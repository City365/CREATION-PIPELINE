'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {analyzeFailureDetailed,parseFailureAnalysis}=require('../src/reply-intent');
const {TaskQueue}=require('../src/tasks');

const analysis={category:'entry',reason:'豆包页面改版，找不到视频模式入口',advice:'更新视频入口选择器后重试',confidence:0.91};
function listen(handler){
  return new Promise(resolve=>{const server=http.createServer(handler);server.listen(0,'127.0.0.1',()=>resolve(server));});
}
function fakeSettings(port){
  return {value:{interpreter:{enabled:true,protocol:'openai',baseUrl:'http://127.0.0.1:'+port+'/v1',apiKey:'test-key',model:'test-model',timeoutMs:2000}}};
}
const failureInput={
  task:{prompt:'一只橘猫在窗台伸懒腰',platform:'doubao',status:'starting'},
  account:{name:'闲鱼1-大豆包'},
  error:{message:'没有找到视频模式入口（已尝试：账号配置 → 直接入口 → 更多技能）'},
  lastReply:'',pageText:'',flags:{},
};

test('parseFailureAnalysis validates category and fields',()=>{
  const parsed=parseFailureAnalysis('```json\n'+JSON.stringify(analysis)+'\n```');
  assert.equal(parsed.category,'entry');
  assert.equal(parsed.advice,'更新视频入口选择器后重试');
  assert.equal(parseFailureAnalysis('{"category":"nope","reason":"x"}'),null);
  assert.equal(parseFailureAnalysis('not json'),null);
});

test('analyzeFailureDetailed sends context and parses the diagnosis',async()=>{
  let received=null;
  const server=await listen((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      received={url:req.url,headers:req.headers,body:JSON.parse(body)};
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(analysis)}}]}));
    });
  });
  try{
    const result=await analyzeFailureDetailed(fakeSettings(server.address().port),()=>undefined,failureInput);
    assert.equal(result.error,'');
    assert.equal(result.analysis.category,'entry');
    assert.match(received.body.messages[1].content,/没有找到视频模式入口/);
    assert.match(received.body.messages[1].content,/闲鱼1-大豆包/);
  }finally{server.close();}
});

test('failed task gets the AI reason while keeping the raw error',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbm-failure-'));
  const account={id:'acc-1',name:'测试账号',platform:'doubao',enabled:true,quota:{limit:5,used:0},cooldownUntil:0};
  const store={
    list:()=>[account],
    get:id=>id===account.id?account:null,
    canUse:()=>true,
    refundQuota(){},
  };
  let analyzed=false;
  const queue=new TaskQueue({
    directory,store,concurrency:1,
    execute:async()=>{throw new Error('没有找到视频模式入口');},
    analyzeFailure:async(task,acc,error)=>{
      analyzed=true;
      assert.equal(acc.id,account.id);
      assert.match(error.message,/视频模式/);
      return analysis;
    },
  });
  try{
    const task=queue.submit({prompt:'测试提示词',platform:'doubao'});
    for(let i=0;i<80;i++){
      await new Promise(resolve=>setTimeout(resolve,20));
      if(queue.get(task.id).status==='failed')break;
    }
    const saved=queue.get(task.id);
    assert.equal(saved.status,'failed');
    assert.equal(saved.error,'没有找到视频模式入口');
    assert.equal(saved.message,analysis.reason);
    assert.equal(saved.failureCategory,'entry');
    assert.equal(saved.failureReason,analysis.reason);
    assert.equal(saved.failureAdvice,analysis.advice);
    assert.equal(saved.failureAnalysis.confidence,0.91);
    assert.equal(analyzed,true);
  }finally{
    await queue.shutdown().catch(()=>{});
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('failed task falls back to the raw error when analysis is unavailable',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbm-failure-'));
  const account={id:'acc-2',name:'测试账号',platform:'doubao',enabled:true,quota:{limit:5,used:0},cooldownUntil:0};
  const store={list:()=>[account],get:id=>id===account.id?account:null,canUse:()=>true,refundQuota(){}};
  const queue=new TaskQueue({
    directory,store,concurrency:1,
    execute:async()=>{throw new Error('原始失败原因');},
    analyzeFailure:async()=>null,
  });
  try{
    const task=queue.submit({prompt:'测试提示词',platform:'doubao'});
    for(let i=0;i<80;i++){
      await new Promise(resolve=>setTimeout(resolve,20));
      if(queue.get(task.id).status==='failed')break;
    }
    const saved=queue.get(task.id);
    assert.equal(saved.status,'failed');
    assert.equal(saved.message,'原始失败原因');
    assert.equal(saved.failureAnalysis,undefined);
  }finally{
    await queue.shutdown().catch(()=>{});
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
