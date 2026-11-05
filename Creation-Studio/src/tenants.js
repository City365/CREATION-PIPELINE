'use strict';
/**
 * 租户：数据隔离的最外层边界。
 *
 * 一个租户下有多名用户，每名用户下有自己的项目；项目之外的东西（任务、素材、成片、
 * 智能体工作区）都挂在项目上，所以「项目归属校验」做对了，数据就不会串。
 *
 * 存 SQLite（src/db.js），和用户、会话、项目同一个库；老 JSON 由 db.js 一次性导入。
 */
const db = require('./db');
const { uid } = require('./util');

const DEFAULT_TENANT = 'tnt_default';

function toTenant(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

function list() {
  const rows = db.open().prepare('SELECT * FROM tenants ORDER BY created_at').all();
  if (!rows.length) return [ensureDefault()];
  return rows.map(toTenant);
}

/** 保证至少有一个租户；老数据迁移都落到这里。 */
function ensure() {
  return list();
}

function ensureDefault() {
  const now = Date.now();
  db.open().prepare('INSERT OR IGNORE INTO tenants(id, name, created_at, updated_at) VALUES (?,?,?,?)')
    .run(DEFAULT_TENANT, '默认租户', now, now);
  return toTenant(db.open().prepare('SELECT * FROM tenants WHERE id = ?').get(DEFAULT_TENANT));
}

function get(id) {
  const key = String(id || '');
  if (!key) return null;
  return toTenant(db.open().prepare('SELECT * FROM tenants WHERE id = ?').get(key));
}

function create(name) {
  const label = String(name || '').trim().slice(0, 60);
  if (!label) throw new Error('请填写租户名称');
  const conn = db.open();
  if (conn.prepare('SELECT 1 AS n FROM tenants WHERE name = ? LIMIT 1').get(label)) throw new Error('租户名称已存在');
  const now = Date.now();
  const id = 'tnt_' + uid('').slice(0, 10);
  conn.prepare('INSERT INTO tenants(id, name, created_at, updated_at) VALUES (?,?,?,?)').run(id, label, now, now);
  return toTenant(conn.prepare('SELECT * FROM tenants WHERE id = ?').get(id));
}

function rename(id, name) {
  const label = String(name || '').trim().slice(0, 60);
  if (!label) throw new Error('请填写租户名称');
  const conn = db.open();
  const row = conn.prepare('SELECT * FROM tenants WHERE id = ?').get(String(id || ''));
  if (!row) throw new Error('租户不存在');
  conn.prepare('UPDATE tenants SET name = ?, updated_at = ? WHERE id = ?').run(label, Date.now(), row.id);
  return toTenant(conn.prepare('SELECT * FROM tenants WHERE id = ?').get(row.id));
}

function remove(id) {
  const key = String(id || '');
  if (key === DEFAULT_TENANT) throw new Error('默认租户不能删除');
  const conn = db.open();
  const row = conn.prepare('SELECT * FROM tenants WHERE id = ?').get(key);
  if (!row) throw new Error('租户不存在');
  const members = conn.prepare('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?').get(key).n;
  if (members) throw new Error('租户里还有用户，先移走或删除用户');
  // 项目属于租户；不先处理项目就删租户会留下孤儿数据，之后谁都能看到却没人能管。
  const projects = conn.prepare('SELECT COUNT(*) AS n FROM projects WHERE tenant_id = ?').get(key).n;
  if (projects) throw new Error('租户下还有 ' + projects + ' 个项目，先删除或转移项目');
  // 租户配置和加密密钥也跟着走，避免留下没有归属的密文。
  conn.prepare('DELETE FROM tenant_configs WHERE tenant_id = ?').run(key);
  conn.prepare("DELETE FROM secrets WHERE scope = 'tenant' AND tenant_id = ?").run(key);
  conn.prepare('DELETE FROM tenant_quotas WHERE tenant_id = ?').run(key);
  conn.prepare('DELETE FROM access_codes WHERE tenant_id = ?').run(key);
  conn.prepare('DELETE FROM tenants WHERE id = ?').run(key);
  return true;
}

function publicTenant(tenant) {
  if (!tenant) return null;
  return { id: tenant.id, name: tenant.name, createdAt: tenant.createdAt, updatedAt: tenant.updatedAt };
}

module.exports = { DEFAULT_TENANT, ensure, list, get, create, rename, remove, publicTenant };
