'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),fs=require('node:fs');
const {pickFolder}=require('../src/folder-picker');
test('native picker preserves absolute directory and never invokes a shell',async()=>{
 const result=await pickFolder({execFile:(exe,args,options,done)=>{assert.equal(options.shell,false);assert.match(args[0],/pick-folder.py$/);done(null,JSON.stringify({path:os.tmpdir()}));}});
 assert.equal(result.path,fs.realpathSync(os.tmpdir()));assert.equal(result.cancelled,false);
});
test('cancel is successful and does not add a root',async()=>{assert.deepEqual(await pickFolder({execFile:(e,a,o,done)=>done(null,'{"path":"","cancelled":true}')}),{path:'',cancelled:true});});
test('invalid response and process failure are handled',async()=>{
 await assert.rejects(pickFolder({execFile:(e,a,o,done)=>done(null,'bad')}),/无法读取/);
 await assert.rejects(pickFolder({execFile:(e,a,o,done)=>done(Error('failed'),'')}),/未完成/);
});
