'use strict';
// 探针 V7：处理 Create videos 引导弹窗后，抓视频模式控件、画幅选项、发送按钮和历史视频下载入口。不提交生成。
const fs = require('node:fs');
const path = require('node:path');
const { BrowserPool } = require('../src/browser-pool');
const { Store } = require('../src/store');

const ACCOUNT_ID = process.argv[2] || '539b6180-4332-4f25-b892-88bca4f4814f';
const evidence = path.resolve(__dirname, '../evidence');
const wait = ms => new Promise(r => setTimeout(r, ms));

const buttons = page => page.evaluate(() => {
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="radio"]')]
    .filter(visible)
    .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50), label: e.getAttribute('aria-label') || '', role: e.getAttribute('role') || '', checked: e.getAttribute('aria-checked') || '' }))
    .filter(item => item.text || item.label);
});

async function dismissVideoIntro(page) {
  for (let i = 0; i < 2; i += 1) {
    const intro = page.locator('.cdk-overlay-pane:has-text("Create videos"), .cdk-overlay-pane:has-text("With Gemini Omni")').first();
    if (!await intro.count() || !await intro.isVisible().catch(() => false)) return false;
    const tryIt = intro.locator('button:has-text("Try it")').first();
    if (await tryIt.count()) { await tryIt.click(); await wait(1600); continue; }
    await page.keyboard.press('Escape');
    await wait(900);
  }
  return true;
}

async function enableVideoMode(page) {
  await page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"]').first().click({ force: true });
  await wait(500);
  await page.locator('[aria-label="Upload & tools"]').first().click();
  await wait(700);
  let item = page.locator('[role="menuitemcheckbox"]:has-text("Create video")').first();
  if (!await item.count()) {
    const more = page.locator('.cdk-overlay-pane [role="menuitem"]:has-text("More tools")').first();
    if (await more.count()) { await more.click(); await wait(800); }
    item = page.locator('[role="menuitemcheckbox"]:has-text("Create video")').first();
  }
  if (await item.count()) { await item.click(); await wait(1800); }
  await dismissVideoIntro(page);
  await wait(800);
}

(async () => {
  const store = new Store(path.resolve(__dirname, '../data'));
  const account = store.get(ACCOUNT_ID);
  const pool = new BrowserPool({ store });
  const report = { steps: {} };
  try {
    const page = await pool.taskPage(account);
    await wait(3500);
    await enableVideoMode(page);
    report.steps.videoModeButtons = await buttons(page);
    await page.screenshot({ path: path.join(evidence, 'gemini-v7-video-mode.png') });

    // 画幅菜单
    const aspect = page.locator('[aria-label^="Aspect ratio"], button:has-text("Landscape"), button:has-text("Portrait")').first();
    if (await aspect.count() && await aspect.isVisible().catch(() => false)) {
      report.steps.aspectLabel = await aspect.getAttribute('aria-label');
      await aspect.click({ force: true });
      await wait(900);
      report.steps.aspectMenu = await page.evaluate(() => [...document.querySelectorAll('.cdk-overlay-pane [role="menuitemradio"],.cdk-overlay-pane [role="menuitem"],.cdk-overlay-pane button,.cdk-overlay-pane [role="radio"]')]
        .map(e => ({ text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60), label: e.getAttribute('aria-label') || '', checked: e.getAttribute('aria-checked') || '' }))
        .filter(item => item.text || item.label));
      await page.screenshot({ path: path.join(evidence, 'gemini-v7-aspect.png') });
      await page.keyboard.press('Escape');
      await wait(700);
    }

    // 发送按钮
    const editor = page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"]').first();
    await editor.click({ force: true });
    await editor.fill('setup check');
    await wait(800);
    report.steps.sendButtons = (await buttons(page)).filter(b => /send|发送|submit/i.test(b.label + b.text));
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await wait(400);

    // 历史视频会话
    const chat = page.locator('a[href^="/app/"]').filter({ hasText: '生成男性视频' }).first();
    if (!await chat.count()) {
      const anyVideoChat = page.locator('a[href^="/app/"]').first();
      if (await anyVideoChat.count()) await anyVideoChat.click({ force: true });
    } else await chat.click({ force: true });
    await wait(6000);
    report.steps.history = await page.evaluate(() => {
      const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return {
        url: location.href,
        videos: [...document.querySelectorAll('video')].filter(visible).map(video => ({
          src: (video.currentSrc || video.getAttribute('src') || video.querySelector('source')?.src || '').slice(0, 300),
          poster: (video.getAttribute('poster') || '').slice(0, 160),
          duration: video.duration || null, width: video.videoWidth || null, height: video.videoHeight || null
        })),
        buttons: [...document.querySelectorAll('button')].filter(visible).map(b => b.getAttribute('aria-label') || (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 60)
      };
    });
    await page.screenshot({ path: path.join(evidence, 'gemini-v7-history.png') });
    // 悬停视频卡片看有没有下载按钮
    const video = page.locator('video').first();
    if (await video.count()) {
      const box = await video.boundingBox();
      if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await wait(1200); }
      report.steps.hoverButtons = (await buttons(page)).filter(b => /download|下载|more/i.test(b.label + b.text));
      await page.screenshot({ path: path.join(evidence, 'gemini-v7-history-hover.png') });
    }
  } finally {
    fs.writeFileSync(path.join(evidence, 'gemini-probe-v7.json'), JSON.stringify(report, null, 2));
    await pool.close().catch(() => {});
  }
  console.log(JSON.stringify(report, null, 2).slice(0, 5000));
})().catch(error => { console.error('探针失败：' + (error.stack || error.message)); process.exitCode = 1; });
