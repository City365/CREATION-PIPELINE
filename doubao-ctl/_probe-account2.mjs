const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const main = list.find(t => t.url.includes('doubao-chat/chat'));
class Cdp { constructor(u){this.u=u;this.i=0;this.p=new Map();} open(){return new Promise((res,rej)=>{this.ws=new WebSocket(this.u);this.ws.onopen=()=>res();this.ws.onerror=()=>rej(new Error('ws'));this.ws.onmessage=(e)=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.id&&this.p.has(m.id)){const p=this.p.get(m.id);this.p.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}})} send(method,params={}){const id=++this.i;return new Promise((res,rej)=>{this.p.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method,params}))})} async ev(src){const r=await this.send('Runtime.evaluate',{expression:src,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text);return r.result.value} }
const c = new Cdp(main.webSocketDebuggerUrl); await c.open(); await c.send('Runtime.enable');
const src = [
  '(() => {',
  '  const menu = document.querySelector(String.fromCharCode(91) + "data-testid=\\"chat_header_menu\\"]");',
  '  return { hasMenu: !!menu };',
  '})()',
].join('\n');
const rows = await c.ev([
  '(() => {',
  '  const menu = document.querySelector("[data-testid=chat_header_menu]");',
  '  if (!menu) return { open: false };',
  '  const rs = [...menu.querySelectorAll("[data-testid=avatar_menu_account_row]")];',
  '  return { open: true, rows: rs.map((r, i) => ({ i, text: (r.innerText || "").split(String.fromCharCode(10)).filter(Boolean).join(" | "), attrs: [...r.attributes].map(a => a.name + "=" + a.value.slice(0, 50)), html: r.outerHTML.slice(0, 600) })) };',
  '})()',
].join('\n'));
console.log(JSON.stringify(rows, null, 1).slice(0, 4000));
c.ws.close();
