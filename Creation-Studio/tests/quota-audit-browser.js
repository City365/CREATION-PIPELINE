'use strict';
// 手动运行：npm run test:quota-audit-browser。管理员在设置页看到配额并可保存，审计页有记录。
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

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-quota-ui-'));
  const data = path.join(dir, 'data');
  const base = 'http://127.0.0.1:18950';
  let child;
  let browser;
  const start = async () => {
    child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      cwd: ROOT, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, WMD_PORT: '18950', WMD_DATA_DIR: data, APPDATA: path.join(dir, 'appdata') },
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
      body: JSON.stringify({ username: 'ui-admin', password: 'ui-admin-pass' }),
    });
    const cookie = (reg.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('wmd_session='));

    browser = await chromium.launch({ executablePath: findChrome(), headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.addCookies([{ name: 'wmd_session', value: decodeURIComponent(cookie.slice('wmd_session='.length)), domain: '127.0.0.1', path: '/' }]);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/#image');
    await page.waitForSelector('#settings-btn', { state: 'visible' });
    await page.click('#settings-btn');
    await page.waitForSelector('#modal-panel');
    await page.click('#modal-panel [data-tab="team"]');
    await page.waitForSelector('#team-quota');
    await until(async () => (await page.locator('#team-quota').innerText()).includes('用户 1/'));
    assert.match(await page.locator('#team-quota').innerText(), /用户 1\/不限/);

    await page.fill('#quota-users', '3');
    await page.click('#quota-save');
    await until(async () => (await page.locator('#team-quota').innerText()).includes('用户 1/3'));

    await page.click('#modal-panel [data-tab="audit"]');
    await page.waitForSelector('#audit-list');
    await until(async () => (await page.locator('#audit-list').innerText()).includes('auth.register'));
    assert.match(await page.locator('#audit-list').innerText(), /auth\.(login|register)/);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ['quota shown', 'quota saved', 'audit visible', 'no page errors'] }));
  } finally {
    await browser?.close();
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
