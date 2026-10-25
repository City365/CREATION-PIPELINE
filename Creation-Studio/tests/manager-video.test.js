'use strict';
/* 外接管理器：豆包 / Gemini 视频任务全流程（mock 管理器服务） */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = 18933;
const MANAGER_PORT = 18934;
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await sleep(300);
  }
}

const MP4 = Buffer.concat([Buffer.from('000000206674797069736f6d0000020069736f6d', 'hex'), Buffer.alloc(2048, 0x11)]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function startMockManager() {
  const state = { tasks: [], submits: [], polls: 0, auth: '', failDownloadOnce: true };
  const server = http.createServer((req, res) => {
    const send = (code, payload, type = 'application/json') => {
      const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
      res.writeHead(code, { 'Content-Type': type, 'Content-Length': body.length });
      res.end(body);
    };
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/health') return send(200, { ok: true, version: '0.1.0', service: 'mock-manager' });
    state.auth = String(req.headers.authorization || '');
    if (state.auth !== 'Bearer test-token') return send(401, { error: '本地连接凭据无效' });
    if (url.pathname === '/api/state') {
      return send(200, {
        accounts: [
          { id: 'acc-doubao', name: '豆包账号1', platform: 'doubao', enabled: true },
          { id: 'acc-gemini', name: 'Gemini账号1', platform: 'gemini', enabled: true },
        ],
        tasks: state.tasks,
      });
    }
    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw); } catch { /* ignore */ }
        state.submits.push(body);
        const task = { id: 'mgr-task-1', status: 'queued', progress: 5, message: '等待可用账号', platform: body.platform, accountId: body.accountId };
        state.tasks.push(task);
        send(201, task);
      });
      return;
    }
    const taskRoute = /^\/api\/tasks\/([^/]+)(?:\/(file))?$/.exec(url.pathname);
    if (taskRoute) {
      if (taskRoute[2] === 'file') {
        if (state.failDownloadOnce) { state.failDownloadOnce = false; return send(503, {error:'temporary download failure'}); }
        return send(200, MP4, 'video/mp4');
      }
      state.polls += 1;
      const task = state.tasks[0] || {};
      if (state.polls >= 2) {
        task.status = 'completed';
        task.progress = 100;
        task.message = '已下载并校验';
        task.result = { path: 'D:/fake/out.mp4', bytes: MP4.length };
      } else {
        task.status = 'running';
        task.progress = 40;
        task.message = '生成中';
      }
      return send(200, task);
    }
    return send(404, { error: '接口不存在' });
  });
  return new Promise((resolve) => server.listen(MANAGER_PORT, '127.0.0.1', () => resolve({ server, state })));
}

test('外接管理器：豆包 / Gemini 视频任务跑通', { timeout: 90000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-manager-'));
  const manager = await startMockManager();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      APPDATA: path.join(tmp, 'appdata'),
      H3_PORT: String(PORT),
      H3_DATA_DIR: path.join(tmp, 'data'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${PORT}`;
  const json = async (url, opts) => (await fetch(base + url, opts)).json();
  const post = (url, body) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    await waitFor(async () => (await fetch(base + '/api/health')).ok, 15000);
    await fetch(base + '/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saveFolder: path.join(tmp, 'media'), assetFolder: path.join(tmp, 'assets'), concurrency: 2 }),
    });

    const created = await post('/api/channels', {
      kind: 'video',
      type: 'manager-video',
      name: '本机管理器',
      baseUrl: `http://127.0.0.1:${MANAGER_PORT}`,
      apiKey: 'test-token',
      options: { accountId: '' },
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    const channel = created.data;

    const testRes = await post(`/api/channels/${channel.id}/test`, { kind: 'video' });
    assert.equal(testRes.ok, true);
    assert.equal(testRes.data.ok, true, JSON.stringify(testRes.data));
    assert.match(testRes.data.message, /豆包账号 1 个/);

    const state = await json('/api/state');
    const models = state.data.workflows.filter((w) => w.channelId === channel.id);
    assert.equal(models.length, 2, '一个管理器渠道应派生豆包 + Gemini 两个视频模型');
    const doubao = models.find((w) => w.platform === 'doubao');
    const gemini = models.find((w) => w.platform === 'gemini');
    assert.ok(doubao && gemini);
    assert.deepEqual(gemini.durationOptions, [10]);
    assert.deepEqual(gemini.ratios, ['16:9', '9:16']);

    const refPath = path.join(tmp, 'ref.png');
    fs.writeFileSync(refPath, PNG);
    const jobRes = await post('/api/jobs', {
      workflowId: doubao.id,
      prompt: '雪山寺庙门口，两人相遇，镜头缓推',
      images: [{ path: refPath, name: 'ref.png' }],
      audios: [],
      duration: 10,
      aspectRatio: '16:9',
      count: 1,
    });
    assert.equal(jobRes.ok, true, JSON.stringify(jobRes));
    const jobId = jobRes.data.jobs[0].id;

    let done = await waitFor(async () => {
      const list = await json('/api/jobs');
      const job = list.data.jobs.find((j) => j.id === jobId);
      if (job && ['success', 'failed'].includes(job.status)) return job;
      return null;
    }, 45000);
    assert.equal(done.status, 'failed', '首次下载故障应保留远程任务');
    const originalRemote = done.remotePromptId;
    const continued = await post('/api/jobs/' + jobId + '/resume', {});
    assert.equal(continued.ok, true, JSON.stringify(continued));
    done = await waitFor(async () => {
      const job = (await json('/api/jobs')).data.jobs.find(j => j.id === jobId);
      return ['success','failed'].includes(job.status) ? job : null;
    }, 45000);
    assert.equal(done.status, 'success', done.error || '继续下载应成功');
    assert.equal(done.remotePromptId, originalRemote);
    assert.equal(manager.state.submits.length, 1, '继续下载不能重新提交生成');
    assert.ok(done.outputs.length === 1, '应该有一个成片输出');
    assert.ok(fs.existsSync(done.outputs[0].path), '成片应该落盘');
    assert.equal(fs.readFileSync(done.outputs[0].path).length, MP4.length);

    const submit = manager.state.submits.at(-1);
    assert.equal(submit.platform, 'doubao');
    assert.equal(submit.accountId, undefined, '留空账号应由管理器自动选号');
    assert.equal(submit.duration, 10);
    assert.equal(submit.ratio, '16:9');
    assert.deepEqual(submit.references, [refPath]);
    assert.ok(submit.prompt.includes('雪山寺庙'));

    // Gemini 参数：不带 duration / resolution / model
    const geminiJob = await post('/api/jobs', {
      workflowId: gemini.id,
      prompt: '雨夜街头，霓虹灯倒影',
      images: [],
      audios: [],
      duration: 10,
      aspectRatio: '9:16',
      count: 1,
    });
    assert.equal(geminiJob.ok, true, JSON.stringify(geminiJob));
    const gid = geminiJob.data.jobs[0].id;
    const gdone = await waitFor(async () => {
      const list = await json('/api/jobs');
      const job = list.data.jobs.find((j) => j.id === gid);
      if (job && ['success', 'failed'].includes(job.status)) return job;
      return null;
    }, 45000);
    assert.equal(gdone.status, 'success', 'Gemini 任务应成功：' + (gdone.error || ''));
    const gsubmit = manager.state.submits.at(-1);
    assert.equal(gsubmit.platform, 'gemini');
    assert.equal(gsubmit.accountId, undefined, 'Gemini 留空账号同样自动选号');
    assert.equal(gsubmit.ratio, '9:16');
    assert.equal(gsubmit.duration, undefined, 'Gemini 不应带时长');
    assert.equal(gsubmit.resolution, undefined, 'Gemini 不应带清晰度');
    assert.equal(gsubmit.model, undefined, 'Gemini 不应带模型');
  } finally {
    child.kill();
    manager.server.close();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('留空账号时交给管理器自动选号，只有指定账号才钉死', async () => {
  const manager = await startMockManager();
  const { submit } = require('../src/manager-video');
  const base = { baseUrl: `http://127.0.0.1:${MANAGER_PORT}`, apiKey: 'test-token' };
  const job = (id) => ({ id, prompt: '雪山寺庙', images: [], duration: 10, aspectRatio: '16:9' });
  try {
    const auto = await submit({ ...base, options: {} }, job('job-auto'), 'doubao');
    assert.equal(auto.account.name, '豆包账号1');
    assert.equal(manager.state.submits[0].accountId, undefined, '留空时不传 accountId，交给管理器换号');
    const pinned = await submit({ ...base, options: { accountId: 'acc-doubao' } }, job('job-pin'), 'doubao');
    assert.equal(pinned.account.id, 'acc-doubao');
    assert.equal(manager.state.submits[1].accountId, 'acc-doubao', '明确指定的账号仍然钉死');
  } finally {
    manager.server.close();
    await sleep(100);
  }
});
