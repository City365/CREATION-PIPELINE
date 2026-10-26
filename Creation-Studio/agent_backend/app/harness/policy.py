"""Bounded execution profiles: interactive chat and explicit skill deliverables differ."""
import os

def profile(request):
    skill=bool(getattr(request,'skill_id',None) or getattr(request,'skill',None))
    if skill:
        seconds=max(30,min(1800,int(os.getenv('H3_SKILL_RUN_TIMEOUT','600'))))
        timeout=max(5,min(seconds,float(os.getenv('H3_SKILL_MODEL_TIMEOUT',os.getenv('H3_MODEL_TIMEOUT','300')))))
        return {'name':'skill-delivery','seconds':seconds,'model_timeout':timeout,'model_calls':16,'tool_calls':32}
    return {'name':'chat','seconds':180,'model_timeout':float(os.getenv('H3_MODEL_TIMEOUT','120')),'model_calls':8,'tool_calls':16}
