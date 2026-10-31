'use strict';
/* 音色库：扫描目录 → 列表 → 试听 → 复制进音频槽 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 18930;
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 20000) {
  const start = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await sleep(250);
  }
}

function wav(seconds = 1, rate = 8000) {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test('音色库：扫描、分组、选中后复制进音频槽', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-voices-'));
  const library = path.join(tmp, '800+音色', '影视角色');
  fs.mkdirSync(library, { recursive: true });
  fs.writeFileSync(path.join(library, '云小馨.wav'), wav(1.2));
  fs.writeFileSync(path.join(library, '老村长-低音、厚实、强壮.wav'), wav(2.4));
  fs.writeFileSync(path.join(library, '说明.txt'), 'not audio');

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
      body: JSON.stringify({
        saveFolder: path.join(tmp, 'media'),
        assetFolder: path.join(tmp, 'assets'),
        voiceLibraryFolder: path.join(tmp, '800+音色'),
      }),
    });

    const lib = await (await fetch(base + '/api/voice-library')).json();
    assert.equal(lib.ok, true);
    assert.equal(lib.data.total, 2, '只统计音频文件');
    assert.ok(lib.data.groups.some((g) => g.name === '影视角色' && g.count === 2));

    const xiaoxin = lib.data.items.find((i) => i.speaker === '云小馨');
    assert.ok(xiaoxin, '应该解析出音色名');
    assert.ok(Math.abs(xiaoxin.seconds - 1.2) < 0.2, '应该解析出时长：' + xiaoxin.seconds);
    assert.equal(xiaoxin.group, '影视角色');

    const lao = lib.data.items.find((i) => i.speaker.startsWith('老村长'));
    assert.ok(lao, '带描述的音色名应该切出来');
    assert.ok(lao.note.includes('低音'), '描述应保留在 note');

    const preview = await fetch(base + '/api/voice-library/audio?id=' + xiaoxin.id);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-type') || '', /audio\/wav/);

    const picked = await (await fetch(base + '/api/voice-library/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: xiaoxin.id }),
    })).json();
    assert.equal(picked.ok, true, JSON.stringify(picked));
    assert.ok(fs.existsSync(picked.data.path), '样本应该复制进 uploads/voice');
    assert.equal(picked.data.voice, '云小馨');
    assert.equal(picked.data.kind, 'audio');
    assert.ok(picked.data.seconds > 1);
    assert.ok(picked.data.path.includes(path.join('uploads', 'voice')));

    const missing = await (await fetch(base + '/api/voice-library/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'nope' }),
    })).json();
    assert.equal(missing.ok, false);
  } finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
