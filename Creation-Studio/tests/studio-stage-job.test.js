'use strict';
// 舞台显示哪一条任务：必须是「当前分镜最新的一条」，有在跑的就看正在跑的。
// 以前先是找 state.lastJobId（上次会话或上次点选留下的旧 id），于是明明还在生成，
// 舞台却挂着好几天前那条成片显示「完成 · 100%」。这里把这段选任务的逻辑钉住。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = require('./helpers/app-source')();
const wbSource = fs.readFileSync(path.join(root, 'web/workbench-manager.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start > 0 && end > start, `在 app.js 里找不到 ${startMarker}`);
  return source.slice(start, end);
}

const stageSource = slice('function studioOwnJobs() {', '// 结构签名');

function makeSandbox(jobs, itemId, picked) {
  const sandbox = {};
  new Function('module', 'exports', `
const state = { jobs: ${JSON.stringify(jobs)}, lastJobId: '${'job-old'}', stagePick: ${JSON.stringify(picked || {})} };
const WB = { context: () => ({ itemId: ${JSON.stringify(itemId)} }) };
${stageSource}
module.exports = { studioOwnJobs, studioStageJob, studioHistoryJobs, state };
`)(sandbox, sandbox.exports);
  return sandbox.exports;
}

const ITEM = 'item-a';
const OLD = 1792000000000;
const job = (id, status, extra = {}) => Object.assign({ id, itemId: ITEM, status, createdAt: OLD, progress: 0, outputs: [] }, extra);

test('分镜里有正在跑的任务：舞台看正在跑的，不看几天前那条完成的', () => {
  const api = makeSandbox([
    job('job-old', 'success', { createdAt: OLD, outputs: [{ type: 'video', path: 'D:/old.mp4' }] }),
    job('job-new', 'running', { createdAt: OLD + 5000, progress: 42 }),
  ], ITEM);
  assert.equal(api.studioStageJob().id, 'job-new', 'state.lastJobId 指着旧任务也不能盖过正在跑的');
  assert.equal(api.studioStageJob().progress, 42);
});

test('排队中的也算还没完成，优先看在跑的', () => {
  const api = makeSandbox([
    job('job-old', 'success'),
    job('job-queue', 'queued', { createdAt: OLD + 9000 }),
    job('job-run', 'running', { createdAt: OLD + 8000 }),
  ], ITEM);
  assert.equal(api.studioStageJob().id, 'job-run');
});

test('都跑完了：看最新那条，不看好几天前那条', () => {
  const api = makeSandbox([
    job('job-old', 'success', { createdAt: OLD }),
    job('job-mid', 'failed', { createdAt: OLD + 1000 }),
    job('job-new', 'success', { createdAt: OLD + 2000 }),
  ], ITEM);
  assert.equal(api.studioStageJob().id, 'job-new');
  assert.equal(api.studioStageJob().status, 'success');
});

test('最新那条失败了也要显示失败，不能退回更早的成片', () => {
  const api = makeSandbox([
    job('job-old', 'success', { createdAt: OLD, outputs: [{ type: 'video', path: 'D:/old.mp4' }] }),
    job('job-new', 'failed', { createdAt: OLD + 2000 }),
  ], ITEM);
  assert.equal(api.studioStageJob().id, 'job-new');
  assert.equal(api.studioStageJob().outputs.length, 0, '失败的任务没成片，舞台要显示错误而不是旧视频');
});

test('只看当前分镜的任务，别的分镜在跑不串台', () => {
  const api = makeSandbox([
    job('job-other', 'running', { itemId: 'item-b', createdAt: OLD + 9000 }),
    job('job-mine', 'success', { createdAt: OLD + 1000 }),
  ], ITEM);
  assert.equal(api.studioOwnJobs().length, 1);
  assert.equal(api.studioStageJob().id, 'job-mine');
});

test('这个分镜还没任务时舞台保持空态', () => {
  const api = makeSandbox([job('job-other', 'running', { itemId: 'item-b' })], ITEM);
  assert.equal(api.studioStageJob(), null);
});

test('最近任务列表按时间倒序，最新的在最上面', () => {
  assert.match(source, /const recent = ownJobs\.slice\(\)\.sort\(\(a, b\) => \(b\.createdAt \|\| 0\) - \(a\.createdAt \|\| 0\)\)\.slice\(0, 5\)/, '最近任务要取最新的五条');
});

test('切换分镜时 lastJobId 取该分镜最新的任务，而不是最老的那条', () => {
  assert.match(wbSource, /const own=\(state\.jobs\|\|\[\]\)\.filter\(j=>j\.itemId===item\.id\);/, '切换分镜要按当前分镜筛任务');
  assert.match(wbSource, /own\.slice\(\)\.sort\(\(a,b\)=>\(b\.createdAt\|\|0\)-\(a\.createdAt\|\|0\)\)\[0\]\.id/, 'lastJobId 取 createdAt 最大的那条');
});

test('别的分镜的任务跑完，目录里的「生成中」要自己变成「完成」，而且只重画目录这几行', () => {
  assert.match(wbSource, /function rowsHtml\(k\)/, '目录行要抽出来单独渲染');
  assert.match(wbSource, /function paintSidebar\(k\) \{\s*const host=document\.querySelector\('\.wb-directory \.wb-list'\)/, 'paintSidebar 只换目录列表，不动整个页面');
  assert.match(wbSource, /return \{reconcileImageTask,layout,paintSidebar,/, 'WB 要导出 paintSidebar');
  assert.match(source, /const statusChanged = previousStatus !== job\.status;/, '任务事件里要判断状态真的变了，进度事件不重画目录');
  assert.match(source, /if \(statusChanged\) \{ try \{ WB\.paintSidebar\('video'\); \} catch/, '状态变化时补画分镜目录');
});

const videoOut = (name) => ({ type: 'video', name, path: 'D:/out/' + name });

test('生成历史只列有片的任务，最新在前，最多四个', () => {
  const jobs = [];
  for (let i = 0; i < 6; i += 1) {
    jobs.push(job('job-' + i, 'success', { createdAt: OLD + i * 1000, outputs: [videoOut(i + '.mp4')] }));
  }
  jobs.push(job('job-failed', 'failed', { createdAt: OLD + 9000 }));
  const api = makeSandbox(jobs, ITEM);
  const history = api.studioHistoryJobs(4);
  assert.equal(history.length, 4, '一排放四个');
  assert.deepEqual(history.map((j) => j.id), ['job-5', 'job-4', 'job-3', 'job-2'], '最新的在前');
  assert.ok(history.every((j) => j.outputs.length), '没出片的失败任务不进历史');
});

test('点历史缩略图回看那一版：空闲时生效，一有新任务在跑就回到实时任务', () => {
  const done = [job('job-a', 'success', { createdAt: OLD, outputs: [videoOut('a.mp4')] }), job('job-b', 'success', { createdAt: OLD + 1000, outputs: [videoOut('b.mp4')] })];
  const picked = { [ITEM]: 'job-a' };
  const idle = makeSandbox(done, ITEM, picked);
  assert.equal(idle.studioStageJob().id, 'job-a', '点了旧版就回看旧版');
  const busy = makeSandbox(done.concat([job('job-c', 'running', { createdAt: OLD + 2000, progress: 20 })]), ITEM, picked);
  assert.equal(busy.studioStageJob().id, 'job-c', '有任务在跑时舞台回到实时任务，不能停在旧版上');
  const stale = makeSandbox(done, ITEM, { [ITEM]: 'job-gone' });
  assert.equal(stale.studioStageJob().id, 'job-b', '点的任务没了就回落到最新那条');
  // 没出片的任务不可能是回看目标（缩略图只列有片的任务），回落到默认规则＝最新那条
  const noVideo = makeSandbox([done[1], job('job-x', 'failed', { createdAt: OLD + 5000 })], ITEM, { [ITEM]: 'job-x' });
  assert.equal(noVideo.studioStageJob().id, 'job-x');
});

test('历史缩略图接上了点击：写进 stagePick 再重画舞台', () => {
  assert.match(source, /data-act="stage-pick"/, '历史卡片要带 stage-pick 动作');
  assert.match(source, /state\.stagePick\[WB\.context\('video'\)\.itemId\] = target\.dataset\.id;/, '点了要记住是哪一版');
  assert.match(source, /if \(studioOwnJobs\(\)\.some\(\(j\) => j\.status === 'running' \|\| j\.status === 'queued'\)\) \{[\s\S]{0,120}return toast\('这个分镜还在生成/, '正在生成时先别回看，免得又出现「没完成却显示完成」');
  assert.match(fs.readFileSync(path.join(root, 'web/styles.css'), 'utf8'), /\.stage-history-grid \{ display: grid; grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/, '一排四个缩略图');
});

test('新任务一进来就取消回看，免得新出的一版被旧版按住', () => {
  assert.match(source, /if \(index < 0 && job\.itemId && state\.stagePick\) delete state\.stagePick\[job\.itemId\];/, '任务事件里新任务要清掉回看');
  assert.match(source, /if \(state\.stagePick\) delete state\.stagePick\[workbenchContext\.itemId\];/, '从创作台生成时也要清掉回看');
});
