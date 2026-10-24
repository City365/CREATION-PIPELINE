'use strict';
// 手动视觉检查：为每个主题截一张任务页和设置页，输出到 evidence/theme-<name>.png
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createService } = require('../src/server');
const { findChrome } = require('../src/browser-pool');

const themes = ['mint', 'sky', 'peach', 'aurora', 'sakura', 'midnight', 'graphite'];
(async () => {
  const directory = path.resolve(__dirname, '../.cache/theme-preview-' + Date.now());
  fs.mkdirSync(directory, { recursive: true });
  let service, browser;
  try {
    service = await createService({ directory, port: 0, pool: { close: async () => {}, closeAccount: async () => {} } });
    const a = service.store.add({ name: '主创作账号', platform: 'doubao' });
    service.store.update(a.id, { enabled: false, group: '日常创作', remark: '界面预览用账号', quotaLimit: 5, quotaUsed: 2 });
    const b = service.store.add({ name: '镜头实验室', platform: 'dola' });
    service.store.update(b.id, { enabled: false, group: '视频测试', quotaLimit: 8, quotaUsed: 3 });
    const t = service.queue.submit({ prompt: '午后窗边，一只橘猫慢慢伸了个懒腰。镜头轻轻推进，阳光照亮毛发。', platform: 'doubao', accountId: a.id, duration: 5, ratio: '16:9' });
    service.queue.update(service.queue.get(t.id), { status: 'completed', message: '已下载并校验', progress: 100 });
    const f = service.queue.submit({ prompt: '雨后街道上的霓虹倒影，缓慢的长镜头。', platform: 'doubao', duration: 10, ratio: '9:16' });
    service.queue.update(service.queue.get(f.id), { status: 'failed', error: '界面预览示例：平台配额不足', message: '请检查账号' });
    browser = await chromium.launch({ executablePath: findChrome(), headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    for (const theme of themes) {
      await page.goto(service.baseURL + '/tasks');
      await page.evaluate(([theme]) => {
        localStorage.setItem('creative-desk-appearance', JSON.stringify({ theme, components: 'rounded', motion: 'full' }));
      }, [theme]);
      await page.reload();
      await page.locator('#task-rows tr').first().waitFor();
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.resolve(__dirname, `../evidence/theme-${theme}.png`) });
      await page.goto(service.baseURL + '/settings');
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.resolve(__dirname, `../evidence/theme-${theme}-settings.png`), fullPage: true });
      console.log('theme ' + theme + ' ok');
    }
    // 顶栏快速换主题
    await page.goto(service.baseURL + '/tasks');
    await page.waitForTimeout(400);
    await page.locator('#theme-switch').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.resolve(__dirname, '../evidence/theme-switch.png') });
    await page.keyboard.press('Escape');
    // 弹窗与下载记录的在某个主题下的样子
    await page.goto(service.baseURL + '/tasks');
    await page.waitForTimeout(400);
    await page.locator('[data-task-action="detail"]').first().click();
    await page.locator('#detail-dialog[open]').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.resolve(__dirname, '../evidence/theme-dialog.png') });
  } finally {
    await browser?.close();
    await service?.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
