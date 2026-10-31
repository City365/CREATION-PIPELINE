'use strict';
/**
 * 项目工作区：所有实体文件（素材、生成视频/图片、上传、导出）都放在
 * `<projectRoot>/<项目目录>/` 下，工程目录里只保留代码、配置和数据库类数据。
 *
 * 这里的函数只接收项目对象，不反向依赖 projects.js，避免循环引用。
 */
const path = require('node:path');
const config = require('./config');
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

function dirFor(project) {
  return path.join(root(), folderName(project));
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

module.exports = { SUBDIRS, root, folderName, dirFor, pathsFor, forProject, isInside, assertInside };
