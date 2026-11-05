'use strict';
/**
 * 密钥不能出现在任何状态/列表接口里；留空保存要保留原 Key，clearKey 才清空。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const KEY = 'sk-qa-secret-' + Math.random().toString(36).slice(2, 10);

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

test('状态/渠道/配置接口不返回完整 Key', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-secret-'));
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
    return { status: res.status, text: await res.text() };
  };

  const reg = await call('/api/auth/register', 'POST', { username: 'qa-secret', password: 'qa-pass-123' });
  assert.equal(reg.status, 200, reg.text);

  const created = await call('/api/channels', 'POST', {
    kind: 'llm', type: 'openai-chat', name: 'qa-channel',
    baseUrl: 'http://127.0.0.1:1', model: 'qa-model', apiKey: KEY,
  });
  assert.equal(created.status, 200, created.text);
  const channelId = JSON.parse(created.text).data.id;
  assert.ok(channelId);

  for (const endpoint of ['/api/state', '/api/channels']) {
    const res = await call(endpoint);
    assert.equal(res.status, 200, endpoint + ' ' + res.text);
    assert.equal(res.text.includes(KEY), false, endpoint + ' 泄露了完整 Key');
  }
  const saved = await call('/api/config', 'PUT', { ui: {} });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.text.includes(KEY), false, '/api/config 泄露了完整 Key');
  const stateText = (await call('/api/state')).text;
  assert.match(stateText, /sk-q…/, '应返回脱敏后的尾号');

  const configFile = path.join(dir, 'config.json');
  assert.equal(fs.readFileSync(configFile, 'utf8').includes(KEY), false, 'config.json 不应再有明文 Key');
  const dbBytes = Buffer.concat([
    fs.readFileSync(path.join(dir, 'wmd.sqlite')),
    fs.existsSync(path.join(dir, 'wmd.sqlite-wal')) ? fs.readFileSync(path.join(dir, 'wmd.sqlite-wal')) : Buffer.alloc(0),
  ]).toString('utf8');
  assert.equal(dbBytes.includes(KEY), false, '数据库文件里不应出现明文 Key');

  // 跨进程读加密库：证明服务端确实把 Key 存进去了，而且可解密使用
  process.env.WMD_DATA_DIR = dir;
  const vault = require('../src/vault');
  assert.equal(vault.get('channel:llm:' + channelId + ':apiKey', { scope: 'tenant', tenantId: 'tnt_default' }), KEY);

  // 留空保存 = 保留原 Key
  const kept = await call('/api/channels/' + encodeURIComponent(channelId), 'PUT', { kind: 'llm', name: 'qa-channel-2' });
  assert.equal(kept.status, 200, kept.text);
  assert.equal(kept.text.includes(KEY), false, '更新接口也不能回传 Key');
  assert.equal(JSON.parse(kept.text).data.hasKey, true, '留空保存不应清掉原 Key');
  assert.equal(vault.get('channel:llm:' + channelId + ':apiKey', { scope: 'tenant', tenantId: 'tnt_default' }), KEY);

  // 明确清空
  const cleared = await call('/api/channels/' + encodeURIComponent(channelId), 'PUT', { kind: 'llm', clearKey: true });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal(JSON.parse(cleared.text).data.hasKey, false);
  assert.equal(vault.get('channel:llm:' + channelId + ':apiKey', { scope: 'tenant', tenantId: 'tnt_default' }), '', 'clearKey 应删除加密库里的 Key');
});
