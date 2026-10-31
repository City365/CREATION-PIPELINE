'use strict';
// 视频创作台提交后屏幕一直闪：SSE 每来一条进度事件就整页重画。
// 这里守住“进度只打补丁、结构变化才重画”的约定。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const start = source.indexOf('function studioOwnJobs(');
const end = source.indexOf('function renderStudio(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到 studioOwnJobs');

const sandbox = {};
new Function('module', 'exports', `
let STATE = { jobs: [], lastJobId: '', route: 'studio' };
const state = { get jobs() { return STATE.jobs; }, get lastJobId() { return STATE.lastJobId; }, set lastJobId(v) { STATE.lastJobId = v; }, get route() { return STATE.route; } };
let ITEM = 'item-1';
const WB = { context: () => ({ itemId: ITEM }) };
const STATUS_LABEL = { queued: '排队中', running: '生成中', success: '完成', failed: '失败', canceled: '已取消' };
function makeNode(props) {
  const node = Object.assign({ style: {}, textContent: '', className: '' }, props);
  node.querySelectorAll = node.querySelectorAll || (() => []);
  node.querySelector = node.querySelector || (() => null);
  return node;
}
let DOM = {};
const document = { getElementById: (id) => DOM[id] || null };
${source.slice(start, end)}
module.exports = {
  studioOwnJobs, studioStageJob, studioStageSignature, studioLivePatch,
  setState: (patch) => {
    STATE = Object.assign({}, STATE, patch);
    ITEM = patch.itemId || ITEM;
  },
  setDom: (dom) => { DOM = dom; },
  makeNode,
};
`)(sandbox, sandbox.exports);

const { studioStageJob, studioStageSignature, studioLivePatch, setState, setDom, makeNode } = sandbox.exports;

const job = (id, status, progress, extra = {}) => ({ id, status, progress, itemId: 'item-1', createdAt: progress, outputs: [], ...extra });

test('进度变化不改结构签名，状态变化才改', () => {
  setState({ jobs: [job('j1', 'running', 10)], lastJobId: '', itemId: 'item-1' });
  const base = studioStageSignature();
  setState({ jobs: [job('j1', 'running', 88)] });
  assert.equal(studioStageSignature(), base, '进度 10%→88% 不该触发整页重画');
  setState({ jobs: [job('j1', 'success', 100)] });
  assert.notEqual(studioStageSignature(), base, '状态变了才需要重画');
});

test('舞台优先跟随 lastJobId，其次 running，最后取有产出的', () => {
  setState({ jobs: [job('a', 'success', 100, { outputs: [{ type: 'video' }] }), job('b', 'running', 30)], lastJobId: 'a' });
  assert.equal(studioStageJob().id, 'a');
  setState({ lastJobId: '' });
  assert.equal(studioStageJob().id, 'b');
  setState({ jobs: [job('c', 'success', 100, { outputs: [{ type: 'video' }] })] });
  assert.equal(studioStageJob().id, 'c');
});

test('进度补丁只改数字，不重建舞台 DOM', () => {
  const bar = makeNode({ style: {} });
  const waitText = makeNode({ textContent: '生成中 · 10%' });
  const hint = makeNode({ textContent: 'RunningHub 生成中… · 10%' });
  const badge = makeNode({ textContent: '生成中' });
  const stage = makeNode({});
  stage.querySelector = (selector) => {
    if (selector === '.stage-bar > i') return bar;
    if (selector === '.stage-wait span:last-child') return waitText;
    if (selector === '.stage-meta .stage-line.hint span') return hint;
    if (selector === '.stage-meta .stage-line .wmd-badge, .stage-meta .stage-line .badge') return badge;
    return null;
  };
  const rowState = makeNode({ textContent: '生成中' });
  const dot = makeNode({ className: 'dot warn' });
  const row = makeNode({ dataset: { id: 'j1' } });
  row.querySelector = (selector) => (selector === '.stage-queue-state' ? rowState : selector === '.dot' ? dot : null);
  const head = makeNode({ textContent: '0 排队 · 1 生成中' });
  const queue = makeNode({});
  queue.querySelectorAll = () => [row];
  queue.querySelector = (selector) => (selector === '.stage-queue-head .tnum' ? head : null);

  setState({ route: 'studio', jobs: [job('j1', 'running', 63, { stage: 'RunningHub 生成中…（363（1/4））' })], lastJobId: 'j1' });
  setDom({ 'studio-stage': stage, 'studio-queue': queue });

  const ok = studioLivePatch();
  assert.equal(ok, true);
  assert.equal(bar.style.width, '63%');
  assert.match(hint.textContent, /63%/);
  assert.equal(typeof stage.innerHTML, 'undefined', '补丁不能替换舞台 innerHTML（那会闪）');
  assert.equal(rowState.textContent, '生成中');
  assert.match(head.textContent, /1 生成中/);
});

test('connectEvents 在 studio 页只打补丁，不再无条件整页重画', () => {
  const branch = source.slice(source.indexOf("if (state.route === 'studio') {"), source.indexOf("if (state.route === 'jobs' || state.route === 'logs') render();"));
  assert.ok(branch.includes('studioLivePatch()'), 'studio 分支要调用 studioLivePatch');
  assert.ok(branch.includes('studioStageSignature()'), 'studio 分支要比较结构签名');
  assert.ok(branch.includes('studioSignatureCache'), '整页重画后要对齐签名缓存');
});

test('舞台容器用 display:contents 包住，布局不变', () => {
  const css = fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8');
  assert.match(css, /#studio-stage, #studio-queue \{ display: contents; \}/);
});
