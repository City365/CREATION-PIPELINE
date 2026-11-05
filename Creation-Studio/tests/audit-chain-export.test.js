'use strict';
/**
 * 审计哈希链与导出：链校验、篡改检出、CSV/JSON 权限。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
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
    const type = res.headers.get('content-type') || '';
    const raw = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      type,
      headers: res.headers,
      raw,
      body: type.includes('json') ? JSON.parse(raw.toString('utf8') || '{}') : raw.toString('utf8'),
    };
  };
  return call;
}

test('审计哈希链能发现篡改，导出带权限控制', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-audit-chain-'));
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
  t.after(() => { try { child.kill('SIGTERM'); } catch { /* ignore */ } try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ } });
  const base = `http://127.0.0.1:${port}`;
  assert.ok(await until(async () => (await fetch(base + '/api/health')).ok), '服务没有启动');

  const admin = client(base);
  const member = client(base);
  assert.equal((await admin('/api/auth/register', 'POST', { username: 'audit-admin', password: 'audit-pass-123' })).status, 200);
  assert.equal((await admin('/api/users', 'POST', { username: 'audit-member', password: 'audit-pass-123', role: 'member' })).status, 200);
  assert.equal((await member('/api/auth/login', 'POST', { username: 'audit-member', password: 'audit-pass-123' })).status, 200);
  assert.equal((await admin('/api/projects', 'POST', { name: '审计项目' })).status, 200);

  const list = await admin('/api/audit?limit=50');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.integrity.ok, true, JSON.stringify(list.body.data.integrity));
  assert.ok(list.body.data.total >= 3);

  const csv = await admin('/api/audit/export?format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.type, /text\/csv/);
  assert.match(csv.headers.get('content-disposition') || '', /attachment/);
  assert.ok(csv.raw[0] === 0xEF && csv.raw[1] === 0xBB && csv.raw[2] === 0xBF, 'CSV 应带 UTF-8 BOM');
  assert.match(csv.body, /项目|project\.create/);

  const json = await admin('/api/audit/export?format=json');
  assert.equal(json.status, 200);
  assert.equal(json.body.integrity.ok, true);

  // 直接改库，链校验必须失败
  const conn = new DatabaseSync(path.join(dataDir, 'wmd.sqlite'));
  conn.exec('PRAGMA busy_timeout = 5000');
  conn.exec("UPDATE audit_log SET detail = 'tampered' WHERE rowid = (SELECT MAX(rowid) FROM audit_log)");
  conn.close();
  const after = await admin('/api/audit?limit=50');
  assert.equal(after.status, 200);
  assert.equal(after.body.data.integrity.ok, false, JSON.stringify(after.body.data.integrity));
  const tampered = await admin('/api/audit/export?format=json');
  assert.equal(tampered.body.integrity.ok, false);

  // 成员不能导出
  assert.equal((await member('/api/audit/export?format=csv')).status, 403);
  assert.equal((await member('/api/audit')).status, 403);
});
