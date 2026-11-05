'use strict';
/**
 * 主密钥轮换。
 *
 *   node scripts/rotate-secret.js                 # 预览：当前密钥来源、密钥条数、目标指纹
 *   node scripts/rotate-secret.js --apply         # 生成新密钥并重加密
 *   node scripts/rotate-secret.js --apply --new-key <64 位 hex 或 32 字节 base64>
 *
 * 注意：如果启动时用环境变量 WMD_SECRET_KEY，文件轮换不会生效；脚本会直接拒绝。
 */
const crypto = require('node:crypto');
const db = require('../src/db');
const vault = require('../src/vault');

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const prefixed = process.argv.find((item) => item.startsWith(name + '='));
  return prefixed ? prefixed.slice(name.length + 1) : '';
}

function main() {
  const apply = process.argv.includes('--apply');
  const supplied = argValue('--new-key');
  const count = db.open().prepare('SELECT COUNT(*) AS n FROM secrets').get().n;
  const source = process.env.WMD_SECRET_KEY ? '环境变量 WMD_SECRET_KEY' : 'data/secret.key';
  if (!apply) {
    console.log(JSON.stringify({ apply: false, source, secrets: count, keyFile: vault.keyFile(), note: '预览不会修改任何东西' }, null, 2));
    return;
  }
  const newKey = supplied ? vault.normalizeKey(supplied) : crypto.randomBytes(32);
  const out = vault.rotate({ newKey });
  console.log(JSON.stringify({ apply: true, secrets: out.rotated, backup: out.backup, keyFile: vault.keyFile(), fingerprint: crypto.createHash('sha256').update(newKey).digest('hex').slice(0, 12) }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('轮换失败：' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
