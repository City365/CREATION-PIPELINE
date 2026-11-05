'use strict';
/**
 * 一次性邀请码 / 密码重置码。
 *
 * 数据库只存 sha256(code)，明文只在创建响应里返回一次；单次使用、带过期时间。
 * 不接邮件服务：管理员生成链接后自己发给对方。
 */
const crypto = require('node:crypto');
const db = require('./db');

const INVITE_TTL = 72 * 3600 * 1000;
const RESET_TTL = 30 * 60 * 1000;

function hash(code) {
  return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function codeFor(purpose) {
  const prefix = purpose === 'reset' ? 'rst_' : 'inv_';
  return prefix + crypto.randomBytes(24).toString('base64url');
}

function cleanup() {
  try {
    db.open().prepare('DELETE FROM access_codes WHERE expires_at < ?').run(Date.now() - 7 * 24 * 3600 * 1000);
  } catch { /* 清理失败不影响创建 */ }
}

function insert({ purpose, tenantId = '', role = 'member', userId = '', createdBy = '', ttlMs }) {
  cleanup();
  const code = codeFor(purpose);
  const now = Date.now();
  const expiresAt = now + Math.max(60 * 1000, Number(ttlMs) || INVITE_TTL);
  db.open().prepare(`INSERT INTO access_codes(code_hash, purpose, tenant_id, role, user_id, created_by, created_at, expires_at, used_at)
    VALUES (?,?,?,?,?,?,?,?,0)`).run(
    hash(code), String(purpose), String(tenantId), String(role), String(userId), String(createdBy), now, expiresAt,
  );
  return { code, purpose, tenantId, role, userId, createdAt: now, expiresAt };
}

function createInvite({ tenantId, role = 'member', createdBy = '', ttlMs = INVITE_TTL } = {}) {
  return insert({ purpose: 'invite', tenantId, role, createdBy, ttlMs });
}

function createReset({ userId, tenantId = '', createdBy = '', ttlMs = RESET_TTL } = {}) {
  return insert({ purpose: 'reset', tenantId, userId, createdBy, ttlMs });
}

function peek(code, purpose) {
  const row = db.open().prepare(`SELECT * FROM access_codes
    WHERE code_hash = ? AND purpose = ? AND used_at = 0 AND expires_at > ?`).get(hash(code), String(purpose), Date.now());
  if (!row) return null;
  return {
    codeHash: row.code_hash,
    purpose: row.purpose,
    tenantId: row.tenant_id,
    role: row.role,
    userId: row.user_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** 标记已用；返回 false 表示已被别人用掉或过期。 */
function consume(code, purpose) {
  const result = db.open().prepare(`UPDATE access_codes SET used_at = ?
    WHERE code_hash = ? AND purpose = ? AND used_at = 0 AND expires_at > ?`)
    .run(Date.now(), hash(code), String(purpose), Date.now());
  return Number(result.changes) > 0;
}

module.exports = { INVITE_TTL, RESET_TTL, hash, createInvite, createReset, peek, consume };
