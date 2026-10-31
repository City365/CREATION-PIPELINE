"""Only tools frozen into this run may execute; plugin CRUD grants no authority."""
import asyncio, hashlib, json
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage
from . import run_store, recovery, registry, identity
from .runtime import RunStopped

ALLOWED=set(registry.CAPABILITIES)
class ToolGateway(AgentMiddleware):
    def __init__(self,ctx,tools):
        self.ctx=ctx;self.registry={t.name:t for t in tools};self.serial=asyncio.Lock();self.write_cache={};self.read_timeout=20;self.write_timeout=45
        if not self.registry.keys()<=ALLOWED:raise ValueError('Unregistered runtime capability')
        manifest=[{'name':t.name,'schema':t.args_schema.model_json_schema()} for t in tools]
        self.manifest_hash=hashlib.sha256(json.dumps(manifest,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
        ctx.receipt['tool_manifest_hash']=self.manifest_hash
    async def awrap_tool_call(self,request,handler):
        ctx=self.ctx;call=request.tool_call;name=call['name'];args=call.get('args',{});cid=call.get('id','')
        async with self.serial:
            ctx.check()
            await identity.authorize(ctx.project,getattr(ctx,'authorization',None))
            registry.verify(ctx,args.get('topic') if name=='read_analysis_guidance' else None)
            if name not in self.registry or request.tool is not self.registry[name]:
                ctx.reason='tool_not_allowed';raise RunStopped(ctx.reason)
            ctx.budget.begin_tool(name,args)
            # Reject before the handler, preserving the tool's authoritative Pydantic schema.
            try:self.registry[name].args_schema.model_validate(args)
            except Exception:
                ctx.budget.tool_failures+=1;ctx.budget.publish()
                ctx.receipt.setdefault('tool_errors',{})[name]='invalid_arguments'
                return ToolMessage(content=json.dumps({'ok':False,'error':'工具参数不符合声明结构'}),tool_call_id=cid,name=name,status='error')
            if name=='create_task_plan' and getattr(ctx,'resume_checkpoint',None) and ctx.receipt.get('plan'):
                run_store.append_event(ctx.project,ctx.run_id,{'type':'tool_reused','tool_call_id':cid,'tool_name':name})
                return ToolMessage(content=json.dumps({'ok':True,'reused':True,'plan':ctx.receipt['plan'],'note':'恢复已有计划，请沿用原步骤编号，不重建计划'},ensure_ascii=False),tool_call_id=cid,name=name)
            risk=registry.CAPABILITIES[name]
            write=risk in ('workspace_write','media_write','fs_write','shell')
            fingerprint=hashlib.sha256(json.dumps([name,args],sort_keys=True).encode()).hexdigest()
            if write and fingerprint in self.write_cache:
                run_store.append_event(ctx.project,ctx.run_id,{'type':'tool_reused','tool_call_id':cid,'tool_name':name})
                return self.write_cache[fingerprint].model_copy(update={'tool_call_id':cid})
            if write and getattr(ctx,'resume_checkpoint',None):
                ctx.reason='resume_write_blocked';raise RunStopped(ctx.reason)
            call_key=cid+':'+str(ctx.budget.tools)
            recovery.tool_state(ctx,call_key,name,write,'running')
            run_store.update(ctx.project,ctx.run_id,phase='tool',budget=ctx.budget.publish())
            run_store.append_event(ctx.project,ctx.run_id,{'type':'tool_started','tool_call_id':cid,'tool_name':name,'arguments_hash':hashlib.sha256(json.dumps(args,sort_keys=True).encode()).hexdigest(),'risk':risk})
            try:
                timeout=registry.tool_timeout(name,args,self.write_timeout if write else self.read_timeout)
                result=await ctx.guarded(asyncio.wait_for(handler(request),timeout=timeout))
                content=getattr(result,'content','')
                failed=getattr(result,'status','success')=='error'
                if isinstance(content,str):
                    try:failed=failed or json.loads(content).get('ok') is False
                    except (ValueError,AttributeError):pass
                    if len(content)>32000:
                        result=result.model_copy(update={'content':json.dumps({'truncated':True,'content':content[:30000],'note':'输出已裁剪，请缩小范围或分页读取'},ensure_ascii=False)})
                if failed:
                    ctx.budget.tool_failures+=1
                    ctx.receipt.setdefault('tool_errors',{})[name]='tool_failed'
                else:ctx.receipt.setdefault('tool_errors',{}).pop(name,None)
                if not failed and write:self.write_cache[fingerprint]=result
                recovery.tool_state(ctx,call_key,name,write,'unknown' if write and failed else 'failed' if failed else 'succeeded')
                if not failed:recovery.save(ctx)
                run_store.append_event(ctx.project,ctx.run_id,{'type':'tool_finished','tool_call_id':cid,'tool_name':name,'ok':not failed})
                return result
            except asyncio.TimeoutError:
                recovery.tool_state(ctx,call_key,name,write,'unknown' if write else 'failed')
                ctx.reason='tool_timeout_exceeded'
                if write:ctx.receipt['side_effects']=risk+'_may_complete_after_stop'
                raise RunStopped(ctx.reason)
            except (asyncio.CancelledError,RunStopped):
                recovery.tool_state(ctx,call_key,name,write,'unknown' if write else 'failed')
                if write:ctx.receipt['side_effects']=risk+'_may_complete_after_stop'
                raise
            finally:
                ctx.budget.publish()
                run_store.update(ctx.project,ctx.run_id,budget=ctx.budget.publish())
