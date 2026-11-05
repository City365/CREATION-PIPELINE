'use strict';
// 创作台底部参数栏：豆包（管理器）除了画幅、时长，还得能看见并选中「模型名称」。
// 这个值会随任务发给管理器，必须跟网页下拉文案一字不差（Seedance 2.0 Mini / Fast）。
// 守住：
// 1) 豆包工作流出现 #p-model-name，两个模型都在，默认「跟随页面当前模型」；
// 2) 选中的模型会回填到下拉的 selected；
// 3) Gemini / AutoDL 这类没有模型下拉的工作流不出现这一栏，也不会带模型；
// 4) 生成时把模型名称放进 /api/jobs 的请求体，提示行里也显示它。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'web/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'web/styles.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start > 0 && end > start, `在 app.js 里找不到 ${startMarker}`);
  return source.slice(start, end);
}

const helperSource = [
  slice('function studioModelName(wf, s) {', 'function studioModelFieldHtml(wf, s) {'),
  slice('function studioModelFieldHtml(wf, s) {', 'function refreshStudioHint() {'),
].join('\n');

function makeSandbox() {
  const sandbox = {};
  new Function('module', 'exports', `
const esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ICON = { caret: '<svg class="caret"></svg>' };
${helperSource}
module.exports = { studioModelName, studioModelFieldHtml, studioGenerateHint, studioGenerateHintHtml };
`)(sandbox, sandbox.exports);
  return sandbox.exports;
}

const doubao = { id: 'mgr:ch1:doubao', provider: 'manager', providerLabel: '管理器', durationKey: 'duration', platform: 'doubao', models: ['Seedance 2.0 Mini', 'Seedance 2.0 Fast'] };
const gemini = { id: 'mgr:ch1:gemini', provider: 'manager', providerLabel: '管理器', durationKey: 'duration', platform: 'gemini', models: [] };

test('豆包工作流有模型名称下拉：Mini / Fast 都能选', () => {
  const html = makeSandbox().studioModelFieldHtml(doubao, {});
  assert.match(html, /id="p-model-name"/);
  assert.match(html, />模型名称</);
  assert.match(html, /<option value=""\s*selected>跟随页面当前模型<\/option>/);
  assert.match(html, /Seedance 2\.0 Mini/);
  assert.match(html, /Seedance 2\.0 Fast/);
});

test('选中的模型会回填成 selected，并且真的带得出去', () => {
  const api = makeSandbox();
  const html = api.studioModelFieldHtml(doubao, { model: 'Seedance 2.0 Fast' });
  assert.match(html, /<option value="Seedance 2\.0 Fast"\s+selected>Seedance 2\.0 Fast<\/option>/);
  assert.match(html, /<option value="Seedance 2\.0 Mini"\s*>Seedance 2\.0 Mini<\/option>/);
  assert.equal(api.studioModelName(doubao, { model: 'Seedance 2.0 Fast' }), 'Seedance 2.0 Fast');
});

test('没选模型时留空，交给网页当前模型', () => {
  const api = makeSandbox();
  assert.equal(api.studioModelName(doubao, {}), '');
  assert.equal(api.studioModelName(doubao, { model: '' }), '');
});

test('Gemini / 没有模型下拉的工作流：不出现这一栏，也不带模型', () => {
  const api = makeSandbox();
  assert.equal(api.studioModelFieldHtml(gemini, { model: 'Seedance 2.0 Fast' }), '');
  assert.equal(api.studioModelName(gemini, { model: 'Seedance 2.0 Fast' }), '');
  assert.equal(api.studioModelName({ id: 'autodl:x' }, { model: 'Seedance 2.0 Fast' }), '');
});

test('残留的模型名不在当前下拉里时当作没选，不会发错模型', () => {
  const api = makeSandbox();
  assert.equal(api.studioModelName(doubao, { model: 'seedance-2.0-fast' }), '');
  assert.equal(api.studioModelName(doubao, { model: 'Seedance 2.5' }), '');
  const html = api.studioModelFieldHtml(doubao, { model: 'Seedance 2.5' });
  assert.equal(/selected>Seedance 2\.5/.test(html), false);
});

test('参数栏里真的插了这一栏，且生成时带 model', () => {
  assert.ok(source.includes('${studioModelFieldHtml(wf, s)}'), '创作台参数栏要插入模型名称下拉');
  assert.match(source, /model: studioModelName\(wf, s\),/, '/api/jobs 请求体里要有 model');
  assert.ok(source.includes('id="studio-generate-hint"'), '生成按钮下面的参数摘要要给模型名留位置');
  assert.match(source, /modelNameSel\.onchange = \(\) => \{ s\.model = modelNameSel\.value; refreshStudioHint\(\);/, '换模型后摘要要立刻跟着变');
  assert.match(styles, /\.wmd-compose-field\.is-name\s*\{[^}]*min-width/, '模型名称这一栏要有自己的宽度，别把画幅挤变形');
  assert.match(styles, /\.wmd-compose-params\.is-with-name \.wmd-compose-field\.is-model/, '多了模型名称后「视频模型」这一栏要收窄，四栏才排得进一行');
  assert.match(indexHtml, /styles\.css\?v=proj\d+/);
});

test('生成按钮下的参数摘要会显示选中的模型名称', () => {
  const api = makeSandbox();
  assert.equal(api.studioGenerateHint(doubao, { aspectRatio: '16:9 (Widescreen)', duration: 15, model: '' }), '管理器 · 16:9 · 15s');
  assert.equal(api.studioGenerateHint(doubao, { aspectRatio: '16:9 (Widescreen)', duration: 15, model: 'Seedance 2.0 Fast' }), '管理器 · 16:9 · 15s · Seedance 2.0 Fast');
  assert.equal(api.studioGenerateHint(gemini, { aspectRatio: '9:16 (Portrait Widescreen)', duration: 10, model: 'Seedance 2.0 Fast' }), '管理器 · 9:16 · 10s');
  // 折行只发生在两段之间（参数 / 模型名），别把 15s 单独甩到一行
  const html = api.studioGenerateHintHtml(doubao, { aspectRatio: '16:9 (Widescreen)', duration: 15, model: 'Seedance 2.0 Fast' });
  assert.match(html, /<span class="hint-seg">管理器 · 16:9 · 15s<\/span>/);
  assert.match(html, /<span class="hint-seg">Seedance 2\.0 Fast<\/span>/);
  assert.equal(api.studioGenerateHintHtml(doubao, { aspectRatio: '16:9 (Widescreen)', duration: 15, model: '' }), '<span class="hint-seg">管理器 · 16:9 · 15s</span>');
});

test('选中的模型跟着项目草稿存盘，刷新后还在', () => {
  const sandbox = {};
  const snapshotSource = slice('function studioSnapshot() {', 'function studioApply(saved) {');
  const applySource = slice('function studioApply(saved) {', 'function studioBeacon() {');
  new Function('module', 'exports', `
const state = { studio: { workflowId: 'mgr:ch1:doubao', images: [], audios: [], prompt: '', model: '' } };
const workflowById = (id) => (id === 'mgr:ch1:doubao' ? ${JSON.stringify(doubao)} : null);
${snapshotSource}
${applySource}
state.studio.model = '';
const blank = studioSnapshot();
studioApply({ model: 'Seedance 2.0 Mini', duration: 15 });
const saved = studioSnapshot();
studioApply({ model: '' });
const cleared = studioSnapshot();
module.exports = { blank, saved, cleared };
`)(sandbox, sandbox.exports);
  assert.equal(sandbox.exports.blank.model, '', '没选过就是空，跟随页面当前模型');
  assert.equal(sandbox.exports.saved.model, 'Seedance 2.0 Mini', '模型名称要跟画幅、时长一起存进创作台草稿');
  assert.equal(sandbox.exports.saved.duration, 15);
  assert.equal(sandbox.exports.cleared.model, '', '选回「跟随页面当前模型」能清掉');
});

test('管理器豆包工作流把模型清单交给前端，Gemini 不带', () => {
  const plugin = require(path.join(root, 'plugins/video/browser-manager/index.js'));
  const list = plugin.workflows({ id: 'ch1', name: '本机管理器 · 豆包/Gemini', enabled: true, type: 'manager-video', options: {} });
  const doubaoWf = list.find((wf) => wf.platform === 'doubao');
  const geminiWf = list.find((wf) => wf.platform === 'gemini');
  assert.deepEqual(doubaoWf.models, ['Seedance 2.0 Mini', 'Seedance 2.0 Fast']);
  assert.equal(geminiWf.models, undefined, 'Gemini 页面上没有模型选项');
  const publicListSource = fs.readFileSync(path.join(root, 'src/workflows.js'), 'utf8');
  assert.match(publicListSource, /models: wf\.models \|\| \[\]/, 'publicList 要把 models 转给前端');
});
