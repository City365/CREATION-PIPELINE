'use strict';
/**
 * 密钥入库：明文迁移、加密落库、文件脱敏、跨进程解密、删除清理、错误主密钥失败。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-vault-'));
process.env.WMD_DATA_DIR = dir;
delete process.env.WMD_SECRET_KEY;

const API_KEY = 'sk-vault-' + Math.random().toString(36).slice(2, 10);
const AUTODL = 'autodl-' + Math.random().toString(36).slice(2, 10);
const LLM = 'sk-llm-' + Math.random().toString(36).slice(2, 10);
const EXEC = 'exe-' + Math.random().toString(36).slice(2, 10);
const configFile = path.join(dir, 'config.json');

fs.writeFileSync(configFile, JSON.stringify({
  channels: {
    llm: [{ id: 'ch-llm', type: 'openai-chat', name: 'L', baseUrl: 'http://127.0.0.1:1', model: 'm', apiKey: API_KEY }],
    image: [],
    video: [{ id: 'ch-v', type: 'manager-video', name: 'V', baseUrl: 'http://127.0.0.1:1', model: '', apiKey: '', executorToken: EXEC }],
  },
  autodlKeys: [{ id: 'key-1', name: '主 Key', token: AUTODL, enabled: true }],
  llm: { baseUrl: 'http://127.0.0.1:1', apiKey: LLM, model: 'm' },
}, null, 2));

const config = require('../src/config');
const vault = require('../src/vault');
const db = require('../src/db');

function assertNoPlaintext(file, secrets) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file).toString('utf8');
  for (const secret of secrets) assert.equal(text.includes(secret), false, path.basename(file) + ' 里出现了明文密钥');
}

test('首次加载把明文密钥搬进加密库，并改写 config.json', () => {
  const cfg = config.load();
  assert.equal(cfg.channels.llm[0].apiKey, API_KEY);
  assert.equal(cfg.channels.video[0].executorToken, EXEC);
  assert.equal(cfg.autodlKeys[0].token, AUTODL);
  assert.equal(cfg.llm.apiKey, LLM);

  const text = fs.readFileSync(configFile, 'utf8');
  for (const secret of [API_KEY, AUTODL, LLM, EXEC]) assert.equal(text.includes(secret), false);
  assert.ok(fs.readdirSync(dir).some((name) => name.startsWith('config.json.bak-')), '改写前应留备份');

  assert.deepEqual(vault.names({ scope: 'tenant', tenantId: 'tnt_default' }), [
    'autodl:key-1',
    'channel:llm:ch-llm:apiKey',
    'channel:video:ch-v:executorToken',
    'llm:apiKey',
  ].sort());
  assert.ok(fs.existsSync(path.join(dir, 'secret.key')), '应生成主密钥文件');

  assertNoPlaintext(path.join(dir, 'wmd.sqlite'), [API_KEY, AUTODL, LLM, EXEC]);
  assertNoPlaintext(path.join(dir, 'wmd.sqlite-wal'), [API_KEY, AUTODL, LLM, EXEC]);
});

test('另一个进程能用同一个主密钥解密', () => {
  const script = "const v=require('./src/vault');process.stdout.write(v.get('channel:llm:ch-llm:apiKey',{scope:'tenant',tenantId:'tnt_default'}))";
  const out = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, WMD_DATA_DIR: dir, WMD_SECRET_KEY: '' },
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, API_KEY);
});

test('主密钥不匹配时启动直接失败，不静默返回空密钥', () => {
  const out = spawnSync(process.execPath, ['-e', "require('./src/config').load()"], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, WMD_DATA_DIR: dir, WMD_SECRET_KEY: 'definitely-a-different-passphrase' },
  });
  assert.notEqual(out.status, 0, '换错主密钥不能继续启动');
  assert.match(out.stderr, /无法解密/);
});

test('保存配置会更新加密库，删除渠道/Key 会清理对应密钥', () => {
  const cfg = config.load();
  cfg.channels.llm[0].apiKey = 'sk-updated-' + Math.random().toString(36).slice(2, 8);
  const updated = cfg.channels.llm[0].apiKey;
  config.save({ channels: cfg.channels });
  assert.equal(vault.get('channel:llm:ch-llm:apiKey', { scope: 'tenant', tenantId: 'tnt_default' }), updated);
  assert.equal(fs.readFileSync(configFile, 'utf8').includes(updated), false);

  config.save({ autodlKeys: [] });
  assert.equal(vault.get('autodl:key-1', { scope: 'tenant', tenantId: 'tnt_default' }), '');
  assert.equal(fs.readFileSync(configFile, 'utf8').includes(AUTODL), false);

  config.save({ llm: { ...config.load().llm, apiKey: '' } });
  assert.equal(vault.get('llm:apiKey', { scope: 'tenant', tenantId: 'tnt_default' }), '');

  // 删除渠道：对应密文一并清理
  const current = config.load();
  current.channels.video = [];
  config.save({ channels: current.channels });
  assert.equal(vault.get('channel:video:ch-v:executorToken', { scope: 'tenant', tenantId: 'tnt_default' }), '');
});

test('密文被篡改时报错，不把坏数据当成空值', () => {
  db.open().prepare('UPDATE secrets SET value_enc = ? WHERE name = ?').run('v1:AAAA:BBBB:CCCC', 'channel:llm:ch-llm:apiKey');
  assert.throws(() => vault.get('channel:llm:ch-llm:apiKey', { scope: 'tenant', tenantId: 'tnt_default' }), /无法解密/);
});

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
