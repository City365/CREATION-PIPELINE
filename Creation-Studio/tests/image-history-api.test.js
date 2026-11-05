'use strict';
/**
 * 图像历史 HTTP：生成完成后能从 /api/images/history 读到；其它租户读不到。
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

test('图像历史入库、按租户隔离', async (t) => {
  const provider = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-history-api-'));
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
  const b = client(base);
  assert.equal((await admin('/api/auth/register', 'POST', { username: 'qa-history', password: 'qa-pass-123' })).status, 200);

  const channel = await admin('/api/channels', 'POST', {
    kind: 'image', type: 'openai-images', name: '历史 mock',
    baseUrl: 'http://127.0.0.1:' + provider.address().port + '/v1', model: 'mock', apiKey: 'test',
  });
  assert.equal(channel.status, 200, JSON.stringify(channel.body));

  const prompt = 'qa-history-' + Math.random().toString(36).slice(2, 8);
  const generated = await admin('/api/images/generate', 'POST', { prompt, count: 1 });
  assert.equal(generated.status, 200, JSON.stringify(generated.body));

  const history = await admin('/api/images/history');
  assert.equal(history.status, 200, JSON.stringify(history.body));
  assert.ok(history.body.data.items.some((item) => item.prompt === prompt), '生成后应出现在历史里');

  // 另一个租户看不到
  const tenant = await admin('/api/tenants', 'POST', { name: 'qa-history-b' });
  assert.equal(tenant.status, 200, JSON.stringify(tenant.body));
  assert.equal((await admin('/api/users', 'POST', { username: 'qa-history-b', password: 'qa-pass-123', tenantId: tenant.body.data.id })).status, 200);
  assert.equal((await b('/api/auth/login', 'POST', { username: 'qa-history-b', password: 'qa-pass-123' })).status, 200);
  const other = await b('/api/images/history');
  assert.equal(other.status, 200);
  assert.equal(other.body.data.items.length, 0, 'B 租户不应看到 A 的历史');
  const own = await admin('/api/images/history');
  assert.ok(own.body.data.items.some((item) => item.prompt === prompt), 'A 的历史不应被 B 清掉');
});

test.after(() => {
  // provider 在 t.after 里关闭；避免监听句柄让测试进程挂住。
});
