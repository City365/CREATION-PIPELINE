'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');
const registry=require('../src/video-plugins');
function manifest(id){return {id,name:id,version:'1.0.0',apiVersion:1,entry:'index.js',provider:id,channelTypes:[{id,label:id,fields:[{key:'baseUrl',label:'URL',required:true},{key:'apiKey',label:'Key',type:'password'}]}]};}
function fixture(root,id,extra={}){const dir=path.join(root,id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({...manifest(id),...extra}));fs.writeFileSync(path.join(dir,'index.js'),"module.exports={workflows:()=>[],slots:()=>[],execute:async()=>{},test:async()=>({ok:true})}");return dir;}
test('built-in registry keeps existing channel types and excludes invalid plugin packages',()=>{
 assert.equal(registry.errors().length,0);
 for(const type of ['manager-video','autodl-h3','openai-video','generic-task'])assert.ok(registry.forType(type));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'video-plugins-'));
 fixture(root,'good');fixture(root,'unsupported',{apiVersion:99});fixture(root,'duplicate',{id:'good'});fixture(root,'escaping',{entry:'../../outside.js'});
 const result=registry.loadPlugins(root);assert.equal(result.plugins.length,1);assert.equal(result.errors.length,3);
 assert.throws(()=>registry.requireVersion('autodl-h3','99.0.0'),/插件版本不可用/);
});
test('a file-only external plugin registers settings, models and executes through the task lifecycle', {timeout:30000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'video-plugin-e2e-'));const dir=fixture(path.join(root,'plugins'),'fixture-video');
 fs.writeFileSync(path.join(dir,'index.js'),`module.exports={
 workflows:ch=>[{id:'fixture:'+ch.id,channelId:ch.id,channelType:ch.type,label:'测试视频',images:0,audios:0,videos:0,optionalImages:true,durationKey:'duration',durationDefault:3,durationOptions:[3],sizeMode:'resolution',resolutions:['test'],defaultResolution:'test'}],
 slots:ch=>[{key:'fixture:'+ch.id,id:ch.id,provider:'fixture-video',name:ch.name}],
 test:async()=>({ok:true,message:'fixture'}),
 submit:async()=>({taskId:'fixture-1'}),poll:async()=>({status:'success'}),
 async execute(ctx){const ch=ctx.channels.get('video',ctx.slot.id);const receipt=await this.submit(ch,ctx.job);ctx.job.remotePromptId=receipt.taskId;const result=await this.poll(ch,receipt.taskId);if(result.status!=='success')throw Error('failed');ctx.touch(ctx.job,{progress:90});const dir=ctx.jobDir(ctx.job);ctx.job.outputDir=dir;await ctx.saveOutputs(ctx.job,dir,[{type:'video',filename:'fixture.mp4',url:ch.baseUrl+'/fixture.mp4'}],ctx.signal);ctx.writeJobMeta(ctx.job,dir,{worker:ch.name});}
};`);
 const mock=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'video/mp4'});res.end(Buffer.from('plugin-result'));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const child=spawn(process.execPath,[path.join(__dirname,'../src/server.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,WMD_PORT:'19373',WMD_DATA_DIR:path.join(root,'data'),WMD_PROJECT_ROOT:path.join(root,'projects'),WMD_VIDEO_PLUGINS_DIR:path.join(root,'plugins'),WMD_AGENT_AUTOSTART:'0'},stdio:'ignore',windowsHide:true});
 const base='http://127.0.0.1:19373';let token;
 const call=async(url,body)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{'X-WMD-Internal':token}:{})},body:body?JSON.stringify(body):undefined});return r.json();};
 try{
  const until=Date.now()+15000;while(Date.now()<until){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  token=JSON.parse(fs.readFileSync(path.join(root,'data/internal-token.json'),'utf8')).token;
  const catalog=await call('/api/video-plugins');assert.equal(catalog.data.plugins[0].id,'fixture-video');
  const ch=await call('/api/channels',{kind:'video',type:'fixture-video',name:'文件插件',baseUrl:'http://127.0.0.1:'+mock.address().port,apiKey:'fixture'});assert.equal(ch.ok,true,JSON.stringify(ch));
  const state=await call('/api/state');assert.equal(state.data.channelTypes.video.length,1);const wf=state.data.workflows[0];assert.equal(wf.pluginId,'fixture-video');
  const created=await call('/api/jobs',{workflowId:wf.id,prompt:'测试',duration:3,resolution:'test'});assert.equal(created.ok,true,JSON.stringify(created));
  let job;const deadline=Date.now()+10000;while(Date.now()<deadline){job=(await call('/api/jobs')).data.jobs.find(j=>j.id===created.data.jobs[0].id);if(['failed','success'].includes(job.status))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(job.status,'success',job.error);assert.equal(job.pluginId,'fixture-video');assert.equal(job.pluginVersion,'1.0.0');assert.equal(fs.readFileSync(job.outputs[0].path,'utf8'),'plugin-result');
 }finally{child.kill();mock.closeAllConnections();await new Promise(r=>mock.close(r));}
});
