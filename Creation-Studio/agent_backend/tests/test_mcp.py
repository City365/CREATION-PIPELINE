"""MCP 客户端：握手、工具发现、调用、错误传播、超长结果落盘。"""
import pathlib
import sys

import pytest

from app import mcp, spill

FIXTURE = pathlib.Path(__file__).resolve().parent / 'fixtures' / 'mcp_echo_server.py'


def config(**over):
    base = {'name': 'echo-test', 'command': sys.executable, 'args': [str(FIXTURE)], 'timeout': 20}
    base.update(over)
    return base


@pytest.fixture(autouse=True)
def clean_servers(tmp_path, monkeypatch):
    mcp.shutdown()
    monkeypatch.setattr(spill, 'ROOT', tmp_path / 'spills')
    yield
    mcp.shutdown()


def test_handshake_and_tool_discovery():
    server = mcp.server_for(config())
    tools = server.list_tools()
    assert [t['name'] for t in tools] == ['echo', 'fail', 'big']
    assert tools[0]['inputSchema']['required'] == ['text']


def test_probe_reports_availability():
    ok = mcp.probe(config())
    assert ok['ok'] is True and ok['tools'] == 3 and 'echo' in ok['items']
    bad = mcp.probe(config(name='broken', command='definitely-not-a-command-xyz'))
    assert bad['ok'] is False and bad['error']


def test_unavailable_server_does_not_break_tool_building():
    """一个连不上的 server 只丢自己的工具，其余照常。"""
    tools = mcp.build_mcp_tools([config(), config(name='broken', command='nope-not-here')])
    names = sorted(t.name for t in tools)
    assert names == ['mcp__echo-test__big', 'mcp__echo-test__echo', 'mcp__echo-test__fail']
    assert [item['name'] for item in mcp.LAST_FAILURES] == ['broken']


def test_tool_call_roundtrip_returns_text():
    tools = {t.name: t for t in mcp.build_mcp_tools([config()])}
    result = tools['mcp__echo-test__echo'].invoke({'text': '你好', 'times': 3})
    assert result['ok'] is True
    assert result['content'] == '你好你好你好'
    assert result['server'] == 'echo-test' and result['tool'] == 'echo'
    assert result['duration_ms'] >= 0


def test_error_flag_is_propagated_not_raised():
    tools = {t.name: t for t in mcp.build_mcp_tools([config()])}
    result = tools['mcp__echo-test__fail'].invoke({})
    assert result['ok'] is False
    assert result['content'] == '我失败了'


def test_call_events_are_published():
    seen = []
    tools = {t.name: t for t in mcp.build_mcp_tools([config()], project='p', run_id='r',
                                                   publish=seen.append)}
    tools['mcp__echo-test__echo'].invoke({'text': 'x'})
    assert seen and seen[-1]['type'] == 'tool'
    assert seen[-1]['source'] == 'mcp'
    assert seen[-1]['tool'] == 'mcp__echo-test__echo'
    assert seen[-1]['status'] == 'ok'


def test_long_result_is_spilled():
    import json
    tools = {t.name: t for t in mcp.build_mcp_tools([config()], project='p', run_id='r')}
    result = tools['mcp__echo-test__big'].invoke({'chars': mcp.MAX_RESULT_CHARS + 5000})
    payload = json.loads(result['content'])
    assert payload['truncated'] is True
    assert payload['spill_id'].startswith('s')
    back = spill.read(payload['spill_id'])
    assert back['ok'] is True


def test_unknown_tool_surfaces_server_error():
    server = mcp.server_for(config())
    with pytest.raises(mcp.McpError):
        server.call('不存在', {})


def test_silent_server_times_out_instead_of_hanging():
    """不回复握手的服务器必须超时报错，不能把请求线程挂死。"""
    import time
    silent = {'name': 'silent', 'command': sys.executable,
              'args': ['-c', 'import time; time.sleep(30)'], 'timeout': 0.5}
    started = time.monotonic()
    with pytest.raises(mcp.McpError):
        mcp.server_for(silent)
    assert time.monotonic() - started < 10
