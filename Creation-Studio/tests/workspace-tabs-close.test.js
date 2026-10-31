'use strict';
// 工作区标签：关掉最后一个标签 = 退出工作区（与右上角 ✕ 一致）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function workspace() {
  const state = {};
  let closed = 0;
  const calls = [];
  const c = {
    projectId: 'p1', sessionId: 's1', projectName: '测试', expanded: false,
    state: () => state, render: () => {}, toast: () => {}, open: () => {},
    close: () => { closed += 1; },
    apply: () => {}, previewHtml: () => '<div data-preview></div>',
    trajectoryHtml: () => '', loadTrajectory: () => {},
  };
  const context = {
    window: {}, document: { addEventListener() {}, querySelector() { return null; } },
    setTimeout, clearTimeout, URLSearchParams, console,
    fetch: async (url) => {
      calls.push(url);
      if (url.includes('/tree')) return { ok: true, json: async () => ({ rootName: '测试', items: [], nextOffset: null }) };
      if (url.includes('/preview')) return { ok: true, json: async () => ({ kind: 'text', content: 'x' }) };
      return { ok: true, json: async () => ({ id: 'f1', name: '一.md', relative_path: '一.md' }) };
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/agent-workspace.js'), 'utf8'), context);
  return { ws: context.window.AgentWorkspace, c, closed: () => closed, state };
}

test('只剩一个标签时，关闭它等于关闭整个工作区', () => {
  const { ws, c, closed } = workspace();
  ws.html(c);
  assert.equal(ws.active().type, 'start');
  ws.closeCurrent();
  assert.equal(closed(), 1, '应当调用 context.close()，也就是右上角 ✕ 的同一条路径');
  // 再打开一次，工作区仍然是一个新标签页（不会残留上次的关闭状态）
  ws.html(c);
  assert.match(ws.html(c), /新标签页/);
});

test('还有别的标签时只关这一个，不退出工作区', async () => {
  const { ws, c, closed } = workspace();
  ws.html(c);
  await ws.openFile('f1', { id: 'f1', name: '一.md', relative_path: '一.md' });
  assert.ok(ws.html(c).includes('一.md'));
  ws.closeCurrent();
  assert.equal(closed(), 0, '还有「新标签页」在，不该退出工作区');
  assert.equal(ws.active().type, 'start');
  assert.ok(!ws.html(c).includes('一.md'));
});

test('关掉最后一个文件标签也一样退出，不是留一个空壳', async () => {
  const { ws, c, closed } = workspace();
  ws.html(c);
  await ws.openFile('f1', { id: 'f1', name: '一.md', relative_path: '一.md' });
  // 先关掉启动页，只剩文件标签
  ws.select('start');
  ws.closeCurrent();
  assert.equal(closed(), 0);
  ws.closeCurrent();
  assert.equal(closed(), 1);
});

test('app.js：右上角 ✕ 与标签关闭共用 askCloseWorkspace，并清空预览状态', () => {
  const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
  assert.match(source, /function askCloseWorkspace\(\)/);
  assert.match(source, /if \(act === 'ask-close-cap'\) \{ return askCloseWorkspace\(\); \}/);
  assert.match(source, /open:askOpenWorkspace,close:askCloseWorkspace/);
  const fn = source.slice(source.indexOf('function askCloseWorkspace()'), source.indexOf('function askWorkspaceContext()'));
  const a = { capabilitiesOpen: true, previewFile: { id: 'f1' }, previewData: {}, mediaPreview: {} };
  let rendered = 0;
  vm.runInNewContext(fn + ';askCloseWorkspace();', {
    askState: () => a, askRenderAll: () => { rendered += 1; },
    AgentWorkspace: { sync: () => {} },
  });
  assert.equal(a.capabilitiesOpen, false);
  assert.equal(a.previewFile, null);
  assert.equal(a.previewData, null);
  assert.equal(a.mediaPreview, null);
  assert.equal(rendered, 1);
});
