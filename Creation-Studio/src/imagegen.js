'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { httpJson, fetchBuffer, encodeMultipart, mimeFor, extForMime, ensureDir, dayFolder, uid, kindOf } = require('./util');

function apiUrl(baseUrl, suffix) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('缺少 Base URL');
  return base + suffix;
}

function authHeaders(channel, extra = {}) {
  const headers = { Accept: 'application/json', ...extra };
  if (channel.apiKey) headers.Authorization = 'Bearer ' + String(channel.apiKey).replace(/^\s*Bearer\s+/i, '').trim();
  return headers;
}

function extForMimeSafe(mime) {
  const ext = extForMime(String(mime || '').split(';')[0].trim());
  if (ext) return ext;
  if (/jpe?g/i.test(mime)) return '.jpg';
  if (/webp/i.test(mime)) return '.webp';
  return '.png';
}

function dataUrlParts(dataUrl) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  if (!m) return null;
  return { mime: m[1], base64: m[3], buffer: Buffer.from(m[3], 'base64') };
}

function collectImages(payload) {
  const found = [];
  const pushUrl = (url) => { if (typeof url === 'string' && /^(https?:|data:)/i.test(url)) found.push({ kind: 'url', value: url }); };
  const pushB64 = (b64, mime) => { if (typeof b64 === 'string' && b64.length > 32) found.push({ kind: 'b64', value: b64, mime: mime || 'image/png' }); };

  const visit = (value, depth) => {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) { for (const v of value) visit(v, depth + 1); return; }
    if (typeof value !== 'object') return;
    if (typeof value.b64_json === 'string') pushB64(value.b64_json, value.mime_type || value.mimeType);
    if (typeof value.base64 === 'string' && value.base64.length > 64) pushB64(value.base64, value.mime_type);
    if (typeof value.url === 'string') pushUrl(value.url);
    if (typeof value.image_url === 'object' && value.image_url) pushUrl(value.image_url.url);
    if (typeof value.image_url === 'string') pushUrl(value.image_url);
    if (value.inlineData && value.inlineData.data) pushB64(value.inlineData.data, value.inlineData.mimeType);
    if (value.inline_data && value.inline_data.data) pushB64(value.inline_data.data, value.inline_data.mime_type);
    for (const key of ['data', 'images', 'output', 'result', 'results', 'content', 'parts', 'candidates', 'choices', 'message']) {
      if (key in value) visit(value[key], depth + 1);
    }
  };
  visit(payload, 0);

  // Markdown images inside chat text.
  const walkText = (value, depth) => {
    if (depth > 6 || value == null) return;
    if (typeof value === 'string') {
      for (const m of value.matchAll(/!\[[^\]]*\]\((data:image\/[^)\s]+|https?:\/\/[^)\s]+)\)/g)) pushUrl(m[1]);
      return;
    }
    if (Array.isArray(value)) { for (const v of value) walkText(v, depth + 1); return; }
    if (typeof value === 'object') for (const v of Object.values(value)) walkText(v, depth + 1);
  };
  walkText(payload, 0);

  const seen = new Set();
  return found.filter((item) => {
    const key = item.kind + ':' + item.value.slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function toBuffers(items) {
  const out = [];
  for (const item of items) {
    if (item.kind === 'b64') {
      out.push({ buffer: Buffer.from(item.value, 'base64'), mime: item.mime || 'image/png' });
    } else if (item.value.startsWith('data:')) {
      const parts = dataUrlParts(item.value);
      if (parts) out.push({ buffer: parts.buffer, mime: parts.mime });
    } else {
      const res = await fetchBuffer(item.value, { timeoutMs: 120000 });
      out.push({ buffer: res.buffer, mime: res.contentType || 'image/png' });
    }
  }
  return out;
}

function readRefs(refs) {
  return (refs || []).filter((r) => r && r.path && fs.existsSync(r.path)).map((r) => ({
    path: r.path,
    name: r.name || path.basename(r.path),
    mime: mimeFor(r.name || r.path),
    buffer: fs.readFileSync(r.path),
  }));
}

function extraParams(channel) {
  const raw = channel.options && channel.options.extraJson;
  if (!raw || !String(raw).trim()) return {};
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('必须是 JSON 对象');
    return parsed;
  } catch (err) {
    throw new Error('附加参数不是合法 JSON：' + err.message);
  }
}

async function openaiImages(channel, { prompt, count, size, quality, refs }) {
  const images = readRefs(refs);
  const model = channel.model;
  const extra = extraParams(channel);
  let payload;
  if (images.length) {
    const fields = [
      { name: 'model', content: model },
      { name: 'prompt', content: prompt },
      { name: 'n', content: String(Math.max(1, Math.min(4, count || 1))) },
    ];
    if (size && size !== 'auto') fields.push({ name: 'size', content: size });
    if (quality && quality !== 'auto') fields.push({ name: 'quality', content: quality });
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined || value === null || value === '') continue;
      fields.push({ name: key, content: typeof value === 'string' ? value : JSON.stringify(value) });
    }
    for (const img of images) fields.push({ name: 'image[]', filename: img.name, content: img.buffer, mime: img.mime });
    const { body, contentType } = encodeMultipart(fields);
    const res = await httpJson(apiUrl(channel.baseUrl, '/images/edits'), {
      method: 'POST',
      headers: authHeaders(channel, { 'Content-Type': contentType }),
      body,
      timeoutMs: 300000,
    });
    if (!res.ok) throw new Error(`生图接口 HTTP ${res.status}：${(res.data && (res.data.error && (res.data.error.message || res.data.error) || res.data.message)) || String(res.text || '').slice(0, 200)}`);
    payload = res.data;
  } else {
    const body = { model, prompt, n: Math.max(1, Math.min(4, count || 1)), ...extra };
    if (size && size !== 'auto') body.size = size;
    if (quality && quality !== 'auto') body.quality = quality;
    const res = await httpJson(apiUrl(channel.baseUrl, '/images/generations'), {
      method: 'POST',
      headers: authHeaders(channel, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      timeoutMs: 300000,
    });
    if (!res.ok) throw new Error(`生图接口 HTTP ${res.status}：${(res.data && (res.data.error && (res.data.error.message || res.data.error) || res.data.message)) || String(res.text || '').slice(0, 200)}`);
    payload = res.data;
  }
  return toBuffers(collectImages(payload));
}

async function geminiImage(channel, { prompt, count, refs, size }) {
  const images = readRefs(refs);
  const parts = [{ text: prompt }];
  for (const img of images) parts.push({ inline_data: { mime_type: img.mime, data: img.buffer.toString('base64') } });
  const url = apiUrl(channel.baseUrl, `/models/${encodeURIComponent(channel.model)}:generateContent`);
  const outputs = [];
  const runs = Math.max(1, Math.min(4, count || 1));
  for (let i = 0; i < runs; i++) {
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    };
    if (size && ['512px', '1K', '2K', '4K'].includes(size)) body.generationConfig.imageConfig = { imageSize: size };
    const res = await httpJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-goog-api-key': String(channel.apiKey || '').replace(/^\s*Bearer\s+/i, '').trim() },
      body: JSON.stringify(body),
      timeoutMs: 300000,
    });
    if (!res.ok) {
      const msg = (res.data && res.data.error && (res.data.error.message || res.data.error)) || String(res.text || '').slice(0, 200);
      throw new Error(`Gemini 生图 HTTP ${res.status}：${msg}`);
    }
    outputs.push(...await toBuffers(collectImages(res.data)));
  }
  return outputs;
}

async function chatImage(channel, { prompt, count, refs, size }) {
  const images = readRefs(refs);
  const content = [{ type: 'text', text: prompt }];
  for (const img of images) content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.buffer.toString('base64')}` } });
  const body = {
    ...extraParams(channel),
    model: channel.model,
    messages: [{ role: 'user', content: images.length ? content : prompt }],
    modalities: ['image', 'text'],
  };
  if (size && size !== 'auto') body.size = size;
  const res = await httpJson(apiUrl(channel.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: authHeaders(channel, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    timeoutMs: 300000,
  });
  if (!res.ok) {
    const msg = (res.data && (res.data.error && (res.data.error.message || res.data.error) || res.data.message)) || String(res.text || '').slice(0, 200);
    throw new Error(`Chat 生图 HTTP ${res.status}：${msg}`);
  }
  const buffers = await toBuffers(collectImages(res.data));
  const runs = Math.max(1, Math.min(4, count || 1));
  if (buffers.length >= runs) return buffers.slice(0, runs);
  const out = buffers.slice();
  while (out.length < runs) out.push(buffers[0]);
  return out;
}

async function generate(channel, input) {
  if (!channel) throw new Error('没有启用的图像渠道');
  if (!channel.baseUrl) throw new Error('渠道缺少 Base URL');
  if (!channel.model) throw new Error('渠道缺少模型 ID');
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw new Error('提示词不能为空');
  const args = {
    prompt,
    count: Math.max(1, Math.min(4, Number(input.count) || 1)),
    size: input.size || channel.options.size || 'auto',
    quality: input.quality || channel.options.quality || 'auto',
    refs: input.refs || [],
  };
  let buffers;
  if (channel.type === 'gemini-image') buffers = await geminiImage(channel, args);
  else if (channel.type === 'chat-image') buffers = await chatImage(channel, args);
  else buffers = await openaiImages(channel, args);
  if (!buffers.length) throw new Error('接口返回里没有找到图片（可能只返回了文字）');
  return buffers;
}

function saveImages(buffers, jobId) {
  const cfg = config.load();
  const dir = ensureDir(path.join(cfg.saveFolder, 'images', dayFolder()));
  const id = jobId || uid('img-');
  const items = [];
  buffers.forEach((item, index) => {
    const ext = extForMimeSafe(item.mime);
    const name = `${id}-${String(index + 1).padStart(2, '0')}${ext}`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, item.buffer);
    items.push({ path: file, name, bytes: item.buffer.length, mime: item.mime, kind: 'image', url: '/api/file?path=' + encodeURIComponent(file) });
  });
  return { id, dir, items };
}

async function test(channel) {
  const items = await generate(channel, { prompt: 'A single small red dot on a plain white background, minimal.', count: 1, size: 'auto' });
  const saved = saveImages(items.slice(0, 1), uid('chtest-'));
  return { ok: true, message: `生图成功：${path.basename(saved.items[0].path)}`, sample: saved.items[0] };
}

module.exports = { generate, saveImages, test, collectImages, TYPES: null };
