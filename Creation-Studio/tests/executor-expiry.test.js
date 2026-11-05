'use strict';
/**
 * 执行端命令过期：超时后不再下发；管理器执行前也拒绝过期命令。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-exec-'));
process.env.WMD_DATA_DIR = dir;

const channel = require('../src/executor-channel');
const db = require('../src/db');
const { Outbound } = require('../../Video-Generation-Manager/src/outbound');

test('超时命令从队列移除，后续轮询拿不到', async () => {
  const { token } = channel.issue('user-qa');
  assert.equal((await channel.poll(token, { waitMs: 1 })).commands.length, 0, '先让通道上线');
  await assert.rejects(
    channel.request(token, { method: 'GET', path: '/api/health', timeoutMs: 1000 }),
    /没有返回结果/,
  );
  const next = await channel.poll(token, { waitMs: 1 });
  assert.equal(next.commands.length, 0, '过期命令不应再被下发');
});

test('管理器拒绝执行过期命令，不请求本地接口', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => { hits += 1; res.end('{}'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseURL = 'http://127.0.0.1:' + server.address().port;
  const outbound = new Outbound({
    settings: { value: { remote: { enabled: true, studioUrl: 'http://127.0.0.1:1', token: 'qa-token' } } },
    baseURL,
    token: 'qa-token',
    log: () => {},
  });
  await outbound.execute({ id: 'cmd-expired', method: 'GET', path: '/api/health', expiresAt: Date.now() - 10000 });
  assert.equal(hits, 0, '过期命令不能打到本地管理器');
  await new Promise((resolve) => server.close(resolve));
});

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
