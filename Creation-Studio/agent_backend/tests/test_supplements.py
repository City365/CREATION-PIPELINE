"""直发 = 当前任务的补充说明：有序、只并入一次、不取消任务、不丢。"""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import SystemMessage

from app import main, store, supplements


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'chat.db')
    main.locks.clear()
    main.LIVE_RUNS.clear()
    main.RUN_EVENTS.clear()
    main.RUN_ENDED.clear()
    supplements.reset()
    return TestClient(main.app)


def headers(project='p1'):
    return {'X-Project-Id': project}


def create(client):
    return client.put('/agent/sessions/c1', headers=headers(),
                      json={'id': 'c1', 'title': '测试', 'updated': 1, 'messages': []})


class FakeRequest:
    """ModelRequest 的最小替身：只需要 messages / system_message / override。"""

    def __init__(self, messages=None, system_message=None):
        self.messages = list(messages or [])
        self.system_message = SystemMessage(content=system_message) if isinstance(system_message, str) else system_message
        self.model_settings = {}

    def override(self, **kwargs):
        clone = FakeRequest(self.messages, self.system_message)
        for key, value in kwargs.items():
            setattr(clone, key, value)
        return clone


def test_queue_keeps_order_and_never_repeats():
    channel = supplements.RunChannel('p1', 'run-1', 'c1')
    first = channel.push('补充一：改成横屏')
    second = channel.push('补充二：每集 90 秒')
    assert (first['position'], second['position']) == (1, 2)
    assert first['id'] != second['id']

    applied = channel.drain()
    assert [item['text'] for item in applied] == ['补充一：改成横屏', '补充二：每集 90 秒']
    assert all(item['status'] == 'applied' for item in applied)
    # 同一条不会被并入第二次
    assert channel.drain() == []
    assert channel.pending() == []


def test_push_after_close_returns_undelivered():
    channel = supplements.RunChannel('p1', 'run-2', 'c1')
    channel.push('赶上的补充')
    channel.drain()
    assert channel.close() == []        # 已并入的不会再交回
    with pytest.raises(RuntimeError):
        channel.push('任务结束后不该再入队')


def test_close_returns_only_queued_items():
    channel = supplements.RunChannel('p1', 'run-3', 'c1')
    channel.push('甲')
    channel.push('乙')
    channel.drain()
    channel.push('丙')
    left = channel.close()
    assert [item['text'] for item in left] == ['丙']
    assert left[0]['status'] == 'undelivered'
    snapshot = channel.snapshot()
    assert [item['status'] for item in snapshot['items']] == ['applied', 'applied', 'undelivered']


def test_registry_tracks_live_run_per_session():
    channel = supplements.open_run('p1', 'run-4', 'c1')
    assert supplements.live_run('p1', 'c1') is channel
    assert supplements.live_run('p2', 'c1') is None
    supplements.close_run('p1', 'run-4')
    assert supplements.live_run('p1', 'c1') is None
    # 归档仍可查询，前端收尾时能拿到每条的最终状态
    assert supplements.channel('p1', 'run-4').snapshot()['closed'] is True


def test_route_needs_a_running_task(client):
    assert create(client).status_code == 200
    # 没有执行中的任务：直发退回普通发送
    response = client.post('/agent/sessions/c1/supplements', headers=headers(), json={'text': '补充'})
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'no_active_run'
    assert client.post('/agent/runs/run-x/supplements', headers=headers(), json={'text': '补充'}).status_code == 409
    assert client.post('/agent/sessions/missing/supplements', headers=headers(), json={'text': '补充'}).status_code == 404


def test_route_binds_supplement_to_run_id(client):
    assert create(client).status_code == 200
    supplements.open_run('p1', 'run-5', 'c1')
    by_session = client.post('/agent/sessions/c1/supplements', headers=headers(), json={'text': '第一条'})
    assert by_session.status_code == 200
    body = by_session.json()
    assert body['run_id'] == 'run-5' and body['position'] == 1 and body['id'].startswith('sp_')
    by_run = client.post('/agent/runs/run-5/supplements', headers=headers('p2'), json={'text': '别的项目'})
    assert by_run.status_code == 409          # 项目隔离
    by_run = client.post('/agent/runs/run-5/supplements', headers=headers(), json={'text': '第二条'})
    assert by_run.status_code == 200 and by_run.json()['position'] == 2
    snapshot = client.get('/agent/runs/run-5/supplements', headers=headers()).json()
    assert [item['text'] for item in snapshot['items']] == ['第一条', '第二条']
    assert all(item['status'] == 'queued' for item in snapshot['items'])
    supplements.close_run('p1', 'run-5')
    assert client.post('/agent/runs/run-5/supplements', headers=headers(), json={'text': '第三条'}).status_code == 409


def test_middleware_merges_at_model_boundary_only():
    import asyncio
    channel = supplements.RunChannel('p1', 'run-6', 'c1')
    events, seen, captured = [], [], []

    def record(item):
        seen.append(item['text'])

    middleware = supplements.SupplementChannel(channel, publish=events.append, receipt={}, record=record)

    async def handler(request):
        captured.append(request)
        return 'model-response'

    request = FakeRequest(messages=[{'role': 'user', 'content': '把小说拆成分集'}], system_message='基础提示')
    before = list(request.messages)

    async def drive():
        # 还没有补充说明：请求原样透传，行为零变化
        assert await middleware.awrap_model_call(request, handler) == 'model-response'
        channel.push('补充：第 2 集要横屏')
        channel.push('补充：结尾留钩子')
        await middleware.awrap_model_call(request, handler)
        await middleware.awrap_model_call(request, handler)

    asyncio.run(drive())
    assert captured[0].system_message.content == '基础提示'
    system = captured[1].system_message.content
    assert system.startswith('基础提示')
    assert supplements.BLOCK_HEAD in system
    assert system.index('第 2 集要横屏') < system.index('结尾留钩子')
    assert '不是新任务' in system
    assert captured[1].messages == before          # 消息序列（工具调用链）没被动过
    assert seen == ['补充：第 2 集要横屏', '补充：结尾留钩子']
    assert [event['type'] for event in events] == ['supplement'] and events[0]['count'] == 2
    # 下一次调用仍然带着同样的补充说明（不会丢），但不会重复投递
    assert captured[2].system_message.content == system


# ---- 端到端：运行中直发并入当前任务，而不是新开一轮 ----

def _patch_graph(monkeypatch, seen, push_text='', call_middleware=True):
    class Graph:
        async def astream(self, payload, **kwargs):
            if push_text:
                channel = supplements.live_run('p1', 'c1')
                assert channel is not None, '运行中必须能找到当前任务的补充说明通道'
                seen['pushed'] = channel.push(push_text)
            if call_middleware:
                middle = [m for m in seen['middleware'] if isinstance(m, supplements.SupplementChannel)][0]
                captured = {}

                async def handler(request):
                    captured['system'] = request.system_message.content
                    captured['messages'] = len(request.messages)
                    return 'ok'

                await middle.awrap_model_call(FakeRequest(messages=[{'role': 'user', 'content': '历史'}], system_message='基础提示'), handler)
                seen['system'] = captured['system']
            yield SimpleNamespace(content='继续执行中'), {}
            yield SimpleNamespace(content='，已按补充说明调整'), {}

    def fake_create_agent(**kwargs):
        seen['middleware'] = kwargs.get('middleware') or []
        return Graph()

    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    monkeypatch.setattr(main, 'create_agent', fake_create_agent)


def _events(response):
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]


def test_direct_send_while_running_is_merged_not_restarted(client, monkeypatch):
    assert create(client).status_code == 200
    seen = {}
    _patch_graph(monkeypatch, seen, push_text='补充：第 2 集改成横屏，时长 90 秒')
    response = client.post('/agent/chat', headers=headers(), json={'session_id': 'c1', 'text': '继续把第 2 集拆分镜'})
    assert response.status_code == 200
    events = _events(response)
    kinds = [event['type'] for event in events]
    assert seen['pushed']['position'] == 1
    assert 'supplement' in kinds and 'done' in kinds
    assert kinds[-1] == 'done'
    # 模型这次调用的系统提示里带着补充说明，消息序列（计划/工具链）没被改写
    assert '第 2 集改成横屏' in seen['system'] and '不是新任务' in seen['system']
    assert seen['system'].startswith('基础提示')
    receipt = client.get('/agent/executions/' + events[-1]['execution']['id'], headers=headers()).json()
    assert [item['text'] for item in receipt['supplements']] == ['补充：第 2 集改成横屏，时长 90 秒']
    assert receipt['status'] == 'completed'
    saved = client.get('/agent/sessions', headers=headers()).json()[0]['messages']
    assert len(saved) == 2                     # 只有一轮：补充说明没有另起任务
    assert saved[-1]['execution']['supplements'][0]['status'] == 'applied'


def test_supplement_that_misses_its_checkpoint_is_handed_back(client, monkeypatch):
    assert create(client).status_code == 200
    seen = {}
    _patch_graph(monkeypatch, seen, push_text='补充：还没到检查点任务就结束了', call_middleware=False)
    response = client.post('/agent/chat', headers=headers(), json={'session_id': 'c1', 'text': '跑一下'})
    events = _events(response)
    leftovers = [event for event in events if event['type'] == 'supplement_undelivered']
    assert leftovers, '运行结束时必须把没并入的补充说明交回前端'
    assert [item['text'] for item in leftovers[0]['items']] == ['补充：还没到检查点任务就结束了']
    done = [event for event in events if event['type'] == 'done'][-1]
    assert leftovers
    assert 'supplements' not in (done['execution'] or {})
