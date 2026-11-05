'use strict';
// 智能体代理：中文技能 ID（dir:名称）必须重新编码，否则 Node 会拒绝未转义路径
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
const start = source.indexOf('function proxyAgent');
const end = source.indexOf('async function handle', start);
assert.ok(start > 0 && end > start, '在 server.js 里找不到 proxyAgent');

const fn = source.slice(start, end);

test('代理转发前按路径段重新编码', () => {
  assert.ok(fn.includes(".replace(/^\\/api\\/agent/, '/agent')"), '要替换代理前缀');
  assert.ok(fn.includes(".split('/')"), '要按段处理');
  assert.ok(fn.includes('encodeURIComponent(segment)'), '每段要重新编码，中文 ID 才能转发');
});

test('中文技能 ID 编码结果可以直接作为上游路径', () => {
  const encode = (pathname) => pathname.replace(/^\/api\/agent/, '/agent')
    .split('/').map((segment) => segment ? encodeURIComponent(segment) : segment).join('/');
  const upstream = encode('/api/agent/plugins/dir:6-分镜提示词转批量任务格式');
  assert.equal(upstream, '/agent/plugins/dir%3A6-%E5%88%86%E9%95%9C%E6%8F%90%E7%A4%BA%E8%AF%8D%E8%BD%AC%E6%89%B9%E9%87%8F%E4%BB%BB%E5%8A%A1%E6%A0%BC%E5%BC%8F');
  assert.doesNotMatch(upstream, /[^\x20-\x7e]/);
});
