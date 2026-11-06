'use strict';
/**
 * 项目工作区：所有实体文件（素材、生成视频/图片、上传、导出）都放在
 * `<projectRoot>/<租户>/<用户>/<项目目录>/` 下，工程目录里只保留代码、配置和数据库类数据。
 *
 * 隔离层级是 租户 → 用户 → 项目，磁盘目录和数据库归属一一对应；
 * 老版本只放在 `<projectRoot>/<项目目录>/`，只要那个目录还在就继续用，不擅自搬动用户数据
 * （搬迁用 scripts/migrate-project-dirs.js）。
 *
 * 这里的函数只接收项目对象，不反向依赖 projects.js，避免循环引用。
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const { ensureDir, safeSegment } = require('./util');

const SUBDIRS = ['assets', 'media', 'uploads', 'exports', '智能体工作区'];

function root() {
  return ensureDir(path.resolve(config.load().projectRoot));
}

function folderName(project) {
  if (project && project.folder) return project.folder;
  const clean = safeSegment(String((project && project.name) || 'project')).replace(/[. ]+$/g, '').slice(0, 48) || 'project';
  const suffix = String((project && project.id) || '').replace(/^proj-/, '').slice(-6) || '000000';
  return `${clean}-${suffix}`;
}

/** 归属人 / 租户各自的目录段：名字可读，短 id 兜底，改名后还能找回原来的目录。 */
function scopeName(kind, id) {
  const key = String(id || '');
  if (!key) return '';
  try {
    const conn = db.open();
    if (kind === 'tenant') {
      const row = conn.prepare('SELECT name FROM tenants WHERE id = ?').get(key);
      return (row && row.name) || '';
    }
    const row = conn.prepare('SELECT username FROM users WHERE id = ?').get(key);
    return (row && row.username) || '';
  } catch {
    return '';
  }
}

function segmentFor(kind, id) {
  const key = String(id || '');
  const fallback = kind === 'tenant' ? 'tenant' : 'user';
  const clean = safeSegment(scopeName(kind, key) || fallback).replace(/[. ]+$/g, '').slice(0, 32) || fallback;
  const stripped = key.replace(/^(tnt_|user-)/, '');
  const suffix = (stripped.length <= 8 ? stripped : stripped.slice(-6)) || '000000';
  return `${clean}-${suffix}`;
}

/** 在 parent 下取「这一段」目录：已经存在的同名段优先，其次找后缀对得上的旧目录。 */
function segmentDir(parent, kind, id) {
  const base = ensureDir(parent);
  const segment = segmentFor(kind, id);
  const exact = path.join(base, segment);
  if (fs.existsSync(exact)) return exact;
  const suffix = segment.slice(-6);
  let adopted = '';
  try {
    const hit = fs.readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('-' + suffix))
      .map((entry) => entry.name);
    if (hit.length === 1) adopted = hit[0];
  } catch { /* 目录还读不出来就按新路径建 */ }
  return path.join(base, adopted || segment);
}

/** `<projectRoot>/<租户>/<用户>`：项目目录的父级。 */
function scopeDirFor(project) {
  const tenantDir = segmentDir(root(), 'tenant', project && project.tenantId);
  return segmentDir(tenantDir, 'user', project && project.ownerUserId);
}

function legacyDirFor(project) {
  return path.join(root(), folderName(project));
}

function dirFor(project) {
  if (project?.sourceFolders?.length) return path.resolve(project.sourceFolders[0]);
  const legacy = legacyDirFor(project);
  // 老版本目录还在 → 继续用，不擅自搬家
  if (fs.existsSync(legacy)) return legacy;
  return path.join(scopeDirFor(project), folderName(project));
}

function pathsFor(project) {
  const dir = ensureDir(dirFor(project));
  const paths = { dir };
  for (const sub of SUBDIRS) paths[sub] = ensureDir(path.join(dir, sub));
  return paths;
}

function isInside(rootPath, abs) {
  const root = path.resolve(rootPath);
  const target = path.resolve(abs);
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInside(rootPath, abs) {
  if (!isInside(rootPath, abs)) throw new Error('非法路径');
  return path.resolve(abs);
}

/** 当前项目根与各子目录；没有项目时返回 null，调用方回退到旧目录。 */
function forProject(project) {
  if (!project || !project.id) return null;
  return { ...pathsFor(project), folder: folderName(project), projectId: project.id };
}

module.exports = { SUBDIRS, root, folderName, dirFor, legacyDirFor, scopeDirFor, pathsFor, forProject, isInside, assertInside };
