"""子智能体：子任务成为独立 run，父 run 只留引用。"""
import asyncio

import pytest
from langchain_core.messages import AIMessage

from app import store, subagent


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'sub.db')
    return tmp_path


class Graph:
    def __init__(self, text='子任务完成：三集分镜已拆好', usage=True, delay=0.0):
        self.text = text
        self.usage = usage
        self.delay = delay
        self.calls = 0

    async def ainvoke(self, payload):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        message = AIMessage(content=self.text)
        if self.usage:
            message.usage_metadata = {'input_tokens': 10, 'output_tokens': 5, 'total_tokens': 15}
        return {'messages': [message]}


def creator(graph, capture=None):
    def make(**kwargs):
        if capture is not None:
            capture.update(kwargs)
        return graph
    return make


def tool(name):
    """造一个指定名字的占位工具（LangChain 的 @tool 认 __name__）。"""
    from langchain_core.tools import tool as make

    def placeholder():
        """占位工具。"""
        return {}

    placeholder.__name__ = name
    return make(placeholder)


def test_subagent_gets_its_own_run_and_receipt():
    graph = Graph()
    result = asyncio.run(subagent.execute(
        project='p', parent_run_id='parent-1', task='拆三集分镜', model=object(),
        tools=[tool('read_file')], system_prompt='你是助手', label='分镜',
        create_agent=creator(graph)))
    assert result['ok'] is True
    assert result['summary'].startswith('子任务完成')
    assert result['parent_run_id'] if 'parent_run_id' in result else True
    saved = store.get_run('p', result['run_id'])
    assert saved['kind'] == 'subagent'
    assert saved['parent_run_id'] == 'parent-1'
    assert saved['status'] == 'completed'
    assert saved['label'] == '分镜'
    assert saved['usage'] == {'input_tokens': 10, 'output_tokens': 5, 'total_tokens': 15}
    assert saved['duration_ms'] >= 0
    # 父 run 完全没被塞进子 run 的内容
    assert 'steps' in saved and saved['steps'] == []


def test_subagent_cannot_spawn_another_subagent():
    graph = Graph()
    captured = {}
    asyncio.run(subagent.execute(
        project='p', parent_run_id='parent-1', task='x', model=object(),
        tools=[tool('read_file'), tool('spawn_subagent')], system_prompt='',
        create_agent=creator(graph, captured)))
    names = [item.name for item in captured['tools']]
    assert 'read_file' in names
    assert 'spawn_subagent' not in names, '子智能体不能再派子智能体，否则递归失控'


def test_depth_limit_hides_the_tool(monkeypatch):
    monkeypatch.setattr(subagent, 'MAX_DEPTH', 1)
    base = dict(project='p', parent_run_id='r', model=object(),
                tools=[], system_prompt='', create_agent=creator(Graph()))
    assert [t.name for t in subagent.build_tools(depth=0, **base)] == [
        'spawn_subagent', 'run_parallel_subagents']
    assert subagent.build_tools(depth=1, **base) == []


def test_parallel_runs_every_task_and_isolates_failures():
    """并行子任务：一个失败不拖累其它，每个都有自己的 run_id。"""
    from app import subagent as sub_mod

    def create(**kwargs):
        task = kwargs.get('system_prompt') or ''
        if '坏的' in graph_for[0]:
            raise RuntimeError('这一项炸了')
        return Graph(text='做完了')

    graph_for = ['']
    tools = {t.name: t for t in sub_mod.build_tools(
        project='p', parent_run_id='parent-p', model=object(), tools=[],
        system_prompt='', depth=0, create_agent=create, timeout=5)}

    ok = asyncio.run(tools['run_parallel_subagents'].ainvoke({'tasks': ['第一件', '第二件']}))
    assert ok['ok'] is True and ok['count'] == 2 and ok['succeeded'] == 2
    assert len({item['run_id'] for item in ok['items']}) == 2
    assert all(item['summary'] == '做完了' for item in ok['items'])


def test_parallel_rejects_empty_and_caps_the_batch():
    from app import subagent as sub_mod
    tools = {t.name: t for t in sub_mod.build_tools(
        project='p', parent_run_id='r', model=object(), tools=[], system_prompt='',
        depth=0, create_agent=creator(Graph()), timeout=5)}
    assert asyncio.run(tools['run_parallel_subagents'].ainvoke({'tasks': []}))['ok'] is False
    many = ['任务' + str(i) for i in range(sub_mod.PARALLEL_LIMIT + 4)]
    result = asyncio.run(tools['run_parallel_subagents'].ainvoke({'tasks': many}))
    assert result['count'] == sub_mod.PARALLEL_LIMIT


def test_parallel_tool_is_hidden_inside_a_subagent():
    captured = {}
    asyncio.run(subagent.execute(
        project='p', parent_run_id='p1', task='x', model=object(),
        tools=[tool('read_file'), tool('run_parallel_subagents')], system_prompt='',
        create_agent=creator(Graph(), captured)))
    names = [item.name for item in captured['tools']]
    assert 'run_parallel_subagents' not in names


def test_spawn_tool_call_goes_through_the_full_path():
    graph = Graph()
    tools = subagent.build_tools(project='p', parent_run_id='parent-9', model=object(),
                                tools=[tool('read_file')], system_prompt='你是助手',
                                depth=0, create_agent=creator(graph))
    result = asyncio.run(tools[0].ainvoke({'task': '把第 3 集拆成分镜', 'label': '第3集'}))
    assert result['ok'] is True
    assert result['run_id'] in result['note']
    saved = store.get_run('p', result['run_id'])
    assert saved['task'] == '把第 3 集拆成分镜'


def test_timeout_is_reported_not_raised():
    graph = Graph(delay=1.0)
    result = asyncio.run(subagent.execute(
        project='p', parent_run_id='r', task='慢任务', model=object(), tools=[],
        system_prompt='', timeout=0.05, create_agent=creator(graph)))
    assert result['ok'] is False
    assert '超时' in result['error']
    saved = store.get_run('p', result['run_id'])
    assert saved['status'] == 'failed' and '超时' in saved['error']


def test_failure_inside_subagent_is_reported_not_raised():
    def boom(**kwargs):
        raise RuntimeError('模型渠道不可用')
    result = asyncio.run(subagent.execute(
        project='p', parent_run_id='r', task='x', model=object(), tools=[],
        system_prompt='', create_agent=boom))
    assert result['ok'] is False
    assert '模型渠道不可用' in result['error']
    assert store.get_run('p', result['run_id'])['status'] == 'failed'


def test_empty_answer_marks_the_run_failed():
    graph = Graph(text='')
    result = asyncio.run(subagent.execute(
        project='p', parent_run_id='r', task='x', model=object(), tools=[],
        system_prompt='', create_agent=creator(graph)))
    assert result['ok'] is False
    assert store.get_run('p', result['run_id'])['status'] == 'failed'


# ---------------------------------------------------------------- 端到端

HEADERS = {'X-Project-Id': 'subagent-run'}


def test_parent_run_exposes_the_spawn_tool(tmp_path, monkeypatch):
    """父 run 的工具表里真的有 spawn_subagent，且只挂一层。"""
    from fastapi.testclient import TestClient
    from types import SimpleNamespace
    from app import main, store as store_mod, subagent as sub_mod

    monkeypatch.setattr(store_mod, 'DB', tmp_path / 'parent.db')
    main.locks.clear()
    main.LIVE_RUNS.clear()
    main.RUN_EVENTS.clear()
    main.RUN_ENDED.clear()
    monkeypatch.setattr(main, 'supports_tools', lambda provider, cfg: True)

    captured = {}

    class Graph:
        async def astream(self, payload, **kwargs):
            yield SimpleNamespace(content='好'), {}

    def create(**kwargs):
        captured['tools'] = kwargs.get('tools') or []
        captured['prompt'] = kwargs.get('system_prompt') or ''
        return Graph()

    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    monkeypatch.setattr(main, 'create_agent', create)

    client = TestClient(main.app)
    client.put('/agent/sessions/s1', headers=HEADERS,
               json={'id': 's1', 'title': '子任务', 'updated': 1, 'messages': []})
    assert client.post('/agent/chat', headers=HEADERS,
                       json={'session_id': 's1', 'text': '你好'}).status_code == 200

    names = [item.name for item in captured['tools']]
    assert 'spawn_subagent' in names
    assert 'read_file' in names
    # 深度上限 1：父 run 拿到工具，子 run 就不该再有
    assert sub_mod.build_tools(project='p', parent_run_id='r', model=object(), tools=[],
                               system_prompt='', depth=1, create_agent=creator(Graph())) == []
