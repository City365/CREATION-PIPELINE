'use strict';
/**
 * 探针与能力矩阵：取消能力、计费时点、远端真值探测。
 * 原则：探不到就是 unknown，绝不假装知道。
 */
const channels = require('./channels');
const { httpJson } = require('./util');

const CAPABILITIES = [
  { id: 'local-queue', provider: 'local', kind: 'video', label: '本地队列（未提交）', cancel: 'remote', probe: 'local', billing: 'on-submit', note: '提交前可直接取消，不计费' },
  { id: 'doubao-video', provider: 'manager', platform: 'doubao', kind: 'video', label: '豆包视频（管理器）', cancel: 'local', probe: 'manager', billing: 'on-submit', note: '页面停止控件待真机取证，取证通过后升级为 remote' },
  { id: 'gemini-video', provider: 'manager', platform: 'gemini', kind: 'video', label: 'Gemini 视频（管理器）', cancel: 'local', probe: 'manager', billing: 'on-submit', note: '已提交不可撤回' },
  { id: 'openai-images', provider: 'openai-images', kind: 'image', label: '图像 API', cancel: 'none', probe: 'local', billing: 'on-submit', note: '同步请求，取消只丢弃结果' },
  { id: 'gemini-image', provider: 'gemini', kind: 'image', label: 'Gemini 生图', cancel: 'none', probe: 'local', billing: 'on-submit', note: '同步请求，取消只丢弃结果' },
];

function capabilities() {
  return { schemaVersion: 1, providers: CAPABILITIES.map((item) => ({ ...item })) };
}

function capabilityFor(job) {
  if (!job) return CAPABILITIES[0];
  const platform = String(job.platform || '');
  return CAPABILITIES.find((c) => c.provider === job.provider && (!c.platform || c.platform === platform)) || CAPABILITIES[0];
}

function mapManagerStatus(status) {
  const value = String(status || '');
  if (['completed', 'success', 'succeeded'].includes(value)) return 'done';
  if (['failed', 'interrupted', 'error'].includes(value)) return 'failed';
  if (['cancelled', 'canceled'].includes(value)) return 'canceled';
  if (['queued', 'starting', 'running', 'uploading', 'submitting', 'generating', 'downloading', 'paused'].includes(value)) return 'running';
  return 'unknown';
}

function localRemote(job) {
  const value = String(job && job.status || '');
  if (value === 'success') return 'done';
  if (['failed', 'interrupted'].includes(value)) return value === 'interrupted' ? 'unknown' : 'failed';
  if (['canceled', 'cancelled'].includes(value)) return 'canceled';
  if (['queued', 'running'].includes(value)) return 'running';
  return 'unknown';
}

async function probeManagerJob(job, request = httpJson, channelOverride = null) {
  const channel = channelOverride || channels.get('video', job.channelId);
  if (!channel || !channel.baseUrl) return null;
  const base = String(channel.baseUrl).replace(/\/+$/, '');
  const res = await request(base + '/api/tasks/' + encodeURIComponent(job.remotePromptId), {
    headers: channel.apiKey ? { Authorization: 'Bearer ' + channel.apiKey } : {},
    timeoutMs: 10000,
  });
  if (!res.ok) return null;
  const data = res.data || {};
  return { remote: mapManagerStatus(data.status), detail: String(data.status || '') + (data.message ? ' · ' + data.message : '') };
}

async function probeJob(job, options = {}) {
  const at = Date.now();
  if (!job) return { remote: 'unknown', evidence: { source: 'none', at, detail: '任务不存在' }, confidence: 0 };
  if (job.provider === 'manager' && job.remotePromptId) {
    try {
      const remote = await probeManagerJob(job, options.request || httpJson, options.channel || null);
      if (remote) return { refType: 'job', refId: job.id, remote: remote.remote, evidence: { source: 'manager', at, detail: remote.detail }, confidence: 0.95 };
    } catch (error) {
      return { refType: 'job', refId: job.id, remote: 'unknown', evidence: { source: 'manager', at, detail: String(error.message || error).slice(0, 200) }, confidence: 0.2 };
    }
    return { refType: 'job', refId: job.id, remote: 'unknown', evidence: { source: 'manager', at, detail: '管理器任务编号存在但探针未取得结果' }, confidence: 0.3 };
  }
  return { refType: 'job', refId: job.id, remote: localRemote(job), evidence: { source: 'local', at, detail: '本地状态：' + (job.status || 'unknown') }, confidence: 0.9 };
}

function probeImageTask(task) {
  if (!task) return { remote: 'unknown', evidence: { source: 'none', at: Date.now(), detail: '任务不存在' }, confidence: 0 };
  return { refType: 'imageTask', refId: task.id, remote: localRemote({ status: task.status }), evidence: { source: 'local', at: Date.now(), detail: '本地状态：' + (task.status || 'unknown') }, confidence: 0.85 };
}

module.exports = { capabilities, capabilityFor, mapManagerStatus, localRemote, probeJob, probeImageTask };
