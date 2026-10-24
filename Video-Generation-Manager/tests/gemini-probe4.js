'use strict';
// 探针 V4：看 Create video 开关的前后差异，并从历史会话里读已生成视频的结构与下载入口。不提交生成。
const fs = require('node:fs');
const path = require('node:path');
const { BrowserPool } = require('../src/browser-pool');
const { Store } = require('../src/store');

const ACCOUNT_ID = process.argv[2] || '539b6180-4332-4f25-b892-88bca4f4814f';
const evidence = path.resolve(__dirname, '../evidence');

const snapshot = page => page.evaluate(() => {
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const buttons = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],[role="tab"]')]
    .filter(visible)
    .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), label: e.getAttribute('aria-label') || '', role: e.getAttribute('role') || '', checked: e.getAttribute('aria-checked') || '' }))
    .filter(item => item.text || item.label);
  const chips = [...document.querySelectorAll('[class*="chip"],[class*="tool"],[class*="pill"]')]
    .filter(visible).map(e => (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean).slice(0, 20);
  const videos = [...document.querySelectorAll('video')].filter(visible).map(video => {
    const source = video.querySelector('source');
    const box = video.closest('[data-test-id],[class*="response"],[class*="message"],[class*="card"]') || video.parentElement;
    const nearby = [...(box?.querySelectorAll('button') || [])].filter(visible).map(b => b.getAttribute('aria-label') || (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean);
    return { src: (video.currentSrc || video.getAttribute('src') || source?.src || '').slice(0, 300), poster: (video.getAttribute('poster') || '').slice(0, 200), duration: video.duration || null, width: video.videoWidth || null, height: video.videoHeight || null, nearby };
  });
  const downloadish = [...document.querySelectorAll('button,[role="button"],a')].filter(e => visible(e) && /download|下载/i.test((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || ''))).map(e => ({ tag: e.tagName, text: (e.innerText || '').trim().slice(0, 40), label: e.getAttribute('aria-label') || '' }));
  return { buttons, chips, videos, downloadish, url: location.href, text: (document.body.innerText || '').slice(-3000) };
});

(async () => {
  const store = new Store(path.resolve(__dirname, '../data'));
  const account = store.get(ACCOUNT_ID);
  const pool = new BrowserPool({ store });
  const report = {};
  try {
    const page = await pool.taskPage(account);
    await page.waitForTimeout(3500);
    for (let i = 0; i < 3; i += 1) if (await page.locator('.cdk-overlay-backdrop-showing').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }

    // 1) 打开 Upload & tools → More tools，看视频入口
    await page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"]').first().click({ force: true });
    await page.waitForTimeout(600);
    await page.locator('[aria-label="Upload & tools"]').first().click();
    await page.waitForTimeout(900);
    report.toolsMenu = await page.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane [role="menuitem"],.cdk-overlay-pane [role="menuitemcheckbox"],.cdk-overlay-pane button')]
      .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), label: e.getAttribute('aria-label') || '', role: e.getAttribute('role') || '', checked: e.getAttribute('aria-checked') || '' }))
      .filter(item => item.text || item.label));
    await page.screenshot({ path: path.join(evidence, 'gemini-v4-tools.png') });
    const moreTools = page.locator('.cdk-overlay-pane [role="menuitem"]:has-text("More tools"), .cdk-overlay-pane button:has-text("More tools"), [role="menuitem"]:has-text("More tools")').first();
    if (await moreTools.count()) {
      await moreTools.click();
      await page.waitForTimeout(1000);
      report.moreTools = await page.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane [role="menuitem"],.cdk-overlay-pane [role="menuitemcheckbox"],.cdk-overlay-pane button,.cdk-overlay-pane [role="option"]')]
        .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), label: e.getAttribute('aria-label') || '', role: e.getAttribute('role') || '', checked: e.getAttribute('aria-checked') || '' }))
        .filter(item => item.text || item.label));
      await page.screenshot({ path: path.join(evidence, 'gemini-v4-more-tools.png') });
    }
    const createVideo = page.locator('[role="menuitemcheckbox"]:has-text("Create video"), [role="menuitem"]:has-text("Create video"), [role="menuitem"]:has-text("Video"), button:has-text("Create video")').first();
    if (await createVideo.count() && await createVideo.isVisible().catch(() => false)) {
      await createVideo.click();
      await page.waitForTimeout(1400);
    }
    report.afterEnable = await snapshot(page);
    await page.screenshot({ path: path.join(evidence, 'gemini-v4-video-tool.png') });

    // 2) 打开历史视频会话，读视频元素和下载入口
    const chat = page.locator('a:has-text("生成男性视频")').first();
    if (await chat.count()) {
      await chat.click();
      await page.waitForTimeout(5000);
      report.videoChat = await snapshot(page);
      await page.screenshot({ path: path.join(evidence, 'gemini-v4-video-chat.png') });
      // 三条点菜单里通常有下载
      const more = page.locator('[aria-label*="More options"], button:has-text("More")').first();
      if (await more.count()) {
        await more.click();
        await page.waitForTimeout(900);
        report.moreMenu = await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"],.cdk-overlay-pane [role="menuitem"],.cdk-overlay-pane button')]
          .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), label: e.getAttribute('aria-label') || '' })).filter(item => item.text || item.label));
        await page.screenshot({ path: path.join(evidence, 'gemini-v4-more.png') });
        await page.keyboard.press('Escape');
      }
    }
  } finally {
    fs.writeFileSync(path.join(evidence, 'gemini-probe-v4.json'), JSON.stringify(report, null, 2));
    await pool.close().catch(() => {});
  }
  console.log(JSON.stringify({
    afterEnableChips: report.afterEnable?.chips,
    afterEnableButtons: (report.afterEnable?.buttons || []).filter(b => /video|视频|Veo/i.test(b.text + b.label)),
    videoChatUrl: report.videoChat?.url,
    videos: report.videoChat?.videos,
    downloadish: report.videoChat?.downloadish,
    moreMenu: report.moreMenu
  }, null, 2).slice(0, 5000));
})().catch(error => { console.error('探针失败：' + (error.stack || error.message)); process.exitCode = 1; });
