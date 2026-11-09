"""事件流：receipt 的每次写入都要能重放回来。"""
import json

import pytest

from app import run_events


def test_trace_roundtrips_flat_sets():
    receipt = run_events.trace({'id': 'r1', 'status': 'running'})
    receipt['status'] = 'completed'
    receipt['finished_at'] = 123
    replayed = run_events.project(run_events.events_of(receipt))
    assert replayed == run_events.plain(receipt)
    assert run_events.verify(receipt)['ok'] is True


def test_nested_dict_write_is_captured():
    receipt = run_events.trace({'context': {'used': 0}})
    receipt['context']['used'] = 16000
    receipt['context']['overflow_suspected'] = True
    assert receipt['context']['used'] == 16000
    replayed = run_events.project(run_events.events_of(receipt))
    assert replayed['context'] == {'used': 16000, 'overflow_suspected': True}
    assert run_events.verify(receipt)['ok'] is True


def test_list_append_and_nested_step_status_are_captured():
    receipt = run_events.trace({'steps': [], 'plan': None})
    receipt['steps'].append({'id': 's1', 'status': 'pending'})
    receipt['steps'].append({'id': 's2', 'status': 'pending'})
    receipt['plan'] = {'steps': [{'id': 's1', 'status': 'pending'}]}
    receipt['plan']['steps'][0]['status'] = 'running'
    replayed = run_events.project(run_events.events_of(receipt))
    assert len(replayed['steps']) == 2
    assert replayed['plan']['steps'][0]['status'] == 'running'
    assert run_events.verify(receipt)['ok'] is True


def test_deleting_a_key_replays_as_absent():
    receipt = run_events.trace({'a': 1, 'b': 2})
    del receipt['a']
    replayed = run_events.project(run_events.events_of(receipt))
    assert 'a' not in replayed and replayed['b'] == 2
    assert run_events.verify(receipt)['ok'] is True


def test_verify_detects_write_that_bypassed_the_proxy():
    receipt = run_events.trace({'a': 1})
    dict.__setitem__(receipt, 'a', 99)          # 绕过代理，事件流没看见
    result = run_events.verify(receipt)
    assert result['ok'] is False
    assert result['diff'][0]['key'] == 'a'


def test_switch_off_returns_plain_dict_and_records_nothing():
    import os
    previous = os.environ.get(run_events.ENABLE_ENV)
    os.environ[run_events.ENABLE_ENV] = '0'
    try:
        receipt = run_events.trace({'a': 1})
        assert type(receipt) is dict
        assert run_events.events_of(receipt) == []
        assert run_events.stats_of(receipt)['tracked'] is False
        assert run_events.verify(receipt)['ok'] is True
    finally:
        if previous is None:
            os.environ.pop(run_events.ENABLE_ENV, None)
        else:
            os.environ[run_events.ENABLE_ENV] = previous


def test_traced_receipt_is_json_serialisable_and_copies_to_plain_data():
    import copy
    receipt = run_events.trace({'id': 'r', 'tools': [{'name': 't'}]})
    receipt['tools'].append({'name': 'u'})
    text = json.dumps(receipt, ensure_ascii=False, sort_keys=True)
    assert json.loads(text)['tools'][1]['name'] == 'u'
    clone = copy.deepcopy(receipt)
    assert type(clone) is dict and type(clone['tools']) is list
    # 深拷贝出来的普通数据不能再影响事件流
    clone['tools'].append({'name': 'v'})
    assert len(receipt['tools']) == 2
    assert len(run_events.verify(receipt)['diff']) == 0


def test_event_log_is_bounded_and_marks_itself_untrustworthy():
    limit = run_events._Log().limit
    writes = 50
    receipt = run_events.trace({'n': 0})
    for i in range(limit + writes):
        receipt['n'] = i
    stats = run_events.stats_of(receipt)
    assert stats['events'] == limit
    assert stats['dropped'] == writes + 1
    assert stats['events'] + stats['dropped'] == limit + writes + 1
    # 事件被截断时校验结果必须自曝不可信，不能拿半截事件流说“相等”
    result = run_events.verify(receipt)
    assert result['truncated'] is True and result['ok'] is False


def test_event_carries_sequence_and_timestamp():
    receipt = run_events.trace({'a': 1})
    receipt['a'] = 2
    events = run_events.events_of(receipt)
    assert [e['seq'] for e in events] == list(range(1, len(events) + 1))
    assert all(isinstance(e['at'], int) and e['at'] > 0 for e in events)
    assert events[-1]['path'] == ['a'] and events[-1]['value'] == 2


# ---------------------------------------------------------------- 真实运行

HEADERS = {'X-Project-Id': 'event-stream'}
SESSION = {'id': 'c1', 'title': '事件流', 'updated': 1, 'messages': []}


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main, store
    monkeypatch.setattr(store, 'DB', tmp_path / 'events.db')
    main.locks.clear()
    main.LIVE_RUNS.clear()
    main.RUN_EVENTS.clear()
    main.RUN_ENDED.clear()
    return TestClient(main.app)


def _stub_graph(monkeypatch):
    """把模型换成固定输出的假 graph：只要 stream() 的装配逻辑是真的。"""
    from types import SimpleNamespace
    from app import main

    class Graph:
        async def astream(self, payload, **kwargs):
            yield SimpleNamespace(content='收到'), {}
            yield SimpleNamespace(content='，好的。'), {}

    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    monkeypatch.setattr(main, 'create_agent', lambda **kwargs: Graph())


def _run(client):
    assert client.put('/agent/sessions/c1', headers=HEADERS, json=SESSION).status_code == 200
    response = client.post('/agent/chat', headers=HEADERS, json={'session_id': 'c1', 'text': '你好'})
    assert response.status_code == 200
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    assert events[-1]['type'] == 'done'
    return events[-1]['execution']


def test_live_run_replays_to_an_identical_receipt(client, monkeypatch):
    """一轮真实请求结束后，事件重放出的结构与内存里的 receipt 必须逐字段相等。"""
    _stub_graph(monkeypatch)
    receipt = _run(client)
    stream = receipt['event_stream']
    assert stream['tracked'] is True
    assert stream['truncated'] is False
    assert stream['ok'] is True, stream['diff']
    assert stream['events'] > 15


def test_receipt_is_still_plain_json_on_the_wire(client, monkeypatch):
    """代理外壳不能漏到返回体里：done 事件必须能 json 往返。"""
    _stub_graph(monkeypatch)
    receipt = _run(client)
    assert type(receipt) is dict
    assert json.loads(json.dumps(receipt, ensure_ascii=False))['status'] == 'completed'
    assert 'event_stream' in receipt
    # 持久化后的回执与流里的回执一致
    saved = client.get('/agent/executions/' + receipt['id'], headers=HEADERS).json()
    assert saved['status'] == receipt['status']
    assert saved['event_stream']['ok'] is True


def test_events_are_persisted_and_replay_into_the_same_receipt(client, monkeypatch):
    """落库的事件重放出来必须等于落库的回执——事件能当真相，回执就能当缓存。"""
    _stub_graph(monkeypatch)
    receipt = _run(client)
    run_id = receipt['id']

    events = client.get('/agent/executions/' + run_id + '/events', headers=HEADERS).json()
    assert events['total'] > 15
    assert [e['seq'] for e in events['items']] == list(range(1, len(events['items']) + 1))
    assert all({'seq', 'at', 'op', 'path'} <= set(e) for e in events['items'])

    projection = client.get('/agent/executions/' + run_id + '/projection', headers=HEADERS).json()
    assert projection['tracked'] is True
    assert projection['identical'] is True, projection['diff']
    assert projection['projection']['status'] == 'completed'
    assert projection['projection']['id'] == run_id


def test_event_pagination_returns_the_tail(client, monkeypatch):
    _stub_graph(monkeypatch)
    receipt = _run(client)
    run_id = receipt['id']
    head = client.get('/agent/executions/' + run_id + '/events?limit=5', headers=HEADERS).json()
    assert [e['seq'] for e in head['items']] == [1, 2, 3, 4, 5]
    tail = client.get('/agent/executions/' + run_id + '/events?after=5&limit=2000', headers=HEADERS).json()
    assert all(e['seq'] > 5 for e in tail['items'])
    assert len(head['items']) + len(tail['items']) == head['total']


def test_unknown_run_has_no_events(client):
    assert client.get('/agent/executions/nope/events', headers=HEADERS).status_code == 404
    assert client.get('/agent/executions/nope/projection', headers=HEADERS).status_code == 404

