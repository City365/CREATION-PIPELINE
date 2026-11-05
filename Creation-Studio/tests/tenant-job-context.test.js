'use strict';
/**
 * 后台任务泵的租户上下文：任务在 t1 创建，即使从没有请求上下文的定时器里泵起，
 * 也必须用 t1 的渠道，而不是默认租户或 t2 的渠道。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-job-tenant-'));
process.env.WMD_DATA_DIR = dir;
delete process.env.WMD_SECRET_KEY;

const config = require('../src/config');
const tenantContext = require('../src/tenant-context');
const jobs = require('../src/jobs');
const workflows = require('../src/workflows');
const channels = require('../src/channels');
const videoPlugins = require('../src/video-plugins');
const db = require('../src/db');
const workbenchStore = require('../src/workbench-store');

const seen = [];

function fakeChannel(id, name) {
  return {
    id, kind: 'video', type: 'fake-video', name, baseUrl: 'http://127.0.0.1:1',
    model: 'fake-model', apiKey: '', enabled: true, active: true, options: {},
  };
}

const fakePlugin = {
  manifest: { channelTypes: [{ id: 'fake-video' }] },
  adapter: {
    slots: (ch) => [{ key: 'fake:' + ch.id, provider: 'fake', id: ch.id, name: ch.name, platform: '' }],
    workflows: () => [],
    execute: async (ctx) => {
      seen.push({ tenant: tenantContext.current(), channelId: ctx.job.channelId });
    },
  },
};

test('从无上下文的任务泵执行时，仍使用任务所属租户的渠道', async () => {
  tenantContext.run('t1', () => {
    config.save({ channels: { llm: [], image: [], video: [fakeChannel('ch-t1', 'T1 渠道')] } });
  });
  tenantContext.run('t2', () => {
    config.save({ channels: { llm: [], image: [], video: [fakeChannel('ch-t2', 'T2 渠道')] } });
  });

  // 打桩：工作流由当前租户的渠道生成，适配器只记录上下文。
  workflows.get = () => {
    const ch = config.load().channels.video[0];
    return ch ? {
      id: 'wf-fake', label: 'fake', provider: 'fake', channelId: ch.id, platform: '',
      images: 0, audios: 0, videos: 0, durationDefault: 5, defaultResolution: '',
      megapixelsDefault: 0, ratios: [], durationOptions: [5], promptRequired: false,
    } : null;
  };
  workflows.validate = () => ({ errors: [], warnings: [] });
  channels.get = (kind, id) => (config.load().channels[kind] || []).find((ch) => ch.id === id) || null;
  videoPlugins.forType = () => fakePlugin;
  videoPlugins.forWorkflow = () => fakePlugin;

  jobs.loadState();
  const created = tenantContext.run('t1', () => jobs.addJobs({ workflowId: 'wf-fake', projectId: 'proj-t1', prompt: 'qa', count: 1 })[0]);
  assert.equal(created.tenantId, 't1');
  jobs.setHeld(created.id, true);

  // 关键：从没有租户上下文的地方继续排队，泵必须自己按任务租户切换。
  jobs.setHeld(created.id, false);

  for (let i = 0; i < 100; i += 1) {
    const job = jobs.get(created.id);
    if (job.status === 'success' || job.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const job = jobs.get(created.id);
  assert.equal(job.status, 'success', job.error);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tenant, 't1');
  assert.equal(seen[0].channelId, 'ch-t1', '不能用默认租户或 t2 的渠道');
  assert.equal(tenantContext.current(), '', '泵结束后不应把租户上下文泄漏到外部');
});

test.after(() => {
  jobs.flushState();
  try { workbenchStore.store().close(); } catch { /* ignore */ }
  db.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 上偶发占用，忽略 */ }
});
