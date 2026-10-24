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
