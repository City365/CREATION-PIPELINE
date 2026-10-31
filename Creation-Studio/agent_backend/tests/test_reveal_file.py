"""reveal：在资源管理器里定位交付文件所在文件夹（优先源位置，其次工作区副本）。"""
from fastapi.testclient import TestClient

import app.main as main
import app.workspace as ws


def client():
    return TestClient(main.app)


def test_reveal_selects_source_file(monkeypatch, tmp_path):
    source = tmp_path / '刀不出鞘_批量任务.txt'
    source.write_text('x', encoding='utf-8')
    monkeypatch.setattr(ws, 'file_record', lambda project, fid, session_id=None: {'id': fid, 'name': source.name, 'source': str(source)})
    launched = []
    monkeypatch.setattr(ws.subprocess, 'Popen', lambda args: launched.append(args))
    res = client().post('/agent/workspace/files/f1/reveal', headers={'X-Project-Id': 'p1'})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body['ok'] is True
    assert body['from_source'] is True
    assert body['path'] == str(source)
    assert body['folder'] == str(tmp_path)
    assert launched and launched[0][0] == 'explorer' and launched[0][1] == '/select,' + str(source)


def test_reveal_falls_back_to_workspace_copy(monkeypatch, tmp_path):
    missing = tmp_path / 'gone.txt'
    copy = tmp_path / 'file_abc' / 'file_abc.txt'
    copy.parent.mkdir(parents=True)
    copy.write_text('x', encoding='utf-8')
    monkeypatch.setattr(ws, 'file_record', lambda project, fid, session_id=None: {'id': fid, 'name': 'a.txt', 'source': str(missing)})
    monkeypatch.setattr(ws, 'file_path', lambda item: copy)
    launched = []
    monkeypatch.setattr(ws.subprocess, 'Popen', lambda args: launched.append(args))
    res = client().post('/agent/workspace/files/f1/reveal', headers={'X-Project-Id': 'p1'})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body['from_source'] is False
    assert body['path'] == str(copy)
    assert launched[0][1] == '/select,' + str(copy)


def test_reveal_reports_missing_file(monkeypatch, tmp_path):
    monkeypatch.setattr(ws, 'file_record', lambda project, fid, session_id=None: {'id': fid, 'name': 'a.txt', 'source': None})
    monkeypatch.setattr(ws, 'file_path', lambda item: tmp_path / 'nope' / 'nope.txt')
    res = client().post('/agent/workspace/files/f1/reveal', headers={'X-Project-Id': 'p1'})
    assert res.status_code == 404
    assert '磁盘' in res.json()['detail']


def test_reveal_needs_project_header():
    res = client().post('/agent/workspace/files/f1/reveal')
    assert res.status_code == 422
