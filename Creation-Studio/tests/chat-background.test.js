'use strict';
// 后台运行登记：切换对话不能打断正在生成的任务。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();
const start = source.indexOf('function askRuns(a = askState())');
const end = source.indexOf('async function askRestore()');
assert.ok(start > 0 && end > start, '在 app.js 里找不到运行登记相关代码');

const box = {};
new Function('module', 'exports', `
let CURRENT = null;
function askState() { return CURRENT; }
${source.slice(start, end)}
module.exports = { askRuns, askRunOf, askAbortRuns, askSyncRunState, setCurrent(v) { CURRENT = v; } };
`)(box, box.exports);
const api = box.exports;

const makeState = (activeId) => ({ activeId, runs: new Map(), generating: false, request: null, controller: null, startedAt: 0 });
const makeController = () => ({ aborted: false, abort() { this.aborted = true; } });

test('切换对话时“生成中”跟着对话走', () => {
  const a = makeState('B');
  api.setCurrent(a);
  const ctrlA = makeController();
  api.askRuns(a).set('A', { chatId: 'A', requestId: 'r1', controller: ctrlA, startedAt: 1, msg: { _reveal: 5 } });
  api.askSyncRunState();
  assert.equal(a.generating, false, '看的是 B，A 在跑，不能显示成 B 在生成');
  assert.equal(a.request, null);
  a.activeId = 'A';
  api.askSyncRunState();
  assert.equal(a.generating, true, '切回 A 应该恢复生成中状态');
  assert.equal(a.request.sessionId, 'A');
  assert.equal(a.controller, ctrlA);
  assert.equal(a.runs.get('A').msg._reveal, null, '切回时直接显示已有内容');
});

test('切换对话不会中止其它对话的任务', () => {
  const a = makeState('A');
  api.setCurrent(a);
  const ctrl = makeController();
  api.askRuns(a).set('A', { chatId: 'A', requestId: 'r2', controller: ctrl, startedAt: 1, msg: null });
  a.activeId = 'B';
  api.askSyncRunState();
  assert.equal(ctrl.aborted, false, '换到别的对话不能 abort 正在跑的任务');
  assert.notEqual(api.askRunOf('A'), null, '后台任务仍应留在登记表里');
});

test('只有整项目重置才统一中止', () => {
  const a = makeState('A');
  api.setCurrent(a);
  const ctrl = makeController();
  api.askRuns(a).set('A', { chatId: 'A', requestId: 'r3', controller: ctrl, startedAt: 1, msg: null });
  api.askAbortRuns();
  assert.equal(ctrl.aborted, true);
  assert.equal(a.runs.size, 0);
  assert.equal(a.generating, false);
});

test('askSelect 不再直接 abort 控制器', () => {
  const body = source.slice(source.indexOf('function askSelect(id)'), source.indexOf('function askPreview(c)'));
  assert.equal(/controller\.abort\(\)/.test(body), false, 'askSelect 里不应再 abort');
  assert.ok(body.includes('askSyncRunState()'));
});

test('左侧对话列表用圆圈标记“正在生成”的对话', () => {
  assert.ok(source.includes('ask-history-flag'), '历史条目要有状态标记元素');
  assert.ok(source.includes('askRunOf(c.id) ? \'is-running\''), '渲染时按运行状态加 is-running');
  const refresh = source.slice(source.indexOf('function askRefreshHistoryFlags()'), source.indexOf('function askScrollBottom()'));
  assert.ok(refresh.includes('askRunOf(id)'), '刷新时也要看运行状态');
  assert.ok(/flag\.textContent = running \? '' :/.test(refresh), '运行中不显示字符，改用转圈');
  assert.equal(source.includes('\'▢\''), false, '不再使用方形占位符');
});

test('刷新页面后能重新接上后台任务', () => {
  assert.ok(source.includes("askApi('/runs/active')"), '刷新后要拉取仍在运行的任务');
  assert.ok(source.includes('async function askAttachRun('), '需要有按事件序号补齐内容的重连逻辑');
  const attach = source.slice(source.indexOf('async function askAttachRun('), source.indexOf('function askScrollBottom()') > 0 ? source.indexOf('function askScrollBottom()') : source.length);
  assert.ok(attach.includes("'/runs/' + encodeURIComponent(run.runId) + '/events?after='"), '重连要读运行事件');
  const restore = source.slice(source.indexOf('async function askRestore()'), source.indexOf('// 从服务端拿还在这跑的对话'));
  assert.ok(restore.includes('wmd-ask-active'), '刷新后应回到上次停留的对话');
});

test('重连的任务也能停止（走 run 取消接口）', () => {
  const stop = source.slice(source.indexOf('async function askStop()'), source.indexOf('async function askChooseCommand('));
  assert.ok(stop.includes("'/api/agent/runs/'"), '应该优先用 run 取消接口');
  assert.ok(stop.includes('request.runId'));
});
