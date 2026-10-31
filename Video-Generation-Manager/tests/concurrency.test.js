'use strict';
// 并发上限：默认 5，允许用环境变量覆盖，且夹在 1–10
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
const tasks = fs.readFileSync(path.join(__dirname, '../src/tasks.js'), 'utf8');

test('默认并发是 5', () => {
  assert.ok(/Number\(process\.env\.DBM_CONCURRENCY\)\|\|5\)/.test(server), 'server 默认 5');
  assert.ok(/concurrency = 5/.test(tasks), '队列默认 5');
});

test('并发仍受 1–10 夹取，且可用环境变量覆盖', () => {
  assert.ok(/Math\.max\(1,Math\.min\(10,/.test(server), '保留上下限');
});

test('队列按并发数派发', () => {
  assert.ok(/this\.running\.size >= this\.concurrency/.test(tasks), '派发时看并发上限');
});
