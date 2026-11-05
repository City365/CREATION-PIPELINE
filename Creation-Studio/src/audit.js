'use strict';
/**
 * 审计日志：谁在什么时间做了什么。只记安全摘要，不记密码、密钥或完整正文。
 *
 * 每条记录带一个按租户串起来的哈希链：
 *   hash = sha256(prev_hash|id|tenant|user|action|target|detail|ip|created_at)
 * 这样直接改库里的记录会被 verify() 发现；它不是防篡改存储，但能留下可校验的证据。
 * 写入失败不能影响业务，因此对外只暴露 record（内部吞掉错误）。
 */
const crypto = require('node:crypto');
const db = require('./db');
const processLog = require('./process-log');

const MAX_PER_TENANT = 5000;
const MAX_EXPORT = 5000;

function fingerprint(row) {
  return crypto.createHash('sha256').update([
    row.prevHash || '', row.id || '', row.tenantId || '', row.userId || '',
    row.action || '', row.target || '', row.detail || '', row.ip || '', String(row.createdAt || 0),
  ].join('|')).digest('hex');
}

function record(entry = {}) {
  try {
    const tenantId = String(entry.tenantId || '');
    const conn = db.open();
    const last = conn.prepare("SELECT hash FROM audit_log WHERE tenant_id = ? AND hash <> '' ORDER BY rowid DESC LIMIT 1").get(tenantId);
    const row = {
      id: crypto.randomUUID(),
      tenantId,
      userId: String(entry.userId || ''),
      action: String(entry.action || '').slice(0, 80),
      target: String(entry.target || '').slice(0, 200),
      detail: String(entry.detail || '').slice(0, 500),
      ip: String(entry.ip || '').slice(0, 80),
      prevHash: last ? last.hash : '',
      createdAt: Number(entry.createdAt) || Date.now(),
    };
    row.hash = fingerprint(row);
    conn.prepare(`INSERT INTO audit_log(id, tenant_id, user_id, action, target, detail, ip, prev_hash, hash, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      row.id, row.tenantId, row.userId, row.action, row.target, row.detail, row.ip, row.prevHash, row.hash, row.createdAt,
    );
    // 每租户保留最近 5000 条，避免日志无限增长。
    conn.prepare(`DELETE FROM audit_log WHERE tenant_id = ? AND id NOT IN (
      SELECT id FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`)
      .run(tenantId, tenantId, MAX_PER_TENANT);
    return true;
  } catch (error) {
    processLog.line('audit-failed', error);
    return false;
  }
}

function toRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    action: row.action,
    target: row.target,
    detail: row.detail,
    ip: row.ip,
    prevHash: row.prev_hash,
    hash: row.hash,
    createdAt: row.created_at,
  };
}

/** tenantId 传空表示不过滤（仅平台管理员应使用）。 */
function list({ tenantId = '', limit = 100, offset = 0 } = {}) {
  const size = Math.max(1, Math.min(500, Number(limit) || 100));
  const skip = Math.max(0, Number(offset) || 0);
  const conn = db.open();
  if (tenantId) {
    return conn.prepare('SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
      .all(String(tenantId), size, skip).map(toRow);
  }
  return conn.prepare('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(size, skip).map(toRow);
}

function count(tenantId = '') {
  const conn = db.open();
  if (tenantId) return conn.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = ?').get(String(tenantId)).n;
  return conn.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
}

/** 导出用：最多 5000 条，按时间倒序。 */
function exportRows(tenantId = '') {
  const conn = db.open();
  if (tenantId) {
    return conn.prepare('SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(String(tenantId), MAX_EXPORT).map(toRow);
  }
  return conn.prepare('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(MAX_EXPORT).map(toRow);
}

function verifyTenant(tenantId) {
  const rows = db.open().prepare('SELECT rowid, * FROM audit_log WHERE tenant_id = ? ORDER BY rowid ASC').all(String(tenantId));
  const start = rows.findIndex((row) => row.hash);
  if (start < 0) return { tenantId, ok: true, checked: 0, anchor: '' };
  let prev = rows[start].prev_hash || '';
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    if (index > start && row.prev_hash !== prev) {
      return { tenantId, ok: false, checked: index - start, brokenAt: row.id, action: row.action, reason: '前一条哈希不匹配' };
    }
    const expected = fingerprint({
      prevHash: row.prev_hash, id: row.id, tenantId: row.tenant_id, userId: row.user_id,
      action: row.action, target: row.target, detail: row.detail, ip: row.ip, createdAt: row.created_at,
    });
    if (row.hash !== expected) {
      return { tenantId, ok: false, checked: index - start, brokenAt: row.id, action: row.action, reason: '内容与哈希不一致' };
    }
    prev = row.hash;
  }
  return { tenantId, ok: true, checked: rows.length - start, anchor: rows[start].id };
}

function verify(tenantId = '') {
  if (tenantId) return verifyTenant(tenantId);
  const ids = db.open().prepare('SELECT DISTINCT tenant_id FROM audit_log ORDER BY tenant_id').all().map((row) => row.tenant_id);
  const tenants = ids.map((id) => verifyTenant(id));
  const broken = tenants.filter((item) => !item.ok);
  return { ok: broken.length === 0, checked: tenants.reduce((sum, item) => sum + item.checked, 0), tenants, broken };
}

function csv(rows) {
  const header = ['时间', '租户', '用户', '动作', '对象', '详情', 'IP', '哈希'];
  const escape = (value) => {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push([
      new Date(row.createdAt).toISOString(), row.tenantId, row.userId, row.action,
      row.target, row.detail, row.ip, row.hash,
    ].map(escape).join(','));
  }
  // Excel 需要 BOM 才能正确识别 UTF-8 中文。
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function exportPayload({ tenantId = '', format = 'json' } = {}) {
  const rows = exportRows(tenantId);
  if (format === 'csv') return { format, body: csv(rows), contentType: 'text/csv; charset=utf-8', rows: rows.length };
  return { format: 'json', body: JSON.stringify({ tenantId: tenantId || '', items: rows, integrity: verify(tenantId) }, null, 2), contentType: 'application/json; charset=utf-8', rows: rows.length };
}

module.exports = { record, list, count, exportRows, exportPayload, verify, verifyTenant, fingerprint, MAX_PER_TENANT };
