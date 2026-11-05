'use strict';
// 任务详情自动刷新不能整页重画（用户看到的就是屏闪）。
// 把 openDetail 里的 itemParts / patchDrawer 抠出来，在最小 DOM 桩上跑：
// 只允许改动真的变了的那几个节点，没变化的卡片一个字节都不写。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/events.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start > 0 && end > start, `在 web/events.js 里找不到 ${startMarker}`);
  return source.slice(start, end);
}

const partsSource = slice('const itemParts = (item, job) => {', 'const itemCardHtml = (item, job) =>');
const patchSource = slice('const patchDrawer = (nextEvent, nextJobByItem) => {', 'const refreshSilently = ');

function makeSandbox() {
  const sandbox = {};
  new Function('module', 'exports', `
const esc = (value) => String(value == null ? '' : value);
const shortText = (value, limit) => String(value == null ? '' : value).slice(0, limit);
const itemRatio = (item, job) => String((item && item.input && item.input.aspectRatio) || (job && job.aspectRatio) || '');
const itemModel = (item, job) => String((item && item.input && item.input.model) || (job && job.model) || '');
const itemDuration = (item, job) => (job && job.status === 'success') ? '1:20' : '进行中';
const itemStatusBadge = (status) => '<em class="badge">' + status + '</em>';
const taskBadge = (status) => '<span class="badge">' + status + '</span>';
const duration = () => '3 分钟';
const STATE = { applied: 0 };
const applyFilter = () => { STATE.applied += 1; };
const WRITES = [];
let drawer = null;
const event = { items: [], stats: {}, status: 'running' };
const jobByItem = new Map();
${partsSource}
${patchSource}
module.exports = {
  itemParts, patchDrawer,
  event, jobByItem, STATE, WRITES,
  setDrawer: (value) => { drawer = value; },
};
`)(sandbox, sandbox.exports);
  return sandbox.exports;
}

/** 够用的假抽屉：按属性选择卡片，记下每个节点被写了几次 innerHTML / textContent */
function makeDrawer(itemIds, sigs, statuses) {
  const writes = [];
  const makeNode = (label, extra = {}) => {
    const node = Object.assign({ dataset: {}, innerHTML: '', style: {}, isConnected: true }, extra);
    let inner = node.innerHTML;
    let text = '';
    Object.defineProperty(node, 'innerHTML', {
      get: () => inner,
      set: (value) => { inner = value; writes.push({ label, kind: 'innerHTML' }); },
    });
    Object.defineProperty(node, 'textContent', {
      get: () => text,
      set: (value) => { text = String(value); writes.push({ label, kind: 'textContent' }); },
    });
    node.__seed = (value) => { inner = value; };   // 假装抽屉已经画过一次，不计入写入
    return node;
  };
  const cards = itemIds.map((id, index) => {
    const parts = {};
    const card = {
      dataset: { drawerItem: id, drawerItemStatus: statuses[index], shotSig: sigs[index] },
      querySelector(selector) {
        if (selector === '[data-drawer-video]') return parts.video || null;
        return parts[selector] || null;
      },
      writes,
      id,
      parts,
    };
    parts['[data-shot-status]'] = makeNode(id + ':status');
    parts['[data-shot-meta]'] = makeNode(id + ':meta');
    parts['[data-shot-flags]'] = makeNode(id + ':flags');
    parts['[data-shot-progress]'] = makeNode(id + ':progress');
    parts['[data-shot-actions]'] = makeNode(id + ':actions');
    parts['[data-shot-media]'] = makeNode(id + ':media');
    return card;
  });
  const nodes = {
    '[data-task-badge]': [makeNode('badge')],
    '[data-progress] span': makeNode('bar'),
    '[data-summary-done]': makeNode('done'),
    '[data-kpi="total"]': makeNode('kpi:total'),
    '[data-kpi="success"]': makeNode('kpi:success'),
    '[data-kpi="failed"]': makeNode('kpi:failed'),
    '[data-kpi="running"]': makeNode('kpi:running'),
    '[data-kpi="duration"]': makeNode('kpi:duration'),
    '[data-chip-count]': [makeNode('chip')],
    '[data-shot-count]': makeNode('count'),
  };
  const drawer = {
    cards,
    querySelectorAll(selector) {
      if (selector === '[data-drawer-item]') return cards;
      return nodes[selector] || [];
    },
    querySelector(selector) {
      const match = /^\[data-drawer-item="(.+)"\]$/.exec(selector);
      if (match) return cards.find((card) => card.dataset.drawerItem === match[1]) || null;
      return nodes[selector] || null;
    },
  };
  return { drawer, writes, cards, nodes };
}

function prepare(sandbox, items, jobs, statuses) {
  sandbox.event.items = items.map((item) => ({ ...item }));
  sandbox.event.stats = {};
  sandbox.jobByItem.clear();
  for (const job of jobs) sandbox.jobByItem.set(job.eventItemId || job.refId, job);
  const partsList = sandbox.event.items.map((item) => sandbox.itemParts(item, sandbox.jobByItem.get(item.id) || null));
  const fake = makeDrawer(items.map((item) => item.id), partsList.map((parts) => parts.sig), statuses);
  // 抽屉已经画过一次：各块初始内容与当前数据一致，之后的写入才代表“真的变了”
  fake.cards.forEach((card, index) => {
    const parts = partsList[index];
    card.parts['[data-shot-status]'].__seed(parts.statusInner);
    card.parts['[data-shot-meta]'].__seed(parts.metaInner);
    card.parts['[data-shot-flags]'].__seed(parts.flagsInner);
    card.parts['[data-shot-progress]'].__seed(parts.progressInner);
    card.parts['[data-shot-actions]'].__seed(parts.actionsInner);
    card.parts['[data-shot-media]'].__seed(parts.mediaInner);
  });
  fake.writes.length = 0;
  sandbox.setDrawer(fake.drawer);
  return fake;
}

const item = (id, status, extra = {}) => ({
  id, status, title: id, refId: 'job-' + id, startedAt: 1,
  input: Object.assign({ prompt: 'p', aspectRatio: '16:9', model: 'Seedance 2.0 Fast' }, extra),
});
const job = (id, status, extra = {}) => ({ id: 'job-' + id, eventItemId: id, status, outputs: [], ...extra });

test('只有变了的卡片写 DOM，没变化的卡片一个字节都不写', () => {
  const sandbox = makeSandbox();
  const items = [item('a', 'running'), item('b', 'running')];
  const fake = prepare(sandbox, items, [job('a', 'running'), job('b', 'running')], ['running', 'running']);
  fake.writes.length = 0;
  // b 没变（同一个签名），a 变成成功并出了成片
  const nextEvent = {
    status: 'running',
    stats: { total: 2, done: 1, success: 1, running: 1 },
    items: [
      { ...items[0], status: 'success' },
      { ...items[1] },
    ],
  };
  const nextJobs = new Map([
    ['a', job('a', 'success', { outputs: [{ type: 'video', path: 'D:/out/a.mp4' }] })],
    ['b', job('b', 'running')],
  ]);
  const ok = sandbox.patchDrawer(nextEvent, nextJobs);
  assert.equal(ok, true, '结构没变应该补丁成功');
  const labels = fake.writes.map((row) => row.label);
  assert.ok(labels.includes('a:status'), '状态变了要换状态徽章');
  assert.ok(labels.includes('a:media'), '新成片要补进媒体块');
  assert.ok(labels.includes('a:actions'), '状态变了操作按钮要跟着换');
  assert.ok(!labels.some((label) => label.startsWith('b:')), '没变化的分镜不能写 DOM');
});

test('进度变化只改进度块，不碰状态和媒体', () => {
  const sandbox = makeSandbox();
  const items = [item('a', 'running')];
  const fake = prepare(sandbox, items, [job('a', 'running')], ['running']);
  fake.writes.length = 0;
  const nextEvent = { status: 'running', stats: { total: 1, running: 1 }, items: [{ ...items[0] }] };
  const nextJobs = new Map([['a', job('a', 'running', { progress: 42, stage: '生成中 · 已提交' })]]);
  assert.equal(sandbox.patchDrawer(nextEvent, nextJobs), true);
  const labels = fake.writes.map((row) => row.label);
  assert.deepEqual([...new Set(labels.filter((label) => label.startsWith('a:')))], ['a:progress']);
});

test('排队/执行中的分镜显示进度条和当前环节，跑完就收起来', () => {
  const sandbox = makeSandbox();
  const running = sandbox.itemParts(item('a', 'running'), { status: 'running', progress: 42, stage: '生成中 · 已提交', outputs: [] });
  assert.match(running.progressInner, /当前环节/);
  assert.match(running.progressInner, /生成中 · 已提交/);
  assert.match(running.progressInner, /42%/);
  assert.match(running.progressInner, /width:42%/);
  assert.match(running.progressInner, /aria-valuenow="42"/);
  const queued = sandbox.itemParts(item('b', 'queued'), { status: 'queued', progress: 0, outputs: [] });
  assert.match(queued.progressInner, /排队中/);
  const done = sandbox.itemParts(item('c', 'success'), { status: 'success', progress: 100, outputs: [] });
  assert.equal(done.progressInner, '', '跑完不再占位');
  const failed = sandbox.itemParts(item('d', 'failed'), { status: 'failed', progress: 30, outputs: [] });
  assert.equal(failed.progressInner, '', '失败后也不再显示进度条');
});

test('条目数变了就退回整页重画（返回 false）', () => {
  const sandbox = makeSandbox();
  const items = [item('a', 'running')];
  const fake = prepare(sandbox, items, [job('a', 'running')], ['running']);
  fake.writes.length = 0;
  const nextEvent = { status: 'running', stats: {}, items: [items[0], item('b', 'queued')] };
  assert.equal(sandbox.patchDrawer(nextEvent, new Map()), false);
  assert.equal(fake.writes.length, 0, '决定重画前不能先动 DOM');
});

test('补丁会把新数据合进原来的对象和 Map，抽屉里已绑好的逻辑拿到的是新值', () => {
  const sandbox = makeSandbox();
  const items = [item('a', 'running')];
  prepare(sandbox, items, [job('a', 'running')], ['running']);
  const nextEvent = { status: 'completed', stats: { total: 1, done: 1, success: 1 }, items: [{ ...items[0], status: 'success', error: '' }] };
  const nextJobs = new Map([['a', job('a', 'success', { outputs: [{ type: 'video', path: 'D:/out/a.mp4' }], remotePromptId: 'mgr-1' })]]);
  assert.equal(sandbox.patchDrawer(nextEvent, nextJobs), true);
  assert.equal(sandbox.event.status, 'completed');
  assert.equal(sandbox.event.items[0].status, 'success');
  assert.equal(sandbox.jobByItem.get('a').remotePromptId, 'mgr-1');
  assert.equal(sandbox.event.items.length, 1, 'items 数组不能整体换掉，否则已绑定的闭包会读到旧数组');
});
