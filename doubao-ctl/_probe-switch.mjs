const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const main = list.find(t => t.url.includes('doubao-chat/chat'));
class Cdp { constructor(u){this.u=u;this.i=0;this.p=new Map();} open(){return new Promise((res,rej)=>{this.ws=new WebSocket(this.u);this.ws.onopen=()=>res();this.ws.onerror=()=>rej(new Error('ws'));this.ws.onmessage=(e)=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.id&&this.p.has(m.id)){const p=this.p.get(m.id);this.p.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}})} send(method,params={}){const id=++this.i;return new Promise((res,rej)=>{this.p.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method,params}))})} async ev(src){const r=await this.send('Runtime.evaluate',{expression:src,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval error');return r.result.value} }
const c = new Cdp(main.webSocketDebuggerUrl); await c.open(); await c.send('Runtime.enable');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const clickSel = async (sel, index) => {
  const rect = await c.ev('(() => { const els = [...document.querySelectorAll(' + JSON.stringify(sel) + ')]; const el = els[' + (index || 0) + ']; if (!el) return null; el.scrollIntoView({block:"center"}); const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()');
  if (!rect) throw new Error('not found: ' + sel);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await c.send('Input.dispatchMouseEvent', Object.assign({ type, button: 'left', clickCount: 1 }, rect));
    await sleep(50);
  }
  return rect;
};
const probeState = async () => c.ev([
  '(() => {',
  '  const menu = document.querySelector("[data-testid=chat_header_menu]");',
  '  const header = menu ? menu.querySelector("button") : null;',
  '  const rows = menu ? [...menu.querySelectorAll("[data-testid=avatar_menu_account_row]")].map(r => (r.innerText || "").split(String.fromCharCode(10)).filter(Boolean).join(" | ")) : [];',
  '  const convs = [...document.querySelectorAll("[data-testid=conversation-list-v2-item]")].length;',
  '  const ed = document.querySelector("div.ProseMirror[contenteditable=true]");',
  '  const quota = menu ? ((menu.innerText || "").split(String.fromCharCode(10)).find(t => t.indexOf("额度") >= 0) || "") : "";',
  '  return { menuOpen: !!menu, header: header ? (header.innerText || "").split(String.fromCharCode(10)).filter(Boolean).join(" | ") : null, rows, convs, hasEditor: !!ed, quota };',
  '})()',
].join('\n'));

const esc = async () => { await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); };
await esc(); await sleep(300);
await clickSel('[data-testid="chat_header_avatar_button"]'); await sleep(600);
console.log('menu state:', JSON.stringify(await probeState()));
await clickSel('[data-testid="avatar_menu_account_row"]', 1);
await sleep(1500);
console.log('after click row1 +1.5s:', JSON.stringify(await probeState()));
await sleep(3000);
console.log('after +4.5s:', JSON.stringify(await probeState()));
await clickSel('[data-testid="chat_header_avatar_button"]'); await sleep(600);
console.log('menu reopened:', JSON.stringify(await probeState()));
await esc();
c.ws.close();
