'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMockCloud, PNG } = require('./mock-cloud');

const PORT = 18926;
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 25000) {
  const start = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await sleep(250);
  }
}

test('图像渠道：新增渠道 → 生成 → 落盘', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-image-'));
  const mock = await startMockCloud();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, APPDATA: path.join(tmp, 'appdata'), WMD_PORT: String(PORT), WMD_DATA_DIR: path.join(tmp, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${PORT}`;
  try {
    await waitFor(async () => (await fetch(base + '/api/health')).ok, 15000);
    await fetch(base + '/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saveFolder: path.join(tmp, 'media'), assetFolder: path.join(tmp, 'assets') }),
    });
    const createdRes = await fetch(base + '/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'image',
        type: 'openai-images',
        name: 'mock 图像',
        baseUrl: mock.url + '/v1',
        apiKey: 'sk-image',
        model: 'mock-image-model',
        options: { extraJson: JSON.stringify({ background: 'transparent' }) },
      }),
    });
    const created = await createdRes.json();
    assert.ok(created.ok, JSON.stringify(created));
    assert.equal(created.data.active, true);

    const gen = await fetch(base + '/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a red dot', count: 1, size: 'auto' }),
    }).then((r) => r.json());
    assert.ok(gen.ok, JSON.stringify(gen));
    assert.equal(gen.data.items.length, 1);
    const item = gen.data.items[0];
    assert.ok(fs.existsSync(item.path), '图片没有落盘');
    assert.ok(item.bytes > 0);
    assert.equal(mock.state.imageRequests.length, 1);
    assert.match(mock.state.imageRequests[0].path, /images\/generations/);
    assert.equal(mock.state.imageRequests[0].body.background, 'transparent');
    const saved = fs.readFileSync(item.path);
    assert.ok(saved.equals(PNG));

    // Reference-image edit goes through multipart /images/edits
    const refPath = path.join(tmp, 'ref.png');
    fs.writeFileSync(refPath, PNG);
    const edited = await fetch(base + '/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'make it blue', count: 1, refs: [{ path: refPath, name: 'ref.png' }] }),
    }).then((r) => r.json());
    assert.ok(edited.ok, JSON.stringify(edited));
    assert.equal(mock.state.imageRequests.length, 2);
    assert.match(mock.state.imageRequests[1].path, /images\/edits/);
    assert.match(mock.state.imageRequests[1].contentType, /multipart\/form-data/);
    const media = await fetch(base + '/api/media?kind=image').then((r) => r.json());
    assert.ok(media.data.items.some((m) => m.path === item.path), '媒体库没有收录生成的图像');

    // 项目资产图：带 targetPath（项目相对路径）就固定落在素材库那个位置
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'projects.json'), JSON.stringify([{
      id: 'proj-e2e', folder: 'proj-e2e', name: '端到端项目', description: '', styleId: '',
      sourceFolders: [], createdAt: 1, updatedAt: 1,
    }]));
    const assetRel = 'assets/素材/人物/第1集-错过，也是彼此成全/林清栀-三视图.png';
    const asset = await fetch(base + '/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'role sheet', count: 1, projectId: 'proj-e2e', targetPath: assetRel }),
    }).then((r) => r.json());
    assert.ok(asset.ok, JSON.stringify(asset));
    const assetPath = path.join(dataDir, 'projects', 'proj-e2e', 'assets', '素材', '人物', '第1集-错过，也是彼此成全', '林清栀-三视图.png');
    assert.equal(asset.data.items[0].path, assetPath, '应该写到 targetPath 指定的位置');
    assert.equal(asset.data.items[0].rel, assetRel);
    assert.ok(fs.existsSync(assetPath));
    const served = await fetch(base + '/api/file?rel=' + encodeURIComponent(assetRel) + '&projectId=proj-e2e');
    assert.equal(served.status, 200, 'rel 地址要能读回来');

    // 绝对路径的 targetPath 直接 400，不落盘
    const rejected = await fetch(base + '/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'bad path', count: 1, projectId: 'proj-e2e', targetPath: path.join(tmp, 'escape.png') }),
    }).then((r) => r.json());
    assert.equal(rejected.ok, false);
    assert.match(String(rejected.error), /相对路径/);
  } finally {
    child.kill();
    mock.server.close();
    await sleep(300);
  }
});

