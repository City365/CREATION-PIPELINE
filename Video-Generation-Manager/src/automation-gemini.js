'use strict';
// Gemini（Google AI Pro/Ultra）视频生成：会员成片本身不带水印，只做
// 开启视频模式 → 设画幅 → 提交提示词 → 等新视频 → 下载并校验，不走去水印流程。
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { firstVisible } = require('./automation');
const { downloadVideo, validateMP4 } = require('./download');

const UI = {
  editor: 'rich-textarea [contenteditable="true"], [contenteditable="true"], textarea',
  tools: '[aria-label="Upload & tools"], [aria-label="Add files"]',
  videoTool: '[role="menuitemcheckbox"]:has-text("Create video")',
  videoChip: '[aria-label="Deselect Videos"]',
  aspect: '[aria-label^="Aspect ratio"]',
  send: '[aria-label="Send message"]',
  download: '[aria-label="Download video"]'
};

// 序列化进页面执行：只读 DOM。
function readGeminiState() {
  const text = document.body?.innerText || '';
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const videos = [...document.querySelectorAll('video')].filter(visible).map(video => ({
    src: video.currentSrc || video.getAttribute('src') || video.querySelector('source')?.src || '',
    poster: video.getAttribute('poster') || '',
    ready: video.readyState >= 1,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    width: video.videoWidth || null,
    height: video.videoHeight || null
  }));
  return {
    url: location.href,
    conversationURL: (location.pathname.match(/^\/app\/([\w-]+)/) || [])[1] ? location.origin + location.pathname : '',
    login: /accounts\.google\.com/.test(location.href) || [...document.querySelectorAll('a,button')].some(e => visible(e) && /^(登录|Sign in)$/i.test((e.innerText || '').trim())),
    videoMode: Boolean(document.querySelector('[aria-label="Deselect Videos"]')),
    videos,
    generating: /正在生成|生成中|Generating|Creating your video/i.test(text) || Boolean(document.querySelector('[aria-label*="停止"], [data-testid*="stop"]')),
    complete: /视频已生成|Here(?:'|’)s your video|Your video is ready/i.test(text),
    blocked: /内容政策|无法生成|违反|can(?:'|’)t help with that|content policy|limit reached|额度/i.test(text),
    text: text.slice(-4000)
  };
}

async function waitForGeminiReady(page, signal) {
  const deadline = Date.now() + 60000;
  let retried = false;
  while (Date.now() < deadline) {
    signal?.throwIfAborted?.();
    const state = await page.evaluate(readGeminiState);
    if (state.login) throw new Error('Gemini 尚未登录：请在账号窗口完成 Google 登录后重新提交');
    if (/not currently supported in your country|isn't currently supported/i.test(state.text)) {
      if (!retried) {
        retried = true;
        await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(4000);
        continue;
      }
      throw new Error('Gemini 在当前网络出口不可用（地区限制）。请开启代理，或在系统管理里配置 HTTP 代理后重试。');
    }
    if (await page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"], textarea').first().count()) return state;
    await page.waitForTimeout(1000);
  }
  throw new Error('Gemini 页面加载超时：' + page.url());
}

async function closeOverlays(page) {
  for (let i = 0; i < 3; i += 1) {
    if (!await page.locator('.cdk-overlay-backdrop-showing').count()) return;
    await page.keyboard.press('Escape');
    await wait(600);
  }
}

async function ensureVideoMode(page, selectors, log, screenshotPath) {
  const chip = page.locator(selectors.videoChip || UI.videoChip).first();
  if (await chip.count() && await chip.isVisible().catch(() => false)) return;
  const editor = () => page.locator(selectors.editor || UI.editor).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await closeOverlays(page);
    // 工具按钮只在输入框聚焦后才出现，且页面刚加载时可能还没挂上事件。
    await editor().click({ force: true }).catch(() => {});
    await wait(700);
    const tools = page.locator(selectors.tools || UI.tools).first();
    if (await tools.count() && await tools.isVisible().catch(() => false)) {
      await tools.click({ force: true }).catch(() => {});
      await wait(900);
    }
    let item = page.locator(selectors.videoTool || UI.videoTool).first();
    if (!await item.count()) {
      const more = page.locator('.cdk-overlay-pane [role="menuitem"]:has-text("More tools"), [role="menuitem"]:has-text("More tools")').first();
      if (await more.count() && await more.isVisible().catch(() => false)) {
        await more.click().catch(() => {});
        await wait(900);
      }
      item = page.locator(selectors.videoTool || UI.videoTool).first();
    }
    if (await item.count() && await item.isVisible().catch(() => false)) {
      await item.click();
      await wait(1600);
      // 首次开视频模式会弹「Create videos With Gemini Omni」，点 Try it 关掉。
      const intro = page.locator('.cdk-overlay-pane:has-text("Create videos"), .cdk-overlay-pane:has-text("With Gemini Omni")').first();
      if (await intro.count() && await intro.isVisible().catch(() => false)) {
        const tryIt = intro.locator('button:has-text("Try it")').first();
        if (await tryIt.count()) await tryIt.click(); else await page.keyboard.press('Escape');
        await wait(1800);
      }
      await closeOverlays(page);
      if (await page.locator(UI.videoChip).first().count()) {
        log('已开启 Gemini 视频模式');
        return;
      }
    }
    await page.keyboard.press('Escape').catch(() => {});
    await wait(1200);
  }
  if (screenshotPath) await page.screenshot({ path: screenshotPath }).catch(() => {});
  throw new Error('没有找到 Create video 入口（已重试 3 次），日志截图见下载目录 gemini-failure.png');
}

async function uploadGeminiReferences(page, files, selectors, signal, update) {
  if (!files.length) return;
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted();
    update({ status: 'uploading', message: '上传参考图 ' + (index + 1) + '/' + files.length, progress: 20 });
    const before = await page.locator('img[alt="attachment"]').count();
    await closeOverlays(page);
    const tools = page.locator(selectors.tools || UI.tools).first();
    if (await tools.count() && await tools.isVisible().catch(() => false)) {
      await tools.click({ force: true }).catch(() => {});
      await wait(700);
    }
    const item = page.locator('.cdk-overlay-pane [role="menuitem"]:has-text("Upload files"), [role="menuitem"]:has-text("Upload files"), button:has-text("Upload files")').first();
    if (!await item.count()) throw new Error('没有找到 Upload files 入口');
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 });
    await item.click();
    const chooser = await chooserPromise;
    await chooser.setFiles([file]);
    const deadline = Date.now() + 60000;
    let uploaded = false;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (await page.locator('img[alt="attachment"]').count() > before) { uploaded = true; break; }
      await wait(400);
    }
    if (!uploaded) throw new Error('参考图上传超时：' + path.basename(file));
  }
  await wait(800);
  // 上传过程中视频模式可能被折叠，确认一次。
  if (!await page.locator(UI.videoChip).first().count()) throw new Error('上传参考图后视频模式失效，请重试');
}

async function applyGeminiOptions(page, task, selectors) {
  const proof = { requested: { model: task.model || '', ratio: task.ratio || '', duration: task.duration ?? null }, applied: {} };
  if (task.duration != null) throw new Error('Gemini 视频模式没有时长选项，请在任务里留空时长');
  if (task.model) throw new Error('Gemini 视频模式暂不支持指定模型，请留空模型');
  if (task.resolution) throw new Error('Gemini 视频模式没有清晰度选项，请留空分辨率');
  if (task.ratio) {
    const map = { '16:9': 'Landscape (16:9)', '9:16': 'Portrait (9:16)' };
    const label = map[task.ratio];
    if (!label) throw new Error('Gemini 只支持 16:9 和 9:16 两种画幅');
    const button = page.locator(selectors.aspect || UI.aspect).first();
    if (!await button.count()) throw new Error('没有找到画幅按钮');
    const current = await button.getAttribute('aria-label') || '';
    if (!current.includes(label.split(' ')[0])) {
      await button.click();
      await wait(700);
      const option = page.locator('.cdk-overlay-pane [role="menuitemradio"]').filter({ hasText: label }).first();
      if (!await option.count()) throw new Error('画幅菜单里没有 ' + label);
      await option.click();
      await wait(700);
    }
    const applied = await button.getAttribute('aria-label') || '';
    if (!applied.includes(label.split(' ')[0])) throw new Error('画幅回读不一致：' + applied);
    proof.applied.ratio = task.ratio;
  }
  return proof;
}

function createGeminiExecutor({ pool, store, downloads, ffprobe, getDispatcher }) {
  return async function execute(task, account, signal, update) {
    let page;
    let finished = false;
    try {
      page = await pool.taskPage(account, task.resume ? task.conversationURL : undefined);
      await page.waitForTimeout(2500);
      const selectors = { ...(account.selectors || {}) };
      const directory = typeof downloads === 'function' ? downloads() : downloads;
      signal.addEventListener('abort', () => { page?.close().catch(() => {}); }, { once: true });
      const log = message => update({ message, progress: 15 });
      const before = await waitForGeminiReady(page, signal);
      update({ message: 'Gemini 页面就绪', progress: 12 });

      if (!task.resume) {
        await ensureVideoMode(page, selectors, log, path.join(directory, 'gemini-failure.png'));
        await uploadGeminiReferences(page, task.references || [], selectors, signal, update);
        const parameters = await applyGeminiOptions(page, task, selectors);
        update({ parameters });
        const editor = await firstVisible(page, selectors.editor || UI.editor, 15000);
        await editor.click();
        await editor.fill(task.prompt);
        update({ status: 'submitting', message: '提交提示词到 Gemini', progress: 10 });
        const send = page.locator(selectors.send || UI.send).first();
        if (await send.count() && await send.isVisible().catch(() => false)) await send.click();
        else await page.keyboard.press('Enter');
      }

      const baseline = new Set(before.videos.map(v => v.src));
      const deadline = Date.now() + task.timeoutSeconds * 1000;
      let state = before;
      let lastText = '';
      let stableSince = Date.now();
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        state = await page.evaluate(readGeminiState);
        if (state.login) throw new Error('Gemini 登录状态失效，请重新登录');
        if (state.conversationURL) update({ conversationURL: state.conversationURL, submittedAt: task.submittedAt || new Date().toISOString() });
        if (state.text !== lastText) { lastText = state.text; stableSince = Date.now(); }
        update({ status: 'generating', message: state.generating ? 'Gemini 正在生成视频' : '等待 Gemini 返回视频', progress: 35 });
        const fresh = state.videos.filter(v => v.src && !baseline.has(v.src));
        if (fresh.length) { state.chosen = fresh[fresh.length - 1]; break; }
        if (state.blocked) throw new Error('Gemini 拒绝或失败：' + state.text.slice(-400));
        if (!state.generating && Date.now() - stableSince > 45000 && state.videos.length === before.videos.length) {
          throw new Error('Gemini 已停止响应但没有出现新视频；请检查账号的视频生成权限或额度');
        }
        await wait(3000);
      }
      if (!state.chosen) throw new Error('等待 Gemini 视频生成超时；未自动重复提交');

      update({ status: 'downloading', message: '下载 Gemini 成片并校验', progress: 90 });
      const destination = path.join(directory, task.id + '.mp4');
      const result = await downloadGeminiResult({ page, src: state.chosen.src, destination, signal, ffprobe, getDispatcher });
      finished = true;
      return { ...result, file: path.basename(result.path), watermarkMethod: 'gemini-member-no-watermark', ownership: { conversationURL: state.conversationURL || '' }, downloadedAt: new Date().toISOString() };
    } finally {
      if (finished && page && !page.isClosed()) await page.close().catch(() => {});
    }
  };
}

async function downloadGeminiResult({ page, src, destination, signal, ffprobe, getDispatcher }) {
  // 先点页面上的 Download video（会员下载入口），失败再直接抓视频地址。
  const video = page.locator('video').last();
  const card = video.locator('xpath=ancestor::*[.//button[@aria-label="Download video"]][1]');
  if (await card.count()) {
    try {
      await card.hover();
      await page.waitForTimeout(700);
      const button = card.locator('[aria-label="Download video"]').first();
      const pending = page.waitForEvent('download', { timeout: 180000 });
      await button.click();
      const download = await pending;
      const temporary = destination + '.part';
      await download.saveAs(temporary);
      const checked = await validateMP4(temporary, ffprobe);
      await fs.promises.rename(temporary, destination);
      return { path: path.resolve(destination), size: fs.statSync(destination).size, duration: checked.duration };
    } catch (error) {
      await fs.promises.unlink(destination + '.part').catch(() => {});
      if (!/^https:/i.test(src)) throw new Error('下载按钮失败且没有可直连的视频地址：' + error.message);
    }
  }
  if (!/^https:/i.test(src)) throw new Error('没有找到可下载的视频地址');
  return downloadVideo({ url: src, page, destination, signal, ffprobe, getDispatcher });
}

module.exports = { createGeminiExecutor, readGeminiState, ensureVideoMode, applyGeminiOptions, UI };
