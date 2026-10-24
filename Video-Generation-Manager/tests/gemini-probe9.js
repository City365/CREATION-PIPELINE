'use strict';
// 探针 V9：Gemini 附件入口。上传一张测试图（不发送），看附件卡与文件输入。
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
    await wait(4000);
    await page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"]').first().click({ force: true });
    await wait(700);
    report.inputs = await page.evaluate(() => [...document.querySelectorAll('input[type=file]')].map(i => ({
      accept: i.getAttribute('accept') || '', multiple: i.multiple, cls: String(i.className || '').slice(0, 80), hidden: i.offsetParent === null
    })));
    report.beforeChips = await page.evaluate(() => [...document.querySelectorAll('[class*="attachment"],[class*="chip"],[class*="upload"]')]
      .map(e => ({ cls: String(e.className || '').slice(0, 90), text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) }))
      .filter(item => item.text).slice(0, 15));

    const image = path.join(evidence, 'sample-reference.png');
    if (!fs.existsSync(image)) throw new Error('缺少测试图 evidence/sample-reference.png');
    const input = page.locator('input[type=file]').first();
    if (await input.count()) {
      report.via = 'input[type=file]';
      await input.setInputFiles([image]);
    } else {
      report.via = 'Upload files menu';
      await page.locator('[aria-label="Upload & tools"]').first().click();
      await wait(800);
      const pending = page.waitForEvent('filechooser', { timeout: 10000 });
      await page.locator('[role="menuitem"]:has-text("Upload files"), button:has-text("Upload files")').first().click();
      const chooser = await pending;
      await chooser.setFiles([image]);
    }
    await wait(5000);
    report.afterChips = await page.evaluate(() => {
      const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return {
        chips: [...document.querySelectorAll('[class*="attachment"],[class*="chip"],[class*="upload"],[class*="file-preview"],[class*="thumbnail"]')]
          .filter(visible).map(e => ({ cls: String(e.className || '').slice(0, 90), text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) })).filter(item => item.text).slice(0, 20),
        images: [...document.querySelectorAll('img')].filter(visible).map(i => ({ src: (i.src || '').slice(0, 120), alt: i.alt || '', w: i.naturalWidth })).filter(i => /blob:|googleusercontent/.test(i.src)).slice(0, 10),
        text: (document.body.innerText || '').slice(0, 1500)
      };
    });
    await page.screenshot({ path: path.join(evidence, 'gemini-v9-attach.png') });
  } finally {
    fs.writeFileSync(path.join(evidence, 'gemini-probe-v9.json'), JSON.stringify(report, null, 2));
    await pool.close().catch(() => {});
  }
  console.log(JSON.stringify({ inputs: report.inputs, via: report.via, after: report.afterChips }, null, 2).slice(0, 4000));
})().catch(error => { console.error('探针失败：' + (error.stack || error.message)); process.exitCode = 1; });
