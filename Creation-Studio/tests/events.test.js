'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 事件存储写到临时目录，避免污染真实 data/events.json
process.env.H3_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-events-'));
const events = require('../src/events');
const jobs = require('../src/jobs');

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
  assert.equal(result.status, 'interrupted');
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
  assert.ok(fs.existsSync(path.join(process.env.H3_DATA_DIR, 'task-events.sqlite')));
  assert.equal(events.get(event.id).title, '测试事件');
});

test('空条目创建被拒绝', () => {
  assert.throws(() => events.createFromJobInputs([], {}), /没有可创建/);
});

function attachFake(event, items) { event.items.push(...items); events.save(); }

test('报告：成功率、耗时与失败归因', () => {
  const event = events.create({ title: 'report', source: 'batch', items: [{ prompt: 'a' }, { prompt: 'b' }] });
  attachFake(event, [
    { id: 'i1', refType: 'job', refId: 'ja', status: 'queued', title: 'a' },
    { id: 'i2', refType: 'job', refId: 'jb', status: 'queued', title: 'b' },
  ]);
  const jobMap = new Map([
    ['ja', { id: 'ja', status: 'success', provider: 'manager', channelId: 'ch1', startedAt: 1000, finishedAt: 5000 }],
    ['jb', { id: 'jb', status: 'failed', provider: 'manager', channelId: 'ch1', startedAt: 1000, finishedAt: 3000, error: '额度不足' }],
  ]);
  const report = events.report(event.id, { jobMap });
  assert.equal(report.success, 1);
  assert.equal(report.failed, 1);
  assert.equal(report.successRate, 50);
  assert.equal(report.durationMs.p50, 3000);
  assert.equal(report.failures[0].error, '额度不足');
  assert.equal(report.failures[0].count, 1);
});

test('报告 CSV 带表头和条目行', () => {
  const event = events.create({ title: 'csv', source: 'batch', items: [{ prompt: 'a' }] });
  attachFake(event, [{ id: 'i1', refType: 'job', refId: 'jc', status: 'queued', title: 'a' }]);
  const csv = events.reportCsv(event.id, { jobMap: new Map([['jc', { id: 'jc', status: 'success', provider: 'manager', channelId: 'ch1', startedAt: 0, finishedAt: 1000 }]]) });
  assert.match(csv.body, /itemId,title,status/);
  assert.match(csv.body, /success/);
});

 test('失败和跳过分别计数，已处理进度包含所有明确终态',()=>{const result=events.hydrate(fakeEvent([{id:'i1',refType:'job',refId:'a'},{id:'i2',refType:'job',refId:'b',override:'skipped'}]),{jobMap:new Map([['a',job('a','failed')],['b',job('b','canceled')]]),worker:null});assert.equal(result.stats.done,2);assert.equal(result.stats.failed,1);assert.equal(result.stats.skipped,1);assert.equal(result.status,'failed');});

test('超过200条事件重载仍完整，分页不会丢弃历史',()=>{for(let i=0;i<205;i++)events.create({title:'archive-'+i,kind:'image'});const total=events.repository.read().filter(e=>e.title.startsWith('archive-')).length;assert.equal(total,205);const page=events.list({kind:'image',page:21});assert.equal(page.events.length,5);assert.equal(page.total,205);});

test('改提示词只动这一条，并同步到执行任务记录', () => {
  const originalList = jobs.list;
  const originalRevise = jobs.revisePrompt;
  const calls = [];
  jobs.list = () => [{ id: 'j-revise', status: 'failed' }];
  jobs.revisePrompt = (id, patch) => { calls.push({ id, patch }); return patch; };
  try {
    const event = events.create({ title: 'revise', source: 'batch', items: [{ prompt: 'x' }] });
    event.items.push({
      id: 'i-revise', refType: 'job', refId: 'j-revise', status: 'failed', title: '镜头 02',
      input: { prompt: '旧前置\n\n旧提示词', userPrompt: '旧提示词', prefixPrompt: '旧前置', images: [] },
    });
    events.save();
    const out = events.reviseItem(event.id, 'i-revise', { prompt: '新提示词', prefixPrompt: '新前置' });
    assert.equal(out.items[0].input.prompt, '新前置\n\n新提示词');
    assert.equal(out.items[0].input.userPrompt, '新提示词');
    assert.equal(out.items[0].input.prefixPrompt, '新前置');
    assert.equal(out.items[0].input.images.length, 0);
    assert.deepEqual(calls, [{ id: 'j-revise', patch: { prompt: '新前置\n\n新提示词', userPrompt: '新提示词', prefixPrompt: '新前置' } }]);
    assert.equal(out.items[0].status, 'failed');
  } finally {
    jobs.list = originalList;
    jobs.revisePrompt = originalRevise;
  }
});

test('改提示词拒绝空内容', () => {
  const originalList = jobs.list;
  jobs.list = () => [{ id: 'j-empty', status: 'failed' }];
  try {
    const event = events.create({ title: 'empty', source: 'batch', items: [{ prompt: 'x' }] });
    event.items.push({ id: 'i-empty', refType: 'job', refId: 'j-empty', status: 'failed', title: 's', input: { prompt: 'old', userPrompt: 'old' } });
    events.save();
    assert.throws(() => events.reviseItem(event.id, 'i-empty', { prompt: '   ' }), /提示词不能为空/);
  } finally {
    jobs.list = originalList;
  }
});
