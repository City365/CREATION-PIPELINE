'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { URL } = require('node:url');
const config = require('./config');
const workflows = require('./workflows');
const providers = require('./providers');
const prompts = require('./prompts');
const library = require('./library');
const auth = require('./auth');
const internalAuth = require('./internal-auth');
const projects = require('./projects');
const styles = require('./styles');
const jobs = require('./jobs');
const batch = require('./batch');
const events = require('./events');
const channels = require('./channels');
const imagegen = require('./imagegen');
const imageTasks = require('./image-tasks');
const genericVideo = require('./generic-video');
const tts = require('./tts');
const voices = require('./voices');
const managerVideo = require('./manager-video');
const studioStore = require('./studio-store');
const workbenchStore = require('./workbench-store');
const workbenchRoutes = require('./workbench-routes');
const generationStore = require('./generation-store');
const creativeRoutes = require('./creative-routes');
const [ensureDir, readJson, writeJson, uid] = [require('./util').ensureDir, require('./util').readJson, require('./util').writeJson, require('./util').uid];
const { sanitizeFilename, kindOf, mimeFor, publicError, formatBytes, estimateTokens, httpJson } = require('./util');

const WEB = path.join(__dirname, '..', 'web');
const AGENT_URL = process.env.H3_AGENT_URL || 'http://127.0.0.1:17820';
const AGENT_PROJECT = process.env.H3_AGENT_PROJECT || 'h3-studio';
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/generation-params.js': ['generation-params.js', 'text/javascript; charset=utf-8'],
  '/image-tasks.js': ['image-tasks.js', 'text/javascript; charset=utf-8'],
  '/events.js': ['events.js', 'text/javascript; charset=utf-8'],
  '/workbench-manager.js': ['workbench-manager.js', 'text/javascript; charset=utf-8'],
  '/workbench.css': ['workbench.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/edit-math.js': ['edit-math.js', 'text/javascript; charset=utf-8'],
  '/edit-enhancements.js': ['edit-enhancements.js', 'text/javascript; charset=utf-8'],
  '/creative.js': ['creative.js', 'text/javascript; charset=utf-8'],
  '/creative.css': ['creative.css', 'text/css; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/skins.css': ['skins.css', 'text/css; charset=utf-8'],
  '/wallpaper-library.js': ['wallpaper-library.js', 'text/javascript; charset=utf-8'],
  '/skins/anime-sea.png': ['skins/anime-sea.png', 'image/png'],
  '/skins/anime-garden.png': ['skins/anime-garden.png', 'image/png'],
  '/skins/quiet-piano.wav': ['skins/quiet-piano.wav', 'audio/wav'],
  '/skins/real-cafe.png': ['skins/real-cafe.png', 'image/png'],
  '/skins/real-reading.png': ['skins/real-reading.png', 'image/png'],
  '/skins/real-cafe.mp4': ['skins/real-cafe.mp4', 'video/mp4'],
  '/skins/real-reading.mp4': ['skins/real-reading.mp4', 'video/mp4'],
  '/skins/moon.svg': ['skins/moon.svg', 'image/svg+xml'],
  '/skins/coast.svg': ['skins/coast.svg', 'image/svg+xml'],
  '/skins/forest.svg': ['skins/forest.svg', 'image/svg+xml'],
  '/h3.css': ['h3.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function ok(res, data) {
  json(res, 200, { ok: true, data });
}

function bad(res, message, status = 400) {
  json(res, status, { ok: false, error: String(message) });
}

async function readBody(req, limit = 120 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (!raw.length) return resolve({});
      try {
        resolve(JSON.parse(raw.toString('utf8')));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function allowedRoots() {
  const cfg = config.load();
  return [cfg.saveFolder, cfg.assetFolder, cfg.uploadFolder, path.join(cfg.dataDir, 'frames')].map((p) => path.resolve(p));
}

function isAllowed(file) {
  const abs = path.resolve(String(file));
  return allowedRoots().some((root) => abs === root || abs.startsWith(root + path.sep));
}

function serveFile(req, res, file, { download = false } = {}) {
  const abs = path.resolve(String(file));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return bad(res, '文件不存在', 404);
  const stat = fs.statSync(abs);
  const type = mimeFor(abs);
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range));
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-store',
      });
      return fs.createReadStream(abs, { start, end }).pipe(res);
    }
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    ...(download ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}` } : {}),
  });
  fs.createReadStream(abs).pipe(res);
}

function saveBase64Upload(name, base64, folder) {
  const clean = sanitizeFilename(name || 'upload');
  const data = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!data) throw new Error('文件内容为空');
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) throw new Error('文件内容为空');
  if (folder === 'assets') {
    const saved = library.saveAssetUpload(clean, buf, '');
    return { ...saved, name: path.basename(saved.path), bytes: buf.length, kind: kindOf(saved.path) };
  }
  const dir = ensureDir(config.load().uploadFolder);
  const target = path.join(dir, `${Date.now().toString(36)}-${clean}`);
  fs.writeFileSync(target, buf);
  return { path: target, rel: target, name: clean, bytes: buf.length, kind: kindOf(clean) };
}

async function llmChat(messages) {
  const cfg = config.llmConfig();
  if (!cfg.enabled || !cfg.apiKey) throw new Error('请先在设置里启用语言模型渠道并填写 API Key');
  const active = channels.active('llm');
  return providers.chat({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    protocol: cfg.protocol,
    messages,
    timeoutMs: cfg.timeoutMs || 180000,
    maxTokens: active ? active.maxTokens || 0 : 0,
  });
}

/**
 * 按渠道的「最大上下文 / 最大输出」裁剪历史：
 * 从最新消息往前装，装不下就丢掉更早的对话；单条就超预算时直接报错。
 */
function prepareMessages(history, systemPrompt, { contextWindow = 0, maxTokens = 0 } = {}) {
  const system = String(systemPrompt || '');
  const systemTokens = estimateTokens(system);
  const budget = contextWindow ? Math.max(512, contextWindow - (maxTokens || 0) - 512) : 0;
  const picked = [];
  let used = systemTokens;
  let trimmed = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const raw = history[i] || {};
    const content = String(raw.content || '').trim();
    if (!content) continue;
    const role = raw.role === 'assistant' ? 'assistant' : 'user';
    const cost = estimateTokens(content);
    if (budget && used + cost > budget) {
      trimmed = i + 1;
      break;
    }
    picked.unshift({ role, content });
    used += cost;
  }
  if (!picked.some((m) => m.role === 'user')) {
    const lastUser = [...history].reverse().find((m) => m && m.role !== 'assistant' && String(m.content || '').trim());
    const cost = lastUser ? estimateTokens(lastUser.content) : 0;
    return {
      messages: [],
      used: 0,
      trimmed: 0,
      error: `这条消息约 ${cost} tokens，超过当前渠道可用的 ${budget} tokens 输入预算；请删减内容，或到 设置 → 文本推理 调大「最大上下文」。`,
    };
  }
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push(...picked);
  return { messages, used, trimmed, error: '' };
}

function imageDataUrl(file) {
  const abs = path.resolve(String(file || ''));
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('图片不存在');
  const stat = fs.statSync(abs);
  if (stat.size > 8 * 1024 * 1024) throw new Error('图片超过 8MB，先压缩再反推');
  return `data:${mimeFor(abs)};base64,${fs.readFileSync(abs).toString('base64')}`;
}

const REVERSE_SYSTEM = `Reverse-engineer this image into a Midjourney-style English prompt as a single natural-language sentence. Place the main subject first, followed by environment, lighting, mood, color palette, art style / medium and camera details. Append common Midjourney parameters when appropriate (e.g. --ar 16:9 --style raw --v 7). Output one prompt line only. No preface, no commentary, no Markdown bold.`;

const IMAGE_PROMPT_SYSTEM = `You are an expert image prompt engineer. Rewrite the user's idea into one detailed English prompt for an image generation model. Keep the subject, composition, lighting, lens and style explicit; do not add text or explanations. Output only the prompt.`;

async function handleOptimize(body) {
  const cfg = config.llmConfig();
  if (!cfg.enabled || !cfg.apiKey) throw new Error('请先在设置里启用语言模型渠道并填写 API Key');
  const userPrompt = String(body.prompt || '').trim();
  if (!userPrompt) throw new Error('提示词为空，先写点想要的画面再优化');
  const assets = (body.assets || []).filter((a) => a && a.token);
  const subjects = (body.subjects || []).filter((s) => s && s.ordinal && s.name);
  const duration = Math.max(1, Math.min(15, Number(body.duration) || 10));
  const language = body.language === 'en' ? 'en' : 'zh';
  const messages = prompts.buildOptimizeMessages({
    prompt: userPrompt,
    assets,
    subjects,
    durationSeconds: duration,
    maxDurationSeconds: 15,
    language,
  });
  if (body.includeImages) {
    const parts = [];
    for (const asset of assets) {
      if (asset.kind === 'audio') continue;
      const abs = asset.path;
      if (!abs || !fs.existsSync(abs)) continue;
      const size = fs.statSync(abs).size;
      if (size > 6 * 1024 * 1024) continue;
      const buf = fs.readFileSync(abs);
      parts.push({ type: 'text', text: `${asset.token}${asset.subjectName ? ' = <Subject ' + (subjects.find((s) => s.name === asset.subjectName) || {}).ordinal + '>「' + asset.subjectName + '」' : ''}` });
      parts.push({ type: 'image_url', image_url: { url: `data:${mimeFor(abs)};base64,${buf.toString('base64')}` } });
    }
    if (parts.length) {
      const userMsg = messages[messages.length - 1];
      messages[messages.length - 1] = { role: 'user', content: [...parts, { type: 'text', text: userMsg.content }] };
    }
  }
  const started = Date.now();
  const result = await providers.chat({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    protocol: cfg.protocol,
    messages,
    timeoutMs: cfg.timeoutMs || 180000,
  });
  const text = prompts.normalizeModelOutput(result.content);
  const validation = prompts.validatePrompt(text, {
    tokens: assets.map((a) => a.token),
    subjects,
    duration,
  });
  return {
    prompt: text,
    warnings: validation.warnings,
    stats: validation.stats,
    model: result.model,
    elapsedMs: Date.now() - started,
  };
}

function collectJobFilters(url) {
  const status = url.searchParams.get('status') || '';
  const provider = url.searchParams.get('provider') || '';
  return { status, provider };
}

/**
 * 把 /api/agent/* 原样转给 17820 的智能体后端（SSE 流式透传）。
 * 前端只需要同源访问，不用处理 CORS，也不暴露后端端口。
 */
let servicesCache = { at: 0, value: null };
async function checkServices() {
  const now = Date.now();
  if (servicesCache.value && now - servicesCache.at < 4000) return servicesCache.value;
  const cfg = config.load();
  const mgrCh = (cfg.channels.video || []).find((c) => c.type === 'manager-video' && c.enabled !== false);
  const managerUrl = ((mgrCh && mgrCh.baseUrl) || process.env.H3_MANAGER_URL || 'http://127.0.0.1:17778').replace(/\/+$/, '');
  const out = {
    agent: { ok: false, url: AGENT_URL },
    manager: { ok: false, url: managerUrl, configured: !!mgrCh },
  };
  try {
    const res = await httpJson(AGENT_URL + '/agent/health', { headers: { 'X-Project-Id': AGENT_PROJECT }, timeoutMs: 1500 });
    if (res.ok) {
      out.agent = { ok: true, url: AGENT_URL, status: res.data.status, model: res.data.model, provider: res.data.provider };
    } else {
      out.agent.error = 'HTTP ' + res.status;
    }
  } catch (err) {
    out.agent.error = publicError(err);
  }
  try {
    const health = await httpJson(managerUrl + '/health', { timeoutMs: 1500 });
    if (health.ok) {
      out.manager = { ok: true, url: managerUrl, version: health.data.version, configured: !!mgrCh };
      if (mgrCh && mgrCh.apiKey) {
        try {
          const stateRes = await httpJson(managerUrl + '/api/state', {
            headers: { Authorization: 'Bearer ' + String(mgrCh.apiKey).replace(/^\s*Bearer\s+/i, '').trim() },
            timeoutMs: 2500,
          });
          if (stateRes.ok) {
            const accounts = (stateRes.data.accounts || []).filter((a) => a.enabled !== false);
            out.manager.doubao = accounts.filter((a) => a.platform === 'doubao').length;
            out.manager.gemini = accounts.filter((a) => a.platform === 'gemini').length;
            out.manager.accounts = accounts.length;
          }
        } catch { /* 账号数只是附加信息 */ }
      }
    } else {
      out.manager.error = 'HTTP ' + health.status;
    }
  } catch (err) {
    out.manager.error = publicError(err);
  }
  servicesCache = { at: now, value: out };
  return out;
}

function proxyAgent(req, res, pathname, search) {
  let target;
  try {
    target = new URL(AGENT_URL);
  } catch {
    return bad(res, '智能体地址配置无效', 502);
  }
  const upstreamPath = pathname.replace(/^\/api\/agent/, '/agent') + (search || '');
  const headers = { ...req.headers, host: target.host, 'x-project-id': req.headers['x-project-id'] || AGENT_PROJECT };
  delete headers.connection;
  delete headers['accept-encoding'];
  const upstream = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: upstreamPath,
    method: req.method,
    headers,
    timeout: 300000,
  }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on('timeout', () => {
    upstream.destroy(new Error('智能体服务响应超时'));
  });
  upstream.on('error', (err) => {
    if (res.headersSent) {
      try { res.end(); } catch { /* ignore */ }
      return;
    }
    const msg = /ECONNREFUSED|ENOTFOUND|ECONNRESET|socket hang up/i.test(err.message)
      ? `智能体后端没有启动（${AGENT_URL}），先运行 start-agent.cmd`
      : `智能体服务不可用：${err.message}`;
    bad(res, msg, 502);
  });
  req.pipe(upstream);
  res.on('close', () => { try { upstream.destroy(); } catch { /* ignore */ } });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method.toUpperCase();

  if (method === 'GET' && pathname.startsWith('/integrations/')) {
    const base = path.resolve(WEB, 'integrations');
    const file = path.resolve(WEB, '.' + pathname);
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return bad(res, 'not found', 404);
    const ext = path.extname(file).toLowerCase();
    const type = {'.js':'text/javascript; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.txt':'text/plain'}[ext] || 'application/octet-stream';
    res.writeHead(200, {'Content-Type':type,'Cache-Control':'no-store'}); fs.createReadStream(file).pipe(res);return;
  }
  if (method === 'GET' && STATIC[pathname]) {
    const [file, type] = STATIC[pathname];
    const abs = path.join(WEB, file);
    if (!fs.existsSync(abs)) return bad(res, 'not found', 404);
    if (type.startsWith('video/') || type.startsWith('audio/')) return serveFile(req, res, abs);
    const body = fs.readFileSync(abs);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': body.length });
    return res.end(body);
  }


  let currentUser = null;
  const token = auth.tokenFromRequest(req);
  const PUBLIC_API = new Set(['/api/health', '/api/auth/me', '/api/auth/login', '/api/auth/register', '/api/auth/logout']);
  const internalCall = internalAuth.authorized(req);
  if (auth.enabled() && pathname.startsWith('/api') && !PUBLIC_API.has(pathname) && !internalCall) {
    currentUser = auth.userByToken(token);
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
  }

  if (await workbenchRoutes(req,res,url,{ok,readBody,mediaPath:(input)=>{const abs=mediaPath(input);if(!isAllowed(abs)||!allowedRoots().some(root=>{try{const rel=path.relative(fs.realpathSync(root),fs.realpathSync(abs));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}catch{return false;}}))throw Error("文件不在素材目录内");return abs;}})) return;
  if (await creativeRoutes(req, res, url, {ok, bad, readBody, mediaPath, imageDataUrl, user:currentUser})) return;

  if (method === 'GET' && pathname === '/api/auth/me') {
    const user = auth.userByToken(token);
    return ok(res, { enabled: auth.enabled(), user: user ? auth.publicUser(user) : null });
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(req);
    const user = auth.register(body.username, body.password);
    const session = auth.login(body.username, body.password);
    res.setHeader('Set-Cookie', 'h3_session=' + encodeURIComponent(session.token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000');
    return ok(res, { user, enabled: true });
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const session = auth.login(body.username, body.password);
    res.setHeader('Set-Cookie', 'h3_session=' + encodeURIComponent(session.token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000');
    return ok(res, { user: session.user, enabled: true });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    auth.logout(token);
    res.setHeader('Set-Cookie', 'h3_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return ok(res, true);
  }

  if (method === 'POST' && pathname === '/api/auth/project') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    const body = await readBody(req);
    auth.setActiveProject(currentUser.id, body.projectId);
    return ok(res, true);
  }

  if (method === 'GET' && pathname === '/api/styles') {
    return ok(res, styles.all().map((s) => styles.publicStyle(s)));
  }

  const styleImageRoute = /^\/api\/styles\/([^/]+)\/image$/.exec(pathname);
  if (method === 'GET' && styleImageRoute) {
    const style = styles.get(styleImageRoute[1]);
    if (!style || !style.image) return bad(res, '没有风格预览图', 404);
    const abs = styles.imagePath(style);
    if (!fs.existsSync(abs)) return bad(res, '预览图不存在', 404);
    const body = fs.readFileSync(abs);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': body.length });
    return res.end(body);
  }

  const styleDetailRoute = /^\/api\/styles\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && styleDetailRoute) {
    const style = styles.get(styleDetailRoute[1]);
    if (!style) return bad(res, '风格不存在', 404);
    return ok(res, styles.detail(style));
  }

  if (method === 'GET' && pathname === '/api/projects') {
    return ok(res, projects.list().map((p) => projects.publicProject(p)));
  }

  if (method === 'POST' && pathname === '/api/projects') {
    const body = await readBody(req);
    const project = projects.create(body);
    if (currentUser) auth.setActiveProject(currentUser.id, project.id);
    return ok(res, projects.publicProject(project));
  }

  const projectRoute = /^\/api\/projects\/([^/]+)$/.exec(pathname);
  if (projectRoute) {
    const id = projectRoute[1];
    if (method === 'PUT') {
      const body = await readBody(req);
      return ok(res, projects.publicProject(projects.update(id, body)));
    }
    if (method === 'DELETE') {
      projects.remove(id);
      return ok(res, true);
    }
  }

  if (pathname.startsWith('/api/agent')) {
    return proxyAgent(req, res, pathname, url.search);
  }


const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENT_DIR = process.env.H3_AGENT_DIR || path.join(PROJECT_ROOT, 'agent_backend');
const MANAGER_DIR = process.env.H3_MANAGER_DIR || path.join(PROJECT_ROOT, '..', 'Video-Generation-Manager');
const PYTHON = process.env.H3_PYTHON || 'D:/notebook/AIGC/ml-engineer/backend/.venv/Scripts/python.exe';
const SERVICE_STATE = path.join(PROJECT_ROOT, 'data', 'service-pids.json');
const MANAGER_BASE = process.env.H3_MANAGER_URL || 'http://127.0.0.1:17778';

function readServicePids() {
  try { return JSON.parse(fs.readFileSync(SERVICE_STATE, 'utf8')); } catch { return {}; }
}
function writeServicePids(pids) {
  try { ensureDir(path.dirname(SERVICE_STATE)); fs.writeFileSync(SERVICE_STATE, JSON.stringify(pids, null, 2)); } catch { /* ignore */ }
}
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function pidOnPort(port) {
  try {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 4000 }).stdout || '';
    const line = out.split(/\r?\n/).find((l) => new RegExp(':' + port + '\\s').test(l) && /LISTENING/i.test(l));
    if (!line) return 0;
    const parts = line.trim().split(/\s+/);
    return Number(parts[parts.length - 1]) || 0;
  } catch { return 0; }
}
async function serviceHealth(name) {
  const url = name === 'agent' ? AGENT_URL + '/agent/health' : MANAGER_BASE + '/health';
  try {
    const res = await httpJson(url, name === 'agent' ? { headers: { 'X-Project-Id': AGENT_PROJECT }, timeoutMs: 1500 } : { timeoutMs: 1500 });
    return { ok: !!res.ok, data: res.data };
  } catch (err) {
    return { ok: false, error: publicError(err) };
  }
}
async function controlService(name, action) {
  if (!['agent', 'manager'].includes(name)) throw new Error('未知服务');
  if (!['start', 'stop'].includes(action)) throw new Error('未知操作');
  const pids = readServicePids();
  const health = await serviceHealth(name);
  if (action === 'start') {
    if (health.ok) return { ok: true, running: true, already: true };
    if (name === 'agent') {
      if (!fs.existsSync(path.join(AGENT_DIR, 'app', 'main.py'))) throw new Error('找不到智能体目录：' + AGENT_DIR);
      if (!fs.existsSync(PYTHON)) throw new Error('找不到 Python：' + PYTHON);
      const child = spawn(PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '17820'], {
        cwd: AGENT_DIR,
        env: { ...process.env, AGENT_SETTINGS_PATH: path.join(AGENT_DIR, 'data', 'agent_settings.json'), HARNESS_AUTH_MODE: 'development', H3_BASE_URL: 'http://127.0.0.1:17821' },
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
      pids.agent = child.pid;
    } else {
      if (!fs.existsSync(path.join(MANAGER_DIR, 'src', 'server.js'))) throw new Error('找不到管理器目录：' + MANAGER_DIR);
      const child = spawn(process.execPath, ['src/server.js'], {
        cwd: MANAGER_DIR,
        env: { ...process.env, DBM_REBUILD_PORT: '17778' },
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
      pids.manager = child.pid;
    }
    writeServicePids(pids);
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const h = await serviceHealth(name);
      if (h.ok) { servicesCache.at = 0; return { ok: true, running: true, pid: pids[name] }; }
    }
    servicesCache.at = 0;
    return { ok: false, running: false, error: '启动超时，请查看日志' };
  }
  const pid = pids[name] || pidOnPort(name === 'agent' ? 17820 : 17778);
  if (pid) {
    try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 8000, windowsHide: true }); } catch { /* ignore */ }
    delete pids[name];
    writeServicePids(pids);
  }
  servicesCache.at = 0;
  await new Promise((r) => setTimeout(r, 600));
  const after = await serviceHealth(name);
  return { ok: !after.ok, running: !!after.ok, stopped: !after.ok };
}

  if (method === 'GET' && pathname === '/api/services') return ok(res, await checkServices());
  if (method === 'POST' && pathname === '/api/services/control') {
    const body = await readBody(req);
    try {
      const result = await controlService(String(body.name || ''), String(body.action || ''));
      return ok(res, result);
    } catch (err) {
      return bad(res, publicError(err));
    }
  }

  if (method === 'GET' && pathname === '/api/health') return ok(res, { status: 'ok', name: 'h3-studio', uptime: process.uptime(), activeImageTasks:imageTasks.tasks().activeCount() });

  if (method === 'GET' && pathname === '/api/studio/state') {
    const q = new URL(req.url, 'http://127.0.0.1');
    return ok(res, studioStore.get(q.searchParams.get('projectId') || 'default'));
  }

  if (method === 'POST' && pathname === '/api/studio/state') {
    const body = await readBody(req);
    const saved = studioStore.save(body.projectId, body.state);
    return ok(res, saved);
  }

  if (method === 'GET' && pathname === '/api/state') {
    return ok(res, {
      config: config.publicView(),
      workflows: workflows.publicList(),
      defaultWorkflowId: workflows.defaultWorkflow().id,
      jobs: jobs.list(),
      stats: jobs.slotStats(),
      channels: {
        llm: channels.list('llm', { includeSecrets: true }),
        image: channels.list('image', { includeSecrets: true }),
        video: channels.list('video', { includeSecrets: true }),
      },
      channelTypes: channels.publicTypes(),
      prompt: {
        sections: prompts.SECTION_KEYS,
        labels: prompts.SECTION_LABEL,
        examples: prompts.EXAMPLES,
        skeleton: prompts.SKELETON,
      },
    });
  }

  if (method === 'POST' && pathname === '/api/batch/parse') {
    const body = await readBody(req);
    return ok(res, batch.parseBatch(body.json, { baseDir: body.baseDir, fileDir: body.fileDir, name: body.name }));
  }

  if (method === 'POST' && pathname === '/api/batch/add') {
    const body = await readBody(req);
    const parsed = batch.parseBatch(body.json, { baseDir: body.baseDir, fileDir: body.fileDir, name: body.name });
    if (!parsed.tasks.some((t) => !t.errors.length)) return bad(res, '没有可提交的任务：' + (parsed.errors[0] || '请检查 JSON'));
    const inputs = batch.toJobInputs(parsed, body.workflowId);
    const created = inputs.flatMap((input) => jobs.addJobs(input));
    return ok(res, { count: created.length, tasks: parsed.tasks.length, warnings: parsed.warnings });
  }

  if (method === 'POST' && pathname === '/api/prompt/validate') {
    const body = await readBody(req);
    return ok(res, prompts.validatePrompt(String(body.prompt || ''), {
      tokens: (body.assets || []).map((a) => a.token),
      subjects: body.subjects || [],
      duration: Number(body.duration) || 10,
    }));
  }

  if (method === 'GET' && pathname === '/api/channels/types') {
    return ok(res, channels.publicTypes());
  }

  if (method === 'GET' && pathname === '/api/channels') {
    return ok(res, {
      llm: channels.list('llm', { includeSecrets: true }),
      image: channels.list('image', { includeSecrets: true }),
      video: channels.list('video', { includeSecrets: true }),
    });
  }

  if (method === 'POST' && pathname === '/api/channels/manager-accounts') {
    const body = await readBody(req);
    const baseUrl = String(body.baseUrl || '').trim() || managerVideo.DEFAULT_BASE;
    const apiKey = String(body.apiKey || '').trim() || (() => {
      const cfg = config.load();
      const ch = (cfg.channels.video || []).find((c) => c.id === body.channelId);
      return (ch && ch.apiKey) || '';
    })();
    try {
      const list = await managerVideo.accounts({ baseUrl, apiKey });
      return ok(res, { accounts: list });
    } catch (err) {
      return bad(res, publicError(err));
    }
  }

  if (method === 'POST' && pathname === '/api/open') {
    const body = await readBody(req);
    const target = String(body.url || '').trim();
    let parsed;
    try { parsed = new URL(target); } catch { return bad(res, '地址无效'); }
    if (!/^https?:$/.test(parsed.protocol) || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
      return bad(res, '只允许打开本机服务地址');
    }
    library.openUrl(target);
    return ok(res, true);
  }

  if (method === 'POST' && pathname === '/api/channels/models') {
    const body = await readBody(req);
    const kind = ['llm', 'image', 'video'].includes(body.kind) ? body.kind : 'llm';
    let apiKey = String(body.apiKey || '').trim();
    if (!apiKey && body.channelId) {
      const existing = channels.get(kind, String(body.channelId));
      if (existing) apiKey = existing.apiKey || '';
    }
    const baseUrl = String(body.baseUrl || '').trim();
    if (!baseUrl) return bad(res, '先填 Base URL，再获取模型');
    const type = String(body.type || '');
    const protocol = type === 'gemini' || type === 'gemini-image' ? 'gemini' : type === 'openai-responses' ? 'responses' : 'chat';
    let models;
    try {
      models = await providers.listModels(baseUrl, apiKey, protocol);
    } catch (err) {
      const raw = String(err.message || err);
      const friendly = /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timeout|超时/i.test(raw)
        ? `连不上 ${baseUrl}（${raw}），检查地址 / 端口 / 代理`
        : raw;
      return bad(res, friendly);
    }
    return ok(res, { models, protocol });
  }

  if (method === 'POST' && pathname === '/api/channels') {
    const body = await readBody(req);
    const kind = ['llm', 'image', 'video'].includes(body.kind) ? body.kind : '';
    if (!kind) return bad(res, '未知渠道类型');
    const created = channels.create(kind, body);
    return ok(res, channels.list(kind).find((c) => c.id === created.id));
  }

  const channelRoute = /^\/api\/channels\/([^/]+)(?:\/(activate|test))?$/.exec(pathname);
  if (channelRoute) {
    const id = channelRoute[1];
    const action = channelRoute[2] || '';
    if (method === 'PUT' && !action) {
      const body = await readBody(req);
      const kind = body.kind;
      if (!['llm', 'image', 'video'].includes(kind)) return bad(res, '未知渠道类型');
      const updated = channels.update(kind, id, body);
      return ok(res, channels.list(kind).find((c) => c.id === updated.id));
    }
    if (method === 'DELETE' && !action) {
      const kind = url.searchParams.get('kind') || '';
      if (!['llm', 'image', 'video'].includes(kind)) return bad(res, '未知渠道类型');
      channels.remove(kind, id);
      return ok(res, true);
    }
    if (method === 'POST' && action === 'activate') {
      const body = await readBody(req);
      const kind = body.kind;
      if (!['llm', 'image', 'video'].includes(kind)) return bad(res, '未知渠道类型');
      return ok(res, channels.activate(kind, id));
    }
    if (method === 'POST' && action === 'test') {
      const body = await readBody(req);
      const kind = body.kind;
      if (!['llm', 'image', 'video'].includes(kind)) return bad(res, '未知渠道类型');
      const channel = channels.get(kind, id);
      if (!channel) return bad(res, '渠道不存在', 404);
      let result;
      try {
        if (!channel.apiKey && channel.type !== 'manager-video') {
          result = { ok: false, message: '这个渠道还没有填 API Key，点「编辑」补上再测试' };
          channels.setTestResult(kind, id, result.ok, result.message);
          return ok(res, result);
        }
        if (kind === 'llm') {
          const protocol = channel.type === 'openai-responses' ? 'responses' : channel.type === 'gemini' ? 'gemini' : 'chat';
          const out = await providers.chat({
            baseUrl: channel.baseUrl,
            apiKey: channel.apiKey,
            model: channel.model,
            protocol,
            messages: [{ role: 'user', content: '只回复两个字：可用' }],
            timeoutMs: 60000,
          });
          result = { ok: true, message: '可用 · ' + String(out.content).trim().slice(0, 60) };
        } else if (kind === 'image') {
          result = await imagegen.test(channel);
        } else if (channel.type === 'manager-video') {
          result = await managerVideo.test(channel);
        } else {
          result = await genericVideo.test(channel);
        }
      } catch (err) {
        result = { ok: false, message: publicError(err) };
      }
      channels.setTestResult(kind, id, result.ok, result.message);
      return ok(res, result);
    }
  }

  if (method === 'POST' && pathname === '/api/images/describe') {
    const body = await readBody(req);
    const file = path.resolve(String(body.path || ''));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return bad(res, '图片不存在');
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(file)) return bad(res, '只支持图片文件');
    const channel = channels.active('llm') || channels.list('llm', { includeSecrets: true }).find((c) => c.enabled !== false);
    if (!channel) return bad(res, '没有可用的文本推理渠道');
    const dataUrl = imageDataUrl(file);
    const out = await providers.chat({
      baseUrl: channel.baseUrl,
      apiKey: channel.apiKey,
      model: channel.model,
      protocol: channel.type === 'gemini' ? 'gemini' : channel.type === 'openai-responses' ? 'responses' : 'chat',
      maxTokens: 900,
      timeoutMs: 180000,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '用中文客观描述这张图：主体与人物、场景、光线、构图、风格，以及画面里的文字（逐字列出）。不要评价好坏，不要编造看不到的内容。' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
    });
    const text = String((out && out.content) || '').trim();
    if (!text) return bad(res, '模型没有返回描述');
    return ok(res, { text, model: channel.model });
  }

  if (method === 'POST' && pathname === '/api/images/reverse') {
    const body = await readBody(req);
    const dataUrl = imageDataUrl(body.path);
    const result = await llmChat([
      { role: 'system', content: REVERSE_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Reverse-engineer this image.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ]);
    return ok(res, { prompt: String(result.content).trim(), model: result.model });
  }

  if (method === 'POST' && pathname === '/api/images/prompt') {
    const body = await readBody(req);
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return bad(res, '提示词为空');
    const result = await llmChat([
      { role: 'system', content: IMAGE_PROMPT_SYSTEM },
      { role: 'user', content: prompt },
    ]);
    return ok(res, { prompt: String(result.content).trim(), model: result.model });
  }


function imageHistoryFile() {
  const dir = config.load().dataDir || path.join(__dirname, '..', 'data');
  ensureDir(dir);
  return path.join(dir, 'image-history.json');
}

function readImageHistory() {
  try {
    const list = JSON.parse(fs.readFileSync(imageHistoryFile(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function rememberImageBatch(entry) {
  try {
    const list = readImageHistory();
    list.unshift(entry);
    fs.writeFileSync(imageHistoryFile(), JSON.stringify(list.slice(0, 80), null, 2) + '\n', 'utf8');
  } catch { /* 历史记录不影响生成 */ }
}

  if (method === 'GET' && pathname === '/api/images/history') {
    return ok(res, { items: readImageHistory() });
  }

  if (method === 'GET' && pathname === '/api/images/tasks') {
    return ok(res,{tasks:imageTasks.tasks().list(url.searchParams.get('projectId')||undefined)});
  }
  const imageAction=/^\/api\/images\/tasks\/([^/]+)(?:\/(pause|resume|retry))?$/.exec(pathname);
  if(imageAction){
    const worker=imageTasks.tasks();
    if(method==='GET')return ok(res,worker.get(imageAction[1]));
    if(method==='POST'&&imageAction[2])return ok(res,worker[imageAction[2]](imageAction[1]));
    return bad(res,'method not allowed',405);
  }
  if (method === 'POST' && pathname === '/api/images/generate') {
    const body=await readBody(req),worker=imageTasks.tasks();
    const task=worker.enqueue(body);
    let eventId=null;try{eventId=events.recordSingleImage(task,'image');}catch{ /* 事件失败不影响任务 */ }
    if(body.background)return ok(res,{taskId:task.id,runId:task.id,status:task.status,eventId});
    const result=await worker.wait(task.id);
    if(result.status!=='success')return bad(res,result.error||'图像任务未完成');
    return ok(res,result.result);
  }

  if (method === 'POST' && pathname === '/api/images/save-copy') {
    const body = await readBody(req);
    const cfg = config.load();
    const target = String(body.target || 'assets');
    const paths = (Array.isArray(body.paths) ? body.paths : [body.path]).filter(Boolean);
    if (!paths.length) return bad(res, '没有要保存的图片');
    let dir;
    if (target === 'assets') dir = cfg.assetFolder;
    else if (target === 'media') dir = path.join(cfg.saveFolder, 'images', new Date().toISOString().slice(0, 10));
    else if (target === 'custom') {
      dir = String(body.dir || '').trim();
      if (!dir || !path.isAbsolute(dir)) return bad(res, '自定义目录必须是绝对路径');
    } else return bad(res, '未知保存位置');
    ensureDir(dir);
    const saved = [];
    for (const raw of paths) {
      const src = path.resolve(String(raw));
      if (!isAllowed(src) || !fs.existsSync(src) || !fs.statSync(src).isFile()) return bad(res, '源文件不可用：' + src);
      let name = sanitizeFilename(String(body.name || path.basename(src)));
      if (!path.extname(name)) name += path.extname(src) || '.png';
      let dest = path.join(dir, name);
      let index = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(dir, path.basename(name, path.extname(name)) + '-' + index + path.extname(name));
        index += 1;
      }
      fs.copyFileSync(src, dest);
      generationStore.link(src,dest);
      saved.push({ name: path.basename(dest), path: dest, bytes: fs.statSync(dest).size, folder: dir });
    }
    return ok(res, { target, folder: dir, items: saved });
  }

  if (method === 'POST' && pathname === '/api/images/save') {
    const body = await readBody(req);
    const data = String(body.data || '');
    const m = /^data:([^;]+);base64,(.+)$/.exec(data);
    if (!m) return bad(res, '数据不是 base64 图片');
    const buffer = Buffer.from(m[2], 'base64');
    if (!buffer.length) return bad(res, '图片为空');
    const saved = imagegen.saveImages([{ buffer, mime: m[1] }]);
    if(body.sourcePath&&isAllowed(body.sourcePath)) generationStore.link(body.sourcePath,saved.items[0].path);
    rememberImageBatch({ id: saved.id, items: saved.items, prompt: String(body.prompt || ''), kind: 'edit', createdAt: Date.now() });
    return ok(res, { id: saved.id, item: saved.items[0] });
  }

  if (method === 'POST' && pathname === '/api/assets/from-file') {
    const body = await readBody(req);
    const src = path.resolve(String(body.path || ''));
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return bad(res, '文件不存在');
    if (!isAllowed(src)) return bad(res,'源文件不在素材目录内');
    const saved = library.saveAssetUpload(path.basename(src), fs.readFileSync(src), body.folder || '');
    generationStore.link(src,saved.path);
    return ok(res, { rel: saved.rel, path: saved.path });
  }

  if (method === 'PUT' && pathname === '/api/config') {
    const body = await readBody(req);
    const patch = {};
    for (const key of ['concurrency', 'saveFolder', 'assetFolder', 'voiceLibraryFolder', 'autodlKeys', 'llm', 'prompt', 'ui']) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (patch.saveFolder) ensureDir(patch.saveFolder);
    if (patch.assetFolder) ensureDir(patch.assetFolder);
    if (Array.isArray(patch.autodlKeys)) {
      patch.autodlKeys = patch.autodlKeys.map((k) => {
        const old = k && k.id ? config.keyById(k.id) : null;
        return { ...k, token: String(k && k.token || '').trim() || (old ? old.token : '') };
      });
    }
    if (patch.llm && !String(patch.llm.apiKey || '').trim()) {
      patch.llm.apiKey = config.llmConfig().apiKey;
    }
    const saved = config.save(patch);
    return ok(res, config.publicView());
  }


  if (method === 'POST' && pathname === '/api/autodl/verify') {
    const body = await readBody(req);
    let token = String(body.token || '').trim();
    const key = body.keyId ? config.keyById(body.keyId) : null;
    if (!token && key) token = key.token;
    const result = await providers.verifyAutodlKey(token);
    if (key) {
      const cfg = config.load();
      const next = cfg.autodlKeys.map((k) => k.id === key.id
        ? { ...k, lastVerifiedAt: Date.now(), lastVerifyOk: result.ok, lastVerifyMessage: result.message }
        : k);
      config.save({ autodlKeys: next });
    }
    return ok(res, result);
  }

  if (method === 'POST' && pathname === '/api/llm/models') {
    const body = await readBody(req);
    const cfg = config.llmConfig();
    const baseUrl = String(body.baseUrl || cfg.baseUrl || '');
    const apiKey = String(body.apiKey || cfg.apiKey || '');
    if (!baseUrl) return bad(res, '缺少 Base URL');
    return ok(res, { models: await providers.listModels(baseUrl, apiKey) });
  }

  if (method === 'POST' && pathname === '/api/llm/test') {
    const cfg = config.llmConfig();
    const body = await readBody(req);
    const baseUrl = String(body.baseUrl || cfg.baseUrl || '');
    const apiKey = String(body.apiKey || cfg.apiKey || '');
    const model = String(body.model || cfg.model || '');
    if (!baseUrl || !apiKey || !model) return bad(res, '请先填写 Base URL、API Key 和模型 ID');
    const started = Date.now();
    const result = await providers.chat({
      baseUrl,
      apiKey,
      model,
      protocol: body.protocol || cfg.protocol || 'chat',
      messages: [{ role: 'user', content: '只回复两个字：可用' }],
      timeoutMs: 60000,
    });
    return ok(res, { message: String(result.content).trim().slice(0, 80), elapsedMs: Date.now() - started });
  }

  if (method === 'POST' && pathname === '/api/optimize') {
    return ok(res, await handleOptimize(await readBody(req)));
  }

  if (method === 'POST' && pathname === '/api/upload/raw') {
    const name = sanitizeFilename(url.searchParams.get('name') || 'upload');
    const limit = (/\.(mp4|webm)$/i.test(name) ? 600 : /\.(mp3|wav|m4a|ogg|flac)$/i.test(name) ? 60 : 10) * 1024 * 1024;
    if (Number(req.headers['content-length']) > limit) {
      req.resume();
      return bad(res, '文件超过上传大小限制', 413);
    }
    const target = path.join(ensureDir(config.load().uploadFolder), `${uid()}-${name}`);
    const partial = target + '.part';
    let handle, bytes = 0;
    try {
      handle = await fs.promises.open(partial, 'wx');
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > limit) throw new Error('文件超过上传大小限制');
        let offset = 0;
        while (offset < chunk.length) {
          const result = await handle.write(chunk, offset, chunk.length - offset);
          offset += result.bytesWritten;
        }
      }
      if (!bytes) throw new Error('文件内容为空');
      await handle.close();
      handle = null;
      await fs.promises.rename(partial, target);
      return ok(res, { path: target, rel: target, name, bytes, kind: kindOf(name) });
    } catch (err) {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.unlink(partial).catch(() => {});
      throw err;
    }
  }

  if (method === 'POST' && pathname === '/api/upload') {
    const body = await readBody(req);
    const saved = saveBase64Upload(body.name, body.data, body.folder);
    return ok(res, saved);
  }

  if (method === 'GET' && pathname === '/api/file') {
    const file = url.searchParams.get('path');
    if (!file || !isAllowed(file)) return bad(res, '非法路径', 403);
    return serveFile(req, res, file, { download: url.searchParams.get('download') === '1' });
  }

/* ------------------------- 智能体可用的本地创作工具 ------------------------- */

const FFMPEG = process.env.H3_FFMPEG || 'D:/notebook/software/ffmpeg/bin/ffmpeg.exe';
const FFPROBE = process.env.H3_FFPROBE || 'D:/notebook/software/ffmpeg/bin/ffprobe.exe';

function runCommand(cmd, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error('命令超时：' + path.basename(cmd)));
    }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error('无法运行 ' + path.basename(cmd) + '：' + err.message)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error((stderr || stdout || '命令失败').trim().slice(0, 600)));
      resolve({ stdout, stderr });
    });
  });
}

function mediaPath(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('缺少视频路径');
  const abs = path.resolve(raw);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('文件不存在：' + abs);
  return abs;
}

  if (method === 'POST' && pathname === '/api/reveal') {
    const body = await readBody(req);
    const file = String(body.path || '');
    if (!file) return bad(res, '缺少路径');
    const select = !!body.select;
    if (!fs.existsSync(file)) return bad(res, '路径不存在');
    library.openPath(file, { select });
    return ok(res, true);
  }

  if (method === 'GET' && pathname === '/api/jobs') {
    const { status, provider } = collectJobFilters(url);
    let list = jobs.list();
    if (status) list = list.filter((j) => j.status === status);
    if (provider) list = list.filter((j) => j.provider === provider);
    return ok(res, { jobs: list, stats: jobs.slotStats() });
  }

  if (method === 'POST' && pathname === '/api/jobs') {
    const body = await readBody(req);
    body.userPrompt = String(body.prompt||'');
    if (body.itemId) workbenchStore.store().get(body.itemId,body.projectId,'video');
    if (body.applyStyle !== false && (typeof body.prefixPrompt==='string' || body.styleId)) {
      const stylePrefix = typeof body.prefixPrompt==='string'?body.prefixPrompt.trim():styles.promptFor(body.styleId, { layer: body.styleLayer || 'video', text: body.prompt });
      if (stylePrefix) body.prompt = stylePrefix + '\n\n' + String(body.prompt || '');
    }
    const wf = workflows.get(body.workflowId);
    if (!wf) return bad(res, '工作流不存在');
    const check = workflows.validate(wf, body);
    if (check.errors.length) return bad(res, check.errors.join('；'));
    const created = jobs.addJobs(body);
    let eventId = null;
    try { eventId = events.recordJobs(created, body.eventId ? 'batch' : 'studio'); } catch { /* 事件失败不影响任务 */ }
    return ok(res, { jobs: created.map((j) => ({ id: j.id })), eventId, warnings: check.warnings });
  }

  if (method === 'GET' && pathname === '/api/events') {
    return ok(res, events.list({ status: url.searchParams.get('status') || '', source: url.searchParams.get('source') || '', limit: url.searchParams.get('limit') }));
  }

  if (method === 'POST' && pathname === '/api/events/import') {
    const body = await readBody(req);
    const parsed = batch.parseBatch(body.json, { baseDir: body.baseDir, fileDir: body.fileDir, name: body.name });
    const inputs = batch.toJobInputs(parsed, body.workflowId);
    if (!inputs.length) return bad(res, '没有可导入的任务：' + (parsed.errors.join('；') || '请检查 JSON'));
    const event = events.createFromJobInputs(inputs, { title: body.title || parsed.name || '', source: 'batch', workflowId: body.workflowId, projectId: body.projectId || '', channelId: body.channelId || '' });
    return ok(res, event);
  }

  if (method === 'POST' && pathname === '/api/events') {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return bad(res, '事件没有条目');
    const inputs = items.map((item) => ({ ...item, workflowId: item.workflowId || body.workflowId, count: 1, projectId: body.projectId || item.projectId, itemId: body.itemId || item.itemId }));
    const event = events.createFromJobInputs(inputs, { title: body.title, source: ['batch', 'studio', 'image', 'api'].includes(body.source) ? body.source : 'api', workflowId: body.workflowId, projectId: body.projectId || '', channelId: body.channelId || '' });
    return ok(res, event);
  }

  const eventItemLog = /^\/api\/events\/([^/]+)\/items\/([^/]+)\/log$/.exec(pathname);
  if (method === 'GET' && eventItemLog) return ok(res, events.itemLog(eventItemLog[1], eventItemLog[2]));

  const eventRoute = /^\/api\/events\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && eventRoute) return ok(res, events.get(eventRoute[1]));

  const jobAction = /^\/api\/jobs\/([^/]+)\/(cancel|retry|resume|delete|hold|unhold|logs)$/.exec(pathname);
  if (jobAction) {
    const id = jobAction[1];
    const action = jobAction[2];
    if (action === 'logs' && method === 'GET') {
      const job = jobs.get(id);
      if (!job) return bad(res, '任务不存在', 404);
      return ok(res, { logs: (job.logs && job.logs.length) ? job.logs : jobs.readLog(id) });
    }
    if (method !== 'POST') return bad(res, 'method not allowed', 405);
    if (action === 'cancel') return ok(res, jobs.cancel(id));
    if (action === 'retry') return ok(res, jobs.retry(id));
    if (action === 'resume') return ok(res, await jobs.resume(id));
    if (action === 'delete') return ok(res, jobs.remove(id));
    if (action === 'hold') return ok(res, jobs.setHeld(id, true));
    if (action === 'unhold') return ok(res, jobs.setHeld(id, false));
  }

  if (method === 'POST' && pathname === '/api/jobs/reorder') {
    const body = await readBody(req);
    return ok(res, jobs.reorder(Array.isArray(body.ids) ? body.ids : []));
  }

  if (method === 'GET' && pathname === '/api/assets') {
    return ok(res, library.scanAssets());
  }

  if (method === 'POST' && pathname === '/api/assets/upload') {
    const body = await readBody(req);
    return ok(res, saveBase64Upload(body.name, body.data, 'assets'));
  }

  if (method === 'POST' && pathname === '/api/assets/move') {
    const body = await readBody(req);
    return ok(res, { rel: library.moveAsset(body.rel, body.folder) });
  }

  if (method === 'POST' && pathname === '/api/assets/rename') {
    const body = await readBody(req);
    return ok(res, { rel: library.renameAsset(body.rel, body.name) });
  }

  if (method === 'POST' && pathname === '/api/assets/subject') {
    const body = await readBody(req);
    return ok(res, library.setSubject(body.rel, body.subject));
  }

  if (method === 'POST' && pathname === '/api/assets/folder') {
    const body = await readBody(req);
    return ok(res, { name: library.createFolder(body.name) });
  }

  if (method === 'GET' && pathname === '/api/assets/file') {
    return serveFile(req, res, library.fileForAsset(url.searchParams.get('rel') || ''));
  }

  if (method === 'GET' && pathname === '/api/media') {
    return ok(res, library.listMedia(url.searchParams.get('kind') || ''));
  }

  if (method === 'GET' && pathname === '/api/media/file') {
    return serveFile(req, res, library.mediaFile(url.searchParams.get('path') || ''));
  }

  if (method === 'POST' && pathname === '/api/media/open') {
    const body = await readBody(req);
    if (body.player) library.openWithSystemPlayer(body.path);
    else library.openPath(body.path, { select: false });
    return ok(res, true);
  }

  if (method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const onJob = (job) => send('job', job);
    const onRefresh = () => send('refresh', {});
    jobs.emitter.on('job', onJob);
    jobs.emitter.on('refresh', onRefresh);
    const timer = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(timer);
      jobs.emitter.off('job', onJob);
      jobs.emitter.off('refresh', onRefresh);
    });
    return;
  }

  if (method === 'GET' && pathname === '/api/prompt') {
    return ok(res, { skeleton: prompts.SKELETON, examples: prompts.EXAMPLES, labels: prompts.SECTION_LABEL, sections: prompts.SECTION_KEYS });
  }

  if (method === 'GET' && pathname === '/api/voices') {
    const list = await tts.listVoices({ refresh: url.searchParams.get('refresh') === '1' });
    return ok(res, { engine: tts.IS_WIN ? 'sapi' : 'none', voices: list });
  }

  if (method === 'POST' && pathname === '/api/tts') {
    const body = await readBody(req);
    const item = await tts.speak({ text: body.text, voice: body.voice, rate: body.rate });
    return ok(res, item);
  }

  if (method === 'POST' && pathname === '/api/llm/chat') {
    // 一次性文本对话：不存会话，按渠道的 maxTokens / contextWindow 裁剪历史。
    // 主要给脚本、测试和外部调用用；创作台走 /api/agent 的智能体服务。
    const body = await readBody(req);
    const channel = body.channelId
      ? channels.get('llm', body.channelId)
      : channels.active('llm');
    if (body.channelId && !channel) return bad(res, '文本推理渠道不存在');
    if (channel && channel.enabled === false) return bad(res, '这个渠道已停用，先去 设置 → 文本推理 启用');
    let cfg;
    if (channel) {
      cfg = {
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        model: channel.model,
        protocol: channel.type === 'openai-responses' ? 'responses' : channel.type === 'gemini' ? 'gemini' : 'chat',
        timeoutMs: 180000,
        maxTokens: channel.maxTokens || 0,
      };
    } else {
      cfg = config.llmConfig();
    }
    if (!cfg || !cfg.apiKey) return bad(res, '还没有可用的文本推理渠道，请到 设置 → 文本推理 添加并启用');
    const history = Array.isArray(body.messages) ? body.messages : [];
    const contextWindow = channel ? Number(channel.contextWindow) || 0 : 0;
    const maxTokens = channel ? Number(channel.maxTokens) || 0 : 0;
    const system = String(body.system || '').trim();
    const prepared = prepareMessages(history, system, { contextWindow, maxTokens });
    if (prepared.error) return bad(res, prepared.error);
    if (!prepared.messages.some((m) => m.role === 'user')) return bad(res, '先说点什么');
    const out = await providers.chat({ ...cfg, messages: prepared.messages });
    const text = String(out && out.content !== undefined ? out.content : out || '').trim();
    if (!text) return bad(res, '模型没有返回内容');
    return ok(res, {
      reply: text,
      model: cfg.model || '',
      usage: {
        contextWindow,
        maxTokens,
        estimatedInput: prepared.used,
        trimmed: prepared.trimmed,
      },
    });
  }

  if (method === 'POST' && pathname === '/api/tools/probe') {
    try {
      const body = await readBody(req);
      const file = mediaPath(body.path);
      const { stdout } = await runCommand(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
      const info = JSON.parse(stdout);
      const videoStream = (info.streams || []).find((x) => x.codec_type === 'video') || {};
      const audioStream = (info.streams || []).find((x) => x.codec_type === 'audio') || null;
      return ok(res, {
        path: file,
        name: path.basename(file),
        duration: Number(info.format && info.format.duration) || 0,
        size: Number(info.format && info.format.size) || fs.statSync(file).size,
        width: Number(videoStream.width) || 0,
        height: Number(videoStream.height) || 0,
        fps: videoStream.r_frame_rate || '',
        codec: videoStream.codec_name || '',
        hasAudio: !!audioStream,
      });
    } catch (err) {
      return bad(res, publicError(err));
    }
  }

  if (method === 'POST' && pathname === '/api/tools/frames') {
    try {
      const body = await readBody(req);
      const file = mediaPath(body.path);
      const count = Math.max(1, Math.min(12, Number(body.count) || 6));
      const width = Math.max(320, Math.min(1600, Number(body.width) || 960));
      const probe = await runCommand(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', file]);
      const duration = Number(JSON.parse(probe.stdout).format && JSON.parse(probe.stdout).format.duration) || 0;
      if (!duration) return bad(res, '读不到视频时长，无法抽帧');
      const dir = path.join(ensureDir(config.load().dataDir || path.join(__dirname, '..', 'data')), 'frames', 'frames-' + Date.now().toString(36) + '-' + uid('').slice(0, 4));
      ensureDir(dir);
      const frames = [];
      for (let i = 0; i < count; i += 1) {
        const time = Math.max(0, Math.min(duration - 0.05, duration * ((i + 0.5) / count)));
        const name = 'frame-' + String(i + 1).padStart(2, '0') + '.jpg';
        const out = path.join(dir, name);
        await runCommand(FFMPEG, ['-y', '-ss', time.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=' + width + ':-2', '-q:v', '3', out], 60000);
        frames.push({ name, path: out, time: Number(time.toFixed(2)), url: '/api/file?path=' + encodeURIComponent(out) });
      }
      return ok(res, { path: file, dir, duration, count, frames });
    } catch (err) {
      return bad(res, publicError(err));
    }
  }

  if (method === 'GET' && pathname === '/api/voice-library') {
    const data = voices.scan({ refresh: url.searchParams.get('refresh') === '1' });
    return ok(res, data);
  }

  if (method === 'POST' && pathname === '/api/voice-library/pick') {
    const body = await readBody(req);
    const item = voices.pick(String(body.id || ''));
    return ok(res, item);
  }

  if (method === 'GET' && pathname === '/api/voice-library/audio') {
    const id = url.searchParams.get('id');
    const item = voices.find(String(id || ''));
    if (!item) return bad(res, '音色不存在', 404);
    const file = path.join(voices.rootFolder(), item.file);
    if (!fs.existsSync(file)) return bad(res, '文件不存在', 404);
    return serveFile(req, res, file);
  }

  return bad(res, 'not found', 404);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
    return res.end();
  }
  route(req, res).catch((err) => {
    if (res.headersSent) {
      try { res.end(); } catch { /* ignore */ }
      return;
    }
    const status = err && err.status === 0 ? 502 : (Number(err?.status) >= 400 && Number(err?.status) <= 599 ? Number(err.status) : 400);
    bad(res, publicError(err), status);
  });
});

function start() {
  const cfg = config.load();
  internalAuth.token();
  config.storage();
  jobs.loadState();
  imageTasks.tasks().initialize();
  imageTasks.tasks().pump();
  const port = Number(process.env.H3_PORT || cfg.port || 17821);
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`H3 Studio → ${url}`);
    console.log(`数据目录 ${config.DATA}`);
    jobs.pump();
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.log(`端口 ${port} 已被占用，可能已经有一个 H3 Studio 在运行：http://127.0.0.1:${port}`);
      process.exit(0);
    }
    console.error('启动失败：' + err.message);
    process.exit(1);
  });
}

let shuttingDown=false;
async function shutdown(){
  if(shuttingDown)return;shuttingDown=true;
  jobs.flushState();
  await imageTasks.tasks().close();
  process.exit(0);
}
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);

if (require.main === module) start();

module.exports = { server, start };

