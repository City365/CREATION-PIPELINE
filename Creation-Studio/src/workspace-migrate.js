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

function run({ force = false } = {}) {
  const marker = readMarker();
  if (marker && !force) return marker;
  // force 重跑时沿用第一次迁移选定的项目，避免因为用户切换了当前项目而把数据拆到两处。
  const project = (marker && marker.projectId ? projects.get(marker.projectId) : null) || pickProject();
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
  const backupList = Object.values(backups).filter(Boolean);
  const record = {
    version: 1,
    projectId: project.id,
    folder: workspace.folderName(project),
    dir: paths.dir,
    at: Date.now(),
    moved,
    backups: backupList,
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

module.exports = { run, preview, markerFile };
