'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const value = await fn(); if (value) return value; } catch { /* 继续等 */ }
    await delay(100);
  }
  throw new Error('等待超时');
}

test('成片维护：重命名 / 删除进 _trash / 上传补片 / 替换成片', { timeout: 40000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-job-output-'));
  const mediaDir = path.join(dir, 'media', '2026-10-29', 'job-out-1');
  fs.mkdirSync(mediaDir, { recursive: true });
  const original = path.join(mediaDir, '镜头 01.mp4');
  fs.writeFileSync(original, Buffer.from('ORIGINAL-VIDEO-BYTES'));
  fs.writeFileSync(path.join(mediaDir, 'params.json'), JSON.stringify({
    id: 'job-out-1', taskTitle: '成片维护', shotLabel: '镜头 01',
    outputs: [{ type: 'video', file: '镜头 01.mp4', bytes: 20 }],
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify({
    version: 1,
    jobs: [{
      id: 'job-out-1', provider: 'local', workflowId: 'wf-local', status: 'success', stage: '完成', progress: 100,
      title: '镜头 01', shotLabel: '镜头 01', taskTitle: '成片维护', prompt: 'seed',
      createdAt: 1, finishedAt: 2, outputDir: mediaDir,
      outputs: [{ type: 'video', name: '镜头 01.mp4', path: original, bytes: 20, url: '' }],
    }],
  }, null, 2));

  const base = 'http://127.0.0.1:18979';
  const child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
    env: { ...process.env, WMD_DATA_DIR: dir, WMD_PORT: '18979', WMD_AGENT_AUTOSTART: '0' },
    stdio: 'ignore',
    windowsHide: true,
  });
  const post = async (url, body, raw) => {
    const init = raw
      ? { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: raw }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) };
    const res = await fetch(base + url, init);
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(JSON.stringify(json));
    return json.data;
  };
  const jobState = () => JSON.parse(fs.readFileSync(path.join(dir, 'jobs.json'), 'utf8')).jobs.find((job) => job.id === 'job-out-1');
  const params = () => JSON.parse(fs.readFileSync(path.join(mediaDir, 'params.json'), 'utf8'));
  try {
    await until(async () => (await fetch(base + '/api/health')).ok);

    // 重命名：文件和两处记录一起改
    const renamed = await post('/api/jobs/job-out-1/output/rename?path=' + encodeURIComponent(original), { name: '抢救室-定稿' });
    await delay(250); // jobs.json 是延迟落盘，等它写完再读文件校验
    assert.equal(renamed.out.name, '抢救室-定稿.mp4');
    const renamedPath = path.join(mediaDir, '抢救室-定稿.mp4');
    assert.ok(fs.existsSync(renamedPath), '文件应该改成新名字');
    assert.equal(fs.existsSync(original), false);
    assert.equal(jobState().outputs[0].name, '抢救室-定稿.mp4');
    assert.equal(params().outputs[0].file, '抢救室-定稿.mp4');

    // 替换：旧文件进 _trash，新内容顶到原位
    const replaced = await post('/api/jobs/job-out-1/output/replace?path=' + encodeURIComponent(renamedPath) + '&name=' + encodeURIComponent('镜头 01.mp4'), {}, Buffer.from('REPLACED-VIDEO-BYTES-123456'));
    await delay(250);
    assert.equal(replaced.out.name, '镜头 01.mp4');
    const replacedPath = path.join(mediaDir, '镜头 01.mp4');
    assert.equal(fs.readFileSync(replacedPath, 'utf8'), 'REPLACED-VIDEO-BYTES-123456');
    assert.ok(replaced.parked && fs.existsSync(replaced.parked), '旧成片要挪进 _trash');
    assert.match(replaced.parked.replace(/\\/g, '/'), /\/_trash\/\d{4}-\d{2}-\d{2}\//);
    assert.equal(jobState().outputs[0].bytes, Buffer.byteLength('REPLACED-VIDEO-BYTES-123456'));

    // 删除：文件消失、进 _trash、输出记录清空
    const deleted = await post('/api/jobs/job-out-1/output/delete?path=' + encodeURIComponent(replacedPath), {});
    await delay(250);
    assert.equal(fs.existsSync(replacedPath), false);
    assert.ok(deleted.parked && fs.existsSync(deleted.parked));
    assert.equal(jobState().outputs.length, 0);
    assert.deepEqual(params().outputs, []);

    // 上传补片：原本没成片也能加一条
    const added = await post('/api/jobs/job-out-1/output/add?name=' + encodeURIComponent('补拍.mp4'), {}, Buffer.from('MANUAL-UPLOAD-BYTES'));
    await delay(250);
    assert.equal(added.out.name, '补拍.mp4');
    assert.ok(fs.existsSync(added.out.path));
    assert.equal(jobState().outputs.length, 1);
    assert.equal(params().outputs[0].file, '补拍.mp4');

    // 不存在的 job / 不存在的输出要报错
    const badJob = await fetch(base + '/api/jobs/nope/output/delete?path=' + encodeURIComponent(added.out.path), { method: 'POST' });
    assert.equal((await badJob.json()).ok, false);
    const badOut = await fetch(base + '/api/jobs/job-out-1/output/delete?path=' + encodeURIComponent(path.join(mediaDir, '不存在的.mp4')), { method: 'POST' });
    assert.equal((await badOut.json()).ok, false);
  } finally {
    child.kill();
    await delay(150);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ }
  }
});
