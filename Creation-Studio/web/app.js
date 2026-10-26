'use strict';

/* ------------------------------------------------------------------ utils */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const enc = encodeURIComponent;

function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v >= 10 ? 0 : 1)) + ' ' + units[i];
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.round(s / 60) + ' 分钟前';
  if (s < 86400) return Math.round(s / 3600) + ' 小时前';
  return Math.round(s / 86400) + ' 天前';
}

function toast(message, isError = false) {
  const host = $('#toasts');
  const text = String(message == null ? '' : message).trim();
  if (!host || !text) return;
  // 同一句话重复出现时只保留一条，避免连续保存叠出一串相同提示。
  for (const node of [...host.children]) {
    if (node.textContent === text) node.remove();
  }
  while (host.children.length >= 3) host.firstElementChild.remove();
  const box = document.createElement('div');
  box.className = 'toast' + (isError ? ' err' : '');
  box.textContent = text;
  host.appendChild(box);
  setTimeout(() => {
    box.classList.add('is-out');
    setTimeout(() => box.remove(), 180);
  }, isError ? 6000 : 3200);
}

// 脚本出错时不要静默变砖：顶部红条 + 一键刷新，方便一眼看出问题
function showFatal(message) {
  let bar = $('#fatal-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fatal-bar';
    bar.className = 'fatal-bar';
    document.body.appendChild(bar);
  }
  const text = String(message || '未知错误').slice(0, 300);
  bar.innerHTML = `<span class="fatal-msg">页面脚本出错：${esc(text)}</span>
    <button type="button" class="h3-btn h3-btn-sm" onclick="location.reload()">刷新页面</button>
    <button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" onclick="this.parentNode.remove()">收起</button>`;
}

window.addEventListener('beforeunload', () => { try { studioBeacon(); } catch { /* ignore */ } });
window.addEventListener('error', (event) => {
  if (!event || !event.message) return;
  if (event.message === 'Script error.') return;
  showFatal(event.message + (event.lineno ? `（第 ${event.lineno} 行）` : ''));
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event && event.reason;
  const message = reason && (reason.message || reason);
  if (message) showFatal('异步请求失败：' + message);
});

const state = {
  config: null,
  workflows: [],
  jobs: [],
  stats: {},
  prompt: null,
  channelTypes: {},
  channels: { llm: [], image: [], video: [] },
  route: 'studio',
  volume: { level: 60, muted: false },
  compare: { left: '', right: '', sync: true },
  script: null,
  scriptChats: null,
  scriptChat: null,
  scriptChatId: '',
  scriptPresets: null,
  scriptPreset: 'free',
  scriptSending: false,
  scriptTyping: false,
  scriptTimer: null,
  scriptPending: '',
  assets: null,
  media: null,
  batch: null,
  busy: false,
  lastJobId: null,
  image: {
    channelId: '',
    tab: 'generate',
    prompt: '',
    size: 'auto',
    count: 1,
    refs: [],
    source: null,
    reverseText: '',
    results: [],
    busy: false,
  },
  studio: {
    workflowId: '',
    channelId: '',
    images: [],
    audios: [],
    prompt: '',
    aspectRatio: '9:16 (Portrait Widescreen)',
    resolution: '',
    megapixels: 0,
    megapixels2: 0,
    duration: 10,
    seed: '',
    count: 1,
    promptMode: 'tags',
    warnings: [],
  },
};


let studioSaveTimer = null;
function studioProjectId() { return state.projectId || 'default'; }
function studioKey(project) { return 'h3.studio.' + (project || studioProjectId()); }
function studioSnapshot() {
  const s = state.studio;
  return {
    workflowId: s.workflowId, prompt: s.prompt, promptMode: s.promptMode,
    images: s.images || [], audios: s.audios || [],
    aspectRatio: s.aspectRatio, resolution: s.resolution,
    megapixels: s.megapixels, megapixels2: s.megapixels2,
    duration: s.duration, seed: s.seed, count: s.count,
    updated: Date.now(),
  };
}
function studioApply(saved) {
  const s = state.studio;
  if (!saved || typeof saved !== 'object') return;
  if (saved.workflowId && workflowById(saved.workflowId)) {
    s.workflowId = saved.workflowId;
    s.channelId = (workflowById(saved.workflowId) || {}).channelId || s.channelId;
  }
  if (typeof saved.prompt === 'string') s.prompt = saved.prompt;
  if (saved.promptMode === 'tags' || saved.promptMode === 'code') s.promptMode = saved.promptMode;
  if (Array.isArray(saved.images)) s.images = saved.images.filter(Boolean);
  if (Array.isArray(saved.audios)) s.audios = saved.audios.filter(Boolean);
  for (const key of ['aspectRatio', 'resolution', 'seed']) if (saved[key] !== undefined) s[key] = saved[key];
  for (const key of ['megapixels', 'megapixels2', 'duration', 'count']) if (Number.isFinite(saved[key])) s[key] = saved[key];
  s._restored = true;
}
function studioBeacon() {
  try {
    const projectId = studioProjectId();
    const blob = new Blob([JSON.stringify({ projectId, state: studioSnapshot() })], { type: 'text/plain' });
    navigator.sendBeacon('/api/studio/state', blob);
  } catch { /* ignore */ }
}
function studioFlush(project) {
  const projectId = project || studioProjectId();
  const snapshot = studioSnapshot();
  try { localStorage.setItem(studioKey(projectId), JSON.stringify(snapshot)); } catch { /* ignore */ }
  fetch('/api/studio/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, state: snapshot }),
    keepalive: true,
  }).catch(() => {});
}
function studioPersist() {
  if (!state.studio || !state.studio._restored) return;
  clearTimeout(studioSaveTimer);
  studioSaveTimer = setTimeout(() => studioFlush(), 300);
}
async function studioLoadForProject(project) {
  const projectId = project || 'default';
  const s = state.studio;
  let server = null;
  try {
    const res = await fetch('/api/studio/state?projectId=' + encodeURIComponent(projectId));
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && data.data && data.data.state) server = data.data;
    }
  } catch { /* offline: use local */ }
  let local = null;
  try { local = JSON.parse(localStorage.getItem(studioKey(projectId)) || 'null'); } catch { local = null; }
  if (projectId !== studioProjectId()) return null;
  const localTime = (local && local.updated) || 0;
  const serverTime = (server && server.updated) || 0;
  const saved = server && serverTime >= localTime ? server.state : (local || (server && server.state));
  if (saved) {
    studioApply(saved);
  } else {
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem('h3.studio') || 'null'); } catch { legacy = null; }
    if (legacy && (legacy.prompt || (legacy.images || []).length)) {
      studioApply(legacy);
      studioFlush(projectId);
      try { localStorage.removeItem('h3.studio'); } catch { /* ignore */ }
      return legacy;
    }
    s.prompt = '';
    s.promptMode = 'tags';
    s.images = [];
    s.audios = [];
    s.seed = '';
    s._restored = true;
  }
  if (local && localTime > serverTime) studioFlush(projectId);
  return saved;
}
function studioRestore() { /* 兼容旧调用：不再直接读全局 key */ state.studio._restored = true; }

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) throw new Error((data && data.error) || `请求失败 HTTP ${res.status}`);
  return data.data;
}

function currentWorkflow() {
  return state.workflows.find((w) => w.id === state.studio.workflowId) || state.workflows[0];
}

function workflowById(id) {
  return state.workflows.find((w) => w.id === id) || null;
}

/* ------------------------------------------------------------------ modal */

function openModal(html) {
  const panel = $('#modal-panel');
  // 清掉上一个弹窗留下来的尺寸类（比如设置页固定 820 高），换弹窗时不串味
  panel.classList.remove('modal-settings', 'modal-channel', 'modal-wide', 'ce-full');
  panel.innerHTML = html;
  $('#modal').hidden = false;
  document.body.style.overflow = 'hidden';
  return panel;
}

function closeModal() {
  if (typeof creativeModalGuard === 'function' && creativeModalGuard() === false) return;
  const previousPanel = $('#modal-panel');
  if (previousPanel) previousPanel.onclick = null;
  $('#modal').hidden = true;
  const panel = $('#modal-panel');
  panel.innerHTML = '';
  panel.classList.remove('modal-settings');
  document.body.style.overflow = '';
}

$('#modal').addEventListener('click', (event) => {
  if (event.target.id === 'modal' || event.target.dataset.close === '1') closeModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#modal').hidden) closeModal();
});

function askText(title, value, placeholder, onOk) {
  openModal(`
    <div class="modal-head"><h2>${esc(title)}</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body"><input class="input" id="ask-input" value="${esc(value || '')}" placeholder="${esc(placeholder || '')}" /></div>
    <div class="modal-foot"><button class="btn" data-close="1">取消</button><button class="btn primary" id="ask-ok">确定</button></div>
  `);
  const input = $('#ask-input');
  input.focus();
  input.select();
  const submit = () => {
    const text = input.value.trim();
    closeModal();
    onOk(text);
  };
  $('#ask-ok').onclick = submit;
  input.onkeydown = (event) => { if (event.key === 'Enter') submit(); };
}

/* ------------------------------------------------------------------ theme */

const THEMES = [
  { id: 'studio-light', label: '原版亮色', dark: false, sw: ['#ebe9f7', '#ffc000'], hint: '清爽明亮的经典界面' },
  { id: 'studio-mint', label: '薄荷奶绿', dark: false, sw: ['#f1faf6', '#14b87a'], hint: '浅绿白底 · 轻盈清晰' },
];
function themeCatalog() { return WallpaperLibrary.catalog((state.config && state.config.ui) || {}, THEMES); }
let wallpaperRotationTimer = null;

function wallpaperIsPaused() {
  const ui = state.config.ui || {};
  return ui.wallpaperPaused ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function mountWallpaper(theme) {
  let layer = $('#wallpaper-layer');
  const needsLayer = theme && (theme.kind === 'video' || theme.motion || ['gif', 'animated-image'].includes(theme.kind));
  if (!needsLayer) { if (layer) layer.remove(); return; }
  const key = theme.id + ':' + theme.wallpaper;
  if (layer && layer.dataset.key !== key) { layer.remove(); layer = null; }
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'wallpaper-layer';
    layer.className = 'wallpaper-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.dataset.key = key;
    if (theme.kind === 'video') {
      const video = document.createElement('video');
      video.className = 'skin-wallpaper-video';
      video.src = theme.wallpaper;
      if (theme.poster) video.poster = theme.poster;
      video.muted = true; video.defaultMuted = true; video.loop = true; video.playsInline = true;
      video.preload = 'auto';
      video.onerror = () => { layer.dataset.failed = 'true'; toast('这段壁纸无法播放，请换一个 MP4 或 WebM 文件', true); };
      layer.appendChild(video);
    } else if (['gif', 'animated-image'].includes(theme.kind)) {
      const image = document.createElement('img');
      image.className = 'skin-gif'; image.alt = ''; image.src = theme.wallpaper;
      layer.appendChild(image);
      const still = document.createElement('canvas'); still.className = 'skin-gif-still';
      image.onload = () => { still.width = image.naturalWidth; still.height = image.naturalHeight; still.getContext('2d').drawImage(image, 0, 0); };
      layer.appendChild(still);
    } else {
      layer.dataset.motion = theme.motion;
      for (let i = 0; i < 18; i++) {
        const particle = document.createElement('i');
        particle.style.cssText = `--x:${(i * 37) % 100}%;--delay:${-i * 1.7}s;--duration:${16 + i % 7 * 3}s;--size:${5 + i % 4 * 2}px`;
        layer.appendChild(particle);
      }
    }
    $('#app').prepend(layer);
  }
  const paused = wallpaperIsPaused();
  document.documentElement.dataset.wallpaperPaused = String(paused);
  const video = layer.querySelector('video');
  if (video) {
    video.muted = !state.config?.ui?.wallpaperSound || !!state.volume?.muted;
    video.volume = Math.max(0, Math.min(100, Number(state.config?.ui?.wallpaperVolume ?? 40))) / 100;
    if (paused) video.pause();
    else video.play().catch(() => { if (!video.isConnected) return; document.documentElement.dataset.wallpaperPaused = 'true'; const button = $('#wallpaper-play'); if (button) { button.textContent = '▶'; button.title = '播放动态壁纸'; } });
  }
}

function syncBackgroundAudio() {
  const ui = state.config?.ui || {};
  let audio = document.getElementById('background-music');
  if (!audio) {
    audio = document.createElement('audio'); audio.id = 'background-music'; audio.loop = true;
    audio.onerror = () => { if (audio.getAttribute('src')) toast('背景音乐无法播放，请更换音频文件', true); };
    document.body.appendChild(audio);
  }
  const src = ui.musicPath ? '/api/file?path=' + encodeURIComponent(ui.musicPath) : '/skins/quiet-piano.wav';
  if (audio.getAttribute('src') !== src) audio.src = src;
  audio.volume = Math.max(0, Math.min(100, Number(ui.musicVolume ?? 30))) / 100;
  audio.muted = !!state.volume?.muted;
  if (!ui.musicPlaying) audio.pause();
  else audio.play().catch(() => {
    if (audio.dataset.waiting) return;
    audio.dataset.waiting = 'true';
    document.addEventListener('pointerdown', () => {
      delete audio.dataset.waiting;
      if (state.config?.ui?.musicPlaying) audio.play().catch(() => toast('点击背景音乐的播放按钮以开启声音'));
    }, { once: true });
  });
}

function currentTheme() {
  const theme = (state.config && state.config.ui && state.config.ui.theme) || 'day-sea';
  return themeCatalog().some((t) => t.id === theme) ? theme : 'day-sea';
}

const AGENT_FONTS = {
  system: { label: '系统默认', css: '"Segoe UI", "Microsoft YaHei", sans-serif' },
  yahei: { label: '微软雅黑 · 清晰', css: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  song: { label: '宋体 · 书卷', css: '"Noto Serif SC", "Source Han Serif SC", SimSun, serif' },
  kai: { label: '楷体 · 人文', css: 'KaiTi, STKaiti, serif' },
};
function agentWelcomeText(ui = {}) {
  return String(ui.agentWelcomeText || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 40) || '让故事成形，让想象入镜。';
}
function applyAgentTypography(ui = {}) {
  const style = document.documentElement.style;
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  style.setProperty('--agent-font', (AGENT_FONTS[ui.agentFont] || AGENT_FONTS.system).css);
  style.setProperty('--agent-size', clamp(ui.agentFontSize ?? 15, 12, 24, 15) + 'px');
  style.setProperty('--agent-leading', String(clamp(ui.agentLineHeight ?? 1.8, 1.3, 2.4, 1.8)));
  style.setProperty('--agent-weight', String([400, 500, 600].includes(Number(ui.agentFontWeight)) ? Number(ui.agentFontWeight) : 400));
  style.setProperty('--agent-title-size', clamp(ui.agentTitleSize ?? 44, 24, 64, 44) + 'px');
}

function applyTheme() {
  const active = currentTheme();
  document.documentElement.dataset.theme = active;
  const theme = themeCatalog().find((t) => t.id === active);
  const ui = (state.config && state.config.ui) || {};
  applyAgentTypography(ui);
  const welcomeText = agentWelcomeText(ui);
  document.documentElement.style.setProperty('--agent-title-length', String(Math.max(1, Array.from(welcomeText).length)));
  const welcome = $('.ask-welcome h2');
  if (welcome) welcome.textContent = welcomeText;
  const wallpaper = theme && theme.wallpaper;
  document.documentElement.dataset.wallpaper = wallpaper ? 'true' : 'false';
  document.documentElement.dataset.daylight = theme.day ? 'true' : 'false';
  const isMedia = ['video', 'gif', 'animated-image'].includes(theme.kind);
  document.documentElement.style.setProperty('--skin-wallpaper', wallpaper && !isMedia ? `url(${JSON.stringify(wallpaper)})` : 'none');
  document.documentElement.style.setProperty('--skin-dim', String(Math.max(0, Math.min(.8, Number(ui.wallpaperDim ?? (theme.day ? .2 : .32))))));
  document.documentElement.style.setProperty('--skin-sidebar-dim', String(Math.max(0, Math.min(.95, Number(ui.wallpaperSidebarDim ?? .15)))));
  document.documentElement.style.setProperty('--skin-preview-alpha', String(1 - Math.max(0, Math.min(100, Number(ui.wallpaperPreviewTransparency ?? 85))) / 100));
  document.documentElement.style.setProperty('--skin-workspace-alpha', String(1 - Math.max(0, Math.min(100, Number(ui.wallpaperWorkspaceTransparency ?? 85))) / 100));
  mountWallpaper({ ...theme, wallpaper });
  syncBackgroundAudio();
  const btn = $('#theme-btn');
  if (btn) {
    const meta = theme;
    btn.title = `主题：${meta.label}`;
    btn.dataset.themeNow = active;
  }
  let play = $('#wallpaper-play');
  if (!play) {
    play = document.createElement('button'); play.type = 'button'; play.id = 'wallpaper-play'; play.className = 'h3-iconbtn';
    if (btn) btn.before(play);
    play.onclick = () => saveAppearance({ wallpaperPaused: !wallpaperIsPaused() }).catch((err) => toast(err.message, true));
  }
  play.hidden = !theme.animated;
  play.textContent = wallpaperIsPaused() ? '▶' : 'Ⅱ';
  play.title = wallpaperIsPaused() ? '播放动态壁纸' : '暂停动态壁纸';
  play.setAttribute('aria-label', play.title);
  clearTimeout(wallpaperRotationTimer);
  if (ui.wallpaperRotate) {
    const pool = WallpaperLibrary.rotationPool(themeCatalog(), ui.wallpaperRotationKind || 'static');
    if (pool.length > 1) wallpaperRotationTimer = setTimeout(() => {
      const next = pool[(pool.findIndex((p) => p.id === currentTheme()) + 1) % pool.length];
      setTheme(next.id).catch((err) => toast(err.message, true));
    }, Math.max(30, Number(ui.wallpaperInterval) || 300) * 1000);
  }
  const menu = $('#theme-menu');
  if (menu) {
    menu.querySelectorAll('.theme-item').forEach((item) => {
      item.classList.toggle('is-on', item.dataset.theme === active);
    });
  }
}

async function setTheme(theme) {
  if (!themeCatalog().some((t) => t.id === theme)) return;
  await saveAppearance({ theme });
}

let appearanceSaveQueue = Promise.resolve();
function saveAppearance(patch) {
  const operation = appearanceSaveQueue.then(() => persistAppearance(patch));
  appearanceSaveQueue = operation.catch(() => {});
  return operation;
}

async function persistAppearance(patch) {
  state.config = state.config || {};
  const previous = { ...(state.config.ui || {}) };
  state.config.ui = { ...previous, ...patch };
  applyTheme();
  try {
    state.config = await api('/api/config', { method: 'PUT', body: { ui: patch } });
    applyTheme();
  } catch (err) { state.config.ui = previous; applyTheme(); throw err; }
}

const themeBtn = $('#theme-btn');
if (themeBtn) themeBtn.onclick = () => openSettings('appearance');

/* ------------------------------------------------------------------ 设置按钮 */

const settingsBtn = $('#settings-btn');
if (settingsBtn) settingsBtn.onclick = () => openSettings();

/* ------------------------------------------------------------------ 全局音量 */

function applyVolume() {
  const v = state.volume || { level: 60, muted: false };
  const level = Math.max(0, Math.min(100, Number(v.level) || 0));
  document.querySelectorAll('video, audio').forEach((el) => {
    if (el.classList.contains('skin-wallpaper-video')) { el.muted = !state.config?.ui?.wallpaperSound || !!v.muted; return; }
    if (el.id === 'background-music') { el.muted = !!v.muted; return; }
    el.volume = level / 100;
    el.muted = !!v.muted;
  });
  const box = $('#volume-box');
  if (box) box.classList.toggle('is-muted', !!v.muted || level === 0);
  const range = $('#volume-range');
  if (range) {
    range.value = String(level);
    range.style.setProperty('--h3-vol', level + '%');
  }
  const mute = $('#mute-btn');
  if (mute) mute.title = v.muted ? '取消静音' : '静音';
}

const volumeRange = $('#volume-range');
if (volumeRange) {
  volumeRange.oninput = () => {
    state.volume = { level: Number(volumeRange.value), muted: false };
    applyVolume();
  };
  volumeRange.onchange = async () => {
    try { await saveAppearance({ volume: state.volume.level, muted: false }); } catch (err) { toast('音量保存失败：' + err.message, true); }
  };
}

const muteBtn = $('#mute-btn');
if (muteBtn) {
  muteBtn.onclick = async () => {
    state.volume = { level: (state.volume && state.volume.level) || 60, muted: !(state.volume && state.volume.muted) };
    applyVolume();
    try { await saveAppearance({ muted: !!state.volume.muted }); } catch (err) { toast('静音设置保存失败：' + err.message, true); }
  };
}

/* ------------------------------------------------------------------ 顶栏小件 */

document.addEventListener('click', async (event) => {
  const copy = event.target.closest('[data-copy]');
  if (!copy) return;
  try {
    await navigator.clipboard.writeText(copy.dataset.copy);
    toast('已复制 ' + copy.dataset.copy);
  } catch (err) { toast(err.message, true); }
});

/* ------------------------------------------------------------------ shell */

function setRoute() {
  const previousRoute = state.route;
  let route = (location.hash || '#image').replace(/^#/, '');
  // 旧路由兼容：批量任务 / 任务 / 任务日志 统一进「任务管理」的对应页签
  if (route === 'jobs' || route === 'batch' || route === 'logs') {
    state.taskTab = route === 'batch' ? 'batch'
      : route === 'logs' ? ((state.logTab || localStorage.getItem('h3.logs.tab') || 'video') === 'image' ? 'image' : 'video')
      : 'running';
    localStorage.setItem('h3.tasks.tab', state.taskTab);
    try { history.replaceState(null, '', '#tasks' + location.search); } catch { /* ignore */ }
    route = 'tasks';
  }
  state.route = ['image', 'studio', 'script', 'assets', 'batch', 'jobs', 'tasks', 'media', 'compare', 'logs', 'projects'].includes(route) ? route : 'image';
  if (state.route === 'tasks' && !state.taskTab) state.taskTab = localStorage.getItem('h3.tasks.tab') || 'running';
  if (state.route !== 'projects' && !state.projectId) state.route = 'projects';
  if (state.route === 'script' && previousRoute !== 'script' && state.ask?.conversations && !state.ask.loading && !state.ask.generating) {
    askNewConversation();
  }
  if (state.route === 'media' || state.route === 'assets') {
    const targetRoute=state.route;
    api('/api/'+targetRoute).then(data=>{state[targetRoute]=data;if(state.route===targetRoute)render();}).catch(e=>toast(e.message,true));
  }
  $$('#nav .h3-maintab').forEach((b) => b.classList.toggle('is-active', b.dataset.route === state.route));
  render();
}

window.addEventListener('hashchange', setRoute);

function render() {
  const view = $('#view');
  let html = '';
  if (state.route === 'studio') html = renderStudio();
  else if (state.route === 'image') html = IJ.panel() + renderImage();
  else if (state.route === 'script') html = renderScript();
  else if (state.route === 'batch') html = '<div class="page-scroll">' + renderBatch() + '</div>';
  else if (state.route === 'jobs') html = '<div class="page-scroll">' + renderJobs() + '</div>';
  else if (state.route === 'tasks') html = '<div class="page-scroll tasks-page">' + renderTasks() + '</div>';
  else if (state.route === 'assets') html = '<div class="page-scroll assets-page" style="background:var(--h3-bg-1) !important">' + renderAssets() + '</div>';
  else if (state.route === 'media') html = '<div class="page-scroll">' + renderMedia() + '</div>';
  else if (state.route === 'compare') html = '<div class="page-scroll is-compare">' + renderCompare() + '</div>';
  else if (state.route === 'logs') html = '<div class="page-scroll">' + renderLogs() + '</div>';
  else if (state.route === 'projects') html = renderProjects();
  if (state.route === 'studio' || state.route === 'image') html = WB.layout(state.route === 'studio' ? 'video' : 'image', html);
  if (state.route === 'studio') studioPersist();
  view.classList.toggle('is-image-route', state.route === 'image');
  // 每次渲染换一个新的宿主节点：旧节点上的事件监听随之销毁，避免同一个 #view 上重复绑定
  const host = document.createElement('div');
  host.className = 'route-host';
  host.innerHTML = html;
  view.replaceChildren(host);
  bindRoute(host);
  if(state.route === "studio" || state.route === "image") WB.bind(host,state.route === "studio" ? "video" : "image");
  applyVolume();
  updateStatus();
}

function updateStatus() {
  const cfg = state.config;
  if (!cfg) return;
  const queued = state.jobs.filter((j) => j.status === 'queued').length + (state.imageTasks||[]).filter(t=>['queued','paused'].includes(t.status)).length;
  const running = state.jobs.filter((j) => j.status === 'running').length + (state.imageTasks||[]).filter(t=>t.status==='running').length;
  const qc = $('#queue-count');
  if (qc) qc.textContent = String(queued + running);
  const jc = $('#job-count');
  if (jc) jc.textContent = (queued + running) ? String(queued + running) : '';
  const qb = $('#queue-btn');
  if (qb) qb.classList.toggle('is-busy', running > 0);
}

const queueBtn = $('#queue-btn');
if (queueBtn) queueBtn.onclick = () => { location.hash = '#jobs'; };

// 顶栏页签：按钮不是链接，必须自己改 hash（之前只监听 hashchange，导致点不动）
function goRoute(route) {
  const next = '#' + route;
  if (location.hash === next) render();
  else location.hash = next;
}

$$('#nav .h3-maintab').forEach((btn, index) => {
  btn.onclick = () => goRoute(btn.dataset.route);
  btn.title = `Ctrl+${index + 1}`;
});

document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
  const index = Number(event.key) - 1;
  const tabs = $$('#nav .h3-maintab');
  if (!Number.isInteger(index) || index < 0 || index >= tabs.length) return;
  event.preventDefault();
  goRoute(tabs[index].dataset.route);
});

/* ------------------------------------------------------------------ studio */

/* ---- 视频创作台：按原版 DOM 结构（h3-panel / h3-slots / h3-compose）重建 ---- */

const ICON = {
  frame: '<svg class="h3-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18"></rect><path d="M7 3v18M17 3v18M3 7h4M3 17h4M17 7h4M17 17h4"></path></svg>',
  swap: '<svg class="h3-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"></path><path d="M3 6h18"></path><path d="M7 22l-4-4 4-4"></path><path d="M21 18H3"></path></svg>',
  x: '<svg class="h3-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>',
  copy: '<svg class="h3-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
  trash: '<svg class="h3-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path></svg>',
  wand: '<svg class="h3-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 12-12M14 4l1.5 3L19 8.5 15.5 10 14 13l-1.5-3L9 8.5 12.5 7z"></path></svg>',
  caret: '<svg class="h3-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>',
  audio: '<svg class="h3-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle></svg>',
  play: '<svg class="h3-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 3 14 9-14 9z"></path></svg>',
  skipBack: '<svg class="h3-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 20 9 12l10-8zM5 19V5"></path></svg>',
  skipFwd: '<svg class="h3-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 4 10 8-10 8zM19 5v14"></path></svg>',
};

function refSlotHtml(image, index, nextEmpty) {
  const num = index + 1;
  const isNext = !image && index === nextEmpty;
  const cls = 'h3-slot' + (image ? ' has-media' : isNext ? ' is-next' : '');
  const style = `--i:${index}`;
  if (!image) {
    return `<div class="${cls}" data-act="add-image" data-index="${index}" style="${style}" title="点击从素材库选择图像，或把图片拖到这里">
      <span class="h3-slot-num is-empty">图${num}</span>
    </div>`;
  }
  return `<div class="${cls}" data-index="${index}" style="${style}" draggable="true" ${image.subject ? `data-subject="${num}"` : ''} title="${esc(image.name)}">
    <img class="h3-slot-img" src="/api/file?path=${enc(image.path)}" alt="" />
    <span class="h3-slot-num">图${num}</span>
    ${image.subject ? `<span class="h3-slot-subject" title="&lt;Subject ${num}&gt;">S${num} ${esc(image.subject)}</span>` : ''}
    <div class="h3-slot-actions">
      <button type="button" class="h3-slot-act" data-act="name-subject" data-index="${index}" title="命名主体（供提示词 &lt;Subject n&gt; 引用）">${ICON.frame}</button>
      <button type="button" class="h3-slot-act" data-act="add-image" data-index="${index}" title="更换图像">${ICON.swap}</button>
      <button type="button" class="h3-slot-act is-danger" data-act="remove-image" data-index="${index}" title="移除">${ICON.x}</button>
    </div>
  </div>`;
}

function audioSlotHtml(audio, index) {
  const num = index + 1;
  if (!audio) {
    return `<div class="h3-audio" data-index="${index}" title="选择内置音色或本地音频，也可把音频文件拖到这里">
      <span class="h3-audio-num tnum">音频${num}</span>
      <button type="button" class="h3-audio-pick" data-act="voice-pick" data-index="${index}" title="用内置音色朗读台词，生成一段音频">内置音色</button>
      <button type="button" class="h3-audio-pick" data-act="add-audio" data-index="${index}" title="选一个本地音频文件">本地音频</button>
    </div>`;
  }
  return `<div class="h3-audio has-media" data-index="${index}" title="${esc(audio.path)}">
    <span class="h3-audio-num tnum">音频${num}</span>
    <span class="h3-audio-ico">${ICON.audio}</span>
    <span class="h3-audio-name">${esc(audio.name)}</span>
    <span class="h3-audio-tag">${audio.voiceId ? '音色库 · ' + esc(audio.voice || '') : audio.voice ? '内置音色' : '本地音频'}${audio.seconds ? ' · ' + audio.seconds + 's' : ''}</span>
    <div class="h3-slot-actions" style="opacity:1">
      <button type="button" class="h3-slot-act" data-act="preview-audio" data-index="${index}" title="试听">${ICON.play}</button>
      <button type="button" class="h3-slot-act" data-act="voice-pick" data-index="${index}" title="换内置音色">${ICON.frame}</button>
      <button type="button" class="h3-slot-act is-danger" data-act="remove-audio" data-index="${index}" title="移除">${ICON.x}</button>
    </div>
  </div>`;
}

async function openVoiceDialog(index) {
  const s = state.studio;
  const existing = s.audios[index];
  const dialogues = [...String(s.prompt || '').matchAll(/<d>([\s\S]*?)<\/d>/g)]
    .map((m) => m[1].replace(/^\s*\[[^\]]*\]\s*/, '').trim())
    .filter(Boolean);

  let library = null;
  let libraryError = '';
  try {
    library = await api('/api/voice-library');
    state.voiceLibrary = library;
  } catch (err) {
    libraryError = err.message;
  }
  state.voiceLines = dialogues;

  const tabs = [
    ['library', '音色库' + (library && library.total ? ` ${library.total}` : '')],
    ['sapi', '系统音色'],
  ];
  state.voiceTab = state.voiceTab || 'library';

  const dialog = () => {
    const tab = state.voiceTab;
    return `
    <div class="modal-head">
      <h2>内置音色 · 音频 ${index + 1}</h2>
      <span class="grow"></span>
      <button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">关闭</button>
    </div>
    <div class="modal-body">
      <div class="h3-page-tabs" style="height:32px;margin:-6px 0 4px;border:0;padding:0">
        ${tabs.map(([id, label]) => `<button type="button" class="h3-page-tab ${tab === id ? 'is-on' : ''}" data-voice-tab="${id}">${label}</button>`).join('')}
      </div>
      ${tab === 'library' ? libraryPane(library, libraryError, existing) : sapiPane(dialogues, existing)}
    </div>
  `;
  };

  openModal(dialog());
  bindVoiceDialog(index, dialog);
}

function libraryPane(library, error, existing) {
  if (error) {
    return `<p class="hint">读取音色库失败：${esc(error)}</p>`;
  }
  if (!library || !library.total) {
    return `<p class="hint">还没有配置音色库目录。到「设置 → 存储目录」里填上「克隆参考音色库」的路径（盘里的 800+ 音色目录），保存后回到这里就能搜索、试听、放进音频槽。</p>`;
  }
  return `
    <div class="row" style="gap:8px">
      <input class="input" id="vl-search" placeholder="搜索音色名 / 台词关键词，例如 云小馨、东北、老妇、新闻" style="flex:1" />
      <select class="select" id="vl-group" style="width:200px">
        <option value="">全部分组（${library.total}）</option>
        ${library.groups.map((g) => `<option value="${esc(g.name)}">${esc(g.name)}（${g.count}）</option>`).join('')}
      </select>
      <button type="button" class="h3-btn h3-btn-sm" id="vl-refresh" title="重新扫描音色目录">重新扫描</button>
    </div>
    <div class="hint">音色库根目录：<span class="mono">${esc(library.root)}</span> · 选中后会把样本复制进 <span class="mono">data/uploads/voice/</span>，再进音频槽</div>
    <div class="vl-list" id="vl-list"></div>
    <div class="row"><span class="hint" id="vl-count"></span><span class="grow"></span><button type="button" class="h3-btn h3-btn-sm" id="vl-more">加载更多</button></div>
  `;
}

function sapiPane(dialogues, existing) {
  return `
    <p class="hint">用系统自带的语音包离线合成 WAV（Windows System.Speech），生成后直接放进这个音频槽，再在提示词里用 &lt;Audio 1&gt; 引用。</p>
    ${dialogues.length ? `<div class="row wrap"><span class="hint">从提示词里取到的台词：</span>${dialogues.slice(0, 6).map((line, i) => `<button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-line="${i}" title="填进下面的文本框">${esc(line.slice(0, 18))}${line.length > 18 ? '…' : ''}</button>`).join('')}</div>` : ''}
    <div class="field"><label>朗读文字</label>
      <textarea class="textarea" id="voice-text" style="min-height:100px" placeholder="例如：师姐，我们快到了。">${esc(dialogues[0] || '')}</textarea>
    </div>
    <div class="row">
      <div class="field grow" style="min-width:220px"><label>音色</label>
        <select class="select" id="voice-name"><option value="">加载中…</option></select>
      </div>
      <div class="field" style="width:120px"><label>语速</label>
        <select class="select" id="voice-rate">
          <option value="-4">很慢</option>
          <option value="-2">慢</option>
          <option value="0" selected>正常</option>
          <option value="2">快</option>
          <option value="4">很快</option>
        </select>
      </div>
    </div>
    <div class="hint" id="voice-state"></div>
    <div class="modal-foot" style="padding:8px 0 0;border:0">
      <button type="button" class="h3-btn h3-btn-sm h3-btn-primary" id="voice-go">生成并放入音频槽</button>
    </div>
  `;
}

function voiceItemHtml(item) {
  const line = item.transcript || item.note || '';
  return `<div class="vl-row" data-voice="${item.id}">
    <button type="button" class="vl-play" data-act="vl-play" data-id="${item.id}" title="试听样本">${ICON.play}</button>
    <div class="vl-main">
      <div class="vl-name">${esc(item.speaker)}<span class="vl-group">${esc(item.group)}</span></div>
      ${line ? `<div class="vl-note" title="${esc(line)}">${esc(line)}</div>` : ''}
    </div>
    <span class="vl-time tnum">${item.seconds ? item.seconds + 's' : ''}</span>
    <button type="button" class="h3-btn h3-btn-sm" data-act="vl-use" data-id="${item.id}">使用</button>
  </div>`;
}

function bindVoiceDialog(index, dialog) {
  const panel = $('#modal-panel');
  const s = state.studio;

  panel.querySelectorAll('[data-voice-tab]').forEach((btn) => {
    btn.onclick = () => {
      state.voiceTab = btn.dataset.voiceTab;
      openModal(dialog());
      bindVoiceDialog(index, dialog);
    };
  });

  const listEl = $('#vl-list');
  if (listEl) {
    const lib = state.voiceLibrary || { items: [] };
    const search = $('#vl-search');
    const groupSel = $('#vl-group');
    const more = $('#vl-more');
    const countEl = $('#vl-count');
    let shown = 0;
    const PAGE = 60;

    const filtered = () => {
      const q = (search && search.value || '').trim().toLowerCase();
      const group = groupSel ? groupSel.value : '';
      return (lib.items || []).filter((item) => {
        if (group && item.group !== group) return false;
        if (!q) return true;
        return (item.speaker + ' ' + item.note + ' ' + item.transcript + ' ' + item.group).toLowerCase().includes(q);
      });
    };

    const renderPage = (reset) => {
      const rows = filtered();
      if (reset) { listEl.innerHTML = ''; shown = 0; }
      const slice = rows.slice(shown, shown + PAGE);
      listEl.insertAdjacentHTML('beforeend', slice.map(voiceItemHtml).join(''));
      shown += slice.length;
      if (countEl) countEl.textContent = rows.length ? `已显示 ${shown}/${rows.length}` : '没有匹配的音色';
      if (more) more.disabled = shown >= rows.length;
      listEl.querySelectorAll('[data-act="vl-play"]').forEach((btn) => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.onclick = () => previewVoiceLibrary(btn.dataset.id, btn);
      });
      listEl.querySelectorAll('[data-act="vl-use"]').forEach((btn) => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            const item = await api('/api/voice-library/pick', { method: 'POST', body: { id: btn.dataset.id } });
            s.audios[index] = item;
            closeModal();
            render();
            toast(`已使用音色：${item.voice || item.name}`);
          } catch (err) {
            toast(err.message, true);
            btn.disabled = false;
          }
        };
      });
    };

    if (search) search.oninput = () => renderPage(true);
    if (groupSel) groupSel.onchange = () => renderPage(true);
    if (more) more.onclick = () => renderPage(false);
    renderPage(true);

    const refresh = $('#vl-refresh');
    if (refresh) {
      refresh.onclick = async () => {
        refresh.disabled = true;
        try {
          state.voiceLibrary = await api('/api/voice-library?refresh=1');
          openModal(dialog());
          bindVoiceDialog(index, dialog);
          toast(`已重新扫描：${state.voiceLibrary.total} 个音色`);
        } catch (err) {
          toast(err.message, true);
          refresh.disabled = false;
        }
      };
    }
  }

  // 系统音色页
  const go = $('#voice-go');
  if (go) {
    api('/api/voices').then((data) => {
      const voices = data.voices || [];
      const sel = $('#voice-name');
      if (!sel) return;
      sel.innerHTML = voices.length
        ? voices.map((v) => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('')
        : '<option value="">没有可用语音包</option>';
      if (!voices.length) go.disabled = true;
    }).catch((err) => toast(err.message, true));
    go.onclick = async () => {
      const text = ($('#voice-text').value || '').trim();
      if (!text) return toast('先写要读的文字', true);
      go.disabled = true;
      const stateEl = $('#voice-state');
      if (stateEl) stateEl.textContent = '正在合成…';
      try {
        const item = await api('/api/tts', {
          method: 'POST',
          body: { text, voice: $('#voice-name').value, rate: Number($('#voice-rate').value) || 0 },
        });
        s.audios[index] = item;
        closeModal();
        render();
        toast(`已生成 ${item.seconds || '?'} 秒音频`);
      } catch (err) {
        if (stateEl) stateEl.textContent = '';
        toast(err.message, true);
        go.disabled = false;
      }
    };
  }

  $$('#modal-panel [data-line]').forEach((btn) => {
    btn.onclick = () => { $('#voice-text').value = (state.voiceLines || [])[Number(btn.dataset.line)] || ''; };
  });
}

let voicePreviewEl = null;
function previewVoiceLibrary(id, btn) {
  try {
    if (voicePreviewEl) { voicePreviewEl.pause(); voicePreviewEl = null; }
    if (btn && btn.classList.contains('is-playing')) { btn.classList.remove('is-playing'); return; }
    document.querySelectorAll('.vl-play.is-playing').forEach((b) => b.classList.remove('is-playing'));
    const el = new Audio('/api/voice-library/audio?id=' + encodeURIComponent(id));
    const v = state.volume || { level: 60, muted: false };
    el.volume = Math.max(0, Math.min(100, Number(v.level) || 0)) / 100;
    el.muted = !!v.muted;
    el.onended = () => { if (btn) btn.classList.remove('is-playing'); };
    el.play().then(() => { if (btn) btn.classList.add('is-playing'); }).catch((err) => toast(err.message, true));
    voicePreviewEl = el;
  } catch (err) {
    toast(err.message, true);
  }
}

function previewAudio(audio) {
  if (!audio) return;
  const el = new Audio('/api/file?path=' + encodeURIComponent(audio.path));
  const v = state.volume || { level: 60, muted: false };
  el.volume = Math.max(0, Math.min(100, Number(v.level) || 0)) / 100;
  el.muted = !!v.muted;
  el.play().catch((err) => toast(err.message, true));
}

const SECTION_WORDS = ['主体定义', '摘要', '保留分析', '详细描述', '环境音', '非剧情配乐', '参考生成', '镜头设计', '主体描述'];

function promptPreviewHtml(text) {
  const s = state.studio;
  const source = String(text || '');
  if (!source.trim()) {
    return `<span class="h3-prompt-placeholder">还没有提示词。点「插入骨架」按当前主体生成 6 段式骨架，或直接切到「代码」开始写。</span>`;
  }
  let html = '';
  let cursor = 0;
  const re = /<Picture\s+(\d+)>|<Subject\s+(\d+)>|<Audio\s+(\d+)>|<d>([\s\S]*?)<\/d>|\[Shot\s+(\d+)\]/gi;
  let m;
  const pushText = (raw) => {
    const value = esc(raw);
    const parts = value.split(/(主体定义|摘要|保留分析|详细描述|环境音|非剧情配乐|参考生成|镜头设计)/g);
    parts.forEach((part, i) => {
      if (i % 2 === 1) html += `<span class="h3-chip is-section"><span>${part}</span></span>`;
      else html += part.replace(/\n/g, '<br>');
    });
  };
  while ((m = re.exec(source))) {
    pushText(source.slice(cursor, m.index));
    if (m[1]) {
      const img = s.images[Number(m[1]) - 1];
      html += `<span class="h3-chip is-media">${img ? `<img class="h3-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>图${m[1]}</span></span>`;
    } else if (m[2]) {
      const img = s.images[Number(m[2]) - 1];
      const label = img && img.subject ? img.subject : '主体' + m[2];
      html += `<span class="h3-chip is-subject">${img ? `<img class="h3-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>${esc(label)}</span></span>`;
    } else if (m[3]) {
      const aud = s.audios[Number(m[3]) - 1];
      html += `<span class="h3-chip is-spec"><span>音频${m[3]}${aud ? ' · ' + esc(aud.name) : ''}</span></span>`;
    } else if (m[4] !== undefined) {
      html += `<span class="h3-chip is-dialogue"><span>对白：</span><span>${esc(m[4])}</span></span>`;
    } else if (m[5]) {
      html += `<span class="h3-chip is-spec is-clickable"><span>镜头${m[5]}</span></span>`;
    }
    cursor = m.index + m[0].length;
  }
  pushText(source.slice(cursor));
  return html;
}


function promptRichHtml(text) {
  const s = state.studio;
  const source = String(text || '');
  const langLabel = { Chinese: '中文对白', English: '英语对白', Korean: '韩语对白', Japanese: '日语对白' };
  let html = '';
  let cursor = 0;
  const re = /\(S(?<speaker>\d+)\)|<Picture\s+(?<picture>\d+)>|<Subject\s+(?<subject>\d+)>|<Audio\s+(?<audio>\d+)>|<d>\[(?<lang>[A-Za-z]+)\](?<dialogue>[\s\S]*?)<\/d>|\[Shot\s+(?<shot>\d+)\]/gi;
  let m;
  const pushText = (raw) => {
    const parts = esc(raw).split(/(主体定义|摘要|保留分析|详细描述|环境音|非剧情配乐|镜头设计|参考生成)/g);
    for (let i = 0; i < parts.length; i += 1) {
      if (i % 2 === 1) html += `<span class="h3-chip is-section" contenteditable="false" data-token="${parts[i]}"><span>${parts[i]}</span></span>`;
      else html += parts[i].replace(/\n/g, '<br>');
    }
  };
  while ((m = re.exec(source))) {
    pushText(source.slice(cursor, m.index));
    const g = m.groups || {};
    if (g.speaker) {
      html += `<span class="h3-chip is-spec is-clickable" contenteditable="false" data-token="(S${g.speaker})"><span>说话人${g.speaker}</span></span>`;
    } else if (g.picture) {
      const img = s.images[Number(g.picture) - 1];
      html += `<span class="h3-chip is-media" contenteditable="false" data-token="&lt;Picture ${g.picture}&gt;">${img ? `<img class="h3-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>图${g.picture}</span></span>`;
    } else if (g.subject) {
      const img = s.images[Number(g.subject) - 1];
      const label = img && img.subject ? img.subject : '主体' + g.subject;
      html += `<span class="h3-chip is-subject" contenteditable="false" data-token="&lt;Subject ${g.subject}&gt;">${img ? `<img class="h3-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>${esc(label)}</span></span>`;
    } else if (g.audio) {
      const aud = s.audios[Number(g.audio) - 1];
      html += `<span class="h3-chip is-spec" contenteditable="false" data-token="&lt;Audio ${g.audio}&gt;"><span>音频${g.audio}${aud ? ' · ' + esc(aud.name) : ''}</span></span>`;
    } else if (g.lang) {
      const lang = g.lang;
      let body = g.dialogue || '';
      let voice = '';
      if (body.startsWith('（男声画外音）')) { voice = 'male'; body = body.slice('（男声画外音）'.length); }
      else if (body.startsWith('（女声画外音）')) { voice = 'female'; body = body.slice('（女声画外音）'.length); }
      const prefix = voice === 'male' ? '男声画外音：' : voice === 'female' ? '女声画外音：' : (langLabel[lang] || lang) + '：';
      html += `<span class="h3-chip is-dialogue" contenteditable="false" data-dialogue="1" data-dialogue-lang="${esc(lang)}"${voice ? ' data-dialogue-voice="' + voice + '"' : ''}><span contenteditable="false" class="h3-dialogue-prefix">${prefix}</span><span contenteditable="true" data-dialogue-body="1">${esc(body)}</span></span>`;
    } else if (g.shot) {
      html += `<span class="h3-chip is-spec is-clickable" contenteditable="false" data-token="[Shot ${g.shot}]"><span>镜头${g.shot}</span></span>`;
    }
    cursor = m.index + m[0].length;
  }
  pushText(source.slice(cursor));
  return html;
}

function richPromptText(root) {
  let out = '';
  const walk = (node) => {
    if (node.nodeType === 3) { out += node.nodeValue || ''; return; }
    if (node.nodeType !== 1) return;
    const el = node;
    if (el.dataset && el.dataset.dialogue) {
      const lang = el.dataset.dialogueLang || 'Chinese';
      const voice = el.dataset.dialogueVoice;
      const body = el.querySelector('[data-dialogue-body]');
      const text = body ? body.textContent : '';
      out += '<d>[' + lang + ']' + (voice === 'male' ? '（男声画外音）' : voice === 'female' ? '（女声画外音）' : '') + text + '</d>';
      return;
    }
    if (el.dataset && el.dataset.token) { out += el.dataset.token; return; }
    if (el.tagName === 'BR') { out += '\n'; return; }
    const block = /^(DIV|P)$/.test(el.tagName);
    if (block && out && !out.endsWith('\n')) out += '\n';
    for (const child of el.childNodes) walk(child);
    if (block && out && !out.endsWith('\n')) out += '\n';
  };
  for (const child of root.childNodes) walk(child);
  return out.replace(/\n+$/, '');
}

function studioMentionItems() {
  const s = state.studio;
  const images = (s.images || []).filter((img) => img && img.path);
  const shots = Math.max(4, images.length, 1);
  const items = [];
  images.forEach((img, i) => items.push({ group: '图像', label: '图' + (i + 1), token: '<Picture ' + (i + 1) + '>', thumb: '/api/file?path=' + encodeURIComponent(img.path) }));
  images.forEach((img, i) => items.push({ group: '主体', label: img.subject || ('主体' + (i + 1)), token: '<Subject ' + (i + 1) + '>', thumb: '/api/file?path=' + encodeURIComponent(img.path) }));
  images.forEach((img, i) => items.push({ group: '说话人', label: '说话人' + (i + 1), token: '(S' + (i + 1) + ')', thumb: '/api/file?path=' + encodeURIComponent(img.path) }));
  items.push({ group: '说话人', label: '新建说话人' + (images.length + 1), token: '(S' + (images.length + 1) + ')', icon: '👤' });
  for (const [label, lang] of [['中文对白', 'Chinese'], ['英语对白', 'English'], ['韩语对白', 'Korean'], ['日语对白', 'Japanese']]) {
    items.push({ group: '对白', label, dialogue: { lang }, icon: '💬' });
  }
  items.push({ group: '对白', label: '男性画外音', dialogue: { lang: 'Chinese', voice: 'male' }, icon: '🔊' });
  items.push({ group: '对白', label: '女性画外音', dialogue: { lang: 'Chinese', voice: 'female' }, icon: '🔊' });
  for (let i = 1; i <= shots; i += 1) items.push({ group: '镜头', label: '镜头' + i, token: '[Shot ' + i + ']', icon: '🎬' });
  items.push({ group: '镜头', label: '新建镜头' + (shots + 1), token: '[Shot ' + (shots + 1) + ']', icon: '🎬' });
  return items;
}
function bindStudioRichEditor(editor) {
  const host = $('#studio-mention-pop');
  let savedRange = null;
  let items = [];
  let index = 0;

  const close = () => { savedRange = null; items = []; if (host) { host.hidden = true; host.innerHTML = ''; } editor.removeAttribute('aria-expanded'); };
  const caretPrefix = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return null;
    const pre = range.cloneRange();
    pre.selectNodeContents(editor);
    pre.setEnd(range.startContainer, range.startOffset);
    return { text: pre.toString(), range };
  };
  const update = () => {
    const info = caretPrefix();
    if (!info) return close();
    const match = info.text.match(/@([^@\s<>]*)$/);
    if (!match) return close();
    const query = match[1].toLowerCase();
    items = studioMentionItems().filter((item) => (item.label + ' ' + item.group).toLowerCase().includes(query));
    index = Math.min(index, Math.max(0, items.length - 1));
    savedRange = info.range.cloneRange();
    if (!host) return;
    host.hidden = false;
    editor.setAttribute('aria-expanded', 'true');
    const rect = info.range.getBoundingClientRect();
    host.style.left = Math.max(8, Math.min(window.innerWidth - 300, rect.left)) + 'px';
    host.style.top = Math.min(window.innerHeight - 260, rect.bottom + 6) + 'px';
    const groups = [];
    for (const item of items) { let g = groups.find((x) => x.name === item.group); if (!g) { g = { name: item.group, items: [] }; groups.push(g); } g.items.push(item); }
    const colClass = (name) => ({ '图像': 'is-media', '主体': 'is-subject', '说话人': 'is-speaker', '对白': 'is-dialogue', '镜头': 'is-spec' })[name] || 'is-spec';
    host.innerHTML = items.length ? groups.map((g) => '<div class="h3-mention-col ' + colClass(g.name) + '"><div class="h3-mention-title">' + esc(g.name) + '</div>' + g.items.map((item) => '<button type="button" class="h3-mention-item' + (items.indexOf(item) === index ? ' is-active' : '') + '" data-mi="' + items.indexOf(item) + '">' + (item.thumb ? '<img src="' + esc(item.thumb) + '" alt="" />' : '<span class="h3-mention-ico">' + (item.icon || '·') + '</span>') + '<span class="h3-mention-label">' + esc(item.label) + (item.desc ? '<small>' + esc(item.desc) + '</small>' : '') + '</span></button>').join('') + '</div>').join('') : '<p class="h3-mention-empty">没有匹配素材；先在左侧添加参考图/音频。</p>';
    host.querySelectorAll('[data-mi]').forEach((btn) => {
      btn.onmousedown = (event) => event.preventDefault();
      btn.onclick = () => choose(Number(btn.dataset.mi));
    });
    host.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(host.offsetWidth || 640, 640) - 12)) + 'px';
    if (host.offsetHeight) host.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - host.offsetHeight - 12)) + 'px';
  };
  const choose = (at) => {
    const item = items[at];
    if (!item || !savedRange) return close();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    const range = savedRange;
    const textNode = range.startContainer;
    if (textNode.nodeType === 3) {
      const upto = textNode.nodeValue.slice(0, range.startOffset);
      const m = upto.match(/@([^@\s<>]*)$/);
      if (m) range.setStart(textNode, range.startOffset - m[0].length);
    }
    range.deleteContents();
    let node;
    if (item.dialogue) {
      node = document.createElement('span');
      node.className = 'h3-chip is-dialogue';
      node.contentEditable = 'false';
      node.dataset.dialogue = '1';
      node.dataset.dialogueLang = item.dialogue.lang || 'Chinese';
      if (item.dialogue.voice) node.dataset.dialogueVoice = item.dialogue.voice;
      const prefix = document.createElement('span');
      prefix.contentEditable = 'false';
      prefix.className = 'h3-dialogue-prefix';
      prefix.textContent = item.dialogue.voice === 'male' ? '男声画外音：' : item.dialogue.voice === 'female' ? '女声画外音：' : ({ Chinese: '中文对白', English: '英语对白', Korean: '韩语对白', Japanese: '日语对白' }[item.dialogue.lang] || item.dialogue.lang) + '：';
      const bodySpan = document.createElement('span');
      bodySpan.contentEditable = 'true';
      bodySpan.dataset.dialogueBody = '1';
      node.appendChild(prefix);
      node.appendChild(bodySpan);
      range.insertNode(node);
      const inside = document.createRange();
      inside.setStart(bodySpan, 0); inside.collapse(true);
      sel.removeAllRanges(); sel.addRange(inside);
      editor.focus();
      close();
      state.studio.prompt = richPromptText(editor);
      const count = $('#prompt-count'); if (count) count.textContent = state.studio.prompt.length + '字';
      studioPersist(); validatePromptSoon();
      return;
    }
    if (item.token) {
      node = document.createElement('span');
      node.contentEditable = 'false';
      node.dataset.token = item.token;
      if (item.token.startsWith('<Picture')) node.className = 'h3-chip is-media';
      else if (item.token.startsWith('<Subject')) node.className = 'h3-chip is-subject';
      else if (item.token.startsWith('(S')) node.className = 'h3-chip is-spec is-clickable';
      else node.className = 'h3-chip is-spec is-clickable';
      if (item.thumb) {
        const img = document.createElement('img');
        img.className = 'h3-chip-media';
        img.src = item.thumb;
        img.alt = '';
        node.appendChild(img);
      }
      const label = document.createElement('span');
      label.textContent = item.label || item.token;
      node.appendChild(label);
    } else {
      node = document.createTextNode(item.text || '');
    }
    range.insertNode(node);
    if (item.token) {
      const space = document.createTextNode(' ');
      node.after(space);
      const after = document.createRange();
      after.setStartAfter(space); after.collapse(true);
      sel.removeAllRanges(); sel.addRange(after);
    } else if (item.caret) {
      const r2 = document.createRange();
      const pos = Math.max(0, (node.nodeValue || '').length + item.caret);
      r2.setStart(node, pos); r2.collapse(true);
      sel.removeAllRanges(); sel.addRange(r2);
    } else {
      const r2 = document.createRange(); r2.setStartAfter(node); r2.collapse(true);
      sel.removeAllRanges(); sel.addRange(r2);
    }
    editor.focus();
    close();
    state.studio.prompt = richPromptText(editor);
    const count = $('#prompt-count'); if (count) count.textContent = state.studio.prompt.length + '字';
    studioPersist();
    validatePromptSoon();
  };
  editor.addEventListener('input', () => {
    state.studio.prompt = richPromptText(editor);
    const count = $('#prompt-count'); if (count) count.textContent = state.studio.prompt.length + '字';
    studioPersist();
    update();
  });
  editor.addEventListener('click', update);
  editor.addEventListener('keyup', (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update(); });
  editor.addEventListener('keydown', (event) => {
    if (event.isComposing || !savedRange) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (items.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); index = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; update(); }
    else if (items.length && ['Enter', 'Tab'].includes(event.key)) { event.preventDefault(); choose(index); }
  });
  editor.addEventListener('blur', () => setTimeout(close, 150));
  editor.addEventListener('paste', (event) => {
    const text = event.clipboardData && event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    document.execCommand('insertText', false, text);
  });
}

function stageEmptyHtml(wf) {
  return `<div class="h3-empty">
    <div class="h3-empty-card">
      <h2 class="h3-empty-title">把参考图拖到左侧开始</h2>
      <p class="h3-empty-desc">ZEALMAN-H3 把图像与音频参考、6 段式提示词提交到 H3 视频工作流，生成带对白与环境音的短视频。生成过程会在这里实时预览，完成后自动保存到你指定的文件夹。</p>
      <ol class="h3-empty-steps">
        <li><b>1</b><span>在左侧添加 1–${wf.images} 张参考图，点图上标签为角色 / 场景命名主体。</span></li>
        <li><b>2</b><span>${wf.audios ? `可选：为 ${wf.audios} 个音频槽选本地音频，绑定到主体作为音色参考。` : '当前工作流不接收音频参考。'}</span></li>
        <li><b>3</b><span>写提示词，用 &lt;Picture 1&gt; / &lt;Subject 1&gt; / &lt;Audio 1&gt; 引用素材，&lt;d&gt;写对白&lt;/d&gt;；或先插入骨架 / 示例。</span></li>
        <li><b>4</b><span>左上角选「渠道」（管理器里的豆包 / Gemini），底部选「视频模型」，再选画幅与时长，点「生成视频」。</span></li>
      </ol>
      <div class="h3-empty-actions">
        <button type="button" class="h3-btn" data-act="go-jobs"><span class="h3-btn-icon">${ICON.play}</span>查看任务日志</button>
        <button type="button" class="h3-btn h3-btn-ghost" data-act="insert-skeleton">插入骨架</button>
      </div>
    </div>
  </div>`;
}

function renderStudio() {
  const s = state.studio;
  const ownJobs = state.jobs.filter(j => j.itemId === WB.context("video").itemId);
  const wf = currentWorkflow();
  if (!wf) return `<div class="h3-empty"><div class="h3-empty-card"><h2 class="h3-empty-title">没有工作流</h2><p class="h3-empty-desc">在 设置 → 视频生成 里添加一个管理器渠道。</p></div></div>`;
  const isAuto = wf.provider === 'autodl';
  const isManager = wf.provider === 'manager';
  const modelChoices = s.channelId
    ? state.workflows.filter((w) => w.channelId === s.channelId)
    : state.workflows.filter((w) => w.provider !== 'autodl');
  const images = s.images || [];
  const audios = s.audios || [];
  const nextEmpty = images.findIndex((x) => !x);
  const mode = s.promptMode || 'tags';
  const lastJob = ownJobs.find((j) => j.id === state.lastJobId) || ownJobs.find((j) => j.status === 'running') || ownJobs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).find((j) => (j.outputs || []).length) || null;
  const outputs = lastJob ? (lastJob.outputs || []) : [];
  const video = [...outputs].reverse().find((o) => o.type === 'video');
  const progress = lastJob ? lastJob.progress || 0 : 0;
  const keyCount = (state.config.autodlKeys || []).filter((k) => k.enabled !== false).length;
  const channel = (state.channels.video || []).find((c) => c.id === wf.channelId) || null;
  const recent = ownJobs.slice(0, 5);

  const videoChannels = (state.channels.video || []).filter((c) => c.enabled !== false);
  const autodlWorkflows = state.workflows.filter((w) => w.provider === 'autodl');
  const channelWorkflows = wf.channelId ? state.workflows.filter((w) => w.channelId === wf.channelId) : [];
  const channelOptions = videoChannels.length
    ? videoChannels.map((c) => `<option value="${esc(c.id)}" ${c.id === wf.channelId ? 'selected' : ''}>${esc(c.name)}${c.active ? ' · 默认' : ''}</option>`).join('')
    : '<option value="">没有可用的视频渠道</option>';
  const shortModel = (w) => {
    const name = String(w.label || w.id);
    const channel = videoChannels.find((c) => c.id === w.channelId);
    if (channel && name.startsWith(channel.name)) return name.slice(channel.name.length).replace(/^[\s·|/\\-—]+/, '').trim() || name;
    return name;
  };
  const modelOptions = isAuto
    ? autodlWorkflows.map((w) => `<option value="${esc(w.id)}" ${w.id === wf.id ? 'selected' : ''}>${esc(String(w.display).replace(/^\[官网API\]\s*/, ''))}</option>`).join('')
    : (channelWorkflows.length
      ? channelWorkflows.map((w) => `<option value="${esc(w.id)}" ${w.id === wf.id ? 'selected' : ''}>${esc(shortModel(w))}</option>`).join('')
      : `<option value="${esc(wf.id)}" selected>${esc((channel && (channel.model || channel.name)) || wf.label)}</option>`);

  const remote = isManager
    ? `<div class="h3-remote-group">
      <button type="button" class="h3-remote h3-panel-remote is-ready" data-act="go-video-channels" title="外接管理器：用真实 Chrome 账号跑豆包 / Gemini">
        <span class="h3-remote-dot"></span>
        <span class="h3-remote-msg is-strong">${esc(wf.platform === 'gemini' ? 'Gemini · 管理器' : '豆包 · 管理器')}</span>
        <span class="h3-remote-host">${esc((channel && channel.baseUrl) || '127.0.0.1:17778')}</span>
      </button>
      <button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-act="open-manager" title="打开管理器工作台（本机 17778）">打开管理器</button>
    </div>`
    : isAuto
    ? `<button type="button" class="h3-remote h3-panel-remote is-ready" data-act="go-keys" title="官网 API 直接按 Key 计费调用，无需开云端机器">
        <span class="h3-remote-dot"></span>
        <span class="h3-remote-msg is-strong">AutoDL 官网 API · ${keyCount} 个 Key</span>
        <span class="h3-remote-host">autodl.art</span>
      </button>`
    : `<button type="button" class="h3-remote h3-panel-remote ${channel ? 'is-ready' : 'is-unconfigured'}" data-act="go-video-channels" title="自定义视频渠道：填你自己的接口地址与 Key">
        <span class="h3-remote-dot"></span>
        <span class="h3-remote-msg is-strong">${channel ? esc(channel.name) : '自定义渠道'}</span>
        <span class="h3-remote-host">${esc((channel && channel.baseUrl) || '未填写接口')}</span>
      </button>`;

  const ratioOptions = isManager && (wf.ratios || []).length ? wf.ratios : ['9:16', '16:9', '1:1'];
  const currentRatio = (String(s.aspectRatio || '').match(/\d+:\d+/) || [wf.defaultRatio || '16:9'])[0];
  const aspectField = isAuto
    ? `<div class="h3-field h3-compose-field is-aspect">
        <div class="h3-field-head"><span class="h3-field-label">分辨率</span></div>
        <div class="h3-select-wrap"><select class="h3-select" id="p-resolution">
          ${wf.resolutions.map((r) => `<option value="${esc(r)}" ${r === (s.resolution || wf.defaultResolution) ? 'selected' : ''}>${esc(r)}</option>`).join('')}
        </select><span class="h3-select-caret">${ICON.caret}</span></div>
      </div>`
    : `<div class="h3-field h3-compose-field is-aspect">
        <div class="h3-field-head"><span class="h3-field-label">画幅</span></div>
        <div class="h3-select-wrap"><select class="h3-select" id="p-aspect">
          ${ratioOptions.map((r) => `<option value="${esc(r)}" ${r === currentRatio ? 'selected' : ''}>${esc(r)}${r === '9:16' ? ' 竖屏' : r === '16:9' ? ' 横屏' : ''}</option>`).join('')}
        </select><span class="h3-select-caret">${ICON.caret}</span></div>
      </div>`;

  const stage = lastJob
    ? `<div class="stage-live">
        <div class="stage-video">${video
          ? `<video src="/api/file?path=${enc(video.path)}" controls playsinline></video>`
          : `<div class="stage-wait"><span class="h3-spinner"></span><span>${esc(lastJob.stage || '生成中')} · ${progress}%</span></div>`}</div>
        <div class="stage-meta">
          <div class="stage-line"><strong>${esc(lastJob.title)}</strong><span class="grow"></span>${jobStatusBadge(lastJob)}</div>
          <div class="stage-bar"><i style="width:${progress}%"></i></div>
          <div class="stage-line hint"><span>${esc(lastJob.stage)} · ${progress}%</span><span class="grow"></span><span>${ago(lastJob.createdAt)}</span></div>
          ${lastJob.error ? `<div class="stage-line is-danger">${esc(lastJob.error)}</div>` : ''}
          <div class="stage-line">
            <button type="button" class="h3-btn h3-btn-sm" data-act="open-job" data-id="${esc(lastJob.id)}">查看任务</button>
            ${video ? `<button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-act="play-job" data-id="${esc(lastJob.id)}">系统播放器</button>` : ''}
            ${lastJob && lastJob.outputDir ? `<button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-act="open-job-folder" data-path="${esc(lastJob.outputDir)}">打开文件夹</button>` : ''}
          </div>
        </div>
      </div>`
    : stageEmptyHtml(wf);

  const queue = recent.length
    ? `<div class="stage-queue">
        <div class="stage-queue-head">最近任务<span class="h3-statusbar-spacer"></span><span class="tnum">${state.stats.queued || 0} 排队 · ${state.stats.running || 0} 生成中</span></div>
        ${recent.map((job) => `<button type="button" class="stage-queue-row" data-act="open-job" data-id="${esc(job.id)}">
          <span class="dot ${job.status === 'success' ? 'ok' : job.status === 'failed' ? 'bad' : job.status === 'running' ? 'warn' : ''}"></span>
          <span class="stage-queue-title">${esc(job.title)}</span>
          <span class="stage-queue-state">${esc(STATUS_LABEL[job.status] || job.status)}</span>
        </button>`).join('')}
      </div>`
    : '';

  return `
  <div class="h3-main studio-main">
    <aside class="h3-panel studio-panel" style="width:${s.panelWidth ? s.panelWidth + 'px' : '67%'}">
      <div class="h3-panel-body">
        <div class="h3-panel-top">
          <div class="h3-workflow">
            <span class="h3-eyebrow">渠道</span>
            <div class="h3-select-wrap h3-workflow-select">
              <select class="h3-select" id="channel-select" title="视频渠道；默认渠道在 设置 → 视频生成 里改">${channelOptions}</select>
              <span class="h3-select-caret">${ICON.caret}</span>
            </div>
            <span class="h3-workflow-tag ${isAuto ? 'is-autodl' : (isManager ? 'is-manager' : 'is-generic')}">${isAuto ? '官网API' : isManager ? '管理器' : '自定义'}</span>
          </div>
          ${remote}
        </div>

        ${generationPrefixHtml('video')}
        <div class="h3-slots" id="slot-strip">
          <div class="h3-slots-head">
            <span class="h3-eyebrow">图像参考</span>
            <span class="h3-slots-count tnum">${images.filter(Boolean).length}/${wf.images}</span>
            <span class="h3-slots-sep"></span>
            <span class="h3-eyebrow">音频参考</span>
            <span class="h3-slots-count tnum">${audios.filter(Boolean).length}/${wf.audios}</span>
            <span class="h3-slots-spacer"></span>
            <span class="h3-slots-note">空槽不提交，提示词勿引用</span>
            <button type="button" class="h3-link h3-slots-link" data-act="upload-images" title="从本机选择图片，按原比例完整放入空槽">上传图片</button>
            <button type="button" class="h3-link h3-slots-link" data-act="upload-audio" title="从本机选择音频放入空音频槽">上传音频</button>
            <button type="button" class="h3-link h3-slots-link" data-act="pick-asset" title="从素材库挑一张图放进下一个空槽">粘贴图片</button>
            <button type="button" class="h3-link h3-slots-link" data-act="clear-assets">清空素材</button>
          </div>
          <div class="h3-strip">
            ${Array.from({ length: wf.images }, (_, i) => refSlotHtml(images[i], i, nextEmpty)).join('')}
            <span class="h3-strip-split"></span>
            ${Array.from({ length: wf.audios }, (_, i) => audioSlotHtml(audios[i], i)).join('')}
          </div>
          <input type="file" id="studio-image-file" accept="image/*" multiple hidden />
        </div>

        <div class="h3-field h3-field-grow">
          <div class="h3-field-head">
            <span class="h3-field-label">提示词</span>
            <span class="h3-field-right">
              <span class="h3-prompt-count tnum" id="prompt-count">${s.prompt.length}字</span>
              <span class="h3-view-switch">
                <button type="button" class="${mode === 'tags' ? 'is-on' : ''}" data-act="prompt-mode" data-mode="tags">标签</button>
                <button type="button" class="${mode === 'code' ? 'is-on' : ''}" data-act="prompt-mode" data-mode="code">代码</button>
              </span>
              <button type="button" class="h3-skill-btn" data-act="optimize" ${state.busy ? 'disabled' : ''} title="${state.busy ? '正在调用语言渠道' : '用语言渠道扩写成 6 段式提示词'}">${state.busy ? '优化中' : 'Skill 优化'}</button>
              <button type="button" class="h3-iconbtn is-sm" data-act="llm-channel" title="Skill 优化：语言渠道">${ICON.wand}</button>
              <button type="button" class="h3-link h3-slots-link" data-act="insert-skeleton" title="按当前主体与时长生成 6 段式骨架">插入骨架</button>
              <button type="button" class="h3-link h3-slots-link" data-act="examples" title="插入示例提示词">示例</button>
              <span class="h3-prompt-tools">
                <button type="button" class="h3-iconbtn is-sm" data-act="copy-prompt" title="复制全文">${ICON.copy}</button>
                <button type="button" class="h3-iconbtn is-sm" data-act="clear-prompt" title="清空">${ICON.trash}</button>
              </span>
            </span>
          </div>
          <div class="h3-prompt-wrap${mode === 'code' ? ' is-editing' : ''}">
            <div class="h3-prompt h3-rich-editor ${mode === 'tags' ? '' : 'is-hidden'}" id="prompt-view" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="输入 @ 引用参考图、主体、音频、说话人、对白、画外音或镜头">${mode === 'tags' ? promptRichHtml(s.prompt) : ''}</div>
            <div class="h3-mention-pop" id="studio-mention-pop" hidden></div>            <textarea class="h3-prompt-code ${mode === 'code' ? '' : 'is-hidden'}" id="prompt-editor" spellcheck="false"
              placeholder="输入 @ 选择已上传的图片或音频。用 <Picture 1> 引用参考图、<Subject 1> 引用主体、<Audio 1> 引用音频，用 <d>[Chinese] 台词</d> 写对白。">${esc(s.prompt)}</textarea>
            <div id="studio-reference-menu" class="studio-reference-menu" role="listbox" aria-label="参考素材" hidden></div>
          </div>
          <div class="prompt-warn ${(s.warnings || []).length ? 'show' : ''}" id="prompt-warn">${(s.warnings || []).map((w) => '· ' + esc(w)).join('<br>')}</div>
        </div>

        <div class="h3-compose">
          <div class="h3-compose-params">
            <div class="h3-field h3-compose-field is-model">
              <div class="h3-field-head"><span class="h3-field-label">视频模型</span></div>
              <div class="h3-select-wrap"><select class="h3-select" id="p-model" title="${esc(wf.note || '')}">
                ${modelChoices.map((w) => `<option value="${esc(w.id)}" ${w.id === wf.id ? 'selected' : ''}>${esc(shortModel(w))}</option>`).join('')}
              </select><span class="h3-select-caret">${ICON.caret}</span></div>
            </div>
            ${aspectField}
            <div class="h3-field h3-compose-field is-duration">
              <div class="h3-field-head"><span class="h3-field-label">时长</span></div>
              <div class="h3-select-wrap"><select class="h3-select" id="p-duration" ${(wf.durationOptions || []).length === 1 ? 'disabled' : ''}>
                ${((wf.durationOptions && wf.durationOptions.length) ? wf.durationOptions : Array.from({ length: 15 }, (_, i) => i + 1)).map((n) => `<option value="${n}" ${n === Number(s.duration) ? 'selected' : ''}>${n} 秒</option>`).join('')}
              </select><span class="h3-select-caret">${ICON.caret}</span></div>
            </div>
            <div class="h3-field h3-compose-field is-num">
              <div class="h3-field-head"><span class="h3-field-label">数量</span></div>
              <input class="h3-input" id="p-count" type="number" min="1" max="5" value="${Number(s.count) || 1}" />
            </div>
            ${isManager ? '' : `<div class="h3-field h3-compose-field is-num">
              <div class="h3-field-head"><span class="h3-field-label">种子</span></div>
              <input class="h3-input h3-mono" id="p-seed" value="${esc(s.seed)}" placeholder="随机" />
            </div>`}
            ${wf.pass2 ? `<div class="h3-field h3-compose-field is-num">
              <div class="h3-field-head"><span class="h3-field-label">${esc(wf.pass2.label || '二次采样')}</span></div>
              <div class="h3-select-wrap"><select class="h3-select" id="p-megapixels2">
                ${(wf.pass2.options || []).map((m) => `<option value="${m}" ${Number(m) === Number(s.megapixels2 || wf.pass2.default) ? 'selected' : ''}>${m}</option>`).join('')}
              </select><span class="h3-select-caret">${ICON.caret}</span></div>
            </div>` : ''}
          </div>
          <div class="h3-generate">
            <button type="button" class="h3-btn h3-btn-primary h3-btn-lg" data-act="generate" ${state.busy ? 'disabled' : ''}>生成视频</button>
            <div class="h3-generate-hint"><span class="tnum">${isAuto ? '官网 API' : esc(wf.providerLabel || '自定义')} · ${esc(isAuto ? (s.resolution || wf.defaultResolution) : s.aspectRatio.split(' ')[0])} · ${s.duration}s</span></div>
          </div>
        </div>
      </div>
    </aside>

    <div class="h3-splitter" title="拖动调整创作台宽度"></div>

    <div class="h3-stage">
      <div class="h3-toolbar">
        <span class="h3-toolbar-title">舞台</span>
        <span class="h3-toolbar-spacer"></span>
        <button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-act="go-jobs">任务日志</button>
      </div>
      <div class="h3-stage-body">
        ${stage}
        ${queue}
      </div>
    </div>
  </div>`;
}


function bindStudio(root) {
  bindGenerationParameters(root,'video');
  const s = state.studio;
  const wf = currentWorkflow();

  bindSplitter(root, '.studio-panel', (width) => {
    s.panelWidth = width || null;
    if (width) localStorage.setItem('h3.panelWidth', String(width));
    else localStorage.removeItem('h3.panelWidth');
  });

  const applyWorkflowDefaults = (next) => {
    if (!next) return;
    s.workflowId = next.id;
    s.channelId = next.channelId || '';
    s.resolution = next.defaultResolution || '';
    s.megapixels = next.megapixelsDefault || 0;
    s.megapixels2 = next.pass2 ? next.pass2.default : 0;
    s.duration = Math.min(15, next.durationDefault || 10);
    if (next.defaultRatio) s.aspectRatio = next.defaultRatio;
    localStorage.setItem('h3.workflowId', s.workflowId);
  };

  const channelSel = $('#channel-select', root);
  if (channelSel) {
    channelSel.onchange = () => {
      const id = channelSel.value;
      if (!id) {
        const auto = state.workflows.find((w) => w.provider === 'autodl' && w.id === s.workflowId)
          || state.workflows.find((w) => w.provider === 'autodl');
        applyWorkflowDefaults(auto);
      } else {
        const first = state.workflows.find((w) => w.channelId === id);
        applyWorkflowDefaults(first || workflowById('ch:' + id));
      }
      render();
    };
  }

  const modelSel = $('#p-model', root);
  if (modelSel) {
    modelSel.onchange = () => {
      applyWorkflowDefaults(workflowById(modelSel.value));
      render();
    };
  }

  const editor = $('#prompt-editor', root);
  if (editor) {
    editor.oninput = () => {
      s.prompt = editor.value;
      const count = $('#prompt-count');
      if (count) count.textContent = s.prompt.length + '字';
      studioPersist();
    };
    editor.onblur = () => { validatePromptSoon(); };
    const menu = $('#studio-reference-menu', root);
    if (menu) bindStudioMentions(editor, menu);
  }

  const uploadInput = $('#studio-image-file', root);
  if (uploadInput) {
    uploadInput.onchange = async () => {
      const files = [...(uploadInput.files || [])];
      uploadInput.value = '';
      if (files.length) await studioUploadImages(files);
    };
  }
  const slotArea = $('.h3-slots', root);
  if (slotArea) {
    slotArea.ondragover = (event) => { if (![...(event.dataTransfer.types || [])].includes('Files')) return; event.preventDefault(); slotArea.classList.add('is-drop'); };
    slotArea.ondragleave = () => slotArea.classList.remove('is-drop');
    slotArea.ondrop = async (event) => {
      const files = [...(event.dataTransfer.files || [])].filter((f) => String(f.type || '').startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      slotArea.classList.remove('is-drop');
      await studioUploadImages(files);
    };
  }

  const rich = $('#prompt-view', root);
  if (rich) bindStudioRichEditor(rich);


  const bindChange = (sel, key, cast = String) => {
    const el = $(sel, root);
    if (!el) return;
    el.onchange = () => { s[key] = cast(el.value); };
  };
  bindChange('#p-resolution', 'resolution');
  bindChange('#p-aspect', 'aspectRatio');
  bindChange('#p-duration', 'duration', Number);
  bindChange('#p-megapixels', 'megapixels', Number);
  bindChange('#p-megapixels2', 'megapixels2', Number);
  const countEl = $('#p-count', root);
  if (countEl) countEl.onchange = () => { s.count = Math.max(1, Math.min(5, Number(countEl.value) || 1)); };
  const seedEl = $('#p-seed', root);
  if (seedEl) seedEl.oninput = () => { s.seed = seedEl.value; };

  root.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    try {
      if (act === 'upload-images') { const el = $('#studio-image-file'); if (el) el.click(); return; }
      if (act === 'upload-audio') {
        const wf = currentWorkflow();
        const index = state.studio.audios.findIndex((x) => !x);
        if (!wf.audios) return toast('当前工作流不接收音频参考', true);
        if (index < 0 || index >= wf.audios) return toast('音频槽已满', true);
        return openAudioPicker(index);
      }
      if (act === 'add-image') return openImagePicker(Number(target.dataset.index));
      if (act === 'remove-image') { s.images[Number(target.dataset.index)] = null; return render(); }
      if (act === 'remove-audio') { s.audios[Number(target.dataset.index)] = null; return render(); }
      if (act === 'name-subject') {
        const index = Number(target.dataset.index);
        const img = s.images[index];
        if (!img) return;
        return askText('命名主体', img.subject, '例如：护法武僧、湖畔少女、雪山古寺', (text) => {
          img.subject = text;
          render();
        });
      }
      if (act === 'add-audio') return openAudioPicker(Number(target.dataset.index));
      if (act === 'voice-pick') return openVoiceDialog(Number(target.dataset.index));
      if (act === 'preview-audio') return previewAudio(s.audios[Number(target.dataset.index)]);
      if (act === 'prompt-mode') { s.promptMode = target.dataset.mode; return render(); }
      if (act === 'copy-prompt') {
        await navigator.clipboard.writeText(s.prompt || '');
        toast('已复制提示词');
        return;
      }
      if (act === 'insert-tag') { s.promptMode = 'code'; render(); return openTagMenu(); }
      if (act === 'insert-skeleton') { s.promptMode = 'code'; s.prompt = state.prompt.skeleton; render(); toast('已插入六段式骨架'); return; }
      if (act === 'examples') return openExamples();
      if (act === 'clear-prompt') { s.prompt = ''; s.warnings = []; s.promptMode = 'code'; return render(); }
      if (act === 'optimize') { s.promptMode = 'code'; return optimizePrompt(); }
      if (act === 'generate') return generate();
      if (act === 'open-job') { return openJobDetail(target.dataset.id); }
      if (act === 'go-jobs') { state.logTab='video';localStorage.setItem('h3.logs.tab','video');location.hash = '#logs'; return; }
      if (act === 'open-manager') {
        const ch = (state.channels.video || []).find((c) => c.id === s.channelId);
        await api('/api/open', { method: 'POST', body: { url: (ch && ch.baseUrl) || 'http://127.0.0.1:17778' } });
        return;
      }
      if (act === 'open-job-folder') {
        await api('/api/reveal', { method: 'POST', body: { path: target.dataset.path } });
        return;
      }
      if (act === 'play-job') {
        const job = state.jobs.find((j) => j.id === target.dataset.id);
        const video = job && (job.outputs || []).find((o) => o.type === 'video');
        if (video) await api('/api/media/open', { method: 'POST', body: { path: video.path, player: true } });
        return;
      }
      if (act === 'add-video-channel') return openChannelDialog('video', null);
      if (act === 'go-video-channels') return openSettings('channels');
      if (act === 'go-keys') return openSettings('keys');
      if (act === 'pick-asset') { const slot = s.images.findIndex((x) => !x); return openImagePicker(slot < 0 ? 0 : slot); }
      if (act === 'clear-assets') { s.images = s.images.map(() => null); s.audios = s.audios.map(() => null); return render(); }
      if (act === 'llm-channel') return openSettings('channels');
    } catch (err) {
      toast(err.message, true);
    }
  });

  const grid = $('#slot-strip', root);
  if (grid) {
    grid.addEventListener('dragover', (event) => { event.preventDefault(); grid.classList.add('is-drop'); });
    grid.addEventListener('dragleave', () => grid.classList.remove('is-drop'));
    grid.addEventListener('drop', async (event) => {
      event.preventDefault();
      grid.classList.remove('is-drop');
      const files = Array.from(event.dataTransfer.files || []);
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const saved = await uploadFile(file, 'image');
        if (saved) {
          let slot = s.images.findIndex((x) => !x);
          if (slot < 0) slot = s.images.length;
          s.images[slot] = saved;
        }
      }
      render();
    });
  }
}

async function uploadFile(file, kind) {
  if (!/\.(mp4|webm|mp3|wav|m4a|ogg|flac)$/i.test(file.name)) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
    const saved = await api('/api/upload', { method: 'POST', body: { name: file.name, data } });
    return { path: saved.path, name: saved.name, subject: '', kind };
  }
  const response = await fetch('/api/upload/raw?name=' + encodeURIComponent(file.name), {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || '上传失败 HTTP ' + response.status);
  const saved = result.data;
  return { path: saved.path, name: saved.name, subject: '', kind };
}

function insertAtCursor(text) {
  const editor = $('#prompt-editor');
  if (!editor) return;
  const start = editor.selectionStart || 0;
  const end = editor.selectionEnd || 0;
  const value = editor.value;
  editor.value = value.slice(0, start) + text + value.slice(end);
  editor.selectionStart = editor.selectionEnd = start + text.length;
  state.studio.prompt = editor.value;
  const count = $('#prompt-count');
  if (count) count.textContent = state.studio.prompt.length + ' 字';
  editor.focus();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

async function studioUploadImages(files) {
  const s = state.studio;
  const wf = currentWorkflow();
  let index = s.images.findIndex((x) => !x);
  for (const file of files) {
    if (!file || !String(file.type || '').startsWith('image/')) { toast(file && file.name ? file.name + ' 不是图片' : '不是图片文件', true); continue; }
    if (file.size > 10 * 1024 * 1024) { toast(file.name + ' 超过 10MB', true); continue; }
    if (index < 0) {
      if ((s.images || []).length >= wf.images) { toast('参考图槽已满（' + wf.images + ' 张）', true); break; }
      index = s.images.length;
    }
    if (index >= wf.images) { toast('参考图槽已满（' + wf.images + ' 张）', true); break; }
    try {
      const data = await fileToDataUrl(file);
      const saved = await api('/api/assets/upload', { method: 'POST', body: { name: file.name, data } });
      s.images[index] = { path: saved.path, name: saved.name || file.name, subject: '', kind: 'image' };
      index += 1;
    } catch (err) { toast(file.name + ' 上传失败：' + err.message, true); }
  }
  studioPersist();
  render();
}

function studioReferenceTags(studio = state.studio, workflow = currentWorkflow()) {
  const images = studio.images.slice(0, workflow.images).filter(Boolean);
  const audios = studio.audios.slice(0, workflow.audios).filter(Boolean);
  return [
    ...images.map((img, i) => ({ label: '<Picture ' + (i + 1) + '>  ' + (img.subject || img.name || '图像 ' + (i + 1)), insert: '<Picture ' + (i + 1) + '>' })),
    ...images.flatMap((img, i) => img.subject ? [{ label: '<Subject ' + (i + 1) + '>  ' + img.subject, insert: '<Subject ' + (i + 1) + '>' }] : []),
    ...audios.map((audio, i) => ({ label: '<Audio ' + (i + 1) + '>  ' + (audio.name || '音频 ' + (i + 1)), insert: '<Audio ' + (i + 1) + '>' })),
  ];
}

function bindStudioMentions(editor, host) {
  let range = null, index = 0, items = [];
  function close() { range = null; host.hidden = true; host.innerHTML = ''; editor.removeAttribute('aria-expanded'); }
  function choose(at) {
    if (!range || !items[at]) return;
    editor.setSelectionRange(range.start, range.end);
    insertAtCursor(items[at].insert + ' ');
    close(); validatePromptSoon();
  }
  function update() {
    if (editor.selectionStart !== editor.selectionEnd) return close();
    const prefix = editor.value.slice(0, editor.selectionStart);
    const match = prefix.match(/@([^@\s<>]*)$/);
    if (!match) return close();
    const query = match[1].toLowerCase();
    range = { start: prefix.length - match[0].length, end: prefix.length };
    items = studioReferenceTags().filter(item => item.label.toLowerCase().includes(query));
    index = Math.min(index, Math.max(0, items.length - 1));
    host.hidden = false; editor.setAttribute('aria-expanded', 'true');
    host.innerHTML = items.length ? items.map((item, at) => '<button type="button" role="option" aria-selected="' + (at === index) + '" data-reference-index="' + at + '">' + esc(item.label) + '</button>').join('') : '<span>没有匹配素材，请先上传图片或音频</span>';
    host.querySelectorAll('button').forEach(button => { button.onmousedown = event => event.preventDefault(); button.onclick = () => choose(Number(button.dataset.referenceIndex)); });
  }
  editor.addEventListener('input', () => { index = 0; update(); });
  editor.addEventListener('click', update);
  editor.addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update(); });
  editor.addEventListener('keydown', event => {
    if (event.isComposing || !range) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (items.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); index = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; update(); }
    else if (items.length && ['Enter', 'Tab'].includes(event.key)) { event.preventDefault(); choose(index); }
  });
  editor.addEventListener('blur', close);
}

function openTagMenu() {
  const s = state.studio;
  const tags = studioReferenceTags();
  const extra = [
    { label: '对白  <d>[Chinese] 台词</d>', insert: '<d>[Chinese] </d>' },
    { label: '分镜  [Shot 2] At 00:04.000, ', insert: '[Shot 2] At 00:04.000, ' },
    { label: '任务类型  [reference generation]', insert: '[reference generation] ' },
    { label: '跨切台词  <scenetrans>', insert: '<scenetrans>' },
    { label: '截断标记  <cutoff>', insert: '<cutoff>' },
    { label: '保留关系  fully_preserved', insert: 'fully_preserved' },
  ];
  openModal(`
    <div class="modal-head"><h2>插入标签</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="section"><h3>参考素材</h3><div class="chip-list">${tags.length ? tags.map((t, i) => `<button class="chip" data-tag="${i}">${esc(t.label)}</button>`).join('') : '<span class="hint">先添加参考图/音频</span>'}</div></div>
      <div class="section"><h3>结构与语法</h3><div class="chip-list">${extra.map((t, i) => `<button class="chip" data-extra="${i}">${esc(t.label)}</button>`).join('')}</div></div>
    </div>
  `);
  $$('#modal-panel [data-tag]').forEach((btn) => {
    btn.onclick = () => { insertAtCursor(tags[Number(btn.dataset.tag)].insert); closeModal(); };
  });
  $$('#modal-panel [data-extra]').forEach((btn) => {
    btn.onclick = () => { insertAtCursor(extra[Number(btn.dataset.extra)].insert); closeModal(); };
  });
}

function openExamples() {
  const examples = state.prompt.examples || [];
  openModal(`
    <div class="modal-head"><h2>六段式示例</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body">
      ${examples.map((ex, i) => `<div class="section"><div class="row"><strong>${esc(ex.title)}</strong><span class="grow"></span><button class="btn sm" data-example="${i}">插到编辑器</button></div><pre class="mono" style="white-space:pre-wrap;max-height:260px;overflow:auto;background:var(--surface-2);padding:10px;border-radius:9px;margin:0">${esc(ex.text)}</pre></div>`).join('')}
    </div>
  `);
  $$('#modal-panel [data-example]').forEach((btn) => {
    btn.onclick = () => {
      state.studio.prompt = examples[Number(btn.dataset.example)].text;
      state.studio.promptMode = 'code';
      closeModal();
      render();
    };
  });
}

function openImagePicker(slotIndex) {
  const items = (state.assets ? state.assets.items : []).filter((i) => i.kind === 'image');
  openModal(`
    <div class="modal-head"><h2>选择参考图</h2><span class="grow"></span>
      <button class="btn sm" id="picker-upload">上传本地图片</button>
      <button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="grid-cards">${items.map((item, i) => `
        <div class="asset-card" data-pick="${i}">
          <div class="asset-thumb"><img src="${item.url}" alt="" loading="lazy" /></div>
          <div class="asset-meta"><span class="name">${esc(item.name)}</span><span class="sub">${esc(item.typeLabel || '')}${item.group ? ' · ' + esc(item.group) : ''}${item.subject ? ' · ' + esc(item.subject) : ''}</span></div>
        </div>`).join('') || '<div class="empty">素材库还没有图片</div>'}</div>
    </div>
  `);
  $$('#modal-panel [data-pick]').forEach((card) => {
    card.onclick = () => {
      const item = items[Number(card.dataset.pick)];
      state.studio.images[slotIndex] = { path: item.path, name: item.name, subject: item.subject || '', kind: 'image' };
      closeModal();
      render();
    };
  });
  $('#picker-upload').onclick = () => {
    const input = $('#file-input');
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      const saved = await uploadFile(file, 'image');
      state.studio.images[slotIndex] = saved;
      closeModal();
      render();
    };
    input.click();
  };
}

function openAudioPicker(slotIndex) {
  const items = (state.assets ? state.assets.items : []).filter((i) => i.kind === 'audio');
  openModal(`
    <div class="modal-head"><h2>选择参考音频</h2><span class="grow"></span>
      <button class="btn sm" id="picker-upload">上传本地音频</button>
      <button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="grid-cards">${items.map((item, i) => `
        <div class="asset-card" data-pick="${i}">
          <div class="asset-thumb">♪</div>
          <div class="asset-meta"><span class="name">${esc(item.name)}</span><span class="sub">${esc(item.folder)} · ${fmtBytes(item.bytes)}</span></div>
        </div>`).join('') || '<div class="empty">素材库还没有音频</div>'}</div>
      <div class="hint">原版的「内置音色」由远程工作流提供，源码版只支持本地音频文件。</div>
    </div>
  `);
  $$('#modal-panel [data-pick]').forEach((card) => {
    card.onclick = () => {
      const item = items[Number(card.dataset.pick)];
      state.studio.audios[slotIndex] = { path: item.path, name: item.name, kind: 'audio' };
      closeModal();
      render();
    };
  });
  $('#picker-upload').onclick = () => {
    const input = $('#file-input');
    input.accept = 'audio/*';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      const saved = await uploadFile(file, 'audio');
      state.studio.audios[slotIndex] = saved;
      closeModal();
      render();
    };
    input.click();
  };
}

function studioAssetsPayload() {
  const s = state.studio;
  const assets = [];
  s.images.forEach((img, i) => { if (img) assets.push({ token: `<Picture ${i + 1}>`, kind: 'image', name: img.name, subjectName: img.subject || '', path: img.path }); });
  s.audios.forEach((audio, i) => { if (audio) assets.push({ token: `<Audio ${i + 1}>`, kind: 'audio', name: audio.name, path: audio.path }); });
  const subjects = s.images.map((img, i) => img && img.subject ? { ordinal: i + 1, name: img.subject, tokens: [`<Picture ${i + 1}>`] } : null).filter(Boolean);
  return { assets, subjects };
}

let validateTimer = null;
function validatePromptSoon() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(async () => {
    const s = state.studio;
    if (!s.prompt.trim()) return;
    try {
      const { assets, subjects } = studioAssetsPayload();
      const res = await api('/api/prompt/validate', { method: 'POST', body: { prompt: s.prompt, duration: s.duration, assets, subjects } });
      s.warnings = res.warnings || [];
      const warn = $('#prompt-warn');
      if (warn) {
        warn.innerHTML = s.warnings.map((w) => '· ' + esc(w)).join('<br>');
        warn.classList.toggle('show', s.warnings.length > 0);
      }
    } catch { /* silent */ }
  }, 700);
}

async function optimizePrompt() {
  const s = state.studio;
  if (!s.prompt.trim()) return toast('先写点想要的画面再优化', true);
  state.busy = true;
  render();
  try {
    const { assets, subjects } = studioAssetsPayload();
    const data = await api('/api/optimize', {
      method: 'POST',
      body: {
        prompt: s.prompt,
        assets,
        subjects,
        duration: s.duration,
        language: (state.config.prompt && state.config.prompt.language) || 'zh',
        includeImages: true,
      },
    });
    s.prompt = data.prompt;
    s.warnings = data.warnings || [];
    toast(`优化完成 · ${data.model || ''} · ${Math.round(data.elapsedMs / 1000)} 秒`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
    render();
  }
}

async function generate() {
  const s = state.studio;
  const workbenchContext = WB.context("video");
  await WB.flush("video");
  const wf = currentWorkflow();
  if (!s.prompt.trim()) return toast('提示词不能为空', true);
  if (!s.images.filter(Boolean).length) return toast('至少添加一张参考图', true);
  state.busy = true;
  render();
  try {
    const body = {
      ...workbenchContext,
      requestId:crypto.randomUUID(),
      workflowId: wf.id,
      prompt: s.prompt,
      prefixPrompt:generationPrefixValue('video'),
      images: s.images.filter(Boolean).map((img) => ({ path: img.path, name: img.name, subject: img.subject || '' })),
      audios: s.audios.filter(Boolean).map((audio) => ({ path: audio.path, name: audio.name })),
      duration: s.duration,
      resolution: s.resolution || wf.defaultResolution,
      aspectRatio: s.aspectRatio,
      megapixels: s.megapixels || wf.megapixelsDefault,
      megapixels2: s.megapixels2 || (wf.pass2 ? wf.pass2.default : 0),
      seed: s.seed === '' ? null : Number(s.seed),
      count: s.count || 1,
      styleId: state.project && state.project.styleId,
    };
    const data = await api('/api/jobs', { method: 'POST', body });
    state.jobs = (await api('/api/jobs')).jobs;
    if (WB.context("video").itemId === workbenchContext.itemId) state.lastJobId = data.jobs[0].id;
    try { localStorage.setItem('h3.lastJobId', state.lastJobId); } catch { /* ignore */ }
    toast(`已加入队列 ${data.jobs.length} 条`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
    render();
  }
}

/* ------------------------------------------------------------------ jobs */

const STATUS_LABEL = { queued: '排队', running: '生成中', success: '完成', failed: '失败', canceled: '已取消', interrupted: '已中断' };

function jobStatusBadge(job) {
  return `<span class="badge ${job.status === 'success' ? 'ok' : job.status === 'failed' ? 'bad' : job.status === 'running' ? 'info' : ''}">${STATUS_LABEL[job.status] || job.status}</span>`;
}

function renderJobs(embed = false) {
  const filter = state.jobFilter || { status: '', provider: '' };
  const query = (filter.query || '').trim().toLowerCase();
  const jobs = state.jobs.filter((j) => (!filter.status || j.status === filter.status) && (!filter.provider || j.provider === filter.provider) && (!query || [j.title, j.prompt, j.id, j.workflowId].some((v) => String(v || '').toLowerCase().includes(query)))).sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  const page = taskPagination(jobs, 'running');
  const counts = { queued: 0, running: 0, success: 0, failed: 0 };
  state.jobs.forEach((j) => { if (counts[j.status] !== undefined) counts[j.status]++; });
  const head = `
  <div class="page-head">
    <div><h1>运行任务管理</h1><p>视频任务 · 排队 ${counts.queued} · 生成中 ${counts.running} · 完成 ${counts.success} · 失败 ${counts.failed}</p></div>
    <div class="page-actions"><button class="btn" data-act="go-logs">查看执行日志</button><button class="btn" data-act="go-studio">去创作台</button></div>
  </div>`;
  return `${embed ? '' : head}
  <form class="task-search" data-task-search><label for="task-search">搜索视频任务</label><div><input class="input" id="task-search" name="query" value="${esc(filter.query || '')}" placeholder="输入任务名称、提示词或 ID" /><button class="btn" type="submit">搜索</button></div></form>
  <div class="filters">
    ${['', 'queued', 'running', 'success', 'failed', 'canceled'].map((s) => `<button class="chip ${filter.status === s ? 'active' : ''}" data-filter-status="${s}">${s ? STATUS_LABEL[s] : '全部状态'}</button>`).join('')}
    <span style="width:12px"></span>
    ${[['', '全部渠道'], ['manager', '本机管理器'], ['generic', '自定义']].map(([p, label]) => `<button class="chip ${filter.provider === p ? 'active' : ''}" data-filter-provider="${p}">${label}</button>`).join('')}
    ${embed ? '<span class="grow"></span><button class="btn sm" data-act="go-logs">查看执行日志</button>' : ''}
  </div>
  ${jobs.length ? `<div class="table-wrap"><table class="jobs task-job-table">
    <thead><tr><th>状态</th><th>任务</th><th>工作流</th><th>参考</th><th>进度</th><th>创建</th><th>操作</th></tr></thead>
    <tbody>${page.rows.map((job) => {
      const wf = workflowById(job.workflowId);
      const video = (job.outputs || []).find((o) => o.type === 'video');
      return `<tr class="status-${job.status}">
        <td data-label="状态">${jobStatusBadge(job)}${job.stage && job.stage !== STATUS_LABEL[job.status] ? `<div class="hint">${esc(job.stage)}</div>` : ''}</td>
        <td data-label="任务" class="cell-prompt"><div class="task-row-title" title="${esc(job.title)}"><strong>${esc(job.title)}</strong>${job.held ? ' <span class="badge">锁定</span>' : ''}</div><div class="one-line">${esc(job.excerpt || job.prompt)}</div></td>
        <td data-label="工作流"><div class="small">${wf ? esc(wf.label) : esc(job.workflowId)}</div><div class="hint">${job.provider === 'manager' ? '本机管理器' : job.provider === 'autodl' ? '官网 API' : '自定义'}</div></td>
        <td data-label="参考" class="small">${(job.images || []).length} 图 · ${(job.audios || []).length} 音频<div class="hint">${job.duration || '—'} 秒 · ${esc(job.resolution || job.aspectRatio || '')}</div></td>
        <td data-label="进度"><div class="mini-bar"><i style="width:${job.progress || 0}%"></i></div><div class="hint">${job.progress || 0}%</div></td>
        <td data-label="创建" class="small">${fmtTime(job.createdAt)}<div class="hint">${ago(job.createdAt)}</div></td>
        <td data-label="操作"><div class="cell-actions">
          ${job.status === 'queued' || job.status === 'running' ? `<button class="btn sm" data-act="cancel" data-id="${job.id}">取消</button>` : ''}
          ${job.provider === 'manager' && job.remotePromptId && ['failed', 'canceled'].includes(job.status) ? `<button class="btn sm" data-act="resume" data-id="${job.id}">继续查询／下载</button>` : ''}
          ${job.status === 'failed' || job.status === 'canceled' || job.status === 'success' ? `<button class="btn sm" data-act="retry" data-id="${job.id}">重试</button>` : ''}
          ${job.status === 'queued' ? `<button class="btn sm" data-act="${job.held ? 'unhold' : 'hold'}" data-id="${job.id}">${job.held ? '解锁' : '锁定'}</button>` : ''}
          ${video ? `<button class="btn sm" data-act="play" data-id="${job.id}">播放</button>` : ''}
          ${job.outputDir ? `<button class="btn sm" data-act="reveal" data-id="${job.id}">文件夹</button>` : ''}
          <button class="btn sm ghost" data-act="detail" data-id="${job.id}">详情</button>
          ${job.status !== 'running' ? `<button class="btn sm ghost" data-act="delete" data-id="${job.id}">删除</button>` : ''}
        </div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>${page.footer}` : `<div class="card"><div class="empty"><strong>${state.jobs.length ? '没有匹配的任务' : '还没有任务'}</strong><p>${state.jobs.length ? '试试其他关键词，或切换到全部状态、全部渠道。' : '在创作台生成视频后，任务进度与结果会显示在这里。'}</p><button class="btn primary" data-act="go-studio">去创作台</button></div></div>`}
  `;
}

function bindJobs(root) {
  root.querySelector('[data-task-search]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    state.jobFilter = { ...(state.jobFilter || {}), query: new FormData(event.target).get('query') || '' };
    if (state.taskPages) state.taskPages.running = 1;
    render();
  });
  root.addEventListener('click', async (event) => {
    const filterStatus = event.target.closest('[data-filter-status]');
    const filterProvider = event.target.closest('[data-filter-provider]');
    if (filterStatus) { if (state.taskPages) state.taskPages.running = 1; state.jobFilter = { ...(state.jobFilter || {}), status: filterStatus.dataset.filterStatus }; return render(); }
    if (filterProvider) { if (state.taskPages) state.taskPages.running = 1; state.jobFilter = { ...(state.jobFilter || {}), provider: filterProvider.dataset.filterProvider }; return render(); }
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    const id = target.dataset.id;
    try {
      if (act === 'go-logs') { state.logTab='video';localStorage.setItem('h3.logs.tab','video');location.hash='#logs';return; }
      if (act === 'go-studio') { location.hash = '#studio'; return; }
      if (act === 'cancel') { await api(`/api/jobs/${id}/cancel`, { method: 'POST' }); toast('已请求取消'); }
      if (act === 'resume') { await api(`/api/jobs/${id}/resume`, { method: 'POST' }); toast('已继续原任务，不会重新生成'); }
      if (act === 'retry') { await api(`/api/jobs/${id}/retry`, { method: 'POST' }); toast('已重新排队'); }
      if (act === 'delete') {
        if (!confirm('删除这条任务记录？（不会删除已下载的视频）')) return;
        await api(`/api/jobs/${id}/delete`, { method: 'POST' });
      }
      if (act === 'hold') { await api(`/api/jobs/${id}/hold`, { method: 'POST' }); }
      if (act === 'unhold') { await api(`/api/jobs/${id}/unhold`, { method: 'POST' }); }
      if (act === 'play') {
        const job = state.jobs.find((j) => j.id === id);
        const video = job && (job.outputs || []).find((o) => o.type === 'video');
        if (video) await api('/api/media/open', { method: 'POST', body: { path: video.path, player: true } });
      }
      if (act === 'reveal') {
        const job = state.jobs.find((j) => j.id === id);
        if (job && job.outputDir) await api('/api/reveal', { method: 'POST', body: { path: job.outputDir } });
      }
      if (act === 'detail') return openJobDetail(id);
      state.jobs = (await api('/api/jobs')).jobs;
      render();
    } catch (err) { toast(err.message, true); }
  });
}

async function openJobDetail(id) {
  const job = state.jobs.find((j) => j.id === id);
  if (!job) return;
  let logs = job.logs || [];
  try { logs = (await api(`/api/jobs/${id}/logs`)).logs || []; } catch { /* ignore */ }
  const video = (job.outputs || []).find((o) => o.type === 'video');
  openModal(`
    <div class="modal-head"><h2>${esc(job.title)}</h2>${jobStatusBadge(job)}<span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="kv"><span>任务 ID</span><span class="mono">${esc(job.id)}</span></div>
      <div class="kv"><span>工作流</span><span>${esc(job.workflowId)}</span></div>
      <div class="kv"><span>参数</span><span>${esc(job.resolution || job.aspectRatio)} · ${job.duration} 秒 · seed ${job.seed}</span></div>
      <div class="kv"><span>远程 ID</span><span class="mono">${esc(job.remotePromptId || '—')}</span></div>
      ${job.error ? `<div class="badge bad" style="align-self:flex-start">${esc(job.error)}</div>` : ''}
      ${video ? `<video src="/api/file?path=${enc(video.path)}" controls style="width:100%;border-radius:10px;background:#111"></video>` : ''}
      <div class="section"><h3>提示词</h3><pre class="mono" style="white-space:pre-wrap;max-height:220px;overflow:auto;background:var(--surface-2);padding:10px;border-radius:9px;margin:0">${esc(job.prompt)}</pre></div>
      <div class="section"><h3>日志</h3><pre class="mono" style="white-space:pre-wrap;max-height:240px;overflow:auto;background:var(--surface-2);padding:10px;border-radius:9px;margin:0">${logs.map((l) => `[${fmtTime(l.t)}] ${l.level} ${esc(l.text)}`).join('\n') || '（暂无日志）'}</pre></div>
    </div>
    <div class="modal-foot">
      ${video ? `<button class="btn" data-open-player="${esc(video.path)}">系统播放器打开</button>` : ''}
      ${job.outputDir ? `<button class="btn" data-open-folder="${esc(job.outputDir)}">打开文件夹</button>` : ''}
      <button class="btn" data-close="1">关闭</button>
    </div>
  `);
  const player = $('#modal-panel [data-open-player]');
  if (player) player.onclick = () => api('/api/media/open', { method: 'POST', body: { path: player.dataset.openPlayer, player: true } }).catch((e) => toast(e.message, true));
  const folder = $('#modal-panel [data-open-folder]');
  if (folder) folder.onclick = () => api('/api/reveal', { method: 'POST', body: { path: folder.dataset.openFolder } }).catch((e) => toast(e.message, true));
}

/* ------------------------------------------------------------------ assets */

const ASSET_MATERIALS = [
  { id: 'character', label: '人物' },
  { id: 'scene', label: '场景' },
  { id: 'prop', label: '道具' },
];

function assetTypeMeta(id) {
  return ASSET_MATERIALS.find((item) => item.id === id) || { id, label: id || '其他' };
}

function assetMatch(item) {
  const query = (state.assetQuery || '').toLowerCase();
  return !query || String(item.name || '').toLowerCase().includes(query) || String(item.note || '').toLowerCase().includes(query);
}

function currentAssetView() {
  const data = state.assetLibrary;
  const view = state.assetView || { kind: 'material', type: 'character' };
  if (view.kind === 'material' && !ASSET_MATERIALS.some((item) => item.id === view.type)) view.type = 'character';
  if (view.kind === 'shot') {
    const task = (data?.tasks || []).find((row) => (view.taskId ? row.id === view.taskId : row.title === view.taskTitle));
    if (!task || !(task.shots || []).some((shot) => shot.name === view.name)) return { kind: 'material', type: 'character' };
    return { ...view, taskId: task.id, taskTitle: task.title };
  }
  return view;
}

async function loadAssetLibrary() {
  state.assetLibrary = await api('/api/assets/library');
  return state.assetLibrary;
}

function assetLibraryEmpty(text, hint) {
  return `<div class="card"><div class="empty"><strong>${esc(text)}</strong><p>${esc(hint)}</p></div></div>`;
}

function assetTaskKey(task) { return task.id || task.title; }

function renderAssetSidebar(data, view) {
  const query = String(state.assetQuery || '').toLowerCase();
  const tasks = (data.tasks || []).filter((task) => !query
    || String(task.title).toLowerCase().includes(query)
    || (task.shots || []).some((shot) => String(shot.name).toLowerCase().includes(query)));
  const activeTaskKey = view.kind === 'shot' ? (view.taskId || view.taskTitle) : '';
  const expanded = state.assetExpanded || {};
  return `<aside class="library-nav">
    <div class="library-nav-head"><h2>素材库</h2><span class="hint">${(data.tasks || []).length} 个任务 · ${(data.shots || []).length} 个分镜</span></div>
    <div class="library-group">
      <div class="library-group-title">资产</div>
      ${ASSET_MATERIALS.map((material) => `<button class="lib-item ${view.kind === 'material' && view.type === material.id ? 'active' : ''}" data-lib-material="${material.id}">
        <span>${esc(material.label)}</span><em>${(data.materials && data.materials[material.id] || []).length}</em>
      </button>`).join('')}
    </div>
    <div class="library-group">
      <div class="library-group-title"><span>分镜</span><button class="lib-add" data-act="new-task" title="新建任务">＋ 任务</button></div>
      ${tasks.length ? tasks.map((task) => {
        const key = assetTaskKey(task);
        const isOpen = expanded[key] === true;
        return `<div class="lib-task-block">
          <div class="lib-task-row">
            <button class="lib-caret" data-lib-toggle="${esc(key)}" title="${isOpen ? '收起' : '展开'}">${isOpen ? '▾' : '▸'}</button>
            <button class="lib-node lib-task ${activeTaskKey === key ? 'active' : ''}" data-lib-toggle="${esc(key)}" title="任务 ID：${esc(task.id || '未记录')}">
              <span class="lib-node-main">${esc(task.title)}</span>
              <small class="lib-node-id">${esc(task.id ? task.id.slice(-10) : '未保存')}</small>
            </button>
            <em class="lib-count">${task.count}</em>
            <button class="lib-op" data-task-rename="${esc(key)}" data-task-id="${esc(task.id || '')}" data-task-title="${esc(task.title)}" title="重命名任务">✎</button>
            <button class="lib-op" data-task-delete="${esc(key)}" data-task-id="${esc(task.id || '')}" data-task-title="${esc(task.title)}" title="删除任务">×</button>
          </div>
          ${isOpen ? `<div class="lib-sub">${(task.shots || []).map((shot) => `<div class="lib-shot-row">
            <button class="lib-node lib-shot ${view.kind === 'shot' && view.name === shot.name && (view.taskId || '') === (task.id || '') ? 'active' : ''}" data-lib-shot="${esc(shot.name)}" data-task-id="${esc(task.id || '')}" data-task-title="${esc(task.title)}">
              <span class="lib-node-main">${esc(shot.name)}</span><small class="lib-node-id">${shot.count}/9</small>
            </button>
            <button class="lib-op" data-shot-rename="${esc(shot.name)}" data-task-id="${esc(task.id || '')}" data-task-title="${esc(task.title)}" title="重命名镜头">✎</button>
            <button class="lib-op" data-shot-delete="${esc(shot.name)}" data-task-id="${esc(task.id || '')}" data-task-title="${esc(task.title)}" title="删除镜头">×</button>
          </div>`).join('') || '<div class="lib-empty">这个任务还没有镜头</div>'}</div>` : ''}
        </div>`;
      }).join('') : '<div class="lib-empty">保存任务后会同步到这里</div>'}
    </div>
    ${(data.other || []).length ? `<div class="library-group">
      <div class="library-group-title">其他</div>
      <button class="lib-item ${view.kind === 'other' ? 'active' : ''}" data-lib-other="1"><span>未归类</span><em>${(data.other || []).length}</em></button>
    </div>` : ''}
  </aside>`;
}

function renderAssetGrid(items, emptyText, emptyHint) {
  if (!items.length) return assetLibraryEmpty(emptyText, emptyHint);
  return `<div class="grid-cards asset-grid">${items.map((item) => `
    <div class="asset-card" data-asset-rel="${esc(item.rel)}">
      <div class="asset-thumb">${item.kind === 'image' ? `<img src="${item.url}" alt="" loading="lazy" />` : '♪'}</div>
      <div class="asset-meta"><span class="name" title="${esc(item.name)}">${esc(item.name)}</span><span class="sub">${esc(item.kind === 'audio' ? '音频' : (item.typeLabel || ''))}${item.bytes ? ' · ' + fmtBytes(item.bytes) : ''}</span></div>
    </div>`).join('')}</div>`;
}

function renderMaterialView(data, view) {
  const material = ASSET_MATERIALS.find((item) => item.id === view.type) || ASSET_MATERIALS[0];
  const items = ((data.materials && data.materials[view.type]) || []).filter(assetMatch);
  return `<div class="library-main-head">
    <div><h2>${esc(material.label)}</h2><p class="hint">素材 → ${esc(material.label)} · ${items.length} 个文件</p></div>
    <div class="library-actions">
      <button class="btn" data-act="upload-material">上传${esc(material.label)}</button>
    </div>
  </div>
  ${renderAssetGrid(items, `还没有${material.label}素材`, `点右上角「上传${material.label}」，文件会放进 assets/素材/${material.label}/`)}`;
}

function renderOtherView(data) {
  const items = (data.other || []).filter(assetMatch);
  return `<div class="library-main-head"><div><h2>其他</h2><p class="hint">没有归类的旧文件 · ${items.length} 个</p></div></div>
    ${renderAssetGrid(items, '没有其他文件', '旧结构里的文件会显示在这里。')}`;
}

function renderSlotCard(shot, slot) {
  return `<div class="slot-card ${slot.rel ? 'has-image' : ''}" data-slot="${slot.slot}">
    <div class="slot-head"><b>${esc(slot.label)}</b><span class="hint">${slot.slot}/9</span></div>
    <div class="slot-thumb">${slot.rel ? `<img src="${slot.url}" alt="${esc(slot.label)}" loading="lazy" />` : '<span class="slot-plus">＋</span>'}</div>
    <div class="slot-actions">
      <button class="btn sm" data-slot-upload="${slot.slot}">${slot.rel ? '替换' : '上传'}</button>
      <button class="btn sm ghost" data-slot-pick="${slot.slot}">素材库</button>
      ${slot.rel ? `<button class="btn sm ghost" data-slot-clear="${slot.slot}">清除</button>` : ''}
    </div>
  </div>`;
}

function renderShotFacts(shot) {
  const json = shot.json || {};
  const images = Array.isArray(json.images) ? json.images : [];
  const extras = Object.entries(json.extra || {}).filter(([, value]) => String(value).trim() !== '');
  const notes = images.filter((image) => image.note).map((image) => `${image.slot || '图'} ${image.note}`);
  const styleName = state.styleDetail?.name || state.project?.style?.name || '';
  const prefixText = json.prefixPrompt || (json.styleId ? `项目风格：${styleName || json.styleId}` : '无');
  const facts = [
    ['任务', `${shot.taskTitle || '—'}${shot.taskId ? ' · ' + shot.taskId : ''}`, true],
    ['分镜名称', shot.name],
    ['视频提示词', json.prompt || '—', true],
    ['视频前置提示词', prefixText, true],
    ['参考图', `${shot.count} / 9`],
    ['视频画幅', json.ratio || '渠道默认'],
    ['视频时长', json.duration ? `${json.duration} 秒` : '渠道默认'],
    ['来源文件', json.source || '手工创建'],
    ['导入时间', json.importedAt ? new Date(json.importedAt).toLocaleString('zh-CN', { hour12: false }) : '—'],
  ];
  if (notes.length) facts.push(['素材说明', notes.join('；'), true]);
  if (extras.length) facts.push(['扩展字段', extras.map(([key, value]) => `${key}：${value}`).join('；'), true]);
  return `<section class="shot-facts">
    <div class="shot-facts-head"><b>分镜资料</b><span class="hint">由 shot.json 解析</span></div>
    <dl class="shot-facts-grid">${facts.map(([label, value, wide]) => `<div class="${wide ? 'wide' : ''}"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
  </section>`;
}

function renderShotView(data, view) {
  const task = (data.tasks || []).find((row) => (view.taskId ? row.id === view.taskId : row.title === view.taskTitle));
  const shot = task && (task.shots || []).find((row) => row.name === view.name);
  if (!shot) return assetLibraryEmpty('分镜不存在', '它可能已经被删除。');
  return `<div class="library-main-head">
    <div><h2>${esc(shot.name)}</h2><p class="hint">任务 / ${esc(shot.taskTitle || task.title)}${shot.taskId ? ' · ' + esc(shot.taskId) : ''} · ${shot.count}/9 张参考图</p></div>
    <div class="library-actions">
      <button class="btn" data-act="new-shot">新建镜头</button>
      <button class="btn ghost" data-act="reveal-shot">打开文件夹</button>
    </div>
  </div>
  <div class="slot-grid">${shot.slots.map((slot) => renderSlotCard(shot, slot)).join('')}</div>
  ${renderShotFacts(shot)}`;
}

function renderAssets() {
  if (!state.assetLibrary) return `<div class="empty"><span class="spinner"></span></div>`;
  const data = state.assetLibrary;
  const view = currentAssetView();
  const body = view.kind === 'shot' ? renderShotView(data, view)
    : view.kind === 'other' ? renderOtherView(data)
    : renderMaterialView(data, view);
  return `<div class="library-page" style="width:100%">
    ${renderAssetSidebar(data, view)}
    <section class="library-main">
      <div class="library-top">
        <input class="input" id="asset-search" placeholder="搜索素材 / 分镜" value="${esc(state.assetQuery || '')}" />
        <button class="btn sm ghost" data-act="refresh-assets">重新扫描</button>
        <button class="btn sm ghost" data-act="open-assets">打开目录</button>
      </div>
      ${body}
    </section>
  </div>`;
}

function assetConfirm(title, text, onConfirm) {
  openModal(`<div class="modal-head"><h2>${esc(title)}</h2><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body"><p>${esc(text || '')}</p></div>
    <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">取消</button><button class="btn danger" id="asset-confirm-ok">删除</button></div>`);
  document.querySelector('#asset-confirm-ok').onclick = async () => {
    try {
      await onConfirm();
      if (document.querySelector('#modal:not([hidden])')) closeModal();
    } catch (err) { toast(err.message, true); }
  };
}

function assetDetailModal(item) {
  const panel = openModal(`<div class="modal-head"><h2>${esc(item.name)}</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body"><div class="asset-preview">${item.kind === 'image' ? `<img src="${item.url}" alt="" />` : `<audio src="${item.url}" controls></audio>`}</div>
    <div class="kv"><span>分类</span><span>${esc(item.typeLabel || item.type || '其他')}</span></div>
    <div class="kv"><span>路径</span><span class="mono">${esc(item.rel || '')}</span></div></div>
    <div class="modal-foot"><button class="btn" data-asset-rename="1">重命名</button><button class="btn ghost" data-asset-delete="1">删除</button><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>`);
  panel.querySelector('[data-asset-rename]').onclick = () => askText('重命名素材', item.name, '文件名', async (name) => {
    if (!name) return;
    await api('/api/assets/material/rename', { method: 'POST', body: { rel: item.rel, name } });
    await loadAssetLibrary(); render(); toast('素材已重命名');
  });
  panel.querySelector('[data-asset-delete]').onclick = () => assetConfirm(`删除「${item.name}」？`, '文件会从素材库删除，不能恢复。', async () => {
    await api('/api/assets/material/delete', { method: 'POST', body: { rel: item.rel } });
    await loadAssetLibrary(); render(); toast('素材已删除');
  });
}

function pickSlotFile(task, shotName, slot) {
  const input = $('#file-input');
  if (!input) return;
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = (input.files || [])[0];
    input.value = '';
    if (!file) return;
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取失败'));
        reader.readAsDataURL(file);
      });
      await api('/api/assets/shot/slot', { method: 'POST', body: { taskId: task.id, taskTitle: task.title, shot: shotName, slot, name: file.name, data } });
      await loadAssetLibrary();
      render();
      toast('已写入图' + ['一', '二', '三', '四', '五', '六', '七', '八', '九'][slot - 1]);
    } catch (err) { toast(err.message, true); }
  };
  input.click();
}

async function openAssetPicker(task, shotName, slot) {
  let type = 'character';
  const draw = () => {
    const data = state.assetLibrary || {};
    const items = (data.materials && data.materials[type]) || [];
    const grid = items.length
      ? `<div class="grid-cards asset-grid picker-grid">${items.map((item) => `<div class="asset-card" data-pick-rel="${esc(item.rel)}"><div class="asset-thumb"><img src="${item.url}" alt="" loading="lazy" /></div><div class="asset-meta"><span class="name">${esc(item.name)}</span><span class="sub">${esc(item.typeLabel || '')}</span></div></div>`).join('')}</div>`
      : '<div class="hint">这个分类还没有素材。</div>';
    return `<div class="picker-tabs">${ASSET_MATERIALS.map((material) => `<button class="chip ${type === material.id ? 'active' : ''}" data-picker-type="${material.id}">${material.label}</button>`).join('')}</div>${grid}`;
  };
  const panel = openModal(`<div class="modal-head"><h2>从素材库选择 · 图${['一', '二', '三', '四', '五', '六', '七', '八', '九'][slot - 1]}</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body"><div id="asset-picker-body">${draw()}</div></div>`);
  const body = panel.querySelector('#asset-picker-body');
  const bind = () => {
    body.querySelectorAll('[data-picker-type]').forEach((button) => {
      button.onclick = () => { type = button.dataset.pickerType; body.innerHTML = draw(); bind(); };
    });
    body.querySelectorAll('[data-pick-rel]').forEach((card) => {
      card.onclick = async () => {
        try {
          await api('/api/assets/shot/slot', { method: 'POST', body: { taskId: task.id, taskTitle: task.title, shot: shotName, slot, source: card.dataset.pickRel } });
          closeModal();
          await loadAssetLibrary();
          render();
          toast('已从素材库放入');
        } catch (err) { toast(err.message, true); }
      };
    });
  };
  bind();
}

function bindAssets(root) {
  if (!state.assetLibrary) {
    loadAssetLibrary().then(() => { if (state.route === 'assets') render(); }).catch((err) => toast(err.message, true));
  }
  const search = $('#asset-search');
  if (search) {
    search.oninput = () => {
      state.assetQuery = search.value;
      clearTimeout(state.assetSearchTimer);
      state.assetSearchTimer = setTimeout(() => {
        render();
        const el = $('#asset-search');
        if (el) { el.focus(); el.selectionStart = el.value.length; }
      }, 220);
    };
  }
  root.addEventListener('click', async (event) => {
    const material = event.target.closest('[data-lib-material]');
    if (material) { state.assetView = { kind: 'material', type: material.dataset.libMaterial }; return render(); }
    const toggle = event.target.closest('[data-lib-toggle]');
    if (toggle) {
      const key = toggle.dataset.libToggle;
      state.assetExpanded = { ...(state.assetExpanded || {}), [key]: !(state.assetExpanded || {})[key] };
      return render();
    }
    const taskAddShot = event.target.closest('[data-task-add-shot]');
    if (taskAddShot) {
      return askText('新建镜头', '', '例如：镜头16', async (name) => {
        if (!name) return;
        await api('/api/assets/shot', { method: 'POST', body: { taskId: taskAddShot.dataset.taskId, taskTitle: taskAddShot.dataset.taskTitle, name } });
        state.assetExpanded = { ...(state.assetExpanded || {}), [taskAddShot.dataset.taskAddShot]: true };
        state.assetView = { kind: 'shot', taskId: taskAddShot.dataset.taskId, taskTitle: taskAddShot.dataset.taskTitle, name };
        await loadAssetLibrary(); render(); toast('镜头已创建');
      });
    }
    const taskRename = event.target.closest('[data-task-rename]');
    if (taskRename) {
      const task = (state.assetLibrary.tasks || []).find((row) => (row.id || row.title) === taskRename.dataset.taskRename);
      return askText('重命名任务', task?.title || taskRename.dataset.taskTitle || '', '任务名称', async (title) => {
        if (!title) return;
        await api('/api/assets/task/rename', { method: 'POST', body: { taskId: taskRename.dataset.taskId, taskTitle: taskRename.dataset.taskTitle, title } });
        await loadAssetLibrary(); render(); toast('任务已重命名');
      });
    }
    const taskDelete = event.target.closest('[data-task-delete]');
    if (taskDelete) {
      const task = (state.assetLibrary.tasks || []).find((row) => (row.id || row.title) === taskDelete.dataset.taskDelete);
      return assetConfirm(`删除任务「${task?.title || taskDelete.dataset.taskTitle}」？`, '任务下的镜头目录和图片副本都会删除，素材库原图不受影响。', async () => {
        await api('/api/assets/task/delete', { method: 'POST', body: { taskId: taskDelete.dataset.taskId, taskTitle: taskDelete.dataset.taskTitle } });
        const view = currentAssetView();
        if (view.kind === 'shot' && (view.taskId || '') === taskDelete.dataset.taskId) state.assetView = { kind: 'material', type: 'character' };
        await loadAssetLibrary(); render(); toast('任务已删除');
      });
    }
    const shotRename = event.target.closest('[data-shot-rename]');
    if (shotRename) {
      return askText('重命名镜头', shotRename.dataset.shotRename, '镜头名称', async (name) => {
        if (!name) return;
        await api('/api/assets/shot/rename', { method: 'POST', body: { taskId: shotRename.dataset.taskId, taskTitle: shotRename.dataset.taskTitle, shot: shotRename.dataset.shotRename, name } });
        const view = currentAssetView();
        if (view.kind === 'shot' && view.name === shotRename.dataset.shotRename) state.assetView = { ...view, name };
        await loadAssetLibrary(); render(); toast('镜头已重命名');
      });
    }
    const shotDelete = event.target.closest('[data-shot-delete]');
    if (shotDelete) {
      return assetConfirm(`删除镜头「${shotDelete.dataset.shotDelete}」？`, '这个镜头目录和其中的图片副本会删除。', async () => {
        await api('/api/assets/shot/delete', { method: 'POST', body: { taskId: shotDelete.dataset.taskId, taskTitle: shotDelete.dataset.taskTitle, name: shotDelete.dataset.shotDelete } });
        state.assetView = { kind: 'material', type: 'character' };
        await loadAssetLibrary(); render(); toast('镜头已删除');
      });
    }
    const shot = event.target.closest('[data-lib-shot]');
    if (shot) {
      const taskId = shot.dataset.taskId || '';
      const taskTitle = shot.dataset.taskTitle || '';
      state.assetView = { kind: 'shot', taskId, taskTitle, name: shot.dataset.libShot };
      state.assetExpanded = { ...(state.assetExpanded || {}), [taskId || taskTitle]: true };
      return render();
    }
    if (event.target.closest('[data-lib-other]')) { state.assetView = { kind: 'other' }; return render(); }
    const card = event.target.closest('[data-asset-rel]');
    if (card) {
      const item = (state.assetLibrary.items || []).find((row) => row.rel === card.dataset.assetRel);
      if (item) return assetDetailModal(item);
    }
    const view = currentAssetView();
    const task = view.kind === 'shot'
      ? (state.assetLibrary.tasks || []).find((row) => (view.taskId ? row.id === view.taskId : row.title === view.taskTitle))
      : null;
    const uploadSlot = event.target.closest('[data-slot-upload]');
    if (uploadSlot) return pickSlotFile(task, view.name, Number(uploadSlot.dataset.slotUpload));
    const pickSlot = event.target.closest('[data-slot-pick]');
    if (pickSlot) return openAssetPicker(task, view.name, Number(pickSlot.dataset.slotPick));
    const clearSlot = event.target.closest('[data-slot-clear]');
    if (clearSlot) {
      try {
        await api('/api/assets/shot/clear', { method: 'POST', body: { taskId: task.id, taskTitle: task.title, shot: view.name, slot: Number(clearSlot.dataset.slotClear) } });
        await loadAssetLibrary(); render(); toast('已清除');
      } catch (err) { toast(err.message, true); }
      return;
    }
    const action = event.target.closest('[data-act]');
    if (!action) return;
    try {
      if (action.dataset.act === 'refresh-assets') { await loadAssetLibrary(); return render(); }
      if (action.dataset.act === 'open-assets') { await api('/api/reveal', { method: 'POST', body: { path: state.assetLibrary.root } }); return; }
      if (action.dataset.act === 'upload-material') {
        const input = $('#file-input');
        input.accept = 'image/*';
        input.onchange = async () => {
          const file = (input.files || [])[0];
          input.value = '';
          if (!file) return;
          try {
            const data = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error('读取失败'));
              reader.readAsDataURL(file);
            });
            await api('/api/assets/material/upload', { method: 'POST', body: { type: view.type, name: file.name, data } });
            await loadAssetLibrary(); render(); toast('已上传到' + assetTypeMeta(view.type).label);
          } catch (err) { toast(err.message, true); }
        };
        input.click();
        return;
      }
      if (action.dataset.act === 'new-task') {
        return askText('新建任务', '', '任务名称', async (title) => {
          if (!title) return;
          const task = await api('/api/assets/task', { method: 'POST', body: { title } });
          state.assetExpanded = { ...(state.assetExpanded || {}), [task.id || task.title]: true };
          await loadAssetLibrary(); render(); toast('任务已创建');
        });
      }
      if (action.dataset.act === 'new-shot') {
        const currentTask = (state.assetLibrary.tasks || []).find((row) => (view.taskId ? row.id === view.taskId : row.title === view.taskTitle));
        if (!currentTask) return;
        return askText('新建镜头', '', '镜头名称', async (name) => {
          if (!name) return;
          await api('/api/assets/shot', { method: 'POST', body: { taskId: currentTask.id, taskTitle: currentTask.title, name } });
          state.assetExpanded = { ...(state.assetExpanded || {}), [currentTask.id || currentTask.title]: true };
          state.assetView = { kind: 'shot', taskId: currentTask.id || '', taskTitle: currentTask.title, name };
          await loadAssetLibrary(); render(); toast('镜头已创建');
        });
      }
      if (action.dataset.act === 'reveal-shot') {
        const currentTask = (state.assetLibrary.tasks || []).find((row) => (view.taskId ? row.id === view.taskId : row.title === view.taskTitle));
        const currentShot = currentTask && (currentTask.shots || []).find((row) => row.name === view.name);
        const dir = currentShot ? requirePathJoin(state.assetLibrary.root, currentShot.rel) : state.assetLibrary.root;
        await api('/api/reveal', { method: 'POST', body: { path: dir } });
      }
    } catch (err) { toast(err.message, true); }
  });
}

function requirePathJoin(root, rel) {
  return String(root).replace(/[\\/]+$/, '') + '\\' + String(rel || '').replace(/\//g, '\\');
}

/* ------------------------------------------------------------------ media */

function renderMedia() {
  const kind = state.mediaKind || 'video';
  const data = state.media;
  if (!data) return `<div class="empty"><span class="spinner"></span></div>`;
  const items = data.items.filter((i) => i.kind === kind);
  const shotNumber = (value) => {
    const match = /(\d+)/.exec(String(value || ''));
    return match ? Number(match[1]) : 9999;
  };
  const groups = new Map();
  items.forEach((item, index) => {
    const key = item.taskTitle || '未记录任务';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, index });
  });
  groups.forEach((rows) => rows.sort((a, b) => (shotNumber(a.item.shotLabel || a.item.outputLabel) - shotNumber(b.item.shotLabel || b.item.outputLabel)) || (b.item.mtime - a.item.mtime)));
  const projectLabel = data.projectName || data.projectId || '未选择项目';
  const projects = state.projects || [];
  return `
  <div class="page-head">
    <div><h1>媒体库</h1><p class="media-project-bar">
      ${projects.length ? `<label>项目 <select class="select" id="media-project">${projects.map((project) => `<option value="${esc(project.id)}" ${project.id === data.projectId ? 'selected' : ''}>${esc(project.name)}</option>`).join('')}</select></label>` : `<span class="media-project">项目：${esc(projectLabel)}</span>`}
      <span class="mono">${esc(data.root)}</span></p></div>
    <div class="page-actions">
      ${kind === 'video' ? '<button class="btn" data-act="rename-media-shots">按镜头名重命名</button>' : ''}
      <button class="btn" data-act="open-media-root">打开目录</button>
      <button class="btn" data-act="refresh-media">刷新</button>
      <button class="btn primary" data-act="media-edit">剪辑 / 工程</button>
    </div>
  </div>
  <div class="filters">
    <button class="chip ${kind === 'video' ? 'active' : ''}" data-kind="video">视频 ${data.items.filter((i) => i.kind === 'video').length}</button>
    <button class="chip ${kind === 'image' ? 'active' : ''}" data-kind="image">图像 ${data.items.filter((i) => i.kind === 'image').length}</button>
  </div>
  ${items.length ? [...groups.entries()].map(([taskTitle, rows]) => `<section class="media-task-group">
    <div class="media-task-head"><b>${esc(taskTitle)}</b><span class="hint">${rows.length} 条</span></div>
    <div class="grid-cards">${rows.map(({ item, index }) => `
      <div class="media-card" data-media="${index}">
        <div class="media-thumb ${item.kind === 'video' ? 'is-video' : ''}">${item.kind === 'image' ? `<img src="${item.url}" loading="lazy" />` : `<video src="${item.url}#t=0.5" preload="metadata" muted></video>`}</div>
        <div class="media-meta">
          <span class="name">${esc(item.shotLabel || item.outputLabel || item.name)}</span>
          <span class="sub">${item.name.replace(/\.[^.]+$/, '') !== (item.shotLabel || item.outputLabel) ? esc(item.name) + ' · ' : ''}${esc(item.day)} · ${fmtBytes(item.bytes)}</span>
        </div>
      </div>`).join('')}</div>
  </section>`).join('') : `<div class="card"><div class="empty"><strong>还没有${kind === 'video' ? '视频' : '图片'}</strong><p>生成的成片会自动保存到媒体库目录，按日期 / 任务分文件夹。</p></div></div>`}
  `;
}

async function openMediaRenameModal() {
  const preview = await api('/api/media/rename-shots', { method: 'POST', body: { dryRun: true } });
  if (!preview.plan.length) { toast('当前媒体库没有需要重命名的成片'); return; }
  const groups = new Map();
  preview.plan.forEach((row) => {
    const key = row.taskTitle || '未记录任务';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const panel = openModal(`<div class="modal-head">
      <div><h2>按镜头名重命名</h2><div class="hint">文件名直接用分镜名称（是镜头 01 就叫 镜头 01.mp4），只改文件名，不动视频内容</div></div>
      <button class="btn ghost sm" data-close="1">关闭</button>
    </div>
    <div class="modal-body">
      <div class="rename-media-list">${[...groups.entries()].map(([taskTitle, rows]) => `<section>
        <h3>${esc(taskTitle)}<span class="hint">${rows.length} 条</span></h3>
        ${rows.map((row) => `<div class="rename-media-row"><span class="old">${esc(row.oldName)}</span><span class="arrow">→</span><span class="new">${esc(row.newName)}</span>${row.shotTitle ? `<span class="hint">${esc(row.shotTitle)}</span>` : ''}</div>`).join('')}
      </section>`).join('')}</div>
      <p class="hint">共 ${preview.plan.length} 个文件。确认后立即改名；文件名已经和分镜名称一致的文件会跳过。</p>
    </div>
    <div class="modal-foot"><span class="grow"></span><button class="btn ghost" data-close="1">取消</button><button class="btn primary" id="media-rename-ok">确认重命名</button></div>`);
  panel.classList.add('modal-wide');
  panel.querySelector('#media-rename-ok').onclick = async () => {
    const button = panel.querySelector('#media-rename-ok');
    button.disabled = true;
    try {
      const result = await api('/api/media/rename-shots', { method: 'POST', body: { dryRun: false } });
      state.media = await api('/api/media');
      closeModal();
      render();
      toast(`已重命名 ${result.moved.length} 个成片`);
    } catch (err) {
      button.disabled = false;
      toast(err.message, true);
    }
  };
}

function openMediaDetail(item) {
  const url = esc(item.url || '/api/file?path=' + enc(item.path));
  openModal(`
    <div class="modal-head"><h2>${esc(item.shotLabel || item.name)}</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div style="background:var(--surface-2);border-radius:10px;display:grid;place-items:center;min-height:240px;overflow:hidden">
        ${item.kind === 'video'
          ? `<video src="${url}" controls autoplay playsinline preload="metadata" style="width:100%;max-height:65vh;background:#111"></video>`
          : `<img src="${url}" alt="${esc(item.name)}" style="max-width:100%;max-height:65vh;object-fit:contain" />`}
      </div>
      ${item.taskTitle ? `<div class="kv"><span>任务</span><span>${esc(item.taskTitle)}</span></div>` : ''}
      ${item.shotLabel ? `<div class="kv"><span>分镜</span><span>${esc(item.shotLabel)}</span></div>` : ''}
      <div class="kv"><span>文件</span><span class="mono">${esc(item.name)}</span></div>
      <div class="kv"><span>大小</span><span>${fmtBytes(item.bytes)}</span></div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="media-preview-edit">加入剪辑</button><button class="btn" data-close="1">关闭</button></div>
  `);
  $('#modal-panel .modal-body').insertAdjacentHTML('beforeend','<section id="generation-details">正在读取生成资料…</section>');
  WB.mediaDetails(item);
  $('#media-preview-edit').onclick = () => openVideoEditor(item).catch(e => toast(e.message, true));
}

function bindMedia(root) {
  root.querySelector('#media-project')?.addEventListener('change', async (event) => {
    try { await setActiveProject(event.target.value); }
    catch (err) { toast(err.message, true); }
  });
  root.addEventListener('click', async (event) => {
    const kindBtn = event.target.closest('[data-kind]');
    if (kindBtn) { state.mediaKind = kindBtn.dataset.kind; return render(); }
    const card = event.target.closest('[data-media]');
    if (card) {
      const kind = state.mediaKind || 'video';
      const items = state.media.items.filter((i) => i.kind === kind);
      const item = items[Number(card.dataset.media)];
      if (!item) return;
      return openMediaDetail(item);
    }
    const target = event.target.closest('[data-act]');
    if (!target) return;
    try {
      if (target.dataset.act === 'media-edit') return await openVideoEditor();
      if (target.dataset.act === 'rename-media-shots') return await openMediaRenameModal();
      if (target.dataset.act === 'refresh-media') { state.media = await api('/api/media'); return render(); }
      if (target.dataset.act === 'open-media-root') { await api('/api/reveal', { method: 'POST', body: { path: state.media.root } }); }
    } catch (err) { toast(err.message, true); }
  });
}

/* ------------------------------------------------------------------ image */

function imageChannels() {
  return state.channels.image || [];
}

function imageChannel() {
  const list = imageChannels().filter((c) => c.enabled !== false);
  return list.find((c) => c.id === state.image.channelId) || list.find((c) => c.active) || list[0] || null;
}

function imageSizeOptions(channel) {
  if (!channel) return ['auto'];
  if (channel.type === 'gemini-image') return ['1K', '2K', '4K'];
  if (channel.type === 'chat-image') return ['auto', '1024x1024', '1536x1024', '1024x1536'];
  return ['auto', '1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792'];
}

const GEAR = '<svg class="h3-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
const IMG_ICON = '<svg class="h3-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>';
const DOWN_ICON = '<svg class="h3-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m7 10 5 5 5-5"></path><path d="M12 15V3"></path></svg>';

function fileUrl(file) {
  return '/api/file?path=' + encodeURIComponent(file);
}

// 拖动分隔条调整左侧面板宽度（原版双击可复位）
function bindSplitter(root, panelSel, onResize) {
  const panel = $(panelSel, root);
  const splitter = $('.h3-splitter', root) || $('.zs-splitter', root);
  if (!panel || !splitter) return;
  splitter.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = panel.getBoundingClientRect().width;
    const move = (ev) => {
      const max = Math.max(560, window.innerWidth - 380);
      const width = Math.round(Math.max(560, Math.min(max, startW + ev.clientX - startX)));
      panel.style.width = width + 'px';
      const inner = $('.zs-panel-inner', panel);
      if (inner) inner.style.width = width + 'px';
      onResize(width);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      render();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
  });
  splitter.addEventListener('dblclick', () => { onResize(null); render(); });
}


function imageTabsHtml(tab) {
  return `<div class="h3-page-tabs">
    <button type="button" class="h3-page-tab ${tab === 'edit' ? 'is-on' : ''}" data-img-tab="edit">图像编辑</button>
    <button type="button" class="h3-page-tab ${tab === 'generate' ? 'is-on' : ''}" data-img-tab="generate">图像生成</button>
    <button type="button" class="h3-page-tab ${tab === 'reverse' ? 'is-on' : ''}" data-img-tab="reverse">图像反推</button>
    <button type="button" class="h3-page-tab ${tab === 'scene' ? 'is-on' : ''}" data-img-tab="scene">场景建模</button>
    <span class="h3-toolbar-spacer"></span>
    <button type="button" class="h3-iconbtn" data-act="manage-image-channels" title="图像渠道">${GEAR}</button>
  </div>`;
}

function generationPrefixValue(kind) {
  const value=kind==='video'?state.studio:state.image;
  if(typeof value.prefixPrompt==='string')return value.prefixPrompt;
  const style=state.styleDetail;if(!style)return '';
  let layer=kind==='video'?'video':value.styleLayer||'auto';
  if(layer==='auto'){const text=value.prompt||'';layer=/角色|人物|身份板|立绘|形象/.test(text)?'character':/场景|环境|背景|地点/.test(text)?'scene':/道具|物品|物件|武器/.test(text)?'prop':'video';}
  return String(style[layer]||'').trim();
}
const prefixOpen={image:false,video:false};
const layoutOpen={image:true};
function generationPrefixHtml(kind) {
  const value=kind==='video'?state.studio:state.image;
  const open=prefixOpen[kind]!==false;
  const text=generationPrefixValue(kind);
  const flat=text.replace(/\s+/g,' ').trim();
  const toggle='<button type="button" class="btn sm ghost" data-prefix-toggle="'+kind+'" aria-expanded="'+(open?'true':'false')+'" aria-controls="'+kind+'-prefix-body" title="'+(open?'收起前置提示词':'展开前置提示词')+'">'+(open?'收起 ▴':'展开 ▾')+'</button>';
  const summary=open?'':'<p class="generation-prefix-summary">已收起：'+esc(flat?flat.slice(0,42)+(flat.length>42?'…':''):'未填写（留空则不添加）')+'</p>';
  const layer=kind==='image'?'<select class="zs-select" id="image-style-layer" aria-label="前置词类型">'+[['auto','按正文自动选择'],['character','人物'],['scene','场景'],['prop','道具'],['video','通用 / 视频']].map(([id,title])=>'<option value="'+id+'" '+((value.styleLayer||'auto')===id?'selected':'')+'>'+title+'</option>').join('')+'</select>':'';
  const body=open?'<div class="generation-prefix-body" id="'+kind+'-prefix-body">'+layer+'<textarea id="'+kind+'-prefix" class="generation-parameter-text" rows="4" placeholder="填写要加在正文之前的风格要求；留空则不添加">'+esc(text)+'</textarea><small>'+esc(typeof value.prefixPrompt==='string'?'当前画面自定义前置词':state.styleDetail?'来自项目风格：'+state.styleDetail.name:'当前项目未设置前置词，可直接填写')+'</small></div>':'';
  // 收起时用负外边距抵消所在面板的行间距，让上下各只留 2px；两个页面容器的行距不同，分别取值。
  // 收起时用负外边距抵消面板行距，上下各留 2px；图片页下方紧跟“图片比例”，它收起时由它自己带负边距。
  const nextCompact=kind==='image'&&layoutOpen.image===false;
  const collapseStyle=open?'':' style="margin-top:'+(kind==='video'?-14:-18)+'px;margin-bottom:'+(kind==='video'?-13:(nextCompact?0:-18))+'px"';
  return '<div class="generation-parameter-field generation-prefix-field generation-prefix-field-'+kind+(open?'':' is-collapsed is-compact')+'"'+collapseStyle+'><div class="generation-parameter-head generation-prefix-head"><label for="'+kind+'-prefix">前置提示词</label>'+toggle+'<button type="button" class="btn sm ghost" data-prefix-reset="'+kind+'">使用项目风格</button></div>'+summary+body+'</div>';
}
function imageLayoutParametersHtml() {
  const im=state.image,ratio=im.imageRatio||'auto',selected=GenerationParams.layout(im.imageLayoutId||'free')||GenerationParams.layout('free');
  const choices=ratio==='auto'?[GenerationParams.layout('free')]:GenerationParams.available(ratio);
  const text=typeof im.layoutPrompt==='string'?im.layoutPrompt:selected.description;
  const open=layoutOpen.image!==false;
  const toggle='<button type="button" class="btn sm ghost" data-layout-toggle="image" aria-expanded="'+(open?'true':'false')+'" aria-controls="image-layout-body" title="'+(open?'收起比例与分区设置':'展开比例与分区设置')+'">'+(open?'收起 ▴':'展开 ▾')+'</button>';
  const summary=open?'':'<p class="generation-prefix-summary">已收起：'+esc(ratio==='auto'?'由模型决定':ratio)+' · '+esc(selected.name)+'</p>';
  const preview=selected.shape?'<div class="image-layout-diagram '+selected.shape+'" style="aspect-ratio:'+ratio.replace(':','/')+'">'+selected.cells.map((text,n)=>'<span class="layout-cell cell-'+n+'">'+esc(text)+'</span>').join('')+'</div>':'';
  const body=open?'<div class="generation-layout-body" id="image-layout-body"><select class="zs-select" id="image-ratio" aria-label="图片比例">'+['auto',...GenerationParams.ratios].map(r=>'<option value="'+r+'" '+(r===ratio?'selected':'')+'>'+(r==='auto'?'由模型决定':r)+'</option>').join('')+'</select><label for="image-layout">图片样式 / 分区布局</label><select class="zs-select" id="image-layout" '+(ratio==='auto'?'disabled':'')+'>'+choices.map(l=>'<option value="'+l.id+'" '+(l.id===selected.id?'selected':'')+'>'+esc(l.name)+'</option>').join('')+'</select>'+preview+'<label for="image-layout-prompt">分区说明（可编辑）</label><textarea id="image-layout-prompt" class="generation-parameter-text" rows="5" '+(ratio==='auto'?'disabled':'')+' placeholder="自由构图，或填写每个小块放置的内容">'+esc(text)+'</textarea><small>比例和分区要求会加入生成提示词；像素尺寸使用下方渠道分辨率。</small></div>':'';
  const collapseStyle=open?'':' style="margin-top:-18px;margin-bottom:-18px"';
  return '<div class="generation-parameter-field generation-layout-field'+(open?'':' is-collapsed is-compact')+'"'+collapseStyle+'><div class="generation-parameter-head"><label>图片比例</label>'+toggle+'</div>'+summary+body+'</div>';
}
function bindGenerationParameters(root,kind) {
  const value=kind==='video'?state.studio:state.image;
  const prefix=root.querySelector('#'+kind+'-prefix');if(prefix)prefix.oninput=()=>{value.prefixPrompt=prefix.value;WB.schedule(kind);};
  const toggle=root.querySelector('[data-prefix-toggle="'+kind+'"]');if(toggle)toggle.onclick=()=>{prefixOpen[kind]=prefixOpen[kind]===false;render();};
  const reset=root.querySelector('[data-prefix-reset="'+kind+'"]');if(reset)reset.onclick=()=>{delete value.prefixPrompt;render();};
  if(kind!=='image')return;
  const layoutToggle=root.querySelector('[data-layout-toggle="image"]');if(layoutToggle)layoutToggle.onclick=()=>{layoutOpen.image=layoutOpen.image===false;render();};
  const layer=root.querySelector('#image-style-layer');if(layer)layer.onchange=()=>{value.styleLayer=layer.value;delete value.prefixPrompt;render();};
  const ratio=root.querySelector('#image-ratio');if(ratio)ratio.onchange=()=>{value.imageRatio=ratio.value;const selected=GenerationParams.layout(value.imageLayoutId||'free');if(!selected?.ratios.includes(ratio.value)){value.imageLayoutId='free';delete value.layoutPrompt;}render();};
  const layout=root.querySelector('#image-layout');if(layout)layout.onchange=()=>{value.imageLayoutId=layout.value;delete value.layoutPrompt;render();};
  const description=root.querySelector('#image-layout-prompt');if(description)description.oninput=()=>{value.layoutPrompt=description.value;WB.schedule('image');};
  root.addEventListener('input',e=>{if(e.target.id==='img-prompt'&&value.prefixPrompt===undefined&&prefix)prefix.value=generationPrefixValue('image');});
}

function imagePanelHtml(tab, ch) {
  const im = state.image;
  const sources = tab === 'edit' || tab === 'reverse';
  const source = im.source || null;
  const sizes = imageSizeOptions(ch);
  const tabsBar = `
    <div class="zs-field">
      <div class="zs-field-head">
        <span class="zs-field-label">生图模型</span>
        <span class="zs-field-right">
          <button type="button" class="zs-keystate ${ch ? 'zs-keystate-ready' : 'zs-keystate-missing'}" data-act="manage-image-channels" title="${ch ? '已配置渠道，点击管理' : '还没有图像渠道，点击新增'}">
            <span class="zs-keystate-dot"></span>${ch ? esc(ch.name) : '未配置渠道'}
          </button>
        </span>
      </div>
      <div class="zs-stack">
        <div class="zs-select-wrap">
          <select class="zs-select" id="img-channel">
            ${imageChannels().length
              ? imageChannels().map((c) => `<option value="${esc(c.id)}" ${c.id === ch.id ? 'selected' : ''}>${esc(c.name)}${c.active ? ' · 默认' : ''} · ${esc(c.model || c.type)}</option>`).join('')
              : '<option value="">没有图像渠道</option>'}
          </select>
          <span class="zs-select-caret">${ICON.caret}</span>
        </div>
        <div class="zs-row" title="渠道 / 类型">
          <div class="zs-select-wrap">
            <select class="zs-select" disabled>
              <option>${ch ? esc(ch.type) : '—'}</option>
            </select>
            <span class="zs-select-caret">${ICON.caret}</span>
          </div>
          <div class="zs-select-wrap">
            <select class="zs-select" disabled>
              <option>${ch ? esc(ch.model || '默认模型') : '—'}</option>
            </select>
            <span class="zs-select-caret">${ICON.caret}</span>
          </div>
        </div>
      </div>
    </div>`;

  if (!ch) {
    const purpose = {
      generate: '图像生成：写提示词 → 出图（文生图）',
      edit: '图像编辑：选一张源图 + 写编辑指令 → 出新图',
      reverse: '图像反推：选一张图 → 反推成可复用的提示词',
    }[tab] || '';
    return tabsBar + `
      <div class="zs-field">
        <div class="h3-field-hint">${purpose}</div>
        <div class="h3-field-hint">这个页签需要先有一个图像渠道：OpenAI Images / Gemini / Chat 生图，或者你自己的中转接口。</div>
      </div>
      <div class="zs-panel-foot"><button type="button" class="zs-btn zs-btn-primary zs-btn-lg zs-generate-btn" data-act="add-image-channel">新增图像渠道</button></div>`;
  }

  if (tab === 'reverse') {
    return tabsBar + `
      <div class="zs-field">
        <div class="zs-field-head"><span class="zs-field-label">源图</span></div>
        <div class="zs-row">
          <div class="zs-select-wrap image-source-chip">
            <select class="zs-select" disabled><option>${source ? esc(source.name) : '未选择'}</option></select>
          </div>
          <button type="button" class="zs-btn zs-btn-sm" data-act="pick-source">选择</button>
        </div>
      </div>
      <div class="zs-field">
        <div class="zs-field-head"><span class="zs-field-label">反推结果</span>
          <span class="zs-field-right"><span class="zs-inline-actions">
            <button type="button" class="zs-btn zs-btn-ghost zs-btn-sm" data-act="copy-reverse">复制</button>
            <button type="button" class="zs-btn zs-btn-ghost zs-btn-sm" data-act="use-reverse" ${im.reverseText ? '' : 'disabled'}>去生成</button>
          </span></span>
        </div>
        <div class="zs-prompt">
          <textarea class="zs-textarea" id="img-reverse-out" style="min-height:260px" placeholder="选一张图，点「反推提示词」">${esc(im.reverseText || '')}</textarea>
        </div>
      </div>
      <div class="zs-panel-foot">
        <button type="button" class="zs-btn zs-btn-primary zs-btn-lg zs-generate-btn" data-act="image-reverse" ${im.busy || IJ.active(WB.context('image').itemId) ? 'disabled' : ''}>${im.busy ? '反推中…' : '反推提示词'}</button>
        <p class="h3-field-hint">使用当前语言渠道，需要模型支持图片输入。</p>
      </div>`;
  }

  return tabsBar + generationPrefixHtml('image') + imageLayoutParametersHtml() + `
    ${tab === 'edit' ? `<div class="zs-field">
      <div class="zs-field-head"><span class="zs-field-label">源图</span></div>
      <div class="zs-row">
        <div class="zs-select-wrap image-source-chip">
          <select class="zs-select" disabled><option>${source ? esc(source.name) : '未选择'}</option></select>
        </div>
        <button type="button" class="zs-btn zs-btn-sm" data-act="pick-source">选择</button>
      </div>
    </div>` : ''}
    <div class="zs-field">
      <div class="zs-field-head"><span class="zs-field-label">${tab === 'edit' ? '编辑指令' : '提示词'}</span></div>
      <div class="zs-prompt">
        <textarea class="zs-textarea" id="img-prompt" style="min-height:180px" placeholder="${tab === 'edit' ? '描述要怎么改：换背景、调光线、加/删元素、保持人物不变……' : '描述你想生成的画面：主体、动作、场景、光影、风格……'}">${esc(im.prompt)}</textarea>
        <div class="zs-prompt-foot">
          <span class="zs-prompt-count" id="img-prompt-count">${im.prompt.length}字</span>
          <span class="zs-prompt-spacer"></span>
          <button type="button" class="zs-iconbtn" data-act="image-clear-prompt" title="清空">${ICON.trash}</button>
          <button type="button" class="zs-magic" data-act="image-optimize" ${im.busy || IJ.active(WB.context('image').itemId) ? 'disabled' : ''} title="用当前语言渠道扩写提示词">
            <span>${im.busy ? '优化中…' : '优化提示词'}</span>
          </button>
        </div>
      </div>
    </div>
    <div class="zs-field">
      <div class="zs-field-head"><span class="zs-field-label">渠道分辨率 / 数量</span></div>
      <div class="zs-row">
        <div class="zs-select-wrap">
          <select class="zs-select" id="img-size">${sizes.map((s2) => `<option value="${esc(s2)}" ${s2 === im.size ? 'selected' : ''}>${esc(s2)}</option>`).join('')}</select>
          <span class="zs-select-caret">${ICON.caret}</span>
        </div>
        <div class="zs-select-wrap">
          <select class="zs-select" id="img-count">
            ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === Number(im.count) ? 'selected' : ''}>${n} 张</option>`).join('')}
          </select>
          <span class="zs-select-caret">${ICON.caret}</span>
        </div>
      </div>
    </div>
    <div class="zs-panel-foot">
      <button type="button" class="zs-btn zs-btn-primary zs-btn-lg zs-generate-btn" data-act="image-generate" ${im.busy || IJ.active(WB.context('image').itemId) ? 'disabled' : ''} title="每点一次发送一个任务">${im.busy || IJ.active(WB.context('image').itemId) ? '生成中…' : (tab === 'edit' ? '编辑图像' : '图像生成')}</button>
    </div>`;
}

/* ---- 图像画布：选区 / 裁剪 / 尺寸 / 撤销重做 / 文件菜单（对齐原版工具条） ---- */

function imageCurrent() {
  const im = state.image;
  const tab = im.tab || 'generate';
  const result = (im.results || [])[im.previewIndex || 0] || null;
  const source = im.source || null;
  if (tab === 'reverse') return source ? { url: source.url || fileUrl(source.path), name: source.name, kind: 'source' } : null;
  if (result) return { ...result, kind: 'result' };
  if (tab === 'edit' && source) return { url: fileUrl(source.path), name: source.name, kind: 'source' };
  return null;
}

function imagePushHistory() {
  const im = state.image;
  im.history = im.history || [];
  im.historyIndex = im.historyIndex == null ? -1 : im.historyIndex;
  im.history = im.history.slice(0, im.historyIndex + 1);
  im.history.push(JSON.parse(JSON.stringify(im.results || [])));
  im.historyIndex = im.history.length - 1;
  if (im.history.length > 20) { im.history.shift(); im.historyIndex--; }
}

function imageUndo() {
  const im = state.image;
  if (!im.history || im.historyIndex <= 0) return toast('没有可撤销的步骤', true);
  im.historyIndex -= 1;
  im.results = JSON.parse(JSON.stringify(im.history[im.historyIndex]));
  im.previewIndex = Math.min(im.previewIndex || 0, Math.max(0, im.results.length - 1));
  im.selection = null;
  render();
}

function imageRedo() {
  const im = state.image;
  if (!im.history || im.historyIndex >= im.history.length - 1) return toast('没有可重做的步骤', true);
  im.historyIndex += 1;
  im.results = JSON.parse(JSON.stringify(im.history[im.historyIndex]));
  im.previewIndex = Math.min(im.previewIndex || 0, Math.max(0, im.results.length - 1));
  im.selection = null;
  render();
}

function imageSelectionStyle(sel) {
  if (!sel) return 'display:none';
  const clamp = (n) => Math.max(0, Math.min(100, n * 100));
  return `display:block;left:${clamp(sel.x)}%;top:${clamp(sel.y)}%;width:${clamp(sel.w)}%;height:${clamp(sel.h)}%`;
}

function imageZoomLabel() {
  const z = state.image.zoom;
  if (z === 'fit' || z == null) return '适应';
  return Math.round(z * 100) + '%';
}

function imageViewerHtml(item) {
  if (!item) return '';
  const im = state.image;
  const actual = im.zoom && im.zoom !== 'fit';
  const size = actual ? `style="width:${Math.round((im.zoom || 1) * 100)}%"` : '';
  return `<div class="zd-viewer image-viewer ${actual ? 'is-actual' : ''}" id="img-viewer">
    <div class="image-frame" id="img-frame" ${size}>
      <img id="img-canvas" src="${item.url}" alt="${esc(item.name || '')}" draggable="false" />
      <div class="image-marquee" id="img-marquee" style="${imageSelectionStyle(im.selection)}"></div>
    </div>
  </div>`;
}

function imageWorkspaceHtml(tab, ch) {
  const im = state.image;
  const item = imageCurrent();
  const imageTask=IJ.current();
  const generating=!!imageTask||im.busy;
  const status = imageTask ? imageTask.phase : !ch ? '没有图像渠道 · 先在左侧新增一个'
    : item ? `${item.name}${item.width ? ` · ${item.width}×${item.height}` : ''}${item.bytes ? ` · ${fmtBytes(item.bytes)}` : ''}${im.selection ? ' · 已选区' : ''}`
    : (tab === 'reverse' ? '选择源图后点「反推提示词」' : '就绪 - 在左侧写提示词，点「图像生成」');
  const thumbs = (tab !== 'reverse' && (im.results || []).length)
    ? im.results.map((it, i) => `<button type="button" class="zd-tab ${i === (im.previewIndex || 0) ? 'zd-tab-active' : ''}" data-preview="${i}" title="${esc(it.name)}">
        <span class="zd-tab-name">${esc(it.name)}</span><span role="button" tabindex="0" class="zd-tab-close" data-close-document="${i}" aria-label="关闭 ${esc(it.name)}" title="关闭图片（保留原文件）">×</span><span class="zd-tab-size">${it.width || ''}${it.height ? '×' + it.height : ''}</span>
      </button>`).join('')
    : '';

  return `<div class="zd-toolbar">
    <div class="zd-tool-group zd-filemenu" id="img-filemenu">
      <button type="button" class="zd-tool zd-filemenu-btn" data-act="img-file-menu" title="文件">
        <span class="zd-tool-label">文件</span>
      </button>
      <div class="zd-filemenu-pop">
        <button type="button" class="zd-filemenu-item" data-act="pick-result">打开图片<span class="zd-filemenu-keys">Ctrl+O</span></button>
        <button type="button" class="zd-filemenu-item" data-act="image-paste">粘贴剪贴板<span class="zd-filemenu-keys">Ctrl+V</span></button>
        <button type="button" class="zd-filemenu-item" data-act="image-history">最近生成…</button>
        <button type="button" class="zd-filemenu-item" data-act="image-save" ${item ? '' : 'disabled'}>保存图片…</button>
        <button type="button" class="zd-filemenu-item" data-act="image-save-all" ${(im.results || []).length ? '' : 'disabled'}>保存全部…</button>
        <button type="button" class="zd-filemenu-item" data-act="image-download" ${item ? '' : 'disabled'}>下载到浏览器</button>
        <button type="button" class="zd-filemenu-item" data-act="asset-result" ${item ? '' : 'disabled'}>存到素材库</button>
        <div class="zd-filemenu-sep"></div>
        <button type="button" class="zd-filemenu-item" data-act="image-clear" ${(im.results || []).length ? '' : 'disabled'}>清空画布</button>
      </div>
    </div>
    <span class="zd-tool-sep"></span>
    <div class="zd-tool-group">
      <button type="button" class="zd-tool" data-act="image-undo" title="撤销 (Ctrl+Z)" ${(im.historyIndex || 0) > 0 ? '' : 'disabled'}><span class="zd-tool-label">撤销</span></button>
      <button type="button" class="zd-tool" data-act="image-redo" title="重做 (Ctrl+Y)" ${im.historyIndex != null && im.historyIndex < (im.history || []).length - 1 ? '' : 'disabled'}><span class="zd-tool-label">重做</span></button>
    </div>
    <span class="zd-tool-sep"></span>
    <div class="zd-tool-group">
      <button type="button" class="zd-tool" data-act="image-select-all" title="全选 (Ctrl+A)" ${item ? '' : 'disabled'}><span class="zd-tool-label">全选</span></button>
      <button type="button" class="zd-tool" data-act="image-deselect" title="取消选区 (Esc)" ${im.selection ? '' : 'disabled'}><span class="zd-tool-label">取消选区</span></button>
      <button type="button" class="zd-tool" data-act="image-crop" title="裁剪到选区" ${im.selection ? '' : 'disabled'}><span class="zd-tool-label">裁剪</span></button>
      <button type="button" class="zd-tool" data-act="image-size" title="图像大小" ${item ? '' : 'disabled'}><span class="zd-tool-label">尺寸</span></button>
    </div>
    <span class="zd-tool-sep"></span>
    <div class="zd-tool-group">
      <button type="button" class="zd-tool" data-act="image-zoom-out" title="缩小" ${item ? '' : 'disabled'}>−</button>
      <span class="zd-zoom-readout" title="当前缩放">${imageZoomLabel()}</span>
      <button type="button" class="zd-tool" data-act="image-zoom-in" title="放大" ${item ? '' : 'disabled'}>+</button>
      <button type="button" class="zd-tool" data-act="image-fit" title="适应窗口"><span class="zd-tool-label">适应</span></button>
      <button type="button" class="zd-tool" data-act="image-actual" title="实际像素"><span class="zd-tool-label zd-tool-mono">1:1</span></button>
    </div>
    <button type="button" class="zd-tool" data-act="image-layer-edit">图层编辑</button>
    <button type="button" class="zd-tool" data-act="image-basic-edit" ${item ? '' : 'disabled'}>基础编辑</button>
    <span class="zd-toolbar-spacer"></span>
    <button type="button" class="zd-tool zd-tool-primary" data-act="image-save" ${item ? '' : 'disabled'} title="保存当前图片"><span class="zd-tool-label">保存</span></button>
    <button type="button" class="zd-tool" data-act="image-save-all" ${(im.results || []).length ? '' : 'disabled'} title="保存全部结果"><span class="zd-tool-label">全部保存</span></button>
    <button type="button" class="zd-tool" data-act="asset-result" ${im.previewIndex != null && (im.results || []).length ? '' : 'disabled'} title="把结果存进素材库"><span class="zd-tool-label">存素材库</span></button>
    <button type="button" class="zd-tool" data-act="use-result" ${(im.results || []).length ? '' : 'disabled'} title="把结果作为视频参考图"><span class="zd-tool-label">去视频</span></button>
  </div>
  <div class="zd-tabs">
    ${thumbs}
    <button type="button" class="zd-tab-add" data-act="pick-result" title="从素材库选图打开">+</button>
    <span class="zd-tabs-spacer"></span>
  </div>
  <div class="zd-canvas-area">
    ${IJ.canvas() || (im.busy ? `<div class="img-generating"><span class="img-spin"></span><b>正在生成图片…</b><small>${esc(ch ? ch.name : '')}${im.count > 1 ? ' · ' + im.count + ' 张' : ''}</small></div>` : '')}
    ${item ? imageViewerHtml(item) : generating ? '' : `<div class="zd-empty">
        <div class="zd-empty-card">
          <div class="zd-empty-frame">${IMG_ICON}</div>
          <div class="zd-empty-title">${ch ? '把图片拖到这里开始' : '先新增一个图像渠道'}</div>
          <div class="zd-empty-sub">${ch ? '或从素材库选图 · 也可以直接文生图，结果会显示在这里' : '支持 OpenAI Images / Gemini / Chat 生图，以及任意中转站'}</div>
          <div class="zd-empty-actions">
            ${ch ? `<button type="button" class="zd-btn zd-btn-primary" data-act="pick-result">打开图片</button>` : `<button type="button" class="zd-btn zd-btn-primary" data-act="add-image-channel">新增图像渠道</button>`}
            ${ch ? `<button type="button" class="zd-btn" data-act="image-paste">粘贴剪贴板</button>` : ''}
          </div>
          <ul class="zd-empty-steps">
            <li><b>图像生成</b>：没有图片也可以直接在左侧输入提示词文生图，结果在这里打开。</li>
            <li><b>图像编辑</b>：打开图片后，在左侧写编辑指令并选作源图，结果回贴。</li>
            <li><b>图像反推</b>：把当前图像反推成提示词，一键送回生成或编辑。</li>
          </ul>
        </div>
      </div>`}
  </div>
  <div class="zd-statusbar">
    <span class="zd-status-main" title="${esc(status)}">${esc(status)}</span>
    <span class="zd-status-spacer"></span>
  </div>`;
}

async function imageSaveDataUrl(dataUrl) {
  const sourcePath=(imageCurrent()||{}).path;
  const data = await api('/api/images/save', { method: 'POST', body: { data: dataUrl, sourcePath, ...WB.context('image') } });
  const item = data.item;
  const img = new Image();
  await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; img.src = item.url; });
  return { ...item, width: img.naturalWidth || 0, height: img.naturalHeight || 0, kind: 'image' };
}

function imageDrawToCanvas(source, sx, sy, sw, sh, dw, dh) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(dw));
  canvas.height = Math.max(1, Math.round(dh));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

async function imageCrop() {
  const im = state.image;
  const sel = im.selection;
  if (!sel) return toast('先在画布上拖一个选区', true);
  const img = $('#img-canvas');
  if (!img) return;
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const sx = Math.round(sel.x * nw);
  const sy = Math.round(sel.y * nh);
  const sw = Math.max(1, Math.round(sel.w * nw));
  const sh = Math.max(1, Math.round(sel.h * nh));
  if (sw < 8 || sh < 8) return toast('选区太小', true);
  const item = await imageSaveDataUrl(imageDrawToCanvas(img, sx, sy, sw, sh, sw, sh));
  if (!(state.image.history || []).length) imagePushHistory();
  state.image.results = [...(state.image.results || []), item];
  state.image.previewIndex = state.image.results.length - 1;
  state.image.selection = null;
  imagePushHistory();
  render();
  toast(`已裁剪 ${sw}×${sh}`);
}

function imageResizeDialog() {
  const im = state.image;
  const img = $('#img-canvas');
  if (!img) return;
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  openModal(`
    <div class="modal-head"><h2>图像大小</h2><span class="grow"></span><button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="row">
        <div class="field grow"><label>宽（像素）</label><input class="input" id="img-w" type="number" min="1" value="${nw}" /></div>
        <div class="field grow"><label>高（像素）</label><input class="input" id="img-h" type="number" min="1" value="${nh}" /></div>
      </div>
      <label class="hint"><input type="checkbox" id="img-lock" checked /> 锁定比例（${nw}×${nh}）</label>
    </div>
    <div class="modal-foot">
      <button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">取消</button>
      <button type="button" class="h3-btn h3-btn-sm h3-btn-primary" id="img-size-go">应用</button>
    </div>`);
  const w = $('#img-w');
  const h = $('#img-h');
  const lock = $('#img-lock');
  w.oninput = () => { if (lock.checked) h.value = String(Math.max(1, Math.round(Number(w.value) * nh / nw))); };
  h.oninput = () => { if (lock.checked) w.value = String(Math.max(1, Math.round(Number(h.value) * nw / nh))); };
  $('#img-size-go').onclick = async () => {
    const targetW = Math.max(1, Math.min(8192, Number(w.value) || nw));
    const targetH = Math.max(1, Math.min(8192, Number(h.value) || nh));
    try {
      const item = await imageSaveDataUrl(imageDrawToCanvas(img, 0, 0, nw, nh, targetW, targetH));
      if (!(state.image.history || []).length) imagePushHistory();
  state.image.results = [...(state.image.results || []), item];
      state.image.previewIndex = state.image.results.length - 1;
      state.image.selection = null;
      imagePushHistory();
      closeModal();
      render();
      toast(`已调整为 ${targetW}×${targetH}`);
    } catch (err) { toast(err.message, true); }
  };
}

async function imagePaste() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('这个浏览器不支持读剪贴板');
    const items = await navigator.clipboard.read();
    for (const entry of items) {
      const type = (entry.types || []).find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await entry.getType(type);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取剪贴板失败'));
        reader.readAsDataURL(blob);
      });
      const item = await imageSaveDataUrl(dataUrl);
      if (!(state.image.history || []).length) imagePushHistory();
  state.image.results = [...(state.image.results || []), item];
      state.image.previewIndex = state.image.results.length - 1;
      imagePushHistory();
      render();
      return toast('已粘贴剪贴板图片');
    }
    toast('剪贴板里没有图片', true);
  } catch (err) {
    toast(err.message, true);
  }
}


function applyImageFit() {
  const viewer = $('.image-viewer');
  const frame = $('#img-frame');
  const img = $('#img-canvas');
  if (!viewer || !frame || !img) return;
  const zoom = state.image.zoom;
  if (zoom && zoom !== 'fit') return;
  const nw = img.naturalWidth || 0;
  const nh = img.naturalHeight || 0;
  if (!nw || !nh) return;
  const vw = Math.max(80, viewer.clientWidth - 32);
  const vh = Math.max(80, viewer.clientHeight - 32);
  const scale = Math.min(vw / nw, vh / nh);
  const w = Math.round(nw * scale);
  const h = Math.round(nh * scale);
  if (frame.dataset.fitW === String(w) && frame.dataset.fitH === String(h) && img.style.width === '100%') return;
  frame.dataset.fitW = String(w);
  frame.dataset.fitH = String(h);
  frame.style.width = w + 'px';
  frame.style.height = h + 'px';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
}

function bindImageCanvas(root) {
  // 每次重绘先把上一轮挂在 window/document 上的监听摘掉
  if (state.image._drag) {
    window.removeEventListener('mousemove', state.image._drag.move);
    window.removeEventListener('mouseup', state.image._drag.up);
    state.image._drag = null;
  }
  if (state.image._key) document.removeEventListener('keydown', state.image._key);

  const frame = $('#img-frame');
  const marquee = $('#img-marquee');
  const canvasImg = $('#img-canvas');
  const readout = $('.zd-zoom-readout');
  if (canvasImg && readout) {
    const updateReadout = () => {
      const nw = canvasImg.naturalWidth || 0;
      if (!nw) return;
      const pct = Math.round((canvasImg.getBoundingClientRect().width / nw) * 100);
      readout.textContent = pct + '%';
      readout.title = `当前缩放 ${pct}%（原图 ${nw}×${canvasImg.naturalHeight || 0}）`;
    };
    const refreshViewer = () => { applyImageFit(); updateReadout(); };
    if (canvasImg.complete) refreshViewer();
    else canvasImg.addEventListener('load', refreshViewer);
    window.requestAnimationFrame(refreshViewer);
    if (state.image._resize) window.removeEventListener('resize', state.image._resize);
    state.image._resize = refreshViewer;
    window.addEventListener('resize', refreshViewer);
  }
  if (frame && marquee) {
    let start = null;
    const rectOf = () => frame.getBoundingClientRect();
    const apply = (sel) => { marquee.style.cssText = imageSelectionStyle(sel); };
    frame.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const rect = rectOf();
      start = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
      event.preventDefault();
    });
    const move = (event) => {
      if (!start) return;
      const rect = rectOf();
      const cur = {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
      const sel = {
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      };
      apply(sel);
    };
    const up = (event) => {
      if (!start) return;
      const rect = rectOf();
      const cur = {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
      const sel = {
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      };
      start = null;
      state.image.selection = (sel.w > 0.01 && sel.h > 0.01) ? sel : null;
      apply(state.image.selection);
      const cropBtn = document.querySelector('[data-act="image-crop"]');
      if (cropBtn) cropBtn.disabled = !state.image.selection;
      const deselect = document.querySelector('[data-act="image-deselect"]');
      if (deselect) deselect.disabled = !state.image.selection;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    state.image._drag = { move, up };
  }

  root.addEventListener('click', async (event) => {
    const menuBtn = event.target.closest('.zd-filemenu-btn');
    if (menuBtn) {
      const menu = $('#img-filemenu');
      if (!menu) return;
      const open = menu.classList.toggle('zd-filemenu-open');
      const pop = menu.querySelector('.zd-filemenu-pop');
      if (open && pop) {
        const rect = menuBtn.getBoundingClientRect();
        pop.style.left = Math.round(rect.left) + 'px';
        pop.style.top = Math.round(rect.bottom + 4) + 'px';
      }
      return;
    }
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    try {
      if (act === 'image-select-all') { state.image.selection = { x: 0, y: 0, w: 1, h: 1 }; return render(); }
      if (act === 'image-deselect') { state.image.selection = null; return render(); }
      if (act === 'image-crop') return imageCrop();
      if (act === 'image-size') return imageResizeDialog();
      if (act === 'image-basic-edit') return await openRasterEditor();
      if (act === 'image-layer-edit') return await openLayerEditor(imageCurrent());
      if (act === 'image-undo') return imageUndo();
      if (act === 'image-redo') return imageRedo();
      if (act === 'image-paste') return imagePaste();
      if (act === 'image-zoom-in' || act === 'image-zoom-out') {
        const cur = state.image.zoom === 'fit' || !state.image.zoom ? 1 : state.image.zoom;
        const next = act === 'image-zoom-in' ? Math.min(4, cur * 1.25) : Math.max(0.1, cur / 1.25);
        state.image.zoom = Math.round(next * 100) / 100;
        return render();
      }
      if (act === 'image-fit') { state.image.zoom = 'fit'; return render(); }
      if (act === 'image-actual') { state.image.zoom = 1; return render(); }
    } catch (err) { toast(err.message, true); }
  });

  const onKey = (event) => {
    if (state.route !== 'image' || !$('#modal').hidden) return;
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); imageUndo(); }
    else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); imageRedo(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); state.image.selection = { x: 0, y: 0, w: 1, h: 1 }; render(); }
    else if (event.key === 'Escape') { state.image.selection = null; render(); }
  };
  document.addEventListener('keydown', onKey);
  state.image._key = onKey;
}

function openImageHistory() {
  const list = state.imageHistory || [];
  openModal(`
    <div class="modal-head"><h2>最近生成</h2><span class="grow"></span><button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body">
      ${list.length ? `<div class="grid-cards">${list.map((batch, i) => `<div class="asset-card" data-history="${i}">
        <div class="asset-thumb">${batch.items && batch.items[0] ? `<img src="${batch.items[0].url}" loading="lazy" />` : ''}</div>
        <div class="asset-meta">
          <span class="name">${esc((batch.prompt || '').slice(0, 40) || (batch.kind === 'edit' ? '编辑结果' : '生成结果'))}</span>
          <span class="sub">${batch.items ? batch.items.length + ' 张' : ''}${batch.createdAt ? ' · ' + new Date(batch.createdAt).toLocaleString('zh-CN', { hour12: false }) : ''}</span>
        </div>
      </div>`).join('')}</div>` : '<div class="empty">还没有生成记录</div>'}
    </div>
  `);
  $('#modal-panel [data-history]').forEach((card) => {
    card.onclick = () => {
      const batch = list[Number(card.dataset.history)];
      if (!batch || !batch.items) return;
      state.image.results = batch.items;
      state.image.previewIndex = 0;
      state.image.selection = null;
      state.image.zoom = 'fit';
      if (batch.prompt) state.image.prompt = batch.prompt;
      closeModal();
      render();
      toast('已载入 ' + batch.items.length + ' 张');
    };
  });
}

function renderImage() {
  const tab = state.image.tab || 'generate';
  if (tab === 'scene') return '<div class="h3-image-host">' + imageTabsHtml(tab) + sceneWorkspaceHtml() + '</div>';
  const ch = imageChannel();
  return `<div class="h3-image-host zs-app">
    ${imageTabsHtml(tab)}
    <div class="zs-main">
      <aside class="zs-panel" style="width:${state.image.panelWidth || 440}px">
        <div class="zs-panel-inner" style="width:${state.image.panelWidth || 440}px">
          <div class="zs-panel-body">${imagePanelHtml(tab, ch)}</div>
        </div>
      </aside>
      <div class="zs-splitter" title="拖动调整面板宽度"></div>
      <section class="zd-workspace">${imageWorkspaceHtml(tab, ch)}</section>
    </div>
  </div>`;
}

function bindImage(root) {
  bindGenerationParameters(root,'image');
  const im = state.image;
  const workbenchContext = WB.context("image");
  if (im.tab === 'scene') {
    root.addEventListener('click', e => { const tab=e.target.closest('[data-img-tab]'); if(tab) {sceneCaptureInputs();im.tab=tab.dataset.imgTab;render();} });
    bindSceneWorkspace(root);return;
  }
  bindSplitter(root, '.zs-panel', (width) => { im.panelWidth = width || 440; });
  bindImageCanvas(root);
  root.addEventListener('keydown', event => {
    const close = event.target.closest('[data-close-document]');
    if (close && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.stopPropagation();
      imageCloseDocument(Number(close.dataset.closeDocument));
    }
  });
  const chSel = $('#img-channel', root);
  if (chSel) chSel.onchange = () => { im.channelId = chSel.value; im.size = 'auto'; render(); };
  const sizeSel = $('#img-size', root);
  if (sizeSel) sizeSel.onchange = () => { im.size = sizeSel.value; };
  const countEl = $('#img-count', root);
  if (countEl) countEl.onchange = () => { im.count = Math.max(1, Math.min(4, Number(countEl.value) || 1)); };
  const promptEl = $('#img-prompt', root);
  if (promptEl) {
    promptEl.oninput = () => {
      im.prompt = promptEl.value;
      const count = $('#img-prompt-count');
      if (count) count.textContent = im.prompt.length + '字';
    };
  }
  const reverseOut = $('#img-reverse-out', root);
  if (reverseOut) reverseOut.oninput = () => { im.reverseText = reverseOut.value; };

  root.addEventListener('click', async (event) => {
    const tabBtn = event.target.closest('[data-img-tab]');
    if (tabBtn) { im.tab = tabBtn.dataset.imgTab; return render(); }
    const closeDocument = event.target.closest('[data-close-document]');
    if (closeDocument) { event.stopPropagation(); return imageCloseDocument(Number(closeDocument.dataset.closeDocument)); }
    const thumb = event.target.closest('[data-preview]');
    if (thumb) { im.previewIndex = Number(thumb.dataset.preview); return render(); }
    const clearSource = event.target.closest('[data-clear-source]');
    if (clearSource) { im.source = null; return render(); }
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    const selected = () => (im.results || [])[im.previewIndex || 0] || null;
    try {
      if (act === 'add-image-channel') return openChannelDialog('image', null);
      if (act === 'manage-image-channels') return openSettings('channels');
      if (act === 'set-tab-generate') { im.tab = 'generate'; return render(); }
      if (act === 'image-clear-prompt') { im.prompt = ''; return render(); }
      if (act === 'image-clear') {
        im.results = [];
        im.previewIndex = 0;
        im.selection = null;
        imagePushHistory();
        return render();
      }
      if (act === 'pick-result') return openSourcePicker();
      if (act === 'pick-source') return openSourcePicker();
      if (act === 'copy-reverse') {
        await navigator.clipboard.writeText(im.reverseText || '');
        toast('已复制');
        return;
      }
      if (act === 'use-reverse') {
        im.prompt = im.reverseText || '';
        im.tab = 'generate';
        return render();
      }
      if (act === 'open-result') {
        const item = selected();
        if (item) await api('/api/media/open', { method: 'POST', body: { path: item.path } }).catch((e) => toast(e.message, true));
        return;
      }
      if (act === 'image-history') return openImageHistory();
      if (act === 'image-save') return openImageSaveDialog(false);
      if (act === 'image-save-all') return openImageSaveDialog(true);
      if (act === 'image-download') {
        const item2 = selected();
        if (!item2) return;
        const link = document.createElement('a');
        link.href = '/api/file?path=' + encodeURIComponent(item2.path) + '&download=1';
        link.download = item2.name || 'image.png';
        link.click();
        toast('已开始下载 ' + (item2.name || ''));
        return;
      }
      if (act === 'asset-result') {
        const item = selected();
        if (!item) return;
        await api('/api/assets/from-file', { method: 'POST', body: { path: item.path } });
        state.assets = await api('/api/assets');
        toast('已存进素材库');
        return;
      }
      if (act === 'use-result') {
        const item = selected();
        if (!item) return;
        let slot = state.studio.images.findIndex((x) => !x);
        if (slot < 0) slot = 0;
        state.studio.images[slot] = { path: item.path, name: item.name, subject: '', kind: 'image' };
        location.hash = '#studio';
        toast('已加入视频参考图');
        return;
      }
      if (act === 'image-optimize') {
        if (!im.prompt.trim()) return toast('先写一句想法', true);
        im.busy = true; render();
        try {
          const res = await api('/api/images/prompt', { method: 'POST', body: { prompt: im.prompt } });
          im.prompt = res.prompt;
          toast('提示词已优化');
        } catch (err) { toast(err.message, true); }
        finally { im.busy = false; await WB.complete("image",workbenchContext,im); render(); }
        return;
      }
      if (act === 'image-reverse') {
        if (!im.source) return toast('先选一张源图', true);
        im.busy = true; render();
        try {
          const res = await api('/api/images/reverse', { method: 'POST', body: { path: im.source.path } });
          im.reverseText = res.prompt;
          toast('反推完成');
        } catch (err) { toast(err.message, true); }
        finally { im.busy = false; await WB.complete("image",workbenchContext,im); render(); }
        return;
      }
      if (act === 'image-generate') {
        const ch=imageChannel();
        if(!ch)return toast('请选择图像渠道',true);
        if(!im.prompt.trim())return toast('先写提示词',true);
        if(IJ.active(workbenchContext.itemId))return toast('当前画面已有未结束的图像任务，请查看任务日志',true);
        if((im.tab||'generate')==='edit'&&!im.source)return toast('先选源图',true);
        await WB.flush('image');
        const body={...workbenchContext,background:true,requestId:crypto.randomUUID(),channelId:ch.id,prompt:im.prompt,prefixPrompt:generationPrefixValue('image'),styleLayer:im.styleLayer||'auto',imageRatio:im.imageRatio||'auto',imageLayoutId:im.imageLayoutId||'free',layoutPrompt:im.layoutPrompt,size:im.size,count:im.count,styleId:state.project?.styleId,refs:(im.tab||'generate')==='edit'&&im.source?[{path:im.source.path,name:im.source.name}]:(im.refs||[])};
        im.busy=true;render();
        try{
          await api('/api/images/generate',{method:'POST',body});
          await IJ.refresh();toast('图像任务已加入后台，切换菜单不会中断');
        }catch(e){toast(e.message,true);}finally{im.busy=false;render();}
      }
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openSourcePicker() {
  const items = (state.assets ? state.assets.items : []).filter((i) => i.kind === 'image');
  openModal(`
    <div class="modal-head"><h2>选择源图</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body"><div class="grid-cards">${items.map((item, i) => `
      <div class="asset-card" data-pick="${i}"><div class="asset-thumb"><img src="${item.url}" loading="lazy" /></div>
      <div class="asset-meta"><span class="name">${esc(item.name)}</span><span class="sub">${esc(item.folder)}</span></div></div>`).join('') || '<div class="empty">素材库还没有图片</div>'}</div></div>
  `);
  $$('#modal-panel [data-pick]').forEach((card) => {
    card.onclick = () => {
      const item = items[Number(card.dataset.pick)];
      state.image.source = { path: item.path, name: item.name, url: item.url };
      closeModal();
      render();
    };
  });
}

/* ------------------------------------------------------------------ 对比 */

function compareItem(side) {
  return state.compare[side] || null;
}

function comparePaneHtml(side) {
  const item = compareItem(side);
  const label = side.toUpperCase();
  if (!item) {
    return `<div class="cmp-pane is-empty" data-side="${side}">
      <span class="cmp-badge">${label}</span>
      <div class="cmp-empty">
        <span class="cmp-empty-ico">${IMG_ICON}</span>
        <span>拖入图片 / 视频，或从下面选择</span>
        <div class="cmp-empty-actions">
          <button type="button" class="h3-btn h3-btn-sm" data-act="cmp-pick" data-side="${side}">媒体库</button>
          <button type="button" class="h3-btn h3-btn-sm" data-act="cmp-local" data-side="${side}">本地文件</button>
        </div>
      </div>
    </div>`;
  }
  const media = item.kind === 'video'
    ? `<video src="/api/file?path=${enc(item.path)}" data-cmp-video="${side}" playsinline preload="metadata" ${side === 'right' ? 'muted' : ''}></video>`
    : `<img src="/api/file?path=${enc(item.path)}" alt="" />`;
  return `<div class="cmp-pane" data-side="${side}">
    <span class="cmp-badge">${label}</span>
    <span class="cmp-name">${esc(item.name)}</span>
    <button type="button" class="cmp-clear" data-act="cmp-clear" data-side="${side}" title="移除">×</button>
    ${media}
  </div>`;
}

function renderCompare() {
  const c = state.compare;
  const overlay = c.mode === 'overlay';
  return `
  <div class="cmp">
    <div class="cmp-head">
      <span class="cmp-title">对比</span>
      <span class="cmp-pick">A—${c.left ? esc(c.left.name) : ''}</span>
      <span class="cmp-pick">B—${c.right ? esc(c.right.name) : ''}</span>
      <span class="h3-toolbar-spacer"></span>
      <div class="cmp-mode">
        <button type="button" class="h3-seg-item ${overlay ? '' : 'is-active'}" data-act="cmp-mode" data-mode="side">对比模式</button>
        <button type="button" class="h3-seg-item ${overlay ? 'is-active' : ''}" data-act="cmp-mode" data-mode="overlay">叠加对比</button>
      </div>
      <button type="button" class="h3-link h3-slots-link" data-act="cmp-swap" title="交换 A / B">⇄ 交换 A/B</button>
      <button type="button" class="h3-link h3-slots-link" data-act="cmp-clear-all" title="清空两侧">清空</button>
      <button type="button" class="h3-btn h3-btn-sm" data-act="cmp-export" title="把当前两帧并排导出成 PNG，存进素材库">导出并排合成</button>
    </div>

    <div class="cmp-stage ${overlay ? 'is-overlay' : ''}">
      ${comparePaneHtml('left')}
      ${comparePaneHtml('right')}
      ${overlay ? `<input class="cmp-opacity" id="cmp-opacity" type="range" min="0" max="100" step="1" value="${c.opacity == null ? 50 : c.opacity}" title="叠加不透明度" />` : ''}
    </div>

    <div class="cmp-dock">
      <div class="cmp-transport">
        <button type="button" class="h3-iconbtn is-sm" data-act="cmp-prev" title="上一帧">${ICON.skipBack}</button>
        <button type="button" class="h3-iconbtn is-sm" data-act="cmp-play" title="播放 / 暂停（空格）">${ICON.play}</button>
        <button type="button" class="h3-iconbtn is-sm" data-act="cmp-next" title="下一帧">${ICON.skipFwd}</button>
        <span class="cmp-time tnum" id="cmp-time">00:00</span>
        <input class="cmp-seek" id="cmp-seek" type="range" min="0" max="1000" step="1" value="0" />
        <span class="cmp-time tnum" id="cmp-duration">00:00</span>
        <label class="cmp-loop" title="循环播放"><input type="checkbox" id="cmp-loop" ${c.loop ? 'checked' : ''} /> 循环</label>
        <select class="h3-select cmp-speed" id="cmp-speed" title="播放速度">
          ${[0.25, 0.5, 0.75, 1, 1.5, 2].map((s) => `<option value="${s}" ${Number(s) === Number(c.speed || 1) ? 'selected' : ''}>${s}x</option>`).join('')}
        </select>
      </div>
      <div class="cmp-note">拖入文件，或点「媒体库 / 本地文件」加载；空格播放/暂停，← → 逐帧；两次选同一素材可对比不同重绘</div>
    </div>
  </div>`;
}

function compareVideos() {
  return $$('#view video[data-cmp-video]');
}

function compareTime(target) {
  const vids = compareVideos();
  const primary = vids[0] || null;
  if (!primary) return 0;
  return target === 'max' ? Math.max(...vids.map((v) => v.currentTime || 0)) : (primary.currentTime || 0);
}

function fmtClock(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const rest = Math.floor(s % 60);
  return String(m).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
}

function syncCompareSeek() {
  const vids = compareVideos();
  if (!vids.length) return;
  const t = compareTime();
  vids.forEach((v) => { if (Math.abs((v.currentTime || 0) - t) > 0.25) v.currentTime = t; });
  const seek = $('#cmp-seek');
  const dur = vids.length ? Math.max(...vids.map((v) => v.duration || 0)) : 0;
  if (seek) seek.value = String(Math.round((t / (dur || 1)) * 1000));
  const time = $('#cmp-time');
  if (time) time.textContent = fmtClock(t);
  const duration = $('#cmp-duration');
  if (duration) duration.textContent = fmtClock(dur);
}

function bindCompare(root) {
  if (state.compare._key) document.removeEventListener('keydown', state.compare._key);
  const vids = compareVideos();
  vids.forEach((v) => {
    v.controls = false;
    v.addEventListener('timeupdate', () => syncCompareSeek());
    v.addEventListener('loadedmetadata', () => syncCompareSeek());
    v.addEventListener('ended', () => {
      if (!state.compare.loop) return;
      vids.forEach((x) => { x.currentTime = 0; x.play().catch(() => {}); });
    });
  });
  syncCompareSeek();

  const seek = $('#cmp-seek');
  if (seek) {
    seek.oninput = () => {
      const dur = vids.length ? Math.max(...vids.map((v) => v.duration || 0)) : 0;
      const t = (Number(seek.value) / 1000) * dur;
      vids.forEach((v) => { v.currentTime = t; });
      syncCompareSeek();
    };
  }
  const opacity = $('#cmp-opacity');
  if (opacity) {
    opacity.oninput = () => {
      state.compare.opacity = Number(opacity.value);
      const right = $('.cmp-pane[data-side="right"]');
      if (right) right.style.opacity = String(state.compare.opacity / 100);
    };
  }
  const speed = $('#cmp-speed');
  if (speed) {
    speed.onchange = () => {
      state.compare.speed = Number(speed.value) || 1;
      compareVideos().forEach((v) => { v.playbackRate = state.compare.speed; });
    };
  }
  const loop = $('#cmp-loop');
  if (loop) loop.onchange = () => { state.compare.loop = loop.checked; };

  const onKey = (event) => {
    if (state.route !== 'compare') return;
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const hit = (sel) => { const el = document.querySelector(sel); if (el) { event.preventDefault(); el.click(); } };
    if (event.key === ' ') hit('[data-act="cmp-play"]');
    if (event.key === 'ArrowRight') hit('[data-act="cmp-next"]');
    if (event.key === 'ArrowLeft') hit('[data-act="cmp-prev"]');
  };
  document.addEventListener('keydown', onKey);
  state.compare._key = onKey; // 重绘时不需要手动摘，页面切换后守卫会直接返回

  compareVideos().forEach((v) => {
    v.addEventListener('click', () => document.querySelector('[data-act="cmp-play"]').click());
  });

  root.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    const side = target.dataset.side;
    try {
      if (act === 'cmp-mode') { state.compare.mode = target.dataset.mode; return render(); }
      if (act === 'cmp-swap') { const a = state.compare.left; state.compare.left = state.compare.right; state.compare.right = a; return render(); }
      if (act === 'cmp-clear') { state.compare[side] = null; return render(); }
      if (act === 'cmp-clear-all') { state.compare.left = null; state.compare.right = null; return render(); }
      if (act === 'cmp-pick') return openComparePicker(side);
      if (act === 'cmp-local') return pickCompareLocal(side);
      if (act === 'cmp-play') {
        const vids = compareVideos();
        if (!vids.length) return;
        const playing = vids.some((v) => !v.paused);
        if (playing) vids.forEach((v) => v.pause());
        else {
          const t = compareTime();
          vids.forEach((v) => { if (Math.abs((v.currentTime || 0) - t) > 0.25) v.currentTime = t; v.playbackRate = Number(state.compare.speed) || 1; v.play().catch(() => {}); });
        }
        return;
      }
      if (act === 'cmp-prev' || act === 'cmp-next') {
        const step = act === 'cmp-next' ? 1 / 30 : -1 / 30;
        const vids = compareVideos();
        const t = Math.max(0, compareTime() + step);
        vids.forEach((v) => { v.currentTime = t; });
        return syncCompareSeek();
      }
      if (act === 'cmp-export') return exportCompare();
    } catch (err) { toast(err.message, true); }
  });
}

function openComparePicker(side) {
  const items = ((state.media && state.media.items) || []).filter((i) => i.kind === 'video' || i.kind === 'image');
  openModal(`
    <div class="modal-head"><h2>选择素材 · ${side === 'left' ? 'A' : 'B'}</h2><span class="grow"></span><button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body">
      ${items.length ? `<div class="grid-cards">${items.map((item, i) => `
        <div class="asset-card" data-pick="${i}">
          <div class="asset-thumb">${item.kind === 'video' ? `<video src="${item.url}#t=0.5" preload="metadata" muted></video>` : `<img src="${item.url}" loading="lazy" alt="" />`}</div>
          <div class="asset-meta"><span class="name">${esc(item.name)}</span><span class="sub">${esc(item.day || '')} · ${fmtBytes(item.bytes || 0)}</span></div>
        </div>`).join('')}</div>` : `<div class="empty"><strong>媒体库还没有成片</strong><p>先在视频创作台生成，或点右侧「本地文件」直接选一个视频。</p></div>`}
    </div>`);
  $$('#modal-panel [data-pick]').forEach((card) => {
    card.onclick = () => {
      const item = items[Number(card.dataset.pick)];
      state.compare[side] = { path: item.path, name: item.name, kind: item.kind, url: item.url };
      closeModal();
      render();
    };
  });
}

function pickCompareLocal(side) {
  const input = $('#file-input');
  input.accept = 'video/*,image/*';
  input.onchange = async () => {
    const file = (input.files || [])[0];
    input.value = '';
    if (!file) return;
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
      const saved = await api('/api/upload', { method: 'POST', body: { name: file.name, data } });
      state.compare[side] = { path: saved.path, name: saved.name, kind: file.type.startsWith('video') ? 'video' : 'image' };
      render();
    } catch (err) { toast(err.message, true); }
  };
  input.click();
}

async function exportCompare() {
  const left = compareItem('left');
  const right = compareItem('right');
  if (!left || !right) return toast('两侧都要有素材', true);
  const draw = (item) => new Promise((resolve, reject) => {
    if (item.kind === 'image') {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('读取图片失败'));
      img.src = '/api/file?path=' + encodeURIComponent(item.path);
      return;
    }
    const v = document.querySelector(`video[data-cmp-video="${item === left ? 'left' : 'right'}"]`);
    if (!v) return reject(new Error('视频还没准备好'));
    v.pause();
    resolve(v);
  });
  const [a, b] = await Promise.all([draw(left), draw(right)]);
  const w = 960;
  const fit = (source) => {
    const sw = source.videoWidth || source.naturalWidth || w;
    const sh = source.videoHeight || source.naturalHeight || 540;
    return { sw, sh, h: Math.round((sh / sw) * w) };
  };
  const fa = fit(a);
  const fb = fit(b);
  const height = Math.max(fa.h, fb.h);
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(a, 0, 0, w, fa.h);
  ctx.drawImage(b, w, 0, w, fb.h);
  const data = canvas.toDataURL('image/png');
  const name = 'compare-' + Date.now() + '.png';
  await api('/api/assets/upload', { method: 'POST', body: { name, data } });
  state.assets = await api('/api/assets');
  toast('已导出并排合成到素材库：' + name);
}


function mdInline(text) {
  let html = esc(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return html;
}

function markdownLite(text) {
  const src = String(text || '').replace(/\r\n/g, '\n');
  const chunks = src.split(/```/);
  let out = '';
  for (let c = 0; c < chunks.length; c += 1) {
    if (c % 2 === 1) {
      const code = chunks[c].replace(/^[a-zA-Z0-9_+-]*\n/, '').replace(/\n$/, '');
      out += '<pre class="script-code"><code>' + esc(code) + '</code></pre>';
      continue;
    }
    const lines = chunks[c].split('\n');
    let i = 0;
    let para = [];
    let list = null;
    const flushPara = () => {
      if (para.length) {
        out += '<p>' + para.map(mdInline).join('<br>') + '</p>';
        para = [];
      }
    };
    const flushList = () => {
      if (list) {
        out += '<' + list.type + '>' + list.items.map((t) => '<li>' + mdInline(t) + '</li>').join('') + '</' + list.type + '>';
        list = null;
      }
    };
    let guard = 0;
    while (i < lines.length) {
      if (++guard > 8000) break;
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) { flushPara(); flushList(); i += 1; continue; }
      if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        flushPara(); flushList();
        const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
        const header = cells(trimmed);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().includes('|')) { rows.push(cells(lines[i].trim())); i += 1; }
        out += '<div class="md-table"><table><thead><tr>' + header.map((h) => '<th>' + mdInline(h) + '</th>').join('') + '</tr></thead><tbody>'
          + rows.map((r) => '<tr>' + header.map((_, idx) => '<td>' + mdInline(r[idx] || '') + '</td>').join('') + '</tr>').join('')
          + '</tbody></table></div>';
        continue;
      }
      const h = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (h) { flushPara(); flushList(); const level = Math.min(6, h[1].length); out += '<h' + level + '>' + mdInline(h[2]) + '</h' + level + '>'; i += 1; continue; }
      if (/^([-*_])\1{2,}$/.test(trimmed)) { flushPara(); flushList(); out += '<hr>'; i += 1; continue; }
      if (/^>\s?/.test(trimmed)) {
        flushPara(); flushList();
        const quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
        out += '<blockquote>' + markdownLite(quote.join('\n')) + '</blockquote>';
        continue;
      }
      const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (ol) {
        flushPara();
        if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
        list.items.push(ol[1]); i += 1; continue;
      }
      const ul = /^\s*[-*+]\s+(.+)$/.exec(line);
      if (ul) {
        flushPara();
        if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
        list.items.push(ul[1]); i += 1; continue;
      }
      flushList();
      para.push(trimmed);
      i += 1;
    }
    flushPara(); flushList();
  }
  return out;
}

/* ------------------------------------------------------------------ ask 页复刻（剧本创作台） */

function askProjectId() { return state.projectId || 'h3-studio'; }

const ASK_GENERAL = { id: '', name: '普通聊天', description: '只保留智能助手身份，不注入技能或固定流程；需要时由你选择技能。', prompts: ['你好，先介绍一下你能做什么。', '帮我把这个想法整理成可以开拍的方案。'] };
const ASK_SKILLS = [
  { id: 'novel', name: '小说创作', description: '从一句梗概到可改编的短篇小说 / 章节，带人物、钩子和下一节悬念。', prompts: ['写一个 800 字的短篇开头：雨夜，外卖员在便利店门口捡到一部还在响的手机。', '给我 3 个「雪山寺庙门口重逢」的故事方向。'] },
  { id: 'script', name: '小说转剧本', description: '小说 / 梗概改写成可拍的短剧剧本：分场、台词、场尾钩子。', prompts: ['把下面这段小说改写成 3 场短剧剧本：', '把刚才的小说改成 60 秒竖屏短剧，保留结尾反转。'] },
  { id: 'storyboard', name: '剧本转分镜', description: '剧本拆成 H3 分镜：镜号、时长、景别、六段式提示词。', prompts: ['把上面的剧本拆成 3 个 15 秒分镜。', '帮我把这场戏拆成分镜，标好 <Picture N> 和 <Subject N>。'] },
  { id: 'prompt', name: '分镜转提示词', description: '分镜改写成视频创作台可直接粘贴的六段式提示词。', prompts: ['把上面的分镜写成可直接出片的提示词。', '把这段描述改写成合规的六段式。'] },
  { id: 'review', name: '提示词审核', description: '检查六段、引用、时长和人物一致性，给出可出片结论。', prompts: ['审核这条提示词能不能出片：', '帮我检查分镜引用、时长和人物一致性。'] },
];

const ASK_CHAIN = {
  novel: { next: 'script', label: '转成剧本', verb: '改写成短剧剧本', guidance: 'script' },
  script: { next: 'storyboard', label: '拆成分镜', verb: '拆成可生成的 H3 分镜', guidance: 'storyboard' },
  storyboard: { next: 'prompt', label: '生成视频提示词', verb: '改写成视频创作台可用的提示词', guidance: 'prompt' },
  prompt: { next: null, label: '送到创作台', verb: '', guidance: 'prompt' },
};

const ASK_TOOLS = [
  { id: 'consistency', name: '人物一致性检查', description: '核对相邻分镜的人物外观、服装、道具是否一致。', scope: '分镜工作台' },
  { id: 'timing', name: '时长与镜头检查', description: '校验单镜 15 秒、镜头数与台词长度是否匹配。', scope: '分镜工作台' },
  { id: 'material', name: '素材编号检查', description: '检查 <Picture N>/<Subject N>/<Audio N> 是否越界或缺失。', scope: '素材库' },
  { id: 'voice', name: '音色库检索', description: '按音色名和台词匹配克隆参考音频。', scope: '音色库' },
  { id: 'docs', name: '知识库检索', description: '查找项目里的创作设定与往期剧本。', scope: '知识库' },
];

const ASK_INTERNAL_TOOLS = [
  { name: 'create_task_plan', description: '制定本轮任务步骤，后续逐步记录产出。', kind: 'task' },
  { name: 'read_analysis_guidance', description: '读取技能指导文档（SKILL.md）内容。', kind: 'task' },
  { name: 'record_step_result', description: '记录每一步的结论、产出与引用材料。', kind: 'task' },
  { name: 'search_workspace_documents', description: '在对话附件与项目知识库里做全文检索。', kind: 'task' },
  { name: 'read_workspace_document', description: '分页读取附件 / 知识库文档正文。', kind: 'task' },
  { name: 'create_workspace_artifact', description: '生成可预览的交付文件（Markdown 优先）。', kind: 'task' },
  { name: 'list_creation_models', description: '列出可用的图像渠道与视频模型（含时长、画幅）。', kind: 'create' },
  { name: 'generate_image', description: '调用图像模型出图，可作参考图或首帧。', kind: 'create' },
  { name: 'submit_video_job', description: '把提示词提交到视频工作台生成视频（异步）。', kind: 'create' },
  { name: 'check_video_job', description: '查询视频任务进度、阶段与错误。', kind: 'create' },
  { name: 'wait_video_job', description: '等待视频成片（默认 10 分钟，最多 30 分钟）。', kind: 'create' },
  { name: 'probe_video', description: '读时长、分辨率、帧率、编码、有无音频。', kind: 'create' },
  { name: 'extract_frames', description: '从成片抽帧（最多 12 张），做画面检查或首尾帧。', kind: 'create' },
];

const ASK_EFFORT_LABELS = { none: '关闭', low: '轻量', high: '深入', max: '最高' };
const ASK_MODEL_HINTS = {
  browser: 'Chrome 中打开的本地窗口比手机更稳，建议在桌面浏览器继续。',
};

function askState() {
  if (!state.ask) {
    state.ask = {
      conversations: null,
      activeId: '',
      draft: '',
      search: '',
      generating: false,
      historyOpen: true,
      capabilitiesOpen: false,
      panelTab: 'analysis',
      capTab: 'tools',
      pluginTab: 'skill',
      skillId: '',
      enabledTools: [],
      removed: null,
      rename: { open: false, id: '', text: '' },
      toolDetail: null,
      previewFile: null,
      workspacePage: 'console',
      models: null,
      modelId: '',
      effort: '',
      liked: new Set(),
      disliked: new Set(),
      command: { mode: null, query: null, index: 0 },
      mention: null,
      controller: null,
      request: null,
      error: '',
      loading: false,
      kb: null,
      plugins: null,
      manageError: '',
      trajectory: null,
    };
  }
  if (!state.ask._widthLoaded) {
    state.ask._widthLoaded = true;
    const saved = Number(localStorage.getItem('h3.previewWidth'));
    state.ask.previewWidth = saved >= 240 ? saved : null;
  }
  return state.ask;
}

function askSkillList() {
  const a = askState();
  return [ASK_GENERAL].concat(ASK_SKILLS, a.customSkills || []);
}

function askSkill(id) {
  return askSkillList().find((s) => s.id === id) || ASK_GENERAL;
}

function askSkillName(id) {
  return id ? askSkill(id).name : '';
}

async function askLoadSkills() {
  const a = askState();
  try {
    const data = await askApi('/plugins?kind=skill').then((r) => r.json());
    const list = Array.isArray(data) ? data : data.items || [];
    a.customSkills = list.map((item) => ({
      id: 'plugin:' + item.id,
      name: item.name,
      description: item.description || '自定义技能',
      prompts: [],
      custom: true,
      runtime: item.runtime_status,
    }));
  } catch {
    a.customSkills = a.customSkills || [];
  }
}

function askActive() {
  const a = askState();
  return (a.conversations || []).find((c) => c.id === a.activeId) || null;
}

function askId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function askApi(path, init = {}) {
  const res = await fetch('/api/agent' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId(), ...(init.headers || {}) },
  });
  if (!res.ok) {
    let message = '智能体服务请求失败（' + res.status + '）';
    try {
      const data = await res.json();
      message = typeof data.detail === 'string' ? data.detail : (data.detail && data.detail.message) || message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res;
}

async function askRestore() {
  const a = askState();
  if (a.controller) a.controller.abort();
  a.generating = false;
  a.conversations = [];
  a.activeId = '';
  a.draft = '';
  a.attachments = [];
  a.loading = true;
  a.error = '';
  try {
    const list = await askApi('/sessions').then((r) => r.json());
    a.conversations = Array.isArray(list) ? list : [];
    askNewConversation();
  } catch (err) {
    a.error = err.message;
    a.conversations = [];
    askNewConversation();
  } finally {
    a.loading = false;
    if (state.route === 'script') askRenderAll();
  }
}

function askRemember() {
  try { if (askState().activeId) localStorage.setItem('h3-ask-active', askState().activeId); } catch { /* ignore */ }
}

let askSyncTimer = null;
function askPersist() {
  const a = askState();
  if (a.restoring || a.generating || !a.conversations) return;
  if (askSyncTimer) clearTimeout(askSyncTimer);
  askSyncTimer = setTimeout(() => {
    if (askState().generating) return;
    for (const c of a.conversations) {
      askApi('/sessions/' + encodeURIComponent(c.id), { method: 'PUT', body: JSON.stringify(c) }).catch(() => {});
      }
  }, 600);
}

function askNewConversation() {
  const a = askState();
  a.moreMenu = null;
  a.workspacePage = 'console';
  a.skillId = '';
  a.previewFile = null;
  if (a.controller) a.controller.abort();
  a.generating = false;
  a.mention = null;
  a.command = { mode: null, query: null, index: 0 };
  const c = { id: askId(), title: '新的创作对话', pinned: false, updated: Date.now(), messages: [] };
  a.conversations = [c, ...(a.conversations || [])];
  a.activeId = c.id;
  a.draft = '';
  a.attachments = [];
  askRemember();
  if (state.route === 'script') askRenderAll();
  return c;
}

/** 切换项目时先清掉当前项目的会话缓存，避免把旧项目的聊天记录写到新项目下。 */
function askResetForProject() {
  const a = state.ask;
  if (!a) return;
  if (askSyncTimer) { clearTimeout(askSyncTimer); askSyncTimer = null; }
  if (a.controller) { try { a.controller.abort(); } catch { /* ignore */ } }
  a.controller = null;
  a.generating = false;
  a.conversations = null;
  a.activeId = '';
  a.draft = '';
  a.attachments = [];
  a.loading = false;
  a.error = '';
  a.trajectory = null;
  a.rename = { open: false, id: '', text: '' };
}

function askSelect(id) {
  const a = askState();
  a.skillId = '';
  a.previewFile = null;
  a.workspacePage = 'console';
  if (a.controller) a.controller.abort();
  a.generating = false;
  a.mention = null;
  a.activeId = id;
  a.draft = '';
  a.attachments = [];
  askRemember();
  askRenderAll();
  askScrollBottom();
}

function askPreview(c) {
  const last = (c.messages || []).filter((m) => m.role === 'user').slice(-1)[0];
  return last ? String(last.text || '').slice(0, 35) : '开始一个新的创作问题';
}

function askTimeText(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/* ------------------------------- 渲染 ------------------------------- */

function askMarkdownFor(message) {
  const text = String((message && message.text) || '');
  if (message && message._mdHtml && message._mdLen === text.length && message._mdRaw === text) return message._mdHtml;
  const html = markdownLite(text);
  if (message) { message._mdHtml = html; message._mdLen = text.length; message._mdRaw = text; }
  return html;
}

function askMarkdown(text) {
  return markdownLite(text);
}

function askTraceHtml(msg, pending) {
  const exec = msg.execution;
  if (!exec || !exec.plan) {
    return `<p class="ask-process-note">${esc(exec ? askHeading(exec, pending) : (pending ? '执行中…' : '历史回复'))}</p>`;
  }
  const steps = (exec.plan.steps || []).map((step, index) => {
    const stateText = { pending: '待执行', running: '执行中', completed: '已完成', blocked: '待补充' }[step.status] || step.status;
    const icon = step.status === 'completed' ? '✓' : step.status === 'running' ? '◐' : step.status === 'blocked' ? '!' : index + 1;
    return `<li class="${esc(step.status || '')}">
      <span class="ask-node">${icon}</span>
      <div class="ask-step">
        <div class="ask-step-title"><b>${esc(step.title || '')}</b><span>${esc(stateText)}</span></div>
        <p class="ask-step-purpose">${esc(step.purpose || '')}</p>
        ${step.output ? `<div class="ask-step-output"><small>本步产出 <span>模型分析</span></small><div class="ask-md">${askMarkdown(step.output)}</div></div>` : ''}
        ${(step.evidence && step.evidence.length) ? `<details class="ask-evidence"><summary>依据材料 · ${step.evidence.length} 项 ›</summary>${step.evidence.map((s) => `<div><b>${esc(s.title || '')}</b><span>${esc(s.kind === 'guidance' ? '指导文档' : s.kind === 'workspace' ? '工作空间文件' : s.kind === 'artifact' ? '生成的交付文件' : '用户提供')} · ${esc(s.id || '')}</span><p>${esc(String(s.content || '').slice(0, 400))}</p></div>`).join('')}</details>` : ''}
      </div></li>`;
  }).join('');
  return `<details class="ask-trace" ${pending ? 'open' : ''}>
    <summary class="ask-trace-head"><span>${esc(askHeading(exec, pending))}</span><span class="ask-chev">›</span></summary>
    ${(exec.validation_issues && exec.validation_issues.length) ? `<p class="ask-goal">${esc(exec.validation_issues.join('；'))}</p>` : ''}
    ${exec.plan.goal ? `<p class="ask-goal">${esc(exec.plan.goal)}</p>` : ''}
    <ol class="ask-steps">${steps}</ol>
    <footer>步骤产出基于列出的用户材料与文档；模型分析不代表业务指标计算已验证。完整用户 / 助手 / 工具记录可在右侧「运行轨迹」查看。</footer>
  </details>`;
}

function askHeading(exec, pending) {
  if (pending || (exec && exec.status === 'running')) return '执行中…';
  const labels = { completed: '已完成', succeeded: '已完成', partial: '部分完成', blocked: '待补充', failed: '执行失败', cancelled: '已停止', budget_exceeded: '已达预算上限', interrupted: '执行中断' };
  const status = labels[(exec && (exec.outcome || exec.status)) || ''] || '历史回复';
  const ms = exec && (exec.duration_ms != null ? exec.duration_ms : (exec.finished_at != null && exec.started_at != null ? exec.finished_at - exec.started_at : null));
  if (ms == null || !Number.isFinite(ms)) return status;
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return status + '，用时' + (minutes ? minutes + '分' + (rest ? rest + '秒' : '') : seconds + '秒');
}

function askFilesHtml(files) {
  if (!files || !files.length) return '';
  return `<div class="ask-files">${files.map((f) => `<button type="button" class="ask-file" data-act="ask-preview" data-id="${esc(f.id)}" title="${esc(f.name || '')}">
    <span class="ask-file-icon">${/(\.md|\.txt|\.json|\.csv)$/i.test(f.name || '') ? '📄' : '📎'}</span>
    <span><b>${esc(f.name || '文件')}</b><small>${f.size ? fmtBytes(f.size) : ''}</small></span>
  </button>`).join('')}</div>`;
}

function askMessagesHtml(chat) {
  const a = askState();
  const messages = (chat && chat.messages) || [];
  return messages.map((m, index) => {
    const mine = m.role === 'user';
    const pending = a.generating && index === messages.length - 1;
    const usage = m.execution && m.execution.usage;
    return `<article class="ask-message ${mine ? 'is-user' : 'is-assistant'}">
      <div class="ask-message-body">
        ${mine ? '' : askTraceHtml(m, pending)}
        ${(!mine && m.error && !m.text) ? `<div class="ask-inline-error">⚠ ${esc(m.error)}</div>` : ''}
        ${(!mine && m.execution && m.execution.resource_context) ? `<div class="ask-resource" title="${esc(m.execution.resource_context.snapshot_hash || '')}">🗂 ${esc(m.execution.resource_context.dataset ? m.execution.resource_context.dataset.name + ' · v' + m.execution.resource_context.dataset.version_num : '未选择数据')}</div>` : ''}
        ${m.text ? (mine && m.text.length > 1024 ? `<details class="ask-longmsg"><summary><span>📄</span><b>长文本</b><small>${m.text.length} 字 · 点击展开</small></summary><pre>${esc(m.text)}</pre></details>` : `<div class="ask-message-text ${mine ? 'is-plain' : ''}">${mine ? esc(m.text) : askMarkdown(m.text)}</div>`) : (pending ? '<div class="ask-typing"><i></i><i></i><i></i></div>' : '')}
        ${askFilesHtml(mine ? (m.files || []) : (m.execution && m.execution.artifacts) || [])}
        ${(!mine && (m.media || []).length) ? `<div class="ask-media-grid">${m.media.map((f, mi) => `<button type="button" class="ask-media" data-act="ask-open-media" data-index="${index}" data-media="${mi}" title="${esc(f.name || '')}">
          ${f.kind === 'video' ? `<video src="${esc(f.url)}" muted preload="metadata"></video><span class="ask-media-play">▶</span>` : `<img src="${esc(f.url)}" alt="" loading="lazy" />`}
          <span class="ask-media-name">${esc(f.name || '')}</span>
        </button>`).join('')}</div>` : ''}
        ${(!mine && !pending) ? `<div class="ask-reply-actions">
          ${m.execution && m.execution.checkpoint_available && ['partial', 'failed', 'cancelled', 'budget_exceeded', 'interrupted'].includes(m.execution.outcome || m.execution.status) ? `<button type="button" data-act="ask-resume" data-index="${index}" title="从最近检查点继续，只读恢复">继续任务</button>` : ''}
          ${(() => {
            const sk = ASK_SKILLS.find((x) => x.name === m.skill);
            if (!sk) return ''; 
            const chain = ASK_CHAIN[sk.id];
            if (!chain) return '';
            if (chain.next) return '<button type="button" class="ask-next-step" data-act="ask-chain" data-index="' + index + '" data-skill="' + chain.next + '" data-verb="' + esc(chain.verb) + '" title="把这条产出接到下一步">下一步：' + esc(chain.label) + ' →</button>';
            return '<button type="button" class="ask-next-step" data-act="ask-to-studio" data-index="' + index + '" title="把提示词写进视频创作台">送到创作台 ↗</button>';
          })()}
          <button type="button" data-act="ask-copy" data-index="${index}" title="复制回复"><span>⧉</span>复制</button>
          <button type="button" data-act="ask-paste" data-index="${index}" title="粘贴到输入框"><span>⌁</span>粘贴</button>
          <button type="button" class="${a.liked.has(m.id) ? 'is-on' : ''}" data-act="ask-like" data-index="${index}" title="点赞"><span>▲</span>点赞</button>
          <button type="button" class="${a.disliked.has(m.id) ? 'is-on' : ''}" data-act="ask-dislike" data-index="${index}" title="有问题"><span>▼</span>有问题</button>
          <button type="button" data-act="ask-regenerate" data-index="${index}" title="重新生成这条回复"><span>↻</span>重生成</button>
          <span class="ask-usage" title="输入 ${esc(String((usage && usage.input_tokens) ?? '未知'))} / 输出 ${esc(String((usage && usage.output_tokens) ?? '未知'))}">${esc(usage ? '输入 ' + usage.input_tokens + ' / 输出 ' + usage.output_tokens : '')}</span>
          <span class="ask-time">${esc(askTimeText(m.time))}</span>
        </div>` : (mine ? `<div class="ask-reply-actions is-user-row"><span class="ask-time">${esc(askTimeText(m.time))}</span></div>` : '')}
      </div>
    </article>`;
  }).join('');
}

function askWelcomeHtml() {
  return `<div class="ask-welcome">
    <span class="ask-eyebrow">CREATION PIPELINE</span>
    <h2>${esc(agentWelcomeText(state.config?.ui))}</h2>
  </div>`;
}

function askSkillIcon(id) {
  return ({ novel: '✎', script: '▤', storyboard: '▦', prompt: '◎', review: '✓' })[id] || '★';
}

function askRenderPopups() {
  const a = askState();
  const host = $('#ask-popups');
  if (!host) return;
  const cmdOpen = a.command.mode !== null || a.command.query !== null;
  host.innerHTML = (cmdOpen ? askCommandPopup() : '') + (a.mention ? askMentionPopup() : '');
  host.style.display = host.innerHTML.trim() ? 'block' : 'none';
}

function askSessionFiles(chat) {
  const out = [];
  const seen = new Set();
  for (const [mi, m] of ((chat && chat.messages) || []).entries()) {
    if (m.role !== 'assistant') continue;
    for (const [fi, f] of (m.media || []).entries()) {
      const key = f.url || f.path || (f.name + fi);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: 'media', ...f, mi, fi });
    }
    for (const file of ((m.execution && m.execution.artifacts) || [])) {
      const key = 'artifact:' + file.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: 'artifact', file });
    }
  }
  return out;
}

function askSessionFilesHtml(chat) {
  const files = askSessionFiles(chat);
  if (!files.length) return '';
  return `<div class="ask-files-bar">
    <span class="ask-files-title">本对话文件 ${files.length}</span>
    <div class="ask-files-scroll">${files.map((f) => f.type === 'media'
      ? `<button type="button" class="ask-file-chip" data-act="ask-open-media" data-index="${f.mi}" data-media="${f.fi}" title="${esc(f.name || '')}"><span class="ask-file-thumb">${f.kind === 'video' ? '🎬' : `<img src="${esc(f.url)}" alt="" />`}</span><span class="ask-file-label">${esc(f.name || '')}</span></button>`
      : `<button type="button" class="ask-file-chip" data-act="ask-preview" data-id="${esc(f.file.id)}" title="${esc(f.file.name)}"><span class="ask-file-thumb">📄</span><span class="ask-file-label">${esc(f.file.name)}</span></button>`).join('')}</div>
  </div>`;
}

function askComposerHtml() {
  const a = askState();
  const skill = askSkill(a.skillId);
  const models = a.models || [];
  const efforts = askEfforts();
  return `<div class="ask-composer-area">
    <div class="ask-composer-context">
      <span>🗂 ${esc((state.project && state.project.name) || askProjectId())}</span>
      ${state.styleDetail ? `<span>🎨 ${esc(state.styleDetail.name)}</span>` : ''}
      <span>✧ ${esc(skill.name)}${a.skillId ? ' <button type="button" data-act="ask-clear-skill" title="移除技能，返回普通聊天">×</button>' : ''}</span>
      ${(a.attachments || []).map((f) => `<span class="ask-attach">📎 ${esc(f.name)}<small>${f.status === 'indexed' ? '已索引' : '待处理'}</small><button type="button" data-act="ask-detach" data-id="${esc(f.id)}">×</button></span>`).join('')}
    </div>
    <div class="ask-composer">
      <div class="ask-popups" id="ask-popups"></div>
      <textarea id="ask-input" class="ask-input" rows="2" maxlength="3000" placeholder="${a.generating ? '智能体思考中…' : '聊聊你的想法，或输入 @ 选择技能'}">${esc(a.draft)}</textarea>
      <div class="ask-composer-bar">
        <button type="button" class="ask-icon-btn" data-act="ask-attach" title="添加附件（最多 5 个，单文件 10MB）">📎</button>
        <button type="button" class="ask-icon-btn" data-act="ask-skill-picker" title="插入 @视角">@</button>
        <select class="ask-select" id="ask-model" title="模型">
          ${models.map((m) => `<option value="${esc(m.id)}" ${m.id === a.modelId ? 'selected' : ''} title="上下文 ${m.context_tokens ? Math.round(m.context_tokens / 1000) + 'k' : '默认 500k'}">${esc(m.label)}${m.context_tokens ? ' · ' + Math.round(m.context_tokens / 1000) + 'k' : ''}</option>`).join('') || '<option value="">默认模型</option>'}
        </select>
        ${efforts.length ? `<select class="ask-select" id="ask-effort" title="思考强度">${efforts.map((e) => `<option value="${esc(e)}" ${e === a.effort ? 'selected' : ''}>思考 ${esc(ASK_EFFORT_LABELS[e] || e)}</option>`).join('')}</select>` : ''}
        <span class="ask-draft-count">${(a.draft || '').length}/3000</span>
        <span class="grow"></span>
        ${a.generating ? `<button type="button" class="ask-send is-stop" data-act="ask-stop" title="停止生成">■ 停止</button>` : `<button type="button" class="ask-send" data-act="ask-send" ${a.draft.trim() ? '' : 'disabled'}>发送 ↑</button>`}
      </div>
    </div>
    <div class="ask-hint">Enter 发送 · Shift+Enter 换行 · / 命令 · @ 视角</div>
  </div>`;
}

function askEfforts() {
  const a = askState();
  const model = (a.models || []).find((m) => m.id === a.modelId);
  return (model && model.reasoning_efforts) || [];
}

function askCommandItems() {
  const a = askState();
  const cmd = a.command;
  if (cmd.mode === 'model') return (a.models || []).map((m) => ({ id: m.id, label: m.label }));
  if (cmd.mode === 'think') return askEfforts().map((e) => ({ id: e, label: ASK_EFFORT_LABELS[e] || e }));
  const all = [{ id: 'model', label: '换模型' }, { id: 'think', label: '换思考强度' }, { id: 'compact', label: '压缩当前对话上下文' }];
  const q = cmd.query || '';
  return all.filter((c) => c.id.includes(q));
}

function askCommandPopup() {
  const a = askState();
  if (a.command.mode === null && a.command.query === null) return '';
  const items = askCommandItems();
  const title = a.command.mode === 'model' ? '选择模型' : a.command.mode === 'think' ? '选择思考强度' : '快捷命令';
  return `<div class="ask-popup ask-slash-popup"><div class="ask-popup-title">${title}</div>
    ${items.map((item, i) => `<button type="button" class="${i === a.command.index ? 'is-hl' : ''}" data-act="ask-cmd" data-id="${esc(item.id)}"><b>${a.command.mode ? '' : '/'}${esc(item.id)}</b><span>${esc(item.label)}</span></button>`).join('')}
    ${items.length ? '' : '<p class="ask-popup-empty">暂无可用选项</p>'}</div>`;
}

function askMentionSkills() {
  const a = askState();
  const q = (a.mention && a.mention.query || '').toLowerCase();
  return askSkillList().filter((s) => (s.name + ' ' + s.description + ' ' + s.id).toLowerCase().includes(q));
}

function askMentionPopup() {
  const a = askState();
  if (!a.mention) return '';
  const list = askMentionSkills();
  return `<div class="ask-popup ask-mention-popup">
    <div class="ask-popup-title"><span>✧ 选择创作视角</span><small>${list.length} 项</small></div>
    ${list.map((s, i) => `<button type="button" class="${i === a.mention.index ? 'is-hl' : ''}" data-act="ask-mention" data-skill="${s.id}">
      <span class="ask-mention-ico">${askSkillIcon(s.id)}</span>
      <span><b>${esc(s.name)}</b><small>${esc(s.description)}</small></span>
      ${s.id === a.skillId ? '<span class="ask-check">✓</span>' : '<span class="ask-enter">↵</span>'}
    </button>`).join('')}
    ${list.length ? '' : '<p class="ask-popup-empty">没有匹配的视角，试试“分镜”或“审核”。</p>'}
    <div class="ask-popup-foot">↑ ↓ 选择 · Enter / Tab 确认 · Esc 关闭</div>
  </div>`;
}

function askTrajectoryHtml() {
  const a = askState();
  const data = a.trajectory;
  if (!data) return `<div class="ask-cap-empty">打开后加载最近 50 条运行轨迹…</div>`;
  const items = data.items || [];
  if (!items.length) return `<div class="ask-cap-empty">这条对话还没有运行轨迹</div>`;
  return `<div class="ask-traj">
    ${items.map((it) => `<div class="ask-traj-item ${esc(it.role || '')}">
      <span class="ask-traj-role">${it.role === 'user' ? '用户' : it.role === 'assistant' ? '助手' : '工具'}</span>
      <div><div class="ask-traj-head">${esc(it.kind || it.role || '')} · ${esc(askTimeText(it.time))}</div><p>${esc(String(it.content || '').slice(0, 500))}</p></div>
    </div>`).join('')}
    <div class="ask-traj-foot">共 ${esc(String(data.total || items.length))} 条${data.next_offset ? '' : ' · 已到最早'}
      ${data.next_offset ? `<button type="button" class="ask-btn" data-act="ask-traj-more">加载更早</button>` : ''}</div>
  </div>`;
}

function askCapabilityHtml() {
  const a = askState();
  const tools = ASK_INTERNAL_TOOLS.filter((t) => t.kind !== 'create');
  return `<aside class="ask-cap">
    <div class="ask-cap-head">
      <div class="ask-cap-tabs" role="tablist">
        <button type="button" role="tab" class="${a.panelTab === 'analysis' ? 'is-on' : ''}" data-act="ask-panel" data-tab="analysis">分析工作区</button>
        <button type="button" role="tab" class="${a.panelTab === 'trajectory' ? 'is-on' : ''}" data-act="ask-panel" data-tab="trajectory">运行轨迹</button>
      </div>
      <button type="button" class="ask-icon-btn" data-act="ask-close-cap" title="关闭分析工作区">×</button>
    </div>
    ${a.panelTab === 'analysis' ? `
      <div class="ask-project-context">
        <div class="ask-context-title">本轮项目资源</div>
        <div class="ask-context-row"><span>项目</span><b>${esc((state.project && state.project.name) || askProjectId())}</b></div>
        <div class="ask-context-row"><span>数据版本</span><b>未选择</b></div>
        <div class="ask-context-row"><span>策略包</span><b>未选择</b></div>
        <p class="ask-context-note">H3 项目没有接信贷数据源，这里只展示对话与素材；需要业务数据时再扩展。</p>
      </div>
      <div class="ask-cap-subtabs">
        <button type="button" class="${a.capTab === 'tools' ? 'is-on' : ''}" data-act="ask-captab" data-tab="tools">🛠 工具 <span>${tools.length}</span></button>
        <button type="button" class="${a.capTab === 'skills' ? 'is-on' : ''}" data-act="ask-captab" data-tab="skills">📖 技能 <span>${askSkillList().length}</span></button>
      </div>
      <div class="ask-cap-content">
        ${a.capTab === 'tools' ? `<p class="ask-cap-intro">基础工具：规划、读指导、记录步骤、检索附件、生成交付文件。出图 / 出片 / 抽帧已经做成技能，在「技能」或 @ 里选。</p>
          ${tools.map((t) => `<article class="ask-tool"><b class="ask-tool-internal">${esc(t.name)}</b><p>${esc(t.description)}</p><div class="ask-tool-foot">${t.kind === 'create' ? '创作工具 · 已开放（真实调用）' : '内置任务工具 · 已开放'}</div></article>`).join('')}
`
        : `<p class="ask-cap-intro">技能决定这一轮怎么干活：先选一个，模型按它的步骤和格式执行；也可以去插件页新建。</p>
          <button type="button" class="ask-btn ask-skill-new" data-act="ask-new-skill">＋ 新建技能</button>
          ${askSkillList().map((s) => `<button type="button" class="ask-skill-row ${s.id === a.skillId ? 'is-on' : ''}" data-act="ask-skill" data-id="${s.id}">
            <div><span>${askSkillIcon(s.id)}</span><b>${esc(s.name)}</b>${s.id === a.skillId ? '<span class="ask-check">✓</span>' : ''}</div>
            <p>${esc(s.description)}</p><span>${s.id === a.skillId ? '当前使用' : '点击使用此技能'}</span>
          </button>`).join('')}
          <div class="ask-skill-prompts"><b>试试${esc(askSkill(a.skillId).name)}</b>${askSkill(a.skillId).prompts.map((q) => `<button type="button" data-act="ask-fill" data-text="${esc(q)}">${esc(q)} ↗</button>`).join('')}</div>`}
      </div>
    ` : `<div class="ask-cap-content is-traj">${askTrajectoryHtml()}</div>`}
    <div class="ask-cap-foot"><span class="ask-dot"></span>智能体服务<span>已接入模型</span></div>
  </aside>`;
}

/* 知识库 / 插件管理 */
function askPluginModeText(item) {
  const cfg = (item && item.config) || {};
  if (cfg.mode === 'bundle') {
    const count = Array.isArray(cfg.files) ? cfg.files.length : 0;
    return '完整技能 · ' + count + ' 个附加文件';
  }
  return '文本技能 · SKILL.md';
}

function askManageHtml() {
  const a = askState();
  const view = a.workspacePage;
  if (view === 'knowledge') {
    const items = a.kb || [];
    return `<section class="ask-manage">
      <header class="ask-manage-head">
        <div><h2>知识库</h2><p>项目级知识条目，智能体可检索引用。</p></div>
        <div class="ask-manage-actions">
          <button type="button" class="ask-btn" data-act="ask-manage-refresh">刷新</button>
          <button type="button" class="ask-btn is-primary" data-act="ask-manage-new">新建知识条目</button>
          <button type="button" class="ask-btn" data-act="ask-workspace" data-page="console">返回对话</button>
        </div>
      </header>
      ${a.manageError ? `<div class="ask-error">${esc(a.manageError)}</div>` : ''}
      <div class="ask-manage-list">
        ${items.length ? items.map((item) => `<article class="ask-manage-item">
          <div><b>${esc(item.name || '未命名')}</b><small>${esc(item.description || '')}</small></div>
          <div class="ask-manage-item-actions">
            <button type="button" data-act="ask-manage-edit" data-id="${esc(item.id)}">编辑</button>
            <button type="button" data-act="ask-manage-del" data-id="${esc(item.id)}">删除</button>
          </div>
        </article>`).join('') : '<div class="ask-cap-empty">还没有知识条目</div>'}
      </div>
    </section>`;
  }

  const tab = a.pluginTab || 'skill';
  const plugins = (a.plugins || []).filter((p) => (p.kind || 'skill') === tab);
  const labels = { tool: '工具管理', skill: '技能管理', mcp: 'MCP 管理' };
  const newLabels = { tool: '新建工具', skill: '新建技能', mcp: '新建 MCP' };
  const systemSkills = ASK_SKILLS.map((s) => ({ id: s.id, name: s.name, description: s.description }));
  const systemTools = ASK_INTERNAL_TOOLS.filter((t) => t.kind !== 'create').map((t) => ({ id: t.name, name: t.name, description: t.description }));
  const system = tab === 'skill' ? systemSkills : tab === 'tool' ? systemTools : [];
  const customTitle = tab === 'skill' ? '自定义技能' : tab === 'tool' ? '自定义工具' : '自定义 MCP';

  const row = (item, isSystem) => `<article class="ask-manage-item ${isSystem ? 'is-system' : ''}">
    <div>
      <b>${esc(item.name || '未命名')}</b>
      <small>${isSystem ? '系统内置 · 只读' : (tab === 'skill' ? askPluginModeText(item) + ' · 自定义' : '自定义')}${item.description ? ' · ' + esc(item.description) : ''}</small>
    </div>
    <div class="ask-manage-item-actions">
      <span class="ask-badge ${isSystem ? 'is-sys' : 'is-custom'}">${isSystem ? '系统' : '自定义'}</span>
      ${isSystem ? '' : `<button type="button" data-act="ask-manage-edit" data-id="${esc(item.id)}">编辑</button><button type="button" data-act="ask-manage-del" data-id="${esc(item.id)}">删除</button>`}
    </div>
  </article>`;

  return `<section class="ask-manage">
    <header class="ask-manage-head">
      <div><h2>插件管理</h2><p>系统内置只读；自定义技能 / 工具 / MCP 可以自由添加、编辑、删除。</p></div>
      <div class="ask-manage-actions">
        <button type="button" class="ask-btn" data-act="ask-manage-refresh">刷新</button>
        <button type="button" class="ask-btn is-primary" data-act="ask-manage-new">${newLabels[tab]}</button>
        <button type="button" class="ask-btn" data-act="ask-workspace" data-page="console">返回对话</button>
      </div>
    </header>
    <nav class="ask-manage-tabs">
      ${['tool', 'skill', 'mcp'].map((k) => `<button type="button" class="${tab === k ? 'is-on' : ''}" data-act="ask-plugin-tab" data-tab="${k}">${labels[k]} <span>${(k === 'skill' ? ASK_SKILLS.length : k === 'tool' ? systemTools.length : 0) + (a.plugins || []).filter((p) => (p.kind || 'skill') === k).length}</span></button>`).join('')}
    </nav>
    ${a.manageError ? `<div class="ask-error">${esc(a.manageError)}</div>` : ''}
    <div class="ask-manage-scroll">
      <div class="ask-manage-section"><span>系统内置（不可更改）</span><small>${system.length} 项</small></div>
      <div class="ask-manage-list">
        ${system.length ? system.map((item) => row(item, true)).join('') : '<div class="ask-cap-empty">这一栏没有系统内置项</div>'}
      </div>
      <div class="ask-manage-section"><span>${customTitle}</span><small>${plugins.length} 项</small></div>
      <div class="ask-manage-list">
        ${plugins.length ? plugins.map((item) => row(item, false)).join('') : `<div class="ask-cap-empty">还没有自定义${tab === 'skill' ? '技能' : tab === 'tool' ? '工具' : ' MCP'}，点右上角新建</div>`}
      </div>
    </div>
  </section>`;
}

function askHistoryHtml() {
  const a = askState();
  const search = (a.search || '').toLowerCase();
  const filtered = (a.conversations || [])
    .filter((c) => (c.id === a.activeId || (c.messages || []).length))
    .filter((c) => (c.title + ' ' + (c.messages || []).map((m) => m.text).join(' ')).toLowerCase().includes(search))
    .sort((x, y) => (y.updated || 0) - (x.updated || 0));
  const folders = state.config.ui.conversationFolders || [];
  const assignments = state.config.ui.conversationFolderMap || {};
  const groups = folders.map((folder) => ({ id: folder.id, label: folder.name, items: filtered.filter((c) => assignments[c.id] === folder.id) }));
  groups.push({ id: '', label: '未归类对话', items: filtered.filter((c) => !folders.some((folder) => folder.id === assignments[c.id])) });
  for (const group of groups) group.items.sort((x, y) => Number(!!y.pinned) - Number(!!x.pinned) || (y.updated || 0) - (x.updated || 0));
  return `<aside class="ask-history ${a.historyOpen ? 'is-open' : ''}">
      <div class="ask-pane-heading">
        <span class="ask-pane-logo">Y9</span>
        <div><b>智能创作</b><small>剧本 · 分镜 · 提示词</small></div>
      </div>
      <nav class="ask-workspace-nav">
        <button type="button" class="${a.workspacePage === 'console' ? 'is-on' : ''}" data-act="ask-workspace" data-page="console">▤ 控制台</button>
        <button type="button" data-act="ask-workspace" data-page="knowledge">📖 知识库</button>
        <button type="button" data-act="ask-workspace" data-page="plugins">🧩 插件</button>
      </nav>
      <div class="ask-sidebar-conversations">
        <button type="button" class="ask-new-chat" data-act="ask-new">＋ 新建对话</button>
        <button type="button" class="ask-new-chat ask-new-project" data-act="ask-folder-create">＋ 新建项目</button>
        <div class="ask-history-search"><span>⌕</span><input id="ask-search" placeholder="搜索对话历史" value="${esc(a.search)}" /></div>
        <div class="ask-history-list">
          ${groups.map((g) => ((g.id || g.items.length) ? `<div class="ask-folder-heading"><button type="button" class="ask-folder-toggle" data-act="ask-folder-toggle" data-id="${esc(g.id)}" aria-expanded="${!a.collapsedFolders?.[g.id]}" title="${esc(g.label)}">${a.collapsedFolders?.[g.id] ? '▸' : '▾'} <span>${esc(g.label)}</span><small>${g.items.length}</small></button>${g.id ? `<button type="button" class="ask-folder-action" data-act="ask-folder-new" data-id="${esc(g.id)}" title="在此项目新建对话">＋</button><button type="button" class="ask-folder-action" data-act="ask-folder-rename" data-id="${esc(g.id)}" title="重命名项目">✎</button>` : ''}</div>${(!a.collapsedFolders?.[g.id] || search ? g.items : []).map((c) => `<div class="ask-history-item ${c.id === a.activeId ? 'is-on' : ''}">
            <button type="button" class="ask-history-main" data-act="ask-open" data-id="${esc(c.id)}">
              <span>${c.pinned ? '◆' : '▢'}</span><span><b>${esc(c.title || '新的创作对话')}</b><small>${esc(askPreview(c))}</small></span>
            </button>
            <button type="button" class="ask-history-more" data-act="ask-more" data-id="${esc(c.id)}" title="管理对话">⋯</button>
          </div>`).join('')}` : '')).join('')}
          ${filtered.length ? '' : '<p class="ask-empty-history">没有匹配的对话</p>'}
        </div>
        ${a.removed ? `<div class="ask-undo">已删除一个对话<button type="button" data-act="ask-undo">撤销</button></div>` : ''}
      </div>
      <div class="ask-history-foot"><span>▤ 对话按项目保存在服务端</span><span class="ask-dot"></span></div>
    </aside>`;
}

function askFilePaneHtml() {
  const a = askState();
  const media = a.mediaPreview;
  const file = a.previewFile;
  const data = a.previewData;
  const name = media ? media.name : (file ? file.name : '文件');
  const bytes = media ? media.bytes : (data && data.size) || (file && file.size) || 0;
  const kind = media ? media.kind : ((data && data.kind) || 'text');
  const expanded = !!a.previewExpanded;
  const contentUrl = file ? '/api/agent/workspace/files/' + encodeURIComponent(file.id) + '/content' : '';
  const downloadUrl = media ? media.url : (file ? '/api/agent/workspace/files/' + encodeURIComponent(file.id) + '/download' : '');
  const labels = { image: '图片', video: '视频', audio: '音频', pdf: 'PDF', markdown: 'Markdown', html: 'HTML', spreadsheet: '表格', text: '文本', unsupported: '文件' };
  const kindLabel = media ? (media.kind === 'video' ? '视频' : '图片') : (labels[kind] || '文件');
  let body = '';
  if (media) {
    body = media.kind === 'video'
      ? `<div class="ask-pane-video"><video src="${esc(media.url)}" controls autoplay playsinline></video></div>`
      : `<div class="ask-pane-image"><img src="${esc(media.url)}" alt="" /></div>`;
  } else if (!data) {
    body = a.previewError
      ? `<div class="ask-pane-empty"><b>预览读取失败</b><span>${esc(a.previewError)}</span><button type="button" class="ask-btn" data-act="ask-preview-retry">重新加载</button><a class="ask-btn" href="${esc(downloadUrl)}" download>下载原件</a></div>`
      : '<div class="ask-pane-empty">正在读取文件预览…</div>';
  } else if (data.kind === 'spreadsheet') {
    const rows = data.rows || [];
    const columns = Math.max(0, ...rows.map((row) => row.length));
    const colName = (index) => { let out = ''; let n = index; do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0); return out; };
    body = `<div class="ask-sheet"><div class="ask-sheet-caption">只读预览 · ${data.total_rows ?? rows.length} 行 / ${data.total_columns ?? columns} 列 · 不执行公式</div>
      <div class="ask-sheet-scroll"><table><thead><tr><th class="row-number">#</th>${Array.from({ length: columns }, (_, i) => `<th>${colName(i)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row, ri) => `<tr><th class="row-number">${ri + 1}</th>${Array.from({ length: columns }, (_, ci) => `<td>${esc(String(row[ci] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  } else if (data.kind === 'markdown') {
    body = a.previewSource ? `<pre class="ask-pane-text">${esc(data.content || '')}</pre>` : `<div class="ask-pane-markdown ask-md">${markdownLite(data.content || '')}</div>`;
  } else if (data.kind === 'html') {
    body = a.previewSource
      ? `<pre class="ask-pane-text">${esc(data.content || '')}</pre>`
      : `<iframe class="ask-pane-html" sandbox="" referrerpolicy="no-referrer" srcdoc="${esc(data.content || '')}" title="隔离的 HTML 文件预览"></iframe>`;
  } else if (data.kind === 'image') {
    body = `<div class="ask-pane-image"><img src="${contentUrl}" alt="${esc(name)}" /></div>`;
  } else if (data.kind === 'pdf') {
    body = `<iframe class="ask-pane-html" src="${contentUrl}" title="PDF 文件预览"></iframe>`;
  } else if (data.kind === 'audio') {
    body = `<div class="ask-pane-media"><b>${esc(name)}</b><audio src="${contentUrl}" controls preload="metadata"></audio><p>音频播放</p></div>`;
  } else if (data.kind === 'video') {
    body = `<div class="ask-pane-video"><video src="${contentUrl}" controls preload="metadata" playsinline></video></div>`;
  } else if (data.kind === 'text') {
    body = `<pre class="ask-pane-text">${esc(data.content || data.text || '（没有可预览的文本）')}</pre>`;
  } else {
    body = `<div class="ask-pane-empty"><b>该格式暂不支持在线预览</b><span>${esc(data.message || '可以下载原件后用对应软件打开。')}</span><a class="ask-btn" href="${esc(downloadUrl)}" download>下载原件</a></div>`;
  }
  const isDoc = data && ['markdown', 'html'].includes(data.kind) && !media;
  const sheets = data && data.kind === 'spreadsheet' && Array.isArray(data.sheets) ? data.sheets : [];
  const paneStyle = !expanded && a.previewWidth ? ` style="width:${a.previewWidth}px"` : '';
  return `<aside class="ask-file-pane ${expanded ? 'is-expanded' : ''}"${paneStyle}>
    ${expanded ? '' : '<div class="ask-pane-resizer" role="separator" aria-label="调整聊天与预览宽度" aria-orientation="vertical" tabindex="0" title="拖动调整宽度，双击复位"><span></span></div>'}
    <header class="ask-file-head">
      <span class="ask-file-icon">${kind === 'video' ? '🎬' : kind === 'image' ? '🖼' : '📄'}</span>
      <div><b title="${esc(name)}">${esc(name)}</b><small>${kindLabel}预览${bytes ? ' · ' + fmtBytes(bytes) : ''}</small></div>
      ${downloadUrl ? `<a class="ask-icon-btn" href="${esc(downloadUrl)}" download="${esc(name)}" title="下载原件">⇩</a>` : ''}
      <button type="button" class="ask-icon-btn" data-act="ask-expand-preview" title="${expanded ? '缩小预览' : '展开预览'}">${expanded ? '⤡' : '⤢'}</button>
      <button type="button" class="ask-icon-btn" data-act="ask-close-pane" title="关闭预览">×</button>
    </header>
    ${isDoc ? `<nav class="ask-pane-mode"><button type="button" class="${a.previewSource ? '' : 'is-on'}" data-act="ask-preview-source" data-mode="preview">预览</button><button type="button" class="${a.previewSource ? 'is-on' : ''}" data-act="ask-preview-source" data-mode="source">源码</button>${data.kind === 'html' ? '<span>隔离预览 · 不执行脚本</span>' : ''}</nav>` : ''}
    ${sheets.length ? `<nav class="ask-pane-sheets">${sheets.map((sheet, i) => `<button type="button" class="${i === (data.sheet || 0) ? 'is-on' : ''}" data-act="ask-preview-sheet" data-sheet="${i}">${esc(sheet)}</button>`).join('')}</nav>` : ''}
    <div class="ask-file-body">${body}</div>
    ${data && data.truncated ? `<footer class="ask-file-foot">预览显示${data.kind === 'spreadsheet' ? '前 100 行、最多 50 列' : '前 20 万字符'}，下载可获取原件。</footer>` : (data && data.kind === 'pdf' ? '<footer class="ask-file-foot">PDF 使用浏览器内置阅读器；无法显示时可下载原件。</footer>' : (media ? '' : '<footer class="ask-file-foot">预览仅在打开时读取，不缓存原文。</footer>'))}
  </aside>`;
}
function renderScript() {
  const a = askState();
  if (!a.conversations) {
    if (!a.loading) {
      a.loading = true;
      askRestore();
    }
    return `<div class="ask-app"><div class="ask-loading">正在连接智能体服务…</div></div>`;
  }
  if (a.workspacePage !== 'console') return `<div class="ask-app">${askHistoryHtml()}<section class="ask-chat" style="padding:0">${askManageHtml()}</section></div>`;

  const active = askActive();
  const chat = active || { title: '新的创作对话', messages: [] };
  const messages = chat.messages || [];
  const search = (a.search || '').toLowerCase();
  const filtered = (a.conversations || [])
    .filter((c) => (c.id === a.activeId || (c.messages || []).length))
    .filter((c) => (c.title + ' ' + (c.messages || []).map((m) => m.text).join(' ')).toLowerCase().includes(search))
    .sort((x, y) => (y.updated || 0) - (x.updated || 0));
  const groups = [
    { label: '置顶对话', items: filtered.filter((c) => c.pinned) },
    { label: '最近对话', items: filtered.filter((c) => !c.pinned) },
  ];

  return `<div class="ask-app ${a.historyOpen ? '' : 'is-history-collapsed'}">
    ${askHistoryHtml()}

    <section class="ask-chat ${messages.length ? '' : 'is-empty'}">
      <header class="ask-chat-head">
        <div class="ask-chat-heading">
          <button type="button" class="ask-icon-btn" data-act="ask-toggle-history" title="切换对话列表">☰</button>
          <div><h1>${esc(chat.title || '新的创作对话')}</h1></div>
        </div>
        <div class="ask-head-actions">
          <button type="button" class="ask-icon-btn" data-act="ask-export" title="导出当前对话">⇩</button>
          <button type="button" class="ask-icon-btn ${a.capabilitiesOpen ? 'is-on' : ''}" data-act="ask-toggle-cap" title="工具与技能">▥</button>
        </div>
      </header>

      <div class="ask-messages" id="ask-messages">
        ${a.error ? `<div class="ask-error">${esc(a.error)}</div>` : ''}
        ${messages.length ? `<div class="ask-message-list">${askMessagesHtml(chat)}
          ${a.generating ? `<div class="ask-generation"><span class="ask-pulse"></span><b>模型回复生成中</b><span>整理问题与所选技能…</span><span class="ask-gen-elapsed">0s</span><button type="button" data-act="ask-stop">停止</button></div>` : ''}
        </div>` : askWelcomeHtml()}
      </div>

      ${askComposerHtml()}
    </section>

    ${(a.previewFile || a.mediaPreview) ? askFilePaneHtml() : (a.capabilitiesOpen ? askCapabilityHtml() : '')}
    ${a.rename.open ? askRenameModalHtml() : ''}
    ${a.folderDialog ? askFolderDialogHtml() : ''}
    ${a.toolDetail ? askToolModalHtml() : ''}
    ${a.moreMenu ? askMoreMenuHtml() : ''}
    <input type="file" id="ask-file" hidden multiple accept=".txt,.md,.csv,.json,.xlsx,.docx,.pdf,.png,.jpg,.jpeg,.webp,.html,.mp3,.wav,.m4a,.mp4,.webm" />
  </div>`;
}

function askMediaModalHtml() {
  const a = askState();
  const f = a.mediaPreview;
  const url = f.url || '';
  return `<div class="ask-modal-backdrop" data-act="ask-close-media">
    <div class="ask-modal is-wide">
      <div class="ask-modal-head"><b>${esc(f.name || '媒体')}</b><button type="button" data-act="ask-close-media">×</button></div>
      <div class="ask-modal-body is-media">
        ${f.kind === 'video'
          ? `<video class="ask-media-video" src="${esc(url)}" controls autoplay playsinline></video>`
          : `<img class="ask-preview-img" src="${esc(url)}" alt="" />`}
      </div>
      <div class="ask-modal-foot">
        <a class="ask-btn" href="${esc(url)}" download="${esc(f.name || 'file')}" target="_blank" rel="noreferrer">下载</a>
        <button type="button" class="ask-btn is-primary" data-act="ask-close-media">关闭</button>
      </div>
    </div>
  </div>`;
}

function askPreviewModalHtml() {
  const a = askState();
  const f = a.previewFile;
  const preview = a.previewData;
  return `<div class="ask-modal-backdrop" data-act="ask-close-preview">
    <div class="ask-modal is-wide">
      <div class="ask-modal-head"><b>${esc(f.name || '交付文件')}</b><button type="button" data-act="ask-close-preview">×</button></div>
      <div class="ask-modal-body">
        ${preview ? (preview.kind === 'image' ? `<img class="ask-preview-img" src="${esc(preview.url || '')}" alt="" />` : `<pre class="ask-preview-text">${esc(preview.text || '（没有可预览的文本）')}</pre>`) : '<div class="ask-cap-empty">正在加载预览…</div>'}
      </div>
      <div class="ask-modal-foot">
        <a class="ask-btn" href="/api/agent/workspace/files/${encodeURIComponent(f.id)}/download" target="_blank" rel="noreferrer">下载</a>
        <button type="button" class="ask-btn is-primary" data-act="ask-close-preview">关闭</button>
      </div>
    </div>
  </div>`;
}

function askRenameModalHtml() {
  const a = askState();
  return `<div class="ask-modal-backdrop" data-act="ask-rename-cancel">
    <div class="ask-modal">
      <div class="ask-modal-head"><b>重命名对话</b><button type="button" data-act="ask-rename-cancel">×</button></div>
      <div class="ask-modal-body"><input class="ask-input is-line" id="ask-rename-input" maxlength="60" value="${esc(a.rename.text)}" /></div>
      <div class="ask-modal-foot"><button type="button" class="ask-btn" data-act="ask-rename-cancel">取消</button><button type="button" class="ask-btn is-primary" data-act="ask-rename-save">保存</button></div>
    </div>
  </div>`;
}

function askToolModalHtml() {
  const t = askState().toolDetail;
  return `<div class="ask-modal-backdrop" data-act="ask-close-tool">
    <div class="ask-modal">
      <div class="ask-modal-head"><b>${esc(t.name)}</b><button type="button" data-act="ask-close-tool">×</button></div>
      <div class="ask-modal-body">
        <p class="ask-tool-desc">${esc(t.description)}</p>
        <div class="ask-kv"><span>所属模块</span><b>${esc(t.scope)}</b></div>
        <div class="ask-kv"><span>接入状态</span><b>尚未接入</b></div>
        <div class="ask-kv"><span>权限范围</span><b>当前项目内只读（设计目标）</b></div>
        <div class="ask-kv"><span>执行方式</span><b>后续通过本地接口执行，当前不可用</b></div>
      </div>
      <div class="ask-modal-foot"><button type="button" class="ask-btn is-primary" data-act="ask-close-tool">关闭</button></div>
    </div>
  </div>`;
}

function askFolderDialogHtml() {
  const dialog = askState().folderDialog;
  const folders = state.config.ui.conversationFolders || [];
  const move = dialog.mode === 'move';
  const selected = (state.config.ui.conversationFolderMap || {})[dialog.id] || '';
  return `<div class="ask-modal-backdrop"><div class="ask-modal" role="dialog" aria-modal="true" aria-label="${move ? '移入项目' : dialog.id ? '重命名项目' : '新建项目'}">
    <div class="ask-modal-head"><b>${move ? '移入项目' : dialog.id ? '重命名项目' : '新建项目'}</b><button type="button" data-act="ask-folder-cancel" aria-label="关闭">×</button></div>
    <div class="ask-modal-body">${move ? `<label for="ask-folder-select">选择项目</label><select class="ask-input is-line" id="ask-folder-select"><option value="">未归类</option>${folders.map((folder) => `<option value="${esc(folder.id)}" ${folder.id === selected ? 'selected' : ''}>${esc(folder.name)}</option>`).join('')}</select>${folders.length ? '' : '<p>还没有项目，请先点击左侧“新建项目”。</p>'}` : `<label for="ask-folder-name">项目名称</label><input class="ask-input is-line" id="ask-folder-name" maxlength="40" placeholder="例如：校园短剧、小说改编" value="${esc(dialog.name || '')}" />`}</div>
    <div class="ask-modal-foot"><button class="ask-btn" type="button" data-act="ask-folder-cancel">取消</button><button class="ask-btn is-primary" type="button" data-act="ask-folder-save">保存</button></div>
  </div></div>`;
}

async function askSaveFolder() {
  const a = askState();
  const dialog = a.folderDialog;
  if (!dialog || dialog.saving) return;
  dialog.saving = true;
  try {
    if (dialog.mode === 'move') {
      const id = $('#ask-folder-select').value;
      await saveAppearance({ conversationFolderMap: { ...(state.config.ui.conversationFolderMap || {}), [dialog.id]: id } });
    } else {
      const name = $('#ask-folder-name').value.trim();
      if (!name) throw new Error('请填写项目名称');
      const folders = state.config.ui.conversationFolders || [];
      if (folders.some((folder) => folder.name === name && folder.id !== dialog.id)) throw new Error('已有同名项目，请换一个名称');
      const next = dialog.id ? folders.map((folder) => folder.id === dialog.id ? { ...folder, name } : folder) : [...folders, { id: 'folder-' + askId(), name }];
      await saveAppearance({ conversationFolders: next });
    }
    a.folderDialog = null;
    askRenderAll();
  } catch (err) { toast(err.message, true); }
  finally { dialog.saving = false; }
}

function askMoreMenuHtml() {
  const a = askState();
  const c = (a.conversations || []).find((x) => x.id === a.moreMenu);
  if (!c) return '';
  return `<div class="ask-more-menu" role="menu" aria-label="管理对话：${esc(c.title || '新的创作对话')}" style="visibility:hidden">
    <button type="button" data-act="ask-pin" data-id="${esc(c.id)}">${c.pinned ? '取消置顶' : '置顶对话'}</button>
    <button type="button" data-act="ask-rename" data-id="${esc(c.id)}">重命名</button>
    <button type="button" data-act="ask-folder-move" data-id="${esc(c.id)}">移入项目</button>
    <button type="button" class="is-danger" data-act="ask-delete" data-id="${esc(c.id)}">删除对话</button>
  </div>`;
}

document.addEventListener('contextmenu', (event) => {
  const row = event.target.closest('.ask-history-item');
  if (!row || state.route !== 'script') return;
  const trigger = row.querySelector('.ask-history-main');
  if (!trigger) return;
  event.preventDefault();
  askState().moreMenu = trigger.dataset.id;
  askRenderAll();
});

function askCloseMoreMenu() {
  if (state.ask) state.ask.moreMenu = null;
  $('.ask-more-menu')?.remove();
}

function askPositionMoreMenu() {
  const menu = $('.ask-more-menu');
  if (!menu) return;
  const id = askState().moreMenu;
  const trigger = $$('.ask-history-main').find((button) => button.dataset.id === id);
  const list = $('.ask-history-list');
  if (!trigger || !list) return askCloseMoreMenu();
  const row = trigger.closest('.ask-history-item').getBoundingClientRect();
  const bounds = list.getBoundingClientRect();
  if (row.bottom <= bounds.top || row.top >= bounds.bottom) return askCloseMoreMenu();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = row.right + 8 + width <= window.innerWidth - 8 ? row.right + 8 : Math.max(8, row.left - width - 8);
  menu.style.left = Math.min(left, Math.max(8, window.innerWidth - width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(row.top, window.innerHeight - height - 8)) + 'px';
  menu.style.visibility = 'visible';
}

document.addEventListener('pointerdown', (event) => {
  if (state.ask?.moreMenu && !event.target.closest('.ask-more-menu, .ask-history-item')) askCloseMoreMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') askCloseMoreMenu();
});
document.addEventListener('scroll', (event) => {
  if (event.target.matches?.('.ask-history-list')) askPositionMoreMenu();
}, true);
window.addEventListener('resize', askPositionMoreMenu);

function askRenderAll() {
  if (state.route !== 'script') return;
  const view = $('#view');
  if (!view) return;
  const host = $('.route-host', view);
  if (!host) return;
  const historyScroll = $('.ask-history-list', host)?.scrollTop || 0;
  host.innerHTML = renderScript();
  bindAsk(host);
  askRenderPopups();
  const historyList = $('.ask-history-list', host);
  if (historyList) historyList.scrollTop = historyScroll;
  askPositionMoreMenu();
  const msgs = $('#ask-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

let askRenderTimer = null;
function askRenderSoon() {
  if (askRenderTimer) return;
  askRenderTimer = setTimeout(() => {
    askRenderTimer = null;
    askRenderMessages();
  }, 150);
}

function askScrollBottom() {
  const host = $('#ask-messages');
  if (host) host.scrollTop = host.scrollHeight;
}

function askRenderMessages() {
  const a = askState();
  const host = $('#ask-messages');
  if (!host) return;
  const chat = askActive();
  if (!chat) return;
  host.closest('.ask-chat').classList.toggle('is-empty', !chat.messages.length);
  if (!chat.messages.length) { host.innerHTML = askWelcomeHtml(); return; }
  host.innerHTML = `<div class="ask-message-list">${askMessagesHtml(chat)}
    ${a.generating ? `<div class="ask-generation"><span class="ask-pulse"></span><b>模型回复生成中</b><span>整理问题与所选技能…</span><span class="ask-gen-elapsed">0s</span><button type="button" data-act="ask-stop">停止</button></div>` : ''}
  </div>`;
  host.scrollTop = host.scrollHeight;
}

/* ------------------------------- 行为 ------------------------------- */

async function askLoadModels() {
  const a = askState();
  try {
    const data = await askApi('/models').then((r) => r.json());
    if (!Array.isArray(data.models)) throw new Error('bad');
    a.models = data.models;
    const previousDefault = a.defaultModelId;
    if (!data.models.some((m) => m.id === a.modelId) || a.modelId === previousDefault) {
      a.modelId = data.default_model || (data.models[0] && data.models[0].id) || '';
    }
    a.defaultModelId = data.default_model || '';
    a.effort = data.default_effort || '';
    askSyncEffort();
  } catch {
    a.models = a.models || [];
  }
}

function askSyncEffort() {
  const a = askState();
  const efforts = askEfforts();
  if (!efforts.includes(a.effort)) a.effort = efforts.includes('high') ? 'high' : (efforts[0] || '');
}

function askApplyEvent(msg, data) {
  if (data.type === 'start' && data.execution) msg.execution = data.execution;
  if (data.type === 'process' && data.plan) { msg.execution = msg.execution || {}; msg.execution.plan = data.plan; }
  if (data.type === 'trace') {
    msg.execution = msg.execution || {};
    msg.execution.steps = msg.execution.steps || [];
    const at = msg.execution.steps.findIndex((s) => s.id === data.step.id);
    if (at < 0) msg.execution.steps.push(data.step);
    else msg.execution.steps[at] = data.step;
    if (msg.execution.plan) {
      const idx = (msg.execution.plan.steps || []).findIndex((s) => s.id === data.step.id);
      if (idx >= 0) msg.execution.plan.steps[idx] = data.step;
    }
  }
  if (data.type === 'summary' && msg.execution) msg.execution.summary = data.text;
  if (data.type === 'media' && Array.isArray(data.files)) {
    msg.media = msg.media || [];
    for (const file of data.files) {
      if (file && file.url && !msg.media.some((x) => x.url === file.url)) msg.media.push(file);
    }
  }
  if (data.type === 'artifact' && data.file) {
    msg.execution = msg.execution || {};
    msg.execution.artifacts = msg.execution.artifacts || [];
    if (!msg.execution.artifacts.some((f) => f.id === data.file.id)) msg.execution.artifacts.push(data.file);
  }
  if (data.type === 'replace') msg.text = String(data.text || '');
  if (data.type === 'delta') msg.text = (msg.text || '') + String(data.text || '');
  if (data.type === 'error') {
    msg.error = data.message || '执行失败';
    if (!msg.text) msg.text = '⚠ ' + msg.error;
    msg._streaming = false;
  }
  if (data.type === 'done' || data.type === 'run_finished') {
    if (data.execution) msg.execution = data.execution;
    if (data.time) msg.time = data.time;
    msg._streaming = false;
    if (!msg.text && msg.execution && msg.execution.summary) msg.text = msg.execution.summary;
    if (!msg.text && msg.error) msg.text = '⚠ ' + msg.error;
  }
}

async function askQueueReply(chat, question, insertAt, fileIds = [], resumeId = '') {
  const a = askState();
  a.generating = true;
  const controller = new AbortController();
  a.controller = controller;
  const requestId = askId();
  a.request = { sessionId: chat.id, requestId, controller };
  const history = chat.messages.slice(0, insertAt === undefined ? chat.messages.length - 1 : insertAt).filter((m) => m.text);
  const msg = { id: askId(), role: 'assistant', text: '', time: Date.now(), skill: askSkillName(a.skillId), _streaming: true };
  if (insertAt === undefined) chat.messages.push(msg);
  else chat.messages.splice(insertAt, 0, msg);
  chat.updated = Date.now();
  askRenderMessages();
  let runId = '';
  let lastSeq = 0;
  const applyEvent = (data) => {
    if (typeof data.sequence === 'number') {
      if (data.sequence <= lastSeq) return;
      lastSeq = data.sequence;
    }
    askApplyEvent(msg, data);
  };
  try {
    if (!resumeId) {
      const saved = await fetch('/api/agent/sessions/' + encodeURIComponent(chat.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
        body: JSON.stringify({ ...chat, messages: history }),
        signal: controller.signal,
      });
      if (!saved.ok) throw new Error('会话保存失败');
    }
    const res = await fetch(resumeId ? '/api/agent/runs/' + encodeURIComponent(resumeId) + '/resume' : '/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
      signal: controller.signal,
      body: JSON.stringify(resumeId ? { client_request_id: requestId } : {
        client_request_id: requestId,
        session_id: chat.id,
        text: question,
        skill: askSkillName(a.skillId),
        skill_id: askSkill(a.skillId).id.startsWith('plugin:') ? askSkill(a.skillId).id.slice(7) : undefined,
        style_prompt: a.skillId ? (state.styleDetail && state.styleDetail.video) || '' : '',
        project_name: (state.project && state.project.name) || '',
        file_ids: fileIds,
        model_id: a.modelId || undefined,
        reasoning_effort: a.effort || undefined,
      }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      runId = (error.detail && error.detail.run_id) || '';
      throw new Error(typeof error.detail === 'string' ? error.detail : (error.detail && error.detail.message) || '模型连接失败');
    }
    runId = res.headers.get('X-Agent-Run-Id') || '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    for (;;) {
      const part = await reader.read();
      buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        const line = event.split('\n').find((x) => x.startsWith('data: '));
        if (!line) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.type === 'done' || data.type === 'run_finished') done = true;
        applyEvent(data);
        askRenderSoon();
      }
      if (part.done) break;
    }
    if (!done) throw new Error('回复连接中断，尚未收到任务结束确认');
  } catch (err) {
    const aborted = controller.signal.aborted;
    msg._streaming = false;
    if (!aborted) {
      let recovered = false;
      if (runId) {
        try {
          for (;;) {
            const response = await fetch('/api/agent/runs/' + encodeURIComponent(runId) + '/events?after=' + lastSeq + '&limit=100', {
              headers: { 'X-Project-Id': askProjectId() }, signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) break;
            const events = await response.json();
            if (!Array.isArray(events.items) || !events.items.length) break;
            for (const ev of events.items) {
              applyEvent(ev);
              if (ev.type === 'done' || ev.type === 'run_finished') recovered = true;
            }
            if (recovered || events.items.length < 100) break;
          }
        } catch { /* ignore */ }
      }
      if (!recovered) {
        if (msg.execution) {
          msg.execution.status = 'failed';
          for (const step of msg.execution.steps || []) if (step.status === 'running') step.status = 'failed';
        }
        msg.text = (msg.text ? msg.text + '\n\n' : '') + '[回复失败] ' + (err.message || '请稍后重试');
        toast('回复失败，请检查模型服务', true);
      }
    } else if (msg.text) {
      msg.text += '\n\n[生成已停止]';
    }
  } finally {
    if (a.request && a.request.controller !== controller) return;
    a.generating = false;
    a.startedAt = 0;
    a.controller = null;
    if (a.request && a.request.controller === controller) a.request = null;
    chat.updated = Date.now();
    if (askRenderTimer) { clearTimeout(askRenderTimer); askRenderTimer = null; }
    askRenderMessages();
    askPersist();
  }
}

async function askSend(text) {
  const a = askState();
  let raw = String(text === undefined ? a.draft : text).trim();
  const originalRaw = raw;
  const cmd = raw.match(/^\/(model|think|compact)$/);
  if (cmd) { askChooseCommand(cmd[1]); return; }
  if (!raw || a.generating) return;
  let chat = askActive();
  if (!chat) { askNewConversation(); chat = askActive(); }
  if (raw.length > 1024) {
    try {
      if (!(a.attachments || []).length) {
        await fetch('/api/agent/sessions/' + encodeURIComponent(chat.id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
          body: JSON.stringify(chat),
        }).catch(() => {});
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = new File([raw], '长文本-' + stamp + '.md', { type: 'text/markdown' });
      const saved = await askUploadFile(file, chat.id);
      a.attachments = [...(a.attachments || []), saved];
      raw = '已发送文件：' + saved.name;
      toast('超过 1024 字，已转为文件发送');
    } catch (err) {
      toast('长文本转文件失败，仍按文本发送：' + err.message, true);
    }
  }
  a.startedAt = Date.now();
  const attached = [...(a.attachments || [])];
  chat.messages.push({ id: askId(), role: 'user', text: raw, files: attached, time: Date.now() });
  if (chat.messages.length === 1) {
    chat.title = ASK_SKILLS.reduce((title, s) => title.split('@' + s.name).join(''), originalRaw).trim().slice(0, 24) || '新的创作对话';
    const headTitle = $('.ask-chat-heading h1');
    if (headTitle) headTitle.textContent = chat.title;
    const activeItem = $('.ask-history-item.is-on b');
    if (activeItem) activeItem.textContent = chat.title;
  }
  chat.updated = Date.now();
  a.draft = '';
  a.attachments = [];
  a.mention = null;
  a.command = { mode: null, query: null, index: 0 };
  const input = $('#ask-input');
  if (input) input.value = '';
  askRenderPopups();
  askPersist();
  askRenderAll();
  askQueueReply(chat, raw, undefined, attached.map((f) => f.id));
}

async function askStop() {
  const a = askState();
  const request = a.request;
  if (!request || request.stopping) return;
  request.stopping = true;
  try {
    const res = await fetch('/api/agent/sessions/' + encodeURIComponent(request.sessionId) + '/requests/' + encodeURIComponent(request.requestId) + '/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
      body: '{}', signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error('后端尚未确认停止，请稍后重试');
    // Keep the response stream open so its terminal receipt confirms cancellation.
    toast('已请求停止，正在等待后端结束');
  } catch (err) {
    toast(err.message || '停止请求失败，请检查后端连接', true);
  } finally {
    if (a.request === request) request.stopping = false;
  }
}

async function askChooseCommand(id) {
  const a = askState();
  if (a.generating) { toast('请等待当前回复完成', true); return; }
  if (a.command.mode === 'model') { a.modelId = id; askSyncEffort(); a.draft = ''; askClosePopups(); askRenderAll(); return; }
  if (a.command.mode === 'think') { a.effort = id; a.draft = ''; askClosePopups(); askRenderAll(); return; }
  a.draft = '';
  a.command = { mode: null, query: null, index: 0 };
  if (id === 'model' || id === 'think') { a.command = { mode: id, query: null, index: 0 }; askRenderAll(); return; }
  if (!a.activeId) return;
  const ok = confirm('将已有对话概括成摘要供后续消息使用，历史消息仍保留，会消耗 Token。继续？');
  if (!ok) return;
  try {
    a.generating = true;
    const res = await askApi('/sessions/' + encodeURIComponent(a.activeId) + '/compact', {
      method: 'POST',
      body: JSON.stringify({ model_id: a.modelId || undefined, reasoning_effort: a.effort || undefined }),
    });
    const result = await res.json();
    toast('上下文已压缩（' + (result.messages || 0) + ' 条消息）');
  } catch {
    toast('压缩失败，原上下文保留', true);
  } finally {
    a.generating = false;
    askRenderMessages();
  }
}

function askClosePopups() {
  const a = askState();
  a.mention = null;
  a.command = { mode: null, query: null, index: 0 };
}

function askUpdateMention() {
  const a = askState();
  const input = $('#ask-input');
  if (!input) return;
  a.draft = input.value;
  const end = input.selectionStart;
  const cmd = input.value.match(/^\/([a-z]*)$/);
  a.command = { mode: null, query: cmd ? cmd[1] : null, index: 0 };
  const prefix = input.value.slice(0, end);
  const match = prefix.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match || input.selectionStart !== input.selectionEnd) { a.mention = null; return; }
  const start = end - match[1].length - 1;
  if (!a.mention || a.mention.query !== match[1]) {
    a.mention = { start, end, query: match[1], index: 0 };
  } else {
    a.mention.start = start; a.mention.end = end; a.mention.query = match[1];
  }
}

function askChooseMention(id) {
  const a = askState();
  const range = a.mention;
  const skill = askSkill(id);
  if (!range) return;
  a.skillId = id;
  const token = '@' + skill.name + ' ';
  const input = $('#ask-input');
  const value = input ? input.value : a.draft;
  a.draft = value.slice(0, range.start) + token + value.slice(range.end);
  a.mention = null;
  askRenderPopups();
  const chip = document.querySelector('.ask-composer-context > span:nth-child(2)');
  if (chip) chip.textContent = '✧ ' + skill.name;
  const el = $('#ask-input');
  if (el) {
    el.value = a.draft;
    el.focus();
    el.setSelectionRange(range.start + token.length, range.start + token.length);
    const c = $('.ask-draft-count'); if (c) c.textContent = a.draft.length + '/3000';
    const send = $('[data-act="ask-send"]'); if (send) send.disabled = !a.draft.trim();
  }
}

async function askUploadFile(file, chatId) {
  const form = new FormData();
  form.append('file', file);
  if (chatId) form.append('session_id', chatId);
  const res = await fetch('/api/agent/workspace/files', {
    method: 'POST',
    headers: { 'X-Project-Id': askProjectId() },
    body: form,
  });
  if (!res.ok) throw new Error('上传失败 HTTP ' + res.status);
  return res.json();
}

async function askAttachFiles(files) {
  const a = askState();
  let chat = askActive();
  if (!chat) { askNewConversation(); chat = askActive(); }
  await fetch('/api/agent/sessions/' + encodeURIComponent(chat.id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
    body: JSON.stringify(chat),
  }).catch(() => {});
  for (const file of files) {
    if ((a.attachments || []).length >= 5) { toast('最多添加 5 个附件', true); break; }
    if (file.size > 10 * 1024 * 1024) { toast(file.name + ' 超过 10 MB', true); continue; }
    try {
      const saved = await askUploadFile(file, chat.id);
      a.attachments.push(saved);
      toast(saved.status === 'indexed' ? file.name + ' 已保存并建立索引' : file.name + '：' + (saved.status || '待处理'));
    } catch (err) {
      toast(err.message, true);
    }
  }
  askRenderAll();
}

async function askPreviewFile(id, sheet = 0) {
  const a = askState();
  const all = [];
  for (const c of a.conversations || []) for (const m of c.messages || []) {
    for (const f of (m.execution && m.execution.artifacts) || []) all.push(f);
    for (const f of m.files || []) all.push(f);
  }
  const file = all.find((f) => f.id === id) || { id, name: '文件' };
  a.previewFile = file;
  a.previewData = null;
  a.previewError = '';
  a.previewSheet = sheet;
  a.previewSource = false;
  a.mediaPreview = null;
  a.previewExpanded = false;
  askRenderAll();
  try {
    const res = await fetch('/api/agent/workspace/files/' + encodeURIComponent(id) + '/preview?sheet=' + sheet, { headers: { 'X-Project-Id': askProjectId() } });
    if (!res.ok) throw new Error('预览接口返回 ' + res.status);
    a.previewData = await res.json();
  } catch (err) {
    a.previewError = err.message || '预览失败';
  }
  askRenderAll();
}
async function askExportChat() {
  const chat = askActive();
  if (!chat) return;
  const text = '# ' + chat.title + '\n\n' + chat.messages.map((m) => `## ${m.role === 'user' ? '你' : 'H3 助手'}\n\n` + (m.execution ? `### 执行记录\n\n- 运行编号：${m.execution.id || ''}\n- 模型：${m.execution.model || ''}\n- 状态：${m.execution.status || ''}\n` + (m.execution.plan ? m.execution.plan.steps.map((s) => `- ${s.title} [${s.status}]：${s.output || s.purpose || ''}`).join('\n') : '') + '\n\n' : '') + m.text + `\n\n时间：${askTimeText(m.time)}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = '剧本创作-对话记录.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function askLoadManage() {
  const a = askState();
  a.manageError = '';
  try {
    const path = a.workspacePage === 'knowledge' ? '/knowledge' : '/plugins';
    const res = await askApi(path).then((r) => r.json());
    if (a.workspacePage === 'knowledge') a.kb = Array.isArray(res) ? res : res.items || [];
    else a.plugins = Array.isArray(res) ? res : res.items || [];
  } catch (err) {
    a.manageError = err.message;
  }
  askRenderAll();
}

async function askLoadTrajectory(offset = 0, append = false) {
  const a = askState();
  if (!a.activeId) return;
  try {
    const data = await askApi('/sessions/' + encodeURIComponent(a.activeId) + '/trajectory?limit=50' + (offset ? '&offset=' + offset : '')).then((r) => r.json());
    a.trajectory = append && a.trajectory ? { ...data, items: [...(a.trajectory.items || []), ...(data.items || [])] } : data;
  } catch (err) {
    if (!append) a.trajectory = { items: [] };
    toast(err.message, true);
  }
  askRenderAll();
}

function bindAsk(root) {
  const a = askState();
  if (!root) return;
  if (!a.models) { a.models = []; askLoadModels().then(() => { if (state.route === 'script') askRenderAll(); }); }
  if (!a.customSkills) { a.customSkills = []; askLoadSkills().then(() => { if (state.route === 'script') askRenderAll(); }); }

  if (a.generating) {
    clearInterval(a._genTimer);
    a._genTimer = setInterval(() => {
      const el = $('.ask-gen-elapsed');
      if (!el) { clearInterval(a._genTimer); return; }
      el.textContent = Math.max(0, Math.round((Date.now() - (a.startedAt || Date.now())) / 1000)) + 's';
    }, 1000);
  } else if (a._genTimer) { clearInterval(a._genTimer); a._genTimer = null; }

  const input = $('#ask-input');
  if (input) {
    input.oninput = () => { a.draft = input.value; askUpdateMention(); const c = $('.ask-draft-count'); if (c) c.textContent = a.draft.length + '/3000'; const send = $('[data-act="ask-send"]'); if (send) send.disabled = !a.draft.trim(); askRenderPopups(); };
    input.onkeyup = (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) askUpdateMention(); };
    input.onkeydown = (event) => {
      if (event.isComposing) return;
      const cmdOpen = a.command.mode !== null || a.command.query !== null;
      const mentionOpen = !!a.mention;
      if (cmdOpen) {
        if (event.key === 'Escape') { event.preventDefault(); askClosePopups(); askRenderPopups(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const items = askCommandItems(); if (items.length) { a.command.index = (a.command.index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; askRenderPopups(); } return; }
        if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
          event.preventDefault();
          const item = askCommandItems()[a.command.index];
          if (item) askChooseCommand(item.id);
          return;
        }
      }
      if (mentionOpen) {
        if (event.key === 'Escape') { event.preventDefault(); a.mention = null; askRenderPopups(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const list = askMentionSkills(); if (list.length) { a.mention.index = (a.mention.index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length; askRenderPopups(); } return; }
        if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) { event.preventDefault(); const skill = askMentionSkills()[a.mention.index]; if (skill) askChooseMention(skill.id); return; }
      }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); askSend(); }
    };
    if (!a.draft) input.focus();
  }

  const search = $('#ask-search');
  if (search) search.oninput = () => { a.search = search.value; askRenderAll(); const el = $('#ask-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };

  const modelSel = $('#ask-model');
  if (modelSel) modelSel.onchange = () => { a.modelId = modelSel.value; askSyncEffort(); askRenderAll(); };
  const effortSel = $('#ask-effort');
  if (effortSel) effortSel.onchange = () => { a.effort = effortSel.value; };

  const renameInput = $('#ask-rename-input');
  if (renameInput) {
    renameInput.oninput = () => { a.rename.text = renameInput.value; };
    renameInput.onkeydown = (event) => { if (event.key === 'Enter') askSaveRename(); };
    renameInput.focus();
  }
  const folderName = $('#ask-folder-name');
  if (folderName) {
    folderName.focus();
    folderName.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); askSaveFolder(); } };
  }

  if (a._askClick) root.removeEventListener('click', a._askClick);
  const askClick = async (event) => {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    try {
      if (act === 'ask-new') return askNewConversation();
      if (act === 'ask-clear-skill') { a.skillId = ''; return askRenderAll(); }
      if (act === 'ask-folder-create' || act === 'ask-folder-rename') {
        const folder = (state.config.ui.conversationFolders || []).find((item) => item.id === btn.dataset.id);
        a.workspacePage = 'console';
        a.folderDialog = { mode: 'name', id: folder?.id || '', name: folder?.name || '' };
        return askRenderAll();
      }
      if (act === 'ask-folder-cancel') { a.folderDialog = null; return askRenderAll(); }
      if (act === 'ask-folder-save') return askSaveFolder();
      if (act === 'ask-folder-toggle') {
        a.collapsedFolders = { ...(a.collapsedFolders || {}), [btn.dataset.id]: !a.collapsedFolders?.[btn.dataset.id] };
        return askRenderAll();
      }
      if (act === 'ask-folder-new') {
        const conversation = askNewConversation();
        await saveAppearance({ conversationFolderMap: { ...(state.config.ui.conversationFolderMap || {}), [conversation.id]: btn.dataset.id } });
        a.collapsedFolders = { ...(a.collapsedFolders || {}), [btn.dataset.id]: false };
        return askRenderAll();
      }
      if (act === 'ask-folder-move') {
        a.folderDialog = { mode: 'move', id: btn.dataset.id };
        a.moreMenu = null;
        return askRenderAll();
      }
      if (act === 'ask-open') { a.moreMenu = null; return askSelect(btn.dataset.id); }
      if (act === 'ask-more') { a.moreMenu = a.moreMenu === btn.dataset.id ? null : btn.dataset.id; return askRenderAll(); }
      if (act === 'ask-more-close') { if (!event.target.closest('.ask-more-menu')) { a.moreMenu = null; askRenderAll(); } return; }
      if (act === 'ask-pin') {
        const c = (a.conversations || []).find((x) => x.id === btn.dataset.id);
        if (c) c.pinned = !c.pinned;
        a.moreMenu = null; askPersist(); return askRenderAll();
      }
      if (act === 'ask-rename') {
        const c = (a.conversations || []).find((x) => x.id === btn.dataset.id);
        a.rename = { open: true, id: c.id, text: c.title };
        a.moreMenu = null; return askRenderAll();
      }
      if (act === 'ask-rename-cancel') { a.rename = { open: false, id: '', text: '' }; return askRenderAll(); }
      if (act === 'ask-rename-save') return askSaveRename();
      if (act === 'ask-delete') {
        const id = btn.dataset.id;
        const c = (a.conversations || []).find((x) => x.id === id);
        if (!c) return;
        if (id === a.activeId) askStop();
        await askApi('/sessions/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => toast('删除会话失败', true));
        a.removed = c;
        a.conversations = (a.conversations || []).filter((x) => x.id !== id);
        if (a.activeId === id) {
          a.activeId = (a.conversations[0] && a.conversations[0].id) || '';
          if (!a.activeId) askNewConversation();
        }
        return askRenderAll();
      }
      if (act === 'ask-undo') {
        if (a.removed) { a.conversations.unshift(a.removed); a.removed = null; askPersist(); }
        return askRenderAll();
      }
      if (act === 'ask-workspace') {
        a.workspacePage = btn.dataset.page;
        a.previewFile = null;
        askRenderAll();
        if (a.workspacePage !== 'console') askLoadManage();
        return;
      }
      if (act === 'ask-toggle-history') {
        a.historyOpen = !a.historyOpen;
        if (!a.historyOpen && a.capabilitiesOpen) a.capabilitiesOpen = false;
        return askRenderAll();
      }
      if (act === 'ask-toggle-cap') { a.capabilitiesOpen = !a.capabilitiesOpen; a.previewFile = null; a.previewData = null; a.mediaPreview = null; a.previewExpanded = false; if (a.capabilitiesOpen && a.panelTab === 'trajectory') askLoadTrajectory(); return askRenderAll(); }
      if (act === 'ask-close-cap') { a.capabilitiesOpen = false; return askRenderAll(); }
      if (act === 'ask-panel') {
        a.panelTab = btn.dataset.tab;
        if (a.panelTab === 'trajectory') { a.trajectory = null; askRenderAll(); return askLoadTrajectory(); }
        return askRenderAll();
      }
      if (act === 'ask-captab') { a.capTab = btn.dataset.tab; return askRenderAll(); }
      if (act === 'ask-skill') { a.skillId = btn.dataset.id; return askRenderAll(); }
      if (act === 'ask-new-skill') {
        a.workspacePage = 'plugins';
        a.pluginTab = 'skill';
        askRenderAll();
        await askLoadManage();
        return askManageDialog('skill');
      }
      if (act === 'ask-use-skill') { a.skillId = btn.dataset.skill; return askSend(btn.dataset.prompt); }
      if (act === 'ask-fill') { a.draft = btn.dataset.text; askRenderAll(); const el = $('#ask-input'); if (el) el.focus(); return; }
      if (act === 'ask-cmd') return askChooseCommand(btn.dataset.id);
      if (act === 'ask-mention') return askChooseMention(btn.dataset.skill);
      if (act === 'ask-skill-picker') {
        const el = $('#ask-input');
        const caret = el ? el.selectionStart : a.draft.length;
        a.draft = a.draft.slice(0, caret) + '@' + a.draft.slice(caret);
        a.mention = { start: caret, end: caret + 1, query: '', index: 0 };
        askRenderAll();
        const input2 = $('#ask-input');
        if (input2) { input2.focus(); input2.setSelectionRange(caret + 1, caret + 1); }
        return;
      }
      if (act === 'ask-attach') { $('#ask-file').click(); return; }
      if (act === 'ask-detach') { a.attachments = (a.attachments || []).filter((f) => f.id !== btn.dataset.id); return askRenderAll(); }
      if (act === 'ask-send') return askSend();
      if (act === 'ask-stop') return askStop();
      if (act === 'ask-export') return askExportChat();
      if (act === 'ask-chain') {
        const chat = askActive();
        if (!chat || a.generating) return;
        const msg = (chat.messages || [])[Number(btn.dataset.index)];
        if (!msg) return;
        const next = btn.dataset.skill;
        a.skillId = next;
        const arts = (msg.execution && msg.execution.artifacts) || [];
        const files = arts.map((f) => ({ id: f.id, name: f.name, size: f.size }));
        const text = arts.length
          ? '把附件《' + arts[0].name + '》' + btn.dataset.verb + '，保持人物、情节和台词不变。'
          : '把上面的内容' + btn.dataset.verb + '，保持人物、情节和台词不变：\n\n' + String(msg.text || '').slice(0, 1500);
        chat.messages.push({ id: askId(), role: 'user', text, files, time: Date.now() });
        chat.updated = Date.now();
        askPersist();
        askRenderMessages();
        return askQueueReply(chat, text, undefined, files.map((f) => f.id));
      }
      if (act === 'ask-to-studio') {
        const msg = (askActive() && askActive().messages || [])[Number(btn.dataset.index)];
        if (!msg || !msg.text) return;
        state.studio.prompt = msg.text;
        state.studio.promptMode = 'code';
        state.studio.workflowId = state.studio.workflowId || (state.workflows[0] && state.workflows[0].id);
        location.hash = '#studio';
        toast('已写进视频创作台的提示词框');
        return;
      }
      if (act === 'ask-copy') {
        const msg = (askActive() && askActive().messages || [])[Number(btn.dataset.index)];
        if (msg) { await navigator.clipboard.writeText(msg.text || ''); toast('已复制回复'); }
        return;
      }
      if (act === 'ask-paste') {
        const msg = (askActive() && askActive().messages || [])[Number(btn.dataset.index)];
        if (!msg) return;
        if ((msg.text || '').length > 3000) { toast('回复超过 3000 字，请复制后挑选', true); return; }
        a.draft = msg.text;
        askRenderAll();
        const el = $('#ask-input');
        if (el) el.focus();
        return;
      }
      if (act === 'ask-like' || act === 'ask-dislike') {
        const msg = (askActive() && askActive().messages || [])[Number(btn.dataset.index)];
        if (!msg) return;
        const set = act === 'ask-like' ? a.liked : a.disliked;
        const other = act === 'ask-like' ? a.disliked : a.liked;
        if (set.has(msg.id)) set.delete(msg.id); else { set.add(msg.id); other.delete(msg.id); }
        return askRenderMessages();
      }
      if (act === 'ask-regenerate') {
        const chat = askActive();
        if (!chat || a.generating) return;
        const index = Number(btn.dataset.index);
        const question = [...chat.messages.slice(0, index)].reverse().find((m) => m.role === 'user');
        if (!question) return;
        chat.messages.splice(index, 1);
        return askQueueReply(chat, question.text, index, (question.files || []).map((f) => f.id));
      }
      if (act === 'ask-resume') {
        const chat = askActive();
        if (!chat || a.generating) return;
        const msg = chat.messages[Number(btn.dataset.index)];
        if (!msg || !msg.execution) return;
        chat.messages.push({ id: askId(), role: 'user', text: '继续刚才未完成的任务', time: Date.now() });
        return askQueueReply(chat, '继续刚才未完成的任务', undefined, [], msg.execution.id);
      }
      if (act === 'ask-preview-source') {
        a.previewSource = btn.dataset.mode === 'source';
        return askRenderAll();
      }
      if (act === 'ask-preview-sheet') {
        return askPreviewFile(a.previewFile && a.previewFile.id, Number(btn.dataset.sheet || 0));
      }
      if (act === 'ask-preview-retry') {
        return askPreviewFile(a.previewFile && a.previewFile.id, a.previewSheet || 0);
      }
      if (act === 'ask-open-media') {
        const chat = askActive();
        const msg = chat && chat.messages[Number(btn.dataset.index)];
        const file = msg && msg.media && msg.media[Number(btn.dataset.media)];
        if (!file) return;
        a.mediaPreview = file;
        a.previewFile = null;
        a.previewExpanded = false;
        return askRenderAll();
      }
      if (act === 'ask-close-media') {
        a.mediaPreview = null;
        a.previewExpanded = false;
        return askRenderAll();
      }
      if (act === 'ask-expand-preview') {
        a.previewExpanded = !a.previewExpanded;
        return askRenderAll();
      }
      if (act === 'ask-close-pane') {
        a.previewFile = null;
        a.previewData = null;
        a.mediaPreview = null;
        a.previewExpanded = false;
        return askRenderAll();
      }
      if (act === 'ask-preview') return askPreviewFile(btn.dataset.id);
      if (act === 'ask-close-preview') {
        a.previewFile = null;
        a.previewData = null;
        a.previewExpanded = false;
        return askRenderAll();
      }
      if (act === 'ask-tool') { a.toolDetail = ASK_TOOLS.find((t) => t.id === btn.dataset.id) || null; return askRenderAll(); }
      if (act === 'ask-close-tool') { a.toolDetail = null; return askRenderAll(); }
      if (act === 'ask-traj-more') return askLoadTrajectory((askState().trajectory && askState().trajectory.next_offset) || 0, true);
      if (act === 'ask-plugin-tab') { a.pluginTab = btn.dataset.tab; return askRenderAll(); }
      if (act === 'ask-manage-refresh') return askLoadManage();
      if (act === 'ask-manage-new') return askManageDialog(a.workspacePage === 'knowledge' ? 'knowledge' : (a.pluginTab || 'skill'));
      if (act === 'ask-manage-edit') {
        const list = a.workspacePage === 'knowledge' ? a.kb : a.plugins;
        const item = (list || []).find((x) => x.id === btn.dataset.id);
        return askManageDialog(a.workspacePage === 'knowledge' ? 'knowledge' : (item.kind || a.pluginTab || 'skill'), item);
      }
      if (act === 'ask-manage-del') {
        const path = a.workspacePage === 'knowledge' ? '/knowledge/' : '/plugins/';
        if (!confirm('删除这条配置？')) return;
        await askApi(path + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }).catch((e) => toast(e.message, true));
        return askLoadManage();
      }
    } catch (err) {
      toast(err.message, true);
    }
  };
  a._askClick = askClick;
  root.addEventListener('click', askClick);

  const fileInput = $('#ask-file');
  if (fileInput) fileInput.onchange = () => { const files = [...(fileInput.files || [])]; fileInput.value = ''; if (files.length) askAttachFiles(files); };

  // 拖拽文件到聊天区
  root.ondragover = (event) => {
    if (![...(event.dataTransfer.types || [])].includes('Files')) return;
    event.preventDefault();
    root.classList.add('is-file-drag');
  };
  root.ondragleave = () => root.classList.remove('is-file-drag');
  root.ondrop = (event) => {
    const dropFiles = [...(event.dataTransfer.files || [])];
    if (!dropFiles.length) return;
    event.preventDefault();
    root.classList.remove('is-file-drag');
    askAttachFiles(dropFiles);
  };

  // Ctrl+V 直接粘贴文件/截图
  if (a._pasteHandler) document.removeEventListener('paste', a._pasteHandler);
  a._pasteHandler = (event) => {
    if (state.route !== 'script') return;
    const clip = event.clipboardData;
    if (!clip) return;
    const files = [...(clip.files || [])];
    if (!files.length) {
      for (const item of [...(clip.items || [])]) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    if (!files.length) return;
    event.preventDefault();
    askAttachFiles(files);
  };
  document.addEventListener('paste', a._pasteHandler);

  const pane = $('.ask-file-pane');
  const resizer = pane && pane.querySelector('.ask-pane-resizer');
  if (pane && resizer) {
    let dragStart = 0;
    let dragWidth = 0;
    let dragging = false;
    const commit = () => {
      try { if (a.previewWidth) localStorage.setItem('h3.previewWidth', String(a.previewWidth)); else localStorage.removeItem('h3.previewWidth'); } catch { /* ignore */ }
    };
    resizer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      dragStart = event.clientX;
      dragWidth = pane.getBoundingClientRect().width;
      resizer.setPointerCapture(event.pointerId);
      document.body.classList.add('is-pane-resizing');
    });
    resizer.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const total = pane.parentElement ? pane.parentElement.clientWidth : 1200;
      const next = Math.max(240, Math.min(dragWidth + dragStart - event.clientX, Math.max(280, total - 380)));
      pane.style.width = next + 'px';
      a.previewWidth = Math.round(next);
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-pane-resizing');
      commit();
    };
    resizer.addEventListener('pointerup', endDrag);
    resizer.addEventListener('pointercancel', endDrag);
    resizer.addEventListener('lostpointercapture', endDrag);
    resizer.addEventListener('dblclick', () => { a.previewWidth = null; commit(); askRenderAll(); });
    resizer.addEventListener('keydown', (event) => {
      if (event.key === 'Home') { event.preventDefault(); a.previewWidth = null; commit(); return askRenderAll(); }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const base = pane.getBoundingClientRect().width;
      a.previewWidth = Math.max(240, base + (event.key === 'ArrowLeft' ? 24 : -24));
      commit();
      askRenderAll();
    });
  }
}

function askSaveRename() {
  const a = askState();
  const c = (a.conversations || []).find((x) => x.id === a.rename.id);
  if (c && a.rename.text.trim()) c.title = a.rename.text.trim();
  a.rename = { open: false, id: '', text: '' };
  askPersist();
  askRenderAll();
}

async function askManageDialog(kind, item) {
  const a = askState();
  const isKb = kind === 'knowledge';
  let pluginKind = isKb ? '' : (kind === 'plugins' ? (a.pluginTab || 'skill') : kind);
  if (!isKb && !['tool', 'skill', 'mcp'].includes(pluginKind)) pluginKind = 'skill';
  const cfg = (item && item.config) || {};
  let mode = cfg.mode === 'bundle' ? 'bundle' : 'text';
  let files = Array.isArray(cfg.files)
    ? cfg.files.map((f) => ({ path: String(f.path || f.name || ''), content: String(f.content ?? '') })).filter((f) => f.path)
    : [];
  const kindLabel = { tool: '工具', skill: '技能', mcp: 'MCP' }[pluginKind] || '';
  const title = isKb
    ? (item ? '编辑知识条目' : '新建知识条目')
    : (item ? '编辑' + kindLabel : '新建' + kindLabel);
  const skillMd = esc(cfg.instructions || '');
  const toolConfig = pluginKind === 'skill' ? '' : esc(JSON.stringify(cfg.extra || {}, null, 2));

  openModal(`<div class="modal-head"><h2>${title}</h2><span class="grow"></span><button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body">
      ${isKb ? '' : `<div class="field"><label>类型</label><input class="input" value="${esc(kindLabel)}" disabled /></div>`}
      <div class="field"><label>名称</label><input class="input" id="ask-manage-name" value="${esc(item ? item.name : '')}" placeholder="${isKb ? '例如：项目世界观' : '例如：资产提取（人物/场景/道具）'}" /></div>
      <div class="field"><label>描述</label><textarea class="input" id="ask-manage-desc" rows="2" placeholder="一句话说明它解决什么问题">${esc(item ? item.description || '' : '')}</textarea></div>
      ${isKb ? '' : pluginKind === 'skill' ? `
        <div class="field"><label>技能形态</label>
          <div class="ask-mode-opts">
            <label class="ask-mode-opt"><input type="radio" name="ask-plugin-mode" value="text" ${mode === 'text' ? 'checked' : ''} /><span><b>文本技能</b><small>单个 SKILL.md / 提示词，适合纯步骤说明</small></span></label>
            <label class="ask-mode-opt"><input type="radio" name="ask-plugin-mode" value="bundle" ${mode === 'bundle' ? 'checked' : ''} /><span><b>完整技能</b><small>SKILL.md + 脚本 / 文档 / 示例文件</small></span></label>
          </div>
        </div>
        <div class="ask-mode-pane ${mode === 'text' ? '' : 'is-hidden'}" id="ask-mode-text">
          <div class="field"><label>SKILL.md 内容</label><textarea class="input" id="ask-manage-instructions" rows="10" placeholder="写清触发条件、步骤、输出格式、检查项">${skillMd}</textarea></div>
        </div>
        <div class="ask-mode-pane ${mode === 'bundle' ? '' : 'is-hidden'}" id="ask-mode-bundle">
          <div class="field"><label>SKILL.md 内容（入口，必填）</label><textarea class="input" id="ask-manage-skillmd" rows="8" placeholder="技能入口说明；脚本和示例放在下面的附加文件里">${skillMd}</textarea></div>
          <div class="field"><label>附加文件（脚本 / 文档 / 示例，文本）</label>
            <input type="file" id="ask-bundle-picker" multiple class="input" accept=".md,.mjs,.js,.py,.txt,.json,.yaml,.yml,.html,.css,.csv" />
            <div class="ask-bundle-list" id="ask-bundle-list"></div>
            <p class="hint">选择多个文件即可；文件名带目录时按目录保存。单个文件建议 &lt; 200KB。</p>
          </div>
        </div>`
      : `<div class="field"><label>配置（JSON，可选）</label><textarea class="input" id="ask-manage-instructions" rows="8" placeholder='例如 {"endpoint":"http://...","headers":{}}'>${toolConfig}</textarea></div>`}
    </div>
    <div class="modal-foot"><button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">取消</button><button type="button" class="h3-btn h3-btn-sm h3-btn-primary" id="ask-manage-save">保存</button></div>`);

  const renderFiles = () => {
    const box = $('#ask-bundle-list');
    if (!box) return;
    box.innerHTML = files.length
      ? files.map((f, i) => `<div class="ask-bundle-row"><span title="${esc(f.path)}">${esc(f.path)}</span><small>${f.content.length} 字</small><button type="button" data-rm="${i}" title="移除">×</button></div>`).join('')
      : '<p class="hint">还没有附加文件。完整技能可以放 scripts/、references/、examples/ 等。</p>';
    $$('#ask-bundle-list [data-rm]').forEach((btn) => {
      btn.onclick = () => { files.splice(Number(btn.dataset.rm), 1); renderFiles(); };
    });
  };
  renderFiles();

  const updateMode = () => {
    const picked = document.querySelector('input[name="ask-plugin-mode"]:checked');
    mode = picked ? picked.value : 'text';
    const textPane = $('#ask-mode-text');
    const bundlePane = $('#ask-mode-bundle');
    if (textPane) textPane.classList.toggle('is-hidden', mode !== 'text');
    if (bundlePane) bundlePane.classList.toggle('is-hidden', mode !== 'bundle');
  };
  $$('input[name="ask-plugin-mode"]').forEach((radio) => { radio.onchange = updateMode; });

  const picker = $('#ask-bundle-picker');
  if (picker) {
    picker.onchange = async () => {
      for (const file of [...(picker.files || [])]) {
        if (file.size > 200 * 1024) { toast(file.name + ' 超过 200KB，先不要放进技能', true); continue; }
        const text = await file.text();
        if (/^SKILL\.md$/i.test(file.name)) {
          const md = $('#ask-manage-skillmd');
          if (md) md.value = text;
          continue;
        }
        const path = file.webkitRelativePath || file.name;
        files = files.filter((f) => f.path !== path);
        files.push({ path, content: text });
      }
      picker.value = '';
      renderFiles();
    };
  }

  $('#ask-manage-save').onclick = async () => {
    try {
      const name = $('#ask-manage-name').value.trim();
      if (!name) return toast('填个名称', true);
      const description = $('#ask-manage-desc').value.trim();
      let payload;
      if (isKb) {
        payload = { name, description };
      } else if (pluginKind === 'skill') {
        if (mode === 'bundle') {
          const entry = ($('#ask-manage-skillmd') || {}).value || '';
          if (!entry.trim()) return toast('完整技能需要填写 SKILL.md 入口内容', true);
          payload = { kind: 'skill', name, description, enabled: item ? item.enabled !== false : true, config: { mode: 'bundle', instructions: entry, files } };
        } else {
          payload = { kind: 'skill', name, description, enabled: item ? item.enabled !== false : true, config: { mode: 'text', instructions: ($('#ask-manage-instructions') || {}).value || '' } };
        }
      } else {
        const raw = ($('#ask-manage-instructions') || {}).value || '';
        let extra = {};
        if (raw.trim()) {
          try { extra = JSON.parse(raw); } catch { extra = { text: raw }; }
        }
        payload = { kind: pluginKind, name, description, enabled: item ? item.enabled !== false : true, config: { mode: 'text', extra } };
      }
      const path = isKb ? '/knowledge' : '/plugins';
      if (item) await askApi(path + '/' + encodeURIComponent(item.id), { method: 'PUT', body: JSON.stringify(payload) });
      else await askApi(path, { method: 'POST', body: JSON.stringify(payload) });
      closeModal();
      await askLoadSkills();
      await askLoadManage();
      toast('已保存');
    } catch (err) {
      toast(err.message, true);
    }
  };
}

function bindScript(root) {
  bindAsk(root);
}

/* ------------------------------------------------------------------ batch */

function renderBatch(embed = false) {
  const b = state.batch || {};
  const result = b.result || null;
  const head = `
  <div class="page-head">
    <div><h1>批量创建</h1><p>导入 AI 整理好的任务 JSON，选 API 后一次加入并发队列。</p></div>
    <div class="page-actions">
      <button class="btn" data-act="batch-import">导入 JSON</button>
      <button class="btn" data-act="batch-template">保存模板</button>
      <button class="btn" data-act="batch-spec">复制 AI 说明</button>
    </div>
  </div>`;
  return `${embed ? '' : head}
  ${embed ? '<div class="task-batch-tools"><button class="btn" data-act="batch-import">导入 JSON</button><button class="btn" data-act="batch-template">保存模板</button><button class="btn" data-act="batch-spec">复制 AI 说明</button></div>' : ''}
  <div class="batch-grid">
    <div class="card" style="padding:14px;display:flex;flex-direction:column;gap:10px">
      <div class="row"><span class="muted small">工作流</span><select class="select" id="batch-workflow" style="flex:1">${state.workflows.filter((w) => w.provider !== 'autodl' || !state.workflows.some((x) => x.provider === 'manager')).map((w) => `<option value="${esc(w.id)}" ${w.id === (b.workflowId || state.studio.workflowId) ? 'selected' : ''}>${esc(w.display)}</option>`).join('')}</select></div>
      <textarea class="textarea mono" id="batch-json" style="min-height:300px" placeholder='{"format":"zealman-h3-batch","version":1,"baseDir":"","defaults":{"duration":10,"repeat":1},"tasks":[...]}'>${esc(b.text || '')}</textarea>
      <div class="row">
        <button class="btn primary" data-act="batch-parse">解析并校验</button>
        <button class="btn" data-act="batch-add" ${result && result.tasks.some((t) => !t.errors.length) ? '' : 'disabled'}>加入队列</button>
        <span class="grow"></span>
        <span class="hint">也支持把 .json 文件拖进左侧</span>
      </div>
      ${result ? `
        <div class="row small"><strong>${esc(result.name)}</strong><span class="badge">${result.tasks.length} 条</span>${result.errors.length ? `<span class="badge bad">${result.errors.length} 个问题</span>` : '<span class="badge ok">全部通过</span>'}<span class="grow"></span><span class="hint mono">${esc(result.baseDir)}</span></div>
        ${result.warnings.length ? `<div class="prompt-warn show">${result.warnings.map((w) => '· ' + esc(w)).join('<br>')}</div>` : ''}
      ` : ''}
    </div>
    <div class="card" style="padding:14px">
      <div class="stage-title">校验结果</div>
      <div class="validate-list">
        ${result ? result.tasks.map((t) => `
          <div class="validate-row ${t.errors.length ? 'bad' : 'ok'}">
            <span class="idx">${t.index}</span>
            <div style="flex:1;min-width:0">
              <div><strong>${esc(t.title)}</strong> <span class="hint">×${t.repeat}</span></div>
              <div class="hint">${t.images.length} 图 · ${t.audios.length} 音频 · ${t.duration} 秒 · ${esc(t.aspectRatio)}</div>
              ${t.errors.length ? `<div style="color:var(--danger)">${t.errors.map(esc).join('<br>')}</div>` : ''}
            </div>
          </div>`).join('') : `<div class="hint">解析后会在这里显示每条任务的校验结果。</div>`}
      </div>
    </div>
  </div>`;
}

function bindBatch(root) {
  const textarea = $('#batch-json');
  if (textarea) textarea.oninput = () => {
    state.batch = state.batch || {};
    state.batch.text = textarea.value;
  };
  const wf = $('#batch-workflow');
  if (wf) wf.onchange = () => { state.batch = state.batch || {}; state.batch.workflowId = wf.value; };

  const drop = $('.batch-grid', root);
  if (drop) {
    drop.addEventListener('dragover', (event) => { event.preventDefault(); });
    drop.addEventListener('drop', async (event) => {
      const file = (event.dataTransfer.files || [])[0];
      if (!file) return;
      event.preventDefault();
      const text = await file.text();
      state.batch = state.batch || {};
      state.batch.text = text;
      state.batch.fileName = file.name;
      render();
      toast('已载入 ' + file.name);
    });
  }

  root.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    try {
      if (act === 'batch-import') {
        const input = $('#file-input');
        input.accept = '.json,application/json';
        input.onchange = async () => {
          const file = input.files && input.files[0];
          input.value = '';
          if (!file) return;
          const text = await file.text();
          state.batch = state.batch || {};
          state.batch.text = text;
          state.batch.fileName = file.name;
          render();
          toast('已载入 ' + file.name);
        };
        input.click();
        return;
      }
      if (act === 'batch-template') {
        const template = {
          format: 'zealman-h3-batch',
          version: 1,
          name: '新批次',
          baseDir: '',
          defaults: { aspectRatio: '9:16', duration: 10, repeat: 1 },
          tasks: [{ title: '示例任务', images: [{ path: '示例1/fs.png', subject: '角色' }], audios: [], prompt: 'subject_definitions:\n<Subject 1> is ...\n\nsummary:\n[reference generation] ...' }],
        };
        const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'H3-批量任务模板.json';
        a.click();
        URL.revokeObjectURL(a.href);
        return;
      }
      if (act === 'batch-spec') {
        const spec = `请把下面的分镜/素材清单整理成 ZEALMAN-H3 批量任务 JSON（format=zealman-h3-batch, version=1）：
- tasks[].prompt 必须是六段式：subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music
- images 每项写 {path, subject}，path 用绝对路径或相对素材库的路径；第 n 张对应 <Picture n>
- audios 写本地音频路径，第 n 段对应 <Audio n>
- 可选字段：aspectRatio（9:16 / 16:9 / 1:1）、duration（1–15 秒）、repeat
- 不要写 workflow/api 字段，导入后统一选择。`;
        await navigator.clipboard.writeText(spec);
        toast('已复制 AI 说明');
        return;
      }
      if (act === 'batch-parse') {
        const text = ($('#batch-json') && $('#batch-json').value) || '';
        if (!text.trim()) return toast('先粘贴或导入 JSON', true);
        state.batch = state.batch || {};
        state.batch.text = text;
        state.batch.workflowId = ($('#batch-workflow') && $('#batch-workflow').value) || state.studio.workflowId;
        const result = await api('/api/batch/parse', { method: 'POST', body: { json: text, fileDir: state.batch.fileDir || null, name: state.batch.fileName } });
        state.batch.result = result;
        render();
        toast(result.errors.length ? `解析完成，${result.errors.length} 个问题` : '解析完成，全部通过', result.errors.length > 0);
        return;
      }
      if (act === 'batch-add') {
        const text = ($('#batch-json') && $('#batch-json').value) || '';
        const workflowId = ($('#batch-workflow') && $('#batch-workflow').value) || state.studio.workflowId;
        const res = await api('/api/batch/add', { method: 'POST', body: { json: text, workflowId, name: state.batch.fileName } });
        state.jobs = (await api('/api/jobs')).jobs;
        toast(`已加入队列 ${res.count} 条`);
        location.hash = '#jobs';
      }
    } catch (err) { toast(err.message, true); }
  });
}

/* ------------------------------------------------------------------ logs */

function logsPanel(tab) {
  const jobsWithLogs = (state.route==='tasks'?(state.taskVideoLogs||[]):state.jobs).slice().sort((a,b) => (Number(b.createdAt)||0) - (Number(a.createdAt)||0));
  return `<section id="generation-log-panel" role="tabpanel" aria-labelledby="${state.route === 'tasks' ? 'task-tab-logs' : (tab==='video'?'video':'image') + '-log-tab'}">
  ${tab==='image'?IJ.table(true,state.route==='tasks'?state.taskImageLogs:undefined):IJ.logTable(jobsWithLogs.map(job=>({id:job.id,createdAt:job.createdAt,title:job.title,statusHtml:jobStatusBadge(job)+'<div class="hint">'+esc(job.stage||'')+'</div>',error:job.error,actions:'<button class="btn sm" data-act="detail" data-id="'+job.id+'">查看日志</button>'})))}
  </section>`;
}

function renderLogs() {
  const tab=state.logTab||localStorage.getItem('h3.logs.tab')||'video';
  return `
  <div class="page-head"><div><h1>任务日志</h1><p>每条任务从提交、轮询到下载的全过程都会记录在这里。</p></div>
    <div class="page-actions"><button class="btn" data-act="go-studio">去创作台</button></div></div>
  <div class="generation-log-tabs" role="tablist" aria-label="生成日志类型">
    <button type="button" role="tab" id="video-log-tab" aria-controls="generation-log-panel" aria-selected="${tab==='video'}" data-log-tab="video" class="${tab==='video'?'is-active':''}">视频生成日志</button>
    <button type="button" role="tab" id="image-log-tab" aria-controls="generation-log-panel" aria-selected="${tab==='image'}" data-log-tab="image" class="${tab==='image'?'is-active':''}">图像生成日志</button>
  </div>
  ${logsPanel(tab)}
  `;
}

function bindLogs(root) {
  root.addEventListener('keydown', event=>{const tab=event.target.closest('[data-log-tab]');if(!tab||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const next=tab.dataset.logTab==='video'?'image':'video';state.logTab=next;localStorage.setItem('h3.logs.tab',next);render();document.querySelector('[data-log-tab="'+next+'"]').focus();});
  root.addEventListener('click', (event) => {
    const tab=event.target.closest('[data-log-tab]');
    if(tab){state.logTab=tab.dataset.logTab;localStorage.setItem('h3.logs.tab',state.logTab);render();return;}
    const target = event.target.closest('[data-act]');
    if (!target) return;
    if (target.dataset.act === 'go-studio') { location.hash = '#studio'; return; }
    if (target.dataset.act === 'detail') openJobDetail(target.dataset.id);
  });
}

/* ------------------------------------------------------------------ 任务管理（合并入口） */

const TASK_TABS = [['create','创建任务'],['manage','任务管理'],['schedule','任务调度'],['monitor','任务监控'],['logs','日志']];
function taskMedia(){return state.taskMedia||localStorage.getItem('h3.tasks.media')||'video';}
function currentTaskTab(){const value=state.taskTab||localStorage.getItem('h3.tasks.tab')||'create';return TASK_TABS.some(([id])=>id===value)?value:'create';}
function taskPagination(rows,key,meta){
  const size=10,total=meta?.total??rows.length,pages=Math.max(1,Math.ceil(total/size));
  state.taskPages=state.taskPages||{};
  const page=Math.max(1,Math.min(pages,Number(meta?.page??state.taskPages[key])||1));state.taskPages[key]=page;
  const start=(page-1)*size;
  const button=(label,target,disabled)=>`<button type="button" class="btn sm" data-task-page="${target}" data-page-key="${esc(key)}" ${disabled?'disabled':''}>${label}</button>`;
  return {rows:meta?rows:rows.slice(start,start+size),footer:`<nav class="task-pagination" aria-label="列表分页"><span>共 ${total} 条 · 每页10条</span><div>${button('首页',1,page===1)}${button('上一页',page-1,page===1)}<span class="task-page-number" aria-live="polite">${page} / ${pages}</span>${button('下一页',page+1,page===pages)}${button('末页',pages,page===pages)}</div></nav>`};
}
function renderTasks(){
  const tab=currentTaskTab(),media=taskMedia();
  const title=(TASK_TABS.find(([id])=>id===tab)||[null,'任务管理'])[1];
  const body=tab==='create'?Events.renderCreate()
    : tab==='schedule'?Events.renderSchedule()
    : tab==='monitor'?Events.renderMonitor()
    : tab==='logs'?Events.renderLogs()
    : Events.render('manage');
  const tabActions=`<div class="task-tabbar-actions">${tab==='monitor'?'<button type="button" class="btn sm" data-event-range="7">近 7 天报告</button>':''}${tab==='create'?'':'<button type="button" class="btn sm ghost" data-task-refresh="1">刷新</button>'}</div>`;
  return `<header class="task-header"><div><h1>${title}</h1></div><div class="task-media-switch" role="group" aria-label="媒体类型"><button class="btn ${media==='video'?'primary':''}" data-task-media="video" aria-pressed="${media==='video'}">视频</button><button class="btn ${media==='image'?'primary':''}" data-task-media="image" aria-pressed="${media==='image'}">图像</button></div></header><section class="task-workspace"><div class="task-tabbar"><div class="task-tabs" role="tablist" aria-label="任务生命周期">${TASK_TABS.map(([id,label])=>`<button type="button" role="tab" id="task-tab-${id}" aria-controls="task-panel" data-task-tab="${id}" aria-selected="${tab===id}">${label}</button>`).join('')}</div>${tabActions}</div><div class="task-panel" id="task-panel" role="tabpanel" aria-labelledby="task-tab-${tab}">${body}</div></section>`;
}

async function loadTaskLogs(force=false){
  const media=taskMedia(),page=(state.taskPages||{})[media]||1,key=media+':'+page;
  if(!force&&state.taskLogKey===key)return;
  state.taskLogKey=key;
  try{const data=await api((media==='video'?'/api/jobs':'/api/images/tasks')+'?page='+page);if(key!==state.taskLogKey)return;state.taskLogPaging={total:data.total,page:data.page,pageSize:10};if(media==='video')state.taskVideoLogs=data.jobs||[];else state.taskImageLogs=data.tasks||[];if(state.route==='tasks'&&currentTaskTab()==='logs')render();}catch(err){state.taskLogKey=null;toast(err.message,true);}
}
function bindTasks(root){
  root.addEventListener('click',async event=>{
    const media=event.target.closest('[data-task-media]');
    if(media){state.taskMedia=media.dataset.taskMedia;localStorage.setItem('h3.tasks.media',state.taskMedia);state.taskEventStatus='';state.taskEventQuery='';state.taskPages={};state.taskLogPaging=null;state.taskVideoLogs=[];state.taskImageLogs=[];state.events=[];state.eventPaging=null;await Events.load();render();return;}
    const page=event.target.closest('[data-task-page]');
    if(page&&!page.disabled){state.taskPages={...(state.taskPages||{}),[page.dataset.pageKey]:Number(page.dataset.taskPage)};if(page.dataset.pageKey==='events')await Events.load();else if(currentTaskTab()==='logs')await loadTaskLogs(true);render();return;}
    const refresh=event.target.closest('[data-task-refresh]');
    if(refresh){
      if(currentTaskTab()==='create'){try{state.assets=await api('/api/assets');}catch{/* 刷新素材失败时保持原列表 */}render();}
      else {await Events.load();render();}
      return;
    }
    const button=event.target.closest('[data-task-tab]');
    if(button){state.taskEventStatus='';state.taskPages={...(state.taskPages||{}),events:1};state.taskTab=button.dataset.taskTab;localStorage.setItem('h3.tasks.tab',state.taskTab);await Events.load();render();return;}
  });
  Events.bind(root);
}

/* ------------------------------------------------------------------ settings */

﻿function channelTypeMeta(kind, type) {
  const list = state.channelTypes[kind] || [];
  return list.find((t) => t.id === type) || list[0] || null;
}

function channelTypeLabel(kind, type) {
  const meta = channelTypeMeta(kind, type);
  return meta ? meta.label : type;
}

function channelRows(kind) {
  const list = state.channels[kind] || [];
  if (!list.length) return `<div class="hint">还没有渠道。</div>`;
  return list.map((ch) => `
    <div class="host-row ${ch.enabled === false ? 'is-off' : ''}">
      <span class="dot ${ch.lastTestOk === true ? 'ok' : ch.lastTestOk === false ? 'bad' : ''}"></span>
      <div style="flex:1;min-width:0">
        <div>${esc(ch.name)} ${ch.active && ch.enabled !== false ? '<span class="badge ok">默认</span>' : ''} ${ch.enabled === false ? '<span class="badge">已停用</span>' : ''}</div>
        <div class="url">${esc(ch.baseUrl)}${ch.model ? ' · ' + esc(ch.model) : ''} · ${esc(channelTypeLabel(kind, ch.type))}</div>
        ${ch.maxTokens || ch.contextWindow ? `<div class="hint">输出 ≤ ${ch.maxTokens || '默认'} tokens · 上下文 ${ch.contextWindow || '默认'} tokens</div>` : ''}
        ${ch.lastTestMessage ? `<div class="hint">${esc(ch.lastTestMessage)}</div>` : ''}
        <div class="hint">Key：${ch.apiKey ? `<code class="key-plain">${esc(ch.apiKey)}</code>` : '<span class="is-danger">未填写</span>'}</div>
      </div>
      <button type="button" class="btn sm" data-test-channel="${esc(ch.id)}" data-kind="${kind}">测试</button>
      ${ch.active && ch.enabled !== false ? '' : `<button type="button" class="btn sm" data-activate-channel="${esc(ch.id)}" data-kind="${kind}">设为默认</button>`}
      <button type="button" class="btn sm ghost" data-toggle-channel="${esc(ch.id)}" data-kind="${kind}" data-enabled="${ch.enabled === false ? '1' : '0'}">${ch.enabled === false ? '启用' : '停用'}</button>
      <button type="button" class="btn sm ghost" data-edit-channel="${esc(ch.id)}" data-kind="${kind}">编辑</button>
      <button type="button" class="btn sm ghost" data-del-channel="${esc(ch.id)}" data-kind="${kind}">删除</button>
    </div>`).join('');
}

const CHANNEL_KIND_META = {
  llm: {
    title: '文本推理',
    desc: '剧本创作台、Skill 优化、提示词改写都用这里「默认」的渠道；创作台里还能临时切到别的渠道。',
  },
  image: {
    title: '图片生成',
    desc: 'OpenAI Images（含参考图编辑）、Gemini 生图、Chat Completions 生图；图像创作台默认用「默认」渠道，也能临时切换。',
  },
  video: {
    title: '视频生成',
    desc: '视频渠道就是管理器里的豆包 / Gemini 账号池，也可以接自定义视频接口；视频创作台默认用「默认」渠道。',
  },
};

function keyRowsHtml(keys) {
  return keys.map((k, i) => `<div class="key-row">
    <span class="dot ${k.lastVerifyOk === true ? 'ok' : k.lastVerifyOk === false ? 'bad' : ''}"></span>
    <div style="flex:1;min-width:0">
      <div>${esc(k.name)} ${k.enabled === false ? '<span class="badge">停用</span>' : ''}</div>
      <div class="url">${esc(k.masked || k.token || '')}</div>
      ${k.lastVerifyMessage ? `<div class="hint">${esc(k.lastVerifyMessage)}</div>` : ''}
    </div>
    <button type="button" class="btn sm" data-verify="${i}">验证</button>
    <button type="button" class="btn sm ghost" data-remove-key="${i}">移除</button>
  </div>`).join('') || '<div class="hint">还没有 Key。官网 API 需要至少一个 Key 才能在视频创作台出任务。</div>';
}

function appearancePane() {
  const active = currentTheme();
  const ui = state.config.ui || {};
  const tab = state.wallpaperTab || 'static';
  const themes = themeCatalog();
  const visible = themes.filter((t) => t.day && (tab === 'mine' ? t.custom : tab === 'dynamic' ? t.animated : !t.animated));
  const card = (t) => `<div class="wallpaper-card-wrap"><button type="button" class="theme-card ${t.id === active ? 'is-on' : ''}" data-theme-pick="${esc(t.id)}" aria-pressed="${t.id === active}" title="${esc(t.hint || '')}">
    <span class="theme-card-preview ${t.wallpaper ? 'is-scenic' : ''}" style="--sw-1:${t.sw[0]};--sw-2:${t.sw[1]};${t.poster || (t.wallpaper && t.kind !== 'video') ? 'background-image:url(&quot;' + esc(t.poster || t.wallpaper) + '&quot;)' : ''}">
      ${t.kind === 'video' && !t.poster ? '<span class="wallpaper-video-mark">▶ VIDEO</span>' : ''}
      <i class="tc-bar"></i><i class="tc-side"></i><i class="tc-line"></i><i class="tc-accent"></i>
      <span class="wallpaper-kind">${t.kind === 'video' ? '视频' : t.kind === 'gif' ? 'GIF' : t.kind === 'animated-image' ? '动态图片' : t.motion ? '场景动画' : t.animated ? '动态' : '静态'}</span>
    </span><span class="theme-card-name">${esc(t.label)}</span><span class="theme-card-hint">${esc(t.hint || '')}</span>
    <span class="theme-card-tag">${t.day ? '白昼' : t.dark ? '深色' : '亮色'}${t.id === active ? ' · 使用中' : ''}</span>
    </button>${t.custom ? `<button type="button" class="wallpaper-remove" data-wallpaper-remove="${esc(t.id)}" aria-label="从壁纸库移除 ${esc(t.label)}" title="只移出壁纸库，保留本机原文件">×</button>` : ''}</div>`;
  return `<div class="settings-block"><h3>智能体 · 字体与排版</h3><div class="field"><label for="agent-welcome-text">中文欢迎语</label><input class="input" id="agent-welcome-text" maxlength="40" value="${esc(agentWelcomeText(ui))}" placeholder="让故事成形，让想象入镜。" /><small class="hint">最多 40 字，保持单行显示。修改后移开焦点自动保存，留空恢复默认。</small></div><p class="hint">即时预览并自动保存。正文设置应用于对话、输入框和文字预览；欢迎标题单独调节。字体使用本机已安装字体。</p><div class="field"><label for="agent-font">字体风格</label><select id="agent-font" class="input">${Object.entries(AGENT_FONTS).map(([id, font]) => `<option value="${id}" ${(ui.agentFont || 'system') === id ? 'selected' : ''}>${font.label}</option>`).join('')}</select></div><div class="field"><label for="agent-weight">字重</label><select id="agent-weight" class="input">${[[400, '常规'], [500, '适中'], [600, '加粗']].map(([value, label]) => `<option value="${value}" ${Number(ui.agentFontWeight || 400) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>${[['agent-size', '正文字号', 'agentFontSize', 12, 24, 1, 15, 'px'], ['agent-leading', '正文行距', 'agentLineHeight', 1.3, 2.4, .1, 1.8, ''], ['agent-title-size', '欢迎标题字号', 'agentTitleSize', 24, 64, 1, 44, 'px']].map(([id, label, key, min, max, step, fallback, unit]) => `<label class="wallpaper-dim" for="${id}"><span>${label}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${ui[key] ?? fallback}" /><output id="${id}-value">${ui[key] ?? fallback}${unit}</output></label>`).join('')}<div class="agent-type-preview"><span id="agent-welcome-preview">${esc(agentWelcomeText(ui))}</span><br>每一个灵感，都值得成为一部作品。</div><button type="button" class="btn ghost" id="agent-type-reset">恢复默认排版</button></div>
    <div class="settings-block">
      <h3>白昼主题 · 动漫与真人</h3>
      <p class="hint">清晰的浅色界面，让创作轻一点。静态图片、场景动画与视频分开选；自己的收藏可以一直添加。</p>
      <div class="wallpaper-tabs" role="tablist" aria-label="壁纸分类">${[['static', '静态图片'], ['dynamic', '动态壁纸'], ['mine', '我的收藏']].map(([id, name]) => `<button type="button" role="tab" aria-selected="${tab === id}" data-wallpaper-tab="${id}" class="${tab === id ? 'is-on' : ''}">${name}</button>`).join('')}</div>
      <div class="theme-grid">${visible.map(card).join('') || '<div class="wallpaper-empty">还没有收藏，添加喜欢的动漫图片或视频吧。</div>'}</div>
      <div class="wallpaper-settings">
        <div class="field"><label for="wallpaper-name">新主题名称（可选）</label><input class="input" id="wallpaper-name" maxlength="60" placeholder="例如：我的窗边午后；留空使用文件名" /></div>
        <div class="row"><button type="button" class="btn primary" id="wallpaper-upload">＋ 导入素材并新建主题</button><button type="button" class="btn ghost" id="wallpaper-toggle" ${themes.find((t) => t.id === active)?.animated ? '' : 'disabled'}>${themes.find((t) => t.id === active)?.animated ? wallpaperIsPaused() ? '播放动态壁纸' : '暂停动态壁纸' : '当前为静态壁纸'}</button></div>
        <p class="hint" id="wallpaper-import-status">可多选。图片 / GIF ≤ 10MB，MP4 / WebM ≤ 600MB。仅保存在本机，可在下方开启视频原声。</p>
        <input type="file" id="wallpaper-file" accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm" multiple hidden />
<div class="settings-block"><h3>声音与背景音乐</h3>
<label><input type="checkbox" id="wallpaper-sound" ${ui.wallpaperSound ? 'checked' : ''} /> 开启视频原声</label>
<label class="wallpaper-dim" for="wallpaper-volume">视频原声音量<input id="wallpaper-volume" type="range" min="0" max="100" value="${ui.wallpaperVolume ?? 40}" /></label>
<p class="hint">背景音乐：${esc(ui.musicName || '窗边轻琴 · 内置配乐')}。没有音轨的视频开启原声后仍无声。</p>
<div class="row"><button class="btn primary" id="music-toggle" type="button">${ui.musicPlaying ? '暂停背景音乐' : '播放背景音乐'}</button><button class="btn ghost" id="music-import" type="button">导入音乐</button><button class="btn ghost" id="music-default" type="button">使用内置配乐</button></div>
<input type="file" id="music-file" accept=".mp3,.wav,.m4a,.ogg,.flac" hidden />
<label class="wallpaper-dim" for="music-volume">背景音乐音量<input id="music-volume" type="range" min="0" max="100" value="${ui.musicVolume ?? 30}" /></label><p class="hint">音乐循环播放，支持 MP3、WAV、M4A、OGG、FLAC，最大 60MB。顶部总静音同时控制原声和配乐。</p></div>
        <label class="wallpaper-dim" for="wallpaper-dim"><span>对话区柔和度</span><input id="wallpaper-dim" type="range" min="0" max="80" value="${Math.round(Number(ui.wallpaperDim ?? .2) * 100)}" /><output id="wallpaper-dim-value">${Math.round(Number(ui.wallpaperDim ?? .2) * 100)}%</output></label>
        <label class="wallpaper-dim" for="wallpaper-sidebar-dim"><span>左侧记录栏柔和度</span><input id="wallpaper-sidebar-dim" type="range" min="0" max="95" value="${Math.round(Number(ui.wallpaperSidebarDim ?? .15) * 100)}" /><output id="wallpaper-sidebar-dim-value">${Math.round(Number(ui.wallpaperSidebarDim ?? .15) * 100)}%</output></label>
        <label class="wallpaper-dim" for="wallpaper-preview-alpha"><span>右侧预览框背景透明度</span><input id="wallpaper-preview-alpha" type="range" min="0" max="100" value="${Number(ui.wallpaperPreviewTransparency ?? 85)}" /><output id="wallpaper-preview-alpha-value">${Number(ui.wallpaperPreviewTransparency ?? 85)}%</output></label>
        <label class="wallpaper-dim" for="wallpaper-workspace-alpha"><span>右侧工作区背景透明度</span><input id="wallpaper-workspace-alpha" type="range" min="0" max="100" value="${Number(ui.wallpaperWorkspaceTransparency ?? 85)}" /><output id="wallpaper-workspace-alpha-value">${Number(ui.wallpaperWorkspaceTransparency ?? 85)}%</output></label>
        <div class="wallpaper-rotation"><label><input type="checkbox" id="wallpaper-rotate" ${ui.wallpaperRotate ? 'checked' : ''} /> 自动轮换</label><select class="input" id="wallpaper-rotation-kind" aria-label="轮换类型">${[['static', '只换静态'], ['dynamic', '只换动态'], ['all', '静态与动态']].map(([value, label]) => `<option value="${value}" ${value === (ui.wallpaperRotationKind || 'static') ? 'selected' : ''}>${label}</option>`).join('')}</select><select class="input" id="wallpaper-interval" aria-label="轮换间隔">${[[60, '每 1 分钟'], [300, '每 5 分钟'], [900, '每 15 分钟']].map(([value, label]) => `<option value="${value}" ${value === (ui.wallpaperInterval || 300) ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      </div>
      <details class="wallpaper-legacy"><summary>清爽纯色主题</summary><div class="theme-grid">${themes.filter((t) => !t.day).map(card).join('')}</div></details>
    </div>`;
}

function channelPane(kind) {
  const d = state.settingsDraft;
  const meta = CHANNEL_KIND_META[kind];
  return `
    <div class="settings-block">
      <div class="settings-block-head"><h3>${meta.title}渠道</h3></div>
      <p class="hint">${meta.desc}</p>
      ${channelRows(kind)}
      <div class="row"><button type="button" class="btn" data-add-channel="${kind}">＋ 新增${meta.title}渠道</button></div>
    </div>`;
}

function openSettings(tab = 'text') {
  const alias = { channels: 'text', keys: 'video' };
  state.settingsTab = alias[tab] || tab;
  state.settingsDraft = {
    autodlKeys: JSON.parse(JSON.stringify(state.config.autodlKeys || [])),
    projectRoot: state.config.projectRoot || '',
    saveFolder: state.config.saveFolder,
    assetFolder: state.config.assetFolder,
    concurrency: state.config.concurrency,
    voiceLibraryFolder: state.config.voiceLibraryFolder || '',
  };
  renderSettings();
}

function renderSettings() {
  const d = state.settingsDraft;
  const tab = state.settingsTab;
  const tabs = [
    ['text', '文本推理'],
    ['image', '图片生成'],
    ['video', '视频生成'],
    ['appearance', '外观'],
    ['storage', '存储目录'],
    ['about', '关于'],
  ];
  const kindOf = { text: 'llm', image: 'image', video: 'video' };
  let pane = '';
  if (kindOf[tab]) {
    pane = channelPane(kindOf[tab]);
  } else if (tab === 'appearance') {
    pane = appearancePane();
  } else if (tab === 'storage') {
    pane = `
      <div class="settings-block">
        <h3>存储目录</h3>
        <div class="field"><label>项目根目录</label><input class="input mono" id="project-root" value="${esc(d.projectRoot || '')}" /></div>
        <p class="hint">每个项目会在这里自动生成独立子目录：<span class="mono">assets/ media/ uploads/ exports/</span>。项目激活时，素材、成片、上传都只读写该项目目录。修改根目录不会搬动已存在的项目文件。</p>
        <div class="workspace-migrate">
          <button type="button" class="btn" id="workspace-migrate">把旧数据迁入当前项目</button>
          <span class="hint">旧版散落的 <span class="mono">data/assets、uploads、media</span> 不会自动搬动。点击后会先备份到 <span class="mono">data/backups</span>，再迁入当前项目。</span>
        </div>
        <div class="field"><label>未归档成片目录（旧数据）</label><input class="input mono" id="save-folder" value="${esc(d.saveFolder)}" /></div>
        <div class="field"><label>未归档素材目录（旧数据）</label><input class="input mono" id="asset-folder" value="${esc(d.assetFolder)}" /></div>
        <div class="field"><label>克隆参考音色库（800+ 音色目录）</label><input class="input mono" id="voice-folder" value="${esc(d.voiceLibraryFolder || '')}" placeholder="D:\\notebook\\AIGC\\Comic-drama\\资产文档\\800+音色" /></div>
        <div class="field" style="width:200px"><label>并发上限</label><input class="input" id="concurrency" type="number" min="1" max="8" value="${d.concurrency}" /></div>
        <p class="hint">每个 Key / 每个自定义视频渠道各占 1 个工位；并发上限控制同时执行的任务总数。</p>
        <p class="hint">音色库目录留空时，会自动用 <span class="mono">D:\\notebook\\AIGC\\Comic-drama\\资产文档\\800+音色</span>（如果存在）。</p>
      </div>`;
  } else {
    pane = `
      <div class="settings-block">
        <h3>关于</h3>
        <div class="kv"><span>版本</span><span>H3 Studio 0.3.0（源码重建版）</span></div>
        <div class="kv"><span>数据目录</span><span class="mono">${esc(state.config.dataDir || '')}</span></div>
        <div class="kv"><span>原版</span><span>ZEALMAN-H3 桌面版 2026.10.23（Tauri）</span></div>
        <p class="hint">本工具与原版无授权关系，仅按现有 API 协议与提示词规则重建，便于修改和二次开发。</p>
      </div>`;
  }
  openModal(`
    <div class="modal-head"><h2>设置</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="settings-grid">
        <div class="settings-nav">${tabs.map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}</div>
        <div class="settings-pane" id="settings-pane">${pane}</div>
      </div>
    </div>
    <div class="modal-foot"><span class="hint grow">设置保存在本机 data/config.json</span><button class="btn" data-close="1">关闭</button><button class="btn primary" id="settings-save">保存</button></div>
  `);
  $('#modal-panel').classList.add('modal-settings');
  bindSettings();
}

function bindSettings() {
  const d = state.settingsDraft;
  $$('#modal-panel [data-tab]').forEach((btn) => {
    btn.onclick = () => { state.settingsTab = btn.dataset.tab; renderSettings(); };
  });

  const keyAdd = $('#key-add');
  if (keyAdd) keyAdd.onclick = () => {
    const token = $('#key-token').value.trim();
    if (!token) return toast('粘贴 Token', true);
    d.autodlKeys.push({ id: 'key-' + Date.now().toString(36), name: 'Key ' + (d.autodlKeys.length + 1), token, enabled: true, masked: token.slice(0, 4) + '…' + token.slice(-4) });
    renderSettings();
  };
  $$('#modal-panel [data-remove-key]').forEach((btn) => {
    btn.onclick = () => { d.autodlKeys.splice(Number(btn.dataset.removeKey), 1); renderSettings(); };
  });
  $$('#modal-panel [data-verify]').forEach((btn) => {
    btn.onclick = async () => {
      const key = d.autodlKeys[Number(btn.dataset.verify)];
      const dot = btn.parentElement.querySelector('.dot');
      try {
        const res = await api('/api/autodl/verify', { method: 'POST', body: { token: key.token } });
        if (dot) dot.className = 'dot ' + (res.ok ? 'ok' : 'bad');
        const hint = btn.parentElement.querySelector('.hint') || document.createElement('div');
        hint.className = 'hint';
        hint.textContent = res.message;
        if (!hint.parentElement) btn.parentElement.querySelector('div').appendChild(hint);
        toast(res.message, !res.ok);
      } catch (err) { toast(err.message, true); }
    };
  });

  $$('#modal-panel [data-theme-pick]').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await setTheme(btn.dataset.themePick);
        renderSettings();
        toast('主题已切换');
      } catch (err) { toast(err.message, true); }
    };
  });

  if ($('#music-toggle')) {
    const saveSound = async (patch) => { try { await saveAppearance(patch); renderSettings(); } catch (err) { toast(err.message, true); } };
    $('#music-toggle').onclick = () => saveSound({ musicPlaying: !state.config.ui.musicPlaying });
    $('#wallpaper-sound').onchange = (event) => saveSound({ wallpaperSound: event.target.checked });
    for (const [id, key] of [['wallpaper-volume', 'wallpaperVolume'], ['music-volume', 'musicVolume']]) {
      $('#' + id).oninput = (event) => { state.config.ui[key] = Number(event.target.value); syncBackgroundAudio(); const video = $('.skin-wallpaper-video'); if (video) video.volume = Number(state.config.ui.wallpaperVolume ?? 40) / 100; };
      $('#' + id).onchange = (event) => saveSound({ [key]: Number(event.target.value) });
    }
    $('#music-default').onclick = () => saveSound({ musicPath: '', musicName: '', musicPlaying: true });
    $('#music-import').onclick = () => $('#music-file').click();
    $('#music-file').onchange = async (event) => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (!/\.(mp3|wav|m4a|ogg|flac)$/i.test(file.name)) throw new Error('请选择支持的音频格式');
        if (file.size > 60 * 1024 * 1024) throw new Error('音乐文件不能超过 60MB');
        $('#music-import').disabled = true;
        const saved = await uploadFile(file, 'audio');
        await saveSound({ musicPath: saved.path, musicName: file.name, musicPlaying: true });
      } catch (err) { toast(err.message, true); if ($('#music-import')) $('#music-import').disabled = false; }
    };
  }
  if ($('#agent-welcome-text')) {
    const input = $('#agent-welcome-text');
    input.oninput = () => { const preview = $('#agent-welcome-preview'); if (preview) preview.textContent = agentWelcomeText({ agentWelcomeText: input.value }); };
    input.onchange = async () => {
      try { await saveAppearance({ agentWelcomeText: agentWelcomeText({ agentWelcomeText: input.value }) }); input.value = agentWelcomeText(state.config.ui); }
      catch (err) { toast('欢迎语保存失败：' + err.message, true); }
    };
  }
  if ($('#agent-font')) {
    for (const [id, key] of [['agent-font', 'agentFont'], ['agent-weight', 'agentFontWeight'], ['agent-size', 'agentFontSize'], ['agent-leading', 'agentLineHeight'], ['agent-title-size', 'agentTitleSize']]) {
      const control = $('#' + id);
      control.oninput = () => {
        applyAgentTypography({ ...state.config.ui, [key]: id === 'agent-font' ? control.value : Number(control.value) });
        const output = $('#' + id + '-value'); if (output) output.textContent = control.value + (id === 'agent-leading' ? '' : 'px');
      };
      control.onchange = async () => {
        try { await saveAppearance({ [key]: id === 'agent-font' ? control.value : Number(control.value) }); }
        catch (err) { toast('排版保存失败：' + err.message, true); }
      };
    }
    $('#agent-type-reset').onclick = async () => {
      try { await saveAppearance({ agentFont: 'system', agentFontSize: 15, agentLineHeight: 1.8, agentFontWeight: 400, agentTitleSize: 44 }); renderSettings(); }
      catch (err) { toast(err.message, true); }
    };
  }
  const wallpaperFile = $('#wallpaper-file');
  if (wallpaperFile) {
    $$('#modal-panel [data-wallpaper-tab]').forEach((button) => { button.onclick = () => { state.wallpaperTab = button.dataset.wallpaperTab; renderSettings(); }; });
    $$('#modal-panel [data-wallpaper-remove]').forEach((button) => { button.onclick = async () => {
      try {
        const id = button.dataset.wallpaperRemove;
        await saveAppearance({ wallpapers: (state.config.ui.wallpapers || []).filter((p) => p.id !== id), ...(currentTheme() === id ? { theme: 'day-sea' } : {}) });
        renderSettings();
      } catch (err) { toast(err.message, true); }
    }; });
    $('#wallpaper-upload').onclick = () => wallpaperFile.click();
    wallpaperFile.onchange = async () => {
      const files = Array.from(wallpaperFile.files);
      if (!files.length) return;
      const themeName = $('#wallpaper-name').value.trim();
      const button = $('#wallpaper-upload');
      button.disabled = true;
      let imported = 0;
      try {
        for (const file of files) {
          try {
            const kind = await WallpaperLibrary.inspect(file);
            const limit = kind === 'video' ? 600 : 10;
            if (file.size > limit * 1024 * 1024) throw new Error(file.name + ' 超过 ' + limit + 'MB');
            $('#wallpaper-import-status').textContent = `正在添加 ${imported + 1} / ${files.length}：${file.name}`;
            const saved = await uploadFile(file, kind);
            const label = themeName ? themeName + (files.length > 1 ? ' · ' + (imported + 1) : '') : file.name.replace(/\.[^.]+$/, '');
            const item = { id: 'user-wp-' + askId(), label, path: saved.path, kind, createdAt: Date.now() };
            await saveAppearance({ wallpapers: [...(state.config.ui.wallpapers || []), item], theme: item.id });
            imported++;
          } catch (err) { toast(err.message, true); }
        }
        state.wallpaperTab = 'mine'; renderSettings();
        if (imported) toast('已添加 ' + imported + ' 张 / 段壁纸');
      } finally { button.disabled = false; }
    };
    $('#wallpaper-toggle').onclick = async () => {
      try { await saveAppearance({ wallpaperPaused: !wallpaperIsPaused() }); renderSettings(); }
      catch (err) { toast(err.message, true); }
    };
    const dim = $('#wallpaper-dim');
    dim.oninput = () => {
      document.documentElement.style.setProperty('--skin-dim', String(Number(dim.value) / 100));
      $('#wallpaper-dim-value').textContent = dim.value + '%';
    };
    dim.onchange = async () => {
      try { await saveAppearance({ wallpaperDim: Number(dim.value) / 100 }); }
      catch (err) { toast(err.message, true); }
    };
    const sidebarDim = $('#wallpaper-sidebar-dim');
    sidebarDim.oninput = () => {
      document.documentElement.style.setProperty('--skin-sidebar-dim', String(Number(sidebarDim.value) / 100));
      $('#wallpaper-sidebar-dim-value').textContent = sidebarDim.value + '%';
    };
    sidebarDim.onchange = async () => {
      try { await saveAppearance({ wallpaperSidebarDim: Number(sidebarDim.value) / 100 }); }
      catch (err) { toast(err.message, true); }
    };
    const saveRotation = async () => {
      try { await saveAppearance({ wallpaperRotate: $('#wallpaper-rotate').checked, wallpaperRotationKind: $('#wallpaper-rotation-kind').value, wallpaperInterval: Number($('#wallpaper-interval').value) }); }
      catch (err) { toast(err.message, true); }
    };
    for (const [id, key, variable] of [
      ['wallpaper-preview-alpha', 'wallpaperPreviewTransparency', '--skin-preview-alpha'],
      ['wallpaper-workspace-alpha', 'wallpaperWorkspaceTransparency', '--skin-workspace-alpha'],
    ]) {
      const slider = $('#' + id);
      slider.oninput = () => {
        document.documentElement.style.setProperty(variable, String(1 - Number(slider.value) / 100));
        $('#' + id + '-value').textContent = slider.value + '%';
      };
      slider.onchange = async () => {
        try { await saveAppearance({ [key]: Number(slider.value) }); }
        catch (err) { toast(err.message, true); }
      };
    }
    ['wallpaper-rotate', 'wallpaper-rotation-kind', 'wallpaper-interval'].forEach((id) => { $('#' + id).onchange = saveRotation; });
  }

  // Channel buttons
  $$('#modal-panel [data-add-channel]').forEach((btn) => {
    btn.onclick = () => openChannelDialog(btn.dataset.addChannel, null, { returnToSettings: true });
  });
  $$('#modal-panel [data-edit-channel]').forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.dataset.kind;
      const ch = (state.channels[kind] || []).find((c) => c.id === btn.dataset.editChannel);
      if (ch) openChannelDialog(kind, ch, { returnToSettings: true });
    };
  });
  $$('#modal-panel [data-del-channel]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('删除这个渠道？')) return;
      await api(`/api/channels/${btn.dataset.delChannel}?kind=${btn.dataset.kind}`, { method: 'DELETE' }).catch((e) => toast(e.message, true));
      await refreshState();
      state.image.channelId = '';
      renderSettings();
      toast('已删除');
    };
  });
  $$('#modal-panel [data-activate-channel]').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/channels/${btn.dataset.activateChannel}/activate`, { method: 'POST', body: { kind: btn.dataset.kind } }).catch((e) => toast(e.message, true));
      await refreshState();
      renderSettings();
      toast('已设为默认渠道');
    };
  });
  $$('#modal-panel [data-toggle-channel]').forEach((btn) => {
    btn.onclick = async () => {
      const enable = btn.dataset.enabled === '1';
      await api(`/api/channels/${btn.dataset.toggleChannel}`, { method: 'PUT', body: { kind: btn.dataset.kind, enabled: enable } }).catch((e) => toast(e.message, true));
      await refreshState();
      renderSettings();
      toast(enable ? '已启用渠道' : '已停用渠道');
    };
  });
  const autodlDefault = $('#modal-panel [data-autodl-default]');
  if (autodlDefault) {
    autodlDefault.onclick = async () => {
      const activeOnes = (state.channels.video || []).filter((c) => c.active);
      for (const ch of activeOnes) {
        await api(`/api/channels/${ch.id}`, { method: 'PUT', body: { kind: 'video', active: false } }).catch(() => {});
      }
      await refreshState();
      renderSettings();
      toast('官网 API 已设为视频默认渠道');
    };
  }
  $$('#modal-panel [data-test-channel]').forEach((btn) => {
    btn.onclick = async () => {
      const kind = btn.dataset.kind;
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = '测试中…';
      try {
        const res = await api(`/api/channels/${btn.dataset.testChannel}/test`, { method: 'POST', body: { kind } });
        toast(res.message, !res.ok);
        await refreshState();
        renderSettings();
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    };
  });

  const save = $('#settings-save');
  if (save) save.onclick = async () => {
    try {
      const payload = {
        autodlKeys: d.autodlKeys,
        projectRoot: $('#project-root') ? $('#project-root').value.trim() : d.projectRoot,
        saveFolder: $('#save-folder') ? $('#save-folder').value.trim() : d.saveFolder,
        assetFolder: $('#asset-folder') ? $('#asset-folder').value.trim() : d.assetFolder,
        concurrency: $('#concurrency') ? Number($('#concurrency').value) || 3 : d.concurrency,
        voiceLibraryFolder: $('#voice-folder') ? $('#voice-folder').value.trim() : (d.voiceLibraryFolder || ''),
      };
      await api('/api/config', { method: 'PUT', body: payload });
      await refreshState();
      state.assets = await api('/api/assets');
      state.media = await api('/api/media');
      closeModal();
      render();
      toast('设置已保存');
    } catch (err) { toast(err.message, true); }
  };

  const migrate = $('#workspace-migrate');
  if (migrate) migrate.onclick = async () => {
    try {
      const info = await api('/api/workspace');
      const counts = info.migration.counts || {};
      const total = info.migration.total || 0;
      if (info.migration.marker) {
        toast('已经迁移过了，备份在：' + ((info.migration.marker.backups || []).join('、') || '无'));
        return;
      }
      if (!total) { toast('没有需要迁移的旧文件'); return; }
      const ok = confirm(`将把旧目录里的 ${total} 个文件（素材 ${counts.assets || 0} / 上传 ${counts.uploads || 0} / 成片 ${counts.media || 0}）先备份，再迁入当前项目「${info.project ? info.project.name : ''}」。继续？`);
      if (!ok) return;
      const record = await api('/api/workspace/migrate', { method: 'POST', body: {} });
      const moved = Object.values(record.moved || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
      state.assets = await api('/api/assets');
      state.media = await api('/api/media');
      toast('迁移完成：' + moved + ' 项');
      render();
    } catch (err) { toast(err.message, true); }
  };
}

function collectChannelDraft(kind, draft) {
  for (const el of $$('#modal-panel [data-ch-key]')) {
    const key = el.dataset.chKey;
    const scope = el.dataset.chScope;
    const value = el.type === 'checkbox' ? el.checked : el.value;
    if (scope === 'options') draft.options[key] = value;
    else draft[key] = value;
  }
  const maxTokens = $('#ch-max-tokens');
  if (maxTokens) draft.maxTokens = Math.max(0, Number(maxTokens.value) || 0);
  const contextWindow = $('#ch-context-window');
  if (contextWindow) draft.contextWindow = Math.max(0, Number(contextWindow.value) || 0);
  return draft;
}

function guessContextWindow(model) {
  const hit = /(\d+(?:\.\d+)?)\s*([km])/i.exec(String(model || ''));
  if (!hit) return 0;
  const value = Number(hit[1]);
  if (!Number.isFinite(value)) return 0;
  const mult = hit[2].toLowerCase() === 'm' ? 1000000 : 1000;
  const tokens = Math.round(value * mult);
  return tokens >= 4096 && tokens <= 4000000 ? tokens : 0;
}

const MODEL_HINTS = [
  ['gpt-5', 128000, 8192],
  ['gpt-4.1', 1000000, 32768],
  ['gpt-4o', 128000, 16384],
  ['o3', 200000, 100000],
  ['o4', 200000, 100000],
  ['claude', 200000, 8192],
  ['gemini', 1000000, 65536],
  ['deepseek', 128000, 8192],
  ['qwen', 128000, 8192],
  ['glm', 128000, 8192],
  ['kimi', 256000, 8192],
  ['doubao', 128000, 8192],
];

function guessLimits(model) {
  const name = String(model || '').toLowerCase();
  const byName = guessContextWindow(name);
  let context = byName;
  let maxTokens = 0;
  for (const [needle, ctx, out] of MODEL_HINTS) {
    if (name.includes(needle)) {
      if (!context) context = ctx;
      maxTokens = out;
      break;
    }
  }
  return { context, maxTokens };
}

function openChannelDialog(kind, channel, opts = {}) {
  const types = state.channelTypes[kind] || [];
  if (!types.length) return toast('没有可用的渠道类型', true);
  const kindLabel = kind === 'llm' ? '文本推理' : kind === 'image' ? '图片生成' : '视频生成';
  const draft = channel
    ? { ...channel, options: { ...(channel.options || {}) }, apiKey: channel.apiKey || '', maxTokens: channel.maxTokens || 0, contextWindow: channel.contextWindow || 0 }
    : {
      name: '',
      type: types[0].id,
      baseUrl: '',
      model: '',
      apiKey: '',
      maxTokens: kind === 'llm' ? 4096 : 0,
      contextWindow: kind === 'llm' ? 128000 : 0,
      options: {},
    };
  let modelList = [];
  let managerAccounts = [];

  const loadManagerAccounts = async (silent) => {
    const baseUrl = ((document.querySelector('[data-ch-key="baseUrl"]') || {}).value || draft.baseUrl || '').trim();
    const apiKey = ((document.querySelector('[data-ch-key="apiKey"]') || {}).value || '').trim();
    if (!baseUrl) { if (!silent) toast('先填管理器地址', true); return; }
    try {
      if (!silent) toast('正在读取管理器账号…');
      const data = await api('/api/channels/manager-accounts', { method: 'POST', body: { baseUrl, apiKey, channelId: channel ? channel.id : '' } });
      managerAccounts = data.accounts || [];
      collectChannelDraft(kind, draft);
      draw();
      if (!silent) toast(managerAccounts.length ? '已读取 ' + managerAccounts.length + ' 个账号' : '管理器里还没有账号');
    } catch (err) {
      if (!silent) toast(err.message, true);
    }
  };

  const draw = () => {
    const meta = channelTypeMeta(kind, draft.type);
    const modelOptions = modelList.map((m) => `<option value="${esc(m)}"></option>`).join('');
    const fields = (meta ? meta.fields : []).map((f) => {
      if (f.key === 'baseUrl') {
        return `<div class="field full"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>
          <input class="input mono" data-ch-key="baseUrl" data-ch-scope="top" value="${esc(draft.baseUrl || '')}" placeholder="${esc(f.placeholder || '')}" /></div>`;
      }
      if (f.key === 'apiKey') {
        const value = draft.apiKey || '';
        return `<div class="field"><label>${esc(f.label)} <span class="hint">本机明文保存</span></label>
          <input class="input mono" data-ch-key="apiKey" data-ch-scope="top" type="text" value="${esc(value)}" placeholder="${esc(f.placeholder || 'sk-…')}" autocomplete="off" />
          <div class="hint">直接显示并保存在 data/config.json；留空保存 = 保留原 Key</div></div>`;
      }
      if (f.key === 'model') {
        return `<div class="field"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>
          <div class="ch-model-row">
            <input class="input mono" id="ch-model" data-ch-key="model" data-ch-scope="top" list="ch-model-options" value="${esc(draft.model || '')}" placeholder="${esc(f.placeholder || '')}" />
            <button type="button" class="h3-btn h3-btn-sm" id="ch-fetch-models" title="用上面的 Base URL + Key 拉取 /models">获取模型</button>
          </div>
          <datalist id="ch-model-options">${modelOptions}</datalist>
          <div class="hint" id="ch-model-hint">${modelList.length ? `已获取 ${modelList.length} 个模型，点输入框下拉选择` : '不知道填什么？点「获取模型」自动拉列表'}</div></div>`;
      }
      if (draft.type === 'manager-video' && f.key === 'accountId') {
        const opts = managerAccounts.map((a) => '<option value="' + esc(a.id) + '" ' + (a.id === draft.options.accountId ? 'selected' : '') + '>' + esc(a.name) + ' · ' + esc(a.platform) + '</option>').join('');
        return '<div class="field"><label>' + esc(f.label) + '</label>'
          + '<div class="ch-model-row">'
          + '<select class="select" data-ch-key="accountId" data-ch-scope="options" id="ch-manager-account">'
          + '<option value="">自动（该平台第一个可用账号）</option>' + opts + '</select>'
          + '<button type="button" class="h3-btn h3-btn-sm" id="ch-manager-load">读取账号</button></div>'
          + '<div class="hint">' + (managerAccounts.length ? '已读取 ' + managerAccounts.length + ' 个账号' : '先填地址和凭据，再点「读取账号」') + '</div></div>';
      }
      const top = ['baseUrl', 'apiKey', 'model'].includes(f.key);
      const value = top ? (draft[f.key] || '') : (draft.options[f.key] ?? '');
      const common = `data-ch-key="${esc(f.key)}" data-ch-scope="${top ? 'top' : 'options'}" class="input"`;
      if (f.type === 'textarea') {
        return `<div class="field full"><label>${esc(f.label)}</label><textarea ${common} rows="3" placeholder="${esc(f.placeholder || '')}">${esc(value)}</textarea></div>`;
      }
      if (f.options && f.options.length) {
        const opts = f.options.map((o) => `<option value="${esc(o)}" ${String(o) === String(value) ? 'selected' : ''}>${esc(o)}</option>`).join('');
        return `<div class="field"><label>${esc(f.label)}</label><select ${common.replace('class="input"', 'class="select"')}>${opts}</select></div>`;
      }
      return `<div class="field"><label>${esc(f.label)}${f.required ? ' *' : ''}</label><input ${common} type="text" value="${esc(value)}" placeholder="${esc(f.placeholder || '')}" /></div>`;
    }).join('');

    const limitFields = kind === 'llm' ? `
      <div class="ch-section">
        <div class="ch-section-head">
          <span class="ch-section-title">模型限制</span>
          <span class="hint">留 0 = 不限制，交给上游默认</span>
        </div>
        <div class="row wrap">
          <div class="field" style="min-width:190px;flex:1">
            <label>最大输出 token</label>
            <input class="input mono" id="ch-max-tokens" type="number" min="0" max="200000" step="256" value="${Number(draft.maxTokens) || 0}" placeholder="例如 4096" />
          </div>
          <div class="field" style="min-width:190px;flex:1">
            <label>最大上下文 token</label>
            <input class="input mono" id="ch-context-window" type="number" min="0" max="4000000" step="1024" value="${Number(draft.contextWindow) || 0}" placeholder="例如 128000" />
          </div>
        </div>
        <p class="hint">剧本创作台发消息前会按「最大上下文 − 最大输出」裁剪历史；单条超预算会直接报错提示，不会白烧请求。</p>
      </div>` : '';

    openModal(`
      <div class="modal-head">
        <h2>${channel ? '编辑' : '新增'}${kindLabel}渠道</h2>
        <span class="grow"></span>
        <button type="button" class="btn ghost sm" data-close="1">关闭</button>
      </div>
      <div class="modal-body ch-dialog">
        <div class="row wrap">
          <div class="field" style="min-width:200px;flex:1"><label>名称</label><input class="input" id="ch-name" value="${esc(draft.name || '')}" placeholder="例如：公司中转 / 本地代理" /></div>
          <div class="field" style="min-width:230px;flex:1"><label>接口类型</label><select class="select" id="ch-type">${types.map((t) => `<option value="${esc(t.id)}" ${t.id === draft.type ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></div>
        </div>
        <p class="hint">${esc(meta ? meta.hint : '')}</p>
        <div class="ch-fields">${fields}</div>
        ${limitFields}
      </div>
      <div class="modal-foot">
        <span class="hint grow">${kind === 'image' ? '「保存并测试」会真实生成一张小图（会计费）' : '保存后可在列表里「测试」'}</span>
        <button type="button" class="btn" data-close="1">取消</button>
        <button type="button" class="btn" id="ch-test">保存并测试</button>
        <button type="button" class="btn primary" id="ch-save">保存</button>
      </div>
    `);
    $('#modal-panel').classList.add('modal-channel');
    const mgrLoad = $('#ch-manager-load');
    if (mgrLoad) mgrLoad.onclick = () => loadManagerAccounts(false);

    $('#ch-type').onchange = () => {
      const current = collectChannelDraft(kind, draft);
      current.type = $('#ch-type').value;
      current.options = {};
      const meta2 = channelTypeMeta(kind, current.type);
      for (const f of meta2.fields) {
        if (!['baseUrl', 'apiKey', 'model'].includes(f.key) && f.default !== undefined) current.options[f.key] = f.default;
      }
      Object.assign(draft, current);
      modelList = [];
      draw();
    };

    const fetchBtn = $('#ch-fetch-models');
    if (fetchBtn) {
      fetchBtn.onclick = async () => {
        const baseUrl = ($('[data-ch-key="baseUrl"]') || {}).value || '';
        const apiKey = (($('[data-ch-key="apiKey"]') || {}).value || '').trim();
        if (!String(baseUrl).trim()) return toast('先填 Base URL', true);
        fetchBtn.disabled = true;
        const old = fetchBtn.textContent;
        fetchBtn.textContent = '获取中…';
        try {
          const data = await api('/api/channels/models', {
            method: 'POST',
            body: { kind, type: draft.type, baseUrl: baseUrl.trim(), apiKey, channelId: channel ? channel.id : '' },
          });
          modelList = data.models || [];
          collectChannelDraft(kind, draft);
          draw();
          toast(modelList.length ? `已获取 ${modelList.length} 个模型` : '接口没返回模型，手动填吧');
        } catch (err) {
          toast(err.message, true);
          fetchBtn.disabled = false;
          fetchBtn.textContent = old;
        }
      };
    }

    const modelInput = $('#ch-model');
    if (modelInput) {
      modelInput.onchange = () => {
        const guess = guessLimits(modelInput.value);
        const ctx = $('#ch-context-window');
        const max = $('#ch-max-tokens');
        if (ctx && !Number(ctx.value) && guess.context) ctx.value = String(guess.context);
        if (max && !Number(max.value) && guess.maxTokens) max.value = String(guess.maxTokens);
      };
    }

    const save = async (testAfter) => {
      const payload = collectChannelDraft(kind, draft);
      payload.name = $('#ch-name').value.trim() || payload.type;
      if (!String(payload.baseUrl || '').trim()) return toast('请填写 Base URL', true);
      if (kind !== 'video' && !String(payload.model || '').trim()) return toast('请填写模型 ID（可以先点「获取模型」）', true);
      if (kind === 'llm' && payload.maxTokens && payload.contextWindow && payload.maxTokens > payload.contextWindow) {
        return toast('最大输出不能超过最大上下文', true);
      }
      payload.kind = kind;
      try {
        let saved;
        if (channel) saved = await api(`/api/channels/${channel.id}`, { method: 'PUT', body: payload });
        else saved = await api('/api/channels', { method: 'POST', body: payload });
        await refreshState();
        if (kind === 'image' && saved) state.image.channelId = saved.id;
        closeModal();
        if (opts.returnToSettings) openSettings(kind === 'llm' ? 'text' : kind === 'image' ? 'image' : 'video');
        if (testAfter && saved) {
          const result = await api(`/api/channels/${saved.id}/test`, { method: 'POST', body: { kind } });
          toast(result.message, !result.ok);
          await refreshState();
        }
        if (state.route === 'image') render();
        if (state.route === 'studio') render();
        if (state.route === 'script') render();
        toast('渠道已保存');
      } catch (err) {
        toast(err.message, true);
      }
    };
    $('#ch-save').onclick = () => save(false);
    $('#ch-test').onclick = () => save(true);
  };
  draw();
  if (draft.type === 'manager-video') loadManagerAccounts(true);
}

async function refreshState() {
  const data = await api('/api/state');
  state.config = data.config;
  state.workflows = data.workflows;
  state.jobs = data.jobs;
  state.stats = data.stats;
  state.prompt = data.prompt;
  state.channelTypes = data.channelTypes || {};
  state.channels = data.channels || { llm: [], image: [], video: [] };
  if (state.ask && state.ask.models) await askLoadModels();
  if (!state.image.channelId) {
    const imageList = state.channels.image.filter((c) => c.enabled !== false);
    const active = imageList.find((c) => c.active) || imageList[0];
    state.image.channelId = active ? active.id : '';
  }
  updateStatus();
}



/* ------------------------------------------------------------------ init */

async function refreshJobs() {
  const data = await api('/api/jobs');
  state.jobs = data.jobs;
  state.stats = data.stats;
  updateStatus();
}

function connectEvents() {
  if (!window.EventSource) return;
  const source = new EventSource('/api/task-events/stream');
  let timer = null;
  source.onmessage = () => {};
  source.addEventListener('job', (event) => {
    try {
      const job = JSON.parse(event.data);
      const index = state.jobs.findIndex((j) => j.id === job.id);
      if (index >= 0) state.jobs[index] = job;
      else state.jobs.unshift(job);
      if (state.lastJobId === job.id && (job.status === 'success' || job.status === 'failed')) {
        // Force a rerender of the studio stage when the tracked job finishes.
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        const active = document.activeElement;
        const typing = active && (active.id === 'prompt-editor' || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
        if (state.route === 'studio' && typing) {
          updateStatus();
          return;
        }
        if (state.route === 'jobs' || state.route === 'studio' || state.route === 'logs') render();
        updateStatus();
      }, 400);
    } catch { /* ignore */ }
  });
  source.onerror = () => { /* browser retries automatically */ };
}

async function openManagerPage(item) {
  if (!item) return;
  if (!item.classList.contains('is-ok')) {
    await toggleService('manager', item);
    if (!item.classList.contains('is-ok')) return;
  }
  const detail = item.parentElement && item.parentElement.dataset.detail ? JSON.parse(item.parentElement.dataset.detail) : {};
  const url = (detail.manager && detail.manager.url) || 'http://127.0.0.1:17778/';
  try { await api('/api/open', { method: 'POST', body: { url } }); }
  catch (err) { toast('打开管理器失败：' + err.message, true); }
}

async function toggleService(name, el) {
  if (!el || el.classList.contains('is-busy')) return;
  const action = el.classList.contains('is-ok') ? 'stop' : 'start';
  const label = name === 'agent' ? '智能体' : '管理器';
  const act = el.querySelector('.h3-svc-act, .h3-svc-power');
  el.classList.add('is-busy');
  if (act) act.textContent = action === 'start' ? '启动中' : '停止中';
  try {
    const res = await api('/api/services/control', { method: 'POST', body: { name, action } });
    if (action === 'start' && !res.running) throw new Error(res.error || '启动失败');
    toast(label + (action === 'start' ? ' 已启动' : ' 已停止'));
  } catch (err) {
    toast(label + '：' + err.message, true);
  } finally {
    el.classList.remove('is-busy');
    await refreshServices();
  }
}

async function refreshServices() {
  let data;
  try {
    data = await fetch('/api/services').then((r) => r.json());
  } catch {
    return;
  }
  const list = (data && data.data) || {};
  for (const name of ['agent', 'manager']) {
    const el = document.querySelector('.h3-svc-item[data-svc="' + name + '"]');
    if (!el) continue;
    const info = list[name] || { ok: false };
    el.classList.toggle('is-ok', !!info.ok);
    el.classList.toggle('is-bad', !info.ok);
    const label = name === 'agent' ? '智能体' : '管理器';
    const act = el.querySelector('.h3-svc-act, .h3-svc-power');
    if (act && !el.classList.contains('is-busy')) act.textContent = info.ok ? '停止' : '启动';
    el.title = info.ok
      ? label + '在线' + (info.model ? ' · ' + info.model : '') + (info.accounts != null ? ' · 账号 ' + info.accounts : '')
      : label + '未连接' + (info.error ? '：' + info.error : '');
  }
  const box = document.getElementById('svc-lights');
  if (box) {
    box.dataset.detail = JSON.stringify(list);
    box.title = ['agent', 'manager'].map((name) => {
      const info = list[name] || {};
      const label = name === 'agent' ? '智能体 17820' : '管理器 17778';
      return label + '：' + (info.ok ? '在线' + (info.model ? ' / ' + info.model : '') + (info.accounts != null ? ' / 账号 ' + info.accounts : '') : '未连接');
    }).join('\n');
  }
}

/* ------------------------------------------------------------------ 账号 / 项目 */

function renderLoginScreen() {
  const enabled = state.auth && state.auth.enabled;
  document.body.innerHTML = `
    <div class="auth-screen">
      <form class="auth-card" id="auth-form">
        <div class="auth-brand"><span class="h3-brand-mark">Y9</span><div><b>H3 Studio</b><small>AI 视频创作工作台</small></div></div>
        <h1>${enabled ? '登录' : '创建账号'}</h1>
        <p class="hint">${enabled ? '本机账号，登录后才能进入项目。' : '第一次使用，先创建本机账号（密码至少 6 位）。'}</p>
        <input class="input" id="auth-user" placeholder="用户名" autocomplete="username" />
        <input class="input" id="auth-pass" type="password" placeholder="密码" autocomplete="${enabled ? 'current-password' : 'new-password'}" />
        ${enabled ? '' : '<input class="input" id="auth-pass2" type="password" placeholder="再输一次密码" autocomplete="new-password" />'}
        <div class="auth-error" id="auth-error"></div>
        <button class="h3-btn h3-btn-primary" type="submit" id="auth-submit">${enabled ? '登录' : '创建并登录'}</button>
        <div class="auth-switch">${enabled ? '只能本机登录；忘记密码删掉 data/users.json 重新创建' : '本机明文数据，仅个人使用'}</div>
      </form>
    </div>`;
  const form = $('#auth-form');
  form.onsubmit = async (event) => {
    event.preventDefault();
    const username = $('#auth-user').value.trim();
    const password = $('#auth-pass').value;
    const error = $('#auth-error');
    error.textContent = '';
    if (!enabled && password !== $('#auth-pass2').value) {
      error.textContent = '两次密码不一致';
      return;
    }
    const btn = $('#auth-submit');
    btn.disabled = true;
    btn.textContent = '处理中…';
    try {
      const res = await fetch(enabled ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '失败');
      location.reload();
    } catch (err) {
      error.textContent = err.message;
      btn.disabled = false;
      btn.textContent = enabled ? '登录' : '创建并登录';
    }
  };
  $('#auth-user').focus();
}

async function loadProjects() {
  try {
    state.projects = await api('/api/projects');
    state.styles = await api('/api/styles');
  } catch {
    state.projects = [];
    state.styles = [];
  }
  return state.projects;
}

function styleImageUrl(style) {
  if (!style || !style.id) return '';
  const version = String(style.image || '').split('/').pop();
  return '/api/styles/' + encodeURIComponent(style.id) + '/image' + (version ? '?v=' + encodeURIComponent(version) : '');
}

async function setActiveProject(id, opts = {}) {
  const project = (state.projects || []).find((p) => p.id === id);
  if (!project) return null;
  const previousId = state.projectId;
  if (previousId && previousId !== id) { await WB.flushAll(); studioFlush(previousId); }
  state.projectId = id;
  state.project = project;
  try { localStorage.setItem('h3.projectId', id); } catch { /* ignore */ }
  state.styleDetail = await api('/api/styles/' + encodeURIComponent(project.styleId)).catch(() => null);
  // 必须先等服务端记住当前项目，再重新读素材/媒体/任务，否则会读到上一个项目的数据。
  await fetch('/api/auth/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: id }),
  }).catch(() => {});
  Events.resetForProject();
  if (state.route === 'tasks' && $('#view')) await Events.load();
  askResetForProject();
  state.assets = await api('/api/assets').catch(() => state.assets);
  state.media = await api('/api/media').catch(() => state.media);
  const jobData = await api('/api/jobs').catch(() => null);
  if (jobData && Array.isArray(jobData.jobs)) state.jobs = jobData.jobs;
  await studioLoadForProject(id);
  if(state.projectId!==id)return null;
  await WB.load(id);
  if(state.projectId!==id)return null;
  applyProjectChip();
  if (!opts.silent) render();
  return project;
}

function applyProjectChip() {
  const name = (state.project && state.project.name) || '未选择项目';
  const style = state.styleDetail ? state.styleDetail.name : '';
  const btn = $('#project-btn');
  if (btn) btn.title = '项目：' + name + (style ? ' · ' + style : '') + '（点击切换）';
}

function renderProjects() {
  const user = state.auth && state.auth.user;
  const list = state.projects || [];
  return `<div class="projects-page">
    <div class="projects-head">
      <div><h1>项目</h1><p>项目可以绑定一套风格（自动注入风格前置），也可以选「探索模式」自由生成。</p></div>
      <span class="grow"></span>
      ${user ? `<span class="hint">${esc(user.username)}</span>` : ''}
      ${state.auth && state.auth.enabled ? '<button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-act="logout">退出登录</button>' : ''}
      <button type="button" class="h3-btn h3-btn-sm h3-btn-primary" data-act="new-project">＋ 新建项目</button>
    </div>
    ${list.length ? `<div class="projects-grid">${list.map((p) => `<div class="project-card ${p.id === state.projectId ? 'is-on' : ''}">
      ${p.style && p.style.image ? `<img class="project-cover" src="${styleImageUrl({ id: p.styleId, image: p.style && p.style.image })}" alt="" />` : '<div class="project-cover project-cover-explore">🧭</div>'}
      <div class="project-body">
        <b>${esc(p.name)}</b>
        <small>${p.style ? '🎨 ' + esc(p.style.name) : '🧭 探索模式'}</small>
        ${p.dir ? `<small class="mono project-dir" title="${esc(p.dir)}">📁 ${esc(p.dir)}</small>` : ''}
        ${p.description ? `<small>${esc(p.description)}</small>` : ''}
        <div class="row">
          <button type="button" class="h3-btn h3-btn-sm ${p.id === state.projectId ? 'h3-btn-ghost' : 'h3-btn-primary'}" data-act="open-project" data-id="${esc(p.id)}">${p.id === state.projectId ? '当前项目' : '进入'}</button>
          <button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-act="edit-project" data-id="${esc(p.id)}">编辑</button>
          <button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-act="delete-project" data-id="${esc(p.id)}">删除</button>
        </div>
      </div>
    </div>`).join('')}</div>` : '<div class="ask-cap-empty">还没有项目，先新建一个并选风格。</div>'}
  </div>`;
}

function bindProjects(root) {
  if (!root) return;
  root.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    try {
      if (act === 'new-project') return openProjectDialog(null);
      if (act === 'edit-project') {
        const project = (state.projects || []).find((p) => p.id === btn.dataset.id);
        return openProjectDialog(project);
      }
      if (act === 'open-project') {
        await setActiveProject(btn.dataset.id);
        if (location.hash === '#projects') location.hash = '#image';
        else setRoute();
        return;
      }
      if (act === 'delete-project') {
        if (!confirm('删除这个项目？项目里的任务和成片不会删。')) return;
        await api('/api/projects/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
        await loadProjects();
        if (state.projectId === btn.dataset.id) {
          state.projectId = '';
          state.project = null;
          state.styleDetail = null;
          localStorage.removeItem('h3.projectId');
          applyProjectChip();
        }
        return render();
      }
      if (act === 'logout') {
        await fetch('/api/auth/logout', { method: 'POST' });
        location.reload();
        return;
      }
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openProjectDialog(project) {
  const list = state.styles || [];
  let selected = project ? project.styleId || '' : '';
  const isEdit = !!project;
  openModal(`
    <div class="modal-head"><h2>${isEdit ? '编辑项目' : '新建项目'}</h2><span class="grow"></span><button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body ch-dialog">
      <div class="field full"><label>项目名称</label><input class="input" id="project-name-input" maxlength="60" value="${esc(project ? project.name : '')}" placeholder="例如：雪山寺庙 · 第 1 集" /></div>
      <div class="field full"><label>备注（可选）</label><textarea class="input" id="project-desc-input" rows="2" placeholder="题材、受众、时长…">${esc(project ? project.description || '' : '')}</textarea></div>
      <div class="ch-section"><div class="ch-section-head"><span class="ch-section-title">选择风格</span><span class="hint">决定角色、场景、道具和视频的画面风格</span></div>
        <div class="style-grid" id="style-grid">
          <button type="button" class="style-card style-card-explore ${!selected ? 'is-on' : ''}" data-style="">
            <div class="style-explore-cover">🧭</div>
            <div><b>探索模式</b><small>不内置风格前置，完全按你的提示词自由生成；适合先试感觉。</small></div>
          </button>
          ${list.map((st) => `<button type="button" class="style-card ${st.id === selected ? 'is-on' : ''}" data-style="${esc(st.id)}">
          ${st.image ? `<img src="${styleImageUrl(st)}" alt="" />` : ''}
          <div><b>${esc(st.name)}</b><small>${esc(st.summary || '')}</small></div>
        </button>`).join('')}</div>
      </div>
      <p class="hint" id="style-hint">${selected ? '已选：' + esc((list.find((x) => x.id === selected) || {}).name || '') : '已选：探索模式（不注入风格前置）'}</p>
    </div>
    <div class="modal-foot">
      <span class="hint grow">风格前置保存在 data/styles.json，可随时替换</span>
      <button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">取消</button>
      <button type="button" class="h3-btn h3-btn-sm h3-btn-primary" id="project-save">${isEdit ? '保存' : '创建'}</button>
    </div>`);
  $('#modal-panel').classList.add('modal-channel');
  $$('#style-grid .style-card').forEach((card) => {
    card.onclick = () => {
      selected = card.dataset.style;
      $$('#style-grid .style-card').forEach((c) => c.classList.toggle('is-on', c === card));
      const hit = list.find((x) => x.id === selected);
      $('#style-hint').textContent = '已选：' + (hit ? hit.name : '探索模式（不注入风格前置）');
    };
  });
  $('#project-save').onclick = async () => {
    const name = $('#project-name-input').value.trim();
    if (!name) return toast('请填写项目名称', true);

    try {
      const body = { name, description: $('#project-desc-input').value.trim(), styleId: selected };
      const saved = isEdit
        ? await api('/api/projects/' + encodeURIComponent(project.id), { method: 'PUT', body })
        : await api('/api/projects', { method: 'POST', body });
      closeModal();
      await loadProjects();
      await setActiveProject(saved.id, { silent: true });
      if (!isEdit) location.hash = '#image';
      else render();
      toast(isEdit ? '项目已保存' : '项目已创建');
    } catch (err) {
      toast(err.message, true);
    }
  };
}

function openImageSaveDialog(all) {
  const results = state.image.results || [];
  const items = all ? results : [imageCurrent()].filter(Boolean);
  if (!items.length) return toast('还没有可保存的图片', true);
  openModal(`
    <div class="modal-head"><h2>保存图片</h2><span class="grow"></span><button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="row wrap">
        <div class="field" style="min-width:220px;flex:1"><label>文件名</label><input class="input" id="img-save-name" value="${esc(items[0].name || 'image.png')}" /></div>
        <div class="field" style="min-width:180px"><label>保存到</label>
          <select class="select" id="img-save-target">
            <option value="assets">素材库（assets）</option>
            <option value="media">媒体库 images/日期</option>
            <option value="download">浏览器下载</option>
            <option value="custom">自定义目录…</option>
          </select>
        </div>
      </div>
      <div class="field full" id="img-save-dir-wrap" hidden><label>自定义目录（绝对路径）</label><input class="input mono" id="img-save-dir" placeholder="D:\\作品\\项目名" /></div>
      <div class="hint">${all ? `将保存 ${items.length} 张（文件名会自动加序号避免覆盖）` : esc(items[0].name)}${items[0].path ? ' · ' + esc(items[0].path) : ''}</div>
    </div>
    <div class="modal-foot">
      <button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">取消</button>
      <button type="button" class="h3-btn h3-btn-sm h3-btn-primary" id="img-save-go">保存</button>
    </div>`);
  $('#img-save-target').onchange = (e) => { $('#img-save-dir-wrap').hidden = e.target.value !== 'custom'; };
  $('#img-save-go').onclick = async () => {
    const target = $('#img-save-target').value;
    const name = $('#img-save-name').value.trim() || 'image.png';
    if (target === 'download') {
      for (const it of items) {
        const link = document.createElement('a');
        link.href = '/api/file?path=' + encodeURIComponent(it.path) + '&download=1';
        link.download = name;
        link.click();
      }
      closeModal();
      toast('已开始下载');
      return;
    }
    try {
      const data = await api('/api/images/save-copy', {
        method: 'POST',
        body: { paths: items.map((x) => x.path), name, target, dir: $('#img-save-dir').value.trim() },
      });
      closeModal();
      toast('已保存 ' + data.items.length + ' 张到 ' + data.folder);
    } catch (err) {
      toast(err.message, true);
    }
  };
}

async function init() {
  try {
    const me = await fetch('/api/auth/me').then((r) => r.json()).catch(() => ({ data: { enabled: false, user: null } }));
    state.auth = (me && me.data) || { enabled: false, user: null };
    if (!state.auth.user) return renderLoginScreen();
    const data = await api('/api/state');
    state.config = data.config;
    state.workflows = data.workflows;
    state.jobs = data.jobs;
    state.stats = data.stats;
    state.prompt = data.prompt;
    state.channelTypes = data.channelTypes || {};
    state.channels = data.channels || { llm: [], image: [], video: [] };
    const imageList = state.channels.image.filter((c) => c.enabled !== false);
    const activeImage = imageList.find((c) => c.active) || imageList[0];
    state.image.channelId = activeImage ? activeImage.id : '';
    const stored = localStorage.getItem('h3.workflowId');
    const storedWidth = Number(localStorage.getItem('h3.panelWidth')) || 0;
    if (storedWidth) state.studio.panelWidth = storedWidth;
    // 默认渠道以「设置 → 视频生成」里标的默认为准，其次是上次选择；有管理器渠道时不再回落到官网 API。
    const videoChannels = (state.channels.video || []).filter((c) => c.enabled !== false);
    const activeVideo = (state.channels.video || []).find((c) => c.active && c.enabled !== false);
    const managerWf = activeVideo ? state.workflows.find((w) => w.channelId === activeVideo.id) : null;
    let wf = managerWf
      || workflowById(stored)
      || workflowById(data.defaultWorkflowId)
      || state.workflows[0];
    if (wf && wf.provider === 'autodl' && videoChannels.length) {
      wf = state.workflows.find((w) => w.channelId === videoChannels[0].id) || wf;
    }
    state.studio.workflowId = wf.id;
    state.studio.channelId = wf.channelId || '';
    state.studio.resolution = wf.defaultResolution || '';
    state.studio.megapixels = wf.megapixelsDefault || 0;
    state.studio.megapixels2 = wf.pass2 ? wf.pass2.default : 0;
    state.studio.duration = Math.min(15, wf.durationDefault || 10);
    await loadProjects();
    let storedProject = '';
    try { storedProject = localStorage.getItem('h3.projectId') || ''; } catch { storedProject = ''; }
    const activeProject = (state.projects || []).find((p) => p.id === storedProject) || (state.projects || [])[0] || null;
    if (activeProject) await setActiveProject(activeProject.id, { silent: true });
    else { await studioLoadForProject('default'); await WB.load('default'); }
    applyTheme();
    setRoute();
    state.assets = await api('/api/assets');
    state.media = await api('/api/media');
    state.imageHistory = await api('/api/images/history').then((d) => d.items || []).catch(() => []);
    if (!WB.current('image') && (state.image.results || []).length === 0 && state.imageHistory[0] && state.imageHistory[0].items) {
      state.image.results = state.imageHistory[0].items;
      state.image.previewIndex = 0;
      if (state.imageHistory[0].prompt) state.image.prompt = state.imageHistory[0].prompt;
    }
    try {
      const storedJob = localStorage.getItem('h3.lastJobId') || '';
      if (storedJob && state.jobs.some((j) => j.id === storedJob)) state.lastJobId = storedJob;
      else {
        const latest = state.jobs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).find((j) => (j.outputs || []).length);
        if (latest) state.lastJobId = latest.id;
      }
    } catch { /* ignore */ }
    render();
    connectEvents();
    IJ.init();
    refreshServices();
    setInterval(refreshServices, 20000);
    const projectBtn = $('#project-btn');
    if (projectBtn) projectBtn.onclick = () => { location.hash = '#projects'; };
    applyProjectChip();
    const agentItem = document.querySelector('.h3-svc-item[data-svc="agent"]');
    if (agentItem) agentItem.onclick = () => toggleService('agent', agentItem);
    const managerItem = document.querySelector('.h3-svc-item[data-svc="manager"]');
    if (managerItem) {
      const power = managerItem.querySelector('.h3-svc-power');
      if (power) power.onclick = (event) => { event.stopPropagation(); toggleService('manager', managerItem); };
      const label = managerItem.querySelector('.h3-svc-label');
      if (label) label.onclick = () => openManagerPage(managerItem);
    }
  } catch (err) {
    if (/请先登录/.test(err.message)) return renderLoginScreen();
    document.body.innerHTML = `<div class="empty" style="height:100vh;justify-content:center"><strong>无法连接 H3 Studio 服务</strong><p>${esc(err.message)}</p></div>`;
  }
}

function bindRoute(root) {
  if (state.route === 'studio') bindStudio(root);
  else if (state.route === 'image') bindImage(root);
  else if (state.route === 'tasks') bindTasks(root);
  else if (state.route === 'jobs') bindJobs(root);
  else if (state.route === 'assets') bindAssets(root);
  else if (state.route === 'compare') bindCompare(root);
  else if (state.route === 'script') bindScript(root);
  else if (state.route === 'media') bindMedia(root);
  else if (state.route === 'batch') bindBatch(root);
  else if (state.route === 'logs') bindLogs(root);
  else if (state.route === 'projects') bindProjects(root);
}

init();







/* Local raster editor. Originals are retained; applying creates a new image. */
function imageCloseDocument(index) {
  const im = state.image;
  if (!Number.isInteger(index) || !im.results?.[index]) return;
  imagePushHistory();
  im.results = im.results.filter((_, i) => i !== index);
  const active = im.previewIndex || 0;
  im.previewIndex = Math.max(0, Math.min(active - (index < active ? 1 : 0), im.results.length - 1));
  im.selection = null;
  imagePushHistory();
  render();
}

async function openRasterEditor() {
  const source = imageCurrent();
  if (!source) return;
  const image = new Image();
  image.src = source.url;
  try { await image.decode(); } catch { return toast('图片加载失败，无法编辑', true); }
  openModal(`
    <div class="modal-head"><h2>基础编辑 · ${esc(source.name)}</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">取消</button></div>
    <div class="modal-body raster-editor">
      <div class="raster-tools">
        <label>工具 <select id="raster-tool" class="select"><option value="brush">画笔</option><option value="erase">橡皮擦（透明）</option><option value="rect">矩形框</option><option value="text">文字（点击放置）</option></select></label>
        <label>颜色 <input id="raster-color" type="color" value="#ff3333"></label>
        <label>笔宽 <input id="raster-width" type="number" min="1" max="500" value="12"></label>
        <label>字号 <input id="raster-font" type="number" min="8" max="1000" value="64"></label>
        <input id="raster-text" class="input" placeholder="输入要添加的文字" aria-label="添加文字内容">
      </div>
      <div class="raster-tools">
        <button class="btn" data-raster="undo">撤销</button><button class="btn" data-raster="redo">重做</button>
        <button class="btn" data-raster="left">左转90°</button><button class="btn" data-raster="right">右转90°</button>
        <button class="btn" data-raster="flip-x">水平翻转</button><button class="btn" data-raster="flip-y">垂直翻转</button>
      </div>
      <div class="raster-tools">
        <label>亮度 <input id="raster-bright" type="range" min="0" max="200" value="100"></label>
        <label>对比度 <input id="raster-contrast" type="range" min="0" max="200" value="100"></label>
        <label>饱和度 <input id="raster-saturate" type="range" min="0" max="200" value="100"></label>
        <button class="btn" data-raster="adjust">应用调色</button><button class="btn" data-raster="reset-adjust">重置调色</button>
      </div>
      <p class="hint">在图片上拖动绘制，文字工具点击放置；笔宽和字号以原图像素计。调色滑块实时预览，应用后可继续绘制。裁剪、尺寸调整在主画布工具栏。</p>
      <div class="raster-stage"><canvas id="raster-canvas"></canvas></div>
      <p class="hint" id="raster-status"></p>
    </div>
    <div class="modal-foot"><button class="btn" data-close="1">取消</button><button class="btn primary" id="raster-save">保存为新图片</button></div>`);
  $('#modal-panel').classList.add('modal-wide');
  const canvas = $('#raster-canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const history = [canvas.toDataURL('image/png')]; let cursor = 0; let pending = false; let start = null; let before = null;
  const controls = ['bright', 'contrast', 'saturate'].map(n => $('#raster-' + n));
  const filter = () => 'brightness(' + controls[0].value + '%) contrast(' + controls[1].value + '%) saturate(' + controls[2].value + '%)';
  const reset = () => { controls.forEach(c => c.value = 100); canvas.style.filter = ''; };
  const refresh = () => {
    $('#raster-status').textContent = canvas.width + ' × ' + canvas.height + ' 像素';
    $('[data-raster="undo"]').disabled = cursor === 0 || pending;
    $('[data-raster="redo"]').disabled = cursor === history.length - 1 || pending;
  };
  const snapshot = () => { history.splice(cursor + 1); history.push(canvas.toDataURL('image/png')); if (history.length > 20) history.shift(); cursor = history.length - 1; refresh(); };
  const bake = () => {
    if (controls.every(c => Number(c.value) === 100)) return;
    const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height; copy.getContext('2d').drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.filter = filter(); ctx.drawImage(copy, 0, 0); ctx.filter = 'none'; reset();
  };
  controls.forEach(c => c.oninput = () => { canvas.style.filter = filter(); });
  const point = e => { const r = canvas.getBoundingClientRect(); return {x: Math.max(0, Math.min(canvas.width, (e.clientX - r.left) * canvas.width / r.width)), y: Math.max(0, Math.min(canvas.height, (e.clientY - r.top) * canvas.height / r.height))}; };
  const brush = (a,b) => {
    ctx.save(); ctx.globalCompositeOperation = $('#raster-tool').value === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = $('#raster-color').value; ctx.lineWidth = Math.max(1, Math.min(500, Number($('#raster-width').value) || 12)); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x + .001,b.y);ctx.stroke();ctx.restore();
  };
  canvas.onpointerdown = e => {
    if (pending || e.button !== 0) return;
    e.preventDefault(); bake(); const p = point(e); const tool = $('#raster-tool').value;
    if (tool === 'text') {
      const text = $('#raster-text').value; if (!text.trim()) return toast('先输入文字', true);
      ctx.fillStyle = $('#raster-color').value; ctx.font = Math.max(8, Math.min(1000, Number($('#raster-font').value) || 64)) + 'px sans-serif'; ctx.textBaseline = 'top';
      ctx.fillText(text, p.x, p.y); snapshot(); return;
    }
    canvas.setPointerCapture(e.pointerId); start = p; before = ctx.getImageData(0,0,canvas.width,canvas.height);
    if (tool !== 'rect') brush(p,p);
  };
  canvas.onpointermove = e => {
    if (!start || pending) return; const p = point(e);
    if ($('#raster-tool').value === 'rect') { ctx.putImageData(before,0,0);ctx.strokeStyle = $('#raster-color').value;ctx.lineWidth = Math.max(1, Number($('#raster-width').value)||12);ctx.strokeRect(start.x,start.y,p.x-start.x,p.y-start.y); }
    else { brush(start,p); start = p; }
  };
  const finish = () => { if(start) { start = null;before = null;snapshot(); } };
  canvas.onpointerup = finish; canvas.onpointercancel = finish;
  const panel = $('#modal-panel');
  panel.querySelectorAll('[data-raster]').forEach(button => button.onclick = async () => {
    if (pending || start) return;
    const action = button.dataset.raster;
    try {
      if(action === 'reset-adjust') return reset();
      if(action === 'undo' || action === 'redo') {
        const next = cursor + (action === 'undo' ? -1 : 1); if(next < 0 || next >= history.length) return;
        pending = true;refresh(); const restored = new Image();restored.src = history[next];await restored.decode();
        canvas.width = restored.naturalWidth;canvas.height = restored.naturalHeight;ctx.drawImage(restored,0,0);cursor = next;reset();
      } else {
        bake();
        if(action !== 'adjust') {
          const copy = document.createElement('canvas');copy.width = canvas.width;copy.height = canvas.height;copy.getContext('2d').drawImage(canvas,0,0);
          const rotate = action === 'left' || action === 'right';canvas.width = rotate ? copy.height : copy.width;canvas.height = rotate ? copy.width : copy.height;
          ctx.save();ctx.translate(canvas.width/2,canvas.height/2);
          if(rotate) ctx.rotate(action === 'left' ? -Math.PI/2 : Math.PI/2);
          else ctx.scale(action === 'flip-x' ? -1 : 1,action === 'flip-y' ? -1 : 1);
          ctx.drawImage(copy,-copy.width/2,-copy.height/2);ctx.restore();
        }
        snapshot();
      }
    } catch(error) { toast(error.message,true); } finally { pending = false;refresh(); }
  });
  $('#raster-save').onclick = async e => {
    if(pending || start) return; pending = true;e.target.disabled = true;
    try {
      bake();const item = await imageSaveDataUrl(canvas.toDataURL('image/png'));
      imagePushHistory();state.image.results = [...(state.image.results || []),item];state.image.previewIndex = state.image.results.length-1;state.image.selection = null;imagePushHistory();
      closeModal();render();toast('已保存编辑副本，原图已保留');
    } catch(error) { toast(error.message,true); } finally { pending = false;e.target.disabled = false; }
  };
  refresh();
}

