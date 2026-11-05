'use strict';
/**
 * 自动备份：对三个 SQLite 库做 VACUUM INTO 快照，按保留策略清理。
 *
 * - 运行中不能直接复制主文件；VACUUM INTO 生成一致快照。
 * - 只清理 data/backups/auto 下的自动快照，不碰 migration/ 和手工备份。
 * - 定时器 unref()，不阻止进程退出；失败只写 process.log，不影响业务。
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const db = require('./db');
const processLog = require('./process-log');

const DB_NAMES = ['wmd.sqlite', 'task-events.sqlite', 'studio.db'];
const LAST_MARK = 'backup.last_auto';
const DAY = 24 * 3600 * 1000;
let timer = null;
let kickoff = null;

function dataDir() {
  return config.DATA || path.join(__dirname, '..', 'data');
}

function autoDir() {
  return path.join(dataDir(), 'backups', 'auto');
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function targetFor(name, at) {
  const dir = autoDir();
  const base = `${stamp(new Date(at))}-${name}`;
  const ext = path.extname(base);
  const stem = base.slice(0, -ext.length);
  let target = path.join(dir, base);
  let index = 1;
  // 同一秒内多次备份：studio.db 和 .sqlite 都要能正确加序号。
  while (fs.existsSync(target)) target = path.join(dir, `${stem}-${index++}${ext}`);
  return target;
}

/** 生成一次快照；返回实际生成的文件。 */
function snapshot({ now = Date.now(), names = DB_NAMES } = {}) {
  fs.mkdirSync(autoDir(), { recursive: true });
  const out = [];
  for (const name of names) {
    const source = path.join(dataDir(), name);
    if (!fs.existsSync(source)) continue;
    const target = targetFor(name, now);
    const conn = new DatabaseSync(source);
    try {
      conn.exec('PRAGMA busy_timeout = 5000');
      conn.prepare('VACUUM INTO ?').run(target);
    } finally {
      try { conn.close(); } catch { /* ignore */ }
    }
    out.push({ name, source, target, bytes: fs.statSync(target).size });
  }
  return out;
}

function list() {
  const dir = autoDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /\.(sqlite|db)$/.test(name))
    .map((name) => {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      // 名字格式：20261105-013000-wmd.sqlite / 20261105-013000-studio.db
      const match = /^\d{8}-\d{6}-(.+?)(?:-\d+)?\.(?:sqlite|db)$/.exec(name);
      return { file, name, db: match ? match[1] : 'unknown', bytes: stat.size, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
}

/** 每个库保留最新 keep 份；额外删除超过 days 天的文件。 */
function prune({ keep = 14, days = 30, now = Date.now() } = {}) {
  const groups = new Map();
  for (const row of list()) {
    if (!groups.has(row.db)) groups.set(row.db, []);
    groups.get(row.db).push(row);
  }
  const removed = [];
  for (const rows of groups.values()) {
    rows.forEach((row, index) => {
      const tooOld = now - row.mtime > Math.max(1, days) * DAY;
      if (index < Math.max(1, keep) && !tooOld) return;
      try {
        fs.rmSync(row.file, { force: true });
        removed.push(row.file);
      } catch (error) {
        processLog.line('backup-prune-failed', error);
      }
    });
  }
  return removed;
}

function lastAuto() {
  try {
    const row = db.open().prepare('SELECT value FROM meta WHERE key = ?').get(LAST_MARK);
    return Number(row && row.value) || 0;
  } catch {
    return 0;
  }
}

function markAuto(at) {
  try {
    db.open().prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)').run(LAST_MARK, String(at));
  } catch (error) {
    processLog.line('backup-mark-failed', error);
  }
}

/** 距上次自动备份不足 24 小时就跳过。 */
function maybeRun({ now = Date.now(), force = false, keep = 14, days = 30 } = {}) {
  if (!force && now - lastAuto() < DAY) return { skipped: true, files: [], removed: [] };
  try {
    const files = snapshot({ now });
    const removed = prune({ keep, days, now });
    markAuto(now);
    return { skipped: false, files, removed };
  } catch (error) {
    processLog.line('backup-failed', error);
    return { skipped: false, files: [], removed: [], error: error.message };
  }
}

function start() {
  if (timer) return;
  kickoff = setTimeout(() => { maybeRun(); }, 60 * 1000);
  kickoff.unref?.();
  timer = setInterval(() => { maybeRun(); }, 6 * 3600 * 1000);
  timer.unref?.();
}

function stop() {
  if (kickoff) clearTimeout(kickoff);
  if (timer) clearInterval(timer);
  kickoff = null;
  timer = null;
}

module.exports = { DB_NAMES, autoDir, snapshot, list, prune, maybeRun, lastAuto, start, stop };
