'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectorsFor, DOUBAO_DEFAULTS } = require('../src/automation');

test('豆包账号没配置选择器时用页面默认值，不会报未配置', () => {
  const selectors = selectorsFor('doubao', { selectors: {} });
  assert.equal(selectors.durationControl, DOUBAO_DEFAULTS.durationControl);
  assert.ok(selectors.ratioControl && selectors.editor && selectors.send && selectors.upload);
  assert.ok(selectors.attachment);
});

test('账号自己的选择器覆盖默认值，其余仍继承', () => {
  const selectors = selectorsFor('doubao', { selectors: { editor: '#custom', durationControl: '#duration' } });
  assert.equal(selectors.editor, '#custom');
  assert.equal(selectors.durationControl, '#duration');
  assert.equal(selectors.send, DOUBAO_DEFAULTS.send);
});

test('其他平台不会被塞进豆包选择器', () => {
  const selectors = selectorsFor('gemini', { selectors: { editor: '#g' } });
  assert.deepEqual(selectors, { editor: '#g' });
});
