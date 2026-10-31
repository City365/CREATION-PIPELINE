'use strict';
/** 项目管理：一个项目绑定一个风格，并在项目根目录下拥有独立的文件子目录。 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const styles = require('./styles');
const workspace = require('./workspace');
const { uid } = require('./util');

function dataDir() {
  return config.load().dataDir || path.join(__dirname, '..', 'data');
}

function file() {
  return path.join(dataDir(), 'projects.json');
}

function load() {
  try {
    const list = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(list, null, 2) + '\n', 'utf8');
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

function list() {
  const all = load();
  let changed = false;
  for (const project of all) {
    try {
      if (ensureWorkspace(project)) changed = true;
    } catch { /* 目录建不出来不应让整个项目列表失败 */ }
  }
  if (changed) save(all);
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function get(id) {
  const project = load().find((p) => p.id === id) || null;
  if (project) {
    try {
      if (ensureWorkspace(project)) save(load().map((p) => (p.id === id ? project : p)));
    } catch { /* ignore */ }
  }
  return project;
}

function create(input) {
  const project = normalize(input);
  ensureWorkspace(project);
  const all = load();
  all.push(project);
  save(all);
  return project;
}

function update(id, patch) {
  const all = load();
  const index = all.findIndex((p) => p.id === id);
  if (index < 0) throw new Error('项目不存在');
  const merged = normalize({ ...all[index], ...patch, id }, all[index]);
  merged.folder = all[index].folder || merged.folder;
  all[index] = merged;
  ensureWorkspace(merged);
  save(all);
  return merged;
}

function remove(id) {
  const all = load();
  const next = all.filter((p) => p.id !== id);
  save(next);
  return next.length !== all.length;
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

module.exports = { list, get, create, update, remove, publicProject };
