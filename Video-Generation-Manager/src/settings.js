'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {ProxyAgent}=require('undici');
const {readJSON,saveJSON}=require('./store');
class Settings {
 constructor(directory){this.directory=path.resolve(directory);this.file=path.join(this.directory,'settings.json');this.value={proxy:{enabled:false,server:'',username:'',password:'',bypass:'localhost,127.0.0.1'},downloadDirectory:'',...readJSON(this.file,{})};this.agent=null;}
 public(){const {password,...proxy}=this.value.proxy;return {proxy:{...proxy,passwordConfigured:Boolean(password)},downloadDirectory:this.value.downloadDirectory||'',downloadsPath:this.downloadsDirectory()};}
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
  return {proxy:p,downloadDirectory};
 }
 async save(value){const old=this.agent;saveJSON(this.file,value);this.value=value;this.agent=null;await old?.close();return this.public();}
 browserProxy(){const p=this.value.proxy;return p.enabled?{server:p.server,bypass:p.bypass,username:p.username||undefined,password:p.password||undefined}:undefined;}
 dispatcher(url){const p=this.value.proxy;if(!p.enabled)return undefined;const host=new URL(url).hostname;const bypass=p.bypass.split(',').map(x=>x.trim()).filter(Boolean);if(bypass.some(x=>x==='*'||host===x||x.startsWith('*.')&&(host===x.slice(2)||host.endsWith(x.slice(1)))))return undefined;
  if(!this.agent)this.agent=new ProxyAgent({uri:p.server,...(p.username||p.password?{token:'Basic '+Buffer.from(p.username+':'+p.password).toString('base64')}:{})});return this.agent;}
 async close(){await this.agent?.close();}
}
module.exports={Settings};
