'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');
const { Store, readJSON, saveJSON, safeSegment } = require('./store');
const { TaskQueue } = require('./tasks');
const {Settings}=require('./settings');
const { BrowserPool, findChrome } = require('./browser-pool');
const {readPageState}=require('./adapters/page-state');
const { createExecutor,applyOptions,selectorsFor } = require('./automation');
const { createGeminiExecutor } = require('./automation-gemini');
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
  const defaultDownloads=path.join(directory,'downloads');fs.mkdirSync(defaultDownloads,{recursive:true});
  // 下载目录可由用户在系统管理里改；每次使用都重新解析并确保存在。
  const currentDownloads=()=>{const dir=settings.downloadsDirectory();fs.mkdirSync(dir,{recursive:true});return dir;};
  const pool=options.pool || new BrowserPool({store,chromePath:process.env.DBM_CHROME_PATH,testBaseURL:options.testBaseURL,getProxy:()=>settings.browserProxy()});
  const ffprobe=options.ffprobe || findFFprobe();
  const getDispatcher=url=>settings.dispatcher(url);
  const doubaoExecutor=createExecutor({pool,store,downloads:currentDownloads,ffprobe,fixture:Boolean(options.testBaseURL),getDispatcher});
  const geminiExecutor=createGeminiExecutor({pool,store,downloads:currentDownloads,ffprobe,getDispatcher});
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
    try { return await defaultExecute(task,account,signal,update); }
    finally { try { await pool.closeAccount(account.id); } catch { /* 窗口可能已被用户手动关闭 */ } }
  });
  const concurrency=Math.max(1,Math.min(10,Number(process.env.DBM_CONCURRENCY)||3));
  const queue=new TaskQueue({directory,store,execute,concurrency});
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
        if(req.method==='GET' && pathname==='/api/settings'){send(res,200,settings.public());return;}
        if(req.method==='PUT' && pathname==='/api/settings'){
          const value=settings.validate(await body(req));
          const proxyChanged=settings.proxyChanged(value);
          if(proxyChanged && queue.running.size)throw new Error('请等待正在执行的任务完成后再修改代理');
          // 只有代理变化才需要重开账号浏览器；改下载目录直接生效。
          if(proxyChanged){
            queue.stopping=true;
            try{
              for(const account of store.list())await pool.closeAccount(account.id);
              send(res,200,await settings.save(value));
            }finally{if(!shuttingDown){queue.stopping=false;queue.kick();}}
            return;
          }
          send(res,200,await settings.save(value));return;
        }
        if(req.method==='GET' && pathname==='/api/state') {
          send(res,200,{accounts:store.list(),tasks:queue.list(),busyAccounts:[...queue.busy],directory,downloads:currentDownloads(),connectionFile,version:'0.1.0'});return;
        }
        if(req.method==='POST' && pathname==='/api/accounts'){
          const input=await body(req);if(input.platform==='fixture' && !options.testBaseURL)throw new Error('测试平台未启用');
          send(res,201,store.add(input));queue.kick();return;
        }
        const accountRoute=pathname.match(/^\/api\/accounts\/([0-9a-f-]{36})(?:\/(open|close|inspect|prepare-video|reference-draft))?$/i);
        if(accountRoute){
          const account=store.get(accountRoute[1]);if(!account){send(res,404,{error:'账号不存在'});return;}
          if(req.method==='PATCH' && !accountRoute[2]){send(res,200,store.update(account.id,await body(req)));queue.kick();return;}
          if(req.method==='DELETE' && !accountRoute[2]){
            if(queue.busy.has(account.id))throw new Error('账号正在执行任务，请先取消任务');
            await pool.closeAccount(account.id);send(res,200,store.remove(account.id));return;
          }
          if(req.method==='POST' && accountRoute[2]==='prepare-video'){if(queue.busy.has(account.id))throw new Error('账号正在执行任务');await pool.open(account);const context=await pool.context(account);const page=context.pages().filter(p=>!p.isClosed()&&p.url().startsWith(pool.url(account).split('/chat')[0])).at(-1);const input=await body(req);if(input.prompt)await page.locator(account.selectors?.editor||'[contenteditable=true]').fill(String(input.prompt));send(res,200,await applyOptions(page,{...input,platform:account.platform},selectorsFor(account.platform,account),new AbortController().signal));return;}
          if(req.method==='POST' && accountRoute[2]==='reference-draft'){
            if(queue.busy.has(account.id))throw new Error('账号正在执行任务');
            const input=await body(req);
            const {prepareReferenceDraft}=require('./reference-draft');
            send(res,200,await prepareReferenceDraft(pool,account,input));return;
          }
          if(req.method==='GET' && accountRoute[2]==='inspect'){send(res,200,await pool.inspect(account));return;}
          if(req.method==='POST' && accountRoute[2]==='open'){send(res,200,await pool.open(account));return;}
          if(req.method==='POST' && accountRoute[2]==='close'){
            if(queue.busy.has(account.id))throw new Error('账号正在执行任务，请先取消任务');
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
            if(!t.conversationURL&&input.conversationURL){
              if(!['failed','interrupted'].includes(t.status))throw new Error('只有失败或中断任务可以恢复会话');
              const account=store.get(t.accountId);if(!account)throw new Error('原执行账号不存在');
              if(queue.busy.has(account.id))throw new Error('账号正在执行任务');
              const page=await pool.taskPage(account,String(input.conversationURL));
              await page.locator(account.selectors?.editor||'[contenteditable=true]').first().waitFor({timeout:30000});
              const found=await page.evaluate(readPageState,{selectors:account.selectors||{},prompt:t.submittedPrompt||t.prompt});
              if(!found.userKey||found.otherUser)throw new Error('会话中没有匹配本任务的提示词，未继续生成');
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
      const files={'/':'tasks.html','/tasks':'tasks.html','/accounts':'accounts.html','/api':'api.html','/settings':'settings.html','/app.js':'app.js','/theme-boot.js':'theme-boot.js','/styles.css':'styles.css'};
      if(!files[pathname]){send(res,404,{error:'页面不存在'});return;}
      const file=path.join(webRoot,files[pathname]);
      const content=fs.readFileSync(file);const type=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript';
      res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        ...(file.endsWith('.html')?{'Set-Cookie':'dbm_session='+token+'; HttpOnly; SameSite=Strict; Path=/'}:{})});res.end(content);
    }catch(error){if(!res.headersSent)send(res,400,{error:String(error.message || error)});else res.destroy(error);}
  });
  server.requestTimeout=60000;
  server.on('clientError',(_,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const baseURL='http://127.0.0.1:'+server.address().port;
  saveJSON(connectionFile,{baseURL,apiToken:token});
  const wake=setInterval(()=>queue.kick(),5000);wake.unref();
  const service={server,queue,store,pool,token,baseURL,connectionFile,directory,closed,
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
if(require.main===module)createService().then(async service=>{
  console.log('本地管理器已启动：'+service.baseURL);console.log('数据目录：'+service.directory);
  service.closed.then(result=>{if(!result.ok)console.error('退出时有资源未能正常关闭（不影响数据）');process.exit(result.ok?0:1);});
  if(process.argv.includes('--open'))await service.openDashboard();
  let closing=false;const stop=async()=>{if(closing)return;closing=true;await service.close();process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}).catch(error=>{console.error('启动失败：'+error.message);process.exitCode=1;});
module.exports={createService,secureEqual};
