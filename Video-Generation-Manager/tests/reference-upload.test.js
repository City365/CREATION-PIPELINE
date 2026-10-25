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
// Builds the committed React tree the current Doubao composer renders: one card
// host per attachment, a card component carrying status/progressPercent, and a
// list wrapper holding attachmentStates for the same DOM order.
function commitCards(cards,states,listStates=states){
  const root={stateNode:null,child:null};root.stateNode={current:root};
  const holder={memoizedProps:{attachmentStates:listStates},return:root,child:null};root.child=holder;
  let previous=null;
  cards.forEach((card,index)=>{
    const state=states[index]||{};
    const host={stateNode:card,return:null};
    const component={memoizedProps:{status:state.status,progressPercent:state.uploadPercent,ariaLabel:state.fileName,
      attachmentState:{fileName:state.fileName,fileKey:state.fileKey,uploadPercent:state.uploadPercent,status:state.status,
        imageWidth:state.imageWidth??state.width,imageHeight:state.imageHeight??state.height,size:state.size}},
      child:host,return:holder};
    host.return=component;
    if(previous)previous.sibling=component;else holder.child=component;
    previous=component;card.__reactFiberTest=host;
  });
  return root;
}
test('attachment reader reads every card from the committed composer',()=>{
  const a={fileName:'one.png',fileKey:'one',status:'Normal',uploadPercent:100,imageWidth:100,imageHeight:100};
  const b={...a,fileName:'two.png',fileKey:'two'};
  const cards=[{},{}];commitCards(cards,[a,b]);
  const context={document:{querySelectorAll:()=>cards}};vm.createContext(context);
  const result=vm.runInContext('('+readAttachmentState.toString()+')()',context);
  assert.deepEqual(Array.from(result,x=>x.fileName),['one.png','two.png']);
});
test('attachment reader rejects snapshots whose count does not match mounted cards',()=>{
  const card={};const root={stateNode:null,child:null};root.stateNode={current:root};
  const host={stateNode:card,return:null};const component={memoizedProps:{},child:host,return:null};host.return=component;
  const holder={memoizedProps:{attachmentStates:[{},{}]},child:component,return:root};component.return=holder;root.child=holder;card.__reactFiberTest=host;
  const context={document:{querySelectorAll:()=>[card]}};vm.createContext(context);assert.equal(vm.runInContext('('+readAttachmentState.toString()+')()',context).length,0);
});

test('four images upload sequentially in the committed composer',async()=>{
  const names=['one.png','two.png','three.png','four.png'];const cards=[];
  const page={locator(selector){return {first(){return this;},async count(){return selector.includes('input')?1:cards.length;},async setInputFiles(){cards.push({});const states=names.slice(0,cards.length).map(name=>({fileName:name,fileKey:name,status:'Normal',uploadPercent:100,imageWidth:100,imageHeight:100}));commitCards(cards,states);}};},async evaluate(fn,selector){const context={document:{querySelectorAll:()=>cards},selector};vm.createContext(context);return vm.runInContext('('+fn.toString()+')(selector)',context);}};
  await uploadReferences(page,names,{},new AbortController().signal,'doubao');assert.equal(cards.length,4);
});

test('uncommitted old tree cannot report a finished upload',()=>{
 // The legacy parent-chain read is gone: when the card only exists in a tree that
 // the committed root does not contain, the reader reports nothing rather than
 // borrowing that tree's Normal snapshot.
 const ready={fileName:'one.png',fileKey:'uploaded',status:'Normal',uploadPercent:100,imageWidth:100,imageHeight:100};
 const root={stateNode:null};root.stateNode={current:root};
 const card={};
 const old={memoizedProps:{status:'Normal',progressPercent:100,ariaLabel:'one.png',attachmentState:ready},return:root};
 card.__reactFiberTest=old;
 const context={document:{querySelectorAll:()=>[card]}};vm.createContext(context);
 assert.equal(vm.runInContext('('+readAttachmentState.toString()+')()',context).length,0);
});

test('committed child graph beats stale parent links and outer props',()=>{
 const ready={fileName:'one.png',fileKey:'ready',status:'Normal',uploadPercent:100,imageWidth:100,imageHeight:100};
 const card={};const currentRoot={stateNode:null,child:null};currentRoot.stateNode={current:currentRoot};const oldRoot={stateNode:currentRoot.stateNode};
 const stale={memoizedProps:{attachmentStates:[{...ready,status:'Uploading',uploadPercent:0,fileKey:''}]},return:oldRoot};card.__reactFiberTest=stale;
 currentRoot.child={memoizedProps:{attachmentStates:[{...ready,status:'Uploading',uploadPercent:45}]},child:{memoizedProps:{attachmentStates:[ready]},child:{stateNode:card,return:oldRoot}}};
 const context={document:{querySelectorAll:()=>[card]}};vm.createContext(context);const result=vm.runInContext('('+readAttachmentState.toString()+')()',context);assert.equal(result[0].status,'Normal');assert.equal(result[0].fileKey,'ready');
});
test('detached cards cannot borrow a completed snapshot from an old tree',()=>{
 const currentRoot={stateNode:null,child:null};currentRoot.stateNode={current:currentRoot};const old={memoizedProps:{attachmentStates:[{fileName:'one.png',status:'Normal',uploadPercent:100,fileKey:'old'}]},return:currentRoot};const context={document:{querySelectorAll:()=>[{__reactFiberTest:old}]}};vm.createContext(context);assert.equal(vm.runInContext('('+readAttachmentState.toString()+')()',context).length,0);
});

test('new composer reads the card own status when wrapper arrays lag at 89 percent',()=>{
 // Current Doubao build: the card component carries status/progressPercent, the
 // attachmentState sits two levels up, and matching attachmentStates arrays live
 // 12+ levels up. A nearer wrapper copy can stay at Uploading/89.
 const fileName='陈择健.png',fileKey='tos-cn-i-a9rns2rl98/abc.png';
 const card={};const root={stateNode:null,child:null};root.stateNode={current:root};
 const cardHost={stateNode:card,return:null};
 const cardComponent={memoizedProps:{status:'Normal',progressPercent:100,ariaLabel:fileName},child:cardHost,return:null};
 const attachmentState={memoizedProps:{attachmentState:{fileName,fileKey,uploadPercent:100,status:'Normal',imageWidth:941,imageHeight:1672,size:2123074}},child:cardComponent,return:null};
 const staleWrapper={memoizedProps:{attachmentStates:[{fileName,status:'Uploading',uploadPercent:89,fileKey:''}]},child:attachmentState,return:null};
 const listHolder={memoizedProps:{attachmentStates:[{fileName,fileKey,uploadPercent:100,status:'Normal',imageWidth:941,imageHeight:1672}]},child:staleWrapper,return:root};
 root.child=listHolder;cardHost.return=cardComponent;cardComponent.return=attachmentState;attachmentState.return=staleWrapper;staleWrapper.return=listHolder;card.__reactFiberTest=cardHost;
 const context={document:{querySelectorAll:()=>[card]}};vm.createContext(context);
 const result=vm.runInContext('('+readAttachmentState.toString()+')()',context);
 assert.equal(result.length,1);assert.equal(result[0].status,'Normal');assert.equal(result[0].uploadPercent,100);assert.equal(result[0].fileKey,fileKey);assert.equal(result[0].width,941);
});
