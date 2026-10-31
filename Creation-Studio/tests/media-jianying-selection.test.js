'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const drafts = require('../src/media-drafts');

const media = [
  { rel: 'd1/a.mp4', name: '镜头 02.mp4', shotLabel: '镜头 02', kind: 'video', mtime: 20 },
  { rel: 'd1/b.mp4', name: '镜头 01.mp4', shotLabel: '镜头 01', kind: 'video', mtime: 10 },
  { rel: 'd2/c.mp4', name: '镜头 03.mp4', shotLabel: '镜头 03', kind: 'video', mtime: 30 },
];

test('选中单条成片生成一份草稿，名字用项目名加片名', () => {
  const plan = drafts.planTargets({ rels: ['d1/b.mp4'] }, { projectName: '白昼', data: { episodes: [], assignments: {} }, mediaItems: media });
  assert.equal(plan.error, undefined);
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].name, '白昼-镜头 01');
  assert.deepEqual(plan.targets[0].items.map((item) => item.rel), ['d1/b.mp4']);
  assert.equal(plan.targets[0].episodeId, '');
});

test('选中多条成片按镜头号排序并合并成一份草稿', () => {
  const plan = drafts.planTargets({ rels: ['d2/c.mp4', 'd1/a.mp4', 'd1/b.mp4'] }, { projectName: '白昼', data: { episodes: [], assignments: {} }, mediaItems: media });
  assert.deepEqual(plan.targets[0].items.map((item) => item.rel), ['d1/b.mp4', 'd1/a.mp4', 'd2/c.mp4']);
  assert.equal(plan.targets[0].name, '白昼-选中 3 条');
});

test('选中项不在当前项目视频库里时给出明确错误', () => {
  const plan = drafts.planTargets({ rels: ['other/x.mp4'] }, { projectName: '白昼', data: { episodes: [], assignments: {} }, mediaItems: media });
  assert.match(plan.error, /选中的成片/);
  assert.equal(plan.targets, undefined);
});

test('沿用分集与全部集两条旧路线', () => {
  const data = {
    episodes: [{ id: 'ep1', name: '第1集' }, { id: 'ep2', name: '第2集' }],
    assignments: { 'd1/b.mp4': 'ep1', 'd1/a.mp4': 'ep1', 'd2/c.mp4': 'ep2' },
  };
  const one = drafts.planTargets({ episodeId: 'ep1' }, { projectName: '白昼', data, mediaItems: media });
  assert.equal(one.targets.length, 1);
  assert.equal(one.targets[0].name, '白昼-第1集');
  assert.deepEqual(one.targets[0].items.map((item) => item.rel), ['d1/b.mp4', 'd1/a.mp4']);

  const all = drafts.planTargets({ all: true }, { projectName: '白昼', data, mediaItems: media });
  assert.deepEqual(all.targets.map((target) => target.name), ['白昼-第1集', '白昼-第2集']);
  assert.deepEqual(all.targets.map((target) => target.items.length), [2, 1]);
});

test('分集缺失或没有成片时提示清楚', () => {
  const data = { episodes: [{ id: 'ep1', name: '第1集' }], assignments: {} };
  assert.match(drafts.planTargets({ episodeId: 'nope' }, { projectName: '白昼', data, mediaItems: media }).error, /分集不存在/);
  assert.match(drafts.planTargets({ episodeId: 'ep1' }, { projectName: '白昼', data, mediaItems: media }).error, /第1集 还没有成片/);
  assert.match(drafts.planTargets({ all: true }, { projectName: '白昼', data, mediaItems: media }).error, /还没有分集里有成片/);
  assert.match(drafts.planTargets({}, { projectName: '白昼', data, mediaItems: [] }).error, /媒体库里还没有成片/);
});

test('不指定范围时整库按镜头号排成一份草稿', () => {
  const plan = drafts.planTargets({}, { projectName: '白昼', data: { episodes: [], assignments: {} }, mediaItems: media });
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].name, '白昼');
  assert.deepEqual(plan.targets[0].items.map((item) => item.rel), ['d1/b.mp4', 'd1/a.mp4', 'd2/c.mp4']);
});

test('媒体库不再提供内置剪辑工程，剪辑交给剪映', () => {
  const web = path.join(__dirname, '..', 'web');
  const app = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
  assert.equal(app.includes('剪辑 / 工程'), false);
  assert.equal(app.includes('加入剪辑'), false);
  assert.equal(app.includes('openVideoEditor'), false);
  assert.equal(app.includes('media-preview-jianying'), true, '预览弹窗应保留导入剪映');
  const creative = fs.readFileSync(path.join(web, 'creative.js'), 'utf8');
  assert.equal(creative.includes('openVideoEditor'), false);
  assert.equal(creative.includes('documents/edit'), false);
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  assert.equal(html.includes('edit-math.js'), false);
  assert.equal(html.includes('edit-enhancements.js'), false);
  for (const file of ['edit-math.js', 'edit-enhancements.js']) {
    assert.equal(fs.existsSync(path.join(web, file)), false, `${file} 应已移除`);
  }
  const src = path.join(__dirname, '..', 'src');
  assert.equal(fs.existsSync(path.join(src, 'edit-renderer.js')), false);
  assert.equal(fs.existsSync(path.join(src, 'media-waveform.js')), false);
  const routes = fs.readFileSync(path.join(src, 'creative-routes.js'), 'utf8');
  assert.equal(routes.includes('/api/creative/edit'), false);
  assert.equal(routes.includes('documents/(scene|image|edit)'), false);
});
