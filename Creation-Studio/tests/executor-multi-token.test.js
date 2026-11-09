'use strict';
/**
 * 多执行端令牌：同一用户多台机器各一条；可单独撤销；不能撤销别人的。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { stopAndClean } = require('./server-cleanup');
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

async function poll(base, token) {
  return fetch(base + '/api/executor/poll?token=' + encodeURIComponent(token) + '&wait=0').then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));
}

test('同一用户可生成多条令牌，单独撤销，越权撤销失败', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-executor-multi-'));
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
  t.after(() => stopAndClean(child, dir));
  const base = `http://127.0.0.1:${port}`;
  assert.ok(await until(async () => (await fetch(base + '/api/health')).ok), '服务没有启动');

  const admin = client(base);
  const other = client(base);
  assert.equal((await admin('/api/auth/register', 'POST', { username: 'exec-admin', password: 'exec-pass-123' })).status, 200);

  const first = await admin('/api/executor/pair', 'POST', { name: 'machine-a' });
  const second = await admin('/api/executor/pair', 'POST', { name: 'machine-b' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const tokenA = first.body.data.token;
  const tokenB = second.body.data.token;
  assert.notEqual(tokenA, tokenB);
  assert.match(tokenA, /^exe_/);

  const status = await admin('/api/executor/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.data.channels.length, 2);
  const ids = status.body.data.channels.map((row) => row.id);
  assert.ok(ids.includes(first.body.data.id));
  assert.ok(ids.includes(second.body.data.id));
  assert.ok(status.body.data.channels.every((row) => row.token === undefined), '状态接口不能返回完整令牌');

  assert.equal((await poll(base, tokenA)).status, 200);
  assert.equal((await poll(base, tokenB)).status, 200);

  // 设为视频任务通道：先建一个管理器渠道
  const channel = await admin('/api/channels', 'POST', {
    kind: 'video', type: 'manager-video', name: '本机管理器', baseUrl: 'http://127.0.0.1:17778',
  });
  assert.equal(channel.status, 200, JSON.stringify(channel.body));
  const active = await admin('/api/executor/active', 'POST', { id: first.body.data.id });
  assert.equal(active.status, 200, JSON.stringify(active.body));
  const afterActive = await admin('/api/executor/status');
  assert.equal(afterActive.body.data.channel.activeId, first.body.data.id);

  // 另一个用户不能撤销
  assert.equal((await admin('/api/users', 'POST', { username: 'exec-other', password: 'exec-pass-123' })).status, 200);
  assert.equal((await other('/api/auth/login', 'POST', { username: 'exec-other', password: 'exec-pass-123' })).status, 200);
  assert.equal((await other('/api/executor/pair', 'DELETE', { id: second.body.data.id })).status, 404);
  assert.equal((await poll(base, tokenB)).status, 200);

  // 撤销自己的第一条，第二条不受影响
  assert.equal((await admin('/api/executor/pair', 'DELETE', { id: first.body.data.id })).status, 200);
  assert.equal((await poll(base, tokenA)).status, 401);
  assert.equal((await poll(base, tokenB)).status, 200);
  const finalStatus = await admin('/api/executor/status');
  assert.equal(finalStatus.body.data.channels.length, 1);
  assert.equal(finalStatus.body.data.channels[0].id, second.body.data.id);
});
