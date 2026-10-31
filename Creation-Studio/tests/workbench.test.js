'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createStore}=require('../src/workbench-store');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wmd-workbench-'));const file=path.join(dir,'studio.db');const s=createStore(file);t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});return {s,file};}
test('分镜按项目和类型隔离，修改冲突、完整排序和软删除恢复',t=>{
 const {s}=setup(t);let a=s.create('p','video',{draft:{prompt:'A',images:[{path:'a.png'}]}}),b=s.create('p','video',{draft:{prompt:'B'}});s.create('p','image');s.create('q','video');
 assert.equal(s.list('p','video').items.length,2);assert.throws(()=>s.get(a.id,'q','video'),/不属于/);
 a=s.update(a.id,'p','video',{revision:a.revision,draft:{prompt:'修改A'}});assert.throws(()=>s.update(a.id,'p','video',{revision:1,draft:{prompt:'覆盖'}}),e=>e.status===409);
 let list=s.list('p','video');assert.throws(()=>s.reorder('p','video',[b.id,b.id],list.version));s.reorder('p','video',[b.id,a.id],list.version);assert.equal(s.list('p','video').items[0].id,b.id);
 assert.throws(()=>s.reorder('p','video',[a.id,b.id],list.version),e=>e.status===409);
 a=s.get(a.id,'p','video');a=s.update(a.id,'p','video',{revision:a.revision,deleted:true});assert.equal(s.list('p','video').items.length,1);assert.equal(s.list('p','video',true).items.length,1);s.update(a.id,'p','video',{revision:a.revision,deleted:false});assert.equal(s.list('p','video').items.length,2);
});
test('生成快照保持原文，复制移动文件仍关联原输入，重启可恢复',t=>{
 const {s,file}=setup(t);const a=s.create('p','image');const prompt='中文台词\n<Picture 1> '+ '长提示词'.repeat(200);const input={itemId:a.id,projectId:'p',kind:'image',prompt,refs:[{path:'a.png',name:'图1'}],apiKey:'secret'};
 const run=s.begin(input);input.prompt='变了';s.finish(run,'success',[{path:path.join(path.dirname(file),'result.png')}]);s.link(path.join(path.dirname(file),'result.png'),path.join(path.dirname(file),'copy.png'));s.link(path.join(path.dirname(file),'copy.png'),path.join(path.dirname(file),'renamed.png'),true);
 assert.equal(s.detail(path.join(path.dirname(file),'renamed.png')).snapshot.prompt,prompt);assert.equal(s.detail(path.join(path.dirname(file),'renamed.png')).snapshot.apiKey,undefined);assert.equal(s.detail(path.join(path.dirname(file),'copy.png')),null);
 s.close();assert.equal(s.get(a.id,'p','image').id,a.id);assert.equal(s.runs(a.id,'p','image')[0].snapshot.prompt,prompt);
});
test('旧工作台迁移幂等，原数据保留',t=>{
 const {s}=setup(t);const db=s.open();db.exec('CREATE TABLE studio_state(project TEXT PRIMARY KEY,data TEXT,updated INTEGER)');db.prepare('INSERT INTO studio_state VALUES(?,?,?)').run('p',JSON.stringify({prompt:'旧稿'}),1);s.legacyDraft('p');s.legacyDraft('p');assert.equal(s.list('p','video').items.length,1);assert.equal(s.list('p','video').items[0].draft.prompt,'旧稿');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM studio_state').get().n,1);
});
