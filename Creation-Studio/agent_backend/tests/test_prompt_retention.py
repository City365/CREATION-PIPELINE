"""提示词留存：切走的应用层文案必须能原样取回，关掉不等于删除。"""
import pytest

from app import app_packs, chat_policy

HEADERS = {'X-Project-Id': 'retention'}


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main, store
    monkeypatch.setattr(store, 'DB', tmp_path / 'retain.db')
    main.locks.clear()
    return TestClient(main.app)


def test_segments_join_back_to_the_exact_prompt():
    for pid in app_packs.names():
        pack = app_packs.load(pid)
        parts = chat_policy.segments(pack)
        assert ''.join(p['text'] for p in parts if p['enabled']) == chat_policy.build(pack)


def test_every_policy_text_matches_its_constant_character_for_character():
    pack = app_packs.load('creation-studio')
    from app.app_packs import creation_studio as mod
    by_id = {p['id']: p for p in chat_policy.segments(pack)}
    assert by_id['policy.format.genui']['text'] == mod.GENUI
    assert by_id['policy.image.paths']['text'] == mod.IMAGE_PATHS
    assert by_id['policy.interaction.ask_choice']['text'] == mod.ASK_CHOICE
    assert by_id['policy.format.genui']['chars'] == len(mod.GENUI)


def test_endpoint_returns_full_text_and_layered_breakdown(client):
    data = client.get('/agent/app-pack/prompt', headers=HEADERS).json()
    assert data['chars'] == 3401
    assert data['chars'] == data['application_chars'] + data['framework_chars']
    assert data['application_chars'] == 2579
    assert len(data['prompt']) == data['chars']
    ids = [s['id'] for s in data['segments']]
    assert ids == ['framework.identity', 'policy.format.genui', 'policy.image.paths',
                   'policy.interaction.ask_choice', 'framework.supplement',
                   'framework.skill.none', 'framework.tail']


def test_compare_shows_exactly_what_switching_away_removes(client):
    data = client.get('/agent/app-pack/prompt?compare=generic', headers=HEADERS).json()
    removed = data['compare']['removed']
    assert [s['id'] for s in removed] == ['policy.format.genui', 'policy.image.paths',
                                          'policy.interaction.ask_choice']
    assert data['compare']['removed_chars'] == 2579
    # 切走的原文完整带出来，不是只给个 id
    assert removed[0]['text'].startswith('答复里只有两种格式')
    assert removed[1]['text'].startswith('\n【出图落盘 · 路径规范】')
    assert removed[2]['text'].startswith('\n【智能推荐 · 用面板问用户】')
    # 框架层一段没少
    assert data['compare']['kept'] == ['framework.identity', 'framework.skill.none',
                                       'framework.supplement', 'framework.tail']
    assert data['compare']['chars'] == 818


def test_disabling_a_policy_keeps_its_text_retrievable(client):
    pack = app_packs.load('creation-studio')
    image = pack.policy('image.paths')
    image.enabled = False
    try:
        data = client.get('/agent/app-pack/prompt', headers=HEADERS).json()
    finally:
        image.enabled = True
    seg = next(s for s in data['segments'] if s['id'] == 'policy.image.paths')
    assert seg['enabled'] is False
    assert seg['text'] == image.text, '关掉之后原文必须还在'
    # 不进提示，但仍在留存里
    assert image.text not in data['prompt']
    assert data['chars'] == 3401 - len(image.text)
    assert data['retained_chars'] == 3401


def test_unknown_pack_is_rejected(client):
    response = client.get('/agent/app-pack/prompt?pack=nope', headers=HEADERS)
    assert response.status_code >= 400


def test_generic_pack_has_no_application_layer(client):
    data = client.get('/agent/app-pack/prompt?pack=generic', headers=HEADERS).json()
    assert data['application_chars'] == 0
    assert all(s['layer'] == 'framework' for s in data['segments'])
    assert data['chars'] == data['retained_chars']
