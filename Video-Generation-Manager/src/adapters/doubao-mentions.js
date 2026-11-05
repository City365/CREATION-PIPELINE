'use strict';
const path=require('node:path');

// ══════════════════════════════════════════════════════════════════════════
// 【已停用】豆包原生 @ 图片引用（2026-11-01 起默认关闭，代码完整保留）
//
// 停用范围：下面 bindReferences() / pickCandidate() 代表的整条链路——
//   在提示词里敲 "@" → 输入图片文件名 → 等豆包的素材候选弹层（role=option）
//   → 按完整文件名精确点选 → 生成 .node-inputEngineMention 图片芯片 → 再按
//   attachment-image-card 的 alt/src 逐个核验绑定结果。
//   停用后这条链路不会被调用，但函数、候选去重逻辑、核验逻辑一行都没删。
//
// 停用期间的替代行为：图片引用一律降级为纯文本，pictureTagsToText() 负责转换—
//   <Picture 1>  → 图1
//   @图片1 / @图1 → 图1
//   多个标记按出现顺序依次变成 图1、图2……正文其余部分原样保留。转换后的字符串
//   直接 editor.fill() 写进输入框，不产生任何 mention 芯片，豆包按普通文字收到。
//
// 为什么停：
//   1) 候选弹层只滚出前几张图的候选，第 6 张起必须先输文件名，前 5 张又是另一套行为；
//   2) 候选是模糊匹配（"办公室.png" 也会命中 "主管办公室.png"），必须靠 pickCandidate
//      按完整文件名唯一命中，一旦重名或多命中就直接中止，跑一次任务容易白等；
//   3) 素材卡片的 alt/src 顺序必须与上传顺序完全一致才允许发送，任何顺序抖动都会拦下；
//   4) 现在的提示词直接用 "图1/图2" 指代图片，模型自己理解对应关系，链路更短更稳。
//
// 什么时候会被启用（即"何时禁用"的对照）：只有在显式要求原生 @ 绑定、
//   DBM_NATIVE_MENTIONS=1（或调用方 nativeMentions=true）时，submitText 才走
//   bindReferences；其余所有情况——默认值、未设置、设为 0/其它任何值——都禁用。
//   注意它依赖上传已完成（attachment-image-card 已渲染），上传没完成时启用它会直接报错。
//
// 恢复原生 @ 绑定的做法：设置环境变量 DBM_NATIVE_MENTIONS=1 后重启管理器（17778），
//   提示词里的标记会重新变成真芯片；要彻底回到旧行为，只需把 submitText 里的
//   nativeMentionsEnabled() 判断改成 true。
// ══════════════════════════════════════════════════════════════════════════
function nativeMentionsEnabled(){
  return String(process.env.DBM_NATIVE_MENTIONS||'').trim()==='1';
}
// 纯文本降级：<Picture n> / @图片n / @图n 一律写成「图n」，其余文字不动。
function pictureTagsToText(text){
  return String(text??'').replace(/<Picture\s+(\d+)>|@(?:图片|图)\s*(\d+)(?!\d)/gi,(all,a,b)=>'图'+(a||b));
}
function referenceParts(text,files){
 const parts=[];let last=0;
 const pattern=/<Picture\s+(\d+)>|@(?:图片|图)\s*(\d+)(?!\d)/gi;
 for(const match of text.matchAll(pattern)){
  const index=Number(match[1]||match[2])-1;
  if(index<0||index>=files.length)throw new Error('图片引用超出已上传图片范围：'+match[0]);
  if(match.index>last)parts.push({text:text.slice(last,match.index)});
  parts.push({index,name:path.basename(files[index])});last=match.index+match[0].length;
 }
 if(last<text.length)parts.push({text:text.slice(last)});
 return parts;
}
// 候选列表是模糊匹配：“办公室.png”也会命中“主管办公室.png”。
// 必须按完整文件名挑，否则会把两个不同素材当成同名，或者点到另一张。
function pickCandidate(texts,name){
 const norm=value=>String(value||'').replace(/\s+/g,' ').trim();
 const wanted=norm(name);
 const entries=(Array.isArray(texts)?texts:[]).map((raw,index)=>({index,text:norm(raw)}));
 const exact=entries.filter(entry=>entry.text===wanted);
 if(exact.length===1)return {index:exact[0].index};
 if(exact.length>1)return {index:-1};
 // 候选行可能带大小、格式等附加信息：文件名要在开头，后面紧跟空白。
 const prefixed=entries.filter(entry=>entry.text.startsWith(wanted)&&/^(?:\s|$)/.test(entry.text.slice(wanted.length)));
 if(prefixed.length===1)return {index:prefixed[0].index};
 if(prefixed.length>1)return {index:-1};
 // 兜底：文件名前面不能紧跟文字，避免“办公室.png”命中“主管办公室.png”。
 const standalone=entries.filter(entry=>{
  const at=entry.text.indexOf(wanted);
  if(at<0)return false;
  return !/[\p{L}\p{N}_-]/u.test(entry.text[at-1]||'');
 });
 return {index:standalone.length===1?standalone[0].index:-1};
}
async function bindReferences(page,editor,text,files,signal){
 const parts=referenceParts(text,files);const expected=parts.filter(p=>p.index!==undefined);
 if(!expected.length){await editor.fill(text);return {text,bindings:[]};}
 // Validate the complete mapping before touching the editor.
 const names=files.map(f=>path.basename(f));
 for(const item of expected)if(names.filter(n=>n===item.name).length!==1)throw new Error('参考图文件名重复，无法唯一绑定：'+item.name);
 const cards=await page.locator('[data-testid="attachment-image-card"] img').evaluateAll(es=>es.map(e=>({name:e.alt,src:e.src})));
 if(cards.length!==files.length||cards.some((card,i)=>card.name!==names[i]))throw new Error('上传图片顺序与引用映射不一致，未发送');
 await editor.fill('');await editor.focus();
 const bindings=[];
 for(const part of parts){
  signal.throwIfAborted();
  await editor.press('Control+End');
  if(part.text!==undefined){await page.keyboard.insertText(part.text);continue;}
  await page.keyboard.type('@');
  // 豆包只滚出前几张图的候选；第 6 张起必须先输入图片名，候选才会出现。
  // 统一输入不带扩展名的文件名，前 5 张也走同一条路径，避免两套行为。
  const query=part.name.replace(/\.[^.]+$/,'')||part.name;
  await page.keyboard.type(query);
  const option=page.getByRole('option').filter({hasText:part.name});
  try { await option.first().waitFor({state:'visible',timeout:10000}); }
  catch { throw new Error('豆包素材候选未出现：'+part.name+'（已尝试输入 @'+query+'）'); }
  const candidates=await option.allInnerTexts().catch(()=>[]);
  const picked=pickCandidate(candidates,part.name);
  if(picked.index<0){
   const listed=(Array.isArray(candidates)?candidates:[]).map(item=>String(item).replace(/\s+/g,' ').trim()).filter(Boolean).join(' / ');
   throw new Error('豆包素材候选无法唯一确定：'+part.name+(listed?'（候选：'+listed+'）':''));
  }
  await option.nth(picked.index).click();
  const nodes=await editor.locator('.node-inputEngineMention').evaluateAll(es=>es.map(e=>({name:e.textContent.trim(),src:e.querySelector('img')?.src||''})));
  const last=nodes.at(-1);
  if(nodes.length!==bindings.length+1||last.name!==part.name||last.src!==cards[part.index].src)throw new Error('豆包原生图片引用未核验通过：'+part.name);
  bindings.push({picture:part.index+1,name:part.name});
 }
 const actual=await editor.innerText();
 const expectedText=parts.map(part=>part.text!==undefined?part.text:part.name).join('');
 if(actual.replace(/\s+/g,'')!==expectedText.replace(/\s+/g,''))throw new Error('图片引用插入后全文顺序或内容不一致，已停止发送');
 return {text:actual,bindings};
}
module.exports={referenceParts,bindReferences,pickCandidate,nativeMentionsEnabled,pictureTagsToText};
