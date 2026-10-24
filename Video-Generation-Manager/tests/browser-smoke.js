'use strict';
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');
const { execFileSync }=require('node:child_process');const {setTimeout:wait}=require('node:timers/promises');
const {chromium}=require('playwright-core');const {findChrome}=require('../src/browser-pool');const {createService}=require('../src/server');const {readPageState}=require('../src/adapters/page-state');
async function until(fn,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(200);}throw new Error('等待超时');}
(async()=>{
  const root=path.join(__dirname,'..','.cache','browser-smoke-'+Date.now());fs.mkdirSync(root,{recursive:true});
  const evidence=path.join(__dirname,'..','evidence');const video=path.join(root,'video.mp4');
  const ffmpeg=process.env.DBM_FFMPEG||'D:/notebook/software/ffmpeg/bin/ffmpeg.exe';const ffprobe=process.env.DBM_FFPROBE||'D:/notebook/software/ffmpeg/bin/ffprobe.exe';
  execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=green:s=320x240:d=1','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true,timeout:30000});
  const fixture=http.createServer((req,res)=>{if(req.url==='/video.mp4'){res.writeHead(200,{'Content-Type':'video/mp4'});fs.createReadStream(video).pipe(res);}else{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'fixture.html')));}});
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));const fixtureURL='http://127.0.0.1:'+fixture.address().port;
  let service,browser;
  try{
    service=await createService({directory:path.join(root,'data'),port:0,testBaseURL:fixtureURL,ffprobe});
    browser=await chromium.launch({executablePath:findChrome(),headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(service.baseURL+'/accounts');await page.locator('#add-account').click();
    await page.locator('#account-form [name=name]').fill('测试创作账号');await page.getByRole('button',{name:'保存账号',exact:true}).click();
    await until(()=>service.store.list().length===1);await page.getByRole('button',{name:'刷新',exact:true}).click();
    await page.screenshot({path:path.join(evidence,'dashboard.png'),fullPage:true});assert.deepEqual(errors,[]);
    // Real Chrome DOM regression: old assistant video must never belong to a new user prompt.
    const dom=await browser.newPage();await dom.goto(fixtureURL);
    await dom.locator('#messages').evaluate(e=>e.innerHTML='<div data-role="assistant" data-message-id="123456789">历史成片<video data-watermark="false" src="/video.mp4"></video></div>');
    const before=await dom.evaluate(readPageState,{});
    await dom.locator('#messages').evaluate(e=>e.insertAdjacentHTML('beforeend','<div data-role="user" data-message-id="123456790">本次提示词</div>'));
    const snapshot=await dom.evaluate(readPageState,{baseline:before.keys,prompt:'本次提示词'});
    assert.ok(snapshot.userKey);assert.equal(snapshot.media.length,0);assert.equal(snapshot.replies.length,0);
    const account=service.store.add({platform:'fixture',name:'Real Chrome Fixture'});
    const selectors={editor:'#editor',send:'#send',modeControl:'#mode',attachment:'.attachment',uploading:'.uploading',upload:'#upload'};
    service.store.update(account.id,{selectors});
    const reference=path.join(root,'reference.png');await page.screenshot({path:reference});
    const good=service.queue.submit({platform:'fixture',accountId:account.id,prompt:'生成测试视频',references:[reference],removeWatermark:true});
    await until(()=>['completed','failed'].includes(service.queue.get(good.id).status));
    const done=service.queue.get(good.id);assert.equal(done.status,'completed',done.error);assert.ok(done.result.duration>0);assert.equal(done.result.watermarkMethod,'explicit-no-watermark');
    const paused=service.queue.submit({platform:'fixture',accountId:account.id,prompt:'captcha-test'});
    await until(()=>service.queue.get(paused.id).status==='paused');service.queue.cancel(paused.id);
    await until(()=>!service.queue.running.has(paused.id));assert.equal(service.queue.get(paused.id).status,'cancelled');assert.equal(service.queue.get(paused.id).result,null);
    const cancelled=service.queue.submit({platform:'fixture',accountId:account.id,prompt:'cancel-test'});
    await until(()=>service.queue.get(cancelled.id).status==='generating');service.queue.cancel(cancelled.id);
    await until(()=>!service.queue.running.has(cancelled.id));assert.equal(service.queue.get(cancelled.id).result,null);
    // Thin plugin end-to-end: real HTTP polling, MP4 transfer and host naming, without touching the installed host.
    const connection=service.connectionFile;const plugin=path.join(__dirname,'..','plugin','video_plugin_doubao_local','main.py');
    const script=path.join(root,'plugin-smoke.py');const result=path.join(root,'plugin-result.json');
    fs.writeFileSync(script,'import importlib.util,json,os\ns=importlib.util.spec_from_file_location("local_plugin",'+JSON.stringify(plugin)+')\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nctx={"prompt":"插件生成测试视频","project_path":'+JSON.stringify(path.join(root,'project'))+',"unique_name":"sceneabc","viewer_index":1,"generation_round":2,"output_position":[0],"plugin_params":{"connection_file":'+JSON.stringify(connection)+',"platform":"fixture","account_id":'+JSON.stringify(account.id)+',"remove_watermark":True,"poll_interval":0.2}}\nr=m.generate(ctx)\nassert isinstance(r,list) and len(r)==1\nassert os.path.basename(r[0])=="0001_sceneabc_2_0.mp4"\nassert os.path.getsize(r[0])>0\nopen('+JSON.stringify(result)+',"w",encoding="utf-8").write(json.dumps(r))\n');
    const {spawn}=require('node:child_process');await new Promise((resolve,reject)=>{const p=spawn(process.env.DBM_PYTHON || 'C:/Program Files/python/python.exe',[script],{windowsHide:true,stdio:['ignore','pipe','pipe']});let err='';p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(err)));});
    assert.ok(JSON.parse(fs.readFileSync(result,'utf8'))[0].endsWith('0001_sceneabc_2_0.mp4'));
    const report={passed:true,chrome:true,tests:['dashboard-add-account','no-renderer-errors','historical-video-exclusion','sequential-reference-upload','generated-video-download-ffprobe','captcha-pauses','cancellation-stops-page','python-plugin-http-poll-and-return'],platformGenerationTested:false,createdAt:new Date().toISOString()};
    fs.writeFileSync(path.join(evidence,'browser-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser?.close();await service?.close();await new Promise(r=>fixture.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
