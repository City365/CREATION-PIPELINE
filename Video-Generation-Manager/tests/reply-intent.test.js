'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createInterpreter,endpoint,parseVerdict,cleanSuggested}=require('../src/reply-intent');

function listen(handler){
  return new Promise(resolve=>{
    const server=http.createServer(handler);
    server.listen(0,'127.0.0.1',()=>resolve(server));
  });
}
function fakeSettings(port,protocol='openai',overrides={}){
  return {value:{interpreter:{
    enabled:true,protocol,
    baseUrl:'http://127.0.0.1:'+port+(protocol==='anthropic'?'/anthropic':'/v1'),
    apiKey:'test-key',model:'test-model',timeoutMs:2000,
    ...overrides,
  }}};
}
const input={
  task:{prompt:'一只橘猫在窗台上伸懒腰，16:9，5 秒',duration:5,ratio:'16:9'},
  lastReply:'我现在无法直接生成视频，可以先帮你写脚本。',
  recentReplies:['我现在无法直接生成视频，可以先帮你写脚本。'],
  sent:[],pushRounds:0,
};
const pushVerdict={intent:'soft_refuse',confidence:0.9,next_action:'push',evidence:'无法直接生成视频',suggested_reply:'请按上面的提示词直接生成视频'};

test('endpoint builds OpenAI and Anthropic paths',()=>{
  assert.equal(endpoint('https://api.deepseek.com/v1','openai'),'https://api.deepseek.com/v1/chat/completions');
  assert.equal(endpoint('https://api.deepseek.com','openai'),'https://api.deepseek.com/v1/chat/completions');
  assert.equal(endpoint('https://x.test/api/paas/v4','openai'),'https://x.test/api/paas/v4/chat/completions');
  assert.equal(endpoint('https://api.deepseek.com/anthropic','anthropic'),'https://api.deepseek.com/anthropic/v1/messages');
});
test('parseVerdict accepts fenced JSON and validates fields',()=>{
  const ok=parseVerdict('```json\n'+JSON.stringify(pushVerdict)+'\n```');
  assert.equal(ok.intent,'soft_refuse');
  assert.equal(ok.nextAction,'push');
  assert.equal(ok.suggestedReply,'请按上面的提示词直接生成视频');
  assert.equal(parseVerdict('{"intent":"unknown","confidence":1,"next_action":"push"}'),null);
  assert.equal(parseVerdict('not json'),null);
});
test('cleanSuggested rejects links, mentions and long text',()=>{
  assert.equal(cleanSuggested('https://example.com 生成视频'),'');
  assert.equal(cleanSuggested('@图1 生成视频'),'');
  assert.equal(cleanSuggested('生成视频'.repeat(20)),'');
  assert.equal(cleanSuggested('“直接生成视频”'),'直接生成视频');
});
test('OpenAI-compatible call sends the task context and parses the verdict',async()=>{
  let received=null;
  const server=await listen((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      received={url:req.url,headers:req.headers,body:JSON.parse(body)};
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(pushVerdict)}}]}));
    });
  });
  try{
    const interpreter=createInterpreter({settings:fakeSettings(server.address().port),getDispatcher:()=>undefined});
    const verdict=await interpreter.classify(input);
    assert.equal(verdict.intent,'soft_refuse');
    assert.equal(verdict.nextAction,'push');
    assert.equal(received.url,'/v1/chat/completions');
    assert.equal(received.headers.authorization,'Bearer test-key');
    assert.equal(received.body.model,'test-model');
    assert.match(received.body.messages[1].content,/一只橘猫/);
    assert.match(received.body.messages[1].content,/无法直接生成视频/);
  }finally{server.close();}
});
test('Anthropic-compatible call uses x-api-key and the messages endpoint',async()=>{
  let received=null;
  const server=await listen((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      received={url:req.url,headers:req.headers,body:JSON.parse(body)};
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({content:[{type:'text',text:JSON.stringify(pushVerdict)}]}));
    });
  });
  try{
    const interpreter=createInterpreter({settings:fakeSettings(server.address().port,'anthropic'),getDispatcher:()=>undefined});
    const verdict=await interpreter.classify(input);
    assert.equal(verdict.intent,'soft_refuse');
    assert.equal(received.url,'/anthropic/v1/messages');
    assert.equal(received.headers['x-api-key'],'test-key');
    assert.equal(received.body.system!==undefined,true);
    assert.equal(received.body.thinking.type,'disabled');
    assert.equal(received.body.max_tokens,10000);
  }finally{server.close();}
});
test('disabled or failing interpreter returns null and an error for diagnostics',async()=>{
  const disabled=createInterpreter({settings:{value:{interpreter:{enabled:false}}},getDispatcher:()=>undefined});
  assert.equal(await disabled.classify(input),null);
  const detail=await disabled.classifyDetailed(input);
  assert.match(detail.error,/未启用/);

  const server=await listen((req,res)=>{res.writeHead(500);res.end('boom');});
  try{
    const interpreter=createInterpreter({settings:fakeSettings(server.address().port),getDispatcher:()=>undefined});
    const result=await interpreter.classifyDetailed(input);
    assert.equal(result.verdict,null);
    assert.match(result.error,/HTTP 500/);
  }finally{server.close();}
});
test('unparseable model output falls back to null',async()=>{
  const server=await listen((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'我觉得可以开始'}}]}));});
  try{
    const interpreter=createInterpreter({settings:fakeSettings(server.address().port),getDispatcher:()=>undefined});
    assert.equal(await interpreter.classify(input),null);
  }finally{server.close();}
});
test('truncated output reports that thinking may have used the token budget',async()=>{
  const server=await listen((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({stop_reason:'max_tokens',content:[{type:'thinking',thinking:'...'}]}));});
  try{
    const interpreter=createInterpreter({settings:fakeSettings(server.address().port,'anthropic'),getDispatcher:()=>undefined});
    const result=await interpreter.classifyDetailed(input);
    assert.equal(result.verdict,null);
    assert.match(result.error,/截断/);
  }finally{server.close();}
});
