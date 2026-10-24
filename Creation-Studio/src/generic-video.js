'use strict';
const { httpJson } = require('./util');

function apiUrl(baseUrl, suffix) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('渠道缺少 Base URL');
  return base + suffix;
}

function headersFor(channel) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (channel.apiKey) headers.Authorization = 'Bearer ' + String(channel.apiKey).replace(/^\s*Bearer\s+/i, '').trim();
  return headers;
}

function dotGet(obj, dotPath, fallback) {
  if (!dotPath) return fallback;
  const parts = String(dotPath).split('.').filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return fallback;
    const m = /^(.+)\[(\d+)\]$/.exec(part);
    if (m) cur = cur[m[1]] ? cur[m[1]][Number(m[2])] : undefined;
    else cur = cur[part];
  }
  return cur === undefined ? fallback : cur;
}

function fillTemplate(template, values) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = values[key];
    if (value === undefined || value === null) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(String(value)).slice(1, -1);
  });
}

function sizeFor(aspectKey, longSide = 1280) {
  const raw = String(aspectKey || '16:9');
  const m = /(\d+)\s*:\s*(\d+)/.exec(raw);
  const w = m ? Number(m[1]) : 16;
  const h = m ? Number(m[2]) : 9;
  if (w === h) return `${longSide}x${longSide}`;
  if (w > h) return `${longSide}x${Math.round(longSide * h / w / 2) * 2}`;
  return `${Math.round(longSide * w / h / 2) * 2}x${longSide}`;
}

function firstImageData(job) {
  const img = (job.images || []).find(Boolean);
  if (!img) return '';
  const fs = require('node:fs');
  const { mimeFor } = require('./util');
  try {
    const buf = fs.readFileSync(img.path);
    return `data:${mimeFor(img.name || img.path)};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

async function submit(channel, job) {
  const image0 = firstImageData(job);
  if (channel.type === 'generic-task') {
    const opts = channel.options || {};
    const submitPath = opts.submitPath || '/v1/videos/generations';
    const template = opts.bodyTemplate || '{"model":"{model}","prompt":"{prompt}","duration":{duration}}';
    const bodyText = fillTemplate(template, {
      model: channel.model,
      prompt: job.prompt,
      duration: job.duration,
      seconds: job.duration,
      size: sizeFor(job.aspectRatio),
      aspect_ratio: job.aspectRatio,
      seed: job.seed,
      image0,
    });
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (err) {
      throw new Error('请求体模板不是合法 JSON：' + err.message);
    }
    if (image0 && !/"image0"|"image"|"image_url"|"first_frame"/.test(template)) {
      // The template did not ask for the image; leave it out rather than guessing a field name.
    }
    const res = await httpJson(apiUrl(channel.baseUrl, submitPath), {
      method: 'POST',
      headers: headersFor(channel),
      body: JSON.stringify(body),
      timeoutMs: 120000,
    });
    if (!res.ok) {
      const msg = (res.data && (res.data.error && (res.data.error.message || res.data.error) || res.data.message || res.data.msg)) || String(res.text || '').slice(0, 240);
      throw new Error(`提交失败 HTTP ${res.status}：${msg}`);
    }
    const id = dotGet(res.data, opts.idPath || 'id', dotGet(res.data, 'data.id', dotGet(res.data, 'task_id')));
    if (!id) throw new Error('提交响应里没有任务 ID（检查「任务 ID 字段」）');
    return { taskId: String(id), raw: res.data };
  }

  // OpenAI video (Sora-compatible)
  const body = {
    model: channel.model,
    prompt: job.prompt,
    seconds: String(job.duration),
  };
  const size = sizeFor(job.aspectRatio);
  if (size && size !== 'auto') body.size = size;
  if (image0) body.input_reference = image0;
  const res = await httpJson(apiUrl(channel.baseUrl, '/videos'), {
    method: 'POST',
    headers: headersFor(channel),
    body: JSON.stringify(body),
    timeoutMs: 120000,
  });
  if (!res.ok) {
    const msg = (res.data && (res.data.error && (res.data.error.message || res.data.error) || res.data.message)) || String(res.text || '').slice(0, 240);
    throw new Error(`提交失败 HTTP ${res.status}：${msg}`);
  }
  const id = (res.data && (res.data.id || (res.data.data && res.data.data.id))) || '';
  if (!id) throw new Error('提交响应里没有视频任务 id');
  return { taskId: String(id), raw: res.data };
}

async function poll(channel, taskId) {
  if (channel.type === 'generic-task') {
    const opts = channel.options || {};
    const pollPath = (opts.pollPath || '/v1/videos/generations/{id}').replace('{id}', encodeURIComponent(taskId));
    const res = await httpJson(apiUrl(channel.baseUrl, pollPath), { headers: headersFor(channel), timeoutMs: 30000 });
    if (!res.ok) {
      const msg = (res.data && (res.data.error && (res.data.error.message || res.data.error) || res.data.message)) || String(res.text || '').slice(0, 200);
      throw new Error(`查询失败 HTTP ${res.status}：${msg}`);
    }
    const data = res.data || {};
    const raw = String(dotGet(data, opts.statusPath || 'status', dotGet(data, 'data.status', '')) || '').toLowerCase();
    const url = dotGet(data, opts.resultPath || 'data.url', dotGet(data, 'data.video_url', dotGet(data, 'video_url', '')));
    const failed = ['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(raw);
    const success = ['completed', 'succeeded', 'success', 'done', 'finished'].includes(raw);
    return {
      status: failed ? 'failed' : success ? 'success' : 'running',
      rawStatus: raw,
      url: success ? String(url || '') : '',
      progress: Number(dotGet(data, opts.progressPath || 'progress', NaN)),
      message: String(dotGet(data, 'message', '') || ''),
    };
  }
  const res = await httpJson(apiUrl(channel.baseUrl, `/videos/${encodeURIComponent(taskId)}`), { headers: headersFor(channel), timeoutMs: 30000 });
  if (!res.ok) {
    const msg = (res.data && (res.data.error && (res.data.error.message || res.data.error) || res.data.message)) || String(res.text || '').slice(0, 200);
    throw new Error(`查询失败 HTTP ${res.status}：${msg}`);
  }
  const data = res.data || {};
  const raw = String(data.status || (data.data && data.data.status) || '').toLowerCase();
  const failed = ['failed', 'error', 'cancelled', 'canceled'].includes(raw);
  const success = ['completed', 'succeeded', 'success', 'done'].includes(raw);
  return {
    status: failed ? 'failed' : success ? 'success' : 'running',
    rawStatus: raw,
    url: success ? String((data.url || (data.data && data.data.url) || '')) : '',
    progress: Number(data.progress ?? (data.data && data.data.progress) ?? NaN),
    message: String(data.error || data.message || ''),
  };
}

async function downloadUrl(channel, taskId) {
  return apiUrl(channel.baseUrl, `/videos/${encodeURIComponent(taskId)}/content`);
}

async function test(channel) {
  if (!channel.baseUrl) return { ok: false, message: '请填写 Base URL' };
  if (channel.type !== 'generic-task' && !channel.model) return { ok: false, message: '请填写模型 ID' };
  try {
    const url = apiUrl(channel.baseUrl, channel.type === 'generic-task' ? '/models' : '/videos');
    const res = await httpJson(url, { headers: headersFor(channel), timeoutMs: 15000 });
    if (res.status === 401 || res.status === 403) return { ok: false, message: '鉴权失败（Key 无效）' };
    return { ok: true, message: '接口可访问' };
  } catch (err) {
    return { ok: false, message: '无法连接：' + err.message };
  }
}

module.exports = { submit, poll, downloadUrl, test, sizeFor, dotGet };
