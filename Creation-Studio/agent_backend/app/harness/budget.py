"""Per-run accounting. Unknown provider usage is never presented as zero consumption."""
import hashlib, json, threading
from .runtime import RunStopped

class BudgetLedger:
    def __init__(self,ctx,model_calls=8,tool_calls=16,output_tokens=24000,total_tokens=200000):
        self.ctx=ctx;self.lock=threading.RLock()
        self.limits={'model_calls':model_calls,'tool_calls':tool_calls,'output_tokens':output_tokens,'total_tokens':total_tokens}
        self.models={};self.tools=0;self.fingerprints={};self.input=0;self.output=0;self.tool_failures=0
        # 缓存分桶：只有提供方逐次报告这两个值时，命中率才有意义。
        # 缺一次就不出汇总，不拿部分数据凑一个百分比出来。
        self.cache_read=0;self.cache_write=0;self.cache_reported=0
    def stop(self,reason):self.ctx.reason=reason;raise RunStopped(reason)
    def begin_model(self):
        with self.lock:
            self.ctx.check()
            if len(self.models)>=self.limits['model_calls']:self.stop('model_calls_exceeded')
            if self.output>=self.limits['output_tokens']:self.stop('output_tokens_exceeded')
            if self.input+self.output>=self.limits['total_tokens']:self.stop('total_tokens_exceeded')
            call_id='model-'+str(len(self.models)+1);self.models[call_id]=None;self.publish();return call_id
    def settle(self,call_id,usage):
        with self.lock:
            if self.models.get(call_id) is not None:return
            if usage and any(k in usage for k in ('input_tokens','output_tokens')):
                clean={k:max(0,int(usage.get(k,0))) for k in ('input_tokens','output_tokens')}
                details=usage.get('input_token_details') or {}
                if 'cache_read' in details or 'cache_creation' in details:
                    read=max(0,int(details.get('cache_read') or 0))
                    write=max(0,int(details.get('cache_creation') or 0))
                    self.cache_read+=read;self.cache_write+=write;self.cache_reported+=1
                    clean['cache_read']=read;clean['cache_write']=write
                self.models[call_id]=clean;self.input+=clean['input_tokens'];self.output+=clean['output_tokens']
            self.publish()
            if self.output>=self.limits['output_tokens']:self.stop('output_tokens_exceeded')
            if self.input+self.output>=self.limits['total_tokens']:self.stop('total_tokens_exceeded')
    def begin_tool(self,name,args):
        with self.lock:
            self.ctx.check()
            if self.tools>=self.limits['tool_calls']:self.stop('tool_calls_exceeded')
            fingerprint=hashlib.sha256(json.dumps([name,args],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            if self.fingerprints.get(fingerprint,0)>=3:self.stop('repeated_tool_calls_exceeded')
            self.fingerprints[fingerprint]=self.fingerprints.get(fingerprint,0)+1
            self.tools+=1;self.publish()
    def publish(self):
        calls=len(self.models)
        cache_complete=bool(calls) and self.cache_reported==calls
        # 命中率 = 缓存读 / 总提示词。input_tokens 在 Anthropic 口径里已含缓存读，
        # 所以分母直接用 input_tokens，别再乘一遍。
        hit_rate=round(self.cache_read/self.input*100,1) if cache_complete and self.input else None
        snapshot={'model_calls':calls,'tool_calls':self.tools,'tool_failures':self.tool_failures,
                  'usage_complete':bool(self.models) and all(x is not None for x in self.models.values()),
                  'input_tokens':self.input,'output_tokens':self.output,'total_tokens':self.input+self.output,
                  'missing_usage_calls':sum(x is None for x in self.models.values()),
                  'cache_read_tokens':self.cache_read,'cache_write_tokens':self.cache_write,
                  'cache_complete':cache_complete,'cache_hit_rate':hit_rate}
        if self.ctx.receipt is not None:
            self.ctx.receipt['budget']={'limits':self.limits,**snapshot}
            self.ctx.receipt['usage']={k:snapshot[k] for k in ('input_tokens','output_tokens','total_tokens',
                                                               'cache_read_tokens','cache_hit_rate')}
        return snapshot
