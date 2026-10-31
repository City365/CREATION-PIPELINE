'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {parsePlan,fallbackPlan,planWarmup,buildPlanPrompt,validMessage,withShortAsk,OPENERS}=require('../src/warmup');
const {warmUpConversation,selectorsFor}=require('../src/automation');
const {Settings}=require('../src/settings');

function listen(handler){
  return new Promise(resolve=>{const server=http.createServer(handler);server.listen(0,'127.0.0.1',()=>resolve(server));});
}
function fakeSettings(port,{enabled=true}={}){
  return {value:{
    interpreter:{enabled,protocol:'openai',baseUrl:'http://127.0.0.1:'+port+'/v1',apiKey:'test-key',model:'test-model',timeoutMs:2000},
    warmup:{enabled:true,rounds:2,timeoutMs:45000},
  }};
}

test('parsePlan keeps only valid warm-up messages',()=>{
  const plan=parsePlan(JSON.stringify({messages:['最近在追一部漫剧，节奏比短剧还快，你觉得关键在哪？','那如果只有一分钟时长，你会先砍掉哪部分？']}),2);
  assert.equal(plan.length,2);
  assert.equal(parsePlan(JSON.stringify({messages:['帮我生成视频','太短']}),2),null);
  assert.equal(parsePlan(JSON.stringify({messages:['只有一条足够长的消息用来测试解析失败的情况']}),2),null);
  assert.equal(parsePlan('not json',2),null);
});

test('warm-up messages never contain task instructions',()=>{
  assert.equal(validMessage('帮我生成视频，用上面的提示词'),'');
  assert.equal(validMessage('https://example.com 看看这个'),'');
  assert.ok(validMessage(OPENERS[0]));
});

test('fallback plan generates the requested number of natural messages',()=>{
  const messages=fallbackPlan(2);
  assert.equal(messages.length,2);
  for(const text of messages)assert.ok(validMessage(text),text);
});

test('every warm-up message asks for a short reply, without duplicates',()=>{
  const asked=withShortAsk('最近在追一部漫剧，你觉得节奏怎么把握？');
  assert.match(asked,/简短|简单说|一两句|句/);
  assert.ok(asked.startsWith('最近在追一部漫剧'));
  assert.equal(withShortAsk(asked),asked);
});

test('planWarmup uses the model when it is available',async()=>{
  const messages=['最近在追一部漫剧，节奏比短剧还快，你觉得关键在哪？','那如果只有一分钟时长，你会先砍掉哪部分？'];
  const server=await listen((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      const payload=JSON.parse(body);
      assert.match(payload.messages[0].content,/漫剧/);
      assert.match(payload.messages[1].content,/雨夜里的旧书店/);
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({messages})}}]}));
    });
  });
  try{
    const result=await planWarmup({settings:fakeSettings(server.address().port),getDispatcher:()=>undefined,task:{prompt:'雨夜里的旧书店'},rounds:2});
    assert.equal(result.source,'ai');
    assert.equal(result.messages.length,2);
    // 每条都会带上“简短回答”的要求，避免豆包写长篇拖慢暖场
    assert.match(result.messages[0],/^最近在追一部漫剧/);
    for(const text of result.messages)assert.match(text,/简短|简单说|一两句|句/);
  }finally{server.close();}
});

test('planWarmup falls back to the pool when the model is disabled or broken',async()=>{
  const disabled=await planWarmup({settings:fakeSettings(0,{enabled:false}),getDispatcher:()=>undefined,task:{prompt:'x'},rounds:2});
  assert.equal(disabled.source,'pool');
  assert.equal(disabled.messages.length,2);
  const broken=await planWarmup({settings:{value:{interpreter:{enabled:true,baseUrl:'http://127.0.0.1:1/v1',apiKey:'k',model:'m',timeoutMs:300}}},getDispatcher:()=>undefined,task:{prompt:'x'},rounds:2});
  assert.equal(broken.source,'pool');
});

test('buildPlanPrompt carries the task theme without asking for the prompt itself',()=>{
  const {system,user}=buildPlanPrompt({task:{prompt:'雨夜里的旧书店，暖色调'},rounds:2});
  assert.match(system,/漫剧/);
  assert.match(system,/不要出现“生成视频”/);
  assert.match(user,/雨夜里的旧书店/);
});

function fakePage({videoMode=false}={}){
  const sent=[];const replies=['漫剧更吃节奏，前几秒就得立住人物。','结尾留钩子更容易让人追下去。'];let replyIndex=0;
  const interactive=selector=>selector==='[data-testid="chat_input_input"] [contenteditable="true"]'||selector==='[data-testid="chat_input_send_button"]';
  const makeLocator=(selector)=>({
    async count(){return 1;},
    async isVisible(){return selector==='[data-input-engine-actionbar-control-key="video-model"]'?videoMode:interactive(selector);},
    async innerText(){return '';},
    async click(){},
    first(){return this;},
    nth(){return {
      async isVisible(){return interactive(selector);},
      async boundingBox(){return null;},
      async fill(text){sent.push(text);},
      async click(){},
      async press(){},
    };},
  });
  return {
    sent,
    locator(selector){return makeLocator(selector);},
    async evaluate(fn,arg={}){
      if(arg&&Object.prototype.hasOwnProperty.call(arg,'baseline')){
        const text=replies[Math.min(replyIndex,replies.length-1)];
        return {responding:false,replies:[{text}],text};
      }
      return {keys:['k'+sent.length],messageCount:1};
    },
  };
}

test('warmUpConversation sends each warm-up message and waits for the reply',async()=>{
  const page=fakePage();
  const updates=[];const signal=new AbortController().signal;
  const planned=['最近在追一部漫剧，节奏比短剧还快，你觉得关键在哪？','那如果只有一分钟时长，你会先砍掉哪部分？'];
  const warmup={
    config:()=>({enabled:true,rounds:2,timeoutMs:1000,stableMs:0,pollMs:20}),
    plan:async()=>({messages:planned,source:'ai'}),
  };
  const info=await warmUpConversation({page,task:{prompt:'雨夜里的旧书店',platform:'doubao'},selectors:selectorsFor('doubao',{}),signal,update:patch=>updates.push(patch),warmup});
  assert.equal(page.sent.length,2);
  assert.deepEqual(page.sent,planned);
  assert.equal(info.rounds,2);
  assert.equal(info.source,'ai');
  assert.match(info.messages[0].reply,/漫剧/);
  assert.equal(updates.at(-1).warmup.rounds,2);
});

test('warmUpConversation skips the page when it is stuck in video mode',async()=>{  const page=fakePage({videoMode:true});
  const signal=new AbortController().signal;
  const warmup={config:()=>({enabled:true,rounds:2,timeoutMs:1000,stableMs:0,pollMs:20}),plan:async()=>({messages:['a','b'],source:'ai'})};
  const info=await warmUpConversation({page,task:{prompt:'x',platform:'doubao'},selectors:selectorsFor('doubao',{}),signal,update:()=>{},warmup});
  assert.equal(page.sent.length,0);
  assert.match(info.skipped,/视频模式/);
});

test('settings keeps warm-up defaults and clamps the values',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dbm-warmup-'));
  const settings=new Settings(directory);
  try{
    assert.deepEqual(settings.public().warmup,{enabled:true,rounds:2,timeoutMs:45000});
    const value=settings.validate({warmup:{enabled:false,rounds:9,timeoutMs:100}});
    assert.deepEqual(value.warmup,{enabled:false,rounds:3,timeoutMs:5000});
    // 保存其他设置时不应该把暖场改回默认值
    assert.equal(settings.validate({proxy:{}}).warmup.enabled,true);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
