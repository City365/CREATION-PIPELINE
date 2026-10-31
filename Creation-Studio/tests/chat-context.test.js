'use strict';
// 输入框旁的上下文占用圈：15k/1024k 这种显示与配色阈值
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const start = source.indexOf('function askFmtTokens(');
const end = source.indexOf('function askContextMeterHtml(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到 askFmtTokens');

const box = {};
new Function('module', 'exports', `
const ASK_CTX_R = 6.6;
const ASK_CTX_C = 2 * Math.PI * ASK_CTX_R;
${source.slice(start, end)}
module.exports = { askFmtTokens, askCtxTone, ASK_CTX_C };
`)(box, box.exports);
const { askFmtTokens, askCtxTone, ASK_CTX_C } = box.exports;

test('token 数量按 k/m 缩写', () => {
  assert.equal(askFmtTokens(0), '0');
  assert.equal(askFmtTokens(999), '999');
  assert.equal(askFmtTokens(15000), '15k');
  assert.equal(askFmtTokens(1024000), '1m');
  assert.equal(askFmtTokens(1536), '2k');
});

test('占用配色有 80% 与 95% 两档阈值', () => {
  assert.equal(askCtxTone(0.2), '');
  assert.equal(askCtxTone(0.79), '');
  assert.equal(askCtxTone(0.8), 'is-warn');
  assert.equal(askCtxTone(0.94), 'is-warn');
  assert.equal(askCtxTone(0.95), 'is-danger');
  assert.equal(askCtxTone(1), 'is-danger');
});

test('圆圈周长用于 stroke-dasharray，能画出占比', () => {
  assert.ok(ASK_CTX_C > 41 && ASK_CTX_C < 42, '半径 6.6 的周长约 41.5');
  const ring = source.slice(source.indexOf('function askContextMeterHtml('), source.indexOf('function askUpdateContextMeter('));
  assert.ok(ring.includes('stroke-dasharray'), '用 dasharray 画占比');
  assert.ok(ring.includes('ask-ctx-text'), '要显示 已用/总量 文本');
  const update = source.slice(source.indexOf('function askUpdateContextMeter('), source.indexOf('function askEfforts(') > 0 ? source.length : source.length);
  assert.ok(update.includes('setAttribute(\'stroke-dasharray\''), '要能就地更新占比');
});

test('输入框里放在发送按钮左边', () => {
  const composer = source.slice(source.indexOf('function askComposerHtml('), source.indexOf('/* ----------------------- 上下文占用'));
  const meterAt = composer.indexOf('askContextMeterHtml()');
  const sendAt = composer.indexOf('data-act="ask-send"');
  assert.ok(meterAt > 0 && sendAt > 0, '两者都要在输入区里');
  assert.ok(meterAt < sendAt, '圆圈统计要排在发送按钮之前');
});

test('上下文总量取所选模型的 context_tokens', () => {
  const stats = source.slice(source.indexOf('function askContextStats('), source.indexOf('function askFmtTokens('));
  assert.ok(stats.includes('context_tokens'), '总量来自模型能力');
  assert.ok(stats.includes('input_tokens'), '已用优先取上一轮真实 usage');
  assert.ok(stats.includes('a.draft'), '草稿也要算进占用');
});
