import asyncio, json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from app import main, store
from app.harness import runtime, run_store

@pytest.fixture
def isolated(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB',tmp_path/'runs.db')
    monkeypatch.setenv('HARNESS_RUNTIME_ENABLED','true')
    monkeypatch.setenv('HARNESS_PROJECT_ALLOWLIST','p1')
    main.locks.clear()

def test_atomic_claim_idempotency_and_scope(isolated):
    def acquire(i):
        try:return run_store.claim('p1','s',str(i),'hash')[1]
        except run_store.Conflict:return False
    with ThreadPoolExecutor(max_workers=4) as pool:assert sum(pool.map(acquire,range(4)))==1
    with pytest.raises(run_store.Conflict):run_store.claim('p1','s','new','h')
    assert not run_store.busy('p2','s')
    item,_=run_store.claim('p2','s','one','h')
    same,created=run_store.claim('p2','s','one','h')
    assert same['id']==item['id'] and not created
    with pytest.raises(run_store.Conflict):run_store.claim('p2','s','one','different')
    run_store.update('p2',item['id'],status='succeeded')
    assert run_store.update('p2',item['id'],status='running')['status']=='succeeded'

def test_prepare_failure_releases_and_persists(isolated):
    async def check():
        async def fail():raise HTTPException(503,'bad config')
        with pytest.raises(HTTPException):await runtime.execute(main.ChatRequest(session_id='s',text='hi'), 'p1',fail)
        assert not run_store.busy('p1','s')
        with run_store.connect() as db:rid=db.execute('SELECT id FROM harness_runs').fetchone()[0]
        assert run_store.get('p1',rid)['status']=='failed'
        assert run_store.events('p1',rid)[-1]['type']=='run_finished'
    asyncio.run(check())

def test_cancel_during_prepare_and_stream(isolated):
    async def check():
        payload,_=run_store.claim('p1','s','r','h')
        ctx=runtime.Runtime('p1',payload)
        async def cancel():
            await asyncio.sleep(.02);run_store.cancel('p1',payload['id'])
        task=asyncio.create_task(cancel())
        with pytest.raises(runtime.RunStopped):await ctx.guarded(asyncio.sleep(3))
        await task;ctx.finish()
        assert run_store.get('p1',payload['id'])['status']=='cancelled'
        assert not run_store.busy('p1','s')
    asyncio.run(check())

def test_deadline_and_expired_lease(isolated):
    async def check():
        item,_=run_store.claim('p1','s','r','h')
        ctx=runtime.Runtime('p1',item,seconds=.02)
        with pytest.raises(runtime.RunStopped):await ctx.guarded(asyncio.sleep(5))
        ctx.finish();assert run_store.get('p1',item['id'])['status']=='budget_exceeded'
    asyncio.run(check())
    item,_=run_store.claim('p1','s','next','h',seconds=-31)
    assert run_store.get('p1',item['id'])['status']=='interrupted'

def test_prepare_owns_lease_and_terminal_replay(isolated):
    async def check():
        req=main.ChatRequest(session_id='s',text='hi',client_request_id='client-1')
        calls=[]
        async def prepare():
            calls.append(1)
            assert run_store.busy('p1','s')
            ctx=runtime.current.get();ctx.receipt={'status':'completed'}
            async def stream():yield runtime.encode({'type':'done','execution':{'status':'completed'}})
            return StreamingResponse(stream())
        response=await runtime.execute(req,'p1',prepare)
        result=[x async for x in response.body_iterator]
        replay=await runtime.execute(req,'p1',prepare)
        again=[x async for x in replay.body_iterator]
        assert len(calls)==1
        assert json.loads(result[0][6:])['event_id']==json.loads(again[0][6:])['event_id']
        assert not run_store.busy('p1','s')
    asyncio.run(check())

def test_chat_route_enabled_compatibility_and_api(isolated,monkeypatch):
    from fastapi.testclient import TestClient
    class Graph:
        async def astream(self,*args,**kwargs):
            yield SimpleNamespace(content='hello'),{}
    monkeypatch.setattr(main,'create_chat_model',lambda:object())
    monkeypatch.setattr(main,'create_agent',lambda **kw:Graph())
    client=TestClient(main.app);headers={'X-Project-Id':'p1'}
    client.put('/agent/sessions/s',headers=headers,json={'id':'s','title':'s','updated':1,'messages':[]})
    body={'session_id':'s','text':'hello','client_request_id':'same'}
    response=client.post('/agent/chat',headers=headers,json=body)
    assert response.status_code==200
    rid=response.headers['x-agent-run-id']
    result=client.get('/agent/runs/'+rid,headers=headers).json()
    assert result['status']=='succeeded'  # Plain conversation does not require a task plan.
    assert result['execution']['validation_issues']==[]
    assert client.get('/agent/runs/'+rid,headers={'X-Project-Id':'p2'}).status_code==404
    replay=client.post('/agent/chat',headers=headers,json=body)
    assert replay.headers['x-agent-run-id']==rid
    assert len(store.get_session('p1','s')['messages'])==2
    assert client.post('/agent/chat',headers=headers,json={**body,'text':'different'}).status_code==409
    events=client.get('/agent/runs/'+rid+'/events',headers=headers).json()['items']
    assert [e['sequence'] for e in events]==list(range(1,len(events)+1))
    assert client.post('/agent/runs/'+rid+'/cancel',headers=headers).json()['status']=='succeeded'

def test_compaction_uses_same_lease_and_idempotency(isolated,monkeypatch):
    from fastapi.testclient import TestClient
    from langchain_core.messages import AIMessage
    calls=[]
    class Model:
        async def ainvoke(self,*args,**kw):
            calls.append(1)
            assert run_store.busy('p1','s')
            with pytest.raises(run_store.Conflict):run_store.claim('p1','s','chat','h')
            return AIMessage(content='历史摘要',usage_metadata={'input_tokens':10,'output_tokens':4,'total_tokens':14})
    monkeypatch.setattr(main,'create_chat_model',lambda *a,**kw:Model())
    client=TestClient(main.app);headers={'X-Project-Id':'p1'}
    client.put('/agent/sessions/s',headers=headers,json={'id':'s','title':'s','updated':1,'messages':[{'id':'u','role':'user','text':'hi'}]})
    response=client.post('/agent/sessions/s/compact',headers=headers,json={'client_request_id':'compact-once'})
    assert response.status_code==200
    rid=response.json()['run_id'];result=run_store.get('p1',rid)
    assert result['status']=='succeeded' and result['execution']['budget']['model_calls']==1
    replay=client.post('/agent/sessions/s/compact',headers=headers,json={'client_request_id':'compact-once'})
    assert replay.json()['run_id']==rid and len(calls)==1
    assert not run_store.busy('p1','s')
