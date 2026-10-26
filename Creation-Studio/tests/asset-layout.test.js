'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-asset-layout-'));
process.env.H3_DATA_DIR = dir;
const projects = require('../src/projects');
const layout = require('../src/asset-layout');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* sqlite 占用时保留 */ } });

test('素材库按任务分组：分镜/任务/镜头，9 格 + shot.json + task.json', () => {
  const project = projects.create({ name: '结构测试' });
  const refA = path.join(dir, 'a.png');
  const refB = path.join(dir, 'b.png');
  fs.writeFileSync(refA, PNG);
  fs.writeFileSync(refB, PNG);
  const items = [
    { title: '镜头01', prompt: '雨夜街头', prefixPrompt: '冷色调，电影感', images: Array.from({ length: 10 }, () => ({ path: refA, note: '女主' })), duration: 10, ratio: '16:9' },
    { title: '镜头02', prompt: '清晨咖啡馆', images: [{ path: refB, note: '场景' }], duration: 8, ratio: '9:16' },
  ];
  const imported = layout.importShots(project.id, items, '白昼v0.5.json', { id: 'evt_test_1', title: '白昼v0.5' });
  assert.equal(imported.imported, 2);
  assert.equal(imported.task.id, 'evt_test_1');
  const root = layout.rootFor(project.id);
  const taskDir = path.join(root, '分镜', '白昼v0.5');
  const shot1 = path.join(taskDir, '镜头01');
  assert.ok(fs.existsSync(path.join(root, '素材', '人物')), '素材/人物');
  assert.ok(fs.existsSync(path.join(root, '素材', '场景')), '素材/场景');
  assert.ok(fs.existsSync(path.join(root, '素材', '道具')), '素材/道具');
  assert.ok(fs.existsSync(path.join(root, '其他')), '其他');
  assert.ok(fs.existsSync(path.join(taskDir, 'task.json')), '任务级 task.json');
  assert.ok(fs.existsSync(path.join(shot1, '图一.png')));
  assert.ok(fs.existsSync(path.join(shot1, '图九.png')));
  assert.equal(fs.existsSync(path.join(shot1, '图十.png')), false, '最多 9 格');
  const taskJson = JSON.parse(fs.readFileSync(path.join(taskDir, 'task.json'), 'utf8'));
  assert.equal(taskJson.id, 'evt_test_1');
  const json = JSON.parse(fs.readFileSync(path.join(shot1, 'shot.json'), 'utf8'));
  assert.equal(json.prompt, '雨夜街头');
  assert.equal(json.prefixPrompt, '冷色调，电影感');
  assert.equal(json.taskId, 'evt_test_1');
  assert.equal(json.images.length, 9);

  let data = layout.scan(project.id);
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].title, '白昼v0.5');
  assert.deepEqual(data.tasks[0].shots.map((shot) => shot.name), ['镜头01', '镜头02']);
  assert.equal(data.tasks[0].shots[0].taskId, 'evt_test_1');
  assert.equal(data.shots.length, 2);
  assert.equal(data.tasks[0].shots[0].count, 9);

  const material = layout.saveMaterialBuffer(project.id, 'character', '女主.png', PNG);
  assert.equal(material.type, 'character');
  const taskRef = { id: 'evt_test_1', title: '白昼v0.5' };
  const copied = layout.copyToSlot(project.id, taskRef, '镜头02', 1, material.rel);
  assert.equal(copied.label, '图一');
  assert.ok(fs.existsSync(path.join(taskDir, '镜头02', '图一.png')));
  const shot2Json = JSON.parse(fs.readFileSync(path.join(taskDir, '镜头02', 'shot.json'), 'utf8'));
  assert.equal(shot2Json.images[0].sourcePath, path.join(root, '素材', '人物', '女主.png'));

  layout.updateShot(project.id, taskRef, '镜头02', { prompt: '改过的提示词' });
  data = layout.scan(project.id);
  assert.equal(data.tasks[0].shots.find((shot) => shot.name === '镜头02').prompt, '改过的提示词');

  layout.clearSlot(project.id, taskRef, '镜头02', 1);
  assert.equal(layout.scan(project.id).tasks[0].shots.find((shot) => shot.name === '镜头02').count, 0);

  assert.throws(() => layout.copyToSlot(project.id, taskRef, '镜头02', 1, '../../escape.png'), /素材文件不存在|不存在/);
  layout.deleteShot(project.id, taskRef, '镜头02');
  assert.deepEqual(layout.scan(project.id).tasks[0].shots.map((shot) => shot.name), ['镜头01']);
});
