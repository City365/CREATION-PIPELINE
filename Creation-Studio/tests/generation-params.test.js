'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');
const params=require('../web/generation-params');const imagegen=require('../src/imagegen');const {PNG}=require('./mock-cloud');
test('四种比例按方向关联分区，分区面积及人物视角保留',()=>{
 for(const ratio of params.ratios){const options=params.available(ratio);assert.ok(options.some(p=>p.id==='free'));assert.ok(options.some(p=>p.id==='custom'));for(const option of options){const text=params.compose({prompt:'用户正文',imageRatio:ratio,imageLayoutId:option.id},'前置词');assert.ok(text.startsWith('前置词\n\n'));assert.ok(text.includes(ratio));assert.ok(text.endsWith('用户正文'));}}
 assert.match(params.layout('wide-character').description,/1\/3/);assert.match(params.layout('wide-character').description,/三个/);assert.match(params.layout('portrait-character').description,/下排占总高度的 2\/3/);assert.match(params.layout('wide-outfit').description,/无伤口/);assert.match(params.layout('portrait-outfit').description,/画框不包含头部/);
 assert.throws(()=>params.instructions({imageRatio:'9:16',imageLayoutId:'wide-character'}),/不匹配/);
 assert.equal(params.compose({prompt:'正文'},''),'正文');assert.match(params.compose({prompt:'正文',imageRatio:'4:3',imageLayoutId:'custom',layoutPrompt:'左格场景，右格道具'},'前置'),/左格场景，右格道具/);
});
test('Gemini 请求同时保留原生比例与分辨率',async()=>{
 let input;const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);input=JSON.parse(Buffer.concat(chunks));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:PNG.toString('base64')}}]}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await imagegen.generate({id:'mock',type:'gemini-image',baseUrl:'http://127.0.0.1:'+server.address().port,model:'mock',apiKey:'test',options:{}},{prompt:'test',imageRatio:'3:4',size:'2K',count:1});assert.equal(input.generationConfig.imageConfig.aspectRatio,'3:4');assert.equal(input.generationConfig.imageConfig.imageSize,'2K');}finally{await new Promise(r=>server.close(r));}
});
