'use strict';
// 探针 V8：聚焦输入框后，工具按钮到底是 Add files 还是 Upload & tools，点开菜单里有什么。
const fs = require('node:fs');
const path = require('node:path');
const { BrowserPool } = require('../src/browser-pool');
const { Store } = require('../src/store');
const ACCOUNT_ID = process.argv[2] || '539b6180-4332-4f25-b892-88bca4f4814f';
const evidence = path.resolve(__dirname, '../evidence');
const wait = ms => new Promise(r => setTimeout(r, ms));
const labels = page => page.evaluate(() => {
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return [...document.querySelectorAll('button,[role="button"]')].filter(visible)
    .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), label: e.getAttribute('aria-label') || '' }))
    .filter(item => item.text || item.label);
});

(async () => {
  const store = new Store(path.resolve(__dirname, '../data'));
  const account = store.get(ACCOUNT_ID);
  const pool = new BrowserPool({ store });
  const report = {};
  try {
    const page = await pool.taskPage(account);
    await wait(4000);
    report.beforeFocus = await labels(page);
    const editor = page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"]').first();
    await editor.click({ force: true });
    await wait(1000);
    report.afterFocus = await labels(page);
    const upload = page.locator('[aria-label="Upload & tools"]').first();
    report.uploadCount = await upload.count();
    report.uploadVisible = await upload.isVisible().catch(() => false);
    if (report.uploadVisible) {
      await upload.click();
      await wait(900);
      report.menu = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],.cdk-overlay-pane button')]
        .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), label: e.getAttribute('aria-label') || '', role: e.getAttribute('role') || '' }))
        .filter(item => item.text || item.label));
      await page.screenshot({ path: path.join(evidence, 'gemini-v8-menu.png') });
    } else {
      await page.screenshot({ path: path.join(evidence, 'gemini-v8-nofocus.png') });
    }
  } finally {
    fs.writeFileSync(path.join(evidence, 'gemini-probe-v8.json'), JSON.stringify(report, null, 2));
    await pool.close().catch(() => {});
  }
  console.log(JSON.stringify({ uploadVisible: report.uploadVisible, uploadCount: report.uploadCount, menu: report.menu, afterFocusPlus: (report.afterFocus || []).filter(b => /Add files|Upload|Upload & tools|tools|file/i.test(b.label + b.text)) }, null, 2).slice(0, 4000));
})().catch(error => { console.error('探针失败：' + (error.stack || error.message)); process.exitCode = 1; });
