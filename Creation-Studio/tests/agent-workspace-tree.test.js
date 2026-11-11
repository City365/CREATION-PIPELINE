'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
function app() {
 const state={},calls=[];let renders=0;
 const c={projectId:'p1',sessionId:'s1',projectName:'测试',expanded:false,state:()=>state,render:()=>renders++,toast:()=>{},open:()=>{},apply:v=>Object.assign(state,{previewFile:v.file,previewData:v.data,previewError:v.error}),previewHtml:()=>'<div data-preview>preview</div>',trajectoryHtml:()=>'',loadTrajectory:()=>{}};
 const window={};const context={window,document:{addEventListener(){},querySelector(){return null;}},setTimeout,clearTimeout,URLSearchParams,console,fetch:async(url,options)=>{
  calls.push(url);let body;
  if(url.includes('/tree'))body={rootName:'测试',items:[{name:'文档',relative_path:'文档',kind:'directory'}],nextOffset:null};
  else if(url.endsWith('/preview?sheet=0'))body={kind:'text',content:url.includes('f1')?'one':'two'};
  else body={id:'f1',name:'一.md',relative_path:'文档/一.md'};
  return {ok:true,json:async()=>body};
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../web/agent-workspace.js'),'utf8'),context);
 window.AgentWorkspace.html(c);return {ws:window.AgentWorkspace,c,state,calls};
}
test('workspace opens on a tool start page and loads a file tree on request',async()=>{
 const {ws,c,calls}=app();assert.equal(calls.length,0);assert.match(ws.html(c),/data-aw="files"/);
 await ws.showFiles();const html=ws.html(c);assert.match(html,/role="tree"/);assert.match(html,/文档/);assert.doesNotMatch(html,/agent-file-card/);
});
test('file preview coexists with tree; tabs switch and close without losing other files',async()=>{
 const {ws,c,state}=app();await ws.showFiles();
 await ws.openFile('f1',{id:'f1',name:'一.md',relative_path:'文档/一.md'});
 await ws.openFile('f2',{id:'f2',name:'二.md',relative_path:'文档/二.md'});
 assert.equal(state.previewData.content,'two');assert.match(ws.html(c),/data-preview/);assert.match(ws.html(c),/role="tree"/);
 ws.select('file:f1');assert.equal(state.previewData.content,'one');
 ws.closeCurrent();assert.equal(ws.active().id,'start');
 assert.match(ws.html(c),/二.md/);ws.select('file:f2');assert.equal(state.previewData.content,'two');
});
test('new tab does not discard previews and project switch never displays old tree',async()=>{
 const {ws,c}=app();await ws.openFile('f1',{id:'f1',name:'一.md'});ws.newTab();assert.equal(ws.active().type,'start');assert.match(ws.html(c),/一.md/);
 assert.doesNotMatch(ws.html({...c,projectId:'p2'}),/一.md/);
});

test('workspace starts at 30 percent and resizing persists through tab changes',async()=>{
 const {ws,c}=app();assert.match(ws.html(c),/--aw-width:30%/);assert.match(ws.html(c),/调整工作区宽度/);
 ws.resizeWidth(46);assert.match(ws.html(c),/--aw-width:46%/);
 await ws.showFiles();await ws.openFile('f1',{id:'f1',name:'一.md'});ws.newTab();
 assert.match(ws.html(c),/--aw-width:46%/);assert.match(ws.html(c),/role="tree"/);
 ws.resizeWidth(30);assert.match(ws.html(c),/--aw-width:30%/);
});
test('opening workspace does not collapse history or close the summary',()=>{
 const source=require('./helpers/app-source')();
 const fn=source.slice(source.indexOf('function askOpenWorkspace()'),source.indexOf('function askWorkspaceContext()'));
 const state={historyOpen:true,summaryOpen:true,capabilitiesOpen:false};
 vm.runInNewContext(fn+';askOpenWorkspace();',{askState:()=>state});
 assert.equal(state.historyOpen,true);assert.equal(state.summaryOpen,true);assert.equal(state.capabilitiesOpen,true);
});
