'use strict';
/**
 * 外接「管理器」视频服务（D:\notebook\software\管理器7.8.7\rebuild）
 *
 * 那套服务用真实 Chrome 账号跑豆包 / Gemini 网页生成，本地 HTTP 接口：
 *   GET  /health                     不需要鉴权
 *   GET  /api/state                  accounts / tasks / 目录
 *   POST /api/tasks                  提交（platform=doubao|gemini）
 *   GET  /api/tasks/{id}             状态
 *   GET  /api/tasks/{id}/file        成片 mp4
 * 鉴权：Authorization: Bearer <data/connection.json 里的 apiToken>
 */

const { httpJson, fetchBuffer } = require('../../../src/util');
const transport = require('../../../src/executor-transport');

const DEFAULT_BASE = 'http://127.0.0.1:17778';
const PLATFORM_LABEL = { doubao: '豆包', gemini: 'Gemini', dola: 'Dola' };

function baseUrl(channel) {
  return String((channel && channel.baseUrl) || DEFAULT_BASE).replace(/\/+$/, '');
}

/** 远程执行端（服务器够不到用户电脑）时，请求走通道，凭据由那边的管理器自己补。 */
function remote(channel) {
  return transport.isRemote(channel);
}

function authHeaders(channel, extra = {}) {
  const headers = { Accept: 'application/json', ...extra };
  // 走通道时不把 apiToken 塞进命令里：它属于用户那台机器，不该在服务器上流转。
  if (remote(channel)) return headers;
  const token = String((channel && channel.apiKey) || '').replace(/^\s*Bearer\s+/i, '').trim();
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function failMessage(res, fallback) {
  const data = res.data || {};
  return data.error || data.message || String(res.text || '').slice(0, 200) || fallback;
}

async function health(channel) {
  const res = await transport.requestJson(channel, '/health', { timeoutMs: 20000 });
  if (!res.ok) throw new Error('管理器服务未响应 HTTP ' + res.status);
  return res.data || {};
}

async function state(channel) {
  const res = await transport.requestJson(channel, '/api/state', { headers: authHeaders(channel), timeoutMs: 30000 });
  if (!res.ok) throw new Error('读取管理器状态失败：' + failMessage(res, 'HTTP ' + res.status));
  return res.data || {};
}

function accountsFor(stateData, platform) {
  return (stateData.accounts || []).filter((a) => a.platform === platform && a.enabled !== false);
}

function pickAccount(channel, stateData, platform) {
  const wanted = String((channel.options && channel.options.accountId) || (channel && channel.accountId) || '').trim();
  const list = accountsFor(stateData, platform);
  if (wanted) {
    const hit = list.find((a) => a.id === wanted || a.name === wanted);
    if (!hit) throw new Error(`管理器里没有匹配的${PLATFORM_LABEL[platform] || platform}账号（${wanted}），请到管理器账号管理里确认`);
    return hit;
  }
  const hit = list[0];
  if (!hit) throw new Error(`管理器里还没有可用的${PLATFORM_LABEL[platform] || platform}账号，先到管理器「账号管理」里添加并登录`);
  return hit;
}

function shortAspect(aspectRatio) {
  const m = /(\d+)\s*[:：]\s*(\d+)/.exec(String(aspectRatio || ''));
  if (!m) return '16:9';
  return `${m[1]}:${m[2]}`;
}

// 管理器里豆包的模型是网页下拉的可见文案，必须一字不差。这里把小写/短写法归一，
// 认不出来的原样透传（管理器会在页面上按文案匹配，对不上会明确报错）。
const MODEL_CHOICES = ['Seedance 2.0 Mini', 'Seedance 2.0 Fast'];
function normalizeModel(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!raw) return '';
  // seedance-2.0-fast / seedance_2.0_Fast / 2.0 mini / fast 都归到页面上的文案
  const key = raw.toLowerCase().replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  const hit = /^(?:seedance\s+)?(?:2\s+0\s+)?(mini|fast)$/.exec(key);
  return hit ? MODEL_CHOICES[hit[1] === 'mini' ? 0 : 1] : raw;
}

/** 模型：任务上带了就用任务的，没带才回落到渠道配置；Gemini 页面上没有模型选项，一律留空。 */
function modelOf(channel, job, platform) {
  if (platform === 'gemini') return '';
  return normalizeModel((job && job.model) || (channel && channel.model) || '');
}

async function submit(channel, job, platform) {
  const stateData = await state(channel);
  const account = pickAccount(channel, stateData, platform);
  // 只有渠道里明确指定了账号才钉死它。留空时交给管理器自己挑选：
  // 管理器会按配额/冷却/占用情况换号，钉死一个号会在它配额满时一直排队。
  const pinnedAccount = String((channel.options && channel.options.accountId) || (channel && channel.accountId) || '').trim();
  const references = (job.images || []).filter(Boolean).map((img) => img.path).filter(Boolean).slice(0, 9);
  // 画幅：任务上的 aspectRatio / ratio 优先，没带就按工作流默认走 16:9。
  const ratio = shortAspect(job.aspectRatio || job.ratio);
  const model = modelOf(channel, job, platform);
  const body = {
    platform,
    ...(pinnedAccount ? { accountId: account.id } : {}),
    prompt: job.prompt,
    references,
    requestId: job.runId || job.id,
    removeWatermark: true,
    timeoutSeconds: 3600,
  };
  if (platform === 'gemini') {
    // Gemini 固定 10 秒、只有 16:9 / 9:16，不能带时长/清晰度/模型
    body.ratio = ratio === '9:16' ? '9:16' : '16:9';
  } else {
    body.duration = Math.max(5, Math.min(15, Number(job.duration) || 10));
    if (['16:9', '9:16', '1:1', '4:3', '3:4'].includes(ratio)) body.ratio = ratio;
    if (job.resolution) body.resolution = job.resolution;
    if (model) body.model = model;
  }
  const res = await transport.requestJson(channel, '/api/tasks', {
    method: 'POST',
    headers: authHeaders(channel, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    timeoutMs: 90000,
  });
  if (!res.ok) throw new Error('提交到管理器失败：' + failMessage(res, 'HTTP ' + res.status));
  const data = res.data || {};
  if (!data.id) throw new Error('管理器没有返回任务 ID');
  return { taskId: String(data.id), account: { id: account.id, name: account.name }, raw: data };
}

async function poll(channel, taskId) {
  const res = await transport.requestJson(channel, '/api/tasks/' + encodeURIComponent(taskId), {
    headers: authHeaders(channel),
    timeoutMs: 30000,
  });
  if (!res.ok) throw new Error('查询管理器任务失败：' + failMessage(res, 'HTTP ' + res.status));
  const data = res.data || {};
  const raw = String(data.status || '').toLowerCase();
  const status = ['completed'].includes(raw) ? 'success'
    : ['failed', 'cancelled', 'interrupted'].includes(raw) ? 'failed'
      : 'running';
  const analysis = data.failureAnalysis || null;
  return {
    status,
    rawStatus: raw,
    progress: Number(data.progress) || 0,
    message: String((analysis && analysis.reason) || data.message || data.error || ''),
    failureAnalysis: analysis,
    failureReason: analysis ? analysis.reason : '',
    failureAdvice: analysis ? analysis.advice : '',
    result: data.result || null,
    accountId: data.accountId || '',
    conversationURL: data.conversationURL || '',
    submittedPrompt: data.submittedPrompt || '',
    referenceBindings: data.referenceBindings || [],
  };
}

async function resume(channel, taskId) {
  const current = await poll(channel, taskId);
  if (current.status !== 'failed') return current;
  if (!current.conversationURL) throw new Error('原任务没有可恢复会话，请打开管理器检查，未重新提交');
  const response = await transport.requestJson(channel, '/api/tasks/' + encodeURIComponent(taskId) + '/resume', {
    method: 'POST', headers: authHeaders(channel, { 'Content-Type': 'application/json' }), body: '{}', timeoutMs: 45000,
  });
  if (!response.ok) throw new Error('继续管理器任务失败：' + failMessage(response, 'HTTP ' + response.status));
  return response.data;
}

async function cancel(channel, taskId) {
  const res = await transport.requestJson(channel, '/api/tasks/' + encodeURIComponent(taskId) + '/cancel', {
    method: 'POST',
    headers: authHeaders(channel, { 'Content-Type': 'application/json' }),
    body: '{}',
    timeoutMs: 30000,
  });
  return res.ok;
}

async function accounts(channel) {
  const data = await state(channel);
  return (data.accounts || []).map((a) => ({
    id: a.id,
    name: a.name || a.id,
    platform: a.platform,
    enabled: a.enabled !== false,
  }));
}

async function download(channel, taskId) {
  const res = await transport.downloadBuffer(channel, '/api/tasks/' + encodeURIComponent(taskId) + '/file', {
    headers: authHeaders(channel),
    timeoutMs: 900000,
  });
  if (!res.buffer || !res.buffer.length) throw new Error('管理器返回的成片为空');
  return { buffer: res.buffer, contentType: res.contentType || 'video/mp4' };
}

async function test(channel) {
  try {
    const info = await health(channel);
    const stateData = await state(channel);
    const accounts = stateData.accounts || [];
    const doubao = accountsFor(stateData, 'doubao').length;
    const gemini = accountsFor(stateData, 'gemini').length;
    return {
      ok: true,
      message: `管理器在线（v${info.version || '?'}）· 豆包账号 ${doubao} 个 · Gemini 账号 ${gemini} 个`,
    };
  } catch (err) {
    return { ok: false, message: '连不上管理器：' + err.message + '（先在 rebuild 目录启动服务）' };
  }
}

module.exports = { DEFAULT_BASE, PLATFORM_LABEL, MODEL_CHOICES, normalizeModel, modelOf, health, state, accounts, accountsFor, submit, poll, resume, download, cancel, test, shortAspect, baseUrl };
