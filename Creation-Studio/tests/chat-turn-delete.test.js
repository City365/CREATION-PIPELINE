'use strict';
// 删除一轮：问题连同它的回复（可能多条）一起删掉
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const start = source.indexOf('function askTurnSpan(');
const end = source.indexOf('// 右侧轮次滑条');
assert.ok(start > 0 && end > start, '在 app.js 里找不到 askTurnSpan');

const box = {};
new Function('module', 'exports', `${source.slice(start, end)}\nmodule.exports = { askTurnSpan };`)(box, box.exports);
const { askTurnSpan } = box.exports;

const MSGS = [
  { role: 'user', text: '第一问' },
  { role: 'assistant', text: '第一答' },
  { role: 'user', text: '第二问' },
  { role: 'assistant', text: '第二答' },
  { role: 'assistant', text: '第二答补充' },
  { role: 'user', text: '第三问' },
  { role: 'assistant', text: '第三答' },
];

test('一轮包含问题和它后面的全部回复', () => {
  const span = askTurnSpan(MSGS, 2);
  assert.deepEqual(span, { start: 2, end: 5, count: 3 });
});

test('删除中间一轮不影响其它轮次', () => {
  const span = askTurnSpan(MSGS, 2);
  const next = [...MSGS];
  next.splice(span.start, span.count);
  assert.deepEqual(next.map((m) => m.text), ['第一问', '第一答', '第三问', '第三答']);
});

test('最后一轮删到结尾', () => {
  const span = askTurnSpan(MSGS, 5);
  assert.deepEqual(span, { start: 5, end: 7, count: 2 });
});

test('不是用户消息就不处理', () => {
  assert.equal(askTurnSpan(MSGS, 1), null);
  assert.equal(askTurnSpan(MSGS, 99), null);
  assert.equal(askTurnSpan([], 0), null);
});

test('界面上有删除入口，并且会持久化', () => {
  assert.ok(source.includes('data-act="ask-delete-turn"'), '用户消息上要有删除按钮');
  const handler = source.slice(source.indexOf("if (act === 'ask-delete-turn')"), source.indexOf("if (act === 'ask-jump')"));
  assert.ok(handler.includes('confirm('), '删除前要确认');
  assert.ok(handler.includes('askTurnSpan('), '按轮次范围删除');
  assert.ok(handler.includes('askPersist()'), '删完要同步到服务端');
  assert.ok(handler.includes('generating'), '生成中应挡住删除');
});
