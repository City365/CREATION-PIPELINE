'use strict';
/**
 * 每用户界面偏好 API：两个用户不同主题，互不影响；平台配置不被改写。
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

function client(base) {
  let cookie = '';
  const call = async (p, method = 'GET', body) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return call;
}

test('两个用户的界面主题互不影响，平台配置保持默认', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-user-prefs-api-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WMD_PORT: String(port),
      WMD_DATA_DIR: path.join(dir, 'data'),
      WMD_AGENT_URL: 'http://127.0.0.1:9',
      WMD_MANAGER_URL: 'http://127.0.0.1:9',
      APPDATA: path.join(dir, 'appdata'),
    },
  });
  t.after(() => { try { child.kill('SIGTERM'); } catch { /* ignore */ } fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  assert.ok(await until(async () => (await fetch(base + '/api/health')).ok), '服务没有启动');

  const admin = client(base);
  const other = client(base);
  assert.equal((await admin('/api/auth/register', 'POST', { username: 'pref-admin', password: 'pref-pass-123' })).status, 200);
  assert.equal((await admin('/api/users', 'POST', { username: 'pref-other', password: 'pref-pass-123' })).status, 200);
  assert.equal((await other('/api/auth/login', 'POST', { username: 'pref-other', password: 'pref-pass-123' })).status, 200);

  const before = await admin('/api/state');
  assert.equal(before.status, 200);
  assert.equal(before.body.data.config.ui.theme, 'day-sea');

  const saved = await admin('/api/config', 'PUT', { ui: { theme: 'night', agentFontSize: 18 } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.ui.theme, 'night');
  assert.equal(saved.body.data.ui.agentFontSize, 18);

  const adminState = await admin('/api/state');
  const otherState = await other('/api/state');
  assert.equal(adminState.body.data.config.ui.theme, 'night');
  assert.equal(otherState.body.data.config.ui.theme, 'day-sea');
  assert.equal(otherState.body.data.config.ui.agentFontSize, undefined);

  const file = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'config.json'), 'utf8'));
  assert.equal(file.ui.theme, 'day-sea', '平台默认值不应被用户偏好改写');

  // 另一个用户也能保存自己的主题，不影响管理员
  assert.equal((await other('/api/config', 'PUT', { ui: { theme: 'paper' } })).status, 200);
  assert.equal((await admin('/api/state')).body.data.config.ui.theme, 'night');
  assert.equal((await other('/api/state')).body.data.config.ui.theme, 'paper');
});
