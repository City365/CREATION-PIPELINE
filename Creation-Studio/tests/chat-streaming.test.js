'use strict';
// 流式回复的“逐字显示”切片：只影响正在输出的最后一条，历史消息永远显示全文。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();
const start = source.indexOf('function askShownText(');
const end = source.indexOf('function askMessageHtml(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到 askShownText');

const box = {};
new Function('module', 'exports', `${source.slice(start, end)}\nmodule.exports = { askShownText };`)(box, box.exports);
const { askShownText } = box.exports;

const A = { generating: true };

test('流式中的最后一条按已显示字数截断', () => {
  const messages = [{ role: 'user', text: '问' }, { role: 'assistant', text: '秋天的山很静', _streaming: true, _reveal: 3 }];
  assert.equal(askShownText(messages[1], 1, messages, A), '秋天的');
});

test('已显示字数超过正文时按全文显示', () => {
  const messages = [{ role: 'assistant', text: 'abc', _streaming: true, _reveal: 99 }];
  assert.equal(askShownText(messages[0], 0, messages, A), 'abc');
});

test('历史消息即使带旧的显示进度也显示全文', () => {
  const messages = [{ role: 'assistant', text: '旧的回复内容', _streaming: true, _reveal: 2 }, { role: 'assistant', text: '新的', _streaming: true, _reveal: 0 }];
  assert.equal(askShownText(messages[0], 0, messages, A), '旧的回复内容');
});

test('流式结束后不再截断', () => {
  const messages = [{ role: 'assistant', text: '完整回答', _streaming: false, _reveal: 1 }];
  assert.equal(askShownText(messages[0], 0, messages, A), '完整回答');
});

test('没有进度记录时显示全文', () => {
  const messages = [{ role: 'assistant', text: '回答', _streaming: true }];
  assert.equal(askShownText(messages[0], 0, messages, A), '回答');
});
