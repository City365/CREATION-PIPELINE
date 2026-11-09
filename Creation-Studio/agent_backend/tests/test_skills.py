import json
import pytest
from fastapi.testclient import TestClient
from app import main, store, skills


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'skills.db')
    main.locks.clear()
    return TestClient(main.app)


def headers(project='p1'):
    return {'X-Project-Id': project}


def test_builtin_skills_cover_all_topics():
    ids = [item['id'] for item in skills.builtin_skills()]
    assert ids == ['novel', 'script', 'storyboard', 'prompt', 'review']
    for item in skills.builtin_skills():
        assert item['source'] == 'builtin' and item['readonly'] is True
        assert item['name'] in skills.skill_topics(), '内置技能名称必须能映射到指导文档 topic'


def test_skills_endpoint_merges_builtin_and_custom(client):
    base = client.get('/agent/skills', headers=headers()).json()['items']
    assert [s['source'] for s in base] == ['builtin'] * 5
    assert client.get('/agent/skills', headers=headers('p2')).json()['items'][-1]['source'] == 'builtin'


def test_install_skill_then_appears_in_both_lists(client):
    body = {'name': '钩子诊断', 'description': '检查短剧开场三秒', 'content': '# 钩子诊断\n\n先看开场三秒。'}
    created = client.post('/agent/skills/install', headers=headers(), json=body).json()
    assert created['ok'] is True and created['reinstalled'] is False
    items = client.get('/agent/skills', headers=headers()).json()['items']
    custom = [s for s in items if s['source'] == 'custom']
    assert len(custom) == 1 and custom[0]['name'] == '钩子诊断'
    assert custom[0]['id'] == 'plugin:dir:钩子诊断' and custom[0]['runtime_status'] == 'available'
    # 技能存在后端目录里，换项目也能看到
    assert any(s['name'] == '钩子诊断' for s in client.get('/agent/skills', headers=headers('p2')).json()['items'])
    # 插件管理读的是同一份目录技能
    plugins = client.get('/agent/plugins', headers=headers()).json()
    assert any(p['name'] == '钩子诊断' and p['kind'] == 'skill' for p in plugins)


def test_reinstall_same_name_updates_instead_of_duplicating(client):
    body = {'name': '钩子诊断', 'description': 'v1', 'content': '第一版'}
    client.post('/agent/skills/install', headers=headers(), json=body)
    again = client.post('/agent/skills/install', headers=headers(), json={**body, 'description': 'v2', 'content': '第二版内容'}).json()
    assert again['reinstalled'] is True
    custom = [s for s in client.get('/agent/skills', headers=headers()).json()['items'] if s['source'] == 'custom']
    assert len(custom) == 1
    assert custom[0]['description'] == 'v2'


def test_install_rejects_empty_and_oversized_content(client):
    empty = client.post('/agent/skills/install', headers=headers(), json={'name': 'x', 'content': ''})
    assert empty.status_code in (400, 422)
    big = client.post('/agent/skills/install', headers=headers(), json={'name': 'big', 'content': 'a' * (skills.SKILL_CONTENT_LIMIT + 1)})
    assert big.status_code == 400
    assert '过长' in big.text
