'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { createService } = require('../src/server');
const { Store } = require('../src/store');
const { TaskQueue } = require('../src/tasks');
async function until(fn) {const end=Date.now()+5000;while(Date.now()<end){if(fn())return;await wait(10);}throw new Error('等待超时');}
const fakePool={close:async()=>{},closeAccount:async()=>{},open:async()=>({ok:true})};
test('API拒绝跨站/缺失凭据；同一requestId只执行一次；取消后不返回完成结果',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbm-service-'));let calls=0;let releases=new Map();
  const service=await createService({directory,port:0,pool:fakePool,execute:async(task,account,signal)=>{
    calls++;await new Promise(resolve=>releases.set(task.id,resolve));
    const file=path.join(directory,task.id+'.mp4');fs.writeFileSync(file,'fixture');return {path:file};
  }});
  t.after(async()=>{for(const release of releases.values())release();await service.close();fs.rmSync(directory,{recursive:true,force:true});});
  const request=async(route,method='GET',data,headers={})=>{const r=await fetch(service.baseURL+route,{method,headers:{Authorization:'Bearer '+service.token,'Content-Type':'application/json',...headers},body:data?JSON.stringify(data):undefined});return {status:r.status,body:await r.json()};};
  assert.equal((await fetch(service.baseURL+'/api/state')).status,401);
  assert.equal((await request('/api/state','GET',null,{Origin:'https://foreign.invalid'})).status,403);
  const wrongHost=await new Promise((resolve,reject)=>require('node:http').get(service.baseURL+'/api/state',{headers:{Host:'foreign.invalid',Authorization:'Bearer '+service.token}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
  assert.equal(wrongHost,403);
  const a=(await request('/api/accounts','POST',{platform:'doubao',name:'test'})).body;
  const input={prompt:'original',platform:'doubao',accountId:a.id,requestId:'same-request'};
  const first=(await request('/api/tasks','POST',input)).body;
  const duplicate=(await request('/api/tasks','POST',input)).body;
  assert.equal(first.id,duplicate.id);await until(()=>calls===1);
  const second=(await request('/api/tasks','POST',{...input,requestId:'next'})).body;
  await wait(30);assert.equal(calls,1,'同账号不能并发');
  await request('/api/tasks/'+first.id+'/cancel','POST',{});releases.get(first.id)();
  await until(()=>calls===2);assert.equal(service.queue.get(first.id).status,'cancelled');assert.equal(service.queue.get(first.id).result,null);
  releases.get(second.id)();await until(()=>service.queue.get(second.id).status==='completed');
  assert.equal((await request('/api/tasks/'+first.id+'/file')).status,404);
});
test('重启不会重新提交未完成任务，排队任务可以在启动前取消',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbm-restart-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new Store(directory);const a=store.add({name:'disabled'});store.update(a.id,{enabled:false});let calls=0;
  const queue=new TaskQueue({directory,store,execute:async()=>{calls++;}});
  const task=queue.submit({prompt:'queued',accountId:a.id});queue.cancel(task.id);await wait(20);assert.equal(calls,0);
  const pending=queue.submit({prompt:'unfinished',accountId:a.id});await wait(20);
  const restored=new TaskQueue({directory,store,execute:async()=>{calls++;}});
  assert.equal(restored.get(pending.id).status,'interrupted');assert.equal(restored.get(task.id).status,'cancelled');
  restored.kick();await wait(20);assert.equal(calls,0);await queue.shutdown();await restored.shutdown();
});
