'use strict';
const path=require('node:path');
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
module.exports={referenceParts,bindReferences,pickCandidate};
