'use strict';
/**
 * 数据目录加固脚本：只生成命令，不自动改权限；非 Windows 给出 chmod 提示。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const { buildCommands } = require('../scripts/harden-data-dir');

test('命令包含目录、密钥文件与当前用户', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-harden-'));
  fs.writeFileSync(path.join(dir, 'secret.key'), 'x');
  try {
    const rows = buildCommands({ dir, user: 'TEST\\user', recursive: true });
    if (process.platform !== 'win32') {
      assert.deepEqual(rows, []);
      return;
    }
    assert.ok(rows.length >= 2);
    assert.equal(rows[0].command, 'icacls');
    assert.ok(rows[0].args.includes('/inheritance:r'));
    assert.ok(rows[0].args.includes('TEST\\user:(OI)(CI)F'));
    assert.ok(rows[0].args.includes('/T'));
    assert.ok(rows.some((row) => row.args[0].endsWith('secret.key')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('默认 dry-run，不执行 icacls', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-harden-run-'));
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/harden-data-dir.js')], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, WMD_DATA_DIR: dir },
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    if (process.platform === 'win32') {
      assert.match(result.stdout, /\[dry-run\] icacls/);
      assert.match(result.stdout, /未修改任何权限/);
    } else {
      assert.match(result.stdout, /不是 Windows|chmod/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
