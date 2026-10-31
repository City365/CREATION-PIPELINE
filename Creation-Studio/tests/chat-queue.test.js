'use strict';
// 待发送队列：排队、只发队首、按对话持久化（刷新不丢）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const start = source.indexOf('function askQueueKey(');
const end = source.indexOf('function askQueueHtml(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到队列实现');
const block = source.slice(start, end);

function makeQueue(store = new Map()) {
  let seq = 0;
  const sandbox = {
    store,
    sent: [],
    state: { activeId: 'c1', draft: '', queues: {}, conversations: [{ id: 'c1' }, { id: 'c2' }] },
    busy: false,
    askId: () => 'q' + (++seq),
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    askState: () => sandbox.state,
    askRunOf: (id) => (sandbox.busy && id === sandbox.state.activeId ? { chatId: id } : null),
    $: () => null,
    toast: () => {},
    askRenderAll: () => {},
    askSend: (text, chatId) => { sandbox.sent.push({ text, chatId }); return Promise.resolve(); },
  };
  // eslint-disable-next-line no-new-func
  new Function('sandbox', `with (sandbox) { ${block}\n; sandbox.api = { askEnqueue, askLoadQueue, askSaveQueue, askDrainQueue, askQueueKey }; }`)(sandbox);
  return sandbox;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('排队写入本地存储，并按对话隔离', () => {
  const box = makeQueue();
  box.api.askEnqueue('第一条', 'c1');
  box.api.askEnqueue('第二条', 'c1');
  box.api.askEnqueue('另一个对话', 'c2');
  assert.deepEqual(box.api.askLoadQueue('c1').map((x) => x.text), ['第一条', '第二条']);
  assert.deepEqual(box.api.askLoadQueue('c2').map((x) => x.text), ['另一个对话']);
  assert.equal(JSON.parse(box.store.get(box.api.askQueueKey('c1'))).length, 2);
});

test('刷新后从本地存储恢复队列', () => {
  const store = new Map();
  const first = makeQueue(store);
  first.api.askEnqueue('刷新前排队', 'c1');
  const second = makeQueue(store);   // 模拟重新打开页面：内存清空，存储保留
  assert.deepEqual(second.api.askLoadQueue('c1').map((x) => x.text), ['刷新前排队']);
});

test('一轮结束后只发队首，剩下的继续排队', async () => {
  const box = makeQueue();
  box.api.askEnqueue('第一条', 'c1');
  box.api.askEnqueue('第二条', 'c1');
  box.api.askDrainQueue('c1');
  await wait(200);
  assert.deepEqual(box.sent.map((s) => s.text), ['第一条']);
  assert.deepEqual(box.api.askLoadQueue('c1').map((x) => x.text), ['第二条']);
  box.api.askDrainQueue('c1');
  await wait(200);
  assert.deepEqual(box.sent.map((s) => s.text), ['第一条', '第二条']);
  assert.equal(box.api.askLoadQueue('c1').length, 0);
});

test('还在生成时不会把队列一次性发出去', async () => {
  const box = makeQueue();
  box.busy = true;
  box.api.askEnqueue('第一条', 'c1');
  box.api.askDrainQueue('c1');
  await wait(200);
  assert.equal(box.sent.length, 0);
  assert.equal(box.api.askLoadQueue('c1').length, 1);
});

test('取消只移除指定那条，其余顺序不变', () => {
  const box = makeQueue();
  box.api.askEnqueue('第一条', 'c1');
  box.api.askEnqueue('第二条', 'c1');
  const list = box.api.askLoadQueue('c1');
  const target = list[0].id;
  list.splice(list.findIndex((x) => x.id === target), 1);
  box.api.askSaveQueue('c1');
  assert.deepEqual(box.api.askLoadQueue('c1').map((x) => x.text), ['第二条']);
});
