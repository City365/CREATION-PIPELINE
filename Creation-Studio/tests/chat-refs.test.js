'use strict';
// 智能体回复里的「画面参考」：直接出图，展示成图片而不是一个框。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();
const start = source.indexOf('/* 画面参考：直接按英文描述出图');
const end = source.indexOf('function askMessagesHtml(chat) {');
assert.ok(start > 0 && end > start, '在 app.js 里找不到画面参考段落');

const calls = [];
const prelude = `
const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toast = () => {};
const api = (path, opts) => { globalThis.__calls.push({ path, opts }); return globalThis.__apiResult(); };
const document = { querySelectorAll: () => [] };
const state = { ask: { refImages: true } };
`;
globalThis.__calls = calls;
globalThis.__apiResult = async () => ({ url: '/api/file?path=ref.png', path: 'ref.png' });
const box = {};
new Function('module', 'exports', prelude + source.slice(start, end) + `
module.exports = { guRefCardHtml, guRefKey, guRefMediaHtml, guHydrateRefs, guRetryRef, guGenerateRef, guRefsEnabled, guRefStop, guRefRatio, guRefBox, guRefSnapRatio, state, ASK_REF_CACHE, ASK_REF_INFLIGHT, ASK_REF_MANUAL, ASK_REF_QUEUE, GU_REF_RATIOS };
`)(box, box.exports);
const refs = box.exports;

function fakeRoot(keys) {
  const nodes = keys.map((key) => ({
    dataset: { guKey: key, guPrompt: `prompt ${key}` },
    isConnected: true,
    state: 'pending',
    classList: { toggle() {}, remove() {} },
    querySelector: () => null,
  }));
  return { nodes, querySelectorAll: (sel) => (String(sel).includes('data-gu-ref') ? nodes : []) };
}

test('图位按 9:16 / 16:9 / 1:1 / 3:4 / 4:3 的比例摆，不硬塞同一个框', () => {
  const size = (ratio) => {
    const box = refs.guRefBox(refs.guRefRatio(ratio));
    return `${box.width}x${box.height}`;
  };
  assert.equal(size('9:16'), '124x220', '竖屏要窄而高');
  assert.equal(size('16:9'), '236x133', '横屏要宽而扁');
  assert.equal(size('1:1'), '220x220', '方形');
  assert.equal(size('3:4'), '165x220');
  assert.equal(size('4:3'), '236x177');
  const html = refs.guRefCardHtml('palace at sunrise', '9:16');
  assert.match(html, /data-gu-ratio="9:16"/);
  assert.match(html, /width:124px/, '卡片宽度随比例');
  assert.match(html, /height:220px/, '图位高度随比例');
});

test('图片实际比例接近标准画幅时按标准画幅摆', () => {
  assert.equal(refs.guRefSnapRatio(1672, 941).label, '16:9', '1672×941 当 16:9');
  assert.equal(refs.guRefSnapRatio(1024, 1024).label, '1:1');
  assert.equal(refs.guRefSnapRatio(720, 1280).label, '9:16');
  assert.equal(refs.guRefSnapRatio(1024, 1365).label, '3:4');
  assert.equal(refs.guRefSnapRatio(1200, 500).label, '12:5', '差太多就按真实比例');
});

test('没给比例时用 4:3，比例写法也宽松', () => {
  assert.match(refs.guRefCardHtml('x prompt here'), /data-gu-ratio="4:3"/);
  assert.equal(refs.guRefRatio('9：16').label, '9:16', '全角冒号也认');
  assert.equal(refs.guRefRatio('16x9').label, '16:9');
  assert.equal(refs.guRefRatio('bogus').label, '4:3');
});

test('出图请求带上比例，服务端按比例挑尺寸', () => {
  assert.match(source, /body: \{ prompt, ratio: GU_REF_RATIOS\.get\(key\) \|\| '' \}/);
});

test('图位里没图就显示提示词，右上角三个按钮一直在', () => {
  const html = refs.guRefCardHtml('vast Chinese celestial palace, golden sunrise, mist');
  assert.match(html, /data-gu-ref/, '需要可被出图流程认领的卡片');
  assert.match(html, /data-gu-state="pending"/);
  assert.match(html, /vast Chinese celestial palace/, '没图时图位里就是提示词');
  assert.doesNotMatch(html, /gu-ref-foot|画面参考<\/span>/, '不要再把卡片拆成图位 + 说明两段');
  assert.match(html, /data-act="ask-ref-now"[^>]*title="生成这张图"/, '生成按钮');
  assert.match(html, /data-act="gu-ref-download"/, '下载按钮');
  assert.match(html, /data-act="gu-copy-text"/, '复制提示词按钮');
  const buttons = html.match(/class="gu-ref-btn/g) || [];
  assert.equal(buttons.length, 3, '三个按钮都在');
});

test('出图成功后只显示图片，按钮仍然在', () => {
  const key = refs.guRefKey('palace at sunrise');
  refs.ASK_REF_CACHE.set(key, { url: '/api/file?path=%2Ftmp%2Fref.png' });
  const html = refs.guRefCardHtml('palace at sunrise');
  assert.match(html, /data-gu-state="ready"/);
  assert.match(html, /<img src="\/api\/file\?path=%2Ftmp%2Fref.png"/);
  assert.match(html, /data-act="ask-open-inline"/);
  assert.match(html, /data-url="\/api\/file\?path=%2Ftmp%2Fref.png"/, '点开要能放大');
  assert.match(html, /自动生成/);
  assert.doesNotMatch(html, /gu-ref-prompt/, '有图就不显示提示词');
  assert.equal((html.match(/class="gu-ref-btn/g) || []).length, 3);
  assert.match(html, /data-act="gu-ref-download" data-url="\/api\/file\?path=%2Ftmp%2Fref.png"/, '下载带上图片地址');
});

test('出图失败仍显示提示词，生成按钮变成重试入口', () => {
  const key = refs.guRefKey('bad prompt here');
  refs.ASK_REF_CACHE.set(key, { error: '没有启用的图像渠道' });
  const html = refs.guRefCardHtml('bad prompt here');
  assert.match(html, /data-gu-state="error"/);
  assert.match(html, /bad prompt here/, '提示词仍然显示');
  assert.match(html, /gu-ref-btn is-bad/, '生成按钮标成失败态');
  assert.match(html, /出图失败：没有启用的图像渠道（点一下重试）/);
  assert.match(html, /data-act="ask-ref-now"/);
});

test('渲染后自动排队出图，命中缓存就立刻贴图', async () => {
  calls.length = 0;
  const root = fakeRoot(['fresh']);
  refs.guHydrateRefs(root);
  assert.equal(calls.length, 1, '应该发起一次出图请求');
  assert.equal(calls[0].path, '/api/chat/ref-image');
  assert.equal(calls[0].opts.body.prompt, 'prompt fresh');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(refs.ASK_REF_CACHE.get('fresh').url, '结果要进缓存，重新渲染时直接用');

  calls.length = 0;
  refs.guHydrateRefs(fakeRoot(['fresh']));
  assert.equal(calls.length, 0, '同一条描述不重复出图');
});

test('同一条描述并发渲染只出一次图', async () => {
  calls.length = 0;
  const root = fakeRoot(['dup', 'dup']);
  refs.guHydrateRefs(root);
  assert.equal(calls.length, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refs.ASK_REF_INFLIGHT.has('dup'), false);
});

test('重试会重新发起出图', async () => {
  calls.length = 0;
  refs.ASK_REF_CACHE.set(refs.guRefKey('retry me'), { error: '超时' });
  refs.guRetryRef('retry me');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.body.prompt, 'retry me');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(refs.ASK_REF_CACHE.get(refs.guRefKey('retry me')).url);
});

test('参考出图不走反推与识别', () => {
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /images\/describe/);
  assert.doesNotMatch(block, /describe/);
  assert.match(block, /\/api\/chat\/ref-image/);
});

test('关掉出图开关后一张都不出，图位里仍是提示词 + 三个按钮', async () => {
  refs.state.ask.refImages = false;
  calls.length = 0;
  try {
    const html = refs.guRefCardHtml('a quiet library at dusk');
    assert.match(html, /data-gu-state="off"/);
    assert.match(html, /a quiet library at dusk/, '没图就显示提示词');
    assert.doesNotMatch(html, /参考出图未开启/, '不要拆成「状态 + 按钮」两块');
    assert.match(html, /data-act="ask-ref-now"/, '生成按钮始终可用（只生成这一张）');
    assert.equal((html.match(/class="gu-ref-btn/g) || []).length, 3);
    assert.doesNotMatch(html, /出图中/);

    refs.guHydrateRefs(fakeRoot(['while-off']));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 0, '关闭时不能发起任何出图请求');
    assert.equal(refs.ASK_REF_QUEUE.length, 0);
  } finally {
    refs.state.ask.refImages = true;
  }
});

test('重新打开开关后继续出图', async () => {
  calls.length = 0;
  refs.guHydrateRefs(fakeRoot(['after-on']));
  assert.equal(calls.length, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(refs.ASK_REF_CACHE.get('after-on').url);
});

test('点一张只出一张：开关关着时手动生成不连带其它卡', async () => {
  refs.state.ask.refImages = false;
  calls.length = 0;
  try {
    refs.guGenerateRef('only this one please');
    assert.equal(calls.length, 1, '只应该发一次请求');
    assert.equal(calls[0].opts.body.prompt, 'only this one please');
    assert.equal(refs.ASK_REF_QUEUE.length, 0);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(refs.ASK_REF_CACHE.get(refs.guRefKey('only this one please')).url);
    assert.equal(refs.ASK_REF_INFLIGHT.size, 0);
    assert.equal(refs.ASK_REF_MANUAL.size, 0, '手动标记用完就清掉');
  } finally {
    refs.state.ask.refImages = true;
  }
});

test('手动生成时别的卡片仍然是占位，不会被排进队列', async () => {
  refs.state.ask.refImages = false;
  calls.length = 0;
  try {
    refs.guHydrateRefs(fakeRoot(['auto-one', 'auto-two']));
    assert.equal(calls.length, 0, '开关关着时自动出图不应该跑');
    refs.guGenerateRef('manual only');
    assert.equal(calls.length, 1);
    assert.equal(refs.ASK_REF_QUEUE.length, 0, '别的卡不进队列');
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    refs.state.ask.refImages = true;
  }
});

test('尺寸直接写在标签上，样式表没更新也不会撑成一大块', () => {
  const prompt = 'a quiet temple in the mist';
  const ready = refs.guRefCardHtml(prompt);
  const ratio = refs.guRefRatio('4:3');
  const box = refs.guRefBox(ratio);
  assert.match(ready, new RegExp(`height:${box.height}px`), '图位高度按比例内联');
  assert.match(ready, new RegExp(`width:${box.width}px`), '卡片宽度按比例内联');
  const tall = refs.guRefCardHtml('a tall pagoda at dusk', '9:16');
  assert.match(tall, /height:220px/);
  const loading = refs.guRefMediaHtml('quiet library', null, ratio);
  assert.match(loading, new RegExp(`height:${box.height}px`), '出图中的占位同样按比例');
  const failed = refs.guRefMediaHtml('quiet library', { error: '超时' }, ratio);
  assert.match(failed, new RegExp(`height:${box.height}px`), '失败态也不另外长高');
  const css = fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8');
  assert.match(css, /\.gu-ref-media \{[^}]*height:148px/, '样式表留一个兜底高度');
  assert.match(css, /\.gu-ref-media\.is-ready img \{[^}]*object-fit:\s*cover/, '图位里铺满');
});

test('卡片严格等于图位高度，不会被网格拉高留下空白条', () => {
  const html = refs.guRefCardHtml('a quiet courtyard at dawn', '9:16');
  assert.match(html, /align-self:start/, '卡片不能被同行的高卡片拉长');
  const css = fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8');
  assert.match(css, /\.gu-ref-grid \{[^}]*align-items:start/, '网格按顶部对齐');
  assert.match(css, /\.gu-ref \{[^}]*align-self:start/, '卡片自身也不拉伸');
});

test('页面能发现自己落后于服务端版本并提示刷新', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.match(server, /pathname === '\/api\/web-version'/);
  assert.match(server, /PUBLIC_API = new Set\(\[[^\]]*'\/api\/web-version'/, '版本接口不需要登录也能查');
  assert.match(source, /function checkWebVersion\(/);
  assert.match(source, /界面已更新 · 点此刷新/);
});

test('正文图片同样限制高度，不按原比例铺满屏幕', () => {
  const css = fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8');
  assert.match(css, /\.gu-image \{[^}]*max-height:\s*\d+px/, '组件里的图片要有高度上限');
  assert.match(css, /img\.ask-inline-img[^{]*\{[^}]*max-height:\s*\d+px/, '正文内联图要有高度上限');
  assert.doesNotMatch(css, /\.gu-ref-media \{[^}]*aspect-ratio/, '参考图位不要再按原比例撑高');
});

test('页面自带占位兜底，旧样式也不会把占位撑成一大片', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  assert.match(html, /\.gu-ref-media \{ height:148px; max-height:148px; overflow:hidden; \}/, '内联兜底要压住高度');
  assert.doesNotMatch(html, /aspect-ratio/, '占位不能再按原比例撑高');
});
