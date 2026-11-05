'use strict';
/**
 * 图像任务泵的租户上下文：任务在 t1 入队，从无上下文处泵起时仍用 t1 的渠道。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-img-tenant-'));
process.env.WMD_DATA_DIR = dir;
delete process.env.WMD_SECRET_KEY;

const config = require('../src/config');
const tenantContext = require('../src/tenant-context');
const workbenchStore = require('../src/workbench-store');
const { createImageTasks } = require('../src/image-tasks');
const db = require('../src/db');

const seen = [];

test('图像任务在后台执行时使用任务所属租户', async () => {
  tenantContext.run('t1', () => {
    config.save({ channels: { llm: [], image: [{ id: 'img-t1', kind: 'image', type: 'openai-images', name: 'T1', baseUrl: 'http://127.0.0.1:1', model: 'm', apiKey: 'k', enabled: true, active: true, options: {} }], video: [] } });
  });
  const tasks = createImageTasks({
    store: workbenchStore.store(),
    channel: () => ({ id: 'img-t1', name: 'T1', type: 'openai-images', model: 'm', apiKey: 'k', options: {} }),
    generate: async () => {
      seen.push(tenantContext.current());
      return [{ buffer: Buffer.from('fake-image'), mime: 'image/png' }];
    },
    saveImages: () => ({ id: 'qa-save', items: [{ type: 'image', name: 'qa.png', path: path.join(dir, 'qa.png'), bytes: 10, url: '' }] }),
  });

  const task = tenantContext.run('t1', () => tasks.enqueue({ prompt: 'qa', projectId: '' }, null));
  await tasks.pump();
  await tasks.wait(task.id);
  const done = tasks.get(task.id);
  assert.equal(done.status, 'success', done.error);
  assert.deepEqual(seen, ['t1']);
  await tasks.close();
});

test.after(() => {
  try { workbenchStore.store().close(); } catch { /* ignore */ }
  db.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});
