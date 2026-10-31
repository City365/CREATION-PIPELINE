'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const value = await fn(); if (value) return value; } catch { /* 继续等 */ }
    await delay(100);
  }
  throw new Error('等待超时');
}

test('任务清单 JSON：任务 → 镜头 → 提示词 → 成片路径 的完整映射', { timeout: 40000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-manifest-'));
  const mediaDir = path.join(dir, 'media', '2026-10-29', 'job-mf-1');
  fs.mkdirSync(mediaDir, { recursive: true });
  const videoA = path.join(mediaDir, '镜头 01.mp4');
  const videoB = path.join(mediaDir, '镜头 02.mp4');
  fs.writeFileSync(videoA, Buffer.alloc(1024, 1));
  fs.writeFileSync(videoB, Buffer.alloc(2048, 2));
  fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify({
    version: 1,
    jobs: [
      {
        id: 'job-mf-1', provider: 'local', workflowId: 'wf', status: 'success', stage: '完成', progress: 100,
        title: '镜头 01', shotLabel: '镜头 01', taskTitle: '首尔没有忘记你', eventId: 'evt_mf_1', eventItemId: 'evt_mf_1_i1',
        remotePromptId: 'remote-001', createdAt: 1000, startedAt: 1100, finishedAt: 2100, outputDir: mediaDir,
        outputs: [{ type: 'video', name: '镜头 01.mp4', path: videoA, bytes: 1024, url: '' }],
      },
      {
        id: 'job-mf-2', provider: 'local', workflowId: 'wf', status: 'success', stage: '完成', progress: 100,
        title: '镜头 02', shotLabel: '镜头 02', taskTitle: '首尔没有忘记你', eventId: 'evt_mf_1', eventItemId: 'evt_mf_1_i2',
        createdAt: 1000, startedAt: 1200, finishedAt: 2200, outputDir: mediaDir,
        outputs: [{ type: 'video', name: '镜头 02.mp4', path: videoB, bytes: 2048, url: '' }],
      },
      {
        id: 'job-mf-3', provider: 'local', workflowId: 'wf', status: 'failed', stage: '失败', progress: 0,
        title: '镜头 03', shotLabel: '镜头 03', taskTitle: '首尔没有忘记你', eventId: 'evt_mf_1', eventItemId: 'evt_mf_1_i3',
        createdAt: 1000, error: '平台失败', outputs: [],
      },
    ],
  }, null, 2));

  const event = {
    schemaVersion: 2, version: 1, id: 'evt_mf_1', title: '首尔没有忘记你', kind: 'video', source: 'batch',
    status: 'partial', spec: { projectId: '', items: [] }, audit: [], createdAt: 1000, finishedAt: 3000,
    items: [
      {
        id: 'evt_mf_1_i1', refType: 'job', refId: 'job-mf-1', title: '镜头 01', shotLabel: '镜头 01', status: 'queued', attempts: 2,
        input: { prompt: '前置\n\n镜头一的提示词', userPrompt: '镜头一的提示词', prefixPrompt: '前置', ratio: '16:9', duration: 15, images: [{ path: 'D:/素材/人物/女主.jpg', name: '女主.jpg', note: '<Picture 1>' }] },
      },
      {
        id: 'evt_mf_1_i2', refType: 'job', refId: 'job-mf-2', title: '镜头 02', shotLabel: '镜头 02', status: 'queued',
        input: { prompt: '镜头二的提示词', userPrompt: '镜头二的提示词', ratio: '16:9', duration: 10 },
      },
      {
        id: 'evt_mf_1_i3', refType: 'job', refId: 'job-mf-3', title: '镜头 03', shotLabel: '镜头 03', status: 'queued',
        input: { prompt: '镜头三的提示词', userPrompt: '镜头三的提示词' },
      },
    ],
  };
  const db = new DatabaseSync(path.join(dir, 'task-events.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS task_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,project_id TEXT NOT NULL,created_at INTEGER NOT NULL,payload TEXT NOT NULL)');
  db.prepare('INSERT OR REPLACE INTO task_events VALUES(?,?,?,?,?)').run(event.id, 'video', '', event.createdAt, JSON.stringify(event));
  db.close();

  const base = 'http://127.0.0.1:18982';
  const child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
    env: { ...process.env, WMD_DATA_DIR: dir, WMD_PORT: '18982', WMD_AGENT_AUTOSTART: '0' },
    stdio: 'ignore',
    windowsHide: true,
  });
  const call = async (url, init) => {
    const res = await fetch(base + url, init || {});
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(JSON.stringify(json));
    return json.data;
  };
  try {
    await until(async () => (await fetch(base + '/api/health')).ok);
    const manifest = await until(async () => {
      const data = await call('/api/tasks/manifest?kind=video');
      return data && data.tasks.length ? data : null;
    });

    assert.equal(manifest.version, 1);
    assert.deepEqual(manifest.counts, { tasks: 1, shots: 3, videos: 2 });
    const task = manifest.tasks[0];
    assert.equal(task.eventId, 'evt_mf_1');
    assert.equal(task.title, '首尔没有忘记你');
    assert.equal(task.shotCount, 3);
    assert.equal(task.videoCount, 2);

    const [first, second, third] = task.shots;
    assert.equal(first.index, 1);
    assert.equal(first.shotLabel, '镜头 01');
    assert.equal(first.status, 'success');
    assert.equal(first.jobId, 'job-mf-1');
    assert.equal(first.remotePromptId, 'remote-001');
    assert.equal(first.attempts, 2);
    assert.equal(first.userPrompt, '镜头一的提示词');
    assert.equal(first.prefixPrompt, '前置');
    assert.equal(first.ratio, '16:9');
    assert.equal(first.duration, 15);
    assert.equal(first.images[0].name, '女主.jpg');
    assert.equal(first.video.path, videoA);
    assert.equal(first.video.name, '镜头 01.mp4');
    assert.equal(first.video.bytes, 1024);
    assert.equal(first.video.exists, true);
    assert.equal(first.durationMs, 1000);

    assert.equal(second.index, 2);
    assert.equal(second.video.path, videoB);
    assert.equal(second.video.bytes, 2048);

    assert.equal(third.index, 3);
    assert.equal(third.status, 'failed');
    assert.equal(third.video, null, '没成片的镜头 video 要是 null');
    assert.equal(third.error, '平台失败');

    // 落盘一份到项目 exports/任务清单/
    const saved = await call('/api/tasks/manifest/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'video' }),
    });
    assert.ok(fs.existsSync(saved.file), '清单文件要真的写出来');
    assert.match(saved.file.replace(/\\/g, '/'), /\/exports\/任务清单\/任务清单_\d{8}-\d{6}\.json$/);
    const written = JSON.parse(fs.readFileSync(saved.file, 'utf8'));
    assert.deepEqual(written.counts, { tasks: 1, shots: 3, videos: 2 });
    assert.equal(written.tasks[0].shots[0].video.path, videoA);

    // 成片被删掉后清单仍能给出记录，但 exists=false
    fs.rmSync(videoB);
    const again = await call('/api/tasks/manifest?kind=video');
    assert.equal(again.tasks[0].shots[1].video.exists, false);
    assert.deepEqual(again.counts, { tasks: 1, shots: 3, videos: 1 });
  } finally {
    child.kill();
    await delay(150);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ }
  }
});
