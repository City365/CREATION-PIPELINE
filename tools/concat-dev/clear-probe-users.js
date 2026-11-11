'use strict';
// 临时小工具：把探测数据目录里的账号清掉，让整壳渲染出来（截图/自检用）。
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dir = process.argv[2] || path.resolve(__dirname, '..', '..', 'outputs', 'concat-validation', 'studio-dock-probe');
const target = process.argv[3] || 'all';

const files = target === 'all' ? ['studio.db', 'wmd.sqlite'] : [target];
for (const file of files) {
  const full = path.join(dir, file);
  let db;
  try { db = new DatabaseSync(full); } catch (error) { console.log(file, '跳过：', error.message); continue; }
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  if (!tables.includes('users')) { console.log(file, '没有 users 表（' + tables.slice(0, 6).join(',') + '）'); db.close(); continue; }
  const before = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (tables.includes('sessions')) db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM users');
  const after = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  console.log(file, 'users', before, '→', after);
  db.close();
}

