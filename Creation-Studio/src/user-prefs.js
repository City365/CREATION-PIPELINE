'use strict';
/**
 * 每用户界面偏好。
 *
 * 主题、壁纸、字号、音量这些是「我看得舒服」的设置，不应该一个人改完影响整个租户。
 * 平台 config.json 里的 ui 继续作为默认值；这里只保存该用户显式改过的键，读取时覆盖默认值。
 */
const db = require('./db');

const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_BYTES = 32 * 1024;

function clean(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (BLOCKED.has(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(out), 'utf8') > MAX_BYTES) throw new Error('界面设置过大');
  return out;
}

function get(userId) {
  const key = String(userId || '');
  if (!key) return {};
  const row = db.open().prepare('SELECT data FROM user_prefs WHERE user_id = ?').get(key);
  if (!row) return {};
  try {
    const data = JSON.parse(row.data);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function save(userId, patch) {
  const key = String(userId || '');
  if (!key) throw new Error('缺少用户');
  const next = { ...get(key), ...clean(patch) };
  db.open().prepare(`INSERT INTO user_prefs(user_id, data, updated_at) VALUES (?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(next), Date.now());
  return next;
}

/** 用平台默认值打底，再覆盖该用户自己的设置。 */
function view(base, userId) {
  return { ...(base && typeof base === 'object' ? base : {}), ...get(userId) };
}

function remove(userId) {
  return Number(db.open().prepare('DELETE FROM user_prefs WHERE user_id = ?').run(String(userId || '')).changes) > 0;
}

module.exports = { get, save, view, remove };
