'use strict';
const {store}=require('./workbench-store');
const generation=require('./generation-store');
module.exports=async function(req,res,url,{ok,readBody,mediaPath}) {
  const pathname=url.pathname,method=req.method;
  if(!pathname.startsWith('/api/workbench/')&&pathname!=='/api/media/details')return false;
  const p=url.searchParams.get('projectId')||'default',k=url.searchParams.get('kind')||'video';
  const db=store();
  if(method==='GET'&&pathname==='/api/workbench/migration-report'){generation.importHistory();ok(res,db.report());return true;}
  if(method==='GET'&&pathname==='/api/media/details'){const detail=generation.details(mediaPath(url.searchParams.get('path')||''));const fs=require('node:fs');detail.missingReferences=[...(detail.snapshot.images||detail.snapshot.refs||[]),...(detail.snapshot.audios||[])].filter(r=>r.path&&!fs.existsSync(r.path)).map(r=>r.name||r.path);ok(res,detail);return true;}
  if(pathname==='/api/workbench/items') {
    if(method==='GET'){db.legacyDraft(p);ok(res,db.list(p,k,url.searchParams.get('deleted')==='1'));return true;}
    if(method==='POST'){const b=await readBody(req);ok(res,db.create(b.projectId,b.kind,b));return true;}
  }
  if(method==='POST'&&pathname==='/api/workbench/items/reorder'){const b=await readBody(req);ok(res,db.reorder(b.projectId,b.kind,b.ids,b.version));return true;}
  if(method==='PUT'&&pathname==='/api/workbench/selection'){const b=await readBody(req);ok(res,db.select(b.projectId,b.kind,b.itemId));return true;}
  const m=/^\/api\/workbench\/items\/([^/]+)(?:\/(delete|restore|runs))?$/.exec(pathname);
  if(m) {
    if(method==='GET'){ok(res,m[2]==='runs'?db.runs(m[1],p,k):db.get(m[1],p,k,true));return true;}
    if(method==='PATCH'||method==='POST') {
      const b=await readBody(req);
      ok(res,db.update(m[1],b.projectId,b.kind,{...b,...(m[2]?{deleted:m[2]==='delete'}:{})}));return true;
    }
  }
  const e=Error('未知分镜接口');e.status=404;throw e;
};
