'use strict';
// 对话隔离：侧栏只列当前项目的对话，跨项目不读、不列、不跳（租户 → 用户 → 项目）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();
const start = source.indexOf('function askHistoryHtml(');
const end = source.indexOf('function askFilePaneHtml(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到 askHistoryHtml');

const sandbox = {};
new Function('module', 'exports', `
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {
  route: 'script',
  project: { name: '当前项目测试' },
  projects: [{ id: 'p1', name: '当前项目测试' }, { id: 'p2', name: '骨灯项目' }],
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
  return Promise.resolve({ json: async () => [] });
};
${source.slice(start, end)}
module.exports = { askHistoryHtml, askLoadProjectHistory, askOpenProjectConversation, askNewChatInProject, askForgetConversation, askFindConversation, askSyncCurrentRowItems, setState: (v) => { CURRENT = v; } };
`)(sandbox, sandbox.exports);

const { askHistoryHtml, askLoadProjectHistory, askOpenProjectConversation, askNewChatInProject, askForgetConversation, askFindConversation, askSyncCurrentRowItems, setState } = sandbox.exports;

const conversation = (id, title, updated = 1) => ({ id, title, updated, messages: [{ role: 'user', text: title }] });

function makeState(patch = {}) {
  const value = {
    historyOpen: true, search: '', conversations: [conversation('c1', '甲对话', 3)],
    projectHistory: null, collapsedFolders: {}, moreMenu: null, removed: false, ...patch,
  };
  setState(value);
  return value;
}

test('侧栏只有当前项目一组，别的项目名不出现', async () => {
  const a = makeState();
  await askLoadProjectHistory();
  const html = askHistoryHtml();
  assert.match(html, /当前项目测试/, '要有当前项目的分组标题');
  assert.equal(html.includes('骨灯项目'), false, '别的项目不能出现在侧栏');
  assert.equal((html.match(/ask-folder-heading/g) || []).length, 1, '只允许一个分组头');
  assert.match(html, /只显示当前项目的对话/, '标题要说明只列当前项目');
  assert.equal(a.projectHistory.length, 1);
});

test('没加载过历史时退回当前项目，不会空着', () => {
  makeState();
  const html = askHistoryHtml();
  assert.match(html, /当前项目测试/);
  assert.match(html, /甲对话/);
});

test('搜索只在当前项目里过滤', () => {
  makeState({ search: '乙' });
  const html = askHistoryHtml();
  assert.equal(html.includes('甲对话'), false);
});

test('整理历史时不发任何跨项目请求', async () => {
  const a = makeState();
  await askLoadProjectHistory();
  assert.deepEqual(a.calls || [], [], '不应该把别的项目的 /sessions 拉开');
  assert.equal(a.projectHistory.length, 1);
  assert.equal(a.projectHistory[0].id, 'p1');
  assert.equal(a.projectHistory[0].items, a.conversations, '历史行要和当前列表同源');
});

test('点别的项目里的对话：只提示，不切项目也不打开', async () => {
  const a = makeState({ conversations: [conversation('c9', '别的对话')] });
  await askOpenProjectConversation('p2', 'c9');
  assert.equal(a.switched, undefined, '不能顺手切项目');
  assert.equal(a.restored, undefined);
  assert.equal(a.selected, undefined, '不能打开别的项目的对话');
  assert.ok(a.toasts.join('').includes('属于另一个项目'));
});

test('当前项目里的对话直接打开，不切项目', async () => {
  const a = makeState({ conversations: [conversation('c1', '甲对话')] });
  await askOpenProjectConversation('p1', 'c1');
  assert.equal(a.switched, undefined);
  assert.equal(a.selected, 'c1');
});

test('对话已经不在当前项目里时给出提示，不乱打开', async () => {
  const a = makeState({ conversations: [] });
  await askOpenProjectConversation('p1', 'gone');
  assert.equal(a.selected, undefined);
  assert.ok(a.toasts.join('').includes('已不在当前项目'));
});

test('在别的项目行上点「＋」不许直接把项目切走', async () => {
  const a = makeState();
  await askNewChatInProject('p2');
  assert.equal(a.switched, undefined, '不能靠新建对话切项目');
  assert.equal(a.created, undefined);
  assert.ok(a.toasts.join('').includes('请先切换到该项目'));
});

test('当前项目里新建对话照常工作', async () => {
  const a = makeState();
  await askNewChatInProject('p1');
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

test('删掉对话后侧栏立刻刷新', () => {
  const conversations = [conversation('c1', '甲对话'), conversation('c2', '乙对话')];
  const a = makeState({ conversations, projectHistory: [{ id: 'p1', name: '当前项目', items: conversations }] });
  askForgetConversation('c1');
  assert.deepEqual(a.conversations.map((c) => c.id), ['c2']);
  assert.equal(a.projectHistory[0].items.some((c) => c.id === 'c1'), false);
  const html = askHistoryHtml();
  assert.equal(html.includes('甲对话'), false, '删掉的对话不能还渲染在侧栏');
  assert.match(html, /乙对话/);
});

test('点已删除的对话：顺手清掉陈旧条目，不只弹提示', async () => {
  const a = makeState({
    conversations: [],
    projectHistory: [{ id: 'p1', name: '当前项目', items: [conversation('gone', '已删除的')] }],
  });
  await askOpenProjectConversation('p1', 'gone');
  assert.equal(a.selected, undefined);
  assert.ok(a.toasts.join('').includes('已不在当前项目'));
  assert.equal(a.projectHistory[0].items.length, 0, '陈旧条目要当场摘掉');
});

test('新建对话会把当前项目行指向新的列表，不会留下旧引用', () => {
  const conversations = [conversation('c1', '甲对话')];
  const a = makeState({ conversations, projectHistory: [{ id: 'p1', name: '当前项目', items: conversations }] });
  a.conversations = [conversation('c-new', '新对话'), ...conversations];
  askSyncCurrentRowItems();
  assert.equal(a.projectHistory[0].items, a.conversations);
});

test('删除分支必须调用 askForgetConversation，并同步一次列表', () => {
  const branch = source.slice(source.indexOf("if (act === 'ask-delete')"), source.indexOf("if (act === 'ask-undo')"));
  assert.ok(branch.includes('askForgetConversation(id)'), '删除分支要同步摘掉条目');
  assert.ok(branch.includes('askLoadProjectHistory('), '删除后要跟服务端对齐一次');
  assert.equal(branch.includes('a.conversations = (a.conversations || []).filter((x) => x.id !== id)'), false);
});

test('askFindConversation 只在当前项目里找', () => {
  const a = makeState({ conversations: [], projectHistory: [{ id: 'p1', name: '当前项目', items: [conversation('c1', '甲')] }] });
  assert.equal(askFindConversation('c1').id, 'c1');
  assert.equal(askFindConversation('nope'), null);
});
