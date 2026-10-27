'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const { TaskQueue } = require('../src/tasks');

function waitFor(fn, timeout = 3000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const value = fn();
      if (value) return resolve(value);
      if (Date.now() - start > timeout) return reject(new Error('等待超时'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

test('配额按北京时间 00:00 重置', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-quota-'));
  let now = new Date('2026-10-27T15:59:00Z'); // 北京时间 23:59
  const store = new Store(dir, { now: () => now });
  const account = store.add({ name: '北京时间账号', platform: 'doubao' });
  assert.equal(account.quota.timezone, 'Asia/Shanghai');
  store.consumeQuota(account.id);
  assert.equal(store.list()[0].quota.used, 1);
  now = new Date('2026-10-27T16:00:01Z'); // 北京时间次日 00:00:01
  assert.equal(store.list()[0].quota.used, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('没有成片失败时退回预扣额度，成功才保留', async () => {
  const dir = fs.mkdtempSync(os.tmpdir());
  let used = 0;
  let refunds = 0;
  const account = { id: 'a', name: '号', platform: 'doubao', enabled: true, quota: { used: 1, limit: 3, timezone: 'Asia/Shanghai', date: '2026-10-27' } };
  const store = {
    accounts: [account],
    list() { return [structuredClone(account)]; },
    get(id) { return id === account.id ? structuredClone(account) : null; },
    canUse() { return true; },
    update(id, patch) { if (patch.quotaUsed !== undefined) used = patch.quotaUsed; return account; },
    refundQuota() { used = Math.max(0, used - 1); refunds += 1; },
  };
  const queue = new TaskQueue({
    directory: dir,
    store,
    execute: async (task, acc, signal, update) => {
      update({ quotaCharged: true });
      throw new Error('平台生成失败');
    },
  });
  const task = queue.submit({ requestId: 'quota-fail', prompt: '测试', platform: 'doubao' });
  const failed = await waitFor(() => queue.list().find((t) => t.id === task.id && t.status === 'failed'));
  assert.equal(refunds, 1);
  assert.equal(failed.quotaRefunded, true);
  assert.equal(failed.quotaCharged, false);
  await queue.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('成功任务不退额度', async () => {
  const dir = fs.mkdtempSync(os.tmpdir());
  const file = path.join(dir, 'out.mp4');
  fs.writeFileSync(file, Buffer.alloc(16));
  let refunds = 0;
  const account = { id: 'a', name: '号', platform: 'doubao', enabled: true, quota: { used: 1, limit: 3, timezone: 'Asia/Shanghai', date: '2026-10-27' } };
  const store = {
    list() { return [structuredClone(account)]; },
    get(id) { return id === account.id ? structuredClone(account) : null; },
    canUse() { return true; },
    update() { return account; },
    refundQuota() { refunds += 1; },
  };
  const queue = new TaskQueue({
    directory: dir,
    store,
    execute: async (task, acc, signal, update) => {
      update({ quotaCharged: true });
      return { path: file };
    },
  });
  const task = queue.submit({ requestId: 'quota-ok', prompt: '测试', platform: 'doubao' });
  const done = await waitFor(() => queue.list().find((t) => t.id === task.id && t.status === 'completed'));
  assert.equal(refunds, 0);
  assert.equal(done.quotaCharged, true);
  await queue.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});
