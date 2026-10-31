"""贴图后的识别与预览：状态要能走到 indexed，raw 能取到原图。"""
import time

import pytest
from fastapi.testclient import TestClient

from app import main, store, workspace

PNG = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
    '0000000a49444154789c6360000002000154a24f9d0000000049454e44ae426082'
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'ws.db')
    monkeypatch.setattr(workspace, 'ROOT', tmp_path / 'workspace')
    main.locks.clear()
    return TestClient(main.app)


def headers(project='p1'):
    return {'X-Project-Id': project}


def test_image_upload_then_recognized(client, monkeypatch):
    # 视觉接口用假实现，避免测试依赖真实模型
    monkeypatch.setattr(
        'app.create_tools._http',
        lambda method, path, body=None, timeout=60: {'text': '一张红色圆形的测试图'},
        raising=True,
    )
    saved = workspace.save_upload('p1', 'shot.png', PNG)
    assert saved['status'] == 'pending_recognition', '上传当时还没识别完'

    item = None
    for _ in range(100):
        item = client.get('/agent/workspace/files/' + saved['id'], headers=headers()).json()
        if item['status'] != 'pending_recognition':
            break
        time.sleep(0.1)
    assert item['status'] == 'indexed', item
    assert item['error'] == ''

    content = client.get('/agent/workspace/files/' + saved['id'] + '/content', headers=headers()).json()
    assert content['ok'] is True
    assert '红色圆形' in (content.get('content') or content.get('text') or '')


def test_recognition_failure_is_reported(client, monkeypatch):
    def boom(method, path, body=None, timeout=60):
        raise RuntimeError('视觉接口 502')

    monkeypatch.setattr('app.create_tools._http', boom, raising=True)
    saved = workspace.save_upload('p1', 'bad.png', PNG)
    item = None
    for _ in range(100):
        item = client.get('/agent/workspace/files/' + saved['id'], headers=headers()).json()
        if item['status'] != 'pending_recognition':
            break
        time.sleep(0.1)
    assert item['status'] == 'recognition_failed'
    assert '502' in item['error']


def test_raw_endpoint_serves_image_with_project_query(client):
    saved = workspace.save_upload('p1', 'raw.png', PNG)
    # <img> 带不了请求头，必须支持 ?project=
    res = client.get('/agent/workspace/files/' + saved['id'] + '/raw?project=p1')
    assert res.status_code == 200
    assert res.headers['content-type'].startswith('image/png')
    assert res.content == PNG
    assert client.get('/agent/workspace/files/' + saved['id'] + '/raw').status_code == 422
