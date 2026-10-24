'use strict';
const {uploadReferences,applyOptions,firstVisible}=require('./automation');
async function prepareReferenceDraft(pool,account,input){
 if(account.platform!=='doubao')throw new Error('图片绑定测试目前仅支持豆包');
 const page=await pool.taskPage(account);
 const signal=new AbortController().signal;
 await firstVisible(page,account.selectors?.editor||'[contenteditable=true]',30000);
 await applyOptions(page,{platform:'doubao'},account.selectors||{},signal);
 try{await uploadReferences(page,input.references||[],account.selectors||{},signal,'doubao');}catch(error){return {sent:false,error:error.message,uploadDiagnostics:error.uploadDiagnostics};}
 const editor=await firstVisible(page,account.selectors?.editor||'[contenteditable=true]');
 const conversion=require('./prompt-mappings').createMappings(pool.store.directory).convert(input.prompt||'图片绑定草稿测试 @图1 与 <Picture 2> 同框。仅草稿，不发送。','doubao');
 const binding=await require('./adapters/doubao-mentions').bindReferences(page,editor,conversion.text,input.references||[],signal);
 return page.evaluate(binding=>({bindings:binding.bindings,url:location.origin+location.pathname,editor:document.querySelector('[contenteditable=true]')?.outerHTML,tail:document.body.innerText.slice(-2500),sent:false}),binding);
}
module.exports={prepareReferenceDraft};
