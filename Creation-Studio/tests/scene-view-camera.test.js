'use strict';
// 四视图出图：机位说明必须放在最前面，并给参考图写清用途，否则四张会被画成一模一样。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-camera-'));
process.env.WMD_DATA_DIR = path.join(tmp, 'data');

const channels = require('../src/channels');
const imagegen = require('../src/imagegen');
const route = require('../src/creative-routes');

function makeImageChannel() {
  return channels.create('image', { name: '机位测试', type: 'openai-images', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test-only', model: 'test-image', active: true });
}

async function callImage(channel, body) {
  let response = null;
  const ctx = {
    ok: (_res, data) => { response = { data }; },
    bad: (_res, error, status) => { response = { error, status }; },
    readBody: async () => ({ channelId: channel.id, ...body }),
    mediaPath: (p) => p,
    imageDataUrl: () => 'data:image/png;base64,AA==',
  };
  await route({ method: 'POST' }, {}, new URL('http://localhost/api/creative/scene/view-image'), ctx);
  return response;
}

test('机位说明放在提示词最前面，且四条各不相同', async () => {
  const channel = makeImageChannel();
  const originalGen = imagegen.generate; const originalSave = imagegen.saveImages;
  const seen = [];
  imagegen.generate = async (ch, input) => { seen.push(input); return [{ buffer: Buffer.from('x'), mime: 'image/png' }]; };
  imagegen.saveImages = () => ({ items: [{ path: '/tmp/x.png', name: 'x.png' }] });
  try {
    for (const view of ['front', 'side', 'back', 'top']) {
      const res = await callImage(channel, { view, prompt: 'scene body text 场景正文', prefix: '项目场景风格' });
      assert.ok(res && res.data, JSON.stringify(res));
      assert.equal(res.data.camera, true, view + ' 要带机位说明');
    }
    assert.equal(seen.length, 4);
    for (const input of seen) {
      assert.match(input.prompt, /^【本图机位】/, '机位必须在最前面，不能被长提示词埋掉');
      assert.ok(input.prompt.indexOf('【本图机位】') < input.prompt.indexOf('项目场景风格'), '机位要在风格前置之前');
      assert.ok(input.prompt.includes('场景正文'));
    }
    assert.match(seen[0].prompt, /朝北看/);
    assert.match(seen[1].prompt, /朝东看/);
    assert.match(seen[2].prompt, /朝南看/);
    assert.match(seen[3].prompt, /俯视/);
    assert.notEqual(seen[0].prompt, seen[1].prompt, '四条开头的机位说明不能一样');
  } finally { imagegen.generate = originalGen; imagegen.saveImages = originalSave; }
});

test('参考图按用途拆开：源图只借材质，正视图只借造型', async () => {
  const channel = makeImageChannel();
  const originalGen = imagegen.generate; const originalSave = imagegen.saveImages;
  let captured = null;
  imagegen.generate = async (ch, input) => { captured = input; return [{ buffer: Buffer.from('x'), mime: 'image/png' }]; };
  imagegen.saveImages = () => ({ items: [{ path: '/tmp/x.png', name: 'x.png' }] });
  try {
    await callImage(channel, {
      view: 'side',
      prompt: 'side prompt',
      references: [
        { path: 'D:/src/source.png', name: '源图', role: '场景源图：只借材质' },
        { path: 'D:/src/front.png', name: '正视图', role: '同一房间的正视图：只借造型' },
      ],
    });
    assert.equal(captured.refs.length, 2, '两张参考图都要带上');
    assert.deepEqual(captured.refs.map((r) => r.path), ['D:/src/source.png', 'D:/src/front.png']);
    assert.match(captured.prompt, /参考图用途：场景源图：只借材质；同一房间的正视图：只借造型/, '用途要写进提示词');
    assert.match(captured.prompt, /不要复制任何参考图的视角/);
  } finally { imagegen.generate = originalGen; imagegen.saveImages = originalSave; }
});

test('老调用只给 sourcePath 时仍然可用，并补上用途说明', async () => {
  const channel = makeImageChannel();
  const originalGen = imagegen.generate; const originalSave = imagegen.saveImages;
  let captured = null;
  imagegen.generate = async (ch, input) => { captured = input; return [{ buffer: Buffer.from('x'), mime: 'image/png' }]; };
  imagegen.saveImages = () => ({ items: [{ path: '/tmp/x.png', name: 'x.png' }] });
  try {
    await callImage(channel, { view: 'back', prompt: 'back prompt', sourcePath: 'D:/src/only.png' });
    assert.equal(captured.refs.length, 1);
    assert.equal(captured.refs[0].path, 'D:/src/only.png');
    assert.match(captured.prompt, /不许照抄这张图的构图与视角/);
  } finally { imagegen.generate = originalGen; imagegen.saveImages = originalSave; }
});

test('前端：正视带源图，其余机位只挂正视图（避免被源图角度带跑）', () => {
  const web = fs.readFileSync(path.join(__dirname, '../web/creative.js'), 'utf8');
  const source = web.slice(web.indexOf('function sceneViewReferences(view) {'), web.indexOf('async function generateOne(view) {'));
  assert.ok(source.includes("if (view.id === 'front') return sourceRef ? [sourceRef] : [];"), '正视只用源图');
  assert.ok(source.includes('同一空间正视图'), '其余机位挂正视图');
  assert.ok(source.includes('不许复制这张图的构图'), '明确禁止照抄构图');
  assert.ok(source.includes('源图那张的角度会把这四张都带成同一个构图'), '写清为什么非正视不带源图');
  assert.ok(web.includes('references: sceneViewReferences(view)'), '单张和整批出图都要带上参考用途');
  const calls = web.split('references: sceneViewReferences(view)').length - 1;
  assert.equal(calls, 2, 'generateOne 与 generateAll 各一处');
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* Windows 上偶尔还有句柄未释放 */ } });
