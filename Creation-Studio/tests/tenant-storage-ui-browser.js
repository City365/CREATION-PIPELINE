'use strict';
// 手动运行：npm run test:tenant-storage-browser。普通租户成员看到的存储目录是只读的。
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-tenant-ui-'));
  const data = path.join(dir, 'data');
  const base = 'http://127.0.0.1:18949';
  let child;
  let browser;
  const start = async () => {
    child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      cwd: ROOT, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, WMD_PORT: '18949', WMD_DATA_DIR: data, APPDATA: path.join(dir, 'appdata') },
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
    const adminRes = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ui-admin', password: 'ui-admin-pass' }),
    });
    assert.equal(adminRes.status, 200);
    const adminCookie = (adminRes.headers.get('set-cookie') || '').split(';')[0];
    const call = async (p, method = 'GET', body) => {
      const res = await fetch(base + p, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      return res.json();
    };
    const tenant = (await call('/api/tenants', 'POST', { name: 'ui-tenant' })).data;
    assert.equal((await call('/api/users', 'POST', { username: 'ui-member', password: 'ui-member-pass', tenantId: tenant.id })).ok, true);
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ui-member', password: 'ui-member-pass' }),
    });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
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
    await page.click('#modal-panel [data-tab="storage"]');
    await page.waitForSelector('#project-root');
    for (const id of ['project-root', 'save-folder', 'asset-folder', 'voice-folder', 'concurrency']) {
      assert.equal(await page.locator('#' + id).isDisabled(), true, id + ' 应该只读');
    }
    const text = await page.locator('#modal-panel').innerText();
    assert.match(text, /平台管理员/);
    await page.click('#modal-panel [data-tab="text"]');
    await page.waitForSelector('#modal-panel [data-tab="text"]');
    assert.equal(await page.locator('[data-add-channel="llm"]').count(), 0, '成员不应看到新增渠道按钮');
    assert.match(await page.locator('#modal-panel').innerText(), /负责人\/管理员维护/);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ['platform fields readonly', 'hint shown', 'member channels read-only'] }));
  } finally {
    await browser?.close();
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
