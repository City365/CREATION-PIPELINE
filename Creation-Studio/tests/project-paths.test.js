'use strict';
// 路径规范：项目里的东西只记「相对项目根目录」的路径。
// 项目根目录是用户自己设的、可变的，绝对路径一换就全断；相对路径只认项目目录这一层。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-paths-'));
process.env.WMD_DATA_DIR = DATA;
process.env.WMD_PROJECT_ROOT = path.join(DATA, 'projects');

const config = require('../src/config');
const projects = require('../src/projects');
const workspace = require('../src/workspace');
const projectPaths = require('../src/project-paths');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('合法相对路径：统一分隔符、去掉开头 ./、压缩重复斜杠', () => {
  assert.equal(projectPaths.normalize('.\\assets\\素材/人物\\a.png'), 'assets/素材/人物/a.png');
  assert.equal(projectPaths.normalize('assets//素材///a.png'), 'assets/素材/a.png');
  assert.equal(projectPaths.normalize('/media/images/a.png'), '/media/images/a.png', '开头的斜杠保留，好让绝对路径被拒绝');
  assert.equal(projectPaths.isSafe('assets/素材/人物/a.png'), true);
  assert.equal(projectPaths.isSafe('media/images/a.png'), true);
});

test('非法路径一律拒绝：绝对路径、盘符、..、空段', () => {
  for (const bad of ['', '/etc/passwd', 'C:\\Windows\\a.png', 'D:/x/a.png', 'assets/../../escape.png', 'assets/./a.png', '..']) {
    assert.equal(projectPaths.isSafe(bad), false, '应该拒绝：' + bad);
    assert.throws(() => projectPaths.assertRel(bad), /相对路径/, '应该抛错：' + bad);
  }
});

test('相对路径在项目目录里解析，越界拒绝', () => {
  const project = projects.create({ name: '路径规范测试' });
  const dir = workspace.dirFor(project);
  const abs = projectPaths.abs(project.id, 'assets/素材/人物/第1集/a.png');
  assert.equal(abs, path.join(path.resolve(dir), 'assets', '素材', '人物', '第1集', 'a.png'));
  assert.equal(projectPaths.relOf(project.id, abs), 'assets/素材/人物/第1集/a.png');
  assert.equal(projectPaths.relOf(project.id, path.join(DATA, 'outside.png')), '', '项目外文件没有 rel');
  assert.throws(() => projectPaths.abs(project.id, '../outside.png'), /相对路径/);
  assert.throws(() => projectPaths.abs('', 'assets/a.png'), /需要先选择项目/);
});

test('规范地址是 /api/file?rel=…&projectId=…，跟着根目录走', () => {
  const project = projects.create({ name: '地址规范测试' });
  const url = projectPaths.fileUrl(project.id, 'assets/素材/人物/第1集/a b.png');
  assert.equal(url, '/api/file?rel=' + encodeURIComponent('assets/素材/人物/第1集/a b.png') + '&projectId=' + encodeURIComponent(project.id));
  assert.ok(projectPaths.isProjectUrl(url));
  assert.ok(!projectPaths.isProjectUrl('/api/file?path=D%3A%5Cx.png'));
});

test('attach 给记录补 rel，并把老式 ?path= 地址改写成 rel 地址', () => {
  const project = projects.create({ name: 'attach 测试' });
  const file = path.join(workspace.pathsFor(project).media, 'images', '2026-01-01', 'x.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG);
  const item = projectPaths.attach(project.id, { path: file, url: '/api/file?path=' + encodeURIComponent(file) });
  assert.equal(item.rel, 'media/images/2026-01-01/x.png');
  assert.match(item.url, /^\/api\/file\?rel=/);
  const asset = projectPaths.attach(project.id, { path: file, url: '/api/assets/file?rel=' + encodeURIComponent('素材/x.png') });
  assert.equal(asset.rel, 'media/images/2026-01-01/x.png');
  assert.match(asset.url, /^\/api\/assets\/file\?rel=/, '素材库自己的地址不要被改写');
});

test('heal：项目整体换到新根目录后，按 rel 仍能找到文件', () => {
  const project = projects.create({ name: '搬家自愈测试' });
  const oldRoot = path.join(DATA, 'projects');
  const file = path.join(workspace.pathsFor(project).media, 'images', '2026-01-02', 'y.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG);
  const record = projectPaths.attach(project.id, { path: file });

  // 用户把项目根目录换到另一个盘/另一个目录，并把项目文件夹整体搬过去
  const nextRoot = path.join(DATA, 'moved-projects');
  fs.mkdirSync(nextRoot, { recursive: true });
  const folder = path.basename(workspace.dirFor(project));
  fs.renameSync(path.join(oldRoot, folder), path.join(nextRoot, folder));
  config.save({ projectRoot: nextRoot });

  assert.ok(!fs.existsSync(record.path), '旧绝对路径已经失效');
  projectPaths.heal(project.id, record);
  const expected = path.join(nextRoot, folder, 'media', 'images', '2026-01-02', 'y.png');
  assert.equal(record.path, expected, '按 rel 现算出新位置');
  assert.ok(fs.existsSync(record.path));
  config.save({ projectRoot: oldRoot });
});

test('heal：老数据没 rel，只有旧根目录的绝对路径，也能按项目目录名重挂', () => {
  const project = projects.create({ name: '老数据自愈测试' });
  const folder = path.basename(workspace.dirFor(project));
  const current = path.join(workspace.dirFor(project), 'assets', '素材', '人物', 'z.png');
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.writeFileSync(current, PNG);
  const legacy = path.join(DATA, 'old-root-2025', folder, 'assets', '素材', '人物', 'z.png');
  const record = { path: legacy };
  projectPaths.heal(project.id, record);
  assert.equal(record.path, path.resolve(current));
  assert.equal(record.rel, 'assets/素材/人物/z.png');
});

test('rebaseAny 不认识项目 id 时也能按目录名找回', () => {
  const project = projects.create({ name: '任意项目自愈' });
  const folder = path.basename(workspace.dirFor(project));
  const current = path.join(workspace.dirFor(project), 'media', 'images', '2026-01-03', 'w.png');
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.writeFileSync(current, PNG);
  const legacy = path.join('E:', 'whatever', folder, 'media', 'images', '2026-01-03', 'w.png');
  assert.equal(projectPaths.rebaseAny(legacy), path.resolve(current));
  assert.equal(projectPaths.rebaseAny(path.join(DATA, 'no-such-project', 'a.png')), '');
});
