const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const {readPageState}=require('../src/adapters/page-state');
function read(rows,args={prompt:'任务提示词'}){
 const elements=rows.map((row,index)=>({dataset:{},className:'',isConnected:true,innerText:row.text||'',textContent:row.text||'',getAttribute(k){return k==='data-role'?row.role:k==='data-message-id'?String(index+1):null;},matches(selector){return selector.includes('[data-role="'+row.role+'"]');},contains(){return false;},compareDocumentPosition(other){return elements.indexOf(other)>index?4:2;},querySelector(selector){if(selector==='[data-message-id]')return null;return row.image&&selector.includes('img')?{}:null;},querySelectorAll(selector){return selector==='[data-testid="message_text_content"]'&&row.text?[{textContent:row.text}]:[];}}));
 let n=0;const context={document:{querySelectorAll(selector){return selector.includes('data-message-id')?elements:[];},querySelector(){return null;}},crypto:{randomUUID(){return String(++n);}},Node:{DOCUMENT_POSITION_FOLLOWING:4},window:{},location:{pathname:'/chat/123'},getComputedStyle(){return {};}};
 vm.createContext(context);return vm.runInContext('('+readPageState.toString()+')({prompt:'+JSON.stringify(args.prompt)+',baseline:'+JSON.stringify(args.baseline||[])+',attachments:'+(args.attachments||0)+',taskReplies:'+JSON.stringify(args.taskReplies||[])+',confirmReplies:'+JSON.stringify(args.confirmReplies||[])+'})',context);
}
test('picture-only message before current prompt belongs to same submission',()=>{
 const state=read([{role:'user',image:true},{role:'user',text:'任务提示词，16:9，15s，720p'},{role:'assistant',text:'确认后我再开始生成视频'}]);
 assert.equal(state.otherUser,false);assert.equal(state.replies.length,1);assert.equal(state.confirmation,true);
});
test('extra text before prompt is still rejected',()=>assert.equal(read([{role:'user',text:'另一项任务'},{role:'user',text:'任务提示词'}]).otherUser,true));
test('extra image after prompt is still rejected',()=>assert.equal(read([{role:'user',text:'任务提示词'},{role:'user',image:true}]).otherUser,true));
test('own attachment bubble may follow the prompt when references were uploaded',()=>{
 const state=read([{role:'user',text:'任务提示词'},{role:'user',image:true},{role:'assistant',text:'确认后我再开始生成视频'}],{prompt:'任务提示词',attachments:1});
 assert.equal(state.otherUser,false);
 assert.equal(state.confirmation,true);
});
test('empty user bubble without painted images is not an extra message',()=>{
 const state=read([{role:'user',text:''},{role:'user',text:'任务提示词'},{role:'assistant',text:'确认后我再开始生成视频'}],{prompt:'任务提示词',attachments:4});
 assert.equal(state.otherUser,false);
 assert.equal(state.replies.length,1);
});
test('extra text after prompt is still rejected',()=>assert.equal(read([{role:'user',text:'任务提示词'},{role:'user',text:'另外生成一条'}]).otherUser,true));

test('native file-name chips still resolve the anchor and the plan reply',()=>{
 const state=read([
  {role:'user',image:true},
  {role:'user',text:'生成视频：场景：客厅，角色：林辰林辰_封面同款蓝白校服_四视图_v1.png，16:9，15s，720p'},
  {role:'assistant',text:'视频生成参数确认：模型 Seedance 2.0 Mini。确认后我再开始生成视频。'},
 ]);
 assert.ok(state.userKey);
 assert.equal(state.otherUser,false);
 assert.equal(state.replies.length,1);
 assert.equal(state.confirmation,true);
});
test('platform-prefixed confirmation counts as already confirmed',()=>{
 const state=read([
  {role:'user',text:'任务提示词'},
  {role:'assistant',text:'确认后我再开始生成视频。'},
  {role:'user',text:'生成视频：确认，开始生成视频'},
 ]);
 assert.equal(state.confirmationSent,true);
 assert.equal(state.otherUser,false);
});

test('randomized confirmation wording counts as confirmed after platform rewrite',()=>{
 const state=read([
  {role:'user',text:'任务提示词'},
  {role:'assistant',text:'确认后我再开始生成视频。'},
  {role:'user',text:'生成视频：确定，生成视频 16:9 15s'},
 ],{prompt:'任务提示词',taskReplies:['确定，生成视频'],confirmReplies:['确定，生成视频']});
 assert.equal(state.confirmationSent,true);
 assert.equal(state.otherUser,false);
});
test('push reply is a task reply but not a confirmation',()=>{
 const state=read([
  {role:'user',text:'任务提示词'},
  {role:'assistant',text:'我现在无法直接生成视频，可以先帮你写脚本。'},
  {role:'user',text:'请继续，用刚才的描述生成视频'},
 ],{prompt:'任务提示词',taskReplies:['请继续，用刚才的描述生成视频']});
 assert.equal(state.otherUser,false);
 assert.equal(state.confirmationSent,false);
 assert.equal(state.videoUnavailable,true);
});
test('video unavailable is read from the latest reply',()=>{
 const unavailable=read([
  {role:'user',text:'任务提示词'},
  {role:'assistant',text:'抱歉，我目前无法直接生成视频，只能提供文字方案。'},
 ]);
 assert.equal(unavailable.videoUnavailable,true);
 const generating=read([
  {role:'user',text:'任务提示词'},
  {role:'assistant',text:'视频生成中，请稍候。'},
 ]);
 assert.equal(generating.videoUnavailable,false);
});

test('streaming plan mentioning generation costs must not start long generation wait',()=>{ const fs=require('node:fs');const source=fs.readFileSync(require('node:path').join(__dirname,'../src/automation.js'),'utf8');
 const start=source.indexOf('          const awaitingConfirmation=');const end=source.indexOf('          // A playable video',start);
 const updates=[];const ctx={state:{confirmation:true,responding:true,generating:true},task:{},update:value=>updates.push(value),Date};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 assert.equal(updates.length,1);assert.match(updates[0].message,/等待回复完成/);assert.equal(updates[0].nextPollAt,undefined);
});

test('warm-up messages stay ours when the platform re-renders the conversation',()=>{
 const warm=['最近想尝试做点都市情感类的短内容，你觉得现在观众更吃哪种氛围感？简单说两句就行。','那种暖金色调、浅景深的画面是不是更容易让人代入？你平时会怎么把握这种质感？一两句话说说就好。'];
 const rows=[
  {role:'user',text:warm[0]},
  {role:'assistant',text:'都市情感现在最吃香克制留白和日常破碎感。'},
  {role:'user',text:warm[1]},
  {role:'assistant',text:'暖金浅景深要保留暗部层次。'},
  {role:'user',image:true},
  {role:'user',text:'任务提示词'},
  {role:'assistant',text:''},
 ];
 // baseline 里的 key 全部对不上：模拟平台重新挂载消息、data 属性丢失后的情况
 const state=read(rows,{prompt:'任务提示词',baseline:['旧1','旧2','旧3','旧4','旧5'],taskReplies:warm,attachments:6});
 assert.ok(state.userKey);
 assert.equal(state.otherUser,false);
 assert.equal(read(rows,{prompt:'任务提示词',baseline:['旧1','旧2','旧3','旧4','旧5'],attachments:6}).otherUser,true);
});
