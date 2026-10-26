'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 用假的 jobs 执行器验证事件调度器，不依赖真实工作流/渠道
const jobsPath = require.resolve('../src/jobs');
const fake = { jobs: [], seq: 0 };
fake.list = () => fake.jobs.map((j) => ({ ...j }));
fake.addJobs = (input) => {
  const job = { id: 'job-' + (++fake.seq), status: 'queued', held: false, title: input.title || 't', prompt: input.prompt || '', order: fake.jobs.length + 1, eventId: input.eventId };
  fake.jobs.push(job);
  return [job];
};
fake.setHeld = (id, held) => { const job = fake.jobs.find((j) => j.id === id); if (job) job.held = !!held; };
fake.cancel = (id) => { const job = fake.jobs.find((j) => j.id === id); if (job) { job.status = 'canceled'; job.held = false; } };
fake.retry = (id) => { const job = fake.jobs.find((j) => j.id === id); if (job) { job.status = 'queued'; job.held = false; } };
fake.readLog = () => [];
require.cache[jobsPath] = { id: jobsPath, filename: jobsPath, loaded: true, exports: fake };

process.env.H3_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-events-sched-'));
const events = require('../src/events');

function input(n) {
  return Array.from({ length: n }, (_, i) => ({ title: 'item' + (i + 1), prompt: 'p' + (i + 1), workflowId: 'wf' }));
}
const unheld = () => fake.jobs.filter((j) => !j.held && j.status === 'queued').map((j) => j.id);

test('默认并发 1：只放行第一条，其余保持等待', async () => {
  fake.jobs.length = 0;
  const event = events.createFromJobInputs(input(3), { title: 'sched-1', source: 'batch' });
  await delay(120);
  assert.equal(event.items.length, 3);
  assert.equal(unheld().length, 1, '并发 1 只应放行一条');
  assert.equal(fake.jobs.filter((j) => j.held).length, 2);
});

test('条目完成后自动放行下一条', async () => {
  fake.jobs.length = 0;
  events.createFromJobInputs(input(2), { title: 'sched-2', source: 'batch' });
  await delay(120);
  const first = fake.jobs.find((j) => !j.held);
  assert.ok(first);
  first.status = 'success';
  events.tick();
  assert.equal(unheld().length, 1, '完成后应放行第二条');
  assert.notEqual(unheld()[0], first.id);
});

test('暂停后不再派发，继续后恢复', async () => {
  fake.jobs.length = 0;
  const event = events.createFromJobInputs(input(2), { title: 'sched-3', source: 'batch' });
  await delay(120);
  const paused = events.pauseEvent(event.id);
  assert.equal(paused.status, 'paused');
  fake.jobs[0].status = 'success';
  events.tick();
  assert.equal(unheld().length, 0, '暂停期间不应放行');
  const resumed = events.resumeEvent(event.id);
  await delay(60);
  assert.ok(['running', 'queued'].includes(resumed.status));
  assert.equal(unheld().length, 1, '继续后应放行一条');
});

test('整组取消：未开始的条目被取消', async () => {
  fake.jobs.length = 0;
  const event = events.createFromJobInputs(input(3), { title: 'sched-4', source: 'batch' });
  await delay(120);
  const canceled = events.cancelEvent(event.id);
  const queuedLeft = fake.jobs.filter((j) => j.status === 'queued' && !j.held).length;
  assert.equal(queuedLeft, 0, '取消后不应还有等待执行的条目');
  assert.equal(canceled.stats.canceled >= 2, true);
});

test('失败策略 stop：失败后其余条目跳过', async () => {
  fake.jobs.length = 0;
  const event = events.createFromJobInputs(input(3), { title: 'sched-5', source: 'batch', policy: { concurrency: 1, onItemFail: 'stop' } });
  await delay(120);
  fake.jobs[0].status = 'failed';
  events.tick();
  const detail = events.get(event.id);
  assert.equal(detail.items.filter((i) => i.status === 'skipped').length, 2);
  assert.equal(detail.status, 'failed');
});

test('重试失败条目会重新排队并保持调度', async () => {
  fake.jobs.length = 0;
  const event = events.createFromJobInputs(input(2), { title: 'sched-6', source: 'batch' });
  await delay(120);
  fake.jobs[0].status = 'failed';
  events.tick();
  const result = events.retryFailed(event.id);
  assert.equal(result.retried, 1);
  assert.equal(fake.jobs[0].status, 'queued');
  await delay(80);
  assert.equal(unheld().length, 1);
});
