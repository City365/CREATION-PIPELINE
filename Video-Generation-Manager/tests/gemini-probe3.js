'use strict';
// 探针 V3：点开模型选择器和 Upload & tools，看有没有 Veo / 视频入口。不提交生成。
const fs = require('node:fs');
const path = require('node:path');
const { BrowserPool } = require('../src/browser-pool');
const { Store } = require('../src/store');

const ACCOUNT_ID = process.argv[2] || '539b6180-4332-4f25-b892-88bca4f4814f';
const evidence = path.resolve(__dirname, '../evidence');

const readPanels = page => page.evaluate(() => {
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const panels = [...document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],.cdk-overlay-pane,mat-menu,mat-dialog-container,[class*="overlay"],[class*="menu-panel"]')]
    .filter(visible)
    .map(root => ({
      tag: root.tagName,
      role: root.getAttribute('role') || '',
      cls: String(root.className || '').slice(0, 120),
      text: (root.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
      items: [...root.querySelectorAll('[role="menuitem"],[role="option"],button,li,mat-option')]
        .filter(visible)
        .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100), label: e.getAttribute('aria-label') || '', role: e.getAttribute('role') || '' }))
        .filter(item => item.text || item.label)
    }))
    .filter(panel => panel.text || panel.items.length);
  const veoNodes = [...document.querySelectorAll('*')]
    .filter(e => e.children.length === 0 && /veo/i.test(e.textContent || ''))
    .slice(0, 10)
    .map(e => ({ tag: e.tagName, text: (e.textContent || '').trim().slice(0, 120) }));
  return { panels, veoNodes };
});

(async () => {
  const store = new Store(path.resolve(__dirname, '../data'));
  const account = store.get(ACCOUNT_ID);
  const pool = new BrowserPool({ store });
  const report = {};
  try {
    const page = await pool.taskPage(account);
    await page.waitForTimeout(3500);
    // 有弹层（新手提示/公告）先关掉，否则点击会被遮罩拦截。
    for (let i = 0; i < 3; i += 1) {
      const backdrop = await page.locator('.cdk-overlay-backdrop-showing').count();
      if (!backdrop) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
    }
    await page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"], textarea').first().click({ force: true });
    await page.waitForTimeout(900);

    const mode = page.locator('[aria-label="Open mode picker, currently Flash-Lite"], button:has-text("Flash-Lite")').first();
    if (await mode.count() && await mode.isVisible().catch(() => false)) {
      await mode.click();
      await page.waitForTimeout(1200);
      report.mode = await readPanels(page);
      await page.screenshot({ path: path.join(evidence, 'gemini-v3-mode.png') });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else report.mode = { missing: true };

    const tools = page.locator('[aria-label="Upload & tools"], [aria-label="Add files"]').first();
    if (await tools.count() && await tools.isVisible().catch(() => false)) {
      await tools.click();
      await page.waitForTimeout(1200);
      report.tools = await readPanels(page);
      await page.screenshot({ path: path.join(evidence, 'gemini-v3-tools.png') });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else report.tools = { missing: true };
  } finally {
    fs.writeFileSync(path.join(evidence, 'gemini-probe-v3.json'), JSON.stringify(report, null, 2));
    await pool.close().catch(() => {});
  }
  console.log(JSON.stringify(report, null, 2).slice(0, 6000));
})().catch(error => { console.error('探针失败：' + (error.stack || error.message)); process.exitCode = 1; });
