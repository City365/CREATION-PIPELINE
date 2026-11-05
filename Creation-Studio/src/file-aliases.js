'use strict';
/**
 * 文件搬家后的别名表：素材归档改名、媒体库整理之后，旧路径（聊天里写死的图片链接、
 * 任务记录、历史消息）会 404。这里记一份「旧绝对路径 → 新绝对路径」，/api/file 找不到时回落到这里，
 * 老对话里的图还能看，不用去改历史消息。
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./db');

function normalize(value) {
  return String(value || '').trim().replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase();
}

/** 别名表现在跟业务数据在同一个库里；保留 file() 是为了兼容旧的调用方。 */
function file() {
  return db.file();
}


function load() {
  const rows = db.open().prepare('SELECT from_path, to_path FROM file_aliases').all();
  const map = {};
  for (const row of rows) map[row.from_path] = row.to_path;
  return map;
}

function save(map) {
  const conn = db.open();
  const now = Date.now();
  conn.exec('BEGIN');
  try {
    conn.prepare('DELETE FROM file_aliases').run();
    for (const [from, to] of Object.entries(map || {})) {
      if (!from || !to) continue;
      conn.prepare('INSERT OR REPLACE INTO file_aliases(from_path, to_path, updated_at) VALUES (?,?,?)').run(String(from), String(to), now);
    }
    conn.exec('COMMIT');
  } catch (error) {
    try { conn.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
}

/** 记一条：旧路径 → 新路径（相对路径会按 data 目录补全，绝对路径原样存）。 */
function record(oldPath, newPath) {
  const from = String(oldPath || '').trim();
  const to = String(newPath || '').trim();
  if (!from || !to) return false;
  const map = load();
  map[from] = to;
  save(map);
  return true;
}

function recordMany(pairs) {
  const map = load();
  let changed = 0;
  for (const [from, to] of pairs || []) {
    if (!from || !to) continue;
    map[String(from).trim()] = String(to).trim();
    changed += 1;
  }
  if (changed) save(map);
  return changed;
}

/** 旧路径如果在表里、且新文件真的存在，就返回新路径；否则返回空字符串。 */
function resolve(requested) {
  const key = normalize(requested);
  if (!key) return '';
  const map = load();
  const hitKey = Object.keys(map).find((item) => normalize(item) === key);
  if (!hitKey) return '';
  const target = String(map[hitKey] || '');
  if (!target) return '';
  try {
    if (!fs.existsSync(target)) return '';
    if (!fs.statSync(target).isFile()) return '';
  } catch { return ''; }
  return target;
}

/* ----------------- 同文件名找回（素材从平铺目录整理进 <集名> 子目录之后） ----------------- */

const INDEX_TTL = 30000;
const INDEX_LIMIT = 20000;
const indexCache = new Map(); // 项目目录 → { at, byName: Map<文件名小写, 绝对路径[]> }

function buildIndex(root) {
  const byName = new Map();
  let count = 0;
  const walk = (dir, depth) => {
    if (count >= INDEX_LIMIT || depth > 8) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (count >= INDEX_LIMIT) return;
      if (entry.name.startsWith('.')) continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(child, depth + 1); continue; }
      if (!entry.isFile()) continue;
      count += 1;
      const key = entry.name.toLowerCase();
      const list = byName.get(key);
      if (list) list.push(child); else byName.set(key, [child]);
    }
  };
  walk(root, 0);
  return byName;
}

function indexFor(root) {
  const key = String(root || '').toLowerCase();
  const hit = indexCache.get(key);
  if (hit && Date.now() - hit.at < INDEX_TTL) return hit.byName;
  const byName = buildIndex(root);
  indexCache.set(key, { at: Date.now(), byName });
  return byName;
}

/** 找回时的搜索根：先项目（路径里带了项目目录名就只搜那个），再媒体库/素材库/上传目录。 */
function searchRoots(requested) {
  const projects = require('./projects');
  const workspace = require('./workspace');
  const list = projects.list();
  const lower = String(requested).toLowerCase().replace(/\//g, '\\');
  const matched = list.filter((project) => {
    try {
      return lower.includes('\\' + path.basename(path.resolve(workspace.dirFor(project))).toLowerCase() + '\\');
    } catch { return false; }
  });
  const roots = [];
  for (const project of (matched.length ? matched : list)) {
    try { roots.push(path.resolve(workspace.dirFor(project))); } catch { /* 目录不可用时跳过 */ }
  }
  const cfg = config.load();
  for (const dir of [cfg.saveFolder, cfg.assetFolder, cfg.uploadFolder]) {
    if (dir) roots.push(path.resolve(dir));
  }
  const seen = new Set();
  const out = [];
  for (const dir of roots) {
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out;
}

/**
 * 文件在项目里被挪过（同文件名、换了目录）时，按文件名找回，并记一条别名。
 * 只有「唯一命中」才认，重名多个不猜，避免把图张冠李戴。
 */
function recover(requested) {
  const oldPath = String(requested || '').trim();
  if (!oldPath) return '';
  const name = path.basename(oldPath.replace(/\//g, '\\')).toLowerCase();
  if (!name) return '';
  const parent = path.basename(path.dirname(oldPath.replace(/\//g, '\\'))).toLowerCase();
  for (const dir of searchRoots(oldPath)) {
    const hits = indexFor(dir).get(name) || [];
    if (!hits.length) continue;
    const sameParent = hits.filter((file) => path.basename(path.dirname(file)).toLowerCase() === parent);
    const pick = sameParent.length === 1 ? sameParent[0] : hits.length === 1 ? hits[0] : '';
    if (!pick) continue;
    try {
      if (!fs.statSync(pick).isFile()) continue;
    } catch { continue; }
    record(oldPath, pick);
    return pick;
  }
  return '';
}

module.exports = { file, load, save, record, recordMany, resolve, recover, normalize };
