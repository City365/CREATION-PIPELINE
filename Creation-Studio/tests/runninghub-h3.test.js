'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const adapter=require('../plugins/video/runninghub-h3'),protocol=require('../plugins/video/runninghub-h3/protocol'),apps=require('../plugins/video/runninghub-h3/workflows.json');
const doc=require('../../docs/runninghub-h3-cn-ai-api-reference.json');

function siteChannel(type,extra={}){const site=Object.values(apps.sites).find(s=>s.channelType===type);return {id:'ch-'+site.id,type,name:site.label,baseUrl:site.baseUrl,options:{instanceType:'default',maxConcurrent:'1'},...extra};}
function tinyPng(dir,name){const file=path.join(dir,name);fs.writeFileSync(file,Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cf0000000300010006d1c3b90000000049454e44ae426082','hex'));return file;}

test('地图与文档逐项一致：10 个应用、站别、节点、图片顺序',()=>{
 assert.equal(apps.schemaVersion,2);
 assert.equal(Object.keys(apps.apps).length,10);
 assert.equal(Object.values(apps.apps).filter(a=>a.site==='cn').length,6);
 assert.equal(Object.values(apps.apps).filter(a=>a.site==='ai').length,4);
 for(const [key,app] of Object.entries(apps.apps)){
  assert.ok(key.startsWith(app.site+'_'),key+' 前缀应与站别一致');
  assert.match(app.applicationId,/^\d{15,}$/);
  assert.equal(app.images.nodes.length,9,key+' 参考图应为 9 个槽位');
  assert.equal(new Set(app.images.nodes).size,9,key+' 参考图节点不应重复');
  assert.ok(app.prompt.nodeId&&app.prompt.fieldName,key+' 缺少提示词节点');
  assert.ok(app.duration.nodeId&&app.duration.fieldName,key+' 缺少时长节点');
  assert.ok(app.aspect.nodeId&&app.aspect.fieldName,key+' 缺少比例节点');
 }
 for(const w of doc.workflows){
  const entry=Object.entries(apps.apps).find(([,a])=>a.applicationId===w.applicationId);
  assert.ok(entry,'文档中的应用未进入插件：'+w.applicationId);
  const [key,app]=entry;
  assert.equal(app.site,w.site,key+' 站别不一致');
  assert.equal(app.label,w.currentName,key+' 名称不一致');
  assert.deepEqual(app.prompt,{nodeId:w.prompt.nodeId,fieldName:w.prompt.fieldName},key+' 提示词节点不一致');
  assert.equal(app.duration.nodeId,w.duration.nodeId,key+' 时长节点不一致');
  assert.equal(app.duration.fieldName,w.duration.fieldName,key+' 时长字段不一致');
  assert.equal(app.duration.default,w.duration.observedDefault,key+' 默认时长不一致');
  assert.equal(app.aspect.nodeId,w.aspectRatio.nodeId,key+' 比例节点不一致');
  assert.equal(app.aspect.default,w.aspectRatio.observedDefault,key+' 默认比例不一致');
  assert.deepEqual(app.aspect.options,w.aspectRatio.options,key+' 比例选项不一致');
  assert.deepEqual(app.images.nodes,w.referenceImages.publicInputOrder.map(x=>x.nodeId),key+' 图片顺序必须与文档完全一致');
 }
});

test('按站别派生工作流：国内 6 条、国际 4 条，标识与字段正确',()=>{
 const cn=siteChannel('runninghub-h3-cn'),ai=siteChannel('runninghub-h3-ai');
 const cnList=adapter.workflows(cn),aiList=adapter.workflows(ai);
 assert.equal(cnList.length,6);assert.equal(aiList.length,4);
 assert.equal(cnList.length+aiList.length,Object.keys(apps.apps).length);
 for(const wf of cnList){
  assert.match(wf.id,/^rh:ch-cn:cn_/);
  assert.equal(wf.channelType,'runninghub-h3-cn');
  assert.equal(wf.images,9);
  assert.equal(wf.durationDefault,15);
  assert.deepEqual(wf.durationOptions,[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
  const app=apps.apps[wf.id.split(':').at(-1)];
  assert.equal(wf.defaultRatio,app.aspect.default.split(' ')[0]);
  assert.ok(wf.ratios.includes('21:9')&&wf.ratios.includes('9:16')&&wf.ratios.includes('1:1'));
 }
 for(const wf of aiList)assert.match(wf.id,/^rh:ch-ai:ai_/);
 assert.deepEqual(adapter.workflows({id:'x',type:'unknown'}),[]);
});

test('节点映射严格保持文档顺序与字段名',()=>{
 const app=apps.apps.cn_720p_dual;
 const refs=app.images.nodes.map((_,i)=>'upload-'+i);
 const nodes=protocol.nodeInfo(app,{prompt:'测试提示词',duration:12,aspectRatio:'9:16'},refs);
 assert.deepEqual(nodes[0],{nodeId:'848',fieldName:'prompt',fieldValue:'测试提示词'});
 assert.deepEqual(nodes[1],{nodeId:'259',fieldName:'value',fieldValue:12});
 assert.deepEqual(nodes.filter(n=>n.fieldName==='image').map(n=>n.nodeId),app.images.nodes);
 assert.equal(nodes.find(n=>n.fieldName==='aspect_ratio').fieldValue,'9:16 (Portrait Widescreen)');
 assert.equal(protocol.nodeInfo(app,{prompt:'p',duration:15,aspectRatio:'4:3'},[]).find(n=>n.fieldName==='aspect_ratio').fieldValue,'4:3 (Standard)');
 assert.equal(protocol.nodeInfo(app,{prompt:'p',duration:15,aspectRatio:'31:99'},[]).find(n=>n.fieldName==='aspect_ratio').fieldValue,app.aspect.default);
});

test('站点校验：国内渠道拒绝国际地址，反之亦然，本地回环放行',()=>{
 assert.equal(protocol.base({type:'runninghub-h3-cn',baseUrl:'https://www.runninghub.cn'}),'https://www.runninghub.cn');
 assert.equal(protocol.base({type:'runninghub-h3-ai',baseUrl:'https://www.runninghub.ai'}),'https://www.runninghub.ai');
 assert.throws(()=>protocol.base({type:'runninghub-h3-cn',baseUrl:'https://www.runninghub.ai'}),/必须为 www\.runninghub\.cn/);
 assert.throws(()=>protocol.base({type:'runninghub-h3-ai',baseUrl:'https://www.runninghub.cn'}),/必须为 www\.runninghub\.ai/);
 assert.throws(()=>protocol.base({type:'runninghub-h3-cn',baseUrl:'http://www.runninghub.cn'}),/必须为/);
 assert.equal(protocol.base({type:'runninghub-h3-ai',baseUrl:'http://127.0.0.1:9999'}),'http://127.0.0.1:9999');
 assert.equal(protocol.siteOfChannel({type:'runninghub-h3-ai'}).id,'ai');
 assert.equal(protocol.siteOfChannel({baseUrl:'https://runninghub.cn'}).id,'cn');
});

async function mockServer(handler){const requests=[];const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);let body;try{body=JSON.parse(bytes.toString());}catch{}requests.push({url:req.url,auth:req.headers.authorization,body,bytes});res.setHeader('Content-Type','application/json');const out=handler(req,body,res,requests);if(out!==undefined)res.end(JSON.stringify(out));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 return {requests,base,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};}

function fakeCtx(channel,workflowId,images,root){
 const job={id:'job-1',workflowId,channelId:channel.id,prompt:'人物向前走',duration:12,aspectRatio:'9:16',images,status:'running',logs:[],remotePromptId:''};
 const saved=[];
 const ctx={channels:{get:(kind,id)=>id===channel.id?channel:null},job,workflow:{id:workflowId},signal:{canceled:false},slot:{id:channel.id},timeoutMs:20000,
  sleep:async()=>{},touch:(j,patch)=>Object.assign(job,patch),log:(j,level,message)=>job.logs.push(message),checkCanceled:()=>{},
  jobDir:()=>root,saveOutputs:async(j,dir,list)=>{saved.push(...list);return list;},writeJobMeta:()=>{},dataUrl:()=>'',formatBytes:()=>'',outputName:()=>'',config:{},workbenchStore:{}};
 return {ctx,job,saved};
}

test('国内站：上传 → 提交 → 轮询 → 下载，节点与鉴权符合文档',{timeout:20000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rh-cn-'));
 const images=[{path:tinyPng(root,'a.png'),name:'a.png'},{path:tinyPng(root,'b.png'),name:'b.png'}];
 let mock;
 mock=await mockServer((req,body,res)=>{
  if(req.url==='/uc/openapi/accountStatus')return {code:0,data:{remainCoins:10}};
  if(req.url==='/openapi/v2/media/upload/binary')return {code:0,data:{fileName:'uploaded/image-'+req.headers['content-length']+'.png'}};
  if(req.url.startsWith('/openapi/v2/run/ai-app/'))return {taskId:'rh-cn-task'};
  if(req.url==='/openapi/v2/query')return {code:0,data:{status:'SUCCESS',results:[{nodeId:'1',url:mock.base+'/draft.mp4',outputType:'video'},{nodeId:'2',url:mock.base+'/final.mp4',outputType:'video'}]}};
  res.setHeader('Content-Type','video/mp4');res.end('final-video');
 });
 try{
  const channel=siteChannel('runninghub-h3-cn',{baseUrl:mock.base,apiKey:'cn-key',id:'ch-cn'});
  const {ctx,job,saved}=fakeCtx(channel,'rh:ch-cn:cn_720p_dual',images,root);
  assert.equal((await adapter.test(channel)).ok,true);
  await adapter.execute(ctx);
  assert.equal(job.remotePromptId,'rh-cn-task');
  assert.equal(saved.length,1);
  assert.match(saved[0].url,/final\.mp4$/);
  const submitted=mock.requests.find(r=>r.url.startsWith('/openapi/v2/run/ai-app/'));
  assert.equal(submitted.url,'/openapi/v2/run/ai-app/2107126425336766466');
  assert.equal(submitted.auth,'Bearer cn-key');
  assert.equal(submitted.body.instanceType,'default');
  assert.deepEqual(submitted.body.nodeInfoList.map(n=>n.nodeId),['848','259','854','856','252']);
  assert.equal(submitted.body.nodeInfoList.filter(n=>n.fieldName==='image').length,2);
  assert.equal(submitted.body.nodeInfoList.find(n=>n.nodeId==='252').fieldValue,'9:16 (Portrait Widescreen)');
  assert.equal(mock.requests.filter(r=>r.url.startsWith('/openapi/v2/run/ai-app/')).length,1);
  assert.equal(mock.requests.filter(r=>r.url==='/openapi/v2/media/upload/binary').length,2);
  assert.ok(!JSON.stringify(job).includes('cn-key'));
 }finally{await mock.close();}
});

test('平台拒单时透出真实错误码与原文，不再伪装成「缺少 taskId」',{timeout:20000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rh-reject-'));
 const images=[{path:tinyPng(root,'a.png'),name:'a.png'}];
 let mock;
 mock=await mockServer((req,body,res)=>{
  if(req.url==='/openapi/v2/media/upload/binary')return {code:0,data:{fileName:'uploaded/x.png'}};
  if(req.url.startsWith('/openapi/v2/run/ai-app/'))return {taskId:'',status:'',errorCode:'605',errorMessage:'Your balance is insufficient. Please top up your account. | 您的账户余额不足，请充值。'};
  res.end('');
 });
 try{
  const channel=siteChannel('runninghub-h3-ai',{baseUrl:mock.base,apiKey:'ai-key',id:'ch-ai'});
  const {ctx,job}=fakeCtx(channel,'rh:ch-ai:ai_1080p_hypervae',images,root);
  await assert.rejects(()=>adapter.execute(ctx),/错误码：605/);
  await assert.rejects(()=>adapter.execute(ctx),/余额不足/);
  assert.equal(job.remotePromptId,'');
  assert.equal(mock.requests.filter(r=>r.url.startsWith('/openapi/v2/run/ai-app/')).length,2);
 }finally{await mock.close();}
});

test('扁平的 openapi/v2 失败体不会被 check 放行，节点异常能直接定位',{timeout:20000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rh-node-'));
 const images=[{path:tinyPng(root,'a.png'),name:'a.png'}];
 let mock;
 mock=await mockServer((req,body,res)=>{
  if(req.url==='/openapi/v2/media/upload/binary')return {code:0,data:{fileName:'uploaded/x.png'}};
  if(req.url.startsWith('/openapi/v2/run/ai-app/'))return {taskId:'',status:'',errorCode:'1101',errorMessage:'Node info error | 节点信息异常',results:null};
  res.end('');
 });
 try{
  const channel=siteChannel('runninghub-h3-ai',{baseUrl:mock.base,apiKey:'ai-key',id:'ch-ai'});
  const {ctx}=fakeCtx(channel,'rh:ch-ai:ai_1080p_hypervae',images,root);
  await assert.rejects(()=>adapter.execute(ctx),/错误码：1101（Node info error \| 节点信息异常）/);
  // 进程内再确认：{code:0} 的旧外壳不会被误判成失败
  assert.doesNotThrow(()=>protocol.submit);
  assert.equal(typeof protocol.test,'function');
 }finally{await mock.close();}
});

test('平台跑挂（805 · VRAM grow failed）自动重投一次，第二次成功',{timeout:20000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rh-retry-'));
 const images=[{path:tinyPng(root,'a.png'),name:'a.png'}];
 let mock,submitted=0;
 mock=await mockServer((req,body,res)=>{
  if(req.url==='/openapi/v2/media/upload/binary')return {code:0,data:{fileName:'uploaded/x.png'}};
  if(req.url.startsWith('/openapi/v2/run/ai-app/')){submitted+=1;return {taskId:submitted===1?'rh-fail-task':'rh-ok-task'};}
  if(req.url==='/openapi/v2/query'){
   if(body.taskId==='rh-fail-task')return {taskId:'rh-fail-task',status:'FAILED',errorCode:'805',errorMessage:'工作流运行失败',failedReason:{node_name:'SamplerAdvanced',node_id:'144',exception_message:'VRAM grow failed: 333620224 bytes'}};
   return {taskId:'rh-ok-task',status:'SUCCESS',results:[{nodeId:'2',url:mock.base+'/final.mp4',outputType:'video'}]};
  }
  res.setHeader('Content-Type','video/mp4');res.end('video');
 });
 try{
  const channel=siteChannel('runninghub-h3-ai',{baseUrl:mock.base,apiKey:'ai-key',id:'ch-ai'});
  const {ctx,job,saved}=fakeCtx(channel,'rh:ch-ai:ai_1080p_hypervae',images,root);
  await adapter.execute(ctx);
  assert.equal(submitted,2,'第一次 805 之后应重投一次');
  assert.equal(job.remotePromptId,'rh-ok-task');
  assert.equal(saved.length,1);
  assert.ok(job.logs.some(l=>/换一次重投/.test(l)),'重投要写进任务日志');
 }finally{await mock.close();}
});

test('继续原任务时遇到 805 不会重复提交',{timeout:20000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rh-resume-'));
 const images=[{path:tinyPng(root,'a.png'),name:'a.png'}];
 let mock,submitted=0;
 mock=await mockServer((req,body,res)=>{
  if(req.url.startsWith('/openapi/v2/run/ai-app/')){submitted+=1;return {taskId:'x'+submitted};}
  if(req.url==='/openapi/v2/query')return {taskId:body.taskId,status:'FAILED',errorCode:'805',errorMessage:'工作流运行失败',failedReason:{node_name:'SamplerAdvanced',node_id:'144',exception_message:'VRAM grow failed: 1024 bytes'}};
  res.end('');
 });
 try{
  const channel=siteChannel('runninghub-h3-ai',{baseUrl:mock.base,apiKey:'ai-key',id:'ch-ai'});
  const {ctx,job}=fakeCtx(channel,'rh:ch-ai:ai_1080p_hypervae',images,root);
  job.remotePromptId='existing-task';
  await assert.rejects(()=>adapter.resumeJob(job,ctx),/805/);
  assert.equal(submitted,0,'继续原任务不能重新提交');
 }finally{await mock.close();}
});

test('国际站：提交到 runninghub.ai 的应用，图片顺序按文档',{timeout:20000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rh-ai-'));
 const images=[{path:tinyPng(root,'a.png'),name:'a.png'}];
 let mock;
 mock=await mockServer((req,body,res)=>{
  if(req.url==='/openapi/v2/media/upload/binary')return {code:0,data:{download_url:'https://cdn.example.com/x.png'}};
  if(req.url.startsWith('/openapi/v2/run/ai-app/'))return {taskId:'rh-ai-task'};
  if(req.url==='/openapi/v2/query')return {code:0,data:{status:'SUCCESS',results:[{url:mock.base+'/out.mp4',outputType:'video'}]}};
  res.setHeader('Content-Type','video/mp4');res.end('video');
 });
 try{
  const channel=siteChannel('runninghub-h3-ai',{baseUrl:mock.base,apiKey:'ai-key',id:'ch-ai'});
  const {ctx}=fakeCtx(channel,'rh:ch-ai:ai_736p_quality',images,root);
  await adapter.execute(ctx);
  const submitted=mock.requests.find(r=>r.url.startsWith('/openapi/v2/run/ai-app/'));
  assert.equal(submitted.url,'/openapi/v2/run/ai-app/2113984372448813058');
  assert.equal(submitted.auth,'Bearer ai-key');
  const nodes=submitted.body.nodeInfoList;
  assert.deepEqual(nodes[0],{nodeId:'28',fieldName:'prompt',fieldValue:'人物向前走'});
  assert.deepEqual(nodes[1],{nodeId:'27',fieldName:'value',fieldValue:12});
  assert.equal(nodes[2].nodeId,'66');
  assert.equal(nodes.length,4);
 }finally{await mock.close();}
});

test('继续原任务：已有 remotePromptId 时不再上传与提交',{timeout:20000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rh-resume-'));
 const mock=await mockServer((req)=>{
  if(req.url==='/openapi/v2/query')return {code:0,data:{status:'SUCCESS',results:[{url:'https://cdn.example.com/resumed.mp4',outputType:'video'}]}};
  return {code:0,data:{}};
 });
 try{
  const channel=siteChannel('runninghub-h3-cn',{baseUrl:mock.base,apiKey:'cn-key',id:'ch-cn'});
  const {ctx,job,saved}=fakeCtx(channel,'rh:ch-cn:cn_1080p_int8',[],root);
  job.remotePromptId='existing-task';
  await adapter.resumeJob(job,ctx);
  assert.equal(saved.length,1);
  assert.equal(mock.requests.filter(r=>r.url.startsWith('/openapi/v2/run/ai-app/')).length,0);
  assert.equal(mock.requests.filter(r=>r.url==='/openapi/v2/media/upload/binary').length,0);
  assert.ok(mock.requests.filter(r=>r.url==='/openapi/v2/query').length>=1);
  const missing=fakeCtx(channel,'rh:ch-cn:cn_1080p_int8',[],root);
  await assert.rejects(()=>adapter.resumeJob(missing.job,missing.ctx),/缺少原任务 ID/);
 }finally{await mock.close();}
});

test('站别不匹配与未知应用都会明确报错',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rh-guard-'));
 const cn=siteChannel('runninghub-h3-cn',{id:'ch-cn',baseUrl:'http://127.0.0.1:65530',apiKey:'k'});
 await assert.rejects(()=>adapter.execute(fakeCtx(cn,'rh:ch-cn:ai_720p_dual',[],root).ctx),/与渠道站点cn不一致/);
 await assert.rejects(()=>adapter.execute(fakeCtx(cn,'rh:ch-cn:nope',[],root).ctx),/应用映射不存在/);
 await assert.rejects(()=>adapter.execute(fakeCtx({...cn,baseUrl:'https://www.runninghub.ai'},'rh:ch-cn:cn_720p_dual',[],root).ctx),/必须为 www\.runninghub\.cn/);
 const overflow=Array.from({length:10},(_,i)=>({path:tinyPng(root,'r'+i+'.png'),name:'r'+i+'.png'}));
 await assert.rejects(()=>adapter.execute(fakeCtx(cn,'rh:ch-cn:cn_720p_dual',overflow,root).ctx),/参考图超出该应用槽位/);
});

test('多账号密钥：每把 Key 一个槽位，任务提交与继续都锁定同一把',{timeout:20000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rh-keys-'));
 let mock;
 mock=await mockServer((req,body,res)=>{
  if(req.url==='/uc/openapi/accountStatus')return req.headers.authorization==='Bearer k2'?{code:900,msg:'invalid key'}:{code:0,data:{remainCoins:5}};
  if(req.url==='/openapi/v2/media/upload/binary')return {code:0,data:{fileName:'uploaded/x.png'}};
  if(req.url.startsWith('/openapi/v2/run/ai-app/'))return {taskId:'multi-task'};
  if(req.url==='/openapi/v2/query')return {code:0,data:{status:'SUCCESS',results:[{url:mock.base+'/m.mp4',outputType:'video'}]}};
  res.setHeader('Content-Type','video/mp4');res.end('v');
 });
 try{
  const channel=siteChannel('runninghub-h3-ai',{baseUrl:mock.base,apiKey:'k1\nk2\nk3\nk4'});
  const slots=adapter.slots(channel);
  assert.equal(slots.length,4);
  assert.deepEqual(slots.map(s=>s.accountIndex),[0,1,2,3]);
  assert.deepEqual(slots.map(s=>s.name),['RunningHub H3 国际站 · 账号1','RunningHub H3 国际站 · 账号2','RunningHub H3 国际站 · 账号3','RunningHub H3 国际站 · 账号4']);
  assert.deepEqual(slots.map(s=>s.key),['rh:ch-ai:acct1','rh:ch-ai:acct2','rh:ch-ai:acct3','rh:ch-ai:acct4']);
  assert.equal(protocol.keys(channel).length,4);
  assert.equal(protocol.keys({apiKey:'a\nb\r\nc; d'}).length,4);
  assert.equal(protocol.keys({apiKey:'same\nsame'}).length,1);
  assert.equal(adapter.slots({...channel,options:{maxConcurrent:'2'}}).length,8);
  const per=adapter.slots({...channel,apiKey:'k1\nk2',options:{maxConcurrent:'2'}});
  assert.deepEqual(per.map(s=>s.name),['RunningHub H3 国际站 · 账号1 #1','RunningHub H3 国际站 · 账号1 #2','RunningHub H3 国际站 · 账号2 #1','RunningHub H3 国际站 · 账号2 #2']);
  const {ctx,job}=fakeCtx(channel,'rh:ch-ai:ai_720p_dual',[{path:tinyPng(root,'a.png'),name:'a.png'}],root);
  ctx.slot={id:channel.id,accountIndex:2,key:'rh:ch-ai:acct3'};
  await adapter.execute(ctx);
  assert.equal(job.rhAccount,2);
  assert.equal(job.rhAccountTotal,4);
  const submitted=mock.requests.find(r=>r.url.startsWith('/openapi/v2/run/ai-app/'));
  assert.equal(submitted.auth,'Bearer k3');
  assert.equal(mock.requests.filter(r=>r.url==='/openapi/v2/media/upload/binary').every(r=>r.auth==='Bearer k3'),true);
  const resumed=mock.requests.filter(r=>r.url==='/openapi/v2/query').length;
  await adapter.resumeJob(job,{...ctx,slot:{id:channel.id}});
  const after=mock.requests.filter(r=>r.url==='/openapi/v2/query').slice(resumed);
  assert.ok(after.length>=1);
  assert.equal(after.every(r=>r.auth==='Bearer k3'),true,'继续原任务必须用提交时那把 Key');
  const summary=await adapter.test(channel);
  assert.equal(summary.ok,false);
  assert.match(summary.message,/3\/4 个账号可用/);
  assert.match(summary.message,/第 2 把/);
  assert.ok(!summary.message.includes('k2'),'错误信息不应回显密钥');
  const named=siteChannel('runninghub-h3-ai',{baseUrl:mock.base,id:'ch-ai',apiKey:'k1\nk2\nk3\nk4',options:{instanceType:'default',maxConcurrent:'1',accountNames:'363\n364\n365\n366'}});
  assert.deepEqual(protocol.accountNames(named),['363','364','365','366']);
  assert.deepEqual(adapter.slots(named).map(s=>s.name),['RunningHub H3 国际站 · 363','RunningHub H3 国际站 · 364','RunningHub H3 国际站 · 365','RunningHub H3 国际站 · 366']);
  assert.equal(protocol.accountLabel(named,2),'365（3/4）');
  assert.equal(protocol.accountLabel(siteChannel('runninghub-h3-ai',{apiKey:'only'}),0),'账号1');
  const shown=fakeCtx(named,'rh:ch-ai:ai_720p_dual',[{path:tinyPng(root,'n.png'),name:'n.png'}],root);
  shown.ctx.slot={id:named.id,accountIndex:1};
  const metas=[];
  shown.ctx.writeJobMeta=(job,dir,meta)=>metas.push(meta);
  await adapter.execute(shown.ctx);
  assert.equal(shown.job.rhAccount,1);
  assert.equal(metas[0].accountName,'364（2/4）');
  assert.ok(shown.job.logs.some((line)=>line.includes('364')),'提交日志应带账号名');
  const empty=siteChannel('runninghub-h3-ai',{baseUrl:mock.base,apiKey:'',id:'ch-ai'});
  assert.deepEqual(adapter.slots(empty),[]);
  await assert.rejects(()=>adapter.execute(fakeCtx(empty,'rh:ch-ai:ai_720p_dual',[],root).ctx),/请填写 RunningHub API Key/);
  const removed=siteChannel('runninghub-h3-ai',{baseUrl:mock.base,apiKey:'k1',id:'ch-ai'});
  const stale=fakeCtx(removed,'rh:ch-ai:ai_720p_dual',[],root);
  stale.job.remotePromptId='task-x';stale.job.rhAccount=3;
  await assert.rejects(()=>adapter.resumeJob(stale.job,stale.ctx),/第 4 个账号密钥已移除/);
 }finally{await mock.close();}
});

test('正式服务：新建国内/国际渠道 → 派生 6+4 条工作流 → 提交任务并落版本号',{timeout:45000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rh-e2e-'));
 let mock;
 mock=await mockServer((req,body,res)=>{
  if(req.url==='/uc/openapi/accountStatus')return {code:0,data:{remainCoins:10}};
  if(req.url==='/openapi/v2/media/upload/binary')return {code:0,data:{fileName:'uploaded/image.png'}};
  if(req.url.startsWith('/openapi/v2/run/ai-app/'))return {taskId:'rh-mock'};
  if(req.url==='/openapi/v2/query')return {code:0,data:{status:'SUCCESS',results:[{url:mock.base+'/final.mp4',nodeId:'1',outputType:'video'}]}};
  res.setHeader('Content-Type','video/mp4');res.end('final-video');
 });
 const child=spawn(process.execPath,[path.join(__dirname,'../src/server.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,WMD_PORT:'19377',WMD_DATA_DIR:path.join(root,'data'),WMD_PROJECT_ROOT:path.join(root,'projects'),WMD_AGENT_AUTOSTART:'0'},stdio:'ignore',windowsHide:true});
 const base='http://127.0.0.1:19377';let token;
 const call=async(url,body)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{'X-WMD-Internal':token}:{})},body:body?JSON.stringify(body):undefined});return r.json();};
 try{
  const start=Date.now();while(Date.now()-start<20000){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  token=JSON.parse(fs.readFileSync(path.join(root,'data/internal-token.json'),'utf8')).token;
  const plugins=await call('/api/video-plugins');
  const plugin=plugins.data.plugins.find(p=>p.id==='runninghub-h3');
  assert.equal(plugin.version,'1.3.0');
  assert.deepEqual(plugin.channelTypes.map(t=>t.id),['runninghub-h3-cn','runninghub-h3-ai']);
  const types=await call('/api/channels/types');
  assert.ok(types.data.video.some(t=>t.id==='runninghub-h3-ai'));
  const channel=await call('/api/channels',{kind:'video',type:'runninghub-h3-cn',name:'RunningHub 国内站',baseUrl:mock.base,apiKey:'mock-rh-key'});
  assert.equal(channel.ok,true,JSON.stringify(channel));
  const international=await call('/api/channels',{kind:'video',type:'runninghub-h3-ai',name:'RunningHub 国际站',baseUrl:mock.base,apiKey:'mock-ai-key'});
  assert.equal(international.ok,true,JSON.stringify(international));
  const state=await call('/api/state');
  const mine=state.data.workflows.filter(w=>w.pluginId==='runninghub-h3');
  assert.equal(mine.length,10);
  assert.equal(mine.filter(w=>w.channelId===channel.data.id).length,6);
  assert.equal(mine.filter(w=>w.channelId===international.data.id).length,4);
  const wf=mine.find(w=>w.id==='rh:'+channel.data.id+':cn_736p_action');
  assert.equal(wf.providerLabel,'RunningHub H3');
  assert.equal(wf.images,9);
  const upload=await call('/api/upload',{name:'ref.png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='});
  const created=await call('/api/jobs',{workflowId:wf.id,prompt:'人物向前走',images:[{path:upload.data.path,name:'ref.png'}],duration:9,aspectRatio:'1:1'});
  assert.equal(created.ok,true,JSON.stringify(created));
  let job;const until=Date.now()+15000;
  while(Date.now()<until){job=(await call('/api/jobs')).data.jobs.find(j=>j.id===created.data.jobs[0].id);if(['success','failed'].includes(job.status))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(job.status,'success',job.error);
  assert.equal(job.pluginId,'runninghub-h3');
  assert.equal(job.pluginVersion,'1.3.0');
  assert.equal(job.remotePromptId,'rh-mock');
  assert.equal(fs.readFileSync(job.outputs[0].path,'utf8'),'final-video');
  assert.ok(!JSON.stringify(job).includes('mock-rh-key'));
  const submitted=mock.requests.find(r=>r.url.startsWith('/openapi/v2/run/ai-app/'));
  assert.equal(submitted.url,'/openapi/v2/run/ai-app/2112164973278482434');
  assert.equal(submitted.body.nodeInfoList.find(n=>n.nodeId==='197').fieldValue,'人物向前走');
  assert.equal(submitted.body.nodeInfoList.find(n=>n.nodeId==='115').fieldValue,'1:1 (Square)');
  assert.equal(submitted.body.nodeInfoList.find(n=>n.nodeId==='132').fieldValue,9);
 }finally{child.kill();await mock.close();}
});


