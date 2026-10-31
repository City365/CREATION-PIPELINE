'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { httpJson, fetchBuffer, encodeMultipart, mimeFor, deepFindUrl } = require('./util');

/* ------------------------------------ 官网 API（AutoDL） ------------------------------------ */

const AUTODL_BASE = process.env.WMD_AUTODL_BASE || 'https://autodl.art';

function autodlHeaders(token) {
  return {
    Authorization: 'Bearer ' + String(token || '').replace(/^\s*Bearer\s+/i, '').trim(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function submitAutodl(token, workflowId, payload) {
  const res = await httpJson(`${AUTODL_BASE}/api/v1/comfyui/comfyui_workflow/${encodeURIComponent(workflowId)}`, {
    method: 'POST',
    headers: autodlHeaders(token),
    body: JSON.stringify(payload),
    timeoutMs: 120000,
  });
  const data = res.data || {};
  if (String(data.code || '').toLowerCase() !== 'success' || !(data.data && data.data.task_id)) {
    const msg = (data.data && (data.data.message || data.data.msg)) || data.msg || data.message || String(res.text || '').slice(0, 200);
    if (res.status === 401) throw new Error('AutoDL 返回 401（密钥无效或未授权大模型接口），请到 https://autodl.art/large-model/tokens 检查令牌');
    throw new Error('任务提交失败：' + msg);
  }
  return String(data.data.task_id);
}

async function pollAutodl(token, taskId) {
  const res = await httpJson(`${AUTODL_BASE}/api/v1/comfyui/comfyui_workflow/result/${encodeURIComponent(taskId)}`, {
    headers: autodlHeaders(token),
    timeoutMs: 30000,
  });
  const data = res.data || {};
  if (String(data.code || '').toLowerCase() !== 'success') {
    throw new Error('查询失败：' + ((data.data && (data.data.message || data.data.msg)) || data.msg || `HTTP ${res.status}`));
  }
  const body = data.data;
  if (!body || typeof body !== 'object') throw new Error('查询响应缺少 data');
  const raw = String(body.status || '').trim().toUpperCase();
  let status = 'unknown';
  if (['QUEUED', 'PENDING', 'WAITING'].includes(raw)) status = 'queued';
  else if (['RUNNING', 'PROCESSING'].includes(raw)) status = 'running';
  else if (['SUCCESS', 'COMPLETED', 'SUCCEEDED'].includes(raw)) status = 'success';
  else if (['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(raw)) status = 'failed';
  return { status, rawStatus: raw, url: status === 'success' ? deepFindUrl(body) : '', message: body.message || body.msg || '', raw: body };
}

async function verifyAutodlKey(token) {
  if (!String(token || '').trim()) return { ok: false, message: '请先填写 API Key' };
  try {
    await httpJson(`${AUTODL_BASE}/api/v1/comfyui/comfyui_workflow/result/h3-key-check`, {
      headers: autodlHeaders(token),
      timeoutMs: 30000,
    });
    return { ok: true, message: 'API Key 可用' };
  } catch (err) {
    if (err.status === 401 || err.status === 403) return { ok: false, message: '密钥无效或未授权' };
    if (/无法连接|超时/.test(err.message)) return { ok: false, message: err.message };
    return { ok: true, message: 'API Key 已被官网接受' };
  }
}

/* ------------------------------------- 语言模型（提示词优化） ------------------------------------- */

function joinUrl(base, suffix) {
  const b = String(base || '').replace(/\/+$/, '');
  if (/\/chat\/completions$|\/responses$/i.test(b)) return b;
  if (/\/v\d+(\.\d+)?$/i.test(b)) return b + suffix;
  return b + '/v1' + suffix;
}

async function chat(opts) {
  const { baseUrl, apiKey, model, messages, timeoutMs = 180000, protocol = 'chat', temperature = 0.4, maxTokens = 0 } = opts;
  const maxOut = Number(maxTokens) > 0 ? Math.round(Number(maxTokens)) : 0;
  if (protocol === 'gemini') {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
    const system = messages.filter((m) => m.role === 'system').map((m) => String(m.content || '')).join('\n\n');
    const parts = [];
    if (system) parts.push({ text: system });
    for (const m of messages.filter((x) => x.role !== 'system')) {
      if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === 'text') parts.push({ text: String(part.text || '') });
          else if (part.type === 'image_url') {
            const hit = /^data:([^;]+);base64,(.*)$/s.exec(String((part.image_url && part.image_url.url) || ''));
            if (hit) parts.push({ inline_data: { mime_type: hit[1], data: hit[2] } });
          }
        }
      } else {
        parts.push({ text: String(m.content || '') });
      }
    }
    const body = { contents: [{ role: 'user', parts }] };
    if (maxOut) body.generationConfig = { maxOutputTokens: maxOut };
    const res = await httpJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-goog-api-key': String(apiKey || '').replace(/^\s*Bearer\s+/i, '').trim() },
      body: JSON.stringify(body),
      timeoutMs,
    });
    if (!res.ok) {
      const msg = (res.data && res.data.error && (res.data.error.message || res.data.error)) || String(res.text || '').slice(0, 300);
      throw new Error(`Gemini 接口 HTTP ${res.status}：${msg}`);
    }
    const partsOut = (res.data && res.data.candidates && res.data.candidates[0] && res.data.candidates[0].content && res.data.candidates[0].content.parts) || [];
    const content = partsOut.map((p) => p.text || '').join('').trim();
    if (!content) throw new Error('Gemini 返回为空');
    return { content, usage: (res.data && res.data.usageMetadata) || null, model };
  }
  const url = joinUrl(baseUrl, protocol === 'responses' ? '/responses' : '/chat/completions');
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + String(apiKey).replace(/^\s*Bearer\s+/i, '').trim();
  const body = protocol === 'responses'
    ? { model, input: messages.map((m) => ({ role: m.role, content: Array.isArray(m.content)
      ? m.content.map((part) => part.type === 'text' ? { type: 'input_text', text: part.text }
        : part.type === 'image_url' ? { type: 'input_image', image_url: part.image_url.url } : part)
      : m.content })) }
    : { model, messages, temperature };
  if (maxOut) {
    if (protocol === 'responses') body.max_output_tokens = maxOut;
    else body.max_tokens = maxOut;
  }
  const res = await httpJson(url, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs });
  const data = res.data;
  if (!res.ok) {
    const msg = (data && (data.error && (data.error.message || data.error) || data.message)) || String(res.text || '').slice(0, 300);
    throw new Error(`模型接口 HTTP ${res.status}：${msg}`);
  }
  let content = '';
  if (protocol === 'responses') {
    content = (data && data.output_text) || '';
    if (!content && data && Array.isArray(data.output)) {
      content = data.output.flatMap((o) => o.content || []).map((c) => c.text || '').join('');
    }
  } else {
    content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  }
  if (!content) throw new Error('模型返回为空');
  return { content, usage: (data && data.usage) || null, model: (data && data.model) || model };
}

async function listModels(baseUrl, apiKey, protocol = 'chat') {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const key = String(apiKey || '').replace(/^\s*Bearer\s+/i, '').trim();
  let url;
  const headers = { Accept: 'application/json' };
  if (protocol === 'gemini') {
    url = `${base}/models` + (key ? '?key=' + encodeURIComponent(key) : '');
    if (key) headers['x-goog-api-key'] = key;
  } else {
    url = joinUrl(base, '/models');
    if (key) headers.Authorization = 'Bearer ' + key;
  }
  const res = await httpJson(url, { headers, timeoutMs: 30000 });
  if (!res.ok) {
    const msg = (res.data && (res.data.error && (res.data.error.message || res.data.error) || res.data.message)) || '';
    throw new Error(`获取模型失败 HTTP ${res.status}${msg ? '：' + msg : ''}`);
  }
  const data = res.data || {};
  const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  return [...new Set(list.map((m) => (typeof m === 'string' ? m : (m.id || m.name || ''))).map((n) => String(n).replace(/^models\//, '')).filter(Boolean))].sort();
}

async function download(url) {
  return fetchBuffer(url);
}

module.exports = {
  AUTODL_BASE,
  submitAutodl,
  pollAutodl,
  verifyAutodlKey,
  chat,
  listModels,
  download,
};
