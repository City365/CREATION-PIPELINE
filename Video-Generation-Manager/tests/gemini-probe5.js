'use strict';
// 探针 V5：视频模式的画幅选项、发送按钮，以及历史视频会话里的下载入口。不提交生成。
const fs = require('node:fs');
const path = require('node:path');
const { BrowserPool } = require('../src/browser-pool');
const { Store } = require('../src/store');

const ACCOUNT_ID = process.argv[2] || '539b6180-4332-4f25-b892-88bca4f4814f';
const evidence = path.resolve(__dirname, '../evidence');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const dumpButtons = page => page.evaluate(() => {
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]')]
    .filter(visible)
    .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50), label: e.getAttribute('aria-label') || '', role: e.getAttribute('role') || '', checked: e.getAttribute('aria-checked') || '' }))
    .filter(item => item.text || item.label);
});

async function clearOverlays(page) {
  for (let i = 0; i < 3; i += 1) {
    if (!await page.locator('.cdk-overlay-backdrop-showing').count()) return;
    await page.keyboard.press('Escape');
    await wait(600);
  }
}

(async () => {
  const store = new Store(path.resolve(__dirname, '../data'));
  const account = store.get(ACCOUNT_ID);
  const pool = new BrowserPool({ store });
  const report = { steps: {} };
  try {
    const page = await pool.taskPage(account);
    await wait(3500);
    await clearOverlays(page);
    await page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"]').first().click({ force: true });
    await wait(600);

    // 打开视频模式
    await page.locator('[aria-label="Upload & tools"]').first().click();
    await wait(800);
    let createVideo = page.locator('[role="menuitemcheckbox"]:has-text("Create video")').first();
    if (!await createVideo.count()) {
      const more = page.locator('.cdk-overlay-pane [role="menuitem"]:has-text("More tools")').first();
      if (await more.count()) { await more.click(); await wait(900); }
      createVideo = page.locator('[role="menuitemcheckbox"]:has-text("Create video")').first();
    }
    if (await createVideo.count()) { await createVideo.click(); await wait(1800); }
    report.steps.afterEnable = await dumpButtons(page);
    await page.screenshot({ path: path.join(evidence, 'gemini-v5-video-mode.png') });

    // 画幅选项
    const ratio = page.locator('button:has-text("Landscape"), [aria-label*="Landscape"], [aria-label*="Aspect"]').first();
    if (await ratio.count() && await ratio.isVisible().catch(() => false)) {
      await ratio.click();
      await wait(900);
      report.steps.ratioMenu = await page.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane [role="menuitemradio"],.cdk-overlay-pane [role="menuitem"],.cdk-overlay-pane button,.cdk-overlay-pane [role="radio"]')]
        .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50), label: e.getAttribute('aria-label') || '', checked: e.getAttribute('aria-checked') || e.getAttribute('aria-checked') || '' }))
        .filter(item => item.text || item.label));
      await page.screenshot({ path: path.join(evidence, 'gemini-v5-ratio.png') });
      await page.keyboard.press('Escape');
      await wait(600);
    }

    // 发送按钮：输入一段测试文字后观察，再清空
    const editor = page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"]').first();
    await editor.click({ force: true });
    await editor.fill('setup check');
    await wait(700);
    report.steps.sendCandidates = (await dumpButtons(page)).filter(b => /send|发送/i.test(b.label + b.text));
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await wait(400);

    // 历史视频会话
    await clearOverlays(page);
    const chat = page.locator('a:has-text("生成男性视频"), a[href^="/app/"]').first();
    if (await chat.count()) {
      await chat.click({ force: true });
      await wait(6000);
      await clearOverlays(page);
      const media = await page.evaluate(() => {
        const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return [...document.querySelectorAll('video')].filter(visible).map(video => {
          const box = video.closest('[data-test-id],[class*="response"],[class*="message"],[class*="card"]') || video.parentElement;
          return {
            src: (video.currentSrc || video.getAttribute('src') || video.querySelector('source')?.src || '').slice(0, 400),
            poster: (video.getAttribute('poster') || '').slice(0, 200),
            duration: video.duration || null, width: video.videoWidth || null, height: video.videoHeight || null,
            controls: video.hasAttribute('controls'),
            nearby: [...(box?.querySelectorAll('button') || [])].filter(visible).map(b => b.getAttribute('aria-label') || (b.innerText || '').trim().slice(0, 40)).filter(Boolean)
          };
        });
      });
      report.steps.historyMedia = media;
      await page.screenshot({ path: path.join(evidence, 'gemini-v5-history.png') });
      const more = page.locator('[aria-label*="More options for"], [aria-label*="More options"]').first();
      if (await more.count()) {
        await more.click();
        await wait(900);
        report.steps.historyMore = await page.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane [role="menuitem"],.cdk-overlay-pane button')]
          .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50), label: e.getAttribute('aria-label') || '' })).filter(item => item.text || item.label));
        await page.screenshot({ path: path.join(evidence, 'gemini-v5-history-more.png') });
        await page.keyboard.press('Escape');
      }
    }
  } finally {
    fs.writeFileSync(path.join(evidence, 'gemini-probe-v5.json'), JSON.stringify(report, null, 2));
    await pool.close().catch(() => {});
  }
  console.log(JSON.stringify({
    videoModeButtons: (report.steps.afterEnable || []).filter(b => /video|视频|landscape|portrait|square|flash|pro|deselect/i.test(b.text + b.label)),
    ratioMenu: report.steps.ratioMenu,
    sendCandidates: report.steps.sendCandidates,
    historyMedia: report.steps.historyMedia,
    historyMore: report.steps.historyMore
  }, null, 2).slice(0, 6000));
})().catch(error => { console.error('探针失败：' + (error.stack || error.message)); process.exitCode = 1; });
