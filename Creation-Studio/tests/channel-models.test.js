'use strict';
/* 渠道模型列表 + token 限制：/api/channels/models、限制持久化、上下文裁剪 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMockCloud } = require('./mock-cloud');

const PORT = 18932;
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

test('渠道模型列表 + 最大输出/上下文限制', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-models-'));
  const mock = await startMockCloud();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, APPDATA: path.join(tmp, 'appdata'), WMD_PORT: String(PORT), WMD_DATA_DIR: path.join(tmp, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${PORT}`;
  const json = async (url, opts) => (await fetch(base + url, opts)).json();
  const post = (url, body) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    await waitFor(async () => (await fetch(base + '/api/health')).ok, 15000);

    // 1. 拉模型列表（mock 的 /models）
    const models = await post('/api/channels/models', { kind: 'llm', type: 'openai-chat', baseUrl: mock.url + '/v1', apiKey: 'test' });
    assert.equal(models.ok, true, JSON.stringify(models));
    assert.ok(models.data.models.includes('mock-model'), '应该拿到 mock 模型：' + JSON.stringify(models.data.models));

    const noUrl = await post('/api/channels/models', { kind: 'llm', baseUrl: '', apiKey: 'x' });
    assert.equal(noUrl.ok, false, '没填 Base URL 要报错');

    // 2. 建渠道时带限制
    const created = await post('/api/channels', {
      kind: 'llm', type: 'openai-chat', name: '带限制的模型',
      baseUrl: mock.url + '/v1', apiKey: 'test', model: 'mock-model',
      maxTokens: 2048, contextWindow: 128000,
    });
    assert.equal(created.ok, true);
    assert.equal(created.data.maxTokens, 2048);
    assert.equal(created.data.contextWindow, 128000);

    // 3. 超出上下文：单条消息就装不下 → 直接报错
    const tooBig = await post('/api/llm/chat', {
      messages: [{ role: 'user', content: '啊'.repeat(4000) }],
      channelId: created.data.id,
      // 该渠道 contextWindow 是 128000，这里临时改成很小来触发
    });
    assert.equal(tooBig.ok, true, '128k 上下文时 4000 字应该还能发');

    // 用一个上下文很小的渠道验证裁剪/报错
    const tiny = await post('/api/channels', {
      kind: 'llm', type: 'openai-chat', name: '小上下文',
      baseUrl: mock.url + '/v1', apiKey: 'test', model: 'mock-model',
      maxTokens: 256, contextWindow: 1200,
    });
    const over = await post('/api/llm/chat', {
      messages: [{ role: 'user', content: '啊'.repeat(3000) }],
      channelId: tiny.data.id,
    });
    assert.equal(over.ok, false, '超预算应报错');
    assert.match(over.error || '', /超过当前渠道可用的/, over.error);

    // 4. 正常对话时把 max_tokens 传给上游
    mock.state.chatRequests.length = 0;
    const sent = await post('/api/llm/chat', {
      messages: [{ role: 'user', content: '你好' }],
      channelId: created.data.id,
    });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.ok(sent.data.usage, '应该返回 usage 信息');
    assert.equal(sent.data.usage.maxTokens, 2048);
    const request = mock.state.chatRequests.at(-1);
    assert.equal(request.max_tokens, 2048, '应带 max_tokens=2048');

    // 5. 历史裁剪：塞很多条，usage.trimmed > 0
    const longHistory = [];
    for (let i = 0; i < 30; i += 1) longHistory.push({ role: i % 2 ? 'assistant' : 'user', content: '内容'.repeat(400) });
    longHistory.push({ role: 'user', content: '最后一句' });
    const trimmedRes = await post('/api/llm/chat', {
      messages: longHistory,
      channelId: tiny.data.id,
    });
    assert.equal(trimmedRes.ok, true, JSON.stringify(trimmedRes));
    assert.ok(trimmedRes.data.usage.trimmed > 0, '应该裁掉一部分历史：' + JSON.stringify(trimmedRes.data.usage));
  } finally {
    child.kill();
    mock.server.close();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
