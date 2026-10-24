import asyncio
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from langchain_core.messages import ToolMessage

from app import create_tools, store
from app.harness import recovery, registry, run_store, runtime
from app.harness.tool_gateway import ToolGateway


def test_creation_tools_are_registered():
    tools = create_tools.build_creation_tools()
    ctx = SimpleNamespace(receipt={})
    ToolGateway(ctx, tools)
    assert {t.name for t in tools} <= registry.CAPABILITIES.keys()
    for name in ('generate_image', 'submit_video_job', 'extract_frames'):
        assert registry.CAPABILITIES[name] == 'media_write'
    assert registry.tool_timeout('generate_image', {}, 20) > 300
    assert registry.tool_timeout('wait_video_job', {'timeout_seconds': 600}, 20) > 600


def test_image_tool_preserves_reference_paths(monkeypatch):
    sent = []
    monkeypatch.setattr(create_tools, '_http', lambda method, path, body, **kw: sent.append(body) or {'id': 'mock', 'items': []})
    tool = next(t for t in create_tools.build_creation_tools() if t.name == 'generate_image')
    result = tool.invoke({'prompt': '保留人物，调整背景', 'refs': ['D:/refs/hero.png']})
    assert result['ok']
    assert sent[0]['refs'] == [{'path': 'D:/refs/hero.png', 'name': 'hero.png'}]


@pytest.mark.parametrize('source', ['file', 'environment'])
def test_internal_credentials_are_sent(monkeypatch, tmp_path, source):
    token = 'test-' + 'a' * 64
    monkeypatch.setenv('H3_DATA_DIR', str(tmp_path))
    monkeypatch.delenv('H3_INTERNAL_TOKEN', raising=False)
    if source == 'file':
        (tmp_path / 'internal-token.json').write_text(json.dumps({'token': token}))
    else:
        monkeypatch.setenv('H3_INTERNAL_TOKEN', token)
    captured = []

    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self): return b'{"ok":true,"data":{"status":"ok"}}'

    def open_request(req, **kwargs):
        captured.append(req)
        return Response()

    monkeypatch.setattr(create_tools.urllib.request, 'urlopen', open_request)
    assert create_tools._http('GET', '/api/state')['status'] == 'ok'
    assert captured[0].get_header('X-h3-internal') == token


def test_media_writes_are_deduplicated_and_blocked_on_resume(monkeypatch, tmp_path):
    monkeypatch.setattr(store, 'DB', tmp_path / 'runs.db')
    monkeypatch.setenv('HARNESS_AUTH_MODE', 'development')

    async def check():
        payload, _ = run_store.claim('p1', 's', 'media', 'h')
        ctx = runtime.Runtime('p1', payload)
        ctx.receipt = {}
        tools = create_tools.build_creation_tools()
        gateway = ToolGateway(ctx, tools)
        tool = next(t for t in tools if t.name == 'submit_video_job')
        calls = []

        async def handler(req):
            calls.append(req)
            return ToolMessage(content='{"ok":true,"job_id":"job-1"}', tool_call_id=req.tool_call['id'])

        def request(cid, prompt='生成视频'):
            return SimpleNamespace(tool=tool, tool_call={'name': tool.name, 'id': cid, 'args': {'prompt': prompt}})

        await gateway.awrap_tool_call(request('first'), handler)
        await gateway.awrap_tool_call(request('second'), handler)
        assert len(calls) == 1
        assert not recovery.uncertain('p1', ctx.run_id)
        events = run_store.events('p1', ctx.run_id, 0, 100)
        assert any(e.get('risk') == 'media_write' for e in events)
        ctx.resume_checkpoint = {'plan': {}}
        with pytest.raises(runtime.RunStopped, match='resume_write_blocked'):
            await gateway.awrap_tool_call(request('resume', '新的生成任务'), handler)
        assert len(calls) == 1

    asyncio.run(check())


def test_standalone_startup_uses_this_backend():
    root = Path(__file__).resolve().parents[2]
    script = (root / 'start-agent.cmd').read_text(encoding='utf-8-sig')
    assert 'cd /d "%~dp0agent_backend"' in script
    assert '%~dp0agent_backend\\data\\agent_settings.json' in script
    resolved = subprocess.check_output(
        [sys.executable, '-B', '-c', "import importlib.util; print(importlib.util.find_spec('app').origin)"],
        cwd=root / 'agent_backend', text=True,
    ).strip()
    assert Path(resolved).resolve() == root / 'agent_backend' / 'app' / '__init__.py'
