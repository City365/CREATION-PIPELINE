'use strict';
// 生的图存哪：有项目就跟视频一样进 `<项目>/media/images/<日期>/`，
// 只有没有项目归属时才写设置里的「媒体库目录」。以前这里写死媒体库，
// 于是智能体/创作台出的图全跑进旧媒体库，项目媒体库里反而看不到。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-image-save-'));
process.env.WMD_DATA_DIR = DATA;
process.env.WMD_PROJECT_ROOT = path.join(DATA, 'projects');

const config = require('../src/config');
const projects = require('../src/projects');
const workspace = require('../src/workspace');
const imagegen = require('../src/imagegen');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const day = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

test('有项目时生图进项目 media/images，而不是设置里的媒体库目录', () => {
  const project = projects.create({ name: '生图归属测试' });
  const saved = imagegen.saveImages([{ buffer: PNG, mime: 'image/png' }], 'img-test', project.id);
  const media = path.join(workspace.pathsFor(project).media, 'images', day());
  assert.equal(path.dirname(saved.items[0].path), media, '应该落在 <项目>/media/images/<日期>');
  assert.ok(fs.existsSync(saved.items[0].path));
  assert.ok(!saved.items[0].path.startsWith(config.load().saveFolder), '不该再写到旧的媒体库目录');
  assert.equal(path.basename(saved.items[0].path), 'img-test-01.png');
  // 记的是项目相对路径 + rel 地址，换过项目根目录也不会断
  assert.equal(saved.items[0].rel, 'media/images/' + day() + '/img-test-01.png');
  assert.equal(saved.items[0].url, '/api/file?rel=' + encodeURIComponent(saved.items[0].rel) + '&projectId=' + encodeURIComponent(project.id));
});

test('没有项目归属时才回落到媒体库目录', () => {
  const saved = imagegen.saveImages([{ buffer: PNG, mime: 'image/png' }], 'img-legacy');
  assert.equal(path.dirname(saved.items[0].path), path.join(config.load().saveFolder, 'images', day()));
});

test('项目不存在时也走媒体库目录，不会抛错', () => {
  const saved = imagegen.saveImages([{ buffer: PNG, mime: 'image/png' }], 'img-missing', 'proj-not-exists');
  assert.equal(path.dirname(saved.items[0].path), path.join(config.load().saveFolder, 'images', day()));
});

test('图片任务把项目 id 带进落盘（image-tasks 调用处）', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/image-tasks.js'), 'utf8');
  assert.match(source, /\(options\.saveImages\|\|imagegen\.saveImages\)\(buffers,undefined,input\.projectId,\{targetPath:input\.targetPath\}\)/, '任务完成时要按项目落盘，并带上目标路径');
});
