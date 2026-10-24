import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from app import store,main
from app.harness import recovery,run_store,runtime
from test_harness_gateways import ScriptedModel

@pytest.fixture
def setup(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB',tmp_path/'recovery.db');monkeypatch.setenv('HARNESS_RUNTIME_ENABLED','true');monkeypatch.setenv('HARNESS_PROJECT_ALLOWLIST','p1');monkeypatch.setenv('HARNESS_RESUME_ENABLED','true');main.locks.clear()
    store.save('p1',{'id':'s','title':'s','updated':1,'messages':[]})
    req=main.ChatRequest(session_id='s',text='继续分析')
    parent,_=run_store.claim('p1','s','parent','h')
    ctx=runtime.Runtime('p1',parent);ctx.sources={'user_input':{'id':'user_input','content':'继续分析','kind':'user_input','title':'用户指令'}}
    ctx.receipt={'plan':{'goal':'分析','steps':[{'id':'one','title':'分析','purpose':'回答','status':'pending','output':'','evidence':[]}]}}
    recovery.save(ctx);run_store.update('p1',ctx.run_id,original_request=req.model_dump(),status='interrupted')
    return ctx

def test_unknown_write_blocks_recovery_and_cross_project(setup):
    recovery.tool_state(setup,'write','create_workspace_artifact',True,'running')
    with pytest.raises(HTTPException) as e:recovery.load('p1',setup.run_id)
    assert e.value.status_code==409
    with pytest.raises(HTTPException) as e:recovery.load('p2',setup.run_id)
    assert e.value.status_code==404

def test_read_only_resume_creates_new_child_and_finishes(setup,monkeypatch):
    model=ScriptedModel(responses=[AIMessage(content='',tool_calls=[{'id':'retry-plan','name':'create_task_plan','args':{'goal':'重试','steps':[{'id':'new','title':'new','purpose':'new'}]}}]),AIMessage(content='',tool_calls=[{'id':'t','name':'record_step_result','args':{'step_id':'one','output':'完成分析','source_ids':['user_input']}}]),AIMessage(content='分析已完成')])
    monkeypatch.setattr(main,'create_chat_model',lambda *a,**kw:model)
    client=TestClient(main.app);h={'X-Project-Id':'p1'}
    response=client.post('/agent/runs/'+setup.run_id+'/resume',headers=h,json={'client_request_id':'resume1'})
    assert response.status_code==200,response.text
    child=run_store.get('p1',response.headers['x-agent-run-id'])
    assert child['parent_run_id']==setup.run_id and child['status']=='succeeded'
    assert child['execution']['plan']['steps'][0]['status']=='completed'
    assert run_store.get('p1',setup.run_id)['status']=='interrupted'
    replay=client.post('/agent/runs/'+setup.run_id+'/resume',headers=h,json={'client_request_id':'resume1'})
    assert replay.headers['x-agent-run-id']==child['id']

def test_resume_rejects_changed_parameters(setup):
    client=TestClient(main.app)
    response=client.post('/agent/chat',headers={'X-Project-Id':'p1'},json={'session_id':'s','text':'另一个任务','parent_run_id':setup.run_id})
    assert response.status_code==409

def test_resumed_task_cannot_create_new_files(setup,monkeypatch):
    from app.workspace import db_open
    model=ScriptedModel(responses=[AIMessage(content='',tool_calls=[{'id':'write','name':'create_workspace_artifact','args':{'name':'report.md','format':'md','content':'must not write'}}])])
    monkeypatch.setattr(main,'create_chat_model',lambda *a,**kw:model)
    client=TestClient(main.app)
    response=client.post('/agent/runs/'+setup.run_id+'/resume',headers={'X-Project-Id':'p1'},json={'client_request_id':'write-blocked'})
    result=run_store.get('p1',response.headers['x-agent-run-id'])
    assert result['status']=='blocked' and result['reason_code']=='resume_write_blocked'
    with db_open() as db:assert db.execute('SELECT COUNT(*) FROM workspace_files').fetchone()[0]==0

def test_startup_expiry_updates_embedded_receipt(setup):
    item,_=run_store.claim('p1','other','expired','h',seconds=-31)
    run_store.update('p1',item['id'],execution={'status':'running','id':item['id']})
    run_store.sweep()
    expired=run_store.get('p1',item['id'])
    assert expired['status']=='interrupted' and expired['execution']['status']=='interrupted'
