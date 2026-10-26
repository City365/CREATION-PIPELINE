'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const probe = require('../src/probe');

test('能力矩阵包含取消/探针/计费字段', () => {
  const data = probe.capabilities();
  assert.ok(Array.isArray(data.providers) && data.providers.length >= 4);
  for (const item of data.providers) {
    assert.ok(['remote', 'local', 'none'].includes(item.cancel));
    assert.ok(['local', 'manager', 'page', 'http'].includes(item.probe));
    assert.ok(['on-submit', 'on-success'].includes(item.billing));
  }
  const doubao = data.providers.find((p) => p.id === 'doubao-video');
  assert.equal(doubao.cancel, 'local');
  assert.equal(doubao.probe, 'manager');
});

test('管理器状态映射', () => {
  assert.equal(probe.mapManagerStatus('completed'), 'done');
  assert.equal(probe.mapManagerStatus('failed'), 'failed');
  assert.equal(probe.mapManagerStatus('cancelled'), 'canceled');
  assert.equal(probe.mapManagerStatus('generating'), 'running');
  assert.equal(probe.mapManagerStatus('weird'), 'unknown');
});

test('本地任务探针：成功/失败/中断', async () => {
  assert.equal((await probe.probeJob({ id: 'j1', provider: 'generic', status: 'success' })).remote, 'done');
  assert.equal((await probe.probeJob({ id: 'j2', provider: 'generic', status: 'failed' })).remote, 'failed');
  const interrupted = await probe.probeJob({ id: 'j3', provider: 'generic', status: 'interrupted' });
  assert.equal(interrupted.remote, 'unknown');
  assert.equal(interrupted.evidence.source, 'local');
});

test('管理器任务探针取远端状态，失败时回 unknown', async () => {
  const job = { id: 'j4', provider: 'manager', platform: 'doubao', channelId: 'ch-x', remotePromptId: 'abc' };
  // 没有对应渠道时无法访问远端 → unknown
  const missing = await probe.probeJob(job);
  assert.equal(missing.remote, 'unknown');
  assert.ok(missing.confidence < 0.5);
});

test('探针注入 request 时按管理器返回状态映射', async () => {
  const calls = [];
  const request = async (url) => { calls.push(url); return { ok: true, data: { status: 'completed', message: 'ok' } }; };
  const result = await probe.probeJob({ id: 'j5', provider: 'manager', platform: 'doubao', channelId: 'ch-x', remotePromptId: 'abc' }, { request, channel: { baseUrl: 'http://127.0.0.1:9', apiKey: 'x' } });
  assert.equal(result.remote, 'done');
  assert.equal(result.evidence.source, calls.length ? (calls[0].includes('/api/tasks/') ? 'manager' : 'other') : 'none');
});
