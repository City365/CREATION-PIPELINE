'use strict';
/**
 * 项目路径规范。
 *
 * 约定只有一条：**项目里的文件一律记「相对项目根目录」的路径**（POSIX 风格，例如
 * `assets/素材/人物/第1集/林清栀-三视图.png`）。项目根目录是用户在设置里自己定的，
 * 换盘、换目录、搬文件夹之后，绝对路径全都断掉；相对路径只认「项目目录」这一层，
 * 跟着根目录走，永远不会指错。
 *
 * 绝对路径只做运行时值：要用的时候由 `abs(projectId, rel)` 现算，不写进任何记录。
 *
 * 老数据里存的是绝对路径（任务、事件、聊天、媒体库），读取时用 `heal()` 兜底：
 *   - 有 rel 就按 rel 现算；
 *   - 没有 rel、文件又不在原处，就按「项目目录名」把后半段搬到当前项目目录（`rebase`）。
 */
const fs = require('node:fs');
const path = require('node:path');
const projects = require('./projects');
const workspace = require('./workspace');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const MEDIA_EXT = new Set([...IMAGE_EXT, '.mp4', '.webm', '.mov', '.m4v', '.mp3', '.wav', '.m4a', '.flac', '.ogg']);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function projectOf(projectId) {
  try {
    return projectId ? projects.get(String(projectId)) : null;
  } catch {
    return null;
  }
}

/** 当前项目目录（绝对路径）；没选项目返回空串。 */
function dirOf(projectId) {
  const project = projectOf(projectId);
  if (!project) return '';
  try {
    return path.resolve(workspace.dirFor(project));
  } catch {
    return '';
  }
}

/** 统一分隔符、去掉开头的 ./、压缩重复的 /。开头的 / 故意保留，好让绝对路径被拒绝。 */
function normalize(rel) {
  return String(rel == null ? '' : rel)
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '');
}

/** 合法的项目相对路径：不能是绝对路径、不能带盘符、不能有 ..、不能有空段。 */
function isSafe(rel) {
  const value = normalize(rel);
  if (!value || value === '.') return false;
  if (/^[a-zA-Z]:/.test(value)) return false;
  if (value.startsWith('/')) return false;
  if (value.includes('\0')) return false;
  return value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function assertRel(rel, label = '目标路径') {
  const value = normalize(rel);
  if (!isSafe(value)) {
    throw httpError(`${label}必须是项目内的相对路径（不能以盘符或 / 开头，不能包含 ..）：${String(rel || '（空）')}`);
  }
  return value;
}

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** 相对路径 → 当前项目目录下的绝对路径（越界直接拒绝）。 */
function abs(projectId, rel) {
  const root = dirOf(projectId);
  if (!root) throw httpError('需要先选择项目，才能使用项目相对路径：' + rel);
  const value = assertRel(rel);
  const target = path.resolve(root, value);
  if (!inside(root, target) || target === root) throw httpError('路径越出了项目目录：' + rel);
  return target;
}

/** 绝对路径 → 项目相对路径；不在项目目录里返回空串（项目外的文件不登记 rel）。 */
function relOf(projectId, file) {
  const root = dirOf(projectId);
  if (!root || !file) return '';
  const target = path.resolve(String(file));
  if (!inside(root, target) || target === root) return '';
  return path.relative(root, target).split(path.sep).join('/');
}

/** 项目内文件的「不会因为换根目录失效」的地址。 */
function fileUrl(projectId, rel) {
  const value = normalize(rel);
  const query = 'rel=' + encodeURIComponent(value) + (projectId ? '&projectId=' + encodeURIComponent(projectId) : '');
  return '/api/file?' + query;
}

function isProjectUrl(url) {
  return /^\/api\/file\?rel=/.test(String(url || ''));
}

/**
 * 给一条记录补 rel（有就保留，没有就从绝对路径算）。
 * url 只在「本来就没有 / 还是老式 ?path= 地址」时改写成 rel 地址，
 * 素材库那种 `/api/assets/file?rel=` 地址不动。
 */
function attach(projectId, item) {
  if (!item || typeof item !== 'object') return item;
  if (!projectId) return item;
  const existing = typeof item.rel === 'string' ? normalize(item.rel) : '';
  const rel = existing && isSafe(existing) ? existing : relOf(projectId, item.path);
  if (!rel) return item;
  item.rel = rel;
  if (!item.url || String(item.url).startsWith('/api/file?path=')) item.url = fileUrl(projectId, rel);
  return item;
}

/** 一批记录（例如 job.outputs）批量补 rel。 */
function attachAll(projectId, list) {
  if (!Array.isArray(list)) return list;
  for (const item of list) attach(projectId, item);
  return list;
}

/**
 * 老记录自愈：把「项目目录名」之后的那一段，挂到当前项目目录下。
 * 换了项目根目录 / 手动搬了项目文件夹之后，老绝对路径还能找回来。
 */
function rebase(projectId, oldAbs) {
  const root = dirOf(projectId);
  if (!root || !oldAbs) return '';
  const separator = /[\\/]+/;
  const parts = String(oldAbs).split(separator).filter(Boolean);
  if (!parts.length) return '';
  const folder = path.basename(root).toLowerCase();
  const index = parts.map((part) => part.toLowerCase()).lastIndexOf(folder);
  if (index < 0 || index === parts.length - 1) return '';
  const target = path.resolve(root, ...parts.slice(index + 1));
  if (!inside(root, target) || target === root) return '';
  try {
    if (fs.existsSync(target)) return target;
  } catch { /* 读不到就当没找到 */ }
  return '';
}

/** 不认识项目 id 时也想自愈：拿所有项目的目录名挨个试。 */
function rebaseAny(oldAbs) {
  if (!oldAbs) return '';
  let list = [];
  try {
    list = projects.list();
  } catch {
    list = [];
  }
  for (const project of list) {
    const hit = rebase(project.id, oldAbs);
    if (hit) return hit;
  }
  return '';
}

/**
 * 读取一条记录时修正路径：
 *   1) 有 rel 且按当前项目目录能读到 → 用现算路径，顺手把老绝对路径修好；
 *   2) 否则原路径存在就保持；
 *   3) 否则按项目目录名重挂（换过根目录的老数据）。
 */
function heal(projectId, item) {
  if (!item || typeof item !== 'object') return item;
  const rel = typeof item.rel === 'string' ? normalize(item.rel) : '';
  const root = dirOf(projectId);
  if (rel && isSafe(rel) && root) {
    const target = path.resolve(root, rel);
    if (inside(root, target) && fs.existsSync(target)) {
      item.path = target;
      return item;
    }
  }
  const current = String(item.path || '');
  if (current && fs.existsSync(current)) {
    if (projectId && !item.rel) attach(projectId, item);
    return item;
  }
  const next = rebase(projectId, current) || rebaseAny(current);
  if (next) {
    item.path = next;
    if (projectId) item.rel = relOf(projectId, next);
  }
  return item;
}

function healAll(projectId, list) {
  if (!Array.isArray(list)) return list;
  for (const item of list) heal(projectId, item);
  return list;
}

/** 目标路径是否已经带了允许的扩展名。 */
function hasExt(rel, set = MEDIA_EXT) {
  return set.has(path.extname(normalize(rel)).toLowerCase());
}

/**
 * 生成类工具的目标路径：允许直接给「素材目录」就按类型分类归档，
 * 但默认要求给到文件名。返回 { rel, dir }。
 */
function targetFor(projectId, targetPath) {
  const rel = assertRel(targetPath);
  return { rel, abs: abs(projectId, rel), dir: path.dirname(abs(projectId, rel)) };
}

module.exports = {
  IMAGE_EXT,
  MEDIA_EXT,
  normalize,
  isSafe,
  assertRel,
  dirOf,
  abs,
  relOf,
  fileUrl,
  isProjectUrl,
  attach,
  attachAll,
  heal,
  healAll,
  rebase,
  rebaseAny,
  hasExt,
  targetFor,
  inside,
};
