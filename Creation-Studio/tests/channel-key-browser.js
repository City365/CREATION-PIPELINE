'use strict';
// 手动运行：npm run test:channel-key-browser。真实浏览器验证设置页只显示脱敏 Key。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const managerRequire = createRequire(path.join(ROOT, '../Video-Generation-Manager/package.json'));
const { chromium } = managerRequire('playwright-core');
const { findChrome } = managerRequire('./src/browser-pool');

const KEY = 'sk-browser-secret-abcdef';
const MASKED = KEY.slice(0, 4) + '…' + KEY.slice(-4);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-key-browser-'));
  const data = path.join(dir, 'data');
  const base = 'http://127.0.0.1:18948';
  let child;
  let browser;
  const errors = [];
  const start = async () => {
    child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      cwd: ROOT, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, WMD_PORT: '18948', WMD_DATA_DIR: data, APPDATA: path.join(dir, 'appdata') },
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
      body: JSON.stringify({ username: 'browser-key', password: 'browser-key' }),
    });
    assert.equal(reg.status, 200);
    const cookie = (reg.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('wmd_session='));
    const created = await fetch(base + '/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ kind: 'llm', type: 'openai-chat', name: 'browser-channel', baseUrl: 'http://127.0.0.1:1', model: 'browser-model', apiKey: KEY }),
    });
    assert.equal(created.status, 200, await created.text());

    browser = await chromium.launch({ executablePath: findChrome(), headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await context.addCookies([{ name: 'wmd_session', value: decodeURIComponent(cookie.slice('wmd_session='.length)), domain: '127.0.0.1', path: '/' }]);
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/#image');
    await page.waitForSelector('#settings-btn');
    await page.click('#settings-btn');
    await page.waitForSelector('#modal-panel .key-plain');

    assert.equal((await page.locator('#modal-panel .key-plain').first().innerText()).trim(), MASKED, '设置页只应显示脱敏 Key');
    const bodyText = await page.locator('body').innerText();
    assert.equal(bodyText.includes(KEY), false, '页面 DOM 不应出现完整 Key');

    await page.click('#modal-panel [data-edit-channel]');
    await page.waitForSelector('#ch-save');
    const keyInput = page.locator('[data-ch-key="apiKey"]');
    assert.equal(await keyInput.inputValue(), '', '编辑时密钥输入框应为空');
    assert.match(await keyInput.getAttribute('placeholder'), /已配置：sk-b…/, '占位符应提示已配置的尾号');
    await page.click('#ch-save');
    await page.waitForSelector('#modal-panel .key-plain');
    assert.equal((await page.locator('#modal-panel .key-plain').first().innerText()).trim(), MASKED, '留空保存后 Key 不应被清掉');

    const cfg = JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'));
    assert.equal(JSON.stringify(cfg).includes(KEY), false, 'config.json 不应再保存明文 Key');
    const list = await (await fetch(base + '/api/channels', { headers: { Cookie: cookie } })).json();
    const saved = (list.data.llm || []).find((c) => c.name === 'browser-channel');
    assert.equal(saved && saved.hasKey, true, '留空保存后服务端仍应能解密出 Key');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ['masked in settings', 'no full key in DOM', 'empty edit field', 'kept after blank save'] }));
  } finally {
    await browser?.close();
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
