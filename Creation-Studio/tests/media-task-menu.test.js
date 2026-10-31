'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-media-menu-'));
process.env.WMD_DATA_DIR = dir;
const library = require('../src/library');

test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ } });

function seed(day, jobDir, files, params) {
  const target = path.join(dir, 'media', day, jobDir);
  fs.mkdirSync(target, { recursive: true });
  if (params) fs.writeFileSync(path.join(target, 'params.json'), JSON.stringify(params, null, 2));
  for (const file of files) fs.writeFileSync(path.join(target, file), Buffer.alloc(1024, 7));
}

seed('2026-10-29', 'job-a', ['镜头 01.mp4', '镜头 02.mp4'], { taskTitle: '首尔没有忘记你', shotLabel: '镜头 01' });
seed('2026-10-29', 'job-b', ['镜头 01.mp4'], { taskTitle: '狗蛋自传', shotLabel: '镜头 01' });
seed('2026-10-28', 'job-c', ['临时片段.mp4'], null);
seed('2026-10-29', 'images', ['图 01.png'], { taskTitle: '图像任务' });

test('任务菜单只按任务聚合：任务数、条数、封面、总大小', () => {
  const data = library.listMediaTasks('video', '');
  assert.equal(data.total, 4, '4 个视频：首尔 2 + 狗蛋 1 + 未记录 1');
  assert.deepEqual(data.counts, { video: 4, image: 0 });
  assert.equal(data.tasks.length, 3);

  const byTitle = new Map(data.tasks.map((task) => [task.taskTitle, task]));
  assert.equal(byTitle.get('首尔没有忘记你').videos, 2);
  assert.equal(byTitle.get('首尔没有忘记你').count, 2);
  assert.equal(byTitle.get('首尔没有忘记你').bytes, 2048);
  assert.match(byTitle.get('首尔没有忘记你').cover, /\/api\/media\/file\?path=/);
  assert.equal(byTitle.get('狗蛋自传').videos, 1);
  assert.equal(byTitle.get('未记录任务').videos, 1, '没有 params.json 的成片归到「未记录任务」');
  // 任务菜单按最近更新倒序
  assert.ok(data.tasks[0].mtime >= data.tasks[data.tasks.length - 1].mtime);
});

test('按任务过滤只返回该任务的文件（页面点任务时才加载这么多）', () => {
  const first = library.listMedia('video', '', { taskTitle: '首尔没有忘记你' });
  assert.equal(first.items.length, 2);
  assert.ok(first.items.every((item) => item.taskTitle === '首尔没有忘记你'));

  const plain = library.listMedia('video', '', { taskTitle: '未记录任务' });
  assert.equal(plain.items.length, 1, '「未记录任务」这个分组名也要能过滤');

  const empty = library.listMedia('video', '', { taskTitle: '不存在的任务' });
  assert.equal(empty.items.length, 0);

  const all = library.listMedia('video', '');
  assert.equal(all.items.length, 4, '不传 taskTitle 时保持原有全量行为');
});

test('图像任务也走同一套菜单，且不混进视频', () => {
  const images = library.listMediaTasks('image', '');
  assert.equal(images.total, 1);
  assert.deepEqual(images.counts, { video: 0, image: 1 });
  assert.equal(images.tasks[0].taskTitle, '图像任务');
  assert.equal(library.listMedia('image', '', { taskTitle: '图像任务' }).items.length, 1);
  assert.equal(library.listMedia('video', '', { taskTitle: '图像任务' }).items.length, 0);
});
