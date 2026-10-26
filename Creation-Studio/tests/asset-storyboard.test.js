'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-asset-storyboard-'));
process.env.H3_DATA_DIR = dir;
const library = require('../src/library');
const projects = require('../src/projects');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// workbench-store 会在数据目录打开 SQLite，Windows 下进程内无法删除，忽略清理失败。
test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ } });

test('分镜参考是文件夹：组内图片统一 storyboard，组外素材可设类型', () => {
  const project = projects.create({ name: '分镜测试' });
  const scene = library.saveAssetUpload(project.id, '场景.png', PNG, '', 'scene');
  assert.equal(scene.type, 'scene');
  assert.equal(scene.group, '');
  const group = library.createGroup(project.id, '镜头01');
  assert.equal(group, '镜头01');
  const ref1 = library.saveAssetUpload(project.id, 'ref1.png', PNG, '镜头01');
  const ref2 = library.saveAssetUpload(project.id, 'ref2.png', PNG, '镜头01');
  assert.equal(ref1.type, 'storyboard');
  assert.equal(ref1.group, '镜头01');

  const data = library.scanAssets(project.id);
  assert.equal(data.groups.length, 1);
  assert.equal(data.groups[0].name, '镜头01');
  assert.equal(data.groups[0].count, 2);
  assert.equal(data.items.find((item) => item.name === 'ref1.png').type, 'storyboard');
  assert.equal(data.items.find((item) => item.name === '场景.png').type, 'scene');

  assert.throws(() => library.setType(project.id, ref1.rel, 'scene'), /分镜文件夹里的图片固定/);
  assert.throws(() => library.setType(project.id, scene.rel, 'storyboard'), /分镜参考请通过新建分镜文件夹/);

  const movedIn = library.moveAsset(project.id, scene.rel, '镜头01');
  assert.equal(movedIn.group, '镜头01');
  assert.equal(movedIn.type, 'storyboard');
  assert.equal(library.scanAssets(project.id).groups[0].count, 3);

  const movedOut = library.moveAsset(project.id, movedIn.rel, '');
  assert.equal(movedOut.group, '');
  assert.notEqual(movedOut.type, 'storyboard');
  const after = library.scanAssets(project.id);
  assert.equal(after.groups[0].count, 2);
  assert.equal(after.items.find((item) => item.name === '场景.png').group, '');
});
