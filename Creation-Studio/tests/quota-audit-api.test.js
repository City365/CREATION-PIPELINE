'use strict';
/**
 * 配额与审计：用户/项目/每日任务上限，登录与变更留痕，租户隔离。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('./mock-cloud');

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
  call.setCookie = (value) => { cookie = value; };
  return call;
}

test('配额限制用户/项目/任务，审计按租户留痕', async (t) => {
  const provider = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-quota-audit-'));
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
  t.after(async () => {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    await new Promise((resolve) => provider.close(resolve));
  });
  const base = `http://127.0.0.1:${port}`;
  assert.ok(await until(async () => (await fetch(base + '/api/health')).ok), '服务没有启动');

  const admin = client(base);
  const owner = client(base);
  const member = client(base);
  assert.equal((await admin('/api/auth/register', 'POST', { username: 'qa-admin', password: 'qa-pass-123' })).status, 200);

  const tenant = await admin('/api/tenants', 'POST', { name: 'qa-quota-tenant' });
  assert.equal(tenant.status, 200, JSON.stringify(tenant.body));
  const tenantId = tenant.body.data.id;

  const quota = await admin('/api/tenants/' + tenantId + '/quota', 'PUT', { maxUsers: 2, maxProjects: 1, maxTasksPerDay: 1 });
  assert.equal(quota.status, 200, JSON.stringify(quota.body));
  assert.equal(quota.body.data.quota.maxUsers, 2);
  assert.equal(quota.body.data.quota.maxProjects, 1);
  assert.equal(quota.body.data.quota.maxTasksPerDay, 1);
  assert.equal(quota.body.data.quota.maxStorageBytes, 0);
  assert.equal(quota.body.data.quota.maxConcurrentTasks, 0);

  assert.equal((await admin('/api/users', 'POST', { username: 'qa-owner', password: 'qa-pass-123', tenantId, role: 'owner' })).status, 200);
  assert.equal((await admin('/api/users', 'POST', { username: 'qa-member', password: 'qa-pass-123', tenantId, role: 'member' })).status, 200);
  const third = await admin('/api/users', 'POST', { username: 'qa-third', password: 'qa-pass-123', tenantId });
  assert.equal(third.status, 429, JSON.stringify(third.body));
  assert.match(third.body.error, /用户数/);

  assert.equal((await owner('/api/auth/login', 'POST', { username: 'qa-owner', password: 'qa-pass-123' })).status, 200);
  assert.equal((await member('/api/auth/login', 'POST', { username: 'qa-member', password: 'qa-pass-123' })).status, 200);

  // 渠道（owner 可管理）
  const channel = await owner('/api/channels', 'POST', {
    kind: 'image', type: 'openai-images', name: '配额 mock',
    baseUrl: 'http://127.0.0.1:' + provider.address().port + '/v1', model: 'mock', apiKey: 'test',
  });
  assert.equal(channel.status, 200, JSON.stringify(channel.body));

  // 项目上限 1
  assert.equal((await owner('/api/projects', 'POST', { name: 'qa-project-1' })).status, 200);
  const secondProject = await owner('/api/projects', 'POST', { name: 'qa-project-2' });
  assert.equal(secondProject.status, 429, JSON.stringify(secondProject.body));
  assert.match(secondProject.body.error, /项目数/);

  // 每日任务上限 1
  const first = await owner('/api/images/generate', 'POST', { prompt: 'qa-quota-first', count: 1 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = await owner('/api/images/generate', 'POST', { prompt: 'qa-quota-second', count: 1 });
  assert.equal(second.status, 429, JSON.stringify(second.body));
  assert.match(second.body.error, /今日任务/);

  // 用量（新增存储/并发字段，核心计数仍按租户）
  const usage = await admin('/api/tenants/' + tenantId + '/quota');
  assert.equal(usage.status, 200);
  assert.equal(usage.body.data.usage.users, 2);
  assert.equal(usage.body.data.usage.projects, 1);
  assert.equal(usage.body.data.usage.tasksToday, 1);
  assert.equal(usage.body.data.usage.runningTasks, 0);
  assert.ok(usage.body.data.usage.storageBytes >= 0);

  // 成员不能改配额 / 不能看审计
  assert.equal((await owner('/api/tenants/' + tenantId + '/quota', 'PUT', { maxUsers: 5 })).status, 403);
  assert.equal((await member('/api/audit')).status, 403);

  // 登录失败也要留痕
  await admin('/api/auth/login', 'POST', { username: 'qa-admin', password: 'wrong-password' });

  // owner 只看到本租户；管理员看到全部
  const ownerAudit = await owner('/api/audit');
  assert.equal(ownerAudit.status, 200);
  assert.ok(ownerAudit.body.data.items.every((row) => row.tenantId === tenantId));
  assert.ok(ownerAudit.body.data.items.some((row) => row.action === 'channel.create'));
  assert.ok(!ownerAudit.body.data.items.some((row) => row.action === 'auth.register'));

  const adminAudit = await admin('/api/audit?limit=200');
  assert.equal(adminAudit.status, 200);
  const actions = adminAudit.body.data.items.map((row) => row.action);
  for (const action of ['auth.register', 'auth.login', 'auth.login.failed', 'tenant.create', 'user.create', 'quota.update', 'project.create', 'channel.create']) {
    assert.ok(actions.includes(action), '缺少审计动作 ' + action);
  }
  assert.equal(JSON.stringify(adminAudit.body).includes('qa-pass-123'), false, '审计不应记录密码');
  assert.equal(JSON.stringify(adminAudit.body).includes('sk-'), false, '审计不应记录密钥');

  const scoped = await admin('/api/audit?tenantId=' + tenantId);
  assert.ok(scoped.body.data.items.every((row) => row.tenantId === tenantId));
});
