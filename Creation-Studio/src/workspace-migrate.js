'use strict';
/**
 * 一次性迁移：把旧版散落在 data/assets、data/uploads、data/media 里的实体文件
 * 收进当前项目的子目录，并把没有项目归属的任务/事件/图像记录归到该项目。
 *
 * 安全约束：
 * - 只处理本应用数据目录下的默认旧目录，不触碰设置里指向外部目录的「未归档」路径；
 * - 搬迁前先复制一份到 data/backups/workspace-<时间>/，误操作可恢复；
 * - 只有第一次运行执行，结果写入 data/workspace-migration.json。
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const auth = require('./auth');
const projects = require('./projects');
const workspace = require('./workspace');
const library = require('./library');
const jobs = require('./jobs');
const events = require('./events');
const imageTasks = require('./image-tasks');
const { ensureDir, safeSegment, stamp } = require('./util');

function markerFile() {
  return path.join(config.DATA, 'workspace-migration.json');
}

function readMarker() {
  try { return JSON.parse(fs.readFileSync(markerFile(), 'utf8')); } catch { return null; }
}

function pickProject() {
  try {
    const user = auth.users()[0];
    if (user && user.activeProjectId) {
      const active = projects.get(user.activeProjectId);
      if (active) return active;
    }
  } catch { /* ignore */ }
  return projects.list()[0] || null;
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let target = path.join(dir, name);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(dir, `${base} (${index})${ext}`);
    index += 1;
  }
  return target;
}

function moveFile(source, targetDir) {
  const target = uniquePath(targetDir, path.basename(source));
  try {
    fs.renameSync(source, target);
  } catch {
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
  }
  return target;
}

function hasFiles(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).some((entry) => !entry.name.startsWith('.')); } catch { return false; }
}

function backupDir(source, label, backupRoot) {
  if (!fs.existsSync(source) || !hasFiles(source)) return '';
  const target = path.join(ensureDir(backupRoot), `${label}-${stamp().replace(/[: ]/g, '-')}`);
  try {
    fs.cpSync(source, target, { recursive: true });
    return target;
  } catch {
    return '';
  }
}

/** 把 sourceRoot 下的所有文件并入 targetRoot，保留子目录结构。 */
function mergeDir(sourceRoot, targetRoot) {
  const source = path.resolve(sourceRoot);
  const target = path.resolve(targetRoot);
  if (!fs.existsSync(source)) return 0;
  if (source === target || workspace.isInside(target, source) || workspace.isInside(source, target)) return 0;
  let moved = 0;
  const walk = (dir, dest) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nextDest = ensureDir(path.join(dest, safeSegment(entry.name)));
        walk(abs, nextDest);
        try { if (!fs.readdirSync(abs).length) fs.rmdirSync(abs); } catch { /* ignore */ }
      } else if (entry.isFile()) {
        moveFile(abs, dest);
        moved += 1;
      }
    }
    try { if (dir !== source && !fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* ignore */ }
  };
  walk(source, target);
  return moved;
}

function agentDbPath() {
  return process.env.H3_AGENT_DB || path.join(config.ROOT, 'agent_backend', 'data', 'conversations.db');
}

/** 把旧版智能体统一挂在 h3-studio 下的会话、运行记录、轨迹和压缩上下文归到目标项目。 */
function migrateAgentSessions(projectId, backupDir) {
  const target = String(projectId || '');
  const legacy = 'h3-studio';
  if (!target || target === legacy) return 0;
  const file = agentDbPath();
  if (!fs.existsSync(file)) return 0;
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { return 0; }
  if (backupDir) {
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(file, path.join(backupDir, 'conversations.db'));
    } catch { /* 备份失败不阻断迁移，结果仍会记录在 marker 里 */ }
  }
  let changes = 0;
  let db = null;
  try {
    db = new DatabaseSync(file);
    for (const table of ['conversations', 'executions', 'trajectory_events', 'compactions']) {
      try {
        const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (!exists) continue;
        const result = db.prepare(`UPDATE ${table} SET project=? WHERE project=?`).run(target, legacy);
        changes += Number(result.changes) || 0;
      } catch { /* 单表失败不影响其它表 */ }
    }
  } catch {
    return 0;
  } finally {
    try { if (db) db.close(); } catch { /* ignore */ }
  }
  return changes;
}

function run({ force = false } = {}) {
  const marker = readMarker();
  if (marker && !force) return marker;
  const project = pickProject();
  if (!project) return null;
  const paths = workspace.pathsFor(project);
  const backupRoot = path.join(config.DATA, 'backups', 'workspace-' + stamp().replace(/[: ]/g, '-'));
  const sources = {
    assets: path.join(config.DATA, 'assets'),
    uploads: path.join(config.DATA, 'uploads'),
    media: path.join(config.DATA, 'media'),
  };
  const backups = {};
  for (const [key, dir] of Object.entries(sources)) backups[key] = backupDir(dir, key, backupRoot);
  const moved = {
    assets: mergeDir(sources.assets, paths.assets),
    uploads: mergeDir(sources.uploads, paths.uploads),
    media: mergeDir(sources.media, paths.media),
  };
  try { moved.meta = library.moveProjectMeta('', project.id); } catch { moved.meta = 0; }
  try { moved.jobs = jobs.adoptLegacy(project.id); } catch { moved.jobs = 0; }
  try { moved.events = events.adoptLegacy(project.id); } catch { moved.events = 0; }
  try { moved.images = imageTasks.tasks().adoptLegacy(project.id); } catch { moved.images = 0; }
  // 测试数据目录下不碰本机真实智能体会话库，除非显式指定了 H3_AGENT_DB。
  if (!process.env.H3_DATA_DIR || process.env.H3_AGENT_DB) {
    try { moved.agents = migrateAgentSessions(project.id, path.join(backupRoot, 'agent')); } catch { moved.agents = 0; }
  }
  const record = {
    version: 1,
    projectId: project.id,
    folder: workspace.folderName(project),
    dir: paths.dir,
    at: Date.now(),
    moved,
    backups: Object.values(backups).filter(Boolean),
  };
  fs.mkdirSync(config.DATA, { recursive: true });
  fs.writeFileSync(markerFile(), JSON.stringify(record, null, 2) + '\n', 'utf8');
  const total = Object.values(moved).reduce((sum, value) => sum + (Number(value) || 0), 0);
  if (total) console.log(`[workspace] 已把 ${total} 个旧文件/记录迁入项目「${project.name}」：${paths.dir}`);
  return record;
}

function countFiles(dir) {
  let count = 0;
  const walk = (current) => {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) count += 1;
    }
  };
  walk(dir);
  return count;
}

function preview() {
  const sources = {
    assets: path.join(config.DATA, 'assets'),
    uploads: path.join(config.DATA, 'uploads'),
    media: path.join(config.DATA, 'media'),
  };
  const counts = {};
  for (const [key, dir] of Object.entries(sources)) counts[key] = countFiles(dir);
  const project = pickProject();
  return {
    marker: readMarker(),
    projectId: project ? project.id : '',
    projectName: project ? project.name : '',
    sources,
    counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
  };
}

module.exports = { run, preview, migrateAgentSessions, markerFile };
