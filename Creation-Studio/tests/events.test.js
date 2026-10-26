'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 事件存储写到临时目录，避免污染真实 data/events.json
process.env.H3_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-events-'));
const events = require('../src/events');

function fakeEvent(items) {
  return { id: 'evt_test', title: 't', source: 'batch', status: 'queued', spec: { items: [] }, items, createdAt: 1, startedAt: null, finishedAt: null };
}
function job(id, status, extra = {}) {
  return { id, status, title: id, error: null, progress: 0, ...extra };
}

test('全部成功 → completed，统计正确', () => {
  const jobMap = new Map([['a', job('a', 'success')], ['b', job('b', 'success')]]);
  const result = events.hydrate(fakeEvent([
    { id: 'i1', refType: 'job', refId: 'a', status: 'queued' },
    { id: 'i2', refType: 'job', refId: 'b', status: 'queued' },
  ]), { jobMap, worker: null });
  assert.equal(result.status, 'completed');
  assert.equal(result.stats.total, 2);
  assert.equal(result.stats.done, 2);
  assert.ok(result.finishedAt);
});

test('一成功一失败 → partial', () => {
  const jobMap = new Map([['a', job('a', 'success')], ['b', job('b', 'failed', { error: 'boom' })]]);
  const result = events.hydrate(fakeEvent([
    { id: 'i1', refType: 'job', refId: 'a', status: 'queued' },
    { id: 'i2', refType: 'job', refId: 'b', status: 'queued' },
  ]), { jobMap, worker: null });
  assert.equal(result.status, 'partial');
  assert.equal(result.stats.failed, 1);
  assert.equal(result.items[1].error, 'boom');
});

test('仍在运行 → running，未结束不算完成', () => {
  const jobMap = new Map([['a', job('a', 'success')], ['b', job('b', 'running')]]);
  const result = events.hydrate(fakeEvent([
    { id: 'i1', refType: 'job', refId: 'a', status: 'queued' },
    { id: 'i2', refType: 'job', refId: 'b', status: 'queued' },
  ]), { jobMap, worker: null });
  assert.equal(result.status, 'running');
  assert.equal(result.finishedAt, null);
  assert.equal(result.stats.running, 1);
});

test('任务记录丢失 → unknown，不污染成功率', () => {
  const result = events.hydrate(fakeEvent([
    { id: 'i1', refType: 'job', refId: 'gone', status: 'queued' },
  ]), { jobMap: new Map(), worker: null });
  assert.equal(result.items[0].status, 'unknown');
  assert.equal(result.stats.unknown, 1);
  assert.equal(result.status, 'failed');
});

test('被取消的条目计入 done，但事件是 canceled', () => {
  const jobMap = new Map([['a', job('a', 'canceled')], ['b', job('b', 'canceled')]]);
  const result = events.hydrate(fakeEvent([
    { id: 'i1', refType: 'job', refId: 'a', status: 'queued' },
    { id: 'i2', refType: 'job', refId: 'b', status: 'queued' },
  ]), { jobMap, worker: null });
  assert.equal(result.status, 'canceled');
  assert.equal(result.stats.canceled, 2);
});

test('没有条目的事件保持 draft，不会误判完成', () => {
  const result = events.hydrate(fakeEvent([]), { jobMap: new Map(), worker: null });
  assert.equal(result.status, 'draft');
  assert.equal(result.stats.total, 0);
});

test('重启中断的任务计为 unknown，事件为 interrupted', () => {
  const jobMap = new Map([['a', job('a', 'interrupted')]]);
  const result = events.hydrate(fakeEvent([{ id: 'i1', refType: 'job', refId: 'a', status: 'queued' }]), { jobMap, worker: null });
  assert.equal(result.items[0].status, 'unknown');
  assert.equal(result.status, 'interrupted');
  assert.equal(result.stats.unknown, 1);
});

test('创建后可查询，存在临时数据目录', () => {
  const event = events.create({ title: '测试事件', source: 'batch', items: [{ prompt: 'p1' }] });
  assert.ok(event.id.startsWith('evt_'));
  const listed = events.list();
  assert.ok(listed.events.some((e) => e.id === event.id));
  assert.ok(fs.existsSync(path.join(process.env.H3_DATA_DIR, 'events.json')));
  assert.equal(events.get(event.id).title, '测试事件');
});

test('空条目创建被拒绝', () => {
  assert.throws(() => events.createFromJobInputs([], {}), /没有可创建/);
});
