'use strict';
const protocol=require('./protocol');
const MAX_SECONDS=15;
function ratioShort(v){return protocol.ratioShort(v);}
function ratiosOf(application){const out=[];for(const option of application.aspect?.options||[]){const short=ratioShort(option);if(short&&!out.includes(short))out.push(short);}return out.length?out:['16:9','9:16','1:1'];}
function keyOf(id){return String(id||'').split(':').at(-1);}
function appFor(job,wf){const key=keyOf((wf&&wf.id)||job.workflowId);if(!key)throw Error('任务缺少工作流标识，无法定位 RunningHub 应用');return protocol.app(key);}
function perAccount(ch){return Math.max(1,Math.min(8,Math.floor(Number(ch.options?.maxConcurrent)||1)));}
function accountIndex(ctx,job){
 const slotIndex=Number(ctx.slot?.accountIndex);
 if(Number.isInteger(slotIndex)&&slotIndex>=0)return slotIndex;
 const stored=Number(job.rhAccount);
 if(Number.isInteger(stored)&&stored>=0)return stored;
 return 0;
}
function workflows(ch){
 const site=protocol.siteOfChannel(ch);if(!site)return [];
 return protocol.appsFor(site.id).map(([key,application])=>{
  const duration=Math.min(MAX_SECONDS,Number(application.duration?.default)||MAX_SECONDS);
  return {id:'rh:'+ch.id+':'+key,channelId:ch.id,channelType:ch.type,provider:'runninghub',label:application.label,note:application.note,images:(application.images?.nodes||[]).length,audios:0,videos:0,optionalImages:true,durationKey:'duration',durationDefault:duration,durationOptions:Array.from({length:duration},(_,i)=>i+1),seedKey:'',sizeMode:'wh',defaultRatio:ratioShort(application.aspect?.default)||'16:9',ratios:ratiosOf(application),megapixelsOptions:[]};
 });
}
async function attempt(ctx,{resumeOnly=false}={}){
 const {job,workflow:wf,signal}=ctx;
 const channelId=ctx.slot?.id||job.channelId;
 const ch=ctx.channels.get('video',channelId);
 if(!ch)throw Error('RunningHub 渠道已删除');
 const site=protocol.siteOfChannel(ch);
 if(!site)throw Error('RunningHub 渠道站点未登记');
 const application=appFor(job,wf);
 if(application.site!==site.id)throw Error('工作流属于'+application.site+'站，与渠道站点'+site.id+'不一致');
 job.apiUrl=protocol.base(ch);
 const accounts=protocol.keys(ch);
 if(!accounts.length)throw Error('请填写 RunningHub API Key（多账号每行一个）');
 const index=accountIndex(ctx,job);
 if(index>=accounts.length)throw Error('提交用的第 '+(index+1)+' 个账号密钥已移除，无法继续原任务');
 if(resumeOnly&&!job.remotePromptId)throw Error('缺少原任务 ID，无法继续原任务');
 job.rhAccount=index;
 job.rhAccountTotal=accounts.length;
 const accountLabel=protocol.accountLabel(ch,index);
 if(!job.remotePromptId){
  const slots=(application.images?.nodes||[]).length;
  if((job.images||[]).length>slots)throw Error('参考图超出该应用槽位：'+application.label+' 最多 '+slots+' 张');
  const refs=[];
  for(const [i,image] of job.images.entries()){
   ctx.checkCanceled(job,signal);
   ctx.touch(job,{progress:5+Math.round(i/Math.max(1,job.images.length)*15),stage:'上传参考图 '+(i+1)+'（'+accountLabel+'）'});
   refs.push(await protocol.upload(ch,image,index));
  }
  ctx.checkCanceled(job,signal);
  ctx.touch(job,{progress:20,stage:'提交到 RunningHub…（'+accountLabel+'）'});
  const receipt=await protocol.submit(ch,application,job,refs,index);
  job.remotePromptId=receipt.taskId;
  ctx.log(job,'info','RunningHub 已提交，任务 '+receipt.taskId+' · '+application.short+' · '+accountLabel);
  ctx.touch(job,{progress:25});
 }
 const started=Date.now();let result,errors=0,unknown=0;
 while(Date.now()-started<ctx.timeoutMs){
  ctx.checkCanceled(job,signal);
  try{result=await protocol.poll(ch,job.remotePromptId,application,index);errors=0;}
  catch(e){if(e.status===401||e.status===403||++errors>=3)throw e;ctx.log(job,'warn','状态查询暂不可用，稍后继续查询原任务');await ctx.sleep(4000);continue;}
  if(result.status==='failed')throw Error(result.message);
  if(result.status==='success')break;
  if(result.rawStatus==='UNKNOWN'&&++unknown>=4)throw Error('RunningHub 连续返回未知状态，请核实原任务');
  ctx.touch(job,{progress:Math.min(88,25+Math.round((Date.now()-started)/1000/8)),stage:(result.status==='queued'?'RunningHub 排队中…':'RunningHub 生成中…')+'（'+accountLabel+'）'});
  await ctx.sleep(4000);
 }
 if(result?.status!=='success'||!result.outputs.length)throw Error('RunningHub 未返回有效视频；请核实原任务');
 ctx.checkCanceled(job,signal);
 const dir=ctx.jobDir(job);
 job.outputDir=dir;
 ctx.touch(job,{progress:90,stage:'下载成片…'});
 await ctx.saveOutputs(job,dir,result.outputs.map((v,i)=>({type:'video',filename:'video-'+i+'.mp4',url:v.url})),signal);
 ctx.writeJobMeta(job,dir,{apiUrl:job.apiUrl,worker:ch.name,site:site.id,accountIndex:index,accountTotal:accounts.length,accountName:accountLabel,applicationId:application.applicationId,applicationName:application.label,inputValues:{nodeMappingKey:keyOf((wf&&wf.id)||job.workflowId),instanceType:ch.options?.instanceType||'default',aspectRatio:job.aspectRatio,duration:job.duration}});
 return job;
}
// 平台侧跑挂了（805 工作流运行失败 / VRAM grow failed）不是参数或密钥问题：同一次执行重投一次，
// 换 seed 重来；resumeOnly（继续原任务）不重投，避免同一个镜头重复计费。
const RETRY_TEXT=/VRAM grow failed|错误码：805|错误码 805|工作流运行失败/i;
async function run(ctx,options={}){
 const job=ctx.job;
 const signal=ctx.signal;
 for(let round=0;round<2;round+=1){
  try{return await attempt(ctx,options);}
  catch(error){
   const text=String(error&&error.message||'');
   const retryable=!options.resumeOnly&&round===0&&RETRY_TEXT.test(text)&&!(signal&&signal.canceled);
   if(!retryable)throw error;
   ctx.log(job,'warn','平台侧运行失败（'+text.slice(0,160)+'），换一次重投');
   job.remotePromptId='';
   ctx.touch(job,{progress:20,stage:'平台显存不足，自动重投…'});
  }
 }
 throw Error('RunningHub 连续两次运行失败，请稍后重试或改用 720P / 736P 应用');
}
module.exports={workflows,execute:ctx=>run(ctx),resumeJob:(job,ctx)=>run({...ctx,job},{resumeOnly:true}),submit:protocol.submit,poll:protocol.poll,test:protocol.test,slots(ch){
 const accounts=protocol.keys(ch);
 if(!accounts.length)return [];
 const per=perAccount(ch);
 const out=[];
 for(let i=0;i<accounts.length;i++)for(let j=0;j<per;j++)out.push({key:'rh:'+ch.id+':acct'+(i+1)+(per>1?':slot'+(j+1):''),id:ch.id,provider:'runninghub',name:(accounts.length>1?ch.name+' · '+(protocol.accountNames(ch)[i]||('账号'+(i+1))):ch.name)+(per>1?' #'+(j+1):''),accountIndex:i});
 return out;
}};
