'use strict';
/**
 * 租户级配置隔离（API）：两个租户各自建渠道/密钥，互相看不到、用不了；
 * 平台管理员也只看自己租户的配置；部署参数改不动。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const KEY_A = 'sk-tenant-a-' + Math.random().toString(36).slice(2, 8);
const KEY_B = 'sk-tenant-b-' + Math.random().toString(36).slice(2, 8);

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
  return async (p, method = 'GET', body) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}

test('租户之间的渠道、密钥、提示词完全隔离', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-tenant-api-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
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

  const admin = client(base);
  const a = client(base);
  const b = client(base);

  assert.equal((await admin('/api/auth/register', 'POST', { username: 'qa-admin', password: 'qa-pass-123' })).status, 200);

  const tenantA = await admin('/api/tenants', 'POST', { name: 'qa-tenant-a' });
  assert.equal(tenantA.status, 200, JSON.stringify(tenantA.body));
  assert.equal((await admin('/api/users', 'POST', { username: 'qa-user-a', password: 'qa-pass-123', tenantId: tenantA.body.data.id, role: 'owner' })).status, 200);
  assert.equal((await a('/api/auth/login', 'POST', { username: 'qa-user-a', password: 'qa-pass-123' })).status, 200);

  const tenantB = await admin('/api/tenants', 'POST', { name: 'qa-tenant-b' });
  assert.equal(tenantB.status, 200, JSON.stringify(tenantB.body));
  assert.equal((await admin('/api/users', 'POST', { username: 'qa-user-b', password: 'qa-pass-123', tenantId: tenantB.body.data.id, role: 'owner' })).status, 200);
  assert.equal((await b('/api/auth/login', 'POST', { username: 'qa-user-b', password: 'qa-pass-123' })).status, 200);

  // A 建图像渠道
  const created = await a('/api/channels', 'POST', {
    kind: 'image', type: 'openai-images', name: 'A 的渠道',
    baseUrl: 'http://127.0.0.1:1', model: 'qa-model', apiKey: KEY_A,
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const channelA = created.body.data.id;

  // B 看不到 A 的渠道，也用不了
  const bChannels = await b('/api/channels');
  assert.equal(bChannels.status, 200);
  assert.equal((bChannels.body.data.image || []).length, 0);
  const bState = await b('/api/state');
  assert.equal((bState.body.data.channels.image || []).length, 0);
  const stolen = await b('/api/images/generate', 'POST', { channelId: channelA, prompt: 'qa' });
  assert.equal(stolen.body.ok, false, 'B 不能用 A 的渠道');

  // B 建自己的渠道
  const createdB = await b('/api/channels', 'POST', {
    kind: 'image', type: 'openai-images', name: 'B 的渠道',
    baseUrl: 'http://127.0.0.1:1', model: 'qa-model', apiKey: KEY_B,
  });
  assert.equal(createdB.status, 200, JSON.stringify(createdB.body));
  const channelB = createdB.body.data.id;

  const aChannels = await a('/api/channels');
  assert.deepEqual((aChannels.body.data.image || []).map((c) => c.id), [channelA]);
  const bChannels2 = await b('/api/channels');
  assert.deepEqual((bChannels2.body.data.image || []).map((c) => c.id), [channelB]);

  // 平台管理员在自己的默认租户里看不到这两个租户的渠道
  const adminChannels = await admin('/api/channels');
  assert.equal((adminChannels.body.data.image || []).length, 0);

  // 非管理员改不动部署参数，但能改自己的提示词
  const savedA = await a('/api/config', 'PUT', { concurrency: 9, prompt: { language: 'en' } });
  assert.equal(savedA.status, 200, JSON.stringify(savedA.body));
  const adminState = await admin('/api/state');
  assert.equal(adminState.body.data.config.concurrency, 3, '非管理员不能改平台并发');
  const aState = await a('/api/state');
  assert.equal(aState.body.data.config.prompt.language, 'en');
  const bState2 = await b('/api/state');
  assert.equal(bState2.body.data.config.prompt.language, 'zh', 'B 的提示词不应被 A 改掉');

  // 配置文件与数据库检查
  const configText = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  for (const secret of [KEY_A, KEY_B]) assert.equal(configText.includes(secret), false);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'wmd.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare("SELECT tenant_id, COUNT(*) AS n FROM secrets WHERE scope = 'tenant' GROUP BY tenant_id").all();
    const byTenant = Object.fromEntries(rows.map((row) => [row.tenant_id, row.n]));
    assert.equal(byTenant[tenantA.body.data.id], 1);
    assert.equal(byTenant[tenantB.body.data.id], 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM secrets WHERE scope = 'platform'").get().n, 0);
    assert.ok(db.prepare('SELECT 1 FROM tenant_configs WHERE tenant_id = ?').get(tenantA.body.data.id));
    assert.ok(db.prepare('SELECT 1 FROM tenant_configs WHERE tenant_id = ?').get(tenantB.body.data.id));
  } finally {
    db.close();
  }
});
