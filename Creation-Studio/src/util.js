'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function uid(prefix = '') {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function dayFolder(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function sanitizeFilename(name, fallback = 'file') {
  const base = path.basename(String(name || '')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return base || fallback;
}

function safeSegment(name) {
  return String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v >= 10 ? 0 : 1)) + ' ' + units[i];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.flac': 'audio/flac',
  '.mov': 'video/quicktime',
};

function mimeFor(file) {
  return MIME[path.extname(String(file)).toLowerCase()] || 'application/octet-stream';
}

function extForMime(mime) {
  const hit = Object.entries(MIME).find(([, v]) => v === mime);
  return hit ? hit[0] : '';
}

async function httpJson(url, opts = {}) {
  const { method = 'GET', headers = {}, body, timeoutMs = 60000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data, text, headers: res.headers };
  } catch (err) {
    const message = err && err.name === 'AbortError' ? `请求超时（${Math.round(timeoutMs / 1000)} 秒）` : (err && err.message) || String(err);
    const error = new Error(message);
    error.status = 0;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBuffer(url, opts = {}) {
  const { headers = {}, timeoutMs = 300000 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return { buffer: Buffer.from(ab), contentType: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

function encodeMultipart(fields, boundary) {
  const b = boundary || '----h3studio' + crypto.randomBytes(8).toString('hex');
  const chunks = [];
  for (const f of fields) {
    chunks.push(Buffer.from(`--${b}\r\n`));
    const disp = `form-data; name="${f.name}"` + (f.filename ? `; filename="${f.filename}"` : '');
    chunks.push(Buffer.from(`Content-Disposition: ${disp}\r\n`));
    if (f.filename) chunks.push(Buffer.from(`Content-Type: ${f.mime || 'application/octet-stream'}\r\n`));
    chunks.push(Buffer.from('\r\n'));
    chunks.push(Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content)));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${b}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${b}` };
}

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.gif']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.mp4']);

function kindOf(file) {
  const ext = path.extname(String(file)).toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return 'file';
}

function deepFindUrl(value, depth = 0) {
  if (depth > 6 || value == null) return '';
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = deepFindUrl(item, depth + 1);
      if (hit) return hit;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const key of ['video_url', 'result_url', 'output_url', 'file_url', 'url', 'video', 'result', 'results', 'outputs', 'output', 'files', 'data']) {
      if (key in value) {
        const hit = deepFindUrl(value[key], depth + 1);
        if (hit) return hit;
      }
    }
  }
  return '';
}

function publicError(err) {
  const message = (err && err.message) || String(err);
  return message.length > 500 ? message.slice(0, 500) + '…' : message;
}

/**
 * 粗略估算 token：中日韩字符按 1 个字 = 1 token，其余按 4 字符 = 1 token。
 * 只用来做上下文裁剪的预算，不追求和具体分词器一致。
 */
function estimateTokens(text) {
  const value = String(text == null ? '' : text);
  if (!value) return 0;
  let wide = 0;
  for (const ch of value) {
    if (/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(ch)) wide += 1;
  }
  return Math.ceil(wide + (value.length - wide) / 4);
}

module.exports = {
  estimateTokens,
  ensureDir,
  readJson,
  writeJson,
  uid,
  nowIso,
  stamp,
  dayFolder,
  sanitizeFilename,
  safeSegment,
  formatBytes,
  sleep,
  mimeFor,
  extForMime,
  httpJson,
  fetchBuffer,
  encodeMultipart,
  kindOf,
  deepFindUrl,
  publicError,
  VIDEO_EXT,
  IMAGE_EXT,
  AUDIO_EXT,
};
