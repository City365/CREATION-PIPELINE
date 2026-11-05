'use strict';
// 手动运行：npm run test:quota-cross-browser。平台管理员可在设置页切换租户并保存配额。
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
  const base = 'http://127.0.0.1:18954';
  let child;
  let browser;
  const start = async () => {
    child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      cwd: ROOT, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, WMD_PORT: '18954', WMD_DATA_DIR: data, APPDATA: path.join(dir, 'appdata') },
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
      body: JSON.stringify({ username: 'quota-ui', password: 'quota-ui-pass' }),
    });
    const cookie = (reg.headers.get('set-cookie') || '').split(';')[0];
    const created = await fetch(base + '/api/tenants', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: '跨租户配额' }),
    }).then((res) => res.json());
    const tenantId = created.data.id;

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
    await page.waitForSelector('#quota-tenant');
    await until(async () => (await page.locator('#quota-tenant option').count()) >= 2);
    await page.selectOption('#quota-tenant', tenantId);
    await until(async () => (await page.locator('#team-quota').innerText()).includes('用户 0/'));
    await page.fill('#quota-users', '5');
    await page.click('#quota-save');
    await until(async () => (await page.locator('#team-quota').innerText()).includes('用户 0/5'));

    const check = await fetch(base + '/api/tenants/' + encodeURIComponent(tenantId) + '/quota', { headers: { Cookie: cookie } }).then((res) => res.json());
    assert.equal(check.data.quota.maxUsers, 5);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ['tenant switch', 'cross-tenant quota saved'] }));
  } finally {
    await browser?.close();
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
