'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createStore}=require('../src/workbench-store');const {createImageTasks}=require('../src/image-tasks');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function setup(t,generate){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wmd-image-worker-'));const store=createStore(path.join(dir,'studio.db'));const item=store.create('p','image',{draft:{prompt:'原始'}});const tasks=createImageTasks({store,channel:()=>({id:'mock',name:'mock',model:'mock-model'}),generate,saveImages:()=>{const file=path.join(dir,'result.png');fs.writeFileSync(file,'result');return {id:'image-batch',items:[{path:file,name:'result.png',url:'/api/file'}]};},remember:()=>{}});t.after(async()=>{await tasks.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,item,tasks};}
test('后端任务不依赖客户端；日志持久化，完成后只合并结果而不覆盖新提示词',async t=>{
 let release;const gate=new Promise(r=>release=r);const {store,item,tasks}=setup(t,async()=>{await gate;return [1];});
 const a=tasks.enqueue({projectId:'p',itemId:item.id,prompt:'生成时的提示词',requestId:'request-once'});assert.equal(tasks.enqueue({projectId:'p',itemId:item.id,prompt:'再次点击',requestId:'request-once'}).id,a.id);
 await delay(10);assert.equal(tasks.get(a.id).status,'running');const fresh=store.get(item.id,'p','image');store.update(item.id,'p','image',{revision:fresh.revision,draft:{prompt:'等待期间改的新提示词'}});
 tasks.pause(a.id);assert.equal(tasks.get(a.id).held,true);tasks.resume(a.id);release();const finished=await tasks.wait(a.id);assert.equal(finished.status,'success');assert.equal(store.get(item.id,'p','image').draft.prompt,'等待期间改的新提示词');assert.equal(store.get(item.id,'p','image').draft.results.length,1);assert.ok(finished.logs.some(l=>l.message.includes('等待生成结果')));assert.ok(finished.logs.some(l=>l.level==='success'));assert.equal(finished.snapshot.userPrompt,'生成时的提示词');
});
test('排队任务手动暂停后不发送，继续只发送一次',async t=>{
 let requests=0;const {tasks}=setup(t,async()=>{requests++;return [1];});const a=tasks.enqueue({projectId:'p',prompt:'暂停验证',paused:true});await delay(20);assert.equal(requests,0);assert.equal(tasks.get(a.id).status,'paused');tasks.resume(a.id);await tasks.wait(a.id);assert.equal(requests,1);
});
test('重启遗留任务保留输入和中断日志，不自动再次消耗额度',async t=>{
 let requests=0;const {store,tasks}=setup(t,async()=>{requests++;return [1];});const id=store.begin({kind:'image',projectId:'p',prompt:'遗留完整提示词',status:'running'});tasks.initialize();assert.equal(tasks.get(id).status,'interrupted');assert.match(tasks.get(id).error,/未自动重新生成/);assert.equal(tasks.get(id).snapshot.prompt,'遗留完整提示词');await delay(20);assert.equal(requests,0);const retry=tasks.retry(id);assert.notEqual(retry.id,id);assert.equal((await tasks.wait(retry.id)).status,'success');assert.equal(requests,1);
});
test('服务侧关闭等待在途图像落盘，不丢失结果',async t=>{
 let release;const gate=new Promise(r=>release=r);const {tasks}=setup(t,async()=>{await gate;return [1];});const a=tasks.enqueue({projectId:'p',prompt:'关闭保护'});await delay(10);let closed=false;const closing=tasks.close().then(()=>closed=true);await delay(20);assert.equal(closed,false);release();await closing;assert.equal(tasks.get(a.id).status,'success');
});
