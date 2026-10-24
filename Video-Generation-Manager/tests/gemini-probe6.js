'use strict';
// 探针 V6：打开 Create video 后出现的弹层是什么，怎么关。
const fs = require('node:fs');
const path = require('node:path');
const { BrowserPool } = require('../src/browser-pool');
const { Store } = require('../src/store');
const ACCOUNT_ID = process.argv[2] || '539b6180-4332-4f25-b892-88bca4f4814f';
const evidence = path.resolve(__dirname, '../evidence');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const store = new Store(path.resolve(__dirname, '../data'));
  const account = store.get(ACCOUNT_ID);
  const pool = new BrowserPool({ store });
  const report = {};
  try {
    const page = await pool.taskPage(account);
    await wait(3500);
    await page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"]').first().click({ force: true });
    await wait(500);
    await page.locator('[aria-label="Upload & tools"]').first().click();
    await wait(800);
    const createVideo = page.locator('[role="menuitemcheckbox"]:has-text("Create video")').first();
    if (await createVideo.count()) { await createVideo.click(); await wait(2000); }
    report.overlays = await page.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1500), buttons: [...e.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || (b.innerText || '').trim().slice(0, 40)).filter(Boolean) })));
    await page.screenshot({ path: path.join(evidence, 'gemini-v6-after-enable.png') });
    // 尝试 Escape 关闭
    for (let i = 0; i < 3; i += 1) {
      if (!await page.locator('.cdk-overlay-backdrop-showing').count()) break;
      await page.keyboard.press('Escape');
      await wait(800);
      report['afterEscape' + i] = await page.evaluate(() => ({ backdrop: !!document.querySelector('.cdk-overlay-backdrop-showing'), url: location.href }));
    }
    await page.screenshot({ path: path.join(evidence, 'gemini-v6-after-escape.png') });
  } finally {
    fs.writeFileSync(path.join(evidence, 'gemini-probe-v6.json'), JSON.stringify(report, null, 2));
    await pool.close().catch(() => {});
  }
  console.log(JSON.stringify(report, null, 2).slice(0, 5000));
})().catch(error => { console.error('探针失败：' + (error.stack || error.message)); process.exitCode = 1; });
