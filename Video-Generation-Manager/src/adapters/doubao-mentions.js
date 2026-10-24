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
  if(part.text!==undefined){await page.keyboard.insertText(part.text);continue;}
  await editor.pressSequentially('@');
  const option=page.getByRole('option').filter({hasText:part.name});
  await option.first().waitFor({state:'visible',timeout:10000});
  if(await option.count()!==1)throw new Error('豆包素材候选不唯一：'+part.name);
  await option.click();
  const nodes=await editor.locator('.node-inputEngineMention').evaluateAll(es=>es.map(e=>({name:e.textContent.trim(),src:e.querySelector('img')?.src||''})));
  const last=nodes.at(-1);
  if(nodes.length!==bindings.length+1||last.name!==part.name||last.src!==cards[part.index].src)throw new Error('豆包原生图片引用未核验通过：'+part.name);
  bindings.push({picture:part.index+1,name:part.name});
 }
 return {text:await editor.innerText(),bindings};
}
module.exports={referenceParts,bindReferences};
