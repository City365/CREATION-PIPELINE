'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { URL } = require('node:url');
const config = require('./config');
const vault = require('./vault');
const backup = require('./backup');
const workflows = require('./workflows');
const providers = require('./providers');
const prompts = require('./prompts');
const seedance = require('./seedance');
const library = require('./library');
const assetLayout = require('./asset-layout');
const imageHistory = require('./image-history');
const auth = require('./auth');
const userPrefs = require('./user-prefs');
const accessCodes = require('./access-codes');
const tenants = require('./tenants');
const tenantContext = require('./tenant-context');
const tenantScope = require('./tenant-scope');
const quotas = require('./quotas');
const audit = require('./audit');
const internalAuth = require('./internal-auth');
const executorChannel = require('./executor-channel');
const executorTransport = require('./executor-transport');
const projects = require('./projects');
const workspace = require('./workspace');
const workspaceMigrate = require('./workspace-migrate');
const styles = require('./styles');
const jobs = require('./jobs');
const batch = require('./batch');
const events = require('./events');
const taskImport = require('./task-import');
const probe = require('./probe');
const channels = require('./channels');
const imagegen = require('./imagegen');
const fileAliases = require('./file-aliases');
const projectPaths = require('./project-paths');
const imageTasks = require('./image-tasks');
const genericVideo = require('./generic-video');
const tts = require('./tts');
const voices = require('./voices');
const managerVideo = require('./manager-video');
const videoPlugins=require('./video-plugins');
const studioStore = require('./studio-store');
const workbenchStore = require('./workbench-store');
const workbenchRoutes = require('./workbench-routes');
const generationStore = require('./generation-store');
const creativeRoutes = require('./creative-routes');
const mediaEpisodes = require('./media-episodes');
const taskManifest = require('./task-manifest');
const mediaDrafts = require('./media-drafts');
const refImages = require('./ref-images');
const jianying = require('./jianying');
const db = require('./db');
const [ensureDir, readJson, writeJson, uid] = [require('./util').ensureDir, require('./util').readJson, require('./util').writeJson, require('./util').uid];
const { sanitizeFilename, kindOf, mimeFor, publicError, formatBytes, estimateTokens, httpJson } = require('./util');

/**
 * 登录页要展示的「空间概览」：默认租户名 + 成员数 + 项目数。
 * 未登录也能读，所以只给聚合数字，不给别人的用户名和项目名。
 */
function spaceSummary(tenantId) {
  const id = String(tenantId || tenants.DEFAULT_TENANT);
  const tenant = tenants.get(id);
  let members = 0;
  let projectCount = 0;
  try {
    const conn = db.open();
    members = conn.prepare('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?').get(id).n;
    projectCount = conn.prepare('SELECT COUNT(*) AS n FROM projects WHERE tenant_id = ?').get(id).n;
  } catch { /* 库还没建好时按 0 处理，登录页不能因为统计挂掉 */ }
  let tenantCount = 1;
  try { tenantCount = Math.max(1, tenants.list().length); } catch { tenantCount = 1; }
  return { tenantId: id, tenantName: (tenant && tenant.name) || '默认租户', tenants: tenantCount, members, projects: projectCount };
}

const WEB = path.join(__dirname, '..', 'web');
const AGENT_URL = process.env.WMD_AGENT_URL || 'http://127.0.0.1:17820';
// 前端没带 X-Project-Id 时的兜底项目名：中性占位，不再借用别的产品项目名。
const AGENT_PROJECT = process.env.WMD_AGENT_PROJECT || 'wmd-local';
const STATIC = {
  '/agent-workspace.css': ['agent-workspace.css', 'text/css; charset=utf-8'],
  '/agent-workspace.js': ['agent-workspace.js', 'text/javascript; charset=utf-8'],
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/generation-params.js': ['generation-params.js', 'text/javascript; charset=utf-8'],
  '/image-tasks.js': ['image-tasks.js', 'text/javascript; charset=utf-8'],
  '/events.js': ['events.js', 'text/javascript; charset=utf-8'],
  '/workbench-manager.js': ['workbench-manager.js', 'text/javascript; charset=utf-8'],
  '/workbench.css': ['workbench.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/creative.js': ['creative.js', 'text/javascript; charset=utf-8'],
  '/creative.css': ['creative.css', 'text/css; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/shell-spec.css': ['shell-spec.css', 'text/css; charset=utf-8'],
  '/shell-nav.js': ['shell-nav.js', 'text/javascript; charset=utf-8'],
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
  '/skins/login-cinema.jpg': ['skins/login-cinema.jpg', 'image/jpeg'],
  '/wmd.css': ['wmd.css', 'text/css; charset=utf-8'],
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

/** 裸字节请求体：执行端回传成片走这里，不做 JSON 解析。 */
async function readRawBody(req, limit = 512 * 1024 * 1024) {
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
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * 可访问的文件根。传租户时只放行该租户的项目目录：
 * 未归档目录（老的 assets/media/uploads）是全局的，只给默认租户；
 * 其它租户只在自己的项目目录和 data/tenants/<id> 下活动。
 */
function allowedRoots(tenantId) {
  const cfg = config.load();
  const roots = [];
  if (!tenantId || tenantId === tenants.DEFAULT_TENANT) {
    roots.push(cfg.saveFolder, cfg.assetFolder, cfg.uploadFolder, path.join(cfg.dataDir, 'frames'), path.join(cfg.dataDir, 'ref-images'));
  } else {
    roots.push(path.join(cfg.dataDir, 'tenants', tenantId));
  }
  try {
    for (const project of projects.list(tenantId || undefined)) {
      try { roots.push(workspace.pathsFor(project).dir); } catch { /* 单个项目目录异常不影响其它路径 */ }
    }
  } catch { /* ignore */ }
  return roots.map((p) => path.resolve(p));
}

function isAllowed(file, tenantId) {
  const abs = path.resolve(String(file));
  return allowedRoots(tenantId).some((root) => abs === root || abs.startsWith(root + path.sep));
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

function saveBase64Upload(name, base64, folder, projectId, type, subfolder) {
  const clean = sanitizeFilename(name || 'upload');
  const data = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!data) throw new Error('文件内容为空');
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) throw new Error('文件内容为空');
  if (folder === 'assets') {
    const saved = library.saveAssetUpload(projectId || '', clean, buf, subfolder || '', type);
    return { ...saved, name: path.basename(saved.path), bytes: buf.length, kind: kindOf(saved.path) };
  }
  const dir = library.uploadRoot(projectId || '');
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
  const format = body.format === 'seedance' ? 'seedance' : 'h3';
  const records = format === 'seedance' ? seedance.recordCountFor(userPrompt, body.records) : 1;
  // Seedance 这边以节拍稿里的「本组总时长」为准，读不到才用界面上的时长。
  const seedanceDuration = format === 'seedance' ? seedance.detectDuration(userPrompt, duration) : duration;
  const messages = format === 'seedance'
    ? seedance.buildSeedanceMessages({
      prompt: userPrompt,
      assets,
      subjects,
      durationSeconds: seedanceDuration,
      maxDurationSeconds: 15,
      records,
    })
    : prompts.buildOptimizeMessages({
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
  const text = format === 'seedance' ? seedance.normalizeSeedanceOutput(result.content) : prompts.normalizeModelOutput(result.content);
  const validation = format === 'seedance'
    ? seedance.validateSeedance(text, { tokens: assets.map((a) => a.token), subjects, duration: seedanceDuration })
    : prompts.validatePrompt(text, {
      tokens: assets.map((a) => a.token),
      subjects,
      duration,
    });
  return {
    format,
    records,
    duration: format === 'seedance' ? seedanceDuration : duration,
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
  const managerUrl = ((mgrCh && mgrCh.baseUrl) || process.env.WMD_MANAGER_URL || 'http://127.0.0.1:17778').replace(/\/+$/, '');
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
  const upstreamPath = pathname.replace(/^\/api\/agent/, '/agent')
    .split('/')
    .map((segment) => segment ? encodeURIComponent(segment) : segment)
    .join('/') + (search || '');
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

function clientIp(req) {
  return String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
}

function route(req, res) {
  // 每个请求一个独立的租户上下文，避免 keep-alive 连接上的请求互相继承租户。
  return tenantContext.run('', () => handle(req, res));
}

async function handle(req, res) {
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
  const PUBLIC_API = new Set(['/api/health', '/api/web-version', '/api/auth/me', '/api/auth/login', '/api/auth/register', '/api/auth/logout',
    '/api/auth/accept-invite', '/api/auth/reset-password',
    // 执行端通道自己校验令牌：管理器是无人值守进程，没有浏览器会话。
    '/api/executor/poll', '/api/executor/reply', '/api/executor/blob']);
  // 邀请/重置码的说明接口要在注册页展示，未登录也能读；只返回租户名/角色/过期时间。
  const publicCodePath = /^\/api\/(invites|resets)\/[^/]+$/.test(pathname);
  const internalCall = internalAuth.authorized(req);
  if (auth.enabled() && pathname.startsWith('/api') && !PUBLIC_API.has(pathname) && !publicCodePath && !internalCall) {
    currentUser = auth.userByToken(token);
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
  }
  // 租户上下文：项目、任务、素材、文件都只在当前租户里找。
  // 没有登录体系（本机未注册）时落到默认租户，行为和以前一致。
  const tenantId = currentUser ? (currentUser.tenantId || tenants.DEFAULT_TENANT) : tenants.DEFAULT_TENANT;
  const role = currentUser ? (currentUser.role || (currentUser.isAdmin ? 'owner' : 'member')) : 'owner';
  const canManage = !currentUser || Boolean(currentUser.isAdmin) || role === 'owner' || role === 'admin';
  // 配置里的渠道/密钥/提示词按租户隔离；后续所有 config.load()/channels.* 都读这个租户。
  tenantContext.enter(tenantId);
  /** 平台默认 ui + 当前用户自己的界面偏好。 */
  const configView = () => {
    const view = config.publicView();
    if (currentUser) view.ui = userPrefs.view(view.ui, currentUser.id);
    return view;
  };

  /**
   * 项目必须属于当前租户，而且必须是当前用户自己的项目。
   * 别人的项目一律当作不存在，连“存在性”都不泄露。
   */
  const assertProject = (id) => {
    const key = String(id || '');
    const project = key ? projects.get(key) : null;
    const sameTenant = project && (project.tenantId || tenants.DEFAULT_TENANT) === tenantId;
    // 没有登录体系（本机没建账号）时只有租户这一层，行为和以前一致
    const sameOwner = !currentUser || !project || !project.ownerUserId || project.ownerUserId === currentUser.id;
    if (!project || !sameTenant || !sameOwner) {
      const error = new Error('项目不存在');
      error.status = 404;
      throw error;
    }
    return project;
  };
  let activeProject = null;
  try { activeProject = currentUser && currentUser.activeProjectId ? assertProject(currentUser.activeProjectId) : null; } catch { activeProject = null; }
  const projectId = activeProject ? activeProject.id : '';
  // 客户端传来的 projectId 不可信：先查归属再放行；空值表示“未归档”。
  // 'default' / 'unassigned' 是旧的“未归档”桶名，不能当成真实项目去查，否则新账号首屏就 404。
  const scoped = (value) => {
    const raw = String(value || '').trim();
    const id = (raw === 'default' || raw === 'unassigned') ? projectId : (raw || projectId);
    if (!id) return '';
    assertProject(id);
    return id;
  };
  // 未归档的数据（没有项目的历史任务、素材）只给默认租户看，避免跨租户串。
  const unassignedVisible = () => tenantId === tenants.DEFAULT_TENANT;
  let tenantProjectIdsCache = null;
  const tenantProjectIds = () => {
    if (!tenantProjectIdsCache) tenantProjectIdsCache = new Set(projects.list(tenantId, currentUser && currentUser.id).map((item) => item.id));
    return tenantProjectIdsCache;
  };
  /** 这条记录（任务/事件）属于当前租户吗。 */
  const inTenant = (pid) => {
    const key = String(pid || '');
    if (!key || key === 'unassigned' || key === 'default') return unassignedVisible();
    return tenantProjectIds().has(key);
  };

  /* ------------------------- 执行端通道（用户本机管理器） ------------------------- */
  // 管理器主动长轮询取命令、本地执行、再回传结果；服务器不需要能访问用户的内网。
  const channelToken = url.searchParams.get('token') || req.headers['x-executor-token'] || '';
  if (pathname === '/api/executor/poll' && method === 'GET') {
    try {
      const waitParam = url.searchParams.get('wait');
      const result = await executorChannel.poll(channelToken, {
        // 显式 wait=0 表示立即返回；只有没传时才用默认长轮询。
        waitMs: waitParam === null || waitParam === '' ? 25000 : Number(waitParam),
        name: url.searchParams.get('name') || '',
        version: url.searchParams.get('version') || '',
      });
      return json(res, 200, result);
    } catch (error) {
      return json(res, 401, { ok: false, error: error.message });
    }
  }
  if (pathname === '/api/executor/reply' && method === 'POST') {
    if (!executorChannel.authenticate(channelToken)) return json(res, 401, { ok: false, error: '通道令牌无效或已失效' });
    const payload = await readBody(req).catch(() => null);
    if (!payload || !payload.id) return bad(res, '缺少命令 id', 400);
    return json(res, 200, { ok: true, settled: executorChannel.settle(channelToken, payload) });
  }
  if (pathname === '/api/executor/blob' && method === 'POST') {
    if (!executorChannel.authenticate(channelToken)) return json(res, 401, { ok: false, error: '通道令牌无效或已失效' });
    const id = String(url.searchParams.get('id') || '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return bad(res, '缺少命令 id', 400);
    const raw = await readRawBody(req);
    const file = executorChannel.saveBlob(id, raw);
    return json(res, 200, { ok: true, bytes: raw.length, blob: path.basename(file, '.bin') });
  }
  if (method === 'GET' && pathname === '/api/executor/status') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    const info = executorChannel.status(currentUser.id);
    const channel = (config.load().channels.video || []).find((c) => c.type === 'manager-video' && c.enabled !== false) || null;
    return ok(res, {
      ...info,
      channel: channel ? { id: channel.id, name: channel.name || '', remote: Boolean(channel.executorToken), baseUrl: channel.baseUrl || '', activeId: channel.executorToken ? executorChannel.tokenId(channel.executorToken) : '' } : null,
    });
  }
  if (method === 'POST' && pathname === '/api/executor/probe') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    const body = await readBody(req).catch(() => ({}));
    const rows = executorChannel.tokensForUser(currentUser.id);
    const probeToken = String(body.token || '') || (rows[0] && rows[0].token) || '';
    if (!probeToken) return bad(res, '还没有配对：先在管理器里生成配对令牌', 400);
    // 指定路径时只回报状态和字节数，不把内容带回浏览器——用来验证通道和大文件回传。
    const probePath = String(body.path || '').trim();
    if (probePath) {
      if (!/^\/api\/[A-Za-z0-9_\/?=&.%+-]+$/.test(probePath)) return bad(res, '探测路径无效', 400);
      try {
        const started = Date.now();
        const out = await executorTransport.requestJson({ executorToken: probeToken }, probePath, { timeoutMs: 180000 });
        return ok(res, { ok: out.ok, status: out.status, bytes: out.blobBytes || (out.text ? Buffer.byteLength(out.text) : 0), ms: Date.now() - started });
      } catch (error) {
        return ok(res, { ok: false, message: error.message });
      }
    }
    try {
      const started = Date.now();
      const stateRes = await executorTransport.requestJson({ executorToken: probeToken }, '/api/state', { timeoutMs: 30000 });
      const data = stateRes.data || {};
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      return ok(res, {
        ok: true,
        ms: Date.now() - started,
        accounts: accounts.length,
        doubao: accounts.filter((a) => a.platform === 'doubao').length,
        gemini: accounts.filter((a) => a.platform === 'gemini').length,
        tasks: Array.isArray(data.tasks) ? data.tasks.length : 0,
      });
    } catch (error) {
      return ok(res, { ok: false, message: error.message });
    }
  }
  if (method === 'POST' && pathname === '/api/executor/pair') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    const body = await readBody(req).catch(() => ({}));
    const issued = executorChannel.issue(currentUser.id, { name: String(body.name || os.hostname() || ''), replace: body.replace === true });
    audit.record({ action: 'executor.pair', tenantId, userId: currentUser.id, target: issued.id, detail: issued.name, ip: clientIp(req) });
    return ok(res, issued);
  }
  if (method === 'POST' && pathname === '/api/executor/active') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    if (!canManage) return bad(res, '只有租户负责人/管理员可以切换任务通道', 403);
    const body = await readBody(req).catch(() => ({}));
    const rows = executorChannel.tokensForUser(currentUser.id);
    const hit = rows.find((row) => executorChannel.tokenId(row.token) === String(body.id || ''))
      || (body.token ? rows.find((row) => row.token === String(body.token)) : null);
    if (!hit) return bad(res, '没有找到这条配对', 404);
    const cfg = config.load();
    const channel = (cfg.channels.video || []).find((c) => c.type === 'manager-video' && c.enabled !== false);
    if (!channel) return bad(res, '请先在「视频生成」里添加并启用管理器渠道', 400);
    channel.executorToken = hit.token;
    config.save({ channels: cfg.channels });
    audit.record({ action: 'executor.active', tenantId, userId: currentUser.id, target: executorChannel.tokenId(hit.token), detail: channel.name || channel.id, ip: clientIp(req) });
    return ok(res, { id: executorChannel.tokenId(hit.token), channelId: channel.id });
  }
  if (method === 'DELETE' && pathname === '/api/executor/pair') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    const body = await readBody(req).catch(() => ({}));
    const removed = executorChannel.revokeForUser(currentUser.id, { id: body.id, token: body.token });
    if (!removed) return bad(res, '没有找到这条配对', 404);
    audit.record({ action: 'executor.revoke', tenantId, userId: currentUser.id, target: String(body.id || ''), ip: clientIp(req) });
    return ok(res, true);
  }

  // 未归档桶：默认租户沿用老的 'default'，其它租户各用各的，避免互相看见
  const unassignedKey = () => (tenantId === tenants.DEFAULT_TENANT ? 'default' : 'unassigned:' + tenantId);
  const scopeKey = (value) => scoped(value) || unassignedKey();

  if (await workbenchRoutes(req,res,url,{ok,readBody,scope:scopeKey,mediaPath:(input)=>{const abs=mediaPath(input);if(!isAllowed(abs, tenantId)||!allowedRoots(tenantId).some(root=>{try{const rel=path.relative(fs.realpathSync(root),fs.realpathSync(abs));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}catch{return false;}}))throw Error("文件不在素材目录内");return abs;}})) return;
  if (await creativeRoutes(req, res, url, {ok, bad, readBody, mediaPath, imageDataUrl, user:currentUser})) return;

  if (method === 'GET' && pathname === '/api/auth/me') {
    const user = auth.userByToken(token);
    return ok(res, { enabled: auth.enabled(), user: user ? auth.publicUser(user) : null, space: spaceSummary(user ? user.tenantId : tenants.DEFAULT_TENANT) });
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(req);
    // 首个用户建默认租户；之后要管理员创建，或者开启 signup.open 自助开新租户
    const user = auth.register(body.username, body.password, { tenantName: body.tenantName });
    audit.record({ action: 'auth.register', tenantId: user.tenantId, userId: user.id, detail: user.username, ip: clientIp(req) });
    const session = auth.login(body.username, body.password);
    res.setHeader('Set-Cookie', 'wmd_session=' + encodeURIComponent(session.token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000');
    return ok(res, { user, enabled: true });
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    let session;
    try {
      session = auth.login(body.username, body.password);
    } catch (error) {
      // 只记用户名和来源，不记密码。
      audit.record({ action: 'auth.login.failed', detail: String(body.username || '').slice(0, 64), ip: clientIp(req) });
      throw error;
    }
    audit.record({ action: 'auth.login', tenantId: session.user.tenantId, userId: session.user.id, detail: session.user.username, ip: clientIp(req) });
    res.setHeader('Set-Cookie', 'wmd_session=' + encodeURIComponent(session.token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000');
    return ok(res, { user: session.user, enabled: true });
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const logoutUser = auth.userByToken(token);
    auth.logout(token);
    if (logoutUser) audit.record({ action: 'auth.logout', tenantId: logoutUser.tenantId, userId: logoutUser.id, ip: clientIp(req) });
    res.setHeader('Set-Cookie', 'wmd_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return ok(res, true);
  }

  if (method === 'POST' && pathname === '/api/auth/project') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    const body = await readBody(req);
    // 只能切到自己租户里的项目
    auth.setActiveProject(currentUser.id, body.projectId ? assertProject(body.projectId).id : '');
    return ok(res, true);
  }

  /* ------------------------- 邀请 / 密码重置（一次性码） ------------------------- */
  if (method === 'POST' && pathname === '/api/auth/accept-invite') {
    const body = await readBody(req);
    const code = String(body.code || '').trim();
    const invite = accessCodes.peek(code, 'invite');
    if (!invite) return bad(res, '邀请链接无效或已过期', 400);
    quotas.assertUsers(invite.tenantId);
    const created = auth.register(body.username, body.password, { asAdmin: true, tenantId: invite.tenantId, role: invite.role });
    if (!accessCodes.consume(code, 'invite')) {
      // 极端并发：码刚被用掉。把刚创建的用户删掉，避免留下没有邀请来源的账号。
      try { auth.removeUser(created.id); } catch { /* 没有项目，正常能删 */ }
      return bad(res, '邀请链接已被使用', 400);
    }
    const session = auth.login(body.username, body.password);
    res.setHeader('Set-Cookie', 'wmd_session=' + encodeURIComponent(session.token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000');
    audit.record({ action: 'invite.accept', tenantId: invite.tenantId, userId: created.id, detail: created.username + ' / ' + created.role, ip: clientIp(req) });
    return ok(res, { user: created, enabled: true });
  }

  if (method === 'POST' && pathname === '/api/auth/reset-password') {
    const body = await readBody(req);
    const code = String(body.code || '').trim();
    const reset = accessCodes.peek(code, 'reset');
    if (!reset) return bad(res, '重置链接无效或已过期', 400);
    if (String(body.password || '').length < 6) return bad(res, '密码至少 6 位', 400);
    const user = auth.findById(reset.userId);
    if (!user) return bad(res, '用户不存在', 400);
    if (!accessCodes.consume(code, 'reset')) return bad(res, '重置链接已被使用', 400);
    auth.updateUser(user.id, { password: body.password });
    audit.record({ action: 'auth.password.reset', tenantId: user.tenantId, userId: user.id, detail: user.username, ip: clientIp(req) });
    return ok(res, true);
  }

  if (method === 'POST' && pathname === '/api/auth/change-password') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    const body = await readBody(req);
    auth.changePassword(currentUser.id, body.oldPassword, body.newPassword);
    // 改密会让旧会话失效，这里直接给当前浏览器换一个新会话。
    const session = auth.login(currentUser.username, body.newPassword);
    res.setHeader('Set-Cookie', 'wmd_session=' + encodeURIComponent(session.token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000');
    audit.record({ action: 'auth.password.change', tenantId, userId: currentUser.id, detail: currentUser.username, ip: clientIp(req) });
    return ok(res, true);
  }

  const inviteInfoRoute = /^\/api\/invites\/([^/]+)$/.exec(pathname);
  if (inviteInfoRoute && method === 'GET') {
    const invite = accessCodes.peek(inviteInfoRoute[1], 'invite');
    if (!invite) return bad(res, '邀请链接无效或已过期', 404);
    const tenant = tenants.get(invite.tenantId);
    return ok(res, { tenantName: tenant ? tenant.name : '', role: invite.role, expiresAt: invite.expiresAt });
  }

  const resetInfoRoute = /^\/api\/resets\/([^/]+)$/.exec(pathname);
  if (resetInfoRoute && method === 'GET') {
    const reset = accessCodes.peek(resetInfoRoute[1], 'reset');
    if (!reset) return bad(res, '重置链接无效或已过期', 404);
    const user = auth.findById(reset.userId);
    if (!user) return bad(res, '重置链接无效或已过期', 404);
    return ok(res, { username: user.username, expiresAt: reset.expiresAt });
  }

  if (method === 'POST' && pathname === '/api/invites') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    if (!canManage) return bad(res, '只有租户负责人/管理员可以邀请成员', 403);
    const body = await readBody(req);
    const role = ['owner', 'admin', 'member'].includes(body.role) ? body.role : 'member';
    if (role === 'owner' && !(currentUser.isAdmin || currentUser.role === 'owner')) return bad(res, '只有负责人可以邀请负责人', 403);
    const targetTenant = currentUser.isAdmin && body.tenantId ? String(body.tenantId) : tenantId;
    if (!currentUser.isAdmin && targetTenant !== tenantId) return bad(res, '不能邀请到其它租户', 403);
    if (!tenants.get(targetTenant)) return bad(res, '租户不存在', 404);
    const hours = Math.max(1, Math.min(168, Number(body.expiresInHours) || 72));
    const created = accessCodes.createInvite({ tenantId: targetTenant, role, createdBy: currentUser.id, ttlMs: hours * 3600 * 1000 });
    audit.record({ action: 'invite.create', tenantId: targetTenant, userId: currentUser.id, target: role, detail: 'expires=' + created.expiresAt, ip: clientIp(req) });
    return ok(res, { code: created.code, url: '/?invite=' + encodeURIComponent(created.code), role, tenantId: targetTenant, expiresAt: created.expiresAt });
  }

  const resetTokenRoute = /^\/api\/users\/([^/]+)\/reset-token$/.exec(pathname);
  if (resetTokenRoute && method === 'POST') {
    if (!currentUser || !canManage) return bad(res, '没有权限重置密码', 403);
    const target = auth.findById(resetTokenRoute[1]);
    if (!target) return bad(res, '用户不存在', 404);
    if (!currentUser.isAdmin && target.tenantId !== tenantId) return bad(res, '用户不存在', 404);
    if (target.isAdmin) return bad(res, '平台管理员请使用自己的改密流程', 400);
    const created = accessCodes.createReset({ userId: target.id, tenantId: target.tenantId, createdBy: currentUser.id });
    audit.record({ action: 'user.reset.token', tenantId: target.tenantId, userId: currentUser.id, target: target.id, detail: target.username, ip: clientIp(req) });
    return ok(res, { code: created.code, url: '/?reset=' + encodeURIComponent(created.code), username: target.username, expiresAt: created.expiresAt });
  }

  /* --------------------------- 租户与成员管理 --------------------------- */
  if (method === 'GET' && pathname === '/api/tenants') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    const list = currentUser.isAdmin ? tenants.list() : [tenants.get(tenantId)].filter(Boolean);
    return ok(res, list.map((row) => ({ ...tenants.publicTenant(row), members: auth.members(row.id).length })));
  }

  if (method === 'POST' && pathname === '/api/tenants') {
    if (!currentUser || !currentUser.isAdmin) return bad(res, '只有平台管理员可以创建租户', 403);
    const body = await readBody(req);
    const created = tenants.create(body.name);
    audit.record({ action: 'tenant.create', tenantId: created.id, userId: currentUser.id, target: created.id, detail: created.name, ip: clientIp(req) });
    return ok(res, tenants.publicTenant(created));
  }

  const tenantRoute = /^\/api\/tenants\/([^/]+)$/.exec(pathname);
  if (tenantRoute) {
    if (!currentUser || !currentUser.isAdmin) return bad(res, '只有平台管理员可以管理租户', 403);
    const id = tenantRoute[1];
    if (method === 'PUT') {
      const renamed = tenants.rename(id, (await readBody(req)).name);
      audit.record({ action: 'tenant.rename', tenantId: id, userId: currentUser.id, target: id, detail: renamed.name, ip: clientIp(req) });
      return ok(res, tenants.publicTenant(renamed));
    }
    if (method === 'DELETE') {
      if (auth.members(id).length) return bad(res, '租户里还有用户，先移走或删除用户', 400);
      const removed = tenants.remove(id);
      audit.record({ action: 'tenant.delete', tenantId: id, userId: currentUser.id, target: id, ip: clientIp(req) });
      return ok(res, removed);
    }
  }

  // 配额：成员可查看自己租户，平台管理员可查看/修改任意租户。
  const quotaRoute = /^\/api\/tenants\/([^/]+)\/quota$/.exec(pathname);
  if (quotaRoute) {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    const id = quotaRoute[1];
    if (!tenants.get(id)) return bad(res, '租户不存在', 404);
    if (!currentUser.isAdmin && id !== tenantId) return bad(res, '租户不存在', 404);
    if (method === 'GET') return ok(res, { quota: quotas.get(id), usage: quotas.usage(id) });
    if (method === 'PUT') {
      if (!currentUser.isAdmin) return bad(res, '只有平台管理员可以修改配额', 403);
      const next = quotas.set(id, await readBody(req));
      audit.record({ action: 'quota.update', tenantId: id, userId: currentUser.id, target: id, detail: JSON.stringify(next), ip: clientIp(req) });
      return ok(res, { quota: next, usage: quotas.usage(id) });
    }
  }

  // 审计：平台管理员看全部（可按租户过滤），租户负责人/管理员只看本租户。
  if (method === 'GET' && pathname === '/api/audit') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    if (!currentUser.isAdmin && !['owner', 'admin'].includes(role)) return bad(res, '没有权限查看审计日志', 403);
    const requested = String(url.searchParams.get('tenantId') || '');
    if (!currentUser.isAdmin && requested && requested !== tenantId) return bad(res, '租户不存在', 404);
    const tenantFilter = currentUser.isAdmin ? requested : tenantId;
    return ok(res, {
      items: audit.list({ tenantId: tenantFilter, limit: Number(url.searchParams.get('limit')) || 100, offset: Number(url.searchParams.get('offset')) || 0 }),
      total: audit.count(tenantFilter),
      integrity: audit.verify(tenantFilter),
    });
  }

  if (method === 'GET' && pathname === '/api/audit/export') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    if (!currentUser.isAdmin && !['owner', 'admin'].includes(role)) return bad(res, '没有权限导出审计日志', 403);
    const requested = String(url.searchParams.get('tenantId') || '');
    if (!currentUser.isAdmin && requested && requested !== tenantId) return bad(res, '租户不存在', 404);
    const tenantFilter = currentUser.isAdmin ? requested : tenantId;
    const format = String(url.searchParams.get('format') || 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
    const out = audit.exportPayload({ tenantId: tenantFilter, format });
    const name = `audit-${tenantFilter || 'all'}-${new Date().toISOString().slice(0, 10)}.${format}`;
    res.writeHead(200, {
      'Content-Type': out.contentType,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    });
    res.end(out.body);
    audit.record({ action: 'audit.export', tenantId: tenantFilter || tenantId, userId: currentUser.id, detail: `${format} rows=${out.rows}`, ip: clientIp(req) });
    return;
  }

  if (method === 'GET' && pathname === '/api/users') {
    if (!currentUser) return json(res, 401, { ok: false, error: '请先登录', auth: true });
    // 平台管理员看全部；其他人只看自己租户
    const list = currentUser.isAdmin ? auth.users().map(auth.publicUser) : auth.members(tenantId);
    return ok(res, list);
  }

  if (method === 'POST' && pathname === '/api/users') {
    if (!currentUser || !canManage) return bad(res, '没有权限创建用户', 403);
    const body = await readBody(req);
    const targetTenant = String(body.tenantId || tenantId);
    if (!currentUser.isAdmin && targetTenant !== tenantId) return bad(res, '不能给其它租户创建用户', 403);
    quotas.assertUsers(targetTenant);
    const created = auth.register(body.username, body.password, { asAdmin: true, tenantId: targetTenant, role: body.role });
    audit.record({ action: 'user.create', tenantId: targetTenant, userId: currentUser.id, target: created.id, detail: created.username + ' / ' + created.role, ip: clientIp(req) });
    return ok(res, created);
  }

  const memberRoute = /^\/api\/users\/([^/]+)$/.exec(pathname);
  if (memberRoute) {
    if (!currentUser || !canManage) return bad(res, '没有权限管理用户', 403);
    const target = auth.findById(memberRoute[1]);
    if (!target) return bad(res, '用户不存在', 404);
    if (!currentUser.isAdmin && target.tenantId !== tenantId) return bad(res, '用户不存在', 404);
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readBody(req);
      const patch = { role: body.role, password: body.password };
      if (target.isAdmin && body.role && body.role !== 'owner') return bad(res, '平台管理员的角色不能降级', 400);
      const updated = auth.updateUser(target.id, patch);
      audit.record({
        action: 'user.update', tenantId: target.tenantId, userId: currentUser.id, target: target.id,
        detail: [body.role ? 'role=' + body.role : '', body.password ? 'password-reset' : ''].filter(Boolean).join(' '),
        ip: clientIp(req),
      });
      return ok(res, updated);
    }
    if (method === 'DELETE') {
      if (target.id === currentUser.id) return bad(res, '不能删除自己', 400);
      const removed = auth.removeUser(target.id);
      audit.record({ action: 'user.delete', tenantId: target.tenantId, userId: currentUser.id, target: target.id, detail: target.username, ip: clientIp(req) });
      return ok(res, removed);
    }
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

  if (method === 'POST' && pathname === '/api/project-folders/pick') {
    return ok(res, await require('./folder-picker').pickFolder());
  }

  if (method === 'GET' && pathname === '/api/projects') {
    // 只返回「当前租户 + 当前用户」自己的项目（隔离层级：租户 → 用户 → 项目）
    // 历史遗留的无主项目在这里按需认领，避免账号建好后项目“失踪”
    if (currentUser) { try { projects.claimOrphans(tenantId); } catch { /* 认领失败不影响列表 */ } }
    return ok(res, projects.list(tenantId, currentUser && currentUser.id).map((p) => projects.publicProject(p)));
  }

  if (method === 'POST' && pathname === '/api/projects') {
    const body = await readBody(req);
    quotas.assertProjects(tenantId);
    const project = projects.create({ ...body, tenantId, ownerUserId: (currentUser && currentUser.id) || '' });
    if (currentUser) auth.setActiveProject(currentUser.id, project.id);
    audit.record({ action: 'project.create', tenantId, userId: currentUser && currentUser.id, target: project.id, detail: project.name, ip: clientIp(req) });
    return ok(res, projects.publicProject(project));
  }

  const projectRoute = /^\/api\/projects\/([^/]+)$/.exec(pathname);
  if (projectRoute) {
    const id = projectRoute[1];
    if (method === 'GET') {
      return ok(res, projects.publicProject(assertProject(id)));
    }
    if (method === 'PUT') {
      assertProject(id);
      const body = await readBody(req);
      const updated = projects.update(id, { ...body, tenantId, ownerUserId: body.ownerUserId });
      audit.record({ action: 'project.update', tenantId, userId: currentUser && currentUser.id, target: id, detail: updated.name, ip: clientIp(req) });
      return ok(res, projects.publicProject(updated));
    }
    if (method === 'DELETE') {
      const project = assertProject(id);
      projects.remove(id);
      audit.record({ action: 'project.delete', tenantId, userId: currentUser && currentUser.id, target: id, detail: project.name, ip: clientIp(req) });
      return ok(res, true);
    }
  }

  if (method === 'GET' && pathname === '/api/workspace') {
    const preview = workspaceMigrate.preview();
    const paths = activeProject ? workspace.pathsFor(activeProject) : null;
    return ok(res, {
      projectRoot: config.load().projectRoot,
      projectId,
      project: activeProject ? projects.publicProject(activeProject) : null,
      dirs: paths ? { dir: paths.dir, assets: paths.assets, media: paths.media, uploads: paths.uploads, exports: paths.exports } : null,
      migration: preview,
    });
  }

  if (method === 'POST' && pathname === '/api/workspace/adopt') {
    // 把「没有项目归属」的历史任务/队列/图像任务收编到当前项目（隔离之后这些数据不属于任何项目）
    const body = await readBody(req).catch(() => ({}));
    const target = scoped(body.projectId);
    if (!target) return bad(res, '先进入一个项目，再收编旧任务');
    const counts = { projectId: target, events: 0, jobs: 0, images: 0 };
    try { counts.events = events.adoptLegacy(target); } catch { /* 单项失败不影响其它 */ }
    try { counts.jobs = jobs.adoptLegacy(target); } catch { /* ignore */ }
    try { counts.images = imageTasks.tasks().adoptLegacy(target); } catch { /* ignore */ }
    audit.record({ action: 'workspace.adopt', tenantId, userId: currentUser && currentUser.id, target, detail: JSON.stringify(counts), ip: clientIp(req) });
    return ok(res, counts);
  }

  if (method === 'POST' && pathname === '/api/workspace/migrate') {
    const body = await readBody(req).catch(() => ({}));
    // 本机脚本可以用内部凭据触发；普通请求仍要求已进入某个项目。
    const targetProject = projectId || (internalCall ? workspaceMigrate.preview().projectId : '');
    if (!targetProject) return bad(res, '先进入一个项目，再迁移旧数据');
    try {
      return ok(res, workspaceMigrate.run({ force: !!(body && body.force === true) }));
    } catch (err) {
      return bad(res, '迁移失败：' + (err.message || err));
    }
  }

  if (pathname.startsWith('/api/agent')) {
    // 客户端自带的 x-project-id 不可信：只认当前租户里的项目，认不出就用当前项目。
    const asked = String(req.headers['x-project-id'] || '').trim();
    let agentProject = projectId || AGENT_PROJECT;
    if (asked) {
      try { agentProject = assertProject(asked).id; } catch { agentProject = projectId || AGENT_PROJECT; }
    }
    req.headers['x-project-id'] = agentProject;
    return proxyAgent(req, res, pathname, url.search);
  }


const PROJECT_ROOT = path.resolve(__dirname, '..');
const AGENT_DIR = process.env.WMD_AGENT_DIR || path.join(PROJECT_ROOT, 'agent_backend');
const MANAGER_DIR = process.env.WMD_MANAGER_DIR || path.join(PROJECT_ROOT, '..', 'Video-Generation-Manager');
const LOCAL_PYTHON = path.join(AGENT_DIR, '.venv', 'Scripts', 'python.exe');
const LEGACY_PYTHON = 'D:/notebook/AIGC/ml-engineer/backend/.venv/Scripts/python.exe';
const PYTHON = process.env.WMD_PYTHON || (fs.existsSync(LOCAL_PYTHON) ? LOCAL_PYTHON : LEGACY_PYTHON);
const SERVICE_STATE = path.join(PROJECT_ROOT, 'data', 'service-pids.json');
const MANAGER_BASE = process.env.WMD_MANAGER_URL || 'http://127.0.0.1:17778';

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
        env: { ...process.env, AGENT_SETTINGS_PATH: path.join(AGENT_DIR, 'data', 'agent_settings.json'), HARNESS_AUTH_MODE: process.env.HARNESS_AUTH_MODE || 'controller', WMD_BASE_URL: 'http://127.0.0.1:17821' },
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

  // 智能体后端复核项目归属：内部凭据 + 本机来源；不按当前租户过滤，
  // 因为智能体是替任意租户的项目服务的，租户隔离由创作台代理层完成。
  const internalProjectRoute = /^\/api\/internal\/projects\/([^/]+)$/.exec(pathname);
  if (method === 'GET' && internalProjectRoute) {
    if (!internalCall) return bad(res, 'forbidden', 403);
    const project = projects.get(internalProjectRoute[1]);
    if (!project) return bad(res, '项目不存在', 404);
    return ok(res, { id: project.id, tenantId: project.tenantId || tenants.DEFAULT_TENANT });
  }

  if (method === 'GET' && pathname === '/api/health') return ok(res, { status: 'ok', name: 'creation-studio', uptime: process.uptime(), activeImageTasks:imageTasks.tasks().activeCount() });

  // 前端资源指纹：页面开着很久时用它发现「服务器已经换了新版本」，提示刷新，避免看到旧样式
  if (method === 'GET' && pathname === '/api/web-version') {
    const files = ['index.html', 'app.js', 'styles.css', 'shell-spec.css'].map((name) => path.join(WEB, name));
    const parts = files.map((file) => {
      try { return Math.round(fs.statSync(file).mtimeMs).toString(36); } catch { return '0'; }
    });
    return ok(res, { version: parts.join('-') });
  }

  // 没有选中项目时，工作台状态按租户分开存，不能用全局的 default 桶
  const studioKey = (value) => scoped(value) || unassignedKey();

  if (method === 'GET' && pathname === '/api/studio/state') {
    return ok(res, studioStore.get(studioKey(url.searchParams.get('projectId'))));
  }

  if (method === 'POST' && pathname === '/api/studio/state') {
    const body = await readBody(req);
    const saved = studioStore.save(studioKey(body.projectId), body.state);
    return ok(res, saved);
  }

  if (method === 'GET' && pathname === '/api/state') {
    return ok(res, {
      config: configView(),
      projectId,
      project: activeProject ? projects.publicProject(activeProject) : null,
      projectRoot: config.load().projectRoot,
      workflows: workflows.publicList(),
      defaultWorkflowId: workflows.defaultWorkflow().id,
      jobs: projectId ? jobs.list(projectId) : jobs.list(),
      stats: jobs.slotStats(),
      channels: {
        // 列表只返回 hasKey / masked；真正调用渠道时服务端自己按 id 取完整 Key。
        // 内部服务（智能体后端，凭 internal token 直接调用）例外：它要自己直连模型，
        // 拿不到 Key 就只能退回单一模型，所以这条分支保留明文 Key。
        llm: channels.list('llm', { includeSecrets: internalCall }),
        image: channels.list('image', { includeSecrets: internalCall }),
        video: channels.list('video', { includeSecrets: internalCall }),
      },
      channelTypes: channels.publicTypes(),
      prompt: {
        sections: prompts.SECTION_KEYS,
        labels: prompts.SECTION_LABEL,
        examples: prompts.EXAMPLES,
        skeleton: prompts.SKELETON,
        seedanceSkeleton: seedance.SKELETON,
        seedance: { start: seedance.START, end: seedance.END, record: seedance.RECORD },
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
    const event=events.createFromJobInputs(prepareEventVideos(inputs),{source:'batch',kind:'video',title:parsed.name,projectId:body.projectId||'',policy:body.policy,schedule:body.schedule});
    return ok(res,{eventId:event.id,count:event.items.length,tasks:parsed.tasks.length,warnings:parsed.warnings});
  }

  if (method === 'POST' && pathname === '/api/prompt/validate') {
    const body = await readBody(req);
    const text = String(body.prompt || '');
    const tokens = (body.assets || []).map((a) => a.token);
    const subjects = body.subjects || [];
    const duration = Number(body.duration) || 10;
    const result = seedance.looksLikeSeedance(text)
      ? seedance.validateSeedance(text, { tokens, subjects, duration })
      : prompts.validatePrompt(text, { tokens, subjects, duration });
    return ok(res, result);
  }

  if (method === 'GET' && pathname === '/api/channels/types') {
    return ok(res, channels.publicTypes());
  }

  if (method === 'GET' && pathname === '/api/video-plugins') return ok(res,{plugins:videoPlugins.list(),errors:videoPlugins.errors()});

  if (method === 'GET' && pathname === '/api/channels') {
    return ok(res, {
      llm: channels.list('llm'),
      image: channels.list('image'),
      video: channels.list('video'),
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
    if (!canManage) return bad(res, '没有权限管理渠道', 403);
    const body = await readBody(req);
    const kind = ['llm', 'image', 'video'].includes(body.kind) ? body.kind : '';
    if (!kind) return bad(res, '未知渠道类型');
    const created = channels.create(kind, body);
    audit.record({ action: 'channel.create', tenantId, userId: currentUser && currentUser.id, target: created.id, detail: kind + ' ' + created.name, ip: clientIp(req) });
    return ok(res, channels.list(kind).find((c) => c.id === created.id));
  }

  const channelRoute = /^\/api\/channels\/([^/]+)(?:\/(activate|test))?$/.exec(pathname);
  if (channelRoute) {
    const id = channelRoute[1];
    const action = channelRoute[2] || '';
    if (method === 'PUT' && !action) {
      if (!canManage) return bad(res, '没有权限管理渠道', 403);
      const body = await readBody(req);
      const kind = body.kind;
      if (!['llm', 'image', 'video'].includes(kind)) return bad(res, '未知渠道类型');
      const updated = channels.update(kind, id, body);
      audit.record({ action: 'channel.update', tenantId, userId: currentUser && currentUser.id, target: id, detail: kind + ' ' + updated.name, ip: clientIp(req) });
      return ok(res, channels.list(kind).find((c) => c.id === updated.id));
    }
    if (method === 'DELETE' && !action) {
      if (!canManage) return bad(res, '没有权限管理渠道', 403);
      const kind = url.searchParams.get('kind') || '';
      if (!['llm', 'image', 'video'].includes(kind)) return bad(res, '未知渠道类型');
      channels.remove(kind, id);
      audit.record({ action: 'channel.delete', tenantId, userId: currentUser && currentUser.id, target: id, detail: kind, ip: clientIp(req) });
      return ok(res, true);
    }
    if (method === 'POST' && action === 'activate') {
      if (!canManage) return bad(res, '没有权限管理渠道', 403);
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
        } else {
          const plugin=videoPlugins.forType(channel.type);
          if(!plugin)throw Error('渠道插件未安装');
          result=await plugin.adapter.test(channel);
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


  if (method === 'GET' && pathname === '/api/images/history') {
    return ok(res, { items: imageHistory.list() });
  }

  if (method === 'GET' && pathname === '/api/images/tasks') {
    const imageProject = scoped(url.searchParams.get('projectId'));
    if(url.searchParams.has('page'))return ok(res,imageTasks.tasks().page(imageProject||undefined,Number(url.searchParams.get('page'))||1));
    return ok(res,{tasks:imageTasks.tasks().list(imageProject||undefined)});
  }
  const imageAction=/^\/api\/images\/tasks\/([^/]+)(?:\/(pause|resume|retry))?$/.exec(pathname);
  if(imageAction){
    const worker=imageTasks.tasks();
    if(method==='GET')return ok(res,worker.get(imageAction[1]));
    if(method==='POST'&&imageAction[2]){const id=imageAction[1],link=events.lookupRef(id);if(link&&['pause','resume'].includes(imageAction[2])){if(imageAction[2]==='pause')events.pauseEvent(link.event.id);else events.resumeEvent(link.event.id);return ok(res,worker.get(link.item.refId));}if(link&&imageAction[2]==='retry'){const event=events.retryItem(link.event.id,link.item.id);return ok(res,worker.get(event.items.find(i=>i.id===link.item.id).refId));}return ok(res,worker[imageAction[2]](id));}
    return bad(res,'method not allowed',405);
  }
  if (method === 'POST' && pathname === '/api/images/generate') {
    const body=await readBody(req),worker=imageTasks.tasks();
    // 项目资产图走固定路径：targetPath 必须是项目相对路径，越界/绝对路径直接拒绝，不落盘
    if (body.targetPath !== undefined && String(body.targetPath || '').trim()) {
      const targetProject = scoped(body.projectId);
      if (!targetProject) return bad(res, '传了 targetPath 就必须带 projectId：项目资产图只能落在项目目录里');
      try {
        projectPaths.targetFor(targetProject, body.targetPath);
        if (!projectPaths.hasExt(body.targetPath, projectPaths.IMAGE_EXT)) return bad(res, 'targetPath 要写到图片文件名（.png / .jpg / .webp）');
      } catch (err) { return bad(res, err.message, err.status || 400); }
      body.projectId = targetProject;
    }
    const event=events.createFromJobInputs([body],{kind:'image',source:'image',title:body.prompt?.slice(0,60),projectId:scoped(body.projectId),paused:body.paused});
    const task=worker.get(event.items[0].refId),eventId=event.id;
    if(body.background)return ok(res,{taskId:task.id,runId:task.id,status:task.status,eventId});
    const result=await worker.wait(task.id);
    if(result.status!=='success')return bad(res,result.error||'图像任务未完成');
    return ok(res,result.result);
  }

  if (method === 'POST' && pathname === '/api/chat/ref-image') {
    const body = await readBody(req);
    return ok(res, await refImages.one(body.prompt, { size: body.size, ratio: body.ratio }));
  }

  if (method === 'POST' && pathname === '/api/images/save-copy') {
    const body = await readBody(req);
    const target = String(body.target || 'assets');
    const paths = (Array.isArray(body.paths) ? body.paths : [body.path]).filter(Boolean);
    if (!paths.length) return bad(res, '没有要保存的图片');
    let dir;
    if (target === 'assets') dir = library.assetRoot(scoped(body.projectId));
    else if (target === 'media') dir = path.join(library.mediaRoot(scoped(body.projectId)), 'images', new Date().toISOString().slice(0, 10));
    else if (target === 'custom') {
      dir = String(body.dir || '').trim();
      if (!dir || !path.isAbsolute(dir)) return bad(res, '自定义目录必须是绝对路径');
    } else return bad(res, '未知保存位置');
    ensureDir(dir);
    const saved = [];
    for (const raw of paths) {
      const src = path.resolve(String(raw));
      if (!isAllowed(src, tenantId) || !fs.existsSync(src) || !fs.statSync(src).isFile()) return bad(res, '源文件不可用：' + src);
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
    const saved = imagegen.saveImages([{ buffer, mime: m[1] }], undefined, scoped(body.projectId), { targetPath: body.targetPath });
    if(body.sourcePath&&isAllowed(body.sourcePath, tenantId)) generationStore.link(body.sourcePath,saved.items[0].path);
    imageHistory.remember({ id: saved.id, items: saved.items, prompt: String(body.prompt || ''), kind: 'edit', createdAt: Date.now(), projectId: String(body.projectId || '') });
    return ok(res, { id: saved.id, item: saved.items[0] });
  }

  if (method === 'POST' && pathname === '/api/assets/from-file') {
    const body = await readBody(req);
    const src = path.resolve(String(body.path || ''));
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return bad(res, '文件不存在');
    if (!isAllowed(src, tenantId)) return bad(res,'源文件不在素材目录内');
    const saved = library.saveAssetUpload(path.basename(src), fs.readFileSync(src), body.folder || '');
    generationStore.link(src,saved.path);
    return ok(res, { rel: saved.rel, path: saved.path });
  }

  if (method === 'PUT' && pathname === '/api/config') {
    const body = await readBody(req);
    const patch = {};
    // 部署参数是平台级的，只有平台管理员能改；渠道/Key/提示词只有租户管理员能改；
    // 界面偏好（主题、壁纸、字号、音量）是每用户自己的，登录后写 user_prefs。
    const platformKeys = new Set(['concurrency', 'projectRoot', 'saveFolder', 'assetFolder', 'voiceLibraryFolder']);
    const tenantKeys = new Set(['autodlKeys', 'llm', 'prompt']);
    const canPlatform = !currentUser || Boolean(currentUser.isAdmin);
    for (const key of ['concurrency', 'projectRoot', 'saveFolder', 'assetFolder', 'voiceLibraryFolder', 'autodlKeys', 'llm', 'prompt']) {
      if (body[key] === undefined) continue;
      if (platformKeys.has(key) && !canPlatform) continue;
      if (tenantKeys.has(key) && !canManage) continue;
      patch[key] = body[key];
    }
    const uiPatch = body.ui && typeof body.ui === 'object' && !Array.isArray(body.ui) ? body.ui : null;
    if (uiPatch) {
      if (currentUser) userPrefs.save(currentUser.id, uiPatch);
      else patch.ui = uiPatch;   // 还没有账号时，本机设置继续写平台默认值
    }
    if (patch.projectRoot) ensureDir(patch.projectRoot);
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
    audit.record({ action: 'config.update', tenantId, userId: currentUser && currentUser.id, detail: [...Object.keys(patch), ...(uiPatch ? ['ui'] : [])].join(','), ip: clientIp(req) });
    return ok(res, configView());
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

  if (method === 'POST' && (pathname === '/api/optimize' || pathname === '/api/optimize/seedance')) {
    const body = await readBody(req);
    if (pathname === '/api/optimize/seedance') body.format = 'seedance';
    return ok(res, await handleOptimize(body));
  }

  if (method === 'POST' && pathname === '/api/upload/raw') {
    const name = sanitizeFilename(url.searchParams.get('name') || 'upload');
    const limit = (/\.(mp4|webm)$/i.test(name) ? 600 : /\.(mp3|wav|m4a|ogg|flac)$/i.test(name) ? 60 : 10) * 1024 * 1024;
    if (Number(req.headers['content-length']) > limit) {
      req.resume();
      return bad(res, '文件超过上传大小限制', 413);
    }
    const target = path.join(ensureDir(library.uploadRoot(projectId)), `${uid()}-${name}`);
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
    const saved = saveBase64Upload(body.name, body.data, body.folder, scoped(body.projectId), body.type);
    return ok(res, saved);
  }

  if (method === 'GET' && pathname === '/api/file') {
    // 规范地址：?rel=<项目相对路径>&projectId=<项目>，跟着项目根目录走，换根不会断
    const relPath = url.searchParams.get('rel');
    if (relPath) {
      const pid = scoped(url.searchParams.get('projectId'));
      let file = '';
      try { file = projectPaths.abs(pid, relPath); } catch (err) { return bad(res, err.message, err.status || 400); }
      if (!fs.existsSync(file)) return bad(res, '文件不存在：' + projectPaths.normalize(relPath), 404);
      return serveFile(req, res, file, { download: url.searchParams.get('download') === '1' });
    }
    const requested = url.searchParams.get('path');
    if (!requested) return bad(res, '非法路径', 403);
    // 老记录（绝对路径）兼容：素材归档/改名后查别名表，换过项目根目录的按项目目录名重挂
    let file = path.resolve(requested);
    let allowed = isAllowed(file, tenantId);
    if (!allowed || !fs.existsSync(file)) {
      const moved = fileAliases.resolve(requested);
      if (moved && isAllowed(moved, tenantId)) { file = moved; allowed = true; }
    }
    // 素材被整理进 <集名> 子目录之后，按文件名找回并记别名
    if ((!allowed || !fs.existsSync(file)) && req.method === 'GET') {
      const found = fileAliases.recover(requested);
      if (found && isAllowed(found, tenantId)) { file = found; allowed = true; }
    }
    if (!allowed && !fs.existsSync(file)) {
      const healed = projectPaths.rebaseAny(requested);
      if (healed && isAllowed(healed, tenantId)) { file = healed; allowed = true; }
    }
    if (!allowed) return bad(res, '非法路径', 403);
    if (!fs.existsSync(file)) return bad(res, '文件已移动或删除：' + requested, 404);
    return serveFile(req, res, file, { download: url.searchParams.get('download') === '1' });
  }

/* ------------------------- 智能体可用的本地创作工具 ------------------------- */

const FFMPEG = process.env.WMD_FFMPEG || 'D:/notebook/software/ffmpeg/bin/ffmpeg.exe';
const FFPROBE = process.env.WMD_FFPROBE || 'D:/notebook/software/ffmpeg/bin/ffprobe.exe';

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
    // 选了项目只看该项目；没选就列本租户（当前用户可见项目）的队列，内部轮询依赖这份列表
    let list = projectId ? jobs.list(projectId) : jobs.list().filter((job) => inTenant(job.projectId));
    const eventId = url.searchParams.get('eventId') || '';
    if (eventId) list = list.filter((j) => j.eventId === eventId);
    if (status) list = list.filter((j) => j.status === status);
    if (provider) list = list.filter((j) => j.provider === provider);
    if(url.searchParams.has('page')){const total=list.length,page=Math.max(1,Math.min(Math.ceil(total/10)||1,Number(url.searchParams.get('page'))||1));list=list.slice().sort((a,b)=>b.createdAt-a.createdAt).slice((page-1)*10,page*10).map(({logs,prompt,...summary})=>summary);return ok(res,{jobs:list,total,page,pageSize:10});}
    return ok(res, { jobs: list, stats: jobs.slotStats() });
  }

  if (method === 'POST' && pathname === '/api/jobs') {
    const body = await readBody(req);
    if(body.itemId)workbenchStore.store().get(body.itemId,scoped(body.projectId),'video');
    const inputs=prepareEventVideos([{ ...body, projectId: scoped(body.projectId) }]);
    const event=events.createFromJobInputs(inputs,{kind:'video',source:'studio',title:body.title,projectId:scoped(body.projectId),policy:body.policy,schedule:body.schedule});
    return ok(res,{jobs:event.items.map(i=>({id:i.refId})),eventId:event.id,warnings:[]});
  }

  if (method === 'GET' && pathname === '/api/capabilities') {
    return ok(res, probe.capabilities());
  }

  const taskProbe = /^\/api\/tasks\/([^/]+)\/probe$/.exec(pathname);
  if (method === 'POST' && taskProbe) {
    const id = taskProbe[1];
    const job = jobs.list().find((item) => item.id === id);
    if (job) return ok(res, await probe.probeJob(job));
    try {
      const worker = require('./image-tasks').tasks();
      return ok(res, probe.probeImageTask(worker.get(id)));
    } catch {
      const missing = new Error('任务不存在'); missing.status = 404; throw missing;
    }
  }

  if (method === 'GET' && pathname === '/api/task-import/template') {
    const format = (url.searchParams.get('format') || 'json').toLowerCase() === 'xlsx' ? 'xlsx' : 'json';
    const body = format === 'xlsx' ? taskImport.xlsxTemplate() : taskImport.jsonTemplate();
    const type = format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/json; charset=utf-8';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="task-template.${format}"`,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  if (method === 'POST' && pathname === '/api/task-import/parse') {
    const body = await readBody(req);
    if (!body || !body.data) return bad(res, '没有收到文件内容');
    try {
      return ok(res, taskImport.parseFile({ name: body.name, data: body.data }));
    } catch (err) {
      return bad(res, err.message || '文件解析失败');
    }
  }

  if (method === 'GET' && pathname === '/api/events') {
    // 任务只在项目内可见：列表按「当前项目」过滤，不再跨项目汇总
    const askedProject = url.searchParams.get('projectId') ? scoped(url.searchParams.get('projectId')) : '';
    const allowedProjectIds = askedProject ? [askedProject] : (projectId ? [projectId] : (unassignedVisible() ? [''] : []));
    return ok(res, events.list({ status: url.searchParams.get('status') || '', source: url.searchParams.get('source') || '', kind:url.searchParams.get('kind')||'',projectId:askedProject,projectIds:allowedProjectIds,page:url.searchParams.get('page'),query:url.searchParams.get('query')||'',month:url.searchParams.get('month')||'',sort:url.searchParams.get('sort')||'' }));
  }

  if (method === 'POST' && pathname === '/api/events/import') {
    const body = await readBody(req);
    const parsed = batch.parseBatch(body.json, { baseDir: body.baseDir, fileDir: body.fileDir, name: body.name });
    const inputs = batch.toJobInputs(parsed, body.workflowId);
    if (!inputs.length) return bad(res, '没有可导入的任务：' + (parsed.errors.join('；') || '请检查 JSON'));
    const event = events.createFromJobInputs(prepareEventVideos(inputs), { kind:'video', policy:body.policy,schedule:body.schedule,draft:body.draft, title: body.title || parsed.name || '', source: 'batch', workflowId: body.workflowId, projectId: scoped(body.projectId), channelId: body.channelId || '' });
    return ok(res, event);
  }

  if (method === 'POST' && pathname === '/api/events') {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return bad(res, '事件没有条目');
    const inputs = items.map((item) => ({ ...item, workflowId: item.workflowId || body.workflowId, count: item.count || 1, projectId: scoped(body.projectId) || item.projectId, itemId: body.itemId || item.itemId }));
    const event = events.createFromJobInputs(body.kind==='image'?inputs:prepareEventVideos(inputs), { kind:body.kind,requestId:body.requestId||req.headers['idempotency-key'],policy:body.policy,schedule:body.schedule,draft:body.draft,pendingSchedule:body.pendingSchedule, title: body.title, source: ['batch', 'studio', 'image', 'api'].includes(body.source) ? body.source : 'api', workflowId: body.workflowId, projectId: scoped(body.projectId), channelId: body.channelId || '' });
    return ok(res, event);
  }

  if (method === 'GET' && pathname === '/api/events/report') {
    return ok(res, events.reportRange(url.searchParams.get('days'),url.searchParams.get('kind'),projectId));
  }

  // 任务详情、子资源、删除、调度一律按项目校验：别的项目的任务当作不存在
  const eventScoped = /^\/api\/events\/([^/]+)(?:\/|$)/.exec(pathname);
  if (eventScoped && !['report', 'trash', 'import'].includes(eventScoped[1])) {
    let target = null;
    try { target = events.get(eventScoped[1]); } catch { target = null; }
    const targetProject = target ? String((target.spec && target.spec.projectId) || '') : '';
    // 当前项目（含「没有项目」这个空桶）之外的任务一律当作不存在
    if (!target || targetProject !== String(projectId || '')) return bad(res, '事件不存在', 404);
  }

  const eventReport = /^\/api\/events\/([^/]+)\/report$/.exec(pathname);
  if (method === 'GET' && eventReport) {
    if (url.searchParams.get('format') === 'csv') {
      const csv = events.reportCsv(eventReport[1]);
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + csv.filename + '"' });
      res.end(csv.body);
      return;
    }
    return ok(res, events.report(eventReport[1]));
  }

  const draftRoute=/^\/api\/events\/([^/]+)\/draft$/.exec(pathname);
  if(draftRoute&&method==='POST'){const body=await readBody(req),event=events.get(draftRoute[1]);const inputs=Array.isArray(body.items)?body.items:[];if(!inputs.length)return bad(res,'至少需要一个条目');return ok(res,events.updateDraft(event.id,event.kind==='image'?inputs:prepareEventVideos(inputs),body));}
  const attemptLogRoute=/^\/api\/task-attempts\/([^/]+)\/logs$/.exec(pathname);
  if(attemptLogRoute&&method==='GET')return ok(res,events.repository.attemptLog(attemptLogRoute[1],Math.max(0,Number(url.searchParams.get('after'))||0)));
  const lifecycleAction=/^\/api\/events\/([^/]+)\/(schedule|queue|prepare|attempts)$/.exec(pathname);
  if(lifecycleAction){const id=lifecycleAction[1];if(method==='POST'&&lifecycleAction[2]==='queue')return ok(res,events.queueEvent(id));if(method==='POST'&&lifecycleAction[2]==='prepare')return ok(res,events.prepareEvent(id));if(method==='POST'&&lifecycleAction[2]==='schedule')return ok(res,events.scheduleEvent(id,await readBody(req)));if(method==='GET'&&lifecycleAction[2]==='attempts'){const event=events.get(id),data=events.repository.attemptPage(id,url.searchParams.get('page'));const grouped=new Map();for(const attempt of data.attempts){const item=event.items.find(i=>i.id===attempt.itemId);if(!grouped.has(attempt.itemId))grouped.set(attempt.itemId,{itemId:attempt.itemId,title:item?.title||attempt.itemId,attempts:[]});grouped.get(attempt.itemId).attempts.push(attempt);}return ok(res,{...data,items:[...grouped.values()]});}}
  const deleteEventRoute = /^\/api\/events\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && deleteEventRoute) {
    const removed = events.removeEvent(deleteEventRoute[1]);
    audit.record({ action: 'event.delete', tenantId, userId: currentUser && currentUser.id, target: deleteEventRoute[1], detail: removed.title || '', ip: clientIp(req) });
    return ok(res, removed);
  }

  /* 豆包视频提取：借管理器的账号登录态抓对话里的成片，再拿回来替换本地成片 */
  // 管理器有 Bearer 鉴权，token 存在「管理器」类型渠道的 apiKey 里（和别的管理器调用保持一致）
  const managerChannel = () => (config.load().channels.video || []).find((c) => c.type === 'manager-video' && c.enabled !== false);
  const managerBaseUrl = () => {
    const channel = managerChannel();
    return String((channel && channel.baseUrl) || MANAGER_BASE).replace(/\/+$/, '');
  };
  const managerAuth = () => {
    const channel = managerChannel();
    const token = String((channel && channel.apiKey) || '').replace(/^\s*Bearer\s+/i, '').trim();
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  };
  if (pathname === '/api/extract/accounts' && method === 'GET') {
    const res2 = await httpJson(managerBaseUrl() + '/api/extract/accounts', { headers: managerAuth(), timeoutMs: 15000 }).catch((err) => ({ ok: false, status: 0, data: null, text: err.message }));
    if (!res2.ok || !res2.data) return bad(res, '管理器没响应，先在管理器里确认服务在跑（' + String((res2.data && res2.data.error) || res2.text || '连接失败').slice(0, 120) + '）', 502);
    const accounts = (res2.data.accounts || []).map((row) => ({ id: row.id, name: row.name, group: row.group || '', enabled: row.enabled !== false }));
    return ok(res, { accounts });
  }
  if (pathname === '/api/extract/scan' && method === 'POST') {
    const body = await readBody(req);
    if (!String(body.url || '').trim()) return bad(res, '请先粘贴豆包对话链接');
    if (!body.accountId) return bad(res, '请选择用于提取的账号');
    try {
      const res2 = await httpJson(managerBaseUrl() + '/api/extract/scan', {
        method: 'POST',
        headers: { ...managerAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: String(body.url).trim(), accountId: String(body.accountId) }),
        timeoutMs: 240000,
      });
      if (!res2.ok || !res2.data) return bad(res, (res2.data && res2.data.error) || '提取失败：管理器没有返回结果', 502);
      return ok(res, res2.data);
    } catch (err) {
      return bad(res, '提取失败：' + err.message, 502);
    }
  }
  if (pathname === '/api/extract/download' && method === 'POST') {
    const body = await readBody(req);
    if (!body.sessionId || !body.key) return bad(res, '缺少提取会话，请重新扫描');
    try {
      const res2 = await httpJson(managerBaseUrl() + '/api/extract/download', {
        method: 'POST',
        headers: { ...managerAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: String(body.sessionId), key: String(body.key), name: String(body.name || '') }),
        timeoutMs: 300000,
      });
      if (!res2.ok || !res2.data) return bad(res, (res2.data && res2.data.error) || '下载失败', 502);
      return ok(res, res2.data);
    } catch (err) {
      return bad(res, '下载失败：' + err.message, 502);
    }
  }
  if (pathname === '/api/extract/stream' && method === 'GET') {
    // 播放时用：把带鉴权的流地址换成一次性直通（管理器侧只认 127.0.0.1，不做跨机暴露）
    const token = String((managerChannel() && managerChannel().apiKey) || '').replace(/^\s*Bearer\s+/i, '').trim();
    const target = managerBaseUrl() + '/api/extract/stream?sessionId=' + encodeURIComponent(url.searchParams.get('sessionId') || '')
      + '&key=' + encodeURIComponent(url.searchParams.get('key') || '')
      + (token ? '&token=' + encodeURIComponent(token) : '');
    res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
    return res.end();
  }

  if (method === 'GET' && pathname === '/api/events/trash') return ok(res, { items: events.listTrash(projectId) });

  /* 任务清单：任务 → 镜头 → 提示词 → 成片路径 的完整 JSON 映射 */
  if (method === 'GET' && pathname === '/api/tasks/manifest') {
    const kind = url.searchParams.get('kind') === 'image' ? 'image' : 'video';
    const pid = scoped(url.searchParams.get('projectId'));
    return ok(res, taskManifest.build(pid, kind));
  }
  if (method === 'POST' && pathname === '/api/tasks/manifest/save') {
    const body = await readBody(req).catch(() => ({}));
    const kind = body.kind === 'image' ? 'image' : 'video';
    const pid = scoped(body.projectId);
    const saved = taskManifest.save(pid, kind);
    return ok(res, { file: saved.file, counts: saved.manifest.counts });
  }
  if (method === 'POST' && pathname === '/api/events/trash/restore') {
    const body = await readBody(req).catch(() => ({}));
    // 回收站也按项目隔离：只能恢复当前项目里的任务
    const mine = events.listTrash(projectId).some((row) => row.id === (body.id || ''));
    if (body.id && !mine) return bad(res, '事件不存在', 404);
    return ok(res, events.restoreEvent(body.id || ''));
  }
  const itemRestoreRoute = /^\/api\/events\/([^/]+)\/items\/restore$/.exec(pathname);
  if (method === 'POST' && itemRestoreRoute) {
    const body = await readBody(req).catch(() => ({}));
    return ok(res, events.restoreItem(itemRestoreRoute[1], body.itemId || ''));
  }

  const eventAction = /^\/api\/events\/([^/]+)\/(pause|resume|cancel|retry-failed)$/.exec(pathname);
  if (method === 'POST' && eventAction) {    const id = eventAction[1];
    if (eventAction[2] === 'pause') return ok(res, events.pauseEvent(id));
    if (eventAction[2] === 'resume') return ok(res, events.resumeEvent(id));
    if (eventAction[2] === 'cancel') return ok(res, events.cancelEvent(id));
    return ok(res, events.retryFailed(id));
  }

  const eventItemAction = /^\/api\/events\/([^/]+)\/items\/([^/]+)\/(retry|skip|resume-original|up|down)$/.exec(pathname);
  if (method === 'POST' && eventItemAction) {
    if(['up','down'].includes(eventItemAction[3]))return ok(res,events.moveItem(eventItemAction[1],eventItemAction[2],eventItemAction[3]));
    if(eventItemAction[3]==='resume-original')return ok(res,await events.resumeOriginal(eventItemAction[1],eventItemAction[2]));
    if (eventItemAction[3] === 'retry') return ok(res, events.retryItem(eventItemAction[1], eventItemAction[2]));
    return ok(res, events.skipItem(eventItemAction[1], eventItemAction[2]));
  }

  const eventItemRevise = /^\/api\/events\/([^/]+)\/items\/([^/]+)\/revise$/.exec(pathname);
  if (method === 'POST' && eventItemRevise) {
    const body = await readBody(req);
    const eventId = eventItemRevise[1];
    const itemId = eventItemRevise[2];
    const updated = events.reviseItem(eventId, itemId, body);
    const item = (updated.items || []).find((row) => row.id === itemId);
    // 素材库只是展示副本；有对应分镜时同步提示词，避免两处内容不一致。
    try {
      const pid = updated.spec?.projectId || projectId;
      if (pid && item?.title && item.input) {
        const library = assetLayout.scan(pid);
        const task = (library.tasks || []).find((row) => row.id === eventId);
        const shot = task && (task.shots || []).find((row) => row.name === item.title);
        if (shot) {
          assetLayout.updateShot(pid, { id: eventId, title: updated.title }, shot.name, {
            json: { prompt: String(item.input.userPrompt || ''), prefixPrompt: String(item.input.prefixPrompt || '') },
          });
        }
      }
    } catch { /* 素材库同步失败不影响提示词已经保存 */ }
    return ok(res, { event: updated, item });
  }

  const eventItemLog = /^\/api\/events\/([^/]+)\/items\/([^/]+)\/log$/.exec(pathname);
  if (method === 'GET' && eventItemLog) return ok(res, events.itemLog(eventItemLog[1], eventItemLog[2]));

  const eventItemDelete = /^\/api\/events\/([^/]+)\/items\/([^/]+)$/.exec(pathname);
  if (method === 'DELETE' && eventItemDelete) return ok(res, events.removeItem(eventItemDelete[1], eventItemDelete[2]));

  const eventRoute = /^\/api\/events\/([^/]+)$/.exec(pathname);
  if(method==='GET'&&eventRoute){const event=events.get(eventRoute[1]);if(url.searchParams.get('paged')==='1'){const total=event.items.length,page=Math.max(1,Math.min(Math.ceil(total/10)||1,Number(url.searchParams.get('page'))||1));event.items=event.items.slice((page-1)*10,page*10);event.spec={...event.spec,items:[]};event.itemPaging={total,page,pageSize:10};}return ok(res,event);}

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
    if (action === 'retry') {const link=events.lookupRef(id);if(link){events.retryItem(link.event.id,link.item.id);return ok(res,jobs.get(id));}return ok(res,jobs.retry(id));}
    if (action === 'resume') return ok(res, await jobs.resume(id));
    if (action === 'delete') return ok(res, jobs.remove(id));
    if (action === 'hold') return ok(res, jobs.setHeld(id, true));
    if (action === 'unhold') return ok(res, jobs.setHeld(id, false));
  }

  if (method === 'POST' && pathname === '/api/jobs/reorder') {
    const body = await readBody(req);
    return ok(res, jobs.reorder(Array.isArray(body.ids) ? body.ids : []));
  }

  /* 手动维护成片：重命名 / 删除 / 替换（右键菜单用的三条） */
  const outputAction = /^\/api\/jobs\/([^/]+)\/output\/(rename|delete|replace|add)$/.exec(pathname);

  /* 从本机已有文件顶替成片（比如刚用管理器提取下来的豆包原片），不走浏览器上传 */
  const fromPathRoute = /^\/api\/jobs\/([^/]+)\/output\/from-path$/.exec(pathname);
  if (fromPathRoute && method === 'POST') {
    const jobId = fromPathRoute[1];
    const body = await readBody(req);
    const source = path.resolve(String(body.sourcePath || ''));
    if (!body.sourcePath || !fs.existsSync(source) || !fs.statSync(source).isFile()) return bad(res, '源文件不存在：' + (body.sourcePath || '空'), 404);
    const mode = body.mode === 'add' ? 'add' : 'replace';
    const target = body.path ? path.resolve(String(body.path)) : '';
    if (mode === 'replace' && !target) return bad(res, '缺少要替换的成片路径');
    const ext = path.extname(source) || '.mp4';
    const name = sanitizeFilename(String(body.name || path.basename(source)));
    if (mode === 'add') {
      const added = jobs.addOutput(jobId, source, { name });
      return ok(res, { out: added.out, mode, job: jobs.get(jobId) });
    }
    if (!fs.existsSync(path.dirname(target))) return bad(res, '成片目录不存在', 404);
    const temp = path.join(path.dirname(target), '.from-path-' + uid() + ext);
    try {
      fs.copyFileSync(source, temp);
    } catch (err) {
      return bad(res, '复制源文件失败：' + err.message, 500);
    }
    const result = jobs.replaceOutput(jobId, target, temp, { name });
    return ok(res, { out: result.out, parked: result.parked, mode, job: jobs.get(jobId) });
  }

  if (outputAction && method === 'POST') {
    const jobId = outputAction[1];
    const action = outputAction[2];
    const rawTarget = url.searchParams.get('path') || '';
    const target = rawTarget ? path.resolve(rawTarget) : '';
    const remapMedia = (fromAbs, toAbs) => {
      if (!fromAbs || !toAbs) return;
      try {
        const root = path.resolve(library.mediaRoot(projectId));
        const relOf = (file) => path.relative(root, path.resolve(file)).split(path.sep).join('/');
        mediaEpisodes.remap(projectId, [{ from: relOf(fromAbs), to: relOf(toAbs) }]);
      } catch { /* 分集归属只是展示信息，改不动也不拦操作 */ }
    };
    if (action === 'rename') {
      const body = await readBody(req);
      const result = jobs.renameOutput(jobId, target, body.name || '');
      remapMedia(target, result.out.path);
      return ok(res, { out: result.out, moved: result.moved, job: jobs.get(jobId) });
    }
    if (action === 'delete') {
      const result = jobs.deleteOutput(jobId, target);
      try {
        const root = path.resolve(library.mediaRoot(projectId));
        const relOf = (file) => path.relative(root, path.resolve(file)).split(path.sep).join('/');
        mediaEpisodes.assign(projectId, '', [relOf(target)]);
      } catch { /* 没有分集归属就直接跳过 */ }
      return ok(res, { removed: result.removed, parked: result.parked, job: jobs.get(jobId) });
    }
    const name = sanitizeFilename(url.searchParams.get('name') || path.basename(target || '成片.mp4'));
    const limit = 4 * 1024 * 1024 * 1024;
    if (Number(req.headers['content-length']) > limit) { req.resume(); return bad(res, '文件超过 4GB', 413); }
    if (action === 'replace' && !fs.existsSync(path.dirname(target))) return bad(res, '成片目录不存在', 404);
    const partialDir = action === 'add' ? os.tmpdir() : path.dirname(target);
    const partial = path.join(partialDir, '.upload-' + uid() + (path.extname(name) || '.mp4'));
    let handle = null;
    let bytes = 0;
    try {
      handle = await fs.promises.open(partial, 'wx');
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > limit) throw new Error('文件超过 4GB');
        let offset = 0;
        while (offset < chunk.length) {
          const written = await handle.write(chunk, offset, chunk.length - offset);
          offset += written.bytesWritten;
        }
      }
      if (!bytes) throw new Error('文件内容为空');
      await handle.close();
      handle = null;
    } catch (err) {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.unlink(partial).catch(() => {});
      throw err;
    }
    if (action === 'add') {
      const added = jobs.addOutput(jobId, partial, { name });
      return ok(res, { out: added.out, job: jobs.get(jobId) });
    }
    const result = jobs.replaceOutput(jobId, target, partial, { name });
    remapMedia(target, result.out.path);
    return ok(res, { out: result.out, parked: result.parked, job: jobs.get(jobId) });
  }

  if (method === 'GET' && pathname === '/api/assets/library') {
    return ok(res, assetLayout.scan(projectId));
  }

  // 素材库左侧树：点一层读一层，别一次把整棵目录树都读出来；deep=1 时把这个分类下的文件全列出来
  if (method === 'GET' && pathname === '/api/assets/dir') {
    return ok(res, assetLayout.scanDir(projectId, url.searchParams.get('rel') || '', { deep: url.searchParams.get('deep') === '1' }));
  }

  if (method === 'GET' && pathname === '/api/assets') {
    return ok(res, library.scanAssets(projectId));
  }

  if (method === 'POST' && pathname === '/api/assets/material/upload') {
    const body = await readBody(req);
    const buffer = Buffer.from(String(body.data || '').split(',').pop(), 'base64');
    if (!buffer.length) return bad(res, '图片是空的');
    return ok(res, assetLayout.saveMaterialBuffer(projectId, body.type, body.name || 'image.png', buffer));
  }

  if (method === 'POST' && pathname === '/api/assets/task') {
    const body = await readBody(req);
    return ok(res, assetLayout.createTask(projectId, body.title || body.name));
  }

  if (method === 'POST' && pathname === '/api/assets/task/rename') {
    const body = await readBody(req);
    return ok(res, assetLayout.renameTask(projectId, { id: body.taskId, title: body.taskTitle }, body.title || body.name));
  }

  if (method === 'POST' && pathname === '/api/assets/task/delete') {
    const body = await readBody(req);
    return ok(res, assetLayout.deleteTask(projectId, { id: body.taskId, title: body.taskTitle }));
  }

  if (method === 'POST' && pathname === '/api/assets/shot/rename') {
    const body = await readBody(req);
    return ok(res, assetLayout.renameShot(projectId, { id: body.taskId, title: body.taskTitle }, body.shot, body.name));
  }

  if (method === 'POST' && pathname === '/api/assets/material/rename') {
    const body = await readBody(req);
    return ok(res, assetLayout.renameMaterial(projectId, body.rel, body.name));
  }

  if (method === 'POST' && pathname === '/api/assets/material/delete') {
    const body = await readBody(req);
    return ok(res, assetLayout.deleteMaterial(projectId, body.rel));
  }

  if (method === 'POST' && pathname === '/api/assets/shot') {
    const body = await readBody(req);
    return ok(res, assetLayout.createShot(projectId, { id: body.taskId, title: body.taskTitle }, body.name));
  }

  if (method === 'POST' && pathname === '/api/assets/shot/slot') {
    const body = await readBody(req);
    const shot = String(body.shot || '').trim();
    if (!shot) return bad(res, '缺少分镜名称');
    const task = { id: body.taskId, title: body.taskTitle };
    if (body.source) return ok(res, assetLayout.copyToSlot(projectId, task, shot, body.slot, body.source));
    if (!body.data) return bad(res, '缺少图片数据');
    const buffer = Buffer.from(String(body.data).split(',').pop(), 'base64');
    if (!buffer.length) return bad(res, '图片是空的');
    return ok(res, assetLayout.saveSlotBuffer(assetLayout.rootFor(projectId), task, shot, body.slot, body.name || 'image.png', buffer));
  }

  if (method === 'POST' && pathname === '/api/assets/shot/clear') {
    const body = await readBody(req);
    return ok(res, assetLayout.clearSlot(projectId, { id: body.taskId, title: body.taskTitle }, body.shot, body.slot));
  }

  if (method === 'POST' && pathname === '/api/assets/shot/json') {
    const body = await readBody(req);
    return ok(res, assetLayout.updateShot(projectId, { id: body.taskId, title: body.taskTitle }, body.shot, { prompt: body.prompt, title: body.title, json: body.json }));
  }

  if (method === 'POST' && pathname === '/api/assets/shots/import') {
    const body = await readBody(req);
    if (!Array.isArray(body.items) || !body.items.length) return bad(res, '没有可导入的分镜');
    return ok(res, assetLayout.importShots(projectId, body.items, body.source || '', { id: body.taskId, title: body.taskTitle }));
  }

  if (method === 'POST' && pathname === '/api/assets/shot/delete') {
    const body = await readBody(req);
    return ok(res, assetLayout.deleteShot(projectId, { id: body.taskId, title: body.taskTitle }, body.name));
  }

  if (method === 'POST' && pathname === '/api/assets/upload') {
    const body = await readBody(req);
    return ok(res, saveBase64Upload(body.name, body.data, 'assets', projectId, body.type, body.group || ''));
  }

  if (method === 'POST' && pathname === '/api/assets/type') {
    const body = await readBody(req);
    return ok(res, library.setType(projectId, body.rel, body.type || body.value));
  }

  if (method === 'POST' && pathname === '/api/assets/move') {
    const body = await readBody(req);
    return ok(res, library.moveAsset(projectId, body.rel, body.group != null ? body.group : body.folder));
  }

  if (method === 'POST' && pathname === '/api/assets/rename') {
    const body = await readBody(req);
    return ok(res, { rel: library.renameAsset(projectId, body.rel, body.name) });
  }

  if (method === 'POST' && pathname === '/api/assets/subject') {
    const body = await readBody(req);
    return ok(res, library.setSubject(projectId, body.rel, body.subject));
  }

  if (method === 'POST' && (pathname === '/api/assets/group' || pathname === '/api/assets/folder')) {
    const body = await readBody(req);
    return ok(res, { name: library.createGroup(projectId, body.name) });
  }

  if (method === 'GET' && pathname === '/api/assets/file') {
    return serveFile(req, res, library.fileForAsset(projectId, url.searchParams.get('rel') || ''));
  }

  if (method === 'GET' && pathname === '/api/media/tasks') {
    return ok(res, library.listMediaTasks(url.searchParams.get('kind') || '', projectId));
  }

  if (method === 'GET' && pathname === '/api/media') {
    // 显式传 projectId 时按该项目列（仍校验租户归属）；不传沿用当前项目。
    const mediaProject = url.searchParams.get('projectId') ? scoped(url.searchParams.get('projectId')) : projectId;
    return ok(res, library.listMedia(url.searchParams.get('kind') || '', mediaProject, { taskTitle: url.searchParams.get('task') || '' }));
  }

  if (method === 'GET' && pathname === '/api/media/episodes') {
    const pid = scoped(url.searchParams.get('projectId'));
    return ok(res, { ...mediaEpisodes.list(pid), jianying: jianying.status() });
  }

  if (method === 'POST' && pathname === '/api/media/episodes') {
    const body = await readBody(req);
    const pid = scoped(body.projectId);
    if (!pid) return bad(res, '先选择项目');
    if (body.action === 'create') return ok(res, mediaEpisodes.create(pid, { name: body.name, number: body.number }));
    if (body.action === 'rename') return ok(res, mediaEpisodes.rename(pid, body.id, body.name));
    if (body.action === 'delete') return ok(res, mediaEpisodes.remove(pid, body.id));
    if (body.action === 'assign') return ok(res, mediaEpisodes.assign(pid, body.episodeId || '', body.rels));
    return bad(res, '未知操作');
  }

  if (method === 'POST' && pathname === '/api/media/jianying') {
    const body = await readBody(req);
    const pid = scoped(body.projectId);
    if (!pid) return bad(res, '先选择项目');
    const project = projects.get(pid);
    const projectName = (project && project.name) || '未命名项目';
    const data = mediaEpisodes.list(pid);
    const media = library.listMedia('video', pid);
    const plan = mediaDrafts.planTargets(body, { projectName, data, mediaItems: media.items });
    if (plan.error) return bad(res, plan.error);
    const targets = plan.targets;
    const result = jianying.createDrafts(targets.map((target) => ({
      name: target.name,
      clips: target.items.map((item) => ({ path: item.path, name: item.name, kind: item.kind })),
    })));
    return ok(res, { ...result, drafts: targets.map((target) => ({ name: target.name, clips: target.items.length, episodeId: target.episodeId })) });
  }

  if (method === 'POST' && pathname === '/api/media/rename-shots') {
    const body = await readBody(req).catch(() => ({}));
    if (!projectId) return bad(res, '先选择项目');
    const plan = planMediaShotNames(projectId);
    if (body.dryRun !== false) return ok(res, plan);
    if (!plan.plan.length) return ok(res, { ...plan, moved: [] });
    const result = jobs.renameOutputs(plan.plan);
    const root = path.resolve(library.mediaRoot(projectId));
    const relOf = (file) => path.relative(root, path.resolve(file)).split(path.sep).join('/');
    mediaEpisodes.remap(projectId, plan.plan.map((row) => ({ from: relOf(row.oldPath), to: relOf(row.newPath) })));
    return ok(res, { ...plan, plan: plan.plan, moved: result.moved });
  }

  if (method === 'GET' && pathname === '/api/media/file') {
    return serveFile(req, res, library.mediaFile(projectId, url.searchParams.get('path') || ''));
  }

  /**
   * 导入自己生成（或从别处下载）的成片：
   * 落盘到 <项目>/media/<日期>/import-<id>/<原文件名>，并写一份 params.json，
   * 这样媒体库、分集、剪映导出都能像普通任务成片一样认出来。
   * body 走原始流（浏览器 fetch(file)），不吃 base64，几十上百 MB 也不用先编码。
   */
  if (method === 'POST' && pathname === '/api/media/import') {
    const name = sanitizeFilename(url.searchParams.get('name') || 'import.mp4');
    const fileKind = kindOf(name);
    if (fileKind !== 'video' && fileKind !== 'image' && fileKind !== 'audio') return bad(res, '只支持导入视频 / 图片 / 音频');
    const dayRaw = String(url.searchParams.get('day') || '').trim();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(dayRaw) ? dayRaw : today;
    const taskTitle = String(url.searchParams.get('taskTitle') || '').slice(0, 80);
    const shotLabel = String(url.searchParams.get('shotLabel') || '').slice(0, 80);
    const limit = 4 * 1024 * 1024 * 1024;
    if (Number(req.headers['content-length']) > limit) {
      req.resume();
      return bad(res, '文件超过 4GB', 413);
    }
    const root = path.resolve(library.mediaRoot(projectId));
    const jobId = 'import-' + uid();
    const dir = ensureDir(path.join(root, day, jobId));
    const target = path.join(dir, name);
    const partial = target + '.part';
    let handle = null;
    let bytes = 0;
    try {
      handle = await fs.promises.open(partial, 'wx');
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > limit) throw new Error('文件超过 4GB');
        let offset = 0;
        while (offset < chunk.length) {
          const written = await handle.write(chunk, offset, chunk.length - offset);
          offset += written.bytesWritten;
        }
      }
      if (!bytes) throw new Error('文件内容为空');
      await handle.close();
      handle = null;
      await fs.promises.rename(partial, target);
    } catch (err) {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.unlink(partial).catch(() => {});
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    const stem = name.replace(/\.[^.]+$/, '');
    writeJson(path.join(dir, 'params.json'), {
      id: jobId,
      createdAt: now.toISOString(),
      finishedAt: now.toISOString(),
      workflow: '手工导入',
      title: shotLabel || stem,
      shotLabel: shotLabel || stem,
      outputLabel: shotLabel || stem,
      taskTitle,
      eventId: '',
      eventItemId: '',
      prompt: '',
      userPrompt: '',
      imported: true,
      sourceName: name,
    });
    const rel = path.relative(root, target).split(path.sep).join('/');
    return ok(res, {
      path: target,
      rel,
      name,
      bytes,
      kind: fileKind,
      day,
      jobId,
      taskTitle,
      shotLabel: shotLabel || stem,
      url: '/api/media/file?path=' + encodeURIComponent(target),
    });
  }

  if (method === 'POST' && pathname === '/api/media/open') {
    const body = await readBody(req);
    if (body.player) library.openWithSystemPlayer(body.path);
    else library.openPath(body.path, { select: false });
    return ok(res, true);
  }

  if (method === 'GET' && pathname === '/api/task-events/stream') {
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
    // 只推本租户的任务事件，别的租户的任务不广播
    const onJob = (job) => { if (inTenant(job && job.projectId)) send('job', job); };
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
    return ok(res, {
      skeleton: prompts.SKELETON,
      examples: prompts.EXAMPLES,
      labels: prompts.SECTION_LABEL,
      sections: prompts.SECTION_KEYS,
      seedance: { skeleton: seedance.SKELETON, start: seedance.START, end: seedance.END, record: seedance.RECORD },
    });
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
  // 上次轮换密钥如果停在“事务已提交、文件还没换”的中间态，先在这里收尾。
  try {
    const recovered = vault.recover();
    if (recovered.recovered) console.log('密钥轮换已收尾：' + (recovered.backup || ''));
  } catch (error) {
    console.error('密钥轮换收尾失败：' + error.message);
  }
  const cfg = config.load();
  internalAuth.token();
  config.storage();
  // 严格按 租户 → 用户 → 项目 隔离之前，历史项目可能没有归属人：启动时挂到租户负责人名下。
  try {
    const claimed = projects.claimOrphans();
    if (claimed.length) console.log('历史项目已归属到租户负责人：' + claimed.map((row) => row.id).join(', '));
  } catch (error) {
    console.error('历史项目归属迁移失败：' + error.message);
  }
  backup.start();
  jobs.loadState();
  events.start();
  imageTasks.tasks().initialize();
  imageTasks.tasks().pump();
  const port = Number(process.env.WMD_PORT || cfg.port || 17821);
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`WENYUN.M-DESKTOP → ${url}`);
    console.log(`数据目录 ${config.DATA}`);
    jobs.pump();
    // 重启对账：能确认的才改状态，确认不了就保持“待对账”
    setImmediate(async () => {
      try {
        for (const job of jobs.list()) {
          if (job.status !== 'interrupted') continue;
          const result = await tenantContext.run(job.tenantId || tenantScope.tenantOfProject(job.projectId), () => probe.probeJob(job));
          if (result.remote === 'done') jobs.reconcile(job.id, { status: 'failed', stage: '平台已完成（待继续查询）', error: '重启后探针发现平台已完成，可点「继续查询/下载」取回原任务' });
          else if (result.remote === 'failed') jobs.reconcile(job.id, { status: 'failed', stage: '平台失败', error: '重启后探针确认平台任务失败：' + String(result.evidence && result.evidence.detail || '').slice(0, 200) });
          else if (result.remote === 'canceled') jobs.reconcile(job.id, { status: 'canceled', stage: '平台已取消' });
          else jobs.reconcile(job.id, { stage: result.remote === 'running' ? '重启待对账：平台仍在生成' : '重启待对账：无法确认平台状态' });
        }
      } catch { /* 对账失败不影响启动 */ }
    });
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.log(`端口 ${port} 已被占用，可能已经有一个 WENYUN.M-DESKTOP 在运行：http://127.0.0.1:${port}`);
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
process.on('SIGINT',()=>{require('./process-log').line('signal','SIGINT');shutdown();});
process.on('SIGTERM',()=>{require('./process-log').line('signal','SIGTERM');shutdown();});

if (require.main === module) {
  // 先装进程级兜底，再启动服务：崩溃/异常必须留下 process.log 证据。
  require('./process-guard').install({ onFatal: () => jobs.flushState() });
  start();
}

module.exports = { server, start };


/**
 * 媒体库「按分镜重命名」：同一任务内按原始分镜顺序编号为 分镜 1..N。
 * 只生成计划，不直接改文件；用户确认后才会调用 jobs.renameOutputs。
 */
function shotIndexOf(item) {
  return mediaDrafts.shotIndexOf(item);
}

function planMediaShotNames(projectId) {
  const data = library.listMedia('video', projectId);
  const root = path.resolve(data.root);
  const keyOf = (file) => path.resolve(file).toLowerCase();
  const jobByPath = new Map();
  for (const job of jobs.list(projectId)) {
    for (const out of job.outputs || []) if (out.path) jobByPath.set(keyOf(out.path), job);
  }
  const groups = new Map();
  for (const item of data.items) {
    if (item.kind !== 'video') continue;
    const abs = path.resolve(item.path);
    if (!workspace.isInside(root, abs)) continue;
    const job = jobByPath.get(keyOf(abs));
    let event = null;
    let eventItem = null;
    let index = 9999;
    if (job && job.eventId) {
      try {
        const found = events.get(job.eventId);
        const row = (found.items || []).find((entry) => entry.id === job.eventItemId);
        if (row) { event = found; eventItem = row; index = found.items.indexOf(row); }
      } catch { /* 旧任务没有事件记录时按任务名分组 */ }
    }
    const taskTitle = (event && event.title) || (job && job.taskTitle) || item.taskTitle || '未记录任务';
    const key = (event && event.id) || ('task:' + taskTitle);
    if (!groups.has(key)) groups.set(key, { taskTitle, rows: [] });
    groups.get(key).rows.push({ item, job, eventItem, index });
  }
  const plan = [];
  for (const group of groups.values()) {
    group.rows.sort((a, b) => (a.index - b.index) || (a.item.mtime - b.item.mtime));
    group.rows.forEach((row, position) => {
      const oldPath = path.resolve(row.item.path);
      const dir = path.dirname(oldPath);
      const ext = path.extname(row.item.name) || '.mp4';
      const shotTitle = (row.eventItem && row.eventItem.title) || (row.job && row.job.title) || (row.item && row.item.shotLabel) || ('镜头 ' + (position + 1));
      const newName = sanitizeFilename(shotTitle, '镜头 ' + (position + 1)) + ext;
      const newPath = path.join(dir, newName);
      if (keyOf(newPath) === keyOf(oldPath)) return;
      plan.push({
        oldPath, newPath, oldName: path.basename(oldPath), newName,
        jobId: row.job ? row.job.id : '',
        taskTitle: group.taskTitle,
        shotTitle,
      });
    });
  }
  return { root, projectId, projectName: data.projectName || '', total: plan.length, plan };
}

function prepareEventVideos(inputs) {
  return inputs.map(original => {
    const input={...original,userPrompt:original.userPrompt ?? String(original.prompt||'')};
    if(input.applyStyle!==false && (typeof input.prefixPrompt==='string'||input.styleId)) {
      const prefix=typeof input.prefixPrompt==='string'?input.prefixPrompt.trim():styles.promptFor(input.styleId,{layer:input.styleLayer||'video',text:input.prompt});
      if(prefix)input.prompt=prefix+'\n\n'+String(input.prompt||'');
    }
    input.applyStyle=false;
    const wf=workflows.get(input.workflowId);
    if(!wf)throw Object.assign(new Error('工作流不存在'),{status:400});
    // 批量 JSON / 接口里画幅可以写 ratio，统一成工作流的画幅键
    if(!input.aspectRatio && input.ratio) input.aspectRatio=String(input.ratio).trim();
    // 模型：任务上带就优先用任务的（豆包 Seedance 2.0 Mini / Fast），没带才回落渠道配置
    input.model=(input.model?String(input.model).trim():'')||(channels.get('video',wf.channelId)||{}).model||wf.model;
    if(wf.provider==='manager'&&input.model)input.model=managerVideo.normalizeModel(input.model);
    const check=workflows.validate(wf,input);
    if(check.errors.length)throw Object.assign(new Error(check.errors.join('；')),{status:400});
    return input;
  });
}
