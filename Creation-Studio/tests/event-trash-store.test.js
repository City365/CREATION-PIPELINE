'use strict';
/**
 * 回收站入库：旧 events-trash.json 一次导入、按租户隔离、每租户 100 条上限。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-event-trash-'));
process.env.WMD_DATA_DIR = dir;
delete process.env.WMD_SECRET_KEY;

const legacyFile = path.join(dir, 'events-trash.json');
fs.writeFileSync(legacyFile, JSON.stringify({
  version: 1,
  items: [{
    event: { id: 'evt-legacy', title: '旧回收任务', kind: 'video', status: 'canceled', spec: { projectId: 'p1' }, items: [] },
    removedAt: 1000,
    items: 0,
  }],
}, null, 2));

const store = require('../src/event-store');

function entry(id, removedAt, tenant) {
  return { event: { id, title: id, kind: 'video', status: 'canceled', spec: { projectId: 'p-' + (tenant || '') }, items: [] }, removedAt, items: 0 };
}

test('旧 events-trash.json 导入默认租户并改名', () => {
  const rows = store.trashList('tnt_default');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event.id, 'evt-legacy');
  assert.equal(fs.existsSync(legacyFile), false);
  assert.ok(fs.existsSync(path.join(dir, 'events-trash.imported.json')));
});

test('回收站按租户隔离', () => {
  store.trashPush('t1', entry('t1-a', 2000, 't1'));
  store.trashPush('t2', entry('t2-a', 2000, 't2'));
  assert.deepEqual(store.trashList('t1').map((row) => row.event.id), ['t1-a']);
  assert.deepEqual(store.trashList('t2').map((row) => row.event.id), ['t2-a']);
  assert.equal(store.trashList('tnt_default').length, 1);
});

test('每个租户单独保留 100 条，取走一条后删除', () => {
  for (let i = 0; i < 105; i += 1) store.trashPush('t1', entry('t1-' + i, 3000 + i, 't1'));
  const rows = store.trashList('t1');
  assert.equal(rows.length, 100);
  assert.equal(rows.some((row) => row.event.id === 't1-0'), false);
  assert.equal(rows[0].event.id, 't1-104');
  assert.equal(store.trashCount('t1'), 100);
  assert.equal(store.trashList('t2').length, 1, '不能挤掉别的租户');

  const taken = store.trashTake('t1', 't1-104');
  assert.equal(taken.event.id, 't1-104');
  assert.equal(store.trashCount('t1'), 99);
  assert.equal(store.trashTake('t2', '').event.id, 't2-a');
  assert.equal(store.trashTake('t2', ''), null);
});

test.after(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
