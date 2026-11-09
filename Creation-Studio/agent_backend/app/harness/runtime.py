"""Request lifecycle owner; the existing LangChain stream remains the driver."""
import asyncio, contextvars, hashlib, json, os, time, uuid
from contextlib import suppress
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from . import run_store, identity

current=contextvars.ContextVar('harness_runtime',default=None)
class RunStopped(RuntimeError):
    def __init__(self,reason):super().__init__(reason);self.reason=reason

def enabled(project):
    """harness 现在是产品的默认引擎，legacy 退成兼容路径。

    之前是「只有 allowlist 里点名的项目才走 harness」，而 allowlist 默认空 ——
    结果这段更强的实现从未被执行过。根子在于 allowlist 这个机制本身不对：
    产品里的项目 id 是用户新建项目时才生成的，不可能预先写进启动脚本。

    现在的规则：
    - `HARNESS_RUNTIME_ENABLED=0` → 整体退回 legacy（应急开关）
    - `HARNESS_PROJECT_DENYLIST=a,b` → 点名排除个别项目
    - `HARNESS_PROJECT_ALLOWLIST=a,b` → 显式列了就只走列表（保留旧行为，测试用）
    - 都不设 → **所有项目走 harness**
    """
    if os.getenv('HARNESS_RUNTIME_ENABLED', 'true').lower() not in ('1', 'true'):
        return False
    denied = [item.strip() for item in os.getenv('HARNESS_PROJECT_DENYLIST', '').split(',') if item.strip()]
    if project in denied:
        return False
    allowed = [item.strip() for item in os.getenv('HARNESS_PROJECT_ALLOWLIST', '').split(',') if item.strip()]
    if allowed:
        return project in allowed
    return True

def encode(event):return 'data: '+json.dumps(event,ensure_ascii=False)+'\n\n'

class Runtime:
    def __init__(self,project,payload,seconds=180):
        self.project=project;self.run_id=payload['id'];self.payload=payload;self.seconds=seconds
        self.deadline=time.monotonic()+seconds;self.reason=None
        self.receipt={'id':self.run_id,'session_id':payload['session_id'],'status':'failed','started_at':payload['started_at'],'steps':[],'plan':None,'summary':'','model':'','provider':'','tool_count':0,'history_count':0,'skill':'','evidence_scope':'准备阶段尚未取得分析结果','input_hash':payload['input_hash']}
        from .budget import BudgetLedger
        self.budget=BudgetLedger(self)
    def check(self):
        if self.reason:raise RunStopped(self.reason)
        if time.monotonic()>=self.deadline:self.reason='deadline_exceeded';raise RunStopped(self.reason)
        item=run_store.get(self.project,self.run_id)
        if not item or item['status'] in run_store.TERMINAL:self.reason='lease_expired';raise RunStopped(self.reason)
        if item.get('cancel_requested_at'):self.reason='user_cancelled';raise RunStopped(self.reason)
    async def guarded(self,awaitable):
        task=asyncio.ensure_future(awaitable)
        try:
            while True:
                self.check()
                done,_=await asyncio.wait({task},timeout=min(.15,max(.001,self.deadline-time.monotonic())))
                if done:
                    result=task.result();self.check();return result
        finally:
            if not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError,Exception):await task
    def receipt_status(self,receipt):
        if self.reason:
            receipt['status']='cancelled' if self.reason in ('user_cancelled','client_disconnected') else ('budget_exceeded' if self.reason.endswith('exceeded') else ('blocked' if self.reason in ('resume_write_blocked','tool_not_allowed','skill_revoked') else 'interrupted'))
        self.budget.publish()
        status=receipt.get('status','failed')
        receipt['outcome']='succeeded' if status=='completed' else status
        receipt['reason_code']=self.reason or receipt.get('reason_code') or ('response_generated' if status=='completed' else 'execution_failed')
        receipt['finished_at']=receipt.get('finished_at') or run_store.now()
        receipt['duration_ms']=receipt['finished_at']-receipt.get('started_at',self.payload['started_at'])
        receipt['engine_version']='harness/2.0'
        return receipt
    def finish(self):
        receipt=self.receipt_status(self.receipt or {'status':'failed'})
        payload=run_store.update(self.project,self.run_id,status=receipt['outcome'],phase='finished',outcome=receipt['outcome'],reason_code=receipt['reason_code'],finished_at=run_store.now(),execution=receipt)
        return run_store.append_event(self.project,self.run_id,{'type':'run_finished','status':payload['status'],'reason_code':payload['reason_code'],'execution':receipt})
    def persist(self,event):return encode(run_store.append_event(self.project,self.run_id,event))

async def execute(req,project,prepare):
    from . import recovery
    checkpoint=None
    if getattr(req,'parent_run_id',None):
        parent,checkpoint=recovery.load(project,req.parent_run_id)
        original={k:v for k,v in parent.get('original_request',{}).items() if k not in ('client_request_id','parent_run_id')}
        if req.model_dump(exclude={'client_request_id','parent_run_id'})!=original:raise HTTPException(409,'恢复参数必须与原运行一致，请新建任务修改配置')
    from .policy import profile
    policy=profile(req)
    fingerprint=hashlib.sha256(json.dumps(req.model_dump(exclude={'client_request_id'}),ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    try:payload,created=run_store.claim(project,req.session_id,req.client_request_id or str(uuid.uuid4()),fingerprint,seconds=policy['seconds'],principal=identity.current.get())
    except run_store.Conflict as exc:raise HTTPException(409,{'message':str(exc),'run_id':exc.run_id})
    if not created:
        if payload['status'] not in run_store.TERMINAL:raise HTTPException(409,{'message':'请求已经在执行','run_id':payload['id']})
        async def replay():
            after=0
            while True:
                items=run_store.events(project,payload['id'],after,100)
                if not items:break
                for item in items:
                    after=item['sequence'];yield encode(item)
        return StreamingResponse(replay(),media_type='text/event-stream',headers={'X-Agent-Run-Id':payload['id']})
    ctx=Runtime(project,payload,seconds=policy['seconds']);ctx.resume_checkpoint=checkpoint
    ctx.model_timeout=policy['model_timeout'];ctx.policy=policy
    ctx.budget.limits.update(model_calls=policy['model_calls'],tool_calls=policy['tool_calls'])
    token=current.set(ctx)
    run_store.update(project,ctx.run_id,original_request=req.model_dump(),parent_run_id=getattr(req,'parent_run_id',None),execution_policy=policy)
    run_store.update(project,ctx.run_id,status='preparing',phase='preparing')
    try:
        response=await ctx.guarded(prepare())
    except BaseException as exc:
        if isinstance(exc,asyncio.CancelledError):ctx.reason=ctx.reason or 'client_disconnected'
        public_error=exc.detail if isinstance(exc,HTTPException) and isinstance(exc.detail,str) else '任务准备未完成，请检查配置或取消状态。'
        ctx.receipt['error']=public_error
        ctx.persist({'type':'error','message':public_error})
        ctx.finish()
        if isinstance(exc,RunStopped):raise HTTPException(409,{'message':'任务准备已停止','run_id':ctx.run_id,'reason_code':exc.reason})
        if isinstance(exc,HTTPException):raise HTTPException(exc.status_code,{'message':public_error,'run_id':ctx.run_id})
        if isinstance(exc,asyncio.CancelledError):raise
        raise HTTPException(503,{'message':public_error,'run_id':ctx.run_id})
    finally:current.reset(token)
    async def stream():
        token=current.set(ctx);iterator=response.body_iterator.__aiter__()
        run_store.update(project,ctx.run_id,status='running',phase='running')
        try:
            while True:
                try:raw=await ctx.guarded(anext(iterator))
                except StopAsyncIteration:break
                text=raw.decode() if isinstance(raw,bytes) else raw
                # Existing driver emits exactly one JSON SSE record per item.
                for block in text.strip().split('\n\n'):
                    if block.startswith('data: '):yield ctx.persist(json.loads(block[6:]))
        except RunStopped as exc:
            ctx.reason=exc.reason
            yield ctx.persist({'type':'error','message':'任务已停止：'+exc.reason,'reason_code':exc.reason})
        except (asyncio.CancelledError,GeneratorExit):
            ctx.reason=ctx.reason or 'client_disconnected';raise
        finally:
            with suppress(asyncio.CancelledError,Exception):await iterator.aclose()
            terminal=ctx.finish();current.reset(token)
        yield encode(terminal)
    return StreamingResponse(stream(),media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no','X-Agent-Run-Id':ctx.run_id})

async def operation(req,project,sid,kind,execute_operation):
    fingerprint=hashlib.sha256(json.dumps({'kind':kind,**req.model_dump(exclude={'client_request_id'})},sort_keys=True).encode()).hexdigest()
    try:payload,created=run_store.claim(project,sid,req.client_request_id or str(uuid.uuid4()),fingerprint)
    except run_store.Conflict as exc:raise HTTPException(409,{'message':str(exc),'run_id':exc.run_id})
    if not created:
        if payload['status']=='succeeded':return payload['result']
        raise HTTPException(409,{'message':'操作已经存在，请查看运行状态','run_id':payload['id']})
    ctx=Runtime(project,payload);ctx.receipt={'id':ctx.run_id,'session_id':sid,'status':'running','started_at':payload['started_at'],'operation':kind}
    token=current.set(ctx)
    run_store.update(project,ctx.run_id,status='running',phase=kind)
    try:
        result=await ctx.guarded(execute_operation())
        result={**result,'run_id':ctx.run_id}
        ctx.receipt.update(status='completed',finished_at=run_store.now())
        run_store.update(project,ctx.run_id,result=result)
        return result
    except asyncio.CancelledError:
        ctx.reason=ctx.reason or 'client_disconnected';raise
    finally:
        if ctx.receipt['status']=='running':ctx.receipt['status']='failed'
        ctx.finish();current.reset(token)


from contextlib import asynccontextmanager
@asynccontextmanager
async def lifespan(app):
    run_store.sweep()
    try:
        from app import spill
        spill.purge()
    except Exception:  # 清理失败不能挡住启动
        pass
    yield
