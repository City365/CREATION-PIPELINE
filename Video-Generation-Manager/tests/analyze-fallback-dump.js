'use strict';
// 离线分析 live probe 抓到的响应原文：fallback_api 出现在哪里、属于哪个消息、主机是否在允许列表。
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'evidence', 'live-probe');
const { collectFallbacks, parseJSON, unwatermarkedRequest } = require('../src/adapters/doubao-fallback');

function parseMaybe(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[[{]/.test(text)) return null;
  try { return parseJSON(text); } catch { return null; }
}

function walk(value, owner, trail, out, depth = 0) {
  if (value == null) return;
  if (typeof value === 'string') {
    const parsed = parseMaybe(value);
    if (parsed) walk(parsed, owner, trail + ' (string)', out, depth + 1);
    return;
  }
  if (typeof value !== 'object' || depth > 24) return;
  const own = String(value.message_id_str || value.messageIdStr || value.message_id || value.messageId || owner);
  if (typeof value.fallback_api === 'string') {
    out.push({ messageId: own, ownerChanged: own !== owner, trail, url: value.fallback_api, keys: Object.keys(value).slice(0, 12) });
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'fallback_api') continue;
    walk(child, own, trail + '.' + key, out, depth + 1);
  }
}

for (const file of fs.readdirSync(dir).filter(f => /^response-\d+\.json$/.test(f)).sort()) {
  const full = path.join(dir, file);
  const text = fs.readFileSync(full, 'utf8');
  const out = [];
  let parsedRaw = null;
  try { parsedRaw = parseJSON(text); } catch (error) { console.log(file + ' 顶层解析失败：' + error.message); }
  if (parsedRaw) walk(parsedRaw, '', '$', out);
  else walk(text, '', '$', out);
  console.log('\n=== ' + file + ' ===');
  console.log('fallback_api 文本出现次数：' + (text.match(/fallback_api/g) || []).length + '，结构化命中：' + out.length);
  const byMessage = new Map();
  for (const item of out) {
    const key = item.messageId || '(无消息ID)';
    if (!byMessage.has(key)) byMessage.set(key, []);
    byMessage.get(key).push(item);
  }
  for (const [messageId, items] of byMessage) {
    console.log('-- 消息 ' + messageId + '，' + items.length + ' 条');
    for (const item of items.slice(0, 3)) {
      let host = '';
      try { host = new URL(item.url).hostname; } catch { host = '(非法URL)'; }
      let allowed = 'n/a';
      try { unwatermarkedRequest(item.url); allowed = '允许'; } catch (error) { allowed = '拒绝: ' + error.message; }
      console.log('   host=' + host + ' | ' + allowed);
      console.log('   url=' + item.url.slice(0, 300));
      console.log('   trail=' + item.trail.slice(-160) + ' | keys=' + item.keys.join(','));
    }
  }
  const mod = collectFallbacks(parsedRaw || text);
  console.log('collectFallbacks 结果：' + mod.length + ' 条' + (mod.length ? ' -> ' + JSON.stringify(mod.slice(0, 3)).slice(0, 400) : ''));
}
