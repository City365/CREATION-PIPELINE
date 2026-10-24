'use strict';
// Decoder adapted from doubao-dola-watermark-helper v1.6.7 (MIT).
// See licenses/doubao-dola-watermark-helper-MIT.txt.
const crypto=require('node:crypto').webcrypto;
const captures=new WeakMap();
function isHttpUrl(value){return typeof value==='string'&&/^https?:\/\//i.test(value);}
function parseJSON(text){return JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")|(-?\d{16,})(?=\s*[,}\]])/g,(all,quoted,number)=>quoted||JSON.stringify(number)));}
function parseString(text){try{const value=parseJSON(text);return value&&typeof value==='object'?value:null;}catch{return null;}}
function collectFallbacks(value,owner='',out=[],seen=new WeakSet(),depth=0){
 if(depth>22||value==null||out.length>=160)return out;
 if(typeof value==='string'){const parsed=parseString(value.trim());if(parsed)collectFallbacks(parsed,owner,out,seen,depth+1);return out;}
 if(typeof value!=='object'||seen.has(value))return out;seen.add(value);
 const current=String(value.message_id_str||value.messageIdStr||value.message_id||value.messageId||owner);
 if(typeof value.fallback_api==='string')out.push({messageId:current,url:value.fallback_api.replace(/\\u0026/g,'&').replace(/\\\//g,'/')});
 for(const [key,child]of Object.entries(value)){if(key!=='fallback_api')collectFallbacks(child,current,out,seen,depth+1);}return out;
}
// 实测 fallback_api 的主机是 vas-lf-x.snssdk.com（字节 fplay 接口），不是 doubao.com；
// 扩展本身不限制主机，这里保留允许列表但按实测补上 snssdk.com。
function allowedFallback(raw){try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)(doubao\.com|dola\.com|snssdk\.com|byteintlapi\.com|bytedanceapi\.com|volcengineapi\.com|volcvod\.com|douyinvod\.com|byteoversea\.com)$/.test(u.hostname);}catch{return false;}}
function unwatermarkedRequest(raw){if(!allowedFallback(raw))throw new Error('不支持的fallback_api地址');const url=new URL(raw);for(const [key,value]of Object.entries({channel:'no',codec_type:'8',logo_type:'unwatermarked'}))url.searchParams.set(key,value);return url.href;}
function hasWatermark(raw){let value=String(raw||'');try{value=decodeURIComponent(value);}catch{}return /video_gen_watermark_dyn|lr=cici_ai|(?:[?&])(?:watermark|with_watermark|wm)=(?:1|true)(?:&|$)|no_watermark=false/i.test(value);}
function attachFallbackCapture(page){
 if(captures.has(page))return;
 const state={records:[],pending:new Set(),errors:[],resolved:new Map()};captures.set(page,state);
 // /im/chain/single 携带增量消息（扩展只拦这一条）；/im/conversation/batch_get 携带历史会话，
 // 实测同一成片的 fallback_api 也出现在其中，重新打开既有会话时只有后者有数据。
 page.on('response',response=>{
  let u;try{u=new URL(response.url());}catch{return;}if(!/(^|\.)doubao\.com$/.test(u.hostname)||!/\/im\/(?:chain\/single|chain\/multi|conversation\/batch_get)$/.test(u.pathname))return;
  const pending=(async()=>{try{const text=await response.text();if(text.length>20*1024*1024)return;const found=collectFallbacks(parseJSON(text));state.records.push(...found);if(state.records.length>320)state.records.splice(0,state.records.length-320);}catch(e){state.errors.push(e.message);if(state.errors.length>5)state.errors.shift();}})();state.pending.add(pending);pending.finally(()=>state.pending.delete(pending));
 });
}
// Serialized into the account page; inspect only caller-selected message subtrees.
function readMessageFallbacks(messageIds){
 const hits=[],seen=new WeakSet();let budget=25000;
 function walk(value,owner,depth=0){if(--budget<0||depth>22||value==null)return;if(typeof value==='string'){try{const parsed=JSON.parse(value);if(parsed&&typeof parsed==='object')walk(parsed,owner,depth+1);}catch{}return;}if(typeof value!=='object'||seen.has(value))return;seen.add(value);const own=String(value.message_id_str||value.messageIdStr||value.message_id||value.messageId||owner);if(own!==owner)return;if(typeof value.fallback_api==='string')hits.push({messageId:owner,url:value.fallback_api});for(const [key,child]of Object.entries(value)){if(key!=='fallback_api')walk(child,owner,depth+1);}}
 for(const id of messageIds){if(!/^\d{8,}$/.test(id))continue;const root=document.querySelector('[data-message-id="'+id+'"]');if(!root)continue;for(const el of [root,...root.querySelectorAll('[class*="video"],[class*="media"],video,img')].slice(0,180)){for(const key of Object.keys(el).filter(k=>k.startsWith('__reactProps')||k.startsWith('__reactFiber'))){const ref=el[key];walk(ref?.memoizedProps||ref?.pendingProps||ref,id);}}}
 return hits;
}
function keySeed(value,depth=0){if(depth>12||value==null)return '';if(typeof value==='string'){const match=value.match(/(?:[?&]key_seed=|"key_seed"\s*:\s*")([^&"'<>\\\s]+)/i);try{return match?decodeURIComponent(match[1]):'';}catch{return '';}}if(typeof value!=='object')return '';if(typeof value.key_seed==='string')return value.key_seed;for(const child of Object.values(value)){const hit=keySeed(child,depth+1);if(hit)return hit;}return '';}
async function resolvePayload(payload){
 const info=payload?.video_info||payload?.data?.video_info||payload;const data=info?.data||info;const list=data?.video_list&&typeof data.video_list==='object'?Object.values(data.video_list):[data];
 const entries=list.filter(x=>x&&typeof x==='object').sort((a,b)=>(Number(b.bitrate||b.real_bitrate||0)+Number(b.vwidth||b.width||0)*Number(b.vheight||b.height||0))-(Number(a.bitrate||a.real_bitrate||0)+Number(a.vwidth||a.width||0)*Number(a.vheight||a.height||0)));
 for(const entry of entries){const token=entry.main_url||entry.play_url;if(typeof token!=='string')continue;const url=await decodeMainUrl(token,keySeed(payload));if(!url)continue;const parsed=new URL(url);if(parsed.protocol==='https:'&&!hasWatermark(url))return {url,width:Number(entry.vwidth||entry.width)||null,height:Number(entry.vheight||entry.height)||null};}return null;
}
async function resolveFallbackVideo({page,messageIds,signal,getDispatcher,request=fetch}){
 attachFallbackCapture(page);const state=captures.get(page);await Promise.race([Promise.allSettled([...state.pending]),new Promise(resolve=>setTimeout(resolve,1000))]);
 const selected=new Set(messageIds.map(String));const dom=await page.evaluate(readMessageFallbacks,[...selected]);
 const records=[...state.records,...dom].filter(r=>selected.has(r.messageId)&&allowedFallback(r.url));const seen=new Set();const diagnostics=[];
 for(const record of records){if(seen.has(record.url))continue;seen.add(record.url);signal?.throwIfAborted();
  if(state.resolved.has(record.url)&&state.resolved.get(record.url).expiresAt>Date.now()){const value=state.resolved.get(record.url);if(value.result)return {...value.result,messageId:record.messageId,diagnostics};diagnostics.push(value.diagnostic);continue;}
  try{let url=unwatermarkedRequest(record.url);let response;for(let redirect=0;redirect<4;redirect++){response=await request(url,{redirect:'manual',headers:{accept:'application/json,text/plain,*/*'},dispatcher:getDispatcher?.(url),signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(15000)])});if(![301,302,303,307,308].includes(response.status))break;const target=new URL(response.headers.get('location')||'',url).href;await response.body?.cancel();if(!allowedFallback(target))throw new Error('fallback_api重定向地址不受支持');url=target;}
   if(!response.ok)throw new Error('fallback_api HTTP '+response.status);const payload=await response.json();const result=await resolvePayload(payload);const diagnostic={messageId:record.messageId,status:response.status,resolved:Boolean(result),code:payload.code??payload.status_code??null};state.resolved.set(record.url,{result,diagnostic,expiresAt:Date.now()+(result?600000:30000)});diagnostics.push(diagnostic);if(result)return {...result,messageId:record.messageId,diagnostics};
  }catch(error){signal?.throwIfAborted();const diagnostic={messageId:record.messageId,error:error.message};diagnostics.push(diagnostic);state.resolved.set(record.url,{result:null,diagnostic,expiresAt:Date.now()+30000});}
 }
 return {url:'',diagnostics,matchedApis:seen.size};
}
const QAAB_SALT_HEX = "4dd4c2e6b83162090e52b3c7a6733ba4"
  + "1cb2462b829ab58a196b39db57177524"
  + "f49baf7f08e8d68d26a72e37c1a95a2f"
  + "1f05a51892aef2949732b62a38aadd58";

async function decodeMainUrl(token, keySeed = "") {
  if (isHttpUrl(token)) {
    return token;
  }

  const plainUrl = tryDecodeBase64Url(token);
  if (plainUrl) {
    return plainUrl;
  }

  if (token.startsWith("qAAB") && keySeed) {
    return await decodeQaabToken(token, keySeed);
  }

  return "";
}

function tryDecodeBase64Url(token) {
  const bytes = base64DecodeLoose(token);
  if (!bytes) {
    return "";
  }
  const text = asciiUrlFromBytes(bytes);
  return isHttpUrl(text) ? text : "";
}

function base64DecodeLoose(text) {
  const input = String(text || "").trim();
  const variants = [
    input,
    input.replace(/[$@#]/g, (char) => ({ "$": "_", "@": "/", "#": "." }[char])),
    input.replace(/[$@#]/g, (char) => ({ "$": "+", "@": "/", "#": "=" }[char]))
  ];
  const seen = new Set();

  for (const candidate of variants) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    try {
      const normalized = padBase64(candidate).replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(normalized);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    } catch {
      // Try the next variant.
    }
  }

  return null;
}

function padBase64(text) {
  const pad = (4 - (text.length % 4)) % 4;
  return text + "=".repeat(pad);
}

function asciiUrlFromBytes(bytes) {
  if (!bytes || !bytes.length) {
    return "";
  }
  for (const byte of bytes) {
    if (byte !== 9 && byte !== 10 && byte !== 13 && (byte < 32 || byte > 126)) {
      return "";
    }
  }
  return new TextDecoder().decode(bytes);
}

async function decodeQaabToken(token, keySeed) {
  const data = base64DecodeLoose(token);
  const seed = base64DecodeLoose(keySeed);
  if (!data || !seed) {
    return "";
  }

  const digest1 = await crypto.subtle.digest("SHA-512", seed.slice(0, 32));
  const salt = hexToBytes(QAAB_SALT_HEX);
  const digest2Input = concatBytes(new Uint8Array(digest1), salt);
  const digest2 = new Uint8Array(await crypto.subtle.digest("SHA-512", digest2Input));
  const key = digest2.slice(0, 16);
  const iv = digest2.slice(16, 32);
  const attempts = [];

  if (data.length >= 4 && data[0] === 0xa8 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0x00) {
    attempts.push({ payload: data.slice(4), key, iv });
    attempts.push({ payload: data.slice(4), key: iv, iv: key });
    if (data.length > 36) {
      attempts.push({ payload: data.slice(36), key, iv: data.slice(20, 36) });
      attempts.push({ payload: data.slice(36), key, iv });
    }
  } else {
    attempts.push({ payload: data, key, iv });
  }

  for (const attempt of attempts) {
    const url = await decryptAesCbcUrl(attempt.payload, attempt.key, attempt.iv);
    if (url) {
      return url;
    }
  }

  return "";
}

async function decryptAesCbcUrl(payload, keyBytes, ivBytes) {
  if (!payload.length || payload.length % 16 !== 0) {
    return "";
  }

  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["decrypt"]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, key, payload));
    const direct = asciiUrlFromBytes(plain);
    if (isHttpUrl(direct)) {
      return direct;
    }
    const stripped = stripPkcs7(plain);
    const url = asciiUrlFromBytes(stripped);
    return isHttpUrl(url) ? url : "";
  } catch {
    return "";
  }
}

function stripPkcs7(bytes) {
  if (!bytes || !bytes.length) {
    return new Uint8Array();
  }
  const pad = bytes[bytes.length - 1];
  if (pad < 1 || pad > 16 || pad > bytes.length) {
    return bytes;
  }
  for (let index = bytes.length - pad; index < bytes.length; index += 1) {
    if (bytes[index] !== pad) {
      return bytes;
    }
  }
  return bytes.slice(0, bytes.length - pad);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function concatBytes(first, second) {
  const bytes = new Uint8Array(first.length + second.length);
  bytes.set(first, 0);
  bytes.set(second, first.length);
  return bytes;
}


module.exports={attachFallbackCapture,resolveFallbackVideo,readMessageFallbacks,collectFallbacks,decodeMainUrl,resolvePayload,unwatermarkedRequest,hasWatermark,parseJSON};
