import asyncio, json
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.tools import tool
from app import main, store
from app.harness import runtime, run_store
from app.harness.budget import BudgetLedger
from app.harness.tool_gateway import ToolGateway
from app.harness.model_gateway import ModelGateway

@pytest.fixture
def isolated(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB',tmp_path/'runs.db')
    monkeypatch.setenv('HARNESS_RUNTIME_ENABLED','true');monkeypatch.setenv('HARNESS_PROJECT_ALLOWLIST','p1')
    main.locks.clear()

def context():
    item,_=run_store.claim('p1','s','one','h')
    ctx=runtime.Runtime('p1',item);ctx.receipt={};return ctx

def test_ledger_multicall_usage_limits_and_dedup(isolated):
    ctx=context();ledger=BudgetLedger(ctx,model_calls=2,tool_calls=2,output_tokens=100)
    a=ledger.begin_model();ledger.settle(a,{'input_tokens':10,'output_tokens':3})
    ledger.settle(a,{'input_tokens':10,'output_tokens':3})
    b=ledger.begin_model();ledger.settle(b,{'input_tokens':20,'output_tokens':5})
    assert ledger.publish()['total_tokens']==38
    assert ledger.publish()['usage_complete']
    with pytest.raises(runtime.RunStopped):ledger.begin_model()
    assert ctx.reason=='model_calls_exceeded'

def test_tool_validation_unknown_and_repetition(isolated):
    async def check():
        ctx=context()
        @tool
        def read_analysis_guidance(topic:str)->dict:
            """Read guidance."""
            return {'ok':True}
        gateway=ToolGateway(ctx,[read_analysis_guidance]);calls=[]
        async def handler(req):calls.append(req);return ToolMessage(content='{"ok":true}',tool_call_id='t')
        def req(name='read_analysis_guidance',args=None):return SimpleNamespace(tool_call={'name':name,'args':args or {},'id':'t'},tool=read_analysis_guidance)
        result=await gateway.awrap_tool_call(req(),handler)
        assert result.status=='error' and not calls
        for _ in range(3):await gateway.awrap_tool_call(req(args={'topic':'script'}),handler)
        with pytest.raises(runtime.RunStopped):await gateway.awrap_tool_call(req(args={'topic':'script'}),handler)
        assert len(calls)==3 and ctx.reason=='repeated_tool_calls_exceeded'
    asyncio.run(check())

def test_unknown_tool_cannot_reach_handler(isolated):
    async def check():
        ctx=context();gateway=ToolGateway(ctx,[])
        async def handler(req):pytest.fail('unregistered tool executed')
        with pytest.raises(runtime.RunStopped):await gateway.awrap_tool_call(SimpleNamespace(tool_call={'name':'shell','args':{},'id':'x'},tool=None),handler)
    asyncio.run(check())

def test_model_error_is_not_retried(isolated):
    async def check():
        ctx=context();gateway=ModelGateway(ctx);calls=[]
        class Request:
            model=SimpleNamespace(max_tokens=100);model_settings={}
            def override(self,**kw):return self
        async def handler(req):calls.append(1);raise RuntimeError('401')
        with pytest.raises(RuntimeError):await gateway.awrap_model_call(Request(),handler)
        assert len(calls)==1 and ctx.budget.publish()['missing_usage_calls']==1
    asyncio.run(check())

class ScriptedModel(FakeMessagesListChatModel):
    def bind_tools(self,tools,**kwargs):return self

def test_actual_graph_uses_gateways_and_aggregates_usage(isolated,monkeypatch):
    usage={'input_tokens':10,'output_tokens':3,'total_tokens':13}
    model=ScriptedModel(responses=[
        AIMessage(content='',tool_calls=[{'id':'plan','name':'create_task_plan','args':{'goal':'greet','steps':[{'id':'s1','title':'回应','purpose':'问候'}]}}],usage_metadata=usage),
        AIMessage(content='',tool_calls=[{'id':'step','name':'record_step_result','args':{'step_id':'s1','output':'您好','source_ids':['user_input']}}],usage_metadata=usage),
        AIMessage(content='您好，很高兴为您分析。',usage_metadata=usage)])
    monkeypatch.setattr(main,'create_chat_model',lambda *a,**kw:model)
    client=TestClient(main.app);headers={'X-Project-Id':'p1'}
    client.put('/agent/sessions/s',headers=headers,json={'id':'s','title':'s','updated':1,'messages':[]})
    response=client.post('/agent/chat',headers=headers,json={'session_id':'s','text':'执行所选技能','skill':'小说转剧本'})
    assert response.status_code==200
    result=client.get('/agent/runs/'+response.headers['x-agent-run-id'],headers=headers).json()
    assert result['status']=='succeeded',result
    execution=result['execution']
    assert execution['budget']['model_calls']==3
    assert execution['budget']['tool_calls']==2
    assert {k:execution['usage'][k] for k in ('input_tokens','output_tokens','total_tokens')}=={'input_tokens':30,'output_tokens':9,'total_tokens':39}
    # 这次调用没有缓存明细，命中率必须是 None 而不是 0%——没数据就不编数字
    assert execution['usage']['cache_hit_rate'] is None
    assert execution['budget']['usage_complete']
    assert execution['tool_manifest_hash']
    events=run_store.events('p1',result['id'])
    assert len([e for e in events if e['type']=='model_started'])==3
    assert len([e for e in events if e['type']=='tool_finished'])==2

def test_actual_graph_repeated_tools_cannot_loop(isolated,monkeypatch):
    model=ScriptedModel(responses=[AIMessage(id='m'+str(i),content='',tool_calls=[{'id':'t'+str(i),'name':'read_analysis_guidance','args':{'topic':'scope'}}]) for i in range(5)])
    monkeypatch.setattr(main,'create_chat_model',lambda *a,**kw:model)
    client=TestClient(main.app);headers={'X-Project-Id':'p1'}
    client.put('/agent/sessions/s',headers=headers,json={'id':'s','title':'s','updated':1,'messages':[]})
    response=client.post('/agent/chat',headers=headers,json={'session_id':'s','text':'loop','skill':'小说转剧本'})
    result=run_store.get('p1',response.headers['x-agent-run-id'])
    assert result['status']=='budget_exceeded'
    assert result['reason_code']=='repeated_tool_calls_exceeded'
    assert result['execution']['budget']['tool_calls']==3

def test_output_budget_and_unknown_usage(isolated):
    ctx=context();ledger=BudgetLedger(ctx,output_tokens=10)
    a=ledger.begin_model();ledger.settle(a,None)
    assert ledger.publish()['missing_usage_calls']==1 and not ledger.publish()['usage_complete']
    b=ledger.begin_model()
    with pytest.raises(runtime.RunStopped):ledger.settle(b,{'input_tokens':20,'output_tokens':10})
    assert ctx.reason=='output_tokens_exceeded'

def test_workspace_write_dedup_and_cancel_boundary(isolated):
    async def check():
        ctx=context();calls=[]
        @tool
        def create_workspace_artifact(name:str)->dict:
            """Create artifact."""
            return {'ok':True}
        gateway=ToolGateway(ctx,[create_workspace_artifact])
        def req(cid):return SimpleNamespace(tool_call={'name':'create_workspace_artifact','args':{'name':'report'},'id':cid},tool=create_workspace_artifact)
        async def handler(request):calls.append(1);return ToolMessage(content='{"ok":true}',tool_call_id=request.tool_call['id'])
        await gateway.awrap_tool_call(req('a'),handler)
        reused=await gateway.awrap_tool_call(req('b'),handler)
        assert len(calls)==1 and reused.tool_call_id=='b'
        run_store.cancel('p1',ctx.run_id)
        with pytest.raises(runtime.RunStopped):await gateway.awrap_tool_call(req('c'),handler)
        assert len(calls)==1
    asyncio.run(check())

def test_tool_timeout_stops_followup(isolated):
    async def check():
        ctx=context()
        @tool
        def read_analysis_guidance(topic:str)->dict:
            """Guidance."""
            return {'ok':True}
        gateway=ToolGateway(ctx,[read_analysis_guidance]);gateway.read_timeout=.02
        request=SimpleNamespace(tool_call={'name':'read_analysis_guidance','args':{'topic':'x'},'id':'t'},tool=read_analysis_guidance)
        async def slow(req):await asyncio.sleep(2)
        with pytest.raises(runtime.RunStopped):await gateway.awrap_tool_call(request,slow)
        assert ctx.reason=='tool_timeout_exceeded'
        with pytest.raises(runtime.RunStopped):ctx.budget.begin_model()
    asyncio.run(check())

def test_general_chat_with_actual_graph_needs_no_plan(isolated,monkeypatch):
    model=ScriptedModel(responses=[AIMessage(content='你好！想聊点什么？',usage_metadata={'input_tokens':10,'output_tokens':5,'total_tokens':15})])
    monkeypatch.setattr(main,'create_chat_model',lambda *a,**kw:model)
    client=TestClient(main.app);headers={'X-Project-Id':'p1'}
    client.put('/agent/sessions/general',headers=headers,json={'id':'general','title':'general','updated':1,'messages':[]})
    response=client.post('/agent/chat',headers=headers,json={'session_id':'general','text':'你好'})
    result=run_store.get('p1',response.headers['x-agent-run-id'])
    assert result['status']=='succeeded'
    assert result['execution']['plan'] is None
    assert result['execution']['budget']['tool_calls']==0
    assert result['execution']['plan_required'] is False
