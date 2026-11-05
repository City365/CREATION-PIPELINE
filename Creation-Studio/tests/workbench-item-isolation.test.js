'use strict';
// 画面目录里每个条目都必须是独立的：新建/切换不能继承上一个条目的场景建模数据。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const creative = fs.readFileSync(path.join(__dirname, '../web/creative.js'), 'utf8');
const wb = fs.readFileSync(path.join(__dirname, '../web/workbench-manager.js'), 'utf8');

function slice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start > 0 && end > start, `找不到 ${startMarker}`);
  return source.slice(start, end);
}

test('场景数据按「画面条目」分仓：不同条目不同 key，不会共用', () => {
  const source = slice(creative, 'function ceSceneItemId() {', 'function sceneFlow() {');
  const sandbox = {};
  new Function('module', 'exports', `
let ITEM = 'item-a';
const localStorage = { data: {}, getItem(k) { return this.data[k] || null; }, setItem(k, v) { this.data[k] = v; } };
const WB = { context: () => ({ itemId: ITEM }) };
const ceProject = () => 'proj-1';
${source}
module.exports = { sceneFlowKey, setItem: (id) => { ITEM = id; }, localStorage };
`)(sandbox, sandbox.exports);
  const a = sandbox.exports.sceneFlowKey();
  sandbox.exports.setItem('item-b');
  const b = sandbox.exports.sceneFlowKey();
  assert.notEqual(a, b, '两条画面的存档 key 必须不同');
  assert.match(a, /proj-1\.item-a$/);
  assert.match(b, /proj-1\.item-b$/);
  // 写 A 的存档不污染 B
  sandbox.exports.localStorage.setItem(a, '{"name":"书房"}');
  assert.equal(sandbox.exports.localStorage.getItem(b), null);
});

test('没有条目时退回项目级 key，旧数据仍能读到', () => {
  const source = slice(creative, 'function ceSceneItemId() {', 'function sceneFlow() {');
  const sandbox = {};
  new Function('module', 'exports', `
const WB = { context: () => ({ itemId: null }) };
const ceProject = () => 'proj-1';
${source}
module.exports = { sceneFlowKey };
`)(sandbox, sandbox.exports);
  assert.equal(sandbox.exports.sceneFlowKey(), 'wmd.sceneFlow.proj-1');
});

test('场景数据跟着条目草稿走：写进 draft，切换后从自己的草稿恢复', () => {
  assert.match(wb, /'layoutPrompt','sceneFlow'\]/, '草稿快照要包含 sceneFlow');
  assert.ok(creative.includes('state.image.sceneFlow = payload'), '保存时写进当前条目');
  assert.ok(creative.includes('WB.schedule(\'image\')'), '写进条目后要触发自动保存');
  const saved = slice(creative, 'function sceneFlowSavedFor(key) {', 'function sceneProjectStylePrefix()');
  assert.ok(saved.indexOf('localStorage.getItem(key)') < saved.indexOf('state.image.sceneFlow'), '先读本条目本地存档，再读本条目草稿');
  assert.ok(saved.includes('return null'), '都没有时返回空，不能回退到别的画面');
});

test('新建条目会把场景数据清空', () => {
  assert.match(wb, /sceneFlow:null/, '新建的草稿要显式清空场景数据');
});

test('切换条目会重新加载场景数据，不复用缓存', () => {
  const flow = slice(creative, 'function sceneFlow() {', 'function sceneFlowSave() {');
  assert.ok(flow.includes('if (creativeState.flowKey !== key)'), 'key 变了必须重建 flow');
  assert.ok(flow.includes('sceneFlowSavedFor(key)'), '恢复要按当前条目的 key 取');
});
