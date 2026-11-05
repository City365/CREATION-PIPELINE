'use strict';
// 场景四视图出图时：图片区中间要转圈 + 已等时长 + 进度条，排队的那几张写明在排队。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/creative.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../web/creative.css'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start > 0 && end > start, `在 creative.js 里找不到 ${startMarker}`);
  return source.slice(start, end);
}

const waitSource = slice('function sceneWaitElapsedText(startedAt) {', 'function sceneWorkspaceHtml()');

function makeSandbox() {
  const sandbox = {};
  new Function('module', 'exports', `
const esc = (value) => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let FLOW = { busy: '', viewBusy: {}, views: [] };
const sceneFlow = () => FLOW;
const document = { querySelectorAll: () => [], querySelector: () => null };
${waitSource}
module.exports = { sceneViewCard, sceneWaitElapsedText, setFlow: (value) => { FLOW = value; } };
`)(sandbox, sandbox.exports);
  return sandbox.exports;
}

const views = ['front', 'side', 'back', 'top'].map((id) => ({ id, label: id, hint: id + '机位', prompt: '提示词 ' + id, image: null }));

test('正在出的那一张：图片区中间有转圈、第几张、已等时长和进度条', () => {
  const box = makeSandbox();
  const startedAt = Date.now() - 12000;
  box.setFlow({ busy: 'all', viewBusy: { front: startedAt, side: 0 }, views: views.map((v) => ({ ...v })) });
  const html = box.sceneViewCard(views[0]);
  assert.match(html, /class="scn-wait"/, '要有等待浮层');
  assert.match(html, /class="scn-ring"/, '要有转圈');
  assert.match(html, /第 1\/4 张 · 生成中/, '整批生成要写第几张');
  assert.match(html, /data-scn-wait-elapsed="\d+"/, '要带开始时间，方便每秒更新已等多久');
  assert.match(html, /已等 12 秒/);
  assert.match(html, /class="scn-wait-bar is-live"/, '整批生成用带进度的条');
  assert.match(html, /生成中…/, '按钮文案');
});

test('排队中的那几张：写明排队，不再假装生成中', () => {
  const box = makeSandbox();
  box.setFlow({ busy: 'all', viewBusy: { front: Date.now() }, views: views.map((v) => ({ ...v })) });
  const html = box.sceneViewCard(views[2]);
  assert.ok(!html.includes('scn-wait'), '没轮到的不要转圈');
  assert.match(html, /排队中 · 等前面一张出完/);
  assert.match(html, /排队中…/, '按钮文案也要是排队中');
});

test('单张出图没有真实进度：用不确定进度条，不编百分比', () => {
  const box = makeSandbox();
  box.setFlow({ busy: '', viewBusy: { side: Date.now() }, views: views.map((v) => ({ ...v })) });
  const html = box.sceneViewCard(views[1]);
  assert.match(html, /scn-wait-bar is-indeterminate/);
  assert.match(html, /正在生成/);
  assert.ok(!/第 \d+\/\d+ 张/.test(html), '单张不显示第几张');
});

test('整批已出完的张数会推着进度条走', () => {
  const box = makeSandbox();
  const done = views.map((v) => ({ ...v, image: { url: '/x.png' } }));
  box.setFlow({ busy: 'all', viewBusy: { top: Date.now() }, views: done });
  const html = box.sceneViewCard(done[3]);
  assert.match(html, /第 4\/4 张 · 生成中/);
  assert.match(html, /width:100%/, '前 3 张出完，进度到 100% 那一段');
});

test('已等时长按秒走，超过一分钟换成几分几秒', () => {
  const box = makeSandbox();
  const now = Date.now();
  assert.equal(box.sceneWaitElapsedText(now - 8000), '已等 8 秒');
  assert.equal(box.sceneWaitElapsedText(now - 65000), '已等 1 分 5 秒');
});

test('每秒只改文字，不整页重画；样式表里有转圈和进度条', () => {
  assert.ok(source.includes('function sceneStartWaitTicker('), '要有计时器');
  assert.ok(source.includes('sceneStartWaitTicker();'), '渲染后要启动计时器');
  const tick = slice('function sceneWaitTick() {', 'function sceneStartWaitTicker() {');
  assert.ok(tick.includes('data-scn-wait-elapsed'), '只挑等待节点');
  assert.ok(tick.includes('textContent'), '只改文字');
  assert.ok(!tick.includes('render('), '不能整页重画');
  assert.ok(/\.scn-ring\s*\{[^}]*animation:scn-ring/.test(css), '转圈有动画');
  assert.ok(/@keyframes scn-ring/.test(css), '转圈关键帧完整');
  assert.ok(/\.scn-wait-bar\.is-indeterminate/.test(css), '不确定进度条样式');
  assert.ok(/\.scn-shot\s*\{[^}]*position\s*:\s*relative/.test(css), '图片区要能定位等待浮层');
});
