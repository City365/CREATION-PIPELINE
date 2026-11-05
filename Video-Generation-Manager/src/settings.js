'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {ProxyAgent}=require('undici');
const {readJSON,saveJSON}=require('./store');
class Settings {
 constructor(directory){this.directory=path.resolve(directory);this.file=path.join(this.directory,'settings.json');const stored=readJSON(this.file,{});this.value={proxy:{enabled:false,server:'',username:'',password:'',bypass:'localhost,127.0.0.1'},downloadDirectory:'',...stored,interpreter:{enabled:false,protocol:'openai',baseUrl:'',apiKey:'',model:'',timeoutMs:8000,...(stored.interpreter||{})},warmup:{enabled:true,rounds:2,timeoutMs:45000,...(stored.warmup||{})},scheduler:{mode:'web',clientExe:'',pollMs:8000,...(stored.scheduler||{})}};this.agent=null;}
 public(){const {password,...proxy}=this.value.proxy;const {apiKey,...interpreter}=this.value.interpreter||{};const warmup=this.value.warmup||{};const scheduler=this.value.scheduler||{};const remote=this.value.remote||{};return {proxy:{...proxy,passwordConfigured:Boolean(password)},downloadDirectory:this.value.downloadDirectory||'',downloadsPath:this.downloadsDirectory(),interpreter:{...interpreter,apiKeyConfigured:Boolean(apiKey)},warmup:{enabled:Boolean(warmup.enabled),rounds:Number(warmup.rounds)||2,timeoutMs:Number(warmup.timeoutMs)||45000},scheduler:{mode:scheduler.mode==='client'?'client':'web',clientExe:String(scheduler.clientExe||''),pollMs:Number(scheduler.pollMs)||8000},remote:{enabled:Boolean(remote.enabled),studioUrl:String(remote.studioUrl||''),name:String(remote.name||''),tokenConfigured:Boolean(remote.token)}};}
 // 未配置时用数据目录下的 downloads；配置后返回解析过的绝对路径。
 downloadsDirectory(){const raw=String(this.value.downloadDirectory||'').trim();return raw?path.resolve(raw):path.join(this.directory,'downloads');}
 proxyChanged(next){const before=this.value.proxy,after=next?.proxy||{};return ['enabled','server','username','password','bypass'].some(k=>String(before[k]??'')!==String(after[k]??''));}
 validate(input){
  const old=this.value.proxy,p={...old,...input.proxy};
  p.enabled=Boolean(p.enabled);
  for(const k of ['server','username','password','bypass']){if(typeof p[k]!=='string'||p[k].length>2048)throw new Error('代理配置格式无效');if(k!=='password')p[k]=p[k].trim();}
  if(!input.proxy?.password&&!input.proxy?.clearPassword)p.password=old.password;
  if(input.proxy?.clearPassword)p.password='';
  delete p.clearPassword;
  if(p.server){let u;try{u=new URL(p.server);}catch{throw new Error('请填写完整代理地址，例如 http://127.0.0.1:7890');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('代理仅支持 HTTP/HTTPS 地址，账号密码请单独填写');p.server=u.origin;}
  if(p.enabled&&!p.server)throw new Error('启用代理前请填写代理地址');
  let downloadDirectory=this.value.downloadDirectory||'';
  if(input.downloadDirectory!==undefined){
    const value=String(input.downloadDirectory||'').trim();
    if(value.includes('\0')||value.length>1024)throw new Error('下载目录格式无效');
    if(value){
      if(!path.isAbsolute(value))throw new Error('下载目录必须是绝对路径，例如 D:\\成片');
      let stat=null;try{stat=fs.statSync(value);}catch{}
      if(stat&&!stat.isDirectory())throw new Error('这个路径是文件，不是文件夹：'+value);
      if(!stat){try{fs.mkdirSync(value,{recursive:true});}catch(error){throw new Error('无法创建下载目录：'+error.message);}}
      const probe=path.join(value,'.dbm-write-'+process.pid);
      try{fs.writeFileSync(probe,'ok');fs.unlinkSync(probe);}catch(error){throw new Error('下载目录不可写：'+error.message);}
    }
    downloadDirectory=value;
  }
  const oldInterpreter=this.value.interpreter||{};
  const source=input.interpreter||{};
  const i={...oldInterpreter,...source};
  i.enabled=Boolean(i.enabled);
  i.protocol=i.protocol==='anthropic'?'anthropic':'openai';
  i.baseUrl=String(i.baseUrl||'').trim().replace(/\/+$/,'');
  i.model=String(i.model||'').trim();
  i.timeoutMs=Math.max(1000,Math.min(30000,Number(i.timeoutMs)||8000));
  if(source.clearApiKey)i.apiKey='';
  else if(source.apiKey===undefined||source.apiKey==='')i.apiKey=oldInterpreter.apiKey||'';
  else i.apiKey=String(source.apiKey).trim();
  delete i.clearApiKey;
  if(i.baseUrl){
    let u;try{u=new URL(i.baseUrl);}catch{throw new Error('AI 回复理解的 Base URL 格式无效');}
    if(!['http:','https:'].includes(u.protocol))throw new Error('AI 回复理解只支持 HTTP/HTTPS 地址');
  }
  if(i.enabled&&(!i.baseUrl||!i.model||!i.apiKey))throw new Error('启用 AI 回复理解前请填写 Base URL、模型和 API Key');
  const oldWarmup=this.value.warmup||{};
  const sourceWarmup=input.warmup||{};
  const w={...oldWarmup,...sourceWarmup};
  w.enabled=sourceWarmup.enabled===undefined?oldWarmup.enabled!==false:Boolean(sourceWarmup.enabled);
  w.rounds=Math.max(1,Math.min(3,Math.round(Number(w.rounds)||2)));
  w.timeoutMs=Math.max(5000,Math.min(120000,Number(w.timeoutMs)||45000));
  const oldScheduler=this.value.scheduler||{};
  const sourceScheduler=input.scheduler||{};
  const sc={...oldScheduler,...sourceScheduler};
  sc.mode=sourceScheduler.mode==='client'?'client':'web';
  sc.clientExe=String(sc.clientExe||'').trim();
  if(sc.clientExe&&!path.isAbsolute(sc.clientExe))throw new Error('客户端程序路径必须是绝对路径');
  sc.pollMs=Math.max(3000,Math.min(120000,Number(sc.pollMs)||8000));
  const oldRemote=this.value.remote||{};
  const sourceRemote=input.remote||{};
  const r={...oldRemote,...sourceRemote};
  r.enabled=sourceRemote.enabled===undefined?Boolean(oldRemote.enabled):Boolean(sourceRemote.enabled);
  r.studioUrl=String(r.studioUrl||'').trim().replace(/\/+$/,'');
  r.name=String(r.name||'').trim().slice(0,80);
  if(r.studioUrl){
    let u;try{u=new URL(r.studioUrl);}catch{throw new Error('创作台地址格式无效，例如 https://studio.example.com');}
    if(!['http:','https:'].includes(u.protocol))throw new Error('创作台地址只支持 http/https');
    if(u.pathname!=='/'||u.search||u.hash)throw new Error('创作台地址只填到域名（可带端口），不要带路径');
    r.studioUrl=u.origin;
  }
  if(sourceRemote.clearToken)r.token='';
  else if(sourceRemote.token===undefined||sourceRemote.token==='')r.token=oldRemote.token||'';
  else r.token=String(sourceRemote.token).trim();
  delete r.clearToken;
  if(r.enabled&&(!r.studioUrl||!r.token))throw new Error('启用外联前请填写创作台地址和配对令牌');
  return {proxy:p,downloadDirectory,interpreter:i,warmup:w,scheduler:sc,remote:r};
 }
 async save(value){const old=this.agent;saveJSON(this.file,value);this.value=value;this.agent=null;await old?.close();return this.public();}
 browserProxy(){const p=this.value.proxy;return p.enabled?{server:p.server,bypass:p.bypass,username:p.username||undefined,password:p.password||undefined}:undefined;}
 dispatcher(url){const p=this.value.proxy;if(!p.enabled)return undefined;const host=new URL(url).hostname;const bypass=p.bypass.split(',').map(x=>x.trim()).filter(Boolean);if(bypass.some(x=>x==='*'||host===x||x.startsWith('*.')&&(host===x.slice(2)||host.endsWith(x.slice(1)))))return undefined;
  if(!this.agent)this.agent=new ProxyAgent({uri:p.server,...(p.username||p.password?{token:'Basic '+Buffer.from(p.username+':'+p.password).toString('base64')}:{})});return this.agent;}
 async close(){await this.agent?.close();}
}
module.exports={Settings};
