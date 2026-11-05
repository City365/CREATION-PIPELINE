'use strict';
const {store}=require('./workbench-store');
const generation=require('./generation-store');
module.exports=async function(req,res,url,{ok,readBody,mediaPath,scope}) {
  const pathname=url.pathname,method=req.method;
  if(!pathname.startsWith('/api/workbench/')&&pathname!=='/api/media/details')return false;
  // 项目 id 一律过归属校验：传了别人的项目会直接 404，空值落到租户自己的“未归档”桶
  const project=(value)=>(typeof scope==='function'?scope(value):(value||'default'));
  const p=project(url.searchParams.get('projectId')),k=url.searchParams.get('kind')||'video';
  const db=store();
  if(method==='GET'&&pathname==='/api/workbench/migration-report'){generation.importHistory();ok(res,db.report());return true;}
  if(method==='GET'&&pathname==='/api/media/details'){const detail=generation.details(mediaPath(url.searchParams.get('path')||''));const fs=require('node:fs');detail.missingReferences=[...(detail.snapshot.images||detail.snapshot.refs||[]),...(detail.snapshot.audios||[])].filter(r=>r.path&&!fs.existsSync(r.path)).map(r=>r.name||r.path);ok(res,detail);return true;}
  if(pathname==='/api/workbench/items') {
    if(method==='GET'){db.legacyDraft(p);ok(res,db.list(p,k,url.searchParams.get('deleted')==='1'));return true;}
    if(method==='POST'){const b=await readBody(req);ok(res,db.create(project(b.projectId),b.kind,b));return true;}
  }
  if(method==='POST'&&pathname==='/api/workbench/items/reorder'){const b=await readBody(req);ok(res,db.reorder(project(b.projectId),b.kind,b.ids,b.version));return true;}
  if(method==='PUT'&&pathname==='/api/workbench/selection'){const b=await readBody(req);ok(res,db.select(project(b.projectId),b.kind,b.itemId));return true;}
  const m=/^\/api\/workbench\/items\/([^/]+)(?:\/(delete|restore|runs))?$/.exec(pathname);
  if(m) {
    if(method==='GET'){ok(res,m[2]==='runs'?db.runs(m[1],p,k):db.get(m[1],p,k,true));return true;}
    if(method==='PATCH'||method==='POST') {
      const b=await readBody(req);
      ok(res,db.update(m[1],project(b.projectId),b.kind,{...b,...(m[2]?{deleted:m[2]==='delete'}:{})}));return true;
    }
  }
  const e=Error('未知分镜接口');e.status=404;throw e;
};
