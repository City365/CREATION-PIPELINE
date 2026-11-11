'use strict';
/**
 * /api/music/* —— 剪映曲库的一扇门（不是曲库本身）
 *
 * 曲库数据在「剪映控制 API」这个独立服务里（tools/jianying-api，默认 127.0.0.1:17830）：
 *
 *   /music/status         本地索引条数 + 原生通道能不能用 + 缓存目录
 *   /music/search         本机已缓存的曲库（曲名 ↔ music_id ↔ 本地 mp3）—— 秒回
 *   /music/native-search  联网搜剪映素材平台（lyra-cli），和在剪映里搜出来的一样
 *   /music/download       按 resource_id 下成 m4a，返回落地绝对路径（可直接 media.import）
 *
 * 这层只做转发，外加把本机音频文件按 Range 直出给 <audio> 试听；
 * 不认识任何一条曲库语义，加接口不用改这里。剪映 API 没起就顺手拉起来。
 *
 *   GET  /api/music/status
 *   GET  /api/music/search?q=&type=&limit=        本机索引
 *   GET  /api/music/native?q=&type=&limit=        联网
 *   POST /api/music/download {resource_id,title,type}
 *   GET  /api/music/audio?path=                   试听（Range）
 *
 * 只认回环。
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PREFIX = '/api/music';
const PIPELINE = path.resolve(__dirname, '..', '..');
const BASE = (process.env.WMD_JY_API || 'http://127.0.0.1:17830').replace(/\/+$/, '');
const SERVER_SCRIPT = process.env.WMD_JY_SERVER
  || path.join(PIPELINE, 'tools', 'jianying-api', 'server.py');
const PYTHON = process.env.WMD_JY_PYTHON
  || path.join(PIPELINE, '.venv-jianying', 'Scripts', 'python.exe');
const LOG_DIR = process.env.WMD_MUSIC_LOG || path.join(PIPELINE, 'outputs');

const state = { spawning: null, lastSpawnAt: 0, spawnError: '', pid: null };

const AUDIO_MIME = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.aac': 'audio/aac',
  '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.mp4': 'audio/mp4', '.webm': 'audio/webm',
};

function bad(status, message) {
  const error = Error(message);
  error.status = status;
  return error;
}

function isLoopback(req) {
  const raw = (req.socket && (req.socket.remoteAddress || '')) || '';
  return raw === '::1' || raw === '127.0.0.1' || /^::ffff:127\./.test(raw);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ 剪映 API */

function request(method, pathname, options) {
  const opts = options || {};
  const target = new URL(BASE);
  // 一定带 Content-Length：剪映 API 用 BaseHTTPRequestHandler，只认长度，
  // chunked 的请求体它读成空 body。
  const payload = opts.body !== undefined ? JSON.stringify(opts.body) : '';
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port || 80,
      method,
      path: pathname,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: opts.timeout || 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = { raw: text }; }
        if (res.statusCode >= 400) {
          const detail = payload && (payload.error || payload.message);
          const error = bad(res.statusCode >= 500 ? 502 : 400, detail || ('剪映 API ' + res.statusCode));
          error.upstream = payload;
          return reject(error);
        }
        resolve(payload);
      });
    });
    req.on('timeout', () => req.destroy(bad(504, '剪映 API 超时')));
    req.on('error', (error) => reject(bad(502, '剪映 API 连不上：' + error.message)));
    if (payload) req.write(payload);
    req.end();
  });
}

async function health(timeout) {
  try {
    const payload = await request('GET', '/health', { timeout: timeout || 1500 });
    return payload && payload.ok ? payload : null;
  } catch (e) {
    return null;
  }
}

function spawnServer() {
  state.lastSpawnAt = Date.now();
  if (!fs.existsSync(SERVER_SCRIPT)) {
    state.spawnError = '缺少剪映 API 脚本：' + SERVER_SCRIPT;
    state.spawning = null;
    return Promise.resolve(false);
  }
  const python = fs.existsSync(PYTHON) ? PYTHON : 'python';
  const port = new URL(BASE).port || '17830';
  let log = 'ignore';
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    log = fs.openSync(path.join(LOG_DIR, 'jianying-api.log'), 'a');
  } catch (e) { /* 写不了日志也照起 */ }
  let child;
  try {
    child = spawn(python, [SERVER_SCRIPT, '--port', String(port)], {
      cwd: PIPELINE,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
  } catch (error) {
    state.spawnError = error.message;
    state.spawning = null;
    return Promise.resolve(false);
  }
  child.on('error', (error) => { state.spawnError = error.message; });
  child.unref();
  state.pid = child.pid || null;
  state.spawning = null;
  return Promise.resolve(true);
}

async function ensureUp() {
  if (await health(1500)) return true;
  if (!state.spawning && Date.now() - state.lastSpawnAt > 8000) {
    state.spawning = spawnServer();
    await state.spawning;
  }
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    await sleep(400);
    if (await health(1200)) { state.spawnError = ''; return true; }
  }
  return false;
}

function upstreamQuery(params) {
  const query = new URLSearchParams();
  params.forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  const text = query.toString();
  return text ? '?' + text : '';
}

/* ------------------------------------------------------------------ 试听直出 */

function roots() {
  const configured = String(process.env.WMD_JY_MUSIC_ROOTS || '').split(';').map((row) => row.trim()).filter(Boolean);
  if (configured.length) return configured.map((row) => path.resolve(row));
  const out = [path.join(PIPELINE, 'output', 'jy-library')];
  const local = process.env.LOCALAPPDATA;
  if (local) out.unshift(path.join(local, 'JianyingPro', 'User Data', 'Cache'));
  return out;
}

function inside(target, root) {
  const rel = path.relative(path.resolve(root), target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function serveAudio(req, res, file) {  const stat = fs.statSync(file);
  const size = stat.size;
  const type = AUDIO_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const hit = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    let start = parseInt((hit && hit[1]) || '', 10);
    let end = parseInt((hit && hit[2]) || '', 10);
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= size) end = size - 1;
    if (start > end) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + size });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });
  return fs.createReadStream(file).pipe(res);
}

/* ------------------------------------------------- 远程试听：同源转发（Range 也转） */

// 只转剪映自家的 CDN，别的一律不碰
const PREVIEW_HOSTS = String(process.env.WMD_JY_PREVIEW_HOSTS ||
  'vlabvod.com,faceu.com,faceu.mobi,byteimg.com,ulikecam.com,snssdk.com,pstatp.com,bytedance.com,ibytedtos.com')
  .split(',').map((row) => row.trim().toLowerCase()).filter(Boolean);

function hostAllowed(host) {
  const name = String(host || '').toLowerCase();
  return PREVIEW_HOSTS.some((root) => name === root || name.endsWith('.' + root));
}

function proxyAudio(req, res, target) {
  const headers = {
    'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
    'Accept': '*/*',
    'Referer': 'https://lv.ulikecam.com/',
  };
  if (req.headers.range) headers.Range = req.headers.range;
  const upstream = https.request({
    hostname: target.hostname,
    port: target.port || 443,
    path: target.pathname + target.search,
    method: 'GET',
    headers,
    timeout: 20000,
  }, (reply) => {
    const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    const out = { 'Cache-Control': 'no-store' };
    for (const key of passthrough) {
      if (reply.headers[key]) out[key.replace(/\b\w/g, (c) => c.toUpperCase())] = reply.headers[key];
    }
    if (!out['Accept-Ranges']) out['Accept-Ranges'] = 'bytes';
    res.writeHead(reply.statusCode || 200, out);
    reply.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(bad(504, '试听地址超时')));
  upstream.on('error', (error) => {
    if (res.headersSent) { res.end(); return; }
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: '试听转发失败：' + error.message }));
  });
  upstream.end();
}

/* ------------------------------------------------------------------ 路由 */

module.exports = async function musicRoutes(req, res, url, { ok, bad: badReply, readBody }) {
  const pathname = url.pathname;
  if (pathname !== PREFIX && !pathname.startsWith(PREFIX + '/')) return false;
  if (!isLoopback(req)) {
    if (badReply) badReply(res, '曲库接口只对本机开放', 403);
    else { res.writeHead(403); res.end(); }
    return true;
  }

  const method = req.method.toUpperCase();
  const what = pathname.slice(PREFIX.length) || '/';

  if (method === 'GET' && (what === '/status' || what === '/')) {
    const up = await ensureUp();
    if (!up) {
      ok(res, {
        up: false, base: BASE, python: PYTHON, script: SERVER_SCRIPT, pid: state.pid,
        error: state.spawnError || '剪映 API 没起来（看 outputs/jianying-api.log）',
      });
      return true;
    }
    const payload = await request('GET', '/music/status', { timeout: 10000 })
      .catch((error) => ({ error: error.message }));
    ok(res, Object.assign({ up: true, base: BASE, pid: state.pid }, payload));
    return true;
  }

  if (method === 'GET' && (what === '/search' || what === '/native')) {
    const up = await ensureUp();
    if (!up) throw bad(503, state.spawnError || '剪映 API 没起来');
    const keyword = String(url.searchParams.get('q') || url.searchParams.get('keyword') || '').trim();
    const kind = String(url.searchParams.get('type') || 'music');
    const limit = Number(url.searchParams.get('limit') || 20);
    const target = what === '/native' ? '/music/native-search' : '/music/search';
    if (what === '/native' && !keyword) throw bad(400, '先给个关键词');
    const query = upstreamQuery([
      ['keyword', keyword],
      ['type', kind === 'all' || kind === 'local' ? '' : kind],
      ['limit', Number.isFinite(limit) && limit > 0 ? Math.min(Math.round(limit), 100) : 20],
    ]);
    const payload = await request('GET', target + query, { timeout: what === '/native' ? 90000 : 15000 });
    ok(res, Object.assign({ up: true, source: what === '/native' ? 'native' : 'local' }, payload));
    return true;
  }

  if (method === 'POST' && what === '/download') {
    const body = await readBody(req);
    const resourceId = String(body.resource_id || body.resourceId || '').trim();
    if (!resourceId) throw bad(400, '缺少 resource_id');
    const up = await ensureUp();
    if (!up) throw bad(503, state.spawnError || '剪映 API 没起来');
    const payload = await request('POST', '/music/download', {
      timeout: 300000,
      body: {
        resource_id: resourceId,
        type: String(body.type || 'music'),
        title: body.title ? String(body.title) : undefined,
      },
    });
    ok(res, Object.assign({ up: true }, payload));
    return true;
  }

  if (method === 'GET' && what === '/preview') {
    const target = String(url.searchParams.get('url') || '').trim();
    if (!target) throw bad(400, '缺少 url');
    let parsed;
    try { parsed = new URL(target); } catch (e) { throw bad(400, 'url 不合法'); }
    if (parsed.protocol !== 'https:') throw bad(400, '只转 https');
    if (!hostAllowed(parsed.hostname)) throw bad(403, '不在试听白名单里：' + parsed.hostname);
    proxyAudio(req, res, parsed);
    return true;
  }

  if (method === 'GET' && what === '/audio') {
    const target = String(url.searchParams.get('path') || '').trim();
    if (!target) throw bad(400, '缺少 path');
    const resolved = path.resolve(target);
    if (!AUDIO_MIME[path.extname(resolved).toLowerCase()]) throw bad(400, '不是音频文件');
    if (!roots().some((root) => inside(resolved, root))) throw bad(403, '只给曲库目录里的音频');
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw bad(404, '文件不存在');
    serveAudio(req, res, resolved);
    return true;
  }

  throw bad(404, '未知的曲库接口：' + pathname);
};
