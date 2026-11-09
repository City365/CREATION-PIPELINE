"""Observable model cycles, separate from final answer and protocol replay."""
import json,re,time,uuid
from langchain.agents.middleware import AgentMiddleware

def reasoning_text(message):
    extra=getattr(message,'additional_kwargs',{}) or {}
    value=extra.get('reasoning_content') or ''
    content=getattr(message,'content',[])
    if isinstance(content,list):
        for block in content:
            if not isinstance(block,dict):continue
            if block.get('type')=='thinking':value+=block.get('thinking','')
            elif block.get('type') in ('reasoning','reasoning_content'):
                value+=block.get('text','') or ''.join(x.get('text','') for x in block.get('summary',[]) if isinstance(x,dict))
    return value

def safe(value):
    if isinstance(value,dict):return {k:('[REDACTED]' if re.search(r'api.?key|authorization|password|secret|access.?token|signature|encrypted_content',k,re.I) else safe(v)) for k,v in value.items()}
    if isinstance(value,list):return [safe(v) for v in value]
    if isinstance(value,str):
        value=re.sub(r'(?i)(Bearer\s+)[A-Za-z0-9._-]+',r'\1[REDACTED]',value)
        return re.sub(r'(?i)((?:api[_-]?key|password|access_token|secret)["\']?\s*[:=]\s*["\']?)[^"\'\s,}]+',r'\1[REDACTED]',value)
    return value

class CycleTrace(AgentMiddleware):
    def __init__(self):
        self.record=lambda *a,**kw:None
        self.cycle=0;self.call_id='';self.reasoning='';self.partial_id=''
        self.publish=lambda e:None;self.last_push=0
        # 计速：模型墙钟 / 工具墙钟分开记，回复里「时间花在哪」才有依据。
        self.llm_ms=0.0;self.tool_ms=0.0;self.tool_calls=0

    async def awrap_tool_call(self,request,handler):
        started=time.monotonic()
        self.tool_calls+=1
        try:
            return await handler(request)
        finally:
            self.tool_ms+=(time.monotonic()-started)*1000

    async def awrap_model_call(self,request,handler):
        self.cycle+=1;self.call_id=str(uuid.uuid4());self.reasoning='';self.partial_id=str(uuid.uuid4())
        started=time.monotonic()
        messages=[{'role':getattr(m,'type',''),'content':getattr(m,'content',''),'tool_calls':getattr(m,'tool_calls',[]),'tool_call_id':getattr(m,'tool_call_id',None)} for m in request.messages]
        system=getattr(request,'system_message',None)
        tools=[]
        for tool in getattr(request,'tools',[]) or []:
            if isinstance(tool,dict):tools.append(tool)
            else:tools.append({'name':getattr(tool,'name',''),'description':getattr(tool,'description',''),'parameters':tool.args_schema.model_json_schema() if getattr(tool,'args_schema',None) else {}})
        snapshot=safe({'system':getattr(system,'content',str(system or '')),'messages':messages,'tools':tools,'model_settings':getattr(request,'model_settings',{})})
        self.record('system',json.dumps(snapshot,ensure_ascii=False,indent=2),kind='model_input',cycle=self.cycle,model_call_id=self.call_id)
        try:
            response=await handler(request)
            if not self.reasoning:
                self.reasoning=''.join(reasoning_text(m) for m in response.result if getattr(m,'type','')=='ai')
            return response
        except BaseException as exc:
            self.record('system',type(exc).__name__,kind='model_failed',cycle=self.cycle,model_call_id=self.call_id)
            raise
        finally:
            duration_ms=(time.monotonic()-started)*1000
            self.llm_ms+=duration_ms
            if self.reasoning:self.record('assistant',self.reasoning,kind='reasoning',id=self.partial_id,cycle=self.cycle,model_call_id=self.call_id)
            self.record('system',json.dumps({'duration_ms':round(duration_ms),'reasoning_available':bool(self.reasoning)}),kind='model_end',cycle=self.cycle,model_call_id=self.call_id)
    def chunk(self,message):
        text=reasoning_text(message)
        if not text:return
        self.reasoning+=text
        now=time.monotonic()
        if now-self.last_push<.12:return
        self.last_push=now
        self.publish({'type':'trajectory_delta','item':{'id':self.partial_id,'role':'assistant','kind':'reasoning','cycle':self.cycle,'model_call_id':self.call_id,'content':self.reasoning}})
