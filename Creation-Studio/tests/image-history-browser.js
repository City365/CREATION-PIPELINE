'use strict';
// 手动运行：npm run test:image-history-browser。登录后打开「最近生成」，断言历史条目可见。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const managerRequire = createRequire(path.join(ROOT, '../Video-Generation-Manager/package.json'));
const { chromium } = managerRequire('playwright-core');
const { findChrome } = managerRequire('./src/browser-pool');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (await fn()) return; } catch { /* 继续等 */ }
    await sleep(100);
  }
  throw new Error('浏览器验收超时');
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-history-ui-'));
  const data = path.join(dir, 'data');
  const base = 'http://127.0.0.1:18951';
  let child;
  let browser;
  const start = async () => {
    child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      cwd: ROOT, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, WMD_PORT: '18951', WMD_DATA_DIR: data, APPDATA: path.join(dir, 'appdata') },
    });
    await until(async () => (await fetch(base + '/api/health')).ok);
  };
  const stop = async () => {
    if (!child) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill();
    await exited;
    child = null;
  };
  try {
    await start();
    const reg = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'history-ui', password: 'history-pass' }),
    });
    const cookie = (reg.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('wmd_session='));

    const conn = new DatabaseSync(path.join(data, 'wmd.sqlite'));
    conn.exec('PRAGMA busy_timeout = 5000');
    conn.prepare(`INSERT INTO image_history(id, tenant_id, project_id, created_at, payload) VALUES (?,?,?,?,?)`)
      .run('hist-ui-1', 'tnt_default', '', Date.now(), JSON.stringify({
        id: 'hist-ui-1', prompt: '浏览器历史条目', kind: 'generate', createdAt: Date.now(),
        items: [{ url: '/skins/anime-sea.png' }],
      }));
    conn.close();

    browser = await chromium.launch({ executablePath: findChrome(), headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.addCookies([{ name: 'wmd_session', value: decodeURIComponent(cookie.slice('wmd_session='.length)), domain: '127.0.0.1', path: '/' }]);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/#image');
    await page.waitForSelector('#settings-btn', { state: 'visible' });
    await until(async () => await page.evaluate(() => Array.isArray(state.imageHistory) && state.imageHistory.length > 0));
    await page.evaluate(() => openImageHistory());
    await page.waitForSelector('#modal-panel');
    await until(async () => (await page.locator('#modal-panel').innerText()).includes('最近生成'));
    assert.match(await page.locator('#modal-panel').innerText(), /浏览器历史条目/);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ['history modal', 'history item visible', 'no page errors'] }));
  } finally {
    await browser?.close();
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
