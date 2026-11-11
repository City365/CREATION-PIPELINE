const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'outputs/concat-validation');
const name='源码接口-'+Date.now(),project=path.join(out,name);
const calls=[
 ['version',{}],
 ['project.create',{location:out,name,video:{width:640,height:360,rateNum:24,rateDen:1}}],
 ['media.import',{path:project,file:path.join(root,'Creation-Studio/web/skins/real-cafe.mp4')}],
 ['edit.apply',{path:project,command:{op:'addClip',mediaId:'m1',trackId:'T1',start:0}}],
 ['project.save',{path:project}],
 ['project.close',{path:project,save:true}],
 ['project.open',{path:project}],
 ['project.get',{path:project}],
 ['project.close',{path:project,save:true}]
].map(([method,params],i)=>({jsonrpc:'2.0',id:i+1,method,params}));
const env={...process.env,PATH:path.join(out,'deps/ffmpeg/ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-shared-8.1/bin')+path.delimiter+process.env.PATH};
const r=spawnSync(path.join(root,'Concat/src/target/debug/concat-cli.exe'),['api'],{env,shell:false,windowsHide:true,input:calls.map(c=>JSON.stringify(c)).join('\n')+'\n',encoding:'utf8',timeout:45000,maxBuffer:8e6});
fs.writeFileSync(path.join(out,'source-api-raw.log'),r.stdout||'');fs.writeFileSync(path.join(out,'source-api-stderr.log'),r.stderr||'');
if(r.error)throw r.error;assert.equal(r.status,0);
const replies=r.stdout.trim().split(/\r?\n/).map(s=>JSON.parse(s));assert.equal(replies.length,calls.length);
for(const r of replies)assert(!r.error,JSON.stringify(r.error));
assert.equal(replies[0].result.concat,'0.2.10');
assert.equal(replies[7].result.project.media.length,1);
assert.equal(replies[7].result.project.timelines[0].clips.length,1);
assert.equal(replies[7].result.project.timelines[0].clips[0].duration,6);
fs.writeFileSync(path.join(out,'source-api-results.json'),JSON.stringify({calls,replies},null,2));
console.log('Source CLI API: '+replies.length+' requests passed; saved and reopened '+project);
