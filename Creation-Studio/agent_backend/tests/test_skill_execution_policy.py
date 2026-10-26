import asyncio,json
from types import SimpleNamespace
import pytest
from app import store
from app.harness import runtime,run_store,policy
from app.harness.model_gateway import ModelGateway
from app.models import factory

def test_skill_profile_is_bounded_and_chat_unchanged(monkeypatch):
    for key in ('H3_SKILL_RUN_TIMEOUT','H3_SKILL_MODEL_TIMEOUT','H3_MODEL_TIMEOUT'):monkeypatch.delenv(key,raising=False)
    chat=policy.profile(SimpleNamespace(skill='',skill_id=None));skill=policy.profile(SimpleNamespace(skill='资产提取',skill_id='asset'))
    assert chat['seconds']==180 and chat['model_timeout']==120 and chat['model_calls']==8
    assert skill['seconds']==600 and skill['model_timeout']==300 and skill['model_calls']==16 and skill['tool_calls']==32
    monkeypatch.setenv('H3_SKILL_RUN_TIMEOUT','999999');assert policy.profile(SimpleNamespace(skill='x'))['seconds']==1800
    monkeypatch.setenv('H3_SKILL_MODEL_TIMEOUT','999999');assert policy.profile(SimpleNamespace(skill='x'))['model_timeout']==1800

def test_factory_uses_harness_timeout_without_sdk_retry(monkeypatch):
    captured={}
    monkeypatch.setattr(factory,'resolve_model',lambda *a:('openai',{'model':'mock','base_url':'http://local/v1','api_key':'local-key'}))
    monkeypatch.setattr(factory,'ChatOpenAI',lambda **kw:captured.update(kw) or object())
    ctx=SimpleNamespace(model_timeout=300,budget=SimpleNamespace(limits={'output_tokens':24000}))
    token=runtime.current.set(ctx)
    try:factory.create_chat_model()
    finally:runtime.current.reset(token)
    assert captured['timeout']==300 and captured['max_retries']==0

def test_timeout_records_failed_call_and_marks_pending_step_running(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB',tmp_path/'db.sqlite')
    item,_=run_store.claim('p','s','one','hash',seconds=600)
    ctx=runtime.Runtime('p',item,seconds=600);ctx.model_timeout=300
    ctx.receipt={'plan':{'steps':[{'id':'one','status':'completed'},{'id':'two','status':'pending'}]}}
    gateway=ModelGateway(ctx)
    class Request:
        model=SimpleNamespace(max_tokens=24000);model_settings={}
        def override(self,**kw):return self
    async def fail(request):raise TimeoutError('delayed provider')
    async def execute():
        with pytest.raises(TimeoutError):await gateway.awrap_model_call(Request(),fail)
    asyncio.run(execute())
    events=run_store.events('p',item['id'])
    failed=next(e for e in events if e['type']=='model_failed')
    assert failed['timeout_seconds']==300 and failed['duration_ms']>=0
    assert ctx.receipt['reason_code']=='model_response_timeout'
    assert ctx.receipt['plan']['steps'][1]['status']=='running'
    assert ctx.budget.publish()['model_calls']==1
