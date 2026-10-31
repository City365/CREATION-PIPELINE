'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let i = 0; i < 150; i++) {
    try { const v = await fn(); if (v) return v; } catch { /* 继续等 */ }
    await delay(100);
  }
  throw new Error('等待超时');
}

test('导入本地成片：落到 media/日期/import-xxx/，媒体库能按任务名认出', { timeout: 40000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-media-import-'));
  const base = 'http://127.0.0.1:18977';
  const child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
    env: { ...process.env, WMD_DATA_DIR: dir, WMD_PORT: '18977', WMD_AGENT_AUTOSTART: '0' },
    stdio: 'ignore',
    windowsHide: true,
  });
  const api = async (url, init) => {
    const res = await fetch(base + url, init || {});
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(JSON.stringify(json));
    return json.data;
  };
  try {
    await until(async () => (await fetch(base + '/api/health')).ok);

    // 假的 mp4 内容就够：这条链路只关心落盘位置、params.json 和媒体库索引
    const payload = Buffer.alloc(2048, 7);
    const query = new URLSearchParams({ name: '我自己的镜头 07.mp4', taskTitle: '首尔没有忘记你', shotLabel: '镜头 07' });
    const saved = await api('/api/media/import?' + query.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4' },
      body: payload,
    });
    assert.equal(saved.name, '我自己的镜头 07.mp4');
    assert.equal(saved.bytes, payload.length);
    assert.equal(saved.kind, 'video');
    assert.match(saved.day, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(saved.path.replace(/\\/g, '/'), /\/\d{4}-\d{2}-\d{2}\/import-[0-9a-f]+\/我自己的镜头 07\.mp4$/);
    assert.ok(fs.existsSync(saved.path), '文件应真的落盘');
    assert.deepEqual(fs.readFileSync(saved.path), payload);

    const params = JSON.parse(fs.readFileSync(path.join(path.dirname(saved.path), 'params.json'), 'utf8'));
    assert.equal(params.taskTitle, '首尔没有忘记你');
    assert.equal(params.shotLabel, '镜头 07');
    assert.equal(params.title, '镜头 07');
    assert.equal(params.imported, true);
    assert.equal(params.workflow, '手工导入');

    const media = await api('/api/media?kind=video');
    const item = media.items.find((row) => row.path === saved.path);
    assert.ok(item, '媒体库应能列出刚导入的成片');
    assert.equal(item.taskTitle, '首尔没有忘记你');
    assert.equal(item.shotLabel, '镜头 07');
    assert.equal(item.kind, 'video');
    assert.equal(item.rel, saved.rel);

    // 不写分镜名时，用文件名兜底
    const plain = await api('/api/media/import?' + new URLSearchParams({ name: '临时片段.mp4' }).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4' },
      body: payload,
    });
    const plainParams = JSON.parse(fs.readFileSync(path.join(path.dirname(plain.path), 'params.json'), 'utf8'));
    assert.equal(plainParams.shotLabel, '临时片段');
    assert.equal(plainParams.taskTitle, '');

    // 不支持的类型直接拒绝，不建目录
    const before = fs.readdirSync(path.resolve(media.root)).length;
    const res = await fetch(base + '/api/media/import?name=note.txt', { method: 'POST', body: 'hello' });
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.match(json.error, /只支持导入/);
    assert.equal(fs.readdirSync(path.resolve(media.root)).length, before);
  } finally {
    child.kill();
    await delay(150);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ }
  }
});
