'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMockCloud, PNG } = require('./mock-cloud');

const PORT = 18925;
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await sleep(300);
  }
}

test('Skill 优化：提示词注入 → 模型 JSON → 六段输出', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-opt-'));
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
    const cfg = await fetch(base + '/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saveFolder: path.join(tmp, 'media'), assetFolder: path.join(tmp, 'assets') }),
    }).then((r) => r.json());
    assert.ok(cfg.ok, JSON.stringify(cfg));
    const ch = await fetch(base + '/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'llm', type: 'openai-chat', name: 'mock llm', baseUrl: mock.url + '/v1', apiKey: 'test-key', model: 'mock-model', active: true }),
    }).then((r) => r.json());
    assert.ok(ch.ok, JSON.stringify(ch));

    const res = await fetch(base + '/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '十秒，武僧在湖边对少女说话。',
        duration: 10,
        assets: [{ token: '<Picture 1>', kind: 'image', name: 'wuseng.png', subjectName: '武僧', path: path.join(tmp, 'assets', 'wuseng.png') }],
        subjects: [{ ordinal: 1, name: '武僧', tokens: ['<Picture 1>'] }],
      }),
    }).then((r) => r.json());
    assert.ok(res.ok, JSON.stringify(res));
    assert.match(res.data.prompt, /^subject_definitions:/);
    const sections = res.data.prompt.split(/\n\n/).filter((b) => /^[a-z_]+:/.test(b));
    assert.equal(sections.length, 6);
    assert.ok(Array.isArray(res.data.warnings));
    assert.equal(res.data.model, 'mock-model');

    const request = mock.state.chatRequests[0];
    assert.ok(request, '没有发出模型请求');
    assert.equal(request.model, 'mock-model');
    const system = request.messages.find((m) => m.role === 'system').content;
    assert.match(system, /MiniMax H3/);
    assert.match(system, /六段/);
    const user = request.messages.find((m) => m.role === 'user').content;
    assert.match(String(user), /<Picture 1>/);
    assert.match(String(user), /武僧/);
    assert.match(String(user), /目标时长: 10 秒/);
  } finally {
    child.kill();
    mock.server.close();
    await sleep(300);
  }
});


