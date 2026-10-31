'use strict';
const fs=require('node:fs'),path=require('node:path');
const {httpJson,encodeMultipart,mimeFor}=require('../../../src/util');
const CONFIG=require('./workflows.json');
const SITES=CONFIG.sites,SITE_LIST=Object.values(SITES);
function siteOfChannel(ch){const byType=SITE_LIST.find(s=>s.channelType===ch?.type);if(byType)return byType;try{const host=new URL(String(ch?.baseUrl||'')).hostname;return SITE_LIST.find(s=>s.hosts.includes(host))||null;}catch{return null;}}
function base(ch){const site=siteOfChannel(ch);if(!site)throw Error('渠道类型未登记 RunningHub 站点');let u;try{u=new URL(ch.baseUrl||site.baseUrl);}catch{throw Error('RunningHub 渠道地址无效');}const local=['127.0.0.1','localhost'].includes(u.hostname);if(!local&&(u.protocol!=='https:'||!site.hosts.includes(u.hostname)))throw Error(site.label+'渠道地址必须为 '+site.hosts[0]);return u.origin;}
function keys(ch){const raw=Array.isArray(ch?.keys)?ch.keys.join('\n'):String(ch?.apiKey||'');const out=[];for(const part of raw.split(/[\r\n,;]+/)){const key=part.replace(/^Bearer\s+/i,'').trim();if(key&&!out.includes(key))out.push(key);}return out;}
function accountNames(ch){const raw=Array.isArray(ch?.accountNames)?ch.accountNames.join('\n'):String(ch?.options?.accountNames||ch?.accountNames||'');return raw.split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean);}
function accountLabel(ch,index){const names=accountNames(ch);const total=keys(ch).length;const label=names[index]||('账号'+(index+1));return total>1?label+'（'+(index+1)+'/'+total+'）':label;}
function keyAt(ch,index=0){const list=keys(ch);if(!list.length)throw Error('请填写 RunningHub API Key（多账号每行一个）');const i=Number.isInteger(index)&&index>=0&&index<list.length?index:0;return list[i];}
function app(key){const found=CONFIG.apps[key];if(!found)throw Error('RunningHub 应用映射不存在：'+(key||'空'));return found;}
function appsFor(siteId){return Object.entries(CONFIG.apps).filter(([,a])=>a.site===siteId);}
function ratioShort(value){return (String(value||'').match(/\d+:\d+/)||[])[0]||'';}
function redact(ch,message){let text=String(message||'未知错误');for(const key of keys(ch))if(key.length>=8)text=text.split(key).join('[密钥已隐藏]');return text;}
async function request(ch,route,body,options={}){
 const key=keyAt(ch,options.keyIndex);
 try{const res=await httpJson(base(ch)+route,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':options.contentType||'application/json'},body:options.raw?body:JSON.stringify(body),timeoutMs:options.timeoutMs||30000});
 if(!res.ok){const error=Error('RunningHub HTTP '+res.status);error.status=res.status;throw error;}
 const data=res.data;if(!data||typeof data!=='object')throw Error('RunningHub 返回格式异常');return data;
 }catch(e){const err=Error(redact(ch,e.message));err.status=e.status;throw err;}
}
// RunningHub 有两套响应外壳：uc/* 用 {code,msg}，openapi/v2/* 直接扁平返回 {taskId,status,errorCode,errorMessage}
function failure(data){
 if(!data||typeof data!=='object')return null;
 const code=data.errorCode!==undefined&&data.errorCode!==null&&String(data.errorCode)!==''?data.errorCode:data.code;
 if(code===undefined||code===null||String(code)===''||String(code)==='0')return null;
 const message=data.errorMessage||data.msg||data.message||'';
 return {code:String(code),message:String(message)};
}
function check(data){
 const bad=failure(data);
 if(bad)throw Error('RunningHub 拒绝请求，错误码：'+bad.code+(bad.message?'（'+bad.message+'）':''));
}
async function upload(ch,image,keyIndex=0){const file=fs.readFileSync(image.path);const form=encodeMultipart([{name:'file',filename:path.basename(image.name||image.path),mime:mimeFor(image.path),content:file}]);const data=await request(ch,'/openapi/v2/media/upload/binary',form.body,{raw:true,contentType:form.contentType,timeoutMs:120000,keyIndex});check(data);const d=data.data||data;const fileRef=d.download_url||d.url||d.fileUrl||d.fileName||d.file_url;if(!fileRef)throw Error('上传响应缺少文件标识');return String(fileRef);}
function nodeInfo(application,job,uploads){
 const nodes=[{nodeId:String(application.prompt.nodeId),fieldName:application.prompt.fieldName||'text',fieldValue:job.prompt}];
 if(application.duration?.nodeId)nodes.push({nodeId:String(application.duration.nodeId),fieldName:application.duration.fieldName||'value',fieldValue:Number(job.duration)});
 uploads.forEach((ref,i)=>{const slot=(application.images?.nodes||[])[i];if(slot)nodes.push({nodeId:String(slot),fieldName:application.images.fieldName||'image',fieldValue:ref});});
 if(application.aspect?.nodeId){const options=application.aspect.options||[];const short=ratioShort(job.aspectRatio);const pick=options.find(o=>o===job.aspectRatio)||options.find(o=>ratioShort(o)===short)||application.aspect.default;if(pick)nodes.push({nodeId:String(application.aspect.nodeId),fieldName:application.aspect.fieldName||'aspect_ratio',fieldValue:pick});}
 return nodes;
}
async function submit(ch,application,job,uploads,keyIndex=0){const type=ch.options?.instanceType||'default';if(!['default','plus','ultra'].includes(type))throw Error('实例类型必须为 default / plus / ultra');const body={nodeInfoList:nodeInfo(application,job,uploads),instanceType:type};
 const data=await request(ch,'/openapi/v2/run/ai-app/'+encodeURIComponent(application.applicationId),body,{timeoutMs:60000,keyIndex});check(data);const id=data.taskId||data.data?.taskId;
 if(!id){const bad=failure(data);throw Error('RunningHub 未接单（taskId 为空）'+(bad?' · 错误码 '+bad.code+(bad.message?'：'+bad.message:''):'')+'；请先到平台核实，避免重复提交');}
 return {taskId:String(id)};
}
function outputs(data,application){const raw=data.results||data.outputs||[];const list=(Array.isArray(raw)?raw:Object.entries(raw).map(([nodeId,v])=>({...v,nodeId:v.nodeId||nodeId}))).filter(v=>v&&typeof v==='object').map(v=>({url:v.url||v.fileUrl||v.download_url,nodeId:String(v.nodeId||v.node_id||''),type:String(v.outputType||v.fileType||'')})).filter(v=>typeof v.url==='string'&&/^https?:\/\//i.test(v.url)&&(/video|mp4|webm|mov/i.test(v.type)||/\.(mp4|webm|mov)(?:[?#]|$)/i.test(v.url)));
 const final=list.filter(v=>application.finalOutputNode&&v.nodeId===String(application.finalOutputNode));return final.length?final:list.length?[list[list.length-1]]:[];}
async function poll(ch,id,application,keyIndex=0){const raw=await request(ch,'/openapi/v2/query',{taskId:id},{keyIndex});const data=raw.data&&typeof raw.data==='object'?raw.data:raw;const status=String(data.status||data.taskStatus||'UNKNOWN').toUpperCase();const bad=failure(raw)||failure(data);if(['FAILED','ERROR','CANCELLED','CANCELED','NOT_FOUND'].includes(status)||bad){const why=bad?'错误码 '+bad.code+(bad.message?'：'+bad.message:''):'状态 '+status;return {status:'failed',message:'RunningHub 任务失败（'+why+'）'};}
 if(['SUCCESS','SUCCEEDED','COMPLETED'].includes(status))return {status:'success',outputs:outputs(data,application)};
 return {status:['QUEUED','PENDING','WAITING'].includes(status)?'queued':'running',rawStatus:status};}
async function test(ch){
 const list=keys(ch);
 if(!list.length)return {ok:false,message:'请填写 RunningHub API Key（多账号每行一个）'};
 const site=siteOfChannel(ch)?.label||'RunningHub';
 const failures=[];
 for(let i=0;i<list.length;i++){
  try{const d=await request(ch,'/uc/openapi/accountStatus',{apikey:list[i]},{keyIndex:i});check(d);if(!d.data||typeof d.data!=='object')throw Error('账号状态响应缺少数据');}
  catch(e){failures.push('第 '+(i+1)+' 把：'+redact(ch,e.message));}
 }
 if(!failures.length)return {ok:true,message:site+' '+list.length+' 个账号状态查询通过，未提交生成任务'};
 return {ok:false,message:site+' '+(list.length-failures.length)+'/'+list.length+' 个账号可用；'+failures.join('；')};
}
module.exports={base,siteOfChannel,keys,accountNames,accountLabel,keyAt,app,appsFor,ratioShort,upload,nodeInfo,submit,poll,outputs,test,config:CONFIG};
