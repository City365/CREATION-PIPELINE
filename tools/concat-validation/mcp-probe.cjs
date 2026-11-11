const {spawn}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const out=process.env.CONCAT_VALIDATION_OUTPUT?path.resolve(root,process.env.CONCAT_VALIDATION_OUTPUT):path.join(root,'outputs/concat-validation');fs.mkdirSync(out,{recursive:true});
const binary=process.env.CONCAT_VALIDATION_BIN||'D:/notebook/software/Concat/concat.exe';
const depsBin=path.join(root,'outputs/concat-validation/deps/ffmpeg/ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-shared-8.1/bin');
const appdata=path.join(out,'runtime/roaming'),localdata=path.join(out,'runtime/local');
fs.mkdirSync(appdata,{recursive:true});fs.mkdirSync(localdata,{recursive:true});
const child=spawn(binary,['--mcp','headless'],{shell:false,windowsHide:true,env:{...process.env,APPDATA:appdata,LOCALAPPDATA:localdata,PATH:depsBin+path.delimiter+process.env.PATH,CONCAT_MCP_ROOTS:path.resolve(out)}});
let buffer='',id=0;const pending=new Map();let stderr='';
child.stdout.on('data',chunk=>{buffer+=chunk;let p;while((p=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,p);buffer=buffer.slice(p+1);try{const m=JSON.parse(line);if(pending.has(m.id)){const r=pending.get(m.id);pending.delete(m.id);clearTimeout(r.timer);r.resolve(m)}}catch{}}});
child.stderr.on('data',c=>stderr+=c);child.on('error',e=>{for(const r of pending.values()){clearTimeout(r.timer);r.reject(e)}pending.clear()});
function request(method,params){return new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('Timeout: '+method))},45000);pending.set(n,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n')})}
const transcript=[];
async function call(name,args={}){const r=await request('tools/call',{name,arguments:args});transcript.push({name,args,response:r});fs.writeFileSync(path.join(out,'e2e-transcript.json'),JSON.stringify(transcript,null,2));if(r.error||r.result?.isError)throw Error(name+': '+JSON.stringify(r));const data=r.result?.structuredContent||JSON.parse(r.result.content.find(c=>c.type==='text').text);console.log(name,JSON.stringify(data).slice(0,1400));return data}
async function e2e(){
 const assert=require('node:assert/strict');
 const name='验证工程-'+Date.now(),project=path.join(out,name);
 await call('project_create',{location:out,name,video:{width:640,height:360,rateNum:24,rateDen:1}});
 await call('media_import',{path:project,file:path.resolve(__dirname,'../../Creation-Studio/web/skins/real-cafe.mp4')});
 const t=await call('timeline_read',{path:project});fs.writeFileSync(path.join(out,'last-project.txt'),project);
 if(!process.argv.includes('--render')){await call('project_close',{path:project,save:true});return}
 const media=t.media?.[0]?.id;assert(media,'Imported media must have an ID');
 const added=await call('clips_add_sequence',{path:project,mediaIds:[media,media],start:0});
 const clipId=added.timeline.clips[0].id;assert.equal(added.timeline.duration,12);
 const trimmed=await call('clip_trim',{path:project,clipId,edge:'end',delta:-2,ripple:true});
 assert.equal(trimmed.timeline.duration,10);assert.equal(trimmed.timeline.clips[1].start,4);
 const undone=await call('edit_undo',{path:project});assert.equal(undone.timeline.duration,12);
 const redone=await call('edit_redo',{path:project});assert.equal(redone.timeline.duration,10);
 const audio=await call('media_import',{path:project,file:path.resolve(__dirname,'../../Creation-Studio/web/skins/quiet-piano.wav')});
 const a=await call('clips_add_sequence',{path:project,mediaIds:[audio.createdId],start:0});
 const ac=a.timeline.clips.find(c=>c.media===audio.createdId);assert(ac);
 if(ac.duration>10)await call('clip_trim',{path:project,clipId:ac.id,edge:'end',delta:10-ac.duration});
 const gain=await call('clip_update',{path:project,clipId:ac.id,patch:{volume:.25}});
 assert.equal(gain.timeline.clips.find(c=>c.id===ac.id).volume,.25);
 await call('captions_add',{path:project,captions:[{start:.5,end:3,text:'智能剪辑 · 首轮验证'},{start:4.5,end:8,text:'时间线裁剪与音乐混音'}],style:{fontFamily:'Microsoft YaHei',fontSize:.07}});
 await call('project_save',{path:project});
 await call('preview_frame',{path:project,time:1,output:path.join(out,'preview.png'),width:640,height:360});
 const job=await call('export_start',{path:project,output:path.join(out,'sample.mp4'),width:640,height:360,preset:'ultrafast'});
 const done=await call('export_wait',{job:job.job,timeout:40});assert.equal(done.state,'done');
 await call('project_close',{path:project,save:true});
 const reopened=await call('project_open',{path:project});assert.equal(reopened.timeline.duration,10);assert.equal(reopened.timeline.clips.length,5);
 await call('timeline_read',{path:project});await call('project_close',{path:project,save:true});
 fs.writeFileSync(path.join(out,'assertions.json'),JSON.stringify({passed:true,checks:['12s sequence','ripple trim to 10s','second clip moved to 4s','undo to 12s','redo to 10s','music gain applied','two Chinese captions','preview generated','export done','save reopen retains 5 clips and 10s']},null,2));
}
async function main(){try{const init=await request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'creation-pipeline-validation',version:'0.1'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');const listed=await request('tools/list',{});fs.writeFileSync(path.join(out,'mcp-discovery.json'),JSON.stringify({init,listed},null,2));console.log('MCP initialized; tools:',listed.result?.tools?.length);const ver=await request('tools/call',{name:'concat_version',arguments:{}});fs.writeFileSync(path.join(out,'installed-version.json'),JSON.stringify(ver,null,2));if(process.argv.includes('--e2e'))await e2e();}finally{child.stdin.end();setTimeout(()=>child.kill(),1500);fs.writeFileSync(path.join(out,'mcp-stderr.log'),stderr)}}
main().catch(e=>{console.error(e.message);process.exitCode=1});
