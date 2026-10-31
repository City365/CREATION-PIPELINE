// LLM brain: OpenAI/Anthropic compatible chat call, configurable from agent.json or the manager settings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_AGENT_CONFIG = path.join(ROOT, 'agent.json');
const MANAGER_SETTINGS = process.env.DOUBAO_MANAGER_SETTINGS || 'D:\\notebook\\AIGC\\CREATION-PIPELINE\\Video-Generation-Manager\\data\\settings.json';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function loadBrainConfig() {
  const own = readJson(DEFAULT_AGENT_CONFIG);
  if (own && own.baseUrl && own.apiKey && own.model) return Object.assign({ protocol: own.protocol || 'anthropic' }, own, { source: DEFAULT_AGENT_CONFIG });
  const manager = readJson(MANAGER_SETTINGS);
  const it = manager && manager.interpreter;
  if (it && it.baseUrl && it.apiKey && it.model) {
    return {
      protocol: it.protocol === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: it.baseUrl,
      apiKey: it.apiKey,
      model: it.model,
      timeoutMs: Math.max(15000, Number(it.timeoutMs) || 60000),
      maxTokens: 1200,
      source: MANAGER_SETTINGS,
    };
  }
  if (process.env.DOUBAO_BRAIN_BASE_URL && process.env.DOUBAO_BRAIN_API_KEY) {
    return { protocol: 'openai', baseUrl: process.env.DOUBAO_BRAIN_BASE_URL, apiKey: process.env.DOUBAO_BRAIN_API_KEY, model: process.env.DOUBAO_BRAIN_MODEL || 'gpt-4o-mini', timeoutMs: 60000, maxTokens: 1200, source: 'env' };
  }
  throw new Error('没有可用的模型配置：请在 doubao-ctl/agent.json 或管理器设置里配好 Base URL / 模型 / API Key');
}

export async function chat(config, system, messages, options = {}) {
  const timeoutMs = options.timeoutMs || config.timeoutMs || 60000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    if (config.protocol === 'anthropic') {
      const res = await fetch(config.baseUrl.replace(/[\/]+$/, '') + '/v1/messages', {
        method: 'POST',
        signal: ac.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: config.model, max_tokens: config.maxTokens || 1200, system, messages }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('模型接口 HTTP ' + res.status + ': ' + JSON.stringify(data).slice(0, 300));
      const text = (data.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('');
      return { text, usage: data.usage || null };
    }
    const res = await fetch(config.baseUrl.replace(/[\/]+$/, '') + '/chat/completions', {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
      body: JSON.stringify({ model: config.model, max_tokens: config.maxTokens || 1200, messages: [{ role: 'system', content: system }].concat(messages) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('模型接口 HTTP ' + res.status + ': ' + JSON.stringify(data).slice(0, 300));
    const text = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    return { text, usage: data.usage || null };
  } finally {
    clearTimeout(timer);
  }
}

// 从模型输出里抠出第一个 JSON 对象，容忍代码块包裹和前后废话。
export function parseJsonReply(text) {
  const raw = String(text || '').trim();
  const fence = String.fromCharCode(96).repeat(3);
  const fenced = raw.split(fence);
  const body = fenced.length >= 3 ? fenced[1].replace(/^json\s*/i, '') : raw;
  const start = body.indexOf('{');
  if (start < 0) throw new Error('模型没有返回 JSON: ' + raw.slice(0, 200));
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === String.fromCharCode(92)) esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error('模型返回的 JSON 不完整: ' + raw.slice(0, 200));
}
