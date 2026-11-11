'use strict';

/* app.init.js — init / 账号 / 项目
 * 由 web/app.js 按原段注释切分而来（第 12483–13618 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */

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
