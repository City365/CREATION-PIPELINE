'use strict';
// 账号轮换：指定账号没有今日配额、或被平台判定额度用尽时，任务要换同平台其他账号，而不是一直排队。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TaskQueue } = require('../src/tasks');

function storeOf(accounts) {
  return {
    accounts,
    list() { return accounts.map(a => structuredClone(a)); },
    get(id) { const a = accounts.find(x => x.id === id); return a && structuredClone(a); },
    canUse(a) { return a.quota.used < a.quota.limit; },
    update(id, patch) { const a = accounts.find(x => x.id === id); if (a && patch.quotaUsed !== undefined) a.quota.used = patch.quotaUsed; return a; },
  };
}

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-queue-'));
  const file = path.join(dir, 'out.mp4'); fs.writeFileSync(file, Buffer.alloc(64));
  return { dir, file };
}

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

const account = (id, name, used, limit = 3) => ({ id, name, platform: 'doubao', enabled: true, quota: { used, limit, timezone: 'America/Tijuana', date: '2026-10-25' } });

test('指定账号今日配额已满时改用同平台其他账号', async () => {
  const { dir, file } = workspace();
  const store = storeOf([account('a', '自己号1', 3), account('b', '闲鱼1', 0)]);
  const used = [];
  const queue = new TaskQueue({ directory: dir, store, execute: async (task, acc) => { used.push(acc.id); return { path: file }; } });
  const task = queue.submit({ requestId: 'job-1', prompt: '测试', platform: 'doubao', accountId: 'a' });
  const done = await waitFor(() => queue.list().find(t => t.id === task.id && t.status === 'completed'));
  assert.equal(done.accountId, 'b');
  assert.deepEqual(used, ['b']);
  await queue.shutdown();
});

test('平台判定额度不足时换下一个账号继续，不把任务判失败', async () => {
  const { dir, file } = workspace();
  const store = storeOf([account('a', '自己号1', 0), account('b', '闲鱼1', 0)]);
  const used = [];
  const queue = new TaskQueue({ directory: dir, store, execute: async (task, acc) => {
    used.push(acc.id);
    if (acc.id === 'a') { const error = new Error('平台额度不足'); error.code = 'ACCOUNT_QUOTA_EXHAUSTED'; throw error; }
    return { path: file };
  } });
  const task = queue.submit({ requestId: 'job-2', prompt: '测试', platform: 'doubao', accountId: 'a' });
  const done = await waitFor(() => queue.list().find(t => t.id === task.id && t.status === 'completed'));
  assert.deepEqual(used, ['a', 'b']);
  assert.equal(done.accountId, 'b');
  assert.deepEqual(done.excludedAccounts, ['a']);
  await queue.shutdown();
});

test('没指定账号时在可用账号池里随机挑选', async () => {
  const { dir, file } = workspace();
  const store = storeOf([account('a', '自己号1', 0), account('b', '闲鱼1', 0)]);
  const used = [];
  const queue = new TaskQueue({ directory: dir, store, execute: async (task, acc) => { used.push(acc.id); return { path: file }; } });
  const original = Math.random;
  try {
    Math.random = () => 0;
    await queue.submit({ requestId: 'job-4', prompt: '测试', platform: 'doubao' });
    await waitFor(() => used.length === 1);
    Math.random = () => 0.999;
    await queue.submit({ requestId: 'job-5', prompt: '测试', platform: 'doubao' });
    await waitFor(() => used.length === 2);
  } finally { Math.random = original; }
  assert.deepEqual(used, ['a', 'b']);
  await queue.shutdown();
});

test('没有可用账号时才排队等待', async () => {  const { dir, file } = workspace();
  const store = storeOf([account('a', '自己号1', 3), account('b', '闲鱼1', 3)]);
  const queue = new TaskQueue({ directory: dir, store, execute: async () => ({ path: file }) });
  const task = queue.submit({ requestId: 'job-3', prompt: '测试', platform: 'doubao' });
  await new Promise(r => setTimeout(r, 120));
  const queued = queue.list().find(t => t.id === task.id);
  assert.equal(queued.status, 'queued');
  assert.equal(queued.message, '等待可用账号：今日配额、冷却或占用限制');
  await queue.shutdown();
});
