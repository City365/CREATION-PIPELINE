"""跨轮目标：一条会话里持续存在的「正在做的事」。"""
import json

import pytest

from app import goal, store


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'goal.db')
    return tmp_path


def tools(project='p', session='s'):
    return {t.name: t for t in goal.build_goal_tools(project, session)}


def test_no_goal_means_no_prompt_block():
    assert goal.active('p', 's') is None
    assert goal.prompt_block(None) == ''


def test_set_goal_persists_and_injects():
    result = tools()['set_goal'].invoke({'objective': '把这本小说做成短剧'})
    assert result['ok'] is True
    saved = goal.active('p', 's')
    assert saved['objective'] == '把这本小说做成短剧'
    assert saved['status'] == 'active' and saved['turns'] == 0
    block = goal.prompt_block(saved)
    assert '【跨轮目标】' in block
    assert '把这本小说做成短剧' in block
    assert '不是本轮任务' in block


def test_progress_is_recorded_and_shown():
    tools()['set_goal'].invoke({'objective': '把小说做成短剧'})
    tools()['add_goal_progress'].invoke({'note': '第 1-3 集剧本已出，存在 assets/剧本/'})
    tools()['add_goal_progress'].invoke({'note': '第 4 集拆完分镜'})
    saved = goal.active('p', 's')
    assert [n['text'] for n in saved['notes']][-2:] == ['第 1-3 集剧本已出，存在 assets/剧本/', '第 4 集拆完分镜']
    block = goal.prompt_block(saved)
    assert '最近进展' in block and '第 4 集拆完分镜' in block


def test_progress_without_goal_is_refused():
    result = tools()['add_goal_progress'].invoke({'note': '随便记一条'})
    assert result['ok'] is False
    assert 'set_goal' in result['error']


def test_complete_goal_stops_injection():
    tools()['set_goal'].invoke({'objective': '把小说做成短剧'})
    result = tools()['complete_goal'].invoke({'reason': '第 12 集交付完毕'})
    assert result['ok'] is True
    assert goal.active('p', 's') is None, '结束后不能再注入提示'
    assert goal.current('p', 's')['status'] == 'done'
    assert goal.current('p', 's')['close_reason'] == '第 12 集交付完毕'
    assert goal.prompt_block(goal.active('p', 's')) == ''


def test_turn_counter_advances_only_while_active():
    tools()['set_goal'].invoke({'objective': 'x'})
    for _ in range(3):
        goal.bump_turn('p', 's')
    assert goal.active('p', 's')['turns'] == 3
    tools()['complete_goal'].invoke({})
    assert goal.bump_turn('p', 's') is None
    assert goal.current('p', 's')['turns'] == 3


def test_replacing_the_objective_keeps_identity_and_notes():
    tools()['set_goal'].invoke({'objective': '把小说做成短剧'})
    first = goal.active('p', 's')
    tools()['add_goal_progress'].invoke({'note': '剧本已出'})
    tools()['set_goal'].invoke({'objective': '把小说做成 60 集竖屏短剧'})
    second = goal.active('p', 's')
    assert second['id'] == first['id'], '同一个目标改描述，不换 id'
    assert second['notes'][0]['text'] == '剧本已出'
    assert second['replaced'] == '把小说做成短剧'


def test_new_goal_after_completion_starts_clean():
    tools()['set_goal'].invoke({'objective': '第一个目标'})
    tools()['add_goal_progress'].invoke({'note': '旧进展'})
    tools()['complete_goal'].invoke({})
    tools()['set_goal'].invoke({'objective': '第二个目标'})
    fresh = goal.active('p', 's')
    assert fresh['objective'] == '第二个目标'
    assert fresh['notes'] == [] and fresh['turns'] == 0


def test_goals_are_scoped_per_session():
    tools(session='a')['set_goal'].invoke({'objective': '会话 A 的目标'})
    assert goal.active('p', 'a') is not None
    assert goal.active('p', 'b') is None
    assert goal.active('other', 'a') is None


def test_empty_objective_is_refused():
    result = tools()['set_goal'].invoke({'objective': '   '})
    assert result['ok'] is False
    assert goal.active('p', 's') is None


# ---------------------------------------------------------------- 真实一轮

HEADERS = {'X-Project-Id': 'goal-run'}


def test_goal_reaches_the_system_prompt_of_the_next_turn(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from types import SimpleNamespace
    from app import main

    monkeypatch.setattr(store, 'DB', tmp_path / 'goalrun.db')
    main.locks.clear()
    main.LIVE_RUNS.clear()
    main.RUN_EVENTS.clear()
    main.RUN_ENDED.clear()

    prompts = []

    class Graph:
        async def astream(self, payload, **kwargs):
            yield SimpleNamespace(content='好'), {}

    def create(**kwargs):
        prompts.append(kwargs.get('system_prompt') or '')
        return Graph()

    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    monkeypatch.setattr(main, 'create_agent', create)

    client = TestClient(main.app)
    client.put('/agent/sessions/g1', headers=HEADERS,
               json={'id': 'g1', 'title': '目标', 'updated': 1, 'messages': []})
    assert client.post('/agent/chat', headers=HEADERS,
                       json={'session_id': 'g1', 'text': '你好'}).status_code == 200
    assert '【跨轮目标】' not in prompts[0]

    goal.open_goal('goal-run', 'g1', '把这本书做成 24 集短剧')
    assert client.post('/agent/chat', headers=HEADERS,
                       json={'session_id': 'g1', 'text': '继续'}).status_code == 200
    assert '【跨轮目标】' in prompts[1]
    assert '把这本书做成 24 集短剧' in prompts[1]


def test_receipt_carries_the_goal(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from types import SimpleNamespace
    from app import main

    monkeypatch.setattr(store, 'DB', tmp_path / 'goalrc.db')
    main.locks.clear()
    main.LIVE_RUNS.clear()
    main.RUN_EVENTS.clear()
    main.RUN_ENDED.clear()

    class Graph:
        async def astream(self, payload, **kwargs):
            yield SimpleNamespace(content='好'), {}

    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    monkeypatch.setattr(main, 'create_agent', lambda **kwargs: Graph())

    client = TestClient(main.app)
    client.put('/agent/sessions/g2', headers=HEADERS,
               json={'id': 'g2', 'title': '目标', 'updated': 1, 'messages': []})
    goal.open_goal('goal-run', 'g2', '把这本书做成 24 集短剧')
    response = client.post('/agent/chat', headers=HEADERS, json={'session_id': 'g2', 'text': '继续'})
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    receipt = events[-1]['execution']
    assert receipt['goal']['objective'] == '把这本书做成 24 集短剧'
    assert receipt['goal']['turns'] == 1
    # 目标也要能通过事件重放
    projection = client.get('/agent/executions/' + receipt['id'] + '/projection', headers=HEADERS).json()
    assert projection['identical'] is True, projection['diff']
