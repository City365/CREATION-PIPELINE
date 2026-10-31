'use strict';
// 贴图后：附件状态文案、预览走 raw 地址
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const start = source.indexOf('function askAttachStatusText(');
const end = source.indexOf('async function askUploadFile(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到 askAttachStatusText');

const box = {};
new Function('module', 'exports', `${source.slice(start, end)}\nmodule.exports = { askAttachStatusText };`)(box, box.exports);
const { askAttachStatusText } = box.exports;

test('图片状态用“识别”措辞，文档用“索引”', () => {
  assert.equal(askAttachStatusText({ name: 'a.png', status: 'indexed' }), '已识别');
  assert.equal(askAttachStatusText({ name: 'a.md', status: 'indexed' }), '已索引');
  assert.equal(askAttachStatusText({ name: 'a.png', status: 'pending_recognition' }), '识别中…');
  assert.equal(askAttachStatusText({ name: 'a.png', status: 'recognition_failed' }), '识别失败');
  assert.equal(askAttachStatusText({ name: 'a.wav', status: 'pending_transcription' }), '转写中…');
  assert.equal(askAttachStatusText({ name: 'a.bin', status: 'weird' }), '待处理');
});

test('图片/音视频预览改用 raw 地址（content 是给文本用的）', () => {
  assert.ok(source.includes("'/raw?project='"), 'raw 地址要带项目参数');
  const pane = source.slice(source.indexOf('function askFilePaneHtml('), source.indexOf('function askPreviewModalHtml('));
  assert.ok(/data\.kind === 'image'[\s\S]{0,120}rawUrl/.test(pane), '图片预览用 raw');
  assert.ok(/data\.kind === 'video'[\s\S]{0,120}rawUrl/.test(pane), '视频预览用 raw');
});

test('上传后轮询识别状态，成功会提示模型可见', () => {
  assert.ok(source.includes('askWatchAttachmentStatus'), '要有状态轮询');
  const watch = source.slice(source.indexOf('async function askWatchAttachmentStatus('), source.indexOf('async function askPreviewFile('));
  assert.ok(watch.includes('/workspace/files/'), '轮询单文件状态接口');
  assert.ok(watch.includes('图片已识别'), '识别完成要提示');
  assert.ok(watch.includes('识别失败'), '失败也要提示');
});
