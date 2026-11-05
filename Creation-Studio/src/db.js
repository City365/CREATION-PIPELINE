'use strict';
/**
 * 唯一的数据源：data/wmd.sqlite。
 *
 * 账号、会话、租户、项目这些「谁能看到什么」的数据不能放在可以随手编辑的 JSON 里，
 * 全部走 SQLite；首次启动时把老的 tenants/users/sessions/projects.json 导入一次，
 * 然后把它们改名成 *.imported.json，避免有人改了还以为生效。
 *
 * 用 Node 内置的 node:sqlite，不引入原生依赖。
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 每用户的界面偏好（主题、壁纸、字号、音量）。平台 ui 仍是默认值，这里只存覆盖项。
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 一次性邀请/重置码。只存哈希，明文只在创建响应里出现一次。
CREATE TABLE IF NOT EXISTS access_codes (
  code_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  user_id TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_access_codes_expires ON access_codes(expires_at);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  active_project_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  style_id TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT '',
  source_folders TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_projects_tenant ON projects(tenant_id);

CREATE TABLE IF NOT EXISTS executor_channels (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS asset_meta (
  project TEXT PRIMARY KEY,
  subjects TEXT NOT NULL DEFAULT '{}',
  types TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_aliases (
  from_path TEXT PRIMARY KEY,
  to_path TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media_episodes (
  project TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 视频任务状态：一行一个任务。热路径只 upsert 变更行，不再全量重写 jobs.json。
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT '',
  tenant_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  order_no INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jobs_project ON jobs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_jobs_status ON jobs(status);

-- 加密后的密钥。scope/tenant_id 预留给「平台级 / 租户级」拆分，当前统一写 platform。
CREATE TABLE IF NOT EXISTS secrets (
  scope TEXT NOT NULL DEFAULT 'platform',
  tenant_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, tenant_id, name)
);

-- 每个租户自己的渠道、AutoDL Key 元数据、提示词；密钥在 secrets 表里单独加密。
CREATE TABLE IF NOT EXISTS tenant_configs (
  tenant_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 图像生成历史：每个租户保留最近 80 条，按租户隔离。
CREATE TABLE IF NOT EXISTS image_history (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tnt_default',
  project_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_image_history_tenant ON image_history(tenant_id, created_at DESC);

-- 租户配额：0 表示不限制。
CREATE TABLE IF NOT EXISTS tenant_quotas (
  tenant_id TEXT PRIMARY KEY,
  max_users INTEGER NOT NULL DEFAULT 0,
  max_projects INTEGER NOT NULL DEFAULT 0,
  max_tasks_per_day INTEGER NOT NULL DEFAULT 0,
  max_storage_bytes INTEGER NOT NULL DEFAULT 0,
  max_concurrent_tasks INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- 审计日志：登录、成员/租户/项目/配置变更等；detail 只写安全摘要，不写密钥或密码。
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  prev_hash TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at DESC);
`;

let handle = null;
let openedFor = '';

function dataDir() {
  // 用模块常量而不是 config.load()：config 加载密钥时会反过来打开数据库，
  // 这里再调用 load() 会形成递归。
  return config.DATA || path.join(__dirname, '..', 'data');
}

function file() {
  return path.join(dataDir(), 'wmd.sqlite');
}

function open() {
  const dir = dataDir();
  const target = path.join(dir, 'wmd.sqlite');
  if (handle && openedFor === target) return handle;
  if (handle) { try { handle.close(); } catch { /* 换库时旧连接关不掉就算了 */ } handle = null; }
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(target);
  db.exec(SCHEMA);
  migrate(db);
  handle = db;
  openedFor = target;
  importLegacy(db, dir);
  importStores(db, dir);
  return db;
}

/** 给老库补列/补索引；每一步都可重复执行。 */
function ensureColumn(db, table, column, ddl) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((row) => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function migrate(db) {
  ensureColumn(db, 'jobs', 'tenant_id', "tenant_id TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'tenant_quotas', 'max_storage_bytes', 'max_storage_bytes INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'tenant_quotas', 'max_concurrent_tasks', 'max_concurrent_tasks INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'audit_log', 'prev_hash', "prev_hash TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'audit_log', 'hash', "hash TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE INDEX IF NOT EXISTS ix_jobs_tenant_status ON jobs(tenant_id, status)');
  // 老任务没有 tenant_id：按 data 里的 tenantId 回填一次，缺失的落默认租户。
  if (!db.prepare('SELECT value FROM meta WHERE key = ?').get('jobs_tenant_backfill')) {
    const rows = db.prepare("SELECT id, data FROM jobs WHERE tenant_id = ''").all();
    const update = db.prepare('UPDATE jobs SET tenant_id = ? WHERE id = ?');
    for (const row of rows) {
      let tenantId = 'tnt_default';
      try { tenantId = String(JSON.parse(row.data).tenantId || 'tnt_default'); } catch { /* 坏数据落默认租户 */ }
      update.run(tenantId, row.id);
    }
    db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)').run('jobs_tenant_backfill', String(Date.now()));
  }
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

/** 把老的 JSON 数据导入一次；导入过的文件改名，避免有人改了 JSON 以为还在用。 */
function importLegacy(db, dir) {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get('legacy_import');
  if (done) return;
  const rename = (name) => {
    const from = path.join(dir, name);
    if (!fs.existsSync(from)) return;
    try { fs.renameSync(from, path.join(dir, name.replace(/\.json$/, '.imported.json'))); } catch { /* 改名失败不影响数据 */ }
  };

  const tenants = readJson(path.join(dir, 'tenants.json'), []);
  const users = readJson(path.join(dir, 'users.json'), []);
  const sessions = readJson(path.join(dir, 'sessions.json'), {});
  const projects = readJson(path.join(dir, 'projects.json'), []);
  const hasTenants = Array.isArray(tenants) && tenants.length;
  const hasUsers = Array.isArray(users) && users.length;
  const hasProjects = Array.isArray(projects) && projects.length;
  if (!hasTenants && !hasUsers && !hasProjects && !(sessions && Object.keys(sessions).length)) return;

  const now = Date.now();
  const insertTenant = db.prepare('INSERT OR IGNORE INTO tenants(id, name, created_at, updated_at) VALUES (?,?,?,?)');
  const insertUser = db.prepare(`INSERT OR IGNORE INTO users(id, username, username_key, salt, hash, is_admin, tenant_id, role, active_project_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insertSession = db.prepare('INSERT OR IGNORE INTO sessions(token, user_id, created_at, expires_at) VALUES (?,?,?,?)');
  const insertProject = db.prepare(`INSERT OR IGNORE INTO projects(id, tenant_id, owner_user_id, name, description, style_id, folder, source_folders, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  db.exec('BEGIN');
  try {
    for (const row of (Array.isArray(tenants) ? tenants : [])) {
      if (!row || !row.id) continue;
      insertTenant.run(String(row.id), String(row.name || '默认租户'), Number(row.createdAt) || now, Number(row.updatedAt) || now);
    }
    if (!db.prepare('SELECT 1 AS n FROM tenants LIMIT 1').get()) {
      insertTenant.run('tnt_default', '默认租户', now, now);
    }
    const fallbackTenant = db.prepare('SELECT id FROM tenants ORDER BY created_at LIMIT 1').get().id;
    for (const row of (Array.isArray(users) ? users : [])) {
      if (!row || !row.id || !row.username) continue;
      insertUser.run(
        String(row.id), String(row.username), String(row.username).toLowerCase(),
        String(row.salt || ''), String(row.hash || ''),
        row.isAdmin ? 1 : 0,
        String(row.tenantId || fallbackTenant),
        String(row.role || (row.isAdmin ? 'owner' : 'member')),
        String(row.activeProjectId || ''),
        Number(row.createdAt) || now,
      );
    }
    for (const [token, row] of Object.entries(sessions || {})) {
      if (!row || !row.userId) continue;
      insertSession.run(String(token), String(row.userId), Number(row.createdAt) || now, Number(row.expiresAt) || now);
    }
    for (const row of (Array.isArray(projects) ? projects : [])) {
      if (!row || !row.id) continue;
      insertProject.run(
        String(row.id), String(row.tenantId || fallbackTenant), String(row.ownerUserId || ''),
        String(row.name || '未命名项目'), String(row.description || ''), String(row.styleId || ''),
        String(row.folder || ''),
        JSON.stringify(Array.isArray(row.sourceFolders) ? row.sourceFolders : []),
        Number(row.createdAt) || now, Number(row.updatedAt) || now,
      );
    }
    db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)').run('legacy_import', String(now));
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
  for (const name of ['tenants.json', 'users.json', 'sessions.json', 'projects.json']) rename(name);
}

/**
 * 第二批迁移：执行端令牌、素材分类、文件别名、剧集分组。
 * 和第一批分开打标记，这样已经迁移过账号库的环境也能补上。
 */
function importStores(db, dir) {
  if (db.prepare('SELECT value FROM meta WHERE key = ?').get('stores_import')) return;
  const readJson = (name) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { return null; }
  };
  const channels = readJson('executor-channels.json');
  const assets = readJson('assets.json');
  const aliases = readJson('file-aliases.json');
  const episodes = readJson('media-episodes.json');
  const now = Date.now();

  db.exec('BEGIN');
  try {
    for (const [token, row] of Object.entries((channels && channels.tokens) || {})) {
      if (!row) continue;
      db.prepare('INSERT OR IGNORE INTO executor_channels(token, user_id, name, created_at, last_seen) VALUES (?,?,?,?,?)')
        .run(String(token), String(row.userId || 'local'), String(row.name || ''), Number(row.createdAt) || now, Number(row.lastSeen) || 0);
    }
    // 老版 assets.json 是扁平结构（subjects 直接在顶层），对应到“未归档”那一行
    const assetRows = (assets && assets.projects)
      || (assets && assets.subjects ? { '': { subjects: assets.subjects, types: assets.types || {} } } : {});
    for (const [project, row] of Object.entries(assetRows)) {
      if (!row) continue;
      db.prepare('INSERT OR REPLACE INTO asset_meta(project, subjects, types, updated_at) VALUES (?,?,?,?)')
        .run(String(project), JSON.stringify(row.subjects || {}), JSON.stringify(row.types || {}), now);
    }
    for (const [from, to] of Object.entries(aliases || {})) {
      if (!from || !to) continue;
      db.prepare('INSERT OR REPLACE INTO file_aliases(from_path, to_path, updated_at) VALUES (?,?,?)').run(String(from), String(to), now);
    }
    for (const [project, row] of Object.entries((episodes && episodes.projects) || {})) {
      if (!row) continue;
      db.prepare('INSERT OR REPLACE INTO media_episodes(project, payload, updated_at) VALUES (?,?,?)').run(String(project), JSON.stringify(row), now);
    }
    db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)').run('stores_import', String(now));
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
  for (const name of ['executor-channels.json', 'assets.json', 'file-aliases.json', 'media-episodes.json']) {
    const from = path.join(dir, name);
    if (!fs.existsSync(from)) continue;
    try { fs.renameSync(from, path.join(dir, name.replace(/\.json$/, '.imported.json'))); } catch { /* 改名失败不影响数据 */ }
  }
}

module.exports = { open, close, file, dataDir };

/** 测试与优雅退出用：关掉当前连接，下次 open() 重新建。 */
function close() {
  if (handle) { try { handle.close(); } catch { /* ignore */ } }
  handle = null;
  openedFor = '';
}
