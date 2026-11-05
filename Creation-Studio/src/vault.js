'use strict';
/**
 * 密钥库：渠道 API Key、AutoDL Token、执行端令牌加密后存 SQLite。
 *
 * - 加密：AES-256-GCM，随机 12 字节 IV，认证标签随密文一起存。
 * - 主密钥：优先 `WMD_SECRET_KEY`（64 位 hex / 32 字节 base64 / 任意口令经 SHA-256），
 *   否则首次使用时生成 `data/secret.key`（权限 0600）。
 * - 密钥文件/环境变量与数据库分开存放；换远程 MySQL/PG 时主密钥仍留在应用侧。
 * - 解密失败直接报错，不静默返回空值：宁可启动失败，也不能把“读不到”当成“已清空”再写回去。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCOPE = 'platform';
const ROTATION_MARK = 'vault_rotation';
let cachedKey = null;

function dataDir() {
  try { return require('./config').DATA; } catch { return path.join(__dirname, '..', 'data'); }
}

function keyFile() {
  return path.join(dataDir(), 'secret.key');
}

function nextKeyFile() {
  return path.join(dataDir(), 'secret.key.next');
}

/** 把 64 位 hex / 32 字节 base64 / Buffer 统一成 32 字节。 */
function normalizeKey(material) {
  if (Buffer.isBuffer(material)) {
    if (material.length !== 32) throw new Error('密钥必须是 32 字节');
    return Buffer.from(material);
  }
  const text = String(material || '').trim();
  if (/^[0-9a-f]{64}$/i.test(text)) return Buffer.from(text, 'hex');
  const decoded = Buffer.from(text, 'base64');
  if (decoded.length === 32) return decoded;
  throw new Error('密钥格式不支持：需要 64 位 hex 或 32 字节 base64');
}

function masterKey() {
  if (cachedKey) return cachedKey;
  const env = String(process.env.WMD_SECRET_KEY || '').trim();
  if (env) {
    let raw = null;
    if (/^[0-9a-f]{64}$/i.test(env)) raw = Buffer.from(env, 'hex');
    else {
      try { const decoded = Buffer.from(env, 'base64'); if (decoded.length === 32) raw = decoded; } catch { /* 按口令处理 */ }
    }
    cachedKey = raw || crypto.createHash('sha256').update(env).digest();
    return cachedKey;
  }
  const file = keyFile();
  if (fs.existsSync(file)) {
    const raw = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
    if (raw.length !== 32) throw new Error('data/secret.key 无效：应为 32 字节 base64');
    cachedKey = raw;
    return cachedKey;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = crypto.randomBytes(32);
  fs.writeFileSync(file, raw.toString('base64'), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows 上不一定支持，忽略 */ }
  cachedKey = raw;
  return cachedKey;
}

function encryptWith(key, text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

function decryptWith(key, payload) {
  const parts = String(payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('密文格式不支持');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const body = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

function encrypt(text) {
  return encryptWith(masterKey(), text);
}

function decrypt(payload) {
  return decryptWith(masterKey(), payload);
}

function conn() {
  return require('./db').open();
}

function get(name, { scope = SCOPE, tenantId = '' } = {}) {
  const row = conn().prepare('SELECT value_enc FROM secrets WHERE scope = ? AND tenant_id = ? AND name = ?')
    .get(String(scope), String(tenantId), String(name));
  if (!row) return '';
  try {
    return decrypt(row.value_enc);
  } catch (error) {
    throw new Error('密钥「' + name + '」无法解密：secret.key 与环境变量 WMD_SECRET_KEY 不匹配');
  }
}

function set(name, value, { scope = SCOPE, tenantId = '' } = {}) {
  const now = Date.now();
  conn().prepare(`INSERT INTO secrets(scope, tenant_id, name, value_enc, updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(scope, tenant_id, name) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`)
    .run(String(scope), String(tenantId), String(name), encrypt(String(value)), now);
  return true;
}

function remove(name, { scope = SCOPE, tenantId = '' } = {}) {
  const result = conn().prepare('DELETE FROM secrets WHERE scope = ? AND tenant_id = ? AND name = ?')
    .run(String(scope), String(tenantId), String(name));
  return Number(result.changes) > 0;
}

function names({ scope = SCOPE, tenantId = '' } = {}) {
  return conn().prepare('SELECT name FROM secrets WHERE scope = ? AND tenant_id = ? ORDER BY name')
    .all(String(scope), String(tenantId)).map((row) => row.name);
}

/** 只清理本模块管理的三类前缀，避免误删以后新增的其他密钥。 */
function prune(keep, { scope = SCOPE, tenantId = '' } = {}) {
  const keepSet = keep instanceof Set ? keep : new Set(keep || []);
  let removed = 0;
  for (const name of names({ scope, tenantId })) {
    if (!/^(autodl:|channel:|llm:)/.test(name)) continue;
    if (keepSet.has(name)) continue;
    if (remove(name, { scope, tenantId })) removed += 1;
  }
  return removed;
}

function readAll() {
  return conn().prepare('SELECT scope, tenant_id, name, value_enc FROM secrets ORDER BY scope, tenant_id, name').all();
}

function writeKeyFile(target, key) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, key.toString('base64'), { mode: 0o600 });
  try { fs.chmodSync(target, 0o600); } catch { /* Windows 上不一定支持 */ }
}

function swapKeyFiles() {
  const file = keyFile();
  const next = nextKeyFile();
  const backup = file + '.bak-' + Date.now();
  if (fs.existsSync(file)) fs.renameSync(file, backup);
  fs.renameSync(next, file);
  return backup;
}

/**
 * 轮换主密钥：解密全部密钥 → 用新密钥重加密 → 写 key.next → 事务更新 → 换文件。
 * 任何一步失败都不改动原库；中途崩溃由 recover() 在下次启动时收尾。
 * 返回 { rotated, backup, env }。
 */
function rotate({ newKey } = {}) {
  if (String(process.env.WMD_SECRET_KEY || '').trim()) {
    throw new Error('环境变量 WMD_SECRET_KEY 生效时不能用文件轮换；请改为更新环境变量并重启');
  }
  const currentKey = masterKey();
  const target = newKey ? normalizeKey(newKey) : crypto.randomBytes(32);
  const rows = readAll();
  const encrypted = rows.map((row) => ({ ...row, value_enc: encryptWith(target, decryptWith(currentKey, row.value_enc)) }));
  const database = conn();
  writeKeyFile(nextKeyFile(), target);
  database.exec('BEGIN');
  try {
    const update = database.prepare('UPDATE secrets SET value_enc = ?, updated_at = ? WHERE scope = ? AND tenant_id = ? AND name = ?');
    const now = Date.now();
    for (const row of encrypted) update.run(row.value_enc, now, row.scope, row.tenant_id, row.name);
    database.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)').run(ROTATION_MARK, JSON.stringify({ at: now, rows: encrypted.length }));
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* ignore */ }
    try { fs.rmSync(nextKeyFile(), { force: true }); } catch { /* ignore */ }
    throw error;
  }
  const backup = swapKeyFiles();
  database.prepare('DELETE FROM meta WHERE key = ?').run(ROTATION_MARK);
  cachedKey = target;
  return { rotated: encrypted.length, backup: backup || '', env: false };
}

/**
 * 启动时收尾未完成的轮换：
 * - 有 marker + next：先用 next 试解密一条；成功说明事务已提交，换文件；失败说明事务未提交，删 next。
 * - 没有 marker 但有 next：轮换没走到事务，删掉 next，保留原密钥。
 */
function recover() {
  // 环境变量是权威主密钥时，不碰文件，避免把环境变量模式下的旧 next 文件误换进来。
  if (String(process.env.WMD_SECRET_KEY || '').trim()) return { recovered: false };
  const next = nextKeyFile();
  const database = conn();
  const mark = database.prepare('SELECT value FROM meta WHERE key = ?').get(ROTATION_MARK);
  if (!fs.existsSync(next)) {
    if (mark) database.prepare('DELETE FROM meta WHERE key = ?').run(ROTATION_MARK);
    return { recovered: false };
  }
  if (!mark) {
    try { fs.rmSync(next, { force: true }); } catch { /* ignore */ }
    return { recovered: false };
  }
  const key = normalizeKey(fs.readFileSync(next, 'utf8'));
  const row = database.prepare('SELECT value_enc FROM secrets LIMIT 1').get();
  let ok = true;
  if (row) {
    try { decryptWith(key, row.value_enc); } catch { ok = false; }
  }
  if (!ok) {
    try { fs.rmSync(next, { force: true }); } catch { /* ignore */ }
    database.prepare('DELETE FROM meta WHERE key = ?').run(ROTATION_MARK);
    return { recovered: false };
  }
  const backup = swapKeyFiles();
  database.prepare('DELETE FROM meta WHERE key = ?').run(ROTATION_MARK);
  cachedKey = key;
  return { recovered: true, backup: backup || '' };
}

/** 测试用：换数据目录或换主密钥后清掉内存缓存。 */
function resetKeyCache() {
  cachedKey = null;
}

module.exports = {
  get, set, remove, names, prune, keyFile, nextKeyFile, rotate, recover, resetKeyCache, normalizeKey,
};
