'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process');const adapter=require('../plugins/video/runninghub-h3'),protocol=require('../plugins/video/runninghub-h3/protocol'),maps=require('../plugins/video/runninghub-h3/workflows.json');
test('RunningHub node mapping preserves exact picture order and final output selection',()=>{
 const refs=maps.wenxi_720p_app.ref_image_nodes.map((_,i)=>'upload-'+i);const nodes=protocol.nodeInfo(maps.wenxi_720p_app,{prompt:'test',duration:10,aspectRatio:'16:9'},refs);
 assert.deepEqual(nodes.filter(n=>n.fieldName==='image').map(n=>n.nodeId),maps.wenxi_720p_app.ref_image_nodes);
 assert.equal(nodes.find(n=>n.fieldName==='aspect_ratio').fieldValue,'16:9 (Widescreen)');
 assert.deepEqual(protocol.outputs({results:[{url:'https://example.com/draft.mp4',nodeId:'1'},{url:'https://example.com/final.mp4',nodeId:'2'}]},{final_output_node:'2'}).map(v=>v.nodeId),['2']);
 assert.equal(adapter.workflows({id:'test',type:'runninghub-h3-cn'}).length,7);
});
test('RunningHub native JS plugin: configure key, upload, submit, poll and download', {timeout:30000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rh-h3-e2e-'));const requests=[];let mockBase;
 const mock=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);let body;try{body=JSON.parse(bytes.toString());}catch{}requests.push({url:req.url,auth:req.headers.authorization,body,bytes});res.setHeader('Content-Type','application/json');if(req.url==='/uc/openapi/accountStatus')return res.end(JSON.stringify({code:0,data:{remainCoins:10}}));if(req.url==='/openapi/v2/media/upload/binary')return res.end(JSON.stringify({code:0,data:{fileName:'uploaded/image.png'}}));if(req.url.startsWith('/openapi/v2/run/ai-app/'))return res.end(JSON.stringify({taskId:'rh-mock'}));if(req.url==='/openapi/v2/query')return res.end(JSON.stringify({status:'SUCCESS',results:[{url:mockBase+'/draft.mp4',nodeId:'1',outputType:'video'},{url:mockBase+'/final.mp4',nodeId:'2',outputType:'video'}]}));res.setHeader('Content-Type','video/mp4');res.end('final-video');});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));mockBase='http://127.0.0.1:'+mock.address().port;
 const child=spawn(process.execPath,[path.join(__dirname,'../src/server.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,WMD_PORT:'19374',WMD_DATA_DIR:path.join(root,'data'),WMD_PROJECT_ROOT:path.join(root,'projects'),WMD_AGENT_AUTOSTART:'0'},stdio:'ignore',windowsHide:true});
 const base='http://127.0.0.1:19374';let token;const call=async(url,body)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{'X-WMD-Internal':token}:{})},body:body?JSON.stringify(body):undefined});return r.json();};
 try{
  const start=Date.now();while(Date.now()-start<15000){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  token=JSON.parse(fs.readFileSync(path.join(root,'data/internal-token.json'),'utf8')).token;
  const channel=await call('/api/channels',{kind:'video',type:'runninghub-h3-cn',name:'RunningHub H3 国内站',baseUrl:mockBase,apiKey:'mock-rh-key'});assert.equal(channel.ok,true,JSON.stringify(channel));
  const checked=await call('/api/channels/'+channel.data.id+'/test',{kind:'video'});assert.equal(checked.data.ok,true,JSON.stringify(checked));
  const state=await call('/api/state');const wf=state.data.workflows.find(w=>w.id==='rh:'+channel.data.id+':wenxi_720p_app');assert.equal(wf.pluginId,'runninghub-h3');
  const upload=await call('/api/upload',{name:'ref.png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='});
  const created=await call('/api/jobs',{workflowId:wf.id,prompt:'人物向前走',images:[{path:upload.data.path,name:'ref.png'}],duration:10,aspectRatio:'16:9'});assert.equal(created.ok,true,JSON.stringify(created));
  let job;const until=Date.now()+10000;while(Date.now()<until){job=(await call('/api/jobs')).data.jobs.find(j=>j.id===created.data.jobs[0].id);if(['success','failed'].includes(job.status))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(job.status,'success',job.error);assert.equal(job.pluginId,'runninghub-h3');assert.equal(job.remotePromptId,'rh-mock');assert.equal(fs.readFileSync(job.outputs[0].path,'utf8'),'final-video');assert.equal(job.outputs.length,1);assert.match(job.outputs[0].url,/final.mp4$/);assert.ok(!JSON.stringify(job).includes('mock-rh-key'));
  const sent=requests.find(r=>r.url.startsWith('/openapi/v2/run/ai-app/'));assert.match(sent.url,/2104543598783057921$/);assert.equal(sent.auth,'Bearer mock-rh-key');assert.equal(sent.body.instanceType,'default');assert.equal(sent.body.nodeInfoList.find(n=>n.nodeId==='526').fieldValue,'uploaded/image.png');assert.equal(requests.filter(r=>r.url.startsWith('/openapi/v2/run/ai-app/')).length,1);
 }finally{child.kill();mock.closeAllConnections();await new Promise(r=>mock.close(r));}
});
