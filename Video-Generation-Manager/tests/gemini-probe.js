'use strict';
// 手动探针：用 Gemini 账号配置打开 gemini.google.com，只点开菜单看结构，不提交生成。
const fs = require('node:fs');
const path = require('node:path');
const { BrowserPool } = require('../src/browser-pool');
const { Store } = require('../src/store');

const ACCOUNT_ID = process.argv[2] || '539b6180-4332-4f25-b892-88bca4f4814f';
const evidence = path.resolve(__dirname, '../evidence');

(async () => {
  const store = new Store(path.resolve(__dirname, '../data'));
  const account = store.get(ACCOUNT_ID);
  if (!account) throw new Error('账号不存在');
  const pool = new BrowserPool({ store });
  const report = { url: '', buttons: [], modeMenu: [], toolsMenu: [], editor: null, veoMentions: [], text: '' };
  try {
    const page = await pool.taskPage(account);
    await page.waitForTimeout(3500);
    report.url = page.url();
    const snapshot = async () => page.evaluate(() => ({
      buttons: [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],[role="tab"]')]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .slice(0, 80)
        .map(e => ({ tag: e.tagName, text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80), label: e.getAttribute('aria-label') || '', role: e.getAttribute('role') || '', testid: e.getAttribute('data-testid') || '' })),
      text: (document.body.innerText || '').slice(0, 6000)
    }));
    const first = await snapshot();
    report.buttons = first.buttons;
    report.text = first.text;
    report.editor = await page.evaluate(() => {
      const el = document.querySelector('rich-textarea [contenteditable="true"], [contenteditable="true"], textarea');
      if (!el) return null;
      return { tag: el.tagName, cls: String(el.className || '').slice(0, 200), placeholder: el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '', aria: el.getAttribute('aria-label') || '' };
    });

    const openMenu = async (clickTarget) => {
      const target = page.locator(clickTarget).first();
      if (!await target.count() || !await target.isVisible().catch(() => false)) return [];
      await target.click();
      await page.waitForTimeout(900);
      const items = await page.evaluate(() => {
        const roots = [...document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],.cdk-overlay-pane,mat-menu,mat-dialog-container')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        const nodes = roots.flatMap(root => [...root.querySelectorAll('[role="menuitem"],[role="option"],button,li')]);
        return nodes.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
          .map(e => ({ role: e.getAttribute('role') || '', text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120), label: e.getAttribute('aria-label') || '' }))
          .filter(item => item.text || item.label);
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      return items;
    };

    report.modeMenu = await openMenu('button:has-text("Flash-Lite")');
    await page.screenshot({ path: path.join(evidence, 'gemini-probe-mode.png') });
    report.toolsMenu = await openMenu('[aria-label="Upload & tools"]');
    await page.screenshot({ path: path.join(evidence, 'gemini-probe-tools.png') });
    await page.screenshot({ path: path.join(evidence, 'gemini-probe-home.png') });
    report.veoMentions = await page.evaluate(() => (document.body.innerHTML.match(/[^<>]{0,40}Veo[^<>]{0,40}/g) || []).slice(0, 20));
  } finally {
    fs.writeFileSync(path.join(evidence, 'gemini-probe.json'), JSON.stringify(report, null, 2));
    await pool.close().catch(() => {});
  }
  console.log(JSON.stringify({ url: report.url, editor: report.editor, modeMenu: report.modeMenu, toolsMenu: report.toolsMenu, veoMentions: report.veoMentions, buttonCount: report.buttons.length }, null, 2));
})().catch(error => { console.error('探针失败：' + (error.stack || error.message)); process.exitCode = 1; });
