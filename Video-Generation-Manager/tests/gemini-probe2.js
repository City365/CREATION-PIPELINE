'use strict';
// 登录态探针 V2：聚焦输入框、点开 + 菜单、看 Task 标签，不提交生成。
const fs = require('node:fs');
const path = require('node:path');
const { BrowserPool } = require('../src/browser-pool');
const { Store } = require('../src/store');

const ACCOUNT_ID = process.argv[2] || '539b6180-4332-4f25-b892-88bca4f4814f';
const evidence = path.resolve(__dirname, '../evidence');
const dump = async (page, name) => {
  const data = await page.evaluate(() => {
    const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const items = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],[role="tab"],[role="radio"],a')]
      .filter(visible).map(e => ({ tag: e.tagName, text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), label: e.getAttribute('aria-label') || '', role: e.getAttribute('role') || '' }))
      .filter(item => item.text || item.label);
    const overlays = [...document.querySelectorAll('[role="menu"],[role="listbox"],[role="dialog"],.cdk-overlay-pane,mat-menu,mat-dialog-container')]
      .filter(visible).map(root => (root.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 900));
    return { items, overlays, text: (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 5000) };
  });
  await page.screenshot({ path: path.join(evidence, name + '.png') });
  return data;
};

(async () => {
  const store = new Store(path.resolve(__dirname, '../data'));
  const account = store.get(ACCOUNT_ID);
  const pool = new BrowserPool({ store });
  const report = {};
  try {
    const page = await pool.taskPage(account);
    await page.waitForTimeout(3500);
    const editor = page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"], textarea').first();
    await editor.click();
    await page.waitForTimeout(900);
    report.focused = await dump(page, 'gemini-v2-focus');

    const addFiles = page.locator('[aria-label="Add files"], [aria-label="添加文件"], button:has-text("Add files")').first();
    if (await addFiles.count() && await addFiles.isVisible().catch(() => false)) {
      await addFiles.click();
      await page.waitForTimeout(1000);
      report.tools = await dump(page, 'gemini-v2-tools');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } else report.tools = { missing: true };

    const taskTab = page.locator('button:has-text("Task"), [role="tab"]:has-text("Task")').first();
    if (await taskTab.count() && await taskTab.isVisible().catch(() => false)) {
      await taskTab.click();
      await page.waitForTimeout(1200);
      report.task = await dump(page, 'gemini-v2-task');
      const chatTab = page.locator('button:has-text("Chat"), [role="tab"]:has-text("Chat")').first();
      if (await chatTab.count()) { await chatTab.click(); await page.waitForTimeout(800); }
    }
  } finally {
    fs.writeFileSync(path.join(evidence, 'gemini-probe-v2.json'), JSON.stringify(report, null, 2));
    await pool.close().catch(() => {});
  }
  const brief = {};
  for (const [key, value] of Object.entries(report)) {
    brief[key] = { items: (value.items || []).length, overlays: (value.overlays || []).filter(Boolean), hasVeo: /Veo|视频|Video/i.test(value.text || '') };
  }
  console.log(JSON.stringify(brief, null, 2));
})().catch(error => { console.error('探针失败：' + (error.stack || error.message)); process.exitCode = 1; });
