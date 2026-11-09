"""端到端：应用包声明 MCP server，工具就出现在 agent 的工具表里。"""
import json
import pathlib
import sys

import pytest

from app import app_packs, mcp, spill
from app.app_packs.base import Pack

FIXTURE = pathlib.Path(__file__).resolve().parent / 'fixtures' / 'mcp_echo_server.py'
HEADERS = {'X-Project-Id': 'mcp-runtime'}

ECHO = {'name': 'echo-test', 'command': sys.executable, 'args': [str(FIXTURE)], 'timeout': 20}


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main, store
    monkeypatch.setattr(store, 'DB', tmp_path / 'mcp.db')
    monkeypatch.setattr(spill, 'ROOT', tmp_path / 'spills')
    mcp.shutdown()
    pack = Pack(id='mcp-test', name='MCP 测试', product='TEST', forbidden_pipelines='固定流程',
                policies=[], skill_topics={}, mcp_servers=[ECHO])
    monkeypatch.setitem(app_packs.PACKS, 'mcp-test', pack)
    monkeypatch.setenv(app_packs.ENV, 'mcp-test')
    main.locks.clear()
    main.LIVE_RUNS.clear()
    main.RUN_EVENTS.clear()
    main.RUN_ENDED.clear()
    yield TestClient(main.app)
    mcp.shutdown()


def _stub(monkeypatch, captured):
    from types import SimpleNamespace
    from app import main

    class Graph:
        async def astream(self, payload, **kwargs):
            yield SimpleNamespace(content='好的'), {}

    def create(**kwargs):
        captured['tools'] = kwargs.get('tools') or []
        return Graph()

    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    monkeypatch.setattr(main, 'create_agent', create)


def test_pack_mcp_servers_reach_the_tool_list(client, monkeypatch):
    captured = {}
    _stub(monkeypatch, captured)
    client.put('/agent/sessions/c1', headers=HEADERS,
               json={'id': 'c1', 'title': 'mcp', 'updated': 1, 'messages': []})
    assert client.post('/agent/chat', headers=HEADERS,
                       json={'session_id': 'c1', 'text': '你好'}).status_code == 200
    names = sorted(t.name for t in captured['tools'])
    assert 'mcp__echo-test__echo' in names
    assert 'mcp__echo-test__fail' in names
    # 落盘回读工具与内置工具共存
    assert 'read_tool_output' in names
    assert 'read_file' in names


def test_mcp_tool_is_callable_inside_the_run(client, monkeypatch):
    captured = {}
    _stub(monkeypatch, captured)
    tools = {t.name: t for t in mcp.build_mcp_tools([ECHO], project='mcp-runtime', run_id='r1')}
    result = tools['mcp__echo-test__echo'].invoke({'text': '回环'})
    assert result['ok'] is True and result['content'] == '回环'


def test_servers_endpoint_reports_live_state(client):
    data = client.get('/agent/mcp/servers', headers=HEADERS).json()
    assert data['count'] == 1 and data['available'] == 1
    item = data['items'][0]
    assert item['name'] == 'echo-test' and item['ok'] is True
    assert sorted(item['items']) == ['big', 'echo', 'fail']


def test_broken_server_is_reported_not_fatal(client, monkeypatch):
    pack = app_packs.load('mcp-test')
    monkeypatch.setattr(pack, 'mcp_servers', [ECHO, {'name': 'dead', 'command': 'no-such-binary-xyz'}])
    data = client.get('/agent/mcp/servers', headers=HEADERS).json()
    assert data['count'] == 2 and data['available'] == 1
    dead = next(i for i in data['items'] if i['name'] == 'dead')
    assert dead['ok'] is False and dead['error']


def test_health_reports_mcp_runtime(client):
    health = client.get('/agent/health', headers=HEADERS).json()
    assert health['mcp_runtime'] is True
