'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const { TaskQueue } = require('../src/tasks');

function makeQueue(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-gemini-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  const queue = new TaskQueue({ directory, store, execute: async () => { await new Promise(resolve => setTimeout(resolve, 50)); } });
  t.after(() => queue.shutdown());
  const account = store.add({ platform: 'gemini', name: 'Gemini 测试' });
  return { store, queue, account };
}

test('Gemini 账号与任务平台可用，但会拒绝它不支持的参数', async t => {
  const { store, queue, account } = makeQueue(t);
  assert.equal(account.platform, 'gemini');
  assert.throws(() => store.add({ platform: 'openai' }), /平台不支持/);

  const base = { platform: 'gemini', accountId: account.id, prompt: '一只猫' };
  assert.throws(() => queue.submit({ ...base, duration: 5 }), /时长/);
  assert.throws(() => queue.submit({ ...base, resolution: '1080p' }), /清晰度/);
  assert.throws(() => queue.submit({ ...base, model: 'veo' }), /模型/);
  assert.throws(() => queue.submit({ ...base, ratio: '1:1' }), /16:9/);

  const ok = queue.submit({ ...base, ratio: '16:9', removeWatermark: true });
  assert.equal(ok.platform, 'gemini');
  assert.equal(ok.duration, null);
  assert.equal(ok.ratio, '16:9');
  queue.cancel(ok.id);
});

test('豆包仍然接受时长/分辨率/模型参数', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-doubao-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  const queue = new TaskQueue({ directory, store, execute: async () => { await new Promise(resolve => setTimeout(resolve, 50)); } });
  t.after(() => queue.shutdown());
  const account = store.add({ platform: 'doubao', name: '豆包测试' });
  const task = queue.submit({ platform: 'doubao', accountId: account.id, prompt: '一只猫', duration: 15, ratio: '9:16', resolution: '720p' });
  assert.equal(task.duration, 15);
  assert.equal(task.resolution, '720p');
  queue.cancel(task.id);
});
