'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {createExecutor}=require('../src/automation');
test('正式执行器准备模式先清空再配置与上传，填完提示词后停在扣额和发送之前',async()=>{
 const calls=[];let charged=0;const editor={async fill(text){calls.push(['fill',text]);},async click(){calls.push(['click','editor']);},async press(){throw Error('不应按下发送键');}};
 const page={locator(selector){return {async count(){return selector==='#editor'?1:0;},nth(){return {async isVisible(){return true;},...editor};},async isVisible(){return false;},first(){return this;},async innerText(){return '';}};},getByText(){return {async count(){return 0;}};},async evaluate(){return {messageCount:0,keys:[],captcha:false};},async close(){calls.push(['close']);}};
 const execute=createExecutor({pool:{async taskPage(){return page;}},store:{consumeQuota(){charged++;throw Error('不应扣额');}},prepareOnly:true});
 const result=await execute({platform:'fixture',prompt:'完整长提示词',references:[],timeoutSeconds:120},{id:'test',platform:'fixture',selectors:{editor:'#editor'}},new AbortController().signal,()=>{});
 assert.equal(result.sent,false);assert.equal(result.mode,'executor-before-send');assert.equal(charged,0);assert.deepEqual(calls.filter(c=>c[0]==='fill'),[['fill',''],['fill','完整长提示词']]);assert.ok(!calls.some(c=>c[0]==='click'));
});
