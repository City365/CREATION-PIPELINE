'use strict';
/**
 * 清理 data/backups 里的旧工作区/恢复备份，保留：
 *   - migration/（数据库迁移快照）
 *   - 最新的 .db 备份
 *   - 未超过 --days 天（默认 7）的备份
 *
 *   node scripts/clean-backups.js                 # 预览
 *   node scripts/clean-backups.js --apply         # 删除并写 manifest
 *   node scripts/clean-backups.js --apply --days 30
 */
const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg > 0 ? Math.max(0, Number(process.argv[daysArg + 1]) || 0) : 7;
const DATA = path.resolve(process.env.WMD_DATA_DIR || path.join(__dirname, '..', 'data'));
const BACKUPS = path.join(DATA, 'backups');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');

const manifest = { backups: BACKUPS, apply: APPLY, olderThanDays: DAYS, at: new Date().toISOString(), deleted: [], kept: [], errors: [] };

function ageDays(file) {
  try { return (Date.now() - fs.statSync(file).mtimeMs) / 86400000; } catch { return 0; }
}

function sizeOf(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const entry of fs.readdirSync(file, { withFileTypes: true })) total += sizeOf(path.join(file, entry.name));
    return total;
  } catch { return 0; }
}

function filesUnder(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else out.push({ path: path.relative(BACKUPS, file), bytes: sizeOf(file) });
    }
  };
  walk(dir);
  return out;
}

function run() {
  if (!fs.existsSync(BACKUPS)) throw new Error('备份目录不存在：' + BACKUPS);
  const entries = fs.readdirSync(BACKUPS, { withFileTypes: true });
  const dbs = entries
    .filter((entry) => entry.isFile() && /\.db$/i.test(entry.name))
    .map((entry) => ({ name: entry.name, at: fs.statSync(path.join(BACKUPS, entry.name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  const newestDb = dbs[0] ? dbs[0].name : '';

  for (const entry of entries) {
    const name = entry.name;
    if (name === 'migration') { manifest.kept.push(name + '/（迁移快照）'); continue; }
    if (entry.isFile() && name === newestDb) { manifest.kept.push(name + '（最新数据库备份）'); continue; }
    const full = path.join(BACKUPS, name);
    const old = ageDays(full) >= DAYS;
    const isWorkspace = entry.isDirectory() && /^(workspace|restore)-/.test(name);
    const isOldDb = entry.isFile() && /\.db$/i.test(name) && old;
    if (!isWorkspace && !isOldDb) { manifest.kept.push(name + '（未到期限或不在清理范围）'); continue; }
    if (!old) { manifest.kept.push(name + '（' + ageDays(full).toFixed(1) + ' 天，未到期限）'); continue; }
    const item = { name, bytes: sizeOf(full), ageDays: Number(ageDays(full).toFixed(1)), files: entry.isDirectory() ? filesUnder(full) : null };
    manifest.deleted.push(item);
    if (APPLY) {
      try {
        fs.rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (error) {
        manifest.errors.push({ name, error: error.message });
      }
    }
  }

  if (APPLY) {
    const file = path.join(BACKUPS, 'cleanup-manifest-' + stamp + '.json');
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    console.log('已删除 ' + manifest.deleted.length + ' 项，清单：' + path.relative(process.cwd(), file));
  } else {
    console.log('预览（加 --apply 才会删除）：');
  }
  for (const item of manifest.deleted) {
    console.log((APPLY ? '  deleted ' : '  would   ') + item.name + '  (' + item.bytes + ' B, ' + item.ageDays + ' 天)');
  }
  for (const item of manifest.kept) console.log('  keep    ' + item);
  for (const item of manifest.errors) console.log('  error   ' + item.name + ': ' + item.error);
}

try {
  run();
} catch (error) {
  console.error('清理失败：' + error.message);
  process.exitCode = 1;
}
