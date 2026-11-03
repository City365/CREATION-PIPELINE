const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
const code=source.slice(source.indexOf('function askRecordLiveTool('),source.indexOf('function askApplyEvent('));
const {askRecordTrajectory,askRecordLiveTool}=new Function(code+';return {askRecordTrajectory,askRecordLiveTool}')();
test('streamed reasoning is replaced by durable record without duplication',()=>{
 const msg={};askRecordTrajectory(msg,{item:{id:'r',kind:'reasoning',content:'part'}});
 askRecordTrajectory(msg,{item:{id:'r',kind:'reasoning',content:'complete',seq:2}});
 assert.equal(msg.liveTrajectory.length,1);assert.equal(msg.liveTrajectory[0].content,'complete');
 askRecordLiveTool(msg,{type:'tool_call',tool:'read',tool_call_id:'t'});
 assert.equal(msg.liveTrajectory.length,1);assert.equal(msg.liveTools.length,1);
});
