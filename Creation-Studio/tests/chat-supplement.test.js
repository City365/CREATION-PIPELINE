'use strict';
// 直发＝当前任务的补充说明：队列 UI、状态核对、不丢不重复
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');

function slice(startMark, endMark) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark, start + 1);
  assert.ok(start > 0, '在 app.js 里找不到：' + startMark);
  assert.ok(end > start, '在 app.js 里找不到结尾标记：' + endMark);
  return source.slice(start, end);
}

const supplementSrc = slice('/* ------------------- 直发 = 当前任务的补充说明', '// 一轮结束后只发队首那一条');
const queueHtmlSrc = slice('function askQueueHtml() {', '// 右侧轮次滑条');

const CURRENT = { queue: [], activeId: 'c1' };
let saved = 0;
let toasts = [];
let snapshots = {};

const box = {};
new Function('module', 'exports', `
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let CURRENT = null;
const sets = { set(v) { CURRENT = v; } };
const askState = () => CURRENT;
const askLoadQueue = () => CURRENT.queue;
const askSaveQueue = () => { CURRENT.saved = (CURRENT.saved || 0) + 1; };
const askRunOf = () => CURRENT.run || null;
const askRenderSoon = () => {};
const askRenderAll = () => {};
const askId = () => 'q_' + Math.random().toString(36).slice(2, 8);
const askProjectId = () => 'p1';
const toast = (text) => { CURRENT.toasts = (CURRENT.toasts || []).concat(text); };
const fetch = async (url) => {
  const key = Object.keys(CURRENT.snapshots || {}).find((k) => url.indexOf(k) >= 0);
  if (!key) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => CURRENT.snapshots[key] };
};
${supplementSrc}
${queueHtmlSrc}
module.exports = { askQueueHtml, askQueueAck, askQueueMark, askQueueSettle, askSupplementSend, set: sets.set };
`)(box, box.exports);

const { askQueueHtml, askQueueAck, askQueueMark, askQueueSettle, askSupplementSend, set } = box.exports;

function state(patch) {
  const value = { queue: [], activeId: 'c1', toasts: [], snapshots: {}, ...patch };
  set(value);
  return value;
}

test('运行中：队首箭头发送补充说明，不中断', () => {
  state({ queue: [{ id: 'a', text: '第二集改成横屏' }], run: { runId: 'run-1' } });
  const html = askQueueHtml();
  assert.match(html, /data-act="ask-queue-now"/);
  assert.match(html, />↑</);
  assert.match(html, /队首 ↑：补充给当前任务，不中断执行/);
  assert.doesNotMatch(html, /中断当前回复并马上发送这条/);
});

test('没有运行时：按钮退回 ↑，提示立即发送', () => {
  state({ queue: [{ id: 'a', text: '接着写第三集' }], run: null });
  const html = askQueueHtml();
  assert.match(html, />↑</);
  assert.match(html, /当前没有任务在跑，点 ↑ 立即发送/);
});

test('已直发的条目显示等待状态，不再重复给直发按钮', () => {
  state({ queue: [{ id: 'a', text: '已发出去的那条', sup: { id: 'sp_1', runId: 'run-1', state: 'queued' } }], run: { runId: 'run-1' } });
  const html = askQueueHtml();
  assert.match(html, /等检查点/);
  assert.doesNotMatch(html, /data-act="ask-queue-now"/);
});

test('askQueueAck 只删已并入的那条，不动其它排队项', () => {
  const value = state({ queue: [{ id: 'a', text: '甲', sup: { id: 'sp_1', state: 'queued' } }, { id: 'b', text: '乙' }] });
  askQueueAck('c1', ['sp_1']);
  assert.deepEqual(value.queue.map((x) => x.id), ['b']);
  assert.equal(value.saved, 1);
});

test('askQueueMark 只更新对应补充说明的状态', () => {
  const value = state({ queue: [{ id: 'a', text: '甲', sup: { id: 'sp_1', state: 'queued' } }] });
  askQueueMark('c1', ['sp_1'], 'received');
  assert.equal(value.queue[0].sup.state, 'received');
});

test('收尾核对：已并入的移出队列，没赶上的退回普通排队并提示', async () => {
  const value = state({
    queue: [
      { id: 'a', text: '并入过的', sup: { id: 'sp_1', runId: 'run-1', state: 'queued' } },
      { id: 'b', text: '没赶上的', sup: { id: 'sp_2', runId: 'run-1', state: 'received' } },
      { id: 'c', text: '普通排队' },
    ],
    run: null,
  });
  value.snapshots['/supplements'] = {
    run_id: 'run-1',
    items: [{ id: 'sp_1', text: '并入过的', status: 'applied' }, { id: 'sp_2', text: '没赶上的', status: 'undelivered' }],
  };
  await askQueueSettle('c1', 'run-1');
  assert.deepEqual(value.queue.map((x) => x.text), ['没赶上的', '普通排队']);
  assert.equal(value.queue[0].sup, undefined);          // 退回普通排队，之后按顺序正常发送
  assert.ok(value.toasts.some((text) => /退回队列/.test(text)));
});

test('任务已结束时直发返回 no_active_run，由调用方退回普通发送', async () => {
  const value = state({ queue: [], run: { runId: 'run-1' } });
  value.snapshots['__none__'] = {};
  const res = await askSupplementSend('补充', 'c1');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'error');
});
