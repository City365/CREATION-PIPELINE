'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMockCloud, PNG } = require('./mock-cloud');

const PORT = 18928;
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await sleep(250);
  }
}

test('图像反推 / 提示词优化走当前语言渠道', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-imgtools-'));
  const mock = await startMockCloud();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, APPDATA: path.join(tmp, 'appdata'), H3_PORT: String(PORT), H3_DATA_DIR: path.join(tmp, 'data') },
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
    await fetch(base + '/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'llm', type: 'openai-chat', name: 'mock vision', baseUrl: mock.url + '/v1', apiKey: 'sk-mock', model: 'mock-vision', active: true }),
    });
    const imagePath = path.join(tmp, 'source.png');
    fs.writeFileSync(imagePath, PNG);

    const reversed = await fetch(base + '/api/images/reverse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: imagePath }),
    }).then((r) => r.json());
    assert.ok(reversed.ok, JSON.stringify(reversed));
    assert.match(reversed.data.prompt, /warrior monk/);

    const request = mock.state.chatRequests[0];
    const user = request.messages.find((m) => m.role === 'user');
    assert.ok(Array.isArray(user.content), '反推应以多模态消息发送');
    const imagePart = user.content.find((p) => p.type === 'image_url');
    assert.match(imagePart.image_url.url, /^data:image\/png;base64,/);

    const optimized = await fetch(base + '/api/images/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '一个武僧' }),
    }).then((r) => r.json());
    assert.ok(optimized.ok, JSON.stringify(optimized));
    assert.match(optimized.data.prompt, /detailed cinematic portrait/i);
  } finally {
    child.kill();
    mock.server.close();
    await sleep(300);
  }
});
