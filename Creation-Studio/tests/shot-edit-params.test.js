'use strict';
// 「编辑分镜」里必须能改比例和视频模型：这两项是真正发给管理器（豆包 / Gemini）的参数。
// 这里把 openReviseModal 从 web/events.js 里取出来，在最小 DOM 桩上跑一遍，守住：
// 1) 弹窗里有 16:9 横屏 / 9:16 竖屏 的比例选择，且默认选中当前分镜的值；
// 2) 豆包有 Seedance 2.0 Mini / Fast 两个模型选项，Gemini 不出现模型下拉；
// 3) 保存时把 ratio / model 一起发给 /revise 接口。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/events.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert.ok(start > 0 && end > start, `在 events.js 里找不到 ${startMarker}`);
  return source.slice(start, end);
}

const ratioSource = slice('function itemRatio(item, job) {', 'function itemDuration(item, job) {');
const pickerSource = slice('function pickLocalImage(onPick) {', 'async function uploadOutput(');
const lightboxSource = slice('function openImageLightbox(src, caption) {', 'function openOutputRename(');
const modalStart = source.indexOf('function openReviseModal(');
const modalEnd = source.indexOf('  /**', modalStart);
assert.ok(modalStart > 0 && modalEnd > modalStart, '在 events.js 里找不到 openReviseModal');
const modalSource = source.slice(modalStart, modalEnd);

function makeSandbox() {
  const sandbox = {};
  new Function('module', 'exports', `
const WORKFLOWS = [{ id: 'mgr:ch1:doubao', provider: 'manager', platform: 'doubao', ratios: ['16:9', '9:16'] },
  { id: 'mgr:ch1:gemini', provider: 'manager', platform: 'gemini', ratios: ['16:9', '9:16'] },
  { id: 'autodl:x', provider: 'autodl', platform: '', ratios: [] }];
const state = { workflows: WORKFLOWS };
const esc = (value) => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtSize = (bytes) => bytes + ' B';
const shortText = (value, limit) => { const text = String(value == null ? '' : value); return text.length > limit ? text.slice(0, limit) : text; };
const toast = (message) => { API.toasts.push(String(message)); };
const closeModal = () => { API.closed = true; };
const load = async () => {};
const openDetail = async () => {};
const shotJobInfo = () => ({ out: null, job: null });
const workflowFor = (id) => state.workflows.find((w) => w.id === id) || null;
const API = { calls: [], toasts: [], closed: false, html: '', nodes: {}, failWith: null, uploads: [], appended: [] };
const api = async (url, options) => {
  API.calls.push({ url, body: options && options.body });
  if (API.failWith) throw new Error(API.failWith);
  return { ok: true };
};
const fetch = async (url) => {
  API.uploads.push(String(url));
  return { ok: true, status: 200, json: async () => ({ ok: true, data: { path: 'D:/uploads/new-ref.png', name: 'new-ref.png' } }) };
};
function node(extra) {
  const base = {
    value: '', onclick: null, disabled: false, innerHTML: '', textContent: '', className: '',
    listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    removeEventListener() {},
    remove() {},
  };
  return Object.assign(base, extra || {});
}
// 选图：createElement('input') 立即“选中”一张假图片，走真实的上传代码路径
const document = {
  body: { append(el) { API.appended.push(el); }, removeChild() {} },
  createElement(tag) {
    const el = node({ tagName: String(tag).toUpperCase(), files: null, type: '', accept: '', style: {} });
    el.click = () => {
      el.files = [{ name: 'new-ref.png', type: 'image/png' }];
      if (el.onchange) el.onchange();
    };
    return el;
  },
  addEventListener() {},
  removeEventListener() {},
};
// 预先建好弹窗里会被读写的控件，免得测试里再判空
function seedNodes() {
  for (const id of ['#revise-prompt', '#revise-prefix', '#revise-ratio', '#revise-model', '#revise-save', '#revise-retry', '#revise-back', '#revise-cancel', '#revise-add', '#revise-refs-grid', '#revise-ref-add']) {
    API.nodes[id] = node();
  }
}
const openModal = (html) => {
  API.html = String(html);
  const pick = (selector) => {
    const key = String(selector).trim();
    const ids = key.split(',');
    if (ids.length > 1) return ids[0];
    return key;
  };
  const panel = {
    classList: { add() {} },
    querySelector: (selector) => {
      const key = pick(selector);
      if (!API.nodes[key]) API.nodes[key] = node();
      return API.nodes[key];
    },
    querySelectorAll: () => [],
  };
  return panel;
};
${ratioSource}
${pickerSource}
${lightboxSource}
${modalSource}
seedNodes();
module.exports = { openReviseModal, itemRatio, itemModel, API, state };
`)(sandbox, sandbox.exports);
  return sandbox.exports;
}

const failedItem = (extra = {}) => ({
  id: 'item-1',
  refId: 'job-1',
  status: 'failed',
  title: '镜头 01',
  input: Object.assign({ prompt: '旧提示词', userPrompt: '旧提示词', prefixPrompt: '旧前置', images: [], workflowId: 'mgr:ch1:doubao', aspectRatio: '16:9' }, extra),
});

test('豆包分镜：比例给 16:9 横屏 / 9:16 竖屏，模型给 Seedance 2.0 Mini / Fast', () => {
  const api = makeSandbox();
  api.openReviseModal('evt-1', failedItem(), null);
  const html = api.API.html;
  assert.match(html, /16:9 横屏/);
  assert.match(html, /9:16 竖屏/);
  assert.match(html, /Seedance 2\.0 Mini/);
  assert.match(html, /Seedance 2\.0 Fast/);
  assert.match(html, /id="revise-ratio"/);
  assert.match(html, /id="revise-model"/);
});

test('当前分镜的比例和模型会作为默认选中项', () => {
  const api = makeSandbox();
  api.openReviseModal('evt-1', failedItem({ aspectRatio: '9:16', model: 'Seedance 2.0 Fast' }), null);
  const html = api.API.html;
  assert.match(html, /<option value="9:16" selected>9:16 竖屏<\/option>/);
  assert.match(html, /<option value="Seedance 2\.0 Fast" selected>Seedance 2\.0 Fast<\/option>/);
  assert.match(html, /<option value="16:9">16:9 横屏<\/option>/);
});

test('Gemini 分镜不出现模型下拉，只提示留空', () => {
  const api = makeSandbox();
  api.openReviseModal('evt-1', failedItem({ workflowId: 'mgr:ch1:gemini' }), null);
  const html = api.API.html;
  assert.equal(html.includes('id="revise-model"'), false);
  assert.match(html, /Gemini 页面上没有模型选项/);
  assert.match(html, /id="revise-ratio"/);
});

test('保存时把比例和模型一起发给 revise 接口', async () => {
  const api = makeSandbox();
  api.openReviseModal('evt-1', failedItem(), null);
  api.API.nodes['#revise-prompt'].value = '新提示词';
  api.API.nodes['#revise-prefix'].value = '新前置';
  api.API.nodes['#revise-ratio'].value = '9:16';
  api.API.nodes['#revise-model'].value = 'Seedance 2.0 Mini';
  await api.API.nodes['#revise-save'].onclick();
  const call = api.API.calls.at(-1);
  assert.match(call.url, /\/items\/item-1\/revise$/);
  assert.deepEqual(call.body, { prompt: '新提示词', prefixPrompt: '新前置', ratio: '9:16', model: 'Seedance 2.0 Mini', images: [] });
});

test('参考图能看见并带序号的缩略图，点图可以放大预览', () => {
  const api = makeSandbox();
  api.openReviseModal('evt-1', failedItem({
    images: [
      { path: 'D:/refs/a.png', name: '女主正面' },
      { path: 'D:/refs/b.png', name: '场景远景' },
    ],
  }), null);
  const html = api.API.html;
  assert.match(html, /id="revise-refs-grid"/);
  const grid = api.API.nodes['#revise-refs-grid'];
  assert.match(grid.innerHTML, /图1/);
  assert.match(grid.innerHTML, /图2/);
  assert.match(grid.innerHTML, /女主正面/);
  assert.match(grid.innerHTML, /data-ref-zoom="0"/);
  assert.match(grid.innerHTML, /data-ref-replace="1"/);
  assert.match(grid.innerHTML, /data-ref-remove="1"/);
  assert.ok(grid.innerHTML.includes(encodeURIComponent('D:/refs/a.png')), '缩略图要走 /api/file 读本地图');
  // 点击缩略图：叠一层原图预览，图源就是同一张本地图片
  api.API.nodes['#revise-refs-grid'].listeners.click({ target: { closest: (sel) => (sel === '[data-ref-zoom]' ? { dataset: { refZoom: '1' } } : null) } });
  const overlay = api.API.appended.at(-1);
  assert.equal(overlay.className, 'evt-image-backdrop');
  assert.ok(overlay.innerHTML.includes(encodeURIComponent('D:/refs/b.png')), '放大后看的是图2');
  assert.match(overlay.innerHTML, /图2/);
});

test('删除参考图后保存时带的是删完的列表', async () => {
  const api = makeSandbox();
  api.openReviseModal('evt-1', failedItem({
    images: [{ path: 'D:/refs/a.png', name: 'A' }, { path: 'D:/refs/b.png', name: 'B' }],
  }), null);
  const grid = api.API.nodes['#revise-refs-grid'];
  grid.listeners.click({ target: { closest: (sel) => (sel === '[data-ref-remove]' ? { dataset: { refRemove: '0' } } : null) } });
  assert.ok(!grid.innerHTML.includes('>A<'), '被删掉的那张不再出现');
  assert.match(grid.innerHTML, /图1/);
  assert.match(grid.innerHTML, />B</);
  api.API.nodes['#revise-prompt'].value = '新提示词';
  await api.API.nodes['#revise-save'].onclick();
  const call = api.API.calls.at(-1);
  assert.equal(call.body.images.length, 1);
  assert.equal(call.body.images[0].path, 'D:/refs/b.png');
});

test('添加参考图走上传接口，新图插到列表末尾', async () => {
  const api = makeSandbox();
  api.openReviseModal('evt-1', failedItem({ images: [{ path: 'D:/refs/a.png', name: 'A' }] }), null);
  await api.API.nodes['#revise-ref-add'].onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(api.API.uploads.some((url) => url.startsWith('/api/upload/raw')), '应该调用原始上传接口');
  const grid = api.API.nodes['#revise-refs-grid'];
  assert.match(grid.innerHTML, /图2/);
  api.API.nodes['#revise-prompt'].value = '新提示词';
  await api.API.nodes['#revise-save'].onclick();
  const call = api.API.calls.at(-1);
  assert.equal(call.body.images.length, 2);
  assert.equal(call.body.images[1].path, 'D:/uploads/new-ref.png');
});
