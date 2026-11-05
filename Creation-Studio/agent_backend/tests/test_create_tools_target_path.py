"""生图路径参数：项目资产图传 target_path（项目相对路径），聊天随手出图不传。

规范目的：素材库里的图固定在自己的相对路径上，聊天里临时出的图走项目 media/images，
两条路分开；所有路径都相对项目根目录，用户换根目录也不会失效。
"""
from urllib.parse import quote

from app import create_tools


def _tools(project=None, session_id=None, publish=None):
    return {t.name: t for t in create_tools.build_creation_tools(publish, project, session_id)}


def _fake_http(sent, items):
    def http(method, path, body=None, **kwargs):
        sent.append((path, body))
        return {'id': 'mock', 'items': items}
    return http


PNG_ITEM = {'path': 'D:/proj/assets/素材/人物/第1集/a.png', 'rel': 'assets/素材/人物/第1集/a.png',
            'name': 'a.png', 'url': '/api/file?rel=x', 'bytes': 10}


def test_asset_generation_sends_project_and_target_path(monkeypatch):
    sent = []
    monkeypatch.setattr(create_tools, '_http', _fake_http(sent, [PNG_ITEM]))
    tool = _tools(project='proj-1', session_id='s-1')['generate_image']
    result = tool.invoke({'prompt': '三视图', 'target_path': 'assets/素材/人物/第1集/a.png'})
    assert result['ok']
    path, body = sent[0]
    assert path == '/api/images/generate'
    assert body['projectId'] == 'proj-1'
    assert body['targetPath'] == 'assets/素材/人物/第1集/a.png'
    assert result['images'][0]['rel'] == 'assets/素材/人物/第1集/a.png'


def test_chat_generation_does_not_send_target_path(monkeypatch):
    sent = []
    monkeypatch.setattr(create_tools, '_http', _fake_http(sent, [PNG_ITEM]))
    tool = _tools(project='proj-1', session_id='s-1')['generate_image']
    assert tool.invoke({'prompt': '随手来一张'})['ok']
    body = sent[0][1]
    assert 'targetPath' not in body, '聊天随手出图不能传路径参数'
    assert body['projectId'] == 'proj-1', '仍然要带项目，图才不会跑到旧媒体库'


def test_media_url_uses_project_relative_path(monkeypatch):
    published = []
    monkeypatch.setattr(create_tools, '_http', _fake_http([], [PNG_ITEM]))
    tool = _tools(project='proj-1', session_id='s-1', publish=published.append)['generate_image']
    tool.invoke({'prompt': '三视图', 'target_path': 'assets/素材/人物/第1集/a.png'})
    files = published[0]['files']
    rel = 'assets/素材/人物/第1集/a.png'
    assert files[0]['url'] == '/api/file?rel=' + quote(rel) + '&projectId=proj-1'
    assert files[0]['rel'] == rel
