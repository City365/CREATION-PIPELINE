'use strict';
/**
 * 调试产物清理脚本：只移动白名单，不碰数据。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

test('只移动调试产物，保留数据与迁移存档', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-clean-debug-'));
  const write = (name, body = 'x') => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    return file;
  };
  write('shot.png');
  write('run.log');
  write('_patch.js');
  write('p0-topbar.json', '{}');
  write('scene-a-evidence.json', '{}');
  write('backups-config-1.json', '{"channels":{"llm":[{"apiKey":"sk-old"}]}}');
  write('config.json.bak-1', '{"channels":[]}');
  write('jobs.json.bak-1', '{"jobs":[]}');
  write('wmd.before-x.sqlite', 'db');
  write('script-chats.json', '[]');
  write('agent-timeout-diagnostic/a.txt');
  write('media/keep.png');
  write('scene-view-prompts/cache.json', '{}');
  write('config.json', '{}');
  write('secret.key', 'k');
  write('workspace-migration.json', '{}');
  write('styles.json', '[]');
  write('users.imported.json', '[]');

  const out = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'clean-debug.js'), '--apply'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, WMD_DATA_DIR: dir },
  });
  assert.equal(out.status, 0, out.stderr);
  const exists = (name) => fs.existsSync(path.join(dir, name));

  assert.equal(exists('debug/screenshots/shot.png'), true);
  assert.equal(exists('debug/logs/run.log'), true);
  assert.equal(exists('debug/debug-scripts/_patch.js'), true);
  assert.equal(exists('debug/evidence/p0-topbar.json'), true);
  assert.equal(exists('debug/evidence/scene-a-evidence.json'), true);
  assert.equal(exists('debug/config-backups/backups-config-1.json'), true);
  assert.equal(exists('debug/config-backups/config.json.bak-1'), true);
  assert.equal(exists('debug/migration-copies/jobs.json.bak-1'), true);
  assert.equal(exists('backups/migration/wmd.before-x.sqlite'), true);
  assert.equal(exists('debug/legacy-data/script-chats.json'), true);
  assert.equal(exists('debug/dirs/agent-timeout-diagnostic/a.txt'), true);
  assert.ok(fs.readdirSync(path.join(dir, 'debug')).some((name) => name.startsWith('cleanup-manifest-')));

  // 数据与正在使用的文件留在原位
  assert.equal(exists('config.json'), true);
  assert.equal(exists('secret.key'), true);
  assert.equal(exists('workspace-migration.json'), true);
  assert.equal(exists('styles.json'), true);
  assert.equal(exists('users.imported.json'), true);
  assert.equal(exists('media/keep.png'), true);
  assert.equal(exists('scene-view-prompts/cache.json'), true);
  assert.equal(exists('shot.png'), false);
  assert.equal(exists('run.log'), false);

  fs.rmSync(dir, { recursive: true, force: true });
});
