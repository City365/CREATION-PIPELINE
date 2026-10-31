import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import main, skill_library, store, workspace


def make_skill(root, name, description='', body='# 技能\n\n步骤一。'):
    folder = root / name
    (folder / 'references').mkdir(parents=True, exist_ok=True)
    (folder / 'SKILL.md').write_text(
        '---\nname: ' + name + '\ndescription: ' + description + '\n---\n\n' + body,
        encoding='utf-8')
    (folder / 'references' / 'format.md').write_text('格式说明。', encoding='utf-8')
    return folder


def zip_bytes(entries):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, data in entries:
            archive.writestr(name, data)
    return buffer.getvalue()


def test_scan_composes_skill_md_and_references(tmp_path, monkeypatch):
    monkeypatch.setattr(skill_library, 'ROOT', tmp_path / 'lib')
    make_skill(tmp_path / 'lib', '演示技能', '一句话描述')
    items = skill_library.scan()
    assert len(items) == 1
    item = items[0]
    assert item['id'] == 'dir:演示技能'
    assert item['name'] == '演示技能'
    assert item['description'] == '一句话描述'
    assert '格式说明。' in item['config']['instructions']
    assert item['config']['mode'] == 'bundle'


def test_library_skills_are_visible_in_every_project(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'db.sqlite')
    monkeypatch.setattr(skill_library, 'ROOT', tmp_path / 'lib')
    make_skill(tmp_path / 'lib', '全局技能')
    assert [item['name'] for item in workspace.plugins('p1', 'skill')] == ['全局技能']
    assert [item['name'] for item in workspace.plugins('p2', 'skill')] == ['全局技能']


def test_write_rename_and_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(skill_library, 'ROOT', tmp_path / 'lib')
    item = skill_library.write_skill('新技能', '描述', '# 正文\n\n内容')
    assert item['name'] == '新技能'
    assert (tmp_path / 'lib' / '新技能' / 'SKILL.md').is_file()
    renamed = skill_library.update_skill('新技能', '改名技能', '描述2', '# 新正文')
    assert renamed['name'] == '改名技能'
    assert not (tmp_path / 'lib' / '新技能').exists()
    assert '新正文' in (tmp_path / 'lib' / '改名技能' / 'SKILL.md').read_text(encoding='utf-8')
    skill_library.delete_skill('改名技能')
    assert skill_library.scan() == []


def test_zip_upload_uses_folder_and_blocks_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(skill_library, 'ROOT', tmp_path / 'lib')
    data = zip_bytes([
        ('shotlist/SKILL.md', '---\nname: shotlist\ndescription: 测试包\n---\n\n# 包内技能\n正文'),
        ('shotlist/references/a.md', '附件内容'),
        ('../evil.txt', 'bad'),
        ('__MACOSX/junk.txt', 'junk'),
    ])
    item = skill_library.save_zip('导入技能', data)
    assert item['name'] == '导入技能'
    folder = tmp_path / 'lib' / '导入技能'
    assert (folder / 'SKILL.md').is_file()
    assert (folder / 'references' / 'a.md').is_file()
    assert not (tmp_path / 'evil.txt').exists()
    assert not (folder / '__MACOSX').exists()
    assert '附件内容' in item['config']['instructions']
    with pytest.raises(ValueError):
        skill_library.save_zip('坏包', zip_bytes([('readme.txt', 'no skill here')]))


def test_migrate_database_item_to_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(skill_library, 'ROOT', tmp_path / 'lib')
    item = {'kind': 'skill', 'name': '旧技能', 'description': '旧描述',
            'config': {'instructions': '正文', 'files': [{'path': 'references/x.md', 'content': '附件'}]}}
    assert skill_library.migrate_item(item) == 'created'
    assert (tmp_path / 'lib' / '旧技能' / 'references' / 'x.md').is_file()
    assert skill_library.migrate_item(item) == 'exists'


def test_plugin_api_reads_and_writes_the_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'db.sqlite')
    monkeypatch.setattr(skill_library, 'ROOT', tmp_path / 'lib')
    main.locks.clear()
    client = TestClient(main.app)
    headers = {'X-Project-Id': 'p1'}
    created = client.post('/agent/plugins', headers=headers, json={
        'kind': 'skill', 'name': '接口技能', 'description': 'd',
        'config': {'mode': 'text', 'instructions': '内容'}}).json()
    assert created['id'] == 'dir:接口技能'
    assert (tmp_path / 'lib' / '接口技能' / 'SKILL.md').is_file()
    updated = client.put('/agent/plugins/dir:接口技能', headers=headers, json={
        'kind': 'skill', 'name': '接口技能', 'description': 'd2',
        'config': {'mode': 'text', 'instructions': '新内容'}}).json()
    assert '新内容' in updated['config']['instructions']
    assert client.delete('/agent/plugins/dir:接口技能', headers=headers).status_code == 200
    assert not (tmp_path / 'lib' / '接口技能').exists()
