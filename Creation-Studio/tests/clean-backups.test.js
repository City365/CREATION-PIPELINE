'use strict';
/**
 * 旧备份清理脚本：保留 migration、最新 .db 和未到期限的备份。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

test('只删过期的 workspace/restore 和旧 .db', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-clean-backups-'));
  const backups = path.join(dir, 'backups');
  const write = (name, whenDaysAgo) => {
    const file = path.join(backups, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    if (whenDaysAgo) {
      const at = new Date(Date.now() - whenDaysAgo * 86400000);
      fs.utimesSync(file, at, at);
      fs.utimesSync(path.dirname(file), at, at);
    }
  };
  write('migration/snap.sqlite', 30);
  write('workspace-old/a.bin', 10);
  write('workspace-new/a.bin', 0);
  write('restore-old/a.bin', 10);
  write('studio-new.db', 0);
  write('studio-old.db', 10);

  const out = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'clean-backups.js'), '--apply', '--days', '7'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, WMD_DATA_DIR: dir },
  });
  assert.equal(out.status, 0, out.stderr);
  const exists = (name) => fs.existsSync(path.join(backups, name));

  assert.equal(exists('migration/snap.sqlite'), true);
  assert.equal(exists('workspace-new/a.bin'), true);
  assert.equal(exists('studio-new.db'), true);
  assert.equal(exists('workspace-old'), false);
  assert.equal(exists('restore-old'), false);
  assert.equal(exists('studio-old.db'), false);
  assert.ok(fs.readdirSync(backups).some((name) => name.startsWith('cleanup-manifest-')));

  fs.rmSync(dir, { recursive: true, force: true });
});
