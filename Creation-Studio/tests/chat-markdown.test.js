'use strict';
// 对话正文的基础排版：标题、表格、列表要真的渲染出来，而不是一堆管道符
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();

function extract(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start > 0, `找不到 ${name}`);
  let depth = 0;
  let i = source.indexOf('{', start);
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { i += 1; break; }
    }
  }
  return source.slice(start, i);
}

const prelude = `
const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const askImageUrl = (src) => String(src || '');
`;
const box = {};
new Function('module', 'exports', prelude + extract('mdInline') + extract('markdownLite') + extract('askMarkdown') + `
module.exports = { mdInline, markdownLite, askMarkdown };
`)(box, box.exports);
const md = box.exports;

test('标题渲染成标题标签', () => {
  const html = md.askMarkdown('## 四、秋风萧瑟的美感\n\n正文一段。\n\n### 小标题');
  assert.match(html, /<h2>四、秋风萧瑟的美感<\/h2>/);
  assert.match(html, /<h3>小标题<\/h3>/);
});

test('标准表格渲染成 table，含表头与表体', () => {
  const html = md.askMarkdown('| 镜头 | 时长 | 画面 |\n| --- | --- | --- |\n| 01 | 8s | 空镜 |\n| 02 | 8s | 雨夜 |');
  assert.match(html, /class="md-table"/);
  assert.match(html, /<th>镜头<\/th>/);
  assert.match(html, /<td>雨夜<\/td>/);
  assert.doesNotMatch(html, /\|\s*---/, '分隔行不该留在正文里');
});

test('全角竖线的表格也能认出来', () => {
  const html = md.askMarkdown('｜ 名称 ｜ 值 ｜\n｜ --- ｜ --- ｜\n｜ 风格 ｜ 东方仙侠 ｜');
  assert.match(html, /<th>名称<\/th>/);
  assert.match(html, /<td>东方仙侠<\/td>/);
});

test('对齐写法（:---:）与无首尾竖线都支持', () => {
  const html = md.askMarkdown('名称 | 值\n:--- | ---:\n风格 | 仙侠');
  assert.match(html, /<th>名称<\/th>/);
  assert.match(html, /<td>仙侠<\/td>/);
});

test('列表与引用不串行', () => {
  const html = md.askMarkdown('1. 先定调\n2. 再分镜\n\n- 参考一\n- 参考二\n\n> 一句引用');
  assert.match(html, /<ol><li>先定调<\/li>/);
  assert.match(html, /<ul><li>参考一<\/li>/);
  assert.match(html, /<blockquote>/);
});

test('组件里的文字遇到标题或表格按块级排版', () => {
  assert.match(source, /is-block">\$\{askMarkdown\(raw\)\}/, 'GenUI 的 text 需要能渲染块级 md');
  assert.match(source, /const raw = \(node\.children \|\| \[\]\)/, '要先取出纯文本再判断块级语法');
  assert.match(fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8'), /\.gu-text\.is-block h1/);
});

test('表格与标题在样式里有定义，不是裸标签', () => {
  const css = fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8');
  assert.match(css, /\.md-table table \{[^}]*border-collapse/);
  assert.match(css, /\.md-table th, \.md-table td \{[^}]*border:\s*1px/);
  assert.match(css, /\.ask-message-text h2/);
  assert.match(css, /\.gu-text\.is-block h1/);
});
