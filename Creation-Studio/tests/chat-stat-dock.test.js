'use strict';
// 输入框下方的状态条：活动 · 用量 · 上下文环三段。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');

function load(chats, state) {
  const start = source.indexOf('function askSecs(');
  const end = source.indexOf('// 每轮用量：');
  assert.ok(start > 0 && end > start, '在 app.js 里找不到统计条相关函数');
  const box = {};
  new Function('module', 'exports', `
const __chats = ${JSON.stringify(chats)};
const __state = ${JSON.stringify(state)};
function askState() { return __state; }
function askActive() { return __chats; }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function askContextMeterHtml() { return '<span class="ask-ctx">ring</span>'; }
function askFmtTokens(v) { const n = Math.max(0, Math.round(Number(v) || 0)); return n >= 1000000 ? (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'm' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n); }
${source.slice(start, end)}
module.exports = { askSessionStats, askStatDockHtml, askFmtTokens, askSecs };
`)(box, box.exports);
  return box.exports;
}

const STATE = { models: [{ id: 'm', context_tokens: 100000 }], modelId: 'm', draft: '' };

const turn = (stats, usage) => ({
  role: 'assistant', text: '答',
  execution: { turn: { stats }, usage },
});

test('三段：活动 / 用量 / 上下文环', () => {
  const api = load({ messages: [turn({ model_calls: 3, tps: 88.5 }, { input_tokens: 12000, output_tokens: 800 })] }, STATE);
  const html = api.askStatDockHtml();
  assert.match(html, /ask-stat-group/);
  assert.equal((html.match(/ask-stat-sep/g) || []).length, 2, '两个分隔线分成三段');
  assert.match(html, /ask-ctx/, '上下文环并进同一条');
});

test('活动段显示轮次、步数、速率', () => {
  // 会话级速率是加权算的：总解码 token / 总解码时长，不直接读单轮的 tps
  const api = load({ messages: [turn({ model_calls: 3, decode_ms: 1000, decode_tokens: 88.5 },
    { input_tokens: 100, output_tokens: 10 })] }, STATE);
  const html = api.askStatDockHtml();
  assert.match(html, /1 轮/);
  assert.match(html, /3 步/);
  assert.match(html, /88\.5 token\/s/, '单位写全，不缩成 tok/s');
});

test('用量段显示累计 token 总量，不缩成 k', () => {
  const api = load({ messages: [turn({ model_calls: 1 }, { input_tokens: 12000, output_tokens: 800 })] }, STATE);
  const html = api.askStatDockHtml();
  assert.match(html, /12,800 token/, '位置够，直接给全量数字');
  assert.doesNotMatch(html, /\d+k (tok|token)/, '不再出现 k 缩写');
});

test('有完整缓存上报才显示命中率', () => {
  const api = load({ messages: [turn({ model_calls: 2 }, {
    input_tokens: 12000, output_tokens: 800, cache_read_tokens: 11000, cache_hit_rate: 91.7,
  })] }, STATE);
  assert.match(api.askStatDockHtml(), /缓存命中 91\.7%/);
});

test('渠道没报缓存就不显示那一项，不凑百分比', () => {
  const api = load({ messages: [turn({ model_calls: 2 }, { input_tokens: 12000, output_tokens: 800 })] }, STATE);
  const html = api.askStatDockHtml();
  assert.doesNotMatch(html, /缓存命中/);
  assert.doesNotMatch(html, /0%/, '没有数据不能显示成 0%');
});

test('多轮缓存按 input 加权平均，不是简单平均', () => {
  const api = load({ messages: [] }, STATE);
  const stats = api.askSessionStats({ messages: [
    turn({ model_calls: 1 }, { input_tokens: 1000, output_tokens: 10, cache_read_tokens: 1000, cache_hit_rate: 100 }),
    turn({ model_calls: 1 }, { input_tokens: 9000, output_tokens: 10, cache_read_tokens: 0, cache_hit_rate: 0 }),
  ] });
  // 1000/10000 = 10%，不是 (100+0)/2 = 50%
  assert.equal(stats.cacheRate, 10);
});

test('没有数据不凑数：没轮次整条不渲染', () => {
  const api = load({ messages: [] }, STATE);
  assert.equal(api.askStatDockHtml(), '');
});

// 圆环后只看比例：10k/1m 这种绝对量移到 title 里，正文不再挤数字。
test('上下文环后面跟百分比，不跟 k / m 的绝对量', () => {
  const start = source.indexOf('function askContextMeterHtml(');
  const end = source.indexOf('// 就地刷新圆圈');
  assert.ok(start > 0 && end > start, '找不到上下文环渲染');
  const box = {};
  new Function('module', 'exports', `
const ASK_CTX_R = 5.5;
const ASK_CTX_C = 34.56;
const esc = (v) => String(v == null ? '' : v);
function askContextStats() { return { used: 10400, total: 1000000, ratio: 0.0104, exact: true }; }
function askCtxTone() { return ''; }
function askFullTokens(v) { return Math.max(0, Math.round(Number(v) || 0)).toLocaleString('en-US'); }
function askPct(r) { return (Math.max(0, Math.min(1, Number(r) || 0)) * 100).toFixed(1).replace(/\\.0$/, '') + '%'; }
${source.slice(start, end)}
module.exports = { askContextMeterHtml };
`)(box, box.exports);
  const html = box.exports.askContextMeterHtml();
  assert.match(html, /<span class="ask-ctx-text">1%<\/span>/, '圆环后就是比例');
  assert.doesNotMatch(html, /<span class="ask-ctx-text">[^<]*[km]/, '正文不再出现 10k / 1m');
  assert.match(html, /10,400 \/ 1,000,000 token/, '绝对量留在 title 里，还是全量数字');
});

test('只有一轮没缓存时，另一轮有缓存也算 —— 缺的那轮不进分母', () => {
  const api = load({
    messages: [
      turn({ model_calls: 1 }, { input_tokens: 1000, output_tokens: 10, cache_read_tokens: 800, cache_hit_rate: 80 }),
      turn({ model_calls: 1 }, { input_tokens: 5000, output_tokens: 10 }),
    ],
  }, STATE);
  const stats = api.askSessionStats({
    messages: [
      turn({ model_calls: 1 }, { input_tokens: 1000, output_tokens: 10, cache_read_tokens: 800, cache_hit_rate: 80 }),
      turn({ model_calls: 1 }, { input_tokens: 5000, output_tokens: 10 }),
    ],
  });
  assert.equal(stats.cacheRate, 80, '800/1000，那 5000 没有缓存明细不参与');
  assert.equal(stats.cacheTurns, 1);
});
