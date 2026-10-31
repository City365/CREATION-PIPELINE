'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMockCloud, PNG } = require('./mock-cloud');

const PORT = 18927;
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 40000) {
  const start = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await sleep(300);
  }
}

const PROMPT = `subject_definitions:
<Subject 1> is A from <Picture 1>.
summary:
[reference generation] Test.
retention_analysis:
<Subject 1>: fully_preserved - face.
detailed_description:
[Shot 1] A wide shot.
overall_soundscape:
Wind.
non_diegetic_music:
N/A`;

test('自定义视频渠道：OpenAI 视频兼容 + 通用任务式', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-gvideo-'));
  const mock = await startMockCloud();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, APPDATA: path.join(tmp, 'appdata'), WMD_PORT: String(PORT), WMD_DATA_DIR: path.join(tmp, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${PORT}`;
  try {
    await waitFor(async () => (await fetch(base + '/api/health')).ok, 15000);
    await fetch(base + '/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saveFolder: path.join(tmp, 'media'), assetFolder: path.join(tmp, 'assets'), concurrency: 2 }),
    });
    const upload = await fetch(base + '/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a.png', data: 'data:image/png;base64,' + PNG.toString('base64') }),
    }).then((r) => r.json());
    assert.ok(upload.ok);

    const mk = async (body) => {
      const res = await fetch(base + '/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'video', ...body }),
      }).then((r) => r.json());
      assert.ok(res.ok, JSON.stringify(res));
      return res.data;
    };

    const openai = await mk({
      type: 'openai-video',
      name: 'mock sora',
      baseUrl: mock.url + '/v1',
      apiKey: 'sk-video',
      model: 'mock-video-model',
      options: { seconds: 8, size: '1280x720' },
    });
    assert.equal(openai.active, true);

    const state = await fetch(base + '/api/state').then((r) => r.json());
    const synthetic = state.data.workflows.find((w) => w.id === 'ch:' + openai.id);
    assert.ok(synthetic, '工作流列表里没有合成渠道条目');
    assert.equal(synthetic.provider, 'generic');

    const createJob = async (workflowId) => {
      const res = await fetch(base + '/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId,
          prompt: PROMPT,
          images: [{ path: upload.data.path, name: upload.data.name }],
          audios: [],
          duration: 8,
          aspectRatio: '16:9 (Widescreen)',
          count: 1,
        }),
      }).then((r) => r.json());
      assert.ok(res.ok, JSON.stringify(res));
      return res.data.jobs[0].id;
    };

    const waitJob = async (id) => waitFor(async () => {
      const list = await fetch(base + '/api/jobs').then((r) => r.json());
      const hit = list.data.jobs.find((j) => j.id === id);
      return hit && (hit.status === 'success' || hit.status === 'failed') ? hit : null;
    }, 45000);

    const job1 = await waitJob(await createJob('ch:' + openai.id));
    assert.equal(job1.status, 'success', job1.error || '');
    assert.ok(fs.existsSync(job1.outputs[0].path));
    assert.equal(mock.state.videoRequests.length, 1);
    assert.equal(mock.state.videoRequests[0].model, 'mock-video-model');
    assert.equal(mock.state.videoRequests[0].seconds, '8');
    assert.match(mock.state.videoRequests[0].input_reference, /^data:image\/png;base64,/);

    const generic = await mk({
      type: 'generic-task',
      name: 'mock task',
      baseUrl: mock.url,
      apiKey: 'sk-task',
      model: 'task-model',
      options: {
        submitPath: '/v1/tasks',
        pollPath: '/v1/tasks/{id}',
        bodyTemplate: '{"model":"{model}","prompt":"{prompt}","duration":{duration},"image":"{image0}"}',
        idPath: 'data.task_id',
        statusPath: 'data.status',
        resultPath: 'data.result.video_url',
      },
    });
    const job2 = await waitJob(await createJob('ch:' + generic.id));
    assert.equal(job2.status, 'success', job2.error || '');
    assert.ok(fs.existsSync(job2.outputs[0].path));
    const req = mock.state.taskRequests[0];
    assert.equal(req.model, 'task-model');
    assert.equal(req.duration, 8);
    assert.match(req.image, /^data:image\/png;base64,/);
  } finally {
    child.kill();
    mock.server.close();
    await sleep(300);
  }
});

