'use strict';
// 手动运行：npm run test:user-prefs-browser。两个账号各自保存主题，互不影响。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');

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

async function register(base, username, password) {
  const res = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return cookie;
}

async function login(base, username, password) {
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

async function pageWith(context, base, cookie) {
  await context.addCookies([{ name: 'wmd_session', value: decodeURIComponent(cookie.slice('wmd_session='.length)), domain: '127.0.0.1', path: '/' }]);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(base + '/#image');
  await page.waitForSelector('#settings-btn', { state: 'visible' });
  return page;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-prefs-ui-'));
  const data = path.join(dir, 'data');
  const base = 'http://127.0.0.1:18952';
  let child;
  let browser;
  const start = async () => {
    child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      cwd: ROOT, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, WMD_PORT: '18952', WMD_DATA_DIR: data, APPDATA: path.join(dir, 'appdata') },
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
    const cookieA = await register(base, 'prefs-a', 'prefs-pass-a');
    const res = await fetch(base + '/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ username: 'prefs-b', password: 'prefs-pass-b' }),
    });
    assert.equal(res.status, 200);
    const cookieB = await login(base, 'prefs-b', 'prefs-pass-b');

    browser = await chromium.launch({ executablePath: findChrome(), headless: true });
    const contextA = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const pageA = await pageWith(contextA, base, cookieA);
    await pageA.evaluate(async () => {
      await fetch('/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ui: { theme: 'studio-mint' } }),
      });
    });
    await pageA.reload();
    await pageA.waitForSelector('#settings-btn', { state: 'visible' });
    await until(async () => (await pageA.evaluate(() => document.documentElement.dataset.theme)) === 'studio-mint');

    const contextB = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const pageB = await pageWith(contextB, base, cookieB);
    assert.notEqual(await pageB.evaluate(() => document.documentElement.dataset.theme), 'studio-mint');

    await pageA.reload();
    await pageA.waitForSelector('#settings-btn', { state: 'visible' });
    await until(async () => (await pageA.evaluate(() => document.documentElement.dataset.theme)) === 'studio-mint');
    console.log(JSON.stringify({ passed: true, checks: ['user A theme persisted', 'user B unaffected'] }));
  } finally {
    await browser?.close();
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
