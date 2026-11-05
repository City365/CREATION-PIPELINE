'use strict';
// 素材归档/改名后，聊天里写死的旧图片链接不能变成死链：/api/file 找不到原路径时查别名表。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-file-alias-'));
process.env.WMD_DATA_DIR = DATA;

const aliases = require('../src/file-aliases');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('记一条旧路径 → 新路径，旧路径就能解析到新文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-move-'));
  const oldFile = path.join(dir, 'old.png');
  const newFile = path.join(dir, 'new.png');
  fs.writeFileSync(newFile, PNG);
  assert.equal(aliases.record(oldFile, newFile), true);
  assert.equal(aliases.resolve(oldFile), newFile);
});

test('新文件不存在时解析失败，不会返回假路径', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-move-'));
  const oldFile = path.join(dir, 'gone.png');
  const newFile = path.join(dir, 'missing.png');
  aliases.record(oldFile, newFile);
  assert.equal(aliases.resolve(oldFile), '');
});

test('大小写和斜杠不同也能命中', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-move-'));
  const newFile = path.join(dir, 'Case.png');
  fs.writeFileSync(newFile, PNG);
  aliases.record(path.join(dir, 'Case.PNG'), newFile);
  assert.equal(aliases.resolve(path.join(dir, 'case.png')), newFile);
});

test('批量记录与去重', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-move-'));
  const a = path.join(dir, 'a.png');
  const b = path.join(dir, 'b.png');
  fs.writeFileSync(a, PNG);
  fs.writeFileSync(b, PNG);
  assert.equal(aliases.recordMany([[path.join(dir, 'x.png'), a], [path.join(dir, 'y.png'), b]]), 2);
  assert.equal(aliases.resolve(path.join(dir, 'x.png')), a);
  assert.equal(aliases.resolve(path.join(dir, 'y.png')), b);
  assert.equal(aliases.resolve(path.join(dir, 'never.png')), '');
});

test('素材被整理进 <集名> 子目录后，按文件名找回并自动记别名', () => {
  const projects = require('../src/projects');
  const workspace = require('../src/workspace');
  const project = projects.create({ name: '找回测试' });
  const root = path.join(workspace.dirFor(project), 'assets', '素材', '人物');
  const moved = path.join(root, '第1集-错过，也是彼此成全', '林清栀-三视图.png');
  fs.mkdirSync(path.dirname(moved), { recursive: true });
  fs.writeFileSync(moved, PNG);
  const legacy = path.join(root, '林清栀-三视图.png');
  assert.equal(aliases.resolve(legacy), '', '别名表里还没有');
  assert.equal(aliases.recover(legacy), moved, '按同名文件找回');
  assert.equal(aliases.resolve(legacy), moved, '找回时顺手记住，下次直接命中');
});

test('同名的文件有多个时不瞎猜', () => {
  const projects = require('../src/projects');
  const workspace = require('../src/workspace');
  const project = projects.create({ name: '重名不猜测试' });
  const root = path.join(workspace.dirFor(project), 'assets', '素材', '场景');
  for (const folder of ['第1集-a', '第2集-b']) {
    const file = path.join(root, folder, '校园人工湖畔.png');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, PNG);
  }
  const legacy = path.join(root, '湖.png', '校园人工湖畔.png');
  assert.equal(aliases.recover(legacy), '', '两个同名文件、父目录也对不上，就不猜');
});

test('/api/file 找不到文件时会回落别名表，改了名的素材照样能打开', () => {
  const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
  assert.match(server, /const fileAliases = require\('\.\/file-aliases'\)/, '服务要加载别名表');
  assert.match(server, /const moved = fileAliases\.resolve\(requested\);/, '/api/file 命中不到再查别名');
  assert.match(server, /fileAliases\.recover\(requested\)/, '再找不到就按文件名在项目里找回');
  assert.match(server, /return bad\(res, '文件已移动或删除：' \+ requested, 404\)/, '真的没有时返回明确的 404 文案');
  const layout = fs.readFileSync(path.join(__dirname, '../src/asset-layout.js'), 'utf8');
  assert.match(layout, /require\('\.\/file-aliases'\)\.record\(abs, target\)/, '素材改名也要记别名');
});
