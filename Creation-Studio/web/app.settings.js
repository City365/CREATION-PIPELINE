'use strict';

/* app.settings.js — 设置
 * 由 web/app.js 按原段注释切分而来（第 11286–12482 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */

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
