'use strict';
/**
 * 应用配置。
 *
 * 部署参数（端口、路径、并发、主题）留在 data/config.json；
 * 密钥（渠道 API Key、AutoDL Token、执行端令牌）加密存 SQLite（src/vault.js），
 * config.json 里永远只留 id/名称，方便备份和人工排查，泄露文件也不会泄露密钥。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ensureDir, readJson, writeJson, uid } = require('./util');
const vault = require('./vault');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.WMD_DATA_DIR ? path.resolve(process.env.WMD_DATA_DIR) : path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA, 'config.json');

function defaultProjectRoot() {
  if (process.env.WMD_PROJECT_ROOT) return path.resolve(process.env.WMD_PROJECT_ROOT);
  if (process.env.WMD_DATA_DIR) return path.join(DATA, 'projects');
  // 默认放在工程仓库旁边（同一个盘、空间充足），而不是仓库内部。
  return path.join(path.dirname(path.dirname(ROOT)), 'WENYUN.M-DESKTOP-Projects');
}

const DEFAULTS = {
  port: Number(process.env.WMD_PORT || 17821),
  concurrency: 3,
  projectRoot: defaultProjectRoot(),
  saveFolder: path.join(DATA, 'media'),
  assetFolder: path.join(DATA, 'assets'),
  uploadFolder: path.join(DATA, 'uploads'),
  voiceLibraryFolder: '',
  // 剪映草稿根目录；留空则从剪映自己的草稿索引里读
  jianyingDraftRoot: '',
  autodlKeys: [],
  // 自助注册：默认关闭，只有平台管理员能创建用户；打开后每个新用户自动开一个独立租户
  signup: { open: false },
  llm: {
    enabled: false,
    protocol: 'chat',
    baseUrl: 'https://www.autodl.art/api/v1',
    apiKey: '',
    model: 'gpt-5.6-luna',
    timeoutMs: 180000,
  },
  prompt: {
    language: 'zh',
    systemPrompt: '',
  },
  ui: {
    theme: 'day-sea',
  },
};

const DEFAULT_TENANT = 'tnt_default';
const TENANT_KEYS = ['channels', 'autodlKeys', 'llm', 'prompt'];

let platformCache = null;
const tenantCache = new Map();

/** 当前租户：HTTP 请求和后台任务由 tenant-context 提供；没有上下文落到默认租户。 */
function currentTenant() {
  const id = require('./tenant-context').current();
  return id || DEFAULT_TENANT;
}

/* --------------------------- 密钥：加密库读写 --------------------------- */

/** 收集配置对象里的明文密钥（只认有 id 的条目）。 */
function collectSecrets(cfg) {
  const out = [];
  for (const key of cfg.autodlKeys || []) {
    if (key && key.id && key.token) out.push({ name: 'autodl:' + key.id, value: String(key.token) });
  }
  if (cfg.llm && cfg.llm.apiKey) out.push({ name: 'llm:apiKey', value: String(cfg.llm.apiKey) });
  for (const kind of ['llm', 'image', 'video']) {
    for (const channel of (cfg.channels && cfg.channels[kind]) || []) {
      if (!channel || !channel.id) continue;
      if (channel.apiKey) out.push({ name: 'channel:' + kind + ':' + channel.id + ':apiKey', value: String(channel.apiKey) });
      if (channel.executorToken) out.push({ name: 'channel:' + kind + ':' + channel.id + ':executorToken', value: String(channel.executorToken) });
    }
  }
  return out;
}

/** 写进 config.json 的版本：不含任何密钥。 */
function stripSecrets(cfg) {
  const copy = structuredClone(cfg);
  for (const key of copy.autodlKeys || []) delete key.token;
  if (copy.llm) delete copy.llm.apiKey;
  for (const kind of ['llm', 'image', 'video']) {
    for (const channel of (copy.channels && copy.channels[kind]) || []) {
      delete channel.apiKey;
      delete channel.executorToken;
    }
  }
  return copy;
}

/** 从加密库补回密钥；没有就留空，交给上层报“未配置”。 */
function withSecrets(cfg, tenantId) {
  const next = structuredClone(cfg);
  const scope = { scope: 'tenant', tenantId: String(tenantId || DEFAULT_TENANT) };
  const fallback = scope.tenantId === DEFAULT_TENANT ? { scope: 'platform', tenantId: '' } : null;
  const read = (name) => {
    const value = vault.get(name, scope);
    if (value) return value;
    return fallback ? vault.get(name, fallback) : '';
  };
  for (const key of next.autodlKeys || []) {
    if (!key || !key.id || key.token) continue;
    const value = read('autodl:' + key.id);
    if (value) key.token = value;
    else if (key.token === undefined) key.token = '';
  }
  if (next.llm && !next.llm.apiKey) {
    const value = read('llm:apiKey');
    if (value) next.llm.apiKey = value;
  }
  for (const kind of ['llm', 'image', 'video']) {
    for (const channel of (next.channels && next.channels[kind]) || []) {
      if (!channel || !channel.id) continue;
      if (!channel.apiKey) {
        const value = read('channel:' + kind + ':' + channel.id + ':apiKey');
        if (value) channel.apiKey = value;
        else if (channel.apiKey === undefined) channel.apiKey = '';
      }
      if (!channel.executorToken) {
        const value = read('channel:' + kind + ':' + channel.id + ':executorToken');
        if (value) channel.executorToken = value;
        else if (channel.executorToken === undefined) channel.executorToken = '';
      }
    }
  }
  return next;
}

/** 把当前租户的密钥写进加密库；已删除的渠道/Key 一并清理。 */
function persistSecrets(cfg, tenantId) {
  const scope = { scope: 'tenant', tenantId: String(tenantId || DEFAULT_TENANT) };
  const keep = new Set();
  const put = (name, value) => {
    keep.add(name);
    if (String(value || '').trim()) vault.set(name, String(value), scope);
    else vault.remove(name, scope);
  };
  for (const key of cfg.autodlKeys || []) if (key && key.id) put('autodl:' + key.id, key.token);
  for (const kind of ['llm', 'image', 'video']) {
    for (const channel of (cfg.channels && cfg.channels[kind]) || []) {
      if (!channel || !channel.id) continue;
      put('channel:' + kind + ':' + channel.id + ':apiKey', channel.apiKey);
      put('channel:' + kind + ':' + channel.id + ':executorToken', channel.executorToken);
    }
  }
  put('llm:apiKey', cfg.llm && cfg.llm.apiKey);
  vault.prune(keep, scope);
}

/** 把旧版本平台作用域的密钥搬到某个租户（默认租户迁移时使用）。 */
function movePlatformSecrets(tenantId) {
  const from = { scope: 'platform', tenantId: '' };
  const to = { scope: 'tenant', tenantId: String(tenantId) };
  for (const name of vault.names(from)) {
    const value = vault.get(name, from);
    if (value) vault.set(name, value, to);
    vault.remove(name, from);
  }
}

function tenantConfigRow(tenantId) {
  return require('./db').open().prepare('SELECT data FROM tenant_configs WHERE tenant_id = ?').get(String(tenantId)) || null;
}

function emptyTenantConfig() {
  return {
    channels: { llm: [], image: [], video: [] },
    autodlKeys: [],
    llm: structuredClone(DEFAULTS.llm),
    prompt: structuredClone(DEFAULTS.prompt),
  };
}

function pickTenant(cfg) {
  return { channels: cfg.channels, autodlKeys: cfg.autodlKeys, llm: cfg.llm, prompt: cfg.prompt };
}

/** 写进 config.json 的版本：只留部署参数，不含租户配置。 */
function stripTenantFields(cfg) {
  const copy = structuredClone(cfg);
  for (const key of TENANT_KEYS) delete copy[key];
  delete copy.tenantId;
  return copy;
}

function persistTenant(tenantId, cfg) {
  const data = stripSecrets(pickTenant(cfg));
  require('./db').open().prepare(`INSERT INTO tenant_configs(tenant_id, data, updated_at) VALUES (?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
    .run(String(tenantId), JSON.stringify(data), Date.now());
  persistSecrets(cfg, tenantId);
}

/** 平台配置：端口、路径、并发、注册开关、界面主题；不含任何渠道/密钥。 */
function normalizePlatform(raw) {
  const cfg = normalize(raw);
  cfg.channels = { llm: [], image: [], video: [] };
  cfg.autodlKeys = [];
  cfg.llm = structuredClone(DEFAULTS.llm);
  cfg.prompt = structuredClone(DEFAULTS.prompt);
  return cfg;
}

function platformLoad() {
  if (platformCache) return platformCache;
  ensureDir(DATA);
  const raw = readJson(CONFIG_FILE, null) || {};
  platformCache = normalizePlatform(raw);
  if (!fs.existsSync(CONFIG_FILE)) writeJson(CONFIG_FILE, stripTenantFields(platformCache));
  return platformCache;
}

/**
 * 租户配置。第一次读默认租户时，把旧版本 config.json 里的渠道/Key/提示词
 * 迁到该租户，并把配置文件的这些字段删掉；其它租户从空配置开始，互不继承。
 */
function tenantConfigLoad(tenantId) {
  const row = tenantConfigRow(tenantId);
  const isDefault = tenantId === DEFAULT_TENANT;
  if (row) {
    if (isDefault) movePlatformSecrets(tenantId);
    try { return JSON.parse(row.data); } catch { return emptyTenantConfig(); }
  }
  const data = emptyTenantConfig();
  if (isDefault) {
    const legacy = readJson(CONFIG_FILE, null);
    if (legacy) {
      if (legacy.channels && typeof legacy.channels === 'object') data.channels = legacy.channels;
      else { const seeded = structuredClone(legacy); seedChannels(seeded); data.channels = seeded.channels; }
      if (Array.isArray(legacy.autodlKeys)) data.autodlKeys = legacy.autodlKeys;
      if (legacy.llm) data.llm = { ...DEFAULTS.llm, ...legacy.llm };
      if (legacy.prompt) data.prompt = { ...DEFAULTS.prompt, ...legacy.prompt };
      // 兼容还没跑过 TASK-006 的旧文件：把内联明文也收进加密库
      for (const item of collectSecrets(data)) vault.set(item.name, item.value, { scope: 'tenant', tenantId });
      movePlatformSecrets(tenantId);
      try { fs.copyFileSync(CONFIG_FILE, CONFIG_FILE + '.bak-' + Date.now()); } catch { /* 备份失败不阻塞 */ }
      writeJson(CONFIG_FILE, stripTenantFields(platformLoad()));
    }
  }
  require('./db').open().prepare('INSERT OR REPLACE INTO tenant_configs(tenant_id, data, updated_at) VALUES (?,?,?)')
    .run(String(tenantId), JSON.stringify(stripSecrets(data)), Date.now());
  return data;
}

function seedChannels(cfg) {
  if (cfg.channels && Array.isArray(cfg.channels.llm)) return;
  const channels = { llm: [], image: [], video: [] };
  if (cfg.llm && cfg.llm.baseUrl && cfg.llm.apiKey) {
    channels.llm.push({
      id: uid('ch-'),
      name: '原语言模型渠道',
      kind: 'llm',
      type: cfg.llm.protocol === 'responses' ? 'openai-responses' : cfg.llm.protocol === 'gemini' ? 'gemini' : 'openai-chat',
      baseUrl: cfg.llm.baseUrl,
      apiKey: cfg.llm.apiKey,
      model: cfg.llm.model || '',
      enabled: false,
      active: false,
      lastTestOk: false,
      lastTestMessage: '原 AutoDL 令牌通常未开通语言模型；请编辑此渠道或新增一个可用渠道',
      options: {},
      createdAt: Date.now(),
    });
  }
  cfg.channels = channels;
}

function load() {
  const tenantId = currentTenant();
  const hit = tenantCache.get(tenantId);
  if (hit) return hit;
  const platform = platformLoad();
  const tenantData = tenantConfigLoad(tenantId);
  const cfg = normalize({ ...platform, ...tenantData, tenantId });
  const withKeys = withSecrets(cfg, tenantId);
  withKeys.tenantId = tenantId;
  tenantCache.set(tenantId, withKeys);
  return withKeys;
}

function normalize(input) {
  const cfg = { ...structuredClone(DEFAULTS), ...(input || {}) };
  delete cfg.cloudHosts;
  cfg.dataDir = DATA;
  cfg.port = Number(cfg.port) || DEFAULTS.port;
  cfg.concurrency = Math.max(1, Math.min(10, Number(cfg.concurrency) || 3));
  cfg.projectRoot = String(cfg.projectRoot || DEFAULTS.projectRoot).trim() || DEFAULTS.projectRoot;
  cfg.saveFolder = String(cfg.saveFolder || DEFAULTS.saveFolder);
  cfg.assetFolder = String(cfg.assetFolder || DEFAULTS.assetFolder);
  cfg.uploadFolder = String(cfg.uploadFolder || DEFAULTS.uploadFolder);
  cfg.voiceLibraryFolder = String(cfg.voiceLibraryFolder || '').trim();
  cfg.autodlKeys = (Array.isArray(cfg.autodlKeys) ? cfg.autodlKeys : [])
    // 有 id 就保留：密钥在加密库里，文件里没有 token 不代表这条 Key 被删了。
    .filter((k) => k && (k.id || k.token))
    .map((k) => ({
      id: k.id || uid('key-'),
      name: String(k.name || 'Key'),
      token: String(k.token || '').trim(),
      enabled: k.enabled !== false,
      lastVerifiedAt: k.lastVerifiedAt || null,
      lastVerifyOk: k.lastVerifyOk ?? null,
      lastVerifyMessage: k.lastVerifyMessage || '',
    }));
  cfg.signup = { open: Boolean(cfg.signup && cfg.signup.open) };
  cfg.llm = { ...DEFAULTS.llm, ...(cfg.llm || {}) };
  cfg.llm.baseUrl = String(cfg.llm.baseUrl || '').trim().replace(/\/+$/, '');
  const channels = { llm: [], image: [], video: [], ...(cfg.channels || {}) };
  for (const kind of ['llm', 'image', 'video']) {
    channels[kind] = (Array.isArray(channels[kind]) ? channels[kind] : [])
      .filter((c) => c && typeof c === 'object')
      .map((c) => ({
        ...c,
        id: c.id || uid('ch-'),
        kind,
        options: { ...(c.options || {}) },
        enabled: c.enabled !== false,
        active: !!c.active,
      }));
  }
  cfg.channels = channels;
  cfg.prompt = { ...DEFAULTS.prompt, ...(cfg.prompt || {}) };
  cfg.ui = { ...DEFAULTS.ui, ...(cfg.ui || {}) };
  return cfg;
}

function save(patch) {
  const tenantId = currentTenant();
  const input = patch || {};
  const tenantPatch = {};
  for (const key of TENANT_KEYS) if (input[key] !== undefined) tenantPatch[key] = input[key];
  const platformPatch = {};
  for (const key of Object.keys(input)) if (!TENANT_KEYS.includes(key)) platformPatch[key] = input[key];

  // 租户配置：渠道、AutoDL Key 元数据、提示词；密钥写当前租户的加密行。
  if (Object.keys(tenantPatch).length) {
    const current = load();
    const next = normalize({ ...current, ...tenantPatch, tenantId });
    persistTenant(tenantId, next);
  }
  // 部署参数：端口、路径、并发、注册开关、主题；只有这些进 config.json。
  if (Object.keys(platformPatch).length) {
    const base = platformLoad();
    const next = normalizePlatform({
      ...base,
      ...platformPatch,
      ui: { ...base.ui, ...(platformPatch.ui || {}) },
    });
    writeJson(CONFIG_FILE, stripTenantFields(next));
    platformCache = next;
    tenantCache.clear(); // 部署参数是所有租户共享的，所有租户缓存都要失效
  } else {
    tenantCache.delete(tenantId);
  }
  return load();
}

function storage() {
  const cfg = load();
  return {
    media: ensureDir(cfg.saveFolder),
    assets: ensureDir(cfg.assetFolder),
    uploads: ensureDir(cfg.uploadFolder),
  };
}

function publicChannel(kind, ch) {
  return {
    id: ch.id,
    name: ch.name,
    kind,
    type: ch.type,
    baseUrl: ch.baseUrl,
    model: ch.model,
    maxTokens: ch.maxTokens || 0,
    contextWindow: ch.contextWindow || 0,
    enabled: ch.enabled !== false,
    active: !!ch.active,
    options: { ...(ch.options || {}) },
    // 只给前端「有没有配、尾号是什么」，完整 Key 不出接口。
    hasKey: !!ch.apiKey,
    masked: ch.apiKey ? ch.apiKey.slice(0, 4) + '…' + ch.apiKey.slice(-4) : '',
    createdAt: ch.createdAt,
    lastTestAt: ch.lastTestAt || null,
    lastTestOk: ch.lastTestOk ?? null,
    lastTestMessage: ch.lastTestMessage || '',
  };
}

function publicView() {
  const cfg = load();
  return {
    port: cfg.port,
    dataDir: DATA,
    concurrency: cfg.concurrency,
    projectRoot: cfg.projectRoot,
    saveFolder: cfg.saveFolder,
    assetFolder: cfg.assetFolder,
    uploadFolder: cfg.uploadFolder,
    voiceLibraryFolder: cfg.voiceLibraryFolder,
    autodlKeys: cfg.autodlKeys.map((k) => ({
      id: k.id,
      name: k.name,
      enabled: k.enabled,
      masked: k.token ? k.token.slice(0, 4) + '…' + k.token.slice(-4) : '',
      lastVerifiedAt: k.lastVerifiedAt,
      lastVerifyOk: k.lastVerifyOk,
      lastVerifyMessage: k.lastVerifyMessage,
    })),
    channels: {
      llm: (cfg.channels.llm || []).map((c) => publicChannel('llm', c)),
      image: (cfg.channels.image || []).map((c) => publicChannel('image', c)),
      video: (cfg.channels.video || []).map((c) => publicChannel('video', c)),
    },
    llm: {
      enabled: !!cfg.llm.enabled,
      protocol: cfg.llm.protocol,
      baseUrl: cfg.llm.baseUrl,
      model: cfg.llm.model,
      hasKey: !!cfg.llm.apiKey,
      masked: cfg.llm.apiKey ? cfg.llm.apiKey.slice(0, 4) + '…' + cfg.llm.apiKey.slice(-4) : '',
      timeoutMs: cfg.llm.timeoutMs,
    },
    prompt: cfg.prompt,
    ui: cfg.ui,
  };
}

function llmConfig() {
  const cfg = load();
  const list = (cfg.channels && cfg.channels.llm) || [];
  const act = list.find((c) => c.active && c.enabled !== false) || list.find((c) => c.enabled !== false);
  if (act) {
    return {
      enabled: true,
      baseUrl: act.baseUrl,
      apiKey: act.apiKey,
      model: act.model,
      protocol: act.type === 'openai-responses' ? 'responses' : act.type === 'gemini' ? 'gemini' : 'chat',
      timeoutMs: cfg.llm.timeoutMs || 180000,
      channelId: act.id,
      channelName: act.name,
      type: act.type,
    };
  }
  if (list.length) return { ...cfg.llm, enabled: false };
  return { ...cfg.llm };
}

function keyById(id) {
  return load().autodlKeys.find((k) => k.id === id) || null;
}

module.exports = {
  ROOT,
  DATA,
  CONFIG_FILE,
  DEFAULTS,
  load,
  save,
  storage,
  publicView,
  llmConfig,
  keyById,
};


