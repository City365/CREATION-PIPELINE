'use strict';
/**
 * 配额增强：存储空间与并发任务。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-quota-extra-'));
process.env.WMD_DATA_DIR = path.join(dir, 'data');

const db = require('../src/db');
const quotas = require('../src/quotas');
const projects = require('../src/projects');
const workspace = require('../src/workspace');

test.after(() => {
  db.close();
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* Windows 上偶尔还有句柄未释放 */ }
});

function runningJob(id, tenantId) {
  const now = Date.now();
  db.open().prepare(`INSERT INTO jobs(id, project_id, tenant_id, status, order_no, created_at, updated_at, data)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, 'p1', tenantId, 'running', 1, now, now, JSON.stringify({ id, tenantId, status: 'running' }));
}

test('并发上限按正在运行的任务计数', () => {
  quotas.set('tnt_a', { maxConcurrentTasks: 1 });
  assert.doesNotThrow(() => quotas.assertConcurrent('tnt_a', 1));
  runningJob('job-1', 'tnt_a');
  let error = null;
  try { quotas.assertConcurrent('tnt_a', 1); } catch (err) { error = err; }
  assert.ok(error, '应抛出并发配额错误');
  assert.equal(error.status, 429);
  assert.match(error.message, /并发/);
  assert.doesNotThrow(() => quotas.assertConcurrent('tnt_a', 0));
  assert.doesNotThrow(() => quotas.assertConcurrent('tnt_b', 5));
  assert.equal(quotas.usage('tnt_a').runningTasks, 1);
});

test('存储上限按租户项目目录统计，超限后拒绝新任务', () => {
  const project = projects.create({ name: '配额项目', tenantId: 'tnt_a' });
  const projectDir = workspace.pathsFor(project).dir;
  fs.writeFileSync(path.join(projectDir, 'clip.bin'), Buffer.alloc(4096, 1));
  quotas.clearStorageCache('tnt_a');
  quotas.set('tnt_a', { maxStorageBytes: 1024 });
  let error = null;
  try { quotas.assertStorage('tnt_a', 0); } catch (err) { error = err; }
  assert.ok(error, '应抛出存储配额错误');
  assert.equal(error.status, 429);
  assert.match(error.message, /存储/);
  const usage = quotas.usage('tnt_a');
  assert.ok(usage.storageBytes >= 4096, JSON.stringify(usage));
  assert.ok(usage.storageFiles >= 1);

  quotas.set('tnt_a', { maxStorageBytes: 0 });
  assert.doesNotThrow(() => quotas.assertStorage('tnt_a', 10 * 1024 * 1024));
});

test('存储缓存 60 秒，fresh 可强制重算', () => {
  const project = projects.create({ name: '缓存项目', tenantId: 'tnt_cache' });
  const projectDir = workspace.pathsFor(project).dir;
  fs.writeFileSync(path.join(projectDir, 'a.bin'), Buffer.alloc(100, 1));
  quotas.clearStorageCache('tnt_cache');
  const first = quotas.storageUsage('tnt_cache');
  fs.writeFileSync(path.join(projectDir, 'b.bin'), Buffer.alloc(200, 1));
  const cached = quotas.storageUsage('tnt_cache');
  assert.equal(cached.bytes, first.bytes);
  const fresh = quotas.storageUsage('tnt_cache', { fresh: true });
  assert.ok(fresh.bytes >= first.bytes + 200);
});

test('配额校验拒绝负数与超大值', () => {
  assert.throws(() => quotas.set('tnt_a', { maxStorageBytes: -1 }), /非负整数/);
  assert.throws(() => quotas.set('tnt_a', { maxConcurrentTasks: 1.5 }), /非负整数/);
});
