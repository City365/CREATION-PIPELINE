'use strict';
const fs=require('node:fs'),path=require('node:path');
const {httpJson,encodeMultipart,mimeFor}=require('../../../src/util');
function base(ch){const u=new URL(ch.baseUrl||'https://www.runninghub.cn');const local=['127.0.0.1','localhost'].includes(u.hostname);if(!local&&(!['www.runninghub.cn','runninghub.cn'].includes(u.hostname)||u.protocol!=='https:'))throw Error('RunningHub 国内站渠道地址必须为 runninghub.cn');return u.origin;}
function secret(ch){return String(ch.apiKey||'').replace(/^Bearer\s+/i,'').trim();}
function redact(ch,message){return String(message||'未知错误').split(secret(ch)||'__empty_key__').join('[密钥已隐藏]');}
async function request(ch,route,body,options={}){
 if(!secret(ch))throw Error('请填写 RunningHub API Key');
 try{const res=await httpJson(base(ch)+route,{method:'POST',headers:{Authorization:'Bearer '+secret(ch),'Content-Type':options.contentType||'application/json'},body:options.raw?body:JSON.stringify(body),timeoutMs:options.timeoutMs||30000});
 if(!res.ok){const error=Error('RunningHub HTTP '+res.status);error.status=res.status;throw error;}
 const data=res.data;if(!data||typeof data!=='object')throw Error('RunningHub 返回格式异常');return data;
 }catch(e){const err=Error(redact(ch,e.message));err.status=e.status;throw err;}
}
function check(data){if(data.code!==undefined&&String(data.code)!=='0')throw Error('RunningHub 拒绝请求，错误码：'+data.code);}
async function upload(ch,image){const file=fs.readFileSync(image.path);const form=encodeMultipart([{name:'file',filename:path.basename(image.name||image.path),mime:mimeFor(image.path),content:file}]);const data=await request(ch,'/openapi/v2/media/upload/binary',form.body,{raw:true,contentType:form.contentType,timeoutMs:120000});check(data);const d=data.data||data;const fileRef=d.download_url||d.url||d.fileUrl||d.fileName||d.file_url;if(!fileRef)throw Error('上传响应缺少文件标识');return String(fileRef);}
function nodeInfo(mapping,job,uploads){
 const nodes=[{nodeId:String(mapping.prompt_node),fieldName:mapping.prompt_field||'text',fieldValue:job.prompt}];
 if(mapping.duration_node)nodes.push({nodeId:String(mapping.duration_node),fieldName:mapping.duration_field||'value',fieldValue:Number(job.duration)});
 uploads.forEach((ref,i)=>nodes.push({nodeId:String(mapping.ref_image_nodes[i]),fieldName:mapping.ref_image_fields?.[i]||mapping.ref_image_field||'image',fieldValue:ref}));
 if(mapping.aspect_ratio_node){const short=(String(job.aspectRatio||'').match(/\d+:\d+/)||[])[0];const ratio=(mapping.aspect_ratio_options||[]).find(r=>r===job.aspectRatio||r.split(' ')[0]===short)||mapping.aspect_ratio_default;if(ratio)nodes.push({nodeId:String(mapping.aspect_ratio_node),fieldName:mapping.aspect_ratio_field||'aspect_ratio',fieldValue:ratio});}
 return nodes;
}
async function submit(ch,mapping,job,uploads){const type=ch.options?.instanceType||'default';if(!['default','plus','ultra'].includes(type))throw Error('实例类型必须为 default / plus / ultra');const body={nodeInfoList:nodeInfo(mapping,job,uploads),instanceType:type};
 const data=await request(ch,'/openapi/v2/run/ai-app/'+encodeURIComponent(mapping.workflow_id),body,{timeoutMs:60000});check(data);const id=data.taskId||data.data?.taskId;if(!id)throw Error('提交响应缺少 taskId；请先到平台核实，避免重复提交');return {taskId:String(id)};
}
function outputs(data,mapping){const raw=data.results||data.outputs||[];const list=(Array.isArray(raw)?raw:Object.entries(raw).map(([nodeId,v])=>({...v,nodeId:v.nodeId||nodeId}))).filter(v=>v&&typeof v==='object').map(v=>({url:v.url||v.fileUrl||v.download_url,nodeId:String(v.nodeId||v.node_id||''),type:String(v.outputType||v.fileType||'')})).filter(v=>typeof v.url==='string'&&/^https?:\/\//i.test(v.url)&&(/video|mp4|webm|mov/i.test(v.type)||/\.(mp4|webm|mov)(?:[?#]|$)/i.test(v.url)));
 const final=list.filter(v=>mapping.final_output_node&&v.nodeId===String(mapping.final_output_node));return final.length?final:list.length?[list[list.length-1]]:[];
}
async function poll(ch,id,mapping){const raw=await request(ch,'/openapi/v2/query',{taskId:id});const data=raw.data&&typeof raw.data==='object'?raw.data:raw;const status=String(data.status||data.taskStatus||'UNKNOWN').toUpperCase();if(['FAILED','ERROR','CANCELLED','CANCELED','NOT_FOUND'].includes(status)||(!['0','undefined'].includes(String(raw.code))))return {status:'failed',message:'RunningHub 任务失败（'+status+' / '+(raw.code??data.errorCode??'')+'）'};
 if(['SUCCESS','SUCCEEDED','COMPLETED'].includes(status))return {status:'success',outputs:outputs(data,mapping)};
 return {status:['QUEUED','PENDING','WAITING'].includes(status)?'queued':'running',rawStatus:status};}
async function test(ch){try{const d=await request(ch,'/uc/openapi/accountStatus',{apikey:secret(ch)});check(d);if(!d.data||typeof d.data!=='object')throw Error('账号状态响应缺少数据');return {ok:true,message:'国内站账号状态查询通过，未提交生成任务'};}catch(e){return {ok:false,message:redact(ch,e.message)};}}
module.exports={base,upload,nodeInfo,submit,poll,test,outputs};
