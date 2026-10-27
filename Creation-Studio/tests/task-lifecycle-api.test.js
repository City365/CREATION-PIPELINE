'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');const {startMockCloud,PNG}=require('./mock-cloud');const http=require('node:http');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){try{const v=await fn();if(v)return v;}catch{}await delay(100);}throw Error('等待超时');}
test('正式HTTP：统一单条与批量、草稿不发送、定时、分页、幂等、SSE和执行归档',{timeout:45000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'h3-lifecycle-')),cloud=await startMockCloud();const base='http://127.0.0.1:18971';
 let badServer;
 const child=spawn(process.execPath,[path.resolve(__dirname,'../src/server.js')],{env:{...process.env,H3_DATA_DIR:dir,H3_PORT:'18971',H3_AGENT_AUTOSTART:'0'},stdio:'ignore',windowsHide:true});
 const api=async(url,body)=>{const res=await fetch(base+url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const json=await res.json();if(!res.ok||!json.ok)throw Error(JSON.stringify(json));return json.data;};
 const del=async(id)=>{const res=await fetch(base+'/api/events/'+id,{method:'DELETE'});const json=await res.json();if(!res.ok||!json.ok)throw Error(JSON.stringify(json));return json.data;};
 try{
  await until(async()=>{const r=await fetch(base+'/api/health');return r.ok;});
  const ch=await api('/api/channels',{kind:'image',type:'openai-images',name:'local mock',baseUrl:cloud.url+'/v1',apiKey:'test-key',model:'mock-image-model'});
  const body={kind:'image',source:'batch',title:'双条目',draft:true,requestId:'same-input',items:[{prompt:'red',prefixPrompt:'prefix',channelId:ch.id},{prompt:'blue',channelId:ch.id}]};
  const draft=await api('/api/events',body);assert.equal(draft.status,'draft');assert.equal(draft.items.length,2);assert.equal(cloud.state.imageRequests.length,0);
  assert.equal((await api('/api/events',body)).id,draft.id);
  await api('/api/events/'+draft.id+'/schedule',{startAt:new Date(Date.now()+60000).toISOString(),order:2,concurrency:1});
  await api('/api/events/'+draft.id+'/queue',{});await delay(200);assert.equal(cloud.state.imageRequests.length,0,'指定未来执行不可提前提交');
  await api('/api/events/'+draft.id+'/schedule',{startAt:null,order:2,concurrency:1});
  const completed=await until(async()=>{const e=await api('/api/events/'+draft.id);return e.status==='completed'&&e;});assert.equal(completed.stats.done,2);assert.equal(cloud.state.imageRequests.length,2);
  const snapshot=await api('/api/images/tasks/'+completed.items[0].refId);assert.match(snapshot.snapshot.prompt,/prefix/);assert.equal(snapshot.snapshot.userPrompt,'red');
  const single=await api('/api/images/generate',{prompt:'single',channelId:ch.id,background:true,requestId:'single-request'});assert.ok(single.eventId);assert.equal((await api('/api/events/'+single.eventId)).items.length,1);
  for(let i=0;i<12;i++)await api('/api/events',{kind:'image',draft:true,items:[{prompt:'draft '+i,channelId:ch.id}]});
  const list=await api('/api/events?kind=image&page=2');assert.equal(list.events.length,4);assert.equal(list.total,14);assert.equal(list.pageSize,10);assert.equal(list.events[0].items,undefined);
  const mixed=await api('/api/events?kind=image&status=draft,completed');assert.equal(mixed.total,14,'多状态筛选应同时包含草稿与完成');
  assert.equal((await api('/api/events?kind=video')).total,0);
  await until(async()=>{const data=await api('/api/events/'+draft.id+'/attempts');return data.items.every(i=>i.attempts.length===1)&&data;});
  let badCount=0;badServer=http.createServer((req,res)=>{req.resume();req.on('end',()=>{badCount++;res.setHeader('Content-Type','application/json');if(badCount===1){res.writeHead(502);res.end(JSON.stringify({error:'controlled failure'}));}else res.end(JSON.stringify({data:[{b64_json:PNG.toString('base64')}]}));});});await new Promise(r=>badServer.listen(0,'127.0.0.1',r));
  const badChannel=await api('/api/channels',{kind:'image',type:'openai-images',name:'failure fixture',baseUrl:'http://127.0.0.1:'+badServer.address().port+'/v1',apiKey:'test',model:'fixture'});
  const failedTask=await api('/api/images/generate',{prompt:'retry fixture',channelId:badChannel.id,background:true});
  await until(async()=>{const e=await api('/api/events/'+failedTask.eventId);return e.status==='failed';});
  const retry=await api('/api/images/tasks/'+failedTask.taskId+'/retry',{});assert.notEqual(retry.id,failedTask.taskId);
  await until(async()=>{const e=await api('/api/events/'+failedTask.eventId);return e.status==='completed';});
  const history=await until(async()=>{const data=await api('/api/events/'+failedTask.eventId+'/attempts');return data.items[0].attempts.length===2&&data.items[0].attempts;});assert.deepEqual(history.map(a=>a.status).sort(),['failed','success']);
  const twenty=await api('/api/events',{kind:'image',title:'20 local images',draft:true,items:Array.from({length:20},(_,i)=>({prompt:'item '+i,channelId:ch.id}))});
  const detail=await api('/api/events/'+twenty.id+'?paged=1&page=2');assert.equal(detail.items.length,10);assert.equal(detail.itemPaging.total,20);
  await api('/api/events/'+twenty.id+'/queue',{});await until(async()=>{const event=await api('/api/events/'+twenty.id);return event.status==='completed'&&event.stats.done===20;});
  // 待调度任务：可编辑、可取消、可删除；已排期任务先取消，已结束任务可删除但不可重排
  const pending=await api('/api/events',{kind:'image',title:'pending one',pendingSchedule:true,items:[{prompt:'pending',channelId:ch.id}]});assert.equal(pending.status,'unscheduled');
  const edited=await api('/api/events/'+pending.id+'/draft',{title:'pending edited',items:[{prompt:'pending edited',channelId:ch.id}]});assert.equal(edited.title,'pending edited');assert.equal(edited.items.length,1);
  await api('/api/events/'+pending.id+'/schedule',{startAt:new Date(Date.now()+3600000).toISOString(),concurrency:1});
  assert.equal((await api('/api/events/'+pending.id)).status,'scheduled');
  await assert.rejects(()=>del(pending.id),/不能删除/,'已排期任务不能直接删除');
  await api('/api/events/'+pending.id+'/cancel',{});assert.equal((await api('/api/events/'+pending.id)).status,'canceled');
  await del(pending.id);await assert.rejects(()=>api('/api/events/'+pending.id),/事件不存在/);
  await assert.rejects(()=>api('/api/events/'+twenty.id+'/schedule',{startAt:null}),/不能再改调度/,'已完成任务不能重排');
  await assert.rejects(()=>api('/api/events/'+twenty.id+'/prepare',{}),/不能重新调度/,'已完成任务不能回到待调度');
  const controller=new AbortController();const stream=await fetch(base+'/api/task-events/stream',{signal:controller.signal});assert.match(stream.headers.get('content-type'),/text\/event-stream/);controller.abort();
  const listing=await fetch(base+'/api/events');assert.match(listing.headers.get('content-type'),/application\/json/);
 }finally{if(badServer)await new Promise(r=>badServer.close(r));child.kill();await new Promise(r=>child.once('exit',r));await new Promise(r=>cloud.server.close(r));}
});
