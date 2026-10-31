'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {poll}=require('../src/manager-video');

function listen(handler){
  return new Promise(resolve=>{const server=http.createServer(handler);server.listen(0,'127.0.0.1',()=>resolve(server));});
}
function reply(res,payload){
  const body=Buffer.from(JSON.stringify(payload));
  res.writeHead(200,{'Content-Type':'application/json','Content-Length':body.length});
  res.end(body);
}

test('manager failure analysis is surfaced to the console',async()=>{
  const server=await listen((req,res)=>reply(res,{
    id:'t1',status:'failed',message:'原始错误',
    failureAnalysis:{category:'entry',reason:'豆包页面改版，找不到视频模式入口',advice:'更新视频入口选择器后重试',confidence:0.91},
  }));
  try{
    const result=await poll({baseUrl:'http://127.0.0.1:'+server.address().port,apiKey:'test-token'},'t1');
    assert.equal(result.status,'failed');
    assert.equal(result.message,'豆包页面改版，找不到视频模式入口');
    assert.equal(result.failureReason,'豆包页面改版，找不到视频模式入口');
    assert.equal(result.failureAdvice,'更新视频入口选择器后重试');
    assert.equal(result.failureAnalysis.category,'entry');
  }finally{server.close();}
});

test('console falls back to the raw manager message without analysis',async()=>{
  const server=await listen((req,res)=>reply(res,{id:'t2',status:'failed',message:'原始错误'}));
  try{
    const result=await poll({baseUrl:'http://127.0.0.1:'+server.address().port,apiKey:'test-token'},'t2');
    assert.equal(result.status,'failed');
    assert.equal(result.message,'原始错误');
    assert.equal(result.failureAnalysis,null);
    assert.equal(result.failureReason,'');
  }finally{server.close();}
});
