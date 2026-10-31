'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const value = await fn(); if (value) return value; } catch { /* 继续等 */ }
    await delay(100);
  }
  throw new Error('等待超时');
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

test('豆包提取：账号列表 / 扫描 / 下载 → 用提取结果替换成片', { timeout: 40000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-extract-proxy-'));
  const mediaDir = path.join(dir, 'media', '2026-10-29', 'job-x');
  fs.mkdirSync(mediaDir, { recursive: true });
  const original = path.join(mediaDir, '镜头 05.mp4');
  fs.writeFileSync(original, 'ORIGINAL');
  fs.writeFileSync(path.join(mediaDir, 'params.json'), JSON.stringify({ id: 'job-x', outputs: [{ type: 'video', file: '镜头 05.mp4', bytes: 8 }] }, null, 2));
  fs.writeFileSync(path.join(dir, 'jobs.json'), JSON.stringify({
    version: 1,
    jobs: [{
      id: 'job-x', provider: 'local', workflowId: 'wf', status: 'success', stage: '完成', progress: 100,
      title: '镜头 05', shotLabel: '镜头 05', taskTitle: '首尔没有忘记你', createdAt: 1, finishedAt: 2,
      outputDir: mediaDir, outputs: [{ type: 'video', name: '镜头 05.mp4', path: original, bytes: 8, url: '' }],
    }],
  }, null, 2));

  // 假管理器：只实现这次要用到的三个接口
  const downloaded = path.join(dir, 'doubao-extract.mp4');
  fs.writeFileSync(downloaded, 'DOUBAO-EXTRACTED-VIDEO');
  const seen = {};
  const manager = http.createServer(async (req, res) => {
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.method === 'GET' && req.url === '/api/extract/accounts') {
      return send(200, { accounts: [{ id: 'acc-1', name: '闲鱼5-我的大豆包', group: '主力', enabled: true }, { id: 'acc-2', name: 'Gemini 364', group: '', enabled: true }] });
    }
    if (req.method === 'POST' && req.url === '/api/extract/scan') {
      seen.scan = await readBody(req);
      return send(200, {
        sessionId: 'session-abc',
        account: { id: 'acc-1', name: '闲鱼5-我的大豆包' },
        title: '首尔没有忘记你',
        videos: [
          { key: 'v1', duration: 15, width: 1920, height: 1080, method: 'official-no-watermark', methodLabel: '官方无水印', unwatermarked: true, downloadable: true, poster: '', text: '第5条：抢救室' },
          { key: 'v2', duration: 10, width: 1920, height: 1080, method: 'page-video', methodLabel: '页面播放地址', unwatermarked: false, downloadable: true, poster: '', text: '' },
        ],
        generating: false,
      });
    }
    if (req.method === 'POST' && req.url === '/api/extract/download') {
      seen.download = await readBody(req);
      return send(200, { ok: true, name: path.basename(downloaded), path: downloaded, size: fs.statSync(downloaded).size, duration: 15 });
    }
    return send(404, { error: 'not found' });
  });
  await new Promise((resolve) => manager.listen(0, '127.0.0.1', resolve));
  const managerUrl = 'http://127.0.0.1:' + manager.address().port;

  const base = 'http://127.0.0.1:18983';
  const child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
    env: { ...process.env, WMD_DATA_DIR: dir, WMD_PORT: '18983', WMD_AGENT_AUTOSTART: '0', WMD_MANAGER_URL: managerUrl },
    stdio: 'ignore',
    windowsHide: true,
  });
  const call = async (url, init) => {
    const res = await fetch(base + url, init || {});
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(JSON.stringify(json));
    return json.data;
  };
  const post = (url, body) => call(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  try {
    await until(async () => (await fetch(base + '/api/health')).ok);

    const accounts = await call('/api/extract/accounts');
    assert.equal(accounts.accounts.length, 2);
    assert.equal(accounts.accounts[0].name, '闲鱼5-我的大豆包');
    assert.equal(accounts.accounts[0].group, '主力');

    const scan = await post('/api/extract/scan', { url: 'https://www.doubao.com/chat/38449980185337346', accountId: 'acc-1' });
    assert.deepEqual(seen.scan, { url: 'https://www.doubao.com/chat/38449980185337346', accountId: 'acc-1' });
    assert.equal(scan.sessionId, 'session-abc');
    assert.equal(scan.videos.length, 2);
    assert.equal(scan.videos[0].key, 'v1');
    assert.equal(scan.videos[0].unwatermarked, true);

    const file = await post('/api/extract/download', { sessionId: scan.sessionId, key: 'v1', name: '' });
    assert.deepEqual(seen.download, { sessionId: 'session-abc', key: 'v1', name: '' });
    assert.equal(file.path, downloaded);
    assert.ok(fs.existsSync(file.path));

    // 用提取下来的文件顶替成片
    const replaced = await post('/api/jobs/job-x/output/from-path', { path: original, sourcePath: file.path, name: '镜头 05.mp4', mode: 'replace' });
    assert.equal(replaced.out.name, '镜头 05.mp4');
    assert.equal(fs.readFileSync(original, 'utf8'), 'DOUBAO-EXTRACTED-VIDEO');
    assert.ok(replaced.parked && fs.existsSync(replaced.parked), '旧成片要进 _trash');
    assert.match(replaced.parked.replace(/\\/g, '/'), /\/_trash\/\d{4}-\d{2}-\d{2}\//);

    // 本来没成片时走 add
    const added = await post('/api/jobs/job-x/output/from-path', { sourcePath: file.path, name: '补一条.mp4', mode: 'add' });
    assert.equal(added.out.name, '补一条.mp4');
    assert.ok(fs.existsSync(added.out.path));

    // 源文件不存在要报错
    const badSource = await fetch(base + '/api/jobs/job-x/output/from-path', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: original, sourcePath: path.join(dir, '不存在.mp4') }),
    });
    assert.equal((await badSource.json()).ok, false);

    // 缺少链接要报错
    const noUrl = await fetch(base + '/api/extract/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 'acc-1' }) });
    assert.equal((await noUrl.json()).ok, false);
  } finally {
    child.kill();
    manager.close();
    await delay(150);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ }
  }
});

test('管理器没起来时，提取接口给出明确提示', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-extract-down-'));
  const base = 'http://127.0.0.1:18984';
  const child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
    env: { ...process.env, WMD_DATA_DIR: dir, WMD_PORT: '18984', WMD_AGENT_AUTOSTART: '0', WMD_MANAGER_URL: 'http://127.0.0.1:1' },
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    await until(async () => (await fetch(base + '/api/health')).ok);
    const res = await fetch(base + '/api/extract/accounts');
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.match(json.error, /管理器/);
  } finally {
    child.kill();
    await delay(150);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ }
  }
});
