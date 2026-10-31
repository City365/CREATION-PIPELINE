const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const main = list.find(t => t.url.includes('doubao-chat/chat'));
class Cdp { constructor(u){this.u=u;this.i=0;this.p=new Map();} open(){return new Promise((res,rej)=>{this.ws=new WebSocket(this.u);this.ws.onopen=()=>res();this.ws.onerror=()=>rej(new Error('ws'));this.ws.onmessage=(e)=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.id&&this.p.has(m.id)){const p=this.p.get(m.id);this.p.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}})} send(method,params={}){const id=++this.i;return new Promise((res,rej)=>{this.p.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method,params}))})} async ev(src){const r=await this.send('Runtime.evaluate',{expression:src,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value} }
const c = new Cdp(main.webSocketDebuggerUrl); await c.open(); await c.send('Runtime.enable');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const rectOf = (sel) => ['(() => { const el = document.querySelector(' + JSON.stringify(sel) + '); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()'][0];
const avatar = await c.ev(rectOf('[data-testid="chat_header_avatar_button"]'));
console.log('avatar rect', JSON.stringify(avatar));
if (avatar) {
  for (const type of ['mouseMoved','mousePressed','mouseReleased']) {
    await c.send('Input.dispatchMouseEvent', Object.assign({ type, button: 'left', clickCount: 1 }, avatar));
    await sleep(60);
  }
}
await sleep(900);
const dump = await c.ev([
  '(() => {',
  '  const visible = [...document.querySelectorAll(\'[role="menu"],[data-radix-popper-content-wrapper],[class*="dropdown"],[data-slot="dropdown-menu-content"],[data-state="open"]\')];',
  '  const items = [...document.querySelectorAll(\'[role="menuitem"],[data-radix-collection-item],[class*="menu-item"],[data-testid*="account"],[data-testid*="avatar"]\')]',
  '    .filter(e => e.getClientRects().length)',
  '    .map(e => ({ tag: e.tagName, testid: e.getAttribute("data-testid"), role: e.getAttribute("role"), text: (e.innerText||"").replace(/\\n+/g," | ").slice(0, 120), cls: String(e.className).slice(0,60) }));',
  '  const layers = visible.filter(e => e.getClientRects().length).map(e => ({ tag: e.tagName, testid: e.getAttribute("data-testid"), cls: String(e.className).slice(0,80), text: (e.innerText||"").slice(0, 200) }));',
  '  return { items, layers, bodyTail: document.body.innerText.slice(-600) };',
  '})()',
].join(String.fromCharCode(10)));
console.log(JSON.stringify(dump, null, 1).slice(0, 5000));
c.ws.close();
