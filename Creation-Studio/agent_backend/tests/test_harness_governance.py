import json
import httpx,pytest
from fastapi import HTTPException
from app import store
from app.harness import runtime,run_store,registry,identity
from app.task_tools import build_task_tools

@pytest.fixture
def ctx(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB',tmp_path/'governance.db')
    item,_=run_store.claim('p','s','r','h');c=runtime.Runtime('p',item);c.receipt={};return c

def test_frozen_skill_and_revocation(ctx):
    from app.workspace import db_open
    item={'id':'skill1','kind':'skill','enabled':True,'name':'指导','config':{'instructions':'原版本'}}
    with db_open() as db:db.execute('INSERT INTO plugins VALUES (?,?,?,?)',('skill1','p','skill',json.dumps(item)))
    frozen=registry.freeze(ctx)
    tools={t.name:t for t in build_task_tools(ctx.receipt,'q',lambda x:None,{},project='p',session_id='s',skill_snapshot=frozen)}
    assert tools['read_analysis_guidance'].invoke({'topic':'skill:skill1'})['content']=='原版本'
    registry.verify(ctx,'skill:skill1')
    item['config']['instructions']='新版本'
    with db_open() as db:db.execute('UPDATE plugins SET payload=? WHERE id=?',(json.dumps(item),'skill1'))
    assert tools['read_analysis_guidance'].invoke({'topic':'skill:skill1'})['content']=='原版本'
    with pytest.raises(runtime.RunStopped):registry.verify(ctx)
    assert ctx.reason=='skill_revoked'

def test_unadapted_tools_remain_unavailable(ctx):
    for kind in ['tool','mcp']:
        item=registry.describe_plugin({'id':'x','name':'x','kind':kind,'enabled':True,'config':{'code':'anything'}})
        assert item['runtime_status']=='configured'
    with pytest.raises(runtime.RunStopped):registry.verify(ctx,'skill:foreign-project')

@pytest.mark.asyncio
async def test_controller_auth_fails_closed(monkeypatch):
    # 旧的外部业务后端模式已经下线，配错就报配置无效（fail closed）。
    monkeypatch.setenv('HARNESS_AUTH_MODE','business')
    with pytest.raises(HTTPException) as error:await identity.authorize('p',None)
    assert error.value.status_code==503

    monkeypatch.setenv('HARNESS_AUTH_MODE','controller')
    monkeypatch.setenv('WMD_INTERNAL_TOKEN','token-x')
    class Client:
        def __init__(self,**kw):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,path):
            assert path.endswith('/api/internal/projects/p')
            data={'ok':True,'data':{'id':'p','tenantId':'tnt_demo'}}
            return httpx.Response(200,json=data,request=httpx.Request('GET','http://controller'+path))
    monkeypatch.setattr(identity.httpx,'AsyncClient',Client)
    identity_value=await identity.authorize('p')
    assert identity_value['user_id']=='controller:p'
    assert identity_value['tenant_id']=='tnt_demo'

    class Denied(Client):
        async def get(self,path):
            data={'ok':False,'error':'项目不存在'}
            return httpx.Response(404,json=data,request=httpx.Request('GET','http://controller'+path))
    monkeypatch.setattr(identity.httpx,'AsyncClient',Denied)
    with pytest.raises(HTTPException) as error:await identity.authorize('p')
    assert error.value.status_code==403

    monkeypatch.delenv('WMD_INTERNAL_TOKEN',raising=False)
    monkeypatch.setattr(identity,'_internal_token',lambda:'')
    with pytest.raises(HTTPException) as error:await identity.authorize('p')
    assert error.value.status_code==503

def test_health_is_public_in_controller_mode(monkeypatch):
    # 启动器在 controller 模式下还没有真实项目；健康检查不能被项目归属卡住。
    monkeypatch.setenv('HARNESS_AUTH_MODE','controller')
    from fastapi.testclient import TestClient
    from app import main
    response=TestClient(main.app).get('/agent/health')
    assert response.status_code==200
    assert response.json()['status']=='ok'

def test_user_and_project_concurrency_are_server_limits(ctx):
    principal={'user_id':'u1','security_mode':'business'}
    run_store.claim('p','s2','r','h',principal=principal)
    run_store.claim('p','s3','r','h',principal=principal)
    with pytest.raises(run_store.Conflict):run_store.claim('other','s4','r','h',principal=principal)
    run_store.claim('p','s4','r','h')
    with pytest.raises(run_store.Conflict):run_store.claim('p','s5','r','h')
