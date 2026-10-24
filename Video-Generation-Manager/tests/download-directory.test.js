'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { Settings } = require('../src/settings');
const { createService } = require('../src/server');
async function until(fn) { const end = Date.now() + 5000; while (Date.now() < end) { if (fn()) return; await wait(10); } throw new Error('等待超时'); }

test('下载目录必须是绝对路径、不能是文件，保存后持久化并可清空回默认', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-dl-dir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const settings = new Settings(dir);
  assert.equal(settings.downloadsDirectory(), path.join(dir, 'downloads'));
  assert.equal(settings.public().downloadDirectory, '');
  assert.throws(() => settings.validate({ downloadDirectory: '成片' }), /绝对路径/);
  const file = path.join(dir, 'a.txt'); fs.writeFileSync(file, 'x');
  assert.throws(() => settings.validate({ downloadDirectory: file }), /不是文件夹/);
  const target = path.join(dir, '成片目录', '视频');
  const value = settings.validate({ downloadDirectory: target });
  assert.equal(value.downloadDirectory, target);
  assert.equal(fs.statSync(target).isDirectory(), true);
  await settings.save(value);
  assert.equal(settings.downloadsDirectory(), target);
  const restored = new Settings(dir);
  assert.equal(restored.downloadsDirectory(), target);
  assert.equal(restored.public().downloadsPath, target);
  assert.equal(settings.validate({ downloadDirectory: '' }).downloadDirectory, '');
});

test('改下载目录后任务文件与下载记录都指向新目录，且不会关闭账号窗口', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-dl-dir-svc-'));
  const custom = path.join(dir, '自定义成片');
  let closes = 0;
  const service = await createService({
    directory: dir, port: 0,
    pool: { close: async () => {}, closeAccount: async () => { closes += 1; }, open: async () => ({ ok: true }) },
    execute: async task => {
      const file = path.join(custom, task.id + '.mp4');
      fs.writeFileSync(file, 'fixture');
      return { path: file, size: 7, duration: 5, watermarkMethod: 'fallback-api-unwatermarked', file: task.id + '.mp4' };
    }
  });
  t.after(async () => { await service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const headers = { Authorization: 'Bearer ' + service.token, 'Content-Type': 'application/json' };
  const put = await fetch(service.baseURL + '/api/settings', { method: 'PUT', headers, body: JSON.stringify({ downloadDirectory: custom }) });
  assert.equal(put.status, 200);
  assert.equal(closes, 0, '改下载目录不应关闭账号窗口');
  const state = await (await fetch(service.baseURL + '/api/state', { headers })).json();
  assert.equal(state.downloads, custom);
  const account = service.store.add({ name: '下载目录测试', platform: 'doubao' });
  const task = service.queue.submit({ prompt: 'custom dir', platform: 'doubao', accountId: account.id, requestId: 'dl-dir-1' });
  await until(() => service.queue.get(task.id).status === 'completed');
  assert.equal(service.queue.get(task.id).result.path, path.join(custom, task.id + '.mp4'));
  const listing = await (await fetch(service.baseURL + '/api/downloads', { headers })).json();
  assert.equal(listing.directory, custom);
  assert.equal(listing.files[0].taskId, task.id);
});
