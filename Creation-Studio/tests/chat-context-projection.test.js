'use strict';
// 上下文占用口径：压缩之后环必须立刻变小，不能等下一轮 usage 刷新。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();
const start = source.indexOf('function askContextStats(');
const end = source.indexOf('function askFmtTokens(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到 askContextStats');

// 用可控的 chat / state 驱动
function load(chat, state) {
  const box = {};
  new Function('module', 'exports', `
const __chat = ${JSON.stringify(chat)};
const __state = ${JSON.stringify(state)};
function askState() { return __state; }
function askActive() { return __chat; }
${source.slice(start, end)}
module.exports = { askContextStats };
`)(box, box.exports);
  return box.exports.askContextStats;
}

const STATE = { models: [{ id: 'm', context_tokens: 100000 }], modelId: 'm', draft: '' };
const usage = (input, output) => ({ usage: { input_tokens: input, output_tokens: output } });
const report = (used) => ({ context: { report: { used } } });
const turn = (text, extra) => ({ role: 'assistant', text, execution: extra });
const card = (shadowedChars, summary) => ({
  role: 'compacted', text: summary,
  compaction: { shadowed: 6, shadowed_chars: shadowedChars, summary_chars: summary.length },
});

test('优先用下一轮预计（context.report.used），而不是上一轮实际', () => {
  const stats = load({ messages: [turn('答', { ...usage(50000, 1000), ...report(20000) })] }, STATE);
  assert.equal(stats().used, 20000, 'report 存在时以它为准');
  assert.equal(stats().exact, false, '估算值不标 exact');
});

test('没有 report 时回退到上一轮 usage', () => {
  const stats = load({ messages: [turn('答', usage(30000, 2000))] }, STATE);
  assert.equal(stats().used, 32000);
  assert.equal(stats().exact, true);
});

test('压缩卡片出现后占用立刻变小', () => {
  const before = load({ messages: [turn('答', report(60000))] }, STATE);
  const base = before().used;
  // 压缩遮掉 40000 字符（约 28000 token），换回一张 200 字的摘要
  const after = load({
    messages: [turn('答', report(60000)), card(40000, '摘'.repeat(200))],
  }, STATE);
  const now = after().used;
  assert.ok(now < base, `压缩后应更小：${now} < ${base}`);
  assert.equal(now, base - Math.ceil(40000 * 0.7) + Math.ceil(200 * 0.7));
});

test('压缩之后的新对话仍然累加', () => {
  const stats = load({
    messages: [turn('答', report(60000)), card(40000, '摘'.repeat(200)),
      { role: 'user', text: '继续' }, turn('再答', {})],
  }, STATE);
  const expected = 60000 - Math.ceil(40000 * 0.7) + Math.ceil(200 * 0.7)
    + Math.ceil(2 * 0.7) + Math.ceil(2 * 0.7);
  assert.equal(stats().used, expected);
});

test('占用不会掉成负数', () => {
  const stats = load({
    messages: [turn('答', report(1000)), card(999999, '')],
  }, STATE);
  assert.equal(stats().used, 0);
});

test('找不到任何回执时按全文估算', () => {
  const stats = load({
    messages: [{ role: 'user', text: '一'.repeat(100) }, { role: 'assistant', text: '二'.repeat(100) }],
  }, STATE);
  assert.equal(stats().used, Math.ceil(200 * 0.7));
});

test('草稿计入占用', () => {
  const stats = load({ messages: [turn('答', report(1000))] },
    { ...STATE, draft: '写'.repeat(100) });
  assert.equal(stats().used, 1000 + Math.ceil(100 * 0.7));
});

test('占比按所选模型的 context_tokens 归一', () => {
  const stats = load({ messages: [turn('答', report(50000))] }, STATE);
  assert.equal(stats().ratio, 0.5);
});
