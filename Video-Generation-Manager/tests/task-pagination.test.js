'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TaskQueue } = require('../src/tasks');

function queueWith(tasks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-page-'));
  const store = { list: () => [], get: () => null, canUse: () => true, update: () => {}, refundQuota: () => {} };
  const queue = new TaskQueue({ directory: dir, store, execute: async () => null });
  queue.tasks = tasks;
  queue.persist();
  return { queue, dir };
}

const row = (i, status = 'completed') => ({
  id: 'task-' + String(i).padStart(3, '0'), requestId: 'r' + i, prompt: '镜头 ' + i, platform: 'doubao',
  status, createdAt: new Date(2026, 0, 1, 0, i).toISOString(), updatedAt: new Date(2026, 0, 1, 0, i).toISOString(),
});

test('任务列表每页 10 条，统计和分页信息正确', () => {
  const tasks = Array.from({ length: 25 }, (_, i) => row(i, i < 3 ? 'failed' : 'completed'));
  const { queue, dir } = queueWith(tasks);
  const page = queue.page({ page: 2, pageSize: 10 });
  assert.equal(page.total, 25);
  assert.equal(page.pages, 3);
  assert.equal(page.page, 2);
  assert.equal(page.tasks.length, 10);
  assert.equal(page.tasks[0].id, 'task-014');
  assert.equal(page.stats.total, 25);
  assert.equal(page.stats.active, 0);
  assert.equal(page.stats.done, 22);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('搜索和状态筛选在服务端完成', () => {
  const tasks = Array.from({ length: 15 }, (_, i) => row(i, i % 4 === 0 ? 'failed' : 'completed'));
  const { queue, dir } = queueWith(tasks);
  const filtered = queue.page({ page: 1, pageSize: 10, query: '镜头 1', filter: 'failed' });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.tasks[0].id, 'task-012');
  const active = queue.page({ page: 1, pageSize: 10, filter: 'active' });
  assert.equal(active.total, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
