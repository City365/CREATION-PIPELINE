'use strict';
// 对话历史按项目分组：没有本地「分组」了，项目就是唯一的分组
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const start = source.indexOf('function askHistoryHtml(');
const end = source.indexOf('function askFilePaneHtml(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到 askHistoryHtml');

const sandbox = {};
new Function('module', 'exports', `
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {
  project: { name: '当前项目测试' },
  projects: [{ id: 'p1', name: '当前项目测试' }, { id: 'p2', name: '骨灯项目' }, { id: 'p3', name: '另一个项目' }],
};
let CURRENT = null;
const askState = () => CURRENT;
const askProjectId = () => 'p1';
const askPreview = (c) => String((c.messages || [])[0]?.text || '').slice(0, 12);
const askRunOf = () => null;
const askRenderAll = () => {};
const askNewConversation = () => { CURRENT.created = (CURRENT.created || 0) + 1; return { id: 'new' }; };
const toast = (text) => { CURRENT.toasts = (CURRENT.toasts || []).concat([String(text)]); };
const askSelect = (id) => { CURRENT.selected = id; };
const askRestore = async () => { CURRENT.restored = (CURRENT.restored || 0) + 1; };
const setActiveProject = async (id) => { CURRENT.switched = (CURRENT.switched || []).concat([id]); };
const askApi = (url, init) => {
  const project = (init && init.headers && init.headers['X-Project-Id']) || '';
  CURRENT.calls = (CURRENT.calls || []).concat([{ url, project }]);
  const items = [{ id: 'c-' + project, title: project + ' 的对话', updated: 2, messages: [{ role: 'user', text: 'x' }] }];
  return Promise.resolve({ json: async () => items });
};
${source.slice(start, end)}
module.exports = { askHistoryHtml, askLoadProjectHistory, askOpenProjectConversation, askNewChatInProject, setState: (v) => { CURRENT = v; } };
`)(sandbox, sandbox.exports);

const { askHistoryHtml, askLoadProjectHistory, askOpenProjectConversation, askNewChatInProject, setState } = sandbox.exports;

const conversation = (id, title, updated = 1) => ({ id, title, updated, messages: [{ role: 'user', text: title }] });

function makeState(patch = {}) {
  const value = {
    historyOpen: true, search: '', conversations: [conversation('c1', '甲对话', 3)],
    projectHistory: null, projectHistoryAt: 0, collapsedFolders: {}, moreMenu: null, removed: false, ...patch,
  };
  setState(value);
  return value;
}

test('侧栏按项目分组；「新建分组」和「未归类对话」都不再出现', () => {
  makeState({
    projectHistory: [
      { id: 'p1', name: '我的同桌测试', items: [conversation('c1', '甲对话')] },
      { id: 'p2', name: '骨灯项目', items: [conversation('c2', '乙对话')] },
    ],
  });
  const html = askHistoryHtml();
  assert.equal(html.includes('新建分组'), false);
  assert.equal(html.includes('未归类对话'), false);
  assert.match(html, /我的同桌测试/);
  assert.match(html, /骨灯项目/);
  assert.match(html, /data-project="p1"/);
  assert.match(html, /data-project="p2"/);
  assert.match(html, /对话按项目保存/);
});

test('没加载过项目历史时退回当前项目，不会空着', () => {
  makeState();
  const html = askHistoryHtml();
  assert.match(html, /当前项目测试/);
  assert.match(html, /甲对话/);
});

test('搜索在每个项目内过滤', () => {
  makeState({
    search: '乙',
    projectHistory: [
      { id: 'p1', name: '我的同桌测试', items: [conversation('c1', '甲对话')] },
      { id: 'p2', name: '骨灯项目', items: [conversation('c2', '乙对话')] },
    ],
  });
  const html = askHistoryHtml();
  assert.equal(html.includes('甲对话'), false);
  assert.match(html, /乙对话/);
});

test('其它项目的会话按项目拉取（带 X-Project-Id），当前项目用内存里的列表', async () => {
  const a = makeState();
  await askLoadProjectHistory(true);
  assert.deepEqual((a.calls || []).map((c) => c.project).sort(), ['p2', 'p3']);
  assert.ok((a.calls || []).every((c) => c.url === '/sessions'));
  const row = (id) => a.projectHistory.find((x) => x.id === id);
  assert.deepEqual(row('p1').items.map((c) => c.id), ['c1']);
  assert.deepEqual(row('p2').items.map((c) => c.id), ['c-p2']);
  assert.equal(a.projectHistory.length, 3);
});

test('打开别的项目里的对话：先切项目，再打开会话', async () => {
  const a = makeState({ conversations: [conversation('c9', '别的对话')] });
  await askOpenProjectConversation('p2', 'c9');
  assert.deepEqual(a.switched, ['p2']);
  assert.equal(a.restored, 1);
  assert.equal(a.selected, 'c9');
});

test('当前项目里的对话直接打开，不切项目', async () => {
  const a = makeState({ conversations: [conversation('c1', '甲对话')] });
  await askOpenProjectConversation('p1', 'c1');
  assert.equal(a.switched, undefined);
  assert.equal(a.selected, 'c1');
});

test('对话已经不在项目里时给出提示，不乱打开', async () => {
  const a = makeState({ conversations: [] });
  await askOpenProjectConversation('p1', 'gone');
  assert.equal(a.selected, undefined);
  assert.ok(a.toasts.join('').includes('已不在该项目'));
});

test('在项目行上点「＋」= 切到该项目并新建对话', async () => {
  const a = makeState();
  await askNewChatInProject('p2');
  assert.deepEqual(a.switched, ['p2']);
  assert.equal(a.created, 1);
});

test('app.js 里旧的分组入口已经清干净', () => {
  assert.equal(source.includes('新建分组'), false);
  assert.equal(source.includes('ask-folder-create'), false);
  assert.equal(source.includes('ask-folder-move'), false);
  assert.equal(source.includes('移动到分组'), false);
  assert.equal(source.includes('askFolderDialogHtml'), false);
  assert.equal(source.includes('askSaveFolder'), false);
});
