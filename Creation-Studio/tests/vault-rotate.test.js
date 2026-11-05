'use strict';
/**
 * 主密钥轮换：重加密全部密钥、失败不动原库、崩溃后收尾。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-vault-rotate-'));
process.env.WMD_DATA_DIR = path.join(dir, 'data');
delete process.env.WMD_SECRET_KEY;

const db = require('../src/db');
const vault = require('../src/vault');

const scope = { scope: 'tenant', tenantId: 'tnt_default' };

test.after(() => {
  db.close();
  delete process.env.WMD_SECRET_KEY;
  vault.resetKeyCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('轮换后全部密钥可解密，旧密钥备份保留', () => {
  vault.set('channel:image:c1:apiKey', 'secret-one', scope);
  vault.set('llm:apiKey', 'secret-two', scope);
  const before = fs.readFileSync(vault.keyFile(), 'utf8').trim();
  const newKey = crypto.randomBytes(32);
  const out = vault.rotate({ newKey });
  assert.equal(out.rotated, 2);
  assert.equal(vault.get('channel:image:c1:apiKey', scope), 'secret-one');
  assert.equal(vault.get('llm:apiKey', scope), 'secret-two');
  assert.equal(fs.readFileSync(vault.keyFile(), 'utf8').trim(), newKey.toString('base64'));
  assert.ok(fs.existsSync(out.backup), '旧密钥应备份');
  assert.equal(fs.readFileSync(out.backup, 'utf8').trim(), before);
  assert.equal(db.open().prepare('SELECT 1 FROM meta WHERE key = ?').get('vault_rotation'), undefined);
  assert.equal(fs.existsSync(vault.nextKeyFile()), false);
});

test('坏密文时轮换中止，原库和原密钥不变', () => {
  const current = fs.readFileSync(vault.keyFile(), 'utf8').trim();
  db.open().prepare(`INSERT INTO secrets(scope, tenant_id, name, value_enc, updated_at) VALUES (?,?,?,?,?)`)
    .run('tenant', 'tnt_default', 'broken:key', 'v1:bad:bad:bad', Date.now());
  assert.throws(() => vault.rotate({ newKey: crypto.randomBytes(32) }), /解密|bad|auth/i);
  assert.equal(fs.readFileSync(vault.keyFile(), 'utf8').trim(), current);
  assert.equal(vault.get('llm:apiKey', scope), 'secret-two');
  assert.equal(fs.existsSync(vault.nextKeyFile()), false);
  db.open().prepare('DELETE FROM secrets WHERE name = ?').run('broken:key');
});

test('遗留 marker + next 在启动时收尾', () => {
  const current = fs.readFileSync(vault.keyFile(), 'utf8').trim();
  fs.writeFileSync(vault.nextKeyFile(), current, { mode: 0o600 });
  db.open().prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)').run('vault_rotation', JSON.stringify({ at: Date.now(), rows: 2 }));
  const out = vault.recover();
  assert.equal(out.recovered, true);
  assert.equal(fs.existsSync(vault.nextKeyFile()), false);
  assert.equal(db.open().prepare('SELECT 1 FROM meta WHERE key = ?').get('vault_rotation'), undefined);
  assert.equal(vault.get('llm:apiKey', scope), 'secret-two');
});

test('环境变量生效时拒绝文件轮换', () => {
  process.env.WMD_SECRET_KEY = 'local-test-passphrase';
  vault.resetKeyCache();
  assert.throws(() => vault.rotate({ newKey: crypto.randomBytes(32) }), /环境变量/);
  delete process.env.WMD_SECRET_KEY;
  vault.resetKeyCache();
});
