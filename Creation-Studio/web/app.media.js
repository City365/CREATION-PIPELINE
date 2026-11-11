'use strict';

/* app.media.js — 媒体库
 * 由 web/app.js 按原段注释切分而来（第 3525–4094 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */

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
