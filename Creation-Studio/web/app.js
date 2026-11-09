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
  state.route = ['image', 'studio', 'script', 'assets', 'batch', 'jobs', 'tasks', 'media', 'compare', 'logs', 'projects'].includes(route) ? route : 'image';
  // 从地址栏恢复二级菜单状态
  const tabParam = parsed.params.get('tab');
  const dirParam = parsed.params.get('dir');
  const vendorParam = parsed.params.get('vendor');
  const taskParam = parsed.params.get('task');
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
  btn.title = `Ctrl+${index + 1}`;
});

document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
  const index = Number(event.key) - 1;
  const tabs = $$('#nav .wmd-maintab');
  if (!Number.isInteger(index) || index < 0 || index >= tabs.length) return;
  event.preventDefault();
  goRoute(tabs[index].dataset.route);
});

/* ------------------------------------------------------------------ studio */

/* ---- 视频创作台：按原版 DOM 结构（wmd-panel / wmd-slots / wmd-compose）重建 ---- */

const ICON = {
  frame: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18"></rect><path d="M7 3v18M17 3v18M3 7h4M3 17h4M17 7h4M17 17h4"></path></svg>',
  swap: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"></path><path d="M3 6h18"></path><path d="M7 22l-4-4 4-4"></path><path d="M21 18H3"></path></svg>',
  x: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>',
  copy: '<svg class="wmd-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
  trash: '<svg class="wmd-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path></svg>',
  wand: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 12-12M14 4l1.5 3L19 8.5 15.5 10 14 13l-1.5-3L9 8.5 12.5 7z"></path></svg>',
  caret: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>',
  audio: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle></svg>',
  play: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 3 14 9-14 9z"></path></svg>',
  skipBack: '<svg class="wmd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 20 9 12l10-8zM5 19V5"></path></svg>',
  skipFwd: '<svg class="wmd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 4 10 8-10 8zM19 5v14"></path></svg>',
};

function refSlotHtml(image, index, nextEmpty) {
  const num = index + 1;
  const isNext = !image && index === nextEmpty;
  const cls = 'wmd-slot' + (image ? ' has-media' : isNext ? ' is-next' : '');
  const style = `--i:${index}`;
  if (!image) {
    return `<div class="${cls}" data-act="add-image" data-index="${index}" style="${style}" title="点击从素材库选择图像，或把图片拖到这里">
      <span class="wmd-slot-num is-empty">图${num}</span>
    </div>`;
  }
  return `<div class="${cls}" data-index="${index}" style="${style}" draggable="true" ${image.subject ? `data-subject="${num}"` : ''} title="${esc(image.name)}">
    <img class="wmd-slot-img" src="/api/file?path=${enc(image.path)}" alt="" />
    <span class="wmd-slot-num">图${num}</span>
    ${image.subject ? `<span class="wmd-slot-subject" title="&lt;Subject ${num}&gt;">S${num} ${esc(image.subject)}</span>` : ''}
    <div class="wmd-slot-actions">
      <button type="button" class="wmd-slot-act" data-act="name-subject" data-index="${index}" title="命名主体（供提示词 &lt;Subject n&gt; 引用）">${ICON.frame}</button>
      <button type="button" class="wmd-slot-act" data-act="add-image" data-index="${index}" title="更换图像">${ICON.swap}</button>
      <button type="button" class="wmd-slot-act is-danger" data-act="remove-image" data-index="${index}" title="移除">${ICON.x}</button>
    </div>
  </div>`;
}

function audioSlotHtml(audio, index) {
  const num = index + 1;
  if (!audio) {
    return `<div class="wmd-audio" data-index="${index}" title="选择内置音色或本地音频，也可把音频文件拖到这里">
      <span class="wmd-audio-num tnum">音频${num}</span>
      <button type="button" class="wmd-audio-pick" data-act="voice-pick" data-index="${index}" title="用内置音色朗读台词，生成一段音频">内置音色</button>
      <button type="button" class="wmd-audio-pick" data-act="add-audio" data-index="${index}" title="选一个本地音频文件">本地音频</button>
    </div>`;
  }
  return `<div class="wmd-audio has-media" data-index="${index}" title="${esc(audio.path)}">
    <span class="wmd-audio-num tnum">音频${num}</span>
    <span class="wmd-audio-ico">${ICON.audio}</span>
    <span class="wmd-audio-name">${esc(audio.name)}</span>
    <span class="wmd-audio-tag">${audio.voiceId ? '音色库 · ' + esc(audio.voice || '') : audio.voice ? '内置音色' : '本地音频'}${audio.seconds ? ' · ' + audio.seconds + 's' : ''}</span>
    <div class="wmd-slot-actions" style="opacity:1">
      <button type="button" class="wmd-slot-act" data-act="preview-audio" data-index="${index}" title="试听">${ICON.play}</button>
      <button type="button" class="wmd-slot-act" data-act="voice-pick" data-index="${index}" title="换内置音色">${ICON.frame}</button>
      <button type="button" class="wmd-slot-act is-danger" data-act="remove-audio" data-index="${index}" title="移除">${ICON.x}</button>
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
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button>
    </div>
    <div class="modal-body">
      <div class="wmd-page-tabs" style="height:32px;margin:-6px 0 4px;border:0;padding:0">
        ${tabs.map(([id, label]) => `<button type="button" class="wmd-page-tab ${tab === id ? 'is-on' : ''}" data-voice-tab="${id}">${label}</button>`).join('')}
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
      <button type="button" class="wmd-btn wmd-btn-sm" id="vl-refresh" title="重新扫描音色目录">重新扫描</button>
    </div>
    <div class="hint">音色库根目录：<span class="mono">${esc(library.root)}</span> · 选中后会把样本复制进 <span class="mono">data/uploads/voice/</span>，再进音频槽</div>
    <div class="vl-list" id="vl-list"></div>
    <div class="row"><span class="hint" id="vl-count"></span><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm" id="vl-more">加载更多</button></div>
  `;
}

function sapiPane(dialogues, existing) {
  return `
    <p class="hint">用系统自带的语音包离线合成 WAV（Windows System.Speech），生成后直接放进这个音频槽，再在提示词里用 &lt;Audio 1&gt; 引用。</p>
    ${dialogues.length ? `<div class="row wrap"><span class="hint">从提示词里取到的台词：</span>${dialogues.slice(0, 6).map((line, i) => `<button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-line="${i}" title="填进下面的文本框">${esc(line.slice(0, 18))}${line.length > 18 ? '…' : ''}</button>`).join('')}</div>` : ''}
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
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-primary" id="voice-go">生成并放入音频槽</button>
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
    <button type="button" class="wmd-btn wmd-btn-sm" data-act="vl-use" data-id="${item.id}">使用</button>
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
    return `<span class="wmd-prompt-placeholder">还没有提示词。点「插入骨架」按当前主体生成 6 段式骨架，或直接切到「代码」开始写。</span>`;
  }
  let html = '';
  let cursor = 0;
  const re = /<Picture\s+(\d+)>|<Subject\s+(\d+)>|<Audio\s+(\d+)>|<d>([\s\S]*?)<\/d>|\[Shot\s+(\d+)\]/gi;
  let m;
  const pushText = (raw) => {
    const value = esc(raw);
    const parts = value.split(/(主体定义|摘要|保留分析|详细描述|环境音|非剧情配乐|参考生成|镜头设计)/g);
    parts.forEach((part, i) => {
      if (i % 2 === 1) html += `<span class="wmd-chip is-section"><span>${part}</span></span>`;
      else html += part.replace(/\n/g, '<br>');
    });
  };
  while ((m = re.exec(source))) {
    pushText(source.slice(cursor, m.index));
    if (m[1]) {
      const img = s.images[Number(m[1]) - 1];
      html += `<span class="wmd-chip is-media">${img ? `<img class="wmd-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>图${m[1]}</span></span>`;
    } else if (m[2]) {
      const img = s.images[Number(m[2]) - 1];
      const label = img && img.subject ? img.subject : '主体' + m[2];
      html += `<span class="wmd-chip is-subject">${img ? `<img class="wmd-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>${esc(label)}</span></span>`;
    } else if (m[3]) {
      const aud = s.audios[Number(m[3]) - 1];
      html += `<span class="wmd-chip is-spec"><span>音频${m[3]}${aud ? ' · ' + esc(aud.name) : ''}</span></span>`;
    } else if (m[4] !== undefined) {
      html += `<span class="wmd-chip is-dialogue"><span>对白：</span><span>${esc(m[4])}</span></span>`;
    } else if (m[5]) {
      html += `<span class="wmd-chip is-spec is-clickable"><span>镜头${m[5]}</span></span>`;
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
      if (i % 2 === 1) html += `<span class="wmd-chip is-section" contenteditable="false" data-token="${parts[i]}"><span>${parts[i]}</span></span>`;
      else html += parts[i].replace(/\n/g, '<br>');
    }
  };
  while ((m = re.exec(source))) {
    pushText(source.slice(cursor, m.index));
    const g = m.groups || {};
    if (g.speaker) {
      html += `<span class="wmd-chip is-spec is-clickable" contenteditable="false" data-token="(S${g.speaker})"><span>说话人${g.speaker}</span></span>`;
    } else if (g.picture) {
      const img = s.images[Number(g.picture) - 1];
      html += `<span class="wmd-chip is-media" contenteditable="false" data-token="&lt;Picture ${g.picture}&gt;">${img ? `<img class="wmd-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>图${g.picture}</span></span>`;
    } else if (g.subject) {
      const img = s.images[Number(g.subject) - 1];
      const label = img && img.subject ? img.subject : '主体' + g.subject;
      html += `<span class="wmd-chip is-subject" contenteditable="false" data-token="&lt;Subject ${g.subject}&gt;">${img ? `<img class="wmd-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>${esc(label)}</span></span>`;
    } else if (g.audio) {
      const aud = s.audios[Number(g.audio) - 1];
      html += `<span class="wmd-chip is-spec" contenteditable="false" data-token="&lt;Audio ${g.audio}&gt;"><span>音频${g.audio}${aud ? ' · ' + esc(aud.name) : ''}</span></span>`;
    } else if (g.lang) {
      const lang = g.lang;
      let body = g.dialogue || '';
      let voice = '';
      if (body.startsWith('（男声画外音）')) { voice = 'male'; body = body.slice('（男声画外音）'.length); }
      else if (body.startsWith('（女声画外音）')) { voice = 'female'; body = body.slice('（女声画外音）'.length); }
      const prefix = voice === 'male' ? '男声画外音：' : voice === 'female' ? '女声画外音：' : (langLabel[lang] || lang) + '：';
      html += `<span class="wmd-chip is-dialogue" contenteditable="false" data-dialogue="1" data-dialogue-lang="${esc(lang)}"${voice ? ' data-dialogue-voice="' + voice + '"' : ''}><span contenteditable="false" class="wmd-dialogue-prefix">${prefix}</span><span contenteditable="true" data-dialogue-body="1">${esc(body)}</span></span>`;
    } else if (g.shot) {
      html += `<span class="wmd-chip is-spec is-clickable" contenteditable="false" data-token="[Shot ${g.shot}]"><span>镜头${g.shot}</span></span>`;
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
    host.innerHTML = items.length ? groups.map((g) => '<div class="wmd-mention-col ' + colClass(g.name) + '"><div class="wmd-mention-title">' + esc(g.name) + '</div>' + g.items.map((item) => '<button type="button" class="wmd-mention-item' + (items.indexOf(item) === index ? ' is-active' : '') + '" data-mi="' + items.indexOf(item) + '">' + (item.thumb ? '<img src="' + esc(item.thumb) + '" alt="" />' : '<span class="wmd-mention-ico">' + (item.icon || '·') + '</span>') + '<span class="wmd-mention-label">' + esc(item.label) + (item.desc ? '<small>' + esc(item.desc) + '</small>' : '') + '</span></button>').join('') + '</div>').join('') : '<p class="wmd-mention-empty">没有匹配素材；先在左侧添加参考图/音频。</p>';
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
      node.className = 'wmd-chip is-dialogue';
      node.contentEditable = 'false';
      node.dataset.dialogue = '1';
      node.dataset.dialogueLang = item.dialogue.lang || 'Chinese';
      if (item.dialogue.voice) node.dataset.dialogueVoice = item.dialogue.voice;
      const prefix = document.createElement('span');
      prefix.contentEditable = 'false';
      prefix.className = 'wmd-dialogue-prefix';
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
      if (item.token.startsWith('<Picture')) node.className = 'wmd-chip is-media';
      else if (item.token.startsWith('<Subject')) node.className = 'wmd-chip is-subject';
      else if (item.token.startsWith('(S')) node.className = 'wmd-chip is-spec is-clickable';
      else node.className = 'wmd-chip is-spec is-clickable';
      if (item.thumb) {
        const img = document.createElement('img');
        img.className = 'wmd-chip-media';
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
  if(wf.videos) return '<div class="wmd-empty"><div class="wmd-empty-card"><h2 class="wmd-empty-title">让人物跟随参考视频动作</h2><p class="wmd-empty-desc">添加一张人物图片和一段 MP4 / WebM 动作视频，选择输出分辨率后生成。无需填写提示词或指定时长，按实际生成视频时长计费。</p><button type="button" class="wmd-btn" data-act="go-jobs">查看任务日志</button></div></div>';

  return `<div class="wmd-empty">
    <div class="wmd-empty-card">
      <h2 class="wmd-empty-title">把参考图拖到左侧开始</h2>
      <p class="wmd-empty-desc">创作台把图像与音频参考、六段式提示词提交到视频工作流，生成带对白与环境音的短视频。生成过程会在这里实时预览，完成后自动保存到你指定的文件夹。</p>
      <ol class="wmd-empty-steps">
        <li><b>1</b><span>在左侧添加 1–${wf.images} 张参考图，点图上标签为角色 / 场景命名主体。</span></li>
        <li><b>2</b><span>${wf.audios ? `可选：为 ${wf.audios} 个音频槽选本地音频，绑定到主体作为音色参考。` : '当前工作流不接收音频参考。'}</span></li>
        <li><b>3</b><span>写提示词，用 &lt;Picture 1&gt; / &lt;Subject 1&gt; / &lt;Audio 1&gt; 引用素材，&lt;d&gt;写对白&lt;/d&gt;；或先插入骨架 / 示例。</span></li>
        <li><b>4</b><span>左上角选「渠道」（管理器里的豆包 / Gemini），底部选「视频模型」，再选画幅与时长，点「生成视频」。</span></li>
      </ol>
    </div>
  </div>`;
}

// 舞台要跟着任务进度变，但不能整页重画：整页重画会让创作台一直闪，还会打断正在播的成片
function studioOwnJobs() {
  const itemId = WB.context('video').itemId;
  return (state.jobs || []).filter((j) => j.itemId === itemId);
}

/** 当前分镜出过片的那些任务，最新的在前：舞台上面那排「生成历史」用它抽卡对比。 */
function studioHistoryJobs(limit = 4) {
  return studioOwnJobs()
    .filter((j) => (j.outputs || []).some((o) => o.type === 'video'))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit);
}

function studioPickedJobId() {
  const itemId = WB.context('video').itemId;
  return (state.stagePick && state.stagePick[itemId]) || '';
}

/**
 * 舞台看的是「当前分镜最新的一条任务」：有在跑的就看正在跑的，没有才看最新的那条。
 * 以前优先用 state.lastJobId，那个值是上次会话/上次点选留下的，会把好几天前的成片
 * 钉在舞台上——明明还在生成，舞台却显示「完成 · 100%」。
 * 点过上面的历史缩略图后，空闲时优先看用户点的那一版；一有新任务在跑就回到实时任务。
 */
function studioStageJob() {
  const ownJobs = studioOwnJobs();
  if (!ownJobs.length) return null;
  const active = ownJobs
    .filter((j) => j.status === 'running' || j.status === 'queued')
    .sort((a, b) => (Number(b.status === 'running') - Number(a.status === 'running')) || ((b.createdAt || 0) - (a.createdAt || 0)))[0];
  if (active) return active;
  const picked = studioPickedJobId();
  const hit = picked ? ownJobs.find((j) => j.id === picked) : null;
  if (hit && (hit.outputs || []).some((o) => o.type === 'video')) return hit;
  return ownJobs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
}

// 结构签名：只有“任务集合或状态”变了才值得整页重画，进度百分比变化不算
let studioSignatureCache = '';
function studioStageSignature() {
  const own = studioOwnJobs();
  const stageId = (studioStageJob() || {}).id || '';
  return own.map((j) => j.id + ':' + j.status).join('|') + '#' + stageId;
}

// 出片之后舞台要把 <video> 换上去；只换 .stage-video 这一块，
// 否则用户正在文本框里打字时（我们不敢整页重画）成片永远不出现
function studioStageMediaPatch() {
  if (state.route !== 'studio') return false;
  const last = studioStageJob();
  if (!last) return false;
  const video = [...(last.outputs || [])].reverse().find((o) => o.type === 'video');
  if (!video) return false;
  const box = document.querySelector('#studio-stage .stage-video');
  if (!box || box.querySelector('video')) return false;
  box.innerHTML = `<video src="/api/file?path=${enc(video.path)}" controls playsinline></video>`;
  return true;
}

function studioLivePatch() {
  if (state.route !== 'studio') return false;
  const stage = document.getElementById('studio-stage');
  const queue = document.getElementById('studio-queue');
  if (!stage && !queue) return false;
  const last = studioStageJob();
  if (stage && last) {
    const progress = last.progress || 0;
    const bar = stage.querySelector('.stage-bar > i');
    if (bar) bar.style.width = progress + '%';
    const waiting = stage.querySelector('.stage-wait span:last-child');
    if (waiting && !stage.querySelector('.stage-video video')) waiting.textContent = (last.stage || '生成中') + ' · ' + progress + '%';
    const hint = stage.querySelector('.stage-meta .stage-line.hint span');
    if (hint) hint.textContent = (last.stage || '') + ' · ' + progress + '%';
    const badge = stage.querySelector('.stage-meta .stage-line .wmd-badge, .stage-meta .stage-line .badge');
    if (badge) badge.textContent = STATUS_LABEL[last.status] || last.status;
  }
  if (queue) {
    for (const row of queue.querySelectorAll('.stage-queue-row')) {
      const job = (state.jobs || []).find((j) => j.id === row.dataset.id);
      if (!job) continue;
      const stateCell = row.querySelector('.stage-queue-state');
      if (stateCell) stateCell.textContent = STATUS_LABEL[job.status] || job.status;
      const dot = row.querySelector('.dot');
      if (dot) dot.className = 'dot ' + (job.status === 'success' ? 'ok' : job.status === 'failed' ? 'bad' : job.status === 'running' ? 'warn' : '');
    }
    const head = queue.querySelector('.stage-queue-head .tnum');
    if (head) {
      const counts = (state.jobs || []).reduce((acc, j) => {
        if (j.status === 'queued') acc.queued += 1;
        else if (j.status === 'running') acc.running += 1;
        return acc;
      }, { queued: 0, running: 0 });
      head.textContent = counts.queued + ' 排队 · ' + counts.running + ' 生成中';
    }
  }
  return true;
}

function renderStudio() {
  const s = state.studio;
  const ownJobs = studioOwnJobs();
  const wf = currentWorkflow();
  if (!wf) return `<div class="wmd-empty"><div class="wmd-empty-card"><h2 class="wmd-empty-title">没有工作流</h2><p class="wmd-empty-desc">在 设置 → 视频生成 里添加一个管理器渠道。</p></div></div>`;
  const skillFmt = studioSkillFormat(s, wf);
  const isAuto = wf.provider === 'autodl';
  const isManager = wf.provider === 'manager';

  // 当前厂商：渠道下拉与模型下拉都只列本厂商的东西，跨厂商互不出现
  const studioVendor = vendorKeyOf(wf);
  const modelChoices = (s.channelId
    ? state.workflows.filter((w) => w.channelId === s.channelId)
    : state.workflows.filter((w) => w.provider !== 'autodl'))
    .filter((w) => vendorKeyOf(w) === studioVendor);
  const images = s.images || [];
  const audios = s.audios || [];
  const nextEmpty = images.findIndex((x) => !x);
  const mode = s.promptMode || 'tags';
  const lastJob = studioStageJob();
  const outputs = lastJob ? (lastJob.outputs || []) : [];
  const video = [...outputs].reverse().find((o) => o.type === 'video');
  const progress = lastJob ? lastJob.progress || 0 : 0;
  const keyCount = (state.config.autodlKeys || []).filter((k) => k.enabled !== false).length;
  const channel = (state.channels.video || []).find((c) => c.id === wf.channelId) || null;
  // 最近任务：最新的排前面（state.jobs 是创建顺序，直接 slice 会拿到最老的五条）
  const recent = ownJobs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  const allVideoChannels = (state.channels.video || []).filter((c) => c.enabled !== false);
  // 只保留「本厂商有工作流」的渠道；一个都没有时回退全量，避免下拉变空
  const vendorChannels = allVideoChannels.filter((c) =>
    state.workflows.some((w) => w.channelId === c.id && vendorKeyOf(w) === studioVendor));
  const videoChannels = vendorChannels.length ? vendorChannels : allVideoChannels;
  const autodlWorkflows = state.workflows.filter((w) => w.provider === 'autodl' && (!wf.channelId || w.channelId===wf.channelId) && vendorKeyOf(w) === studioVendor);
  const channelWorkflows = wf.channelId
    ? state.workflows.filter((w) => w.channelId === wf.channelId && vendorKeyOf(w) === studioVendor)
    : [];
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
    ? autodlWorkflows.map((w) => `<option value="${esc(w.id)}" ${w.id === wf.id ? 'selected' : ''}>${esc(w.label)}</option>`).join('')
    : (channelWorkflows.length
      ? channelWorkflows.map((w) => `<option value="${esc(w.id)}" ${w.id === wf.id ? 'selected' : ''}>${esc(shortModel(w))}</option>`).join('')
      : `<option value="${esc(wf.id)}" selected>${esc((channel && (channel.model || channel.name)) || wf.label)}</option>`);

  // 渠道右侧的信息条（管理器地址 / AutoDL / 自定义渠道名）与上方「渠道」选择器重复，已移除。
  // 进入渠道设置仍走左侧「管理器」按钮，打开管理器工作台走顶栏「管理器」。
  const remote = '';

  const ratioOptions = (wf.ratios || []).length ? wf.ratios : ['9:16', '16:9', '1:1'];
  const currentRatio = (String(s.aspectRatio || '').match(/\d+:\d+/) || [wf.defaultRatio || '16:9'])[0];
  const aspectField = isAuto
    ? `<div class="wmd-field wmd-compose-field is-aspect">
        <div class="wmd-field-head"><span class="wmd-field-label">分辨率</span></div>
        <div class="wmd-select-wrap"><select class="wmd-select" id="p-resolution">
          ${wf.resolutions.map((r) => `<option value="${esc(r)}" ${r === (s.resolution || wf.defaultResolution) ? 'selected' : ''}>${esc(r)}</option>`).join('')}
        </select><span class="wmd-select-caret">${ICON.caret}</span></div>
      </div>`
    : `<div class="wmd-field wmd-compose-field is-aspect">
        <div class="wmd-field-head"><span class="wmd-field-label">画幅</span></div>
        <div class="wmd-select-wrap"><select class="wmd-select" id="p-aspect">
          ${ratioOptions.map((r) => `<option value="${esc(r)}" ${r === currentRatio ? 'selected' : ''}>${esc(r)}${r === '9:16' ? ' 竖屏' : r === '16:9' ? ' 横屏' : ''}</option>`).join('')}
        </select><span class="wmd-select-caret">${ICON.caret}</span></div>
      </div>`;

  // 生成历史：抽卡要能对比前几版，一排放四个，点哪个舞台就回看哪个
  const historyJobs = studioHistoryJobs(4);
  const historyStrip = historyJobs.length ? `<div class="stage-history">
        <div class="stage-history-head"><span>生成历史</span><span class="hint">点缩略图回看这一版</span></div>
        <div class="stage-history-grid">${historyJobs.map((job, index) => {
          const out = [...(job.outputs || [])].reverse().find((o) => o.type === 'video');
          const on = lastJob && job.id === lastJob.id;
          const label = index === 0 ? '最新' : '第 ' + (historyJobs.length - index) + ' 版';
          const time = new Date(job.createdAt || 0).toLocaleString('zh-CN', { hour12: false });
          return `<button type="button" class="stage-history-card${on ? ' is-on' : ''}" data-act="stage-pick" data-id="${esc(job.id)}" title="${esc(label)} · ${esc(time)} 生成 · 点一下在舞台回看">
            <video src="/api/file?path=${enc(out.path)}#t=0.5" preload="metadata" muted playsinline></video>
            <span class="stage-history-tag">${esc(label)}</span>
          </button>`;
        }).join('')}</div>
      </div>` : '';

  const stage = lastJob
    ? `<div class="stage-live">
        ${historyStrip}
        <div class="stage-video">${video
          ? `<video src="/api/file?path=${enc(video.path)}" controls playsinline></video>`
          : `<div class="stage-wait"><span class="wmd-spinner"></span><span>${esc(lastJob.stage || '生成中')} · ${progress}%</span></div>`}</div>
        <div class="stage-meta">
          <div class="stage-line"><strong>${esc(lastJob.title)}</strong><span class="grow"></span>${jobStatusBadge(lastJob)}</div>
          <div class="stage-bar"><i style="width:${progress}%"></i></div>
          <div class="stage-line hint"><span>${esc(lastJob.stage)} · ${progress}%</span><span class="grow"></span><span>${ago(lastJob.createdAt)}</span></div>
          ${lastJob.error ? `<div class="stage-line is-danger">${esc(lastJob.error)}</div>` : ''}
          <div class="stage-line">
            <button type="button" class="wmd-btn wmd-btn-sm" data-act="open-job" data-id="${esc(lastJob.id)}">查看任务</button>
            ${video ? `<button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-act="play-job" data-id="${esc(lastJob.id)}">系统播放器</button>` : ''}
            ${lastJob && lastJob.outputDir ? `<button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-act="open-job-folder" data-path="${esc(lastJob.outputDir)}">打开文件夹</button>` : ''}
          </div>
        </div>
      </div>`
    : stageEmptyHtml(wf);

  const queue = recent.length
    ? `<div class="stage-queue">
        <div class="stage-queue-head">最近任务<span class="wmd-statusbar-spacer"></span><span class="tnum">${state.stats.queued || 0} 排队 · ${state.stats.running || 0} 生成中</span></div>
        ${recent.map((job) => `<button type="button" class="stage-queue-row" data-act="open-job" data-id="${esc(job.id)}">
          <span class="dot ${job.status === 'success' ? 'ok' : job.status === 'failed' ? 'bad' : job.status === 'running' ? 'warn' : ''}"></span>
          <span class="stage-queue-title">${esc(job.title)}</span>
          <span class="stage-queue-state">${esc(STATUS_LABEL[job.status] || job.status)}</span>
        </button>`).join('')}
      </div>`
    : '';

  return `
  <div class="wmd-main studio-main">
    <aside class="wmd-panel studio-panel" style="width:${s.panelWidth ? s.panelWidth + 'px' : '67%'}">
      <div class="wmd-panel-body">
        <div class="wmd-panel-top">
          <div class="wmd-workflow">
            <span class="wmd-eyebrow">渠道</span>
            <div class="wmd-select-wrap wmd-workflow-select">
              <select class="wmd-select" id="channel-select" title="视频渠道；默认渠道在 设置 → 视频生成 里改">${channelOptions}</select>
              <span class="wmd-select-caret">${ICON.caret}</span>
            </div>
            <span class="wmd-workflow-tag ${isAuto ? 'is-autodl' : (isManager ? 'is-manager' : 'is-generic')}">${esc(wf.providerLabel || (isAuto ? 'AutoDL 官方H3' : isManager ? '管理器' : '自定义'))}</span>
          </div>
          ${remote}
        </div>

        ${wf.promptRequired === false ? '' : generationPrefixHtml('video')}

        <div class="wmd-field" ${wf.videos ? '' : 'style="display:none"'}><div class="wmd-field-head"><span class="wmd-field-label">动作参考视频（必填）</span></div><button type="button" class="wmd-btn" data-act="upload-motion-video">${esc(s.videos?.[0]?.name||'选择动作视频 MP4 / WebM')}</button>${s.videos?.length?'<button type="button" class="wmd-btn" data-act="remove-motion-video">移除视频</button>':''}<p class="hint">上传一张人物图片和一段动作视频，按实际生成时长计费。</p></div>
        <div class="wmd-slots" id="slot-strip">
          <div class="wmd-slots-head">
            <span class="wmd-eyebrow">图像参考</span>
            <span class="wmd-slots-count tnum">${images.filter(Boolean).length}/${wf.images}</span>
            <span class="wmd-slots-sep"></span>
            <span class="wmd-eyebrow">音频参考</span>
            <span class="wmd-slots-count tnum">${audios.filter(Boolean).length}/${wf.audios}</span>
            <span class="wmd-slots-spacer"></span>
            <span class="wmd-slots-note">空槽不提交，提示词勿引用</span>
            <button type="button" class="wmd-link wmd-slots-link" data-act="upload-images" title="从本机选择图片，按原比例完整放入空槽">上传图片</button>
            <button type="button" class="wmd-link wmd-slots-link" data-act="upload-audio" title="从本机选择音频放入空音频槽">上传音频</button>
            <button type="button" class="wmd-link wmd-slots-link" data-act="pick-asset" title="从素材库挑一张图放进下一个空槽">粘贴图片</button>
            <button type="button" class="wmd-link wmd-slots-link" data-act="clear-assets">清空素材</button>
          </div>
          <div class="wmd-strip">
            ${Array.from({ length: wf.images }, (_, i) => refSlotHtml(images[i], i, nextEmpty)).join('')}
            <span class="wmd-strip-split"></span>
            ${Array.from({ length: wf.audios }, (_, i) => audioSlotHtml(audios[i], i)).join('')}
          </div>
          <input type="file" id="studio-image-file" accept="image/*" multiple hidden />
        </div>

        <div class="wmd-field wmd-field-grow" ${wf.promptRequired === false ? 'style="display:none"' : ''}>
          <div class="wmd-field-head is-prompt-head">
            <span class="wmd-field-label">提示词</span>
            <span class="wmd-prompt-count tnum" id="prompt-count">${s.prompt.length}字</span>
            <span class="wmd-field-right">
              <span class="wmd-view-switch">
                <button type="button" class="${mode === 'tags' ? 'is-on' : ''}" data-act="prompt-mode" data-mode="tags">标签</button>
                <button type="button" class="${mode === 'code' ? 'is-on' : ''}" data-act="prompt-mode" data-mode="code">代码</button>
              </span>
              <button type="button" class="wmd-tool-btn" data-act="optimize" data-format="${skillFmt}" ${state.busy ? 'disabled' : ''} title="${state.busy ? '正在调用语言渠道' : '按当前视频模型的分镜格式扩写提示词'}">${state.busy ? '优化中' : '提示词优化'}</button>
              <button type="button" class="wmd-tool-btn" data-act="insert-skeleton" data-format="${skillFmt}" title="插入当前视频模型对应的分镜骨架">模板</button>
              <button type="button" class="wmd-tool-btn" data-act="examples" title="插入示例提示词">示例</button>
              <span class="wmd-prompt-tools">
                <button type="button" class="wmd-iconbtn is-sm" data-act="copy-prompt" title="复制全文">${ICON.copy}</button>
                <button type="button" class="wmd-iconbtn is-sm" data-act="clear-prompt" title="清空">${ICON.trash}</button>
              </span>
            </span>
          </div>
          <div class="wmd-prompt-wrap${mode === 'code' ? ' is-editing' : ''}">
            <div class="wmd-prompt wmd-rich-editor ${mode === 'tags' ? '' : 'is-hidden'}" id="prompt-view" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="输入 @ 引用参考图、主体、音频、说话人、对白、画外音或镜头">${mode === 'tags' ? promptRichHtml(s.prompt) : ''}</div>
            <div class="wmd-mention-pop" id="studio-mention-pop" hidden></div>            <textarea class="wmd-prompt-code ${mode === 'code' ? '' : 'is-hidden'}" id="prompt-editor" spellcheck="false"
              placeholder="输入 @ 选择已上传的图片或音频。用 <Picture 1> 引用参考图、<Subject 1> 引用主体、<Audio 1> 引用音频，用 <d>[Chinese] 台词</d> 写对白。">${esc(s.prompt)}</textarea>
            <div id="studio-reference-menu" class="studio-reference-menu" role="listbox" aria-label="参考素材" hidden></div>
          </div>
          <div class="prompt-warn ${(s.warnings || []).length ? 'show' : ''}" id="prompt-warn">${(s.warnings || []).map((w) => '· ' + esc(w)).join('<br>')}</div>
        </div>

        <div class="wmd-compose">
          <div class="wmd-compose-params${Array.isArray(wf.models) && wf.models.length ? ' is-with-name' : ''}">
            <div class="wmd-field wmd-compose-field is-model">
              <div class="wmd-field-head"><span class="wmd-field-label">视频模型</span></div>
              <div class="wmd-select-wrap"><select class="wmd-select" id="p-model" title="${esc(wf.note || '')}">
                ${modelOptions}
              </select><span class="wmd-select-caret">${ICON.caret}</span></div>
            </div>
            ${studioModelFieldHtml(wf, s)}
            ${aspectField}
            <div class="wmd-field wmd-compose-field is-duration" ${!wf.durationKey ? 'style="display:none"' : ''}>
              <div class="wmd-field-head"><span class="wmd-field-label">时长</span></div>
              <div class="wmd-select-wrap"><select class="wmd-select" id="p-duration" ${(wf.durationOptions || []).length === 1 ? 'disabled' : ''}>
                ${((wf.durationOptions && wf.durationOptions.length) ? wf.durationOptions : Array.from({ length: 15 }, (_, i) => i + 1)).map((n) => `<option value="${n}" ${n === Number(s.duration) ? 'selected' : ''}>${n} 秒</option>`).join('')}
              </select><span class="wmd-select-caret">${ICON.caret}</span></div>
            </div>
            <div class="wmd-field wmd-compose-field is-num">
              <div class="wmd-field-head"><span class="wmd-field-label">数量</span></div>
              <input class="wmd-input" id="p-count" type="number" min="1" max="5" value="${Number(s.count) || 1}" />
            </div>
            ${isManager ? '' : `<div class="wmd-field wmd-compose-field is-num">
              <div class="wmd-field-head"><span class="wmd-field-label">种子</span></div>
              <input class="wmd-input wmd-mono" id="p-seed" value="${esc(s.seed)}" placeholder="随机" />
            </div>`}
            ${wf.pass2 ? `<div class="wmd-field wmd-compose-field is-num">
              <div class="wmd-field-head"><span class="wmd-field-label">${esc(wf.pass2.label || '二次采样')}</span></div>
              <div class="wmd-select-wrap"><select class="wmd-select" id="p-megapixels2">
                ${(wf.pass2.options || []).map((m) => `<option value="${m}" ${Number(m) === Number(s.megapixels2 || wf.pass2.default) ? 'selected' : ''}>${m}</option>`).join('')}
              </select><span class="wmd-select-caret">${ICON.caret}</span></div>
            </div>` : ''}
          </div>
          <div class="wmd-generate">
            <button type="button" class="wmd-btn wmd-btn-primary wmd-btn-lg" data-act="generate" ${state.busy ? 'disabled' : ''}>生成视频</button>
          </div>
        </div>
      </div>
    </aside>

    <div class="wmd-splitter" title="拖动调整创作台宽度"></div>

    <div class="wmd-stage">
      <div class="wmd-toolbar">
        <span class="wmd-toolbar-title">舞台</span>
        <span class="wmd-toolbar-spacer"></span>
        <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-act="go-jobs">任务日志</button>
      </div>
      <div class="wmd-stage-body">
        <div id="studio-stage">${stage}</div>
        <div id="studio-queue">${queue}</div>
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
    if (width) localStorage.setItem('wmd.panelWidth', String(width));
    else localStorage.removeItem('wmd.panelWidth');
  });

  const applyWorkflowDefaults = (next) => {
    if (!next) return;
    // state.studio 可能已被 WB.adopt 换成另一个对象，这里每次取最新引用
    const s = state.studio;
    s.workflowId = next.id;
    s.skillFormat = ''; // 换了渠道 / 模型，模板与优化格式回到跟随该渠道
    s.channelId = next.channelId || '';
    s.resolution = next.defaultResolution || '';
    s.megapixels = next.megapixelsDefault || 0;
    s.megapixels2 = next.pass2 ? next.pass2.default : 0;
    s.duration = Math.min(15, next.durationDefault || 10);
    if (next.defaultRatio) s.aspectRatio = next.defaultRatio;
    localStorage.setItem('wmd.workflowId', s.workflowId);
  };

  // 供外壳（左侧二级菜单）直接切换模型：先落盘当前分镜，再换到新厂商的目录，最后套模型参数
  window.__studioSwitchWorkflow = async (id) => {
    const next = workflowById(id);
    if (!next) return false;
    try { await WB.flush('video'); } catch (error) { /* 保存失败也继续切 */ }
    await WB.reloadVendor(undefined, vendorKeyOf(next));
    applyWorkflowDefaults(next);
    render();
    return true;
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
  const slotArea = $('.wmd-slots', root);
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
  const modelNameSel = $('#p-model-name', root);
  if (modelNameSel) modelNameSel.onchange = () => { s.model = modelNameSel.value; refreshStudioHint(); studioPersist(); };
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
      if (act === 'remove-motion-video') {s.videos=[];return render();}
      if (act === 'upload-motion-video') {
        const picker=document.createElement('input');picker.type='file';picker.accept='video/mp4,video/webm';
        picker.onchange=async()=>{if(!picker.files[0])return;try{const context=WB.context('video');const project=state.projectId;const video=await uploadFile(picker.files[0],'video');if(project!==state.projectId||context.itemId!==WB.context('video').itemId)return toast('已切换分镜，请重新选择视频',true);s.videos=[video];render();}catch(e){toast(e.message,true);}};
        picker.click();return;
      }
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
      if (act === 'insert-skeleton') {
        s.promptMode = 'code';
        const fmt = target.dataset.format === 'seedance'
          ? 'seedance'
          : target.dataset.format === 'h3' ? 'h3' : studioSkillFormat(s);
        s.skillFormat = fmt;
        const sdSkeleton = (state.prompt.seedance && state.prompt.seedance.skeleton) || state.prompt.seedanceSkeleton || '';
        if (fmt === 'seedance') {
          s.prompt = sdSkeleton;
          render();
          return toast(sdSkeleton ? '已插入 Seedance 2.0 分镜节拍稿' : 'Seedance 骨架没取到，刷新页面再试', !sdSkeleton);
        }
        s.prompt = state.prompt.skeleton;
        render();
        return toast('已插入六段式骨架');
      }
      if (act === 'examples') return openExamples();
      if (act === 'clear-prompt') { s.prompt = ''; s.warnings = []; s.promptMode = 'code'; return render(); }
      if (act === 'optimize') { s.promptMode = 'code'; return optimizePrompt(target.dataset.format === 'seedance' ? 'seedance' : 'h3'); }
      if (act === 'generate') return generate();
      if (act === 'stage-pick') {
        // 有任务在跑时舞台必须跟着实时任务（不然又会「没完成却显示完成」），回看先等它跑完
        if (studioOwnJobs().some((j) => j.status === 'running' || j.status === 'queued')) {
          return toast('这个分镜还在生成，等它跑完再回看历史');
        }
        state.stagePick = state.stagePick || {};
        state.stagePick[WB.context('video').itemId] = target.dataset.id;
        return render();
      }
      if (act === 'open-job') { return openJobDetail(target.dataset.id); }
      if (act === 'go-jobs') { state.logTab='video';localStorage.setItem('wmd.logs.tab','video');location.hash = '#logs'; return; }
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
      if (act === 'clear-assets') { s.images = s.images.map(() => null); s.audios = s.audios.map(() => null); s.videos=[]; return render(); }
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

/* 素材库选择器：人物 / 场景 / 道具 三个分类（对应素材库三个文件夹）+ 其他 */
const ASSET_PICKER_CATEGORIES = [['character', '人物'], ['scene', '场景'], ['prop', '道具'], ['other', '其他']];

function assetPickerItem(item, fallbackLabel) {
  return {
    path: item.path || '',
    rel: item.rel || '',
    name: item.name || '',
    url: item.url || '',
    kind: item.kind || 'image',
    bytes: item.bytes || 0,
    tag: item.typeLabel || item.category || fallbackLabel || '',
  };
}

async function openLibraryPicker(opts = {}) {
  const want = opts.accept === 'audio' ? 'audio' : 'image';
  const title = opts.title || (want === 'audio' ? '选择参考音频' : '选择参考图');
  let lib = null;
  try { lib = await api('/api/assets/library'); } catch { lib = null; }
  const legacy = ((state.assets && state.assets.items) || []).filter((i) => i.kind === want);
  const buckets = {};
  for (const [id, label] of ASSET_PICKER_CATEGORIES) {
    const raw = id === 'other'
      ? [...((lib && lib.other) || []), ...(((lib && lib.items) || []).filter((i) => i.type === 'storyboard')), ...legacy]
      : (((lib && lib.materials) || {})[id] || []);
    buckets[id] = raw.filter((i) => (i.kind || want) === want).map((i) => assetPickerItem(i, label));
  }
  const tabs = ASSET_PICKER_CATEGORIES;
  let active = (tabs.find(([id]) => buckets[id].length) || tabs[0])[0];

  const draw = () => {
    const items = buckets[active];
    const activeLabel = (tabs.find(([id]) => id === active) || tabs[0])[1];
    openModal(`
      <div class="modal-head"><h2>${esc(title)}</h2><span class="grow"></span>
        <button class="btn sm" id="picker-upload">上传本地${want === 'audio' ? '音频' : '图片'}</button>
        <button class="btn ghost sm" data-close="1">关闭</button></div>
      <div class="modal-body asset-picker">
        <div class="asset-picker-tabs">${tabs.map(([id, label]) => `<button type="button" class="chip ${id === active ? 'active' : ''}" data-picker-tab="${id}">${esc(label)}<span class="asset-picker-count">${buckets[id].length}</span></button>`).join('')}</div>
        <div class="grid-cards">${items.length ? items.map((item, i) => `
          <div class="asset-card" data-pick="${i}">
            <div class="asset-thumb">${want === 'audio' ? '♪' : `<img src="${esc(item.url)}" alt="" loading="lazy" />`}</div>
            <div class="asset-meta"><span class="name">${esc(item.name)}</span><span class="sub">${esc(item.tag)}${item.bytes ? ' · ' + fmtBytes(item.bytes) : ''}</span></div>
          </div>`).join('') : `<div class="empty">${esc(activeLabel)}文件夹里还没有${want === 'audio' ? '音频' : '图片'}，可以直接上传</div>`}</div>
      </div>`);
    $$('#modal-panel [data-picker-tab]').forEach((btn) => {
      btn.onclick = () => { active = btn.dataset.pickerTab; draw(); };
    });
    $$('#modal-panel [data-pick]').forEach((card) => {
      card.onclick = () => {
        const item = items[Number(card.dataset.pick)];
        if (item && opts.onPick) Promise.resolve(opts.onPick(item)).catch((err) => toast(err.message, true));
      };
    });
    const upload = $('#picker-upload');
    if (upload) upload.onclick = () => {
      const input = $('#file-input');
      input.accept = want === 'audio' ? 'audio/*' : 'image/*';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        try {
          const saved = await uploadFile(file, want);
          if (opts.onPick) await opts.onPick(assetPickerItem(saved, '本地上传'));
        } catch (err) { toast(err.message, true); }
      };
      input.click();
    };
  };
  draw();
}

function openImagePicker(slotIndex) {
  return openLibraryPicker({
    title: '选择参考图',
    onPick: (item) => {
      state.studio.images[slotIndex] = { path: item.path, name: item.name, subject: '', kind: 'image' };
      closeModal();
      render();
    },
  });
}

function openAudioPicker(slotIndex) {
  return openLibraryPicker({
    accept: 'audio',
    title: '选择参考音频',
    onPick: (item) => {
      state.studio.audios[slotIndex] = { path: item.path, name: item.name, kind: 'audio' };
      closeModal();
      render();
    },
  });
}

function studioAssetsPayload() {
  const s = state.studio;
  const assets = [];
  s.images.forEach((img, i) => { if (img) assets.push({ token: `<Picture ${i + 1}>`, kind: 'image', name: img.name, subjectName: img.subject || '', path: img.path }); });
  s.audios.forEach((audio, i) => { if (audio) assets.push({ token: `<Audio ${i + 1}>`, kind: 'audio', name: audio.name, path: audio.path }); });
  const subjects = s.images.map((img, i) => img && img.subject ? { ordinal: i + 1, name: img.subject, tokens: [`<Picture ${i + 1}>`] } : null).filter(Boolean);
  return { assets, subjects };
}

/**
 * 内置提示词模板跟着「渠道 + 视频模型」走：
 * 豆包 / Seedance → 白昼 v0.5 分镜格式；MiniMax H3（官网 API 工作流）→ 六段式。
 * 用户手动点过某一边时以手动为准，直到下次切渠道或模型再回到跟随。
 */
function skillFormatOf(wf) {
  const id = String((wf && wf.id) || '').toLowerCase();
  const label = String((wf && (wf.label || wf.display)) || '').toLowerCase();
  if (id.includes('doubao') || id.includes('seedance') || label.includes('豆包') || label.includes('seedance')) return 'seedance';
  return 'h3';
}

function studioSkillFormat(s, wf) {
  // 格式完全由当前视频模型决定：Seedance 页面只出现 Seedance 工具，H3 页面只出现 H3 工具
  return skillFormatOf(wf || currentWorkflow());
}

/**
 * 视频模型名称：豆包网页有模型下拉（Seedance 2.0 Mini / Fast），文案必须一字不差。
 * 工作流没带 models（Gemini、AutoDL、自定义渠道）就返回空，不往任务里塞模型。
 */
function studioModelName(wf, s) {
  const list = Array.isArray(wf && wf.models) ? wf.models : [];
  if (!list.length) return '';
  const value = String((s && s.model) || '').trim();
  return list.includes(value) ? value : '';
}

function studioModelFieldHtml(wf, s) {
  const list = Array.isArray(wf && wf.models) ? wf.models : [];
  if (!list.length) return '';
  const current = studioModelName(wf, s);
  return `<div class="wmd-field wmd-compose-field is-name">
              <div class="wmd-field-head"><span class="wmd-field-label">模型名称</span></div>
              <div class="wmd-select-wrap"><select class="wmd-select" id="p-model-name" title="发给管理器的视频模型名称，必须和网页下拉文案一字不差；不指定就沿用网页当前选中的模型">
                <option value="" ${current ? '' : 'selected'}>跟随页面当前模型</option>
                ${list.map((model) => `<option value="${esc(model)}" ${model === current ? 'selected' : ''}>${esc(model)}</option>`).join('')}
              </select><span class="wmd-select-caret">${ICON.caret}</span></div>
            </div>`;
}

/** 生成按钮下面那行参数摘要：管理器 · 16:9 · 15s（选了模型再单独一行 Seedance 2.0 Fast）。
 *  模型名比这行长，所以拆成两段：窄的时候只在两段之间折行，不会把「15s」孤零零甩到一行。 */
function studioGenerateHintParts(wf, s) {
  const isAuto = wf && wf.provider === 'autodl';
  const size = esc(isAuto ? ((s && s.resolution) || (wf && wf.defaultResolution)) : String((s && s.aspectRatio) || '').split(' ')[0]);
  const duration = wf && wf.durationKey ? ` · ${(s && s.duration)}s` : ' · 按实际生成时长';
  return {
    params: `${isAuto ? '官网 API' : esc((wf && wf.providerLabel) || '自定义')} · ${size}${duration}`,
    model: esc(studioModelName(wf, s)),
  };
}

function studioGenerateHint(wf, s) {
  const parts = studioGenerateHintParts(wf, s);
  return parts.model ? `${parts.params} · ${parts.model}` : parts.params;
}

function studioGenerateHintHtml(wf, s) {
  const parts = studioGenerateHintParts(wf, s);
  return `<span class="hint-seg">${parts.params}</span>${parts.model ? ` <span class="hint-seg">${parts.model}</span>` : ''}`;
}

function refreshStudioHint() {
  const wf = currentWorkflow();
  const hint = $('#studio-generate-hint');
  if (hint) hint.innerHTML = studioGenerateHintHtml(wf, state.studio);
  const box = hint && hint.closest('.wmd-generate-hint');
  if (box) box.classList.toggle('is-two-line', Boolean(studioModelName(wf, state.studio)));
}

let validateTimer = null;function validatePromptSoon() {
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

async function optimizePrompt(format = 'h3') {
  const s = state.studio;
  const mode = format === 'seedance' ? 'seedance' : 'h3';
  if (!s.prompt.trim()) return toast('先写点想要的画面再优化', true);
  s.skillFormat = mode;
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
        format: mode,
      },
    });
    s.prompt = data.prompt;
    s.warnings = data.warnings || [];
    const label = mode === 'seedance' ? 'Seedance 2.0' : 'H3';
    const stats = (mode === 'seedance' && data.stats)
      ? ` · ${data.duration ? data.duration + ' 秒 / ' : ''}${data.stats.shots} 镜 / ${data.stats.dialogue} 句`
      : '';
    toast(`优化完成 · ${label} · ${data.model || ''}${stats} · ${Math.round(data.elapsedMs / 1000)} 秒`);
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
  if (wf.promptRequired !== false && !s.prompt.trim()) return toast('提示词不能为空', true);
  if (wf.videos && !s.videos?.length) return toast('请添加动作参考视频',true);
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
      images: s.images.slice(0,wf.images).filter(Boolean).map((img) => ({ path: img.path, name: img.name, subject: img.subject || '' })),
      audios: s.audios.slice(0,wf.audios).filter(Boolean).map((audio) => ({ path: audio.path, name: audio.name })),
      videos: (s.videos || []).slice(0,wf.videos||0).map(video=>({path:video.path,name:video.name})),
      duration: s.duration,
      model: studioModelName(wf, s),
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
    // 刚提交了新任务：舞台回到实时任务，不要停在上一次回看的旧版
    if (state.stagePick) delete state.stagePick[workbenchContext.itemId];
    if (WB.context("video").itemId === workbenchContext.itemId) state.lastJobId = data.jobs[0].id;
    try { localStorage.setItem('wmd.lastJobId', state.lastJobId); } catch { /* ignore */ }
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
          ${job.provider === 'manager' && job.remotePromptId && (['failed', 'canceled'].includes(job.status) || (job.status === 'queued' && job.held)) ? `<button class="btn sm" data-act="resume" data-id="${job.id}">继续查询／下载</button>` : ''}
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
      if (act === 'go-logs') { state.logTab='video';localStorage.setItem('wmd.logs.tab','video');location.hash='#logs';return; }
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

const ASSET_VIEW_KEY = 'wmd.assets.view';
function saveAssetView(view) {
  try {
    if (view && view.kind && view.kind !== 'overview') localStorage.setItem(ASSET_VIEW_KEY, JSON.stringify(view));
  } catch (error) { /* 忽略存储失败 */ }
}
function currentAssetView() {
  const data = state.assetLibrary;
  if (!state.assetView) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(ASSET_VIEW_KEY) || 'null'); } catch (error) { saved = null; }
    // 刷新后回到上次所在的分类；第一次进来默认「人物素材」
    state.assetView = saved && saved.kind && saved.kind !== 'overview'
      ? saved
      : { kind: 'dir', rel: '素材/人物', deep: false };
  }
  const raw = state.assetView || { kind: 'overview' };
  // 老的「素材分类」视图统一成目录视图：素材/<人物|场景|道具>
  const view = raw.kind === 'material'
    ? { kind: 'dir', rel: '素材/' + assetTypeMeta(raw.type).label, type: raw.type }
    : raw;
  saveAssetView(view);
  if (view.kind === 'dir' && !view.rel) return { kind: 'dir', rel: '素材/人物', deep: false };
  if (view.kind === 'shot') {
    const task = (data?.tasks || []).find((row) => (view.taskId ? row.id === view.taskId : row.title === view.taskTitle));
    if (!task || !(task.shots || []).some((shot) => shot.name === view.name)) return { kind: 'shot-root' };
    return { ...view, taskId: task.id, taskTitle: task.title };
  }
  return view;
}

async function loadAssetLibrary() {
  state.assetLibrary = await api('/api/assets/library');
  // 重新扫描后目录缓存作废，避免显示删掉的文件
  state.assetTree = {};
  return state.assetLibrary;
}

/** 只允许一个在途请求：每次 render 都重开请求会变成死循环（页面直接卡死）。 */
function ensureAssetLibrary() {
  if (state.assetLibrary || state.assetLibraryLoading) return;
  state.assetLibraryLoading = true;
  loadAssetLibrary()
    .then(() => { state.assetLibraryLoading = false; if (state.route === 'assets') render(); })
    .catch((err) => { state.assetLibraryLoading = false; toast(err.message, true); });
}

/** 素材树单层：第一次展开某层时才去读它的子目录，页面不用一次加载几千个文件。
 *  deep=true 读这个分类下所有文件（点分类时右侧要列全部）。
 *  同一层只发一个请求；在途时返回同一个 promise，避免 render→bind→load 互相触发死循环。 */
function assetDirKey(rel, deep) {
  return (deep ? 'deep::' : '') + rel;
}

function loadAssetDir(rel, deep = false) {
  state.assetTree = state.assetTree || {};
  const key = assetDirKey(rel, deep);
  const cached = state.assetTree[key];
  if (cached && cached.loaded) return Promise.resolve(cached);
  if (cached && cached.promise) return cached.promise;
  const entry = { loading: true, loaded: false };
  const query = '?rel=' + encodeURIComponent(rel) + (deep ? '&deep=1' : '');
  entry.promise = api('/api/assets/dir' + query)
    .then((data) => {
      const done = { ...data, loading: false, loaded: true, deep: Boolean(deep) };
      state.assetTree[key] = done;
      return done;
    })
    .catch((err) => {
      const failed = { loading: false, loaded: true, error: err.message, dirs: [], files: [] };
      state.assetTree[key] = failed;
      return failed;
    });
  state.assetTree[key] = entry;
  return entry.promise;
}

function assetDirInfo(rel, deep = false) {
  return (state.assetTree || {})[assetDirKey(rel, deep)] || null;
}

/** 树里的子目录用「读到的任意一份」都行：深读（deep）里也带着同样一层 dirs。 */
function assetDirAny(rel) {
  return assetDirInfo(rel) || assetDirInfo(rel, true) || null;
}

function assetLibraryEmpty(text, hint) {
  return `<div class="card"><div class="empty"><strong>${esc(text)}</strong><p>${esc(hint)}</p></div></div>`;
}

function assetTaskKey(task) { return task.id || task.title; }

/** 左侧资产树的一行：整行可点（不用非得点小箭头），箭头跟在名称后面；
 *  分类行点一下展开/收起并列出这一类全部文件，项目行点一下直接列出那一层的文件。 */
function assetDirRowHtml(rel, view, depth, countHint) {
  const expanded = (state.assetExpanded || {})['dir:' + rel] === true;
  const info = assetDirAny(rel);
  const name = rel.split('/').pop();
  const active = view.kind === 'dir' && view.rel === rel;
  const count = info && info.loaded ? info.total : (typeof countHint === 'number' ? countHint : '');
  // 结构只有两层：分类（人物/场景/道具）→ 项目文件夹，项目文件夹里全是文件。
  const hasDirs = depth === 0 || Boolean(info && info.loaded && (info.dirs || []).length);
  return `<div class="lib-dir-block">
    <button type="button" class="lib-dir-row ${active ? 'active' : ''}" data-lib-dir="${esc(rel)}" data-lib-dir-depth="${depth}" title="${esc(rel)}" style="padding-left:${8 + depth * 14}px">
      <span class="lib-node-main">${esc(name)}</span>
      ${hasDirs ? `<span class="lib-caret${expanded ? ' is-open' : ''}" aria-hidden="true"></span>` : ''}
      <em class="lib-count">${count}</em>
    </button>
    ${expanded && hasDirs ? assetDirChildrenHtml(rel, view, depth + 1) : ''}
  </div>`;
}

/** 展开后的下一层：只列子目录；文件不列在树上，点目录时整批显示在右侧。 */
function assetDirChildrenHtml(rel, view, depth) {
  const info = assetDirAny(rel);
  if (!info || (!info.loaded && info.loading)) return `<div class="lib-empty" style="padding-left:${8 + depth * 14}px">读取中…</div>`;
  if (info.error) return `<div class="lib-empty" style="padding-left:${8 + depth * 14}px">${esc(info.error)}</div>`;
  const dirs = info.dirs || [];
  if (!dirs.length) return `<div class="lib-empty" style="padding-left:${8 + depth * 14}px">没有子文件夹</div>`;
  return dirs.map((dir) => assetDirRowHtml(dir.rel, view, depth, dir.total)).join('');
}


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
      ${ASSET_MATERIALS.map((material) => {
        const rel = '素材/' + material.label;
        const total = (data.totals && data.totals[material.id]) || 0;
        return assetDirRowHtml(rel, view, 0, total);
      }).join('')}
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

/** 默认总览：只显示三个分类和递归数量，不读任何子目录；点开哪层才读哪层。 */
function renderAssetOverview(data) {
  const cards = ASSET_MATERIALS.map((material) => {
    const total = (data.totals && data.totals[material.id]) || 0;
    return `<button type="button" class="asset-folder" data-lib-dir="${esc('素材/' + material.label)}" data-lib-dir-depth="0" title="打开 assets/素材/${esc(material.label)}">
      <span class="asset-folder-icon">📁</span>
      <span class="asset-folder-name">${esc(material.label)}</span>
      <em>${total}</em>
    </button>`;
  }).join('');
  return `<div class="library-main-head">
    <div><h2>素材库</h2><p class="hint">左侧点分类展开项目文件夹，点项目在那个位置列出这一层的文件（点开才读取，进页面不扫目录）</p></div>
  </div>
  <div class="asset-folders">${cards}</div>`;
}

/** 人物 / 场景 / 道具：三栏——文件夹 → 文件列表 → 预览 */
function renderDirView(view) {
  const rel = view.rel || '素材/人物';
  const parts = rel.split('/');
  const material = ASSET_MATERIALS.find((row) => rel === '素材/' + row.label)
    || ASSET_MATERIALS.find((row) => rel.startsWith('素材/' + row.label))
    || ASSET_MATERIALS[0];
  const rootRel = '素材/' + material.label;
  const rootInfo = assetDirAny(rootRel);
  const folders = (rootInfo && rootInfo.dirs) || [];
  const info = assetDirAny(rel);
  const query = String(state.assetQuery || '').toLowerCase();
  const files = ((info && info.files) || []).filter((file) => !query || String(file.name).toLowerCase().includes(query));
  const activeName = view.file || '';
  const active = files.find((file) => file.name === activeName) || null;

  const crumbs = parts.map((part, index) => {
    const target = parts.slice(0, index + 1).join('/');
    const isLast = index === parts.length - 1;
    const node = isLast
      ? `<span class="asset-crumb is-current">${esc(part)}</span>`
      : `<button type="button" class="asset-crumb" data-asset-crumb="${esc(target)}">${esc(part)}</button>`;
    return (index ? '<span class="asset-crumb-sep">/</span>' : '') + node;
  }).join('');

  const folderCol = folders.length
    ? folders.map((dir) => {
      const on = dir.rel === rel;
      return `<button type="button" class="asset-nav-item${on ? ' is-on' : ''}" data-asset-folder="${esc(dir.rel)}" title="${esc(dir.rel)}">
        <span class="asset-nav-icon">📁</span>
        <span class="asset-nav-name">${esc(dir.name || dir.rel.split('/').pop())}</span>
        <em>${dir.total == null ? '' : dir.total}</em>
      </button>`;
    }).join('')
    : `<div class="shot-col-empty">${esc(material.label)}下面还没有项目文件夹</div>`;

  const fileCol = files.length
    ? files.map((file) => {
      const on = file.name === activeName;
      return `<button type="button" class="asset-nav-item asset-nav-file${on ? ' is-on' : ''}" data-asset-file="${esc(file.name)}" data-asset-rel="${esc(rel)}" title="${esc(file.name)}">
        <span class="asset-nav-thumb">${file.media === 'image' ? `<img src="${file.url}" alt="" loading="lazy" />` : '♪'}</span>
        <span class="asset-nav-name">${esc(file.name)}</span>
      </button>`;
    }).join('')
    : `<div class="shot-col-empty">${info && info.loading && !info.loaded ? '读取中…' : '这个文件夹还没有文件'}</div>`;

  const detail = active
    ? `<div class="asset-preview-stage">
        ${active.media === 'image'
          ? `<img src="${active.url}" alt="${esc(active.name)}" />`
          : '<span class="asset-preview-audio">音频文件</span>'}
        <div class="asset-preview-tools">
          <button type="button" class="wmd-tool-btn" data-asset-copy="${esc(active.url)}" data-asset-name="${esc(active.name)}" title="复制图片">复制</button>
          <button type="button" class="wmd-tool-btn" data-asset-download="${esc(active.url)}" data-asset-name="${esc(active.name)}" title="下载图片">下载</button>
          <button type="button" class="wmd-tool-btn" data-asset-meta-toggle="1" title="查看参数">参数</button>
        </div>
        <dl class="asset-preview-meta" id="asset-preview-meta" hidden>
          <div><dt>名称</dt><dd>${esc(active.name)}</dd></div>
          <div><dt>路径</dt><dd class="mono">${esc(active.rel)}</dd></div>
          <div><dt>大小</dt><dd>${fmtBytes(active.bytes || 0)}</dd></div>
        </dl>
      </div>`
    : `<div class="asset-preview-stage is-empty"><div class="shot-detail-empty"><b>选择中间的文件</b><p>点开图片在右侧预览。</p></div></div>`;

  return `<div class="library-main-head">
    <div><nav class="asset-crumbs" aria-label="当前位置">${crumbs}</nav><p class="hint">${files.length} 个文件</p></div>
    <div class="library-actions">
      <button type="button" class="btn sm ghost" data-act="open-assets">目录</button>
      ${material ? `<button class="btn sm" data-act="upload-material" data-material="${material.id}">上传</button>` : ''}
      <button type="button" class="btn sm ghost" data-act="refresh-assets">刷新</button>
    </div>
  </div>
  <div class="asset-browser">
    <nav class="shot-col" aria-label="文件夹">${folderCol}</nav>
    <nav class="shot-col" aria-label="文件">${fileCol}</nav>
    <section class="shot-col asset-preview-col">${detail}</section>
  </div>`;
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

/* 分镜详情：9 宫格参考图 + 事实 */
function renderShotDetail(shot) {
  return `<div class="slot-grid">${shot.slots.map((slot) => renderSlotCard(shot, slot)).join('')}</div>
${renderShotFacts(shot)}`;
}

/* 分镜三栏：任务 → 镜头（按顺序竖排）→ 详情 */
function renderShotBrowser(data, view) {
  const tasks = data.tasks || [];
  const activeTask = tasks.find((row) => (view.taskId ? row.id === view.taskId : row.title === view.taskTitle)) || tasks[0] || null;
  const shots = activeTask ? (activeTask.shots || []) : [];
  const activeShot = view.kind === 'shot' ? shots.find((row) => row.name === view.name) : null;

  const taskCol = tasks.map((task) => {
    const key = assetTaskKey(task);
    const on = activeTask && assetTaskKey(activeTask) === key;
    return `<button type="button" class="shot-nav-item${on ? ' is-on' : ''}" data-shot-task="${esc(key)}" data-task-id="${esc(task.id || '')}" data-task-title="${esc(task.title)}" title="${esc(task.title)}">
      <span class="shot-nav-name">${esc(task.title)}</span><em>${task.count}</em>
    </button>`;
  }).join('');

  const shotCol = shots.map((shot, index) => {
    const on = activeShot && activeShot.name === shot.name;
    return `<button type="button" class="shot-nav-item shot-nav-shot${on ? ' is-on' : ''}" data-shot-nav="${esc(shot.name)}" data-task-id="${esc(activeTask.id || '')}" data-task-title="${esc(activeTask.title)}" title="${esc(shot.name)}">
      <span class="shot-nav-index">${String(index + 1).padStart(2, '0')}</span>
      <span class="shot-nav-name">${esc(shot.name)}</span><em>${shot.count}/9</em>
    </button>`;
  }).join('');

  const detail = activeShot
    ? renderShotDetail(activeShot)
    : (shots.length
      ? `<div class="shot-detail-empty"><b>选择左侧的镜头</b><p>按顺序点开镜头，查看它的 9 张参考图。</p></div>`
      : assetLibraryEmpty('这个任务还没有镜头', '在创作台建好镜头后会同步过来。'));

  return `<div class="library-main-head">
    <div><nav class="asset-crumbs" aria-label="当前位置"><span class="asset-crumb is-current">分镜</span></nav><p class="hint">${tasks.length} 个任务 · ${shots.length} 个镜头</p></div>
    <div class="library-actions">
      <button type="button" class="btn sm ghost" data-act="open-assets">目录</button>
      <button type="button" class="btn sm ghost" data-act="new-task">＋ 新建任务</button>
      <button type="button" class="btn sm ghost" data-act="new-shot">＋ 新建镜头</button>
      <button type="button" class="btn sm ghost" data-act="refresh-assets">刷新</button>
    </div>
  </div>
  <div class="shot-browser">
    <nav class="shot-col" aria-label="任务">${taskCol || '<div class="shot-col-empty">还没有任务</div>'}</nav>
    <nav class="shot-col" aria-label="镜头">${shotCol || '<div class="shot-col-empty">这个任务还没有镜头</div>'}</nav>
    <section class="shot-col shot-detail">${detail}</section>
  </div>`;
}

function renderAssets() {
  if (!state.assetLibrary) return `<div class="empty"><span class="spinner"></span></div>`;
  const data = state.assetLibrary;
  const view = currentAssetView();
  const body = (view.kind === 'shot' || view.kind === 'shot-root' || view.kind === 'shot-task')
    ? renderShotBrowser(data, view)
    : view.kind === 'other' ? renderOtherView(data)
      : view.kind === 'dir' ? renderDirView(view)
        : renderAssetOverview(data);
  return `<div class="library-page" style="width:100%">
    ${renderAssetSidebar(data, view)}
    <section class="library-main">
      ${body}
    </section>
  </div>`;
}

/* 左侧二级菜单直接切分类：人物 / 场景 / 道具 进目录，分镜进分镜三栏 */
window.__assetsOpen = async (target) => {
  if (target === 'shots') {
    state.assetView = { kind: 'shot-root' };
    state.assetExpanded = {};
    if (state.route !== 'assets') { location.hash = '#assets'; return true; }
    render();
    return true;
  }
  const rel = String(target || '素材/人物');
  const go = async () => {
    state.assetView = { kind: 'dir', rel, deep: false };
    syncHash('assets', { dir: rel });
    render();
    await loadAssetDir(rel, false);
    // 分类根没有直接文件时，自动进第一个项目文件夹，三栏才不会是空的
    const info = assetDirAny(rel);
    const first = info && info.dirs && info.dirs[0];
    if (first && !(info.files || []).length) {
      state.assetView = { kind: 'dir', rel: first.rel, deep: false };
      syncHash('assets', { dir: first.rel });
      await loadAssetDir(first.rel, false);
    }
    render();
  };
  if (state.route !== 'assets') {
    location.hash = '#assets';
    setTimeout(go, 60);
    return true;
  }
  await go();
  return true;
};

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

/** 目录视图里的文件不在 assetLibrary.items 里，点图时要能从目录缓存里找回这条记录。 */
function findAssetItem(rel) {
  const key = String(rel || '').replace(/\\/g, '/');
  const flat = (state.assetLibrary && state.assetLibrary.items) || [];
  const hit = flat.find((row) => String(row.rel || '').replace(/\\/g, '/') === key);
  if (hit) return hit;
  for (const info of Object.values(state.assetTree || {})) {
    const file = (info && info.files || []).find((row) => String(row.rel || '').replace(/\\/g, '/') === key);
    if (file) return { ...file, kind: file.media, path: assetAbsPath(file.rel) };
  }
  return null;
}

function assetTypeLabelOf(rel) {
  const seg = String(rel || '').split('/')[1] || '';
  const hit = ASSET_MATERIALS.find((row) => row.label === seg);
  return hit ? hit.label : '';
}
function assetAbsPath(rel) {
  const root = (state.assetLibrary && state.assetLibrary.root) || '';
  const tail = String(rel || '').replace(/^[\\/]+/, '').replace(/\//g, '\\');
  return root ? root.replace(/[\\/]+$/, '') + '\\' + tail : tail;
}

/** 点图弹窗：左边放大看，右边资料卡（项目归属、绝对位置、大小、尺寸、时间）。 */
function assetDetailModal(item) {
  const rel = String(item.rel || '');
  const abs = item.path || assetAbsPath(rel);
  const project = state.project || {};
  const segs = rel.split('/');
  const typeLabel = item.typeLabel || assetTypeLabelOf(rel) || '其他';
  const folder = segs.slice(0, -1).join(' / ');
  const stamp = item.mtime ? new Date(item.mtime).toLocaleString('zh-CN', { hour12: false }) : '';
  const facts = [
    ['分类', typeLabel],
    ['项目归属', `${project.name || '当前项目'}${project.id ? '（' + project.id + '）' : ''}`],
    ['所在目录', folder || '—'],
    ['相对路径', rel || '—', true],
    ['绝对位置', abs || '—', true],
    ['文件大小', item.bytes ? fmtBytes(item.bytes) : '—'],
    ['尺寸', item.width && item.height ? `${item.width}×${item.height}` : '读取中…', true],
    ['修改时间', stamp || '—'],
  ];
  const panel = openModal(`<div class="modal-head"><h2>${esc(item.name)}</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body asset-detail-body">
      <div class="asset-preview asset-detail-preview">${item.kind === 'image' ? `<img src="${esc(item.url)}" alt="${esc(item.name)}" />` : `<audio src="${esc(item.url)}" controls></audio>`}</div>
      <dl class="asset-detail-facts">${facts.map(([label, value, wide]) => `<div class="${wide ? 'wide' : ''}"><dt>${esc(label)}</dt><dd class="${/路径|位置/.test(label) ? 'mono' : ''}">${esc(value)}</dd></div>`).join('')}</dl>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" data-asset-copy="1">复制路径</button>
      <button class="btn ghost" data-asset-reveal="1">在文件夹中显示</button>
      <button class="btn" data-asset-rename="1">重命名</button>
      <button class="btn ghost" data-asset-delete="1">删除</button>
      <span class="grow"></span>
      <button class="btn" data-close="1">关闭</button>
    </div>`);
  if (item.kind === 'image') {
    const img = panel.querySelector('.asset-detail-preview img');
    if (img) img.onload = () => {
      const row = [...panel.querySelectorAll('.asset-detail-facts > div')].find((div) => div.querySelector('dt') && div.querySelector('dt').textContent === '尺寸');
      const cell = row && row.querySelector('dd');
      if (cell) cell.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
    };
  }
  panel.querySelector('[data-asset-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(abs); toast('已复制绝对路径'); } catch { toast('复制失败', true); }
  };
  panel.querySelector('[data-asset-reveal]').onclick = async () => {
    try { await api('/api/reveal', { method: 'POST', body: { path: abs } }); } catch (err) { toast(err.message, true); }
  };
  panel.querySelector('[data-asset-rename]').onclick = () => askText('重命名素材', item.name, '文件名', async (name) => {
    if (!name) return;
    await api('/api/assets/material/rename', { method: 'POST', body: { rel, name } });
    await loadAssetLibrary(); render(); toast('素材已重命名');
  });
  panel.querySelector('[data-asset-delete]').onclick = () => assetConfirm(`删除「${item.name}」？`, '文件会从素材库删除，不能恢复。', async () => {
    await api('/api/assets/material/delete', { method: 'POST', body: { rel } });
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
  // 只把总览读一次；目录树是纯本地缓存，用户点开某一层才去读盘，进来不会自己扫目录
  ensureAssetLibrary();
  // 刷新后回到上次分类：该层目录还没读过就先读一次
  {
    const view0 = currentAssetView();
    if (view0.kind === 'dir' && view0.rel && !assetDirAny(view0.rel)) {
      loadAssetDir(view0.rel, false).then(() => {
        const info = assetDirAny(view0.rel);
        const first = info && info.dirs && info.dirs[0];
        // 分类根没有直接文件时，自动落到第一个项目文件夹，三栏不会是空的
        if (first && !(info.files || []).length) {
          state.assetView = { kind: 'dir', rel: first.rel, deep: false };
          syncHash('assets', { dir: first.rel });
          return loadAssetDir(first.rel, false);
        }
        return null;
      }).then(() => { if (state.route === 'assets') render(); }).catch(() => {});
    }
  }
  // 点预览区以外的空白处收起参数浮层（全局只绑一次）
  if (!window.__assetMetaOutsideBound) {
    window.__assetMetaOutsideBound = true;
    document.addEventListener('click', (e) => {
      const box = document.querySelector('#asset-preview-meta');
      if (!box || box.hidden) return;
      if (box.contains(e.target) || (e.target.closest && e.target.closest('[data-asset-meta-toggle]'))) return;
      box.hidden = true;
    });
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
    // 预览区右上角：复制 / 下载 / 参数
    const copyBtn = event.target.closest('[data-asset-copy]');
    if (copyBtn) {
      event.preventDefault();
      try {
        const src = copyBtn.dataset.assetCopy;
        const blob = await (await fetch(src)).blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
        toast('图片已复制到剪贴板');
      } catch (err) {
        toast('复制失败：' + err.message, true);
      }
      return;
    }
    const downBtn = event.target.closest('[data-asset-download]');
    if (downBtn) {
      event.preventDefault();
      const a = document.createElement('a');
      a.href = downBtn.dataset.assetDownload;
      a.download = downBtn.dataset.assetName || '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const metaBtn = event.target.closest('[data-asset-meta-toggle]');
    if (metaBtn) {
      event.preventDefault();
      const box = document.querySelector('#asset-preview-meta');
      if (box) box.hidden = !box.hidden;
      return;
    }
    // 文件夹列：切到该文件夹，文件列跟着换
    const folder = event.target.closest('[data-asset-folder]');
    if (folder) {
      const rel = folder.dataset.assetFolder;
      state.assetView = { kind: 'dir', rel, deep: false };
      syncHash('assets', { dir: rel });
      render();
      const info = assetDirInfo(rel, false);
      if (!info || (!info.loaded && !info.loading)) {
        await loadAssetDir(rel, false);
        if (state.route === 'assets') render();
      }
      return;
    }
    // 文件列：选中后在右侧预览
    const fileNode = event.target.closest('[data-asset-file]');
    if (fileNode) {
      state.assetView = { kind: 'dir', rel: fileNode.dataset.assetRel, deep: false, file: fileNode.dataset.assetFile };
      syncHash('assets', { dir: fileNode.dataset.assetRel });
      render();
      return;
    }
    // 面包屑：回到上一级
    const crumb = event.target.closest('[data-asset-crumb]');
    if (crumb) {
      const rel = crumb.dataset.assetCrumb;
      state.assetView = { kind: 'dir', rel, deep: false };
      syncHash('assets', { dir: rel });
      render();
      const info = assetDirInfo(rel, false);
      if (!info || (!info.loaded && !info.loading)) {
        await loadAssetDir(rel, false);
        if (state.route === 'assets') render();
      }
      return;
    }
    // 分镜分类的面包屑：回到任务列表
    if (event.target.closest('[data-asset-crumb-shots]')) {
      state.assetView = { kind: 'shot-root' };
      render();
      return;
    }
    // 分镜分类里的任务：切任务，镜头列跟着换
    const shotTask = event.target.closest('[data-shot-task]');
    if (shotTask) {
      state.assetView = {
        kind: 'shot-task',
        taskId: shotTask.dataset.taskId,
        taskTitle: shotTask.dataset.taskTitle,
      };
      render();
      return;
    }
    // 镜头列：选中某个镜头，右侧出 9 宫格
    const shotNav = event.target.closest('[data-shot-nav]');
    if (shotNav) {
      state.assetView = {
        kind: 'shot',
        name: shotNav.dataset.shotNav,
        taskId: shotNav.dataset.taskId,
        taskTitle: shotNav.dataset.taskTitle,
      };
      render();
      return;
    }
    // 资产树：整行可点（箭头跟在名称后面，只是提示）。
    //   分类行 → 展开/收起，并在右侧列出这一类「全部项目」的文件（deep）
    //   项目行 → 右侧只列它这一层的文件
    const dirNode = event.target.closest('[data-lib-dir]');
    if (dirNode) {
      const rel = dirNode.dataset.libDir;
      const depth = Number(dirNode.dataset.libDirDepth || 0);
      const deep = depth === 0;
      if (deep) {
        const key = 'dir:' + rel;
        state.assetExpanded = { ...(state.assetExpanded || {}), [key]: !((state.assetExpanded || {})[key] === true) };
      }
      const label = rel.split('/').pop();
      const material = ASSET_MATERIALS.find((row) => row.label === label) || ASSET_MATERIALS.find((row) => rel.startsWith('素材/' + row.label));
      state.assetView = { kind: 'dir', rel, deep, type: material ? material.id : '' };
      render();
      const info = assetDirInfo(rel, deep);
      if (!info || (!info.loaded && !info.loading)) {
        await loadAssetDir(rel, deep);
        if (state.route === 'assets') render();
      }
      return;
    }
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
      const item = findAssetItem(card.dataset.assetRel);
      if (item) return assetDetailModal(item);
      toast('这个文件已经不在磁盘上了', true);
      return;
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

function episodeData() {
  const data = state.episodes || {};
  return {
    episodes: Array.isArray(data.episodes) ? data.episodes : [],
    assignments: data.assignments && typeof data.assignments === 'object' ? data.assignments : {},
    jianying: data.jianying || null,
  };
}

function mediaEpisodeMatches(item, filter) {
  if (!filter) return true;
  const { assignments } = episodeData();
  const assigned = assignments[item.rel] || '';
  if (filter === '__none__') return !assigned;
  return assigned === filter;
}

function episodeNameOf(id) {
  const found = episodeData().episodes.find((episode) => episode.id === id);
  return found ? found.name : '';
}

/** 媒体库任务菜单所需的数据（只取聚合，不拉文件明细）。 */
async function loadMediaTaskMenu() {
  const kind = state.mediaKind || 'video';
  if (!state.episodes) await reloadMediaEpisodes();
  state.mediaTasks = await api('/api/media/tasks?kind=' + kind);
  if (state.mediaTask) await loadMediaTaskItems(state.mediaTask);
  else state.mediaTaskItems = null;
}

async function loadMediaTaskItems(taskTitle) {
  const kind = state.mediaKind || 'video';
  const data = await api('/api/media?kind=' + kind + '&task=' + encodeURIComponent(taskTitle || ''));
  state.mediaTaskItems = data;
  state.mediaTask = taskTitle || '';
  return data;
}

function mediaProjectHead(data, extraActions) {
  // 本地磁盘路径不展示；需要时用「打开目录」按钮
  return `<div class="page-head">
    <div><h1>媒体库</h1></div>
    <div class="page-actions">${extraActions}</div>
  </div>`;
}

/* 左侧二级菜单：全部成片 / 某个任务的分镜成片 */
window.__mediaSetEpisode = async (target) => {
  state.mediaKind = 'video';
  if (state.route !== 'media') {
    location.hash = '#media';
    return true;
  }
  if (!target) {
    state.mediaTask = '';
    state.mediaTaskItems = null;
    state.mediaEpisode = '';
    syncHash('media', {});
    render();
    return true;
  }
  const title = String(target).startsWith('task:') ? String(target).slice(5) : String(target);
  try { await loadMediaTaskItems(title); } catch (error) { /* 忽略 */ }
  state.mediaEpisode = '';
  syncHash('media', { task: title });
  render();
  return true;
};

/** 默认视图：按任务列出菜单，一个缩略图都不预加载。 */
function renderMediaTaskMenu() {
  const kind = state.mediaKind || 'video';
  const data = state.mediaTasks;
  if (!data) return `<div class="empty"><span class="spinner"></span></div>`;
  const counts = data.counts || { video: 0, image: 0 };
  const tasks = data.tasks || [];
  const actions = `
      <button class="btn" data-act="media-import" title="把你自己生成或下载的成片复制进媒体库目录，并登记任务名/分镜名">导入成片</button>
      <button class="btn" data-act="open-media-root">打开目录</button>
      <button class="btn" data-act="refresh-media">刷新</button>
      <button class="btn" data-act="episode-new">新建分集</button>`;
  const menu = tasks.length ? `<div class="media-task-menu">${tasks.map((task) => `
    <button type="button" class="media-task-tile" data-media-task="${esc(task.taskTitle)}">
      <span class="media-task-cover" aria-hidden="true">📁</span>
      <span class="media-task-body">
        <b>${esc(task.taskTitle)}</b>
        <span class="hint">${task.videos ? `视频 ${task.videos}` : ''}${task.videos && task.images ? ' · ' : ''}${task.images ? `图像 ${task.images}` : ''} · ${fmtBytes(task.bytes)}</span>
        <span class="hint">最近 ${new Date(task.mtime).toLocaleString('zh-CN', { hour12: false })}</span>
      </span>
    </button>`).join('')}</div>`
    : `<div class="card"><div class="empty"><strong>还没有成片</strong><p>生成的成片会自动保存到媒体库目录，按日期 / 任务分文件夹；也可以用右上角「导入成片」把自己生成或下载的视频放进来。</p></div></div>`;
  return `
  ${mediaProjectHead(data, actions)}
  ${menu}`;
}

function renderMedia() {
  if (!state.mediaTask) return renderMediaTaskMenu();  const kind = state.mediaKind || 'video';
  const data = state.mediaTaskItems;
  if (!data) return `<div class="empty"><span class="spinner"></span></div>`;
  const { episodes, assignments, jianying } = episodeData();
  const allItems = data.items.filter((i) => i.kind === kind);
  // 分集只在这个任务内部生效：别的任务的分集不往这里带，避免越积越多
  const usedEpisodeIds = new Set(allItems.map((item) => assignments[item.rel]).filter(Boolean));
  const taskEpisodes = episodes.filter((episode) => usedEpisodeIds.has(episode.id));
  let filter = state.mediaEpisode || '';
  if (filter && filter !== '__none__' && !taskEpisodes.some((episode) => episode.id === filter)) filter = '';
  if (filter === '__none__' && !allItems.some((item) => !assignments[item.rel])) filter = '';
  const items = allItems.filter((item) => mediaEpisodeMatches(item, filter));
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
  const current = taskEpisodes.find((episode) => episode.id === filter) || null;
  const countOf = (episodeId) => allItems.filter((item) => assignments[item.rel] === episodeId).length;
  const unassigned = allItems.filter((item) => !assignments[item.rel]).length;
  const importLabel = current ? '导入剪映：' + current.name : '导入剪映（全部）';
  const importable = current
    ? countOf(current.id)
    : (taskEpisodes.length ? taskEpisodes.reduce((sum, episode) => sum + countOf(episode.id), 0) : allItems.length);
  const missing = jianying && jianying.available === false;
  const epChip = (id, name, count, active) => `<button class="ep-chip${active ? ' active' : ''}" data-episode="${esc(id)}" data-drop-episode="${esc(id)}">
      <svg class="ep-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
      <span class="ep-chip-label">${esc(name)}</span>
      <b>${count}</b>
    </button>`;
  const actions = `
      ${kind === 'video' ? '<button class="btn" data-act="rename-media-shots">按镜头名重命名</button>' : ''}
      <button class="btn" data-act="open-media-root">打开目录</button>
      <button class="btn" data-act="refresh-media">刷新</button>`;
  return `
  ${mediaProjectHead(data, actions)}
  <nav class="media-crumbs" aria-label="当前位置">
    <button type="button" class="asset-crumb" data-act="media-tasks-back">媒体库</button>
    <span class="asset-crumb-sep">/</span>
    <span class="asset-crumb is-current">${esc(state.mediaTask)}</span>
  </nav>
  <section class="ep-section">
    <div class="ep-head">
      <h3>分集</h3>
      <span class="hint">把成片卡片拖到某一集上即可归入</span>
      <span class="grow"></span>
      <span class="ep-actions">
        ${current ? '<button class="btn ghost sm" data-act="episode-rename">重命名</button><button class="btn ghost sm" data-act="episode-delete">删除分集</button>' : ''}
        <button class="btn sm primary" data-act="jianying-import" ${importable ? '' : 'disabled'} title="把这一集（或全部）的成片按镜头顺序做成剪映草稿">${importLabel}</button>
      </span>
    </div>
    <div class="ep-bar">
      ${epChip('', '全部', allItems.length, !filter)}
      ${taskEpisodes.map((episode) => epChip(episode.id, episode.name, countOf(episode.id), filter === episode.id)).join('')}
      ${unassigned ? epChip('__none__', '未分集', unassigned, filter === '__none__') : ''}
      <button type="button" class="ep-chip ep-chip-new" data-act="episode-new">
        <svg class="ep-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        <span class="ep-chip-label">新建分集</span>
      </button>
    </div>
    <p class="hint ep-foot">剪辑交给剪映：点右上「导入剪映」生成草稿后打开剪映接着剪${missing ? ' · 没找到剪映草稿目录，先打开一次剪映' : ''}</p>
  </section>
  ${items.length ? [...groups.entries()].map(([taskTitle, rows]) => `<section class="media-task-group">
    <div class="media-task-head"><b>${esc(taskTitle)}</b><span class="hint">${rows.length} 条</span><span class="grow"></span><button class="btn ghost sm" data-act="group-assign" data-task="${esc(taskTitle)}">整组归入</button><button class="btn sm" data-act="media-import">导入成片</button></div>
    <div class="grid-cards">${rows.map(({ item, index }) => {
      const episodeName = episodeNameOf(assignments[item.rel] || '');
      return `
      <div class="media-card" data-media="${index}" data-rel="${esc(item.rel)}" draggable="true" title="拖到上方的某一集即可归入">
        <div class="media-thumb ${item.kind === 'video' ? 'is-video' : ''}">${item.kind === 'image' ? `<img src="${item.url}" loading="lazy" />` : `<video src="${item.url}#t=0.5" preload="metadata" muted></video>`}${episodeName ? `<span class="ep-badge">${esc(episodeName)}</span>` : ''}</div>
        <div class="media-meta">
          <span class="name">${esc(item.shotLabel || item.outputLabel || item.name)}</span>
          <span class="sub">${item.name.replace(/\.[^.]+$/, '') !== (item.shotLabel || item.outputLabel) ? esc(item.name) + ' · ' : ''}${esc(item.day)} · ${fmtBytes(item.bytes)}</span>
        </div>
      </div>`;
    }).join('')}</div>
  </section>`).join('') : `<div class="card"><div class="empty"><strong>${filter ? '这一集还没有成片' : '还没有' + (kind === 'video' ? '视频' : '图片')}</strong><p>${filter ? '把卡片拖到上方的这一集，或先切到「全部」再拖。' : '这个任务下暂时没有成片，换个任务，或用「导入成片」补一条。'}</p></div></div>`}
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
      await loadMediaTaskMenu();
      closeModal();
      render();
      toast(`已重命名 ${result.moved.length} 个成片`);
    } catch (err) {
      button.disabled = false;
      toast(err.message, true);
    }
  };
}

function openMediaImportModal() {
  const media = state.mediaTasks || state.mediaTaskItems || state.media || {};
  const projectName = media.projectName || (state.mediaTask || '手工导入');
  const panel = openModal(`<div class="modal-head">
      <div><h2>导入成片</h2><div class="hint">自己生成或下载的视频，复制一份进媒体库（${esc(media.root || '媒体库目录')}），原文件不动</div></div>
      <button class="btn ghost sm" data-close="1">关闭</button>
    </div>
    <div class="modal-body">
      <div class="field"><label>任务名</label>
        <input class="input" id="media-import-task" value="${esc(projectName)}" placeholder="例如：首尔没有忘记你" /></div>
      <p class="hint">落盘位置：media/&lt;日期&gt;/import-xxx/&lt;原文件名&gt;，同名任务在媒体库里会归成一组。</p>
      <div class="field"><label>分镜名（留空用文件名）</label>
        <input class="input" id="media-import-shot" value="" placeholder="例如：镜头 07" /></div>
      <div class="field"><label>选择文件</label>
        <input class="input" id="media-import-files" type="file" multiple accept="video/*,image/*,audio/*" /></div>
      <div class="hint" id="media-import-status"></div>
    </div>
    <div class="modal-foot"><span class="grow"></span><button class="btn ghost" data-close="1">取消</button><button class="btn primary" id="media-import-ok">开始导入</button></div>`);
  const status = panel.querySelector('#media-import-status');
  panel.querySelector('#media-import-ok').onclick = async () => {
    const button = panel.querySelector('#media-import-ok');
    const files = [...(panel.querySelector('#media-import-files').files || [])];
    if (!files.length) { toast('先选要导入的文件', true); return; }
    const taskTitle = panel.querySelector('#media-import-task').value.trim();
    const shotInput = panel.querySelector('#media-import-shot').value.trim();
    button.disabled = true;
    const done = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      status.textContent = `正在导入 ${index + 1}/${files.length}：${file.name}`;
      const shotLabel = files.length === 1 ? (shotInput || file.name.replace(/\.[^.]+$/, '')) : file.name.replace(/\.[^.]+$/, '');
      const query = new URLSearchParams({ name: file.name, taskTitle, shotLabel });
      let payload = null;
      try {
        const res = await fetch('/api/media/import?' + query.toString(), {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        payload = await res.json().catch(() => null);
        if (!payload || !payload.ok) throw new Error((payload && payload.error) || `请求失败 HTTP ${res.status}`);
      } catch (err) {
        button.disabled = false;
        status.textContent = '';
        toast(`${file.name} 导入失败：${err.message}`, true);
        return;
      }
      done.push(payload.data);
    }
    await reloadMediaEpisodes();
    closeModal();
    // 导入完成后直接进这个任务的成片，省得再回菜单找
    state.mediaTask = (done[0] && done[0].taskTitle) || taskTitle || '';
    state.mediaEpisode = '';
    await loadMediaTaskMenu();
    render();
    toast(`已导入 ${done.length} 个成片到 ${done[0].day}`);
  };
}

function openMediaDetail(item) {
  const url = esc(item.url || '/api/file?path=' + enc(item.path));
  openModal(`
    <div class="modal-head"><h2>${esc(item.shotLabel || item.name)}</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="media-detail-preview">
        ${item.kind === 'video'
          ? `<video src="${url}" controls autoplay playsinline preload="metadata"></video>`
          : `<img src="${url}" alt="${esc(item.name)}" />`}
      </div>
      ${item.taskTitle ? `<div class="kv"><span>任务</span><span>${esc(item.taskTitle)}</span></div>` : ''}
      ${item.shotLabel ? `<div class="kv"><span>分镜</span><span>${esc(item.shotLabel)}</span></div>` : ''}
      <div class="kv"><span>文件</span><span class="mono">${esc(item.name)}</span></div>
      <div class="kv"><span>大小</span><span>${fmtBytes(item.bytes)}</span></div>
    </div>
    <div class="modal-foot"><button class="btn primary" id="media-preview-jianying" title="把这一条成片单独做成剪映草稿">导入剪映</button><button class="btn" data-close="1">关闭</button></div>
  `);
  $('#modal-panel .modal-body').insertAdjacentHTML('beforeend','<section id="generation-details">正在读取生成资料…</section>');
  WB.mediaDetails(item);
  const jianying = episodeData().jianying;
  const jyButton = $('#media-preview-jianying');
  if (jianying && jianying.available === false) { jyButton.disabled = true; jyButton.title = '没找到剪映草稿目录，先打开一次剪映'; }
  jyButton.onclick = async () => {
    closeModal();
    await importToJianying({ rels: item.rel ? [item.rel] : [] });
  };
}

function bindMedia(root) {
  root.querySelector('#media-project')?.addEventListener('change', async (event) => {
    try {
      state.mediaEpisode = '';
      await setActiveProject(event.target.value);
    } catch (err) { toast(err.message, true); }
  });
  root.addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-media]');
    if (!card || !card.dataset.rel) return;
    event.dataTransfer.setData('text/plain', card.dataset.rel);
    event.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  });
  root.addEventListener('dragend', (event) => {
    event.target.closest('[data-media]')?.classList.remove('is-dragging');
    $$('.ep-chip.drop-hover', root).forEach((chip) => chip.classList.remove('drop-hover'));
  });
  root.addEventListener('dragover', (event) => {
    const chip = event.target.closest('[data-drop-episode]');
    if (!chip) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    chip.classList.add('drop-hover');
  });
  root.addEventListener('dragleave', (event) => {
    const chip = event.target.closest('[data-drop-episode]');
    if (chip) chip.classList.remove('drop-hover');
  });
  root.addEventListener('drop', async (event) => {
    const chip = event.target.closest('[data-drop-episode]');
    if (!chip) return;
    event.preventDefault();
    chip.classList.remove('drop-hover');
    const rel = event.dataTransfer.getData('text/plain');
    if (rel) await assignMediaEpisode(chip.dataset.dropEpisode, [rel]);
  });
  root.addEventListener('click', async (event) => {
    const taskTile = event.target.closest('[data-media-task]');
    if (taskTile) {
      try {
        state.mediaEpisode = '';
        await loadMediaTaskItems(taskTile.dataset.mediaTask);
        await reloadMediaEpisodes();
        syncHash('media', { task: taskTile.dataset.mediaTask });
        render();
      } catch (err) { toast(err.message, true); }
      return;
    }
    const episodeBtn = event.target.closest('[data-episode]');
    if (episodeBtn) { state.mediaEpisode = episodeBtn.dataset.episode || ''; return render(); }
    const kindBtn = event.target.closest('[data-kind]');
    if (kindBtn) {
      state.mediaKind = kindBtn.dataset.kind;
      state.mediaEpisode = '';
      try {
        await loadMediaTaskMenu();
        render();
      } catch (err) { toast(err.message, true); }
      return;
    }
    const card = event.target.closest('[data-media]');
    if (card) {
      const kind = state.mediaKind || 'video';
      const items = ((state.mediaTaskItems && state.mediaTaskItems.items) || []).filter((i) => i.kind === kind && mediaEpisodeMatches(i, state.mediaEpisode || ''));
      const item = items[Number(card.dataset.media)];
      if (!item) return;
      return openMediaDetail(item);
    }
    const target = event.target.closest('[data-act]');
    if (!target) return;
    try {
      if (target.dataset.act === 'rename-media-shots') return await openMediaRenameModal();
      if (target.dataset.act === 'media-import') return openMediaImportModal();
      if (target.dataset.act === 'media-tasks-back') {
        state.mediaTask = '';
        state.mediaTaskItems = null;
        await loadMediaTaskMenu();
        return render();
      }
      if (target.dataset.act === 'refresh-media') {
        await loadMediaTaskMenu();
        await reloadMediaEpisodes();
        return render();
      }
      if (target.dataset.act === 'open-media-root') {
        const root = (state.mediaTaskItems && state.mediaTaskItems.root) || (state.mediaTasks && state.mediaTasks.root);
        await api('/api/reveal', { method: 'POST', body: { path: root || '' } });
      }
      if (target.dataset.act === 'episode-new') return openEpisodeCreateModal();
      if (target.dataset.act === 'episode-rename') return openEpisodeRenameModal();
      if (target.dataset.act === 'episode-delete') return deleteCurrentEpisode();
      if (target.dataset.act === 'group-assign') return openEpisodeAssignModal(target.dataset.task || '');
      if (target.dataset.act === 'jianying-import') return await importToJianying();
    } catch (err) { toast(err.message, true); }
  });
}

async function reloadMediaEpisodes() {
  try { state.episodes = await api('/api/media/episodes'); } catch { /* 保留旧数据 */ }
}

async function assignMediaEpisode(episodeId, rels) {
  const list = (rels || []).filter(Boolean);
  if (!list.length) return;
  const target = !episodeId || episodeId === '__none__' ? '' : episodeId;
  try {
    await api('/api/media/episodes', { method: 'POST', body: { action: 'assign', episodeId: target, rels: list } });
    await reloadMediaEpisodes();
    render();
    toast(`已归入 ${target ? episodeNameOf(target) : '未分集'}：${list.length} 条`);
  } catch (err) {
    toast(err.message, true);
  }
}

function groupRels(taskTitle) {
  const kind = state.mediaKind || 'video';
  const filter = state.mediaEpisode || '';
  return ((state.mediaTaskItems && state.mediaTaskItems.items) || [])
    .filter((item) => item.kind === kind && (item.taskTitle || '未记录任务') === taskTitle && mediaEpisodeMatches(item, filter))
    .map((item) => item.rel);
}

function openEpisodeCreateModal() {
  const { episodes } = episodeData();
  const suggested = '第' + (episodes.length + 1) + '集';
  const panel = openModal(`<div class="modal-head">
      <div><h2>新建分集</h2><div class="hint">在项目下建一个「集」，再把媒体库里的片段拖进去</div></div>
      <button class="btn ghost sm" data-close="1">关闭</button>
    </div>
    <div class="modal-body">
      <label class="field"><span>分集名称</span><input class="input" id="ep-name" value="${esc(suggested)}" placeholder="第1集" /></label>
    </div>
    <div class="modal-foot"><span class="grow"></span><button class="btn ghost" data-close="1">取消</button><button class="btn primary" id="ep-create-ok">创建</button></div>`);
  const input = panel.querySelector('#ep-name');
  input.focus();
  input.select();
  panel.querySelector('#ep-create-ok').onclick = async () => {
    const name = input.value.trim();
    try {
      await api('/api/media/episodes', { method: 'POST', body: { action: 'create', name } });
      await reloadMediaEpisodes();
      closeModal();
      render();
      toast('已创建分集：' + name);
    } catch (err) { toast(err.message, true); }
  };
}

function openEpisodeRenameModal() {
  const current = episodeData().episodes.find((episode) => episode.id === state.mediaEpisode);
  if (!current) { toast('先选中一集'); return; }
  const panel = openModal(`<div class="modal-head">
      <div><h2>重命名分集</h2><div class="hint">${esc(current.name)}</div></div>
      <button class="btn ghost sm" data-close="1">关闭</button>
    </div>
    <div class="modal-body">
      <label class="field"><span>分集名称</span><input class="input" id="ep-name" value="${esc(current.name)}" /></label>
    </div>
    <div class="modal-foot"><span class="grow"></span><button class="btn ghost" data-close="1">取消</button><button class="btn primary" id="ep-rename-ok">保存</button></div>`);
  const input = panel.querySelector('#ep-name');
  input.focus();
  input.select();
  panel.querySelector('#ep-rename-ok').onclick = async () => {
    try {
      await api('/api/media/episodes', { method: 'POST', body: { action: 'rename', id: current.id, name: input.value.trim() } });
      await reloadMediaEpisodes();
      closeModal();
      render();
      toast('已重命名');
    } catch (err) { toast(err.message, true); }
  };
}

async function deleteCurrentEpisode() {
  const current = episodeData().episodes.find((episode) => episode.id === state.mediaEpisode);
  if (!current) { toast('先选中一集'); return; }
  if (!confirm(`删除「${current.name}」这一集？片段仍在媒体库里，只是不再属于任何一集。`)) return;
  try {
    await api('/api/media/episodes', { method: 'POST', body: { action: 'delete', id: current.id } });
    state.mediaEpisode = '';
    await reloadMediaEpisodes();
    render();
    toast('已删除分集：' + current.name);
  } catch (err) { toast(err.message, true); }
}

function openEpisodeAssignModal(taskTitle) {
  const rels = groupRels(taskTitle);
  if (!rels.length) { toast('这一组没有可归入的片段'); return; }
  const { episodes } = episodeData();
  const rows = episodes.length
    ? episodes.map((episode) => `<button type="button" class="btn ep-pick" data-episode-id="${esc(episode.id)}"><span>${esc(episode.name)}</span><em>${episode.count || 0} 条</em></button>`).join('')
    : `<p class="hint">还没有分集，先在下面新建一集。</p>`;
  const panel = openModal(`<div class="modal-head">
      <div><h2>整组归入分集</h2><div class="hint">${esc(taskTitle)} · ${rels.length} 条</div></div>
      <button class="btn ghost sm" data-close="1">关闭</button>
    </div>
    <div class="modal-body">
      <div class="ep-pick-list">${rows}</div>
      <div class="ep-new-row"><input class="input" id="ep-new-name" placeholder="新建一集，例如 第1集" /><button class="btn" id="ep-new-create">新建并归入</button></div>
    </div>`);
  panel.addEventListener('click', async (event) => {
    const pick = event.target.closest('[data-episode-id]');
    if (!pick) return;
    closeModal();
    await assignMediaEpisode(pick.dataset.episodeId, rels);
  });
  panel.querySelector('#ep-new-create').onclick = async () => {
    const name = panel.querySelector('#ep-new-name').value.trim();
    if (!name) { toast('先给这一集起个名字'); return; }
    try {
      const episode = await api('/api/media/episodes', { method: 'POST', body: { action: 'create', name } });
      closeModal();
      await assignMediaEpisode(episode.id, rels);
    } catch (err) { toast(err.message, true); }
  };
}

async function importToJianying(options = {}) {
  const filter = state.mediaEpisode || '';
  const { episodes, jianying } = episodeData();
  if (jianying && jianying.available === false) { toast('没找到剪映草稿目录，先打开一次剪映再导入', true); return; }
  if (jianying && jianying.running) { toast('剪映正在运行，请先关闭剪映再导入', true); return; }
  const rels = (Array.isArray(options.rels) ? options.rels : []).filter(Boolean);
  const episode = rels.length ? null : episodes.find((item) => item.id === filter);
  const body = rels.length
    ? { rels }
    : (episode ? { episodeId: episode.id } : (episodes.length ? { all: true } : {}));
  try {
    toast('正在生成剪映草稿…');
    const result = await api('/api/media/jianying', { method: 'POST', body });
    showJianyingResult(result);
    await reloadMediaEpisodes();
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

function showJianyingResult(result) {
  const rows = (result.created || []).map((row) => `<div class="kv"><span>${esc(row.name)}</span><span>${row.clips} 个片段 · ${fmtClock(row.duration)}</span></div>`).join('');
  const panel = openModal(`<div class="modal-head">
      <div><h2>已生成剪映草稿</h2><div class="hint">共 ${(result.created || []).length} 个，打开剪映就能在「本地草稿」里看到</div></div>
      <button class="btn ghost sm" data-close="1">关闭</button>
    </div>
    <div class="modal-body">
      <div class="jy-result">${rows || '<p class="hint">没有生成草稿。</p>'}</div>
      <div class="kv"><span>草稿目录</span><span class="mono">${esc(result.root || '')}</span></div>
    </div>
    <div class="modal-foot"><span class="grow"></span><button class="btn" id="jy-open-root">打开草稿目录</button><button class="btn primary" data-close="1">知道了</button></div>`);
  panel.classList.add('modal-wide');
  panel.querySelector('#jy-open-root').onclick = async () => {
    try { await api('/api/reveal', { method: 'POST', body: { path: result.root } }); }
    catch (err) { toast(err.message, true); }
  };
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

const GEAR = '<svg class="wmd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
const IMG_ICON = '<svg class="wmd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>';
const DOWN_ICON = '<svg class="wmd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m7 10 5 5 5-5"></path><path d="M12 15V3"></path></svg>';

function fileUrl(file) {
  return '/api/file?path=' + encodeURIComponent(file);
}

// 拖动分隔条调整左侧面板宽度（原版双击可复位）
function bindSplitter(root, panelSel, onResize) {
  const panel = $(panelSel, root);
  const splitter = $('.wmd-splitter', root) || $('.zs-splitter', root);
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
  // 子页签已由左侧二级菜单承担，这里不再输出页内工具条（含齿轮设置）
  return '';
}

// 供左侧二级菜单直接切换图像子页签（页内按钮已移除）
window.__imageSwitchTab = (tab) => {
  if (!['edit', 'generate', 'reverse', 'scene'].includes(tab)) return false;
  state.image.tab = tab;
  syncHash('image', { tab });
  render();
  return true;
};

function generationPrefixValue(kind) {
  const value=kind==='video'?state.studio:state.image;
  if(typeof value.prefixPrompt==='string')return value.prefixPrompt;
  const style=state.styleDetail;if(!style)return '';
  if(kind==='image'){
    const layer=value.styleLayer||'free';
    if(layer==='free')return '';
    return String(style[layer]||'').trim();
  }
  return String(style.video||'').trim();
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
  const layer=kind==='image'?'<select class="zs-select" id="image-style-layer" aria-label="前置词类型">'+[['free','自由（不注入）'],['character','人物'],['scene','场景'],['prop','道具']].map(([id,title])=>'<option value="'+id+'" '+((value.styleLayer||'auto')===id?'selected':'')+'>'+title+'</option>').join('')+'</select>':'';
  const body=open?'<div class="generation-prefix-body" id="'+kind+'-prefix-body">'+layer+'<textarea id="'+kind+'-prefix" class="generation-parameter-text" rows="4" placeholder="填写要加在正文之前的风格要求；留空则不添加">'+esc(text)+'</textarea><small>'+esc(typeof value.prefixPrompt==='string'?'当前画面自定义前置词':state.styleDetail?'来自项目风格：'+state.styleDetail.name:'当前项目未设置前置词，可直接填写')+'</small></div>':'';
  // 收起时用负外边距抵消所在面板的行间距，让上下各只留 2px；两个页面容器的行距不同，分别取值。
  // 收起时用负外边距抵消面板行距，上下各留 2px；图片页下方紧跟“图片比例”，它收起时由它自己带负边距。
  const nextCompact=kind==='image'&&layoutOpen.image===false;
  const collapseStyle='';
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
  const body=open?'<div class="generation-layout-body" id="image-layout-body"><select class="zs-select" id="image-ratio" aria-label="图片比例">'+['auto',...GenerationParams.ratios].map(r=>'<option value="'+r+'" '+(r===ratio?'selected':'')+'>'+(r==='auto'?'由模型决定':r)+'</option>').join('')+'</select><label for="image-layout">图片样式 / 分区布局</label><select class="zs-select" id="image-layout" '+(ratio==='auto'?'disabled':'')+'>'+choices.map(l=>'<option value="'+l.id+'" '+(l.id===selected.id?'selected':'')+'>'+esc(l.name)+'</option>').join('')+'</select>'+preview+'<label for="image-layout-prompt">分区说明（可编辑）</label><textarea id="image-layout-prompt" class="generation-parameter-text" rows="5" '+(ratio==='auto'?'disabled':'')+' placeholder="自由构图，或填写每个小块放置的内容">'+esc(text)+'</textarea><small>比例和分区要求会加入生成提示词；像素尺寸使用下方图片尺寸。</small></div>':'';
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
          <button type="button" class="zs-keystate ${ch ? 'zs-keystate-ready' : 'zs-keystate-missing'}" data-act="manage-image-channels" title="${ch ? '已配置模型，点击管理' : '还没有图像模型，点击新增'}">
            <span class="zs-keystate-dot"></span>${ch ? esc(ch.model || ch.name) : '未配置模型'}
          </button>
        </span>
      </div>
      <div class="zs-stack">
        <div class="zs-select-wrap">
          <select class="zs-select" id="img-channel">
            ${imageChannels().length
              ? imageChannels().map((c) => `<option value="${esc(c.id)}" ${c.id === ch.id ? 'selected' : ''}>${esc(c.model || c.name)}${c.active ? ' · 默认' : ''}</option>`).join('')
              : '<option value="">没有可用的图像模型</option>'}
          </select>
          <span class="zs-select-caret">${ICON.caret}</span>
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
        <div class="wmd-field-hint">${purpose}</div>
        <div class="wmd-field-hint">这个页签需要先有一个图像模型：OpenAI Images / Gemini / Chat 生图，或者你自己的中转接口。</div>
      </div>
      <div class="zs-panel-foot"><button type="button" class="zs-btn zs-btn-primary zs-btn-lg zs-generate-btn" data-act="add-image-channel">新增图像模型</button></div>`;
  }

  if (tab === 'reverse') {
    const busyText = im.busy === 'gen' ? '出图中…' : im.busy === 'reverse' ? '反推中…' : (im.reverseText ? '重新反推并出图' : '反推并出图');
    return tabsBar + `
      ${imageSourcePickerHtml(source)}
      <div class="zs-field">
        <div class="zs-field-head"><span class="zs-field-label">反推 → 直接出图</span>
          <span class="zs-field-right"><span class="zs-inline-actions">
            ${im.reverseText ? '<button type="button" class="zs-btn zs-btn-ghost zs-btn-sm" data-act="use-reverse" ' + (im.busy || IJ.active(WB.context('image').itemId) ? 'disabled' : '') + '>再出一张</button>' : ''}
            <button type="button" class="zs-btn zs-btn-ghost zs-btn-sm" data-act="copy-reverse" ${im.reverseText ? '' : 'disabled'}>复制提示词</button>
          </span></span>
        </div>
        ${im.reverseText
          ? `<div class="zs-reverse-prompt">
              <div class="zs-reverse-hint">反推结果就是这块，直接改；改完点「再出一张」。</div>
              <textarea class="zs-textarea" id="img-reverse-out" style="min-height:220px">${esc(im.reverseText || '')}</textarea>
            </div>`
          : '<div class="wmd-field-hint">选一张源图，点下面「反推并出图」：先反推成提示词，再用它直接出图，结果显示在右侧画布，不用切页签。</div>'}
      </div>
      ${im.busy === 'gen' ? '<div class="wmd-field-hint">正在出图，完成后右侧画布自动更新…</div>' : ''}
      <div class="zs-panel-foot">
        <button type="button" class="zs-btn zs-btn-primary zs-btn-lg zs-generate-btn" data-act="image-reverse" ${im.busy || IJ.active(WB.context('image').itemId) ? 'disabled' : ''}>${busyText}</button>
      </div>`;
  }

  return tabsBar + generationPrefixHtml('image') + imageLayoutParametersHtml() + `
    <div class="zs-field">
      <div class="zs-field-head"><span class="zs-field-label">风格类别</span></div>
      <div class="zs-select-wrap"><select class="zs-select" id="img-style-category">${[['free','自由（不注入项目风格）'],['character','人物'],['scene','场景'],['prop','道具']].map(([id,label]) => `<option value="${id}" ${(im.styleLayer || 'free') === id ? 'selected' : ''}>${label}</option>`).join('')}</select><span class="zs-select-caret">${ICON.caret}</span></div>
    </div>
    ${tab === 'edit' ? imageSourcePickerHtml(source) : ''}
    <div class="zs-field">
      <div class="zs-field-head"><span class="zs-field-label">${tab === 'edit' ? '编辑指令' : '提示词'}</span></div>
      <div class="zs-prompt">
        <textarea class="zs-textarea" id="img-prompt" style="min-height:180px" placeholder="${tab === 'edit' ? '描述要怎么改：换背景、调光线、加/删元素、保持人物不变……' : '描述你想生成的画面：主体、动作、场景、光影、风格……'}">${esc(im.prompt)}</textarea>
        <div class="zs-prompt-foot">
          <span class="zs-prompt-count" id="img-prompt-count">${im.prompt.length}字</span>
          <span class="zs-prompt-spacer"></span>
          <button type="button" class="zs-iconbtn" data-act="image-clear-prompt" title="清空">${ICON.trash}</button>
          <button type="button" class="zs-magic" data-act="image-optimize" ${im.busy || IJ.active(WB.context('image').itemId) ? 'disabled' : ''} title="用当前推理模型扩写提示词">
            <span>${im.busy ? '优化中…' : '优化提示词'}</span>
          </button>
        </div>
      </div>
    </div>
    <div class="zs-field">
      <div class="zs-field-head"><span class="zs-field-label">图片尺寸 / 数量</span></div>
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
  const status = imageTask ? imageTask.phase : !ch ? '没有图像模型 · 先在左侧新增一个'
    : item ? `${item.name}${item.width ? ` · ${item.width}×${item.height}` : ''}${item.bytes ? ` · ${fmtBytes(item.bytes)}` : ''}${im.selection ? ' · 已选区' : ''}`
    : (tab === 'reverse' ? '选源图 → 反推并出图，结果显示在这里' : '就绪 - 在左侧写提示词，点「图像生成」');
  return `<div class="zd-toolbar">
    <div class="zd-tool-group zd-filemenu" id="img-filemenu">
      <button type="button" class="zd-tool zd-filemenu-btn" data-act="img-file-menu" title="文件">
        <span class="zd-tool-label">文件</span>
      </button>
      <div class="zd-filemenu-pop">
        <button type="button" class="zd-filemenu-item" data-act="image-import">导入图片文件…</button>
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
  <div class="zd-canvas-area">
    ${IJ.canvas() || (im.busy ? `<div class="img-generating"><span class="img-spin"></span><b>正在生成图片…</b><small>${esc(ch ? ch.name : '')}${im.count > 1 ? ' · ' + im.count + ' 张' : ''}</small></div>` : '')}
    ${item ? imageViewerHtml(item) : generating ? '' : `<div class="zd-empty">
        <div class="zd-empty-card">
          <div class="zd-empty-frame">${IMG_ICON}</div>
          <div class="zd-empty-title">${ch ? '把图片拖到这里开始' : '先新增一个图像模型'}</div>
          <div class="zd-empty-sub">${ch ? '或从素材库选图 · 也可以直接文生图，结果会显示在这里' : '支持 OpenAI Images / Gemini / Chat 生图，以及任意中转站'}</div>
          <div class="zd-empty-actions">
            ${ch ? `<button type="button" class="zd-btn zd-btn-primary" data-act="pick-result">打开图片</button>
      <button type="button" class="zd-btn" data-act="image-import">导入文件</button>` : `<button type="button" class="zd-btn zd-btn-primary" data-act="add-image-channel">新增图像模型</button>`}
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
    ${(im.results || []).length > 1 ? `<span class="zd-docnav">
      <button type="button" class="zd-tool" data-act="doc-prev" title="上一张">‹</button>
      <span class="zd-docnav-count" title="当前第几张">${(im.previewIndex || 0) + 1}/${im.results.length}</span>
      <button type="button" class="zd-tool" data-act="doc-next" title="下一张">›</button>
    </span>` : ''}
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
    <div class="modal-head"><h2>图像大小</h2><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="row">
        <div class="field grow"><label>宽（像素）</label><input class="input" id="img-w" type="number" min="1" value="${nw}" /></div>
        <div class="field grow"><label>高（像素）</label><input class="input" id="img-h" type="number" min="1" value="${nh}" /></div>
      </div>
      <label class="hint"><input type="checkbox" id="img-lock" checked /> 锁定比例（${nw}×${nh}）</label>
    </div>
    <div class="modal-foot">
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">取消</button>
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-primary" id="img-size-go">应用</button>
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
      if (act === 'doc-prev' || act === 'doc-next') {
        const list = state.image.results || [];
        if (!list.length) return;
        const step = act === 'doc-prev' ? -1 : 1;
        state.image.previewIndex = ((state.image.previewIndex || 0) + step + list.length) % list.length;
        return render();
      }
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
    <div class="modal-head"><h2>最近生成</h2><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button></div>
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
  $$('#modal-panel [data-history]').forEach((card) => {
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
  if (tab === 'scene') return '<div class="wmd-image-host is-scene">' + imageTabsHtml(tab) + sceneWorkspaceHtml() + '</div>';
  const ch = imageChannel();
  return `<div class="wmd-image-host zs-app">
    ${imageTabsHtml(tab)}
    <input type="file" id="image-import-file" accept="image/*" hidden />
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
  // 反推页直接出图：用给定提示词提交一次文生图，结果由后台任务回填到右侧画布，不切页签
  const imageGenerateNow = async (prompt, refs = []) => {
    const ch = imageChannel();
    if (!ch) throw new Error('请选择图像模型');
    const text = String(prompt || '').trim();
    if (!text) throw new Error('提示词是空的');
    if (IJ.active(workbenchContext.itemId)) throw new Error('当前画面已有未结束的图像任务，请等它结束');
    await WB.flush('image');
    await api('/api/images/generate', { method: 'POST', body: {
      ...workbenchContext, background: true, requestId: crypto.randomUUID(), channelId: ch.id,
      prompt: text, prefixPrompt: generationPrefixValue('image'), styleLayer: im.styleLayer || 'free',
      imageRatio: im.imageRatio || 'auto', imageLayoutId: im.imageLayoutId || 'free', layoutPrompt: im.layoutPrompt,
      size: im.size, count: im.count, styleId: state.project?.styleId, refs: Array.isArray(refs) ? refs : [],
    } });
    await IJ.refresh();
  };
  if (im.tab === 'scene') {
    root.addEventListener('click', e => { const tab=e.target.closest('[data-img-tab]'); if(tab) {sceneCaptureInputs();im.tab=tab.dataset.imgTab;render();} });
    bindSceneWorkspace(root);return;
  }
  bindSplitter(root, '.zs-panel', (width) => { im.panelWidth = width || 440; });
  bindImageCanvas(root);
  bindImageSourcePicker(root);
  root.addEventListener('keydown', event => {
    const close = event.target.closest('[data-close-document]');
    if (close && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.stopPropagation();
      imageCloseDocument(Number(close.dataset.closeDocument));
    }
  });
  const chSel = $('#img-channel', root);
  if (chSel) chSel.onchange = () => { im.channelId = chSel.value; im.size = 'auto'; render(); };
  const categorySel = $('#img-style-category', root);
  if (categorySel) categorySel.onchange = () => { im.styleLayer = categorySel.value; delete im.prefixPrompt; render(); };
  const sizeSel = $('#img-size', root);
  if (sizeSel) sizeSel.onchange = () => { im.size = sizeSel.value; };
  const countEl = $('#img-count', root);
  if (countEl) countEl.onchange = () => { im.count = Math.max(1, Math.min(4, Number(countEl.value) || 1)); };
  const importInput = $('#image-import-file', root);
  if (importInput) importInput.onchange = async () => {
    const files = [...(importInput.files || [])];
    importInput.value = '';
    if (files.length) await imageImportToCanvas(files).catch((err) => toast(err.message, true));
  };
  if (state.image._pasteHandler) document.removeEventListener('paste', state.image._pasteHandler);
  state.image._pasteHandler = async (event) => {
    if (state.route !== 'image' || document.querySelector('.modal-backdrop')) return;
    // 焦点在源图框里时由源图框自己接剪贴板，不要再往画布塞一份
    if (event.target && event.target.closest && event.target.closest('.src-picker-field')) return;
    const files = [...((event.clipboardData && event.clipboardData.files) || [])].filter((f) => String(f.type || '').startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    await imageImportToCanvas(files).catch((err) => toast(err.message, true));
  };
  document.addEventListener('paste', state.image._pasteHandler);
  const canvasArea = $('.zd-canvas-area', root);
  if (canvasArea) {
    canvasArea.ondragover = (event) => { if (![...(event.dataTransfer.types || [])].includes('Files')) return; event.preventDefault(); canvasArea.classList.add('is-drop'); };
    canvasArea.ondragleave = () => canvasArea.classList.remove('is-drop');
    canvasArea.ondrop = async (event) => {
      const files = [...(event.dataTransfer.files || [])].filter((f) => String(f.type || '').startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      canvasArea.classList.remove('is-drop');
      await imageImportToCanvas(files).catch((err) => toast(err.message, true));
    };
  }
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
    if (clearSource) return imageClearSource({ keepFocus: true });
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
      if (act === 'image-import') { const el = $('#image-import-file'); if (el) el.click(); return; }
      if (act === 'pick-result') return openSourcePicker();
      if (act === 'pick-source') return openSourcePicker();
      if (act === 'copy-reverse') {
        await navigator.clipboard.writeText(im.reverseText || '');
        toast('已复制');
        return;
      }
        if (act === 'use-reverse') {
        im.prompt = im.reverseText || '';
        // 反推页里直接出图，不跳页签
        if (!String(im.prompt).trim()) return toast('提示词是空的', true);
        im.busy = 'gen'; render();
        try {
          await imageGenerateNow(im.prompt, []);
          toast('已按提示词出图');
        } catch (err) { toast(err.message, true); }
        finally { im.busy = false; render(); }
        return;
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
        if (IJ.active(workbenchContext.itemId)) return toast('当前画面已有未结束的图像任务，请等它结束', true);
        im.busy = 'reverse'; render();
        try {
          const res = await api('/api/images/reverse', { method: 'POST', body: { path: im.source.path } });
          im.reverseText = res.prompt;
          im.prompt = res.prompt;
          // 反推完立刻用这段提示词出图，结果显示在右侧画布，不跳页签
          im.busy = 'gen'; render();
          await imageGenerateNow(res.prompt, []);
          toast('反推完成，已按提示词出图');
        } catch (err) { toast(err.message, true); }
        finally { im.busy = false; await WB.complete("image",workbenchContext,im); render(); }
        return;
      }
      if (act === 'image-generate') {
        const ch=imageChannel();
        if(!ch)return toast('请选择图像模型',true);
        if(!im.prompt.trim())return toast('先写提示词',true);
        if(IJ.active(workbenchContext.itemId))return toast('当前画面已有未结束的图像任务，请查看任务日志',true);
        if((im.tab||'generate')==='edit'&&!im.source)return toast('先选源图',true);
        await WB.flush('image');
        const body={...workbenchContext,background:true,requestId:crypto.randomUUID(),channelId:ch.id,prompt:im.prompt,prefixPrompt:generationPrefixValue('image'),styleLayer:im.styleLayer||'free',imageRatio:im.imageRatio||'auto',imageLayoutId:im.imageLayoutId||'free',layoutPrompt:im.layoutPrompt,size:im.size,count:im.count,styleId:state.project?.styleId,refs:(im.tab||'generate')==='edit'&&im.source?[{path:im.source.path,name:im.source.name}]:(im.refs||[])};
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

function imageSetSource(item) {
  state.image.source = { path: item.path, name: item.name || '图片', url: item.url, width: item.width || 0, height: item.height || 0 };
  state.image._focusSource = true;
  closeModal();
  try { WB.schedule('image'); } catch {}
  render();
  toast('已选择源图：' + state.image.source.name);
}

/* 清掉源图：删除按钮与 Backspace/Delete 共用这条路径 */
function imageClearSource(opts = {}) {
  if (!state.image.source) return;
  state.image.source = null;
  if (opts.keepFocus) state.image._focusSource = true;
  try { WB.schedule('image'); } catch {}
  render();
  toast('已删除源图');
}

async function imageImportToCanvas(files) {
  const file = [...files].find((f) => String(f.type || '').startsWith('image/'));
  if (!file) return;
  const item = await imageSaveDataUrl(await fileToDataUrl(file));
  state.image.results = [...(state.image.results || []), item];
  state.image.previewIndex = state.image.results.length - 1;
  state.image.source = { path: item.path, name: item.name || file.name, url: item.url, width: item.width || 0, height: item.height || 0 };
  imagePushHistory();
  render();
  toast('已导入图片：' + (item.name || file.name));
}

async function imageSourceFromFile(file) {
  const dataUrl = await fileToDataUrl(file);
  const item = await imageSaveDataUrl(dataUrl);
  imageSetSource(item);
}

/* 源图选择器：常驻在面板里（拖入 / 粘贴 / 上传 / 素材库），不再弹窗 */
function imageSourcePickerHtml(source) {
  const previewSrc = source ? (source.url || '/api/file?path=' + encodeURIComponent(source.path)) : '';
  return `<div class="zs-field src-picker-field">
    <div class="zs-field-head">
      <span class="zs-field-label">源图</span>
      <span class="zs-field-right">
        <span class="src-picker-state" title="${esc(source ? source.name : '未选择')}">${source ? esc(source.name) : '未选择'}</span>
      </span>
    </div>
    <div class="src-stage ${source ? 'is-filled' : 'is-empty'}" data-source-drop="1" tabindex="0" title="${source ? '点一下选中，Backspace 或 Delete 删除' : '点一下选中这里，再按 Ctrl+V 粘贴图片'}">
      ${source
        ? `<img class="src-stage-img" src="${esc(previewSrc)}" alt="" />`
        : `<div class="src-stage-empty"><b>拖入图片</b><span>点一下选中这里，Ctrl+V 直接粘贴</span></div>`}
      <span class="src-stage-badge">${source ? '已选中 · Ctrl+V 换图 · Backspace 删除' : '已选中 · Ctrl+V 粘贴'}</span>
      <input type="file" accept="image/*" hidden data-source-input="1" />
    </div>
    <div class="src-actions">
      <button type="button" class="zs-btn zs-btn-sm" data-source-library="1">素材库</button>
      <button type="button" class="zs-btn zs-btn-sm" data-source-upload="1">上传</button>
      <button type="button" class="zs-btn zs-btn-sm" data-source-paste="1">粘贴</button>
      ${source ? '<button type="button" class="zs-btn zs-btn-sm src-danger" data-clear-source="1">删除</button>' : ''}
    </div>
  </div>`;
}

function bindImageSourcePicker(root) {
  const drop = $('[data-source-drop]', root);
  if (!drop) return;
  const input = $('[data-source-input]', root);
  const upload = $('[data-source-upload]', root);
  if (upload && input) upload.onclick = () => input.click();
  if (input) input.onchange = () => {
    const file = (input.files || [])[0];
    input.value = '';
    if (file) imageSourceFromFile(file).catch((err) => toast(err.message, true));
  };
  const library = $('[data-source-library]', root);
  if (library) library.onclick = () => openSourcePicker();
  drop.onclick = () => drop.focus();
  const field = drop.closest('.src-picker-field') || drop;
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    if (!state.image.source) return;
    event.preventDefault();
    event.stopPropagation();
    imageClearSource({ keepFocus: true });
  });
  if (state.image._focusSource) {
    state.image._focusSource = false;
    drop.focus();
  }
  drop.addEventListener('paste', (event) => {
    const file = [...((event.clipboardData && event.clipboardData.files) || [])].find((f) => String(f.type || '').startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    imageSourceFromFile(file).catch((err) => toast(err.message, true));
  });
  drop.ondragover = (event) => {
    if (![...((event.dataTransfer && event.dataTransfer.types) || [])].includes('Files')) return;
    event.preventDefault();
    drop.classList.add('is-drop');
  };
  drop.ondragleave = () => drop.classList.remove('is-drop');
  drop.ondrop = (event) => {
    const file = [...((event.dataTransfer && event.dataTransfer.files) || [])].find((f) => String(f.type || '').startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    drop.classList.remove('is-drop');
    imageSourceFromFile(file).catch((err) => toast(err.message, true));
  };
  const paste = $('[data-source-paste]', root);
  if (paste) paste.onclick = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('这个浏览器不支持读剪贴板');
      const entries = await navigator.clipboard.read();
      for (const entry of entries) {
        const type = (entry.types || []).find((t) => t.startsWith('image/'));
        if (!type) continue;
        const blob = await entry.getType(type);
        return imageSourceFromFile(new File([blob], '剪贴板图片.png', { type }));
      }
      toast('剪贴板里没有图片', true);
    } catch (err) { toast(err.message, true); }
  };
}

function openSourcePicker() {
  return openLibraryPicker({
    title: '选择源图',
    onPick: (item) => imageSetSource(item),
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
          <button type="button" class="wmd-btn wmd-btn-sm" data-act="cmp-pick" data-side="${side}">媒体库</button>
          <button type="button" class="wmd-btn wmd-btn-sm" data-act="cmp-local" data-side="${side}">本地文件</button>
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
      <span class="wmd-toolbar-spacer"></span>
      <div class="cmp-mode">
        <button type="button" class="wmd-seg-item ${overlay ? '' : 'is-active'}" data-act="cmp-mode" data-mode="side">对比模式</button>
        <button type="button" class="wmd-seg-item ${overlay ? 'is-active' : ''}" data-act="cmp-mode" data-mode="overlay">叠加对比</button>
      </div>
      <button type="button" class="wmd-link wmd-slots-link" data-act="cmp-swap" title="交换 A / B">⇄ 交换 A/B</button>
      <button type="button" class="wmd-link wmd-slots-link" data-act="cmp-clear-all" title="清空两侧">清空</button>
      <button type="button" class="wmd-btn wmd-btn-sm" data-act="cmp-export" title="把当前两帧并排导出成 PNG，存进素材库">导出并排合成</button>
    </div>

    <div class="cmp-stage ${overlay ? 'is-overlay' : ''}">
      ${comparePaneHtml('left')}
      ${comparePaneHtml('right')}
      ${overlay ? `<input class="cmp-opacity" id="cmp-opacity" type="range" min="0" max="100" step="1" value="${c.opacity == null ? 50 : c.opacity}" title="叠加不透明度" />` : ''}
    </div>

    <div class="cmp-dock">
      <div class="cmp-transport">
        <button type="button" class="wmd-iconbtn is-sm" data-act="cmp-prev" title="上一帧">${ICON.skipBack}</button>
        <button type="button" class="wmd-iconbtn is-sm" data-act="cmp-play" title="播放 / 暂停（空格）">${ICON.play}</button>
        <button type="button" class="wmd-iconbtn is-sm" data-act="cmp-next" title="下一帧">${ICON.skipFwd}</button>
        <span class="cmp-time tnum" id="cmp-time">00:00</span>
        <input class="cmp-seek" id="cmp-seek" type="range" min="0" max="1000" step="1" value="0" />
        <span class="cmp-time tnum" id="cmp-duration">00:00</span>
        <label class="cmp-loop" title="循环播放"><input type="checkbox" id="cmp-loop" ${c.loop ? 'checked' : ''} /> 循环</label>
        <select class="wmd-select cmp-speed" id="cmp-speed" title="播放速度">
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
    <div class="modal-head"><h2>选择素材 · ${side === 'left' ? 'A' : 'B'}</h2><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button></div>
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


function askImageUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return '';
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(url)) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^\/(api|media|assets|wallpapers)\//.test(url)) return url;
  return '';
}

function mdInline(text) {
  let html = esc(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g, (whole, alt, src) => {
    const url = askImageUrl(src);
    if (!url) return whole;
    return `<span class="ask-inline-media"><img class="ask-inline-img" src="${url}" alt="${alt}" loading="lazy" data-act="ask-open-inline" data-url="${url}" data-label="${alt || '图片'}" /><span class="ask-inline-missing">图片未能加载 · ${esc(alt || url)}</span></span>`;
  });
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return html;
}

function markdownLite(text) {
  // 全角竖线也当表格分隔符：模型偶尔会混用 ｜ 和 |
  const src = String(text || '').replace(/\r\n/g, '\n').replace(/｜/g, '|');
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

function askProjectId() { return state.projectId || 'wenyun-m-desktop'; }

const ASK_GENERAL = { id: '', name: '普通聊天', description: '只保留智能助手身份，不注入技能或固定流程；需要时由你选择技能。', prompts: ['你好，先介绍一下你能做什么。', '帮我把这个想法整理成可以开拍的方案。'] };
const ASK_SKILLS = [
  { id: 'novel', name: '小说创作', description: '从一句梗概到可改编的短篇小说 / 章节，带人物、钩子和下一节悬念。', prompts: ['写一个 800 字的短篇开头：雨夜，外卖员在便利店门口捡到一部还在响的手机。', '给我 3 个「雪山寺庙门口重逢」的故事方向。'] },
  { id: 'script', name: '小说转剧本', description: '小说 / 梗概改写成可拍的短剧剧本：分场、台词、场尾钩子。', prompts: ['把下面这段小说改写成 3 场短剧剧本：', '把刚才的小说改成 60 秒竖屏短剧，保留结尾反转。'] },
  { id: 'storyboard', name: '剧本转分镜', description: '剧本拆成标准分镜：镜号、时长、景别、六段式提示词。', prompts: ['把上面的剧本拆成 3 个 15 秒分镜。', '帮我把这场戏拆成分镜，标好 <Picture N> 和 <Subject N>。'] },
  { id: 'prompt', name: '分镜转提示词', description: '分镜改写成视频创作台可直接粘贴的六段式提示词。', prompts: ['把上面的分镜写成可直接出片的提示词。', '把这段描述改写成合规的六段式。'] },
  { id: 'review', name: '提示词审核', description: '检查六段、引用、时长和人物一致性，给出可出片结论。', prompts: ['审核这条提示词能不能出片：', '帮我检查分镜引用、时长和人物一致性。'] },
];

const ASK_CHAIN = {
  novel: { next: 'script', label: '转成剧本', verb: '改写成短剧剧本', guidance: 'script' },
  script: { next: 'storyboard', label: '拆成分镜', verb: '拆成可生成的标准分镜', guidance: 'storyboard' },
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
  { name: 'list_creation_models', description: '列出可用的图像模型与视频模型（含时长、画幅）。', kind: 'create' },
  { name: 'generate_image', description: '调用图像模型出图，可作参考图或首帧。', kind: 'create' },
  { name: 'submit_video_job', description: '把提示词提交到视频工作台生成视频（异步）。', kind: 'create' },
  { name: 'check_video_job', description: '查询视频任务进度、阶段与错误。', kind: 'create' },
  { name: 'wait_video_job', description: '等待视频成片（默认 10 分钟，最多 30 分钟）。', kind: 'create' },
  { name: 'probe_video', description: '读时长、分辨率、帧率、编码、有无音频。', kind: 'create' },
  { name: 'extract_frames', description: '从成片抽帧（最多 12 张），做画面检查或首尾帧。', kind: 'create' },
];

const ASK_EFFORT_LABELS = { none: '关闭', low: '轻量', high: '深入', max: '最高' };
// 本地权限三档：只调"能写哪里、能不能跑命令"，高危命令任何档位都被系统强制阻断
const ASK_PERMISSIONS = [
  { id: 'readonly', label: '仅查看', icon: '👁', desc: '只读检索，不写文件、不移动、不生成、不执行命令' },
  { id: 'workspace', label: '工作区权限', icon: '🗂', desc: '项目目录内可读写、移动、生成；命令需完全权限' },
  { id: 'full', label: '完全权限', icon: '⚡', desc: '本机任意路径可读写（系统目录除外）' },
];
const ASK_PERM_DEFAULT = 'workspace';

function askPermission(id) {
  return ASK_PERMISSIONS.find((p) => p.id === id) || ASK_PERMISSIONS.find((p) => p.id === ASK_PERM_DEFAULT);
}

function askPermissionSet(id) {
  const a = askState();
  a.permission = askPermission(id).id;
  try { localStorage.setItem('wmd.askPermission', a.permission); } catch { /* ignore */ }
  return a.permission;
}
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
      historyOpen: (() => { try { return localStorage.getItem('wmd.askHistoryOpen') !== '0'; } catch { return true; } })(),
      capabilitiesOpen: false,
      // 参考出图开关：关掉就不调用图像渠道（省钱），设置跟着浏览器记住
      refImages: (() => { try { return localStorage.getItem('wmd.askRefImages') !== '0'; } catch { return true; } })(),
      webSearch: (() => { try { return localStorage.getItem('wmd.askWebSearch') === '1'; } catch { return false; } })(),
      // 本地权限档位：仅查看 / 工作区权限 / 完全权限
      permission: (() => { try { return askPermission(localStorage.getItem('wmd.askPermission') || '').id; } catch { return ASK_PERM_DEFAULT; } })(),
      permMenu: false,
      toolsSupported: true,
      panelTab: 'analysis',
      capTab: 'tools',
      pluginTab: 'skill',
      skillId: '',
      enabledTools: [],
      removed: null,
      rename: { open: false, id: '', text: '' },
      toolDetail: null,
      installSkill: null,
      queues: {},
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
    const saved = Number(localStorage.getItem('wmd.previewWidth'));
    state.ask.previewWidth = saved >= 240 ? saved : null;
  }
  return state.ask;
}

function askSkillList() {
  const a = askState();
  const all = (a.skills && a.skills.length)
    ? a.skills
    : ASK_SKILLS.map((s) => ({ ...s, source: 'builtin' }));
  return [ASK_GENERAL].concat(all);
}

function askSkill(id) {
  return askSkillList().find((s) => s.id === id) || ASK_GENERAL;
}

function askSkillName(id) {
  return id ? askSkill(id).name : '';
}

// 技能统一来源：内置技能 + 自定义技能都来自 /agent/skills，右侧组件与插件管理共用
async function askLoadSkills() {
  const a = askState();
  try {
    const data = await askApi('/skills').then((r) => r.json());
    const list = Array.isArray(data) ? data : data.items || [];
    a.skills = list.map((item) => {
      const id = String(item.id || '');
      const source = item.source || (id.startsWith('plugin:') ? 'custom' : 'builtin');
      return {
        id,
        name: item.name || '未命名技能',
        description: item.description || (source === 'custom' ? '自定义技能' : ''),
        prompts: Array.isArray(item.prompts) ? item.prompts : [],
        source,
        runtime: item.runtime_status,
        enabled: item.enabled !== false,
        pluginId: item.plugin_id || (id.startsWith('plugin:') ? id.slice(7) : ''),
      };
    });
    a.customSkills = a.skills.filter((s) => s.source === 'custom');
  } catch {
    a.skills = a.skills || [];
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
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return res;
}

async function askUpload(path, form) {
  const res = await fetch('/api/agent' + path, {
    method: 'POST',
    headers: { 'X-Project-Id': askProjectId() },
    body: form,
  });
  if (!res.ok) {
    let message = '技能上传失败（' + res.status + '）';
    try {
      const data = await res.json();
      message = typeof data.detail === 'string' ? data.detail : (data.detail && data.detail.message) || message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json().catch(() => ({}));
}

/* 对话级运行登记：切换对话不再打断正在跑的任务，后台继续，回到对话就能看到结果 */
function askRuns(a = askState()) { if (!a.runs) a.runs = new Map(); return a.runs; }
function askRunOf(id) { return id ? askRuns(askState()).get(id) || null : null; }
function askAbortRuns() {
  const a = askState();
  for (const run of askRuns(a).values()) { try { run.controller.abort(); } catch { /* ignore */ } }
  askRuns(a).clear();
  a.generating = false;
  a.request = null;
  a.controller = null;
  a.startedAt = 0;
}
function askSyncRunState() {
  const a = askState();
  const run = askRunOf(a.activeId);
  a.generating = !!run;
  a.request = run ? { sessionId: run.chatId, requestId: run.requestId, controller: run.controller, runId: run.runId || '' } : null;
  a.controller = run ? run.controller : null;
  a.startedAt = run ? run.startedAt : 0;
  // 回到还在跑的对话时先显示已有内容，避免从零开始补字
  if (run && run.msg) run.msg._reveal = null;
}

async function askRestore() {
  const a = askState();
  askAbortRuns();
  a.conversations = [];
  a.activeId = '';
  a.draft = '';
  a.attachments = [];
  a.loading = true;
  a.error = '';
  try {
    const list = await askApi('/sessions').then((r) => r.json());
    a.conversations = Array.isArray(list) ? list : [];
    // 刷新后回到上次停留的对话，而不是每次新开一个
    const remembered = (() => { try { return localStorage.getItem('wmd-ask-active') || ''; } catch { return ''; } })();
    const existing = remembered ? a.conversations.find((c) => c.id === remembered) : null;
    if (existing) {
      a.activeId = existing.id;
      a.skillId = '';
      a.workspacePage = 'console';
      askSyncRunState();
    } else {
      askNewConversation();
    }
  } catch (err) {
    a.error = err.message;
    a.conversations = [];
    askNewConversation();
  } finally {
    a.loading = false;
    if (state.route === 'script') askRenderAll();
    askRemember();
    askLoadActiveRuns();
    askLoadProjectHistory().catch(() => {});
  }
}

// 从服务端拿还在这跑的对话（刷新后据此恢复“生成中”和左侧转圈）
async function askLoadActiveRuns() {
  const a = askState();
  let data = null;
  try { data = await askApi('/runs/active').then((r) => r.json()); } catch { return; }
  const items = (data && data.items) || [];
  const live = new Set(items.map((x) => x.session_id));
  for (const run of askRuns(a).values()) {
    if (run.attached && !live.has(run.chatId)) {
      const other = askRuns(a);
      other.delete(run.chatId);
    }
  }
  for (const item of items) {
    if (!item || !item.session_id || askRunOf(item.session_id)) continue;
    askRuns(a).set(item.session_id, {
      chatId: item.session_id,
      requestId: '',
      runId: item.run_id,
      controller: null,
      startedAt: item.started_at || Date.now(),
      msg: null,
      attached: true,
    });
  }
  askSyncRunState();
  askRefreshHistoryFlags();
  if (askRunOf(a.activeId)) askAttachRun(a.activeId);
}

// 刷新/切回时重新接上正在跑的任务：按事件序号补齐内容
async function askAttachRun(chatId) {
  const a = askState();
  const run = askRunOf(chatId);
  if (!run || run.attaching) return;
  if (!run.runId) return;
  const chat = (a.conversations || []).find((c) => c.id === chatId);
  if (!chat) return;
  // 后端已经把这一轮的结果写回会话了（刷新前就跑完了），不要再补一条
  const tailMsg = chat.messages[chat.messages.length - 1];
  if (tailMsg && tailMsg.role === 'assistant' && tailMsg.execution && tailMsg.execution.id === run.runId) {
    askRuns(a).delete(chatId);
    askSyncRunState();
    askRefreshHistoryFlags();
    if (a.activeId === chatId) askRenderMessages();
    return;
  }
  run.attaching = true;
  if (!run.msg) {
    const tail = chat.messages[chat.messages.length - 1];
    run.msg = tail && tail.role === 'assistant' && tail._runId === run.runId
      ? tail
      : { id: 'run-' + run.runId, role: 'assistant', text: '', time: Date.now(), _streaming: true, _runId: run.runId };
    if (!chat.messages.includes(run.msg)) chat.messages.push(run.msg);
  }
  run.msg._streaming = true;
  askSyncRunState();
  if (a.activeId === chatId) askRenderMessages();
  let cursor = 0;
  let sawDone = false;
  for (let guard = 0; guard < 3600; guard += 1) {
    if (askRunOf(chatId) !== run) return;
    let page = null;
    try {
      page = await askApi('/runs/' + encodeURIComponent(run.runId) + '/events?after=' + cursor).then((r) => r.json());
    } catch {
      page = null;
    }
    if (page) {
      for (const ev of page.items || []) {
        if (typeof ev.sequence === 'number') cursor = Math.max(cursor, ev.sequence);
        if (ev.type === 'done' || ev.type === 'run_finished') sawDone = true;
        askApplyEvent(run.msg, ev, chatId);
      }
      if (a.activeId === chatId) askRevealKick();
      const done = (page.items || []).some((ev) => ev.type === 'done' || ev.type === 'error');
      const finished = page.finished === true;
      if (done || (finished && !(page.items || []).length)) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  const runs = askRuns(a);
  if (runs.get(chatId) === run) runs.delete(chatId);
  run.msg._streaming = false;
  run.msg._reveal = null;
  if (!sawDone && run.msg.text && !run.msg.error && !/\[生成已停止\]/.test(run.msg.text)) run.msg.text += '\n\n[生成已停止]';
  chat.updated = Date.now();
  if (a.activeId === chatId) { askSyncRunState(); askRenderMessages(); }
  askRefreshHistoryFlags();
  askPersist();
  askDrainQueue(chatId);
}

function askRemember() {
  try { if (askState().activeId) localStorage.setItem('wmd-ask-active', askState().activeId); } catch { /* ignore */ }
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
  a.mention = null;
  a.command = { mode: null, query: null, index: 0 };
  const c = { id: askId(), title: '新的创作对话', pinned: false, updated: Date.now(), messages: [] };
  a.conversations = [c, ...(a.conversations || [])];
  a.activeId = c.id;
  askSyncCurrentRowItems();
  a.draft = '';
  a.attachments = [];
  askSyncRunState();
  askRemember();
  if (state.route === 'script') askRenderAll();
  return c;
}

/** 切换项目时先清掉当前项目的会话缓存，避免把旧项目的聊天记录写到新项目下。 */
function askResetForProject() {
  const a = state.ask;
  if (!a) return;
  if (askSyncTimer) { clearTimeout(askSyncTimer); askSyncTimer = null; }
  askAbortRuns();
  a.conversations = null;
  a.activeId = '';
  a.draft = '';
  a.attachments = [];
  a.loading = false;
  a.error = '';
  a.trajectory = null;
  a.rename = { open: false, id: '', text: '' };
  a.projectHistory = null;
  a.projectHistoryAt = 0;
}

function askSelect(id) {
  const a = askState();
  a.skillId = '';
  a.previewFile = null;
  a.workspacePage = 'console';
  a.mention = null;
  a.activeId = id;
  a.draft = '';
  a.attachments = [];
  askSyncRunState();
  askRemember();
  askRenderAll();
  askScrollBottom();
  if (askRunOf(id) && askRunOf(id).attached) askAttachRun(id);
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

// 把一次运行的真实轨迹（思考 / 工具调用 / 结果）整理成可折叠的行
function askTraceRows(msg) {
  const items = (msg && (msg.trajectory || msg.liveTrajectory)) || [];
  const rows = [];
  for (const item of items) {
    const kind = item.kind || '';
    if (item.kind === 'model_input') { rows.push({type:'input',name:'第 '+item.cycle+' 轮输入',text:'实际上下文',full:item.content,key:item.id}); continue; }
    if (item.kind === 'model_end' || item.kind === 'model_failed') { rows.push({type:'cycle',name:'第 '+item.cycle+' 轮'+(item.kind === 'model_failed'?'失败':'结束'),text:item.kind === 'model_failed'?item.content:(JSON.parse(item.content || '{}').reasoning_available?'':'未返回推理文本'),full:item.content,key:item.id}); continue; }
    if (item.kind === 'reasoning') { rows.push({type:'think',text:item.content,key:item.id}); continue; }
    if (item.role === 'user') continue;
    if (item.role === 'assistant' && kind === 'final') continue;
    if (item.role === 'assistant') {
      const calls = Array.isArray(item.tool_calls) ? item.tool_calls : [];
      const text = String(item.content || '').trim();
      if (text && calls.length) rows.push({ type: 'explanation', text, key:item.id });
      for (const call of calls) {
        let args = '';
        try { args = typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {}); } catch { args = ''; }
        rows.push({ key:call.id, type: 'tool', name: call.name || 'tool', full: args, args: String(args || '').replace(/\s+/g, ' ').slice(0, 80) });
      }
      if (text && !calls.length) rows.push({ type: 'explanation', text, key:item.id });
      continue;
    }
    if (item.role === 'tool') {
      rows.push({ key:item.id || ('result:'+item.tool_call_id), type: 'result', name: item.tool_name || '', status: item.status || 'success', full: String(item.content || ''), text: String(item.content || '').replace(/\s+/g, ' ') });
    }
  }
  return rows;
}

function askTraceRowHtml(row, index = 0, expanded = false) {
  const failed = row.type === 'result' && row.status && row.status !== 'success';
  const label = row.type === 'think' ? '思考' : row.type === 'explanation' ? '说明' : row.type === 'input' ? '输入' : row.type === 'cycle' ? '循环' : row.type === 'tool' ? '运行命令' : failed ? '失败' : '结果';
  const icon = row.type === 'think' ? '✳' : row.type === 'tool' ? '›_' : '↳';
  const brief = row.type === 'tool' ? row.name + (row.args ? ' · ' + row.args : '') : (row.name ? row.name + '：' : '') + (row.text || '');
  const full = row.full ?? (row.type === 'tool' ? row.args : row.text) ?? '';
  return '<li class="is-'+esc(row.type)+(failed?' is-failed':'')+'"><details class="ask-trace-row-detail"'+(expanded?' open':'')+'><summary data-act="ask-trace-row-toggle" data-row="'+esc(row.key || String(index))+'"><span class="ask-row-ico">'+icon+'</span><b>'+label+'</b><em>'+esc(brief)+'</em></summary><pre>'+esc(row.type === 'tool' ? row.name+'\n'+full : full)+'</pre></details></li>';
}

// 拉取某条回复对应运行的完整轨迹（思考 / 工具调用），用于消息里的“执行过程”
const askTraceLoading = new Set();
async function askLoadMessageTrace(msg, runId, chatId) {
  const a = askState();
  const sid = chatId || a.activeId;
  const id = String(runId || (msg && msg.execution && msg.execution.id) || '');
  if (!id || !sid) return;
  if (askTraceLoading.has(id)) return;
  askTraceLoading.add(id);
  if (msg) { msg._traceLoading = true; msg._traceError = ''; }
  if (state.route === 'script') askRenderMessages();
  try {
    const data = await askApi('/sessions/' + encodeURIComponent(sid) + '/trajectory?run_id=' + encodeURIComponent(id)).then((r) => r.json());
    const items=[];
    items.push(...((data && data.items) || []));
    let next=data?.next_offset;
    while (next != null) {
      const page=await askApi('/sessions/'+encodeURIComponent(sid)+'/trajectory?run_id='+encodeURIComponent(id)+'&offset='+next+'&limit=100').then(r=>r.json());
      items.push(...(page.items || []));
      if (page.next_offset === next) break;
      next=page.next_offset;
    }
    msg.trajectory = items;
  } catch (err) {
    // 失败不要留空数组：留着未加载状态，用户还能重试
    msg.trajectory = undefined;
    msg._traceError = (err && err.message) || '执行过程加载失败';
  } finally {
    askTraceLoading.delete(id);
    if (msg) msg._traceLoading = false;
  }
  if (state.route === 'script') askRenderMessages();
}

function askExecutionTools(msg) {
  if (msg.liveTools?.length) return msg.liveTools;
  if (msg.execution?.tools?.length) return msg.execution.tools;
  const tools = [];
  for (const item of msg.trajectory || []) {
    if (item.role === 'assistant') for (const call of item.tool_calls || []) tools.push({ id: call.id, name: call.name, status: 'running' });
    if (item.role === 'tool') {
      const tool = tools.find(t => item.tool_call_id ? t.id === item.tool_call_id : t.name === item.tool_name && t.status === 'running');
      if (tool) tool.status = item.status || 'success';
      else tools.push({ name: item.tool_name, status: item.status || 'success' });
    }
  }
  return tools;
}

function askPlanHistoryHtml(exec, expanded = false) {
  const planSteps = exec.plan?.steps?.length ? exec.plan.steps : (exec.steps || []);
  if (!planSteps.length) return '';
  const stepHtml = planSteps.map((step, index) => {
    const stateText = { pending: '待执行', running: '执行中', completed: '已完成', blocked: '待补充' }[step.status] || step.status;
    const icon = step.status === 'completed' ? '✓' : step.status === 'running' ? '◐' : step.status === 'blocked' ? '!' : index + 1;
    return `<li class="${esc(step.status || '')}">
      <span class="ask-node">${icon}</span>
      <div class="ask-step">
        <div class="ask-step-title"><b>${esc(step.title || '')}</b><span>${esc(stateText)}</span></div>
        <p class="ask-step-purpose">${esc(step.purpose || '')}</p>
        ${step.output ? `<div class="ask-step-output"><small>本步产出 <span>模型分析</span></small><div class="ask-md">${askMarkdown(step.output)}</div></div>` : ''}
        ${(step.evidence && step.evidence.length) ? `<details class="ask-evidence"><summary>依据材料 · ${step.evidence.length} 项 ›</summary>${step.evidence.map((s) => `<div><b>${esc(s.title || '')}</b><span>${esc(s.kind === 'guidance' ? '指导文档' : s.kind === 'workspace' ? '工作空间文件' : s.kind === 'artifact' ? '生成的交付文件' : '用户提供')} · ${esc(s.id || '')}</span><p>${esc(String(s.content || ''))}</p></div>`).join('')}</details>` : ''}
      </div></li>`;
  }).join('');
  return '<details class="ask-trace-section ask-plan-history ask-trace-fold" aria-label="计划流程与依据"'+(expanded?' open':'')+'><summary data-act="ask-trace-section-toggle" data-section="plan">计划流程</summary>'+(exec.plan?.goal?'<p class="ask-goal">'+esc(exec.plan.goal)+'</p>':'')+'<ol class="ask-steps">'+stepHtml+'</ol></details>';
}

function askTraceHtml(msg, pending) {
  const exec = msg.execution;
  if (!exec) return pending ? '<p class="ask-process-note">执行中…</p>' : '';
  const planHtml = askPlanHistoryHtml(exec, msg.planSectionOpen === true);
  const rows = askTraceRows(msg);
  if (!rows.length) for (const tool of msg.execution?.tools || []) { rows.push({type:'tool',name:tool.name,args:''}); rows.push({type:'result',name:tool.name,status:tool.status,text:tool.output || ''}); }
  const runId = exec.id || '';
  const loading = !!msg._traceLoading;
  const failed = !!msg._traceError;
  const loaded = Array.isArray(msg.trajectory);
  const canLoad = !loaded && !!runId;
  const open = msg.traceOpen === true;
  const running = !!pending || exec.status === 'running';
  if (running && msg._t0 == null) msg._t0 = Date.now();
  const since = running ? Number(msg._t0) || Date.now() : 0;
  const headText = askHeading(exec, pending, msg);
  const headInner = running ? '<span class="ask-trace-live" data-trace-live data-since="'+since+'"><span class="ask-trace-live-text">'+esc(headText)+'</span><span class="ask-trace-live-time"> · '+esc(askDurationText(Date.now()-since))+'</span></span>' : '<span>'+esc(headText)+'</span>';
  if (loaded && !rows.length && !planHtml && !pending) return '<div class="ask-trace is-static"><div class="ask-trace-head is-static"><span>'+esc(headText)+'</span></div></div>';
  const toolHtml = rows.map((row, index) => askTraceRowHtml(row, index, !!msg.traceRowsOpen?.[row.key || String(index)])).join('');
  return '<section class="ask-trace '+(pending?'is-running ':'')+(open?'is-open':'')+'" data-trace-run="'+esc(runId)+'"><button type="button" class="ask-trace-head" data-act="ask-trace-toggle" data-run="'+esc(runId)+'" aria-expanded="'+open+'">'+headInner+'<span class="ask-chev">'+(open?'⌄':'›')+'</span></button>'+(open?'<div class="ask-trace-body">'+(toolHtml?'<details class="ask-trace-section ask-trace-fold" aria-label="工具调用轨迹"'+(msg.traceSectionOpen?' open':'')+'><summary data-act="ask-trace-section-toggle" data-section="trace">轨迹</summary><ul class="ask-trace-rows">'+toolHtml+'</ul></details>':'')+planHtml+((loading || (canLoad&&!pending&&!failed))?'<p class="ask-trace-empty">正在加载执行过程…</p>':'')+(failed?'<button type="button" class="ask-trace-load" data-act="ask-load-trace" data-run="'+esc(runId)+'" title="'+esc(msg._traceError)+'">重新加载执行过程</button>':'')+'</div>':'')+'</section>';
}

function askPlanDockHtml(chat) {
  const msg = [...(chat?.messages || [])].reverse().find(m => m.role === 'assistant');
  const plan = msg?.execution?.plan;
  if (!plan?.steps?.length) return '';
  const steps = plan.steps;
  if (steps.every(step => step.status === 'pending' || !step.status)) return '';
  const completed = steps.filter(s => s.status === 'completed').length;
  const labels = {pending:'待执行',running:'执行中',completed:'已完成',blocked:'待补充',failed:'失败',cancelled:'已取消'};
  const ended = msg.execution.status !== 'running' && !msg._streaming;
  const open = msg.planCollapsed === false;
  return '<section class="ask-plan-dock" aria-label="任务计划"><button type="button" class="ask-plan-head" data-act="ask-plan-toggle" aria-expanded="'+open+'"><b>任务计划</b><span>'+completed+' / '+steps.length+' 已完成'+(ended?' · 本轮已结束':'')+'</span><span class="ask-plan-chevron">'+(open?'⌄':'›')+'</span></button>'+(open?'<div class="ask-plan-scroll">'+(plan.goal?'<p>'+esc(plan.goal)+'</p>':'')+'<ol>'+steps.map((step,i)=>'<li class="is-'+esc(step.status || 'pending')+'"><span class="ask-plan-index">'+(step.status==='completed'?'✓':step.status==='running'?'◐':i+1)+'</span><b>'+esc(step.title || '')+'</b><small>'+esc(labels[step.status]||'待执行')+'</small></li>').join('')+'</ol></div>':'')+'</section>';
}

function askSyncPlanDock(chatId) {
  const chat = askActive();
  if (!chat || (chatId && chat.id !== chatId)) return;
  const host = document.getElementById('ask-plan-dock');
  if (!host) return;
  const scroll = host.querySelector('.ask-plan-scroll')?.scrollTop || 0;
  host.innerHTML = askPlanDockHtml(chat);
  const next = host.querySelector('.ask-plan-scroll');
  if (next) next.scrollTop = scroll;
}

// 展开执行过程就等于要看到内容：渲染后自动把没加载的轨迹拉回来，不再多一个「加载执行过程」按钮。
// 流式过程中先看实时行（execution.steps / tools），本轮结束后自动补全。
function askTraceAutoLoad(chat) {
  if (!chat || state.route !== 'script') return;
  for (const msg of chat.messages || []) {
    if (!msg || msg.role !== 'assistant') continue;
    const exec = msg.execution;
    if (!exec || !exec.id) continue;
    if (Array.isArray(msg.trajectory) || msg._traceError || msg._traceLoading) continue;
    if (!msg.traceOpen || msg._streaming) continue;
    askLoadMessageTrace(msg, exec.id, chat.id).catch(() => {});
  }
}

/* ---- 执行中的实时状态：不是固定一句「执行中」，而是跟着工具在干什么走 ---- */
const ASK_TOOL_ACTIONS = {
  run_command: ['准备运行命令', '执行了命令', '命令执行失败'],
  write_file: ['准备写入文件', '已写入文件', '写入文件失败'],
  read_file: ['准备读取文件', '已读取文件', '读取文件失败'],
  list_dir: ['准备查看目录', '已查看目录', '查看目录失败'],
  make_dir: ['准备创建目录', '已创建目录', '创建目录失败'],
  move_file: ['准备移动文件', '已移动文件', '移动文件失败'],
  copy_file: ['准备复制文件', '已复制文件', '复制文件失败'],
  delete_file: ['准备删除文件', '已删除文件', '删除文件失败'],
  read_permission: ['正在确认权限', '已确认权限', '确认权限失败'],
  generate_image: ['准备生成图片', '已生成图片', '生成图片失败'],
  submit_video_job: ['准备提交视频任务', '已提交视频任务', '提交视频任务失败'],
  extract_frames: ['准备抽帧', '已抽帧', '抽帧失败'],
  create_workspace_artifact: ['准备写入交付文件', '已写入交付文件', '写入交付文件失败'],
  publish_artifact: ['准备交付文件', '已交付文件', '交付文件失败'],
  create_task_plan: ['正在制定计划', '已制定计划', '制定计划失败'],
  record_step_result: ['正在记录步骤结果', '已记录步骤结果', '记录步骤结果失败'],
  read_analysis_guidance: ['正在读取指导文档', '已读取指导文档', '读取指导文档失败'],
  ask_choice: ['正在准备选项面板', '已发出选项面板', '选项面板失败'],
};

function askDurationText(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? minutes + '分' + (rest ? rest + '秒' : '') : seconds + '秒';
}

// 这一步在做什么：工具名 + 参数/结果摘要（命令、路径、文件名）
function askLiveStatus(msg) {
  const live = (msg && msg.live) || null;
  if (!live || !live.tool) return { text: '正在分析请求', detail: (live && live.detail) || '' };
  const phases = ASK_TOOL_ACTIONS[live.tool];
  const word = live.phase === 'running' ? 0 : live.phase === 'failed' ? 2 : 1;
  const text = phases
    ? phases[word]
    : live.phase === 'running' ? '准备执行 ' + live.tool : live.phase === 'failed' ? '执行 ' + live.tool + ' 失败' : '已执行 ' + live.tool;
  return { text, detail: live.detail || '' };
}

let askLiveTimer = 0;
// 只改时间文字，不整页重绘：一次长命令跑几分钟也能一直走秒
function askEnsureLiveTicker() {
  if (askLiveTimer) return;
  askLiveTimer = setInterval(() => {
    const nodes = document.querySelectorAll('[data-trace-live]');
    if (!nodes.length) return;
    for (const node of nodes) {
      const since = Number(node.dataset.since) || 0;
      const time = node.querySelector('.ask-trace-live-time');
      if (!since || !time) continue;
      time.textContent = ' · ' + askDurationText(Date.now() - since);
    }
  }, 1000);
}

function askHeading(exec, pending, msg) {
  if (pending || (exec && exec.status === 'running')) {
    if (msg && msg._t0 == null) msg._t0 = Date.now();
    const live = askLiveStatus(msg);
    return live.detail ? live.text + ' · ' + live.detail : live.text;
  }
  const labels = { completed: '已完成', succeeded: '已完成', partial: '部分完成', blocked: '待补充', failed: '执行失败', cancelled: '已停止', budget_exceeded: '已达预算上限', interrupted: '执行中断' };
  const status = labels[(exec && (exec.outcome || exec.status)) || ''] || '历史回复';
  const ms = exec && (exec.duration_ms != null ? exec.duration_ms : (exec.finished_at != null && exec.started_at != null ? exec.finished_at - exec.started_at : null));
  if (ms == null || !Number.isFinite(ms)) return status;
  return status + '，用时' + askDurationText(ms);
}

function askFilesHtml(files) {
  if (!files || !files.length) return '';
  return `<div class="ask-files">${files.map((f) => `<button type="button" class="ask-file" data-act="ask-preview" data-id="${esc(f.id)}" title="${esc(f.name || '')}">
    <span class="ask-file-icon">${/(\.md|\.txt|\.json|\.csv)$/i.test(f.name || '') ? '📄' : '📎'}</span>
    <span><b>${esc(f.name || '文件')}</b><small>${f.size ? fmtBytes(f.size) : ''}</small></span>
  </button>`).join('')}</div>`;
}

/* ------------------- 对话里的交互组件（豆包 GenUI / DIL） ------------------- */
// 豆包系模型偶尔会把交互组件源码直接写进回复：
//   {@body const [style,setStyle] = DIL.useState("诗意苍凉")}
//   <box border radius="xl" padding={4} gap={4}>
//     <text weight="medium">1. 整体氛围</text>
//     <radio-group value={style} onChange={setStyle}>…</radio-group>
//     <button block onClick={() => GenUI.issueNewTurn("…"+style+"…")}>生成</button>
//   </box>
// 这里把它还原成真实的单选卡片 + 动作按钮，标签不会再裸露在对话正文里。

const askGenUiMemory = new Map();
const GU_TAG_SRC = '<(\\/?)([a-zA-Z][\\w-]*)((?:\\{[^{}]*\\}|"[^"]*"|\'[^\']*\'|[^<>"\'])*?)(\\/?)>';

/* --- 格式协议 ---------------------------------------------------------------
   一条回复里只允许两种格式，且必须靠标签边界区分清楚：
   1) 正文 = Markdown：普通文字、标题、列表、表格、代码块。这里出现的 <…> 一律当文字。
   2) 组件 = 下面这张白名单里的标签，标签名大小写不敏感、可写 GridItem / Column 这类别名。
   任何不在白名单里的标签都不进正文：带属性的（<Foo bar="1"/>）、自闭合的组件式标签
   直接吞掉，避免把模型内部协议漏给用户；正文里的素材编号 <Picture N>、<Subject N>、
   <Audio N>、台词 <d>[Chinese] …</d> 没有属性，照原样保留。                              */
const GU_RENDER_TAGS = new Set([
  'box', 'card', 'panel', 'row', 'col', 'stack', 'group', 'grid', 'grid-item',
  'text', 'image', 'img', 'asyncimage', 'asyncimagegroup', 'divider',
  'radio-group', 'checkbox-group', 'radio', 'checkbox', 'option', 'choice',
  'button', 'input', 'textarea', 'link', 'a', 'tag',
]);
const GU_CONTAINER_TAGS = new Set(['box', 'card', 'panel', 'row', 'col', 'stack', 'group', 'grid', 'grid-item']);
const GU_TAG_ALIASES = {
  column: 'col', columns: 'col', section: 'box', container: 'box', wrapper: 'box', layout: 'box',
  caption: 'text', label: 'text', paragraph: 'text',
  item: 'grid-item', hr: 'divider', chip: 'tag', badge: 'tag',
  checkboxgroup: 'checkbox-group', radiogroup: 'radio-group', select: 'radio-group',
};
const GU_SAFE_PROSE_TAGS = new Set(['b', 'i', 'u', 's', 'em', 'strong', 'code', 'br', 'sub', 'sup', 'mark', 'small', 'kbd', 'del', 'ins']);
const GU_TAG_CANON = new Map();
for (const name of GU_RENDER_TAGS) GU_TAG_CANON.set(name.replace(/-/g, ''), name);
for (const [alias, name] of Object.entries(GU_TAG_ALIASES)) GU_TAG_CANON.set(alias.replace(/-/g, ''), name);

function guTagName(raw) {
  const flat = String(raw == null ? '' : raw).toLowerCase().replace(/[-_\s]/g, '');
  return GU_TAG_CANON.get(flat) || String(raw == null ? '' : raw).toLowerCase();
}

// 一眼能看出是不是组件协议：白名单标签、带属性、或大写开头的自闭合标签
function guLooksComponent(name, attrs, selfClose) {
  const tag = guTagName(name);
  if (GU_RENDER_TAGS.has(tag)) return true;
  if (GU_SAFE_PROSE_TAGS.has(tag)) return false;
  if (/=/.test(String(attrs || ''))) return true;
  return !!selfClose && /^[A-Z]/.test(String(name || ''));
}

// 万一有标签漏到 Markdown 段落里（流式中途、模型忘闭合），这里兜底不再裸露
function guScrubLeaks(text) {
  let out = String(text == null ? '' : text);
  if (out.indexOf('<') < 0) return out;
  const whole = out;
  out = out.replace(new RegExp(GU_TAG_SRC, 'g'), (all, close, name, attrs, selfClose, offset) => {
    if (guInCode(whole, offset)) return all;                  // 代码块里讨论的标签是文字
    if (GU_RENDER_TAGS.has(guTagName(name))) return '';        // 组件标签漏进正文：吞掉
    if (GU_SAFE_PROSE_TAGS.has(guTagName(name))) return all;   // <br> 这类内联 HTML 原样保留
    if (close) return all;                                     // </d> 这类正文标记保留
    return guLooksComponent(name, attrs, selfClose) ? '' : all;
  });
  // 流式输出时尾巴上那半个标签也别闪出来
  const tail = /<\s*\/?([A-Za-z][\w:-]*)((?:\s[^<>]*)?)$/.exec(out);
  if (tail && !guInCode(out, tail.index) && guLooksComponent(tail[1], tail[2] || '', /\/$/.test(out))) out = out.slice(0, tail.index);
  return out;
}

// 引号没写完的组件标签（流式中途最常见）连 GU_TAG_SRC 都匹配不到，按行兜底：
// 能捞到画面描述就重建成规范标签，捞不到就整行丢掉
function guLooseAttrs(body) {
  const out = {};
  const re = /([A-Za-z_][\w:-]*)\s*=\s*(?:"([^"]*)"?|'([^']*)'?|([^\s>]+))/g;
  let m;
  const src = String(body || '');
  while ((m = re.exec(src))) out[m[1]] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
  return out;
}

function guFixStrayTags(text) {
  const src = String(text == null ? '' : text);
  if (src.indexOf('<') < 0) return src;
  const lines = src.split('\n');
  const atStart = new RegExp('^[ \\t]*' + GU_TAG_SRC);
  let fence = false;
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    if ((line.match(/`/g) || []).length % 2 === 1) continue;
    const head = /^[ \t]*<\s*\/?([A-Za-z][\w:-]*)/.exec(line);
    if (!head) continue;
    const name = head[1];
    if (atStart.test(line)) continue;                          // 正常闭合的标签，交给分段器
    const tag = guTagName(name);
    if (GU_SAFE_PROSE_TAGS.has(tag)) continue;
    if (!GU_RENDER_TAGS.has(tag) && !/^[A-Z]/.test(name)) continue;
    const attrs = guLooseAttrs(line);
    const query = attrs.query || attrs.prompt || attrs.queries || '';
    const ratio = String(attrs.aspectRatio || attrs.aspect_ratio || attrs.ratio || '').replace(/\/+$/, '');
    lines[i] = query
      ? `<AsyncImage query="${String(query).replace(/"/g, "'")}"${ratio ? ` aspectRatio="${ratio.replace(/"/g, '')}"` : ''}/>`
      : '';
    changed = true;
  }
  return changed ? lines.join('\n') : src;
}

function guReadString(src, index) {
  const quote = src[index];
  let out = '';
  let i = index + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const next = src[i + 1];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 2;
      continue;
    }
    if (ch === quote) return { value: out, next: i + 1 };
    out += ch;
    i += 1;
  }
  return { value: out, next: src.length };
}

// 只做字符串拼接求值，不执行模型给的任意代码
function guEvalExpr(expr, values) {
  let src = String(expr == null ? '' : expr).trim();
  if (!src) return '';
  const store = values || {};
  const call = /GenUI\.[A-Za-z_$][\w$]*\s*\(/.exec(src);
  if (call) {
    let i = call.index + call[0].length;
    const start = i;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '"' || ch === "'") { i = guReadString(src, i).next; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    src = src.slice(start, Math.max(start, i - 1));
  }
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") { const r = guReadString(src, i); out += r.value; i = r.next; continue; }
    if (ch === '`') {
      let k = i + 1;
      while (k < src.length && src[k] !== '`') {
        if (src[k] === '$' && src[k + 1] === '{') {
          let depth = 1;
          let e = k + 2;
          while (e < src.length && depth > 0) {
            if (src[e] === '{') depth += 1;
            else if (src[e] === '}') depth -= 1;
            e += 1;
          }
          out += guEvalExpr(src.slice(k + 2, Math.max(k + 2, e - 1)), store);
          k = e;
          continue;
        }
        out += src[k];
        k += 1;
      }
      i = k + 1;
      continue;
    }
    const ident = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (ident) {
      const name = ident[0];
      if (Object.prototype.hasOwnProperty.call(store, name)) out += String(store[name] == null ? '' : store[name]);
      i += name.length;
      continue;
    }
    i += 1;
  }
  return out;
}

function guStateDecls(text) {
  const decls = {};
  const re = /\{@body\s+const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*DIL\.useState\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)?\s*\)\s*\}/g;
  const src = String(text || '');
  let m;
  while ((m = re.exec(src))) {
    decls[m[1]] = { setter: m[2], value: m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : '' };
  }
  return decls;
}

function guStripDecls(text) {
  return String(text || '').replace(/^[ \t]*\{@body[^\n]*\}[ \t]*\r?\n?/gm, '').replace(/^[ \t]*\{@body[^\n]*\}[ \t]*/gm, '');
}

// 代码块/行内代码里的标签是“被讨论的文字”，不能当组件执行
function guInCode(src, index) {
  const upto = String(src || '').slice(0, Math.max(0, index));
  if ((upto.match(/```/g) || []).length % 2 === 1) return true;
  const line = upto.slice(upto.lastIndexOf('\n') + 1);
  return (line.match(/`/g) || []).length % 2 === 1;
}

function guLocateBlock(text) {
  const src = String(text || '');
  // 块首 = 任意白名单标签（不只是容器）。模型常常单独甩一个 <AsyncImage …/> 或
  // <text …>…</text>，只认容器的话这段协议就会原样漏进正文。
  const probe = new RegExp(GU_TAG_SRC, 'g');
  let head = null;
  let m;
  while ((m = probe.exec(src))) {
    if (m[1]) continue;
    if (!GU_RENDER_TAGS.has(guTagName(m[2]))) continue;
    if (guInCode(src, m.index)) continue;
    head = { index: m.index, end: probe.lastIndex, selfClose: !!m[4] };
    break;
  }
  if (!head) return null;
  if (head.selfClose) return { start: head.index, end: head.end, body: src.slice(head.index, head.end), partial: false };
  const re = new RegExp(GU_TAG_SRC, 'g');
  re.lastIndex = head.index;
  let depth = 0;
  while ((m = re.exec(src))) {
    if (m[4]) continue;
    if (m[1]) {
      depth -= 1;
      if (depth <= 0) return { start: head.index, end: re.lastIndex, body: src.slice(head.index, re.lastIndex), partial: false };
    } else {
      depth += 1;
    }
  }
  return { start: head.index, end: src.length, body: src.slice(head.index), partial: true };
}

function guSegments(text) {
  const segs = [];
  let rest = String(text || '');
  for (let guard = 0; guard < 400; guard += 1) {
    const block = guLocateBlock(rest);
    if (!block) { segs.push({ type: 'md', value: rest }); break; }
    if (block.start > 0) segs.push({ type: 'md', value: rest.slice(0, block.start) });
    if (block.partial) {
      // 模型忘闭合时只吃掉这一行组件，后面的正文继续按 Markdown 排，别整段被一个标签吞掉
      const src = rest.slice(block.start);
      const cut = src.search(/\n\s*\n/);
      const body = cut > 0 ? src.slice(0, cut) : src;
      if (body.replace(/\s/g, '').length < 40) segs.push({ type: 'pending' });
      else segs.push({ type: 'ui', body });
      if (cut > 0) { rest = src.slice(cut); continue; }
      break;
    }
    segs.push({ type: 'ui', body: block.body });
    rest = rest.slice(block.end);
  }
  return segs;
}

function guParseAttrs(raw) {
  const out = {};
  const src = String(raw || '');
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (i >= src.length) break;
    const name = /^[A-Za-z_][\w:-]*/.exec(src.slice(i));
    if (!name) { i += 1; continue; }
    const key = name[0];
    i += key.length;
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] !== '=') { out[key] = { kind: 'flag', value: true }; continue; }
    i += 1;
    while (i < src.length && /\s/.test(src[i])) i += 1;
    const quote = src[i];
    if (quote === '"' || quote === "'") {
      const read = guReadString(src, i);
      out[key] = { kind: 'str', value: read.value };
      i = read.next;
      continue;
    }
    if (quote === '{') {
      let depth = 1;
      let k = i + 1;
      while (k < src.length && depth > 0) {
        if (src[k] === '{') depth += 1;
        else if (src[k] === '}') depth -= 1;
        k += 1;
      }
      out[key] = { kind: 'expr', value: src.slice(i + 1, Math.max(i + 1, k - 1)) };
      i = k;
      continue;
    }
    const bare = /^[^\s>]+/.exec(src.slice(i));
    out[key] = { kind: 'str', value: bare ? bare[0] : '' };
    i += bare ? bare[0].length : 1;
  }
  return out;
}

function guPushText(parent, raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (text) parent.children.push({ name: '#text', text });
}

function guBuildTree(body) {
  const src = String(body || '');
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = new RegExp(GU_TAG_SRC, 'g');
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) guPushText(stack[stack.length - 1], src.slice(last, m.index));
    last = re.lastIndex;
    const tag = guTagName(m[2]);
    if (m[1]) {
      for (let k = stack.length - 1; k > 0; k -= 1) if (stack[k].name === tag) { stack.length = k; break; }
      continue;
    }
    const node = { name: tag, attrs: guParseAttrs(m[3]), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  if (last < src.length) guPushText(stack[stack.length - 1], src.slice(last));
  return root;
}

function guAttrText(node, name, ctx) {
  const attr = node.attrs && node.attrs[name];
  if (!attr) return '';
  if (attr.kind === 'expr') return guEvalExpr(attr.value, ctx.values);
  return String(attr.value == null ? '' : attr.value);
}

function guExprOf(node, name) {
  const attr = node.attrs && node.attrs[name];
  return attr && attr.kind === 'expr' ? String(attr.value || '') : '';
}

function guBindKey(node, ctx) {
  const bound = guExprOf(node, 'value').trim();
  if (bound) {
    if (ctx.decls[bound]) return bound;
    for (const [key, decl] of Object.entries(ctx.decls)) if (decl.setter === bound) return key;
    return bound;
  }
  const change = guExprOf(node, 'onChange').trim();
  if (change) for (const [key, decl] of Object.entries(ctx.decls)) if (decl.setter === change) return key;
  return '';
}

function guRenderChildren(node, ctx) {
  return (node.children || []).map((child) => guRenderNode(child, ctx)).join('');
}

function guRenderNode(node, ctx) {
  if (!node) return '';
  if (node.name === '#text') return mdInline(node.text || '');
  const children = () => guRenderChildren(node, ctx);
  switch (node.name) {
    case 'box':
    case 'card':
    case 'panel':
    case 'row':
    case 'col':
    case 'stack':
    case 'group': {
      const cls = ['gu-box'];
      if (node.name === 'row') cls.push('is-row');
      if (node.attrs.border) cls.push('has-border');
      if (node.attrs.flex) cls.push('is-flex');
      return `<div class="${cls.join(' ')}">${children()}</div>`;
    }
    case 'grid': {
      const cols = Math.max(1, Math.min(4, Number(guAttrText(node, 'columns', ctx) || guAttrText(node, 'cols', ctx)) || 2));
      return `<div class="gu-grid" data-cols="${cols}">${children()}</div>`;
    }
    case 'grid-item':
    case 'griditem':
      return `<div class="gu-grid-item">${children()}</div>`;
    case 'asyncimagegroup': {
      const raw = guExprOf(node, 'query') || guExprOf(node, 'queries') || guExprOf(node, 'prompts');
      let queries = [];
      try {
        const parsed = JSON.parse(String(raw || '').trim() || '[]');
        if (Array.isArray(parsed)) queries = parsed.map((q) => String(q || ''));
      } catch { /* 不是 JSON 就按引号切 */ }
      if (!queries.length) queries = (String(raw || '').match(/["'`]([^"'`]+)["'`]/g) || []).map((s) => s.slice(1, -1));
      if (!queries.length) return '';
      const ratio = guAttrText(node, 'aspectRatio', ctx) || guAttrText(node, 'aspect_ratio', ctx) || guAttrText(node, 'ratio', ctx);
      return `<div class="gu-grid gu-ref-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,236px));gap:10px;justify-content:start;max-width:100%">${queries.map((q) => guRefCardHtml(q, ratio)).join('')}</div>`;
    }
    case 'text': {
      const weight = guAttrText(node, 'weight', ctx);
      const size = guAttrText(node, 'size', ctx);
      const tone = guAttrText(node, 'color', ctx);
      const cls = ['gu-text'];
      if (weight === 'medium' || weight === '500') cls.push('is-medium');
      if (weight === 'bold' || weight === '600' || weight === '700') cls.push('is-bold');
      if (size === 'sm' || size === 'small') cls.push('is-sm');
      if (tone === 'secondary' || tone === 'muted') cls.push('is-muted');
      // 组件里的文字如果带标题、表格、列表这类块级 markdown，就按正文排版渲染，别挤成一段
      const raw = (node.children || []).map((child) => (child && child.name === '#text' ? String(child.text || '') : '')).join('');
      if (/(^|\n)\s*(#{1,6}\s|\||[-*+]\s|\d+[.)]\s|>)/.test(raw) || /^\s*\|/.test(raw)) {
        return `<div class="${cls.join(' ')} is-block">${askMarkdown(raw)}</div>`;
      }
      return `<p class="${cls.join(' ')}">${children()}</p>`;
    }
    case 'asyncimage':
    case 'image':
    case 'img': {
      const src = guAttrText(node, 'src', ctx);
      if (src) return `<img class="gu-image" src="${esc(src)}" alt="${esc(guAttrText(node, 'alt', ctx))}" loading="lazy" />`;
      const query = guAttrText(node, 'query', ctx) || guAttrText(node, 'prompt', ctx) || guAttrText(node, 'alt', ctx);
      const ratio = guAttrText(node, 'aspectRatio', ctx) || guAttrText(node, 'aspect_ratio', ctx) || guAttrText(node, 'ratio', ctx);
      return guRefCardHtml(query, ratio);
    }
    case 'divider':
    case 'hr':
      return '<hr class="gu-divider">';
    case 'radio-group':
    case 'checkbox-group': {
      const multi = node.name === 'checkbox-group';
      const key = guBindKey(node, ctx);
      const current = ctx.values[key];
      const row = guAttrText(node, 'direction', ctx) === 'row';
      const options = (node.children || []).map((child) => {
        if (child.name === '#text') return '';
        if (!['radio', 'checkbox', 'option', 'choice'].includes(child.name)) return guRenderNode(child, ctx);
        const value = guAttrText(child, 'value', ctx) || String((child.children || []).map((c) => c.text || '').join('').trim());
        const on = multi ? (Array.isArray(current) && current.includes(value)) : String(current == null ? '' : current) === value;
        return `<button type="button" class="gu-option${on ? ' is-on' : ''}" data-act="gu-pick" data-gu-key="${esc(key)}" data-gu-value="${esc(value)}" data-gu-multi="${multi ? 1 : 0}" aria-pressed="${on ? 'true' : 'false'}"><span class="gu-dot"></span><span class="gu-option-label">${guRenderChildren(child, ctx)}</span></button>`;
      }).join('');
      return `<div class="gu-options${row ? ' is-row' : ''}"${key ? ` data-gu-group="${esc(key)}"` : ''}>${options}</div>`;
    }
    case 'radio':
    case 'checkbox':
    case 'option':
      return children();
    case 'button': {
      const expr = guExprOf(node, 'onClick');
      const copy = /GenUI\.copy\s*\(/.test(expr);
      const cls = ['gu-action'];
      if (node.attrs.block) cls.push('is-block');
      const variant = guAttrText(node, 'variant', ctx);
      if (variant === 'secondary' || variant === 'outline' || variant === 'ghost') cls.push('is-ghost');
      const attr = copy ? `data-act="gu-copy" data-gu-expr="${esc(expr)}"` : `data-act="gu-run" data-gu-expr="${esc(expr)}"`;
      return `<button type="button" class="${cls.join(' ')}" ${attr}${copy ? ' title="复制这段提示词"' : ''}>${children() || (copy ? '复制' : '继续')}</button>`;
    }
    case 'input':
    case 'textarea': {
      const key = guBindKey(node, ctx);
      const value = ctx.values[key];
      const placeholder = guAttrText(node, 'placeholder', ctx);
      const field = node.name === 'textarea'
        ? `<textarea class="gu-input" rows="2" placeholder="${esc(placeholder)}"${key ? ` data-gu-key="${esc(key)}"` : ''}>${esc(value == null ? '' : value)}</textarea>`
        : `<input class="gu-input" type="text" placeholder="${esc(placeholder)}" value="${esc(value == null ? '' : value)}"${key ? ` data-gu-key="${esc(key)}"` : ''} />`;
      return field;
    }
    case 'link':
    case 'a': {
      const href = guAttrText(node, 'href', ctx);
      return href ? `<a class="gu-link" href="${esc(href)}" target="_blank" rel="noreferrer">${children()}</a>` : children();
    }
    case 'tag':
      return `<span class="gu-tag">${children()}</span>`;
    default: {
      // 白名单之外的标签：只要它带着画面描述/图片地址，就按参考图落地；否则只取子节点
      const src = guAttrText(node, 'src', ctx);
      if (src) return `<img class="gu-image" src="${esc(src)}" alt="${esc(guAttrText(node, 'alt', ctx))}" loading="lazy" />`;
      const query = guAttrText(node, 'query', ctx) || guAttrText(node, 'prompt', ctx);
      if (query) {
        const ratio = guAttrText(node, 'aspectRatio', ctx) || guAttrText(node, 'aspect_ratio', ctx) || guAttrText(node, 'ratio', ctx);
        return guRefCardHtml(query, ratio);
      }
      return children();
    }
  }
}

function guValuesFor(message, decls) {
  const id = (message && message.id) || 'anon';
  let record = askGenUiMemory.get(id);
  if (!record) { record = { values: {} }; askGenUiMemory.set(id, record); }
  for (const [key, decl] of Object.entries(decls)) if (!(key in record.values)) record.values[key] = decl.value;
  return record.values;
}

function guRenderBlock(message, decls, body) {
  const values = guValuesFor(message, decls);
  const ctx = { decls, values };
  const tree = guBuildTree(guStripDecls(body));
  const inner = guRenderChildren(tree, ctx);
  // 只有叶子（<text>、<AsyncImage/>…）时贴正文排，不再套一层卡片边框，避免把一段话切成碎块
  const leafOnly = (tree.children || []).every((child) => child.name === '#text' || !GU_CONTAINER_TAGS.has(child.name));
  const cls = leafOnly ? 'gu-inline' : 'gu-card';
  return `<div class="${cls}" data-gu-msg="${esc((message && message.id) || '')}">${inner}</div>`;
}

function guHtmlFor(text, message, decls) {
  const segs = guSegments(guFixStrayTags(text));
  const scopes = decls || guStateDecls(text);
  return segs.map((seg) => {
    if (seg.type === 'pending') return '<div class="gu-card gu-card-pending"><span class="gu-spin"></span>正在整理可选项…</div>';
    if (seg.type === 'ui') return guRenderBlock(message, scopes, seg.body);
    const md = guScrubLeaks(guStripDecls(seg.value))
      .replace(/<\/?WritingBlock\b[^>]*>/gi, '')
      .replace(/```[a-zA-Z0-9]*\s*\n\s*```/g, '')
      .replace(/\n{3,}/g, '\n\n');
    if (!md.trim()) return '';
    return `<div class="ask-message-text">${askMarkdown(md)}</div>`;
  }).join('');
}

function guPlainText(text) {
  const src = guFixStrayTags(text);
  const segs = guSegments(src);
  const parts = [];
  for (const seg of segs) {
    if (seg.type === 'md') {
      const prose = guScrubLeaks(guStripDecls(seg.value)).trim();
      if (prose) parts.push(prose);
      continue;
    }
    if (seg.type !== 'ui') continue;
    const lines = [];
    const walk = (node) => {
      if (!node) return;
      if (node.name === '#text' && node.text) lines.push(node.text);
      if (node.name === 'button') return;
      for (const child of node.children || []) walk(child);
    };
    walk(guBuildTree(guStripDecls(seg.body)));
    if (lines.length) parts.push(lines.join('\n'));
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* 画面参考：直接按英文描述出图，不走反推/识别；同一条描述只出一次，结果在内存里复用 */
const ASK_REF_CACHE = new Map();
const ASK_REF_INFLIGHT = new Set();
const ASK_REF_QUEUE = [];
const ASK_REF_PROMPTS = new Map();
const ASK_REF_MANUAL = new Set();
const ASK_REF_LIMIT = 2;

/* 刷新/重开页面后图片不用再走一遍「出图中…」：把「描述 → 图片地址 + 图位比例」记在本机。
   图片文件本身在服务端 data/ref-images 里长期保留，这里只是记住它的地址。 */
const ASK_REF_STORE = 'wmd.refImages';
const ASK_REF_STORE_MAX = 400;
let askRefStoreTimer = null;

function guRefStoreSave() {
  if (typeof localStorage === 'undefined') return;
  try {
    const rows = [];
    for (const [key, hit] of ASK_REF_CACHE) {
      if (!hit || !hit.url) continue;
      rows.push([key, { url: hit.url, path: hit.path || '', ratio: GU_REF_RATIOS.get(key) || '' }]);
    }
    const keep = rows.length > ASK_REF_STORE_MAX ? rows.slice(rows.length - ASK_REF_STORE_MAX) : rows;
    localStorage.setItem(ASK_REF_STORE, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* 存不下也不影响当前会话 */ }
}

function guRefStoreSchedule() {
  if (typeof setTimeout !== 'function' || askRefStoreTimer) return;
  askRefStoreTimer = setTimeout(() => { askRefStoreTimer = null; guRefStoreSave(); }, 400);
}

function guRefStoreHydrate() {
  if (typeof localStorage === 'undefined') return;
  let data = {};
  try {
    const raw = localStorage.getItem(ASK_REF_STORE);
    data = raw ? JSON.parse(raw) : {};
  } catch { data = {}; }
  if (!data || typeof data !== 'object') return;
  for (const [key, hit] of Object.entries(data)) {
    if (!hit || !hit.url) continue;
    ASK_REF_CACHE.set(key, { url: hit.url, path: hit.path || '' });
    if (hit.ratio) GU_REF_RATIOS.set(key, hit.ratio);
  }
}

function guRefStoreForget() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(ASK_REF_STORE); } catch { /* ignore */ }
}

function guRefStoreForget() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(ASK_REF_STORE); } catch { /* ignore */ }
}

// 注意：还原要等 GU_REF_RATIOS 初始化之后再做，提前调用会因为 const 的暂时性死区直接抛错。
// 记忆只对本机有效：换项目/换渠道后旧地址失效时，图片加载失败会退回「点一下重试」

// 开关关掉时一张都不出：不排队、不请求，卡片退回可读的描述
function guRefsEnabled() {
  if (typeof state === 'undefined' || !state || !state.ask) return true;
  return state.ask.refImages !== false;
}

function guRefKey(prompt) {
  const text = String(prompt || '');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36) + '-' + text.length.toString(36);
}

// 尺寸直接写在标签上：样式表没更新到、或者被别的规则盖掉，也不会撑成一大块
const GU_REF_BOX = 'position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;overflow:hidden;padding:0;border:0;background:color-mix(in oklch, currentColor 7%, transparent);color:inherit;font:inherit;font-size:11px;line-height:1.5;';
const GU_REF_IMG = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';
const GU_REF_ACTIONS = 'position:absolute;top:6px;right:6px;display:flex;gap:4px;z-index:3;';
const GU_REF_BTN = 'width:22px;height:22px;display:grid;place-items:center;padding:0;border:0;border-radius:6px;background:rgba(12,14,18,.46);color:#fff;font:inherit;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px);';
const GU_REF_FILL = 'max-width:100%;padding:0 26px 0 14px;text-align:center;font-size:10.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;';

// 参考图按自己的比例占位：9:16 / 16:9 / 1:1 / 3:4 / 4:3 都认，等比放进 236×220 的框里
const GU_REF_MAX_W = 236;
const GU_REF_MAX_H = 220;
const GU_REF_RATIOS = new Map();

// 把本机记住的「描述 → 图片地址/比例」读回内存（必须在 GU_REF_RATIOS 之后执行）
guRefStoreHydrate();

function guRefRatio(value) {
  const text = String(value || '').trim().replace(/[：x×*/\s]/gi, ':').replace(/:+/g, ':');
  const hit = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(text);
  if (!hit) return { label: '4:3', w: 4, h: 3 };
  const w = Number(hit[1]);
  const h = Number(hit[2]);
  if (!(w > 0 && h > 0)) return { label: '4:3', w: 4, h: 3 };
  return { label: `${w}:${h}`, w, h };
}

// 常见的五种画幅；生成出来的图接近哪一种就按哪一种摆，避免每张都塞同一个框
const GU_REF_STANDARD = ['9:16', '16:9', '1:1', '3:4', '4:3'];

function guRefSnapRatio(width, height) {
  if (!(width > 0 && height > 0)) return null;
  const actual = width / height;
  let best = null;
  for (const label of GU_REF_STANDARD) {
    const ratio = guRefRatio(label);
    const diff = Math.abs(ratio.w / ratio.h - actual) / actual;
    if (!best || diff < best.diff) best = { ratio, diff };
  }
  if (best && best.diff <= 0.06) return best.ratio;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(Math.round(width), Math.round(height)) || 1;
  return guRefRatio(`${Math.round(width / g)}:${Math.round(height / g)}`);
}

function guRefBox(ratio) {
  const scale = Math.min(GU_REF_MAX_W / ratio.w, GU_REF_MAX_H / ratio.h);
  return { width: Math.round(ratio.w * scale), height: Math.round(ratio.h * scale) };
}

// 一个图位就是一张图：没图显示提示词，有图只显示图；右上角三个按钮一直在
function guRefActionsHtml(prompt, hit) {
  const text = String(prompt || '');
  const url = hit && hit.url ? hit.url : '';
  const loading = Boolean(hit && hit.loading);
  const error = hit && hit.error ? String(hit.error) : '';
  const spinTitle = error ? `出图失败：${error}（点一下重试）` : url ? '重新生成这张图' : '生成这张图';
  return `<div class="gu-ref-actions" style="${GU_REF_ACTIONS}">
    <button type="button" class="gu-ref-btn${error ? ' is-bad' : ''}" style="${GU_REF_BTN}" data-act="ask-ref-now" data-gu-prompt="${esc(text)}" title="${esc(spinTitle)}" aria-label="生成图片">${loading ? '<span class="gu-ref-spin"></span>' : '↻'}</button>
    <button type="button" class="gu-ref-btn" style="${GU_REF_BTN}${url ? '' : 'opacity:.4;'}" data-act="gu-ref-download" data-url="${esc(url)}" title="${url ? '下载图片' : '还没有图片'}" aria-label="下载图片"${url ? '' : ' disabled'}>⤓</button>
    <button type="button" class="gu-ref-btn" style="${GU_REF_BTN}" data-act="gu-copy-text" data-gu-text="${esc(text)}" title="复制提示词" aria-label="复制提示词">⧉</button>
  </div>`;
}

function guRefMediaHtml(prompt, hit, ratio) {
  const text = String(prompt || '');
  const url = hit && hit.url ? hit.url : '';
  const loading = Boolean(hit && hit.loading);
  const error = hit && hit.error ? String(hit.error) : '';
  const cls = url ? ' is-ready' : loading ? ' is-loading' : error ? ' is-failed' : ' is-empty';
  const box = guRefBox(ratio);
  const fill = url
    ? `<button type="button" class="gu-ref-zoom" style="position:absolute;inset:0;padding:0;border:0;background:transparent;cursor:zoom-in" data-act="ask-open-inline" data-url="${esc(url)}" data-label="${esc(text.slice(0, 40))}"><img src="${esc(url)}" alt="${esc(text)}" loading="lazy" style="${GU_REF_IMG}" /></button><span class="gu-ref-badge">自动生成</span>`
    : `<span class="gu-ref-prompt" style="${GU_REF_FILL}">${esc(text || '—')}</span>`;
  return `<div class="gu-ref-media${cls}" style="${GU_REF_BOX}height:${box.height}px;max-height:${box.height}px;">${fill}${guRefActionsHtml(text, hit)}</div>`;
}

function guRefCardHtml(prompt, ratioHint) {
  const text = String(prompt || '').trim();
  const key = guRefKey(text);
  const ratio = guRefRatio(ratioHint || GU_REF_RATIOS.get(key) || '4:3');
  GU_REF_RATIOS.set(key, ratio.label);
  const hit = ASK_REF_CACHE.get(key);
  const busy = ASK_REF_INFLIGHT.has(key) || askRefRunning.has(key);
  const state = hit ? (hit.error ? 'error' : 'ready') : (busy ? 'loading' : (guRefsEnabled() ? 'pending' : 'off'));
  const box = guRefBox(ratio);
  return `<figure class="gu-ref" style="margin:0;min-width:0;align-self:start;width:${box.width}px;max-width:100%;border:1px solid var(--ask-line, rgba(0,0,0,.12));border-radius:12px;overflow:hidden;" data-gu-ref data-gu-key="${key}" data-gu-prompt="${esc(text)}" data-gu-ratio="${esc(ratio.label)}" data-gu-state="${state}">${guRefMediaHtml(text, hit || (busy ? { loading: true } : null), ratio)}</figure>`;
}

function guPaintRef(node, hit) {
  if (!node || !node.isConnected) return;
  node.dataset.guState = hit && hit.error ? 'error' : hit && hit.loading ? 'loading' : 'ready';
  node.classList.toggle('is-error', Boolean(hit && hit.error));
  const media = node.querySelector('.gu-ref-media');
  if (media) media.outerHTML = guRefMediaHtml(node.dataset.guPrompt || '', hit, guRefRatio(node.dataset.guRatio));
  guBindRefImg(node);
}

// 图片加载出来后按图片真实比例把图位调成一样的形状（横的横、竖的竖，不留空也不裁）
function guRefFitBox(node, width, height) {
  if (!node || !node.isConnected) return;
  const ratio = guRefSnapRatio(width, height);
  if (!ratio) return;
  node.dataset.guRatio = ratio.label;
  const key = node.dataset.guKey;
  if (key) { GU_REF_RATIOS.set(key, ratio.label); guRefStoreSchedule(); }
  const box = guRefBox(ratio);
  node.style.width = box.width + 'px';
  const media = node.querySelector('.gu-ref-media');
  if (media) {
    media.style.height = box.height + 'px';
    media.style.maxHeight = box.height + 'px';
  }
}

// 图片加载不出来时不要留一个空白大块，退回「加载失败 + 重试」
function guBindRefImg(scope) {
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  scope.querySelectorAll('.gu-ref-media.is-ready img').forEach((img) => {
    if (img.dataset.guBound) return;
    img.dataset.guBound = '1';
    const node = img.closest('[data-gu-ref]');
    img.addEventListener('error', () => {
      if (node) guPaintRef(node, { error: '图片加载失败' });
    });
    const fit = () => guRefFitBox(node, img.naturalWidth, img.naturalHeight);
    if (img.complete && img.naturalWidth) fit();
    else img.addEventListener('load', fit);
  });
}

function guHydrateRefs(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  if (!guRefsEnabled()) { guRefStop(); return; }
  guBindRefImg(root);
  root.querySelectorAll('[data-gu-ref][data-gu-state="pending"]').forEach((node) => {
    const key = node.dataset.guKey;
    const prompt = node.dataset.guPrompt || '';
    if (!key || !prompt) return;
    const hit = ASK_REF_CACHE.get(key);
    if (hit) { guPaintRef(node, hit); return; }
    if (ASK_REF_INFLIGHT.has(key)) return;
    ASK_REF_INFLIGHT.add(key);
    ASK_REF_PROMPTS.set(key, prompt);
    ASK_REF_QUEUE.push(key);
  });
  guRefPump();
}

// 关掉开关时把还没排队的清空；已经在请求里的让它自然结束，不会再多花一张
function guRefStop() {
  ASK_REF_QUEUE.length = 0;
  for (const key of ASK_REF_INFLIGHT) {
    if (!askRefRunning.has(key)) {
      ASK_REF_INFLIGHT.delete(key);
      ASK_REF_PROMPTS.delete(key);
      ASK_REF_MANUAL.delete(key);
    }
  }
}

// 单张手动出图：只生成这一条，不连带别的卡片，也不改全局开关
function guGenerateRef(prompt, options = {}) {
  const text = String(prompt || '').trim();
  if (!text) return;
  const key = guRefKey(text);
  const hit = ASK_REF_CACHE.get(key);
  if (hit && hit.url && !options.force) return;
  ASK_REF_CACHE.delete(key);
  ASK_REF_MANUAL.add(key);
  guPaintEveryRef(key, { loading: true });
  if (!ASK_REF_INFLIGHT.has(key)) {
    ASK_REF_INFLIGHT.add(key);
    ASK_REF_PROMPTS.set(key, text);
    ASK_REF_QUEUE.push(key);
  }
  guRefPump();
}

function guPaintEveryRef(key, hit) {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  document.querySelectorAll(`[data-gu-ref][data-gu-key="${key}"]`).forEach((node) => guPaintRef(node, hit));
}

function guRefPump() {
  while (ASK_REF_QUEUE.length) {
    const key = ASK_REF_QUEUE.shift();
    const prompt = ASK_REF_PROMPTS.get(key) || '';
    if (!prompt) { ASK_REF_INFLIGHT.delete(key); continue; }
    // 全局开关关着时，只放行用户手动点的那几张
    if (!guRefsEnabled() && !ASK_REF_MANUAL.has(key)) {
      ASK_REF_INFLIGHT.delete(key);
      ASK_REF_PROMPTS.delete(key);
      continue;
    }
    if (guRefRunning() >= ASK_REF_LIMIT) { ASK_REF_QUEUE.unshift(key); break; }
    guRefStart(key, prompt);
  }
}

const askRefRunning = new Set();

function guRefRunning() {
  return askRefRunning.size;
}

function guRefStart(key, prompt) {
  askRefRunning.add(key);
  api('/api/chat/ref-image', { method: 'POST', body: { prompt, ratio: GU_REF_RATIOS.get(key) || '' } })
    .then((result) => {
      ASK_REF_CACHE.set(key, { url: result.url, path: result.path });
      guRefStoreSchedule();
    })
    .catch((err) => {
      ASK_REF_CACHE.set(key, { error: err.message || '出图失败' });
    })
    .finally(() => {
      askRefRunning.delete(key);
      ASK_REF_INFLIGHT.delete(key);
      ASK_REF_PROMPTS.delete(key);
      ASK_REF_MANUAL.delete(key);
      const hit = ASK_REF_CACHE.get(key) || { error: '出图失败' };
      guPaintEveryRef(key, hit);
      guRefPump();
    });
}

// 单张重试＝只重跑这一张
function guRetryRef(prompt) {
  guGenerateRef(prompt);
}

function askMessagesHtml(chat) {
  const a = askState();
  const messages = (chat && chat.messages) || [];
  return messages.map((m, index) => askMessageHtml(m, index, messages, a)).join('');
}

// 计速：一轮的耗时与速率现在是 receipt.turn.stats（turn = 一次用户提交，step = 一次模型调用）。
// turn 是规范位置；旧回执没有 turn 时回退到 receipt.timing，两处字段同构。
// 缺字段就少显示一项，不编造数字。
function askSecs(ms) {
  const v = Number(ms) || 0;
  return v >= 10000 ? (v / 1000).toFixed(0) + 's' : (v / 1000).toFixed(1) + 's';
}

function askTurnStats(ex) {
  if (!ex) return null;
  const turn = ex.turn || null;
  if (turn && turn.stats && typeof turn.stats === 'object') return turn.stats;
  return ex.timing || null;
}

function askSessionStats(chat) {
  const list = (chat && chat.messages) || [];
  const s = { turns: 0, steps: 0, llm: 0, tool: 0, dec: 0, decTokens: 0, input: 0, output: 0, ttftSum: 0, ttftN: 0 };
  for (const m of list) {
    if (m.role !== 'assistant') continue;
    const ex = m.execution || null;
    if (!ex) continue;
    const t = askTurnStats(ex);
    const u = ex.usage || null;
    s.turns += 1;
    if (t) {
      s.steps += Number(t.model_calls) || 0;
      s.llm += Number(t.llm_ms) || 0;
      s.tool += Number(t.tool_ms) || 0;
      s.dec += Number(t.decode_ms) || 0;
      s.decTokens += Number(t.decode_tokens) || 0;
      if (t.ttft_ms) { s.ttftSum += Number(t.ttft_ms); s.ttftN += 1; }
    }
    if (u) { s.input += Number(u.input_tokens) || 0; s.output += Number(u.output_tokens) || 0; }
  }
  s.ttftAvg = s.ttftN ? s.ttftSum / s.ttftN : 0;
  s.tps = s.dec > 0 && s.decTokens ? Number((s.decTokens / (s.dec / 1000)).toFixed(1)) : 0;
  return s;
}

// 输入框下方的统计条。只放用户能感知的东西：快不快（速率）、多久出字（首字）、
// 时间花在模型还是工具上（两个墙钟）。
// 「轮次」「步骤」不在这里：用户自己数得出会话里发了几条，模型内部调了几次也不关他事，
// 这两个数字是拿内部模型填界面，信息量为零。要看的细节在每轮展开面板里。
function askStatDockHtml() {
  const s = askSessionStats(askActive());
  if (!s.turns) return '';
  const activity = [s.tps ? s.tps + ' tok/s' : '',
    s.ttftAvg ? '首字 ' + askSecs(s.ttftAvg) : '',
    s.llm ? '模型 ' + askSecs(s.llm) : '',
    s.tool ? '工具 ' + askSecs(s.tool) : ''].filter(Boolean);
  // 输入与输出分列即可，合计是两者相加，不必占位置。
  const usage = ['输入 ' + askFmtTokens(s.input), '输出 ' + askFmtTokens(s.output)];
  return `<div class="ask-stat-dock">
    <span class="ask-stat" data-composer-stat="activity" title="本会话 ${s.turns} 轮合计：模型墙钟与工具墙钟分开计">${esc(activity.join(' · '))}</span>
    <span class="ask-stat" data-composer-stat="usage">${esc(usage.join(' · '))}</span>
  </div>`;
}

// 每轮用量：stats 与 usage 必须都在，缺一个就整块不显示——不拿部分总量冒充完整。
function askTurnUsageHtml(m) {
  const ex = (m && m.execution) || null;
  const t = askTurnStats(ex);
  const u = ex && ex.usage;
  if (!t || !u || u.output_tokens == null) return '';
  const head = [];
  if (t.tps) head.push(t.tps + ' tok/s');
  if (t.ttft_ms) head.push('首字 ' + askSecs(t.ttft_ms));
  head.push('输出 ' + u.output_tokens + ' tokens');
  const rows = [['模型耗时', t.llm_ms != null ? askSecs(t.llm_ms) : '—'],
    ['工具耗时', t.tool_ms != null ? askSecs(t.tool_ms) : '—'],
    ['解码', t.decode_ms != null ? askSecs(t.decode_ms) : '—'],
    ['模型调用', (t.model_calls || 0) + ' 次'],
    ['工具调用', (t.tool_calls || 0) + ' 次'],
    ['输入 tokens', u.input_tokens ?? '—'],
    ['输出 tokens', u.output_tokens ?? '—']];
  return `<details class="ask-turn-usage">
    <summary>${esc(head.join(' · '))}</summary>
    <div class="ask-turn-usage-body">${rows.map(([k, v]) => `<span><i>${esc(k)}</i><b>${esc(String(v))}</b></span>`).join('')}</div>
  </details>`;
}

function askSpeedHtml(m) {
  const usage = (m && m.execution && m.execution.usage) || null;
  const t = askTurnStats(m && m.execution);
  const parts = [];
  if (usage) parts.push('输入 ' + (usage.input_tokens ?? '?') + ' / 输出 ' + (usage.output_tokens ?? '?'));
  if (t && t.tps) parts.push(t.tps + ' tok/s');
  if (t && t.ttft_ms) parts.push('首字 ' + (t.ttft_ms / 1000).toFixed(1) + 's');
  if (!parts.length) return '';
  const tip = t ? ['模型 ' + ((t.llm_ms || 0) / 1000).toFixed(2) + 's',
    '工具 ' + ((t.tool_ms || 0) / 1000).toFixed(2) + 's',
    '解码 ' + ((t.decode_ms || 0) / 1000).toFixed(2) + 's',
    '模型调用 ' + (t.model_calls || 0) + ' 次 · 工具 ' + (t.tool_calls || 0) + ' 次'].join(' · ') : '';
  return `<span class="ask-usage" title="${esc(tip)}">${esc(parts.join(' · '))}</span>`;
}

// 压缩卡片：时间线上看得见「哪一次压了多少条」，正文可展开。
// 压掉的原文仍在运行轨迹里，这里只放摘要，不给用户造成「历史被我删了」的错觉。
function askCompactionCardHtml(m, index) {
  const c = m.compaction || {};
  const n = Number(c.shadowed) || 0;
  const chars = Number(c.summary_chars) || 0;
  const tokens = chars ? Math.max(1, Math.round(chars / 1.6)) : 0;
  const stamp = m.time ? askTimeText(m.time) : '';
  return `<article class="ask-message is-compacted" data-msg-index="${index}" data-msg-id="${esc(m.id || '')}">
    <details class="ask-cps">
      <summary>
        <span class="ask-cps-ico" aria-hidden="true">▤</span>
        <b>上下文已压缩</b>
        <small>已压缩 ${n} 条历史记录${tokens ? '（约 ' + askFmtTokens(tokens) + ' tokens）' : ''}</small>
        <span class="ask-cps-time">${esc(stamp)}</span>
      </summary>
      <div class="ask-cps-body">
        <div class="ask-cps-label">压缩摘要</div>
        <pre>${esc(String(m.text || '') || '压缩摘要不可用')}</pre>
      </div>
    </details>
  </article>`;
}

// 流式回复按“已显示字数”渲染，字迹匀速推进，不会每来一块就整段跳一下
function askShownText(m, index, messages, a) {
  const text = String((m && m.text) || '');
  const last = index === messages.length - 1;
  if (!last || !m._streaming || m._reveal == null) return text;
  const shown = Math.max(0, Math.min(text.length, m._reveal));
  return shown >= text.length ? text : text.slice(0, shown);
}

// 智能推荐：对话里只留一行记录（真正的选择在输入框上方的问句条里）
function askChoiceQuestions(card) {
  if (!card) return [];
  if (Array.isArray(card.questions) && card.questions.length) return card.questions;
  if (card.question) {
    return [{ id: 'q1', question: card.question, options: card.options || [], multi: !!card.multi, allow_text: card.allow_text !== false }];
  }
  return [];
}

function askChoiceNoteHtml(m) {
  const cards = (m && m.choices) || [];
  if (m.role === 'user' || !cards.length) return '';
  return cards.map((card) => {
    const questions = askChoiceQuestions(card);
    const answered = (m.choiceAnswers || {})[card.id] || null;
    const typed = (m.choiceTyped || {})[card.id] || '';
    const skipped = m.choiceSkipped === card.id;
    let verdict = '等待选择';
    if (answered) verdict = '已选择 ' + answered.length + ' 项';
    else if (typed) verdict = '已回复：' + (typed.length > 28 ? typed.slice(0, 28) + '…' : typed);
    else if (skipped) verdict = '已跳过';
    const head = questions.length > 1 ? questions[0].question + '（等 ' + questions.length + ' 个问题）' : (questions[0] || {}).question || '';
    return `<div class="ask-choice-note${answered || typed ? ' is-done' : ''}${skipped ? ' is-skipped' : ''}" data-choice="${esc(card.id)}">
      <span class="ask-choice-note-badge">✦ 智能推荐</span>
      <span class="ask-choice-note-q">${esc(head)}</span>
      <span class="ask-choice-note-v">${esc(verdict)}</span>
    </div>`;
  }).join('');
}

// 直发补充说明：已并入当前任务的那几条要求，挂在这条回复里可回溯
function askSupplementNoteHtml(m) {
  const list = (m && m.supplements) || [];
  if (!list.length) return '';
  const applied = list.filter((x) => x.state !== 'received').length;
  return `<div class="ask-sup-note">
    <span class="ask-sup-badge">⚡ 补充说明</span>
    <span class="ask-sup-count">${applied ? '已并入 ' + applied + ' 条' : '已收到，等检查点'}</span>
    <span class="ask-sup-list">${list.map((x) => `<span class="ask-sup-chip${x.state === 'received' ? ' is-wait' : ''}" title="${esc(x.text)}">${esc(String(x.text || '').slice(0, 30))}${String(x.text || '').length > 30 ? '…' : ''}</span>`).join('')}</span>
  </div>`;
}

// 输入框上方的问句条：1–4 个问题（单选 / 多选）+ 自行撰写 + 跳过 / 发送
function askChoicePanelHtml() {
  const a = askState();
  const p = a.choice;
  if (!p || p.closed) return '';
  const card = p.card;
  const questions = askChoiceQuestions(card);
  const answers = p.answers || {};
  const custom = p.custom || {};
  const total = questions.length || 1;
  const page = Math.max(0, Math.min(total - 1, Number(p.page) || 0));
  const q = questions[page] || { id: 'q1', question: '', options: [], multi: false };
  const picked = answers[q.id] || [];
  const text = p.text || '';
  const answered = picked.length > 0 || !!text.trim() || !!custom[q.id];
  const last = page >= total - 1;
  const action = last ? '发送' : '下一步';
  const canNext = answered || (page > 0 && custom[q.id]);
  return `<div class="ask-qpanel" id="ask-qpanel" role="group" aria-label="待回答的问题">
    <div class="ask-qpanel-head">
      <span class="ask-qpanel-icon" aria-hidden="true">?</span>
      <span class="ask-qpanel-title">问题</span>
      <span class="grow"></span>
      ${total > 1 ? `<span class="ask-qpanel-pager">
        <button type="button" class="ask-qpanel-arrow" data-act="ask-choice-page" data-delta="-1" ${page === 0 ? 'disabled' : ''} title="上一个问题">‹</button>
        <span class="ask-qpanel-of">${page + 1} of ${total}</span>
        <button type="button" class="ask-qpanel-arrow" data-act="ask-choice-page" data-delta="1" ${last ? 'disabled' : ''} title="下一个问题">›</button>
      </span>` : ''}
      <button type="button" class="ask-qpanel-close" data-act="ask-choice-skip" title="关闭问题面板（这组问题先不问）">✕</button>
    </div>
    <div class="ask-qpanel-block">
      <div class="ask-qpanel-question">${esc(q.question)}${q.multi ? '<span class="ask-qpanel-multi">可多选</span>' : ''}</div>
      <div class="ask-qpanel-options" role="${q.multi ? 'group' : 'radiogroup'}">
        ${(q.options || []).map((o, i) => `<button type="button" class="ask-qpanel-opt${picked.includes(o.id) ? ' is-on' : ''}${q.multi ? ' is-multi' : ''}" role="${q.multi ? 'checkbox' : 'radio'}" aria-checked="${picked.includes(o.id)}" data-act="ask-choice-pick" data-question="${esc(q.id)}" data-option="${esc(o.id)}" title="${esc(o.value || o.label)}">
          <span class="ask-qpanel-key">${q.multi ? (picked.includes(o.id) ? '✓' : '') : i + 1}</span>
          <span class="ask-qpanel-label">${esc(o.label)}</span>
          ${o.why ? `<span class="ask-qpanel-why">${esc(o.why)}</span>` : ''}
          ${o.recommended ? '<span class="ask-qpanel-rec">推荐</span>' : ''}
          <span class="ask-qpanel-go" aria-hidden="true">→</span>
        </button>`).join('')}
      </div>
    </div>
    ${total > 1 ? `<div class="ask-qpanel-dots">${questions.map((item, i) => {
      const done = ((answers[item.id] || []).length > 0) || !!custom[item.id];
      return `<span class="ask-qpanel-dot${i === page ? ' is-on' : ''}${done ? ' is-done' : ''}" title="${esc(item.question)}"></span>`;
    }).join('')}</div>` : ''}
    <div class="ask-qpanel-foot">
      <span class="ask-qpanel-pen" aria-hidden="true">✎</span>
      <input id="ask-choice-input" class="ask-qpanel-input" autocomplete="off" placeholder="或自行撰写回复" value="${esc(text)}" />
      <button type="button" class="ask-qpanel-skip" data-act="ask-choice-skip">跳过</button>
      <button type="button" class="ask-qpanel-send" data-act="${last ? 'ask-choice-send' : 'ask-choice-page'}" data-delta="1" ${(last ? canNext : answered) ? '' : 'disabled'} title="${last ? '提交这组问题的答案' : '回答后进入下一个问题'}">${action}</button>
    </div>
  </div>`;
}

// 兜底：模型在正文里问了却没有出卡时，也给两个可点的默认动作，别让用户自己猜着写
function askQuickHtml(m, index) {
  if (!m || m.role === 'user' || m._streaming || m.error) return '';
  if ((m.choices || []).length) return '';
  const text = String(m.text || '').trim();
  if (!text) return '';
  const tail = text.slice(-140);
  const asking = /[?？]\s*$/.test(text.slice(-40)) || /继续|要不要|是否需要|请回复|告诉我|确认一下|下一步/.test(tail);
  if (!asking) return '';
  return `<div class="ask-quick">
    <button type="button" data-act="ask-quick" data-index="${index}" data-value="继续，按你的推荐执行" title="把决定权交给智能体，按它推荐的方案往下做">按推荐继续</button>
    <button type="button" data-act="ask-quick" data-index="${index}" data-value="" title="收起快捷项，自己输入">其他：我自己说</button>
  </div>`;
}

/* ------------------------- 问句条：选择 / 发送 / 跳过 ------------------------- */
function askChoiceBindInput() {
  const a = askState();
  const input = $('#ask-choice-input');
  if (!input) return;
  input.oninput = () => {
    if (!a.choice) return;
    a.choice.text = input.value;
    const q = askChoiceQuestions(a.choice.card)[Number(a.choice.page) || 0];
    const picked = ((a.choice.answers || {})[q && q.id] || []).length;
    const action = $('#ask-qpanel .ask-qpanel-send');
    if (action) action.disabled = !(input.value.trim() || picked);
  };
  input.onkeydown = (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      const a2 = askState();
      const total = askChoiceQuestions(a2.choice && a2.choice.card).length || 1;
      if ((Number(a2.choice && a2.choice.page) || 0) < total - 1) askChoicePage(1);
      else askChoiceSend();
    }
    if (event.key === 'ArrowRight' && !input.value) { event.preventDefault(); askChoicePage(1); }
    if (event.key === 'ArrowLeft' && !input.value) { event.preventDefault(); askChoicePage(-1); }
    if (event.key === 'Escape') { event.preventDefault(); askChoiceSkip(); }
  };
}

// 只换问句条这一块，保留输入焦点与已输入的文字
function askChoiceRefresh() {
  const a = askState();
  const host = $('#ask-qpanel');
  const html = askChoicePanelHtml();
  if (!host) { askRenderAll(); return; }
  if (!html) { host.remove(); return; }
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  host.replaceWith(wrap.firstElementChild);
  const input = $('#ask-choice-input');
  if (input && a.choice) {
    input.value = a.choice.text || '';
    if (a.choice.focusInput) { input.focus(); a.choice.focusInput = false; }
  }
  askChoiceBindInput();
}

function askChoiceMessage() {
  const a = askState();
  const chat = askActive();
  const id = a.choice && a.choice.messageId;
  return (chat && (chat.messages || []).find((m) => m.id === id)) || null;
}

function askChoicePick(questionId, optionId) {
  const a = askState();
  if (!a.choice) return;
  const questions = askChoiceQuestions(a.choice.card);
  const q = questions.find((x) => x.id === questionId) || questions[a.choice.page || 0] || questions[0];
  if (!q) return;
  a.choice.answers = a.choice.answers || {};
  const current = a.choice.answers[q.id] || [];
  if (q.multi) {
    a.choice.answers[q.id] = current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId];
  } else {
    a.choice.answers[q.id] = [optionId];
  }
  a.choice.text = '';
  if (a.choice.custom) delete a.choice.custom[q.id];
  const input = $('#ask-choice-input');
  if (input) input.value = '';
  askChoiceRefresh();
}

// 翻页：同一组问题一页一题，-1 上一题 / +1 下一题（到最后一题时由发送按钮接棒）
function askChoicePage(delta) {
  const a = askState();
  const p = a.choice;
  if (!p || p.closed) return;
  const questions = askChoiceQuestions(p.card);
  const total = questions.length || 1;
  const from = Math.max(0, Math.min(total - 1, Number(p.page) || 0));
  const q = questions[from];
  // 翻页前把当前页手写的回答记住，切回来还在
  const text = String(p.text || '').trim();
  if (q && text && !((p.answers || {})[q.id] || []).length) {
    p.custom = p.custom || {};
    p.custom[q.id] = text;
  }
  p.text = '';
  const to = Math.max(0, Math.min(total - 1, from + Number(delta || 0)));
  p.page = to;
  const next = questions[to];
  if (next && p.custom && p.custom[next.id]) p.text = p.custom[next.id];
  askChoiceRefresh();
  const input = $('#ask-choice-input');
  if (input) { input.value = p.text || ''; input.focus(); }
}

function askChoiceSummary() {
  const p = askState().choice;
  if (!p) return { text: '', values: [], skills: [] };
  const questions = askChoiceQuestions(p.card);
  const answers = p.answers || {};
  const custom = p.custom || {};
  const lines = [];
  const values = [];
  const skills = [];
  for (const q of questions) {
    const picked = (answers[q.id] || []).map((id) => (q.options || []).find((o) => o.id === id)).filter(Boolean);
    const typed = String(custom[q.id] || '').trim();
    if (!picked.length && !typed) continue;
    const label = picked.length ? picked.map((o) => o.label).join('、') : '（自定）' + typed;
    lines.push('- ' + q.question + ' → ' + label);
    for (const o of picked) {
      values.push(o.value || o.label);
      if (o.skill_id) skills.push(o.skill_id);
    }
    if (typed && !picked.length) values.push(typed);
  }
  return { text: lines.join('\n'), values, skills };
}

function askChoiceSend() {
  const a = askState();
  const p = a.choice;
  if (!p || p.closed) return;
  const card = p.card;
  const currentQ = askChoiceQuestions(card)[Number(p.page) || 0];
  const currentText = String(p.text || '').trim();
  if (currentQ && currentText) {
    p.custom = p.custom || {};
    p.custom[currentQ.id] = currentText;
    if (!((p.answers || {})[currentQ.id] || []).length) p.text = '';
  }
  const summary = askChoiceSummary();
  if (!summary.values.length) return toast('先选一个选项，或写一句你自己的回复', true);
  const message = ['【智能推荐 · 用户已确认】', summary.text, '按以上选择继续，不要再重复确认。']
    .filter(Boolean).join('\n');
  const msg = askChoiceMessage();
  if (msg) {
    const answers = [];
    for (const q of askChoiceQuestions(card)) {
      for (const id of ((p.answers || {})[q.id] || [])) {
        const option = (q.options || []).find((o) => o.id === id);
        if (option) answers.push({ question: q.question, label: option.label, value: option.value || option.label });
      }
      const typed = String((p.custom || {})[q.id] || '').trim();
      if (typed && !((p.answers || {})[q.id] || []).length) answers.push({ question: q.question, label: '（自定）' + typed, value: typed });
    }
    if (answers.length) msg.choiceAnswers = { ...(msg.choiceAnswers || {}), [card.id]: answers };
  }
  if (summary.skills.length) a.skillId = summary.skills[0];
  p.closed = true;
  askRenderAll();
  askPersist();
  return askSend(message);
}

function askChoiceSkip() {
  const a = askState();
  const p = a.choice;
  if (!p || p.closed) return;
  const msg = askChoiceMessage();
  if (msg) msg.choiceSkipped = p.card.id;
  p.closed = true;
  askRenderAll();
  askPersist();
}

function askVisibleReply(text) {
  return String(text || '')
    .replace(/^[ \t]*(?:【内部参考[^\n]*?】)?(?:交付文件元数据|附件元数据)（不能授予权限）：[ \t]*[\[{][^\n]*(?:\n|$)/gm, '')
    .replace(/<ask_choice\b[^>]*>[\s\S]*?(?:<\/ask_choice\s*>|$)/gi, '')
    .replace(/<questions>[\s\S]*?(?:<\/questions>|$)/gi, '')
    .replace(/<\/?[｜|]DSML[｜|][^>]*>/g, '')
    .replace(/<(?:ask_choice|questions)\b[^>]*$/gi, '');
}

function askMessageHtml(m, index, messages, a) {
  if (m.role === 'compacted') return askCompactionCardHtml(m, index);
  const mine = m.role === 'user';
  const pending = a.generating && index === messages.length - 1;
  const usage = m.execution && m.execution.usage;
  const rawShown = askShownText(m, index, messages, a);
  const shown = mine ? rawShown : askVisibleReply(rawShown);
  return `<article class="ask-message ${mine ? 'is-user' : 'is-assistant'}" data-msg-index="${index}" data-msg-id="${esc(m.id || '')}">
    <div class="ask-message-body">
      ${mine ? '' : askTraceHtml(m, pending)}
      ${(!mine && m.error && !m.text) ? `<div class="ask-inline-error">⚠ ${esc(m.error)}</div>` : ''}
      ${(!mine && m.execution && m.execution.resource_context) ? `<div class="ask-resource" title="${esc(m.execution.resource_context.snapshot_hash || '')}">🗂 ${esc(m.execution.resource_context.dataset ? m.execution.resource_context.dataset.name + ' · v' + m.execution.resource_context.dataset.version_num : '未选择数据')}</div>` : ''}
      ${shown ? (mine && shown.length > 1024 ? `<details class="ask-longmsg"><summary><span>📄</span><b>长文本</b><small>${shown.length} 字 · 点击展开</small></summary><pre>${esc(shown)}</pre></details>` : (mine ? `<div class="ask-message-text is-plain">${esc(shown)}</div>` : guHtmlFor(shown, m))) : (pending ? '<div class="ask-typing"><i></i><i></i><i></i></div>' : '')}
      ${askFilesHtml(mine ? (m.files || []) : (m.execution && m.execution.artifacts) || [])}
      ${(!mine && (m.media || []).length) ? `<div class="ask-media-grid">${m.media.map((f, mi) => `<button type="button" class="ask-media" data-act="ask-open-media" data-index="${index}" data-media="${mi}" title="${esc(f.name || '')}">
        ${f.kind === 'video' ? `<video src="${esc(f.url)}" muted preload="metadata"></video><span class="ask-media-play">▶</span>` : `<img src="${esc(f.url)}" alt="" loading="lazy" />`}
        <span class="ask-media-name">${esc(f.name || '')}</span>
      </button>`).join('')}</div>` : ''}
      ${mine ? '' : askChoiceNoteHtml(m)}
      ${mine ? '' : askSupplementNoteHtml(m)}
      ${mine ? '' : askTurnUsageHtml(m)}
      ${mine ? '' : askQuickHtml(m, index)}
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
        ${askSpeedHtml(m)}
        <span class="ask-time">${esc(askTimeText(m.time))}</span>
      </div>` : (mine ? `<div class="ask-reply-actions is-user-row">
        <button type="button" class="ask-turn-delete" data-act="ask-delete-turn" data-index="${index}" title="删除这一轮：问题连同它的回复一起删除">🗑 删除这一轮</button>
        <span class="ask-time">${esc(askTimeText(m.time))}</span>
      </div>` : '')}
    </div>
  </article>`;
}

function askWelcomeHtml() {
  return `<div class="ask-welcome">
    <span class="ask-eyebrow">WENYUN.M-DESKTOP</span>
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
  host.innerHTML = (cmdOpen ? askCommandPopup() : '') + (a.mention ? askMentionPopup() : '') + (a.permMenu ? askPermissionPopup() : '');
  host.style.display = host.innerHTML.trim() ? 'block' : 'none';
}

function askPermissionPopup() {
  const a = askState();
  const current = askPermission(a.permission);
  return `<div class="ask-popup ask-perm-pop"><div class="ask-popup-title">本地权限 · ${esc(current.label)}</div>
    ${ASK_PERMISSIONS.map((p) => `<button type="button" class="${p.id === current.id ? 'is-hl' : ''}" data-act="ask-perm" data-id="${p.id}"><b>${p.icon} ${esc(p.label)}</b><span>${esc(p.desc)}</span></button>`).join('')}
    <p class="ask-perm-note">高危命令（格式化 / 分区 / 关机 / 删系统目录 / 编码载荷 / 账户后门）在任何档位都由系统强制阻断，模型改写法也绕不过去。</p></div>`;
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
    <div id="ask-plan-dock">${askPlanDockHtml(askActive())}</div>
    ${askChoicePanelHtml()}
    <div class="ask-composer-context">
      <button type="button" class="ask-project-trigger" data-act="ask-project-picker" aria-label="选择项目"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/></svg><span class="ask-project-name">${esc(state.project?.name || '选择项目')}</span><svg class="ask-project-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><span>▰ 此计算机</span>
      ${state.styleDetail ? `<span>🎨 ${esc(state.styleDetail.name)}</span>` : ''}
      <span class="ask-skill-context">✧ ${esc(skill.name)}${a.skillId ? ' <button type="button" data-act="ask-clear-skill" title="移除技能，返回普通聊天">×</button>' : ''}</span>
      ${(a.attachments || []).map((f) => `<span class="ask-attach" data-act="ask-preview" data-id="${esc(f.id)}" title="点击预览">📎 ${esc(f.name)}<small>${askAttachStatusText(f)}</small><button type="button" data-act="ask-detach" data-id="${esc(f.id)}">×</button></span>`).join('')}
    </div>
    <div class="ask-composer">
      ${askQueueHtml()}
      <div class="ask-popups" id="ask-popups"></div>
      <textarea id="ask-input" class="ask-input" rows="2" maxlength="3000" placeholder="${a.generating ? '当前回复生成中：Enter 加入队列，队首 ↑ 可补充给当前任务' : '聊聊你的想法，或输入 @ 选择技能'}">${esc(a.draft)}</textarea>
      <div class="ask-composer-bar">
        <button type="button" class="ask-icon-btn" data-act="ask-attach" title="添加附件（最多 5 个，单文件 10MB）">📎</button>
        <button type="button" class="ask-perm is-${esc(askPermission(a.permission).id)}" data-act="ask-permission" title="本地权限：${esc(askPermission(a.permission).label)}（点击切换）">${askPermission(a.permission).icon} ${esc(askPermission(a.permission).label)}</button>
        <button type="button" class="ask-ref-toggle ${a.refImages ? 'is-on' : ''}" data-act="ask-toggle-refs" aria-pressed="${a.refImages}" title="参考出图开关">出图</button>
        <button type="button" class="ask-ref-toggle ${a.webSearch ? 'is-on' : ''}" data-act="ask-toggle-web" role="switch" aria-checked="${!!a.webSearch}" title="${a.webSearch ? '联网已开启，下次发送可搜索和读取网页' : '联网已关闭，下次发送不提供联网工具'}">🌐 联网</button>
        <select class="ask-select" id="ask-model" title="模型">
          ${models.map((m) => `<option value="${esc(m.id)}" ${m.id === a.modelId ? 'selected' : ''} title="上下文 ${m.context_tokens ? Math.round(m.context_tokens / 1000) + 'k' : '默认 500k'}">${esc(m.label)}${m.context_tokens ? ' · ' + Math.round(m.context_tokens / 1000) + 'k' : ''}</option>`).join('') || '<option value="">默认模型</option>'}
        </select>
        ${efforts.length ? `<select class="ask-select" id="ask-effort" title="思考强度">${efforts.map((e) => `<option value="${esc(e)}" ${e === a.effort ? 'selected' : ''}>思考 ${esc(ASK_EFFORT_LABELS[e] || e)}</option>`).join('')}</select>` : ''}
        <span class="ask-draft-count">${(a.draft || '').length}/3000</span>
        <span class="grow"></span>
        ${askContextMeterHtml()}
        ${a.generating
          ? `<button type="button" class="ask-send is-stop" data-act="ask-stop" aria-label="停止生成" title="停止生成">■</button>`
          : `<button type="button" class="ask-send" data-act="ask-send" ${a.draft.trim() ? '' : 'disabled'}>发送 ↑</button>`}
      </div>
    </div>
    ${askStatDockHtml()}
    ${a.toolsSupported === false ? '<div class="ask-hint"><span class="ask-perm-warn">⚠ 当前模型渠道不支持工具调用，文件与命令操作不会执行：把模型切到 deepseek-flash 或 gemini-3.8-flash</span></div>' : ''}
  </div>`;
}

function askEfforts() {
  const a = askState();
  const model = (a.models || []).find((m) => m.id === a.modelId);
  return (model && model.reasoning_efforts) || [];
}

/* ----------------------- 上下文占用（圈 + 已用/总量） ----------------------- */
const ASK_CTX_R = 6.6;
const ASK_CTX_C = 2 * Math.PI * ASK_CTX_R;

// 上下文占用：优先「下一轮预计」，其次「上一轮实际」。
// 压缩让历史变短，但上一轮的 input_tokens 反映的正是被压缩前的历史——拿它算环，
// 压缩完环纹丝不动，用户会以为压缩没生效。context.report.used 是压缩后重新估算的
// 发送量；压缩卡片还带 shadowed_chars，遇到就在时间线上立刻扣掉，不用等下一轮。
function askContextStats() {
  const a = askState();
  const chat = askActive();
  const model = (a.models || []).find((m) => m.id === a.modelId) || {};
  const total = Number(model.context_tokens) || 128000;
  const messages = (chat && chat.messages) || [];
  const estimate = (m) => Math.ceil(String((m && m.text) || '').length * 0.7);
  let used = 0;
  let exact = false;
  let found = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const ex = messages[i].execution || null;
    if (!ex) continue;
    const report = ex.context && ex.context.report;
    if (report && report.used) {
      used = Number(report.used) || 0;
      exact = false;
      found = true;
    } else if (ex.usage && ex.usage.input_tokens) {
      used = Number(ex.usage.input_tokens) + Number(ex.usage.output_tokens || 0);
      exact = true;
      found = true;
    } else {
      continue;
    }
    // 这一轮之后发生的事：追加的对话，以及压缩遮掉的历史
    for (let j = i + 1; j < messages.length; j += 1) {
      const m = messages[j];
      if (m.role === 'compacted') {
        const shadowed = Number((m.compaction && m.compaction.shadowed_chars) || 0);
        used -= Math.ceil(shadowed * 0.7);
        used += estimate(m); // 摘要本身会作为一条历史材料进入上下文
        continue;
      }
      used += estimate(m);
    }
    break;
  }
  used = Math.max(0, used);
  if (!found) {
    // 一条回执都没有才走全文估算。注意判据是 found 而不是 !used：
    // 压缩把占用扣到 0 是合法结果，不该被兜底逻辑覆盖成别的数。
    const chars = messages.reduce((n, m) => n + String(m.text || '').length, 0);
    used = Math.ceil(chars * 0.7);
  }
  used += Math.ceil(String(a.draft || '').length * 0.7);
  return { used, total, ratio: total ? Math.max(0, Math.min(1, used / total)) : 0, exact };
}

function askFmtTokens(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

function askCtxTone(ratio) {
  if (ratio >= 0.95) return 'is-danger';
  if (ratio >= 0.8) return 'is-warn';
  return '';
}

function askContextMeterHtml() {
  const s = askContextStats();
  const len = (ASK_CTX_C * s.ratio).toFixed(1);
  const title = `上下文占用：${askFmtTokens(s.used)} / ${askFmtTokens(s.total)}（${(s.ratio * 100).toFixed(1)}%）${s.exact ? '' : ' · 估算'}`;
  return `<span class="ask-ctx ${askCtxTone(s.ratio)}" title="${esc(title)}">
      <svg class="ask-ctx-ring" viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
        <circle class="ask-ctx-track" cx="9" cy="9" r="${ASK_CTX_R}" />
        <circle class="ask-ctx-fill" cx="9" cy="9" r="${ASK_CTX_R}" stroke-dasharray="${len} ${ASK_CTX_C.toFixed(1)}" transform="rotate(-90 9 9)" />
      </svg>
      <span class="ask-ctx-text">${askFmtTokens(s.used)}/${askFmtTokens(s.total)}</span>
    </span>`;
}

// 就地刷新圆圈，不重排整个输入区
function askUpdateContextMeter() {
  const host = document.querySelector('.ask-ctx');
  if (!host) return;
  const s = askContextStats();
  const fill = host.querySelector('.ask-ctx-fill');
  if (fill) fill.setAttribute('stroke-dasharray', (ASK_CTX_C * s.ratio).toFixed(1) + ' ' + ASK_CTX_C.toFixed(1));
  const text = host.querySelector('.ask-ctx-text');
  if (text) text.textContent = askFmtTokens(s.used) + '/' + askFmtTokens(s.total);
  host.classList.toggle('is-warn', s.ratio >= 0.8 && s.ratio < 0.95);
  host.classList.toggle('is-danger', s.ratio >= 0.95);
  host.title = `上下文占用：${askFmtTokens(s.used)} / ${askFmtTokens(s.total)}（${(s.ratio * 100).toFixed(1)}%）${s.exact ? '' : ' · 估算'}`;
}

/** 斜杠命令目录来自后端 /agent/commands：加命令只改后端一处，前端不再写死三个。 */
async function askLoadCommands() {
  const a = askState();
  try {
    const data = await askApi('/commands').then((r) => r.json());
    const list = Array.isArray(data) ? data : data.items || [];
    const mapped = list.filter((c) => c && c.name).map((c) => ({
      name: String(c.name),
      label: c.label || c.name,
      description: c.description || '',
      kind: c.kind === 'popup' ? 'popup' : 'action',
      arg: c.arg || c.name,
    }));
    if (mapped.length) a.commands = mapped;
  } catch {
    a.commands = a.commands || [];
  }
}

function askCommandList() {
  const a = askState();
  if (a.commands && a.commands.length) return a.commands;
  return [{ name: 'model', label: '换模型', description: '', kind: 'popup', arg: 'model' },
    { name: 'think', label: '换思考强度', description: '', kind: 'popup', arg: 'think' },
    { name: 'compact', label: '压缩当前对话上下文', description: '', kind: 'action', arg: 'compact' }];
}

function askCommandItems() {
  const a = askState();
  const cmd = a.command;
  if (cmd.mode === 'model') return (a.models || []).map((m) => ({ id: m.id, label: m.label }));
  if (cmd.mode === 'think') return askEfforts().map((e) => ({ id: e, label: ASK_EFFORT_LABELS[e] || e }));
  const q = (cmd.query || '').toLowerCase();
  return askCommandList()
    .filter((c) => !q || c.name.includes(q) || (c.label + ' ' + c.description).toLowerCase().includes(q))
    .map((c) => ({ id: c.name, label: c.label, desc: c.description }));
}

function askCommandPopup() {
  const a = askState();
  if (a.command.mode === null && a.command.query === null) return '';
  const items = askCommandItems();
  const title = a.command.mode === 'model' ? '选择模型' : a.command.mode === 'think' ? '选择思考强度' : '快捷命令';
  return `<div class="ask-popup ask-slash-popup"><div class="ask-popup-title">${title}</div>
    ${items.map((item, i) => `<button type="button" class="${i === a.command.index ? 'is-hl' : ''}" data-act="ask-cmd" data-id="${esc(item.id)}"><b>${a.command.mode ? '' : '/'}${esc(item.id)}</b><span title="${esc(item.desc || '')}">${esc(item.label)}</span></button>`).join('')}
    ${items.length ? '' : '<p class="ask-popup-empty">暂无可用选项</p>'}</div>`;
}

/** 拉取当前项目工作区的文件（3 层内），给 @ 引用用。60 秒内复用缓存。 */
async function askLoadWorkspaceFiles(force) {
  const a = askState();
  if (!force && a.wsFiles && Date.now() - (a.wsFilesAt || 0) < 60000) return a.wsFiles;
  const pid = askProjectId();
  const out = [];
  const walk = async (dirPath, depth) => {
    if (depth > 4 || out.length > 400) return;
    try {
      const url = '/api/agent/workspace/tree' + (dirPath ? '?path=' + encodeURIComponent(dirPath) : '');
      const res = await fetch(url, { headers: { 'X-Project-Id': pid } });
      if (!res.ok) return;
      const data = await res.json();
      for (const it of data.items || []) {
        if (it.kind === 'directory') { await walk(it.relative_path, depth + 1); continue; }
        out.push({ name: it.name, path: it.relative_path, size: Number(it.size) || 0 });
        if (out.length > 400) return;
      }
    } catch (error) { /* 单层失败不影响其它目录 */ }
  };
  await walk('', 0);
  a.wsFiles = out;
  a.wsFilesAt = Date.now();
  return out;
}

function askMentionSkills() {
  const a = askState();
  const q = (a.mention && a.mention.query || '').toLowerCase();
  return askSkillList().filter((s) => (s.name + ' ' + s.description + ' ' + s.id).toLowerCase().includes(q));
}

/** @ 弹层的统一列表：技能 + 项目文件 + 本对话附件，键盘导航按这个顺序走 */
function askMentionItems() {
  const a = askState();
  const q = (a.mention && a.mention.query || '').toLowerCase();
  const skills = askMentionSkills().map((s) => ({ kind: 'skill', id: s.id, name: s.name, desc: s.description, icon: askSkillIcon(s.id) }));
  const seen = new Set();
  const files = [];
  for (const f of (a.attachments || [])) {
    const name = f.name || '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    files.push({ kind: 'file', id: name, name, desc: '本对话附件', icon: '📎' });
  }
  for (const f of (a.wsFiles || [])) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    files.push({ kind: 'file', id: f.path, name: f.name, desc: f.path, icon: '📄' });
  }
  const hit = files.filter((f) => !q || (f.name + ' ' + f.desc).toLowerCase().includes(q)).slice(0, 40);
  return [...skills, ...hit];
}

function askChooseMentionItem(item) {
  if (!item) return;
  if (item.kind === 'file') return askChooseFile(item.id);
  return askChooseMention(item.id);
}

function askMentionPopup() {
  const a = askState();
  if (!a.mention) return '';
  const items = askMentionItems();
  const groups = [];
  for (const it of items) {
    const name = it.kind === 'skill' ? '创作视角' : '项目文件';
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, items: [] }; groups.push(g); }
    g.items.push(it);
  }
  return `<div class="ask-popup ask-mention-popup">
    <div class="ask-popup-title"><span>✧ 引用技能或文件</span><small>${items.length} 项</small></div>
    ${groups.map((g) => `<div class="ask-popup-group"><div class="ask-popup-group-title">${g.name}</div>
      ${g.items.map((it) => {
        const i = items.indexOf(it);
        const mark = it.kind === 'skill' && it.id === a.skillId ? '<span class="ask-check">✓</span>' : '<span class="ask-enter">↵</span>';
        return `<button type="button" class="${i === a.mention.index ? 'is-hl' : ''}" data-act="ask-mention" data-kind="${it.kind}" data-id="${esc(it.id)}">
          <span class="ask-mention-ico">${it.icon}</span>
          <span><b>${esc(it.name)}</b><small>${esc(it.desc || '')}</small></span>
          ${mark}
        </button>`;
      }).join('')}
    </div>`).join('')}
    ${items.some((it) => it.kind === 'file') ? '' : `<div class="ask-popup-group"><div class="ask-popup-group-title">项目文件</div><p class="ask-popup-empty">项目工作区里还没有文件；用 📎 上传，或先在素材库建素材。</p></div>`}
    ${items.length ? '' : '<p class="ask-popup-empty">没有匹配的技能或项目文件。</p>'}
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

function askOpenWorkspace() {
  const a=askState();
  a.capabilitiesOpen=true;
}

// 关闭整个工作区：右上角 ✕、以及「关掉最后一个标签」都走这里，效果完全一致
function askCloseWorkspace() {
  const a=askState();
  try { AgentWorkspace?.sync?.(a); } catch { /* 工作区还没建起来时忽略 */ }
  a.capabilitiesOpen=false;
  a.previewFile=null;
  a.previewData=null;
  a.mediaPreview=null;
  askRenderAll();
}
function askWorkspaceContext() {
  const a=askState();
  return {projectId:askProjectId(),sessionId:a.activeId,projectName:state.project?.name||'项目工作区',expanded:a.previewExpanded,
    state:()=>a,render:askRenderAll,toast,open:askOpenWorkspace,close:askCloseWorkspace,
    apply:view=>{a.previewFile=view.file;a.previewData=view.data;a.previewError=view.error;a.previewSheet=view.sheet;a.previewSource=view.source;a.mediaPreview=view.media;},
    previewHtml:()=>askFilePaneHtml(true),trajectoryHtml:askTrajectoryHtml,loadTrajectory:askLoadTrajectory};
}

// Header popovers close independently, without rebuilding the chat under the pointer.
document.addEventListener('pointerdown',event=>{
  const a=state.ask;if(!a)return;
  if(a.headerMenu&&!event.target.closest('.ask-head-actions')){a.headerMenu=false;document.querySelector('.ask-head-menu')?.remove();document.querySelector('[data-act="ask-head-menu"]')?.setAttribute('aria-expanded','false');}
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!state.ask)return;
  if(state.ask.headerMenu||state.ask.summaryOpen){state.ask.headerMenu=false;state.ask.summaryOpen=false;askRenderAll();}
});

function askCapabilityHtml() {
  return window.AgentWorkspace ? AgentWorkspace.html(askWorkspaceContext()) : '';
}
function askHeaderMenuHtml(chat) {
  const id=esc(chat.id||'');
  return '<div class="ask-head-menu" role="menu" aria-label="管理对话">'+
    '<button role="menuitem" data-act="ask-rename" data-id="'+id+'">重命名</button>'+
    '<button role="menuitem" data-act="ask-pin" data-id="'+id+'">'+(chat.pinned?'取消置顶':'置顶')+'</button><hr>'+
    '<button role="menuitem" data-act="ask-new">新建对话</button>'+
    '<button role="menuitem" data-act="ask-copy-conversation">复制对话文本</button>'+
    '<button role="menuitem" data-act="ask-export">导出对话</button></div>';
}
async function askLoadSummaryFiles() {
  const a=askState(),project=askProjectId(),sid=a.activeId;
  if(!sid)return;
  try {
    const result=await askApi('/workspace/session-files?'+new URLSearchParams({session_id:sid,kind:'output'})).then(r=>r.json());
    if(askProjectId()!==project||a.activeId!==sid)return;
    a.summaryFiles={project,sid,...result};if(a.summaryOpen)askRenderAll();
  }catch(err){if(a.summaryOpen)toast(err.message,true);}
}
// 最近一次运行带来的上下文分项统计（后端算好写进回执）
function askContextReport(chat) {
  const list = (chat && chat.messages) || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const report = list[i].execution && list[i].execution.context && list[i].execution.context.report;
    if (report && Array.isArray(report.items) && report.items.length) return report;
  }
  return null;
}

function askContextBlockHtml(chat, stats) {
  const report = askContextReport(chat);
  if (!report) {
    const ratio = Math.max(0, Math.min(1, stats.ratio || 0));
    return `<div class="ask-summary-usage"><b>${Math.round(ratio * 100)}% used</b><span>${askFmtTokens(stats.used)} / ${askFmtTokens(stats.total)}</span></div>
      <div class="ask-ctx-bar"><i class="ask-ctx-seg is-messages" style="width:${(ratio * 100).toFixed(2)}%"></i></div>
      <p class="ask-summary-hint">这个会话还没跑过</p>`;
  }
  const total = Math.max(1, Number(report.window) || stats.total || 1);
  const items = report.items || [];
  const width = (item) => Math.min(100, Math.max(0, (Number(item.tokens) || 0) / total * 100)).toFixed(2);
  const segments = items.map((item) => `<i class="ask-ctx-seg is-${esc(item.key)}" style="width:${width(item)}%" title="${esc(item.label)} · ${askFmtTokens(item.tokens)}"></i>`).join('');
  const rows = items.map((item) => `<div class="ask-ctx-row${item.key === 'free' ? ' is-free' : ''}">
      <span class="ask-ctx-dot is-${esc(item.key)}"></span>
      <span class="ask-ctx-label">${esc(item.label)}</span>
      <span class="ask-ctx-tokens">${askFmtTokens(item.tokens)}</span>
      <span class="ask-ctx-pct">${(Number(item.percent) || 0).toFixed(1)}%</span>
    </div>`).join('');
  const names = Array.isArray(report.tool_names) ? report.tool_names : [];
  const toolsMore = (report.tool_count || names.length)
    ? `<details class="ask-ctx-tools"><summary>Tools · ${report.tool_count || names.length}</summary><div class="ask-ctx-tool-list">${names.length ? names.map((name) => `<span>${esc(name)}</span>`).join('') : '<span>未记录工具名</span>'}</div></details>`
    : '';
  // 只留固定模块的用量：不讲口径，也不摆额外的计数行
  return `<div class="ask-summary-usage"><b>${(Number(report.used_percent) || 0).toFixed(0)}% used</b><span>${askFmtTokens(report.used)} / ${askFmtTokens(total)}</span></div>
    <div class="ask-ctx-bar">${segments}</div>
    ${rows}
    ${toolsMore}`;
}


// 项目所在文件夹的名字（不同项目不同）：D:\…\我的同桌测试-643a02 → 我的同桌测试-643a02
function askFolderName(value) {
  const parts = String(value || '').replace(/[\\/]+/g, '\\').split('\\').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

// 环境三行：本机 / 项目文件夹 / git 分支（分支还没有 git 逻辑，先如实显示 null）
function askEnvironmentHtml() {
  const folder = askFolderName(state.project?.dir) || state.project?.name || askProjectId();
  const branch = state.project?.branch ?? 'null';
  const icon = (name) => ({
    computer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
    branch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 8.2v7.6M18 11.2c0 3.4-3 4.6-6 4.6"/></svg>',
  }[name] || '');
  return `<div class="ask-env-row"><span class="ask-env-ico">${icon('computer')}</span><span class="ask-env-text">This Computer</span></div>`
    + `<div class="ask-env-row"><span class="ask-env-ico">${icon('folder')}</span><span class="ask-env-text" title="${esc(state.project?.dir || '')}">${esc(folder)}</span></div>`
    + `<div class="ask-env-row"><span class="ask-env-ico">${icon('branch')}</span><span class="ask-env-text is-muted">${esc(branch)}</span></div>`;
}

/* ---------- Connectors / Outputs / Changes 的小图标 ---------- */
const ASK_FILE_SHAPES = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  text: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  sheet: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6"/><path d="M8 13h8M8 17h8M12 13v5"/>',
  code: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  audio: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>',
  pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6"/><path d="M8 16c3-4 5 3 8-2"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6"/>',
};

// 按扩展名挑图标：文本 / 表格 / 代码 / 图片 / 视频 / 音频 / PDF / 其它
function askFileKind(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (!name || !ext || ext === String(name).toLowerCase()) return 'file';
  if (['md', 'txt', 'markdown', 'log', 'rtf'].includes(ext)) return 'text';
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) return 'sheet';
  if (['js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'json', 'html', 'css', 'sh', 'yml', 'yaml', 'sql'].includes(ext)) return 'code';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  return 'file';
}

function askFileIcon(name, kind) {
  const shape = ASK_FILE_SHAPES[kind || askFileKind(name)] || ASK_FILE_SHAPES.file;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${shape}</svg>`;
}

function askConnectorsHtml() {
  const a = askState();
  const toolsOk = a.toolsSupported !== false;
  const skill = a.skillId ? askSkill(a.skillId).name : '';
  const row = (badge, text, muted) => `<div class="ask-env-row"><span class="ask-conn-badge">${badge}</span><span class="ask-env-text${muted ? ' is-muted' : ''}">${esc(text)}</span></div>`;
  return row('T', 'Tools · ' + (toolsOk ? 'available' : 'unavailable'), !toolsOk)
    + row('S', 'Skill · ' + (skill || 'null'), !skill)
    + row('C', 'MCP · null', true);
}

function askOutputsHtml(files, indexed) {
  const list = files || [];
  if (!list.length) return '<div class="ask-output-empty">null</div>';
  const rows = list.slice(-10).map((item) => {
    const name = item.type === 'artifact' ? (item.file && item.file.name) || '文件' : item.name || '文件';
    const isFolder = !!(item.file && item.file.kind === 'folder');
    const ico = `<span class="ask-file-ico">${askFileIcon(name, isFolder ? 'folder' : undefined)}</span>`;
    return item.type === 'artifact'
      ? `<button class="ask-summary-file" data-act="ask-preview" data-id="${esc(item.file.id)}">${ico}<span class="ask-file-name">${esc(name)}</span></button>`
      : `<button class="ask-summary-file" data-act="ask-open-media" data-index="${item.mi}" data-media="${item.fi}">${ico}<span class="ask-file-name">${esc(name)}</span></button>`;
  }).join('');
  const more = (indexed && indexed.total ? indexed.total : list.length) > 10 ? '<small>展示最近 10 项，全部文件可在工作区查看。</small>' : '';
  return rows + more;
}

// 改动统计还没有 GitHub 逻辑：固定一个小图标，值为 null
function askChangesHtml() {
  return '<div class="ask-changes"><span class="ask-changes-ico">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 7v4M6 9h4M14 15h4"/></svg>'
    + '</span><span class="ask-changes-text">null</span>'
    + '<button type="button" class="ask-changes-pr" disabled title="尚未接入 GitHub">Create PR</button></div>'
    + '<p class="ask-changes-note">GitHub 改动统计待接入，框位保留。</p>';
}

function askSummaryHtml(chat) {
  const a=askState(),stats=askContextStats();
  const indexed=a.summaryFiles?.project===askProjectId()&&a.summaryFiles?.sid===a.activeId?a.summaryFiles:null;
  const files=indexed?indexed.items.map(file=>({type:'artifact',file})):askSessionFiles(chat);
  return '<aside class="ask-summary" aria-label="Summary"><header><b>Summary</b><button class="ask-icon-btn" data-act="ask-summary" aria-label="关闭摘要">×</button></header>'+
    '<details open class="ask-summary-sec"><summary>Environment</summary>'+askEnvironmentHtml()+'</details>'+
    '<details open class="ask-summary-sec"><summary>Context</summary>'+askContextBlockHtml(chat,stats)+'</details>'+
    '<details open class="ask-summary-sec"><summary>Connectors</summary>'+askConnectorsHtml()+'</details>'+
    '<details open class="ask-summary-sec"><summary>Outputs</summary>'+askOutputsHtml(files,indexed)+'</details>'+
    '<details open class="ask-summary-sec"><summary>Changes</summary>'+askChangesHtml()+'</details></aside>';
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
  const systemSkills = ((a.skills && a.skills.length) ? a.skills.filter((s) => s.source === 'builtin') : ASK_SKILLS.map((s) => ({ id: s.id, name: s.name, description: s.description }))).map((s) => ({ id: s.id, name: s.name, description: s.description }));
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
        ${tab === 'skill' ? '<button type="button" class="ask-btn" data-act="ask-skill-install">安装技能</button>' : ''}
        <button type="button" class="ask-btn is-primary" data-act="ask-manage-new">${newLabels[tab]}</button>
        <button type="button" class="ask-btn" data-act="ask-workspace" data-page="console">返回对话</button>
      </div>
    </header>
    <nav class="ask-manage-tabs">
      ${['tool', 'skill', 'mcp'].map((k) => `<button type="button" class="${tab === k ? 'is-on' : ''}" data-act="ask-plugin-tab" data-tab="${k}">${labels[k]} <span>${(k === 'skill' ? systemSkills.length : k === 'tool' ? systemTools.length : 0) + (a.plugins || []).filter((p) => (p.kind || 'skill') === k).length}</span></button>`).join('')}
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
  const matches = (c) => (c.id === a.activeId || (c.messages || []).length)
    && (c.title + ' ' + (c.messages || []).map((m) => m.text).join(' ')).toLowerCase().includes(search);
  // 对话只在项目内可见：这里永远只有当前项目一行
  const rows = (a.projectHistory && a.projectHistory.length)
    ? a.projectHistory
    : [{ id: askProjectId(), name: state.project?.name || '当前项目', items: a.conversations || [] }];
  const groups = rows.map((row) => ({
    id: row.id,
    label: row.name,
    error: row.error || '',
    items: (row.items || []).filter(matches).sort((x, y) => Number(!!y.pinned) - Number(!!x.pinned) || (y.updated || 0) - (x.updated || 0)),
  }));
  return `<aside class="ask-history ${a.historyOpen ? 'is-open' : ''}">
      <div class="ask-pane-heading">
        <span class="ask-pane-logo">Y9</span>
        <div><b>智能创作</b><small>剧本 · 分镜 · 提示词</small></div>
        <button type="button" class="ask-history-hide" data-act="ask-toggle-history" title="隐藏对话列表">‹</button>
      </div>
      <nav class="ask-workspace-nav">
        <button type="button" class="${a.workspacePage === 'console' ? 'is-on' : ''}" data-act="ask-workspace" data-page="console">▤ 控制台</button>
        <button type="button" data-act="ask-workspace" data-page="knowledge">📖 知识库</button>
        <button type="button" data-act="ask-workspace" data-page="plugins">🧩 插件</button>
      </nav>
      <div class="ask-sidebar-conversations">
        <button type="button" class="ask-new-chat" data-act="ask-new">＋ 新建对话</button>
        <div class="ask-history-search"><span>⌕</span><input id="ask-search" placeholder="搜索对话历史" value="${esc(a.search)}" /></div>
        <div class="ask-history-list">
          ${groups.map((g) => (g.items.length || g.id === askProjectId() ? `<div class="ask-folder-heading"><button type="button" class="ask-folder-toggle" data-act="ask-folder-toggle" data-id="${esc(g.id)}" aria-expanded="${!a.collapsedFolders?.[g.id]}" title="只显示当前项目的对话：${esc(g.label)}">${a.collapsedFolders?.[g.id] ? '▸' : '▾'} <span>${esc(g.label)}</span><small>${g.items.length}</small></button><button type="button" class="ask-folder-action" data-act="ask-project-new-chat" data-id="${esc(g.id)}" title="在${esc(g.label)}新建对话">＋</button></div>${g.error ? `<p class="ask-empty-history">${esc(g.error)}</p>` : ''}${(!a.collapsedFolders?.[g.id] || search ? g.items : []).map((c) => `<div class="ask-history-item ${c.id === a.activeId ? 'is-on' : ''} ${askRunOf(c.id) ? 'is-running' : ''}" data-id="${esc(c.id)}">
            <button type="button" class="ask-history-main" data-act="ask-open" data-id="${esc(c.id)}" data-project="${esc(g.id)}">
              ${(() => {
                const running = !!askRunOf(c.id);
                const flag = running ? 'is-running' : '';
                const mark = running ? '' : (c.pinned ? '◆' : '○');
                return `<span class="ask-history-flag ${flag}" title="${running ? '正在生成回复' : (c.pinned ? '已置顶' : '')}" aria-label="${running ? '正在生成回复' : ''}">${mark}</span>`;
              })()}<span><b>${esc(c.title || '新的创作对话')}</b><small>${esc(askPreview(c))}</small></span>
            </button>
            <button type="button" class="ask-history-more" data-act="ask-more" data-id="${esc(c.id)}" title="管理对话">⋯</button>
          </div>`).join('')}` : '')).join('')}
          ${groups.some((g) => g.items.length) ? '' : '<p class="ask-empty-history">还没有对话：选个项目，点「＋ 新建对话」开工</p>'}
        </div>
        ${a.removed ? `<div class="ask-undo">已删除一个对话<button type="button" data-act="ask-undo">撤销</button></div>` : ''}
      </div>
      <div class="ask-history-foot"><span>▤ 只显示当前项目的对话，切换项目即切换历史</span><span class="ask-dot"></span></div>
    </aside>`;
}

/* ------------------- 对话只在项目内可见：侧栏只列当前项目 ------------------- */
// 隔离层级是 租户 → 用户 → 项目：跨项目的对话一概不读、不列、不跳。
// 这里的「历史」只是当前项目那一行，内容永远跟 a.conversations 同源，不再向别的项目发请求。
async function askLoadProjectHistory() {
  const a = askState();
  const current = askProjectId();
  if (!current) {
    a.projectHistory = [];
    if (state.route === 'script') askRenderAll();
    return;
  }
  const project = (state.projects || []).find((p) => p.id === current);
  a.projectHistory = [{
    id: current,
    name: project ? project.name : (state.project ? state.project.name : '当前项目'),
    items: a.conversations || [],
  }];
  if (state.route === 'script') askRenderAll();
}

// 侧栏按项目分组渲染，当前项目的列表同时被 a.conversations 和 projectHistory 那一行引用；
// 任何增删都要两边一起改，否则删掉的对话还挂在侧栏里，点它就会报“不存在”。
function askSyncCurrentRowItems() {
  const a = askState();
  if (!Array.isArray(a.projectHistory) || !Array.isArray(a.conversations)) return;
  const row = a.projectHistory.find((r) => r.id === askProjectId());
  if (row) row.items = a.conversations;
}

function askFindConversation(id) {
  const a = askState();
  const hit = (a.conversations || []).find((c) => c.id === id);
  if (hit) return hit;
  for (const row of a.projectHistory || []) {
    const found = (row.items || []).find((c) => c.id === id);
    if (found) return found;
  }
  return null;
}

function askConversationProject(id) {
  const a = askState();
  if ((a.conversations || []).some((c) => c.id === id)) return askProjectId();
  for (const row of a.projectHistory || []) if ((row.items || []).some((c) => c.id === id)) return row.id;
  return askProjectId();
}

function askForgetConversation(id) {
  const a = askState();
  if (Array.isArray(a.conversations)) a.conversations = a.conversations.filter((c) => c.id !== id);
  for (const row of a.projectHistory || []) {
    if (Array.isArray(row.items)) row.items = row.items.filter((c) => c.id !== id);
  }
  if (a.moreMenu === id) a.moreMenu = null;
  if (a.rename && a.rename.id === id) a.rename = { open: false, id: '', text: '' };
  a.projectHistoryAt = 0;
  askSyncCurrentRowItems();
}

async function askOpenProjectConversation(projectId, convId) {
  const a = askState();
  // 对话属于它所在的项目：不是当前项目的一律不打开，也不偷偷切项目。
  if (projectId && projectId !== askProjectId()) {
    return toast('这个对话属于另一个项目，先切到那个项目再看', true);
  }
  if (!(a.conversations || []).some((c) => c.id === convId)) {
    // 侧栏里还留着已删掉的条目：摘掉它并跟服务端对齐，用户不用刷新页面
    askForgetConversation(convId);
    askRenderAll();
    askLoadProjectHistory().catch(() => {});
    return toast('这个对话已不在当前项目里，可能已被删除', true);
  }
  return askSelect(convId);
}

async function askNewChatInProject(projectId) {
  // 只在当前项目里新建；别处来的 id 直接无视，避免顺手把项目切走。
  if (projectId && projectId !== askProjectId()) return toast('请先切换到该项目再新建对话', true);
  const a = askState();
  return askNewConversation();
}

function askFilePaneHtml(embedded = false) {
  const a = askState();
  const media = a.mediaPreview;
  const file = a.previewFile;
  const data = a.previewData;
  const name = media ? media.name : (file ? file.name : '文件');
  const bytes = media ? media.bytes : (data && data.size) || (file && file.size) || 0;
  const kind = media ? media.kind : ((data && data.kind) || 'text');
  const expanded = !!a.previewExpanded;
  const contentUrl = file ? '/api/agent/workspace/files/' + encodeURIComponent(file.id) + '/content' : '';
  const rawUrl = file ? '/api/agent/workspace/files/' + encodeURIComponent(file.id) + '/raw?project=' + encodeURIComponent(askProjectId()) : '';
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
    body = `<div class="ask-pane-image"><img src="${rawUrl}" alt="${esc(name)}" /></div>`;
  } else if (data.kind === 'pdf') {
    body = `<iframe class="ask-pane-html" src="${rawUrl}" title="PDF 文件预览"></iframe>`;
  } else if (data.kind === 'audio') {
    body = `<div class="ask-pane-media"><b>${esc(name)}</b><audio src="${rawUrl}" controls preload="metadata"></audio><p>音频播放</p></div>`;
  } else if (data.kind === 'video') {
    body = `<div class="ask-pane-video"><video src="${rawUrl}" controls preload="metadata" playsinline></video></div>`;
  } else if (data.kind === 'text') {
    body = `<pre class="ask-pane-text">${esc(data.content || data.text || '（没有可预览的文本）')}</pre>`;
  } else {
    body = `<div class="ask-pane-empty"><b>该格式暂不支持在线预览</b><span>${esc(data.message || '可以下载原件后用对应软件打开。')}</span><a class="ask-btn" href="${esc(downloadUrl)}" download>下载原件</a></div>`;
  }
  const isDoc = data && ['markdown', 'html'].includes(data.kind) && !media;
  const sheets = data && data.kind === 'spreadsheet' && Array.isArray(data.sheets) ? data.sheets : [];
  const paneStyle = !embedded && !expanded && a.previewWidth ? ` style="width:${a.previewWidth}px"` : '';
  return `<aside class="ask-file-pane ${embedded ? 'is-workspace-preview' : expanded ? 'is-expanded' : ''}"${paneStyle}>
    ${embedded || expanded ? '' : '<div class="ask-pane-resizer" role="separator" aria-label="调整聊天与预览宽度" aria-orientation="vertical" tabindex="0" title="拖动调整宽度，双击复位"><span></span></div>'}
    <header class="ask-file-head">
      <span class="ask-file-icon">${kind === 'video' ? '🎬' : kind === 'image' ? '🖼' : '📄'}</span>
      <div><b title="${esc(name)}">${esc(name)}</b><small>${kindLabel}预览${bytes ? ' · ' + fmtBytes(bytes) : ''}</small></div>
      ${file && data && ['text', 'markdown', 'html'].includes(data.kind) ? `<button type="button" class="ask-icon-btn" data-act="ask-copy-file-content" data-id="${esc(file.id)}" title="复制文件内容" aria-label="复制文件内容"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>` : ''}
      ${downloadUrl ? `<a class="ask-icon-btn" href="${esc(downloadUrl)}" download="${esc(name)}" title="下载原件">⇩</a>` : ''}
      ${file ? `<button type="button" class="ask-icon-btn" data-act="ask-reveal-pane" data-id="${esc(file.id)}" title="打开文件所在文件夹"><span class="ask-icon-folder">📁</span></button>` : ''}
      <button type="button" class="ask-icon-btn" data-act="ask-expand-preview" title="${expanded ? '缩小预览' : '展开预览'}">${expanded ? '⤡' : '⤢'}</button>
      <button type="button" class="ask-icon-btn" data-act="ask-close-pane" title="关闭预览">×</button>
    </header>
    ${isDoc ? `<nav class="ask-pane-mode"><button type="button" class="${a.previewSource ? '' : 'is-on'}" data-act="ask-preview-source" data-mode="preview">预览</button><button type="button" class="${a.previewSource ? 'is-on' : ''}" data-act="ask-preview-source" data-mode="source">源码</button>${data.kind === 'html' ? '<span>隔离预览 · 不执行脚本</span>' : ''}</nav>` : ''}
    ${sheets.length ? `<nav class="ask-pane-sheets">${sheets.map((sheet, i) => `<button type="button" class="${i === (data.sheet || 0) ? 'is-on' : ''}" data-act="ask-preview-sheet" data-sheet="${i}">${esc(sheet)}</button>`).join('')}</nav>` : ''}
    <div class="ask-file-body">${body}</div>
    ${data && data.truncated ? `<footer class="ask-file-foot">预览显示${data.kind === 'spreadsheet' ? '前 100 行、最多 50 列' : '前 20 万字符'}，下载可获取原件。</footer>` : (data && data.kind === 'pdf' ? '<footer class="ask-file-foot">PDF 使用浏览器内置阅读器；无法显示时可下载原件。</footer>' : (media ? '' : '<footer class="ask-file-foot">只读预览 · 文件保存在项目工作区。</footer>'))}
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
  if (a.workspacePage !== 'console') return `<div class="ask-app">${askHistoryHtml()}<section class="ask-chat" style="padding:0">${askManageHtml()}</section>
    ${a.installSkill ? askInstallSkillHtml() : ''}
  </div>`;

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
          <button type="button" class="ask-icon-btn" data-act="ask-head-menu" aria-label="管理" aria-haspopup="menu" aria-expanded="${!!a.headerMenu}" title="管理">⋯</button>
          <button type="button" class="ask-icon-btn ${a.summaryOpen?'is-on':''}" data-act="ask-summary" aria-label="Summary" aria-expanded="${!!a.summaryOpen}" title="Summary"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="5" cy="6" r="2"/><circle cx="5" cy="17" r="2"/><path d="M11 6h10M11 12h10M11 18h10"/></svg></button>
          <span class="aw-head-divider"></span><button type="button" class="ask-icon-btn" data-act="ask-new-workspace" aria-label="新建标签页" title="新建标签页"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 7v10M7 12h10"/></svg></button>

          ${a.headerMenu?askHeaderMenuHtml(chat):''}
        </div>
      </header>

      <div class="ask-chat-body">
        <div class="ask-messages" id="ask-messages">
          ${a.error ? `<div class="ask-error">${esc(a.error)}</div>` : ''}
          ${messages.length ? `<div class="ask-message-list">${askMessagesHtml(chat)}
            ${a.generating ? `<div class="ask-generation"><span class="ask-pulse"></span><b>模型回复生成中</b><span>整理问题与所选技能…</span><span class="ask-gen-elapsed">0s</span><button type="button" data-act="ask-stop">停止</button></div>` : ''}
          </div>` : askWelcomeHtml()}
        </div>
        ${askTurnsHtml(chat)}
      </div>

      ${askComposerHtml()}
    </section>

    ${a.capabilitiesOpen ? askCapabilityHtml() : ''}
    ${a.summaryOpen ? askSummaryHtml(chat) : ''}
    ${a.rename.open ? askRenameModalHtml() : ''}
    ${a.installSkill ? askInstallSkillHtml() : ''}
    ${a.toolDetail ? askToolModalHtml() : ''}
    ${a.moreMenu ? askMoreMenuHtml() : ''}
    <input type="file" id="ask-file" hidden multiple accept=".txt,.md,.csv,.json,.xlsx,.docx,.pdf,.png,.jpg,.jpeg,.webp,.html,.mp3,.wav,.m4a,.mp4,.webm" />
  </div>`;
}

// 一轮 = 一条用户提问 + 它后面的所有助手消息（直到下一条提问）
function askTurnSpan(messages, index) {  const list = messages || [];
  const target = list[index];
  if (!target || target.role !== 'user') return null;
  let end = index + 1;
  while (end < list.length && list[end].role !== 'user') end += 1;
  return { start: index, end, count: end - index };
}

/* --------------------------- 待发送队列（按对话持久化） --------------------------- */
function askQueueKey(chatId) { return 'wmd.ask.queue.' + chatId; }

function askLoadQueue(chatId) {
  const a = askState();
  if (!a.queues) a.queues = {};
  const id = chatId || a.activeId;
  if (!id) return [];
  if (!Array.isArray(a.queues[id])) {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(askQueueKey(id)) || '[]'); } catch { saved = []; }
    a.queues[id] = Array.isArray(saved) ? saved.filter((x) => x && x.text) : [];
  }
  return a.queues[id];
}

function askSaveQueue(chatId) {
  const a = askState();
  const id = chatId || a.activeId;
  if (!id) return;
  try { localStorage.setItem(askQueueKey(id), JSON.stringify((a.queues && a.queues[id]) || [])); } catch { /* ignore */ }
}

function askEnqueue(raw, chatId, webSearch = !!askState().webSearch) {
  const a = askState();
  const id = chatId || a.activeId;
  const text = String(raw || '').trim();
  if (!id || !text) return;
  const list = askLoadQueue(id);
  list.push({ id: askId(), text, time: Date.now(), webSearch: !!webSearch });
  askSaveQueue(id);
  if (id === a.activeId) {
    a.draft = '';
    const input = $('#ask-input');
    if (input) input.value = '';
    askRenderAll();
  }
  toast('已排队第 ' + list.length + ' 条，当前回复结束后依次发送');
}

/* ------------------- 直发 = 当前任务的补充说明（不是新任务） ------------------- */
// 有任务在跑时：这句话并进当前运行，任务不中断、不重启、已完成步骤与中间结果全部保留。
async function askSupplementSend(text, chatId) {
  const a = askState();
  const id = chatId || a.activeId;
  const body = String(text || '').trim();
  const run = askRunOf(id);
  const runId = (run && run.runId) || '';
  if (!id || !body) return { ok: false, code: 'empty' };
  const url = runId
    ? '/api/agent/runs/' + encodeURIComponent(runId) + '/supplements'
    : '/api/agent/sessions/' + encodeURIComponent(id) + '/supplements';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
      body: JSON.stringify({ text: body }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail || {};
      return {
        ok: false,
        code: (detail && detail.code) || 'error',
        message: typeof detail === 'string' ? detail : ((detail && detail.message) || '补充说明未送达'),
        runId,
      };
    }
    return { ok: true, ...data, runId: data.run_id || runId };
  } catch (err) {
    return { ok: false, code: 'network', message: err.message || '补充说明未送达', runId };
  }
}

function askQueueMark(chatId, ids, state) {
  const a = askState();
  const id = chatId || a.activeId;
  const list = askLoadQueue(id);
  const wanted = ids || [];
  let hit = false;
  for (const item of list) {
    if (item.sup && wanted.includes(item.sup.id)) { item.sup.state = state; hit = true; }
  }
  if (hit) { askSaveQueue(id); if (a.activeId === id) askRenderSoon(); }
}

function askQueueAck(chatId, ids) {
  const a = askState();
  const id = chatId || a.activeId;
  const list = askLoadQueue(id);
  const wanted = ids || [];
  if (!list.length || !wanted.length) return;
  let hit = false;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    if (item.sup && wanted.includes(item.sup.id)) { list.splice(i, 1); hit = true; }
  }
  if (hit) { askSaveQueue(id); if (a.activeId === id) askRenderSoon(); }
}

// 一轮收尾：以服务端记录为准核对每条补充说明——已并入的删掉，没赶上的退回普通排队继续发。
async function askQueueSettle(chatId, runId) {
  const a = askState();
  const id = chatId || a.activeId;
  const list = askLoadQueue(id);
  const marks = list.filter((x) => x.sup);
  if (!marks.length) return;
  const target = runId || (marks[0].sup && marks[0].sup.runId) || '';
  let snapshot = null;
  if (target) {
    try {
      const res = await fetch('/api/agent/runs/' + encodeURIComponent(target) + '/supplements', {
        headers: { 'X-Project-Id': askProjectId() }, signal: AbortSignal.timeout(8000),
      });
      if (res.ok) snapshot = await res.json();
    } catch { /* 拿不到就用本地状态兜底 */ }
  }
  const status = new Map(((snapshot && snapshot.items) || []).map((x) => [x.id, x.status]));
  const keep = [];
  let back = 0;
  for (const item of list) {
    if (!item.sup) { keep.push(item); continue; }
    const state = status.get(item.sup.id) || (item.sup.state === 'applied' ? 'applied' : '');
    if (state === 'applied') continue;           // 已并入当前任务，删掉
    delete item.sup;                             // 没赶上检查点：退回普通排队
    back += 1;
    keep.push(item);
  }
  list.length = 0;
  list.push(...keep);
  askSaveQueue(id);
  if (a.activeId === id) askRenderAll();
  if (back) toast(back + ' 条补充说明没赶上执行检查点，已退回队列接着发送');
}

// 一轮结束后只发队首那一条，剩下继续排队
function askDrainQueue(chatId) {
  const a = askState();
  const id = chatId || a.activeId;
  if (!id || askRunOf(id)) return;
  const list = askLoadQueue(id);
  if (!list.length) return;
  const next = list.shift();
  askSaveQueue(id);
  if (a.activeId === id) askRenderAll();
  setTimeout(() => { askSend(next.text, id, !!next.webSearch).catch(() => {}); }, 150);
}

function askQueueHtml() {
  const a = askState();
  const list = askLoadQueue(a.activeId);
  if (!list.length) return '';
  const running = !!askRunOf(a.activeId);
  const rows = list.slice(0, 3).map((item, i) => `<div class="ask-queue-item">
      <span class="ask-queue-idx">${i + 1}</span>
      <span class="ask-queue-text" title="${esc(item.text)}">${esc(item.text)}</span>
      ${item.sup ? `<span class="ask-queue-state">${item.sup.state === 'applied' ? '已并入' : '等检查点'}</span>` : ''}
      ${(i === 0 && !item.sup) ? `<button type="button" class="ask-queue-btn is-direct" data-act="ask-queue-now" data-id="${esc(item.id)}" title="${running ? '直接发送：作为补充说明交给正在执行的任务，不中断执行' : '马上发送这条'}">↑</button>` : ''}
      <button type="button" class="ask-queue-btn is-danger" data-act="ask-queue-cancel" data-id="${esc(item.id)}" title="从队列里取消这条">×</button>
    </div>`).join('');
  const hint = running ? '队首 ↑：补充给当前任务，不中断执行' : '当前没有任务在跑，点 ↑ 立即发送';
  return `<div class="ask-queue" role="region" aria-label="待发送队列">
    <div class="ask-queue-head"><span>待发送 <b>${list.length}</b> 条</span><span class="ask-queue-hint">${hint}</span></div>
    ${rows}
    ${list.length > 3 ? `<div class="ask-queue-rest">后面还有 ${list.length - 3} 条，依次排队</div>` : ''}
  </div>`;
}

// 右侧轮次滑条：一轮一个小格，点一下跳到该轮用户提问；右侧面板打开时不显示
function askTurnsHtml(chat) {
  const a = askState();
  if (a.previewFile || a.mediaPreview || a.capabilitiesOpen) return '';
  const messages = (chat && chat.messages) || [];
  const turns = messages.map((m, index) => ({ m, index })).filter((x) => x.m.role === 'user');
  if (turns.length < 2) return '';
  return `<div class="ask-turns" role="navigation" aria-label="对话轮次">
    <div class="ask-turn-tip" hidden></div>
    ${turns.map((t, order) => `<button type="button" data-act="ask-jump" data-index="${t.index}" data-order="${order}" data-tip="第 ${order + 1} 轮：${esc(String(t.m.text || '').replace(/\s+/g, ' ').slice(0, 20))}" title="第 ${order + 1} 轮"><i></i></button>`).join('')}
  </div>`;
}

// 悬停滑条时弹出这一轮问题的前 20 个字
function askBindTurnTips() {
  const rail = document.querySelector('.ask-turns');
  if (!rail || rail._tipsBound) return;
  rail._tipsBound = true;
  const tip = rail.querySelector('.ask-turn-tip');
  if (!tip) return;
  const show = (event) => {
    const btn = event.target.closest('button[data-tip]');
    if (!btn) return;
    tip.textContent = btn.dataset.tip;
    tip.hidden = false;
    const body = rail.parentElement.getBoundingClientRect();
    const rect = btn.getBoundingClientRect();
    const top = rect.top - body.top + rect.height / 2 - tip.offsetHeight / 2;
    tip.style.top = Math.round(Math.max(2, Math.min(body.height - tip.offsetHeight - 2, top))) + 'px';
  };
  const hide = () => { tip.hidden = true; };
  rail.addEventListener('mouseover', show);
  rail.addEventListener('mouseleave', hide);
  rail.addEventListener('click', hide);
  rail.addEventListener('scroll', hide, true);
}

function askSyncTurns() {
  const host = $('#ask-messages');
  const rail = document.querySelector('.ask-turns');
  if (!host || !rail) return;
  const nodes = [...host.querySelectorAll('.ask-message[data-msg-index]')];
  if (!nodes.length) return;
  const top = host.getBoundingClientRect().top + 8;
  let active = -1;
  for (const node of nodes) {
    if (node.getBoundingClientRect().top <= top + 40) {
      if (node.classList.contains('is-user')) active = Number(node.dataset.msgIndex);
    }
  }
  for (const btn of rail.querySelectorAll('button')) {
    btn.classList.toggle('is-on', Number(btn.dataset.index) === active);
  }
}

function askJumpToTurn(host, node) {
  if (!host || !node) return;
  const a = askState();
  a.pinBottom = false;
  a.jumpUntil = Date.now() + 1400; // 跳转动画期间别让“贴底”逻辑把位置拉回去
  const target = () => Math.round(node.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 10);
  host.scrollTo({ top: Math.max(0, target()), behavior: 'smooth' });
  // 图片/懒加载会让上面的高度变化，动画结束后再校正几次，确保停在目标轮次
  if (a._jumpTimer) clearTimeout(a._jumpTimer);
  let tries = 0;
  const settle = () => {
    a._jumpTimer = null;
    if (!document.body.contains(node)) return;
    const drift = Math.round(node.getBoundingClientRect().top - host.getBoundingClientRect().top - 10);
    if (Math.abs(drift) > 8 && tries < 6) {
      tries += 1;
      host.scrollTop = Math.max(0, target());
      a.jumpUntil = Date.now() + 400;
      a._jumpTimer = setTimeout(settle, 120);
    }
  };
  a._jumpTimer = setTimeout(settle, 430);
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

function askInstallSkillHtml() {
  const d = askState().installSkill;
  return `<div class="ask-modal-backdrop"><div class="ask-modal is-wide" role="dialog" aria-modal="true" aria-label="安装技能">
    <div class="ask-modal-head"><b>安装技能</b><button type="button" data-act="ask-install-cancel" aria-label="关闭">×</button></div>
    <div class="ask-modal-body">
      <label for="ask-install-name">技能名称</label>
      <input class="ask-input is-line" id="ask-install-name" maxlength="100" placeholder="例如：短剧钩子诊断" value="${esc(d.name || '')}" />
      <label for="ask-install-desc">一句话说明</label>
      <input class="ask-input is-line" id="ask-install-desc" maxlength="300" placeholder="这个技能做什么、什么时候用" value="${esc(d.description || '')}" />
      <label for="ask-install-content">技能内容（SKILL.md 正文）</label>
      <textarea class="ask-input" id="ask-install-content" rows="10" placeholder="粘贴 SKILL.md 正文，或点下面的按钮选择 .md 文件">${esc(d.content || '')}</textarea>
      <div class="ask-install-tools">
        <button type="button" class="ask-btn" data-act="ask-install-file">选择 .md 文件</button>
        <span class="ask-install-hint">上限 60000 字符；保存到智能体后端的 skills/ 目录，同名技能会被覆盖升级，换项目也能用。</span>
        <input type="file" id="ask-install-file" accept=".md,.txt,.markdown" hidden />
      </div>
      ${d.error ? `<div class="ask-error">${esc(d.error)}</div>` : ''}
    </div>
    <div class="ask-modal-foot">
      <button class="ask-btn" type="button" data-act="ask-install-cancel">取消</button>
      <button class="ask-btn is-primary" type="button" data-act="ask-install-save" ${d.saving ? 'disabled' : ''}>${d.saving ? '安装中…' : '安装'}</button>
    </div>
  </div></div>`;
}

async function askSaveInstallSkill() {
  const a = askState();
  const d = a.installSkill;
  if (!d || d.saving) return;
  const name = ($('#ask-install-name') || {}).value || '';
  const description = ($('#ask-install-desc') || {}).value || '';
  const content = ($('#ask-install-content') || {}).value || '';
  d.name = name;
  d.description = description;
  d.content = content;
  if (!name.trim()) { d.error = '请填写技能名称'; askRenderAll(); return; }
  if (!content.trim()) { d.error = '请粘贴 SKILL.md 正文或选择文件'; askRenderAll(); return; }
  d.saving = true;
  d.error = '';
  askRenderAll();
  try {
    const res = await askApi('/skills/install', { method: 'POST', body: JSON.stringify({ name: name.trim(), description: description.trim(), content }) });
    const data = await res.json().catch(() => ({}));
    await askLoadSkills();
    await askLoadManage();
    a.installSkill = null;
    a.pluginTab = 'skill';
    a.workspacePage = 'plugins';
    if (state.route === 'script') askRenderAll();
    toast((data && data.reinstalled ? '已覆盖升级技能：' : '已安装技能：') + name.trim());
  } catch (err) {
    d.saving = false;
    d.error = err.message || '安装失败';
    askRenderAll();
  }
}

function askMoreMenuHtml() {
  const a = askState();
  const c = askFindConversation(a.moreMenu);
  if (!c) return '';
  return `<div class="ask-more-menu" role="menu" aria-label="管理对话：${esc(c.title || '新的创作对话')}" style="visibility:hidden">
    <button type="button" data-act="ask-pin" data-id="${esc(c.id)}">${c.pinned ? '取消置顶' : '置顶对话'}</button>
    <button type="button" data-act="ask-rename" data-id="${esc(c.id)}">重命名</button>
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
  const chatScroll = askCaptureScroll($('#ask-messages', host));
  const a = askState();
  const wantBottom = a.scrollIntent === 'bottom';
  if (wantBottom) a.scrollIntent = null;
  host.innerHTML = renderScript();
  bindAsk(host);
  askRenderPopups();
  const historyList = $('.ask-history-list', host);
  if (historyList) historyList.scrollTop = historyScroll;
  askPositionMoreMenu();
  const msgs = $('#ask-messages');
  if (msgs) {
    askBindScrollPin(msgs);
    // 删掉末尾一轮时明确要求停在新末尾；其余情况按重绘前的位置复位，别甩回开头
    if (wantBottom) askHoldScroll(msgs, { atBottom: true });
    else if (chatScroll) askHoldScroll(msgs, chatScroll);
    else if (askLastScroll(a)) askHoldScroll(msgs, askLastScroll(a));
    else if (askFollowBottom()) msgs.scrollTop = msgs.scrollHeight;
    askReportScrollJump(chatScroll, msgs, 'askRenderAll');
  }
  askUpdateContextMeter();
  askBindTurnTips();
  guHydrateRefs($('#ask-messages', view));
}

// 是否跟随到底部：只有用户本来就在底部才跟随，一旦往上翻就停下来
function askFollowBottom() {
  const a = askState();
  return a.pinBottom !== false;
}

/* --------------------- 重绘后保住聊天区滚动位置 ---------------------
   整块重绘（开预览、切源码/工作表、删掉一轮、开关面板）会重建 #ask-messages，
   新的滚动容器 scrollTop 是 0，于是聊天记录被甩回开头，还得重新往下划。
   这里在重绘前记下“视口顶部压在哪条消息、偏移多少”，重绘后按同一条消息复位；
   锚点恰好被删掉时按内容高度差补偿，绝不落回开头。 */
const askScrollHold = { token: 0 };

function askCaptureScroll(host) {
  if (!host) return null;
  const top = host.scrollTop;
  const height = host.scrollHeight;
  const client = Math.max(0, host.clientHeight);
  const atBottom = height - top - client < 40;
  const list = host.querySelector('.ask-message-list');
  const nodes = list ? [...list.children].filter((n) => n.classList && n.classList.contains('ask-message')) : [];
  if (!nodes.length) return { index: -1, id: '', offset: 0, top, scrollHeight: height, clientHeight: client, atBottom };
  const boxTop = host.getBoundingClientRect().top;
  let index = nodes.length - 1;
  let offset = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const rect = nodes[i].getBoundingClientRect();
    if (rect.bottom > boxTop + 1) { index = i; offset = Math.round(rect.top - boxTop); break; }
  }
  return { index, id: nodes[index].dataset.msgId || '', offset, top, scrollHeight: height, clientHeight: client, atBottom };
}

function askRestoreScroll(host, view) {
  if (!host || !view) return;
  const maxTop = Math.max(0, host.scrollHeight - host.clientHeight);
  if (view.atBottom) { host.scrollTop = maxTop; return; }
  const list = host.querySelector('.ask-message-list');
  const nodes = list ? [...list.children].filter((n) => n.classList && n.classList.contains('ask-message')) : [];
  const node = (view.id ? nodes.find((n) => n.dataset.msgId === view.id) : null) || nodes[view.index];
  if (!node) {
    // 锚点这一轮被删掉了：按内容缩短的高度往回补，位置跟着上面补齐，不回开头
    const shrink = Math.max(0, (view.scrollHeight || 0) - host.scrollHeight);
    host.scrollTop = Math.min(maxTop, Math.max(0, (view.top || 0) - shrink));
    return;
  }
  const drift = Math.round(node.getBoundingClientRect().top - host.getBoundingClientRect().top) - view.offset;
  host.scrollTop = Math.min(maxTop, Math.max(0, host.scrollTop + drift));
  // 上面有卡住的高度变化（比如预览面板挤窄了正文）时，别把顶部那一条顶出视野
  if (host.scrollTop === 0 && view.offset < 0) host.scrollTop = Math.min(maxTop, Math.max(0, -view.offset));
}

// 图片是异步补进来的，上面高度一变锚点就会漂，所以重绘后连拉几次把它按住；
// 用户一旦自己滚动（scrollTop 与我们设的不符），立刻交还控制权，不去抢。
function askHoldScroll(host, view) {
  if (!host || !view) return;
  if (view.atBottom) { askRestoreScroll(host, view); return; }
  askScrollHold.token += 1;
  const token = askScrollHold.token;
  const alive = () => token === askScrollHold.token && document.body.contains(host);
  let expected = 0;
  const release = () => { if (Math.abs(host.scrollTop - expected) > 2) askScrollHold.token += 1; };
  const apply = () => {
    if (!alive()) { host.removeEventListener('scroll', release); return; }
    askRestoreScroll(host, view);
    expected = host.scrollTop;
  };
  host.addEventListener('scroll', release, { passive: true });
  apply();
  requestAnimationFrame(apply);
  // 懒加载图片、附件条撑高输入区都会晚一点改高度，多按几轮
  [90, 240, 600, 1200].forEach((ms) => setTimeout(apply, ms));
  setTimeout(() => host.removeEventListener('scroll', release), 1500);
}

// 滚动位置随手记在状态里：重绘前没来得及 capture 的路径也能靠它复位
function askNoteScroll(host) {
  const a = askState();
  if (!host || !a) return;
  const view = askCaptureScroll(host);
  if (!view) return;
  view.chatId = a.activeId || '';
  a.lastScroll = view;
}

function askLastScroll(a) {
  const saved = a && a.lastScroll;
  if (!saved) return null;
  if (saved.chatId && a.activeId && saved.chatId !== a.activeId) return null; // 换了会话就别套用旧位置
  return saved;
}

// 万一还有哪条路径把位置清零，留一笔证据：F12 里 __scrollJumps 直接看调用栈
function askReportScrollJump(before, host, label) {
  if (!before || !host) return;
  if (!before.top || before.top < 40) return;
  if (host.scrollTop > 40) return;
  const info = {
    at: new Date().toISOString(),
    label,
    from: before.top,
    to: host.scrollTop,
    stack: String((new Error().stack) || '').split('\n').slice(1, 6).join(' | '),
  };
  if (typeof window !== 'undefined') {
    window.__scrollJumps = window.__scrollJumps || [];
    window.__scrollJumps.push(info);
  }
  console.warn('[chat-scroll] 重绘后位置被清零', info);
}

function askBindScrollPin(host) {
  if (!host || host._askPinBound) return Promise.resolve();
  host._askPinBound = true;
  host.addEventListener('scroll', () => {
    const a = askState();
    // 用户自己滚的时候顺手记一笔位置，给来不及 capture 的重绘路径兜底
    if (host._askSnapTimer) clearTimeout(host._askSnapTimer);
    host._askSnapTimer = setTimeout(() => { host._askSnapTimer = 0; askNoteScroll(host); }, 60);
    const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 40;
    if (a.jumpUntil && Date.now() < a.jumpUntil) { a.pinBottom = false; askSyncTurns(); return; }
    const wasPinned = a.pinBottom !== false;
    a.pinBottom = atBottom;
    askSyncTurns();
    if (!wasPinned && atBottom) { askRenderStreaming(); return; }
    if (!atBottom) {
      // 已经往上翻了：停止逐帧重绘，等滚回底部再一次性补齐
      if (askRevealRaf) { cancelAnimationFrame(askRevealRaf); askRevealRaf = 0; }
    }
  }, { passive: true });
  return Promise.resolve();
}

let askRenderTimer = null;
let askRevealRaf = 0;

function askRenderSoon() {
  if (askRenderTimer) return;
  askRenderTimer = setTimeout(() => {
    askRenderTimer = null;
    askRenderStreaming();
  }, 90);
}

// 只重绘正在流式输出的最后一条消息，历史消息不参与重排，避免整块重绘带来的抖动
function askRenderStreaming() {
  const a = askState();
  const chat = askActive();
  const host = $('#ask-messages');
  if (!chat || !host) return askRenderMessages();
  const messages = chat.messages || [];
  const list = host.querySelector('.ask-message-list');
  const nodes = list ? [...list.children].filter((n) => n.classList && n.classList.contains('ask-message')) : [];
  if (!list || !messages.length || nodes.length !== messages.length) return askRenderMessages();
  const index = messages.length - 1;
  const node = nodes[index];
  const holder = document.createElement('div');
  holder.innerHTML = askMessageHtml(messages[index], index, messages, a);
  const next = holder.firstElementChild;
  if (!next) return;
  node.replaceWith(next);
  // 回复还在流式输出时先不出图，等这条回复定稿再按完整描述生成
  if (!(a.generating && index === messages.length - 1)) guHydrateRefs(next);
  if (askFollowBottom()) host.scrollTop = host.scrollHeight;
  askUpdateContextMeter();
}

// 收到数据就把“待显示字数”往前推，动画匀速走完，看起来像连续打字而不是一跳一跳
function askRevealKick() {
  const chat = askActive();
  const last = chat && (chat.messages || [])[(chat.messages || []).length - 1];
  if (!last || last.role !== 'assistant' || !last._streaming) { askRenderStreaming(); return; }
  if (last._reveal == null) last._reveal = 0;
  if (!askRevealRaf) askRevealRaf = requestAnimationFrame(askRevealStep);
}

function askRevealStep() {
  askRevealRaf = 0;
  const a = askState();
  const chat = askActive();
  const messages = (chat && chat.messages) || [];
  const msg = messages[messages.length - 1];
  if (!msg || msg.role !== 'assistant') return;
  const target = String(msg.text || '');
  let shown = msg._reveal == null ? target.length : msg._reveal;
  if (shown > target.length) shown = target.length;
  if (shown >= target.length) {
    msg._reveal = target.length;
    if (askFollowBottom()) askRenderStreaming();
    return;
  }
  // 用户往上翻在看历史时不做动画，数据照常累积，滚回底部再一次性补齐
  if (!askFollowBottom()) {
    msg._reveal = target.length;
    return;
  }
  const backlog = target.length - shown;
  const now = performance.now();
  const dt = Math.min(0.12, Math.max(0, now - (msg._revealAt || now - 16)) / 1000);
  msg._revealAt = now;
  const rate = a.generating ? Math.max(32, Math.min(220, backlog * 3.4)) : 4000;
  msg._acc = (msg._acc || 0) + rate * dt;
  const step = Math.min(backlog, Math.floor(msg._acc));
  msg._acc -= step;
  if (step > 0) {
    msg._reveal = shown + step;
    askRenderStreaming();
  }
  if (msg._reveal < target.length) askRevealRaf = requestAnimationFrame(askRevealStep);
}

// 只更新左侧对话列表的“运行中”标记，不重排整页
function askRefreshHistoryFlags() {
  const host = document.querySelector('.ask-history-list');
  if (!host) return;
  const a = askState();
  for (const item of host.querySelectorAll('.ask-history-item')) {
    const id = item.dataset.id;
    const flag = item.querySelector('.ask-history-flag');
    if (!flag || !id) continue;
    const running = !!askRunOf(id);
    const conv = (a.conversations || []).find((c) => c.id === id);
    flag.classList.toggle('is-running', running);
    flag.textContent = running ? '' : (conv && conv.pinned ? '◆' : '○');
    flag.title = running ? '正在生成回复' : (conv && conv.pinned ? '已置顶' : '');
    item.classList.toggle('is-running', running);
  }
}

function askScrollBottom() {
  const a = askState();
  a.pinBottom = true;
  const host = $('#ask-messages');
  if (host) host.scrollTop = host.scrollHeight;
}

function askRenderMessages() {
  const a = askState();
  const host = $('#ask-messages');
  if (!host) return;
  const chat = askActive();
  if (!chat) return;
  const view = askCaptureScroll(host);
  const wantBottom = a.scrollIntent === 'bottom';
  if (wantBottom) a.scrollIntent = null;
  host.closest('.ask-chat').classList.toggle('is-empty', !chat.messages.length);
  if (!chat.messages.length) { host.innerHTML = askWelcomeHtml(); return; }
  askBindScrollPin(host);
  host.innerHTML = `<div class="ask-message-list">${askMessagesHtml(chat)}
    ${a.generating ? `<div class="ask-generation"><span class="ask-pulse"></span><b>模型回复生成中</b><span>整理问题与所选技能…</span><span class="ask-gen-elapsed">0s</span><button type="button" data-act="ask-stop">停止</button></div>` : ''}
  </div>`;
  guHydrateRefs(host);
  if (wantBottom) askHoldScroll(host, { atBottom: true });
  else if (view) askHoldScroll(host, view);
  else if (askLastScroll(a)) askHoldScroll(host, askLastScroll(a));
  else if (askFollowBottom()) host.scrollTop = host.scrollHeight;
  askReportScrollJump(view, host, 'askRenderMessages');
  askEnsureLiveTicker();
  askTraceAutoLoad(chat);
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

function askRecordLiveTool(msg, data) {
  const tools = msg.liveTools || (msg.liveTools = []);
  const name = data.tool || 'tool';
  if (data.type === 'tool_call') {
    if (data.tool_call_id && tools.some(t => t.id === data.tool_call_id)) return;
    tools.push({ id: data.tool_call_id || '', name, detail: data.detail || '', status: 'running' });
    if (!msg.hasCycleTrace) (msg.liveTrajectory || (msg.liveTrajectory = [])).push({role:'assistant',tool_calls:[{id:data.tool_call_id,name,arguments:data.arguments || {detail:data.detail || ''}}]});
  } else {
    const tool = tools.find(t => data.tool_call_id ? t.id === data.tool_call_id : t.name === name && t.status === 'running');
    const result = tool || { id: data.tool_call_id || '', name };
    result.status = data.ok === false ? 'failed' : 'success';
    if (!result.detail && data.ok === false) result.detail = String(data.detail || '').slice(0,160);
    if (!tool) tools.push(result);
    (msg.liveTrajectory || (msg.liveTrajectory = [])).push({role:'tool',tool_name:name,tool_call_id:data.tool_call_id,status:data.ok === false ? 'error' : 'success',content:data.output || data.detail || ''});
  }
}

function askRecordTrajectory(msg, data) {
  msg.hasCycleTrace = true;
  const items=msg.liveTrajectory || (msg.liveTrajectory=[]);
  const item=data.item;
  if (item?.id) {
    const at=items.findIndex(x=>x.id===item.id);
    if (at<0) items.push(item); else items[at]=item;
  }
}

function askApplyEvent(msg, data, chatId) {
  if (data.type === 'trajectory_item' || data.type === 'trajectory_delta') {
    askRecordTrajectory(msg, data);
  }
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
  if (['start','process','trace','done','run_finished'].includes(data.type)) askSyncPlanDock(chatId);
  if (data.type === 'summary' && msg.execution) msg.execution.summary = data.text;
  if (data.type === 'tool_call') {
    askRecordLiveTool(msg, data);
    msg.live = { tool: data.tool || '', detail: data.detail || '', phase: 'running', time: Number(data.time) || Date.now() };
    if (msg._t0 == null) msg._t0 = Number(data.time) || Date.now();
  }
  if (data.type === 'tool_result') {
    askRecordLiveTool(msg, data);
    msg.live = { tool: data.tool || '', detail: data.detail || '', phase: data.ok === false ? 'failed' : 'done', time: Number(data.time) || Date.now() };
  }
  if (data.type === 'media' && Array.isArray(data.files)) {
    msg.media = msg.media || [];
    for (const file of data.files) {
      if (file && file.url && !msg.media.some((x) => x.url === file.url)) msg.media.push(file);
    }
  }
  if (['artifact','workspace_file'].includes(data.type) && data.file) {
    if (askState().capabilitiesOpen) window.AgentWorkspace?.refresh();
  }
  if (data.type === 'artifact' && data.file) {
    msg.execution = msg.execution || {};
    msg.execution.artifacts = msg.execution.artifacts || [];
    if (!msg.execution.artifacts.some((f) => f.id === data.file.id)) msg.execution.artifacts.push(data.file);
  }
  if (data.type === 'choice' && data.id) {
    msg.choices = msg.choices || [];
    if (!msg.choices.some((card) => card.id === data.id)) {
      const card = {
        id: String(data.id),
        questions: (Array.isArray(data.questions) && data.questions.length
          ? data.questions
          : [{ id: 'q1', question: data.question || '', options: data.options || [], multi: !!data.multi, allow_text: data.allow_text !== false }])
          .map((q, qi) => ({
            id: String(q.id || 'q' + (qi + 1)),
            question: String(q.question || ''),
            multi: !!q.multi,
            allow_text: q.allow_text !== false,
            options: (q.options || []).map((o, i) => ({
              id: String(o.id || 'q' + (qi + 1) + 'o' + (i + 1)),
              label: String(o.label || ''),
              why: String(o.why || ''),
              value: String(o.value || o.label || ''),
              skill_id: String(o.skill_id || ''),
              recommended: !!o.recommended,
            })),
          })),
        allow_text: data.allow_text !== false,
        auto_seconds: Number(data.auto_seconds) || 0,
        time: Number(data.time) || Date.now(),
      };
      msg.choices.push(card);
      // 有待回答的问题就把它抬到输入框上方（最新的问题覆盖上一张）
      const a = askState();
      a.choice = { messageId: msg.id || '', card, answers: {}, custom: {}, text: '', page: 0, closed: false };
      askChoiceRefresh();   // 首次没有面板节点时会整块重绘，把问句条挂上去
    }
  }
  if (data.type === 'supplement_received' && Array.isArray(data.items)) {
    msg.supplements = msg.supplements || [];
    for (const item of data.items) {
      const at = msg.supplements.findIndex((x) => x.id === item.id);
      const next = { id: item.id, text: item.text, time: item.time, state: 'received' };
      if (at >= 0) msg.supplements[at] = { ...msg.supplements[at], ...next };
      else msg.supplements.push(next);
    }
    askQueueMark(chatId, data.items.map((x) => x.id), 'received');
    askRenderSoon();
  }
  if (data.type === 'supplement' && Array.isArray(data.items)) {
    msg.supplements = msg.supplements || [];
    for (const item of data.items) {
      const at = msg.supplements.findIndex((x) => x.id === item.id);
      const next = { id: item.id, text: item.text, time: item.time, state: 'applied' };
      if (at >= 0) msg.supplements[at] = { ...msg.supplements[at], ...next };
      else msg.supplements.push(next);
    }
    // 已并入当前任务：从待发送队列抹掉，不会被当成新任务再发一遍
    askQueueAck(chatId, data.items.map((x) => x.id));
    askRenderSoon();
  }
  if (data.type === 'replace') msg.text = String(data.text || '');
  if (data.type === 'delta') msg.text = (msg.text || '') + String(data.text || '');
  // 模型正在组织回复（没有工具在跑）：状态行跟一句它正在写的内容，像实时字幕
  if ((data.type === 'delta' || data.type === 'replace') && (!msg.live || msg.live.phase !== 'running')) {
    const line = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(-60);
    msg.live = { tool: '', detail: line, phase: 'thinking', time: Date.now() };
    if (msg._t0 == null) msg._t0 = Date.now();
  }
  if (data.type === 'start' && data.execution) {
    const a = askState();
    const next = data.execution.tools_supported !== false;
    if (a.toolsSupported !== next) {
      a.toolsSupported = next;
      a.permWarn = next ? '' : '渠道不支持工具调用';
      askRenderAll();
    }
  }
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
    askSyncPlanDock(chatId);
    if (!msg.text && msg.error) msg.text = '⚠ ' + msg.error;
  }
}

async function askQueueReply(chat, question, insertAt, fileIds = [], resumeId = '', webSearch = !!askState().webSearch) {
  const a = askState();
  const controller = new AbortController();
  const requestId = askId();
  const run = { chatId: chat.id, requestId, controller, startedAt: Date.now(), msg: null };
  askRuns(a).set(chat.id, run);
  askSyncRunState();
  askRefreshHistoryFlags();
  if (a.activeId === chat.id) askRenderAll();   // 让输入区切到“排队 / 停止”状态
  const history = chat.messages.slice(0, insertAt === undefined ? chat.messages.length - 1 : insertAt).filter((m) => m.text);
  const msg = { id: askId(), role: 'assistant', text: '', time: Date.now(), skill: askSkillName(a.skillId), _streaming: true };
  run.msg = msg;
  if (insertAt === undefined) chat.messages.push(msg);
  else chat.messages.splice(insertAt, 0, msg);
  chat.updated = Date.now();
  if (a.activeId === chat.id) askRenderMessages();
  let runId = '';
  let lastSeq = 0;
  const applyEvent = (data) => {
    if (typeof data.sequence === 'number') {
      if (data.sequence <= lastSeq) return;
      lastSeq = data.sequence;
    }
    askApplyEvent(msg, data, chat.id);
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
        web_search: !!webSearch,

        permission: a.permission || ASK_PERM_DEFAULT,
      }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      runId = (error.detail && error.detail.run_id) || '';
      throw new Error(typeof error.detail === 'string' ? error.detail : (error.detail && error.detail.message) || '模型连接失败');
    }
    runId = res.headers.get('X-Agent-Run-Id') || '';
    if (runId) {
      run.runId = runId;
      msg._runId = runId;
      if (a.activeId === chat.id) askSyncRunState();
    }
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
        if (a.activeId === chat.id) {
          if (data.type === 'delta' || data.type === 'replace') askRevealKick();
          else askRenderSoon();
        }
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
    const runs = askRuns(a);
    if (runs.get(chat.id) === run) runs.delete(chat.id);
    msg._reveal = null;
    msg._acc = 0;
    msg._revealAt = 0;
    if (a.activeId === chat.id) askSyncRunState();
    chat.updated = Date.now();
    if (askRenderTimer) { clearTimeout(askRenderTimer); askRenderTimer = null; }
    if (askRevealRaf) { cancelAnimationFrame(askRevealRaf); askRevealRaf = 0; }
    if (a.activeId === chat.id) askRenderMessages();
    askUpdateContextMeter();
    askRefreshHistoryFlags();
    askPersist();
    // 跑完把这次运行的执行过程补上（有计划的走计划视图，不需要）
    if (msg.execution && msg.execution.id && !(msg.execution.plan && (msg.execution.plan.steps || []).length)) {
      setTimeout(() => { askLoadMessageTrace(msg, '', chat.id).catch(() => {}); }, 30);
    }
    // 补充说明核对：已并入当前任务的移出队列，没赶上检查点的退回普通排队继续发
    try { await askQueueSettle(chat.id, runId); } catch { /* ignore */ }
    // 队列只发下一条
    askDrainQueue(chat.id);
  }
}

async function askSend(text, chatId, webSearch = !!askState().webSearch) {
  const a = askState();
  const target = (chatId && (a.conversations || []).find((c) => c.id === chatId)) || askActive();
  let raw = String(text === undefined ? a.draft : text).trim();
  const originalRaw = raw;
  const cmd = raw.match(/^\/(model|think|compact)$/);
  if (cmd) { askChooseCommand(cmd[1]); return; }
  if (!raw) return;
  if (!target) { askNewConversation(); }
  const chat = target || askActive();
  if (!chat) return;
  // 用户直接在主输入框里说了别的：问句条视为跳过，别两条线并行
  if (a.choice && !a.choice.closed) {
    const stale = (chat.messages || []).find((m) => m.id === a.choice.messageId);
    if (stale) stale.choiceSkipped = a.choice.card.id;
    a.choice.closed = true;
  }
  // 这一轮还在生成：先排队，结束后依次发送，不会丢
  if (askRunOf(chat.id)) {
    askEnqueue(raw, chat.id, webSearch);
    return;
  }
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
  a.pinBottom = true; // 发新消息时重新跟随到底部
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
  askQueueReply(chat, raw, undefined, attached.map((f) => f.id), '', webSearch);
}

// 输入框「直发」：有任务在跑就作为补充说明并进当前任务；没有任务时照旧开新一轮
async function askSendDirect() {
  const a = askState();
  const chatId = a.activeId;
  const text = String(a.draft || '').trim();
  if (!chatId || !text) return;
  if (!askRunOf(chatId)) { await askSend(text, chatId); return; }
  const res = await askSupplementSend(text, chatId);
  if (!res.ok) {
    if (res.code === 'no_active_run') { await askSend(text, chatId); return; }
    toast(res.message || '补充说明未送达，请稍后重试', true);
    return;
  }
  // 记进本地队列：没赶上检查点也能在收尾时退回普通发送，不会丢
  const list = askLoadQueue(chatId);
  list.push({ id: askId(), text, time: Date.now(), sup: { id: res.id, runId: res.runId, state: 'queued', position: res.position } });
  askSaveQueue(chatId);
  a.draft = '';
  const input = $('#ask-input');
  if (input) input.value = '';
  askRenderPopups();
  askRenderAll();
  toast('已作为补充说明发给当前任务（第 ' + res.position + ' 条），下个检查点生效，任务不中断');
  if ((a.attachments || []).length) toast('直发只带文字，附件仍留在输入框里', true);
}

async function askStop() {
  const a = askState();
  const request = a.request;
  if (!request || request.stopping) return;
  request.stopping = true;
  try {
    if (request.runId) {
      const res = await fetch('/api/agent/runs/' + encodeURIComponent(request.runId) + '/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
        body: '{}', signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error('后端尚未确认停止，请稍后重试');
      toast('已请求停止，正在等待后端结束');
      return;
    }
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
  const cmd = askCommandList().find((c) => c.name === id);
  const kind = cmd ? cmd.kind : 'action';
  const arg = cmd ? cmd.arg : id;
  if (kind === 'popup') { a.command = { mode: arg, query: null, index: 0 }; askRenderAll(); return; }
  if (arg === 'help') { a.draft = '/'; a.command = { mode: null, query: '', index: 0 }; askRenderAll(); return; }
  if (arg !== 'compact') { toast('命令 /' + id + ' 还没有实现', true); return; }
  if (!a.activeId) return;
  // 不弹确认：压缩是可恢复的（历史原文仍在，只多一张摘要卡片），而且结果立刻可见。
  // 浏览器原生 confirm 只留给删任务/删项目这类不可恢复操作。
  try {
    a.generating = true;
    const res = await askApi('/sessions/' + encodeURIComponent(a.activeId) + '/compact', {
      method: 'POST',
      body: JSON.stringify({ model_id: a.modelId || undefined, reasoning_effort: a.effort || undefined }),
    });
    const result = await res.json();
    const card = result && result.message;
    if (card) {
      const chat = askActive();
      if (chat) { if (!Array.isArray(chat.messages)) chat.messages = []; chat.messages.push(card); }
      a.scrollIntent = 'bottom';
    }
    toast('上下文已压缩 · ' + (result.messages || 0) + ' 条历史记录');
  } catch {
    toast('压缩失败，原上下文保留', true);
  } finally {
    a.generating = false;
    askRenderMessages();
  }
}

function askClosePopups() {
  const a = askState();
  // 记住是哪个 @ 被关掉的：同一个位置 + 同一段查询不再自动弹回来。
  if (a.mention) a.mentionClosed = { start: a.mention.start, query: a.mention.query };
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
  // 空过滤不预选第一项：用户可能只是想看看有哪些命令，此时按回车不该执行 /model。
  // 输到 /c 这种有意图的过滤词才高亮匹配项。
  a.command = { mode: null, query: cmd ? cmd[1] : null,
                index: cmd && cmd[1] ? 0 : -1 };
  const prefix = input.value.slice(0, end);
  // @"带 空格的路径" 优先匹配；普通 @token 到空白就停。
  const quoted = prefix.match(/(?:^|\s)@"([^"]*)$/);
  const match = quoted || prefix.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match || input.selectionStart !== input.selectionEnd) { a.mention = null; return; }
  const query = match[1] || '';
  const start = end - query.length - (quoted ? 2 : 1);
  // 关掉就保持关闭：同一个 @ 位置 + 同一段查询不再自动弹回来，改查询或换位置才重新武装。
  const closed = a.mentionClosed;
  if (closed && closed.start === start && closed.query === query) { a.mention = null; return; }
  a.mentionClosed = null;
  const firstOpen = !a.mention;
  if (!a.mention || a.mention.query !== query) {
    a.mention = { start, end, query, index: 0, quoted: Boolean(quoted) };
  } else {
    a.mention.start = start; a.mention.end = end; a.mention.query = query;
  }
  // 第一次打开 @ 时把项目文件拉进来（技能是本地数据，文件要走接口）
  if (firstOpen && !a.wsFiles) {
    askLoadWorkspaceFiles().then(() => { if (askState().mention) askRenderPopups(); }).catch(() => {});
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
  a.mentionClosed = null;
  askRenderPopups();
  const chip = document.querySelector('.ask-skill-context');
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

function askChooseFile(path) {
  const a = askState();
  const range = a.mention;
  if (!range) return;
  // 路径里有空白就必须加引号，否则 @ 会在空格处断掉，后端只能看到一个残缺路径。
  const token = '@' + (/\s/.test(path) ? '"' + path + '"' : path) + ' ';
  const input = $('#ask-input');
  const value = input ? input.value : a.draft;
  a.draft = value.slice(0, range.start) + token + value.slice(range.end);
  a.mention = null;
  askRenderPopups();
  const el = $('#ask-input');
  if (el) {
    el.value = a.draft;
    el.focus();
    el.setSelectionRange(range.start + token.length, range.start + token.length);
    const c = $('.ask-draft-count'); if (c) c.textContent = a.draft.length + '/3000';
    const send = $('[data-act="ask-send"]'); if (send) send.disabled = !a.draft.trim();
  }
}

/** 点工具栏的 @ / / 按钮：在光标处补一个触发符，直接打开对应弹层 */

function askAttachStatusText(file) {
  const status = (file && file.status) || '';
  const image = /\.(png|jpe?g|webp|gif|bmp)$/i.test((file && file.name) || '');
  const labels = {
    indexed: image ? '已识别' : '已索引',
    pending_recognition: '识别中…',
    recognition_failed: '识别失败',
    pending_transcription: '转写中…',
    pending_video_analysis: '解析中…',
    parse_failed: '解析失败',
    needs_ocr: '需 OCR',
    empty: '内容为空',
  };
  return labels[status] || '待处理';
}

async function askUploadFile(file, chatId) {  const form = new FormData();
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
      if (saved.status === 'pending_recognition') toast(file.name + ' 已上传，正在识别画面…');
      else toast(saved.status === 'indexed' ? file.name + ' 已保存并建立索引' : file.name + '：' + (saved.status || '待处理'));
      if (saved.status === 'pending_recognition' || saved.status === 'pending_transcription') askWatchAttachmentStatus(saved.id);
    } catch (err) {
      toast(err.message, true);
    }
  }
  askRenderAll();
}

// 图片上传后异步识别：轮询状态，识别完成就更新成“已识别”，模型这时就能看到画面
async function askWatchAttachmentStatus(fileId) {
  for (let i = 0; i < 90; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    let info = null;
    try {
      info = await askApi('/workspace/files/' + encodeURIComponent(fileId)).then((r) => r.json());
    } catch {
      return;
    }
    const a = askState();
    const item = (a.attachments || []).find((f) => f.id === fileId);
    if (!info) return;
    if (item) { item.status = info.status; item.error = info.error || ''; }
    if (info.status === 'indexed') {
      toast('图片已识别，模型现在可以看到画面内容');
      askRenderAll();
      return;
    }
    if (info.status !== 'pending_recognition' && info.status !== 'pending_transcription') {
      toast('识别失败：' + (info.error || info.status), true);
      askRenderAll();
      return;
    }
  }
}

async function askPreviewFile(id, sheet = 0, force = false) {
  const a=askState();
  const files=[];
  for(const c of a.conversations||[])for(const m of c.messages||[]){files.push(...(m.files||[]),...(m.execution?.artifacts||[]));}
  const file=files.find(f=>f.id===id)||window.AgentWorkspace?.file(id)||{id,name:'文件'};
  askOpenWorkspace();
  AgentWorkspace.html(askWorkspaceContext());
  return AgentWorkspace.openFile(id,file,sheet,force);
}
async function askExportChat() {
  const chat = askActive();
  if (!chat) return;
  const text = '# ' + chat.title + '\n\n' + chat.messages.map((m) => `## ${m.role === 'user' ? '你' : '创作助手'}\n\n` + (m.execution ? `### 执行记录\n\n- 运行编号：${m.execution.id || ''}\n- 模型：${m.execution.model || ''}\n- 状态：${m.execution.status || ''}\n` + (m.execution.plan ? m.execution.plan.steps.map((s) => `- ${s.title} [${s.status}]：${s.output || s.purpose || ''}`).join('\n') : '') + '\n\n' : '') + m.text + `\n\n时间：${askTimeText(m.time)}`).join('\n\n');
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
  if (!a.commands) { a.commands = []; askLoadCommands().then(() => { if (state.route === 'script') askRenderAll(); }); }

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
    input.oninput = () => { a.draft = input.value; askUpdateMention(); const c = $('.ask-draft-count'); if (c) c.textContent = a.draft.length + '/3000'; const send = $('[data-act="ask-send"]'); if (send) send.disabled = !a.draft.trim(); askRenderPopups(); askUpdateContextMeter(); };    input.onkeyup = (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) askUpdateMention(); };
    input.onkeydown = (event) => {
      if (event.isComposing) return;
      const cmdOpen = a.command.mode !== null || a.command.query !== null;
      const mentionOpen = !!a.mention;
      if (cmdOpen) {
        if (event.key === 'Escape') { event.preventDefault(); askClosePopups(); askRenderPopups(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const items = askCommandItems(); if (items.length) { const step = event.key === 'ArrowDown' ? 1 : -1; a.command.index = a.command.index < 0 ? (step > 0 ? 0 : items.length - 1) : (a.command.index + step + items.length) % items.length; askRenderPopups(); } return; }
        if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
          event.preventDefault();
          const item = askCommandItems()[a.command.index];
          if (item) askChooseCommand(item.id);
          return;
        }
      }
      if (mentionOpen) {
        if (event.key === 'Escape') { event.preventDefault(); if (a.mention) a.mentionClosed = { start: a.mention.start, query: a.mention.query }; a.mention = null; askRenderPopups(); return; }
        if (event.key === ' ' && !event.shiftKey) {
          // 空格仲裁：有候选就选定，没候选就让空格正常输入，不吃键。
          const list = askMentionItems();
          if (list.length) { event.preventDefault(); askChooseMentionItem(list[a.mention.index] || list[0]); return; }
          a.mentionClosed = { start: a.mention.start, query: a.mention.query };
          a.mention = null; askRenderPopups();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const list = askMentionItems(); if (list.length) { a.mention.index = (a.mention.index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length; askRenderPopups(); } return; }
        if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) { event.preventDefault(); const item = askMentionItems()[a.mention.index]; if (item) askChooseMentionItem(item); return; }
      }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); askSend(); }
    };
    if (!a.draft) input.focus();
  }

  // 问句条里的「自行撰写」：边输边存，不整块重绘，避免丢焦点
  askChoiceBindInput();

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

  if (a._askClick) root.removeEventListener('click', a._askClick);
  const askClick = async (event) => {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if(act!=='ask-head-menu')a.headerMenu=false;
    try {
      if (act === 'ask-queue-cancel') {
        const list = askLoadQueue(a.activeId);
        const id = btn.dataset.id;
        const at = list.findIndex((x) => x.id === id);
        if (at < 0) return;
        const [removed] = list.splice(at, 1);
        askSaveQueue(a.activeId);
        askRenderAll();
        toast('已取消队列里的这条：' + String(removed.text || '').slice(0, 16));
        return;
      }
      if (act === 'ask-queue-now') {
        const chatId = a.activeId;
        const list = askLoadQueue(chatId);
        if (!list.length) return;
        const item = list.find((x) => x.id === btn.dataset.id) || list[0];
        const idx = list.findIndex((x) => x.id === item.id);
        if (askRunOf(chatId)) {
          // 直发：交给正在执行的这条任务当补充说明，不中断、不重启
          const res = await askSupplementSend(item.text, chatId);
          if (res.ok) {
            item.sup = { id: res.id, runId: res.runId, state: 'queued', position: res.position };
            askSaveQueue(chatId);
            askRenderAll();
            toast('已作为补充说明发给当前任务（第 ' + res.position + ' 条），下个检查点生效，任务不中断');
            return;
          }
          if (res.code !== 'no_active_run') { toast(res.message || '补充说明未送达，请稍后重试', true); return; }
          // 任务刚好结束：退回普通发送
        }
        if (idx >= 0) list.splice(idx, 1);
        askSaveQueue(chatId);
        askRenderAll();
        await askSend(item.text, chatId, !!item.webSearch);
        return;
      }
      if (act === 'ask-send-direct') { await askSendDirect(); return; }
      if (act === 'ask-trace-row-toggle') {
        event.preventDefault();
        const run = btn.closest('[data-trace-run]')?.dataset.traceRun;
        const target = askActive()?.messages?.find(m => m.execution?.id === run);
        if (!target) return;
        const opened = target.traceRowsOpen || (target.traceRowsOpen = {});
        opened[btn.dataset.row] = !opened[btn.dataset.row];
        btn.closest('details').open = opened[btn.dataset.row];
        return;
      }
      if (act === 'ask-trace-section-toggle') {
        event.preventDefault();
        const run = btn.closest('[data-trace-run]')?.dataset.traceRun;
        const target = askActive()?.messages?.find(m => m.execution?.id === run);
        if (!target) return;
        const key = btn.dataset.section === 'plan' ? 'planSectionOpen' : 'traceSectionOpen';
        target[key] = !target[key];
        return askRenderMessages();
      }
      if (act === 'ask-trace-toggle') {
        const run = btn.dataset.run || '';
        const chat = askActive();
        const target = chat && (chat.messages || []).find((m) => m.execution && m.execution.id === run);
        if (!target) return;
        target.traceOpen = !target.traceOpen;
        // 展开就等于要看：轨迹由 askTraceAutoLoad 自动拉，不用再点一次
        return askRenderMessages();
      }
      if (act === 'ask-load-trace') {
        const chat = askActive();
        const run = btn.dataset.run || '';
        const target = chat && (chat.messages || []).find((m) => m.execution && m.execution.id === run);
        if (target) await askLoadMessageTrace(target, run);
        return;
      }
      if (act === 'ask-skill-install') {
        a.installSkill = { name: '', description: '', content: '', saving: false, error: '' };
        return askRenderAll();
      }
      if (act === 'ask-install-cancel') { a.installSkill = null; return askRenderAll(); }
      if (act === 'ask-install-save') return askSaveInstallSkill();
      if (act === 'ask-install-file') { const input = $('#ask-install-file'); if (input) input.click(); return; }
      if (act === 'ask-delete-turn') {
        const chat = askActive();
        if (!chat) return;
        const index = Number(btn.dataset.index);
        const msg = chat.messages[index];
        if (!msg || msg.role !== 'user') return;
        if (a.generating && index >= chat.messages.length - 2) { toast('这一轮还在生成，先停止再删除', true); return; }
        if (!confirm('删除这一轮？问题和它的回复会一起删掉。')) return;
        const span = askTurnSpan(chat.messages, index);
        if (!span) return;
        const before = chat.messages.length;
        const host0 = $('#ask-messages');
        const view0 = host0 ? askCaptureScroll(host0) : null;
        const removed = chat.messages.splice(span.start, span.count);
        chat.updated = Date.now();
        // 删掉的是末尾这一轮 → 内容变短，视口不该因为新容器 scrollTop=0 被甩回第一轮：
        // 本来就贴底、或正看着这条将被删掉的消息时，落到新的末尾（也就是“返回上一轮”）；
        // 其余情况保留原来的位置。
        const atEnd = span.end >= before;
        const stillThere = view0 && view0.id ? chat.messages.some((m) => m.id === view0.id) : true;
        const bottom = chat.messages.length === 0 || (view0 ? view0.atBottom : false) || (atEnd && !stillThere);
        a.pinBottom = bottom;
        if (bottom) a.scrollIntent = 'bottom';
        askRenderAll();
        askPersist();
        toast('已删除这一轮（' + removed.length + ' 条消息）');
        return;
      }
      if (act === 'ask-jump') {
        const host = $('#ask-messages');
        const node = host && host.querySelector('.ask-message[data-msg-index="' + btn.dataset.index + '"]');
        askJumpToTurn(host, node);
        return;
      }
      if (act === 'gu-pick') {
        const card = btn.closest('[data-gu-msg]');
        const record = card && askGenUiMemory.get(card.dataset.guMsg);
        if (!record) return;
        const key = btn.dataset.guKey || '';
        const value = btn.dataset.guValue || '';
        if (btn.dataset.guMulti === '1') {
          const list = Array.isArray(record.values[key]) ? [...record.values[key]] : [];
          const at = list.indexOf(value);
          if (at >= 0) list.splice(at, 1); else list.push(value);
          record.values[key] = list;
        } else {
          record.values[key] = value;
        }
        const group = btn.closest('.gu-options');
        if (group) {
          for (const option of group.querySelectorAll('.gu-option')) {
            const on = btn.dataset.guMulti === '1'
              ? (Array.isArray(record.values[key]) && record.values[key].includes(option.dataset.guValue))
              : option.dataset.guValue === record.values[key];
            option.classList.toggle('is-on', on);
            option.setAttribute('aria-pressed', on ? 'true' : 'false');
          }
        }
        return;
      }
      if (act === 'gu-copy') {
        const card = btn.closest('[data-gu-msg]');
        const record = card && askGenUiMemory.get(card.dataset.guMsg);
        const text = guEvalExpr(btn.dataset.guExpr || '', (record && record.values) || {}).trim();
        if (!text) { toast('这段内容还没生成好', true); return; }
        await navigator.clipboard.writeText(text);
        toast('已复制');
        return;
      }
      if (act === 'gu-copy-text') {
        const text = btn.dataset.guText || '';
        if (!text) return;
        await navigator.clipboard.writeText(text);
        toast('已复制提示词');
        return;
      }
      if (act === 'ask-plan-toggle') {
        const msg = [...(askActive()?.messages || [])].reverse().find(m => m.role === 'assistant');
        if (msg) msg.planCollapsed = msg.planCollapsed === false;
        askSyncPlanDock();
        return;
      }
      if (act === 'ask-toggle-web') {
        a.webSearch = !a.webSearch;
        try { localStorage.setItem('wmd.askWebSearch', a.webSearch ? '1' : '0'); } catch {}
        toast(a.webSearch ? '已开启联网检索，对下次发送生效' : '已关闭联网检索，对下次发送生效');
        return askRenderAll();
      }
      if (act === 'ask-toggle-refs') {
        a.refImages = !a.refImages;
        try { localStorage.setItem('wmd.askRefImages', a.refImages ? '1' : '0'); } catch { /* 记不住也不影响当前会话 */ }
        if (!a.refImages) guRefStop();
        toast(a.refImages ? '已开启参考出图' : '已关闭参考出图，不再调用图像渠道');
        return askRenderAll();
      }
      if (act === 'ask-ref-now') {
        guGenerateRef(btn.dataset.guPrompt || '', { force: true });
        return;
      }
      if (act === 'gu-ref-download') {
        const url = btn.dataset.url || '';
        if (!url) return;
        const link = document.createElement('a');
        link.href = url + (url.includes('?') ? '&' : '?') + 'download=1';
        link.download = '参考图.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }
      if (act === 'gu-ref-retry') {
        guGenerateRef(btn.dataset.guPrompt || '');
        return;
      }
      if (act === 'gu-run') {
        if (a.generating) { toast('上一条回复还在生成，稍等一下', true); return; }
        const card = btn.closest('[data-gu-msg]');
        const record = card && askGenUiMemory.get(card.dataset.guMsg);
        const text = guEvalExpr(btn.dataset.guExpr || '', (record && record.values) || {}).trim();
        if (!text) { toast('这个动作还没有取值，先选一下上面的选项', true); return; }
        return askSend(text);
      }
      if (act === 'ask-project-picker') return askOpenProjectPicker();
      if (act === 'ask-head-menu') {a.headerMenu=!a.headerMenu;a.summaryOpen=false;return askRenderAll();}
      if (act === 'ask-summary') {a.summaryOpen=!a.summaryOpen;askRenderAll();if(a.summaryOpen)askLoadSummaryFiles();return;}
      if (act === 'ask-new-workspace') {
        askOpenWorkspace();AgentWorkspace.html(askWorkspaceContext());return AgentWorkspace.newTab();
      }
      if (act === 'ask-copy-conversation') {
        const chat=askActive();await navigator.clipboard.writeText((chat?.messages||[]).map(m=>(m.role==='user'?'用户':'助手')+'：'+m.text).join('\n\n'));
        toast('已复制对话文本');return askRenderAll();
      }
      if (act === 'ask-new') return askNewConversation();
      if (act === 'ask-clear-skill') { a.skillId = ''; return askRenderAll(); }
      if (act === 'ask-folder-toggle') {
        a.collapsedFolders = { ...(a.collapsedFolders || {}), [btn.dataset.id]: !a.collapsedFolders?.[btn.dataset.id] };
        return askRenderAll();
      }
      if (act === 'ask-project-new-chat') return askNewChatInProject(btn.dataset.id);
      if (act === 'ask-open') { a.moreMenu = null; return askOpenProjectConversation(btn.dataset.project, btn.dataset.id); }
      if (act === 'ask-more') { a.moreMenu = a.moreMenu === btn.dataset.id ? null : btn.dataset.id; return askRenderAll(); }
      if (act === 'ask-more-close') { if (!event.target.closest('.ask-more-menu')) { a.moreMenu = null; askRenderAll(); } return; }
      if (act === 'ask-pin') {
        const c = askFindConversation(btn.dataset.id);
        if (c) c.pinned = !c.pinned;
        a.moreMenu = null; askPersist(); return askRenderAll();
      }
      if (act === 'ask-rename') {
        const c = askFindConversation(btn.dataset.id);
        if (!c) { askForgetConversation(btn.dataset.id); return askRenderAll(); }
        a.rename = { open: true, id: c.id, text: c.title };
        a.moreMenu = null; return askRenderAll();
      }
      if (act === 'ask-rename-cancel') { a.rename = { open: false, id: '', text: '' }; return askRenderAll(); }
      if (act === 'ask-rename-save') return askSaveRename();
      if (act === 'ask-delete') {
        const id = btn.dataset.id;
        const c = askFindConversation(id);
        if (!c) { askForgetConversation(id); return askRenderAll(); }
        const ownerId = askConversationProject(id);
        if (id === a.activeId) askStop();
        let failure = null;
        try {
          await askApi('/sessions/' + encodeURIComponent(id), {
            method: 'DELETE',
            headers: ownerId && ownerId !== askProjectId() ? { 'X-Project-Id': ownerId } : {},
          });
        } catch (err) {
          const gone = err && (err.status === 404 || /不存在|not found/i.test(String(err.message || '')));
          if (!gone) failure = err;
        }
        a.removed = c;
        askForgetConversation(id);
        // 删对话时连它的待发送队列一起清掉
        try { localStorage.removeItem(askQueueKey(id)); } catch { /* ignore */ }
        if (a.queues) delete a.queues[id];
        if (a.activeId === id) {
          a.activeId = (a.conversations[0] && a.conversations[0].id) || '';
          if (!a.activeId) askNewConversation();
        }
        if (failure) toast('删除会话失败：' + (failure.message || '未知错误'), true);
        askRenderAll();
        askLoadProjectHistory().catch(() => {});
        return;
      }
      if (act === 'ask-undo') {
        if (!a.removed) return askRenderAll();
        const back = a.removed;
        a.removed = null;
        if (state.route === 'script') askRenderAll();
        // 撤销要真的把会话写回去，否则刷新页面又没了
        await askApi('/sessions/' + encodeURIComponent(back.id), { method: 'PUT', body: JSON.stringify(back) })
          .catch((err) => toast('撤销失败：' + (err.message || '未知错误'), true));
        a.conversations = [back, ...(a.conversations || []).filter((x) => x.id !== back.id)];
        a.activeId = back.id;
        askSyncCurrentRowItems();
        askPersist();
        askRenderAll();
        askLoadProjectHistory().catch(() => {});
        return;
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
        try { localStorage.setItem('wmd.askHistoryOpen', a.historyOpen ? '1' : '0'); } catch { /* ignore */ }
        // History and workspace remain independently toggleable.
        return askRenderAll();
      }
      if (act === 'ask-files-pick') {
        const chat=askActive(),project=askProjectId();
        if(!chat)return toast('请先新建对话',true);
        return openLibraryPicker({title:'引用项目素材（保留原位置）',onPick:async item=>{
          if(project!==askProjectId()||chat.id!==askState().activeId)throw Error('当前项目或对话已切换，请重新选择');
          await askApi('/sessions/'+encodeURIComponent(chat.id),{method:'PUT',body:JSON.stringify(chat)});
          const saved=await askApi('/workspace/register',{method:'POST',body:JSON.stringify({session_id:chat.id,path:item.path,origin:'input'})}).then(r=>r.json());
          a.attachments=a.attachments||[];
          if(!a.attachments.some(f=>f.id===saved.id))a.attachments.push(saved);
          closeModal();a.panelTab='input';askRenderAll();
        }});
      }
      if (act === 'ask-files-refresh') return window.AgentWorkspace?.refresh();
      if (act === 'ask-files-page') return window.AgentWorkspace?.page(Number(btn.dataset.page));
      if (act === 'ask-file-path') {
        const file = window.AgentWorkspace?.file(btn.dataset.id);
        if (file?.path) { try { await navigator.clipboard.writeText(file.path); toast('已复制路径'); } catch { toast('复制失败，请使用文件预览中的路径',true); } }
        return;
      }
      if (act === 'ask-file-versions') {
        try {
          const rows = await askApi('/workspace/files/'+encodeURIComponent(btn.dataset.id)+'/versions').then(r=>r.json());
          openModal('<div class="modal-head"><h2>文件历史版本</h2><button class="btn" data-close="1">关闭</button></div><div class="modal-body">' + (rows.length ? rows.map(row=>`<p>v${row.version} · ${esc(row.relativePath)} <a href="/api/agent/workspace/files/${encodeURIComponent(btn.dataset.id)}/versions/${row.version}" download>下载</a></p>`).join('') : '<p>暂无历史版本</p>')+'</div>');
        } catch(err) { toast(err.message,true); }
        return;
      }
      if (act === 'ask-file-source') {
        const chat=askActive();
        const index=(chat?.messages||[]).findIndex(m=>(m.files||[]).some(f=>f.id===btn.dataset.id)||(m.execution?.artifacts||[]).some(f=>f.id===btn.dataset.id));
        if(index>=0) { const host=$('#ask-messages'); askJumpToTurn(host,host?.querySelector('.ask-message[data-msg-index="'+index+'"]')); }
        else toast('当前对话中的工作文件，尚未作为消息交付');
        return;
      }
      if (act === 'ask-toggle-cap') { a.capabilitiesOpen = !a.capabilitiesOpen; a.previewFile = null; a.previewData = null; a.mediaPreview = null; a.previewExpanded = false; if (a.capabilitiesOpen && a.panelTab === 'trajectory') askLoadTrajectory(); return askRenderAll(); }
      if (act === 'ask-close-cap') { return askCloseWorkspace(); }
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
      if (act === 'ask-mention') return btn.dataset.kind === 'file' ? askChooseFile(btn.dataset.id) : askChooseMention(btn.dataset.id || btn.dataset.skill);
      if (act === 'ask-permission') { a.permMenu = !a.permMenu; askRenderPopups(); return; }
      if (act === 'ask-perm') {
        askPermissionSet(btn.dataset.id);
        a.permMenu = false;
        askRenderAll();
        return toast('权限已切到「' + askPermission(btn.dataset.id).label + '」');
      }
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
      if (act === 'ask-choice-pick') return askChoicePick(btn.dataset.question, btn.dataset.option);
      if (act === 'ask-choice-page') return askChoicePage(Number(btn.dataset.delta) || 1);
      if (act === 'ask-choice-send') return askChoiceSend();
      if (act === 'ask-choice-skip') return askChoiceSkip();
      if (act === 'ask-choice-type') {
        const input = $('#ask-choice-input');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
        return;
      }
      if (act === 'ask-quick') {
        const value = btn.dataset.value;
        if (!value) { const input = $('#ask-input'); if (input) input.focus(); return; }
        return askSend(value);
      }
      if (act === 'ask-copy') {
        const msg = (askActive() && askActive().messages || [])[Number(btn.dataset.index)];
        if (msg) { await navigator.clipboard.writeText(guPlainText(msg.text || '')); toast('已复制回复'); }
        return;
      }
      if (act === 'ask-paste') {
        const msg = (askActive() && askActive().messages || [])[Number(btn.dataset.index)];
        if (!msg) return;
        const clean = guPlainText(msg.text || '');
        if (clean.length > 3000) { toast('回复超过 3000 字，请复制后挑选', true); return; }
        a.draft = clean;
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
        return askPreviewFile(a.previewFile && a.previewFile.id, a.previewSheet || 0,true);
      }
      if (act === 'ask-open-inline') {
        const url = btn.dataset.url || '';
        if (!url) return;
        askOpenWorkspace();AgentWorkspace.html(askWorkspaceContext());
        return AgentWorkspace.openMedia({url,name:btn.dataset.label||'图片',kind:'image'});
        a.previewFile = null;
        a.previewExpanded = false;
        return askRenderAll();
      }
      if (act === 'ask-open-media') {
        const chat = askActive();
        const msg = chat && chat.messages[Number(btn.dataset.index)];
        const file = msg && msg.media && msg.media[Number(btn.dataset.media)];
        if (!file) return;
        a.capabilitiesOpen=true;AgentWorkspace.html(askWorkspaceContext());return AgentWorkspace.openMedia(file);
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
      if (act === 'ask-copy-file-content') {
        if (!btn.dataset.id || btn.disabled) return;
        btn.disabled = true;
        try {
          const response = await askApi('/workspace/files/' + encodeURIComponent(btn.dataset.id) + '/raw');
          if (!response.ok) throw new Error('读取文件失败');
          await navigator.clipboard.writeText(await response.text());
          toast('已复制文件完整内容');
        } catch (err) { toast(err.message || '复制失败', true); }
        finally { btn.disabled = false; }
        return;
      }
      if (act === 'ask-reveal-pane') {
        const id = btn.dataset.id;
        if (!id) return;
        askApi('/workspace/files/' + encodeURIComponent(id) + '/reveal', { method: 'POST' })
          .then((r) => r.json())
          .then((data) => toast('已打开所在文件夹：' + (data.folder || data.path || '')))
          .catch((err) => toast(err.message || '打开所在文件夹失败', true));
        return;
      }
      if (act === 'ask-close-pane') {
        if(a.capabilitiesOpen && window.AgentWorkspace)return AgentWorkspace.closeCurrent();
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
        if (a.workspacePage !== 'knowledge') await askLoadSkills();
        return askLoadManage();
      }
    } catch (err) {
      toast(err.message, true);
    }
  };
  a._askClick = askClick;
  root.addEventListener('click', askClick);

  // 展开“执行过程”时才去拉这次运行的轨迹（历史消息按需加载）
  if (!root._traceToggle) {
    root._traceToggle = true;
  }

  // 交互卡片里的输入框：只记状态，不触发整段重绘
  if (a._askGuInput) root.removeEventListener('input', a._askGuInput);
  a._askGuInput = (event) => {
    const field = event.target.closest('[data-gu-key]');
    if (!field || !/^(INPUT|TEXTAREA|SELECT)$/.test(field.tagName)) return;
    const card = field.closest('[data-gu-msg]');
    const record = card && askGenUiMemory.get(card.dataset.guMsg);
    if (record) record.values[field.dataset.guKey] = field.value;
  };
  root.addEventListener('input', a._askGuInput);

  // 消息里的图片加载失败时退化成一行说明，而不是留个破图标
  if (a._askImgError) root.removeEventListener('error', a._askImgError, true);
  a._askImgError = (event) => {
    const img = event.target;
    if (!img || img.tagName !== 'IMG' || !img.classList || !img.classList.contains('ask-inline-img')) return;
    const holder = img.closest('.ask-inline-media');
    if (holder) holder.classList.add('is-broken');
  };
  root.addEventListener('error', a._askImgError, true);

  // 点到 @ 候选框和输入框以外的地方，就收起候选框
  if (a._askOutside) document.removeEventListener('pointerdown', a._askOutside, true);  a._askOutside = (event) => {
    const a2 = askState();
    const open = !!a2.mention || a2.command.mode !== null || a2.command.query !== null || !!a2.permMenu;
    if (!open) return;
    const target = event.target;
    if (!target || !target.closest) return;
    if (target.closest('#ask-popups')) return;
    if (target.closest('#ask-input')) return;
    if (target.closest('[data-act="ask-skill-picker"]')) return;
    if (target.closest('[data-act="ask-cmd"]')) return;
    if (target.closest('[data-act="ask-permission"]')) return;
    a2.mention = null;
    a2.command = { mode: null, query: null, index: 0 };
    a2.permMenu = false;
    askRenderPopups();
  };
  document.addEventListener('pointerdown', a._askOutside, true);

  const installFileInput = $('#ask-install-file');
  if (installFileInput) {
    installFileInput.onchange = () => {
      const file = (installFileInput.files || [])[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const d = askState().installSkill;
        if (!d) return;
        d.content = String(reader.result || '');
        if (!d.name) d.name = file.name.replace(/\.(md|markdown|txt)$/i, '');
        askRenderAll();
      };
      reader.readAsText(file);
    };
  }

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
      try { if (a.previewWidth) localStorage.setItem('wmd.previewWidth', String(a.previewWidth)); else localStorage.removeItem('wmd.previewWidth'); } catch { /* ignore */ }
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
  const c = askFindConversation(a.rename.id);
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

  openModal(`<div class="modal-head"><h2>${title}</h2><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button></div>
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
          <div class="field"><label>技能压缩包（.zip）</label>
            <input type="file" id="ask-bundle-zip" class="input" accept=".zip,application/zip" />
            <p class="hint">推荐：把技能目录整体打成一个 zip 上传（根目录或唯一的子目录里要有 SKILL.md），后端会解压到智能体后端的 skills/ 目录。上传压缩包时，下面的 SKILL.md 和附加文件可以留空。</p>
            <div class="hint" id="ask-bundle-zip-name"></div>
          </div>
          <div class="field"><label>SKILL.md 内容（入口，压缩包模式可留空）</label><textarea class="input" id="ask-manage-skillmd" rows="8" placeholder="技能入口说明；脚本和示例放在下面的附加文件里">${skillMd}</textarea></div>
          <div class="field"><label>附加文件（脚本 / 文档 / 示例，文本）</label>
            <input type="file" id="ask-bundle-picker" multiple class="input" accept=".md,.mjs,.js,.py,.txt,.json,.yaml,.yml,.html,.css,.csv" />
            <div class="ask-bundle-list" id="ask-bundle-list"></div>
            <p class="hint">选择多个文件即可；文件名带目录时按目录保存。单个文件建议 &lt; 200KB。</p>
          </div>
        </div>`
      : `<div class="field"><label>配置（JSON，可选）</label><textarea class="input" id="ask-manage-instructions" rows="8" placeholder='例如 {"endpoint":"http://...","headers":{}}'>${toolConfig}</textarea></div>`}
    </div>
    <div class="modal-foot"><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">取消</button><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-primary" id="ask-manage-save">保存</button></div>`);

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

  const zipPicker = $('#ask-bundle-zip');
  if (zipPicker) {
    zipPicker.onchange = () => {
      const file = zipPicker.files && zipPicker.files[0];
      const label = $('#ask-bundle-zip-name');
      if (label) label.textContent = file ? ('已选择：' + file.name + ' · ' + Math.round(file.size / 1024) + ' KB') : '';
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
          const zipInput = $('#ask-bundle-zip');
          const zipFile = zipInput && zipInput.files && zipInput.files[0];
          if (zipFile) {
            const form = new FormData();
            form.append('file', zipFile);
            form.append('name', name);
            await askUpload('/skills/upload', form);
            if (item && String(item.id || '').startsWith('dir:') && item.name !== name) {
              await askApi('/plugins/' + encodeURIComponent(item.id), { method: 'DELETE' });
            }
            closeModal();
            await askLoadSkills();
            await askLoadManage();
            toast('已导入技能：' + name);
            return;
          }
          const entry = ($('#ask-manage-skillmd') || {}).value || '';
          if (!entry.trim()) return toast('完整技能需要填写 SKILL.md 入口内容，或上传技能压缩包', true);
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
      <textarea class="textarea mono" id="batch-json" style="min-height:300px" placeholder='{"format":"wmd-batch","version":1,"baseDir":"","defaults":{"duration":10,"ratio":"16:9","model":"Seedance 2.0 Fast","repeat":1},"tasks":[...]}'>${esc(b.text || '')}</textarea>
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
              <div class="hint">${t.images.length} 图 · ${t.audios.length} 音频 · ${t.duration} 秒 · ${esc(t.aspectRatio)}${t.model ? ` · 模型 ${esc(t.model)}` : ''}</div>
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
          format: 'wmd-batch',
          version: 1,
          name: '新批次',
          baseDir: '',
          defaults: { ratio: '16:9', duration: 10, model: 'Seedance 2.0 Fast', repeat: 1 },
          tasks: [{ title: '示例任务', images: [{ path: '示例1/fs.png', subject: '角色' }], audios: [], prompt: 'subject_definitions:\n<Subject 1> is ...\n\nsummary:\n[reference generation] ...' }],
        };
        const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '批量任务模板.json';
        a.click();
        URL.revokeObjectURL(a.href);
        return;
      }
      if (act === 'batch-spec') {
        const spec = `请把下面的分镜/素材清单整理成批量任务 JSON（format=wmd-batch, version=1；format 是兼容字段，不要改）：
- tasks[].prompt 必须是六段式：subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music
- images 每项写 {path, subject}，path 用绝对路径或相对素材库的路径；第 n 张对应 <Picture n>
- audios 写本地音频路径，第 n 段对应 <Audio n>
- 可选字段：ratio 或 aspectRatio（16:9 / 9:16 / 1:1，管理器 Gemini 只支持 16:9 / 9:16）、duration（1–15 秒）、model（管理器豆包写 Seedance 2.0 Mini 或 Seedance 2.0 Fast；Gemini 留空）、repeat
- ratio / model 可以写在 defaults 里作为整批默认值，tasks[] 里写了就按单个任务覆盖
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
  const tab=state.logTab||localStorage.getItem('wmd.logs.tab')||'video';
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
  root.addEventListener('keydown', event=>{const tab=event.target.closest('[data-log-tab]');if(!tab||!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const next=tab.dataset.logTab==='video'?'image':'video';state.logTab=next;localStorage.setItem('wmd.logs.tab',next);render();document.querySelector('[data-log-tab="'+next+'"]').focus();});
  root.addEventListener('click', (event) => {
    const tab=event.target.closest('[data-log-tab]');
    if(tab){state.logTab=tab.dataset.logTab;localStorage.setItem('wmd.logs.tab',state.logTab);render();return;}
    const target = event.target.closest('[data-act]');
    if (!target) return;
    if (target.dataset.act === 'go-studio') { location.hash = '#studio'; return; }
    if (target.dataset.act === 'detail') openJobDetail(target.dataset.id);
  });
}

/* ------------------------------------------------------------------ 任务管理（合并入口） */

const TASK_TABS = [['create','创建任务'],['manage','任务管理'],['schedule','任务调度'],['monitor','任务监控'],['logs','日志']];
function taskMedia(){return state.taskMedia||localStorage.getItem('wmd.tasks.media')||'video';}
function currentTaskTab(){const value=state.taskTab||localStorage.getItem('wmd.tasks.tab')||'create';return TASK_TABS.some(([id])=>id===value)?value:'create';}
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
  const mediaSwitch=`<button type="button" class="wmd-tool-btn${media==='video'?' is-on':''}" data-task-media="video" aria-pressed="${media==='video'}">视频</button><button type="button" class="wmd-tool-btn${media==='image'?' is-on':''}" data-task-media="image" aria-pressed="${media==='image'}">图像</button>`;
  const tabActions=`<div class="task-tabbar-actions">${mediaSwitch}${tab==='monitor'?'<button type="button" class="wmd-tool-btn" data-event-range="7">近 7 天报告</button>':''}${tab==='create'?'':'<button type="button" class="wmd-tool-btn" data-task-refresh="1">刷新</button>'}</div>`;
  return `<section class="task-workspace"><div class="task-tabbar"><span class="task-eyebrow">TASK MANAGER</span><div class="task-tabs" role="tablist" aria-label="任务生命周期">${TASK_TABS.map(([id,label])=>`<button type="button" role="tab" id="task-tab-${id}" aria-controls="task-panel" data-task-tab="${id}" aria-selected="${tab===id}">${label}</button>`).join('')}</div>${tabActions}</div><div class="task-panel" id="task-panel" role="tabpanel" aria-labelledby="task-tab-${tab}">${body}</div></section>`;
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
    if(media){state.taskMedia=media.dataset.taskMedia;localStorage.setItem('wmd.tasks.media',state.taskMedia);state.taskEventStatus='';state.taskEventQuery='';state.taskEventMonth='';state.taskEventSort='runtime_desc';state.taskPages={};state.taskLogPaging=null;state.taskVideoLogs=[];state.taskImageLogs=[];state.events=[];state.eventPaging=null;await Events.load();render();return;}
    const page=event.target.closest('[data-task-page]');
    if(page&&!page.disabled){state.taskPages={...(state.taskPages||{}),[page.dataset.pageKey]:Number(page.dataset.taskPage)};if(page.dataset.pageKey==='events')await Events.load();else if(currentTaskTab()==='logs')await loadTaskLogs(true);render();return;}
    const refresh=event.target.closest('[data-task-refresh]');
    if(refresh){
      if(currentTaskTab()==='create'){try{state.assets=await api('/api/assets');}catch{/* 刷新素材失败时保持原列表 */}render();}
      else {await Events.load();render();}
      return;
    }
    const button=event.target.closest('[data-task-tab]');
    if(button){state.taskEventStatus='';state.taskEventQuery='';state.taskEventMonth='';state.taskEventSort='runtime_desc';state.taskPages={...(state.taskPages||{}),events:1};state.taskTab=button.dataset.taskTab;localStorage.setItem('wmd.tasks.tab',state.taskTab);syncHash('tasks',{tab:state.taskTab});await Events.load();render();return;}
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
  const me = (state.auth && state.auth.user) || {};
  const canManage = !state.auth || !state.auth.user || Boolean(me.isAdmin || me.role === 'owner' || me.role === 'admin');
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
        <div class="hint">Key：${ch.hasKey ? `<code class="key-plain">${esc(ch.masked || '已配置')}</code>` : '<span class="is-danger">未填写</span>'}</div>
      </div>
      ${canManage ? `
      <button type="button" class="btn sm" data-test-channel="${esc(ch.id)}" data-kind="${kind}">测试</button>
      ${ch.active && ch.enabled !== false ? '' : `<button type="button" class="btn sm" data-activate-channel="${esc(ch.id)}" data-kind="${kind}">设为默认</button>`}
      <button type="button" class="btn sm ghost" data-toggle-channel="${esc(ch.id)}" data-kind="${kind}" data-enabled="${ch.enabled === false ? '1' : '0'}">${ch.enabled === false ? '启用' : '停用'}</button>
      <button type="button" class="btn sm ghost" data-edit-channel="${esc(ch.id)}" data-kind="${kind}">编辑</button>
      <button type="button" class="btn sm ghost" data-copy-channel="${esc(ch.id)}" data-kind="${kind}" title="复制这套配置，再改模型名 / 名称">复制</button>
      <button type="button" class="btn sm ghost" data-del-channel="${esc(ch.id)}" data-kind="${kind}">删除</button>` : '<span class="hint">只读</span>'}
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
  const view = state.appearanceTab || 'system';
  const systemTypeBlock = `<div class="settings-block"><h3>全局 · 字体与排版</h3><p class="hint">应用于整个系统：菜单、任务页、素材库、表单和弹窗都会使用这套字体与字号。</p><div class="two"><div class="field"><label for="system-font">全局字体</label><select id="system-font" class="input">${Object.entries(AGENT_FONTS).map(([id, font]) => `<option value="${id}" ${(ui.systemFont || 'system') === id ? 'selected' : ''}>${font.label}</option>`).join('')}</select></div><div class="field"><label for="system-weight">字重</label><select id="system-weight" class="input">${[[400, '常规'], [500, '适中'], [600, '加粗']].map(([value, label]) => `<option value="${value}" ${Number(ui.systemFontWeight || 400) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div>${[['system-size', '全局字号', 'systemFontSize', 12, 18, .5, 14, 'px'], ['system-leading', '全局行距', 'systemLineHeight', 1.25, 2.2, .05, 1.55, '']].map(([id, label, key, min, max, step, fallback, unit]) => `<label class="wallpaper-dim" for="${id}"><span>${label}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${ui[key] ?? fallback}" /><output id="${id}-value">${ui[key] ?? fallback}${unit}</output></label>`).join('')}<div class="system-type-preview"><strong>标题示例 Title</strong><p>正文示例：让参数、任务和素材都保持同一种阅读节奏。</p><small>辅助文字 · 10 项任务 · 2026/10/27</small></div><button type="button" class="btn ghost" id="system-type-reset">恢复全局默认</button></div>`;
  return `<div class="appearance-tabs" role="tablist" aria-label="外观分类"><button type="button" role="tab" aria-selected="${view === 'system'}" data-appearance-tab="system">系统外观</button><button type="button" role="tab" aria-selected="${view === 'agent'}" data-appearance-tab="agent">智能体外观</button></div>
    <div class="appearance-panel" data-appearance-panel="agent" ${view === 'agent' ? '' : 'hidden'}>
    <div class="settings-block"><h3>智能体 · 字体与排版</h3><div class="field"><label for="agent-welcome-text">中文欢迎语</label><input class="input" id="agent-welcome-text" maxlength="40" value="${esc(agentWelcomeText(ui))}" placeholder="让故事成形，让想象入镜。" /><small class="hint">最多 40 字，保持单行显示。修改后移开焦点自动保存，留空恢复默认。</small></div><p class="hint">即时预览并自动保存。正文设置应用于对话、输入框和文字预览；欢迎标题单独调节。字体使用本机已安装字体。</p><div class="field"><label for="agent-font">字体风格</label><select id="agent-font" class="input">${Object.entries(AGENT_FONTS).map(([id, font]) => `<option value="${id}" ${(ui.agentFont || 'system') === id ? 'selected' : ''}>${font.label}</option>`).join('')}</select></div><div class="field"><label for="agent-weight">字重</label><select id="agent-weight" class="input">${[[400, '常规'], [500, '适中'], [600, '加粗']].map(([value, label]) => `<option value="${value}" ${Number(ui.agentFontWeight || 400) === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>${[['agent-size', '正文字号', 'agentFontSize', 12, 24, 1, 15, 'px'], ['agent-leading', '正文行距', 'agentLineHeight', 1.3, 2.4, .1, 1.8, ''], ['agent-title-size', '欢迎标题字号', 'agentTitleSize', 24, 64, 1, 44, 'px']].map(([id, label, key, min, max, step, fallback, unit]) => `<label class="wallpaper-dim" for="${id}"><span>${label}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${ui[key] ?? fallback}" /><output id="${id}-value">${ui[key] ?? fallback}${unit}</output></label>`).join('')}<div class="agent-type-preview"><span id="agent-welcome-preview">${esc(agentWelcomeText(ui))}</span><br>每一个灵感，都值得成为一部作品。</div><button type="button" class="btn ghost" id="agent-type-reset">恢复默认排版</button></div></div>
    <div class="appearance-panel" data-appearance-panel="system" ${view === 'system' ? '' : 'hidden'}>
    ${systemTypeBlock}
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
        <label class="wallpaper-dim" for="wallpaper-page-alpha"><span>其它页面壁纸可见度</span><input id="wallpaper-page-alpha" type="range" min="0" max="100" value="${visPref(ui, 'pageTransparency', 55)}" /><output id="wallpaper-page-alpha-value">${visPref(ui, 'pageTransparency', 55)}%</output></label>
        <label class="wallpaper-dim" for="wallpaper-side-alpha"><span>左侧菜单栏壁纸可见度</span><input id="wallpaper-side-alpha" type="range" min="0" max="100" value="${visPref(ui, 'sidebarTransparency', 60)}" /><output id="wallpaper-side-alpha-value">${visPref(ui, 'sidebarTransparency', 60)}%</output></label>
        <label class="wallpaper-dim" for="wallpaper-top-alpha"><span>顶部与外框壁纸可见度</span><input id="wallpaper-top-alpha" type="range" min="0" max="100" value="${visPref(ui, 'topbarTransparency', 65)}" /><output id="wallpaper-top-alpha-value">${visPref(ui, 'topbarTransparency', 65)}%</output></label>
        <div class="wallpaper-rotation"><label><input type="checkbox" id="wallpaper-rotate" ${ui.wallpaperRotate ? 'checked' : ''} /> 自动轮换</label><select class="input" id="wallpaper-rotation-kind" aria-label="轮换类型">${[['static', '只换静态'], ['dynamic', '只换动态'], ['all', '静态与动态']].map(([value, label]) => `<option value="${value}" ${value === (ui.wallpaperRotationKind || 'static') ? 'selected' : ''}>${label}</option>`).join('')}</select><select class="input" id="wallpaper-interval" aria-label="轮换间隔">${[[60, '每 1 分钟'], [300, '每 5 分钟'], [900, '每 15 分钟']].map(([value, label]) => `<option value="${value}" ${value === (ui.wallpaperInterval || 300) ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      </div>
      <details class="wallpaper-legacy"><summary>清爽纯色主题</summary><div class="theme-grid">${themes.filter((t) => !t.day).map(card).join('')}</div></details>
    </div>
    </div>`;
}

function channelPane(kind) {
  const d = state.settingsDraft;
  const meta = CHANNEL_KIND_META[kind];
  const me = (state.auth && state.auth.user) || {};
  const canManage = !state.auth || !state.auth.user || Boolean(me.isAdmin || me.role === 'owner' || me.role === 'admin');
  return `
    <div class="settings-block">
      <div class="settings-block-head"><h3>${meta.title}渠道</h3></div>
      <p class="hint">${meta.desc}</p>
      ${canManage ? '' : '<p class="hint">渠道由本租户的负责人/管理员维护，成员只读。</p>'}
      ${channelRows(kind)}
      ${canManage ? `<div class="row"><button type="button" class="btn" data-add-channel="${kind}">＋ 新增${meta.title}渠道</button></div>` : ''}
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

const TEAM_ROLES = { owner: '负责人', admin: '管理员', member: '成员' };
function showTeamLink(url) {
  const box = $('#team-link-box');
  const input = $('#team-link');
  if (!box || !input) return;
  input.value = new URL(url, location.origin).href;
  box.hidden = false;
  input.select?.();
}
function teamRoleLabel(user) {
  if (!user) return '';
  if (user.isAdmin) return '平台管理员';
  return TEAM_ROLES[user.role] || '成员';
}

/**
 * 租户与成员：租户之间数据完全隔离，这里只管人和角色。
 * 平台管理员能建租户、给任意租户加人；租户负责人/管理员只能管本租户。
 */
function teamPane() {
  const me = (state.auth && state.auth.user) || {};
  const canManage = Boolean(me.isAdmin || me.role === 'owner' || me.role === 'admin');
  return `
    <div class="settings-block">
      <h3>租户与成员</h3>
      <p class="hint">每个租户的数据完全隔离：项目、任务、素材、成片、配置互不可见。同一租户的成员共享本租户的项目。</p>
      <div class="kv"><span>当前租户</span><span id="team-tenant">读取中…</span></div>
      <div class="kv"><span>我的角色</span><span>${esc(teamRoleLabel(me))}</span></div>
      <div id="team-members" class="team-members"><p class="hint">读取成员…</p></div>
      ${canManage ? `
      <div class="settings-actions team-add-row">
        <input class="input" id="team-new-name" placeholder="用户名（2–32 位）" autocomplete="off" />
        <input class="input" id="team-new-pass" type="password" placeholder="密码（至少 6 位）" autocomplete="new-password" />
        <select class="input" id="team-new-role"><option value="member">成员</option><option value="admin">管理员</option><option value="owner">负责人</option></select>
        <button type="button" class="btn" id="team-add">添加成员</button>
        <button type="button" class="btn ghost" id="team-invite">生成邀请链接</button>
      </div>
      ${me.isAdmin ? `
      <div class="settings-actions team-add-row">
        <input class="input" id="team-new-tenant" placeholder="新租户名称" autocomplete="off" />
        <button type="button" class="btn ghost" id="team-add-tenant">新建租户</button>
      </div>` : ''}` : ''}
      <div id="team-link-box" hidden>
        <div class="field"><label>一次性链接（只显示这一次，发给对方后 72 小时内有效）</label><input class="input mono" id="team-link" readonly /></div>
      </div>
      <p class="hint">成员的密码由这里设置；忘记密码时可以生成一次性重置链接，或让管理员重置。</p>
      <div class="settings-block" style="margin-top:14px">
        <h3>配额</h3>
        <div id="team-quota" class="hint">读取中…</div>
        ${me.isAdmin ? `
        <div class="settings-actions team-add-row">
          <select class="input" id="quota-tenant" title="选择要配置的租户"></select>
          <input class="input" id="quota-users" type="number" min="0" placeholder="用户数上限（0=不限）" />
          <input class="input" id="quota-projects" type="number" min="0" placeholder="项目数上限（0=不限）" />
          <input class="input" id="quota-tasks" type="number" min="0" placeholder="每日任务上限（0=不限）" />
          <input class="input" id="quota-storage" type="number" min="0" step="0.1" placeholder="存储上限 GB（0=不限）" />
          <input class="input" id="quota-concurrent" type="number" min="0" placeholder="并发任务上限（0=不限）" />
          <button type="button" class="btn" id="quota-save">保存配额</button>
        </div>
        <p class="hint">0 表示不限制；平台管理员可以切换任意租户，其它角色只能看自己租户。</p>` : '<p class="hint">配额由平台管理员设置。</p>'}
      </div>
    </div>`;
}

async function loadQuotaPane(tenantId) {
  const quotaEl = $('#team-quota');
  if (!quotaEl) return;
  try {
    const data = await api('/api/tenants/' + encodeURIComponent(tenantId) + '/quota');
    const q = data.quota || {};
    const u = data.usage || {};
    const label = (value) => value ? value : '不限';
    quotaEl.textContent = `用户 ${u.users || 0}/${label(q.maxUsers)} · 项目 ${u.projects || 0}/${label(q.maxProjects)} · 今日任务 ${u.tasksToday || 0}/${label(q.maxTasksPerDay)}`
      + ` · 存储 ${fmtBytes(u.storageBytes || 0)}/${q.maxStorageBytes ? fmtBytes(q.maxStorageBytes) : '不限'}`
      + ` · 并发 ${u.runningTasks || 0}/${label(q.maxConcurrentTasks)}`;
    if ($('#quota-users')) $('#quota-users').value = String(q.maxUsers || 0);
    if ($('#quota-projects')) $('#quota-projects').value = String(q.maxProjects || 0);
    if ($('#quota-tasks')) $('#quota-tasks').value = String(q.maxTasksPerDay || 0);
    if ($('#quota-storage')) $('#quota-storage').value = String(q.maxStorageBytes ? Number((q.maxStorageBytes / (1024 ** 3)).toFixed(2)) : 0);
    if ($('#quota-concurrent')) $('#quota-concurrent').value = String(q.maxConcurrentTasks || 0);
  } catch (error) {
    quotaEl.textContent = error.message;
  }
}

async function refreshTeamPane() {
  const listEl = $('#team-members');
  const tenantEl = $('#team-tenant');
  if (!listEl) return;
  const me = (state.auth && state.auth.user) || {};
  try {
    const [users, tenants] = await Promise.all([
      api('/api/users'),
      api('/api/tenants').catch(() => []),
    ]);
    const mine = (tenants || []).find((row) => row.id === me.tenantId);
    if (tenantEl) tenantEl.textContent = mine ? `${mine.name}（${mine.members} 人）` : (me.tenantId || '默认租户');
    const canManage = Boolean(me.isAdmin || me.role === 'owner' || me.role === 'admin');
    const selector = $('#quota-tenant');
    if (selector) {
      const previous = selector.value;
      selector.innerHTML = (tenants || []).map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
      const wanted = (tenants || []).some((row) => row.id === previous) ? previous : (me.tenantId || tenants?.[0]?.id || 'tnt_default');
      selector.value = wanted;
      selector.onchange = () => loadQuotaPane(selector.value);
    }
    const quotaTenant = selector ? selector.value : (me.tenantId || 'tnt_default');
    await loadQuotaPane(quotaTenant);
    listEl.innerHTML = users.map((user) => `
      <div class="team-row">
        <span class="team-name">${esc(user.username)}</span>
        <span class="team-role">${esc(teamRoleLabel(user))}</span>
        ${canManage && !user.isAdmin ? `<button type="button" class="btn ghost sm" data-team-role="${esc(user.id)}" data-next="${user.role === 'member' ? 'admin' : user.role === 'admin' ? 'owner' : 'member'}">改角色</button><button type="button" class="btn ghost sm" data-team-reset="${esc(user.id)}">重置密码</button><button type="button" class="btn ghost sm" data-team-remove="${esc(user.id)}">移除</button>` : ''}
      </div>`).join('') || '<p class="hint">还没有成员</p>';
  } catch (error) {
    listEl.innerHTML = `<p class="hint">${esc(error.message)}</p>`;
  }
}

/**
 * 执行端：用户自己电脑上的管理器通过外联通道接进来。
 * 这里负责发配对令牌、看在线状态、测通道；管理器那边填同一个令牌即可。
 */
function executorPane() {
  return `
    <div class="settings-block">
      <h3>我的管理器（执行端）</h3>
      <p class="hint">管理器装在自己电脑上时，用配对令牌让它主动连到这里：任务从通道下发、成片回传，服务器不需要能访问你的电脑。</p>
      <div class="kv"><span>通道状态</span><span id="executor-online">读取中…</span></div>
      <div class="kv"><span>已配对</span><span id="executor-paired">—</span></div>
      <div id="executor-list" class="team-members"></div>
      <div id="executor-token-box" hidden>
        <div class="field"><label>配对令牌（只显示这一次，复制到管理器的「系统管理 → 外联通道」里）</label><input class="input mono" id="executor-token" readonly /></div>
      </div>
      <div class="settings-actions">
        <button type="button" class="btn" id="executor-pair">生成配对令牌</button>
        <button type="button" class="btn ghost" id="executor-probe">测试通道</button>
      </div>
      <p class="hint">每台机器生成一条令牌，多台机器可同时配对；生成新令牌不会让旧令牌失效。可把任意一条设为视频任务通道。</p>
    </div>`;
}

async function refreshExecutorPane() {  const onlineEl = $('#executor-online');
  if (!onlineEl) return;
  try {
    const info = await api('/api/executor/status');
    onlineEl.textContent = info.online ? '在线' : '未连接';
    const rows = info.channels || [];
    const paired = $('#executor-paired');
    if (paired) paired.textContent = rows.length ? `${rows.length} 台` : '还没有配对';
    const list = $('#executor-list');
    if (list) {
      const activeId = (info.channel && info.channel.activeId) || '';
      list.innerHTML = rows.map((row) => `
        <div class="team-row">
          <span class="team-name">${esc(row.name || '未命名')} · ${row.online ? '在线' : '离线'}${activeId === row.id ? ' · 任务通道' : ''}</span>
          <span class="team-role">${esc(row.tokenHint || '')}${row.version ? ' · v' + esc(row.version) : ''}${row.lastError ? ' · ' + esc(row.lastError) : ''}</span>
          <button type="button" class="btn ghost sm" data-exec-active="${esc(row.id)}">设为任务通道</button>
          <button type="button" class="btn ghost sm" data-exec-revoke="${esc(row.id)}">撤销</button>
        </div>`).join('') || '<p class="hint">还没有配对。生成一条令牌，填到管理器里。</p>';
    }
  } catch (error) {
    onlineEl.textContent = error.message;
  }
}

function auditPane() {
  const me = (state.auth && state.auth.user) || {};
  const canView = Boolean(me.isAdmin || me.role === 'owner' || me.role === 'admin');
  if (!canView) {
    return `<div class="settings-block"><h3>审计日志</h3><p class="hint">只有租户负责人/管理员可以查看审计日志。</p></div>`;
  }
  return `
    <div class="settings-block">
      <h3>审计日志</h3>
      <p class="hint">登录、成员、租户、项目、配置与渠道变更；不记录密码和密钥。${me.isAdmin ? '平台管理员可看到所有租户。' : '只显示当前租户。'}</p>
      <div id="audit-integrity" class="hint">完整性校验中…</div>
      <div class="settings-actions">
        <button type="button" class="btn ghost" data-audit-export="csv">导出 CSV</button>
        <button type="button" class="btn ghost" data-audit-export="json">导出 JSON</button>
      </div>
      <div id="audit-list" class="team-members"><p class="hint">读取中…</p></div>
    </div>`;
}

async function refreshAuditPane() {
  const list = $('#audit-list');
  if (!list) return;
  try {
    const data = await api('/api/audit?limit=100');
    const items = (data && data.items) || [];
    const integrity = data && data.integrity;
    const integrityEl = $('#audit-integrity');
    if (integrityEl && integrity) {
      integrityEl.textContent = integrity.ok
        ? `完整性校验通过（${integrity.checked} 条）`
        : `完整性校验失败：${integrity.reason || (integrity.broken && integrity.broken[0] && integrity.broken[0].reason) || '记录被修改或删除'}`;
      integrityEl.style.color = integrity.ok ? '' : 'var(--danger, #c33)';
    }
    list.innerHTML = items.length ? items.map((row) => `
      <div class="team-row">
        <span class="team-name">${esc(row.action)}</span>
        <span class="team-role">${esc(row.detail || row.target || '')}</span>
        <span class="hint">${esc(new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false }))}</span>
      </div>`).join('') : '<p class="hint">还没有审计记录</p>';
  } catch (error) {
    list.innerHTML = `<p class="hint">${esc(error.message)}</p>`;
  }
}

function renderSettings() {
  const d = state.settingsDraft;
  const tab = state.settingsTab;
  const tabs = [
    ['text', '文本推理'],
    ['image', '图片生成'],
    ['video', '视频生成'],
    ['team', '租户成员'],
    ['executor', '执行端'],
    ['audit', '审计日志'],
    ['appearance', '外观'],
    ['storage', '存储目录'],
    ['about', '关于'],
  ];
  const kindOf = { text: 'llm', image: 'image', video: 'video' };
  let pane = '';
  if (kindOf[tab]) {
    pane = channelPane(kindOf[tab]);
  } else if (tab === 'team') {
    pane = teamPane();
  } else if (tab === 'executor') {
    pane = executorPane();
  } else if (tab === 'audit') {
    pane = auditPane();
  } else if (tab === 'appearance') {
    pane = appearancePane();
  } else if (tab === 'storage') {
    // 部署参数是平台级的：只有平台管理员能改，普通租户成员只读。
    const me = (state.auth && state.auth.user) || {};
    const canPlatform = !state.auth || !state.auth.user || Boolean(me.isAdmin);
    const ro = canPlatform ? '' : ' disabled';
    pane = `
      <div class="settings-block">
        <h3>存储目录</h3>
        ${canPlatform ? '' : '<p class="hint">项目目录、并发上限由平台管理员设置；租户内可以改自己的渠道、密钥和提示词。</p>'}
        <div class="field"><label>项目根目录</label><input class="input mono" id="project-root" value="${esc(d.projectRoot || '')}"${ro} /></div>
        <p class="hint">每个项目会在这里自动生成独立子目录：<span class="mono">assets/ media/ uploads/ exports/</span>。项目激活时，素材、成片、上传都只读写该项目目录。修改根目录不会搬动已存在的项目文件。</p>
        <div class="workspace-migrate">
          <button type="button" class="btn" id="workspace-migrate"${ro}>把旧数据迁入当前项目</button>
          <span class="hint">旧版散落的 <span class="mono">data/assets、uploads、media</span> 不会自动搬动。点击后会先备份到 <span class="mono">data/backups</span>，再迁入当前项目。</span>
        </div>
        <div class="field"><label>未归档成片目录（旧数据）</label><input class="input mono" id="save-folder" value="${esc(d.saveFolder)}"${ro} /></div>
        <div class="field"><label>未归档素材目录（旧数据）</label><input class="input mono" id="asset-folder" value="${esc(d.assetFolder)}"${ro} /></div>
        <div class="field"><label>克隆参考音色库（800+ 音色目录）</label><input class="input mono" id="voice-folder" value="${esc(d.voiceLibraryFolder || '')}" placeholder="D:\\notebook\\AIGC\\Comic-drama\\资产文档\\800+音色"${ro} /></div>
        <div class="field" style="width:200px"><label>并发上限</label><input class="input" id="concurrency" type="number" min="1" max="10" value="${d.concurrency}"${ro} /></div>
        <p class="hint">每个 Key / 每个自定义视频渠道各占 1 个工位；并发上限控制同时执行的任务总数。</p>
        <p class="hint">音色库目录留空时，会自动用 <span class="mono">D:\\notebook\\AIGC\\Comic-drama\\资产文档\\800+音色</span>（如果存在）。</p>
      </div>`;
  } else {
    pane = `
      <div class="settings-block">
        <h3>关于</h3>
        <div class="kv"><span>版本</span><span>WENYUN.M-DESKTOP 0.3.0（源码重建版）</span></div>
        <div class="kv"><span>数据目录</span><span class="mono">${esc(state.config.dataDir || '')}</span></div>
        <div class="kv"><span>原版</span><span>原版桌面版 2026.10.23（Tauri）</span></div>
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
    <div class="modal-foot"><span class="hint grow">渠道/部署参数保存在本机；主题、壁纸、字号、音量随账号保存</span><button class="btn" data-close="1">关闭</button><button class="btn primary" id="settings-save">保存</button></div>
  `);
  $('#modal-panel').classList.add('modal-settings');
  bindSettings();
}

function bindSettings() {
  const d = state.settingsDraft;
  // 租户成员面板
  const teamAdd = $('#team-add');
  if (teamAdd) teamAdd.onclick = async () => {
    const username = $('#team-new-name').value.trim();
    const password = $('#team-new-pass').value;
    const role = $('#team-new-role').value;
    try {
      await api('/api/users', { method: 'POST', body: { username, password, role } });
      toast('成员已添加');
      refreshTeamPane();
    } catch (error) { toast(error.message, true); }
  };
  const teamAddTenant = $('#team-add-tenant');
  if (teamAddTenant) teamAddTenant.onclick = async () => {
    const name = $('#team-new-tenant').value.trim();
    try {
      await api('/api/tenants', { method: 'POST', body: { name } });
      toast('租户已创建');
      refreshTeamPane();
    } catch (error) { toast(error.message, true); }
  };
  const teamInvite = $('#team-invite');
  if (teamInvite) teamInvite.onclick = async () => {
    try {
      const role = $('#team-new-role')?.value || 'member';
      const out = await api('/api/invites', { method: 'POST', body: { role } });
      showTeamLink(out.url);
      toast('邀请链接已生成，复制发给对方');
    } catch (error) { toast(error.message, true); }
  };
  const quotaSave = $('#quota-save');
  if (quotaSave) quotaSave.onclick = async () => {
    const me = (state.auth && state.auth.user) || {};
    const target = $('#quota-tenant')?.value || me.tenantId || 'tnt_default';
    try {
      await api('/api/tenants/' + encodeURIComponent(target) + '/quota', {
        method: 'PUT',
        body: {
          maxUsers: Number($('#quota-users').value) || 0,
          maxProjects: Number($('#quota-projects').value) || 0,
          maxTasksPerDay: Number($('#quota-tasks').value) || 0,
          maxStorageBytes: Math.round((Number($('#quota-storage')?.value) || 0) * (1024 ** 3)),
          maxConcurrentTasks: Number($('#quota-concurrent')?.value) || 0,
        },
      });
      toast('配额已保存');
      await loadQuotaPane(target);
    } catch (error) { toast(error.message, true); }
  };
  if ($('#team-members')) {
    refreshTeamPane();
    $('#team-members').onclick = async (event) => {
      const roleBtn = event.target.closest('[data-team-role]');
      const resetBtn = event.target.closest('[data-team-reset]');
      const removeBtn = event.target.closest('[data-team-remove]');
      if (roleBtn) {
        const id = roleBtn.dataset.teamRole;
        try {
          await api('/api/users/' + encodeURIComponent(id), { method: 'PATCH', body: { role: roleBtn.dataset.next || 'admin' } });
          toast('角色已更新');
          refreshTeamPane();
        } catch (error) { toast(error.message, true); }
      }
      if (resetBtn) {
        try {
          const out = await api('/api/users/' + encodeURIComponent(resetBtn.dataset.teamReset) + '/reset-token', { method: 'POST', body: {} });
          showTeamLink(out.url);
          toast('重置链接已生成，30 分钟内有效');
        } catch (error) { toast(error.message, true); }
      }
      if (removeBtn) {
        try {
          await api('/api/users/' + encodeURIComponent(removeBtn.dataset.teamRemove), { method: 'DELETE' });
          toast('成员已移除');
          refreshTeamPane();
        } catch (error) { toast(error.message, true); }
      }
    };
  }

  // 执行端面板（只有切到该页时元素才存在）
  const pairBtn = $('#executor-pair');
  if (pairBtn) pairBtn.onclick = async () => {
    try {
      const out = await api('/api/executor/pair', { method: 'POST', body: {} });
      const input = $('#executor-token');
      input.value = out.token;
      $('#executor-token-box').hidden = false;
      input.select?.();
      toast('配对令牌已生成，复制到管理器里');
      refreshExecutorPane();
    } catch (error) { toast(error.message, true); }
  };
  const probeBtn = $('#executor-probe');
  if (probeBtn) probeBtn.onclick = async () => {
    try {
      const out = await api('/api/executor/probe', { method: 'POST', body: {} });
      if (out.ok) toast(`通道正常：${out.accounts} 个账号 · ${out.ms}ms`);
      else toast(out.message || '通道不通', true);
    } catch (error) { toast(error.message, true); }
  };
  const execList = $('#executor-list');
  if (execList) execList.onclick = async (event) => {
    const active = event.target.closest('[data-exec-active]');
    const revoke = event.target.closest('[data-exec-revoke]');
    try {
      if (active) {
        await api('/api/executor/active', { method: 'POST', body: { id: active.dataset.execActive } });
        toast('已切换视频任务通道');
        refreshExecutorPane();
      }
      if (revoke) {
        await api('/api/executor/pair', { method: 'DELETE', body: { id: revoke.dataset.execRevoke } });
        toast('配对已撤销');
        refreshExecutorPane();
      }
    } catch (error) { toast(error.message, true); }
  };
  if ($('#executor-online')) refreshExecutorPane();
  if ($('#audit-list')) refreshAuditPane();
  $$('#modal-panel [data-audit-export]').forEach((btn) => {
    btn.onclick = () => window.open('/api/audit/export?format=' + encodeURIComponent(btn.dataset.auditExport), '_blank');
  });
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

  $$('#modal-panel [data-appearance-tab]').forEach((button) => {
    button.onclick = () => { state.appearanceTab = button.dataset.appearanceTab; renderSettings(); };
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
  if ($('#system-font')) {
    for (const [id, key] of [['system-font', 'systemFont'], ['system-weight', 'systemFontWeight'], ['system-size', 'systemFontSize'], ['system-leading', 'systemLineHeight']]) {
      const control = $('#' + id);
      control.oninput = () => {
        applySystemTypography({ ...state.config.ui, [key]: id === 'system-font' ? control.value : Number(control.value) });
        const output = $('#' + id + '-value'); if (output) output.textContent = control.value + (id === 'system-leading' ? '' : 'px');
      };
      control.onchange = async () => {
        try { await saveAppearance({ [key]: id === 'system-font' ? control.value : Number(control.value) }); }
        catch (err) { toast('全局排版保存失败：' + err.message, true); }
      };
    }
    $('#system-type-reset').onclick = async () => {
      try { await saveAppearance({ systemFont: 'system', systemFontSize: 14, systemLineHeight: 1.55, systemFontWeight: 400 }); renderSettings(); }
      catch (err) { toast(err.message, true); }
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
    for (const [id, key, variable, kind] of [
      ['wallpaper-preview-alpha', 'wallpaperPreviewTransparency', '--skin-preview-alpha', 'alpha'],
      ['wallpaper-workspace-alpha', 'wallpaperWorkspaceTransparency', '--skin-workspace-alpha', 'alpha'],
      ['wallpaper-page-alpha', 'pageTransparency', '--skin-page-vis', 'vis'],
      ['wallpaper-side-alpha', 'sidebarTransparency', '--skin-side-vis', 'vis'],
      ['wallpaper-top-alpha', 'topbarTransparency', '--skin-top-vis', 'vis'],
    ]) {
      const slider = $('#' + id);
      if (!slider) continue;
      slider.oninput = () => {
        const value = Number(slider.value);
        document.documentElement.style.setProperty(variable, kind === 'alpha' ? String(1 - value / 100) : String(value));
        const out = $('#' + id + '-value');
        if (out) out.textContent = value + '%';
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
  $$('#modal-panel [data-copy-channel]').forEach((btn) => {
    btn.onclick = () => {
      const kind = btn.dataset.kind;
      const ch = (state.channels[kind] || []).find((c) => c.id === btn.dataset.copyChannel);
      if (ch) openChannelDialog(kind, ch, { copy: true, returnToSettings: true });
    };
  });
  $$('#modal-panel [data-del-channel]').forEach((btn) => {    btn.onclick = async () => {
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
  const clearKey = $('#ch-clear-key');
  draft.clearKey = !!(clearKey && clearKey.dataset.on === '1');
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
  const copying = !!opts.copy && !!channel;
  const editing = !!channel && !copying;
  const kindLabel = kind === 'llm' ? '文本推理' : kind === 'image' ? '图片生成' : '视频生成';
  const draft = channel
    ? {
      ...channel,
      id: copying ? undefined : channel.id,
      name: copying ? ((channel.name || channel.model || '模型') + ' 副本') : channel.name,
      active: copying ? false : channel.active,
      enabled: copying ? true : channel.enabled,
      lastTestOk: copying ? undefined : channel.lastTestOk,
      lastTestMessage: copying ? '' : channel.lastTestMessage,
      options: { ...(channel.options || {}) },
      // 接口不再下发完整 Key：编辑时留空表示保持原值，占位符显示尾号。
      apiKey: '',
      masked: channel.masked || '',
      maxTokens: channel.maxTokens || 0,
      contextWindow: channel.contextWindow || 0,
    }
    : {
      name: kind === 'video' && types[0].id==='autodl-h3' ? 'AutoDL 官方H3' : '',
      type: types[0].id,
      baseUrl: types[0].fields?.find(f=>f.key==='baseUrl')?.default || '',
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
      const data = await api('/api/channels/manager-accounts', { method: 'POST', body: { baseUrl, apiKey, channelId: editing ? channel.id : '' } });
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
        const count = String(value).split(/[\r\n,;]+/).map((v) => v.trim()).filter(Boolean).length;
        if (f.type === 'textarea') {
          return `<div class="field full"><label>${esc(f.label)} <span class="hint">保存在服务端，接口不回传完整 Key</span></label>
          <textarea class="input mono" data-ch-key="apiKey" data-ch-scope="top" rows="4" spellcheck="false" autocomplete="off" placeholder="${esc(draft.masked ? '已配置：' + draft.masked + '（留空保存会保留原密钥）' : (f.placeholder || '每行一个 Key'))}">${esc(value)}</textarea>
          <div class="hint"><span id="ch-key-count">${count ? `本次已填 ${count} 个账号，每个账号各算一路并发` : '还没填新密钥；留空保存会保留原密钥'}</span>
            <button type="button" class="wmd-btn wmd-btn-sm" id="ch-clear-key" data-on="0" style="margin-left:8px">清空密钥</button></div></div>`;
        }
        return `<div class="field"><label>${esc(f.label)} <span class="hint">保存在服务端，接口不回传完整 Key</span></label>
          <input class="input mono" data-ch-key="apiKey" data-ch-scope="top" type="text" value="${esc(value)}" placeholder="${esc(draft.masked ? '已配置：' + draft.masked : (f.placeholder || 'sk-…'))}" autocomplete="off" />
          <div class="hint">留空保存 = 保留原 Key；要更换直接输入新的 Key</div></div>`;
      }
      if (f.key === 'model') {
        return `<div class="field"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>
          <div class="ch-model-row">
            <input class="input mono" id="ch-model" data-ch-key="model" data-ch-scope="top" list="ch-model-options" value="${esc(draft.model || '')}" placeholder="${esc(f.placeholder || '')}" />
            <button type="button" class="wmd-btn wmd-btn-sm" id="ch-fetch-models" title="用上面的 Base URL + Key 拉取 /models">获取模型</button>
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
          + '<button type="button" class="wmd-btn wmd-btn-sm" id="ch-manager-load">读取账号</button></div>'
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
        <h2>${copying ? '复制' : channel ? '编辑' : '新增'}${copying ? kindLabel + '模型配置' : kindLabel + '渠道'}</h2>
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
    const keyArea = $('[data-ch-key="apiKey"]');
    const keyCount = $('#ch-key-count');
    if (keyArea && keyCount) {
      const refreshCount = () => {
        const n = String(keyArea.value || '').split(/[\r\n,;]+/).map((v) => v.trim()).filter(Boolean).length;
        keyCount.textContent = n ? `已填 ${n} 个账号，每个账号各算一路并发` : '还没填密钥；留空保存会保留原密钥';
      };
      keyArea.oninput = refreshCount;
      refreshCount();
    }
    const clearKey = $('#ch-clear-key');
    if (clearKey) {
      clearKey.onclick = () => {
        const on = clearKey.dataset.on !== '1';
        clearKey.dataset.on = on ? '1' : '0';
        if (keyArea) keyArea.value = '';
        if (keyCount) keyCount.textContent = on ? '保存后该渠道没有任何密钥' : '还没填密钥；留空保存会保留原密钥';
        clearKey.textContent = on ? '撤销清空' : '清空密钥';
      };
    }

    $('#ch-type').onchange = () => {
      const current = collectChannelDraft(kind, draft);
      current.type = $('#ch-type').value;
      current.options = {};
      const meta2 = channelTypeMeta(kind, current.type);
      if(current.type==='autodl-h3'){current.name='AutoDL 官方H3';current.baseUrl='https://autodl.art';}
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
            body: { kind, type: draft.type, baseUrl: baseUrl.trim(), apiKey, channelId: editing ? channel.id : '' },
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
        if (editing) saved = await api(`/api/channels/${channel.id}`, { method: 'PUT', body: payload });
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
        toast(copying ? '已复制成新的模型配置' : '渠道已保存');
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
      const previousStatus = index >= 0 ? state.jobs[index].status : '';
      // 有新任务进来就取消「回看旧版」，否则新出一版也会被旧版按住看不见
      if (index < 0 && job.itemId && state.stagePick) delete state.stagePick[job.itemId];
      if (index >= 0) state.jobs[index] = job;
      else state.jobs.unshift(job);
      const statusChanged = previousStatus !== job.status;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const active = document.activeElement;
        const typing = active && (active.id === 'prompt-editor' || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');
        if (state.route === 'studio') {
          // 进度事件只打局部补丁；整页重画就是“屏幕一直闪”的原因
          const terminal = job.status === 'success' || job.status === 'failed' || job.status === 'canceled';
          const applyStudio = async () => {
            // 出片的那一刻以服务端为准再取一次，确保 outputs 已经在手上
            if (terminal) { try { await refreshJobs(); } catch { /* ignore */ } }
            const signature = studioStageSignature();
            if (!typing && signature !== studioSignatureCache) {
              studioSignatureCache = signature;
              render();
            } else {
              // 正在打字时不敢整页重画，但成片必须立刻露出来
              // 分镜目录里的「生成中 / 完成」也要跟着变（尤其是别的分镜在跑），只重画目录那几行
              if (statusChanged) { try { WB.paintSidebar('video'); } catch { /* ignore */ } }
              studioStageMediaPatch();
              studioLivePatch();
              updateStatus();
            }
          };
          applyStudio();
          return;
        }
        if (state.route === 'jobs' || state.route === 'logs') render();
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
  const act = el.querySelector('.wmd-svc-act, .wmd-svc-power');
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
    const el = document.querySelector('.wmd-svc-item[data-svc="' + name + '"]');
    if (!el) continue;
    const info = list[name] || { ok: false };
    el.classList.toggle('is-ok', !!info.ok);
    el.classList.toggle('is-bad', !info.ok);
    const label = name === 'agent' ? '智能体' : '管理器';
    const act = el.querySelector('.wmd-svc-act, .wmd-svc-power');
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

const AUTH_ARROW = '<svg class="auth-arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10.5 5.4L15.6 10l-5.1 4.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const AUTH_EYE = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5.2 8-5.2S18 10 18 10s-3 5.2-8 5.2S2 10 2 10z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="2.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

/** 登录页输入框：标签 + 玻璃输入框，密码框带显隐按钮。 */
function authField({ id, label, type = 'text', placeholder, autocomplete, eye = false }) {
  return `<label class="auth-field">
      <span>${label}</span>
      <span class="auth-input">
        <input class="input" id="${id}" type="${type}" placeholder="${placeholder}" autocomplete="${autocomplete}" />
        ${eye ? `<button type="button" class="auth-eye" data-eye="${id}" aria-label="显示密码" title="显示 / 隐藏密码">${AUTH_EYE}</button>` : ''}
      </span>
    </label>`;
}

/** 登录页的空间概览：默认租户名 + 成员数 + 项目数（数字来自 /api/auth/me）。 */
function authSpaceLine() {
  const space = state.auth && state.auth.space;
  if (!space) return '<p class="auth-space" id="auth-space" hidden></p>';
  const label = space.tenants > 1 ? space.tenants + ' 个租户' : (space.tenantName || '默认租户');
  return `<p class="auth-space" id="auth-space">
      <span>空间 <b>${esc(label)}</b></span>
      <span>成员 <b>${Number(space.members) || 0}</b></span>
      <span>项目 <b>${Number(space.projects) || 0}</b></span>
    </p>`;
}

/** 登录 / 邀请 / 重置共用的暗场外壳（片场静帧背景 + 居中玻璃卡）。 */
function authShell({ title, hint, hintId, fields, submit, note, space = false }) {
  return `<div class="auth-screen">
    <div class="auth-bg" aria-hidden="true"></div>
    <div class="auth-grain" aria-hidden="true"></div>
    <header class="auth-top">
      <div class="auth-logo"><span class="auth-mark">Y9</span><b>WENYUN.M-DESKTOP</b></div>
      <span class="auth-top-meta">CREATIVE DESK · 本机创作台</span>
    </header>
    <main class="auth-main">
      <p class="auth-eyebrow"><i></i>SCENE 01 · TAKE 01<i></i></p>
      <h1 class="auth-title">把一句话，<em>做成一部片</em></h1>
      <p class="auth-lead">剧本 · 分镜 · 图像 · 视频，一条流水线跑到底</p>
      <form class="auth-card" id="auth-form" autocomplete="on">
        <div class="auth-card-top">
          <span class="auth-chip"><i></i>本机账号</span>
          <span class="auth-code">SECURE</span>
        </div>
        <h2 class="auth-card-title">${title}</h2>
        <p class="auth-card-hint"${hintId ? ` id="${hintId}"` : ''}>${hint}</p>
        <div class="auth-fields">${fields}</div>
        <div class="auth-error" id="auth-error" role="alert"></div>
        <button class="auth-submit" type="submit" id="auth-submit"><span>${submit}</span>${AUTH_ARROW}</button>
        <p class="auth-note">${note}</p>
      </form>
      ${space ? authSpaceLine() : ''}
    </main>
    <footer class="auth-foot">
      <span>WENYUN PICTURES · 素材与成片留在本机</span>
      <span>35MM · ANAMORPHIC · 24 FPS</span>
    </footer>
  </div>`;
}

/** 密码显隐。 */
function bindAuthUi(root) {
  if (!root) return;
  root.querySelectorAll('[data-eye]').forEach((btn) => {
    btn.onclick = () => {
      const input = root.querySelector('#' + btn.dataset.eye);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('is-on', show);
      btn.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
      input.focus();
    };
  });
}

function renderLoginScreen() {
  const params = new URLSearchParams(location.search);
  const invite = params.get('invite');
  const reset = params.get('reset');
  if (invite || reset) return renderCodeScreen({ invite, reset });
  const enabled = state.auth && state.auth.enabled;
  const fields = [
    authField({ id: 'auth-user', label: '账号', placeholder: '输入用户名', autocomplete: 'username' }),
    authField({ id: 'auth-pass', label: '密码', type: 'password', placeholder: '输入密码', autocomplete: enabled ? 'current-password' : 'new-password', eye: true }),
    enabled ? '' : authField({ id: 'auth-pass2', label: '确认密码', type: 'password', placeholder: '再输一次密码', autocomplete: 'new-password', eye: true }),
  ].filter(Boolean).join('');
  document.body.innerHTML = authShell({
    title: enabled ? '登录' : '创建账号',
    hint: enabled ? '用管理员分配的账号进入你的片场。' : '第一次使用，先创建本机账号（密码至少 6 位）。',
    fields,
    submit: enabled ? '进入创作台' : '创建并进入',
    note: enabled ? '账号由本机管理员分配；忘记密码请联系管理员重置。' : '第一个创建的账号是平台管理员。',
    space: true,
  });
  bindAuthUi($('#auth-form'));
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
      btn.textContent = enabled ? '进入创作台' : '创建并进入';
    }
  };
  $('#auth-user').focus();
}

/** 邀请链接 / 重置链接落地页：用一次性码创建账号或设置新密码。 */
function renderCodeScreen({ invite, reset }) {
  const isReset = Boolean(reset);
  const code = isReset ? reset : invite;
  const fields = [
    isReset ? '' : authField({ id: 'auth-user', label: '账号', placeholder: '用户名（2–32 位）', autocomplete: 'username' }),
    authField({ id: 'auth-pass', label: isReset ? '新密码' : '密码', type: 'password', placeholder: isReset ? '新密码' : '密码', autocomplete: 'new-password', eye: true }),
    authField({ id: 'auth-pass2', label: '确认密码', type: 'password', placeholder: '再输一次密码', autocomplete: 'new-password', eye: true }),
  ].filter(Boolean).join('');
  document.body.innerHTML = authShell({
    title: isReset ? '设置新密码' : '接受邀请',
    hint: isReset ? '设置后旧会话会全部失效，请用新密码重新登录。' : '读取邀请信息…',
    hintId: 'code-hint',
    fields,
    submit: isReset ? '保存新密码' : '接受邀请并进入',
    note: isReset ? '链接由管理员生成，仅限本机使用。' : '接受邀请后会加入对方的租户空间。',
  });
  bindAuthUi($('#auth-form'));
  if (!isReset) {
    fetch('/api/invites/' + encodeURIComponent(invite)).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '邀请链接无效或已过期');
      const hint = $('#code-hint');
      if (hint) hint.textContent = `加入「${data.data.tenantName || '租户'}」，角色：${TEAM_ROLES[data.data.role] || data.data.role}`;
    }).catch((error) => {
      const hint = $('#code-hint');
      if (hint) hint.textContent = error.message;
      const btn = $('#auth-submit');
      if (btn) btn.disabled = true;
    });
  } else {
    fetch('/api/resets/' + encodeURIComponent(reset)).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '重置链接无效或已过期');
      const hint = $('#code-hint');
      if (hint) hint.textContent = `账号：${data.data.username}。设置后旧会话会全部失效。`;
    }).catch((error) => {
      const hint = $('#code-hint');
      if (hint) hint.textContent = error.message;
      const btn = $('#auth-submit');
      if (btn) btn.disabled = true;
    });
  }
  const form = $('#auth-form');
  form.onsubmit = async (event) => {
    event.preventDefault();
    const password = $('#auth-pass').value;
    const error = $('#auth-error');
    error.textContent = '';
    if (password !== $('#auth-pass2').value) { error.textContent = '两次密码不一致'; return; }
    const btn = $('#auth-submit');
    btn.disabled = true;
    btn.textContent = '处理中…';
    try {
      const body = isReset ? { code, password } : { code, username: $('#auth-user').value.trim(), password };
      const res = await fetch(isReset ? '/api/auth/reset-password' : '/api/auth/accept-invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '失败');
      location.replace(location.pathname);
    } catch (err) {
      error.textContent = err.message;
      btn.disabled = false;
      btn.textContent = isReset ? '保存新密码' : '接受邀请并进入';
    }
  };
  $('#auth-pass').focus();
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
  try {
    localStorage.setItem('wmd.projectId', id);
    localStorage.removeItem('wmd.projectNone');
  } catch { /* ignore */ }
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
  await reloadMediaEpisodes();
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
  if (!btn) return;
  btn.title = '当前项目：' + name + (style ? ' · ' + style : '') + '（点击切换）';
  const label = $('#project-btn-name');
  if (label) label.textContent = name;
}

/* ---------------------------- 顶栏项目下拉：快速切换（不额外请求） ---------------------------- */
// 项目列表在启动时已经拿过（state.projects），这里只负责列出和切换；
// 切换成本 = 重新读当前项目的素材/任务/媒体，跟点「项目」页再进是一样的。
function projectMenuEl() {
  let menu = document.getElementById('project-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'project-menu';
    menu.className = 'wmd-project-menu';
    menu.hidden = true;
    menu.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(menu);
  }
  return menu;
}

function closeProjectMenu() {
  const menu = document.getElementById('project-menu');
  if (menu) menu.hidden = true;
  const btn = $('#project-btn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

async function openProjectMenu() {
  const menu = projectMenuEl();
  const btn = $('#project-btn');
  const list = state.projects || [];
  const current = state.projectId;
  menu.innerHTML = `
    <div class="wmd-pm-head">切换项目<small>${list.length} 个</small></div>
    <div class="wmd-pm-list" role="listbox" aria-label="项目列表">
      ${list.length ? list.map((p) => `<button type="button" class="wmd-pm-item${p.id === current ? ' is-on' : ''}" data-project-id="${esc(p.id)}" role="option" aria-selected="${p.id === current}">
          <span class="wmd-pm-name">${esc(p.name)}</span>
          <span class="wmd-pm-style">${p.style ? esc(p.style.name) : '探索模式'}</span>
          ${p.id === current ? '<em>当前</em>' : ''}
        </button>`).join('') : '<p class="wmd-pm-empty">还没有项目</p>'}
    </div>
    <div class="wmd-pm-foot">
      <button type="button" data-pm-act="new">＋ 新建项目</button>
      <button type="button" data-pm-act="manage">管理项目</button>
    </div>`;
  const rect = btn.getBoundingClientRect();
  menu.hidden = false;
  menu.style.top = Math.round(rect.bottom + 6) + 'px';
  menu.style.right = Math.max(8, Math.round(window.innerWidth - rect.right)) + 'px';
  btn.setAttribute('aria-expanded', 'true');

  menu.querySelectorAll('[data-project-id]').forEach((item) => {
    item.onclick = async () => {
      const id = item.dataset.projectId;
      if (id === state.projectId) return closeProjectMenu();
      if (item.dataset.busy) return;
      item.dataset.busy = '1';
      item.classList.add('is-busy');
      try {
        await setActiveProject(id);
        closeProjectMenu();
        toast('已切换到「' + ((state.project && state.project.name) || '') + '」');
      } catch (err) {
        item.classList.remove('is-busy');
        delete item.dataset.busy;
        toast('切换失败：' + err.message, true);
      }
    };
  });
  const newBtn = menu.querySelector('[data-pm-act="new"]');
  if (newBtn) newBtn.onclick = () => { closeProjectMenu(); openProjectDialog(null); };
  const manageBtn = menu.querySelector('[data-pm-act="manage"]');
  if (manageBtn) manageBtn.onclick = () => { closeProjectMenu(); location.hash = '#projects'; };
}

function bindProjectMenu(btn) {
  if (!btn) return;
  btn.onclick = (event) => {
    event.stopPropagation();
    const menu = projectMenuEl();
    if (menu.hidden) openProjectMenu();
    else closeProjectMenu();
  };
  document.addEventListener('click', () => closeProjectMenu());
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeProjectMenu(); });
  window.addEventListener('resize', () => closeProjectMenu());
}

const PJ_ICON = {
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 8.4l3 3 6.2-6.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 4.6A1.6 1.6 0 013.8 3h1.9l1.3 1.7h5.2a1.6 1.6 0 011.6 1.6v4.9a1.6 1.6 0 01-1.6 1.6H3.8a1.6 1.6 0 01-1.6-1.6z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.2" y="5.2" width="7.6" height="7.6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.4 5.2V4A1.4 1.4 0 009 2.6H4A1.4 1.4 0 002.6 4v5A1.4 1.4 0 004 10.4h1.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.6 2.9l2.5 2.5-7 7-3.3.8.8-3.3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.6h10M6.3 4.6V3.3h3.4v1.3M4.4 4.6l.6 8.1h6l.6-8.1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7.2" cy="7.2" r="3.9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.2 10.2L13.4 13.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.4v9.2M3.4 8h9.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

/** 项目目录只显示最后一段，完整路径放在 title / 复制按钮里。 */
function projectDirLabel(project) {
  const full = String((project && project.dir) || '');
  const base = full.split(/[\\/]/).filter(Boolean).pop();
  return base || (project && project.folder) || '';
}

function renderProjects() {
  const user = state.auth && state.auth.user;
  const list = state.projects || [];
  // 当前项目排最前面，其余保持接口顺序
  const ordered = list.slice().sort((a, b) => (b.id === state.projectId ? 1 : 0) - (a.id === state.projectId ? 1 : 0));
  const current = list.find((p) => p.id === state.projectId);
  const cards = ordered.map((p) => {
    const on = p.id === state.projectId;
    const dirLabel = projectDirLabel(p);
    const hay = [p.name, p.description, p.dir, p.style && p.style.name].filter(Boolean).join(' ').toLowerCase();
    const cover = p.style && p.style.image
      ? `<img class="project-cover" src="${styleImageUrl({ id: p.styleId, image: p.style.image })}" alt="" loading="lazy" />`
      : '<div class="project-cover project-cover-explore">🧭</div>';
    return `<article class="project-card${on ? ' is-on' : ''}" data-pid="${esc(p.id)}" data-search="${esc(hay)}" title="${esc(p.dir || p.name)}">
      <div class="project-cover-wrap">${cover}${on ? `<span class="project-badge">${PJ_ICON.check}当前项目</span>` : ''}</div>
      <div class="project-body">
        <div class="project-title">
          <b>${esc(p.name)}</b>
          <span class="project-style">${p.style ? esc(p.style.name) : '探索模式'}</span>
        </div>
        ${p.description ? `<p class="project-desc">${esc(p.description)}</p>` : ''}
        ${p.dir ? `<div class="project-dir">${PJ_ICON.folder}<span>${esc(dirLabel)}</span><button type="button" class="project-copy" data-act="copy-path" data-path="${esc(p.dir)}" title="复制项目路径">${PJ_ICON.copy}</button></div>` : ''}
        <div class="project-actions">
          <button type="button" class="pj-btn pj-btn-open${on ? ' pj-btn-primary' : ''}" data-act="open-project" data-id="${esc(p.id)}">进入创作台</button>
          <button type="button" class="pj-icon" data-act="edit-project" data-id="${esc(p.id)}" title="编辑项目" aria-label="编辑项目">${PJ_ICON.edit}</button>
          <button type="button" class="pj-icon pj-icon-danger" data-act="delete-project" data-id="${esc(p.id)}" title="删除项目" aria-label="删除项目">${PJ_ICON.trash}</button>
        </div>
      </div>
    </article>`;
  }).join('');
  return `<div class="projects-page">
    <header class="projects-hero">
      <div class="projects-hero-top">
        <div class="projects-hero-main">
          <p class="projects-eyebrow">CREATIVE DESK · 项目</p>
          <h1>项目</h1>
          <p class="projects-sub">一个项目 = 独立目录 + 一套风格。绑定风格会自动注入风格前置，也可以选「探索模式」自由生成。</p>
        </div>
        <div class="projects-hero-actions">
          ${user ? `<span class="projects-user"><i>${esc(String(user.username || '?').slice(0, 1).toUpperCase())}</i>${esc(user.username)}</span>` : ''}
          ${state.auth && state.auth.enabled ? `<button type="button" class="pj-btn" data-act="logout">退出登录</button>` : ''}
          <button type="button" class="pj-btn pj-btn-primary" data-act="new-project">${PJ_ICON.plus}新建项目</button>
        </div>
      </div>
      <div class="projects-toolbar">
        <span class="projects-count" id="projects-count">共 ${list.length} 个项目${current ? ` · 当前 ${esc(current.name)}` : ''}</span>
        <label class="projects-search">${PJ_ICON.search}<input type="search" id="projects-search" placeholder="搜索项目名称、风格或路径" autocomplete="off" /></label>
      </div>
    </header>
    <div class="projects-grid" id="projects-grid">
      ${cards}
      <button type="button" class="project-new" data-act="new-project">
        <span class="project-new-icon">${PJ_ICON.plus}</span>
        <span class="project-new-text"><b>新建项目</b><small>绑定风格，或从探索模式开始</small></span>
      </button>
    </div>
    <p class="projects-empty" id="projects-empty" hidden>没有匹配的项目，换个关键词试试。</p>
    <p class="projects-foot">图片、素材和成片都落在各自项目目录里；点卡片任意位置即可进入该项目。</p>
  </div>`;
}

function bindProjects(root) {
  if (!root) return;

  async function openById(id) {
    if (!id) return;
    await setActiveProject(id);
    if (location.hash === '#projects') location.hash = '#image';
    else setRoute();
  }

  // 搜索：纯前端过滤卡片，不发请求；Esc 清空
  const search = root.querySelector('#projects-search');
  const counter = root.querySelector('#projects-count');
  const emptyTip = root.querySelector('#projects-empty');
  const newTile = root.querySelector('.project-new');
  const cards = () => Array.from(root.querySelectorAll('.project-card'));
  if (search) {
    const baseCount = counter ? counter.textContent : '';
    const filter = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      cards().forEach((card) => {
        const hit = !q || (card.dataset.search || '').includes(q);
        card.hidden = !hit;
        if (hit) shown += 1;
      });
      if (newTile) newTile.hidden = Boolean(q);
      if (emptyTip) emptyTip.hidden = shown > 0;
      if (counter) counter.textContent = q ? `匹配 ${shown} / 共 ${cards().length} 个项目` : baseCount;
    };
    search.addEventListener('input', filter);
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      search.value = '';
      filter();
    });
  }

  root.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-act]');
    if (!btn) {
      // 点卡片空白处 = 进入该项目
      const card = event.target.closest('.project-card');
      if (!card || !card.dataset.pid) return;
      try { await openById(card.dataset.pid); } catch (err) { toast(err.message, true); }
      return;
    }
    const act = btn.dataset.act;
    try {
      if (act === 'new-project') return openProjectDialog(null);
      if (act === 'copy-path') {
        const value = btn.dataset.path || '';
        try {
          await navigator.clipboard.writeText(value);
          toast('项目路径已复制');
        } catch (err) {
          toast('复制失败：' + value, true);
        }
        return;
      }
      if (act === 'edit-project') {
        const project = (state.projects || []).find((p) => p.id === btn.dataset.id);
        return openProjectDialog(project);
      }
      if (act === 'open-project') {
        await openById(btn.dataset.id);
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
          localStorage.removeItem('wmd.projectId');
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


async function askOpenProjectPicker() {
  if (askState().generating) return toast('请等待当前任务完成，再切换项目', true);
  await loadProjects();
  openModal('<div class="agent-project-picker">'
    +'<div class="app-picker-search"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7.1" cy="7.1" r="4.5"/><path d="M10.5 10.5 13.9 13.9"/></svg><input id="agent-project-search" placeholder="搜索项目" aria-label="搜索项目" /></div>'
    +'<div id="agent-project-options" role="listbox" aria-label="已有项目"></div>'
    +'<div class="app-picker-foot">'
    +'<button type="button" id="agent-project-new"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.6v8.8M3.6 8h8.8"/></svg>新建项目</button>'
    +'<button type="button" id="agent-project-none"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>不在项目中工作</button>'
    +'</div></div>');
  const trigger=document.querySelector('.ask-project-trigger').getBoundingClientRect();
  const panel=$('#modal-panel');panel.classList.add('modal-project-picker');
  panel.style.setProperty('--project-picker-left',Math.max(12,Math.min(trigger.left,window.innerWidth-412))+'px');
  panel.style.setProperty('--project-picker-bottom',Math.max(12,window.innerHeight-trigger.top+6)+'px');
  let cursor=0;
  const suffixOf=(p)=>{const seg=String(p.dir||'').replaceAll(String.fromCharCode(92),'/').split('/').filter(Boolean).pop()||'';return seg&&seg!==p.name?seg:'';};
  const draw=()=>{
    const q=$('#agent-project-search').value.trim().toLowerCase();
    $('#agent-project-options').innerHTML=(state.projects||[]).filter(p=>p.name.toLowerCase().includes(q)).map(p=>{
      const selected=p.id===state.projectId;const suffix=suffixOf(p);
      return '<button type="button" role="option" aria-selected="'+selected+'" data-project-select="'+esc(p.id)+'" title="'+esc(p.dir||p.name)+'">'
        +'<span class="app-picker-ico">'+AP_FOLDER_SVG+'</span>'
        +'<span class="app-picker-name">'+esc(p.name)+'</span>'
        +(suffix?'<small>'+esc(suffix)+'</small>':'')
        +(selected?'<b>✓</b>':'')
        +'</button>';
    }).join('')||'<p class="hint">没有匹配的项目</p>';
    document.querySelectorAll('#agent-project-options [data-project-select]').forEach(btn=>btn.onclick=async()=>{try{await setActiveProject(btn.dataset.projectSelect);closeModal();}catch(e){toast(e.message,true);}});
    const list=projectRows();
    const active=list.findIndex((btn)=>btn.getAttribute('aria-selected')==='true');
    cursor=active>=0?active:0;
    paintCursor();
  };
  const projectRows=()=>Array.from(document.querySelectorAll('#agent-project-options [data-project-select]'));
  const paintCursor=()=>projectRows().forEach((btn,i)=>btn.classList.toggle('is-cursor',i===cursor));
  $('#agent-project-search').oninput=()=>{cursor=0;draw();};
  $('#agent-project-search').onkeydown=(event)=>{
    const list=projectRows();
    if(!list.length)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      cursor=(cursor+(event.key==='ArrowDown'?1:list.length-1))%list.length;
      paintCursor();
      list[cursor].scrollIntoView({block:'nearest'});
    }else if(event.key==='Enter'){
      event.preventDefault();
      (list[cursor]||list[0]).click();
    }
  };
  $('#agent-project-new').onclick=()=>askCreateProjectDialog();
  $('#agent-project-none').onclick=async()=>{
    try{
      await api('/api/auth/project',{method:'POST',body:{projectId:''}});
      try{localStorage.removeItem('wmd.projectId');localStorage.setItem('wmd.projectNone','1');}catch{/* ignore */}
      closeModal();
      location.reload();
    }catch(e){toast(e.message,true);}
  };
  draw();$('#agent-project-search').focus();
}
const AP_FOLDER_SVG='<svg class="ap-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.9 4.6A1.6 1.6 0 0 1 3.5 3h2.4c.43 0 .84.17 1.14.47L8.2 4.9h4.3a1.6 1.6 0 0 1 1.6 1.6v4.9a1.6 1.6 0 0 1-1.6 1.6h-9a1.6 1.6 0 0 1-1.6-1.6z"/></svg>';
function askCreateProjectDialog() {
  let folders=[],browsing=false;
  openModal('<div class="agent-project-create">'
    +'<div class="apc-head"><h2>创建项目</h2><button type="button" class="apc-close" data-close="1" aria-label="关闭">×</button></div>'
    +'<div class="apc-field"><svg class="apc-input-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.9 4.6A1.6 1.6 0 0 1 3.5 3h2.4c.43 0 .84.17 1.14.47L8.2 4.9h4.3a1.6 1.6 0 0 1 1.6 1.6v4.9a1.6 1.6 0 0 1-1.6 1.6h-9a1.6 1.6 0 0 1-1.6-1.6z"/></svg>'
    +'<input id="agent-project-name" maxlength="60" placeholder="项目名称" aria-label="项目名称" /></div>'
    +'<div class="apc-label">源文件夹</div>'
    +'<div class="apc-source" id="agent-source-box"><div id="agent-source-list"></div></div>'
    +'<div class="apc-foot"><button type="button" class="apc-ghost" data-close="1">取消</button><button type="button" class="apc-primary" id="agent-project-create">创建项目</button></div>'
    +'</div>');
  const draw=()=>{
    const list=$('#agent-source-list');
    if(!folders.length){
      list.innerHTML='<div class="apc-empty">'
        +'<div class="apc-empty-text">在此电脑上添加文件夹<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></div>'
        +'<button type="button" class="apc-add" id="agent-folder-add"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.6v8.8M3.6 8h8.8"/></svg>添加</button>'
        +'</div>';
    }else{
      list.innerHTML=folders.map((p,i)=>'<div class="agent-source-row"><span title="'+esc(p)+'"><b>'+esc(p.replaceAll(String.fromCharCode(92),'/').split('/').filter(Boolean).pop())+'</b><small>'+esc(p)+'</small></span>'+(i===0?'<small class="apc-tag">主要</small>':'<button type="button" class="apc-mini" data-primary="'+i+'">设为主要</button>')+'<button type="button" class="apc-x" data-remove="'+i+'" aria-label="移除文件夹">×</button></div>').join('')
        +'<button type="button" class="apc-add-row" id="agent-folder-add"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.6v8.8M3.6 8h8.8"/></svg>添加文件夹</button>';
    }
    document.querySelectorAll('#agent-source-list [data-remove]').forEach(b=>b.onclick=()=>{folders.splice(Number(b.dataset.remove),1);draw();});
    document.querySelectorAll('#agent-source-list [data-primary]').forEach(b=>b.onclick=()=>{folders.unshift(folders.splice(Number(b.dataset.primary),1)[0]);draw();});
    const add=$('#agent-folder-add');if(add)add.onclick=()=>browse();
  };
  const browse=async()=>{
    if(browsing)return;
    browsing=true;const add=$('#agent-folder-add');if(add){add.disabled=true;add.textContent='等待系统选择文件夹…';}
    try{
      const data=await api('/api/project-folders/pick',{method:'POST',body:{}});
      if(data.path&&!folders.some(p=>p.toLowerCase()===data.path.toLowerCase()))folders.push(data.path);
    }catch(e){toast(e.message,true);}finally{browsing=false;if($('#agent-source-list'))draw();}
  };
  $('#agent-project-create').onclick=async()=>{
    const name=$('#agent-project-name').value.trim();
    if(!name)return toast('请填写项目名称',true);
    if(!folders.length)return toast('请添加至少一个源文件夹',true);
    if(browsing)return toast('请先完成文件夹选择',true);
    const button=$('#agent-project-create');button.disabled=true;
    try{const saved=await api('/api/projects',{method:'POST',body:{name,sourceFolders:folders}});await loadProjects();await setActiveProject(saved.id);closeModal();toast('项目已创建');}catch(e){button.disabled=false;toast(e.message,true);}
  };
  draw();$('#agent-project-name').focus();
}

function openProjectDialog(project) {
  const list = state.styles || [];
  let selected = project ? project.styleId || '' : '';
  const isEdit = !!project;
  openModal(`
    <div class="modal-head"><h2>${isEdit ? '编辑项目' : '新建项目'}</h2><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button></div>
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
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">取消</button>
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-primary" id="project-save">${isEdit ? '保存' : '创建'}</button>
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
    <div class="modal-head"><h2>保存图片</h2><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button></div>
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
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">取消</button>
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-primary" id="img-save-go">保存</button>
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
    const stored = localStorage.getItem('wmd.workflowId');
    const storedWidth = Number(localStorage.getItem('wmd.panelWidth')) || 0;
    if (storedWidth) state.studio.panelWidth = storedWidth;
    // 默认渠道以「设置 → 视频生成」里标的默认为准，其次是上次选择；有管理器渠道时不再回落到官网 API。
    const videoChannels = (state.channels.video || []).filter((c) => c.enabled !== false);
    const activeVideo = (state.channels.video || []).find((c) => c.active && c.enabled !== false);
    const managerWf = activeVideo ? state.workflows.find((w) => w.channelId === activeVideo.id) : null;
    let wf = managerWf
      || workflowById(stored)
      || workflowById(data.defaultWorkflowId)
      || state.workflows[0];
    if (wf && wf.provider === 'autodl' && !wf.channelId && videoChannels.length) {
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
    try { storedProject = localStorage.getItem('wmd.projectId') || ''; } catch { storedProject = ''; }
    let noProject = false;
    try { noProject = localStorage.getItem('wmd.projectNone') === '1'; } catch { noProject = false; }
    // 优先用本机记住的项目；其次用服务端记的「这个用户上次在哪」；最后才落到最新项目
    const activeProject = noProject ? null : (
      (state.projects || []).find((p) => p.id === storedProject)
      || (state.projects || []).find((p) => p.id === data.projectId)
      || (state.projects || [])[0]
      || null
    );
    if (activeProject) await setActiveProject(activeProject.id, { silent: true });
    else { state.projectId = ''; state.project = null; await studioLoadForProject('default'); await WB.load('default'); }
    applyTheme();
    setRoute();
    state.assets = await api('/api/assets');
    state.media = await api('/api/media');
    await reloadMediaEpisodes();
    state.imageHistory = await api('/api/images/history').then((d) => d.items || []).catch(() => []);
    if (!WB.current('image') && (state.image.results || []).length === 0 && state.imageHistory[0] && state.imageHistory[0].items) {
      state.image.results = state.imageHistory[0].items;
      state.image.previewIndex = 0;
      if (state.imageHistory[0].prompt) state.image.prompt = state.imageHistory[0].prompt;
    }
    try {
      const storedJob = localStorage.getItem('wmd.lastJobId') || '';
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
    // 服务刚重启时第一次探测可能还没起来，3 秒后补一次，别让左下角一直红着
    setTimeout(refreshServices, 3000);
    setInterval(refreshServices, 20000);
    bindProjectMenu($('#project-btn'));
    applyProjectChip();
    const agentItem = document.querySelector('.wmd-svc-item[data-svc="agent"]');
    if (agentItem) agentItem.onclick = () => toggleService('agent', agentItem);
    const managerItem = document.querySelector('.wmd-svc-item[data-svc="manager"]');
    if (managerItem) {
      // 左下角只有一个状态点：单击启停（打开管理器工作台走双击）
      managerItem.onclick = () => toggleService('manager', managerItem);
      const power = managerItem.querySelector('.wmd-svc-power');
      if (power) power.onclick = (event) => { event.stopPropagation(); toggleService('manager', managerItem); };
      const label = managerItem.querySelector('.wmd-svc-label');
      if (label) label.onclick = () => openManagerPage(managerItem);
    }
  } catch (err) {
    if (/请先登录/.test(err.message)) return renderLoginScreen();
    document.body.innerHTML = `<div class="empty" style="height:100vh;justify-content:center"><strong>无法连接 WENYUN.M-DESKTOP 服务</strong><p>${esc(err.message)}</p></div>`;
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

/* 页面开着很久时，服务端可能已经换了新前端资源：发现指纹变了就提示刷新一次，
   免得一直对着旧样式看（静态资源是 no-store，刷新即生效）。 */
let askWebVersionStamp = '';
let askWebVersionTimer = null;

async function checkWebVersion() {
  try {
    const res = await fetch('/api/web-version', { cache: 'no-store' });
    const payload = await res.json().catch(() => null);
    const version = payload && payload.ok && payload.data && payload.data.version;
    if (!version) return;
    if (!askWebVersionStamp) { askWebVersionStamp = version; return; }
    if (version !== askWebVersionStamp) showOutdatedBadge();
  } catch { /* 服务重启中或离线，下次再查 */ }
}

function showOutdatedBadge() {
  if (document.getElementById('web-outdated')) return;
  const btn = document.createElement('button');
  btn.id = 'web-outdated';
  btn.type = 'button';
  btn.textContent = '界面已更新 · 点此刷新';
  btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;height:32px;padding:0 14px;border:1px solid rgba(0,0,0,.16);border-radius:16px;background:#fff;color:#111;font:12px/1 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.16);cursor:pointer;';
  btn.onclick = () => location.reload();
  document.body.appendChild(btn);
}

function startWebVersionWatch() {
  checkWebVersion();
  clearInterval(askWebVersionTimer);
  askWebVersionTimer = setInterval(checkWebVersion, 60000);
  window.addEventListener('focus', checkWebVersion);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkWebVersion(); });
}

init();
startWebVersionWatch();






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





