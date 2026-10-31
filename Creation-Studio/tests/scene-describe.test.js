'use strict';
// 场景建模：反推要有可感知的进行中状态，左栏与源图区尺寸要够
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '../web/creative.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../web/creative.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');

test('反推描述按钮真的会触发反推', () => {
  assert.ok(js.includes("if (action === 'describe') return describe();"), 'data-scn="describe" 要接到 describe()');
  assert.ok(js.includes('async function describe('), '要有 describe 实现');
});

test('反推期间有可见的进行中状态', () => {
  assert.ok(js.includes('反推中…'), '按钮文案切换');
  assert.ok(js.includes('scn-stage-busy'), '图片区要有遮罩提示');
  assert.ok(js.includes('正在读图反推描述…'), '遮罩文案');
  assert.ok(js.includes('scn-busy'), '按钮下方要有状态行');
  assert.ok(js.includes('正在用推理模型读图'), '状态行文案');
  assert.ok(/data-scn="library" \$\{f\.busy \? 'disabled' : ''\}/.test(js), '忙碌时其它按钮禁用');
});

test('生成四视图提示词也有进行中提示', () => {
  assert.ok(js.includes('正在推理四条机位提示词'), '提示词生成要有状态行');
  assert.ok(js.includes("${f.busy ? 'disabled' : ''}>${f.busy === 'prompts'"), '按钮文案切换');
});

test('左栏加宽、源图框加高', () => {
  assert.ok(/\.ce-scene\.scn\s*\{\s*grid-template-columns:\s*380px/.test(css), '场景页左栏 380px');
  const stage = css.slice(css.indexOf('.scn-source-stage {'), css.indexOf('.scn-source-stage.is-filled'));
  assert.ok(stage.includes('height:190px'), '源图框高度 190px');
});

test('creative 资源版本号已更新，避免吃到旧缓存', () => {
  assert.ok(html.includes('/creative.js?v=3'), '脚本版本号');
  assert.ok(html.includes('/creative.css?v=3'), '样式版本号');
});
