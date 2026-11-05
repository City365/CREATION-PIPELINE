'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
let connection, location;
let known=new Map();
function open() {
  const dir = config.DATA || path.join(__dirname, '..', 'data');
  const target = path.join(dir, 'task-events.sqlite');
  if (connection && location === target) return connection;
  if (connection) connection.close();
  fs.mkdirSync(dir, { recursive: true });
  connection = new DatabaseSync(target); location = target; known=new Map();
  connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS task_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,project_id TEXT NOT NULL,tenant_id TEXT NOT NULL DEFAULT \'\',created_at INTEGER NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS task_events_scope ON task_events(project_id,kind,created_at DESC); CREATE TABLE IF NOT EXISTS task_attempts(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,item_id TEXT NOT NULL,created_at INTEGER NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS task_attempt_item ON task_attempts(event_id,item_id,created_at); CREATE TABLE IF NOT EXISTS task_meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS event_trash(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL DEFAULT \'tnt_default\',removed_at INTEGER NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS event_trash_scope ON event_trash(tenant_id,removed_at DESC);');
  // 老库补 tenant_id 列；新建库已经包含。
  if (!connection.prepare('PRAGMA table_info(task_events)').all().some((column) => column.name === 'tenant_id')) {
    connection.exec("ALTER TABLE task_events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''");
  }
  connection.exec('CREATE INDEX IF NOT EXISTS task_events_tenant ON task_events(tenant_id,created_at DESC)');
  backfillTenants(connection);
  if (!connection.prepare("SELECT 1 FROM task_meta WHERE key='legacy-import'").get()) {
    const legacy = path.join(dir, 'events.json');
    let events = [];
    if (fs.existsSync(legacy)) events = JSON.parse(fs.readFileSync(legacy, 'utf8')).events || [];
    write(events);
    connection.prepare('INSERT INTO task_meta(key,value) VALUES(?,?)').run('legacy-import', String(Date.now()));
  }
  importTrash(connection, dir);
  return connection;
}

/** 老事件按项目归属补 tenant_id；一次性标记，避免每次启动扫描。 */
function backfillTenants(db) {
  if (db.prepare("SELECT 1 FROM task_meta WHERE key='tenant-backfill'").get()) return;
  const rows = db.prepare("SELECT id, project_id FROM task_events WHERE tenant_id = ''").all();
  if (rows.length) {
    const projects = require('./db').open();
    const lookup = projects.prepare('SELECT tenant_id FROM projects WHERE id = ?');
    const update = db.prepare('UPDATE task_events SET tenant_id = ? WHERE id = ?');
    for (const row of rows) {
      const hit = row.project_id ? lookup.get(row.project_id) : null;
      update.run((hit && hit.tenant_id) || 'tnt_default', row.id);
    }
  }
  db.prepare('INSERT OR REPLACE INTO task_meta(key,value) VALUES(?,?)').run('tenant-backfill', String(Date.now()));
}

function tenantOfEvent(event, cache) {
  if (event && event.tenantId) return String(event.tenantId);
  const projectId = String((event && event.spec && event.spec.projectId) || '');
  if (!projectId) return 'tnt_default';
  if (cache.has(projectId)) return cache.get(projectId);
  let tenantId = 'tnt_default';
  try {
    const hit = require('./db').open().prepare('SELECT tenant_id FROM projects WHERE id = ?').get(projectId);
    if (hit && hit.tenant_id) tenantId = hit.tenant_id;
  } catch { /* 项目库不可用时按默认租户 */ }
  cache.set(projectId, tenantId);
  return tenantId;
}

/** 旧回收站 events-trash.json 一次性导入；原文件改名，失败保留原文件。 */
function importTrash(db, dir) {
  if (db.prepare("SELECT 1 FROM task_meta WHERE key='trash-import'").get()) return;
  const file = path.join(dir, 'events-trash.json');
  if (!fs.existsSync(file)) {
    db.prepare('INSERT OR REPLACE INTO task_meta(key,value) VALUES(?,?)').run('trash-import', String(Date.now()));
    return;
  }
  let rows;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    rows = raw && Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return; // 保留原文件，下次启动再试
  }
  db.exec('BEGIN');
  try {
    const insert = db.prepare('INSERT OR IGNORE INTO event_trash(id, tenant_id, removed_at, payload) VALUES (?,?,?,?)');
    for (const row of rows) {
      if (!row || !row.event || !row.event.id) continue;
      insert.run(String(row.event.id), 'tnt_default', Number(row.removedAt) || Date.now(), JSON.stringify(row));
    }
    db.prepare('INSERT OR REPLACE INTO task_meta(key,value) VALUES(?,?)').run('trash-import', String(Date.now()));
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
  try { fs.renameSync(file, file.replace(/\.json$/, '.imported.json')); } catch { /* 改名失败不影响数据 */ }
}
function kind(event) { return event.kind || (event.source === 'image' || event.items?.some(i => i.refType === 'imageTask') ? 'image' : 'video'); }
function write(events) {
  const db = connection || open();
  db.exec('BEGIN IMMEDIATE');
  try {
    const upsert = db.prepare('INSERT INTO task_events(id,kind,project_id,tenant_id,created_at,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,project_id=excluded.project_id,tenant_id=excluded.tenant_id,payload=excluded.payload');
    const tenantCache = new Map();
    for(const event of events){const value=JSON.stringify(event);if(known.get(event.id)===value)continue;upsert.run(event.id,kind(event),event.spec?.projectId||'',tenantOfEvent(event,tenantCache),event.createdAt||0,value);known.set(event.id,value);}
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); known.clear(); throw err; }
}
function read() { return open().prepare('SELECT payload FROM task_events ORDER BY created_at DESC,rowid DESC').all().map(r => JSON.parse(r.payload)); }
function attempt(record) { open().prepare('INSERT INTO task_attempts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(record.id,record.eventId,record.itemId,record.createdAt,JSON.stringify(record)); }
function attempts(eventId,itemId,includeLogs=true) { return open().prepare('SELECT payload FROM task_attempts WHERE event_id=? AND item_id=? ORDER BY created_at DESC').all(eventId,itemId).map(r=>{const value=JSON.parse(r.payload);if(!includeLogs)delete value.logs;return value;}); }
function query(filter={}) {
 const conditions=[],args=[];
 if(filter.kind){conditions.push('kind=?');args.push(filter.kind);}
 if(filter.projectId){conditions.push('project_id=?');args.push(filter.projectId);}
 // 租户视角：只查本租户项目下的事件（含空项目，调用方决定要不要带上 ''）
 if(Array.isArray(filter.projectIds)){
   const ids=[...new Set(filter.projectIds.map(v=>String(v==null?'':v)))];
   if(!ids.length)conditions.push('0=1');
   else{conditions.push('project_id IN ('+ids.map(()=>'?').join(',')+')');args.push(...ids);}
 }
 if(filter.source){conditions.push("json_extract(payload,'$.source')=?");args.push(filter.source);}
 const db=open(),base=conditions.length?' WHERE '+conditions.join(' AND '):'';
 const stats={total:0,running:0,queued:0,completed:0,failed:0,partial:0,paused:0,interrupted:0,draft:0,canceled:0};
 for(const row of db.prepare("SELECT json_extract(payload,'$.status') AS status,COUNT(*) AS n FROM task_events"+base+' GROUP BY status').all(...args)){stats[row.status]=row.n;stats.total+=row.n;}
 if(filter.status){
   const statuses=String(filter.status).split(',').map(s=>s.trim()).filter(Boolean);
   if(statuses.length===1){conditions.push("json_extract(payload,'$.status')=?");args.push(statuses[0]);}
   else if(statuses.length>1){conditions.push("json_extract(payload,'$.status') IN ("+statuses.map(()=>'?').join(',')+")");args.push(...statuses);}
 }
 if(filter.query){
   conditions.push("(json_extract(payload,'$.title') LIKE ? OR id LIKE ?)");
   args.push('%'+filter.query+'%','%'+filter.query+'%');
 }
 if(filter.month && /^\d{4}-\d{2}$/.test(String(filter.month))){
   const [year,month]=String(filter.month).split('-').map(Number);
   conditions.push('created_at>=? AND created_at<?');
   args.push(new Date(year,month-1,1).getTime(),new Date(year,month,1).getTime());
 }
 const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
 const total=db.prepare('SELECT COUNT(*) AS n FROM task_events'+where).get(...args).n,page=Math.max(1,Math.min(Math.ceil(total/10)||1,Number(filter.page)||1));
 const runAt="COALESCE(json_extract(payload,'$.startedAt'),json_extract(payload,'$.schedule.startAt'))";
 const sorts={
   // 还没排运行时间的任务排最前：调度页靠这个展示「未分配」，否则它们被运行时间排序挤到末页
   pending_first:"(json_extract(payload,'$.status') IN ('unscheduled','draft')) DESC,created_at DESC,rowid DESC",
   runtime_desc:"("+runAt+" IS NULL),"+runAt+" DESC,created_at DESC",
   runtime_asc:"("+runAt+" IS NULL),"+runAt+" ASC,created_at ASC",
   created_desc:'created_at DESC,rowid DESC',
   created_asc:'created_at ASC,rowid ASC',
   updated_desc:"json_extract(payload,'$.updatedAt') DESC,created_at DESC",
   title_asc:"json_extract(payload,'$.title') COLLATE NOCASE ASC,created_at DESC",
 };
 const order=sorts[filter.sort]||sorts.created_desc;
 const events=db.prepare('SELECT payload FROM task_events'+where+' ORDER BY '+order+' LIMIT 10 OFFSET ?').all(...args,(page-1)*10).map(r=>JSON.parse(r.payload));
 return {events,stats,total,page,pageSize:10};
}

function get(id){const row=open().prepare('SELECT payload FROM task_events WHERE id=?').get(id);return row?JSON.parse(row.payload):null;}
function countSince(tenantId, since){return open().prepare('SELECT COUNT(*) AS n FROM task_events WHERE tenant_id = ? AND created_at >= ?').get(String(tenantId||'tnt_default'), Number(since)||0).n;}
function active(){return open().prepare("SELECT payload FROM task_events WHERE json_extract(payload,'$.status') IN ('queued','running','paused','interrupted') OR json_extract(payload,'$.draft')=0 AND json_extract(payload,'$.finishedAt') IS NULL").all().map(r=>JSON.parse(r.payload));}
function attemptLog(id,after=0){const row=open().prepare('SELECT payload FROM task_attempts WHERE id=?').get(id);if(!row)throw Object.assign(new Error('执行记录不存在'),{status:404});const record=JSON.parse(row.payload),logs=record.logs||[];return {id,lines:logs.slice(after,after+50),after,next:Math.min(logs.length,after+50),hasMore:after+50<logs.length};}
function attemptPage(eventId,index=1){const db=open(),total=db.prepare('SELECT COUNT(*) AS n FROM task_attempts WHERE event_id=?').get(eventId).n,page=Math.max(1,Math.min(Math.ceil(total/10)||1,Number(index)||1));const attempts=db.prepare("SELECT id,item_id AS itemId,created_at AS createdAt,json_extract(payload,'$.status') AS status,json_extract(payload,'$.startedAt') AS startedAt,json_extract(payload,'$.finishedAt') AS finishedAt,json_extract(payload,'$.error') AS error FROM task_attempts WHERE event_id=? ORDER BY COALESCE(json_extract(payload,'$.startedAt'),created_at) DESC,rowid DESC LIMIT 10 OFFSET ?").all(eventId,(page-1)*10);return {attempts,total,page,pageSize:10};}
function remove(id){const db=open();const row=db.prepare('SELECT id FROM task_events WHERE id=?').get(id);if(!row)return false;db.prepare('DELETE FROM task_attempts WHERE event_id=?').run(id);db.prepare('DELETE FROM task_events WHERE id=?').run(id);known.delete(id);return true;}

/* ------------------------------- 回收站 ------------------------------- */

function trashEntry(row) {
  try {
    const entry = JSON.parse(row.payload);
    return entry && entry.event && entry.event.id ? entry : null;
  } catch { return null; }
}

function trashPush(tenantId, entry) {
  if (!entry || !entry.event || !entry.event.id) return false;
  const key = String(tenantId || 'tnt_default');
  const conn = open();
  conn.prepare(`INSERT INTO event_trash(id, tenant_id, removed_at, payload) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET tenant_id = excluded.tenant_id, removed_at = excluded.removed_at, payload = excluded.payload`)
    .run(String(entry.event.id), key, Number(entry.removedAt) || Date.now(), JSON.stringify(entry));
  // 每个租户单独保留 100 条。
  conn.prepare(`DELETE FROM event_trash WHERE tenant_id = ? AND id NOT IN (
    SELECT id FROM event_trash WHERE tenant_id = ? ORDER BY removed_at DESC, id DESC LIMIT 100)`)
    .run(key, key);
  return true;
}

function trashList(tenantId) {
  return open().prepare('SELECT payload FROM event_trash WHERE tenant_id = ? ORDER BY removed_at DESC, id DESC LIMIT 100')
    .all(String(tenantId || 'tnt_default')).map(trashEntry).filter(Boolean);
}

function trashCount(tenantId) {
  return open().prepare('SELECT COUNT(*) AS n FROM event_trash WHERE tenant_id = ?').get(String(tenantId || 'tnt_default')).n;
}

/** 取走一条（指定 id 或最近一条）；不存在返回 null。 */
function trashTake(tenantId, id) {
  const key = String(tenantId || 'tnt_default');
  const conn = open();
  const row = id
    ? conn.prepare('SELECT payload FROM event_trash WHERE tenant_id = ? AND id = ?').get(key, String(id))
    : conn.prepare('SELECT payload FROM event_trash WHERE tenant_id = ? ORDER BY removed_at DESC, id DESC LIMIT 1').get(key);
  if (!row) return null;
  const entry = trashEntry(row);
  const target = entry ? entry.event.id : String(id || '');
  if (!target) return null;
  conn.prepare('DELETE FROM event_trash WHERE tenant_id = ? AND id = ?').run(key, String(target));
  return entry;
}

function close() {
  if (connection) { try { connection.close(); } catch { /* ignore */ } }
  connection = null;
  location = '';
  known = new Map();
}

module.exports = { open, close, read, write, kind, query, get, countSince, active, attempt, attempts, attemptLog, attemptPage, remove, trashPush, trashList, trashCount, trashTake };
