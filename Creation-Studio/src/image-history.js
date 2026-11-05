'use strict';
/**
 * 图像生成历史：原来写 data/image-history.json（每次全量读改写），现在按行存 SQLite。
 *
 * - 每个租户保留最近 80 条，互不挤占；列表只返回当前租户。
 * - 首次打开时把旧 JSON 导入默认租户，然后把原文件改名为 *.imported.json。
 * - payload 保留原始条目形状，接口 / 前端不需要改。
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const tenantContext = require('./tenant-context');
const processLog = require('./process-log');

const LIMIT = 80;
const DEFAULT_TENANT = 'tnt_default';
const IMPORT_MARK = 'image_history_import';
let imported = false;

function currentTenant() {
  return tenantContext.current() || DEFAULT_TENANT;
}

function legacyFile() {
  return path.join(config.DATA || path.join(__dirname, '..', 'data'), 'image-history.json');
}

function ensureImported() {
  if (imported) return;
  const conn = db.open();
  if (conn.prepare('SELECT value FROM meta WHERE key = ?').get(IMPORT_MARK)) { imported = true; return; }
  const source = legacyFile();
  if (!fs.existsSync(source)) {
    conn.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)').run(IMPORT_MARK, String(Date.now()));
    imported = true;
    return;
  }
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(source, 'utf8'));
  } catch (error) {
    // 保留原文件，不标记导入；下次再试。历史列表先返回空，不影响生成。
    processLog.line('image-history-import-failed', error);
    imported = true;
    return;
  }
  const list = (Array.isArray(rows) ? rows : []).filter((entry) => entry && entry.id);
  conn.exec('BEGIN');
  try {
    const insert = conn.prepare(`INSERT OR IGNORE INTO image_history(id, tenant_id, project_id, created_at, payload)
      VALUES (?,?,?,?,?)`);
    for (const entry of list) {
      insert.run(String(entry.id), DEFAULT_TENANT, String(entry.projectId || ''), Number(entry.createdAt) || Date.now(), JSON.stringify(entry));
    }
    conn.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)').run(IMPORT_MARK, String(Date.now()));
    conn.exec('COMMIT');
  } catch (error) {
    try { conn.exec('ROLLBACK'); } catch { /* ignore */ }
    processLog.line('image-history-import-failed', error);
    imported = true;
    return;
  }
  try { fs.renameSync(source, source.replace(/\.json$/, '.imported.json')); } catch { /* 改名失败不影响数据 */ }
  imported = true;
}

function list(tenantId) {
  ensureImported();
  const id = String(tenantId || currentTenant());
  return db.open().prepare('SELECT payload FROM image_history WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(id, LIMIT)
    .map((row) => JSON.parse(row.payload));
}

function remember(entry) {
  ensureImported();
  if (!entry || !entry.id) return null;
  const tenantId = String(entry.tenantId || currentTenant());
  const projectId = String(entry.projectId || '');
  const createdAt = Number(entry.createdAt) || Date.now();
  const { tenantId: _ignored, ...payload } = entry;
  const conn = db.open();
  conn.prepare(`INSERT INTO image_history(id, tenant_id, project_id, created_at, payload)
    VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET tenant_id = excluded.tenant_id, project_id = excluded.project_id,
      created_at = excluded.created_at, payload = excluded.payload`)
    .run(String(entry.id), tenantId, projectId, createdAt, JSON.stringify(payload));
  // 每个租户单独保留 80 条，避免一个租户把别的租户挤掉。
  conn.prepare(`DELETE FROM image_history WHERE tenant_id = ? AND id NOT IN (
    SELECT id FROM image_history WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`)
    .run(tenantId, tenantId, LIMIT);
  return payload;
}

module.exports = { remember, list, ensureImported, LIMIT };
