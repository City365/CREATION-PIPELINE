const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
function load(name,end,extra={}) {
 const start=source.indexOf((name==='askStop'?'async ':'')+'function '+name+'(');
 const context={...extra};vm.createContext(context);
 vm.runInContext(source.slice(start,source.indexOf(end,start)),context);return context;
}
test('error event preserves stream until terminal receipt',()=>{
 let aborted=false;const state={generating:true,controller:{abort(){aborted=true;}}};
 const c=load('askApplyEvent','async function askQueueReply',{askState:()=>state});
 const msg={text:''};c.askApplyEvent(msg,{type:'error',message:'403'});
 assert.equal(aborted,false);assert.equal(state.generating,true);
 c.askApplyEvent(msg,{type:'run_finished',execution:{status:'failed'}});
 assert.equal(msg.execution.status,'failed');assert.equal(msg._streaming,false);
});
test('stop failure keeps generation active and reports failure',async()=>{
 const state={generating:true,request:{sessionId:'s',requestId:'r'},controller:{abort(){throw Error('must not abort');}}};
 const notices=[];const c=load('askStop','async function askChooseCommand',{askState:()=>state,ASK_PROJECT:'wenyun-m-desktop',AbortSignal,fetch:async()=>({ok:false}),toast:(...v)=>notices.push(v)});
 await c.askStop();assert.equal(state.generating,true);assert.equal(state.request.stopping,false);assert.equal(notices[0][1],true);
});
test('stop accepted waits for backend terminal receipt',async()=>{
 const state={generating:true,request:{sessionId:'s',requestId:'r'}};
 const c=load('askStop','async function askChooseCommand',{askState:()=>state,ASK_PROJECT:'wenyun-m-desktop',AbortSignal,fetch:async()=>({ok:true}),toast:()=>{}});
 await c.askStop();assert.equal(state.generating,true);assert.ok(state.request);
});
