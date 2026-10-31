const {test}=require('node:test');const assert=require('node:assert/strict');
const {referenceParts,bindReferences,pickCandidate}=require('../src/adapters/doubao-mentions');
test('Chinese and Picture references use the same upload-order mapping',()=>{
 const parts=referenceParts('甲@图1，乙<Picture 2>，再@图片1',['a.png','b.png']);
 assert.deepEqual(parts.filter(p=>p.index!==undefined).map(p=>p.index),[0,1,0]);
 assert.equal(parts.filter(p=>p.text).map(p=>p.text).join(''),'甲，乙，再');
});
test('out of range references fail before the editor is touched',async()=>{
 await assert.rejects(bindReferences({},null,'@图3',['a.png'],new AbortController().signal),/超出/);
});
test('duplicate filenames fail before editing or sending',async()=>{
 await assert.rejects(bindReferences({},null,'@图1',['x/a.png','y/a.png'],new AbortController().signal),/文件名重复/);
});
test('mention search types the image name so later images also match',async()=>{
 const typed=[];const files=['图一.png','图二.png','图三.png','图四.png','图五.png','图六.png'];
 const cards=files.map((name,i)=>({name,src:'s'+(i+1)}));
 const page={
  locator:()=>({evaluateAll:async()=>cards}),
  getByRole:()=>({filter:()=>{const option={waitFor:async()=>{},allInnerTexts:async()=>['图六.png'],nth:()=>({click:async()=>{}})};option.first=()=>option;return option;}}),
  keyboard:{type:async(text)=>{typed.push(text);}},
 };
 const editor={fill:async()=>{},focus:async()=>{},press:async()=>{},innerText:async()=>'图六.png',locator:()=>({evaluateAll:async()=>[{name:'图六.png',src:'s6'}]})};
 const result=await bindReferences(page,editor,'@图6',files,new AbortController().signal);
 assert.deepEqual(typed,['@','图六']);
 assert.deepEqual(result.bindings,[{picture:6,name:'图六.png'}]);
});

test('similar file names pick the exact candidate instead of failing',()=>{
 assert.equal(pickCandidate(['主管办公室.png','办公室.png'],'办公室.png').index,1);
 assert.equal(pickCandidate(['办公室.png','主管办公室.png'],'办公室.png').index,0);
 assert.equal(pickCandidate(['办公室.png 1.2 MB','主管办公室.png 2.0 MB'],'办公室.png').index,0);
 assert.equal(pickCandidate(['图片 办公室.png'],'办公室.png').index,0);
 assert.equal(pickCandidate(['主管办公室.png'],'办公室.png').index,-1);
 assert.equal(pickCandidate(['a办公室.png','b办公室.png'],'办公室.png').index,-1);
});

test('binding picks the exact file when another name contains it',async()=>{
 const files=['主管办公室.png','办公室.png'];
 const cards=files.map((name,i)=>({name,src:'s'+(i+1)}));
 let clicked=-1;
 const option={waitFor:async()=>{},allInnerTexts:async()=>['主管办公室.png','办公室.png'],nth:i=>({click:async()=>{clicked=i;}})};
 option.first=()=>option;
 const page={locator:()=>({evaluateAll:async()=>cards}),getByRole:()=>({filter:()=>option}),keyboard:{insertText:async()=>{},type:async()=>{}}};
 const editor={fill:async()=>{},focus:async()=>{},press:async()=>{},innerText:async()=>'办公室.png',locator:()=>({evaluateAll:async()=>[{name:'办公室.png',src:'s2'}]})};
 const result=await bindReferences(page,editor,'@图2',files,new AbortController().signal);
 assert.equal(clicked,1);
 assert.deepEqual(result.bindings,[{picture:2,name:'办公室.png'}]);
});
