'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');const {startMockCloud,PNG}=require('./mock-cloud');
const ROOT=path.resolve(__dirname,'..');
test('正式 API：生成、另存、移动、历史提示词、隔离、重启和旧记录回读',{timeout:60000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'h3-workbench-api-'));const data=path.join(dir,'data');fs.mkdirSync(data,{recursive:true});
 const mock=await startMockCloud();let child;
 const base='http://127.0.0.1:18942';
 async function call(p,method='GET',body){const r=await fetch(base+p,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const d=await r.json();return {status:r.status,...d};}
 async function start(){child=spawn(process.execPath,[path.join(ROOT,'src/server.js')],{cwd:ROOT,env:{...process.env,APPDATA:path.join(dir,'appdata'),H3_DATA_DIR:data,H3_PORT:'18942'},windowsHide:true,stdio:'ignore'});for(let i=0;i<100;i++){try{if((await call('/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('server not ready');}
 async function stop(){if(child){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;child=null;}}
 t.after(async()=>{await stop();await new Promise(r=>mock.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});await start();
 await call('/api/config','PUT',{saveFolder:path.join(dir,'media'),assetFolder:path.join(dir,'assets')});
 const ch=(await call('/api/channels','POST',{kind:'image',type:'openai-images',name:'mock',baseUrl:mock.url+'/v1',apiKey:'test',model:'mock-model'})).data;
 const item=(await call('/api/workbench/items','POST',{projectId:'p',kind:'image',draft:{prompt:'original'}})).data;
 const prompt='原始中文提示词\n<Picture 1> '+ '完整记录'.repeat(150);
 const result=await call('/api/images/generate','POST',{projectId:'p',itemId:item.id,channelId:ch.id,prompt,size:'auto',count:1});assert.equal(result.ok,true,JSON.stringify(result));
 const src=result.data.items[0].path;
 await call('/api/workbench/items/'+item.id,'PATCH',{projectId:'p',kind:'image',revision:item.revision,draft:{prompt:'后来修改'}});
 const copied=(await call('/api/assets/from-file','POST',{path:src})).data;
 let detail=(await call('/api/media/details?path='+encodeURIComponent(copied.path))).data;assert.equal(detail.snapshot.userPrompt,prompt);assert.equal(detail.itemId,item.id);
 const renamed=(await call('/api/assets/rename','POST',{rel:copied.rel,name:'renamed.png'})).data;
 const moved=(await call('/api/assets/move','POST',{rel:renamed.rel,folder:'角色'})).data;
 const assetPath=path.join(dir,'assets',moved.rel);assert.equal((await call('/api/media/details?path='+encodeURIComponent(assetPath))).data.snapshot.userPrompt,prompt);
 assert.equal((await call('/api/workbench/items/'+item.id+'?projectId=q&kind=image')).status,404);
 assert.equal((await call('/api/workbench/items/'+item.id,'PATCH',{projectId:'p',kind:'image',revision:1,draft:{}})).status,409);
 const outside=path.join(dir,'private.txt');fs.writeFileSync(outside,'private');assert.equal((await call('/api/media/details?path='+encodeURIComponent(outside))).ok,false);
 const legacyDir=path.join(dir,'media','2020-01-01','legacy');fs.mkdirSync(legacyDir,{recursive:true});fs.writeFileSync(path.join(legacyDir,'params.json'),JSON.stringify({workflowId:'old',duration:15}));fs.writeFileSync(path.join(legacyDir,'prompt.txt'),prompt);fs.writeFileSync(path.join(legacyDir,'old.mp4'),Buffer.from('test'));
 assert.equal((await call('/api/media/details?path='+encodeURIComponent(path.join(legacyDir,'old.mp4')))).data.snapshot.prompt,prompt);
 const unknown=path.join(dir,'assets','unknown.png');fs.writeFileSync(unknown,Buffer.from('unique unknown image'));assert.equal((await call('/api/media/details?path='+encodeURIComponent(unknown))).data.missing,true);
 const videoItem=(await call('/api/workbench/items','POST',{projectId:'p',kind:'video'})).data;
 const videoChannel=(await call('/api/channels','POST',{kind:'video',type:'openai-video',name:'mock-video',baseUrl:mock.url+'/v1',apiKey:'test',model:'mock-video-model',options:{seconds:8,size:'1280x720'}})).data;
 const created=await call('/api/jobs','POST',{projectId:'p',itemId:videoItem.id,workflowId:'ch:'+videoChannel.id,prompt,images:[{path:src,name:'ref.png'}],duration:8,aspectRatio:'16:9 (Widescreen)',count:1});assert.equal(created.ok,true,JSON.stringify(created));
 const jobId=created.data.jobs[0].id;
 const waitJob=async()=>{for(let n=0;n<100;n++){const j=(await call('/api/jobs')).data.jobs.find(j=>j.id===jobId);if(['success','failed'].includes(j.status)){assert.equal(j.status,'success',j.error);return j;}await new Promise(r=>setTimeout(r,150));}throw Error('video timeout');};
 const first=await waitJob(),firstPath=first.outputs[0].path;
 assert.equal((await call('/api/workbench/items/'+videoItem.id+'/runs?projectId=p&kind=video')).data[0].status,'success');
 await call('/api/jobs/'+jobId+'/retry','POST',{});const retried=await waitJob();assert.notEqual(retried.outputs[0].path,firstPath);assert.equal(fs.existsSync(firstPath),true);assert.equal((await call('/api/workbench/items/'+videoItem.id+'/runs?projectId=p&kind=video')).data.length,2);
 assert.equal((await call('/api/media/details?path='+encodeURIComponent(firstPath))).data.snapshot.userPrompt,prompt);
 await stop();await start();assert.equal((await call('/api/media/details?path='+encodeURIComponent(assetPath))).data.snapshot.userPrompt,prompt);assert.equal((await call('/api/workbench/items/'+item.id+'?projectId=p&kind=image')).data.draft.prompt,'后来修改');
 const runs=(await call('/api/workbench/items/'+item.id+'/runs?projectId=p&kind=image')).data;assert.equal(runs.length,1);assert.equal(runs[0].snapshot.prompt,prompt);
 const list=(await call('/api/media?kind=image')).data.items;assert.equal(list.filter(i=>i.path===src).length,1);
});
