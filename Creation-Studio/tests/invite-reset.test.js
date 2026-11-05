'use strict';
/**
 * 邀请与密码重置：一次性码、过期/重复使用、旧会话失效。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

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
  call.cookie = () => cookie;
  return call;
}

test('邀请创建/接受/过期/重复，重置密码使旧会话失效', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-invite-'));
  const dataDir = path.join(dir, 'data');
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      WMD_PORT: String(port),
      WMD_DATA_DIR: dataDir,
      WMD_AGENT_URL: 'http://127.0.0.1:9',
      WMD_MANAGER_URL: 'http://127.0.0.1:9',
      APPDATA: path.join(dir, 'appdata'),
    },
  });
  t.after(() => { try { child.kill('SIGTERM'); } catch { /* ignore */ } fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  assert.ok(await until(async () => (await fetch(base + '/api/health')).ok), '服务没有启动');

  const admin = client(base);
  const invitee = client(base);
  assert.equal((await admin('/api/auth/register', 'POST', { username: 'inv-admin', password: 'inv-pass-123' })).status, 200);

  const invite = await admin('/api/invites', 'POST', { role: 'member', expiresInHours: 2 });
  assert.equal(invite.status, 200, JSON.stringify(invite.body));
  const code = invite.body.data.code;
  assert.match(code, /^inv_/);

  const info = await fetch(base + '/api/invites/' + encodeURIComponent(code)).then((res) => res.json());
  assert.equal(info.data.tenantName, '默认租户');
  assert.equal(info.data.role, 'member');

  const accepted = await invitee('/api/auth/accept-invite', 'POST', { code, username: 'inv-user', password: 'inv-pass-123' });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.user.username, 'inv-user');
  assert.equal(accepted.body.data.user.role, 'member');
  assert.ok(invitee.cookie().startsWith('wmd_session='));

  const me = await invitee('/api/auth/me');
  assert.equal(me.body.data.user.username, 'inv-user');
  assert.equal(me.body.data.user.tenantId, accepted.body.data.user.tenantId);

  // 重复使用
  assert.equal((await client(base)('/api/auth/accept-invite', 'POST', { code, username: 'inv-user2', password: 'inv-pass-123' })).status, 400);

  // 成员不能邀请
  assert.equal((await invitee('/api/invites', 'POST', { role: 'member' })).status, 403);

  // 过期
  const expired = await admin('/api/invites', 'POST', { role: 'member', expiresInHours: 1 });
  const expiredCode = expired.body.data.code;
  const conn = new DatabaseSync(path.join(dataDir, 'wmd.sqlite'));
  conn.exec('PRAGMA busy_timeout = 5000');
  conn.prepare("UPDATE access_codes SET expires_at = ? WHERE purpose = 'invite' AND used_at = 0").run(Date.now() - 1000);
  conn.close();
  assert.equal((await client(base)('/api/auth/accept-invite', 'POST', { code: expiredCode, username: 'late-user', password: 'inv-pass-123' })).status, 400);

  // 重置密码：旧会话失效，新密码可登录
  const target = accepted.body.data.user;
  const reset = await admin('/api/users/' + target.id + '/reset-token', 'POST', {});
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  const resetCode = reset.body.data.code;
  assert.match(resetCode, /^rst_/);
  const resetInfo = await fetch(base + '/api/resets/' + encodeURIComponent(resetCode)).then((res) => res.json());
  assert.equal(resetInfo.data.username, 'inv-user');

  assert.equal((await client(base)('/api/auth/reset-password', 'POST', { code: resetCode, password: 'new-pass-123' })).status, 200);
  assert.equal((await invitee('/api/state')).status, 401, '旧会话应失效');
  assert.equal((await client(base)('/api/auth/login', 'POST', { username: 'inv-user', password: 'inv-pass-123' })).status, 400);
  assert.equal((await client(base)('/api/auth/login', 'POST', { username: 'inv-user', password: 'new-pass-123' })).status, 200);
  assert.equal((await client(base)('/api/auth/reset-password', 'POST', { code: resetCode, password: 'another-pass' })).status, 400);

  // 自助改密
  const changed = await admin('/api/auth/change-password', 'POST', { oldPassword: 'inv-pass-123', newPassword: 'admin-pass-456' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await client(base)('/api/auth/login', 'POST', { username: 'inv-admin', password: 'inv-pass-123' })).status, 400);
  assert.equal((await client(base)('/api/auth/login', 'POST', { username: 'inv-admin', password: 'admin-pass-456' })).status, 200);
});
