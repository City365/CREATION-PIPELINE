const {test}=require('node:test');const assert=require('node:assert/strict');
const {referenceParts,bindReferences}=require('../src/adapters/doubao-mentions');
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
  getByRole:()=>({filter:()=>{const option={waitFor:async()=>{},count:async()=>1,click:async()=>{}};option.first=()=>option;return option;}}),
  keyboard:{type:async(text)=>{typed.push(text);}},
 };
 const editor={fill:async()=>{},focus:async()=>{},press:async()=>{},innerText:async()=>'图六.png',locator:()=>({evaluateAll:async()=>[{name:'图六.png',src:'s6'}]})};
 const result=await bindReferences(page,editor,'@图6',files,new AbortController().signal);
 assert.deepEqual(typed,['@','图六']);
 assert.deepEqual(result.bindings,[{picture:6,name:'图六.png'}]);
});
