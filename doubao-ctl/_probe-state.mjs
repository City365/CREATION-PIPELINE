const PORT = 9333;
const targets = async () => (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json());
class Cdp { constructor(u){this.u=u;this.i=0;this.p=new Map();this.closed=false;} open(){return new Promise((res,rej)=>{this.ws=new WebSocket(this.u);this.ws.onopen=()=>res();this.ws.onerror=()=>rej(new Error('ws'));this.ws.onclose=()=>{this.closed=true;for(const p of this.p.values())p.reject(new Error('closed'));this.p.clear();};this.ws.onmessage=(e)=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.id&&this.p.has(m.id)){const p=this.p.get(m.id);this.p.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}})} send(method,params={}){const id=++this.i;return new Promise((res,rej)=>{const t=setTimeout(()=>{this.p.delete(id);rej(new Error('timeout ' + method))},8000);this.p.set(id,{resolve:(v)=>{clearTimeout(t);res(v)},reject:(e)=>{clearTimeout(t);rej(e)}});this.ws.send(JSON.stringify({id,method,params}))})} async ev(src){const r=await this.send('Runtime.evaluate',{expression:src,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error('eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));return r.result.value} }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const attach = async () => {
  const ts = await targets();
  const main = ts.find(t => t.url && t.url.indexOf('doubao-chat/chat') >= 0 && t.url.indexOf('background') < 0);
  if (!main) throw new Error('no chat target: ' + ts.map(t => t.url).join(','));
  const c = new Cdp(main.webSocketDebuggerUrl); await c.open(); await c.send('Runtime.enable');
  return { c, target: main };
};
let { c, target } = await attach();
const isMenuOpen = () => c.ev('(() => !!document.querySelector("[data-testid=chat_header_menu]"))()');
const menuText = () => c.ev([
  '(() => {',
  '  const wrap = document.querySelector("[data-radix-popper-content-wrapper]");',
  '  const menu = document.querySelector("[data-testid=chat_header_menu]");',
  '  const footer = document.querySelector("[data-testid=sidebar_footer_setting_entry]");',
  '  return {',
  '    wrapHead: wrap ? (wrap.innerText || "").split(String.fromCharCode(10)).slice(0, 3) : null,',
  '    menuRows: menu ? [...menu.querySelectorAll("[data-testid=avatar_menu_account_row]")].map(r => (r.innerText || "").split(String.fromCharCode(10)).filter(Boolean).join(" | ")) : null,',
  '    footerText: footer ? (footer.innerText || "").slice(0, 80) : null,',
  '    footerHtml: footer ? footer.outerHTML.slice(0, 300) : null,',
  '  };',
  '})()',
].join('\n'));
console.log('open?', await isMenuOpen());
console.log(JSON.stringify(await menuText(), null, 1));
c.ws.close();
