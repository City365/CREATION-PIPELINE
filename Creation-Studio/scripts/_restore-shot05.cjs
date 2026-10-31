'use strict';
/**
 * 一次性恢复：把被“移除分镜”删掉的「镜头 05」条目插回任务 evt_mvrzbgek_e60721b4。
 * 数据来源：task_attempts 里该条目最后一次执行的 snapshot（就是当初提交的 input），
 * 以及 jobs.json 里仍然存在的 job-mvrzgrbh-7f40（成片 镜头 05.mp4 还在磁盘上）。
 * 必须先停掉 H3 服务再跑，否则服务内存里的旧快照会把改动覆盖回去。
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA = path.join(__dirname, '..', 'data');
const EVENT_ID = 'evt_mvrzbgek_e60721b4';
const ITEM_ID = 'evt_mvrzbgf1_d3d8d284_i';
const JOB_ID = 'job-mvrzgrbh-7f40';

const db = new DatabaseSync(path.join(DATA, 'task-events.sqlite'));
const row = db.prepare('SELECT payload FROM task_events WHERE id=?').get(EVENT_ID);
if (!row) throw new Error('任务不存在');
const event = JSON.parse(row.payload);
if ((event.items || []).some((item) => item.id === ITEM_ID)) {
  console.log('镜头 05 已经在了，不用恢复');
  process.exit(0);
}
const attempt = db.prepare("SELECT payload FROM task_attempts WHERE item_id=? ORDER BY created_at DESC LIMIT 1").get(ITEM_ID);
if (!attempt) throw new Error('找不到镜头 05 的历史执行记录，无法还原提交快照');
const snapshot = JSON.parse(attempt.payload).snapshot;
if (!snapshot || !snapshot.prompt) throw new Error('历史记录里没有完整的提交快照');
const jobs = JSON.parse(fs.readFileSync(path.join(DATA, 'jobs.json'), 'utf8'));
const jobList = Array.isArray(jobs) ? jobs : (jobs.jobs || Object.values(jobs));
const job = jobList.find((item) => item && item.id === JOB_ID);
const output = job && job.outputs && job.outputs[0] ? job.outputs[0].path : '';
const outputExists = output ? fs.existsSync(output) : false;

const attempts = db.prepare('SELECT COUNT(*) AS n FROM task_attempts WHERE item_id=?').get(ITEM_ID).n;
const item = {
  id: ITEM_ID,
  refType: 'job',
  refId: JOB_ID,
  title: snapshot.shotLabel || '镜头 05',
  status: 'queued',
  error: null,
  attempts,
  cancelMode: 'local',
  billing: 'on-submit',
  input: snapshot,
  dispatchState: 'ready',
  shotLabel: snapshot.shotLabel || '镜头 05',
};
const items = event.items || [];
const after = items.findIndex((row) => String(row.shotLabel || row.title || '').includes('04'));
items.splice(after >= 0 ? after + 1 : items.length, 0, item);
event.items = items;
event.version = (event.version || 1) + 1;
event.legacy = false;
event.audit = Array.isArray(event.audit) ? event.audit : [];
event.audit.push({ at: Date.now(), action: 'restore-item', detail: '恢复被移除的分镜 镜头 05' });
db.prepare('UPDATE task_events SET payload=? WHERE id=?').run(JSON.stringify(event), EVENT_ID);
db.close();

console.log(JSON.stringify({
  restored: ITEM_ID,
  title: item.title,
  job: JOB_ID,
  output,
  outputExists,
  attempts,
  itemCount: event.items.length,
  order: event.items.map((row) => row.shotLabel || row.title),
}, null, 2));
