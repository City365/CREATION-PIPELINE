'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { createService } = require('../src/server');
async function until(fn) { const end = Date.now() + 5000; while (Date.now() < end) { if (fn()) return; await wait(10); } throw new Error('等待超时'); }
const fakePool = { close: async () => {}, closeAccount: async () => {}, open: async () => ({ ok: true }) };

test('下载目录可列出、可下载，并与任务结果对应；非法文件名和未知任务被拒绝', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-downloads-'));
  const downloads = path.join(directory, 'downloads');
  const service = await createService({
    directory, port: 0, pool: fakePool,
    execute: async task => {
      fs.mkdirSync(downloads, { recursive: true });
      const file = path.join(downloads, task.id + '.mp4');
      fs.writeFileSync(file, 'fixture-bytes');
      return { path: file, size: 13, duration: 15.05, watermarkMethod: 'fallback-api-unwatermarked', downloadedAt: new Date().toISOString() };
    }
  });
  t.after(async () => { await service.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const request = async (route, method = 'GET', data) => {
    const r = await fetch(service.baseURL + route, { method, headers: { Authorization: 'Bearer ' + service.token, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : await r.text() };
  };

  const account = (await request('/api/accounts', 'POST', { platform: 'doubao', name: '下载测试' })).body;
  const task = (await request('/api/tasks', 'POST', { prompt: 'download list', platform: 'doubao', accountId: account.id, requestId: 'dl-1' })).body;
  await until(() => service.queue.get(task.id).status === 'completed');

  const listing = (await request('/api/downloads')).body;
  assert.equal(listing.directory, downloads);
  assert.equal(listing.files.length, 1);
  assert.equal(listing.files[0].name, task.id + '.mp4');
  assert.equal(listing.files[0].taskId, task.id);
  assert.equal(listing.files[0].watermarkMethod, 'fallback-api-unwatermarked');
  assert.equal(listing.files[0].size, 13);

  const file = await request('/api/downloads/file?name=' + encodeURIComponent(task.id + '.mp4'));
  assert.equal(file.status, 200);
  assert.equal(file.body, 'fixture-bytes');

  assert.equal((await request('/api/downloads/file?name=' + encodeURIComponent('..%2Faccounts.json'))).status, 400);
  assert.equal((await request('/api/reveal', 'POST', { taskId: '00000000-0000-0000-0000-000000000000' })).status, 400);
  assert.equal((await request('/api/reveal', 'POST', { name: 'not-there.mp4' })).status, 400);

  // 任务「打开」= 内联播放，支持 Range 才能拖动进度条
  const auth = { Authorization: 'Bearer ' + service.token };
  const play = await fetch(service.baseURL + '/api/tasks/' + task.id + '/play', { headers: auth });
  assert.equal(play.status, 200);
  assert.equal(play.headers.get('content-type'), 'video/mp4');
  assert.equal(play.headers.get('accept-ranges'), 'bytes');
  assert.match(play.headers.get('content-disposition') || '', /^inline/);
  assert.equal(await play.text(), 'fixture-bytes');
  const range = await fetch(service.baseURL + '/api/tasks/' + task.id + '/play', { headers: { ...auth, Range: 'bytes=0-4' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 0-4/13');
  assert.equal(await range.text(), 'fixtu');
  assert.equal((await fetch(service.baseURL + '/api/tasks/' + task.id + '/play')).status, 401);
  const download = await fetch(service.baseURL + '/api/tasks/' + task.id + '/file', { headers: auth });
  assert.match(download.headers.get('content-disposition') || '', /^attachment/);

  // 「打开」走系统默认播放器：未完成和不存在都要拒绝（成功分支不在这里跑，避免真的弹出播放器）
  const queued = service.queue.get(task.id);
  queued.status = 'queued';
  assert.equal((await request('/api/tasks/' + task.id + '/open', 'POST', {})).status, 400);
  queued.status = 'completed';
  assert.equal((await request('/api/tasks/00000000-0000-0000-0000-000000000000/open', 'POST', {})).status, 400);
});
