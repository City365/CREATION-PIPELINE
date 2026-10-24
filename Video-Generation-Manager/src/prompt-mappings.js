'use strict';
const path=require('node:path');const {readJSON,saveJSON}=require('./store');
const defaults={version:1,languages:{Chinese:'中文',English:'英文',Korean:'韩文',Japanese:'日文'},rules:[
 {id:'speaker',name:'说话人 (S1)',enabled:true,doubao:'<Picture {n}>说：',gemini:'图{n}中的人物说：'},
 {id:'dialogue',name:'对白 <d>[语言]台词</d>',enabled:true,doubao:'（{language}）{text}',gemini:'（{language}）{text}'},
 {id:'voiceover',name:'男声／女声画外音',enabled:true,doubao:'（{language}，{voice}画外音）{text}',gemini:'（{language}，{voice}画外音）{text}'},
 {id:'shot',name:'镜头 [Shot 1]',enabled:true,doubao:'Shot {n}：',gemini:'Shot {n}：'},
 {id:'reference',name:'主体及图片引用',enabled:true,doubao:'<Picture {n}>',gemini:'图{n}'}]};
function validate(value){
 if(!value||!Array.isArray(value.rules)||value.rules.length!==5)throw new Error('必须包含五类映射规则');
 const ids=new Set();for(const rule of value.rules){
  if(!defaults.rules.some(r=>r.id===rule.id)||ids.has(rule.id))throw new Error('规则编号无效或重复');ids.add(rule.id);
  if(typeof rule.enabled!=='boolean')throw new Error('启用状态必须为布尔值');
  for(const platform of ['doubao','gemini'])if(typeof rule[platform]!=='string'||rule[platform].length>500)throw new Error('转换模板必须为500字以内文本');
  if(['speaker','reference','shot'].includes(rule.id)&&rule.enabled)for(const p of ['doubao','gemini'])if(!rule[p].includes('{n}'))throw new Error('编号规则必须保留 {n}');
  if(['dialogue','voiceover'].includes(rule.id)&&rule.enabled)for(const p of ['doubao','gemini'])if(!rule[p].includes('{text}'))throw new Error('对白与画外音必须保留 {text}');
 }
 if(!value.languages||typeof value.languages!=='object'||Array.isArray(value.languages)||Object.entries(value.languages).some(([k,v])=>! /^[A-Za-z]{1,30}$/.test(k)||typeof v!=='string'||!v||v.length>40))throw new Error('语言映射格式无效');
 return {version:1,languages:{...value.languages},rules:value.rules.map(r=>({id:r.id,name:defaults.rules.find(d=>d.id===r.id).name,enabled:r.enabled,doubao:r.doubao,gemini:r.gemini}))};
}
function convert(text,platform,config=defaults){
 if(!['doubao','gemini'].includes(platform))return {text,warnings:[]};
 const rules=Object.fromEntries(config.rules.map(r=>[r.id,r]));const warnings=[];
 const format=(id,vars,original)=>{const r=rules[id];if(!r.enabled)return original;return r[platform].replace(/\{(n|language|text|voice)\}/g,(_,k)=>vars[k]??'');};
 // Collapse redundant Subject + speaker references before expanding either one.
 if(rules.reference.enabled&&rules.speaker.enabled)text=text.replace(/<Subject\s+(\d+)>\s*\(S\1\)/gi,'(S$1)');
 text=text.replace(/(?:\(S(\d+)\)\s*)?<d>\s*\[([A-Za-z]+)\]([\s\S]*?)<\/d>/gi,(original,n,language,body)=>{
  const lang=config.languages[language]||language;if(!config.languages[language])warnings.push('未配置语言：'+language);
  const voice=body.match(/^\s*[（(]((?:男声|女声)?画外音)[）)]\s*/);
  if(voice){if(!rules.voiceover.enabled)return original;return format('voiceover',{language:lang,voice:voice[1].replace('画外音',''),text:body.slice(voice[0].length)},original);}
  const dialogue=format('dialogue',{language:lang,text:body},'<d>['+language+']'+body+'</d>');
  return (n?format('speaker',{n},'(S'+n+')'):'')+dialogue;
 });
 text=text.replace(/\(S(\d+)\)/g,(m,n)=>format('speaker',{n},m));
 text=text.replace(/<Subject\s+(\d+)>|<Picture\s+(\d+)>|@(?:图片|图)\s*(\d+)/gi,(m,a,b,c)=>{
  // Gemini leaves existing Picture/@ forms intact; Subject must become an explicit image reference.
  if(platform==='gemini'&&!a)return m;
  return format('reference',{n:a||b||c},m);
 });
 text=text.replace(/\[Shot\s+(\d+)\]/gi,(m,n)=>format('shot',{n},m));
 if(/<d>|<Subject|\(S\d+\)/.test(text))warnings.push('仍有未转换标签，请检查启用状态或标签格式');
 return {text,warnings:[...new Set(warnings)]};
}
function createMappings(directory){const file=path.join(directory,'prompt-mappings.json');return {get:()=>validate(readJSON(file,defaults)),save:value=>{const result=validate(value);saveJSON(file,result);return result;},convert(text,platform){const config=this.get();return {...convert(text,platform,config),config};}};}
module.exports={defaults,validate,convert,createMappings};
