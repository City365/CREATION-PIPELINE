'use strict';

/* app.core.js — utils / modal / theme / shell / 路由
 * 由 web/app.js 按原段注释切分而来（第 1–849 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */


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

function toast(message, isError = false, action = null) {
  const host = $('#toasts');
  const text = String(message == null ? '' : message).trim();
  if (!host || !text) return;
  // 同一句话重复出现时只保留一条，避免连续保存叠出一串相同提示。
  for (const node of [...host.children]) {
    if (node.dataset.key === text || node.textContent === text) node.remove();
  }
  while (host.children.length >= (action ? 2 : 3)) host.firstElementChild.remove();
  const box = document.createElement('div');
  box.className = 'toast' + (isError ? ' err' : '') + (action ? ' has-action' : '');
  box.dataset.key = text;
  const label = document.createElement('span');
  label.textContent = text;
  box.appendChild(label);
  const dismiss = () => {
    if (!box.isConnected) return;
    box.classList.add('is-out');
    setTimeout(() => box.remove(), 180);
  };
  if (action && action.label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.onclick = async () => {
      button.disabled = true;
      try { await action.onClick(); dismiss(); } catch (err) { button.disabled = false; toast(err.message, true); }
    };
    box.appendChild(button);
  }
  host.appendChild(box);
  const life = action ? Math.max(4000, Number(action.timeout) || 8000) : (isError ? 6000 : 3200);
  setTimeout(dismiss, life);
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
    <button type="button" class="wmd-btn wmd-btn-sm" onclick="location.reload()">刷新页面</button>
    <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" onclick="this.parentNode.remove()">收起</button>`;
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

// 一键成片：三种模式，只有入参不同（小说正文 / 剧本 / 一句话灵感），后面是同一条成片管线。
// 二级菜单、页面标题、hash 里的 ?mode= 都读这一份，加模式只改这里。
const ONECLICK_MODES = [
  { id: 'novel', name: '小说模式', input: '一段小说正文' },
  { id: 'script', name: '剧本模式', input: '剧本（分场 + 台词）' },
  { id: 'idea', name: '灵感模式', input: '一句话或几个关键词' },
];

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
  // 一键成片：三种模式的入参不同，模式记在这里，刷新和二级菜单都读它
  oneclick: { mode: 'novel' },
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
  // 媒体库默认只加载「按任务」的菜单，选中某个任务才去拉它的成片
  mediaTask: '',
  mediaTasks: null,
  mediaTaskItems: null,
  media: null,
  batch: null,
  busy: false,
  lastJobId: null,
  // 舞台上正在回看哪一版：{ [itemId]: jobId }，点历史缩略图时写入，只在空闲时生效
  stagePick: {},
  image: {
    channelId: '',
    tab: 'generate',
    prompt: '',
    styleLayer: 'free',
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
    model: '',
    count: 1,
    promptMode: 'tags',
    warnings: [],
  },
  // 各厂商独立的创作草稿：{ seedance: {...}, minimax: {...}, other: {...} }
  studioDrafts: {},
};


let studioSaveTimer = null;
function studioProjectId() { return state.projectId || 'default'; }
function studioKey(project) { return 'wmd.studio.' + (project || studioProjectId()); }
function studioSnapshot() {
  const s = state.studio;
  return {
    workflowId: s.workflowId, prompt: s.prompt, promptMode: s.promptMode,
    images: s.images || [], audios: s.audios || [], videos: s.videos || [],
    aspectRatio: s.aspectRatio, resolution: s.resolution,
    megapixels: s.megapixels, megapixels2: s.megapixels2,
    duration: s.duration, seed: s.seed, count: s.count, model: s.model || '',
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
  s.videos = Array.isArray(saved.videos) ? saved.videos.filter(Boolean) : [];
  if (Array.isArray(saved.audios)) s.audios = saved.audios.filter(Boolean);
  for (const key of ['aspectRatio', 'resolution', 'seed', 'model']) if (saved[key] !== undefined) s[key] = saved[key];
  for (const key of ['megapixels', 'megapixels2', 'duration', 'count']) if (Number.isFinite(saved[key])) s[key] = saved[key];
  s._restored = true;
}
/* 厂商分桶：Seedance / MiniMax-H3 / ViDu / Muse / Grok-Video / 其他
   切换厂商时各自一份草稿，提示词、参考图、参考音频、时长等互不相串。 */
function vendorKeyOf(wf) {
  const id = String((wf && wf.id) || '').toLowerCase();
  const label = String((wf && (wf.label || wf.display)) || '').toLowerCase();
  if (id.includes('doubao') || id.includes('seedance') || label.includes('豆包') || label.includes('seedance')) return 'seedance';
  if (id.includes('minimax') || id.startsWith('rh:') || label.includes('h3')) return 'minimax';
  if (id.includes('vidu') || label.includes('vidu') || label.includes('生数')) return 'vidu';
  if (id.includes('muse') || label.includes('muse')) return 'muse';
  if (id.includes('grok') || label.includes('grok')) return 'grok';
  return 'other';
}
function resetStudioDraft() {
  const s = state.studio;
  s.prompt = '';
  s.promptMode = 'tags';
  s.images = [];
  s.audios = [];
  s.videos = [];
  s.seed = '';
  s.model = '';
  s.count = 1;
  s.warnings = [];
  s.skillFormat = '';
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
    try { legacy = JSON.parse(localStorage.getItem('wmd.studio') || 'null'); } catch { legacy = null; }
    if (legacy && (legacy.prompt || (legacy.images || []).length)) {
      studioApply(legacy);
      studioFlush(projectId);
      try { localStorage.removeItem('wmd.studio'); } catch { /* ignore */ }
      return legacy;
    }
    s.prompt = '';
    s.promptMode = 'tags';
    s.images = [];
    s.audios = []; s.videos = [];
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
  panel.classList.remove('modal-settings', 'modal-channel', 'modal-wide', 'ce-full', 'modal-project-picker');
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
  document.body.style.overflow = document.getElementById('evt-drawer') ? 'hidden' : '';
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
    const wantSound = !!state.config?.ui?.wallpaperSound && !state.volume?.muted;
    const volume = Math.max(0, Math.min(100, Number(state.config?.ui?.wallpaperVolume ?? 40))) / 100;
    video.volume = volume;
    if (paused) {
      video.muted = !wantSound;
      video.pause();
    } else {
      // 浏览器只允许静音自动播放：先静音起播拿到播放权限，再按设置开声音。
      // 否则带音轨的壁纸会被 autoplay 策略拦下，看起来就是「卡住不动」。
      const start = () => {
        video.muted = true;
        const playing = video.play();
        if (playing && typeof playing.then === 'function') {
          playing.then(() => { video.muted = !wantSound; }).catch(() => {
            document.documentElement.dataset.wallpaperPaused = 'true';
            const button = $('#wallpaper-play');
            if (button) { button.textContent = '▶'; button.title = '播放动态壁纸'; }
          });
        }
      };
      start();
      // 用户第一次点页面任意处后补一次播放机会（有些浏览器要等交互才放行）
      if (!mountWallpaper._retryBound) {
        mountWallpaper._retryBound = true;
        const retry = () => {
          const v = document.querySelector('#wallpaper-layer video');
          if (!v) return;
          if (v.paused && !wallpaperIsPaused()) {
            v.muted = true;
            v.play().then(() => { v.muted = !(!!state.config?.ui?.wallpaperSound && !state.volume?.muted); }).catch(() => {});
          }
          document.removeEventListener('pointerdown', retry);
          document.removeEventListener('keydown', retry);
        };
        document.addEventListener('pointerdown', retry, { once: true });
        document.addEventListener('keydown', retry, { once: true });
      }
    }
    startWallpaperWatchdog();
  }
}

/**
 * 视频壁纸看门狗。
 * 4K 壁纸循环几个小时之后，浏览器解码器偶尔会掉帧、画面变黑/变灰（元素还在、时间不走），
 * 这时只剩暗色蒙版，整页就是一片灰。这里每 5 秒检查一次，卡住就重新 load + play。
 */
function startWallpaperWatchdog() {
  if (startWallpaperWatchdog._timer) return;
  let stuck = 0;
  let lastTime = -1;
  startWallpaperWatchdog._timer = setInterval(() => {
    const v = document.querySelector('#wallpaper-layer video');
    if (!v || v.dataset.recovering === '1') return;
    if (wallpaperIsPaused() || document.visibilityState !== 'visible') { stuck = 0; lastTime = -1; return; }
    // 还在下载就别打扰它，否则会陷入 load 循环
    if (!v.error && v.readyState < 2 && v.networkState === 2) { stuck = 0; lastTime = -1; return; }
    const broken = !!v.error || (v.readyState < 2 && v.networkState !== 2) || (v.readyState >= 2 && v.videoWidth === 0);
    const frozen = !broken && v.readyState >= 2 && Math.abs(v.currentTime - lastTime) < 0.04;
    lastTime = v.currentTime;
    if (!broken && !frozen) { stuck = 0; return; }
    stuck += 1;
    if (stuck < 2) return;
    stuck = 0;
    v.dataset.recovering = '1';
    try {
      const at = Math.round(v.currentTime * 10) / 10;
      v.load();
      v.muted = true;
      v.play().catch(() => {});
      const reason = broken ? '解码异常' : '画面停在 ' + at + 's';
      console.warn('[wallpaper] 视频壁纸卡住（' + reason + '），已重新载入');
      if (!startWallpaperWatchdog._notified) {
        startWallpaperWatchdog._notified = true;
        if (typeof toast === 'function') toast('壁纸画面丢失，已自动重新载入（4K 大文件容易掉帧，可换 1080p）', true);
      }
    } catch (error) { /* 忽略 */ }
    setTimeout(() => { delete v.dataset.recovering; }, 1500);
  }, 5000);
  // 切回标签页时也补一次
  if (!startWallpaperWatchdog._bound) {
    startWallpaperWatchdog._bound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const v = document.querySelector('#wallpaper-layer video');
      if (v && v.paused && !wallpaperIsPaused()) { v.muted = true; v.play().catch(() => {}); }
    });
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

function applySystemTypography(ui = {}) {
  const style = document.documentElement.style;
  const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const size = clamp(ui.systemFontSize ?? 14, 12, 18, 14);
  const scale = size / 14;
  style.setProperty('--system-font', (AGENT_FONTS[ui.systemFont] || AGENT_FONTS.system).css);
  style.setProperty('--system-size', size + 'px');
  style.setProperty('--system-leading', String(clamp(ui.systemLineHeight ?? 1.55, 1.25, 2.2, 1.55)));
  style.setProperty('--system-weight', String([400, 500, 600].includes(Number(ui.systemFontWeight)) ? Number(ui.systemFontWeight) : 400));
  style.setProperty('--wmd-font', (AGENT_FONTS[ui.systemFont] || AGENT_FONTS.system).css);
  for (const [name, base] of [['--wmd-fs-1', 11], ['--wmd-fs-2', 12], ['--wmd-fs-3', 13], ['--wmd-fs-4', 14], ['--wmd-fs-5', 16], ['--wmd-fs-6', 20]]) {
    style.setProperty(name, (base * scale).toFixed(2).replace(/\.?0+$/, '') + 'px');
  }
}

/** 壁纸可见度（0=完全不透，100=完全透明）。键存在就用它（0 也是有效值），不存在才落默认。 */
function visPref(ui, key, fallback) {
  if (!ui || !(key in ui) || ui[key] === null || ui[key] === '') return fallback;
  const n = Number(ui[key]);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
}

function applyTheme() {
  const active = currentTheme();
  document.documentElement.dataset.theme = active;
  const theme = themeCatalog().find((t) => t.id === active);
  const ui = (state.config && state.config.ui) || {};
  applySystemTypography(ui);
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
  // 壁纸穿透的三档可见度（0=完全不透，100=完全透明露出壁纸）。
  const uiCfg = state.config && state.config.ui;
  const pageTrans = visPref(uiCfg, 'pageTransparency', 55);
  document.documentElement.style.setProperty('--skin-page-vis', String(pageTrans));
  const sideTrans = visPref(uiCfg, 'sidebarTransparency', 60);
  document.documentElement.style.setProperty('--skin-side-vis', String(sideTrans));
  const topTrans = visPref(uiCfg, 'topbarTransparency', 65);
  document.documentElement.style.setProperty('--skin-top-vis', String(topTrans));
  mountWallpaper({ ...theme, wallpaper });
  syncBackgroundAudio();
  const anchorBtn = $('#settings-btn');
  let play = $('#wallpaper-play');
  if (!play) {
    play = document.createElement('button'); play.type = 'button'; play.id = 'wallpaper-play'; play.className = 'wmd-iconbtn';
    if (anchorBtn) anchorBtn.before(play);
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

/* ------------------------------------------------------------------ 设置按钮 */

const settingsBtn = $('#settings-btn');
if (settingsBtn) settingsBtn.onclick = () => openSettings();

/* ------------------------------------------------------------------ 全局音量 */
// 顶栏不再放音量条：音量在「设置 → 外观」里按来源（视频原声 / 背景音乐）调。
// 这里只负责把已保存的音量/静音状态应用到页面上的媒体元素。

function applyVolume() {
  const v = state.volume || { level: 60, muted: false };
  const level = Math.max(0, Math.min(100, Number(v.level) || 0));
  document.querySelectorAll('video, audio').forEach((el) => {
    if (el.classList.contains('skin-wallpaper-video')) { el.muted = !state.config?.ui?.wallpaperSound || !!v.muted; return; }
    if (el.id === 'background-music') { el.muted = !!v.muted; return; }
    el.volume = level / 100;
    el.muted = !!v.muted;
  });
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

/* 路由参数：地址形如 #assets?dir=素材/人物/第1集，刷新能回到同一层 */
function routeParams() {
  const raw = (location.hash || '').replace(/^#/, '');
  const cut = raw.indexOf('?');
  const path = cut >= 0 ? raw.slice(0, cut) : raw;
  return { route: path, params: new URLSearchParams(cut >= 0 ? raw.slice(cut + 1) : '') };
}

/** 只改地址栏、不触发 hashchange，避免二次渲染 */
function syncHash(route, values) {
  const params = new URLSearchParams();
  Object.entries(values || {}).forEach(([key, value]) => {
    if (value !== '' && value != null) params.set(key, String(value));
  });
  const query = params.toString();
  const next = '#' + route + (query ? '?' + query : '');
  if (location.hash !== next) {
    try { history.replaceState(null, '', next); } catch (error) { /* 忽略 */ }
  }
}

window.syncHash = syncHash;

function setRoute() {
  const previousRoute = state.route;
  const parsed = routeParams();
  let route = parsed.route || 'image';
  // 旧路由兼容：批量任务 / 任务 / 任务日志 统一进「任务管理」的对应页签
  if (route === 'jobs' || route === 'batch' || route === 'logs') {
    state.taskTab = route === 'batch' ? 'batch'
      : route === 'logs' ? ((state.logTab || localStorage.getItem('wmd.logs.tab') || 'video') === 'image' ? 'image' : 'video')
      : 'running';
    localStorage.setItem('wmd.tasks.tab', state.taskTab);
    try { history.replaceState(null, '', '#tasks' + location.search); } catch { /* ignore */ }
    route = 'tasks';
  }
  // 白名单只收现存的页面。已经删掉的路由（比如智能剪辑 smartcut）不能留一个
  // 「地址还认、内容对不上」的入口：地址栏顺手改回 #image，跟上面 jobs/batch/logs 一个做法。
  const knownRoutes = ['image', 'studio', 'script', 'oneclick', 'concat', 'smartrelease', 'assets', 'batch', 'jobs', 'tasks', 'media', 'compare', 'logs', 'projects'];
  if (!knownRoutes.includes(route)) {
    route = 'image';
    try { history.replaceState(null, '', '#image' + location.search); } catch { /* ignore */ }
  }
  state.route = route;
  // 从地址栏恢复二级菜单状态
  const tabParam = parsed.params.get('tab');
  const dirParam = parsed.params.get('dir');
  const vendorParam = parsed.params.get('vendor');
  const taskParam = parsed.params.get('task');
  const modeParam = parsed.params.get('mode');
  if (state.route === 'oneclick' && modeParam && ONECLICK_MODES.some((m) => m.id === modeParam)) {
    state.oneclick.mode = modeParam;
  }
  if (state.route === 'image' && tabParam && ['edit', 'generate', 'reverse', 'scene'].includes(tabParam)) {
    state.image.tab = tabParam;
  }
  if (state.route === 'tasks' && tabParam) state.taskTab = tabParam;
  if (state.route === 'assets' && dirParam) state.assetView = { kind: 'dir', rel: dirParam, deep: false };
  if (state.route === 'media' && taskParam) state.mediaTask = taskParam;
  if (state.route === 'studio' && vendorParam) {
    const target = (state.workflows || []).find((w) => vendorKeyOf(w) === vendorParam);
    if (target && state.studio && state.studio.workflowId !== target.id) {
      state.studio.workflowId = target.id;
      state.studio.channelId = target.channelId || state.studio.channelId;
    }
  }
  if (state.route === 'tasks' && !state.taskTab) state.taskTab = localStorage.getItem('wmd.tasks.tab') || 'running';
  if (state.route !== 'projects' && !state.projectId) state.route = 'projects';
  if (state.route === 'script' && previousRoute !== 'script' && state.ask?.conversations && !state.ask.loading && !state.ask.generating) {
    askNewConversation();
  }
  if (state.route === 'assets') {
    api('/api/assets').then(data => { state.assets = data; if (state.route === 'assets') render(); }).catch(e => toast(e.message, true));
  }
  if (state.route === 'media') {
    loadMediaTaskMenu().then(() => { if (state.route === 'media') render(); }).catch((e) => toast(e.message, true));
  }
  $$('#nav .wmd-maintab').forEach((b) => b.classList.toggle('is-active', b.dataset.route === state.route));
  render();
}

window.addEventListener('hashchange', setRoute);

function render() {
  const view = $('#view');
  if (!view) return; // 页面还没挂好（或正在被整体替换）时不要硬渲染，否则整页报错
  let html = '';
  if (state.route === 'studio') html = renderStudio();
  else if (state.route === 'image') html = IJ.panel() + renderImage();
  else if (state.route === 'script') html = renderScript();
  else if (state.route === 'oneclick') html = '<div class="page-scroll">' + renderOneClick() + '</div>';
  else if (state.route === 'concat') html = renderConcat();
  else if (state.route === 'smartrelease') html = '<div class="page-scroll">' + renderSmartRelease() + '</div>';
  else if (state.route === 'batch') html = '<div class="page-scroll">' + renderBatch() + '</div>';
  else if (state.route === 'jobs') html = '<div class="page-scroll">' + renderJobs() + '</div>';
  else if (state.route === 'tasks') html = '<div class="page-scroll tasks-page">' + renderTasks() + '</div>';
  else if (state.route === 'assets') html = '<div class="page-scroll assets-page">' + renderAssets() + '</div>';
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
  if (state.route === 'concat' && window.CONCAT_EDITOR) {
    window.CONCAT_EDITOR.mount(host.querySelector('#ce-host'), {
      projectId: askProjectId(),
      projectName: (state.project && state.project.name) || '',
      toast,
    });
  }
  if(state.route === "studio" || state.route === "image") WB.bind(host,state.route === "studio" ? "video" : "image");
  // 整页重画之后把结构签名对齐，避免下一条进度事件又触发一次整页重画
  if (state.route === 'studio') { try { studioSignatureCache = studioStageSignature(); } catch { /* ignore */ } }
  applyVolume();
  updateStatus();
}

function updateStatus() {
  const cfg = state.config;
  if (!cfg) return;
  const queued = state.jobs.filter((j) => j.status === 'queued').length + (state.imageTasks||[]).filter(t=>['queued','paused'].includes(t.status)).length;
  const running = state.jobs.filter((j) => j.status === 'running').length + (state.imageTasks||[]).filter(t=>t.status==='running').length;
  const jc = $('#job-count');
  if (jc) jc.textContent = (queued + running) ? String(queued + running) : '';
}

// 顶栏页签：按钮不是链接，必须自己改 hash（之前只监听 hashchange，导致点不动）
function goRoute(route) {
  const next = '#' + route;
  if (location.hash === next) render();
  else location.hash = next;
}

$$('#nav .wmd-maintab').forEach((btn, index) => {
  btn.onclick = () => goRoute(btn.dataset.route);
  // 第十个落在 0 上：Ctrl+10 按不出来
  btn.title = `Ctrl+${index < 9 ? index + 1 : '0'}`;
});

document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
  const tabs = $$('#nav .wmd-maintab');
  const index = event.key === '0' ? 9 : Number(event.key) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= tabs.length) return;
  event.preventDefault();
  goRoute(tabs[index].dataset.route);
});
