'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { DatabaseSync } = require('node:sqlite');
const fail = (message, status = 400) => { const e = Error(message); e.status = status; throw e; };
function createStore(file) {
  let db;
  const project = p => String(p || 'default').trim().slice(0, 120) || 'default';
  const kind = k => ['image', 'video'].includes(k) ? k : fail('未知创作台类型');
  function open() {
    if (db) return db;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE name='workbench_items'").get();
    if (!exists) {
      // A consistent SQLite backup also includes committed WAL pages.
      const backup = file + '.before-workbench-' + Date.now() + '.bak';
      db.prepare('VACUUM INTO ?').run(backup);
    }
    db.exec(
      "CREATE TABLE IF NOT EXISTS workbench_schema (version INTEGER PRIMARY KEY);" +
      "INSERT OR IGNORE INTO workbench_schema VALUES(1);" +
      "CREATE TABLE IF NOT EXISTS workbench_items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, position INTEGER NOT NULL, draft_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);" +
      "CREATE INDEX IF NOT EXISTS wb_order ON workbench_items(project_id,kind,position);" +
      "CREATE TABLE IF NOT EXISTS workbench_selection (project_id TEXT NOT NULL, kind TEXT NOT NULL, active_item_id TEXT, PRIMARY KEY(project_id,kind));" +
      "CREATE TABLE IF NOT EXISTS generation_runs (id TEXT PRIMARY KEY, item_id TEXT REFERENCES workbench_items(id), project_id TEXT NOT NULL, kind TEXT NOT NULL, job_id TEXT, status TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at INTEGER NOT NULL, finished_at INTEGER, error TEXT);" +
      "CREATE INDEX IF NOT EXISTS wb_runs ON generation_runs(item_id,created_at);" +
      "CREATE UNIQUE INDEX IF NOT EXISTS wb_job ON generation_runs(job_id) WHERE job_id IS NOT NULL;" +
      "CREATE TABLE IF NOT EXISTS media_records (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES generation_runs(id), kind TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL);" +
      "CREATE TABLE IF NOT EXISTS media_locations (normalized_path TEXT PRIMARY KEY, media_id TEXT NOT NULL REFERENCES media_records(id));" +
      "CREATE TABLE IF NOT EXISTS migration_log (source_key TEXT PRIMARY KEY, imported_at INTEGER NOT NULL, details TEXT NOT NULL);"
    );
    const columns=db.prepare('PRAGMA table_info(generation_runs)').all();
    if(!columns.some(c=>c.name==='execution_json'))db.exec("ALTER TABLE generation_runs ADD COLUMN execution_json TEXT NOT NULL DEFAULT '{}'");
    db.exec('INSERT OR IGNORE INTO workbench_schema VALUES(2)');
    return db;
  }
  let transactionDepth=0;
  const transaction = fn => { if(transactionDepth)return fn(); const d=open();transactionDepth++;  d.exec('BEGIN IMMEDIATE'); try { const r=fn();d.exec('COMMIT');return r; } catch(e) { d.exec('ROLLBACK');throw e; } finally {transactionDepth--;} };
  const decode = r => r && ({id:r.id, projectId:r.project_id, kind:r.kind, title:r.title, position:r.position, draft:JSON.parse(r.draft_json), revision:r.revision, createdAt:r.created_at, updatedAt:r.updated_at, deletedAt:r.deleted_at});
  function get(id, p, k, deleted=false) {
    const r = open().prepare('SELECT * FROM workbench_items WHERE id=? AND project_id=? AND kind=?').get(id,project(p),kind(k));
    if (!r || (!deleted && r.deleted_at)) fail('分镜不存在或不属于当前项目',404);
    return decode(r);
  }
  function list(p,k,deleted=false) {
    const d=open();p=project(p);k=kind(k);
    const items=d.prepare('SELECT * FROM workbench_items WHERE project_id=? AND kind=? AND deleted_at IS '+(deleted?'NOT NULL':'NULL')+' ORDER BY position,created_at').all(p,k).map(decode);
    const selected=d.prepare('SELECT active_item_id FROM workbench_selection WHERE project_id=? AND kind=?').get(p,k)?.active_item_id;
    const version=crypto.createHash('sha256').update(JSON.stringify(items.map(i=>[i.id,i.position,i.revision]))).digest('hex');
    return {items,activeId:items.some(i=>i.id===selected)?selected:items[0]?.id||null,version,initialized:!!d.prepare('SELECT 1 FROM workbench_items WHERE project_id=? AND kind=? LIMIT 1').get(p,k)};
  }
  function create(p,k,input={}) {
    p=project(p);k=kind(k);const d=open();
    const id=crypto.randomUUID(),now=Date.now();
    const position=Number(d.prepare('SELECT MAX(position) AS n FROM workbench_items WHERE project_id=? AND kind=?').get(p,k).n||0)+1;
    const title=String(input.title||(k==='video'?'分镜 ':'画面 ')+String(position).padStart(3,'0')).trim().slice(0,120);
    d.prepare('INSERT INTO workbench_items(id,project_id,kind,title,position,draft_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,p,k,title,position,JSON.stringify(input.draft||{}),now,now);
    return get(id,p,k);
  }
  function update(id,p,k,input) {
    const old=get(id,p,k,true);
    if(input.revision!==old.revision) fail('分镜已被其他页面更新，本地内容已保留，请刷新或另存',409);
    const title=input.title===undefined?old.title:String(input.title).trim().slice(0,120);
    if(!title) fail('名称不能为空');
    const draft=input.draft===undefined?old.draft:input.draft;
    const deleted=input.deleted===undefined?old.deletedAt:input.deleted?Date.now():null;
    const result=open().prepare('UPDATE workbench_items SET title=?,draft_json=?,deleted_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(title,JSON.stringify(draft),deleted,Date.now(),id,old.revision);
    if(!result.changes) fail('分镜更新冲突',409);
    return get(id,p,k,true);
  }
  function reorder(p,k,ids,version) {
    return transaction(()=>{
      const current=list(p,k);
      if(current.version!==version) fail('目录已更新，请刷新后重新排序',409);
      if(!Array.isArray(ids)||ids.length!==current.items.length||new Set(ids).size!==ids.length||ids.some(id=>!current.items.some(i=>i.id===id))) fail('排序必须包含当前项目全部分镜且不能重复');
      const stmt=open().prepare('UPDATE workbench_items SET position=?,revision=revision+1 WHERE id=?');
      ids.forEach((id,i)=>stmt.run(i+1,id));return list(p,k);
    });
  }
  function select(p,k,id) {
    if(id)get(id,p,k);
    open().prepare('INSERT INTO workbench_selection VALUES(?,?,?) ON CONFLICT(project_id,kind) DO UPDATE SET active_item_id=excluded.active_item_id').run(project(p),kind(k),id||null);
    return {activeId:id};
  }
  // Explicit allow-list prevents credentials or provider response blobs entering snapshots.
  function snapshot(input) {
    const out={};
    for(const key of ['pluginId','pluginVersion','eventId','eventItemId','prompt','userPrompt','submittedPrompt','prefixPrompt','styleLayer','imageRatio','imageLayoutId','layoutPrompt','channelId','channelName','model','provider','workflowId','styleId','size','quality','count','duration','resolution','aspectRatio','seed','megapixels','megapixels2','tab','source','referenceBindings']) if(input[key]!==undefined)out[key]=input[key];
    for(const key of ['images','refs','audios','videos']) if(Array.isArray(input[key])) out[key]=input[key].filter(Boolean).map((v,i)=>({path:v.path,name:v.name,subject:v.subject||'',ordinal:i+1,assetFingerprint:v.assetFingerprint}));
    return out;
  }
  function begin(input) {
    if(input.itemId)get(input.itemId,input.projectId,input.kind);
    const id=input.recordId||crypto.randomUUID();
    open().prepare('INSERT OR IGNORE INTO generation_runs(id,item_id,project_id,kind,job_id,status,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,input.itemId||null,project(input.projectId||'unassigned'),kind(input.kind),input.jobId||null,input.status||'running',JSON.stringify(snapshot(input)),input.createdAt||Date.now());
    return id;
  }
  const normalizePath=p=>{const value=path.resolve(p);return process.platform==='win32'?value.toLowerCase():value;};
  function register(runId, items) {
    const d=open();
    for(const item of items||[]) {
      if(!item.path)continue;
      const location=normalizePath(item.path);
      const existing=d.prepare('SELECT media_id FROM media_locations WHERE normalized_path=?').get(location);
      if(existing)continue;
      const id=crypto.randomUUID();
      d.prepare('INSERT INTO media_records VALUES(?,?,?,?,?,?)').run(id,runId,item.kind||item.type||'image',path.resolve(item.path),item.name||path.basename(item.path),Date.now());
      d.prepare('INSERT INTO media_locations VALUES(?,?)').run(location,id);
    }
  }
  function finish(id,status,items=[],error=null) {
    transaction(()=>{open().prepare('UPDATE generation_runs SET status=?,finished_at=?,error=? WHERE id=?').run(status,['success','failed','canceled'].includes(status)?Date.now():null,error&&String(error),id);register(id,items);});
  }
  function runs(itemId,p,k) {
    get(itemId,p,k,true);
    return open().prepare('SELECT * FROM generation_runs WHERE item_id=? ORDER BY created_at DESC LIMIT 100').all(itemId).map(r=>({...r,snapshot:{...JSON.parse(r.snapshot_json),...JSON.parse(r.execution_json||'{}')},outputs:open().prepare('SELECT * FROM media_records WHERE run_id=?').all(r.id)}));
  }
  function detail(file) {
    const r=open().prepare('SELECT m.*,r.item_id,r.project_id,r.kind AS run_kind,r.snapshot_json,r.execution_json,r.status,r.created_at AS generated_at FROM media_locations l JOIN media_records m ON m.id=l.media_id JOIN generation_runs r ON r.id=m.run_id WHERE l.normalized_path=?').get(normalizePath(file));
    if(!r)return null;
    const item=r.item_id&&open().prepare('SELECT title,deleted_at FROM workbench_items WHERE id=?').get(r.item_id);
    return {mediaId:r.id,runId:r.run_id,itemId:r.item_id,projectId:r.project_id,kind:r.run_kind,snapshot:{...JSON.parse(r.snapshot_json),...JSON.parse(r.execution_json||'{}')},status:r.status,createdAt:r.generated_at,title:item?.title||'',deleted:!!item?.deleted_at};
  }
  function link(src,dest,move=false) {
    const d=open();const row=d.prepare('SELECT media_id FROM media_locations WHERE normalized_path=?').get(normalizePath(src));
    if(!row)return false;
    transaction(()=>{d.prepare('INSERT OR REPLACE INTO media_locations VALUES(?,?)').run(normalizePath(dest),row.media_id);if(move&&normalizePath(src)!==normalizePath(dest))d.prepare('DELETE FROM media_locations WHERE normalized_path=?').run(normalizePath(src));});return true;
  }
  function migrate(key,fn) {
    if(open().prepare('SELECT 1 FROM migration_log WHERE source_key=?').get(key))return;
    return transaction(()=>{const result=fn();open().prepare('INSERT INTO migration_log VALUES(?,?,?)').run(key,Date.now(),JSON.stringify(result||{}));return result;});
  }
  function legacyDraft(p) {
    return migrate('studio-state:'+project(p),()=>{
      const d=open();if(!d.prepare("SELECT name FROM sqlite_master WHERE name='studio_state'").get())return;
      const row=d.prepare('SELECT data FROM studio_state WHERE project=?').get(project(p));
      if(row)create(p,'video',{title:'原视频工作台',draft:JSON.parse(row.data)});
    });
  }
  function syncJob(job) {
    const id=job.runId||begin({...job,kind:'video',jobId:job.id,recordId:'job:'+job.id,status:job.status});
    finish(id,job.status,job.outputs||[],job.error);return id;
  }
  function execution(id,data) { const value={};if(data.submittedPrompt)value.submittedPrompt=String(data.submittedPrompt);if(Array.isArray(data.referenceBindings))value.referenceBindings=data.referenceBindings; if(Object.keys(value).length)open().prepare('UPDATE generation_runs SET execution_json=? WHERE id=?').run(JSON.stringify(value),id); }
  function report(){const media=open().prepare('SELECT id,name FROM media_records').all();const missingFiles=media.filter(m=>!open().prepare('SELECT normalized_path FROM media_locations WHERE media_id=?').all(m.id).some(l=>fs.existsSync(l.normalized_path))).map(m=>m.name);return {missingFiles,items:open().prepare('SELECT project_id AS projectId,kind,COUNT(*) AS count FROM workbench_items GROUP BY project_id,kind').all(),runs:open().prepare('SELECT project_id AS projectId,kind,COUNT(*) AS count FROM generation_runs GROUP BY project_id,kind').all(),migrations:open().prepare('SELECT * FROM migration_log ORDER BY imported_at DESC LIMIT 200').all()};}
  return {execution,report,open,list,get,create,update,reorder,select,begin,finish,runs,detail,link,migrate,legacyDraft,syncJob,snapshot,close:()=>{db?.close();db=null;}};
}
let singleton;
function store(){return singleton||(singleton=createStore(path.join(config.load().dataDir||config.DATA,'studio.db')));}
module.exports={createStore,store};
