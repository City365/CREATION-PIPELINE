'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
let connection, location;
let known=new Map();
function open() {
  const dir = config.load().dataDir || config.DATA;
  const target = path.join(dir, 'task-events.sqlite');
  if (connection && location === target) return connection;
  if (connection) connection.close();
  fs.mkdirSync(dir, { recursive: true });
  connection = new DatabaseSync(target); location = target; known=new Map();
  connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS task_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,project_id TEXT NOT NULL,created_at INTEGER NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS task_events_scope ON task_events(project_id,kind,created_at DESC); CREATE TABLE IF NOT EXISTS task_attempts(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,item_id TEXT NOT NULL,created_at INTEGER NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS task_attempt_item ON task_attempts(event_id,item_id,created_at); CREATE TABLE IF NOT EXISTS task_meta(key TEXT PRIMARY KEY,value TEXT);');
  if (!connection.prepare("SELECT 1 FROM task_meta WHERE key='legacy-import'").get()) {
    const legacy = path.join(dir, 'events.json');
    let events = [];
    if (fs.existsSync(legacy)) events = JSON.parse(fs.readFileSync(legacy, 'utf8')).events || [];
    write(events);
    connection.prepare('INSERT INTO task_meta(key,value) VALUES(?,?)').run('legacy-import', String(Date.now()));
  }
  return connection;
}
function kind(event) { return event.kind || (event.source === 'image' || event.items?.some(i => i.refType === 'imageTask') ? 'image' : 'video'); }
function write(events) {
  const db = connection || open();
  db.exec('BEGIN IMMEDIATE');
  try {
    const upsert = db.prepare('INSERT INTO task_events VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,project_id=excluded.project_id,payload=excluded.payload');
    for(const event of events){const value=JSON.stringify(event);if(known.get(event.id)===value)continue;upsert.run(event.id,kind(event),event.spec?.projectId||'',event.createdAt||0,value);known.set(event.id,value);}
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
 if(filter.source){conditions.push("json_extract(payload,'$.source')=?");args.push(filter.source);}
 const db=open(),base=conditions.length?' WHERE '+conditions.join(' AND '):'';
 const stats={total:0,running:0,queued:0,completed:0,failed:0,partial:0,paused:0,interrupted:0,draft:0,canceled:0};
 for(const row of db.prepare("SELECT json_extract(payload,'$.status') AS status,COUNT(*) AS n FROM task_events"+base+' GROUP BY status').all(...args)){stats[row.status]=row.n;stats.total+=row.n;}
 if(filter.status){
   const statuses=String(filter.status).split(',').map(s=>s.trim()).filter(Boolean);
   if(statuses.length===1){conditions.push("json_extract(payload,'$.status')=?");args.push(statuses[0]);}
   else if(statuses.length>1){conditions.push("json_extract(payload,'$.status') IN ("+statuses.map(()=>'?').join(',')+")");args.push(...statuses);}
 }
 if(filter.query){conditions.push("json_extract(payload,'$.title') LIKE ?");args.push('%'+filter.query+'%');}
 const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
 const total=db.prepare('SELECT COUNT(*) AS n FROM task_events'+where).get(...args).n,page=Math.max(1,Math.min(Math.ceil(total/10)||1,Number(filter.page)||1));
 const events=db.prepare('SELECT payload FROM task_events'+where+' ORDER BY created_at DESC,rowid DESC LIMIT 10 OFFSET ?').all(...args,(page-1)*10).map(r=>JSON.parse(r.payload));
 return {events,stats,total,page,pageSize:10};
}

function get(id){const row=open().prepare('SELECT payload FROM task_events WHERE id=?').get(id);return row?JSON.parse(row.payload):null;}
function active(){return open().prepare("SELECT payload FROM task_events WHERE json_extract(payload,'$.status') IN ('queued','running','paused','interrupted') OR json_extract(payload,'$.draft')=0 AND json_extract(payload,'$.finishedAt') IS NULL").all().map(r=>JSON.parse(r.payload));}
function attemptLog(id,after=0){const row=open().prepare('SELECT payload FROM task_attempts WHERE id=?').get(id);if(!row)throw Object.assign(new Error('执行记录不存在'),{status:404});const record=JSON.parse(row.payload),logs=record.logs||[];return {id,lines:logs.slice(after,after+50),after,next:Math.min(logs.length,after+50),hasMore:after+50<logs.length};}
function attemptPage(eventId,index=1){const db=open(),total=db.prepare('SELECT COUNT(*) AS n FROM task_attempts WHERE event_id=?').get(eventId).n,page=Math.max(1,Math.min(Math.ceil(total/10)||1,Number(index)||1));const attempts=db.prepare("SELECT id,item_id AS itemId,created_at AS createdAt,json_extract(payload,'$.status') AS status,json_extract(payload,'$.startedAt') AS startedAt,json_extract(payload,'$.finishedAt') AS finishedAt,json_extract(payload,'$.error') AS error FROM task_attempts WHERE event_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10 OFFSET ?").all(eventId,(page-1)*10);return {attempts,total,page,pageSize:10};}
function remove(id){const db=open();const row=db.prepare('SELECT id FROM task_events WHERE id=?').get(id);if(!row)return false;db.prepare('DELETE FROM task_attempts WHERE event_id=?').run(id);db.prepare('DELETE FROM task_events WHERE id=?').run(id);return true;}

module.exports = { open, read, write, kind, query, get, active, attempt, attempts, attemptLog, attemptPage, remove };
