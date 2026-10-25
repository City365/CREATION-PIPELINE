'use strict';
const {firstVisible,createExecutor}=require('./automation');
async function prepareReferenceDraft(pool,account,input){
 if(!['doubao','gemini'].includes(account.platform))throw new Error('草稿测试仅支持豆包和Gemini');
 const signal=new AbortController().signal;
 if(account.platform==='doubao'){
  const conversion=require('./prompt-mappings').createMappings(pool.store.directory).convert(input.prompt||'草稿测试','doubao');
  const execute=createExecutor({pool,store:pool.store,prepareOnly:true});
  const task={platform:'doubao',prompt:conversion.text,references:input.references||[],model:input.model||'',duration:input.duration??15,ratio:input.ratio||'16:9',resolution:input.resolution||'',timeoutSeconds:120,resume:false};
  try{
   const result=await execute(task,account,signal,()=>{});
   const context=await pool.context(account);const page=context.pages().filter(p=>!p.isClosed()).at(-1);
   const screenshot=require('node:path').join(pool.store.directory,'doubao-tag-draft.png');await page.screenshot({path:screenshot});
   return {...result,screenshot};
  }catch(error){return {sent:false,mode:'executor-before-send',error:error.message,uploadDiagnostics:error.uploadDiagnostics};}
 }
 const page=await pool.taskPage(account);
 const {waitForGeminiReady,ensureVideoMode,uploadGeminiReferences,ensureChatMode,UI}=require('./automation-gemini');
 await page.waitForTimeout(2500);await waitForGeminiReady(page,signal);await ensureChatMode(page);await page.waitForTimeout(1000);await ensureVideoMode(page,account.selectors||{},()=>{});
 await uploadGeminiReferences(page,input.references||[],account.selectors||{},signal,()=>{});
 const conversion=require('./prompt-mappings').createMappings(pool.store.directory).convert(input.prompt||'测试草稿','gemini');
 const editor=await firstVisible(page,account.selectors?.editor||UI.editor);await editor.fill(conversion.text);
 const screenshot=require('node:path').join(pool.store.directory,'gemini-tag-draft.png');await page.screenshot({path:screenshot});
 return {sent:false,platform:'gemini',videoMode:await page.locator(UI.videoChip).first().isVisible(),text:await editor.innerText(),convertedPrompt:conversion.text,attachments:await page.locator('img[alt="attachment"]').count(),screenshot};
}
module.exports={prepareReferenceDraft};
