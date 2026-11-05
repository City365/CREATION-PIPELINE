'use strict';
const fs=require('node:fs');
const path=require('node:path');
const config=require('./config');
const crypto=require('node:crypto');
const {store}=require('./workbench-store');
const tenantContext=require('./tenant-context');
const read=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
function importHistory() {
  const db=store();
  // 图像历史已入库（按租户）；只导入当前租户，避免把别的租户的记录带进工作台。
  const imageHistory=require('./image-history');
  for(const batch of imageHistory.list()) {
    db.migrate('image-history:'+batch.id,()=>{
      const id=db.begin({...batch,recordId:'legacy-image:'+batch.id,kind:'image',status:'success'});
      db.finish(id,'success',batch.items||[]);return {count:(batch.items||[]).length};
    });
  }
  const dir=config.load().dataDir||config.DATA;
  // jobs.json 会被新的 jobs 表导入器改名为 jobs.imported.json；两个名字都读，避免旧成片记录漏迁。
  const legacyJobs = read(path.join(dir,'jobs.json'),null) || read(path.join(dir,'jobs.imported.json'),{jobs:[]});
  for(const job of (legacyJobs && legacyJobs.jobs) || []) {
    db.migrate('legacy-job:'+job.id,()=>{db.syncJob(job);return {jobId:job.id};});
  }
}
let imported=false;
const importedTenants = new Set();
function details(file) {
  // 图像历史按租户；每个租户第一次查媒体详情时导入自己的历史。
  const tenant = tenantContext.current() || 'tnt_default';
  if (!importedTenants.has(tenant)) { importHistory(); importedTenants.add(tenant); imported = true; }
  const db=store();let record=db.detail(file);if(record)return record;
  // Legacy video folders have a separate full prompt, not params.prompt.
  const dir=path.dirname(file),params=read(path.join(dir,'params.json'),null);
  if(params) {
    let prompt=params.prompt||'';try{prompt=fs.readFileSync(path.join(dir,'prompt.txt'),'utf8').trimEnd()||prompt;}catch{}
    const id=db.begin({...params,recordId:'legacy-folder:'+dir,kind:'video',prompt,userPrompt:params.userPrompt??prompt,prefixPrompt:params.prefixPrompt,images:(params.refImages||[]).map(p=>({path:p,name:path.basename(p)})),status:'success'});
    db.finish(id,'success',[{path:file,kind:/\.(mp4|webm|mov|mkv)$/i.test(file)?'video':'image'}]);
    record=db.detail(file);
  }
  if(!record&&/\.(png|jpe?g|webp)$/i.test(file)&&fs.existsSync(file)){
    const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const bytes=fs.statSync(file).size,wanted=hash(file),candidates=[];
    const rows=db.open().prepare("SELECT * FROM media_records WHERE kind='image'").all();
    for(const row of rows){try{if(fs.statSync(row.path).size===bytes&&hash(row.path)===wanted)candidates.push(row);}catch{}}
    if(candidates.length===1){db.link(candidates[0].path,file);record=db.detail(file);}
  }
  return record||{kind:/\.(mp4|webm|mov|mkv)$/i.test(file)?'video':'image',snapshot:{},missing:true};
}
function link(src,dest,move=false){details(src);return store().link(src,dest,move);}
module.exports={details,link,importHistory};
