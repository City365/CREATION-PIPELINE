'use strict';
// 豆包视频提取：给一个对话地址，扫描对话里已经生成好的视频，
// 复用管理器既有的无水印通道（插件 fallback_api 原片 → 官方节点接口 → 官方播放接口 → 页面标记地址），
// 然后把无水印原片下载到本地下载目录。任务队列完全不参与，账号窗口和它共用。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { scanConversationVideos } = require('./adapters/conversation-scan');
const { resolveFallbackVideo, hasWatermark } = require('./adapters/doubao-fallback');
const { downloadVideo } = require('./download');

const resolverSource = fs.readFileSync(path.join(__dirname, 'adapters', 'doubao-official-resolver.js'), 'utf8');
const CONVERSATION_PATH = /^\/chat\/[\w-]+$/;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_VIDEOS = 40;
// 检测完就把对话页收掉：窗口挂在后台会一直占内存，整个管理器会越来越卡。
const PAGE_RELEASE_DELAY_MS = 5000;

const METHOD_LABELS = {
  'fallback-api-unwatermarked': '无水印 · fallback 原片接口',
  'official-no-watermark': '无水印 · 官方节点接口',
  'official-video-endpoint': '无水印 · 官方播放接口',
  'explicit-no-watermark': '无水印 · 页面标记地址',
  'page-video': '页面视频（未确认无水印）',
  'unresolved': '未解析到直链',
};

function methodLabel(method) {
  return METHOD_LABELS[method] || method || '未识别';
}

function isUnwatermarked(method) {
  return method === 'fallback-api-unwatermarked' || method === 'official-no-watermark'
    || method === 'official-video-endpoint' || method === 'explicit-no-watermark';
}

function parseConversationUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); }
  catch { throw new Error('请输入完整的豆包对话地址，例如 https://www.doubao.com/chat/1234567890'); }
  if (!/(^|\.)doubao\.com$/i.test(url.hostname)) throw new Error('只支持豆包（doubao.com）的对话地址');
  if (!CONVERSATION_PATH.test(url.pathname)) throw new Error('这个地址不是对话页，应形如 https://www.doubao.com/chat/1234567890');
  return { href: url.origin + url.pathname };
}

function createExtractor({ pool, store, getDispatcher, ffprobe, downloads, history = null, resolveAccountId = null, isAccountBusy = null, budgetMs = 50000 }) {
  const sessions = new Map();

  // 候选顺序：页面指定的账号 → 任务记录里持有这个对话的账号 → 其余启用的账号。
  // 豆包会把别人的对话重定向回 /chat，所以自动模式必须能依次换账号试。
  function accountCandidates(accountId, conversationURL = '') {
    const accounts = store.list().filter(a => a.platform === 'doubao');
    if (!accounts.length) throw new Error('还没有豆包账号，请先到「账号管理」添加账号并完成登录');
    const wanted = String(accountId || '').trim();
    if (wanted) {
      const hit = accounts.find(a => a.id === wanted);
      if (!hit) throw new Error('这个账号不存在，或者不是豆包账号');
      return [hit];
    }
    const list = [];
    const push = (account) => { if (account && !list.some(item => item.id === account.id)) list.push(account); };
    if (conversationURL && typeof resolveAccountId === 'function') {
      const owner = String(resolveAccountId(conversationURL) || '').trim();
      push(accounts.find(a => a.id === owner));
    }
    accounts.filter(a => a.enabled !== false).forEach(push);
    accounts.forEach(push);
    return list.slice(0, 4);
  }

  function sweep() {
    const now = Date.now();
    for (const [id, session] of sessions) {
      // 页面释放是正常状态：检测结果和下载凭据都留在内存里，只有超时才清。
      if (now - session.at > SESSION_TTL_MS) {
        clearTimeout(session.releaseTimer);
        sessions.delete(id);
      }
    }
  }

  // 5 秒宽限到了：先关检测页；这个账号没在跑任务、也没有别的检测在用它，就连浏览器窗口一起收掉。
  function releaseSessionPage(session) {
    session.releaseTimer = null;
    const page = session.page;
    session.page = null;
    if (page && !page.isClosed()) page.close().catch(() => {});
    const busy = typeof isAccountBusy === 'function' ? Boolean(isAccountBusy(session.accountId)) : false;
    const inUse = [...sessions.values()].some(other => other !== session && other.accountId === session.accountId && other.page && !other.page.isClosed());
    if (!busy && !inUse && typeof pool.closeAccount === 'function') {
      Promise.resolve()
        .then(() => pool.closeAccount(session.accountId))
        .catch(() => { /* 窗口已经被用户手动关掉也没关系 */ });
    }
  }

  // 页面回收后下载/预览仍然要能过鉴权，所以先把 UA/Referer/Cookie 抓下来存住。
  async function captureAuth(page, urls) {
    const auth = {
      userAgent: await page.evaluate(() => navigator.userAgent).catch(() => 'Mozilla/5.0'),
      referer: page.url(),
      cookieByUrl: {},
    };
    for (const raw of [...new Set(urls.filter(Boolean))].slice(0, 20)) {
      try {
        const cookies = await page.context().cookies(raw);
        if (cookies.length) auth.cookieByUrl[raw] = cookies.map(cookie => cookie.name + '=' + cookie.value).join('; ');
      } catch { /* 拿不到就退回无 Cookie 下载 */ }
    }
    return auth;
  }

  function authHeaders(session, url) {
    const auth = session.auth;
    if (!auth) return null;
    const headers = { Referer: auth.referer, 'User-Agent': auth.userAgent };
    const cookie = auth.cookieByUrl ? auth.cookieByUrl[url] : '';
    if (cookie) headers.Cookie = cookie;
    return headers;
  }

  // 对话是虚拟列表：滚到顶会卸载后面的消息，所以一边滚动一边合并扫描结果。
  async function collectDomVideos(page, deadline) {
    const merged = new Map();
    const blend = (state) => {
      for (const item of (state && state.videos) || []) if (item.url && !merged.has(item.url)) merged.set(item.url, item);
    };
    const scroller = () => page.locator('[data-testid="message-list"] .scroller');
    blend(await page.evaluate(scanConversationVideos, { limit: 120 }).catch(() => null));
    for (let round = 0; round < 16 && Date.now() < deadline; round += 1) {
      const atTop = await scroller().evaluateAll(els => els.length === 0 || els.every(el => el.scrollTop <= 4)).catch(() => true);
      if (atTop) break;
      await scroller().evaluateAll(els => els.forEach(el => { el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight * 2.5); })).catch(() => {});
      await wait(420);
      blend(await page.evaluate(scanConversationVideos, { limit: 120 }).catch(() => null));
    }
    await scroller().evaluateAll(els => els.forEach(el => { el.scrollTop = el.scrollHeight; })).catch(() => {});
    await wait(600);
    blend(await page.evaluate(scanConversationVideos, { limit: 120 }).catch(() => null));
    return [...merged.values()];
  }

  // 豆包的视频卡片默认只有封面图 + 空播放器容器，<video> 要点了才挂载。
  // 所以还要从 React 节点里把每条消息的 video_id 挖出来，这才是对话里真正存在的视频。
  async function collectMediaVideos(page) {
    const ids = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-message-id]')]
      .map((element) => element.getAttribute('data-message-id')).filter(Boolean))]).catch(() => []);
    const entries = [];
    for (let index = 0; index < ids.length; index += 8) {
      const batch = ids.slice(index, index + 8);
      const inspected = await page.evaluate((messageIds) => {
        const api = window.__LOCAL_DOUBAO_RESOLVER__;
        if (!api || typeof api.inspectMessages !== 'function') return [];
        try {
          return (api.inspectMessages(messageIds) || []).map((item) => ({
            id: String(item.id || ''),
            videoIds: Array.isArray(item.videoIds) ? item.videoIds : [],
            media: (Array.isArray(item.media) ? item.media : []).slice(0, 2).map((media) => ({
              url: String((media && (media.url || media.cover || media.poster)) || '').slice(0, 300),
              width: Number(media && (media.width || media.vwidth)) || null,
              height: Number(media && (media.height || media.vheight)) || null,
            })),
          }));
        } catch { return []; }
      }, batch).catch(() => []);
      for (const message of inspected) {
        for (const videoId of (message.videoIds || [])) {
          entries.push({
            messageId: message.id, videoId: String(videoId), url: '', kind: 'video-card', ready: true,
            duration: null, width: message.media?.[0]?.width ?? null, height: message.media?.[0]?.height ?? null,
            poster: message.media?.[0]?.url || '', text: '', confirmedNoWatermark: false,
          });
        }
      }
    }
    return entries;
  }

  function mergeVideos(domItems, mediaItems) {
    const merged = [];
    const byMessage = new Map();
    for (const item of mediaItems) {
      const key = String(item.messageId || '') + '|' + String(item.videoId || '');
      if (!byMessage.has(key)) { byMessage.set(key, item); merged.push(item); }
    }
    for (const item of domItems) {
      const sameMessage = merged.find(entry => entry.messageId && entry.messageId === item.messageId);
      if (sameMessage) {
        sameMessage.url = item.url;
        sameMessage.poster = sameMessage.poster || item.poster || '';
        sameMessage.width = sameMessage.width || item.width;
        sameMessage.height = sameMessage.height || item.height;
        sameMessage.duration = item.duration;
        sameMessage.confirmedNoWatermark = Boolean(item.confirmedNoWatermark);
        sameMessage.ready = Boolean(item.ready);
        continue;
      }
      merged.push(item);
    }
    return merged;
  }

  async function resolveOfficialNode(page, messageId) {
    return page.evaluate(async (ids) => {
      const api = window.__LOCAL_DOUBAO_RESOLVER__;
      if (!api || typeof api.nodesForMessages !== 'function') return null;
      const nodes = await api.nodesForMessages(ids);
      for (const node of nodes) {
        try { const info = await api.downloadInfo(node); if (info && info.mainUrl) return { mainUrl: info.mainUrl, nodeId: info.nodeId || node }; }
        catch { /* 换下一个节点 */ }
      }
      return null;
    }, [messageId]).catch(() => null);
  }

  async function resolveOfficialPlayInfo(page, messageId) {
    const results = await page.evaluate(async (ids) => {
      const api = window.__LOCAL_DOUBAO_RESOLVER__;
      if (!api || typeof api.resolveMessageDownloads !== 'function') return null;
      try {
        const list = await api.resolveMessageDownloads(ids);
        return (list || []).map((entry) => ({
          messageId: entry.messageId, vid: entry.vid, endpoint: entry.endpoint,
          status: entry.status ?? null, code: entry.code ?? null, error: entry.error || '',
          urls: (entry.candidates || []).map((candidate) => ({
            url: String(candidate.url || ''), score: Number(candidate.score) || 0, accepted: Number(candidate.accepted) || 0,
          })),
        }));
      } catch (error) { return [{ error: String(error && error.message) }]; }
    }, [messageId]).catch(() => null);
    if (!results) return { url: '', diagnostics: [] };
    const flat = [];
    for (const entry of results) for (const candidate of (entry.urls || [])) {
      if (/^https:\/\//i.test(candidate.url) && !hasWatermark(candidate.url)) flat.push(candidate);
    }
    flat.sort((a, b) => (b.accepted - a.accepted) || (b.score - a.score));
    const diagnostics = results.map(entry => ({ vid: entry.vid, status: entry.status, code: entry.code, error: entry.error, candidates: (entry.urls || []).length }));
    return { url: flat.length ? flat[0].url : '', diagnostics };
  }

  async function resolveEntry(page, item, signal) {
    const messageId = String(item.messageId || '');
    const base = {
      key: String(item.messageId || '') + '|' + String(item.videoId || item.url || ''),
      messageId,
      videoId: item.videoId || '',
      role: item.role || 'unknown',
      url: item.url || '',
      kind: item.kind || 'video',
      duration: item.duration ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      poster: item.poster || '',
      text: item.text || '',
      ready: Boolean(item.ready),
      confirmedNoWatermark: Boolean(item.confirmedNoWatermark),
    };
    if (!/^\d{8,}$/.test(messageId)) {
      return { ...base, method: base.url ? 'page-video' : 'unresolved', note: '这条内容没有可用的 message-id，拿不到官方原片' };
    }
    const diagnostics = [];
    try {
      const fallback = await resolveFallbackVideo({ page, messageIds: [messageId], signal, getDispatcher });
      if (fallback.diagnostics) diagnostics.push({ method: 'fallback-api', results: fallback.diagnostics });
      if (fallback.url) return { ...base, url: fallback.url, method: 'fallback-api-unwatermarked', diagnostics };
    } catch (error) { diagnostics.push({ method: 'fallback-api', error: error.message }); }
    const node = await resolveOfficialNode(page, messageId);
    if (node && node.mainUrl) return { ...base, url: node.mainUrl, method: 'official-no-watermark', nodeId: node.nodeId || '', diagnostics };
    const playInfo = await resolveOfficialPlayInfo(page, messageId);
    if (playInfo.diagnostics.length) diagnostics.push({ method: 'official-play-info', results: playInfo.diagnostics });
    if (playInfo.url) return { ...base, url: playInfo.url, method: 'official-video-endpoint', diagnostics };
    if (base.url) return { ...base, method: base.confirmedNoWatermark ? 'explicit-no-watermark' : 'page-video', diagnostics };
    return { ...base, method: 'unresolved', note: '这条视频没有解析出可下载的直链：可能是封面占位还没加载出播放信息，换账号或稍后重试', diagnostics };
  }

  async function scan({ url, accountId, signal } = {}) {
    sweep();
    const target = parseConversationUrl(url);
    const candidates = accountCandidates(accountId, target.href);
    const deadline = Date.now() + budgetMs;
    const failures = [];
    const wantedPath = new URL(target.href).pathname.replace(/\/+$/, '');
    let page = null;
    let account = null;
    for (const candidate of candidates) {
      let attempt = null;
      try {
        attempt = await pool.taskPage(candidate, target.href);
        await attempt.waitForLoadState('domcontentloaded').catch(() => {});
        await attempt.waitForSelector('[data-testid="message-list"], [data-message-id], [data-testid="chat_input_input"]', { timeout: 20000 }).catch(() => {});
        await wait(800, undefined, { signal });
        const landedPath = new URL(attempt.url()).pathname.replace(/\/+$/, '');
        if (landedPath === wantedPath) { page = attempt; account = candidate; break; }
        failures.push(candidate.name + ' 被退回 ' + landedPath);
        await attempt.close().catch(() => {});
      } catch (error) {
        failures.push(candidate.name + ' 打开失败：' + error.message);
        if (attempt && !attempt.isClosed()) await attempt.close().catch(() => {});
      }
      if (String(accountId || '').trim()) break;
    }
    if (!page) throw new Error('这个对话在可用账号下都打不开（' + failures.join('；') + '）。请确认这个对话是哪个豆包账号生成的，在「使用账号」里指定它再试');
    try {
      await page.evaluate(resolverSource).catch(() => {});
      await wait(1200, undefined, { signal });
      const first = await page.evaluate(scanConversationVideos, { limit: 120 }).catch(() => null);
      if (first && first.captcha) throw new Error('这个对话要求人工验证：请先在账号窗口里完成验证，再回来重新检测');
      const domItems = await collectDomVideos(page, deadline);
      const mediaItems = await collectMediaVideos(page);
      const items = mergeVideos(domItems, mediaItems).slice(0, MAX_VIDEOS);
      if (!items.length) {
        const diagnosis = await page.evaluate(() => ({
          url: location.href, title: document.title,
          messages: document.querySelectorAll('[data-message-id]').length,
          videos: document.querySelectorAll('video').length,
          mediaCards: document.querySelectorAll('[class*="video"], [data-testid*="video"]').length,
          bodyHead: String((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 160),
        })).catch(() => null);
        throw new Error('这个对话里没有检测到视频。确认地址是视频生成的对话，或者等平台生成完成后再试｜诊断：' + JSON.stringify(diagnosis));
      }
      // 3 路并发解析，既压得住时间，也不会把页面接口打得太密。
      const resolved = new Array(items.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < items.length && Date.now() < deadline) {
          const index = cursor; cursor += 1;
          resolved[index] = await resolveEntry(page, items[index], signal).catch(error => ({
            key: String(items[index].messageId || '') + '|' + String(items[index].videoId || items[index].url || ''),
            messageId: String(items[index].messageId || ''), videoId: items[index].videoId || '', url: items[index].url || '',
            role: items[index].role || 'unknown', kind: items[index].kind || 'video', duration: items[index].duration ?? null,
            width: items[index].width ?? null, height: items[index].height ?? null, poster: items[index].poster || '',
            text: items[index].text || '', ready: Boolean(items[index].ready), method: 'unresolved', note: '解析失败：' + error.message,
          }));
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const videos = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = resolved[index] || {
          key: String(items[index].messageId || '') + '|' + String(items[index].videoId || items[index].url || ''),
          messageId: String(items[index].messageId || ''), videoId: items[index].videoId || '', url: items[index].url || '',
          role: items[index].role || 'unknown', kind: items[index].kind || 'video', duration: items[index].duration ?? null,
          width: items[index].width ?? null, height: items[index].height ?? null, poster: items[index].poster || '',
          text: items[index].text || '', ready: Boolean(items[index].ready), method: 'unresolved', note: '时间不够，这条只做到了识别；点重新检测可以再解析一次',
        };
        videos.push({
          ...item,
          methodLabel: methodLabel(item.method),
          unwatermarked: isUnwatermarked(item.method),
          downloadable: Boolean(item.url && /^https?:\/\//i.test(item.url)),
        });
      }
      const sessionId = crypto.randomUUID();
      const resolutions = new Map();
      for (const video of videos) resolutions.set(video.key, video);
      const auth = await captureAuth(page, videos.map(video => video.url));
      const conversationURL = page.url().split('?')[0];
      const unwatermarked = videos.filter(video => video.unwatermarked).length;
      const downloadable = videos.filter(video => video.downloadable).length;
      const summary = { total: videos.length, unwatermarked, downloadable, failed: videos.length - downloadable };
      const session = { page, historyId: sessionId, accountId: account.id, conversationURL, resolutions, auth, at: Date.now(), releaseTimer: null };
      session.releaseTimer = setTimeout(() => releaseSessionPage(session), PAGE_RELEASE_DELAY_MS);
      session.releaseTimer.unref?.();
      sessions.set(sessionId, session);
      if (history) {
        try {
          history.add({
            id: sessionId,
            url: target.href,
            conversationURL,
            accountId: account.id,
            accountName: account.name,
            title: first?.title || '',
            summary,
            videos: videos.map(video => ({
              key: video.key,
              messageId: video.messageId,
              videoId: video.videoId || '',
              method: video.method,
              methodLabel: video.methodLabel,
              unwatermarked: Boolean(video.unwatermarked),
              downloadable: Boolean(video.downloadable),
              url: video.url || '',
              duration: video.duration ?? null,
              width: video.width ?? null,
              height: video.height ?? null,
              poster: video.poster || '',
              text: String(video.text || '').slice(0, 80),
              note: video.note || '',
            })),
            auth,
            downloads: [],
          });
        } catch { /* 记录没写进去也不影响这次检测 */ }
      }
      return {
        sessionId,
        recordId: sessionId,
        account: { id: account.id, name: account.name },
        conversationURL,
        title: first?.title || '',
        messageCount: first?.messageCount || 0,
        generating: Boolean(first?.generating),
        videos,
        summary,
      };
    } catch (error) {
      if (page && !page.isClosed()) await page.close().catch(() => {});
      throw error;
    }
  }

  function sessionPage(session) {
    if (session.page && !session.page.isClosed()) return session.page;
    return null;
  }

  async function ensurePage(session) {
    const existing = sessionPage(session);
    if (existing) return existing;
    const account = store.get(session.accountId);
    if (!account) throw new Error('原来执行提取的账号已被删除，请重新检测');
    const page = await pool.taskPage(account, session.conversationURL);
    session.page = page;
    return page;
  }

  // 落盘统一走这里：页面还在就用页面取 cookies，页面已经收了就用缓存凭据。
  async function saveRemote({ url, headers, page, signal, messageId, name }) {
    const directory = typeof downloads === 'function' ? downloads() : downloads;
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const short = String(messageId || '').slice(-6) || crypto.randomBytes(3).toString('hex');
    const wanted = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    const base = wanted || ('豆包提取-' + stamp + '-' + short);
    let destination = path.join(directory, base + '.mp4');
    for (let index = 1; fs.existsSync(destination) && index < 100; index += 1) destination = path.join(directory, base + '-' + index + '.mp4');
    return downloadVideo({ url, page: page || undefined, destination, signal, ffprobe, allowLocal: false, getDispatcher, headers: headers || undefined });
  }

  function rememberDownload(recordId, entry, saved) {
    if (!history || !recordId) return;
    try {
      history.update(recordId, (record) => ({
        downloads: [...(record.downloads || []), { key: entry.key, name: saved.name, size: saved.size, duration: saved.duration, at: new Date().toISOString() }].slice(-20),
      }));
    } catch { /* 记录更新失败不影响下载结果 */ }
  }

  async function download({ sessionId, key, name, signal } = {}) {
    sweep();
    const session = sessions.get(String(sessionId || ''));
    if (!session) throw new Error('这次检测记录已经过期，请重新检测一次');
    const entry = session.resolutions.get(String(key || ''));
    if (!entry) throw new Error('这条视频不在本次检测结果里，请重新检测');
    if (!entry.url) throw new Error('这条视频还没解析出可下载的直链，先把上面的报错信息看一眼，换个账号或稍后重试');
    const headers = authHeaders(session, entry.url);
    let page = sessionPage(session);
    if (!headers && !page) page = await ensurePage(session);
    const result = await saveRemote({ url: entry.url, headers, page, signal, messageId: entry.messageId, name });
    const saved = {
      ok: true, name: path.basename(result.path), path: result.path, size: result.size, duration: result.duration,
      method: entry.method, methodLabel: methodLabel(entry.method), messageId: entry.messageId,
    };
    rememberDownload(session.historyId, entry, saved);
    return saved;
  }

  // 从检测记录里再下一次：直链有时效，过期后平台会返回 403，这里如实报出来让人重新检测。
  async function downloadFromHistory({ recordId, key, name, signal } = {}) {
    if (!history) throw new Error('检测记录功能没有启用');
    const record = history.get(recordId);
    if (!record) throw new Error('这条检测记录已经不存在了');
    const entry = (record.videos || []).find(video => video.key === String(key || ''));
    if (!entry) throw new Error('这条视频不在该检测记录里');
    if (!entry.url) throw new Error('这条视频当时没有解析出可下载的直链，重新检测一次再试');
    const auth = record.auth || null;
    let headers = null;
    if (auth) {
      headers = { Referer: auth.referer || record.url, 'User-Agent': auth.userAgent || 'Mozilla/5.0' };
      const cookie = auth.cookieByUrl ? auth.cookieByUrl[entry.url] : '';
      if (cookie) headers.Cookie = cookie;
    }
    const result = await saveRemote({ url: entry.url, headers, page: null, signal, messageId: entry.messageId, name });
    const saved = {
      ok: true, name: path.basename(result.path), path: result.path, size: result.size, duration: result.duration,
      method: entry.method, methodLabel: entry.methodLabel || methodLabel(entry.method), messageId: entry.messageId,
    };
    rememberDownload(record.id, entry, saved);
    return saved;
  }

  // 预览用：直链需要豆包的 cookie 和 referer，浏览器直接访问会被拒，这里由本地服务中转。
  async function streamTarget({ sessionId, key } = {}) {
    sweep();
    const session = sessions.get(String(sessionId || ''));
    if (!session) throw new Error('这次检测记录已经过期，请重新检测一次');
    const entry = session.resolutions.get(String(key || ''));
    if (!entry) throw new Error('这条视频不在本次检测结果里，请重新检测');
    if (!entry.url) throw new Error('这条视频还没解析出可播放的直链');
    const cached = authHeaders(session, entry.url);
    if (cached) return { url: entry.url, headers: cached, name: entry.messageId || 'video' };
    const page = await ensurePage(session);
    const cookies = await page.context().cookies(entry.url).catch(() => []);
    const headers = { Referer: page.url(), 'User-Agent': await page.evaluate(() => navigator.userAgent).catch(() => 'Mozilla/5.0') };
    if (cookies.length) headers.Cookie = cookies.map(cookie => cookie.name + '=' + cookie.value).join('; ');
    return { url: entry.url, headers, name: entry.messageId || 'video' };
  }

  function close() {
    for (const session of sessions.values()) {
      clearTimeout(session.releaseTimer);
      if (session.page && !session.page.isClosed()) session.page.close().catch(() => {});
    }
    sessions.clear();
  }

  // 历史记录里的直链也可以预览，走同一条中转通道。
  async function streamFromHistory({ recordId, key } = {}) {
    if (!history) throw new Error('检测记录功能没有启用');
    const record = history.get(recordId);
    if (!record) throw new Error('这条检测记录已经不存在了');
    const entry = (record.videos || []).find(video => video.key === String(key || ''));
    if (!entry || !entry.url) throw new Error('这条记录里没有可播放的直链，重新检测一次再试');
    const auth = record.auth || null;
    const headers = { Referer: auth?.referer || record.url, 'User-Agent': auth?.userAgent || 'Mozilla/5.0' };
    const cookie = auth?.cookieByUrl ? auth.cookieByUrl[entry.url] : '';
    if (cookie) headers.Cookie = cookie;
    return { url: entry.url, headers, name: entry.messageId || 'video' };
  }

  return { scan, download, downloadFromHistory, streamTarget, streamFromHistory, close, parseConversationUrl, methodLabel };
}

module.exports = { createExtractor, parseConversationUrl, methodLabel };
