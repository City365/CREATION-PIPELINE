'use strict';
// 代理探测：开着但没启动时要能被识别为不可用，避免打开空白窗口
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { proxyReachable } = require('../src/browser-pool');

test('连不上的代理判为不可用（不抛错）', async () => {
  assert.equal(await proxyReachable('http://127.0.0.1:1'), false);
  assert.equal(await proxyReachable(''), false);
  assert.equal(await proxyReachable('not a url'), false);
});

test('有服务在监听时判为可用', async () => {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  assert.equal(await proxyReachable('http://127.0.0.1:' + port), true);
  assert.equal(await proxyReachable('127.0.0.1:' + port), true, '不带协议头也要认');
  await new Promise((resolve) => server.close(resolve));
});
