'use strict';
// 画面参考出图：同一句描述只出一次图，并发只发一次请求。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-ref-images-'));
process.env.WMD_DATA_DIR = dir;

const imagegen = require('../src/imagegen');
const channels = require('../src/channels');
const refImages = require('../src/ref-images');

test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ } });

const realGenerate = imagegen.generate;
const realActive = channels.active;
let generated = 0;

function stub({ fail = false } = {}) {
  generated = 0;
  channels.active = () => ({ id: 'img', model: 'test-image', options: { size: 'auto' } });
  imagegen.generate = async () => {
    generated += 1;
    if (fail) throw new Error('上游 500');
    return [{ buffer: Buffer.from('fake-png-bytes'), mime: 'image/png' }];
  };
}

test.afterEach(() => {
  imagegen.generate = realGenerate;
  channels.active = realActive;
});

test('按描述出图，落盘后可访问并带缓存标记', async () => {
  stub();
  const result = await refImages.one('vast Chinese celestial palace, golden sunrise');
  assert.equal(result.cached, false);
  assert.equal(generated, 1);
  assert.match(result.url, /^\/api\/file\?path=/);
  assert.ok(fs.existsSync(result.path));
  assert.match(result.path, /ref-images/);
  assert.equal(fs.readFileSync(result.path, 'utf8'), 'fake-png-bytes', '落盘的是图片本体');
  assert.match(result.path, /\.png$/);
});

test('同一条描述第二次直接读缓存，不再调接口', async () => {
  stub();
  const first = await refImages.one('dense traditional Chinese palace complex');
  const second = await refImages.one('dense traditional Chinese palace complex');
  assert.equal(second.cached, true);
  assert.equal(second.url, first.url);
  assert.equal(generated, 1, '只应出一次图');
});

test('并发请求同一句描述只出一次图', async () => {
  stub();
  const [a, b] = await Promise.all([
    refImages.one('dreamy Chinese immortal realm white clouds'),
    refImages.one('dreamy Chinese immortal realm white clouds'),
  ]);
  assert.equal(generated, 1);
  assert.equal(a.url, b.url);
});

test('描述为空直接拒绝，不浪费一次接口调用', async () => {
  stub();
  await assert.rejects(() => refImages.one('  '), /画面描述太短/);
  assert.equal(generated, 0);
});

test('没有启用的图像渠道时给出可操作提示', async () => {
  stub();
  channels.active = () => null;
  await assert.rejects(() => refImages.one('a quiet library at dusk'), /图像渠道/);
});

test('上游失败不写缓存，稍后重试还能成功', async () => {
  stub({ fail: true });
  await assert.rejects(() => refImages.one('warm pearl white palace terrace'), /上游 500/);
  stub();
  const ok = await refImages.one('warm pearl white palace terrace');
  assert.equal(ok.cached, false);
  assert.equal(generated, 1);
});

test('缓存键区分模型与尺寸，换模型会重新出图', () => {
  assert.equal(refImages.cacheKey('p', 'm1', 'auto'), refImages.cacheKey('p', 'm1', 'auto'));
  assert.notEqual(refImages.cacheKey('p', 'm1', 'auto'), refImages.cacheKey('p', 'm2', 'auto'));
  assert.notEqual(refImages.cacheKey('p', 'm1', 'auto'), refImages.cacheKey('p', 'm1', '1024x1024'));
});

test('画面比例映射到渠道尺寸，竖屏出竖图、横屏出横图', () => {
  const openai = { type: 'openai-images' };
  assert.equal(refImages.sizeForRatio('9:16', openai), '1024x1536');
  assert.equal(refImages.sizeForRatio('3:4', openai), '1024x1536');
  assert.equal(refImages.sizeForRatio('16:9', openai), '1536x1024');
  assert.equal(refImages.sizeForRatio('4:3', openai), '1536x1024');
  assert.equal(refImages.sizeForRatio('1:1', openai), '1024x1024');
  assert.equal(refImages.sizeForRatio('9：16', openai), '1024x1536', '全角冒号也认');
  assert.equal(refImages.sizeForRatio('7:5', openai), '', '没见过的比例交给渠道自己定');
  assert.equal(refImages.sizeForRatio('9:16', { type: 'gemini-image' }), '', '别的渠道不吃这套尺寸');
});

test('带比例出图时把尺寸传给渠道', async () => {
  stub();
  let seen = null;
  imagegen.generate = async (channel, input) => { seen = input; generated += 1; return [{ buffer: Buffer.from('fake-png-bytes'), mime: 'image/png' }]; };
  await refImages.one('portrait palace courtyard', { ratio: '9:16' });
  assert.equal(seen.size, '1024x1536');
});
