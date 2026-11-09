"""轮次领域模型：turn = 一次用户提交，step = 一次模型调用。

之前这两个概念混在 cycle / max_rounds / plan.steps 里，加指标只能往 receipt
平铺。现在 turn 是显式对象，stats 在里面，前端统计条读它。
"""
import json

import pytest


HEADERS = {'X-Project-Id': 'turn-model'}


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main, store
    monkeypatch.setattr(store, 'DB', tmp_path / 'turn.db')
    main.locks.clear()
    main.LIVE_RUNS.clear()
    main.RUN_EVENTS.clear()
    main.RUN_ENDED.clear()
    return TestClient(main.app)


def _stub(monkeypatch, chunks=('好的', '。')):
    from types import SimpleNamespace
    from app import main

    class Graph:
        async def astream(self, payload, **kwargs):
            for chunk in chunks:
                yield SimpleNamespace(content=chunk), {}

    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    monkeypatch.setattr(main, 'create_agent', lambda **kwargs: Graph())


def _turn(client, text='你好'):
    response = client.post('/agent/chat', headers=HEADERS, json={'session_id': 'c1', 'text': text})
    assert response.status_code == 200
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    assert events[-1]['type'] == 'done'
    return events[-1]['execution']


def test_turn_index_counts_user_submissions(client, monkeypatch):
    _stub(monkeypatch)
    assert client.put('/agent/sessions/c1', headers=HEADERS,
                      json={'id': 'c1', 'title': '轮次', 'updated': 1, 'messages': []}).status_code == 200
    first = _turn(client, '第一轮')
    second = _turn(client, '第二轮')
    third = _turn(client, '第三轮')
    assert [first['turn']['index'], second['turn']['index'], third['turn']['index']] == [1, 2, 3]
    assert third['turn']['run_id'] == third['id']


def test_turn_stats_is_the_canonical_copy_of_timing(client, monkeypatch):
    _stub(monkeypatch)
    client.put('/agent/sessions/c1', headers=HEADERS,
               json={'id': 'c1', 'title': '轮次', 'updated': 1, 'messages': []})
    receipt = _turn(client)
    turn = receipt['turn']
    assert set(turn) == {'index', 'run_id', 'started_at', 'ended_at', 'step_count', 'steps', 'stats'}
    # stats 是规范位置，timing 是同值快照，两边不能漂移
    assert turn['stats'] == receipt['timing']
    assert turn['step_count'] == receipt['timing']['model_calls']
    assert turn['ended_at'] == receipt['finished_at']
    assert turn['started_at'] <= turn['ended_at']
    # 假 graph 不跑 CycleTrace 中间件，所以 model_calls 是 0；这里只校验字段齐全且同源
    assert set(turn['stats']) == {'llm_ms', 'tool_ms', 'model_calls', 'tool_calls', 'ttft_ms',
                                 'decode_ms', 'decode_tokens', 'tps'}
    assert turn['step_count'] == turn['stats']['model_calls']


def test_turn_survives_the_event_roundtrip(client, monkeypatch):
    _stub(monkeypatch)
    client.put('/agent/sessions/c1', headers=HEADERS,
               json={'id': 'c1', 'title': '轮次', 'updated': 1, 'messages': []})
    receipt = _turn(client)
    projection = client.get('/agent/executions/' + receipt['id'] + '/projection', headers=HEADERS).json()
    assert projection['identical'] is True, projection['diff']
    assert projection['projection']['turn']['stats'] == receipt['timing']
