'use strict';
/**
 * 任务状态落库：旧 jobs.json 一次导入、按行更新、删除同步、重启标记中断。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-jobs-'));
process.env.WMD_DATA_DIR = dir;

const jobs = require('../src/jobs');
const db = require('../src/db');

function count() { return db.open().prepare('SELECT COUNT(*) AS n FROM jobs').get().n; }

test('旧 jobs.json 导入一次并把原文件改名', () => {
  const legacy = {
    jobs: [
      { id: 'job-a', projectId: 'proj-a', status: 'success', order: 1, createdAt: 1000, title: 'A', outputs: [] },
      { id: 'job-b', projectId: 'proj-b', status: 'queued', order: 2, createdAt: 2000, title: 'B', outputs: [] },
    ],
  };
  fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify(legacy));
  jobs.loadState();
  assert.equal(jobs.list().length, 2);
  assert.equal(count(), 2);
  assert.ok(fs.existsSync(path.join(dir, 'jobs.imported.json')), '原文件应改名为 jobs.imported.json');
  assert.equal(fs.existsSync(path.join(dir, 'jobs.json')), false);
});

test('只更新被修改的那一行', () => {
  jobs.setShotMeta('job-a', { shotLabel: '镜头 1' });
  jobs.flushState();
  const a = db.open().prepare('SELECT data FROM jobs WHERE id = ?').get('job-a');
  const b = db.open().prepare('SELECT data FROM jobs WHERE id = ?').get('job-b');
  assert.equal(JSON.parse(a.data).shotLabel, '镜头 1');
  assert.equal(JSON.parse(b.data).shotLabel, undefined, '未修改的任务不应被改写');
});

test('删除任务同时删除行', () => {
  jobs.remove('job-b');
  assert.equal(count(), 1);
  assert.equal(jobs.list().length, 1);
});

test('重启后运行中的任务标记为已中断', () => {
  db.open().prepare(`INSERT INTO jobs(id, project_id, status, order_no, created_at, updated_at, data)
    VALUES (?,?,?,?,?,?,?)`).run(
    'job-c', 'proj-c', 'running', 3, 3000, 3000,
    JSON.stringify({ id: 'job-c', projectId: 'proj-c', status: 'running', order: 3, createdAt: 3000, outputs: [] }),
  );
  jobs.loadState();
  const job = jobs.get('job-c');
  assert.equal(job.status, 'interrupted');
  assert.equal(job.stage, '已中断（待对账）');
  const row = db.open().prepare('SELECT data FROM jobs WHERE id = ?').get('job-c');
  assert.equal(JSON.parse(row.data).status, 'interrupted');
});

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
