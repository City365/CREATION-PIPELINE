'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveGeneratedMedia } = require('../src/automation');

const page = (official = null) => ({ evaluate: async () => official });
const state = (media = []) => ({ replies: [{ id: '59334279665907970' }, { id: '59333689176907010' }], media });
const task = (extra = {}) => ({ platform: 'doubao', removeWatermark: true, ...extra });
const fallbackMiss = async () => ({ url: '', diagnostics: [{ messageId: '59334279665907970', error: 'HTTP 403' }], matchedApis: 1 });
const fallbackHit = async () => ({ url: 'https://v26-vdl.doubao.com/x/video/?lr=unwatermarked', messageId: '59334279665907970', diagnostics: [{ messageId: '59334279665907970', status: 200, resolved: true }], matchedApis: 1 });

test('豆包下载优先使用 fallback_api 无水印原片，并记录归属与诊断', async () => {
  let evaluateCalls = 0;
  const plan = await resolveGeneratedMedia({
    page: { evaluate: async () => { evaluateCalls += 1; return null; } },
    state: state([{ url: 'https://page/video.mp4', ready: true, confirmedNoWatermark: false, messageId: '59333689176907010', messageKey: 'k' }]),
    task: task(), anchorKey: 'anchor-1', signal: new AbortController().signal, resolveFallback: fallbackHit
  });
  assert.equal(plan.media.method, 'fallback-api-unwatermarked');
  assert.equal(plan.media.url, 'https://v26-vdl.doubao.com/x/video/?lr=unwatermarked');
  assert.deepEqual(plan.ownership, { userKey: 'anchor-1', messageIds: ['59334279665907970'] });
  assert.equal(plan.diagnostics[0].method, 'fallback-api');
  assert.equal(plan.diagnostics[0].matchedApis, 1);
  assert.equal(evaluateCalls, 0);
});

test('fallback 未命中且要求无水印时改用官方节点接口', async () => {
  const plan = await resolveGeneratedMedia({
    page: page({ mainUrl: 'https://v26-videoweb.doubao.com/explicit.mp4', nodeId: 'node-9' }),
    state: state(), task: task(), anchorKey: 'anchor-1',
    signal: new AbortController().signal, resolveFallback: fallbackMiss
  });
  assert.equal(plan.media.method, 'official-no-watermark');
  assert.equal(plan.media.nodeId, 'node-9');
  assert.equal(plan.diagnostics[0].results[0].error, 'HTTP 403');
});

test('要求无水印时，页面视频必须被页面明确标记才可采用', async () => {
  const unconfirmed = await resolveGeneratedMedia({
    page: page(null), state: state([{ url: 'https://page/a.mp4', ready: true, confirmedNoWatermark: false, messageId: '1', messageKey: 'k' }]),
    task: task(), signal: new AbortController().signal, resolveFallback: fallbackMiss
  });
  assert.equal(unconfirmed, null);
  const confirmed = await resolveGeneratedMedia({
    page: page(null), state: state([{ url: 'https://page/a.mp4', ready: true, confirmedNoWatermark: true, messageId: '1', messageKey: 'k' }]),
    task: task(), signal: new AbortController().signal, resolveFallback: fallbackMiss
  });
  assert.equal(confirmed.media.method, 'explicit-no-watermark');
});

test('未要求无水印的任务同样先走 fallback，失败时才用页面视频', async () => {
  const viaFallback = await resolveGeneratedMedia({
    page: page(null), state: state([{ url: 'https://page/a.mp4', ready: true, confirmedNoWatermark: false, messageId: '1', messageKey: 'k' }]),
    task: task({ removeWatermark: false }), signal: new AbortController().signal, resolveFallback: fallbackHit
  });
  assert.equal(viaFallback.media.method, 'fallback-api-unwatermarked');
  const viaPage = await resolveGeneratedMedia({
    page: page(null), state: state([{ url: 'https://page/a.mp4', ready: true, confirmedNoWatermark: false, messageId: '1', messageKey: 'k' }]),
    task: task({ removeWatermark: false }), signal: new AbortController().signal, resolveFallback: fallbackMiss
  });
  assert.equal(viaPage.media.method, 'page-video');
});

test('非豆包平台不请求 fallback，只用页面视频；要求无水印时没有可确认来源就报空', async () => {
  let calls = 0;
  const resolveFallback = async () => { calls += 1; return { url: 'https://x/y.mp4' }; };
  const pageVideo = [{ url: 'https://page/a.mp4', ready: true, confirmedNoWatermark: false, messageId: '1', messageKey: 'k' }];
  const plan = await resolveGeneratedMedia({
    page: page(null), state: state(pageVideo), task: task({ platform: 'dola', removeWatermark: false }),
    signal: new AbortController().signal, resolveFallback
  });
  assert.equal(calls, 0);
  assert.equal(plan.media.method, 'page-video');
  const strict = await resolveGeneratedMedia({
    page: page(null), state: state(pageVideo), task: task({ platform: 'dola' }),
    signal: new AbortController().signal, resolveFallback
  });
  assert.equal(calls, 0);
  assert.equal(strict, null);
});

test('没有可归属的回复消息时不调用 fallback', async () => {
  let calls = 0;
  const plan = await resolveGeneratedMedia({
    page: page(null), state: { replies: [{ id: '' }], media: [] }, task: task(),
    signal: new AbortController().signal,
    resolveFallback: async () => { calls += 1; return { url: 'https://x/y.mp4' }; }
  });
  assert.equal(calls, 0);
  assert.equal(plan, null);
});
