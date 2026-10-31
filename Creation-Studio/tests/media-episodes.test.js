'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-media-episodes-'));
process.env.WMD_DATA_DIR = dir;
const episodes = require('../src/media-episodes');

test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ } });

test('新建分集会按顺序编号，重名直接拒绝', () => {
  const first = episodes.create('proj-a', {});
  assert.equal(first.name, '第1集');
  assert.equal(first.number, 1);
  const second = episodes.create('proj-a', {});
  assert.equal(second.name, '第2集');
  assert.throws(() => episodes.create('proj-a', { name: '第1集' }), /已经有一集/);
});

test('归入 / 移出 / 计数', () => {
  const episode = episodes.create('proj-b', { name: '第1集' });
  episodes.assign('proj-b', episode.id, ['d1/j1/a.mp4', 'd1/j1/b.mp4']);
  let data = episodes.list('proj-b');
  assert.equal(data.episodes[0].count, 2);
  assert.equal(data.assignments['d1/j1/a.mp4'], episode.id);
  episodes.assign('proj-b', '', ['d1/j1/b.mp4']);
  data = episodes.list('proj-b');
  assert.equal(data.episodes[0].count, 1);
  assert.equal(data.assignments['d1/j1/b.mp4'], undefined);
});

test('不同项目互不影响', () => {
  const a = episodes.create('proj-c', { name: '第1集' });
  episodes.assign('proj-c', a.id, ['x.mp4']);
  const other = episodes.list('proj-d');
  assert.equal(other.episodes.length, 0);
  assert.deepEqual(other.assignments, {});
});

test('重命名会跟着改名里的集数走', () => {
  const episode = episodes.create('proj-e', { name: '第1集' });
  const renamed = episodes.rename('proj-e', episode.id, '第3集');
  assert.equal(renamed.name, '第3集');
  assert.equal(renamed.number, 3);
  assert.throws(() => episodes.rename('proj-e', episode.id, '  '), /不能为空/);
});

test('删除分集只清归属，不动别的集', () => {
  const one = episodes.create('proj-f', { name: '第1集' });
  const two = episodes.create('proj-f', { name: '第2集' });
  episodes.assign('proj-f', one.id, ['a.mp4']);
  episodes.assign('proj-f', two.id, ['b.mp4']);
  const result = episodes.remove('proj-f', one.id);
  assert.equal(result.cleared, 1);
  const data = episodes.list('proj-f');
  assert.equal(data.episodes.length, 1);
  assert.equal(data.assignments['a.mp4'], undefined);
  assert.equal(data.assignments['b.mp4'], two.id);
});

test('成片改名后归属跟着迁移', () => {
  const episode = episodes.create('proj-g', { name: '第1集' });
  episodes.assign('proj-g', episode.id, ['2026-10-26/job-1/旧名.mp4']);
  const moved = episodes.remap('proj-g', [{ from: '2026-10-26/job-1/旧名.mp4', to: '2026-10-26/job-1/镜头 01.mp4' }]);
  assert.equal(moved, 1);
  const data = episodes.list('proj-g');
  assert.equal(data.assignments['2026-10-26/job-1/镜头 01.mp4'], episode.id);
  assert.equal(data.assignments['2026-10-26/job-1/旧名.mp4'], undefined);
});
