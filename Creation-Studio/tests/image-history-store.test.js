'use strict';
/**
 * 图像历史入库：旧 JSON 一次导入、按租户隔离、每租户 80 条上限。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-image-history-'));
process.env.WMD_DATA_DIR = dir;
delete process.env.WMD_SECRET_KEY;

const legacyFile = path.join(dir, 'image-history.json');
fs.writeFileSync(legacyFile, JSON.stringify([
  { id: 'legacy-1', items: [{ path: 'a.png' }], prompt: 'old', createdAt: 1000, projectId: 'p1' },
  { id: 'legacy-2', items: [{ path: 'b.png' }], prompt: 'older', createdAt: 900 },
], null, 2));

const imageHistory = require('../src/image-history');
const tenantContext = require('../src/tenant-context');
const db = require('../src/db');

test('旧 image-history.json 导入默认租户并改名', () => {
  const rows = imageHistory.list();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.id), ['legacy-1', 'legacy-2']);
  assert.equal(fs.existsSync(legacyFile), false);
  assert.ok(fs.existsSync(path.join(dir, 'image-history.imported.json')));
  assert.equal(rows[0].projectId, 'p1');
});

test('历史按租户隔离', () => {
  tenantContext.run('t1', () => imageHistory.remember({ id: 'a1', items: [], prompt: 'a', createdAt: 2000 }));
  tenantContext.run('t2', () => imageHistory.remember({ id: 'b1', items: [], prompt: 'b', createdAt: 2000 }));
  assert.deepEqual(tenantContext.run('t1', () => imageHistory.list().map((row) => row.id)), ['a1']);
  assert.deepEqual(tenantContext.run('t2', () => imageHistory.list().map((row) => row.id)), ['b1']);
  assert.equal(imageHistory.list().length, 2, '默认租户不受影响');
});

test('每个租户单独保留 80 条', () => {
  tenantContext.run('t1', () => {
    for (let i = 0; i < 85; i += 1) imageHistory.remember({ id: 't1-' + i, items: [], prompt: 'x', createdAt: 3000 + i });
  });
  const t1 = tenantContext.run('t1', () => imageHistory.list());
  assert.equal(t1.length, 80);
  assert.equal(t1.some((row) => row.id === 't1-0'), false, '最早的应被挤掉');
  assert.equal(t1[0].id, 't1-84');
  assert.equal(tenantContext.run('t2', () => imageHistory.list()).length, 1, '不能挤掉别的租户');
  assert.equal(imageHistory.list().length, 2);
  const rows = db.open().prepare('SELECT tenant_id, COUNT(*) AS n FROM image_history GROUP BY tenant_id').all();
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.tenant_id, row.n])), { tnt_default: 2, t1: 80, t2: 1 });
});

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
