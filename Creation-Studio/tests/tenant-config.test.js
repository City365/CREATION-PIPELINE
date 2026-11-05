'use strict';
/**
 * 租户配置隔离（模块级）：同一进程内不同租户上下文读到的渠道、密钥、提示词互不可见。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-tenant-config-'));
process.env.WMD_DATA_DIR = dir;
delete process.env.WMD_SECRET_KEY;

const config = require('../src/config');
const channels = require('../src/channels');
const tenantContext = require('../src/tenant-context');
const vault = require('../src/vault');
const db = require('../src/db');

const KEY1 = 'sk-tenant-a-' + Math.random().toString(36).slice(2, 8);
const KEY2 = 'sk-tenant-b-' + Math.random().toString(36).slice(2, 8);

function channel(id, name, apiKey) {
  return { id, kind: 'llm', type: 'openai-chat', name, baseUrl: 'http://127.0.0.1:1', model: 'm', apiKey, enabled: true, active: true, options: {} };
}

test('两个租户的渠道/密钥/提示词互不可见', () => {
  tenantContext.run('t1', () => {
    config.save({ channels: { llm: [channel('ch-t1', 'A', KEY1)], image: [], video: [] }, prompt: { language: 'en', systemPrompt: 'tenant-a' } });
  });
  tenantContext.run('t2', () => {
    config.save({ channels: { llm: [channel('ch-t2', 'B', KEY2)], image: [], video: [] }, prompt: { language: 'ja', systemPrompt: 'tenant-b' } });
  });

  const a = tenantContext.run('t1', () => config.load());
  assert.equal(a.channels.llm.length, 1);
  assert.equal(a.channels.llm[0].id, 'ch-t1');
  assert.equal(a.channels.llm[0].apiKey, KEY1);
  assert.equal(a.prompt.language, 'en');

  const b = tenantContext.run('t2', () => config.load());
  assert.equal(b.channels.llm.length, 1);
  assert.equal(b.channels.llm[0].id, 'ch-t2');
  assert.equal(b.channels.llm[0].apiKey, KEY2);
  assert.equal(b.prompt.language, 'ja');

  // 跨租户按 id 取渠道必须拿不到
  assert.equal(tenantContext.run('t1', () => channels.get('llm', 'ch-t2')), null);
  assert.equal(tenantContext.run('t2', () => channels.get('llm', 'ch-t1')), null);

  // 没有上下文的内部调用落到默认租户，看不到这两个租户的渠道
  assert.equal(config.load().channels.llm.length, 0);
});

test('config.json 只留部署参数，密钥按租户加密存储', () => {
  const text = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  for (const secret of [KEY1, KEY2]) assert.equal(text.includes(secret), false);
  const parsed = JSON.parse(text);
  for (const key of ['channels', 'autodlKeys', 'llm', 'prompt']) assert.equal(parsed[key], undefined, 'config.json 不应再有 ' + key);

  const conn = db.open();
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM tenant_configs WHERE tenant_id IN ('t1','t2')").get().n, 2);
  assert.equal(vault.get('channel:llm:ch-t1:apiKey', { scope: 'tenant', tenantId: 't1' }), KEY1);
  assert.equal(vault.get('channel:llm:ch-t2:apiKey', { scope: 'tenant', tenantId: 't2' }), KEY2);
  assert.equal(vault.get('channel:llm:ch-t2:apiKey', { scope: 'tenant', tenantId: 't1' }), '');
  assert.equal(conn.prepare("SELECT COUNT(*) AS n FROM secrets WHERE scope = 'platform'").get().n, 0);
});

test('部署参数仍是平台共享，租户只能改自己的配置', () => {
  tenantContext.run('t1', () => config.save({ concurrency: 7 }));
  assert.equal(tenantContext.run('t1', () => config.load()).concurrency, 7);
  assert.equal(tenantContext.run('t2', () => config.load()).concurrency, 7);
  assert.equal(tenantContext.run('t2', () => config.load()).channels.llm[0].id, 'ch-t2', '平台参数变化不应影响租户渠道');
});

test('异步回调继承租户上下文', async () => {
  const seen = await tenantContext.run('t1', () => new Promise((resolve) => {
    setTimeout(() => resolve(config.load().tenantId), 10);
  }));
  assert.equal(seen, 't1');
});

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
