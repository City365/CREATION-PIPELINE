'use strict';

/* app.assets.js — 素材
 * 由 web/app.js 按原段注释切分而来（第 2612–3524 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */

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
