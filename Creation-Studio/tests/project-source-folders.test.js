'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wmd-project-roots-'));
process.env.WMD_DATA_DIR=path.join(dir,'data');process.env.WMD_PROJECT_ROOT=path.join(dir,'legacy');
const projects=require('../src/projects'),workspace=require('../src/workspace');
test('existing folders bind primary and retain ordered extra roots through edits',()=>{
 const a=path.join(dir,'primary'),b=path.join(dir,'reference');fs.mkdirSync(a);fs.mkdirSync(b);fs.writeFileSync(path.join(a,'original.txt'),'original');
 const p=projects.create({name:'多目录',sourceFolders:[a,b,a]});
 assert.deepEqual(p.sourceFolders,[fs.realpathSync(a),fs.realpathSync(b)]);
 assert.equal(workspace.dirFor(p),fs.realpathSync(a));assert.ok(fs.existsSync(path.join(a,'智能体工作区')));
 const edited=projects.update(p.id,{name:'重命名'});assert.deepEqual(edited.sourceFolders,p.sourceFolders);
 assert.equal(projects.publicProject(edited).dir,fs.realpathSync(a));assert.equal(fs.readFileSync(path.join(a,'original.txt'),'utf8'),'original');
});
test('invalid folder input is rejected before project registration',()=>{
 const before=projects.list().length;
 for(const sourceFolders of [['relative'],[path.join(dir,'missing')],[''], 'bad',Array(21).fill(dir)])assert.throws(()=>projects.create({name:'invalid',sourceFolders}));
 assert.equal(projects.list().length,before);
});
test('new project lands in tenant/user/project and keeps the legacy path when it already exists',()=>{const p=projects.create({name:'旧项目'});const dir=workspace.dirFor(p);assert.equal(dir,path.join(workspace.scopeDirFor(p),p.folder),'新项目按 租户/用户/项目 三层放置');const legacy=path.join(workspace.root(),p.folder);fs.mkdirSync(path.join(legacy,'assets'),{recursive:true});assert.equal(workspace.dirFor(p),legacy,'老目录已经存在时继续用它');});
