'use strict';
/* 内置音色：列出发音人 + 合成一段 WAV（Windows System.Speech，离线） */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 18929;
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

test('内置音色：列出发音人并合成 WAV', { timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-tts-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, APPDATA: path.join(tmp, 'appdata'), H3_PORT: String(PORT), H3_DATA_DIR: path.join(tmp, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${PORT}`;
  try {
    await waitFor(async () => (await fetch(base + '/api/health')).ok, 15000);
    await fetch(base + '/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saveFolder: path.join(tmp, 'media'), assetFolder: path.join(tmp, 'assets') }),
    });

    const voicesRes = await (await fetch(base + '/api/voices')).json();
    assert.equal(voicesRes.ok, true);
    assert.equal(voicesRes.data.engine, 'sapi');
    assert.ok(Array.isArray(voicesRes.data.voices));
    assert.ok(voicesRes.data.voices.length > 0, '应该有至少一个系统语音包');
    assert.ok(voicesRes.data.voices.every((v) => v.id && v.label));

    const zh = voicesRes.data.voices.find((v) => v.zh) || voicesRes.data.voices[0];
    const ttsRes = await (await fetch(base + '/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '师姐，我们快到了。', voice: zh.id, rate: 0 }),
    })).json();
    assert.equal(ttsRes.ok, true, JSON.stringify(ttsRes));
    const item = ttsRes.data;
    assert.ok(fs.existsSync(item.path), '音频文件应该落盘');
    assert.ok(item.bytes > 1000, 'WAV 应该比空文件大');
    assert.ok(item.seconds > 0.3, '应该解析出时长');
    assert.equal(item.voice, zh.id);
    assert.ok(item.name.endsWith('.wav'));

    const empty = await (await fetch(base + '/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    })).json();
    assert.equal(empty.ok, false, '空文本应该报错');
  } finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
