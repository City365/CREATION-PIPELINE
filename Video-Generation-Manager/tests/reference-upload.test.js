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
