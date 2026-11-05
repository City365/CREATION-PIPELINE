'use strict';
/**
 * 智能体鉴权收紧：
 * - 内部项目接口只接受本机 + 内部凭据，能查到任意租户的项目；
 * - controller 模式据此校验项目，不再依赖默认租户的 /api/projects 列表。
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

test('内部项目接口校验任意租户项目，普通请求被拒', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-agent-internal-'));
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
  const other = client(base);
  assert.equal((await admin('/api/auth/register', 'POST', { username: 'agent-admin', password: 'agent-pass-123' })).status, 200);
  const projectA = await admin('/api/projects', 'POST', { name: 'agent-project-a' });
  assert.equal(projectA.status, 200, JSON.stringify(projectA.body));

  // 另一个租户的项目：内部接口也要能查到，证明没有按默认租户过滤
  const tenant = await admin('/api/tenants', 'POST', { name: 'agent-tenant-b' });
  assert.equal(tenant.status, 200);
  assert.equal((await admin('/api/users', 'POST', { username: 'agent-owner-b', password: 'agent-pass-123', tenantId: tenant.body.data.id, role: 'owner' })).status, 200);
  assert.equal((await other('/api/auth/login', 'POST', { username: 'agent-owner-b', password: 'agent-pass-123' })).status, 200);
  const projectB = await other('/api/projects', 'POST', { name: 'agent-project-b' });
  assert.equal(projectB.status, 200, JSON.stringify(projectB.body));

  const token = JSON.parse(fs.readFileSync(path.join(dataDir, 'internal-token.json'), 'utf8')).token;
  const internal = (id) => fetch(base + '/api/internal/projects/' + encodeURIComponent(id), {
    headers: { 'X-WMD-Internal': token },
  }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));

  const a = await internal(projectA.body.data.id);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.data.tenantId, projectA.body.data.tenantId);

  const b = await internal(projectB.body.data.id);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(b.body.data.tenantId, tenant.body.data.id);

  const missing = await internal('project-does-not-exist');
  assert.equal(missing.status, 404);

  // 没有内部凭据的普通请求不能读
  const anonymous = await fetch(base + '/api/internal/projects/' + encodeURIComponent(projectA.body.data.id));
  assert.equal(anonymous.status, 401);
});
