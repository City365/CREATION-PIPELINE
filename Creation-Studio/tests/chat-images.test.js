'use strict';
// 聊天里模型常用 Markdown 图片语法引用本地素材（/api/file?path=…）。
// 这里校验前端会把它渲染成图片，而不是把地址原文丢在对话里。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();
const start = source.indexOf('function askImageUrl(raw) {');
const end = source.indexOf('function markdownLite(text) {');
assert.ok(start > 0 && end > start, '在 app.js 里找不到图片渲染段落');

const box = {};
new Function('module', 'exports', `
const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
${source.slice(start, end)}
module.exports = { mdInline, askImageUrl };
`)(box, box.exports);
const { mdInline, askImageUrl } = box.exports;

const LOCAL = '/api/file?path=D%3A%5Cnotebook%5Csoftware%5CWENYUN.M-DESKTOP%E6%A1%8C%E9%9D%A2%E7%89%8810-23-1000-WIN%5C%E5%AA%92%E4%BD%93%E5%BA%93%5Cimages%5C2026-10-27%5Cimg-6298dafeae57-01.png';

test('本地素材路径的 Markdown 图片会渲染成 img', () => {
  const html = mdInline(`![]( ${LOCAL} )`);
  assert.ok(html.includes('<img class="ask-inline-img"'), html);
  assert.ok(html.includes('src="' + LOCAL + '"'));
  assert.ok(!html.includes('!['), '不应残留 Markdown 图片语法');
});

test('带说明文字的图片保留 alt', () => {
  const html = mdInline('**第 4 组**\n![溪涧红叶与倒影](' + LOCAL + ')');
  assert.ok(html.includes('alt="溪涧红叶与倒影"'));
  assert.ok(html.includes('<strong>第 4 组</strong>'));
});

test('图片可点开大图预览', () => {
  const html = mdInline('![场景](' + LOCAL + ')');
  assert.ok(html.includes('data-act="ask-open-inline"'));
  assert.ok(html.includes('data-label="场景"'));
});

test('远程图片同样支持', () => {
  assert.ok(mdInline('![x](https://example.com/a.png)').includes('<img class="ask-inline-img"'));
});

test('不安全的地址不会被渲染', () => {
  assert.equal(askImageUrl('javascript:alert(1)'), '');
  assert.equal(askImageUrl('data:text/html;base64,AAAA'), '');
  assert.equal(askImageUrl('file:///C:/secret.png'), '');
  const html = mdInline('![x](javascript:alert(1))');
  assert.ok(!html.includes('<img'));
});

test('普通链接与叹号文本不受影响', () => {
  assert.ok(mdInline('[文档](https://example.com)').includes('<a href="https://example.com"'));
  assert.equal(mdInline('太好了！真的不错').includes('<img'), false);
});
