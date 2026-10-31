'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.WMD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-events-undo-'));
const events = require('../src/events');

function seed(id, items) {
  const event = {
    schemaVersion: 2,
    version: 1,
    id,
    title: '撤销测试任务',
    kind: 'video',
    source: 'batch',
    status: 'partial',
    spec: { projectId: 'proj-undo', items: [] },
    items,
    createdAt: Date.now(),
    audit: [],
  };
  events.load();
  events.state.events = events.state.events.filter((row) => row.id !== id).concat([event]);
  events.save();
  return event;
}

const items = () => ([
  { id: 'i1', refType: 'job', refId: 'job-a', title: '镜头 01', status: 'queued' },
  { id: 'i2', refType: 'job', refId: 'job-b', title: '镜头 02', status: 'queued' },
  { id: 'i3', refType: 'job', refId: 'job-c', title: '镜头 03', status: 'queued' },
]);

test('移除分镜只是挪进 removedItems，撤销后回到原来的位置', () => {
  seed('evt_undo_items', items());
  const afterRemove = events.removeItem('evt_undo_items', 'i2');
  assert.deepEqual(afterRemove.items.map((row) => row.id), ['i1', 'i3']);
  assert.equal(afterRemove.removedItems.length, 1);
  assert.equal(afterRemove.removedItems[0].item.id, 'i2');
  assert.equal(afterRemove.removedItems[0].index, 1);
  assert.ok(afterRemove.audit.some((row) => row.action === 'remove-item'), '审计里要留下移除记录');

  const afterRestore = events.restoreItem('evt_undo_items');
  assert.deepEqual(afterRestore.items.map((row) => row.id), ['i1', 'i2', 'i3'], '要插回原来的第 2 位');
  assert.equal((afterRestore.removedItems || []).length, 0);
  assert.ok(afterRestore.audit.some((row) => row.action === 'restore-item'));
});

test('移除多条后可以按 itemId 精确恢复指定的那条', () => {
  seed('evt_undo_pick', items());
  events.removeItem('evt_undo_pick', 'i1');
  events.removeItem('evt_undo_pick', 'i3');
  let event = events.get('evt_undo_pick');
  assert.deepEqual(event.items.map((row) => row.id), ['i2']);
  event = events.restoreItem('evt_undo_pick', 'i1');
  assert.deepEqual(event.items.map((row) => row.id), ['i1', 'i2'], 'i1 要回到最前面');
  assert.equal(event.removedItems.length, 1);
  assert.equal(event.removedItems[0].item.id, 'i3');
  assert.throws(() => events.restoreItem('evt_undo_pick', 'nope'), /不在可恢复列表/);
});

test('删除任务进回收站，列表能查到，恢复后分镜一条不少', () => {
  seed('evt_undo_task', items());
  const removed = events.removeEvent('evt_undo_task');
  assert.equal(removed.id, 'evt_undo_task');
  assert.throws(() => events.get('evt_undo_task'), /不存在/);
  assert.equal(events.state.events.some((row) => row.id === 'evt_undo_task'), false);

  const trash = events.listTrash();
  const row = trash.find((entry) => entry.id === 'evt_undo_task');
  assert.ok(row, '回收站里应该有这条任务');
  assert.equal(row.title, '撤销测试任务');
  assert.equal(row.items, 3);
  assert.equal(row.projectId, 'proj-undo');

  const restored = events.restoreEvent('evt_undo_task');
  assert.deepEqual(restored.items.map((item) => item.id), ['i1', 'i2', 'i3']);
  assert.equal(events.listTrash().some((entry) => entry.id === 'evt_undo_task'), false, '恢复后要从回收站拿掉');
  assert.ok(events.get('evt_undo_task'), '恢复后能正常读出来');
});

test('回收站为空时恢复会明确报错', () => {
  assert.throws(() => events.restoreEvent(''), /回收站是空的/);
});

test('已成功的分镜也能重新生成：回到排队、attempts+1、旧成片不动', async () => {
  const jobs = require('../src/jobs');
  const calls = [];
  const original = { retry: jobs.retry, setHeld: jobs.setHeld, setShotMeta: jobs.setShotMeta, list: jobs.list };
  let jobStatus = 'success';
  jobs.list = () => [{ id: 'job-ok', status: jobStatus, outputs: jobStatus === 'success' ? [{ path: 'C:/media/镜头 01.mp4', type: 'video' }] : [], createdAt: 1, shotLabel: '镜头 01' }];
  jobs.retry = (id) => { jobStatus = 'queued'; calls.push(['retry', id]); return { id, status: 'queued' }; };
  jobs.setHeld = (id, held) => { calls.push(['held', id, held]); };
  jobs.setShotMeta = () => {};
  try {
    seed('evt_regen', [{ id: 'ir1', refType: 'job', refId: 'job-ok', title: '镜头 01', shotLabel: '镜头 01', status: 'queued' }]);
    const event = events.retryItem('evt_regen', 'ir1');
    assert.equal(event.status, 'queued', '重新生成后任务要回到排队状态');
    assert.equal(event.finishedAt, null);
    assert.equal(event.items[0].attempts, 1);
    assert.deepEqual(calls, [['retry', 'job-ok'], ['held', 'job-ok', true]]);
    assert.ok(event.audit.some((row) => row.action === 'retry'), '审计里要留下重试记录');
  } finally {
    jobs.retry = original.retry;
    jobs.setHeld = original.setHeld;
    jobs.setShotMeta = original.setShotMeta;
    jobs.list = original.list;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
});

test('已成功的分镜也允许改提示词（改完再重新生成）', () => {
  const jobs = require('../src/jobs');
  const original = { revisePrompt: jobs.revisePrompt, list: jobs.list };
  const patches = [];
  jobs.list = () => [{ id: 'job-ok', status: 'success', outputs: [{ path: 'C:/media/镜头 01.mp4', type: 'video' }], createdAt: 1 }];
  jobs.revisePrompt = (id, patch) => { patches.push({ id, patch }); return patch; };
  try {
    seed('evt_revise_success', [{ id: 'ir9', refType: 'job', refId: 'job-ok', title: '镜头 01', shotLabel: '镜头 01', status: 'queued', input: { prompt: '旧词', prefixPrompt: '前置' } }]);
    const event = events.reviseItem('evt_revise_success', 'ir9', { prompt: '改过的词' });
    assert.equal(event.items[0].input.userPrompt, '改过的词');
    assert.equal(patches[0].patch.prompt, '前置\n\n改过的词');
  } finally {
    jobs.revisePrompt = original.revisePrompt;
    jobs.list = original.list;
  }
});

test('HTTP：删除任务返回进回收站，/api/events/trash 能列出并恢复', { timeout: 40000 }, async () => {
  const { spawn } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-events-undo-http-'));
  const base = 'http://127.0.0.1:18978';
  const child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
    env: { ...process.env, WMD_DATA_DIR: dir, WMD_PORT: '18978', WMD_AGENT_AUTOSTART: '0' },
    stdio: 'ignore',
    windowsHide: true,
  });
  const call = async (url, init) => {
    const res = await fetch(base + url, init || {});
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(JSON.stringify(json));
    return json.data;
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* 等服务起来 */ }
      await delay(100);
    }
    await call('/api/events');
    const { DatabaseSync } = require('node:sqlite');
    const eventId = 'evt_undo_http_1';
    const payload = {
      schemaVersion: 2, version: 1, id: eventId, title: '撤销冒烟任务', kind: 'video', source: 'batch',
      status: 'partial', spec: { projectId: 'proj-undo-http', items: [] }, audit: [],
      items: [{ id: 'evt_undo_http_1_i', refType: 'job', refId: 'job-undo-1', title: '镜头 01', status: 'queued' }],
      createdAt: Date.now(), finishedAt: Date.now(),
    };
    const db = new DatabaseSync(path.join(dir, 'task-events.sqlite'));
    db.prepare('INSERT OR REPLACE INTO task_events VALUES(?,?,?,?,?)').run(eventId, 'video', 'proj-undo-http', payload.createdAt, JSON.stringify(payload));
    db.close();

    const removed = await call('/api/events/' + encodeURIComponent(eventId), { method: 'DELETE' });
    assert.equal(removed.id, eventId);
    const trash = await call('/api/events/trash');
    assert.ok(trash.items.some((row) => row.id === eventId && row.title === '撤销冒烟任务'));

    const restored = await call('/api/events/trash/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: eventId }),
    });
    assert.equal(restored.id, eventId);
    assert.equal(restored.items.length, 1);
    const again = await call('/api/events/trash');
    assert.equal(again.items.some((row) => row.id === eventId), false);
    const detail = await call('/api/events/' + encodeURIComponent(eventId));
    assert.equal(detail.title, '撤销冒烟任务');
  } finally {
    child.kill();
    await delay(150);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ }
  }
});
