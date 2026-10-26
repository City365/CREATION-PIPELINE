'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectImages } = require('../src/imagegen');

const imageA = Buffer.from('a'.repeat(200)).toString('base64');
const imageB = Buffer.from('b'.repeat(200)).toString('base64');

test('同一结果同时返回 b64 和 url 时只保留一张', () => {
  const items = collectImages({ data: [{ b64_json: imageA, url: 'https://example.com/a.png' }] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'b64');
});

test('重复返回的同一张 b64 只保留一张', () => {
  assert.equal(collectImages({ data: [{ b64_json: imageA }, { b64_json: imageA }] }).length, 1);
});

test('两张不同图片仍然都保留', () => {
  assert.equal(collectImages({ data: [{ b64_json: imageA }, { b64_json: imageB }] }).length, 2);
});

test('只有 url 时仍然使用 url', () => {
  const items = collectImages({ data: [{ url: 'https://example.com/a.png' }] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'url');
});
