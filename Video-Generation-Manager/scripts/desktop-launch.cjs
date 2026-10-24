'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const directory=path.resolve(__dirname,'..');
async function main(){
  const connectionFile=path.join(directory,'data','connection.json');
  let baseURL='http://127.0.0.1:17778';
  try {const c=JSON.parse(fs.readFileSync(connectionFile,'utf8'));const u=new URL(c.baseURL);if(u.protocol==='http:'&&u.hostname==='127.0.0.1')baseURL=u.origin;}catch{}
  const response=await fetch(baseURL+'/health',{signal:AbortSignal.timeout(1500)}).then(r=>r.json()).catch(()=>null);
  if(response){
    if(response.service!=='doubao-local-manager')throw new Error('启动端口被其他服务占用');
    const config=JSON.parse(fs.readFileSync(connectionFile,'utf8'));
    const opened=await fetch(baseURL+'/api/window/open',{method:'POST',headers:{Authorization:'Bearer '+config.apiToken},signal:AbortSignal.timeout(30000)});
    if(!opened.ok)throw new Error('无法唤起主窗口，请退出旧版服务后重启');
    return;
  }
  fs.mkdirSync(path.join(directory,'evidence'),{recursive:true});
  const log=fs.openSync(path.join(directory,'evidence','service-live.log'),'a');
  try{
    const server=spawn(process.execPath,[path.join(directory,'src','server.js'),'--open'],{cwd:directory,windowsHide:true,detached:true,stdio:['ignore',log,log]});
    await new Promise((resolve,reject)=>{server.once('spawn',resolve);server.once('error',reject);});server.unref();
  }finally{fs.closeSync(log);}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
