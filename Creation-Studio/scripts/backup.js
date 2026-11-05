'use strict';
/**
 * 手工触发自动备份。默认快照 + 清理；--list 只看，不改。
 *
 *   node scripts/backup.js
 *   node scripts/backup.js --list
 *   node scripts/backup.js --keep 7 --days 14
 */
const backup = require('../src/backup');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return Number(process.argv[index + 1]);
  const prefixed = process.argv.find((item) => item.startsWith(name + '='));
  return prefixed ? Number(prefixed.slice(name.length + 1)) : fallback;
}

function main() {
  if (process.argv.includes('--list')) {
    console.log(JSON.stringify({ dir: backup.autoDir(), files: backup.list() }, null, 2));
    return;
  }
  const keep = argValue('--keep', 14);
  const days = argValue('--days', 30);
  const result = backup.maybeRun({ force: true, keep, days });
  console.log(JSON.stringify({
    dir: backup.autoDir(),
    files: result.files.map((file) => ({ name: file.name, bytes: file.bytes, target: file.target })),
    removed: result.removed,
    error: result.error || '',
  }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error('备份失败：' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
