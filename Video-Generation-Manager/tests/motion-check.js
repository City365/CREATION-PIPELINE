'use strict';
// 背景动画是否真的在动：间隔 4 秒截两张图，用 ffmpeg 算 SSIM（越接近 1 越静止）。
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const { chromium } = require('playwright-core');
const { createService } = require('../src/server');
const { findChrome } = require('../src/browser-pool');
const FFMPEG = process.env.DBM_FFMPEG || 'D:/notebook/software/ffmpeg/bin/ffmpeg.exe';

(async () => {
  const directory = path.resolve(__dirname, '../.cache/motion-check-' + Date.now());
  fs.mkdirSync(directory, { recursive: true });
  let service, browser;
  try {
    service = await createService({ directory, port: 0, pool: { close: async () => {}, closeAccount: async () => {} } });
    const account = service.store.add({ name: '动效检查', platform: 'doubao' });
    service.store.update(account.id, { enabled: false, quotaUsed: 2 });
    const task = service.queue.submit({ prompt: '动效检查用任务，午后的庭院与缓慢的推镜。', platform: 'doubao', accountId: account.id });
    service.queue.update(service.queue.get(task.id), { status: 'completed', message: '已下载并校验', progress: 100 });
    browser = await chromium.launch({ executablePath: findChrome(), headless: true });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    for (const theme of ['aurora', 'midnight']) {
      await page.goto(service.baseURL + '/tasks');
      await page.evaluate(theme => localStorage.setItem('creative-desk-appearance', JSON.stringify({ theme, components: 'rounded', motion: 'full' })), theme);
      await page.reload();
      await page.locator('#task-rows tr').first().waitFor();
      await page.waitForTimeout(1200);
      const first = path.resolve(__dirname, `../evidence/motion-${theme}-1.png`);
      const second = path.resolve(__dirname, `../evidence/motion-${theme}-2.png`);
      await page.screenshot({ path: first });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: second });
      const { stderr } = await run(FFMPEG, ['-hide_banner', '-i', first, '-i', second, '-lavfi', 'ssim', '-f', 'null', '-'], { windowsHide: true, timeout: 60000 }).catch(error => ({ stderr: error.stderr || error.message }));
      const match = String(stderr).match(/All:([0-9.]+)/);
      console.log(theme + ' SSIM=' + (match ? match[1] : '解析失败'));
    }
  } finally {
    await browser?.close();
    await service?.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
