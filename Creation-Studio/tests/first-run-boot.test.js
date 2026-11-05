'use strict';
/**
 * 新账号首屏：没有项目时前端会带 projectId=default（旧的“未归档”桶名），
 * 它必须落到未归档，而不是被当成不存在的项目返回 404。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function until(fn, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (await fn()) return true; } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

test('没有项目时 projectId=default 落到未归档，不 404', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-first-run-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WMD_PORT: String(port),
      WMD_DATA_DIR: dir,
      WMD_AGENT_URL: 'http://127.0.0.1:9',
      WMD_MANAGER_URL: 'http://127.0.0.1:9',
      APPDATA: path.join(dir, 'appdata'),
    },
  });
  t.after(() => { try { child.kill('SIGTERM'); } catch { /* ignore */ } });
  const base = `http://127.0.0.1:${port}`;
  assert.ok(await until(async () => (await fetch(base + '/api/health')).ok), '服务没有启动');

  let cookie = '';
  const call = async (p, method = 'GET', body) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  assert.equal((await call('/api/auth/register', 'POST', { username: 'qa-first', password: 'qa-pass-123' })).status, 200);

  const state = await call('/api/state');
  assert.equal(state.status, 200, JSON.stringify(state.data));

  for (const kind of ['video', 'image']) {
    const list = await call('/api/workbench/items?projectId=default&kind=' + kind);
    assert.equal(list.status, 200, JSON.stringify(list.data));
    assert.ok(Array.isArray(list.data.data.items), '应返回分镜列表');
    assert.equal(list.data.data.items.length, 0);
  }

  const studio = await call('/api/studio/state?projectId=default');
  assert.equal(studio.status, 200, JSON.stringify(studio.data));

  const jobs = await call('/api/jobs');
  assert.equal(jobs.status, 200, JSON.stringify(jobs.data));
});
