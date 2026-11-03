const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const render = source.slice(source.indexOf('function askTraceRows('), source.indexOf('function askFilesHtml('));
const record = source.slice(source.indexOf('function askRecordLiveTool('), source.indexOf('function askApplyEvent('));
const box = {};
new Function('module', 'const esc=String; const askMarkdown=String; '+render+record+'; module.exports={askRecordLiveTool,askTraceHtml};')(box);
const {askRecordLiveTool,askTraceHtml}=box.exports;
test('tool starts and completes visibly before task completion',()=>{
 const msg={execution:{id:'run',status:'running',tools:[]},_streaming:true};
 askRecordLiveTool(msg,{type:'tool_call',tool:'web_search',tool_call_id:'a',detail:'搜索官方文档'});
 let html=askTraceHtml(msg,true);
 assert.match(html,/ask-trace-body/); assert.match(html,/web_search/); assert.match(html,/执行中/);
 askRecordLiveTool(msg,{type:'tool_result',tool:'web_search',tool_call_id:'a',ok:true});
 html=askTraceHtml(msg,true); assert.match(html,/已完成/); assert.equal(msg.execution.status,'running');
});
test('parallel same-name tools pair by call id and replayed starts do not duplicate',()=>{
 const msg={};
 for(const id of ['a','b','a'])askRecordLiveTool(msg,{type:'tool_call',tool:'web_fetch',tool_call_id:id});
 askRecordLiveTool(msg,{type:'tool_result',tool:'web_fetch',tool_call_id:'b',ok:false});
 assert.equal(msg.liveTools.length,2);assert.equal(msg.liveTools[0].status,'running');assert.equal(msg.liveTools[1].status,'failed');
});
test('complete loaded trajectory replaces live rows without duplicate lists',()=>{
 const msg={execution:{id:'r',status:'completed'},liveTools:[{name:'web_search',status:'success'}],trajectory:[{role:'assistant',tool_calls:[{name:'web_search',arguments:{}}]}],traceOpen:true};
 const html=askTraceHtml(msg,false);assert.match(html,/ask-trace-rows/);assert.doesNotMatch(html,/ask-tool-runs/);
});
