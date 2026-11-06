'use strict';
/**
 * 项目管理：一个项目绑定一个风格，并在项目根目录下拥有独立的文件子目录。
 *
 * 项目记录存 SQLite（src/db.js），不再是 data/projects.json——项目归属决定谁能看到
 * 哪些任务、素材和成片，这份数据不能被随手改写。
 */
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const styles = require('./styles');
const tenants = require('./tenants');
const workspace = require('./workspace');
const { uid } = require('./util');

function toProject(row) {
  if (!row) return null;
  let sourceFolders = [];
  try { sourceFolders = JSON.parse(row.source_folders || '[]'); } catch { sourceFolders = []; }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ownerUserId: row.owner_user_id || '',
    folder: row.folder || '',
    name: row.name,
    description: row.description || '',
    styleId: row.style_id || '',
    sourceFolders: Array.isArray(sourceFolders) ? sourceFolders : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function persistWorkspace(project) {
  db.open().prepare('UPDATE projects SET folder = ? WHERE id = ?').run(String(project.folder || ''), project.id);
}

function normalize(input, base = {}) {
  const styleId = String(input.styleId ?? base.styleId ?? '').trim();
  if (styleId && !styles.get(styleId)) throw new Error('风格不存在');
  const style = styleId ? styles.get(styleId) : null;
  const name = String(input.name || base.name || '').trim();
  if (!name) throw new Error('请填写项目名称');
  const sourceFolders = input.sourceFolders ?? base.sourceFolders ?? [];
  if (!Array.isArray(sourceFolders) || sourceFolders.length > 20) throw new Error('源文件夹最多 20 个');
  const roots = [...new Set(sourceFolders.map(item => {
    if (typeof item !== 'string' || !path.isAbsolute(item)) throw new Error('请选择绝对路径的文件夹');
    const resolved = fs.realpathSync(item);
    if (!fs.statSync(resolved).isDirectory()) throw new Error('源路径必须是文件夹');
    return resolved;
  }))];
  return {
    sourceFolders: roots,
    id: base.id || 'proj-' + uid('').slice(0, 10),
    tenantId: String(input.tenantId ?? base.tenantId ?? tenants.DEFAULT_TENANT),
    ownerUserId: String(input.ownerUserId ?? base.ownerUserId ?? ''),
    folder: base.folder || String(input.folder || ''),
    name: name.slice(0, 60),
    description: String(input.description ?? base.description ?? '').slice(0, 500),
    styleId: style ? style.id : '',
    createdAt: base.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

/** 给还没有目录的项目补上目录名并创建目录；返回是否有改动。 */
function ensureWorkspace(project) {
  let changed = false;
  if (!project.folder) {
    project.folder = workspace.folderName(project);
    changed = true;
  }
  workspace.pathsFor(project);
  return changed;
}

/**
 * 项目列表。传 tenantId 时只返回该租户的项目（业务入口必须传）；
 * 不传只给内部工具用（路径解析、迁移），不要拿它直接喂给接口。
 */
function list(tenantId, ownerUserId) {
  const conn = db.open();
  const owner = String(ownerUserId || '');
  let rows;
  if (tenantId && owner) {
    // 隔离层级 租户 → 用户 → 项目：同一个租户里也只列自己的项目。
    rows = conn.prepare('SELECT * FROM projects WHERE tenant_id = ? AND owner_user_id = ? ORDER BY updated_at DESC').all(String(tenantId), owner);
  } else if (tenantId) {
    rows = conn.prepare('SELECT * FROM projects WHERE tenant_id = ? ORDER BY updated_at DESC').all(String(tenantId));
  } else {
    rows = conn.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  }
  return rows.map(toProject).map((project) => {
    try {
      if (ensureWorkspace(project)) persistWorkspace(project);
    } catch { /* 目录建不出来不应让整个项目列表失败 */ }
    return project;
  });
}

/**
 * 把没有归属人的历史项目挂到该租户最早的用户名下（优先租户负责人）。
 * 只在启动时跑一次，避免「无主项目」在严格隔离后谁都看不到。
 */
function claimOrphans(tenantId) {
  const conn = db.open();
  const rows = tenantId
    ? conn.prepare("SELECT id, tenant_id FROM projects WHERE (owner_user_id = '' OR owner_user_id IS NULL) AND tenant_id = ?").all(String(tenantId))
    : conn.prepare("SELECT id, tenant_id FROM projects WHERE owner_user_id = '' OR owner_user_id IS NULL").all();
  if (!rows.length) return [];
  const claimed = [];
  const pickOwner = (tenantId) => {
    const owner = conn.prepare("SELECT id FROM users WHERE tenant_id = ? AND role = 'owner' ORDER BY created_at LIMIT 1").get(tenantId);
    if (owner) return owner.id;
    const first = conn.prepare('SELECT id FROM users WHERE tenant_id = ? ORDER BY created_at LIMIT 1').get(tenantId);
    return first ? first.id : '';
  };
  for (const row of rows) {
    const owner = pickOwner(row.tenant_id);
    if (!owner) continue; // 该租户还没有用户，等有用户再说
    conn.prepare('UPDATE projects SET owner_user_id = ? WHERE id = ?').run(owner, row.id);
    claimed.push({ id: row.id, ownerUserId: owner });
  }
  return claimed;
}

function get(id) {
  const project = toProject(db.open().prepare('SELECT * FROM projects WHERE id = ?').get(String(id || '')));
  if (!project) return null;
  try {
    if (ensureWorkspace(project)) persistWorkspace(project);
  } catch { /* ignore */ }
  return project;
}

function create(input) {
  const project = normalize(input);
  ensureWorkspace(project);
  db.open().prepare(`INSERT INTO projects(id, tenant_id, owner_user_id, name, description, style_id, folder, source_folders, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    project.id, project.tenantId, project.ownerUserId, project.name, project.description,
    project.styleId, project.folder, JSON.stringify(project.sourceFolders), project.createdAt, project.updatedAt,
  );
  return project;
}

function update(id, patch) {
  const conn = db.open();
  const existing = get(id);
  if (!existing) throw new Error('项目不存在');
  const merged = normalize({ ...existing, ...patch, id: existing.id }, existing);
  merged.folder = existing.folder || merged.folder;
  ensureWorkspace(merged);
  conn.prepare(`UPDATE projects SET tenant_id = ?, owner_user_id = ?, name = ?, description = ?, style_id = ?, folder = ?, source_folders = ?, updated_at = ?
    WHERE id = ?`).run(
    merged.tenantId, merged.ownerUserId, merged.name, merged.description, merged.styleId,
    merged.folder, JSON.stringify(merged.sourceFolders), merged.updatedAt, merged.id,
  );
  return merged;
}

function remove(id) {
  const result = db.open().prepare('DELETE FROM projects WHERE id = ?').run(String(id || ''));
  return Number(result.changes) > 0;
}

function publicProject(project) {
  if (!project) return null;
  const style = styles.get(project.styleId);
  let dir = '';
  try { dir = workspace.dirFor(project); } catch { dir = ''; }
  return {
    ...project,
    dir,
    style: style ? styles.publicStyle(style) : null,
  };
}

module.exports = { list, get, create, update, remove, publicProject, claimOrphans };
