'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ensureDir, readJson, writeJson, uid } = require('./util');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.H3_DATA_DIR ? path.resolve(process.env.H3_DATA_DIR) : path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA, 'config.json');

const DEFAULTS = {
  port: Number(process.env.H3_PORT || 17821),
  concurrency: 3,
  saveFolder: path.join(DATA, 'media'),
  assetFolder: path.join(DATA, 'assets'),
  uploadFolder: path.join(DATA, 'uploads'),
  voiceLibraryFolder: '',
  autodlKeys: [],
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

let cache = null;

function legacyConfigDir() {
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appdata, 'com.zealman.h3desktop');
}

function importLegacy() {
  const dir = legacyConfigDir();
  const legacy = readJson(path.join(dir, 'config.json'), null);
  if (!legacy) return null;
  const settings = readJson(path.join(dir, 'zealman-ai-settings.json'), {}) || {};
  const keys = [];
  const seen = new Set();
  for (const item of legacy.autodlKeys || []) {
    const token = String(item && (item.token || item.key) || '').trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    keys.push({ id: item.id || uid('key-'), name: item.name || `Key ${keys.length + 1}`, token, enabled: item.enabled !== false });
  }
  const single = String(legacy.autodlToken || settings.autodlApiKey || '').trim();
  if (single && !seen.has(single)) {
    keys.push({ id: uid('key-'), name: 'Key 1', token: single, enabled: true });
  }
  return { keys, saveFolder: legacy.saveFolder, assetFolder: legacy.assetFolder, llmKey: String(settings.autodlApiKey || legacy.autodlToken || '').trim() };
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
  if (cache) return cache;
  ensureDir(DATA);
  let cfg = readJson(CONFIG_FILE, null);
  if (!cfg) {
    cfg = structuredClone(DEFAULTS);
    const legacy = importLegacy();
    if (legacy) {
      cfg.autodlKeys = legacy.keys;
      if (legacy.llmKey) {
        cfg.llm = { ...cfg.llm, enabled: true, apiKey: legacy.llmKey };
      }
      if (legacy.saveFolder && fs.existsSync(legacy.saveFolder)) cfg.saveFolder = legacy.saveFolder;
      if (legacy.assetFolder && fs.existsSync(legacy.assetFolder)) cfg.assetFolder = legacy.assetFolder;
    }
    seedChannels(cfg);
    writeJson(CONFIG_FILE, cfg);
  } else if (!(cfg.channels && typeof cfg.channels === 'object')) {
    seedChannels(cfg);
    writeJson(CONFIG_FILE, cfg);
  }
  cfg = normalize(cfg);
  cache = cfg;
  return cfg;
}

function normalize(input) {
  const cfg = { ...structuredClone(DEFAULTS), ...(input || {}) };
  delete cfg.cloudHosts;
  cfg.dataDir = DATA;
  cfg.port = Number(cfg.port) || DEFAULTS.port;
  cfg.concurrency = Math.max(1, Math.min(8, Number(cfg.concurrency) || 3));
  cfg.saveFolder = String(cfg.saveFolder || DEFAULTS.saveFolder);
  cfg.assetFolder = String(cfg.assetFolder || DEFAULTS.assetFolder);
  cfg.uploadFolder = String(cfg.uploadFolder || DEFAULTS.uploadFolder);
  cfg.voiceLibraryFolder = String(cfg.voiceLibraryFolder || '').trim();
  cfg.autodlKeys = (Array.isArray(cfg.autodlKeys) ? cfg.autodlKeys : [])
    .filter((k) => k && k.token)
    .map((k) => ({
      id: k.id || uid('key-'),
      name: String(k.name || 'Key'),
      token: String(k.token).trim(),
      enabled: k.enabled !== false,
      lastVerifiedAt: k.lastVerifiedAt || null,
      lastVerifyOk: k.lastVerifyOk ?? null,
      lastVerifyMessage: k.lastVerifyMessage || '',
    }));
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
  const current = load();
  const next = normalize({
    ...current,
    ...(patch || {}),
    ui: { ...current.ui, ...(patch?.ui || {}) },
  });
  writeJson(CONFIG_FILE, next);
  cache = next;
  return next;
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
    apiKey: ch.apiKey || '',
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
  importLegacy,
};


