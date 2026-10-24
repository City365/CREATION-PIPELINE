'use strict';
/** 项目管理：一个项目绑定一个风格，生成时把风格前置注入提示词。 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const styles = require('./styles');
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
  return {
    id: base.id || 'proj-' + uid('').slice(0, 10),
    name: name.slice(0, 60),
    description: String(input.description ?? base.description ?? '').slice(0, 500),
    styleId: style ? style.id : '',
    createdAt: base.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

function list() {
  return load().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function get(id) {
  return load().find((p) => p.id === id) || null;
}

function create(input) {
  const project = normalize(input);
  const all = load();
  all.push(project);
  save(all);
  return project;
}

function update(id, patch) {
  const all = load();
  const index = all.findIndex((p) => p.id === id);
  if (index < 0) throw new Error('项目不存在');
  all[index] = normalize({ ...all[index], ...patch, id }, all[index]);
  save(all);
  return all[index];
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
  return {
    ...project,
    style: style ? styles.publicStyle(style) : null,
  };
}

module.exports = { list, get, create, update, remove, publicProject };
