'use strict';
/** 视频创作台状态：SQLite 持久化（按项目）。 */
const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');
function dataDir() { return config.load().dataDir || path.join(__dirname, '..', 'data'); }
function dbFile() { return path.join(dataDir(), 'studio.db'); }
let db = null;

function open() {
  if (db) return db;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(dbFile());
  db.exec('CREATE TABLE IF NOT EXISTS studio_state (project TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)');
  return db;
}

function normalizeProject(value) {
  const project = String(value || 'default').trim().slice(0, 120);
  return project || 'default';
}

function get(project) {
  const row = open().prepare('SELECT data, updated FROM studio_state WHERE project = ?').get(normalizeProject(project));
  if (!row) return null;
  try {
    return { state: JSON.parse(row.data), updated: Number(row.updated) || 0 };
  } catch {
    return null;
  }
}

function save(project, state) {
  const payload = JSON.stringify(state == null ? {} : state);
  const updated = Date.now();
  open().prepare('INSERT INTO studio_state (project, data, updated) VALUES (?, ?, ?) ON CONFLICT(project) DO UPDATE SET data = excluded.data, updated = excluded.updated')
    .run(normalizeProject(project), payload, updated);
  return { updated };
}

module.exports = { get, save, normalizeProject };
