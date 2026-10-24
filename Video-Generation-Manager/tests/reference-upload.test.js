'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {uploadReferences}=require('../src/automation');
function pageFor(status='Normal', fileName='ref.png') {
  let uploaded=false;const seen=[];
  const page={locator(selector){seen.push(selector);return {first(){return this;},async count(){return selector.includes('input')?1:uploaded?1:0;},async setInputFiles(){uploaded=true;}};},async evaluate(){return uploaded?[{fileName,fileKey:'key',status,uploadPercent:100,width:100,height:100}]:[];}};
  return {page,seen};
}
test('doubao reference upload uses built-in card selector without account overrides',async()=>{
  const {page,seen}=pageFor();
  await uploadReferences(page,['ref.png'],{},new AbortController().signal,'doubao');
  assert.ok(seen.includes('[data-testid="attachment-image-card"]'));
});
test('doubao does not accept incomplete upload even when card is visible',async()=>{
  const {page}=pageFor('Uploading');const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30);
  try {await assert.rejects(uploadReferences(page,['ref.png'],{},controller.signal,'doubao'),{name:'AbortError'});}finally{clearTimeout(timer);}
});
test('doubao does not accept a different uploaded file',async()=>{
  const {page}=pageFor('Normal','other.png');const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30);
  try {await assert.rejects(uploadReferences(page,['ref.png'],{},controller.signal,'doubao'),{name:'AbortError'});}finally{clearTimeout(timer);}
});
test('generic platform still requires explicit completion selectors',async()=>{
  await assert.rejects(uploadReferences({},['ref.png'],{},new AbortController().signal,'fixture'),/attachment和uploading/);
});

const {readAttachmentState}=require('../src/adapters/attachment-state');
const vm=require('node:vm');
test('attachment reader skips stale first-card snapshot after subsequent upload',()=>{
  const a={fileName:'one.png',fileKey:'one',status:'Normal',uploadPercent:100,imageWidth:100,imageHeight:100};
  const b={...a,fileName:'two.png',fileKey:'two'};
  const cards=[{__reactFiberTest:{memoizedProps:{attachmentStates:[a]}}},{__reactFiberTest:{memoizedProps:{attachmentStates:[a,b]}}}];
  const context={document:{querySelectorAll:()=>cards}};vm.createContext(context);
  const result=vm.runInContext('('+readAttachmentState.toString()+')()',context);
  assert.deepEqual(Array.from(result,x=>x.fileName),['one.png','two.png']);
});
test('attachment reader rejects snapshots whose count does not match mounted cards',()=>{
  const context={document:{querySelectorAll:()=>[{__reactFiberTest:{memoizedProps:{attachmentStates:[]}}}]}};
  vm.createContext(context);assert.equal(vm.runInContext('('+readAttachmentState.toString()+')()',context).length,0);
});

test('four images upload sequentially despite older cards keeping shorter snapshots',async()=>{
  const names=['one.png','two.png','three.png','four.png'];const cards=[];
  const page={locator(selector){return {first(){return this;},async count(){return selector.includes('input')?1:cards.length;},async setInputFiles(file){const states=names.slice(0,cards.length+1).map(name=>({fileName:name,fileKey:name,status:'Normal',uploadPercent:100,imageWidth:100,imageHeight:100}));cards.push({__reactFiberTest:{memoizedProps:{attachmentStates:states}}});}};},async evaluate(fn,selector){const context={document:{querySelectorAll:()=>cards},selector};vm.createContext(context);return vm.runInContext('('+fn.toString()+')(selector)',context);}};
  await uploadReferences(page,names,{},new AbortController().signal,'doubao');assert.equal(cards.length,4);
});
