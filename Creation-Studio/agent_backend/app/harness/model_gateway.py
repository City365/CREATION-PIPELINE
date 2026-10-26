"""LangChain model boundary: one physical attempt per logical call, no hidden retries."""
import time
from langchain.agents.middleware import AgentMiddleware
from . import run_store, context, registry, identity

class ModelGateway(AgentMiddleware):
    def __init__(self,ctx):self.ctx=ctx
    async def awrap_model_call(self,request,handler):
        ctx=self.ctx;ledger=ctx.budget
        await identity.authorize(ctx.project,getattr(ctx,'authorization',None))
        registry.verify(ctx)
        material={'messages':[{'role':getattr(m,'type',''),'content':getattr(m,'content',''),'tool_calls':getattr(m,'tool_calls',[])} for m in getattr(request,'messages',[])],'system':str(getattr(request,'system_message',''))}
        if context.estimate(material)>context.input_budget()*.9:ledger.stop('context_budget_exceeded')
        call_id=ledger.begin_model()
        plan=(ctx.receipt or {}).get('plan')
        steps=(plan or {}).get('steps',[])
        if steps and not any(step.get('status')=='running' for step in steps):
            pending=next((step for step in steps if step.get('status')=='pending'),None)
            if pending:
                pending['status']='running'
                run_store.append_event(ctx.project,ctx.run_id,{'type':'process','plan':plan})
        run_store.update(ctx.project,ctx.run_id,phase='model',budget=ledger.publish())
        started=time.monotonic()
        run_store.append_event(ctx.project,ctx.run_id,{'type':'model_started','model_call_id':call_id,'timeout_seconds':getattr(ctx,'model_timeout',None)})
        remaining=max(1,ledger.limits['output_tokens']-ledger.output)
        configured=getattr(request.model,'max_tokens',None) or remaining
        request=request.override(model_settings={**request.model_settings,'max_tokens':min(configured,remaining)})
        try:
            response=await ctx.guarded(handler(request))
            usage=None
            for msg in response.result:
                if getattr(msg,'type',None)=='ai' and getattr(msg,'usage_metadata',None):
                    usage=msg.usage_metadata;break
            ledger.settle(call_id,usage)
            run_store.append_event(ctx.project,ctx.run_id,{'type':'model_finished','model_call_id':call_id,'usage':usage,'usage_available':usage is not None,'duration_ms':round((time.monotonic()-started)*1000)})
            return response
        except Exception as exc:
            timeout='Timeout' in type(exc).__name__
            if timeout and not ctx.reason:ctx.receipt['reason_code']='model_response_timeout'
            run_store.append_event(ctx.project,ctx.run_id,{'type':'model_failed','model_call_id':call_id,'error_type':type(exc).__name__,'duration_ms':round((time.monotonic()-started)*1000),'timeout_seconds':getattr(ctx,'model_timeout',None)})
            raise
        finally:
            ledger.publish()
            run_store.update(ctx.project,ctx.run_id,budget=ledger.publish())
