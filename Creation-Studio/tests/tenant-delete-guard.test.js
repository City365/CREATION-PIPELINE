'use strict';
/**
 * 删除完整性：有项目的租户/用户不能被删，否则项目会变成没有归属的孤儿数据。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const unitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-del-unit-'));
process.env.WMD_DATA_DIR = unitDir;

const db = require('../src/db');
const tenants = require('../src/tenants');

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

test('租户下有项目时不能删除', () => {
  const tenant = tenants.create('qa-tenant-with-project');
  db.open().prepare('INSERT INTO projects(id, tenant_id, owner_user_id, name, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run('proj-qa-orphan', tenant.id, '', 'qa-project', Date.now(), Date.now());
  assert.throws(() => tenants.remove(tenant.id), /项目/);
  assert.ok(tenants.get(tenant.id), '租户应仍然存在');
  db.open().prepare('DELETE FROM projects WHERE id = ?').run('proj-qa-orphan');

  // 删除租户时，配置和加密密钥也要清理
  db.open().prepare('INSERT INTO tenant_configs(tenant_id, data, updated_at) VALUES (?,?,?)').run(tenant.id, '{}', Date.now());
  db.open().prepare("INSERT INTO secrets(scope, tenant_id, name, value_enc, updated_at) VALUES ('tenant',?,?,?,?)")
    .run(tenant.id, 'channel:llm:qa:apiKey', 'v1:AAAA:BBBB:CCCC', Date.now());
  db.open().prepare('INSERT INTO tenant_quotas(tenant_id, max_users, max_projects, max_tasks_per_day, updated_at) VALUES (?,?,?,?,?)')
    .run(tenant.id, 1, 1, 1, Date.now());
  assert.equal(tenants.remove(tenant.id), true);
  assert.equal(db.open().prepare('SELECT COUNT(*) AS n FROM tenant_configs WHERE tenant_id = ?').get(tenant.id).n, 0);
  assert.equal(db.open().prepare("SELECT COUNT(*) AS n FROM secrets WHERE tenant_id = ?").get(tenant.id).n, 0);
  assert.equal(db.open().prepare('SELECT COUNT(*) AS n FROM tenant_quotas WHERE tenant_id = ?').get(tenant.id).n, 0);
});

test('用户名下有项目时 API 拒绝删除，无项目可删', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-del-api-'));
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

  let adminCookie = '';
  const asAdmin = async (p, method = 'GET', body) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(adminCookie ? { Cookie: adminCookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) adminCookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  const reg = await asAdmin('/api/auth/register', 'POST', { username: 'qa-admin', password: 'qa-pass-123' });
  assert.equal(reg.status, 200, JSON.stringify(reg.data));

  const tenant = await asAdmin('/api/tenants', 'POST', { name: 'qa-tenant' });
  assert.equal(tenant.status, 200, JSON.stringify(tenant.data));

  const owner = await asAdmin('/api/users', 'POST', {
    username: 'qa-owner', password: 'qa-pass-123', tenantId: tenant.data.data.id, role: 'member',
  });
  assert.equal(owner.status, 200, JSON.stringify(owner.data));
  const ownerId = owner.data.data.id;

  // 以该用户身份建项目（项目归属当前租户、当前用户）
  let userCookie = '';
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'qa-owner', password: 'qa-pass-123' }),
  });
  userCookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(userCookie);
  const project = await fetch(base + '/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: userCookie },
    body: JSON.stringify({ name: 'qa-project' }),
  });
  const projectBody = await project.json();
  assert.equal(project.status, 200, JSON.stringify(projectBody));

  const blocked = await asAdmin('/api/users/' + encodeURIComponent(ownerId), 'DELETE');
  assert.equal(blocked.status, 400, JSON.stringify(blocked.data));
  assert.match(String(blocked.data.error), /项目/);

  const empty = await asAdmin('/api/users', 'POST', { username: 'qa-empty', password: 'qa-pass-123' });
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  const emptyId = empty.data.data.id;
  // 给这个用户挂一条执行端令牌，删用户时应一并清理
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'wmd.sqlite'));
  db.prepare('INSERT INTO executor_channels(token, user_id, name, created_at, last_seen) VALUES (?,?,?,?,?)')
    .run('exe-qa-empty', emptyId, 'qa', Date.now(), 0);
  db.close();
  const removed = await asAdmin('/api/users/' + encodeURIComponent(emptyId), 'DELETE');
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  const check = new DatabaseSync(path.join(dir, 'wmd.sqlite'), { readOnly: true });
  try {
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM executor_channels WHERE user_id = ?').get(emptyId).n, 0);
  } finally { check.close(); }
});

test.after(() => {
  db.close();
  fs.rmSync(unitDir, { recursive: true, force: true });
});
