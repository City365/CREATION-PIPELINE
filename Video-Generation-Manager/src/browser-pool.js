'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const {attachFallbackCapture,resolveFallbackVideo}=require('./adapters/doubao-fallback');
function findChrome() {
  const candidates = [process.env.DBM_CHROME_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'],'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe'];
  const found = candidates.find(p => p && fs.existsSync(p));
  if (!found) throw new Error('找不到Google Chrome，请设置DBM_CHROME_PATH指向chrome.exe');
  return found;
}
const PLATFORM_URLS = { doubao: 'https://www.doubao.com/chat/', dola: 'https://www.dola.com/chat/', gemini: 'https://gemini.google.com/app' };
const PLATFORM_DOMAINS = { doubao: 'doubao.com', dola: 'dola.com', gemini: 'google.com' };
const RESUME_PATHS = { doubao: /^\/chat\/[\w-]+$/, dola: /^\/chat\/[\w-]+$/, gemini: /^\/app\/[\w-]+$/ };
class BrowserPool {
  constructor({ store, chromePath, testBaseURL = '', getProxy=()=>undefined }) {
    this.getProxy=getProxy; this.store = store; this.chromePath = chromePath || findChrome(); this.testBaseURL = testBaseURL;
    this.contexts = new Map(); this.opening = new Map(); this.closing=false; this.closePromise=null;
  }
  url(account) {
    if (account.platform === 'fixture' && this.testBaseURL) return this.testBaseURL;
    const url = PLATFORM_URLS[account.platform]; if (!url) throw new Error('平台没有浏览器地址'); return url;
  }
  async context(account) {
    if(this.closing)throw new Error('应用正在退出');
    if (this.contexts.has(account.id)) return this.contexts.get(account.id);
    if (this.opening.has(account.id)) return this.opening.get(account.id);
    const pending = (async () => {
      const c = await chromium.launchPersistentContext(this.store.profile(account.id), {
        ...(this.chromePath ? { executablePath: this.chromePath } : { channel: 'chrome' }),
        headless: false, viewport: null, acceptDownloads: true, proxy:this.getProxy(),
        args: ['--window-size=1200,750', ...(process.env.DBM_REBUILD_INSPECT==='1'?['--remote-debugging-port=0']:[]), ...(account.platform==='gemini'?['--disable-blink-features=AutomationControlled']:[])],
        // Google 登录会拒绝带 --enable-automation 的浏览器，Gemini 账号去掉这个默认参数。
        ...(account.platform==='gemini'?{ignoreDefaultArgs:['--enable-automation']}:{}),
        timeout: 45000,
      });
      if(account.platform==='gemini')await c.addInitScript(()=>{try{Object.defineProperty(navigator,'webdriver',{get:()=>false,configurable:true});}catch{}});
      if(this.closing){await c.close();throw new Error('应用正在退出');}
      // Size only new account windows; later reuse preserves the user's adjustments.
      const initialPage=c.pages()[0] || await c.newPage();
      const screen=await initialPage.evaluate(()=>({width:window.screen.availWidth,height:window.screen.availHeight,left:window.screen.availLeft||0,top:window.screen.availTop||0}));
      const session=await c.newCDPSession(initialPage);
      try{
        const {windowId}=await session.send('Browser.getWindowForTarget');
        await session.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
        await session.send('Browser.setWindowBounds',{windowId,bounds:{width:Math.round(screen.width*.7),height:Math.round(screen.height*.9),left:screen.left+24,top:screen.top+24}});
      }finally{await session.detach();}
      c.setDefaultTimeout(15000); c.setDefaultNavigationTimeout(45000);
      c.on('close', () => this.contexts.delete(account.id));
      this.contexts.set(account.id, c); return c;
    })();
    this.opening.set(account.id, pending);
    try { return await pending; } finally { this.opening.delete(account.id); }
  }
  async open(account) {
    const c = await this.context(account);
    let page = c.pages().find(p => !p.isClosed() && p.url().startsWith(this.url(account).split('/chat')[0]));
    if (!page) page = c.pages()[0] || await c.newPage();
    if (page.url() === 'about:blank') await page.goto(this.url(account), { waitUntil: 'domcontentloaded' });
    await page.bringToFront(); return { ok: true, accountId: account.id };
  }
  async taskPage(account, resumeURL) {
    const c = await this.context(account); const page = await c.newPage();
    if(account.platform==='doubao')attachFallbackCapture(page);
    let target=this.url(account);
    if(resumeURL){const u=new URL(resumeURL),expected=new URL(target);if(u.origin!==expected.origin || !(RESUME_PATHS[account.platform]||RESUME_PATHS.doubao).test(u.pathname))throw new Error('续查会话地址无效');target=u.href;}
    await page.goto(target, { waitUntil: 'domcontentloaded' }); return page;
  }
  async inspect(account) {
    const c=await this.context(account);const p=c.pages().filter(p=>!p.isClosed()&&p.url()!=='about:blank').at(-1);
    if(!p)throw new Error('账号窗口尚未打开');
    await p.screenshot({path:path.join(this.store.directory,'account-inspect.png')});
    const state=await p.evaluate(require('./adapters/attachment-state').readAttachmentState);
    const info=await p.evaluate(()=>({url:location.origin+location.pathname,videoControls:[...document.querySelectorAll('[data-input-engine-actionbar-control-key],[data-input-engine-actionbar-render-entry-key],[role=slider]')].map(e=>({tag:e.tagName,key:e.getAttribute('data-input-engine-actionbar-control-key'),entry:e.getAttribute('data-input-engine-actionbar-render-entry-key'),text:(e.innerText||'').slice(0,300),visible:!!(e.getBoundingClientRect().width&&e.getBoundingClientRect().height)})),tailText:document.body.innerText.slice(-4500),
      controls:[...document.querySelectorAll('textarea,input:not([type=password]),button,[role=button],[contenteditable=true]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;}).slice(0,100).map(e=>({tag:e.tagName,id:e.id,class:String(e.className||''),testid:e.getAttribute('data-testid'),role:e.getAttribute('role'),placeholder:e.getAttribute('placeholder'),label:e.getAttribute('aria-label'),data:{...e.dataset},text:e.matches('button,[role=button]')?(e.innerText||'').slice(0,80):''})),
      messageNodes:[...document.querySelectorAll('[data-message-id],[data-testid*=message],[data-role],[class*=message-container]')].slice(-30).map(e=>({tag:e.tagName,class:String(e.className||''),testid:e.getAttribute('data-testid'),role:e.getAttribute('data-role'),messageId:e.getAttribute('data-message-id')}))}));
    return {...info,attachments:state};
  }
  async diagnoseVideo(account,prompt,getDispatcher){
    const {readPageState}=require('./adapters/page-state');const c=await this.context(account);const p=c.pages().filter(p=>!p.isClosed()&&p.url().includes('/chat/')).at(-1);if(!p)throw new Error('请先打开任务会话');
    attachFallbackCapture(p);
    const anchorKey=await p.evaluate(()=>window.__LOCAL_MANAGER_ANCHOR__?.key||'');const state=await p.evaluate(readPageState,{selectors:account.selectors||{},prompt,anchorKey});
    await p.evaluate(fs.readFileSync(path.join(__dirname,'adapters','doubao-official-resolver.js'),'utf8'));
    const ids=state.replies.map(r=>r.id).filter(id=>/^\d{8,}$/.test(id));
    const fallback=await resolveFallbackVideo({page:p,messageIds:ids,getDispatcher});
    const resolved=await p.evaluate(async ids=>{const api=window.__LOCAL_DOUBAO_RESOLVER__;const nodes=await api.nodesForMessages(ids);const infos=[];for(const id of nodes){try{infos.push({nodeId:id,ok:true,...await api.downloadInfo(id)});}catch(e){infos.push({nodeId:id,ok:false,error:e.message});}}return {messageIds:ids,nodes,infos,debug:api.debug(),cards:api.inspectMessages(ids)};},ids);
    return {url:p.url(),userKey:state.userKey,replies:state.replies.map(r=>({id:r.id,text:r.text.slice(-300)})),media:state.media,complete:state.complete,fallback:{url:fallback.url,matchedApis:fallback.matchedApis,diagnostics:fallback.diagnostics},...resolved};
  }
  async closeAccount(id) {
    const pending = this.opening.get(id); if (pending) await pending.catch(() => {});
    const c = this.contexts.get(id);
    if (c) await c.close().catch(error => { if(!/has been closed|Target (?:page, context or browser )?closed|Browser closed/i.test(String(error?.message||error))) throw error; });
  }
  async exportAccount(account) {
    const c = await this.context(account); return c.storageState();
  }
  async importAccount(account, state) {
    const c = await this.context(account);
    if (Array.isArray(state.cookies)) {
      const cookies = state.cookies.map(k => {
        const domain = String(k.domain || '');
        const expected = PLATFORM_DOMAINS[account.platform];
        if (!domain.replace(/^\./,'').endsWith(expected) || !new RegExp('(^|\\.)' + expected.replace(/\./g,'\\.') + '$').test(domain.replace(/^\./,''))) throw new Error('Cookie域名与账号平台不匹配');
        const same = { no_restriction: 'None', lax: 'Lax', strict: 'Strict', None: 'None', Lax: 'Lax', Strict: 'Strict' }[k.sameSite];
        return { name: String(k.name), value: String(k.value), domain, path: k.path || '/', secure: Boolean(k.secure), httpOnly: Boolean(k.httpOnly),
          ...(Number(k.expires ?? k.expirationDate) > 0 ? { expires: Number(k.expires ?? k.expirationDate) } : {}), ...(same ? { sameSite: same } : {}) };
      });
      await c.addCookies(cookies);
    }
    const origins = state.origins || [];
    for (const item of origins) {
      const u = new URL(item.origin), allowed = new URL(this.url(account));
      if (u.protocol !== 'https:' || !(u.hostname === allowed.hostname || u.hostname.endsWith('.'+allowed.hostname.replace(/^www\./,'')))) throw new Error('localStorage来源与平台不匹配');
      const p = await c.newPage();
      try {
        await p.goto(u.origin, { waitUntil:'domcontentloaded' });
        await p.evaluate(items => { for (const i of items) localStorage.setItem(String(i.name), String(i.value)); }, item.localStorage || []);
      } finally { await p.close(); }
    }
    return { ok: true };
  }
  close() {
    if(this.closePromise)return this.closePromise;
    this.closing=true;
    this.closePromise=(async()=>{
      await Promise.allSettled([...this.opening.values()]);
      const results=await Promise.allSettled([...this.contexts.values()].map(c=>c.close()));
      // 用户手动关掉窗口时上下文已经没了，"has been closed" 不算失败。
      const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason)
        .filter(error=>!/has been closed|Target (?:page, context or browser )?closed|Browser closed/i.test(String(error?.message||error)));
      this.contexts.clear();
      if(errors.length)throw new AggregateError(errors,'账号浏览器未能全部关闭');
    })();
    return this.closePromise;
  }
}
module.exports = { BrowserPool, PLATFORM_URLS, PLATFORM_DOMAINS, findChrome };
