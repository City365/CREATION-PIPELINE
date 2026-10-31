"""执行中的实时状态：工具开始/结束时把「在做什么」推给前端。"""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import main, store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'chat.db')
    main.locks.clear()
    main.LIVE_RUNS.clear()
    main.RUN_EVENTS.clear()
    main.RUN_ENDED.clear()
    return TestClient(main.app)


def headers(project='p1'):
    return {'X-Project-Id': project}


def test_tool_detail_prefers_the_meaningful_argument():
    assert main.tool_detail({'command': 'npm test'}) == 'npm test'
    assert main.tool_detail({'path': 'D:/work/分集.md'}) == 'D:/work/分集.md'
    assert main.tool_detail({'prompt': '深秋山道'}) == '深秋山道'
    assert main.tool_detail({'whatever': '随便一个值'}) == '随便一个值'
    assert main.tool_detail({}) == ''
    assert main.tool_detail(None) == ''
    long = main.tool_detail({'command': 'x' * 200})
    assert long.endswith('…') and len(long) == 61


def test_tool_result_detail_reports_reason_or_output():
    assert main.tool_result_detail('{"ok":false,"error":"配额不足"}') == '配额不足'
    assert main.tool_result_detail('{"ok":true,"path":"D:/out.md"}') == 'D:/out.md'
    assert main.tool_result_detail('{"ok":true,"stdout":"全部通过\\n"}') == '全部通过'
    assert main.tool_result_detail('纯文本结果') == '纯文本结果'
    assert main.tool_result_detail('') == ''
    assert main.tool_result_detail('{"ok":true}') == ''


def test_stream_reports_tool_activity_while_running(client, monkeypatch):
    assert client.put('/agent/sessions/c1', headers=headers(),
                      json={'id': 'c1', 'title': '测试', 'updated': 1, 'messages': []}).status_code == 200

    class Graph:
        async def astream(self, payload, **kwargs):
            yield ('updates', {'model': {'messages': [SimpleNamespace(
                type='ai', content='', tool_calls=[{'name': 'run_command', 'args': {'command': 'npm test'}, 'id': 'c1'}])]}})
            yield ('updates', {'tools': {'messages': [SimpleNamespace(
                type='tool', name='run_command', content='{"ok":true,"stdout":"全部通过"}',
                status='success', tool_call_id='c1')]}})
            yield ('updates', {'model': {'messages': [SimpleNamespace(
                type='ai', content='', tool_calls=[{'name': 'write_file', 'args': {'path': 'D:/out/分集.md'}, 'id': 'c2'}])]}})
            yield ('updates', {'tools': {'messages': [SimpleNamespace(
                type='tool', name='write_file', content='{"ok":false,"error":"磁盘只读"}',
                status='error', tool_call_id='c2')]}})
            yield ('messages', (SimpleNamespace(content='好了'), {}))

    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    monkeypatch.setattr(main, 'create_agent', lambda **kwargs: Graph())
    response = client.post('/agent/chat', headers=headers(), json={'session_id': 'c1', 'text': '跑一下测试'})
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    calls = [event for event in events if event['type'] == 'tool_call']
    results = [event for event in events if event['type'] == 'tool_result']
    assert [(e['tool'], e['detail']) for e in calls] == [('run_command', 'npm test'), ('write_file', 'D:/out/分集.md')]
    assert [(e['tool'], e['ok'], e['detail']) for e in results] == [
        ('run_command', True, '全部通过'), ('write_file', False, '磁盘只读')]
    assert all(isinstance(event['time'], int) and event['time'] > 0 for event in calls + results)
    # 事件排在最终回复之前，前端据此实时改标题
    assert [e['type'] for e in events].index('tool_call') < [e['type'] for e in events].index('done')
    assert events[-1]['type'] == 'done'


def test_tool_events_do_not_leak_into_answer_text(client, monkeypatch):
    assert client.put('/agent/sessions/c1', headers=headers(),
                      json={'id': 'c1', 'title': '测试', 'updated': 1, 'messages': []}).status_code == 200

    class Graph:
        async def astream(self, payload, **kwargs):
            yield ('updates', {'tools': {'messages': [SimpleNamespace(
                type='tool', name='list_dir', content='{"ok":true,"entries":[]}',
                status='success', tool_call_id='c9')]}})
            yield ('messages', (SimpleNamespace(content='目录是空的'), {}))

    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    monkeypatch.setattr(main, 'create_agent', lambda **kwargs: Graph())
    response = client.post('/agent/chat', headers=headers(), json={'session_id': 'c1', 'text': '看看目录'})
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    deltas = ''.join(event.get('text', '') for event in events if event['type'] == 'delta')
    assert deltas == '目录是空的'
    assert [event for event in events if event['type'] == 'tool_result'][0]['tool'] == 'list_dir'
