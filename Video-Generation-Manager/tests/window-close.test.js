'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {setTimeout:wait}=require('node:timers/promises');
const {chromium}=require('playwright-core');
const {createService}=require('../src/server');
const {findChrome}=require('../src/browser-pool');
async function processIds(context){
  const session=await context.browser().newBrowserCDPSession();
  try{return (await session.send('SystemInfo.getProcessInfo')).processInfo.map(p=>Number(p.id));}
  finally{await session.detach();}
}
test('关闭真实Chrome主窗口会取消任务、关闭账号浏览器、释放端口并保存Cookie',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbm-close-'));
  let service,account,reopened,poolClosed=false;
  t.after(async()=>{await service?.close();await account?.close().catch(()=>{});await reopened?.close().catch(()=>{});fs.rmSync(directory,{recursive:true,force:true});});
  const profile=path.join(directory,'account');
  account=await chromium.launchPersistentContext(profile,{executablePath:findChrome(),headless:true});
  await account.addCookies([{name:'lifecycle-test',value:'saved',domain:'example.test',path:'/',expires:Date.now()/1000+86400}]);
  const pool={close:async()=>{await account.close();poolClosed=true;}};
  service=await createService({directory,port:0,dashboardHeadless:true,pool,execute:async(task,account,signal)=>{
    await new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  }});
  const a=service.store.add({name:'lifecycle'});const task=service.queue.submit({prompt:'test-only',accountId:a.id});
  const deadline=Date.now()+3000;while(!service.queue.running.size&&Date.now()<deadline)await wait(10);
  assert.equal(service.queue.running.size,1);
  const page=await service.openDashboard();
  assert.equal(await service.openDashboard(),page,'重复打开应复用同一主窗口');
  const pids=[...new Set([...await processIds(page.context()),...await processIds(account)])];
  const port=service.server.address().port;
  await page.close();
  let timeout;let result;try{result=await Promise.race([service.closed,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('关闭主窗口后服务未退出')),20000);})]);}finally{clearTimeout(timeout);}
  assert.equal(result.ok,true);assert.equal(poolClosed,true);
  assert.equal(service.queue.get(task.id).status,'cancelled');assert.equal(service.server.listening,false);
  const open=await new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));});
  assert.equal(open,false);
  await wait(300);
  for(const pid of pids){let alive=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}assert.equal(alive,false,'Chrome进程仍在运行：'+pid);}
  reopened=await chromium.launchPersistentContext(profile,{executablePath:findChrome(),headless:true});
  assert.ok((await reopened.cookies('http://example.test')).some(c=>c.name==='lifecycle-test'&&c.value==='saved'));
  await reopened.close();reopened=null;
});
