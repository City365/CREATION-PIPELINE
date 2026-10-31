'use strict';
// 任务概览排序：运行时间优先取实际开始时间，未开始的取计划运行时间
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.WMD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-task-overview-'));
const repository = require('../src/event-store');

function event(id, startedAt, startAt) {
  return {
    id,
    kind: 'video',
    title: id,
    source: 'batch',
    status: 'completed',
    createdAt: startedAt || 1,
    startedAt,
    schedule: { order: 0, startAt },
    spec: { projectId: '' },
    items: [],
  };
}

repository.write([
  event('rt-old', 1000, null),
  event('rt-new', 3000, null),
  event('rt-scheduled', null, new Date(5000).toISOString()),
  event('rt-never', null, null),
]);

const order = (sort) => repository.query({ sort }).events.map((row) => row.id);

test('运行时间倒序：实际开始时间与计划时间合并排序，没有时间的排最后', () => {
  assert.deepEqual(order('runtime_desc'), ['rt-scheduled', 'rt-new', 'rt-old', 'rt-never']);
});

test('运行时间正序：最早的在前，没有时间的仍在最后', () => {
  assert.deepEqual(order('runtime_asc'), ['rt-old', 'rt-new', 'rt-scheduled', 'rt-never']);
});

test('创建时间排序仍然可用', () => {
  assert.deepEqual(order('created_asc'), ['rt-scheduled', 'rt-never', 'rt-old', 'rt-new']);
  assert.deepEqual(order('created_desc'), ['rt-new', 'rt-old', 'rt-never', 'rt-scheduled']);
});

test('执行历史按运行时间倒序，而不是创建时间', () => {
  repository.attempt({ id: 'att-old', eventId: 'evt-a', itemId: 'i1', createdAt: 9000, status: 'success', startedAt: 1000, finishedAt: 2000 });
  repository.attempt({ id: 'att-new', eventId: 'evt-a', itemId: 'i2', createdAt: 1000, status: 'failed', startedAt: 8000, finishedAt: 9000 });
  const page = repository.attemptPage('evt-a', 1);
  assert.deepEqual(page.attempts.map((row) => row.id), ['att-new', 'att-old']);
});
