'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
let pending=null;
function pickFolder(options={}) {
  if(pending)return pending;
  const local=path.join(__dirname,'../agent_backend/.venv/Scripts/python.exe');
  const python=options.python||process.env.WMD_PYTHON||(fs.existsSync(local)?local:'D:/notebook/AIGC/ml-engineer/backend/.venv/Scripts/python.exe');
  const run=options.execFile||execFile;
  pending=new Promise((resolve,reject)=>{
    run(python,[path.join(__dirname,'../scripts/pick-folder.py')],{shell:false,windowsHide:true,encoding:'utf8',timeout:300000,maxBuffer:16384},(err,stdout)=>{
      if(err)return reject(new Error('系统文件夹选择框未完成，请重试'));
      try{
        const result=JSON.parse(stdout.trim());
        if(!result.path)return resolve({path:'',cancelled:true});
        if(!path.isAbsolute(result.path))throw Error('invalid path');
        const selected=fs.realpathSync(result.path);
        if(!fs.statSync(selected).isDirectory())throw Error('not a folder');
        resolve({path:selected,cancelled:false});
      }catch{return reject(new Error('无法读取所选文件夹'));}
    });
  }).finally(()=>{pending=null;});
  return pending;
}
module.exports={pickFolder};
