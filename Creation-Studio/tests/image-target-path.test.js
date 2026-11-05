'use strict';
// 生图路径参数（targetPath）：
//   项目资产图 → 传固定相对路径，图就固定落在 assets/素材/... ，同名覆盖但旧图留档；
//   聊天随手出图 → 不传，走 <项目>/media/images/<日期>/，不进素材库、不覆盖资产。
// 传绝对路径、带 .. 或越界一律拒绝，不落盘。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-target-'));
process.env.WMD_DATA_DIR = DATA;
process.env.WMD_PROJECT_ROOT = path.join(DATA, 'projects');

const projects = require('../src/projects');
const workspace = require('../src/workspace');
const imagegen = require('../src/imagegen');
const projectPaths = require('../src/project-paths');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('传了 targetPath 就固定落在素材库的相对路径上', () => {
  const project = projects.create({ name: '资产落点测试' });
  const rel = 'assets/素材/人物/第1集-错过，也是彼此成全/林清栀-三视图.png';
  const saved = imagegen.saveImages([{ buffer: PNG, mime: 'image/png' }], 'img-asset', project.id, { targetPath: rel });
  const expected = path.join(workspace.dirFor(project), 'assets', '素材', '人物', '第1集-错过，也是彼此成全', '林清栀-三视图.png');
  assert.equal(saved.items[0].path, expected);
  assert.equal(saved.items[0].rel, rel);
  assert.equal(saved.target, true);
  assert.ok(fs.existsSync(expected));
  assert.equal(saved.items[0].url, '/api/file?rel=' + encodeURIComponent(rel) + '&projectId=' + encodeURIComponent(project.id));
  assert.equal(projectPaths.abs(project.id, saved.items[0].rel), expected, 'rel 能反算出同一个文件');
});

test('同名资产重新生成：路径不变，旧图留档到 assets/.版本/，不留一堆文件名', () => {
  const project = projects.create({ name: '覆盖留档测试' });
  const rel = 'assets/素材/场景/第2集-慢下来，不是落后/大学图书馆通宵自习室.png';
  const first = imagegen.saveImages([{ buffer: PNG, mime: 'image/png' }], 'img-1', project.id, { targetPath: rel });
  const oldBytes = Buffer.from(PNG);
  const second = imagegen.saveImages([{ buffer: Buffer.concat([PNG, Buffer.from('v2')]), mime: 'image/png' }], 'img-2', project.id, { targetPath: rel });
  assert.equal(first.items[0].path, second.items[0].path, '固定路径不换名');
  assert.equal(second.items[0].replaced, true);
  assert.ok(second.items[0].backup && fs.existsSync(second.items[0].backup), '旧图要留档');
  assert.deepEqual(fs.readFileSync(second.items[0].backup), oldBytes);
  assert.ok(second.items[0].backup.includes(path.join('assets', '.版本')), '留档放在 assets/.版本/');
  const dir = path.dirname(second.items[0].path);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['大学图书馆通宵自习室.png'], '目录里只有一张正稿');
});

test('绝对路径 / 带 .. / 非图片扩展名：直接拒绝，不写文件', () => {
  const project = projects.create({ name: '非法路径测试' });
  const dir = path.join(workspace.dirFor(project), 'assets');
  for (const bad of [path.join(dir, 'a.png'), 'D:/tmp/a.png', '../a.png', 'assets/../../a.png']) {
    assert.throws(() => imagegen.saveImages([{ buffer: PNG, mime: 'image/png' }], 'img-bad', project.id, { targetPath: bad }), /相对路径/);
  }
  assert.throws(() => imagegen.saveImages([{ buffer: PNG, mime: 'image/png' }], 'img-bad', project.id, { targetPath: 'assets/素材/x.txt' }), /图片文件名/);
  assert.ok(!fs.existsSync(path.join(dir, 'a.png')));
});

test('不传 targetPath：聊天/测试图走 media/images，不进素材库', () => {
  const project = projects.create({ name: '默认落点测试' });
  const saved = imagegen.saveImages([{ buffer: PNG, mime: 'image/png' }], 'img-chat', project.id);
  assert.match(saved.items[0].rel, /^media\/images\/\d{4}-\d{2}-\d{2}\/img-chat-01\.png$/);
  assert.ok(!saved.items[0].rel.startsWith('assets/'), '默认图不能进素材库');
  assert.equal(saved.target, undefined);
});

test('多张图落到同一个 targetPath：第一张用正名，其余加 -2、-3', () => {
  const project = projects.create({ name: '多张落点测试' });
  const rel = 'assets/素材/道具/第1集-错过，也是彼此成全/借书票与黄铜比例尺.png';
  const saved = imagegen.saveImages([{ buffer: PNG, mime: 'image/png' }, { buffer: Buffer.concat([PNG, Buffer.from('b')]), mime: 'image/png' }], 'img-multi', project.id, { targetPath: rel });
  assert.deepEqual(saved.items.map((item) => item.rel), [
    rel,
    'assets/素材/道具/第1集-错过，也是彼此成全/借书票与黄铜比例尺-2.png',
  ]);
});
