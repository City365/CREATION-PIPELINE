'use strict';
const {uploadReferences,applyOptions,firstVisible}=require('./automation');
async function prepareReferenceDraft(pool,account,input){
 if(!['doubao','gemini'].includes(account.platform))throw new Error('草稿测试仅支持豆包和Gemini');
 const page=await pool.taskPage(account);
 const signal=new AbortController().signal;
 if(account.platform==='gemini'){
  const {waitForGeminiReady,ensureVideoMode,uploadGeminiReferences,ensureChatMode,UI}=require('./automation-gemini');
  await page.waitForTimeout(2500);
  await waitForGeminiReady(page,signal);
  await ensureChatMode(page);
  await page.waitForTimeout(1000);
  await ensureVideoMode(page,account.selectors||{},()=>{});
  await uploadGeminiReferences(page,input.references||[],account.selectors||{},signal,()=>{});
  const conversion=require('./prompt-mappings').createMappings(pool.store.directory).convert(input.prompt||'测试草稿','gemini');
  const editor=await firstVisible(page,account.selectors?.editor||UI.editor);
  await editor.fill(conversion.text);
  const screenshot=require('node:path').join(pool.store.directory,'gemini-tag-draft.png');await page.screenshot({path:screenshot});
  return {sent:false,platform:'gemini',videoMode:await page.locator(UI.videoChip).first().isVisible(),text:await editor.innerText(),convertedPrompt:conversion.text,attachments:await page.locator('img[alt="attachment"]').count(),screenshot};
 }

 await firstVisible(page,account.selectors?.editor||'[contenteditable=true]',30000);
 await applyOptions(page,{platform:'doubao'},account.selectors||{},signal);
 try{await uploadReferences(page,input.references||[],account.selectors||{},signal,'doubao');}catch(error){return {sent:false,error:error.message,uploadDiagnostics:error.uploadDiagnostics};}
 const editor=await firstVisible(page,account.selectors?.editor||'[contenteditable=true]');
 const conversion=require('./prompt-mappings').createMappings(pool.store.directory).convert(input.prompt||'图片绑定草稿测试 @图1 与 <Picture 2> 同框。仅草稿，不发送。','doubao');
 const binding=await require('./adapters/doubao-mentions').bindReferences(page,editor,conversion.text,input.references||[],signal);
 const screenshot=require('node:path').join(pool.store.directory,'doubao-tag-draft.png');await page.screenshot({path:screenshot});
 const result=await page.evaluate(binding=>({bindings:binding.bindings,url:location.origin+location.pathname,editor:document.querySelector('[contenteditable=true]')?.outerHTML,tail:document.body.innerText.slice(-2500),sent:false}),binding);
 return {...result,screenshot};
}
module.exports={prepareReferenceDraft};
