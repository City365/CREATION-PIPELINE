'use strict';
const config = require('./config');
const { uid } = require('./util');

/**
 * Channel types shown in the "新增渠道" dialog.
 * `fields` is declarative so the UI can render the form without hardcoding.
 */
const TYPES = {
  llm: [
    {
      id: 'openai-chat',
      label: 'OpenAI Chat Completions',
      hint: '绝大多数中转站 / 本地代理都兼容：POST {base}/chat/completions',
      fields: [
        { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com/v1', required: true },
        { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-…' },
        { key: 'model', label: '模型 ID', placeholder: 'gpt-4.1-mini', required: true },
      ],
    },
    {
      id: 'openai-responses',
      label: 'OpenAI Responses',
      hint: 'POST {base}/responses，部分新网关只开这个接口',
      fields: [
        { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com/v1', required: true },
        { key: 'apiKey', label: 'API Key', type: 'password' },
        { key: 'model', label: '模型 ID', placeholder: 'gpt-5.6-luna', required: true },
      ],
    },
    {
      id: 'gemini',
      label: 'Gemini generateContent',
      hint: 'POST {base}/models/{model}:generateContent，用 x-goog-api-key',
      fields: [
        { key: 'baseUrl', label: 'Base URL', placeholder: 'https://generativelanguage.googleapis.com/v1beta', required: true },
        { key: 'apiKey', label: 'API Key', type: 'password' },
        { key: 'model', label: '模型 ID', placeholder: 'gemini-3.1-pro', required: true },
      ],
    },
  ],
  image: [
    {
      id: 'openai-images',
      label: 'OpenAI Images（推荐）',
      hint: 'POST /images/generations，参考图走 /images/edits（multipart）',
      fields: [
        { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com/v1', required: true },
        { key: 'apiKey', label: 'API Key', type: 'password' },
        { key: 'model', label: '模型 ID', placeholder: 'gpt-image-1 / flux-1.1', required: true },
        { key: 'size', label: '默认尺寸', placeholder: '1024x1024', options: ['auto', '1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792'] },
        { key: 'quality', label: '质量', placeholder: 'auto', options: ['auto', 'low', 'medium', 'high'] },
        { key: 'extraJson', label: '附加参数（JSON，可选）', type: 'textarea', placeholder: '{"background":"transparent","moderation":"low"}' },
      ],
    },
    {
      id: 'gemini-image',
      label: 'Gemini 生图（generateContent）',
      hint: 'POST {base}/models/{model}:generateContent，返回 inlineData',
      fields: [
        { key: 'baseUrl', label: 'Base URL', placeholder: 'https://generativelanguage.googleapis.com/v1beta', required: true },
        { key: 'apiKey', label: 'API Key', type: 'password' },
        { key: 'model', label: '模型 ID', placeholder: 'gemini-3.1-flash-image', required: true },
        { key: 'imageSize', label: '图片尺寸', placeholder: '1K', options: ['512px', '1K', '2K', '4K'] },
      ],
    },
    {
      id: 'chat-image',
      label: 'Chat Completions 生图',
      hint: '部分聚合站把生图塞进 chat/completions，返回 markdown 或 image_url',
      fields: [
        { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com/v1', required: true },
        { key: 'apiKey', label: 'API Key', type: 'password' },
        { key: 'model', label: '模型 ID', placeholder: 'gpt-image-2.5-sunburst', required: true },
        { key: 'extraJson', label: '附加参数（JSON，可选）', type: 'textarea', placeholder: '{"size":"1024x1024","quality":"high"}' },
      ],
    },
  ],
  video: require('./video-plugins').types(),
};

const LABEL = { llm: '语言模型', image: '图像', video: '视频' };

function typeMeta(kind, type) {
  return (TYPES[kind] || []).find((t) => t.id === type) || null;
}

function defaultsFor(kind, type) {
  const meta = typeMeta(kind, type);
  const out = {};
  for (const f of meta ? meta.fields : []) {
    if (f.default !== undefined) out[f.key] = f.default;
    else out[f.key] = '';
  }
  return out;
}

function normalizeChannel(kind, raw) {
  const type = String(raw.type || (TYPES[kind][0] && TYPES[kind][0].id) || '');
  const options = { ...(raw.options || {}) };
  const channel = {
    id: raw.id || uid('ch-'),
    name: String(raw.name || '').trim() || type,
    kind,
    type,
    enabled: raw.enabled !== false,
    active: !!raw.active,
    createdAt: raw.createdAt || Date.now(),
    lastTestAt: raw.lastTestAt || null,
    lastTestOk: raw.lastTestOk ?? null,
    lastTestMessage: String(raw.lastTestMessage || ''),
  };
  for (const field of ['baseUrl', 'apiKey', 'model']) {
    channel[field] = String(raw[field] || '').trim();
  }
  // 模型限制：最大输出 token / 最大上下文（0 = 不限制，交给上游默认）
  const maxTokens = Number(raw.maxTokens);
  const contextWindow = Number(raw.contextWindow);
  channel.maxTokens = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.min(200000, Math.round(maxTokens)) : 0;
  channel.contextWindow = Number.isFinite(contextWindow) && contextWindow > 0 ? Math.min(4000000, Math.round(contextWindow)) : 0;
  channel.options = options;
  return channel;
}

function ensureChannels(cfg) {
  if (cfg.channels && typeof cfg.channels === 'object') {
    cfg.channels.llm = Array.isArray(cfg.channels.llm) ? cfg.channels.llm : [];
    cfg.channels.image = Array.isArray(cfg.channels.image) ? cfg.channels.image : [];
    cfg.channels.video = Array.isArray(cfg.channels.video) ? cfg.channels.video : [];
    return cfg;
  }
  const channels = { llm: [], image: [], video: [] };
  const legacy = cfg.llm || {};
  if (legacy.baseUrl && legacy.apiKey) {
    channels.llm.push(normalizeChannel('llm', {
      name: legacy.model || '原语言模型渠道',
      type: legacy.protocol === 'responses' ? 'openai-responses' : 'openai-chat',
      baseUrl: legacy.baseUrl,
      apiKey: legacy.apiKey,
      model: legacy.model,
      enabled: true,
      active: true,
    }));
  }
  cfg.channels = channels;
  return cfg;
}

function cleanChannel(channel) {
  return normalizeChannel(channel.kind, channel);
}

function list(kind, { includeSecrets = false } = {}) {
  const cfg = config.load();
  ensureChannels(cfg);
  return (cfg.channels[kind] || []).map((ch) => {
    const copy = { ...ch, options: { ...(ch.options || {}) } };
    if (!includeSecrets) {
      copy.hasKey = !!copy.apiKey;
      copy.masked = copy.apiKey ? copy.apiKey.slice(0, 4) + '…' + copy.apiKey.slice(-4) : '';
      delete copy.apiKey;
    }
    return copy;
  });
}

function get(kind, id, { includeSecrets = true } = {}) {
  const cfg = config.load();
  ensureChannels(cfg);
  const hit = (cfg.channels[kind] || []).find((c) => c.id === id);
  if (!hit) return null;
  if (includeSecrets) return { ...hit, options: { ...(hit.options || {}) } };
  return list(kind).find((c) => c.id === id) || null;
}

function active(kind) {
  const cfg = config.load();
  ensureChannels(cfg);
  const all = (cfg.channels[kind] || []).filter((c) => c.enabled !== false);
  return all.find((c) => c.active) || all[0] || null;
}

function publicTypes() {
  return TYPES;
}

function saveChannels(kind, channels) {
  const cfg = config.load();
  ensureChannels(cfg);
  cfg.channels[kind] = channels;
  const patch = { channels: cfg.channels };
  // Keep the legacy llm object in sync so old code paths keep working.
  if (kind === 'llm') {
    const act = channels.find((c) => c.active) || channels.find((c) => c.enabled !== false);
    patch.llm = act
      ? {
        enabled: true,
        baseUrl: act.baseUrl,
        apiKey: act.apiKey,
        model: act.model,
        protocol: act.type === 'openai-responses' ? 'responses' : act.type === 'gemini' ? 'gemini' : 'chat',
        timeoutMs: (cfg.llm && cfg.llm.timeoutMs) || 180000,
      }
      : { ...(cfg.llm || {}), enabled: false };
  }
  return config.save(patch);
}

function create(kind, input) {
  const cfg = config.load();
  ensureChannels(cfg);
  const channel = normalizeChannel(kind, { ...defaultsFor(kind, input.type), ...input, id: undefined, kind });
  if (!channel.name || channel.name === channel.type) {
    channel.name = `${LABEL[kind]}渠道 ${(cfg.channels[kind] || []).length + 1}`;
  }
  if (!channel.baseUrl) throw new Error('请填写 Base URL');
  if (kind !== 'video' && !channel.model) throw new Error('请填写模型 ID');
  channel.enabled = true;
  const current = cfg.channels[kind] || [];
  const hasActive = current.some((c) => c.active && c.enabled !== false);
  channel.enabled = true;
  channel.active = input.active === true || (!hasActive && (current.length === 0 || input.active !== false));
  if (channel.active) for (const c of current) c.active = false;
  const next = [...current, channel];
  saveChannels(kind, next);
  return get(kind, channel.id);
}

function update(kind, id, patch) {
  const cfg = config.load();
  ensureChannels(cfg);
  const current = cfg.channels[kind] || [];
  const index = current.findIndex((c) => c.id === id);
  if (index < 0) throw new Error('渠道不存在');
  const merged = { ...current[index], ...patch, id, kind };
  if (patch.options) merged.options = { ...(current[index].options || {}), ...patch.options };
  // Empty key means "keep the existing key" (UI never sees the secret).
  if (!String(patch.apiKey || '').trim()) merged.apiKey = current[index].apiKey;
  // 停用就顺带取消默认，启用时可以再设为默认
  if (patch.enabled === false) merged.active = false;
  if (patch.active === true) for (const c of current) c.active = false;
  const next = current.slice();
  next[index] = normalizeChannel(kind, merged);
  saveChannels(kind, next);
  return get(kind, id);
}

function remove(kind, id) {
  const cfg = config.load();
  ensureChannels(cfg);
  const current = cfg.channels[kind] || [];
  const target = current.find((c) => c.id === id);
  if (!target) throw new Error('渠道不存在');
  const next = current.filter((c) => c.id !== id);
  if (target.active && next.length) next[0].active = true;
  saveChannels(kind, next);
  return true;
}

function activate(kind, id) {
  const cfg = config.load();
  ensureChannels(cfg);
  const current = cfg.channels[kind] || [];
  if (!current.some((c) => c.id === id)) throw new Error('渠道不存在');
  for (const c of current) c.active = c.id === id;
  saveChannels(kind, current);
  return get(kind, id);
}

function setTestResult(kind, id, ok, message) {
  const cfg = config.load();
  ensureChannels(cfg);
  const current = cfg.channels[kind] || [];
  const hit = current.find((c) => c.id === id);
  if (!hit) return;
  hit.lastTestAt = Date.now();
  hit.lastTestOk = !!ok;
  hit.lastTestMessage = String(message || '').slice(0, 300);
  saveChannels(kind, current);
}

module.exports = {
  TYPES,
  LABEL,
  typeMeta,
  defaultsFor,
  publicTypes,
  list,
  get,
  active,
  create,
  update,
  remove,
  activate,
  setTestResult,
};
