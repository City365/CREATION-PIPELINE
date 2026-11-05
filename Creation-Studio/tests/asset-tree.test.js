'use strict';
// 素材库左侧改成可展开的目录树：点一层读一层（不再一次扫描整棵树），
// 遇到文件夹继续展开，点目录时右侧只列这一层的文件。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-asset-tree-'));
process.env.WMD_DATA_DIR = DATA;
process.env.WMD_PROJECT_ROOT = path.join(DATA, 'projects');

const assetLayout = require('../src/asset-layout');
const projects = require('../src/projects');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function setup() {
  const project = projects.create({ name: '素材树测试' });
  const root = assetLayout.rootFor(project.id);
  const write = (rel) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, PNG);
  };
  write('素材/人物/第1集-测试剧/甲-三视图.png');
  write('素材/人物/第1集-测试剧/乙-三视图.png');
  write('素材/人物/第2集-测试剧/丙-三视图.png');
  write('素材/人物/散图.png');
  write('素材/场景/第1集-测试剧/美术馆.png');
  fs.writeFileSync(path.join(root, '素材/人物/第1集-测试剧/说明.txt'), 'not media');
  return { project, root };
}

test('单层目录：给出子文件夹（带递归文件数）和这一层的文件', () => {
  const { project } = setup();
  const dir = assetLayout.scanDir(project.id, '素材/人物');
  const names = dir.dirs.map((row) => row.name);
  assert.deepEqual(names, ['第1集-测试剧', '第2集-测试剧'], '子目录按名字排序');
  assert.equal(dir.dirs[0].total, 2, '第一集目录下有 2 张图（说明.txt 不算）');
  assert.deepEqual(dir.files.map((row) => row.name), ['散图.png'], '这一层只列自己的文件');
  assert.equal(dir.total, 4, '自带 1 张 + 第1集 2 张 + 第2集 1 张');

  const sub = assetLayout.scanDir(project.id, '素材/人物/第1集-测试剧');
  assert.equal(sub.files.length, 2);
  assert.equal(sub.dirs.length, 0);
  assert.match(sub.files[0].url, /^\/api\/assets\/file\?rel=/);
});

test('分类总数按递归算，不再只数扁平那一层', () => {
  const { project } = setup();
  const totals = assetLayout.materialTotals(project.id);
  assert.equal(totals.character, 4, '人物：第1集 2 + 第2集 1 + 散图 1');
  assert.equal(totals.scene, 1);
  assert.equal(totals.prop, 0);
  const scan = assetLayout.scan(project.id);
  assert.deepEqual(scan.totals, totals, '素材库总览也要带递归数量');
});

test('目录越界或不存在时直接报错，不会去读别的目录', () => {
  const { project } = setup();
  assert.throws(() => assetLayout.scanDir(project.id, '../..'), /不在素材库/);
  assert.throws(() => assetLayout.scanDir(project.id, '素材/人物/不存在的剧'), /目录不存在/);
});

test('前端：目录树按层加载，并且不会 render→load 互相触发死循环', () => {
  const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
  assert.match(source, /data-lib-dir-depth=/, '分类/项目两层要标出层级');
  assert.match(source, /function loadAssetDir\(rel, deep = false\)/, '缺失目录要按需加载，分类可以深读');
  assert.match(source, /if \(cached && cached\.promise\) return cached\.promise;/, '在途请求要复用同一个 promise');
  assert.match(source, /function ensureAssetLibrary\(\)/, '总览只允许一个在途请求');
  assert.match(source, /if \(state\.assetLibrary \|\| state\.assetLibraryLoading\) return;/, '已有请求时不要再发');
  assert.match(source, /function renderDirView\(view\)/, '右侧按目录渲染');
  assert.ok(!source.includes('bootView'), '进素材库不能自动去读目录：只有用户点开才读');
  assert.match(source, /function renderAssetOverview\(data\)/, '默认给总览，不预读任何子目录');
  const css = fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8');
  assert.match(css, /\.lib-dir-row\{display:flex;align-items:center;gap:6px;width:100%/, '整行是一个可点按钮');
  assert.match(css, /\.lib-dir-row \.lib-count\{flex:none;margin-left:auto/, '数量靠右，箭头跟在名称后面');
  assert.ok(!/lib-dir-row[^}]*\.lib-caret\{[^}]*margin-left:auto/.test(css), '箭头不能推到最右边');
});

test('右侧只列文件，不再重复列文件夹', () => {
  const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
  const dirView = source.slice(source.indexOf('function renderDirView(view) {'), source.indexOf('function renderOtherView(data) {'));
  assert.ok(!dirView.includes('asset-folders'), '目录视图不能再渲染文件夹卡片');
  assert.ok(dirView.includes('renderAssetGrid(cards'), '目录视图列的是文件');
});

test('点图弹窗：放大 + 资料卡（项目归属、绝对位置、尺寸）', () => {
  const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
  const modal = source.slice(source.indexOf('function assetDetailModal(item) {'), source.indexOf('function pickSlotFile('));
  for (const label of ['分类', '项目归属', '所在目录', '相对路径', '绝对位置', '文件大小', '尺寸', '修改时间']) {
    assert.ok(modal.includes(`['${label}'`), `资料卡要有「${label}」`);
  }
  assert.match(modal, /naturalWidth/, '尺寸用图片实际像素回填');
  assert.match(modal, /data-asset-copy/, '要能复制绝对路径');
  assert.match(modal, /data-asset-reveal/, '要能在文件夹中显示');
  assert.match(source, /function findAssetItem\(rel\)/, '目录里的文件要能从缓存里找回记录');
  assert.match(source, /const item = findAssetItem\(card\.dataset\.assetRel\);/, '点卡片要打开详情弹窗');
  const css = fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8');
  assert.match(css, /\.asset-detail-body\{display:flex;flex-direction:row/, '放大图和资料卡左右并排');
  assert.match(css, /\.asset-detail-facts\{flex:0 0 300px/, '资料卡固定宽度');
});
