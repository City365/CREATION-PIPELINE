'use strict';
// 手动实测：用真实账号配置打开既有会话，观察 /im/chain/single 是否带 fallback_api，
// 再走管理器合并进来的 fallback 解码器取无水印地址，下载并抽帧。
// 不是自动测试，不向平台提交生成。
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const { Store } = require('../src/store');
const { BrowserPool } = require('../src/browser-pool');
const { readPageState } = require('../src/adapters/page-state');
const { attachFallbackCapture, resolveFallbackVideo } = require('../src/adapters/doubao-fallback');
const { downloadVideo } = require('../src/download');

const ROOT = path.join(__dirname, '..');
const dataDir = process.env.DBM_REBUILD_DATA_DIR || path.join(ROOT, 'data');
const evidence = path.join(ROOT, 'evidence');
const framesDir = path.join(evidence, 'live-probe');
const conversation = process.argv[2] || 'https://www.doubao.com/chat/38448675943808258';
const FFPROBE = process.env.DBM_FFPROBE || 'D:/notebook/software/ffmpeg/bin/ffprobe.exe';
const FFMPEG = FFPROBE.replace(/ffprobe\.exe$/i, 'ffmpeg.exe');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  fs.mkdirSync(framesDir, { recursive: true });
  const store = new Store(dataDir);
  const account = store.list().find(a => a.platform === 'doubao');
  if (!account) throw new Error('data/accounts.json 里没有豆包账号');
  const pool = new BrowserPool({ store });
  const report = { conversation, accountId: account.id, startedAt: new Date().toISOString(), chainResponses: [], page: {}, fallback: null, download: null, frames: [] };
  try {
    const context = await pool.context(account);
    const page = await context.newPage();
    const chainResponses = [];
    let dumpIndex = 0;
    page.on('response', response => {
      let u; try { u = new URL(response.url()); } catch { return; }
      if (!/(^|\.)doubao\.com$/.test(u.hostname)) return;
      if (!/\/im\//.test(u.pathname)) return;
      const pending = (async () => {
        try {
          const text = await response.text();
          const hits = (text.match(/fallback_api/g) || []).length;
          const record = { url: u.pathname, status: response.status(), bytes: text.length, fallbackApi: hits };
          if (hits) {
            const dump = path.join(framesDir, 'response-' + (dumpIndex++) + '.json');
            fs.writeFileSync(dump, text);
            record.dump = dump;
          }
          chainResponses.push(record);
        } catch (error) { chainResponses.push({ url: u.pathname, status: response.status(), error: error.message }); }
      })();
    });
    attachFallbackCapture(page);
    await page.goto(conversation, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(9000);
    for (let i = 0; i < 6; i += 1) {
      await page.locator('[data-testid="message-list"] .scroller').evaluateAll(es => es.forEach(e => { e.scrollTop = e.scrollHeight; })).catch(() => {});
      await wait(1500);
    }
    await wait(4000);

    const ids = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-message-id]')].map(e => e.getAttribute('data-message-id')))].filter(id => /^\d{8,}$/.test(String(id || ''))));
    const state = await page.evaluate(readPageState, { selectors: account.selectors || {} });
    report.page = { url: page.url(), messageIds: ids, replies: state.replies.map(r => ({ id: r.id, text: r.text.slice(-120) })), media: state.media.map(m => ({ messageId: m.messageId, confirmedNoWatermark: m.confirmedNoWatermark, url: String(m.url).slice(0, 160) })), complete: state.complete };
    report.chainResponses = chainResponses;
    console.log('打开会话：' + page.url());
    console.log('DOM 消息ID：' + ids.length + ' 个');
    console.log('/im/ 响应：' + chainResponses.map(r => `${r.url} status=${r.status} bytes=${r.bytes || '-'} fallback_api=${r.fallbackApi ?? '-'}`).join(' | '));

    const controller = new AbortController();
    const fallback = await resolveFallbackVideo({ page, messageIds: ids, signal: controller.signal });
    report.fallback = fallback;
    console.log('fallback 结果：' + JSON.stringify({ url: fallback.url, matchedApis: fallback.matchedApis, diagnostics: fallback.diagnostics }, null, 2));

    if (fallback.url) {
      const destination = path.join(dataDir, 'downloads', 'live-fallback-' + Date.now() + '.mp4');
      const result = await downloadVideo({ url: fallback.url, page, destination, ffprobe: FFPROBE });
      report.download = { ...result, url: fallback.url, method: 'fallback-api-unwatermarked' };
      console.log('已下载：' + result.path + ' (' + result.size + ' 字节, ' + result.duration + 's)');
      const sheet = path.join(framesDir, 'live-fallback-sheet.jpg');
      await run(FFMPEG, ['-y', '-i', result.path, '-vf', 'fps=2/3,scale=480:-2,tile=5x2', '-frames:v', '1', sheet], { windowsHide: true, timeout: 120000 });
      report.frames.push(sheet);
      console.log('抽帧：' + sheet);
      const reference = path.join(dataDir, 'downloads', '6e7b5c1f-c8cb-4a8d-a224-5d08ce85480a-official-test.mp4');
      if (fs.existsSync(reference)) {
        const refSheet = path.join(framesDir, 'reference-official-sheet.jpg');
        await run(FFMPEG, ['-y', '-i', reference, '-vf', 'fps=2/3,scale=480:-2,tile=5x2', '-frames:v', '1', refSheet], { windowsHide: true, timeout: 120000 });
        report.frames.push(refSheet);
        console.log('对照抽帧：' + refSheet);
      }
    }
  } finally {
    await pool.close().catch(error => console.error('关闭浏览器失败：' + error.message));
    report.finishedAt = new Date().toISOString();
    const file = path.join(evidence, 'live-no-watermark-probe.json');
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    console.log('报告：' + file);
  }
}

main().catch(error => { console.error('实测失败：' + (error && error.stack || error)); process.exitCode = 1; });
