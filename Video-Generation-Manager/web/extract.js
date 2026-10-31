'use strict';
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = (name) => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
const state = { sessionId: '', videos: [], busy: false, mode: 'session', history: [] };
let noticeTimer;

function notice(message, error = false) {
  const node = $('#notice');
  node.textContent = message;
  node.classList.toggle('error', Boolean(error));
  node.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { node.hidden = true; }, error ? 12000 : 5000);
}

function log(line) {
  const card = $('#log-card');
  const panel = $('#extract-log');
  if (!card || !panel) return;
  card.hidden = false;
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  panel.textContent += '[' + stamp + '] ' + line + '\n';
  panel.scrollTop = panel.scrollHeight;
}

async function api(url, options = {}, timeoutMs = 150000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    let data = null;
    try { data = await response.json(); } catch { throw new Error('服务返回了无效响应（HTTP ' + response.status + '）'); }
    if (!response.ok) throw new Error(data.error || ('请求失败：' + response.status));
    return data;
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('等待超时。检测要先打开对话页，再逐条解析无水印地址；如果账号窗口停在人工验证上，请先在窗口里完成验证再重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loadAccounts() {
  const select = $('#extract-account');
  const hint = $('#extract-account-hint');
  try {
    const data = await api('/api/extract/accounts', {}, 20000);
    $('#service-status').textContent = '服务已连接';
    document.querySelector('.header-status')?.classList.remove('offline');
    const current = select.value;
    select.innerHTML = '<option value="">自动 · 第一个可用豆包账号</option>' + data.accounts.map((account) =>
      '<option value="' + esc(account.id) + '">' + esc(account.name) + (account.enabled ? '' : '（已停用）') + (account.group ? ' · ' + esc(account.group) : '') + '</option>').join('');
    if (data.accounts.some((account) => account.id === current)) select.value = current;
    hint.textContent = data.accounts.length ? ('共 ' + data.accounts.length + ' 个豆包账号') : '还没有豆包账号：请先到「账号管理」添加并登录';
    if ($('#extract-downloads-hint')) $('#extract-downloads-hint').textContent = data.downloads ? ('下载目录：' + data.downloads) : '';
    $('#open-downloads').hidden = false;
  } catch (error) {
    $('#service-status').textContent = '服务未连接';
    document.querySelector('.header-status')?.classList.add('offline');
    hint.textContent = error.message;
  }
}

function renderResults(data, mode = 'session') {
  const card = $('#extract-result');
  const list = $('#extract-list');
  state.sessionId = data.sessionId || data.recordId || '';
  state.mode = mode;
  state.videos = data.videos || [];
  card.hidden = false;
  const summary = data.summary || { total: state.videos.length, unwatermarked: 0 };
  $('#extract-summary').textContent = '对话里检测到 ' + summary.total + ' 条视频 · 无水印通道 ' + summary.unwatermarked + ' 条 · 账号 ' + (data.account?.name || '—') + (data.generating ? ' · 这个对话还在生成中' : '');
  list.innerHTML = state.videos.map((video, index) => {
    const stream = (mode === 'history' ? '/api/extract/history/stream?recordId=' : '/api/extract/stream?sessionId=') + encodeURIComponent(state.sessionId) + '&key=' + encodeURIComponent(video.key);
    const chips = [];
    if (video.width && video.height) chips.push(video.width + '×' + video.height);
    if (video.duration) chips.push(Number(video.duration).toFixed(2) + ' 秒');
    if (video.videoId) chips.push('vid ' + String(video.videoId).slice(-6));
    chips.push(video.role === 'assistant' ? 'AI 回复' : '对话消息');
    return '<article class="extract-item" data-index="' + index + '">' +
      '<div class="extract-item-head"><h3>视频 ' + (index + 1) + '<small> #' + esc(String(video.messageId || '').slice(-8) || '未知消息') + '</small></h3>' +
      '<span class="extract-tag ' + (video.unwatermarked ? '' : 'warn') + '">' + esc(video.methodLabel || '未识别') + '</span></div>' +
      (video.downloadable ? '<video preload="metadata" playsinline controls src="' + stream + '"></video>' : '') +
      '<div class="extract-meta-line">' + chips.map((chip) => '<span>' + esc(chip) + '</span>').join('') + '</div>' +
      (video.text ? '<p class="extract-text">' + esc(video.text) + '</p>' : '') +
      (video.note ? '<p class="extract-note">' + esc(video.note) + '</p>' : '') +
      '<div class="extract-actions"><button class="primary" type="button" data-action="download"' + (video.downloadable ? '' : ' disabled') + '>' + icon('download') + '下载原片</button>' +
      '<button type="button" data-action="copy"' + (video.downloadable ? '' : ' disabled') + '>' + icon('copy') + '复制直链</button>' +
      '<span class="extract-status" data-status></span></div></article>';
  }).join('');
}

async function scan(event) {
  event.preventDefault();
  if (state.busy) return;
  const form = event.currentTarget;
  const url = String(form.elements.url.value || '').trim();
  if (!url) { notice('先把豆包对话地址粘贴进来', true); return; }
  const button = $('#scan-button');
  const label = button.querySelector('span');
  state.busy = true;
  button.disabled = true;
  const started = Date.now();
  label.textContent = '正在检测…';
  $('#extract-meta').dataset.busy = '1';
  log('开始检测：' + url);
  const ticker = setInterval(() => {
    label.textContent = '正在检测 ' + Math.round((Date.now() - started) / 1000) + 's';
  }, 900);
  try {
    const data = await api('/api/extract/scan', { method: 'POST', body: JSON.stringify({ url, accountId: form.elements.accountId.value || '' }) }, 170000);
    renderResults(data);
    const summary = data.summary || { total: 0, unwatermarked: 0 };
    log('检测完成：共 ' + summary.total + ' 条视频，其中 ' + summary.unwatermarked + ' 条走通无水印通道');
    log('检测窗口 5 秒后自动关闭并释放浏览器资源；预览和下载用已缓存的登录凭据，不受影响');
    await loadHistory();
    if (summary.total > summary.unwatermarked) log('提示：有 ' + (summary.total - summary.unwatermarked) + ' 条只拿到页面地址，可能是消息缺少 message-id，或者官方原片接口没有返回');
    notice('检测完成：' + summary.total + ' 条视频');
  } catch (error) {
    log('✘ 检测失败：' + error.message);
    notice(error.message, true);
  } finally {
    clearInterval(ticker);
    state.busy = false;
    button.disabled = false;
    label.textContent = '检测视频';
  }
}

async function downloadItem(card) {
  const index = Number(card.dataset.index);
  const video = state.videos[index];
  if (!video) return;
  const button = card.querySelector('[data-action="download"]');
  const status = card.querySelector('[data-status]');
  button.disabled = true;
  status.textContent = '正在下载并校验 MP4…';
  log('下载视频 ' + (index + 1) + '（' + (video.methodLabel || '') + '）');
  try {
    const endpoint = state.mode === 'history' ? '/api/extract/history/download' : '/api/extract/download';
    const payload = state.mode === 'history'
      ? { recordId: state.sessionId, key: video.key }
      : { sessionId: state.sessionId, key: video.key };
    const result = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) }, 300000);
    const size = result.size ? (result.size / 1048576).toFixed(1) + ' MB' : '';
    status.innerHTML = '已保存 <a href="/api/downloads/file?name=' + encodeURIComponent(result.name) + '">' + esc(result.name) + '</a> ' + esc(size) + (result.duration ? ' · ' + Number(result.duration).toFixed(2) + ' 秒' : '');
    log('✔ 已保存 ' + result.name + '（' + (result.size ? (result.size / 1048576).toFixed(1) + ' MB' : '大小未知') + '）');
    notice('无水印原片已保存：' + result.name);
  } catch (error) {
    status.textContent = '下载失败：' + error.message;
    log('✘ 下载失败：' + error.message);
    notice(error.message, true);
  } finally {
    button.disabled = false;
  }
}

$('#extract-form').addEventListener('submit', scan);
$('#refresh-accounts').addEventListener('click', loadAccounts);
$('#clear-log').addEventListener('click', () => { $('#extract-log').textContent = ''; $('#log-card').hidden = true; });
$('#open-downloads').addEventListener('click', async (event) => {
  event.preventDefault();
  try { await api('/api/reveal', { method: 'POST', body: '{}' }, 20000); notice('已在文件管理器打开下载目录'); }
  catch (error) { notice(error.message, true); }
});
$('#extract-list').addEventListener('click', (event) => {
  const card = event.target.closest('.extract-item');
  if (!card) return;
  const action = event.target.closest('[data-action]');
  if (!action) return;
  if (action.dataset.action === 'download') return void downloadItem(card);
  if (action.dataset.action === 'copy') {
    const video = state.videos[Number(card.dataset.index)];
    if (!video) return;
    navigator.clipboard.writeText(video.url).then(() => notice('无水印直链已复制（有效期有限，尽快下载）')).catch(() => notice('复制失败，可以直接点下载原片', true));
  }
});

// 顶栏主题菜单：和其他页面保持一致。
(function themeSwitch() {
  const button = $('#theme-switch');
  const menu = $('#theme-menu');
  if (!button || !menu) return;
  const list = [['mint', '薄荷花园'], ['sky', '晴空来信'], ['peach', '杏桃午后'], ['aurora', '极光夜航'], ['sakura', '樱雾'], ['midnight', '午夜极光'], ['graphite', '石墨暖光']];
  const dark = new Set(['midnight', 'graphite']);
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.scheme = dark.has(theme) ? 'dark' : 'light';
    const meta = document.querySelector('meta[name=color-scheme]');
    if (meta) meta.content = document.documentElement.dataset.scheme;
    try { localStorage.setItem('creative-desk-theme', theme); } catch { /* 忽略存储失败 */ }
    menu.querySelectorAll('[data-theme-pick]').forEach((item) => item.setAttribute('aria-current', String(item.dataset.themePick === theme)));
  };
  menu.innerHTML = list.map(([key, name]) => '<button type="button" class="theme-swatch" role="menuitem" data-theme-pick="' + key + '"><span class="swatch" data-swatch="' + key + '"></span>' + name + '</button>').join('') + '<a class="theme-more" href="/settings#appearance">更多外观设置</a>';
  try { const saved = localStorage.getItem('creative-desk-theme'); if (saved) apply(saved); } catch { /* 忽略 */ }
  button.addEventListener('click', () => {
    if (menu.hidden) { menu.hidden = false; button.setAttribute('aria-expanded', 'true'); }
    else { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('click', (event) => { if (!menu.hidden && !event.target.closest('.theme-switch')) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); } });
  menu.addEventListener('click', (event) => {
    const pick = event.target.closest('[data-theme-pick]');
    if (!pick) return;
    apply(pick.dataset.themePick);
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  });
})();

loadAccounts();

function renderHistory(records) {
  state.history = Array.isArray(records) ? records : [];
  const list = $('#history-list');
  const summary = $('#history-summary');
  if (!list) return;
  if (!state.history.length) {
    summary.textContent = '还没有检测记录：检测一次之后这里会留下可回溯的快照';
    list.innerHTML = '<div class="extract-history-empty">记录会保存对话地址、使用的账号、解析出的视频和下载结果，最多保留最近 120 条。</div>';
    return;
  }
  summary.textContent = '共 ' + state.history.length + ' 条检测记录 · 点「查看」可以回看当时的解析结果并重新下载';
  list.innerHTML = '<table><thead><tr><th>时间</th><th>对话</th><th>账号</th><th>视频</th><th>下载</th><th></th></tr></thead><tbody>' +
    state.history.map((record) => {
      const at = new Date(record.at).toLocaleString('zh-CN', { hour12: false });
      const totals = record.summary || {};
      const label = record.title || record.url;
      const count = String(totals.total ?? record.videoCount ?? 0) + ' 条 / 无水印 ' + String(totals.unwatermarked ?? 0);
      return '<tr data-record="' + esc(record.id) + '"><td>' + esc(at) + '</td>' +
        '<td><strong title="' + esc(record.url) + '">' + esc(label) + '</strong><small>' + esc(record.url) + '</small></td>' +
        '<td>' + esc(record.accountName || '—') + '</td><td>' + esc(count) + '</td>' +
        '<td>' + esc(String(record.downloads || 0)) + ' 次</td>' +
        '<td><div class="row-actions"><button type="button" data-history-action="open">查看</button>' +
        '<button type="button" data-history-action="rescan">重新检测</button>' +
        '<button type="button" class="danger" data-history-action="remove">删除</button></div></td></tr>';
    }).join('') + '</tbody></table>';
}

async function loadHistory() {
  try {
    const data = await api('/api/extract/history', {}, 20000);
    renderHistory(data.records);
  } catch (error) {
    const summary = $('#history-summary');
    if (summary) summary.textContent = '读取检测记录失败：' + error.message;
  }
}

async function openHistory(id) {
  const data = await api('/api/extract/history/' + encodeURIComponent(id), {}, 20000);
  const record = data.record;
  renderResults({
    recordId: record.id,
    title: record.title,
    account: { name: record.accountName },
    conversationURL: record.conversationURL,
    videos: record.videos,
    summary: record.summary,
    generating: false,
  }, 'history');
  log('打开检测记录 ' + record.id.slice(0, 8) + '（' + new Date(record.at).toLocaleString('zh-CN', { hour12: false }) + '）');
  $('#extract-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function removeHistory(id) {
  if (!window.confirm('删除这条检测记录？已经在下载目录里的文件不会被删掉。')) return;
  await api('/api/extract/history/' + encodeURIComponent(id), { method: 'DELETE' }, 20000);
  notice('已删除这条检测记录');
  await loadHistory();
}

async function guardHistory(promise) {
  try { await promise; } catch (error) { notice(error.message, true); }
}

$('#history-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-history-action]');
  const row = event.target.closest('[data-record]');
  if (!button || !row) return;
  const id = row.dataset.record;
  const action = button.dataset.historyAction;
  if (action === 'open') return void guardHistory(openHistory(id));
  if (action === 'remove') return void guardHistory(removeHistory(id));
  if (action === 'rescan') {
    const record = state.history.find((item) => item.id === id);
    if (!record) return;
    $('#conversation-url').value = record.url;
    if (record.accountId) {
      const select = $('#extract-account');
      if ([...select.options].some((option) => option.value === record.accountId)) select.value = record.accountId;
    }
    $('#extract-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    notice('已填入这条记录的地址和账号，点「检测视频」重新解析');
  }
});

$('#clear-history').addEventListener('click', () => guardHistory((async () => {
  if (!state.history.length) { notice('还没有检测记录'); return; }
  if (!window.confirm('清空全部检测记录？下载目录里的文件不会被删掉。')) return;
  await api('/api/extract/history/clear', { method: 'POST', body: '{}' }, 20000);
  notice('检测记录已清空');
  await loadHistory();
})()));

loadHistory();
