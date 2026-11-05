'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: wait } = require('node:timers/promises');
const { chromium } = require('playwright-core');
const { Store, readJSON, saveJSON, safeSegment } = require('./store');
const { TaskQueue } = require('./tasks');
const {Settings}=require('./settings');
const {Outbound}=require('./outbound');
const { BrowserPool, findChrome } = require('./browser-pool');
const {readPageState}=require('./adapters/page-state');
const { createExecutor,applyOptions,selectorsFor,submitText,firstVisible } = require('./automation');
const { chatDetailed } = require('./reply-intent');
const skillPacks = require('./skills');
const { createGeminiExecutor } = require('./automation-gemini');
// v2：官方豆包桌面客户端调度（独立实现，不复用 v1 的网页自动化）
const { createClientExecutor, focusTaskId } = require('./v2/executor');
const v2extract = require('./v2/extract');
const v2client = require('./v2/client');
const v2drive = require('./v2/drive');
const { createExtractor } = require('./extract');
const { createHistory } = require('./extract-history');
const { parseJsonAccountImport, parseDolaTextCookieImport } = require('../recovered/src/account-import');
function secureEqual(a,b) {
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length && x.length>0 && crypto.timingSafeEqual(x,y);
}
function findFFprobe() {
  const found=[process.env.DBM_FFPROBE,'D:/notebook/software/ffmpeg/bin/ffprobe.exe'].find(p=>p && fs.existsSync(p));
  return found || 'ffprobe';
}
// 下载目录是成片的唯一落地位置；这里按修改时间列出文件，并把能对上的任务信息一并带回。
function listDownloads(downloads, queue) {
  let entries;
  try { entries = fs.readdirSync(downloads, { withFileTypes: true }); } catch { return []; }
  const tasks = queue.list().filter(t => t.result?.path);
  return entries.filter(e => e.isFile() && /\.(mp4|mov|m4v|webm)$/i.test(e.name)).map(entry => {
    const full = path.resolve(downloads, entry.name);
    let stat;
    try { stat = fs.statSync(full); } catch { return null; }
    const task = tasks.find(t => path.resolve(t.result.path) === full);
    return { name: entry.name, size: stat.size, mtime: stat.mtime.toISOString(), taskId: task?.id || '',
      watermarkMethod: task?.result?.watermarkMethod || '', duration: task?.result?.duration ?? null };
  }).filter(Boolean).sort((a, b) => new Date(b.mtime) - new Date(a.mtime)).slice(0, 300);
}
// 播放/下载成片。播放要支持 Range，否则浏览器没法拖动进度条。
function serveVideo(req, res, task, inline) {
  const file = task.result?.path;
  if (!file || !fs.existsSync(file)) throw new Error('本地文件已不存在');
  const stat = fs.statSync(file);
  const name = path.basename(file).replace(/"/g, '');
  const common = {
    'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
    'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + name + '"'
  };
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (match && (match[1] || match[2])) {
    let start = match[1] ? Number(match[1]) : null;
    let end = match[2] ? Number(match[2]) : null;
    if (start === null) { start = Math.max(0, stat.size - (end || 0)); end = stat.size - 1; }
    else if (end === null || end >= stat.size) end = stat.size - 1;
    if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); res.end(); return; }
    res.writeHead(206, { ...common, 'Content-Length': end - start + 1, 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...common, 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
}
// 用系统默认程序打开文件（视频交给默认播放器，不占用浏览器）。
function openWithDefaultApp(target) {
  return new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const command = win ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = win ? ['url.dll,FileProtocolHandler', target] : [target];
    let child;
    try { child = spawn(command, args, { detached: true, stdio: 'ignore' }); }
    catch (error) { reject(new Error('无法调用系统播放器：' + error.message)); return; }
    const timer = setTimeout(() => { child.removeAllListeners(); reject(new Error('系统播放器没有响应，可先在资源管理器里设置默认播放器')); }, 5000);
    timer.unref?.();
    child.once('error', error => { clearTimeout(timer); reject(new Error('无法调用系统播放器：' + error.message)); });
    child.once('spawn', () => { clearTimeout(timer); child.unref(); resolve(child.pid); });
  });
}
// 在系统文件管理器里打开下载目录或定位文件。不能带 windowsHide：那会给 explorer 传 SW_HIDE，
// 窗口建出来却是隐藏的，看起来像“点了没反应”。
function revealInExplorer(target, select) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? [select ? '/select,' + target : target]
      : process.platform === 'darwin' ? [...(select ? ['-R'] : []), target] : [target];
    let child;
    try { child = spawn(command, args, { detached: true, stdio: 'ignore' }); }
    catch (error) { reject(new Error('无法调用文件管理器：' + error.message)); return; }
    const timer = setTimeout(() => { child.removeAllListeners(); reject(new Error('文件管理器没有响应，请从系统管理里复制路径手动打开')); }, 5000);
    timer.unref?.();
    child.once('error', error => { clearTimeout(timer); reject(new Error('无法调用文件管理器：' + error.message)); });
    child.once('spawn', () => { clearTimeout(timer); child.unref(); resolve(child.pid); });
  });
}
async function body(req) {
  let size=0;const chunks=[];
  for await(const chunk of req) {size+=chunk.length;if(size>20*1024*1024)throw new Error('请求超过20MB');chunks.push(chunk);}
  const raw=Buffer.concat(chunks).toString('utf8');return raw?JSON.parse(raw):{};
}
// 无水印直链只在带豆包 cookie/referer 时可访问，页面预览/element 播放必须由本地服务中转一次。
async function pipeRemote(req,res,target){
  const controller=new AbortController();
  const headers={...target.headers};
  if(req.headers.range)headers.Range=req.headers.range;
  const response=await fetch(target.url,{headers,redirect:'follow',signal:controller.signal});
  if(!response.ok && response.status!==206){await response.body?.cancel();throw new Error('无水印直链返回 HTTP '+response.status);}
  const out={'Content-Type':response.headers.get('content-type')||'video/mp4','Cache-Control':'no-store','Accept-Ranges':'bytes'};
  for(const [name,value] of response.headers) if(['content-length','content-range','accept-ranges'].includes(name)&&value) out[name]=value;
  res.writeHead(response.status,out);
  if(!response.body){res.end();return;}
  // 浏览器拖动进度条/关掉预览会直接掐断连接，上游流就会报错。
  // 这里必须接住：没有 error 监听的 pipeline 会变成未捕获异常，把整个服务带崩。
  const source=Readable.fromWeb(response.body);
  let closed=false;
  const stop=()=>{ if(closed)return; closed=true; try{controller.abort();}catch{} try{source.destroy();}catch{} };
  source.on('error',()=>{ try{res.destroy();}catch{} stop(); });
  res.on('error',stop);
  res.on('close',stop);
  source.pipe(res);
}
function send(res,code,data,headers={}) {
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));
}
async function createService(options={}) {
  const directory=path.resolve(options.directory || process.env.DBM_REBUILD_DATA_DIR || path.join(__dirname,'..','data'));
  fs.mkdirSync(directory,{recursive:true});
  const connectionFile=path.join(directory,'connection.json');
  const old=readJSON(connectionFile,{});const token=old.apiToken || crypto.randomBytes(32).toString('base64url');
  const port=Number(options.port ?? process.env.DBM_REBUILD_PORT ?? 17778);
  const store=options.store || new Store(directory);
  const settings=new Settings(directory);
  let outbound=null;
  const defaultDownloads=path.join(directory,'downloads');fs.mkdirSync(defaultDownloads,{recursive:true});
  // 下载目录可由用户在系统管理里改；每次使用都重新解析并确保存在。
  const currentDownloads=()=>{const dir=settings.downloadsDirectory();fs.mkdirSync(dir,{recursive:true});return dir;};
  const pool=options.pool || new BrowserPool({store,chromePath:process.env.DBM_CHROME_PATH,testBaseURL:options.testBaseURL,getProxy:()=>settings.browserProxy()});
  const ffprobe=options.ffprobe || findFFprobe();
  const getDispatcher=url=>settings.dispatcher(url);
  const interpreter=require('./reply-intent').createInterpreter({settings,getDispatcher});
  const warmup=require('./warmup').createWarmup({settings,getDispatcher});
  const doubaoExecutor=createExecutor({pool,store,downloads:currentDownloads,ffprobe,fixture:Boolean(options.testBaseURL),getDispatcher,interpreter,warmup});
  const geminiExecutor=createGeminiExecutor({pool,store,downloads:currentDownloads,ffprobe,getDispatcher});
  const clientExecutor=options.clientExecutor || createClientExecutor({store,settings,downloads:currentDownloads,ffprobe,getDispatcher,interpreter,warmup,
    log:(message)=>{try{console.log('[v2] '+message);}catch{/* 日志失败不影响任务 */}}});
  // 视频提取是独立工具：不排任务、不扣额度，只借用账号窗口的无水印解析通道。
  const extractHistory=createHistory(directory);
  const extractor=createExtractor({pool,store,getDispatcher,ffprobe,downloads:currentDownloads,history:extractHistory,
    // 对话归属反查：任务记录里谁跑过这个对话，就用那个账号打开，避免被平台退回对话列表。
    resolveAccountId:(href)=>{const hit=queue.list().find(t=>t.conversationURL===href);return hit?hit.accountId:'';},
    // 账号在跑任务时不能收窗口，否则会把任务页一起关掉。
    isAccountBusy:(accountId)=>queue.busy.has(accountId)});
  const mappings=require('./prompt-mappings').createMappings(directory);
  const defaultExecute=(task,account,signal,update)=>{
    const conversion=task.resume && task.promptMapping ? {text:task.convertedPrompt,config:task.promptMapping,warnings:task.conversionWarnings||[]} : mappings.convert(task.prompt,task.platform);
    const prepared={...task,prompt:conversion.text};
    const patch={convertedPrompt:conversion.text,promptMapping:conversion.config,conversionWarnings:conversion.warnings};
    Object.assign(prepared,patch);update(patch);
    return (task.platform==='gemini'?geminiExecutor:doubaoExecutor)(prepared,account,signal,p=>{Object.assign(prepared,p);update(p);});
  };
  // 每个任务用独立账号窗口跑；跑完立刻关掉窗口，队列里的下一个再开新窗口。
  const execute=options.execute || (async (task,account,signal,update)=>{
    const schedulerMode=(settings.value.scheduler&&settings.value.scheduler.mode)||'web';
    if(schedulerMode==='client' && task.platform==='doubao'){
      return clientExecutor(task,account,signal,update);
    }
    try { return await defaultExecute(task,account,signal,update); }
    finally { try { await pool.closeAccount(account.id); } catch { /* 窗口可能已被用户手动关闭 */ } }
  });
  const concurrency=Math.max(1,Math.min(10,Number(process.env.DBM_CONCURRENCY)||5));
  const analyzeFailure=async (task,account,error)=>{
    const context=(error&&error.failureContext)||{};
    const result=await interpreter.analyzeFailureDetailed({
      task,account,error,
      lastReply:context.lastReply||'',
      pageText:context.pageText||'',
      flags:context.flags||{},
    });
    return result.analysis||null;
  };
  const queue=new TaskQueue({directory,store,execute,concurrency,analyzeFailure});
  // 聊天测试：每个账号复用同一个页面/会话，方便连续多轮观察理解器的判定；不进入视频模式。
  const chatTests=new Map();
  async function runChatTest(account,message,skillsSelected=['intent','chat']){
    const selected=Array.isArray(skillsSelected)?skillsSelected:['intent','chat'];
    const selectors=selectorsFor('doubao',account);
    let session=chatTests.get(account.id);
    let page=session&&!session.page.isClosed()?session.page:null;
    if(!page){
      page=await pool.taskPage(account);
      await firstVisible(page,selectors.editor,30000);
      chatTests.set(account.id,{page});
    }
    const videoMode=()=>page.locator('[data-input-engine-actionbar-control-key="video-model"]').isVisible().catch(()=>false);
    if(await videoMode()){
      const newChat=page.locator(selectors.newChat||'[role="button"]:has-text("新对话")').first();
      if(await newChat.count().catch(()=>0)){await newChat.click().catch(()=>{});await wait(800);}
    }
    if(await videoMode())throw new Error('账号页面停留在视频模式；请先在账号窗口切回「对话」再测试，避免误触发生成');
    await firstVisible(page,selectors.editor,15000);
    const before=await page.evaluate(readPageState,{selectors});
    await submitText(page,message,selectors,new AbortController().signal);
    const started=Date.now();let state=before,reply='',stableAt=0,anchorKey='';
    while(Date.now()-started<120000){
      await wait(800);
      state=await page.evaluate(readPageState,{selectors,baseline:before.keys,prompt:message,anchorKey});
      if(state.captcha)throw new Error('页面要求人工验证，请在账号窗口完成后再试');
      if(state.otherUser)throw new Error('当前会话出现其他用户消息，请关闭测试窗口后重试');
      if(state.userKey)anchorKey=state.userKey;
      const last=state.replies[state.replies.length-1];
      if(anchorKey&&last&&last.text&&!state.responding){
        if(last.text!==reply){reply=last.text;stableAt=Date.now();}
        else if(Date.now()-stableAt>=1500)break;
      }
    }
    if(!reply)throw new Error('等待豆包回复超时；请确认账号已登录且页面能正常聊天');
    let verdict=null;let interpreterError='';
    if(skillPacks.has(selected,'intent')){
      const interpreted=await interpreter.classifyDetailed({task:{prompt:message},lastReply:reply,recentReplies:state.replies.map(item=>item.text),sent:[],pushRounds:0,skills:selected});
      verdict=interpreted.verdict;interpreterError=interpreted.error||'';
    }
    const suggestion=verdict&&skillPacks.has(selected,'chat')?verdict.suggestedReply:'';
    return {reply,conversationURL:page.url().split('?')[0],verdict,interpreterError,suggestion};
  }
  function monitorSnapshot(dimension='month'){
    const now=new Date();const buckets=[];const pad=n=>String(n).padStart(2,'0');
    if(dimension==='hour'){
      const base=new Date(now);base.setMinutes(0,0,0);
      for(let i=23;i>=0;i--){const d=new Date(base);d.setHours(base.getHours()-i);const start=d.getTime(),end=new Date(d.getTime()+3600000).getTime();buckets.push({key:pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':00',label:pad(d.getHours())+':00',start,end,created:0,completed:0,failed:0,canceled:0});}
    }else if(dimension==='day'){
      for(let i=29;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i);const start=d.getTime(),end=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1).getTime();buckets.push({key:d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()),label:(d.getMonth()+1)+'/'+d.getDate(),start,end,created:0,completed:0,failed:0,canceled:0});}
    }else{
      dimension='month';
      for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const start=d.getTime(),end=new Date(d.getFullYear(),d.getMonth()+1,1).getTime();buckets.push({key:d.getFullYear()+'-'+pad(d.getMonth()+1),label:(d.getMonth()+1)+'月',start,end,created:0,completed:0,failed:0,canceled:0});}
    }
    const start=buckets[0].start,end=buckets[buckets.length-1].end;
    const tasks=queue.list();const accounts=store.list();const inRange=tasks.filter(t=>{const ts=Date.parse(t.createdAt);return ts>=start&&ts<end;});
    const statuses={};const ratios={};const durations={};const platforms={};
    const accountStats=new Map(accounts.map(a=>[a.id,{id:a.id,name:a.name,platform:a.platform,enabled:a.enabled!==false,busy:queue.busy.has(a.id),cooldownUntil:a.cooldownUntil||0,quota:a.quota||{used:0,limit:0},tasks:0,completed:0,failed:0}]));
    let processingMs=0,processingCount=0;
    for(const task of inRange){
      const ts=Date.parse(task.createdAt);const bucket=buckets.find(b=>ts>=b.start&&ts<b.end);
      const status=String(task.status||'queued');statuses[status]=(statuses[status]||0)+1;
      if(bucket){bucket.created++;if(status==='completed')bucket.completed++;else if(status==='failed')bucket.failed++;else if(status==='cancelled')bucket.canceled++;}
      const ratio=String(task.ratio||'未设置');ratios[ratio]=(ratios[ratio]||0)+1;
      const duration=task.duration==null?'未设置':String(task.duration)+' 秒';durations[duration]=(durations[duration]||0)+1;
      const platform=String(task.platform||'未知');platforms[platform]=(platforms[platform]||0)+1;
      const account=accountStats.get(task.accountId);if(account){account.tasks++;if(status==='completed')account.completed++;else if(status==='failed')account.failed++;}
      if(status==='completed'){const a=Date.parse(task.createdAt),b=Date.parse(task.updatedAt);if(Number.isFinite(a)&&Number.isFinite(b)&&b>=a){processingMs+=b-a;processingCount++;}}
    }
    const count=(name)=>inRange.filter(t=>t.status===name).length;
    const completed=count('completed'),failed=count('failed'),canceled=count('cancelled');
    const active=inRange.filter(t=>!['completed','failed','cancelled','interrupted'].includes(t.status)).length;
    const total=inRange.length;
    return {
      generatedAt:now.toISOString(),dimension,range:{start,end,label:dimension==='month'?'近 12 个月':dimension==='day'?'近 30 天':'近 24 小时'},
      summary:{total,completed,failed,canceled,active,paused:count('paused'),interrupted:count('interrupted'),completionRate:total?Math.round(completed/total*1000)/10:0,successRate:(completed+failed)?Math.round(completed/(completed+failed)*1000)/10:null,avgProcessingMs:processingCount?Math.round(processingMs/processingCount):null,quotaUsed:accounts.reduce((n,a)=>n+Number(a.quota?.used||0),0),quotaLimit:accounts.reduce((n,a)=>n+Number(a.quota?.limit||0),0),accounts:accounts.length,accountsEnabled:accounts.filter(a=>a.enabled!==false).length,accountsBusy:queue.busy.size},
      series:buckets.map(({start:xStart,end:xEnd,...rest})=>rest),
      statuses:Object.entries(statuses).map(([status,n])=>({status,count:n})).sort((a,b)=>b.count-a.count),
      accounts:[...accountStats.values()].sort((a,b)=>b.tasks-a.tasks),
      params:{ratios:Object.entries(ratios).map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count),durations:Object.entries(durations).map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count),platforms:Object.entries(platforms).map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count)},
    };
  }
  const webRoot=path.join(__dirname,'..','web');let dashboard, dashboardPage, dashboardOpening, closePromise;let shuttingDown=false;
  let resolveClosed;const closed=new Promise(resolve=>{resolveClosed=resolve;});
  function authorized(req) {
    const bearer=String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
    const cookie=String(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('dbm_session='))?.slice(12);
    return secureEqual(bearer,token) || secureEqual(cookie,token);
  }
  const server=http.createServer(async(req,res)=>{
    try {
      if(shuttingDown){send(res,503,{error:'应用正在退出'});return;}
      const url=new URL(req.url,'http://127.0.0.1');const pathname=url.pathname;
      const expected='http://127.0.0.1:'+server.address().port;
      const origin=req.headers.origin;
      const host=req.headers.host;
      if(host!==new URL(expected).host){send(res,403,{error:'无效Host'});return;}
      if(origin && origin!==expected){send(res,403,{error:'不允许跨站请求'});return;}
      if(req.method==='GET' && pathname==='/health'){send(res,200,{ok:true,version:'0.1.0',service:'doubao-local-manager'});return;}
      if(pathname.startsWith('/api/')) {
        if(!authorized(req)){send(res,401,{error:'本地连接凭据无效，请从管理器打开页面或配置插件connection_file'});return;}
        if(pathname==='/api/prompt-mappings'){
          if(req.method==='GET'){send(res,200,mappings.get());return;}
          if(req.method==='PUT'){send(res,200,mappings.save(await body(req)));return;}
        }
        if(pathname==='/api/prompt-mappings/preview' && req.method==='POST'){
          const input=await body(req);const config=input.config?require('./prompt-mappings').validate(input.config):mappings.get();
          if(!['doubao','gemini'].includes(input.platform)||typeof input.text!=='string'||input.text.length>100000)throw new Error('预览参数无效');
          send(res,200,require('./prompt-mappings').convert(input.text,input.platform,config));return;
        }
        if(req.method==='GET' && pathname==='/api/connection'){send(res,200,{baseURL:expected,apiToken:token,connectionFile});return;}
        if(req.method==='GET' && pathname==='/api/skills'){send(res,200,{skills:skillPacks.list()});return;}
        if(req.method==='GET' && pathname==='/api/settings'){send(res,200,settings.public());return;}
        if(req.method==='GET' && pathname==='/api/remote/status'){send(res,200,outbound?outbound.status():{enabled:false});return;}
        if(req.method==='POST' && pathname==='/api/remote/restart'){if(outbound)outbound.restart();send(res,200,outbound?outbound.status():{enabled:false});return;}
        // ---- v2：官方客户端调度的状态与人工操作入口 ----
        if(req.method==='GET' && pathname==='/api/v2/status'){
          const scheduler=settings.value.scheduler||{};
          const status=await v2client.status();
          send(res,200,{...status,mode:scheduler.mode||'web',configuredExe:scheduler.clientExe||'',pollMs:Number(scheduler.pollMs)||8000});
          return;
        }
        if(req.method==='POST' && pathname==='/api/v2/connect'){
          const input=await body(req).catch(()=>({}));
          const scheduler=settings.value.scheduler||{};
          const result=await v2client.ensureReady({restart:Boolean(input.restart),exe:scheduler.clientExe||''});
          send(res,200,result);return;
        }
        if(req.method==='GET' && pathname==='/api/v2/accounts'){
          const {page}=await v2client.connect();
          send(res,200,await v2drive.listAccounts(page));return;
        }
        if(req.method==='POST' && pathname==='/api/v2/extract'){
          const input=await body(req);
          // 会话 id 提取：默认只检测，download=true 才落盘；all=true 提取全部，否则只取最新那条。
          const account=input.accountId?store.get(String(input.accountId)):null;
          if(input.accountId&&!account)throw new Error('账号不存在');
          const result=await v2extract.extractVideos({
            conversationId:input.conversationId||input.conversationURL||'',
            accountName:account?String(account.remark||account.name||''):'',
            messageId:input.messageId||'',
            all:Boolean(input.all),
            download:Boolean(input.download),
            directory:currentDownloads(),
            ffprobe,
            log:(message)=>{try{console.log('[v2] '+message);}catch{/* 日志失败不影响提取 */}},
          });
          send(res,200,result);return;
        }
        if(req.method==='POST' && pathname==='/api/v2/action'){
          const input=await body(req);
          const {page}=await v2client.connect();
          const action=String(input.action||'');
          let result;
          if(action==='newChat')result=await v2drive.newChat(page);
          else if(action==='say')result=await v2drive.typeAndSend(page,String(input.text||''));
          else if(action==='waitReply')result=await v2drive.waitReply(page,{timeoutMs:Number(input.timeoutMs)||180000});
          else if(action==='switchAccount')result=await v2drive.switchAccount(page,String(input.name||''),{reconnect:async()=>{const ctx=await v2client.reconnect();return ctx.page;}});
          else if(action==='sidebar')result=await v2drive.sidebar(page);
          else if(action==='bottom')result=await v2drive.bottom(page);
          else if(action==='messages')result=await v2drive.messages(page,{limit:Number(input.limit)||10});
          else if(action==='screenshot')result={path:await v2drive.screenshot(page,{directory:path.join(directory,'v2','shots')})};
          else throw new Error('未知的客户端操作：'+action);
          // page 是内部句柄，不往外传
          if(result&&typeof result==='object'&&result.page)result=(()=>{const {page:_page,...rest}=result;return rest;})();
          send(res,200,result);return;
        }
        if(req.method==='PUT' && pathname==='/api/settings'){
          const value=settings.validate(await body(req));
          const proxyChanged=settings.proxyChanged(value);
          const remoteBefore=JSON.stringify(settings.value.remote||{});
          const remoteChanged=remoteBefore!==JSON.stringify(value.remote||{});
          if(proxyChanged && queue.running.size)throw new Error('请等待正在执行的任务完成后再修改代理');
          // 只有代理变化才需要重开账号浏览器；改下载目录直接生效。
          if(proxyChanged){
            queue.stopping=true;
            try{
              for(const account of store.list())await pool.closeAccount(account.id);
              const saved=await settings.save(value);
              if(remoteChanged&&outbound)outbound.restart();
              send(res,200,saved);
            }finally{if(!shuttingDown){queue.stopping=false;queue.kick();}}
            return;
          }
          const saved=await settings.save(value);
          if(remoteChanged&&outbound)outbound.restart();
          send(res,200,saved);return;
        }
        if(req.method==='POST' && pathname==='/api/interpreter/test'){
          const result=await interpreter.classifyDetailed({
            task:{prompt:'一只橘猫在阳光下的窗台上伸懒腰，写实摄影风格，16:9，5 秒',duration:5,ratio:'16:9'},
            lastReply:'方案已经准备好了，确认后我就开始生成视频。',
            recentReplies:[],sent:[],pushRounds:0,
          });
          if(!result.verdict)throw new Error(result.error||'AI 回复理解没有返回判定');
          send(res,200,{ok:true,verdict:result.verdict});return;
        }
        if(req.method==='POST' && pathname==='/api/agent/chat'){
          const input=await body(req);
          const message=String(input.message||'').trim();
          if(!message||message.length>4000)throw new Error('测试消息为空或超过 4000 字');
          const selected=Array.isArray(input.skills)?input.skills.map(String):[];
          const history=Array.isArray(input.history)?input.history.slice(-20).map(turn=>({
            role:turn&&turn.role==='assistant'?'assistant':'user',
            text:String((turn&&turn.text)||'').slice(0,8000),
          })):[];
          const result=await chatDetailed(settings,getDispatcher,{message,history,skills:selected});
          if(!result.reply)throw new Error(result.error||'智能体没有返回内容');
          let verdict=null;
          if(skillPacks.has(selected,'intent')){
            const classified=await interpreter.classifyDetailed({task:{prompt:message},lastReply:result.reply,recentReplies:[result.reply],sent:[],pushRounds:0,skills:selected});
            verdict=classified.verdict;
          }
          send(res,200,{reply:result.reply,verdict,error:result.error||''});return;
        }
        if(req.method==='POST' && pathname==='/api/interpreter/import-agent'){
          const file=process.env.DBM_AGENT_SETTINGS || path.resolve(__dirname,'..','..','Creation-Studio','agent_backend','data','agent_settings.json');
          let data=null;
          try{data=readJSON(file,null);}catch(error){throw new Error('读取智能体配置失败：'+error.message);}
          if(!data)throw new Error('找不到智能体配置：'+file);
          const active=(data.model&&data.model.active)||data.active||'';
          const providers=(data.model&&data.model.providers)||data.providers||{};
          const provider=providers[active]||Object.values(providers).find(item=>item&&item.api_key);
          if(!provider||!provider.api_key)throw new Error('智能体配置里没有可用的 API Key');
          const protocol=provider.protocol==='anthropic'?'anthropic':'openai';
          const value=settings.validate({
            proxy:settings.value.proxy,
            downloadDirectory:settings.value.downloadDirectory,
            interpreter:{...settings.value.interpreter,protocol,baseUrl:provider.base_url||provider.baseUrl||'',model:provider.model||'',apiKey:provider.api_key},
          });
          await settings.save(value);
          send(res,200,{ok:true,provider:active||'active',protocol,baseUrl:value.interpreter.baseUrl,model:value.interpreter.model,apiKeyConfigured:true});return;
        }
        if(req.method==='GET' && pathname==='/api/monitor') {
          send(res,200,monitorSnapshot(String(url.searchParams.get('dimension')||'month')));return;
        }
        if(req.method==='GET' && pathname==='/api/state') {
          const accounts=store.list();
          const page=queue.page({
            page:Number(url.searchParams.get('tasksPage'))||1,
            pageSize:url.searchParams.has('tasksPageSize')?Number(url.searchParams.get('tasksPageSize')):10,
            query:url.searchParams.get('q')||'',
            filter:url.searchParams.get('filter')||'all',
            accountName:(id)=>accounts.find((a)=>a.id===id)?.name||'',
          });
          // 执行表：未结束的任务按提交先后排队，序号就是取片顺序。
          const activeOrder=queue.list()
            .filter(t=>!['completed','failed','cancelled','interrupted'].includes(t.status))
            .sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
          const orderMap=new Map(activeOrder.map((t,index)=>[t.id,index+1]));
          const tasks=page.tasks.map(t=>orderMap.has(t.id)?{...t,queuePosition:orderMap.get(t.id)}:t);
          send(res,200,{accounts,tasks,busyAccounts:[...queue.busy],directory,downloads:currentDownloads(),connectionFile,version:'0.1.0',concurrency:queue.concurrency,running:queue.running.size,proxyWarning:pool.proxyWarning||'',
            focusTaskId:(()=>{try{return focusTaskId();}catch{return '';}})(),queue:activeOrder.map(t=>({id:t.id,position:orderMap.get(t.id),status:t.status,accountId:t.accountId,message:t.message})).slice(0,20),
            taskTotal:page.total,taskPage:page.page,taskPageSize:page.pageSize,taskPages:page.pages,taskStats:page.stats});return;
        }
        if(req.method==='POST' && pathname==='/api/accounts'){
          const input=await body(req);if(input.platform==='fixture' && !options.testBaseURL)throw new Error('测试平台未启用');
          send(res,201,store.add(input));queue.kick();return;
        }
        const accountRoute=pathname.match(/^\/api\/accounts\/([0-9a-f-]{36})(?:\/(open|close|inspect|prepare-video|reference-draft|chat-test))?$/i);
        if(accountRoute){
          const account=store.get(accountRoute[1]);if(!account){send(res,404,{error:'账号不存在'});return;}
          if(req.method==='PATCH' && !accountRoute[2]){send(res,200,store.update(account.id,await body(req)));queue.kick();return;}
          if(req.method==='DELETE' && !accountRoute[2]){
            if(queue.busy.has(account.id))throw new Error('账号正在执行任务，请先取消任务');
            await pool.closeAccount(account.id);send(res,200,store.remove(account.id));return;
          }
          if(req.method==='POST' && accountRoute[2]==='prepare-video'){if(queue.busy.has(account.id))throw new Error('账号正在执行任务');await pool.open(account);const context=await pool.context(account);const page=context.pages().filter(p=>!p.isClosed()&&p.url().startsWith(pool.url(account).split('/chat')[0])).at(-1);const input=await body(req);if(input.prompt)await page.locator(account.selectors?.editor||'[contenteditable=true]').fill(require('./adapters/doubao-mentions').pictureTagsToText(input.prompt));send(res,200,await applyOptions(page,{...input,platform:account.platform},selectorsFor(account.platform,account),new AbortController().signal));return;}
          if(req.method==='POST' && accountRoute[2]==='reference-draft'){
            if(queue.busy.has(account.id))throw new Error('账号正在执行任务');
            const input=await body(req);
            const {prepareReferenceDraft}=require('./reference-draft');
            send(res,200,await prepareReferenceDraft(pool,account,input));return;
          }
          if(req.method==='POST' && accountRoute[2]==='chat-test'){
            if(queue.busy.has(account.id))throw new Error('账号正在执行任务，稍后再试');
            if(account.platform!=='doubao')throw new Error('聊天测试目前只支持豆包账号');
            const input=await body(req);
            const message=String(input.message||'').trim();
            if(!message||message.length>2000)throw new Error('测试消息为空或超过 2000 字');
            const selected=Array.isArray(input.skills)?input.skills.map(String):['intent','chat'];
            send(res,200,await runChatTest(account,message,selected));return;
          }
          if(req.method==='GET' && accountRoute[2]==='inspect'){send(res,200,await pool.inspect(account,{probe:url.searchParams.get('probe')||''}));return;}
          if(req.method==='POST' && accountRoute[2]==='open'){send(res,200,await pool.open(account));return;}
          if(req.method==='POST' && accountRoute[2]==='close'){
            if(queue.busy.has(account.id))throw new Error('账号正在执行任务，请先取消任务');
            chatTests.delete(account.id);
            await pool.closeAccount(account.id);send(res,200,{ok:true});return;
          }
        }
        if(req.method==='POST' && pathname==='/api/import') {
          const input=await body(req);
          const parsed=typeof input.text==='string'?parseDolaTextCookieImport(input.text):parseJsonAccountImport(input.backup);
          const imported=[],failures=[];
          for(const source of parsed.sourceAccounts) {
            if(!['doubao','dola','gemini'].includes(source.platform)){failures.push({name:source.name||'',error:'平台不支持'});continue;}
            const a=store.add(source);
            try {
              const state=parsed.sessionData[source.id];
              if(state) await pool.importAccount(a,{cookies:state.cookies || [],origins:state.origins || (Array.isArray(state.localStorage)?state.localStorage:[])});
              imported.push(a);
            }catch(error){store.remove(a.id);failures.push({name:source.name||'',error:error.message});}
          }
          queue.kick();send(res,200,{imported,failures});return;
        }
        if(req.method==='POST' && pathname==='/api/export') {
          const accounts=store.list(),sessions={};
          for(const a of accounts) sessions[a.id]=await pool.exportAccount(a);
          send(res,200,{format:'doubao-manager-backup',version:2,accounts,sessions},{'Content-Disposition':'attachment; filename="accounts-backup.json"'});return;
        }
        if(req.method==='POST' && pathname==='/api/references') {
          const input=await body(req);const name=safeSegment(input.name);
          if(!/\.(png|jpe?g|webp|gif|bmp)$/i.test(name))throw new Error('不支持的参考图格式');
          if(typeof input.base64!=='string')throw new Error('缺少图片内容');
          const buffer=Buffer.from(input.base64,'base64');if(!buffer.length || buffer.length>14*1024*1024)throw new Error('图片为空或超过14MB');
          const dir=path.join(directory,'references');fs.mkdirSync(dir,{recursive:true});
          const file=path.join(dir,crypto.randomUUID()+path.extname(name).toLowerCase());fs.writeFileSync(file,buffer,{flag:'wx'});
          send(res,201,{path:file,name});return;
        }
        if(req.method==='POST' && pathname==='/api/extract/scan'){
          const input=await body(req);
          const controller=new AbortController();
          req.on('close',()=>controller.abort());
          send(res,200,await extractor.scan({url:input.url,accountId:input.accountId,signal:controller.signal}));return;
        }
        if(req.method==='POST' && pathname==='/api/extract/download'){
          const input=await body(req);
          send(res,200,await extractor.download({sessionId:input.sessionId,key:input.key,name:input.name}));return;
        }
        if(req.method==='GET' && pathname==='/api/extract/stream'){
          const target=await extractor.streamTarget({sessionId:url.searchParams.get('sessionId')||'',key:url.searchParams.get('key')||''});
          await pipeRemote(req,res,target);return;
        }
        if(req.method==='GET' && pathname==='/api/extract/accounts'){
          send(res,200,{accounts:store.list().filter(a=>a.platform==='doubao').map(a=>({id:a.id,name:a.name,group:a.group||'',enabled:a.enabled!==false})),downloads:currentDownloads()});return;
        }
        if(req.method==='GET' && pathname==='/api/extract/history'){
          send(res,200,{records:extractHistory.list()});return;
        }
        const historyRoute=pathname.match(/^\/api\/extract\/history\/([0-9a-f-]{36})$/i);
        if(historyRoute && req.method==='GET'){
          const record=extractHistory.get(historyRoute[1]);
          if(!record){send(res,404,{error:'检测记录不存在'});return;}
          send(res,200,{record:{
            id:record.id,at:record.at,url:record.url,conversationURL:record.conversationURL,
            accountId:record.accountId,accountName:record.accountName,title:record.title||'',
            summary:record.summary||{},downloads:record.downloads||[],
            videos:(record.videos||[]).map(video=>({
              key:video.key,messageId:video.messageId,videoId:video.videoId||'',method:video.method,
              methodLabel:video.methodLabel,unwatermarked:Boolean(video.unwatermarked),downloadable:Boolean(video.downloadable),
              url:video.url||'',duration:video.duration??null,width:video.width??null,height:video.height??null,
              text:video.text||'',note:video.note||'',
            })),
          }});return;
        }
        if(historyRoute && req.method==='DELETE'){
          if(!extractHistory.remove(historyRoute[1])){send(res,404,{error:'检测记录不存在'});return;}
          send(res,200,{ok:true});return;
        }
        if(req.method==='POST' && pathname==='/api/extract/history/download'){
          const input=await body(req);
          send(res,200,await extractor.downloadFromHistory({recordId:input.recordId,key:input.key,name:input.name}));return;
        }
        if(req.method==='GET' && pathname==='/api/extract/history/stream'){
          const target=await extractor.streamFromHistory({recordId:url.searchParams.get('recordId')||'',key:url.searchParams.get('key')||''});
          await pipeRemote(req,res,target);return;
        }
        if(req.method==='POST' && pathname==='/api/extract/history/clear'){
          extractHistory.clear();send(res,200,{ok:true});return;
        }
        if(req.method==='GET' && pathname==='/api/downloads'){
          send(res,200,{directory:currentDownloads(),files:listDownloads(currentDownloads(),queue)});return;
        }
        if(req.method==='GET' && pathname==='/api/downloads/file'){
          const name=path.basename(String(url.searchParams.get('name')||''));
          const file=path.join(currentDownloads(),name);
          if(!name||!fs.existsSync(file)||!fs.statSync(file).isFile())throw new Error('下载文件不存在');
          res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':fs.statSync(file).size,
            'Content-Disposition':'attachment; filename="'+encodeURIComponent(name)+'"','Cache-Control':'no-store'});
          fs.createReadStream(file).pipe(res);return;
        }
        if(req.method==='POST' && pathname==='/api/reveal'){
          const input=await body(req);const taskId=String(input.taskId||'');const name=path.basename(String(input.name||''));
          let target=currentDownloads(),select=false;
          if(taskId){
            const t=queue.get(taskId);const file=t.result?.path;
            if(!file||!fs.existsSync(file))throw new Error('这条任务的本地文件已不存在');
            target=file;select=true;
          }else if(name){
            const file=path.join(currentDownloads(),name);
            if(!fs.existsSync(file))throw new Error('下载文件不存在');
            target=file;select=true;
          }
          const pid=await revealInExplorer(target,select);
          send(res,200,{ok:true,target,pid});return;
        }
        if(req.method==='POST' && pathname==='/api/tasks') {
          const input=await body(req);if(input.platform==='fixture' && !options.testBaseURL)throw new Error('测试平台未启用');
          send(res,201,queue.submit(input));return;
        }
        const taskRoute=pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})(?:\/(cancel|file|resume|diagnostics|play|open|stop))?$/i);
        if(taskRoute){
          const t=queue.get(taskRoute[1]);
          if(req.method==='GET'&&taskRoute[2]==='diagnostics'){send(res,200,await pool.diagnoseVideo(store.get(t.accountId),t.submittedPrompt||t.prompt,url=>settings.dispatcher(url)));return;}
          if(req.method==='GET' && !taskRoute[2]){
            const pub=queue.public(t);
            const remoteState=pub.status==='completed'?'done':pub.status==='failed'?'failed':pub.status==='cancelled'?'canceled':['queued','starting','running','uploading','submitting','generating','downloading','paused'].includes(pub.status)?'running':'unknown';
            send(res,200,{...pub,remoteState,cancelCapability:'local'});return;
          }
          if(req.method==='POST' && taskRoute[2]==='stop'){
            // 平台确认后额度已经消耗；聊天指令虽然能取消生成，但不退还额度，产品上不提供停止。
            send(res,501,{error:'平台确认生成后额度已消耗，取消不退还额度；管理器不提供停止功能',code:'CAPABILITY_UNSUPPORTED'});return;
          }
          if(req.method==='POST' && taskRoute[2]==='resume'){
            const input=await body(req);
            // 客户端模式下允许指定原账号（额度耗尽时队列会把任务改派，续查必须回原账号）。
            if((((settings.value.scheduler&&settings.value.scheduler.mode)||'web')==='client') && input.accountId){
              const original=store.get(String(input.accountId));
              if(!original)throw new Error('原执行账号不存在');
              t.accountId=original.id;t.executedAccountId=original.id;
              queue.persist();
            }
            if(!t.conversationURL&&input.conversationURL){
              if(!['failed','interrupted','cancelled'].includes(t.status))throw new Error('只有失败、中断或取消的任务可以恢复会话');
              // 客户端调度没有网页会话可开：只认会话 id，写进任务后由客户端执行器按 id 打开原会话取片。
              if(((settings.value.scheduler&&settings.value.scheduler.mode)||'web')==='client'){
                const raw=String(input.conversationURL||'').trim();
                const matched=/\/chat\/([^/?#]+)/.exec(raw);
                const conversationId=(matched?matched[1]:raw).replace(/\s+/g,'');
                if(!/^[A-Za-z0-9_-]{6,}$/.test(conversationId))throw new Error('会话 id 格式无效，例如 38449986875815426 或其完整地址');
                t.conversationURL='chrome://doubao-chat/chat/'+conversationId;
                t.conversationId=conversationId;
                queue.persist();
                send(res,200,queue.resume(t.id));return;
              }
              const account=store.get(t.accountId);if(!account)throw new Error('原执行账号不存在');
              if(queue.busy.has(account.id))throw new Error('账号正在执行任务');
              const page=await pool.taskPage(account,String(input.conversationURL));
              await page.locator(account.selectors?.editor||'[contenteditable=true]').first().waitFor({timeout:30000});
              const found=await page.evaluate(readPageState,{selectors:account.selectors||{},prompt:t.submittedPrompt||t.prompt});
              if(!found.userKey)throw new Error('会话中没有匹配本任务的提示词，未继续生成');
              t.conversationURL=page.url().split('?')[0];queue.persist();
            }
            send(res,200,queue.resume(t.id));return;
          }
          if(req.method==='POST' && taskRoute[2]==='cancel'){send(res,200,queue.cancel(t.id));return;}
          if(req.method==='POST' && taskRoute[2]==='open'){
            if(t.status!=='completed')throw new Error('任务尚未完成，暂时没有成片可打开');
            const file=t.result?.path;if(!file || !fs.existsSync(file))throw new Error('本地文件已不存在');
            const pid=await openWithDefaultApp(file);
            send(res,200,{ok:true,file,pid});return;
          }
          if(req.method==='GET' && taskRoute[2]==='play' && t.status==='completed'){serveVideo(req,res,t,true);return;}
          if(req.method==='GET' && taskRoute[2]==='file' && t.status==='completed'){serveVideo(req,res,t,false);return;}
        }
        if(req.method==='POST' && pathname==='/api/window/open'){await service.openDashboard();send(res,200,{ok:true});return;}
        if(req.method==='POST' && pathname==='/api/shutdown'){
          send(res,200,{ok:true});setImmediate(()=>service.close().catch(error=>console.error('退出失败：'+error.message)));return;
        }
        send(res,404,{error:'接口不存在'});return;
      }
      if(req.method!=='GET'){send(res,405,{error:'不支持的方法'});return;}
      const files={'/':'tasks.html','/tasks':'tasks.html','/accounts':'accounts.html','/monitor':'monitor.html','/extract':'extract.html','/extract.js':'extract.js','/api':'api.html','/settings':'settings.html','/interpreter':'interpreter.html','/app.js':'app.js','/interpreter.js':'interpreter.js','/monitor.js':'monitor.js','/theme-boot.js':'theme-boot.js','/styles.css':'styles.css'};
      if(!files[pathname]){send(res,404,{error:'页面不存在'});return;}
      const file=path.join(webRoot,files[pathname]);
      const content=fs.readFileSync(file);const type=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript';
      res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        ...(file.endsWith('.html')?{'Set-Cookie':'dbm_session='+token+'; HttpOnly; SameSite=Strict; Path=/'}:{})});res.end(content);
    }catch(error){if(!res.headersSent)send(res,400,{error:String(error.message || error)});else res.destroy(error);}
  });
  server.requestTimeout=180000; // 视频提取要开对话页、滚历史、逐个解析直链，60 秒不够用。
  server.on('clientError',(_,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const baseURL='http://127.0.0.1:'+server.address().port;
  saveJSON(connectionFile,{baseURL,apiToken:token});
  // 外联：共享部署时管理器主动连创作台，服务器不需要能访问这台机器。
  outbound=new Outbound({settings,baseURL,token,log:(message)=>{try{console.log(message);}catch{/* 日志失败不影响任务 */}}});outbound.start();
  const wake=setInterval(()=>queue.kick(),5000);wake.unref();
  const service={server,queue,store,pool,extractor,token,baseURL,connectionFile,directory,closed,
    async openDashboard(){
      if(shuttingDown)throw new Error('应用正在退出');
      if(dashboardPage && !dashboardPage.isClosed()){await dashboardPage.bringToFront();return dashboardPage;}
      if(dashboardOpening)return dashboardOpening;
      dashboardOpening=(async()=>{
        const context=await chromium.launchPersistentContext(path.join(directory,'dashboard'),{
          executablePath:findChrome(),headless:options.dashboardHeadless===true,viewport:null,args:['--app='+baseURL]});
        dashboard=context;
        if(shuttingDown){await context.close();throw new Error('应用正在退出');}
        const pages=context.pages();const p=pages.find(p=>p.url().startsWith(baseURL)) || pages[0] || await context.newPage();
        dashboardPage=p;
        const exit=()=>{if(!shuttingDown)void service.close().catch(error=>console.error('退出失败：'+error.message));};
        p.once('close',exit);context.once('close',exit);
        for(const other of context.pages())if(other!==p)await other.close();
        if(!p.url().startsWith(baseURL))await p.goto(baseURL);
        await p.bringToFront();return p;
      })();
      try{return await dashboardOpening;}finally{dashboardOpening=null;}
    },
    close(){
      if(closePromise)return closePromise;
      shuttingDown=true;clearInterval(wake);
      closePromise=(async()=>{
        const errors=[];
        try{await queue.shutdown();}catch(error){errors.push(error);}
        try{await settings.close();}catch(error){errors.push(error);}
        try{await pool.close();}catch(error){errors.push(error);}
        try{extractor.close();}catch(error){errors.push(error);}
        if(dashboardOpening)await dashboardOpening.catch(()=>{});
        try{await dashboard?.close();}catch(error){errors.push(error);}
        await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections?.();});
        dashboardPage=null;dashboard=null;
        resolveClosed({ok:errors.length===0});
        if(errors.length)throw new AggregateError(errors,'部分应用资源未能正常关闭');
      })();
      return closePromise;
    }
  };
  return service;
}
// 本地服务没有控制台窗口，未捕获的异常不能把进程带走：记日志、继续提供服务。
process.on('unhandledRejection',(error)=>console.error('未处理的异步异常（服务继续运行）：'+String(error&&error.stack||error)));
process.on('uncaughtException',(error)=>console.error('未捕获的异常（服务继续运行）：'+String(error&&error.stack||error)));
if(require.main===module)createService().then(async service=>{
  console.log('本地管理器已启动：'+service.baseURL);console.log('数据目录：'+service.directory);
  service.closed.then(result=>{if(!result.ok)console.error('退出时有资源未能正常关闭（不影响数据）');process.exit(result.ok?0:1);});
  if(process.argv.includes('--open'))await service.openDashboard();
  let closing=false;const stop=async()=>{if(closing)return;closing=true;await service.close();process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}).catch(error=>{console.error('启动失败：'+error.message);process.exitCode=1;});
module.exports={createService,secureEqual};
