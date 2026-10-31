'use strict';
/**
 * 抓豆包会话里的视频直链：复制一份已登录的 Chrome profile 到临时目录，
 * 用 playwright 打开会话页，收集网络里的 mp4 / video 元素，落盘候选清单。
 * 用法：node scripts/_grab-doubao.cjs <chatUrl> <profileId...>
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const MANAGER = path.resolve(__dirname, '..', '..', 'Video-Generation-Manager');
const mgrRequire = createRequire(path.join(MANAGER, 'package.json'));
const { chromium } = mgrRequire('playwright-core');
const { findChrome } = mgrRequire('./src/browser-pool');

const chatUrl = process.argv[2] || 'https://www.doubao.com/chat/38449980185337346';
const rest = process.argv.slice(3);
const dirMode = rest[0] === '--dir';
const givenDir = dirMode ? rest[1] : '';
const profiles = dirMode ? [] : rest;
const OUT = path.join(__dirname, '..', 'data', 'doubao-grab');
fs.mkdirSync(OUT, { recursive: true });

function copyProfile(id) {
  const src = path.join(MANAGER, 'data', 'profiles', id);
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-profile-'));
  for (const name of ['Default', 'Local State']) {
    const from = path.join(src, name);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(dst, name), { recursive: true, force: true });
  }
  return dst;
}

(async () => {
  const report = { chatUrl, attempts: [] };
  const targets = dirMode ? [{ id: 'given', dir: givenDir }] : profiles.map((id) => ({ id, dir: copyProfile(id) }));
  for (const target of targets) {
    const id = target.id;
    const dir = target.dir;
    const keep = dirMode;
    let context = null;
    const urls = new Set();
    const videos = new Set();
    try {
      context = await chromium.launchPersistentContext(dir, {
        executablePath: findChrome(),
        headless: true,
        viewport: { width: 1440, height: 900 },
        args: ['--no-first-run', '--no-default-browser-check'],
      });
      const page = context.pages()[0] || (await context.newPage());
      page.on('response', (res) => {
        const url = res.url();
        if (/\.mp4(\?|$)/i.test(url) || /\/video\//i.test(url) || /doubaoapi|byteimg|vod/i.test(url)) {
          if (/\.mp4/i.test(url)) urls.add(url);
        }
      });
      page.on('request', (req) => {
        const url = req.url();
        if (/\.mp4(\?|$)/i.test(url)) urls.add(url);
      });
      await page.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(9000);
      const title = await page.title();
      const body = (await page.evaluate(() => document.body.innerText)).slice(0, 600);
      const domVideos = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ src: v.currentSrc || v.src, poster: v.poster, duration: v.duration })));
      domVideos.forEach((v) => { if (v.src) videos.add(v.src); });
      const shot = path.join(OUT, `shot-${id.slice(0, 8)}.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      report.attempts.push({ profile: id, title, body, domVideos, urls: [...urls], screenshot: shot });
    } catch (error) {
      report.attempts.push({ profile: id, error: error.message });
    } finally {
      if (context) await context.close().catch(() => {});
      if (!keep) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 临时目录留着 */ } }
    }
    const last = report.attempts[report.attempts.length - 1];
    if (last && ((last.domVideos || []).some((v) => v.src) || (last.urls || []).length)) break;
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
