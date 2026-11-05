'use strict';
/**
 * 自动备份：三库快照、保留策略、24 小时节流。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-backup-'));
const dataDir = path.join(dir, 'data');
process.env.WMD_DATA_DIR = dataDir;
fs.mkdirSync(dataDir, { recursive: true });

const backup = require('../src/backup');
const db = require('../src/db');

test.after(() => {
  backup.stop();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeDb(name) {
  const file = path.join(dataDir, name);
  const conn = new DatabaseSync(file);
  conn.exec('CREATE TABLE IF NOT EXISTS t(x INTEGER)');
  conn.prepare('INSERT INTO t(x) VALUES (?)').run(1);
  conn.close();
}

test('三个库都能生成可打开的快照', () => {
  for (const name of backup.DB_NAMES) makeDb(name);
  const files = backup.snapshot();
  assert.equal(files.length, 3);
  for (const file of files) {
    assert.ok(fs.existsSync(file.target));
    const conn = new DatabaseSync(file.target);
    try {
      assert.equal(conn.prepare('SELECT COUNT(*) AS n FROM t').get().n, 1);
    } finally { conn.close(); }
  }
  assert.equal(backup.list().length, 3);
  // 同一秒再来一次，studio.db 也要能加序号
  assert.equal(backup.snapshot().length, 3);
  assert.equal(backup.list().length, 6);
});

test('保留策略只清理 auto 目录，不碰 migration', () => {
  const auto = backup.autoDir();
  for (const name of fs.readdirSync(auto)) fs.rmSync(path.join(auto, name), { force: true });
  const now = Date.now();
  const rows = [
    ['20260101-000000-wmd.sqlite', 40],
    ['20260102-000000-wmd.sqlite', 35],
    ['20260103-000000-wmd.sqlite', 1],
    ['20260104-000000-wmd.sqlite', 0],
    ['20260105-000000-wmd.sqlite', 10],
  ];
  for (const [name, ageDays] of rows) {
    const file = path.join(auto, name);
    fs.writeFileSync(file, 'x');
    const time = new Date(now - ageDays * 24 * 3600 * 1000);
    fs.utimesSync(file, time, time);
  }
  const migration = path.join(dataDir, 'backups', 'migration');
  fs.mkdirSync(migration, { recursive: true });
  fs.writeFileSync(path.join(migration, 'keep.sqlite'), 'keep');

  const removed = backup.prune({ keep: 2, days: 30, now });
  assert.equal(removed.length, 3);
  const left = fs.readdirSync(auto).sort();
  assert.deepEqual(left, ['20260103-000000-wmd.sqlite', '20260104-000000-wmd.sqlite']);
  assert.ok(fs.existsSync(path.join(migration, 'keep.sqlite')), '迁移快照不能被删除');
});

test('24 小时内跳过，force 可强制执行', () => {
  const first = backup.maybeRun({ force: true, keep: 2, days: 30 });
  assert.equal(first.skipped, false);
  assert.equal(first.files.length, 3);
  const second = backup.maybeRun({});
  assert.equal(second.skipped, true);
  const forced = backup.maybeRun({ force: true, keep: 2, days: 30 });
  assert.equal(forced.skipped, false);
});

test('定时器可以启动和停止', () => {
  backup.start();
  backup.stop();
  assert.ok(true);
});
