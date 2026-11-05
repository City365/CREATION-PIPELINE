'use strict';
/**
 * Windows 数据目录加固：关闭继承，只给运行账号 / SYSTEM / Administrators 完全控制。
 *
 *   node scripts/harden-data-dir.js                  # 只打印命令，不改权限
 *   node scripts/harden-data-dir.js --apply          # 执行
 *   node scripts/harden-data-dir.js --apply --recursive  # 连同现有子文件一起改（目录大时较慢）
 *
 * 非 Windows 平台不做任何修改，只提示用 chmod/chown。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function dataDir() {
  return process.env.WMD_DATA_DIR
    ? path.resolve(process.env.WMD_DATA_DIR)
    : path.resolve(__dirname, '..', 'data');
}

function currentUser() {
  const domain = String(process.env.USERDOMAIN || '').trim();
  const name = String(process.env.USERNAME || os.userInfo().username || '').trim();
  return domain && name ? domain + '\\' + name : name;
}

function buildCommands({ dir = dataDir(), user = currentUser(), recursive = false } = {}) {
  if (process.platform !== 'win32') return [];
  const dirArgs = [dir, '/inheritance:r', '/grant:r', user + ':(OI)(CI)F', 'SYSTEM:(OI)(CI)F', 'BUILTIN\\Administrators:(OI)(CI)F'];
  if (recursive) dirArgs.push('/T', '/C');
  const out = [{ command: 'icacls', args: dirArgs }];
  for (const name of ['secret.key', 'internal-token.json', 'config.json']) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    out.push({ command: 'icacls', args: [file, '/inheritance:r', '/grant:r', user + ':F', 'SYSTEM:F', 'BUILTIN\\Administrators:F'] });
  }
  return out;
}

function format(row) {
  return [row.command].concat(row.args.map((item) => (/\s/.test(item) ? JSON.stringify(item) : item))).join(' ');
}

function main() {
  const apply = process.argv.includes('--apply');
  const recursive = process.argv.includes('--recursive');
  const dir = dataDir();
  if (!fs.existsSync(dir)) {
    console.error('数据目录不存在：' + dir);
    process.exitCode = 1;
    return;
  }
  if (process.platform !== 'win32') {
    console.log('当前不是 Windows：请用 chmod 700 "' + dir + '" 并确保 secret.key 只对运行账号可读。');
    return;
  }
  const commands = buildCommands({ dir, recursive });
  for (const row of commands) {
    const line = format(row);
    console.log((apply ? '' : '[dry-run] ') + line);
    if (!apply) continue;
    const result = spawnSync(row.command, row.args, { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) {
      console.error('失败：' + line);
      if (result.stderr) console.error(result.stderr.trim());
      process.exitCode = 1;
    }
  }
  if (!apply) console.log('未修改任何权限；确认无误后加 --apply。');
}

if (require.main === module) main();

module.exports = { buildCommands, currentUser, dataDir };
