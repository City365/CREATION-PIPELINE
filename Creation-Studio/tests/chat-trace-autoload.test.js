'use strict';
// 执行过程：展开即加载（不用再点一次），并且只留一条分隔线
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'web/styles.css'), 'utf8');

const start = source.indexOf('function askTraceRows(');
const end = source.indexOf('function askFilesHtml(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到执行过程渲染函数');

const box = {};
new Function('module', 'exports', `
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const askMarkdown = (v) => String(v || '');
const fetched = [];
const askApi = (url) => { fetched.push(url); return Promise.resolve({ json: async () => ({ items: [{ role: 'user', kind: 'instruction', content: 'x' }] }) }); };
const state = { route: 'script' };
const askState = () => ({ activeId: 'c1' });
const askActive = () => ({ id: 'c1' });
const askRenderMessages = () => {};
let LOADING_GUARD = null;
${source.slice(start, end)}
module.exports = { askTraceHtml, askTraceAutoLoad, askLoadMessageTrace, askLiveStatus, askDurationText, askHeading, fetched, setLoadingGuard: (v) => { LOADING_GUARD = v; } };
`)(box, box.exports);

const { askTraceHtml, askTraceAutoLoad, askLiveStatus, askDurationText, askHeading, fetched } = box.exports;

const exec = (patch = {}) => ({ id: 'run-1', status: 'completed', steps: [], tools: [], ...patch });

test('展开时不再要求点「加载执行过程」，直接进入加载状态', () => {
  const html = askTraceHtml({ execution: exec(), traceOpen: true }, false);
  assert.match(html, /class="ask-trace-body"/);
  assert.match(html, /正在加载执行过程…/);
  assert.equal(html.includes('>加载执行过程<'), false, '不该再有需要额外点击的按钮');
});

test('加载失败才给重试按钮，并把失败原因挂在 title 上', () => {
  const html = askTraceHtml({ execution: exec(), traceOpen: true, _traceError: '网络异常' }, false);
  assert.match(html, /重新加载执行过程/);
  assert.match(html, /title="网络异常"/);
});

test('正在加载时只显示提示，不闪出重试按钮', () => {
  const html = askTraceHtml({ execution: exec(), traceOpen: true, _traceLoading: true }, false);
  assert.match(html, /正在加载执行过程…/);
  assert.equal(html.includes('重新加载执行过程'), false);
});

test('流式中只留一行实时状态，不摆加载按钮也不渲染空壳', () => {
  const html = askTraceHtml({ execution: exec({ status: 'running' }), _streaming: true }, true);
  assert.match(html, /ask-trace-live/);
  assert.match(html, /正在分析请求/);
  assert.equal(html.includes('class=\"ask-trace-body\"'), false);
  assert.equal(html.includes('加载执行过程'), false);
});

test('渲染完自动给展开过的消息拉轨迹：已加载 / 未展开 / 流式中都跳过', async () => {
  fetched.length = 0;
  const chat = {
    messages: [
      { role: 'assistant', execution: exec({ id: 'r-open' }), traceOpen: true },
      { role: 'assistant', execution: exec({ id: 'r-loaded' }), traceOpen: true, trajectory: [] },
      { role: 'assistant', execution: exec({ id: 'r-closed' }), traceOpen: false },
      { role: 'assistant', execution: exec({ id: 'r-live' }), traceOpen: true, _streaming: true },
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: '无执行的旧消息' },
    ],
  };
  askTraceAutoLoad(chat);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fetched.length, 1);
  assert.match(fetched[0], /r-open/);
  assert.equal(Array.isArray(chat.messages[0].trajectory), true, '加载后写入轨迹');
});

test('执行过程只有一条分隔线：body 不再叠一层 border-top', () => {
  const bodyRule = css.slice(css.indexOf('.ask-trace-body {'), css.indexOf('.ask-trace-body {') + 120);
  assert.equal(/border-top/.test(bodyRule), false, '.ask-trace-body 不该再有 border-top');
  const headRule = css.slice(css.indexOf('.ask-trace-head {'), css.indexOf('.ask-trace-head {') + 260);
  assert.match(headRule, /border-bottom:1px solid|border-bottom: 1px solid/, '分隔线只留头部那一条');
});

// ---- 执行中的实时状态：文案随工具变、时间自己走 ----

test('状态文案跟着工具走：准备 / 完成 / 失败', () => {
  const cases = [
    [{ tool: 'run_command', detail: 'npm test', phase: 'running' }, '正在...', '准备运行命令', 'npm test'],
  ];
  assert.deepEqual(askLiveStatus({ live: { tool: 'run_command', detail: 'npm test', phase: 'running' } }), { text: '准备运行命令', detail: 'npm test' });
  assert.deepEqual(askLiveStatus({ live: { tool: 'run_command', detail: '全部通过', phase: 'done' } }), { text: '执行了命令', detail: '全部通过' });
  assert.deepEqual(askLiveStatus({ live: { tool: 'run_command', detail: 'exit 1', phase: 'failed' } }), { text: '命令执行失败', detail: 'exit 1' });
  assert.deepEqual(askLiveStatus({ live: { tool: 'write_file', detail: '分集.md', phase: 'running' } }), { text: '准备写入文件', detail: '分集.md' });
  assert.deepEqual(askLiveStatus({ live: { tool: 'write_file', detail: '分集.md', phase: 'done' } }), { text: '已写入文件', detail: '分集.md' });
  assert.deepEqual(askLiveStatus({ live: { tool: 'generate_image', detail: '深秋山道', phase: 'done' } }), { text: '已生成图片', detail: '深秋山道' });
});

test('没有工具、或模型正在写回复时显示「正在分析请求」并带上正在写的那句', () => {
  assert.deepEqual(askLiveStatus({}), { text: '正在分析请求', detail: '' });
  assert.deepEqual(askLiveStatus({ live: { phase: 'thinking', detail: '我先看项目里有哪些文件' } }), { text: '正在分析请求', detail: '我先看项目里有哪些文件' });
  assert.deepEqual(askLiveStatus({ live: { tool: 'custom_tool', detail: 'x', phase: 'running' } }), { text: '准备执行 custom_tool', detail: 'x' });
});

test('运行中的标题带秒数，并且每秒自己走', () => {
  const html = askTraceHtml({ execution: exec({ status: 'running' }), _t0: Date.now() - 5000, live: { tool: 'list_dir', detail: 'D:/x', phase: 'running' } }, true);
  assert.match(html, /data-trace-live data-since="\d+"/);
  assert.match(html, /准备查看目录 · D:\/x/);
  assert.match(html, /· \d+秒/);
  assert.doesNotMatch(html, />执行中…</);
});

test('跑完还是「已完成，用时…」，不再显示实时状态', () => {
  assert.equal(askHeading({ id: 'r', status: 'completed', duration_ms: 724000 }, false, {}), '已完成，用时12分4秒');
  assert.equal(askDurationText(9000), '9秒');
  assert.equal(askDurationText(65000), '1分5秒');
  assert.equal(askDurationText(120000), '2分');
});
