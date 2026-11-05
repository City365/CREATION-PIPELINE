'use strict';
/**
 * 每用户界面偏好：覆盖平台默认值、互不影响、删除用户时清理。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-user-prefs-'));
process.env.WMD_DATA_DIR = path.join(dir, 'data');

const db = require('../src/db');
const prefs = require('../src/user-prefs');

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('用户偏好覆盖平台默认值，键互不影响', () => {
  assert.deepEqual(prefs.view({ theme: 'day-sea', volume: 60 }, 'user-a'), { theme: 'day-sea', volume: 60 });
  prefs.save('user-a', { theme: 'night', volume: 30 });
  prefs.save('user-b', { theme: 'paper' });
  assert.deepEqual(prefs.view({ theme: 'day-sea', volume: 60 }, 'user-a'), { theme: 'night', volume: 30 });
  assert.deepEqual(prefs.view({ theme: 'day-sea', volume: 60 }, 'user-b'), { theme: 'paper', volume: 60 });
  assert.deepEqual(prefs.view({ theme: 'day-sea' }, 'user-c'), { theme: 'day-sea' });
});

test('偏好合并写入、拒绝原型键、可删除', () => {
  prefs.save('user-merge', { theme: 'a', wallpaperPaused: true });
  prefs.save('user-merge', { wallpaperPaused: false, agentFontSize: 16 });
  assert.deepEqual(prefs.get('user-merge'), { theme: 'a', wallpaperPaused: false, agentFontSize: 16 });
  prefs.save('user-merge', { __proto__: { hacked: true }, constructor: 'x', theme: 'b' });
  const value = prefs.get('user-merge');
  assert.equal(value.theme, 'b');
  assert.equal(value.hacked, undefined);
  assert.equal(Object.prototype.hacked, undefined);
  assert.equal(prefs.remove('user-merge'), true);
  assert.deepEqual(prefs.get('user-merge'), {});
});

test('偏好落 SQLite，重开连接后仍在', () => {
  prefs.save('user-persist', { theme: 'persist' });
  db.close();
  assert.deepEqual(prefs.get('user-persist'), { theme: 'persist' });
});
