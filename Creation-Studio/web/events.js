'use strict';
/* 任务事件：列表 / 详情 / 创建（P1 最小闭环） */
const Events = (() => {
  let timer = null;
  let lastSignature = '';
  let modalEventId = null;
  const STATUS = { draft: '待调度', unscheduled: '待调度', scheduled: '待执行', queued: '待执行', running: '执行中', paused: '暂停', completed: '完成', partial: '部分失败', failed: '失败', canceled: '已取消', interrupted: '待确认', unknown: '待确认' };
  const TASK_STATUS = { draft: '待运行', unscheduled: '待运行', scheduled: '待运行', queued: '待运行', running: '运行中', paused: '已停止', completed: '已完成', partial: '部分失败', failed: '已失败', canceled: '已取消', interrupted: '已停止', unknown: '已停止' };
  const SOURCE = { batch: '批量导入', studio: '创作台', image: '图像台', api: '接口' };
  const ITEM = { queued: '排队', running: '执行中', success: '完成', failed: '失败', canceled: '已取消', skipped: '跳过', unknown: '未知', paused: '暂停' };

  function typingInTaskPanel() {
    const el = document.activeElement;
    return !!(el && el.closest && el.closest('#task-panel') && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  }

  async function load(options = {}) {
    const pendingRender = !!state.eventRenderPending;
    // 调度页优先显示还没排时间的任务：默认的“运行时间倒序”会把待调度任务排到最后一页，
    // 于是刚建完的任务在调度页上看不见。
    const sortMode = state.taskTab === 'schedule' ? 'pending_first' : (state.taskEventSort || 'runtime_desc');
    try {
      const data = await api('/api/events?kind='+encodeURIComponent(taskMedia())+'&status='+encodeURIComponent(state.taskEventStatus||'')+'&query='+encodeURIComponent(state.taskEventQuery||'')+'&month='+encodeURIComponent(state.taskEventMonth||'')+'&sort='+encodeURIComponent(sortMode)+'&page='+((state.taskPages||{}).events||1));
      const events = data.events || [];
      const signature = JSON.stringify(data.stats)+JSON.stringify([data.page,data.total,taskMedia(),state.taskEventStatus||'',state.taskEventQuery||'',state.taskEventMonth||'',sortMode])+JSON.stringify(events.map((e) => [e.id, e.status, e.stats && e.stats.done, e.stats && e.stats.total, e.stats && e.stats.failed, e.stats && e.stats.running, e.title]));
      const changed = signature !== lastSignature;
      lastSignature = signature;
      state.events = events;
      state.eventStats = data.stats || null;
      state.eventPaging = {total:data.total,page:data.page,pageSize:data.pageSize};
      const hadError = Boolean(state.eventError);
      state.eventError = data.schedulerError || null;
      if (!changed && !hadError && !pendingRender) return;
    } catch (err) {
      state.events = state.events || [];
      state.eventError = err.message;
    }
    if (state.route !== 'tasks' || !['manage','schedule','monitor','logs'].includes(currentTaskTab())) return;
    // 自动刷新时如果用户正在输入，只更新数据，等下一次（失焦后）再重绘，避免焦点和输入被抢走。
    if (options.keepFocus && typingInTaskPanel()) { state.eventRenderPending = true; return; }
    state.eventRenderPending = false;
    window.render();
  }

  const fmtMs = (ms) => ms == null ? '—' : (ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's');

  const fmtSize = (bytes) => {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB';
    return (value / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  };

  function badge(status) {
    const cls = status === 'completed' ? 'ok' : status === 'failed' ? 'bad' : status === 'running' ? 'info' : '';
    return `<span class="badge ${cls}">${esc(STATUS[status] || status)}</span>`;
  }

  function taskBadge(status) {
    const cls = status === 'completed' ? 'ok' : ['failed', 'partial'].includes(status) ? 'bad' : ['running'].includes(status) ? 'info' : ['paused', 'interrupted'].includes(status) ? 'warn' : '';
    return `<span class="badge ${cls}">${esc(TASK_STATUS[status] || status)}</span>`;
  }

  function shortText(value, length = 10) {
    const chars = Array.from(String(value || ''));
    return chars.slice(0, length).join('') + (chars.length > length ? '…' : '');
  }

  function duration(event) {
    const start = event.startedAt;
    if (!start) return '—';
    let end;
    if (['completed', 'failed', 'partial', 'canceled', 'interrupted'].includes(event.status)) {
      const lastFinished = (event.items || []).map((item) => item.finishedAt).filter(Boolean).sort().pop();
      end = event.finishedAt || lastFinished || event.updatedAt || Date.now();
    } else if (event.status === 'paused') {
      const pausedAt = (event.audit || []).filter((row) => row.action === 'pause').map((row) => Number(row.at)).filter(Boolean).sort().pop();
      end = pausedAt || event.finishedAt || start;
    } else {
      end = Date.now();
    }
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    if (seconds < 60) return seconds + 's';
    return Math.floor(seconds / 60) + 'm' + String(seconds % 60).padStart(2, '0') + 's';
  }

  /** 运行时间：已开始的取实际开始时间，未开始的取计划运行时间。 */
  function runAt(event) {
    const value = event.startedAt || event.schedule?.startAt || null;
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function runTimeText(event) {
    const date = runAt(event);
    return date ? date.toLocaleString('zh-CN', { hour12: false }) : '—';
  }

  function render(mode = 'manage') {
    const events = state.events || [];
    const page = taskPagination(events, 'events', state.eventPaging);
    const rows = page.rows.map((event) => {
      const s = event.stats || {};
      const progress = s.total ? Math.round(((s.done || 0) / s.total) * 100) : 0;
      const scheduleReady = !(event.draft || event.pendingSchedule);
      const scheduleText = event.schedule?.startAt ? '已配置 · ' + new Date(event.schedule.startAt).toLocaleString('zh-CN', { hour12: false }) : '已配置';
      const actions = [];
      if (['queued', 'running'].includes(event.status)) actions.push(`<button class="btn sm ghost" data-event-action="pause" data-id="${esc(event.id)}">暂停</button>`);
      if (event.status === 'paused') actions.push(`<button class="btn sm ghost" data-event-action="resume" data-id="${esc(event.id)}">继续</button>`);
      if (['draft', 'unscheduled', 'scheduled', 'queued', 'running', 'paused'].includes(event.status)) actions.push(`<button class="btn sm ghost" data-event-action="cancel" data-id="${esc(event.id)}">取消</button>`);
      if (['draft', 'unscheduled', 'canceled', 'completed', 'failed', 'partial', 'interrupted'].includes(event.status)) actions.push(`<button class="btn sm ghost danger" data-event-delete="${esc(event.id)}">删除</button>`);
      actions.push(`<button class="btn sm" data-event-detail="${esc(event.id)}">详情</button>`);
      return `<tr class="evt-row" data-event-open="${esc(event.id)}">
        <td class="evt-id" data-label="任务ID"><span class="mono" title="${esc(event.id)}">${esc(event.id)}</span></td>
        <td data-label="任务名称"><div class="evt-title" title="${esc(event.title)}">${esc(shortText(event.title, 10))}</div></td>
        <td data-label="调度状态">${scheduleReady ? `<span class="hint">${esc(scheduleText)}</span>` : `<button class="btn sm ghost" data-event-schedule="${esc(event.id)}">配置</button>`}</td>
        <td data-label="状态">${taskBadge(event.status)}</td>
        <td data-label="任务进度"><div class="evt-progress"><span style="width:${progress}%"></span></div><div class="hint">${s.done || 0}/${s.total || 0}</div></td>
        <td class="hint" data-label="运行时间">${runTimeText(event)}</td>
        <td class="tnum" data-label="耗时">${duration(event)}</td>
        <td class="hint" data-label="创建时间">${event.createdAt ? new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
        <td class="evt-actions" data-label="任务操作"><div class="evt-row-actions">${actions.join('')}</div></td>
      </tr>`;
    }).join('');
    const statusOptions = [['','全部状态'],['draft,unscheduled','待调度'],['scheduled,queued','待执行'],['running','执行中'],['paused','暂停'],['completed','完成'],['partial','部分失败'],['failed','失败'],['canceled','已取消'],['interrupted','待确认']];
    const sortOptions = [['runtime_desc','运行时间（新→旧）'],['runtime_asc','运行时间（旧→新）'],['created_desc','最新创建'],['created_asc','最早创建'],['updated_desc','最近更新'],['title_asc','任务名称']];
    return `
    <div class="task-filter-bar">
      <label class="task-filter-field"><span>任务状态</span><select class="select" id="event-status">${statusOptions.map(([value,label])=>`<option value="${value}" ${(state.taskEventStatus||'')===value?'selected':''}>${label}</option>`).join('')}</select></label>
      <label class="task-filter-field"><span>创建时间</span><input class="input" type="month" id="event-month" value="${esc(state.taskEventMonth||'')}"></label>
      <label class="task-filter-field"><span>排序</span><select class="select" id="event-sort">${sortOptions.map(([value,label])=>`<option value="${value}" ${(state.taskEventSort||'runtime_desc')===value?'selected':''}>${label}</option>`).join('')}</select></label>
      <form class="task-filter-search" data-events-search><input class="input" id="event-search" name="query" value="${esc(state.taskEventQuery||'')}" placeholder="任务名称 / ID" aria-label="搜索任务"><button class="btn" type="submit">搜索</button></form>
      <button class="btn sm ghost" type="button" data-event-filter-reset>重置</button>
      <button class="btn sm ghost" type="button" data-event-trash>回收站</button>
      <button class="btn sm" type="button" data-event-manifest>任务清单 JSON</button>
      <span class="task-filter-count">共 ${state.eventPaging?.total || 0} 条</span>
    </div>
    ${state.eventError ? `<div class="card" style="padding:12px;color:var(--wmd-danger)">事件加载失败：${esc(state.eventError)}</div>` : ''}
    ${rows ? `<div class="table-wrap"><table class="jobs evt-table">
      <thead><tr><th>任务ID</th><th>任务名称</th><th>调度状态</th><th>状态</th><th>任务进度</th><th>运行时间</th><th>耗时</th><th>创建时间</th><th>任务操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${page.footer}` : `<div class="card"><div class="empty"><strong>还没有任务</strong><p>在「创建任务」里上传分镜文件并保存，任务会先进入待调度。</p><button class="btn primary" data-event-create="1">去创建任务</button></div></div>`}`;
  }

  /* ---------------- 创建任务：名称 / 渠道 / 视频 / 分镜文件 → 可审阅表格 ---------------- */

  const createDrafts = { video: null, image: null };
  const CREATE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
  const FILE_KIND_LABEL = { json: 'JSON', xlsx: 'Excel', draft: '草稿' };
  const AUDIT_LABEL = { prepare: '保存任务', schedule: '配置调度', queue: '加入队列', pause: '暂停', resume: '继续', cancel: '取消', retry: '重试', skip: '跳过分镜', move: '调整顺序' };

  function workflowFor(id) { return (state.workflows || []).find((w) => w.id === id) || null; }

  function videoChannelList() {
    const list = [];
    for (const channel of state.channels?.video || []) {
      if (channel.enabled === false) continue;
      list.push({ id: 'ch:' + channel.id, name: channel.name });
    }
    return list;
  }

  function videoWorkflows(channelId) {
    if (!channelId) return [];
    const raw = String(channelId).replace(/^ch:/, '');
    return (state.workflows || []).filter((w) => w.channelId === raw);
  }

  function imageChannelList() {
    return (state.channels?.image || []).filter((c) => c.enabled !== false).map((c) => ({ id: c.id, name: c.name }));
  }

  function defaultVideoChannel() {
    const list = videoChannelList();
    const active = (state.channels?.video || []).find((c) => c.active && c.enabled !== false);
    if (active && list.some((c) => c.id === 'ch:' + active.id)) return 'ch:' + active.id;
    return list[0] ? list[0].id : '';
  }

  function defaultWorkflowId(channelId) {
    const list = videoWorkflows(channelId);
    const active = (state.channels?.video || []).find((c) => c.active && c.enabled !== false);
    const match = list.find((w) => w.channelId === active?.id) || list[0];
    return match ? match.id : '';
  }

  function projectPrefix() {
    return String(state.styleDetail?.video || state.styleDetail?.character || '').trim();
  }

  function newDraft(kind) {
    const channelId = kind === 'video' ? defaultVideoChannel() : (imageChannelList()[0]?.id || '');
    return {
      kind,
      editId: '',
      title: '',
      prefixPrompt: projectPrefix(),
      channelId,
      workflowId: kind === 'video' ? defaultWorkflowId(channelId) : '',
      file: null,
      busy: false,
      msg: '',
      requestId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random(),
    };
  }

  function currentDraft() {
    const kind = taskMedia();
    let draft = createDrafts[kind];
    if (!draft || draft.kind !== kind) { draft = newDraft(kind); createDrafts[kind] = draft; }
    return draft;
  }

  function fileLabel(file) {
    const format = FILE_KIND_LABEL[file.format] || String(file.format || '文件');
    const parts = [`${file.stats.items} 个分镜`, `${file.stats.images} 张参考图`];
    return `${format} · ${parts.join(' · ')}`;
  }

  function renderIssues(file) {
    if (!file) return '';
    const errors = file.errors || [];
    const warnings = file.warnings || [];
    const block = (list, cls, title) => (list.length
      ? `<div class="create-issues ${cls}"><b>${esc(title)}</b><ul>${list.map((text) => `<li>${esc(text)}</li>`).join('')}</ul></div>`
      : '');
    return block(errors, '', `${errors.length} 个错误，修正文件后重新上传`) + block(warnings, 'is-warn', `${warnings.length} 个提醒`);
  }

  function channelNameById(id) {
    const channel = videoChannelList().find((c) => c.id === id);
    return channel ? channel.name : '';
  }

  /** 模型名只保留渠道内的短名：同一渠道下的「豆包」「Gemini」不再重复渠道全名。 */
  function shortWorkflowLabel(workflow, channelId) {
    if (!workflow) return '';
    const raw = String(workflow.label || workflow.display || workflow.id);
    const channel = channelNameById(channelId);
    let label = raw;
    if (channel && raw.startsWith(channel)) label = raw.slice(channel.length);
    label = label.replace(/^[\s·|/\\-—]+/, '').trim();
    if (!label) {
      if (workflow.platform === 'doubao') label = '豆包';
      else if (workflow.platform === 'gemini') label = 'Gemini';
      else label = raw;
    }
    return label;
  }

  function availableRatios(draft) {
    if (draft.kind === 'image') return CREATE_RATIOS;
    const workflow = videoWorkflows(draft.channelId).find((w) => w.id === draft.workflowId);
    return (workflow && (workflow.ratios || []).length) ? workflow.ratios : CREATE_RATIOS;
  }

  /** 换渠道 / 模型后，把行里不在新渠道范围内的画幅拉回第一个可用值。 */
  function normalizeRatios(draft) {
    if (!draft.file || !(draft.file.items || []).length) return;
    const ratios = availableRatios(draft);
    for (const item of draft.file.items) {
      if (!ratios.includes(item.ratio)) item.ratio = ratios[0];
    }
  }

  function draftModelLabel(draft) {
    if (draft.kind !== 'video') return '';
    const workflow = videoWorkflows(draft.channelId).find((w) => w.id === draft.workflowId);
    return workflow ? shortWorkflowLabel(workflow, draft.channelId) : '';
  }

  function renderShotTable(draft) {
    const file = draft.file;
    if (!file || !(file.items || []).length) return '';
    const model = draftModelLabel(draft);
    const isImage = draft.kind === 'image';
    const ratios = availableRatios(draft);
    const rows = file.items.map((item, index) => {
      const refs = (item.images || []).map((image, order) => `<span class="shot-ref" title="${esc(image.path || '')}">
        <b>${order + 1}</b><span class="shot-ref-name">${esc(image.name || String(image.path || '').split(/[\\/]/).pop() || '图片')}</span>${image.note ? `<i>${esc(image.note)}</i>` : ''}
        <button type="button" class="shot-ref-x" data-ref-remove="${index}:${order}" title="移除这张参考图">×</button>
      </span>`).join('');
      const extras = Object.entries(item.extra || {}).filter(([, value]) => String(value).trim() !== '');
      return `<tr>
        <td class="tnum">${index + 1}</td>
        <td><input class="input" data-field="title" data-index="${index}" value="${esc(item.title || '')}" placeholder="分镜 ${index + 1}"></td>
        <td><textarea class="textarea" data-field="prompt" data-index="${index}" rows="2" placeholder="这个分镜要生成什么">${esc(item.prompt || '')}</textarea></td>
        <td><select class="select" data-field="ratio" data-index="${index}">${ratios.map((ratio) => `<option value="${esc(ratio)}" ${ratio === (item.ratio || ratios[0]) ? 'selected' : ''}>${esc(ratio)}</option>`).join('')}</select></td>
        <td><input class="input" type="number" min="1" max="15" data-field="duration" data-index="${index}" value="${item.duration || ''}" placeholder="默认"></td>
        ${isImage ? '' : `<td class="shot-model">${esc(model || '—')}</td>`}
        <td class="shot-refs">${refs}${extras.length ? `<div class="shot-extra">扩展：${esc(extras.map(([key, value]) => `${key}=${value}`).join(' · '))}</div>` : ''}${refs ? '' : '<span class="hint">无</span>'}</td>
        <td><button type="button" class="btn sm ghost" data-remove-row="${index}">删除</button></td>
      </tr>`;
    }).join('');
    const tableClass = isImage ? 'is-image' : 'is-video';
    return `<div class="table-wrap create-table-wrap"><table class="jobs create-table ${tableClass}">
      <thead><tr><th>#</th><th>分镜名称</th><th>视频提示词</th><th>视频画幅</th><th>视频时长</th>${isImage ? '' : '<th>使用模型</th>'}<th>参考图（顺序 · 说明）</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div class="create-table-foot"><span class="hint">共 ${file.items.length} 个分镜 · 可直接修改</span><button type="button" class="btn sm ghost" data-tc-add-row>＋ 添加分镜</button></div>`;
  }

  function renderCreate() {
    const draft = currentDraft();
    const kind = draft.kind;
    const file = draft.file;
    const busy = !!draft.busy;
    const channels = kind === 'video' ? videoChannelList() : imageChannelList();
    const models = kind === 'video' ? videoWorkflows(draft.channelId) : [];
    // 一个渠道只有一个模型时不显示「视频模型」，避免重复一栏。
    if (kind === 'video' && models.length === 1 && draft.workflowId !== models[0].id) draft.workflowId = models[0].id;
    const items = (file && file.items) || [];
    const noChannel = !channels.length;
    const canSave = !busy && items.length > 0 && !((file && file.errors) || []).length && !!draft.channelId && (kind !== 'video' || !!draft.workflowId);
    const summary = noChannel
      ? `${kind === 'video' ? '没有可用的视频渠道' : '没有可用的图像渠道'}，请先到 设置 添加`
      : items.length
        ? `${items.length} 个分镜${draftModelLabel(draft) ? ' · ' + esc(draftModelLabel(draft)) : ''}`
        : '还没有上传分镜文件';
    return `<div class="create-page">
      <form class="create-form" id="task-create-form" autocomplete="off">
        <div class="create-head${kind === 'video' && models.length > 1 ? '' : ' is-two'}">
          <label class="create-field"><span>任务名称</span><input class="input" id="tc-title" value="${esc(draft.title)}" placeholder="例如：第 3 集 · 雨夜街头"></label>
          <label class="create-field"><span>${kind === 'video' ? '视频生成渠道' : '图像渠道'}</span><select class="select" id="tc-channel">${channels.map((channel) => `<option value="${esc(channel.id)}" ${channel.id === draft.channelId ? 'selected' : ''}>${esc(channel.name)}</option>`).join('') || '<option value="">没有可用渠道</option>'}</select></label>
          ${kind === 'video' && models.length > 1 ? `<label class="create-field"><span>视频模型</span><select class="select" id="tc-model">${models.map((model) => `<option value="${esc(model.id)}" ${model.id === draft.workflowId ? 'selected' : ''}>${esc(shortWorkflowLabel(model, draft.channelId))}</option>`).join('')}</select></label>` : ''}
        </div>
        <label class="create-field create-prefix"><span>视频前置提示词<em>默认取项目风格，可改</em></span><textarea class="textarea" id="tc-prefix" rows="2" placeholder="风格、画质等，会拼在每条提示词前面">${esc(draft.prefixPrompt || '')}</textarea></label>
        <section class="create-import" id="tc-import">
          <div class="create-import-head">
            <b>分镜文件</b>
            <a class="btn sm" href="/api/task-import/template?format=json" download="task-template.json">JSON 示例</a>
            <a class="btn sm" href="/api/task-import/template?format=xlsx" download="task-template.xlsx">Excel 示例</a>
            <label class="btn sm primary">选择文件<input type="file" id="tc-file" accept=".json,.xlsx" hidden></label>
            <span class="hint">${busy ? '正在解析…' : (file ? esc(file.name) + ' · ' + esc(fileLabel(file)) : '支持 .json / .xlsx，解析后直接改表格')}</span>
          </div>
          ${file || busy ? '' : '<label class="create-drop" id="tc-drop"><span>把分镜文件拖到这里，或点「选择文件」</span><small>JSON / Excel 均可</small></label>'}
          ${renderIssues(file)}
          ${renderShotTable(draft)}
          <p class="create-msg" id="tc-msg">${esc(draft.msg || '')}</p>
          <div class="create-actions">
            <div class="create-summary" id="tc-summary">${summary}</div>
            <div class="create-action-buttons">
              ${draft.editId ? '<button type="button" class="btn ghost" data-tc-cancel-edit>放弃修改</button>' : ''}
              <button type="button" class="btn primary" data-tc-save ${canSave ? '' : 'disabled'}>${draft.editId ? '保存修改' : '保存任务'}</button>
            </div>
          </div>
        </section>
      </form>
    </div>`;
  }

  function readCreateHead(root) {
    const draft = currentDraft();
    const title = root.querySelector('#tc-title');
    const channel = root.querySelector('#tc-channel');
    const model = root.querySelector('#tc-model');
    const prefix = root.querySelector('#tc-prefix');
    if (title) draft.title = title.value;
    if (channel) draft.channelId = channel.value;
    if (model) draft.workflowId = model.value;
    if (prefix) draft.prefixPrompt = prefix.value;
    if (!draft.workflowId && draft.channelId) draft.workflowId = defaultWorkflowId(draft.channelId);
    if (draft.msg) { draft.msg = ''; const box = root.querySelector('#tc-msg'); if (box) box.textContent = ''; }
    return draft;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { const text = String(reader.result || ''); resolve(text.slice(text.indexOf(',') + 1)); };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
  }

  async function loadImportFile(file) {
    if (!/\.(json|xlsx)$/i.test(file.name || '')) { failCreate('只支持 .json 或 .xlsx 文件'); return; }
    const draft = currentDraft();
    draft.busy = true;
    draft.msg = '';
    window.render();
    try {
      const data = await fileToBase64(file);
      const parsed = await api('/api/task-import/parse', { method: 'POST', body: { name: file.name, data } });
      const target = currentDraft();
      target.file = parsed;
      target.busy = false;
      if (draft.kind === 'video' && !(parsed.errors || []).length && (parsed.items || []).length) {
        target.msg = `解析完成，共 ${parsed.items.length} 个镜头；保存任务后才会同步到素材库`;
      }
    } catch (err) {
      const target = currentDraft();
      target.busy = false;
      target.file = null;
      target.msg = err.message;
    }
    window.render();
  }

  function buildTaskPayload(draft) {
    const file = draft.file;
    if (!file) throw new Error('先上传分镜文件');
    if ((file.errors || []).length) throw new Error(`文件还有 ${file.errors.length} 个错误，修正后重新上传`);
    const items = file.items || [];
    if (!items.length) throw new Error('文件里没有分镜');
    if (!draft.channelId) throw new Error(draft.kind === 'video' ? '请选择视频生成渠道' : '请选择图像渠道');
    if (draft.kind === 'video' && !draft.workflowId) throw new Error('请选择视频模型');
    normalizeRatios(draft);
    const workflow = draft.kind === 'video' ? workflowFor(draft.workflowId) : null;
    const defaultDuration = Number(workflow?.durationDefault) || 10;
    const fallbackRatio = String(workflow?.defaultRatio || (workflow?.ratios || [])[0] || '16:9');
    const projectStyleId = String(state.project?.styleId || state.project?.style?.id || '').trim();
    const rows = items.map((item, index) => {
      const prompt = String(item.prompt || '').trim();
      if (!prompt) throw new Error(`第 ${index + 1} 个分镜缺提示词`);
      const images = (item.images || []).filter((image) => image && image.path)
        .map((image) => ({ path: image.path, name: image.name || '', note: image.note || '' }));
      const title = String(item.title || '').trim() || undefined;
      const ratio = item.ratio || fallbackRatio;
      if (draft.kind === 'image') {
        return { title, prompt, prefixPrompt: String(draft.prefixPrompt || '').trim() || String(item.prefixPrompt || '').trim() || undefined, styleId: projectStyleId || undefined, styleLayer: 'image', refs: images, imageRatio: ratio, aspectRatio: ratio, imageLayoutId: 'free', count: 1, channelId: draft.channelId };
      }
      return {
        title, prompt, prefixPrompt: String(draft.prefixPrompt || '').trim() || String(item.prefixPrompt || '').trim() || undefined, styleId: projectStyleId || undefined, styleLayer: 'video', images,
        duration: Math.max(1, Math.min(15, Number(item.duration) || defaultDuration)),
        ratio,
        aspectRatio: ratio,
        workflowId: draft.workflowId,
      };
    });
    const title = String(draft.title || '').trim() || '未命名任务';
    return {
      kind: draft.kind,
      title,
      source: rows.length > 1 ? 'batch' : (draft.kind === 'image' ? 'image' : 'studio'),
      items: rows,
      pendingSchedule: true,
      draft: false,
      requestId: draft.requestId,
      ...(draft.kind === 'video' ? { workflowId: draft.workflowId } : { channelId: draft.channelId }),
      projectId: state.projectId || '',
    };
  }

  async function saveTask(root) {
    const draft = readCreateHead(root);
    draft.msg = '';
    let payload;
    try { payload = buildTaskPayload(draft); }
    catch (err) { failCreate(err.message); return; }
    const buttons = root.querySelectorAll('[data-tc-save]');
    buttons.forEach((button) => { button.disabled = true; });
    try {
      let savedEvent;
      if (draft.editId) {
        await api('/api/events/' + encodeURIComponent(draft.editId) + '/draft', { method: 'POST', body: { title: payload.title, items: payload.items } });
        savedEvent = await api('/api/events/' + encodeURIComponent(draft.editId) + '/prepare', { method: 'POST', body: {} });
      } else {
        savedEvent = await api('/api/events', { method: 'POST', body: payload });
      }
      if (payload.kind === 'video' && savedEvent) {
        try {
          const synced = await api('/api/assets/shots/import', { method: 'POST', body: {
            taskId: savedEvent.id,
            taskTitle: savedEvent.title || payload.title,
            items: payload.items,
            source: draft.file?.name || '',
          } });
          state.assetLibrary = await api('/api/assets/library');
          if ((synced.warnings || []).length) toast(synced.warnings[0], true);
        } catch (err) {
          toast('任务已保存，但素材库同步失败：' + err.message, true);
        }
      }
      createDrafts[draft.kind] = null;
      lastSignature = '';
      state.taskEventStatus = '';
      state.taskEventQuery = '';
      state.taskEventMonth = '';
      state.taskEventSort = 'runtime_desc';
      state.taskPages = { ...(state.taskPages || {}), events: 1 };
      state.taskTab = 'schedule';
      localStorage.setItem('wmd.tasks.tab', 'schedule');
      await load();
      window.render();
      toast('任务已保存，去调度页设置运行时间');
    } catch (err) {
      failCreate(err.message);
    }
  }

  function failCreate(message) {
    currentDraft().msg = String(message || '保存失败');
    window.render();
    const box = document.querySelector('#tc-msg');
    if (box) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function bindCreate(root) {
    const form = root.querySelector('#task-create-form');
    if (!form) return;
    form.addEventListener('submit', (event) => event.preventDefault());
    form.addEventListener('input', (event) => {
      const target = event.target;
      const index = Number(target.dataset.index);
      if (target.dataset.field && Number.isInteger(index)) {
        const draft = currentDraft();
        const item = draft.file?.items?.[index];
        if (item) {
          const field = target.dataset.field;
          item[field] = field === 'duration' ? (target.value ? Number(target.value) : null) : target.value;
        }
        return;
      }
      if (target.id === 'tc-title' || target.id === 'tc-channel' || target.id === 'tc-model' || target.id === 'tc-prefix') readCreateHead(root);
    });
    form.addEventListener('change', (event) => {
      const target = event.target;
      if (target.id === 'tc-channel') {
        const draft = readCreateHead(root);
        draft.channelId = target.value;
        draft.workflowId = defaultWorkflowId(draft.channelId);
        normalizeRatios(draft);
        window.render();
        return;
      }
      if (target.id === 'tc-model') {
        readCreateHead(root);
        normalizeRatios(currentDraft());
        window.render();
      }
    });
    form.addEventListener('click', (event) => {
      const save = event.target.closest('[data-tc-save]');
      if (save) { saveTask(root).catch((err) => failCreate(err.message)); return; }
      const add = event.target.closest('[data-tc-add-row]');
      if (add) {
        const draft = currentDraft();
        if (!draft.file) return;
        draft.file.items.push({ title: '', prompt: '', images: [], duration: null, ratio: availableRatios(draft)[0] });
        window.render();
        return;
      }
      const removeRow = event.target.closest('[data-remove-row]');
      if (removeRow) {
        const draft = currentDraft();
        draft.file.items.splice(Number(removeRow.dataset.removeRow), 1);
        window.render();
        return;
      }
      const removeRef = event.target.closest('[data-ref-remove]');
      if (removeRef) {
        const [row, order] = String(removeRef.dataset.refRemove).split(':').map(Number);
        const draft = currentDraft();
        const item = draft.file?.items?.[row];
        if (item && item.images) item.images.splice(order, 1);
        window.render();
        return;
      }
      const cancelEdit = event.target.closest('[data-tc-cancel-edit]');
      if (cancelEdit) { createDrafts[currentDraft().kind] = null; window.render(); }
    });
    const input = form.querySelector('#tc-file');
    if (input) input.addEventListener('change', function onChange() {
      const file = this.files && this.files[0];
      if (file) loadImportFile(file).catch((err) => failCreate(err.message));
      this.value = '';
    });
    const drop = form.querySelector('#tc-drop') || form.querySelector('#tc-import');
    if (drop) {
      drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (event) => {
        event.preventDefault();
        drop.classList.remove('is-over');
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) loadImportFile(file).catch((err) => failCreate(err.message));
      });
    }
  }

  /* ---------------- 调度页：只分「未分配 / 已分配」 ---------------- */

  function taskErrorBanner() {
    return state.eventError ? `<div class="card" style="padding:12px;color:var(--wmd-danger)">任务加载失败：${esc(state.eventError)}</div>` : '';
  }

  function scheduleRows(events, assigned) {
    if (!events.length) return `<div class="card schedule-empty"><div class="empty"><strong>${assigned ? '没有已分配的任务' : '没有待调度的任务'}</strong><p>${assigned ? '在未分配里配置运行时间后，任务会出现在这里。' : '在创建页保存任务后，它会出现在这里等待调度。'}</p></div></div>`;
    const rows = events.map((event) => {
      const when = event.schedule?.startAt ? new Date(event.schedule.startAt).toLocaleString('zh-CN', { hour12: false }) : (assigned ? '立即执行' : '未设置');
      const running = event.status === 'running';
      const canCancel = ['draft', 'unscheduled', 'scheduled', 'queued', 'paused'].includes(event.status);
      const canDelete = ['draft', 'unscheduled'].includes(event.status);
      return `<tr>
        <td data-label="任务"><div class="evt-title">${esc(event.title)}</div><div class="hint">${esc(event.id)}</div></td>
        <td data-label="分镜">${event.stats?.total || event.itemCount || 0} 个分镜</td>
        <td data-label="运行时间">${esc(when)}</td>
        <td class="tnum" data-label="次序">${Number(event.schedule?.order) || 0}</td>
        <td data-label="并发">${Number(event.policy?.concurrency) || 1}</td>
        <td data-label="失败处理">${event.policy?.onItemFail === 'stop' ? '失败即停' : '继续'}</td>
        <td class="evt-actions" data-label="操作">
          ${running ? '<span class="hint">执行中</span>' : `<button class="btn sm" data-event-schedule="${esc(event.id)}">${assigned ? '修改调度' : '配置调度'}</button>`}
          ${canCancel ? `<button class="btn sm ghost" data-event-action="cancel" data-id="${esc(event.id)}">取消</button>` : ''}
          ${canDelete ? `<button class="btn sm ghost" data-event-delete="${esc(event.id)}">删除</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="jobs schedule-table"><thead><tr><th>任务</th><th>分镜</th><th>运行时间</th><th>次序</th><th>并发</th><th>失败处理</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderSchedule() {
    const page = taskPagination(state.events || [], 'events', state.eventPaging);
    const events = page.rows;
    const stats = state.eventStats || {};
    const unassigned = events.filter((event) => ['unscheduled', 'draft'].includes(event.status));
    const assigned = events
      .filter((event) => ['scheduled', 'queued', 'running', 'paused'].includes(event.status))
      .sort((a, b) => (Number(a.schedule?.order) || 0) - (Number(b.schedule?.order) || 0)
        || String(a.schedule?.startAt || '').localeCompare(String(b.schedule?.startAt || '')));
    const unassignedTotal = (stats.unscheduled || 0) + (stats.draft || 0);
    const assignedTotal = (stats.scheduled || 0) + (stats.queued || 0) + (stats.running || 0) + (stats.paused || 0);
    return `${taskErrorBanner()}<div class="schedule-page">
      <section class="schedule-block"><div class="task-panel-head"><div><h2>未分配 <span class="count">${unassignedTotal}</span></h2><p>刚保存的任务，还没有运行时间。</p></div></div>${scheduleRows(unassigned, false)}</section>
      <section class="schedule-block"><div class="task-panel-head"><div><h2>已分配 <span class="count">${assignedTotal}</span></h2><p>已经排好运行时间的任务；这里不显示执行过程。</p></div></div>${scheduleRows(assigned, true)}</section>
    </div>${page.footer}`;
  }

  /* ---------------- 监控页：配置操作 + 每个条目的执行记录 ---------------- */

  function durationText(event) {
    const start = event.startedAt;
    if (!start) return '—';
    const end = event.finishedAt || Date.now();
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    if (seconds < 60) return seconds + 's';
    return Math.floor(seconds / 60) + 'm' + String(seconds % 60).padStart(2, '0') + 's';
  }

  function itemStatusBadge(status) {
    const label = ITEM[status] || status;
    const cls = status === 'success' ? 'ok' : status === 'failed' ? 'bad' : status === 'running' ? 'info' : '';
    return `<span class="badge ${cls}">${esc(label)}</span>`;
  }

  function renderMonitor() {
    const page = taskPagination(state.events || [], 'events', state.eventPaging);
    const events = page.rows;
    if (!events.length) return `${taskErrorBanner()}<div class="card"><div class="empty"><strong>还没有可监控的任务</strong><p>任务开始执行后，这里会记录每一步的配置和结果。</p></div></div>`;
    const rows = events.map((event) => {
      const when = event.schedule?.startAt ? new Date(event.schedule.startAt).toLocaleString('zh-CN', { hour12: false }) : '立即';
      const error = event.lastError || '';
      return `<tr>
        <td data-label="状态">${badge(event.status)}</td>
        <td data-label="任务"><div class="evt-title">${esc(event.title)}</div><div class="hint">${esc(event.id)}</div></td>
        <td data-label="调度配置"><div class="hint">并发 ${Number(event.policy?.concurrency) || 1} · ${event.policy?.onItemFail === 'stop' ? '失败即停' : '失败继续'}</div><div class="hint">${esc(when)}</div></td>
        <td data-label="开始时间">${event.startedAt ? new Date(event.startedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
        <td class="tnum" data-label="耗时">${durationText(event)}</td>
        <td data-label="条目">${event.stats?.done || 0}/${event.stats?.total || 0}${event.stats?.failed ? ` · <span class="is-danger">失败 ${event.stats.failed}</span>` : ''}</td>
        <td class="hint" data-label="错误 / 警告">${error ? esc((event.errorCount ? event.errorCount + ' 个 · ' : '') + error) : '—'}</td>
        <td data-label="操作"><button class="btn sm" data-event-attempts="${esc(event.id)}">执行记录</button></td>
      </tr>`;
    }).join('');
    return `${taskErrorBanner()}<div class="table-wrap"><table class="jobs monitor-table"><thead><tr><th>状态</th><th>任务</th><th>调度配置</th><th>开始时间</th><th>耗时</th><th>条目</th><th>错误 / 警告</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${page.footer}`;
  }

  async function openAttempts(id) {
    const event = await api('/api/events/' + encodeURIComponent(id));
    const auditRows = (event.audit || []).map((entry) => `<li><span class="hint">${new Date(entry.at).toLocaleString('zh-CN', { hour12: false })}</span> ${esc(AUDIT_LABEL[entry.action] || entry.action)}${entry.detail ? ' · ' + esc(entry.detail) : ''}</li>`).join('') || '<li class="hint">还没有配置操作。</li>';
    const panel = openModal(`<div class="modal-head"><div><h2>执行记录</h2><div class="hint">${esc(event.title)} · ${esc(event.id)}</div></div><button class="btn ghost sm" data-close="1">关闭</button></div>
      <div class="modal-body monitor-modal">
        <div class="monitor-config">
          <div><span>运行时间</span><b>${event.schedule?.startAt ? new Date(event.schedule.startAt).toLocaleString('zh-CN', { hour12: false }) : '立即'}</b></div>
          <div><span>并发</span><b>${Number(event.policy?.concurrency) || 1}</b></div>
          <div><span>失败处理</span><b>${event.policy?.onItemFail === 'stop' ? '失败即停' : '继续执行'}</b></div>
          <div><span>任务状态</span><b>${esc(STATUS[event.status] || event.status)}</b></div>
        </div>
        <div class="monitor-two-col">
          <section class="monitor-block"><div class="evt-section-head"><h3>配置操作</h3><span class="hint">${(event.audit || []).length} 条</span></div><ul class="monitor-audit">${auditRows}</ul></section>
          <section class="monitor-block"><div class="evt-section-head"><h3>执行记录</h3><span class="hint">按运行时间倒序</span></div><div id="attempt-wrap"><div class="hint">加载中…</div></div></section>
        </div>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>`);
    panel.classList.add('modal-wide');
    const wrap = document.querySelector('#attempt-wrap');
    const renderPage = async (page) => {
      wrap.innerHTML = '<div class="hint">加载中…</div>';
      let data;
      try { data = await api('/api/events/' + encodeURIComponent(id) + '/attempts?page=' + page); }
      catch (err) { wrap.innerHTML = `<div class="hint">${esc(err.message)}</div>`; return; }
      const attemptRows = (data.items || []).flatMap((group) => group.attempts.map((attempt) => `<tr>
        <td>${esc(group.title)}</td>
        <td>${itemStatusBadge(attempt.status)}</td>
        <td class="hint">${attempt.startedAt ? new Date(attempt.startedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
        <td class="tnum">${attempt.startedAt ? Math.max(0, Math.round(((attempt.finishedAt || Date.now()) - attempt.startedAt) / 1000)) + 's' : '—'}</td>
        <td class="hint"><div class="monitor-cell-error" title="${esc(attempt.error || '')}">${esc(attempt.error || '—')}</div></td>
      </tr>`)).join('') || '<tr><td colspan="5" class="hint">还没有执行记录。</td></tr>';
      const pages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 10)));
      const button = (label, target, disabled) => `<button class="btn sm" data-attempt-page="${target}" ${disabled ? 'disabled' : ''}>${label}</button>`;
      const pager = pages > 1 ? `<nav class="task-pagination"><span>共 ${data.total} 条 · 第 ${data.page} / ${pages} 页</span><div>${button('上一页', data.page - 1, data.page <= 1)}${button('下一页', data.page + 1, data.page >= pages)}</div></nav>` : '';
      wrap.innerHTML = `<div class="table-wrap monitor-attempt-table"><table class="jobs"><thead><tr><th>分镜</th><th>状态</th><th>开始</th><th>耗时</th><th>错误</th></tr></thead><tbody>${attemptRows}</tbody></table></div>${pager}`;
      wrap.querySelectorAll('[data-attempt-page]').forEach((btn) => { btn.onclick = () => renderPage(Number(btn.dataset.attemptPage)); });
    };
    await renderPage(1);
  }

  /* ---------------- 日志页：每个小任务的运行状态与结果 ---------------- */

  function renderLogs() {
    const page = taskPagination(state.events || [], 'events', state.eventPaging);
    const events = page.rows;
    if (!events.length) return `${taskErrorBanner()}<div class="card"><div class="empty"><strong>还没有任务日志</strong><p>任务执行后，每个分镜的状态和结果都会记录在这里。</p></div></div>`;
    const rows = events.map((event) => `<tr>
      <td data-label="任务"><div class="evt-title">${esc(event.title)}</div><div class="hint">${esc(event.id)}</div></td>
      <td data-label="状态">${badge(event.status)}</td>
      <td data-label="进度">${event.stats?.done || 0}/${event.stats?.total || 0}</td>
      <td data-label="结果">${event.stats?.success || 0} 成功 · ${event.stats?.failed || 0} 失败${event.stats?.unknown ? ` · ${event.stats.unknown} 未知` : ''}</td>
      <td data-label="开始">${event.startedAt ? new Date(event.startedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
      <td class="tnum" data-label="耗时">${durationText(event)}</td>
      <td data-label="操作"><button class="btn sm" data-event-log-view="${esc(event.id)}">查看分镜日志</button></td>
    </tr>`).join('');
    return `${taskErrorBanner()}<div class="table-wrap"><table class="jobs log-table"><thead><tr><th>任务</th><th>状态</th><th>进度</th><th>结果</th><th>开始</th><th>耗时</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${page.footer}`;
  }

  async function openLogs(id) {
    const event = await api('/api/events/' + encodeURIComponent(id));
    const rows = (event.items || []).map((item) => `<tr>
      <td>${esc(item.title || item.refId)}<div class="hint">${esc(item.refType)} · ${esc(item.refId || '')}</div></td>
      <td>${itemStatusBadge(item.status)}</td>
      <td class="hint">${item.startedAt ? new Date(item.startedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
      <td class="tnum">${item.startedAt ? Math.max(0, Math.round(((item.finishedAt || Date.now()) - item.startedAt) / 1000)) + 's' : '—'}</td>
      <td class="hint">${esc(item.error || '—')}</td>
      <td><button class="btn sm" data-event-item-log="${esc(item.id)}" ${item.refId ? '' : 'disabled'}>日志</button></td>
    </tr>`).join('');
    const panel = openModal(`<div class="modal-head"><div><h2>分镜日志</h2><div class="hint">${esc(event.title)} · ${esc(event.id)}</div></div><button class="btn ghost sm" data-close="1">关闭</button></div>
      <div class="modal-body monitor-modal">
        <div class="monitor-config">
          <div><span>任务状态</span><b>${esc(STATUS[event.status] || event.status)}</b></div>
          <div><span>进度</span><b>${event.stats?.done || 0} / ${event.stats?.total || 0}</b></div>
          <div><span>成功</span><b>${event.stats?.success || 0}</b></div>
          <div><span>失败</span><b>${event.stats?.failed || 0}</b></div>
        </div>
        <section class="monitor-block"><div class="evt-section-head"><h3>分镜状态</h3><span class="hint">点击「日志」查看完整输出</span></div><div class="table-wrap monitor-log-table"><table class="jobs"><thead><tr><th>分镜</th><th>状态</th><th>开始</th><th>耗时</th><th>错误</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>
        <section class="monitor-block"><div id="evt-item-log" class="evt-item-log-panel"><div class="hint">点击表格里的「日志」查看执行输出。</div></div></section>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>`);
    panel.classList.add('modal-wide');
    const box = panel.querySelector('#evt-item-log');
    panel.querySelectorAll('[data-event-item-log]').forEach((button) => {
      button.onclick = async () => {
        try {
          const data = await api('/api/events/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(button.dataset.eventItemLog) + '/log');
          box.innerHTML = '<div class="evt-section-head"><h3>' + esc(data.item?.title || data.item?.refId || '执行日志') + '</h3><span class="hint">' + ((data.lines || []).length) + ' 行</span></div>' + ((data.lines || []).length
            ? '<pre class="evt-log">' + esc(data.lines.map((line) => (line.t ? new Date(line.t).toLocaleTimeString('zh-CN', { hour12: false }) + ' ' : '') + (line.level || 'info') + ' ' + (line.text || '')).join('\n')) + '</pre>'
            : '<div class="hint">没有日志记录。</div>');
        } catch (err) { toast(err.message, true); }
      };
    });
  }

  async function confirmDelete(id) {
    const event = await api('/api/events/' + encodeURIComponent(id));
    openModal(`<div class="modal-head"><h2>删除任务</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body"><p>确定删除「${esc(event.title || event.id)}」？</p><p class="hint">删除后任务会进回收站，可以随时恢复；已生成的成片文件不会删除。</p></div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">取消</button><button class="btn danger" id="evt-delete-confirm">删除</button></div>`);
    document.querySelector('#evt-delete-confirm').onclick = async () => {
      try {
        await api('/api/events/' + encodeURIComponent(id), { method: 'DELETE' });
        closeModal();
        lastSignature = '';
        state.taskPages = { ...(state.taskPages || {}), events: 1 };
        await load();
        window.render();
        toast('任务已删除', false, {
          label: '撤销',
          timeout: 12000,
          onClick: async () => {
            await api('/api/events/trash/restore', { method: 'POST', body: { id } });
            lastSignature = '';
            await load();
            window.render();
            toast('任务已恢复');
          },
        });
      } catch (err) { toast(err.message, true); }
    };
  }

  async function openTrashModal() {
    const data = await api('/api/events/trash');
    const rows = (data.items || []).map((row) => `<tr>
      <td class="mono">${esc(row.id)}</td>
      <td>${esc(shortText(row.title || '未命名任务', 16))}</td>
      <td>${esc(row.status || '')}</td>
      <td class="tnum">${row.items || 0}</td>
      <td class="hint">${row.removedAt ? new Date(row.removedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
      <td><button class="btn sm" data-trash-restore="${esc(row.id)}">恢复</button></td>
    </tr>`).join('');
    openModal(`<div class="modal-head"><h2>回收站</h2><span class="hint">删掉的任务留在这里，恢复后连分镜和执行记录一起回来</span><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body">${rows ? `<div class="table-wrap"><table class="jobs"><thead><tr><th>任务ID</th><th>任务名称</th><th>状态</th><th>分镜</th><th>删除时间</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty"><strong>回收站是空的</strong><p>删除的任务会先放这里，确认不要了再清空目录即可。</p></div>'}</div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>`);
    document.querySelectorAll('[data-trash-restore]').forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          await api('/api/events/trash/restore', { method: 'POST', body: { id: button.dataset.trashRestore } });
          closeModal();
          lastSignature = '';
          await load();
          window.render();
          toast('任务已恢复');
        } catch (err) { button.disabled = false; toast(err.message, true); }
      };
    });
  }

  async function openSchedule(id) {
    const event = await api('/api/events/' + encodeURIComponent(id));
    const globalCap = Number(state.config && state.config.concurrency) || 3;
    const local = event.schedule?.startAt ? new Date(event.schedule.startAt) : null;
    const pad = (n) => String(n).padStart(2, '0');
    const value = local ? `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}` : '';
    openModal(`<div class="modal-head"><h2>配置调度</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body">
        <div class="schedule-form">
          <label>运行时间<input class="input" id="evt-start" type="datetime-local" value="${value}" placeholder="留空 = 立即执行"></label>
          <label>并发数量<select class="select" id="evt-concurrency">${Array.from({ length: 10 }, (_, index) => index + 1).map((n) => `<option value="${n}" ${n === (event.policy?.concurrency || 1) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>失败处理<select class="select" id="evt-fail"><option value="continue" ${event.policy?.onItemFail !== 'stop' ? 'selected' : ''}>继续执行其它分镜</option><option value="stop" ${event.policy?.onItemFail === 'stop' ? 'selected' : ''}>失败即停止后续</option></select></label>
          <label>执行次序<input class="input" id="evt-order" type="number" value="${event.schedule?.order || 0}"></label>
        </div>
        <p class="hint">运行时间留空表示保存后立即执行；指定时间则进入「待执行」，到点自动开始。单个任务最多同时运行 10 个分镜；当前全局并发上限为 ${globalCap}（可在「设置 → 并发上限」调到 10），实际同时执行数不会超过这个值。</p>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn primary" id="evt-schedule-save">保存调度</button></div>`);
    document.querySelector('#evt-schedule-save').onclick = async () => {
      try {
        const start = document.querySelector('#evt-start').value;
        await api('/api/events/' + encodeURIComponent(id) + '/schedule', {
          method: 'POST',
          body: {
            order: Number(document.querySelector('#evt-order').value) || 0,
            startAt: start ? new Date(start).toISOString() : null,
            concurrency: Number(document.querySelector('#evt-concurrency').value) || 1,
            onItemFail: document.querySelector('#evt-fail').value,
          },
        });
        closeModal();
        lastSignature = '';
        await load();
        window.render();
        toast('调度已保存');
      } catch (err) { toast(err.message, true); }
    };
  }

  function resetForProject() {
    state.events = null;
    state.eventStats = null;
    state.eventPaging = null;
    state.eventError = null;
    state.taskEventStatus = '';
    state.taskEventQuery = '';
    state.taskEventMonth = '';
    state.taskEventSort = 'runtime_desc';
    state.taskPages = {};
    state.eventRenderPending = false;
    createDrafts.video = null;
    createDrafts.image = null;
    lastSignature = '';
    state.taskTab = 'manage';
    try { localStorage.setItem('wmd.tasks.tab', 'manage'); } catch { /* ignore */ }
    if (document.querySelector('#modal:not([hidden])')) closeModal();
  }

  function draftFromEvent(event) {
    const kind = event.kind === 'image' ? 'image' : 'video';
    const draft = newDraft(kind);
    draft.editId = event.id;
    draft.title = event.title || '';
    const inputs = (event.items || []).map((item) => item.input || {})?.filter((input) => input && (input.prompt || input.userPrompt)) || [];
    draft.prefixPrompt = String(inputs[0]?.prefixPrompt || '') || projectPrefix();
    const first = inputs[0] || {};
    const spec = event.spec || {};
    if (kind === 'video') {
      const workflowId = spec.workflowId || first.workflowId || '';
      if (workflowId) {
        const workflow = workflowFor(workflowId);
        draft.workflowId = workflowId;
        draft.channelId = workflow?.channelId ? 'ch:' + workflow.channelId : (defaultVideoChannel() || '');
      }
    } else {
      draft.channelId = spec.channelId || first.channelId || draft.channelId;
    }
    draft.file = {
      format: 'draft',
      name: '已保存草稿',
      stats: {
        items: inputs.length,
        images: inputs.reduce((sum, input) => sum + (input.images || input.refs || []).length, 0),
        ok: true,
      },
      errors: [],
      warnings: [],
      items: inputs.map((input) => ({
        title: input.title || '',
        prompt: String(input.userPrompt || input.prompt || ''),
        images: (Array.isArray(input.images) ? input.images : Array.isArray(input.refs) ? input.refs : []).map((image) => ({ path: image.path, name: image.name || '', note: image.note || '' })),
        duration: input.duration || null,
        ratio: input.aspectRatio || input.imageRatio || '16:9',
        extra: input.extra || {},
      })),
    };
    return draft;
  }

  async function openCreatePage(id) {
    if (id) {
      const event = await api('/api/events/' + encodeURIComponent(id));
      const kind = event.kind === 'image' ? 'image' : 'video';
      createDrafts[kind] = draftFromEvent(event);
      if (taskMedia() !== kind) { state.taskMedia = kind; localStorage.setItem('wmd.tasks.media', kind); }
      state.taskEventStatus = '';
      state.taskEventQuery = '';
      state.taskEventMonth = '';
      state.taskEventSort = 'runtime_desc';
    } else if (!createDrafts[taskMedia()]) {
      createDrafts[taskMedia()] = newDraft(taskMedia());
    }
    state.taskTab = 'create';
    localStorage.setItem('wmd.tasks.tab', 'create');
    if (document.querySelector('#modal:not([hidden])')) closeModal();
    window.render();
  }

  function closeDrawer(immediate = false) {
    const drawer = document.getElementById('evt-drawer');
    if (!drawer) return;
    drawer.classList.remove('is-open');
    if (immediate) drawer.remove();
    else setTimeout(() => drawer.remove(), 180);
    if (!document.querySelector('#modal:not([hidden])')) document.body.style.overflow = '';
  }

  /* ---------------- 成片右键菜单：播放 / 重命名 / 替换 / 删除 ---------------- */

  let ctxMenuNode = null;
  function closeContextMenu() {
    if (!ctxMenuNode) return;
    ctxMenuNode.remove();
    ctxMenuNode = null;
  }

  function openContextMenu(x, y, items) {
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.innerHTML = items.map((item, index) => (item.sep
      ? '<div class="ctx-sep"></div>'
      : `<button type="button" class="${item.danger ? 'is-danger' : ''}" data-ctx="${index}">${esc(item.label)}</button>`)).join('');
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
    const close = () => {
      closeContextMenu();
      document.removeEventListener('click', onDoc, true);
      document.removeEventListener('contextmenu', onDoc, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
    const onDoc = (evt) => { if (!menu.contains(evt.target)) close(); };
    const onKey = (evt) => { if (evt.key === 'Escape') close(); };
    menu.querySelectorAll('[data-ctx]').forEach((button) => {
      button.onclick = () => {
        const item = items[Number(button.dataset.ctx)];
        close();
        if (item && item.onSelect) item.onSelect();
      };
    });
    setTimeout(() => {
      document.addEventListener('click', onDoc, true);
      document.addEventListener('contextmenu', onDoc, true);
      document.addEventListener('keydown', onKey);
      window.addEventListener('scroll', close, true);
    }, 0);
    ctxMenuNode = menu;
  }

  function pickLocalVideo(onPick) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files && input.files[0];
      input.remove();
      if (file) onPick(file);
    };
    document.body.append(input);
    input.click();
  }

  async function uploadOutput(jobId, action, outPath, file) {
    const query = new URLSearchParams({ name: file.name });
    if (outPath) query.set('path', outPath);
    const res = await fetch('/api/jobs/' + encodeURIComponent(jobId) + '/output/' + action + '?' + query.toString(), {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'video/mp4' },
      body: file,
    });
    const payload = await res.json().catch(() => null);
    if (!payload || !payload.ok) throw new Error((payload && payload.error) || `上传失败 HTTP ${res.status}`);
    return payload.data;
  }

  /** 换/补成片时先选来源：本地文件，或从豆包对话里提取。 */
  function openOutputSourcePicker(context) {
    const { jobId, outPath, title, onDone } = context;
    if (!jobId) { toast('这条分镜还没有提交记录，先重试生成一次', true); return; }
    const action = outPath ? '替换成片' : '上传成片';
    const panel = openModal(`<div class="modal-head">
        <div><h2>${action}</h2><div class="hint">${esc(title || '这条分镜')} · 选一个来源</div></div>
        <span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button>
      </div>
      <div class="modal-body">
        <div class="source-choice">
          <button type="button" class="source-card" id="source-local">
            <b>本地文件</b>
            <span class="hint">从电脑里选一个视频（原文件不动，复制进任务目录）</span>
          </button>
          <button type="button" class="source-card" id="source-doubao">
            <b>豆包链接提取</b>
            <span class="hint">粘贴对话链接 + 选账号，把对话里生成的原始视频抓下来</span>
          </button>
        </div>
        <p class="hint">${outPath ? '替换后旧成片会挪进项目的 <code>media/_trash/</code>，需要时还能找回。' : '上传的视频会登记成这条分镜的成片。'}</p>
      </div>`);
    panel.classList.add('modal-wide');
    panel.querySelector('#source-local').onclick = () => {
      closeModal();
      pickLocalVideo(async (file) => {
        try {
          await uploadOutput(jobId, outPath ? 'replace' : 'add', outPath || '', file);
          toast(outPath ? '成片已替换' : '成片已上传');
          if (onDone) onDone();
        } catch (error) { toast(error.message, true); }
      });
    };
    panel.querySelector('#source-doubao').onclick = () => {
      closeModal();
      openExtractDialog({ jobId, outPath, title, onDone }).catch((error) => toast(error.message, true));
    };
  }

  /** 豆包对话提取：链接 + 账号 → 扫描 → 选中一条下载并顶替成片。 */
  async function openExtractDialog(context) {
    const { jobId, outPath, title, onDone } = context;
    let accounts = [];
    try {
      const data = await api('/api/extract/accounts');
      accounts = data.accounts || [];
    } catch (error) {
      toast(error.message, true);
      return;
    }
    if (!accounts.length) { toast('管理器里还没有可用的豆包账号', true); return; }
    const lastUrl = localStorage.getItem('wmd.extract.url') || '';
    const options = accounts.map((account) => `<option value="${esc(account.id)}">${esc(account.name)}${account.group ? ' · ' + esc(account.group) : ''}${account.enabled ? '' : ' · 已停用'}</option>`).join('');
    const panel = openModal(`<div class="modal-head">
        <div><h2>从豆包提取视频</h2><div class="hint">${esc(title || '这条分镜')} · 用管理器的账号登录态抓对话里的原片</div></div>
        <span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button>
      </div>
      <div class="modal-body">
        <div class="extract-form">
          <label>对话链接<input class="input" id="extract-url" placeholder="https://www.doubao.com/chat/38449980185337346" value="${esc(lastUrl)}" /></label>
          <label>账号<select class="select" id="extract-account">${options}</select></label>
          <button class="btn primary" id="extract-scan">扫描视频</button>
        </div>
        <div class="hint" id="extract-status">扫描会打开该账号的豆包对话页并往下翻历史，一般十几秒；接口最长等 4 分钟。</div>
        <div id="extract-list"></div>
      </div>`);
    panel.classList.add('modal-wide');
    const status = panel.querySelector('#extract-status');
    const listBox = panel.querySelector('#extract-list');
    const scanButton = panel.querySelector('#extract-scan');
    const urlInput = panel.querySelector('#extract-url');
    const accountSelect = panel.querySelector('#extract-account');

    const scan = async () => {
      const url = String(urlInput.value || '').trim();
      if (!url) { toast('先粘贴对话链接', true); return; }
      localStorage.setItem('wmd.extract.url', url);
      scanButton.disabled = true;
      status.textContent = '正在打开对话页并解析视频…';
      listBox.innerHTML = '';
      try {
        const data = await api('/api/extract/scan', { method: 'POST', body: { url, accountId: accountSelect.value } });
        const videos = data.videos || [];
        status.textContent = `${data.account && data.account.name ? data.account.name + ' · ' : ''}${data.title || '对话'} · 解析到 ${videos.length} 条视频${data.generating ? '（对话还在生成）' : ''}`;
        if (!videos.length) { listBox.innerHTML = '<div class="empty"><strong>这个对话里没找到视频</strong><p>确认链接是这个账号自己的对话，或换一个账号再试。</p></div>'; return; }
        listBox.innerHTML = `<div class="extract-list">${videos.map((video, index) => `
          <article class="extract-item" data-session="${esc(data.sessionId)}" data-key="${esc(video.key)}">
            <div class="extract-thumb">${video.poster ? `<img src="${esc(video.poster)}" alt="" loading="lazy" />` : '<span>▶</span>'}</div>
            <div class="extract-meta">
              <b>第 ${index + 1} 条${video.duration ? ' · ' + video.duration + ' 秒' : ''}${video.width && video.height ? ' · ' + video.width + '×' + video.height : ''}</b>
              <span class="hint">${esc(video.methodLabel || video.method || '')}${video.unwatermarked ? ' · 无水印' : ''}${video.downloadable === false ? ' · 不可下载' : ''}</span>
              ${video.text ? `<p class="hint">${esc(shortText(video.text, 40))}</p>` : ''}
              ${video.note ? `<p class="hint">${esc(video.note)}</p>` : ''}
            </div>
            <button class="btn sm primary" data-extract-use="1" ${video.downloadable === false ? 'disabled' : ''}>用这个</button>
          </article>`).join('')}</div>`;
        listBox.querySelectorAll('[data-extract-use]').forEach((button) => {
          button.onclick = async () => {
            const card = button.closest('.extract-item');
            button.disabled = true;
            const old = button.textContent;
            button.textContent = '下载中…';
            try {
              const file = await api('/api/extract/download', { method: 'POST', body: { sessionId: card.dataset.session, key: card.dataset.key, name: '' } });
              const mode = outPath ? 'replace' : 'add';
              await api('/api/jobs/' + encodeURIComponent(jobId) + '/output/from-path', {
                method: 'POST',
                body: { path: outPath || '', sourcePath: file.path, name: file.name || '', mode },
              });
              closeModal();
              toast(mode === 'replace' ? '已用提取的视频替换成片' : '已把提取的视频登记为成片');
              if (onDone) onDone();
            } catch (error) {
              button.disabled = false;
              button.textContent = old;
              toast(error.message, true);
            }
          };
        });
      } catch (error) {
        status.textContent = '';
        toast(error.message, true);
      } finally {
        scanButton.disabled = false;
      }
    };
    scanButton.onclick = () => scan().catch((error) => toast(error.message, true));
    if (lastUrl) setTimeout(() => scanButton.focus(), 60);
  }

  function openVideoPreview(path, options = {}) {
    if (!path) return;
    const jobId = options.jobId || '';
    const title = options.title || '成片预览';
    const overlay = document.createElement('div');
    overlay.className = 'evt-video-backdrop';
    overlay.innerHTML = `<div class="evt-video-modal"><div class="evt-video-head"><b>${esc(title)}</b><span class="grow"></span><button type="button" class="btn sm ghost" data-vp-rename>重命名</button><button type="button" class="btn sm ghost" data-vp-replace>替换成片</button><button type="button" class="btn sm ghost danger" data-vp-delete>删除成片</button><button type="button" class="evt-video-close" aria-label="关闭">×</button></div><video src="/api/file?path=${encodeURIComponent(path)}" controls autoplay playsinline></video></div>`;
    document.body.append(overlay);
    const close = () => overlay.remove();
    const refresh = () => { close(); if (options.onChanged) options.onChanged(); };
    overlay.querySelector('.evt-video-close').onclick = close;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    overlay.querySelector('[data-vp-rename]').onclick = () => {
      if (!jobId) return;
      close();
      openOutputRename(jobId, path, title, options.onChanged);
    };
    overlay.querySelector('[data-vp-replace]').onclick = () => {
      if (!jobId) return;
      close();
      openOutputSourcePicker({ jobId, outPath: path, title, onDone: options.onChanged });
    };
    overlay.querySelector('[data-vp-delete]').onclick = () => {
      if (!jobId) return;
      close();
      openOutputDelete(jobId, path, title, options.onChanged);
    };
    const onKey = (event) => { if (event.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    void refresh;
  }

  function openOutputRename(jobId, outPath, title, onChanged) {
    const current = String(outPath).split(/[\\/]/).pop() || '';
    const base = current.replace(/\.[^.]+$/, '');
    openModal(`<div class="modal-head"><h2>重命名成片</h2><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body">
        <div class="field"><label>文件名</label><input class="input" id="out-rename-name" value="${esc(base)}" /></div>
        <p class="hint">扩展名保持不变；只改这一个文件，任务记录和分集归属会一起更新。</p>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">取消</button><button class="btn primary" id="out-rename-ok">保存</button></div>`);
    const input = document.querySelector('#out-rename-name');
    input.focus();
    input.select();
    document.querySelector('#out-rename-ok').onclick = async () => {
      try {
        await api('/api/jobs/' + encodeURIComponent(jobId) + '/output/rename?path=' + encodeURIComponent(outPath), { method: 'POST', body: { name: input.value.trim() } });
        closeModal();
        toast('成片已重命名');
        if (onChanged) onChanged();
      } catch (error) { toast(error.message, true); }
    };
  }

  function openOutputDelete(jobId, outPath, title, onChanged) {
    openModal(`<div class="modal-head"><h2>删除成片</h2><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body"><p>删除「${esc(title)}」这条成片？</p>
        <p class="hint">文件会挪进项目里的 <code>media/_trash/&lt;日期&gt;/</code>，需要时还能手工找回；任务记录本身保留。</p></div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">取消</button><button class="btn danger" id="out-delete-ok">删除</button></div>`);
    document.querySelector('#out-delete-ok').onclick = async () => {
      try {
        await api('/api/jobs/' + encodeURIComponent(jobId) + '/output/delete?path=' + encodeURIComponent(outPath), { method: 'POST', body: {} });
        closeModal();
        toast('成片已删除，可在 _trash 找回');
        if (onChanged) onChanged();
      } catch (error) { toast(error.message, true); }
    };
  }

  // 画幅比例：分镜输入里优先，其次看子任务上真正提交时的参数；只取 16:9 这种短格式
  function itemRatio(item, job) {
    const raw = [
      (item && item.input && (item.input.aspectRatio || item.input.aspect_ratio)),
      item && item.aspectRatio,
      job && job.aspectRatio,
    ].find((value) => value !== undefined && value !== null && String(value).trim() !== '');
    const short = (String(raw || '').match(/\d+:\d+/) || [])[0];
    return short || '';
  }

  function itemDuration(item, job) {
    const start = (job && job.startedAt) || item.startedAt;
    if (!start) return '—';
    const status = item.status;
    const stopped = ['success', 'failed', 'canceled', 'skipped', 'unknown'].includes(status);
    const end = stopped ? ((job && job.finishedAt) || item.finishedAt || Date.now()) : Date.now();
    return fmtMs(Math.max(0, end - start));
  }

  async function openDetailLegacy(id) {
    const event = await api('/api/events/' + encodeURIComponent(id) + '?paged=1&page=' + ((state.taskPages || {}).detail || 1));
    modalEventId = id;
    const detailItems = new Map((event.items || []).map((item) => [item.id, item]));
    const s = event.stats || {};
    const detailPage = taskPagination(event.items || [], 'detail', event.itemPaging);
    const offset = ((detailPage.page || 1) - 1) * 10;
    const rows = detailPage.rows.map((item, index) => {
      const error = String(item.error || '');
      const errorCell = !error ? '<span class="hint">—</span>'
        : error.length > 120
          ? `<details class="evt-error"><summary>${esc(error.slice(0, 110))}…</summary><pre>${esc(error)}</pre></details>`
          : `<div class="evt-error">${esc(error)}</div>`;
      const actions = [];
      if (['queued', 'paused'].includes(item.status)) {
        actions.push(`<button class="btn sm ghost" data-event-item-action="up" data-item="${esc(item.id)}">上移</button>`);
        actions.push(`<button class="btn sm ghost" data-event-item-action="down" data-item="${esc(item.id)}">下移</button>`);
      }
      if (item.refId) {
        actions.push(`<button class="btn sm ghost" data-event-item-log="${esc(item.id)}">日志</button>`);
        actions.push(`<button class="btn sm ghost" data-event-item-probe="${esc(item.refId)}" data-ref-type="${esc(item.refType)}">探针</button>`);
      }
      if (item.remoteId && item.provider === 'manager' && ['failed', 'unknown', 'canceled'].includes(item.status)) {
        actions.push(`<button class="btn sm" data-event-item-action="resume-original" data-item="${esc(item.id)}">继续查询</button>`);
      }
      if (['failed', 'canceled', 'skipped'].includes(item.status)) {
        actions.push(`<button class="btn sm ghost" data-event-item-revise="${esc(item.id)}">改提示词</button>`);
        actions.push(`<button class="btn sm" data-event-item-action="retry" data-item="${esc(item.id)}">重试</button>`);
      }
      if (['queued', 'paused'].includes(item.status) && item.refId) {
        actions.push(`<button class="btn sm ghost" data-event-item-action="skip" data-item="${esc(item.id)}">跳过</button>`);
      }
      return `<tr>
        <td class="tnum">${offset + index + 1}</td>
        <td><div class="evt-title">${esc(item.title || item.refId || '—')}</div><div class="hint">${esc(item.refType)}${item.provider ? ' · ' + esc(item.provider) : ''}</div></td>
        <td>${itemStatusBadge(item.status)}</td>
        <td>${errorCell}</td>
        <td><div class="evt-row-actions">${actions.join('')}</div></td>
      </tr>`;
    }).join('');

    const pct = s.total ? Math.round(((s.done || 0) / s.total) * 100) : 0;
    const actionButtons = [
      event.status === 'draft' ? `<button class="btn" data-event-edit="${esc(event.id)}">编辑草稿</button><button class="btn primary" data-event-action="queue" data-id="${esc(event.id)}">加入队列</button>` : '',
      event.status === 'unscheduled' ? `<button class="btn" data-event-edit="${esc(event.id)}">编辑任务</button><button class="btn ghost" data-event-action="cancel" data-id="${esc(event.id)}">取消任务</button>` : '',
      ['draft', 'unscheduled', 'canceled'].includes(event.status) ? `<button class="btn ghost" data-event-delete="${esc(event.id)}">删除</button>` : '',
      ['queued', 'running'].includes(event.status) ? `<button class="btn sm" data-event-action="pause" data-id="${esc(event.id)}">暂停</button>` : '',
      event.status === 'paused' ? `<button class="btn sm" data-event-action="resume" data-id="${esc(event.id)}">继续</button>` : '',
      ['queued', 'running', 'paused'].includes(event.status) ? `<button class="btn sm ghost" data-event-action="cancel" data-id="${esc(event.id)}">取消</button>` : '',
      s.failed ? `<button class="btn sm" data-event-action="retry-failed" data-id="${esc(event.id)}">重试失败项</button>` : '',
    ].filter(Boolean).join('');

    const panel = openModal(`<div class="modal-head evt-detail-head">
        <div><h2>${esc(event.title)}</h2><div class="hint">${esc(event.id)} · ${esc(SOURCE[event.source] || event.source)} · 创建 ${new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false })}</div></div>
        <button class="btn ghost sm" data-close="1">关闭</button>
      </div>
      <div class="modal-body evt-detail">
        <section class="evt-summary">
          <div class="evt-summary-top">${badge(event.status)}<div class="evt-progress"><span style="width:${pct}%"></span></div><b>${s.done || 0}/${s.total || 0}</b></div>
          <div class="evt-kpis">
            <div><span>总条目</span><b>${s.total || 0}</b></div>
            <div><span>成功</span><b class="is-ok">${s.success || 0}</b></div>
            <div><span>失败</span><b class="is-bad">${s.failed || 0}</b></div>
            <div><span>执行中</span><b>${s.running || 0}</b></div>
            <div><span>未知</span><b>${s.unknown || 0}</b></div>
            <div><span>耗时</span><b>${duration(event)}</b></div>
          </div>
          ${actionButtons ? `<div class="evt-detail-actions">${actionButtons}</div>` : ''}
        </section>
        <section class="evt-detail-section">
          <div class="evt-section-head"><h3>分镜条目</h3><span class="hint">第 ${detailPage.page || 1} / ${Math.max(1, Math.ceil((event.itemPaging?.total || (event.items || []).length) / 10))} 页</span></div>
          ${rows ? `<div class="table-wrap evt-detail-table"><table class="jobs"><thead><tr><th>#</th><th>分镜</th><th>状态</th><th>错误 / 结果</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>${detailPage.footer}` : '<div class="hint">这个任务还没有条目。</div>'}
        </section>
        <section id="evt-report" class="evt-detail-section"></section>
        <section id="evt-attempts" class="evt-detail-section"></section>
        <div id="evt-item-log"></div>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>`);
    panel.classList.add('modal-wide');
    const logBox = document.querySelector('#evt-item-log');
    api('/api/events/' + encodeURIComponent(id) + '/attempts?page=' + ((state.taskPages || {}).attempts || 1)).then((data) => {
      const target = document.querySelector('#evt-attempts');
      if (!target) return;
      const attempts = data.items.flatMap((item) => item.attempts.map((attempt) => ({ ...attempt, title: item.title })));
      const page = taskPagination(attempts, 'attempts', data);
      target.innerHTML = attempts.length
        ? `<details class="evt-history"><summary>执行历史（${data.total}）</summary><div class="evt-history-list">${page.rows.map((attempt) => `<div class="evt-history-row"><span>${esc(attempt.title)} · ${esc(ITEM[attempt.status] || attempt.status)} · ${new Date(attempt.createdAt).toLocaleString('zh-CN', { hour12: false })}</span><button class="btn sm ghost" data-attempt-log="${esc(attempt.id)}">查看本次日志</button></div>`).join('')}</div>${page.footer}</details>`
        : '';
    }).catch(() => {});

    panel.addEventListener('click', async (e) => {
      const revise = e.target.closest('[data-event-item-revise]');
      if (revise) {
        const item = detailItems.get(revise.dataset.eventItemRevise);
        if (item) openReviseModal(id, item);
        return;
      }
      const page = e.target.closest('[data-task-page]');
      if (page) {
        state.taskPages = { ...(state.taskPages || {}), [page.dataset.pageKey]: Number(page.dataset.taskPage) };
        await openDetail(id);
        return;
      }
      const attempt = e.target.closest('[data-attempt-log]');
      if (attempt) {
        try {
          const data = await api('/api/task-attempts/' + encodeURIComponent(attempt.dataset.attemptLog) + '/logs');
          logBox.innerHTML = '<div class="evt-section-head"><h3>执行日志</h3></div><pre class="evt-log">' + esc(data.lines.map((line) => line.text || line.message || '').join('\n')) + '</pre>' + (data.hasMore ? '<button class="btn" data-more-attempt="' + esc(data.id) + '" data-after="' + data.next + '">继续加载</button>' : '');
        } catch (err) { toast(err.message, true); }
      }
      const more = e.target.closest('[data-more-attempt]');
      if (more) {
        const data = await api('/api/task-attempts/' + encodeURIComponent(more.dataset.moreAttempt) + '/logs?after=' + more.dataset.after);
        logBox.querySelector('pre').textContent += '\n' + data.lines.map((line) => line.text || line.message || '').join('\n');
        more.dataset.after = data.next;
        more.hidden = !data.hasMore;
      }
    });

    const reportBox = document.querySelector('#evt-report');
    api('/api/events/' + encodeURIComponent(id) + '/report').then((report) => {
      const failures = (report.failures || []).map((failure) => `<li><div><b>${esc(failure.provider || '未知')}</b><span class="hint">${esc(failure.channelId || '-')}</span></div><p>${esc(String(failure.error || '').slice(0, 300))}</p><em>×${failure.count}</em></li>`).join('');
      reportBox.innerHTML = `<div class="evt-section-head"><h3>执行报告</h3><a class="btn sm ghost" href="/api/events/${encodeURIComponent(id)}/report?format=csv" download>导出 CSV</a></div>
        <div class="evt-report-grid">
          <div><span>成功率</span><b>${report.successRate == null ? '—' : report.successRate + '%'}</b></div>
          <div><span>成功 / 失败</span><b>${report.success} / ${report.failed}</b></div>
          <div><span>取消 / 跳过 / 未知</span><b>${report.canceled} / ${report.skipped} / ${report.unknown}</b></div>
          <div><span>耗时 P50 / P90 / 最长</span><b>${fmtMs(report.durationMs.p50)} / ${fmtMs(report.durationMs.p90)} / ${fmtMs(report.durationMs.max)}</b></div>
        </div>
        ${failures ? `<div class="evt-failures-block"><h4>失败归因</h4><ul class="evt-failures">${failures}</ul></div>` : ''}`;
    }).catch(() => { reportBox.innerHTML = ''; });

    document.querySelectorAll('[data-event-item-probe]').forEach((button) => {
      button.onclick = async () => {
        try {
          const result = await api('/api/tasks/' + encodeURIComponent(button.dataset.eventItemProbe) + '/probe', { method: 'POST', body: {} });
          logBox.innerHTML = '<div class="evt-section-head"><h3>探针结果</h3></div><pre class="evt-log">' + esc(JSON.stringify(result, null, 2)) + '</pre>';
        } catch (err) { toast(err.message, true); }
      };
    });
    document.querySelectorAll('[data-event-item-action]').forEach((button) => {
      button.onclick = () => runItemAction(button.dataset.eventItemAction, button.dataset.item).catch((err) => toast(err.message, true));
    });
    document.querySelectorAll('[data-event-item-log]').forEach((button) => {
      button.onclick = async () => {
        const data = await api('/api/events/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(button.dataset.eventItemLog) + '/log');
        logBox.innerHTML = '<div class="evt-section-head"><h3>条目日志 · ' + esc(data.item?.title || data.item?.refId || '') + '</h3></div>' +
          ((data.lines || []).length
            ? '<pre class="evt-log">' + esc(data.lines.map((line) => (line.t ? new Date(line.t).toLocaleTimeString('zh-CN', { hour12: false }) + ' ' : '') + (line.level || 'info') + ' ' + (line.text || '')).join('\n')) + '</pre>'
            : '<div class="hint">没有日志记录。</div>');
      };
    });
  }

  async function openDetail(id) {
    // 先取数据再替换抽屉：重试/编辑后刷新失败时保持当前抽屉，不会退回任务列表。
    const [event, jobData] = await Promise.all([
      api('/api/events/' + encodeURIComponent(id)),
      api('/api/jobs?eventId=' + encodeURIComponent(id)).catch(() => ({ jobs: [] })),
    ]);
    modalEventId = id;
    const jobs = jobData.jobs || [];
    const jobByItem = new Map(jobs.map((job) => [job.eventItemId || job.refId, job]));
    const s = event.stats || {};
    const pct = s.total ? Math.round(((s.done || 0) / s.total) * 100) : 0;
    const managerBase = 'http://127.0.0.1:17778/tasks';
    const itemCards = (event.items || []).map((item) => {
      const job = jobByItem.get(item.id) || jobByItem.get(item.refId) || null;
      const managerId = item.remoteId || (job && job.remotePromptId) || '';
      const input = item.input || {};
      const prompt = input.userPrompt == null ? input.prompt : input.userPrompt;
      const prefix = input.prefixPrompt || '';
      const video = (job && (job.outputs || []).find((out) => out.type === 'video' && out.path)) || null;
      const analysis = (job && job.failureAnalysis) || null;
      const reason = (analysis && analysis.reason) || item.error || '';
      const advice = (analysis && analysis.advice) || '';
      const actions = [];
      actions.push(`<button class="btn sm ghost" data-drawer-item-action="detail" data-item="${esc(item.id)}">详情</button>`);
      if (['failed', 'canceled', 'skipped'].includes(item.status)) actions.push(`<button class="btn sm ghost" data-drawer-item-action="retry" data-item="${esc(item.id)}">重试</button>`);
      if (item.status === 'success') actions.push(`<button class="btn sm ghost" data-drawer-item-action="regen" data-item="${esc(item.id)}">重新生成</button>`);
      if (['queued', 'paused'].includes(item.status)) actions.push(`<button class="btn sm ghost" data-drawer-item-action="cancel" data-item="${esc(item.id)}">取消</button>`);
      if (['success', 'failed', 'canceled', 'skipped'].includes(item.status)) actions.push(`<button class="btn sm ghost" data-drawer-item-action="edit" data-item="${esc(item.id)}">编辑</button>`);
      if (['success', 'failed', 'canceled', 'skipped', 'unknown'].includes(item.status)) actions.push(`<button class="btn sm ghost danger" data-drawer-item-action="delete" data-item="${esc(item.id)}">删除</button>`);
      if (item.refId) actions.push(`<button class="btn sm ghost" data-drawer-item-action="probe" data-item="${esc(item.id)}" data-ref="${esc(item.refId)}">探针</button>`);
      if (managerId && ['failed', 'unknown', 'canceled'].includes(item.status)) actions.push(`<button class="btn sm ghost" data-drawer-item-action="resume-original" data-item="${esc(item.id)}">继续查询</button>`);
      return `<article class="evt-shot-card" data-drawer-item="${esc(item.id)}" data-drawer-item-status="${esc(item.status)}">
        <div class="evt-shot-head">
          <div class="evt-shot-id"><span class="hint">任务ID</span>${managerId ? `<a class="mono" href="${managerBase}#${encodeURIComponent(managerId)}" target="_blank" rel="noreferrer" title="打开管理器任务">${esc(managerId)}</a>` : '<span class="hint">未提交</span>'}<small class="mono">${esc(item.id)}</small></div>
          ${itemStatusBadge(item.status)}
        </div>
        <div class="evt-shot-body">
          <div class="evt-shot-info">
            <h4>${esc(item.title || '分镜')}</h4>
            <div class="evt-shot-meta"><span>比例 ${esc(itemRatio(item, job) || '—')}</span><span>运行时长 ${itemDuration(item, job)}</span><span>开始 ${item.startedAt ? new Date(item.startedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span></div>
            <div class="evt-shot-prompt"><b>提示词</b><span title="${esc(prompt || '')}">${esc(shortText(prompt, 10))}</span></div>
            <div class="evt-shot-prompt"><b>前置提示词</b><span title="${esc(prefix || '')}">${esc(shortText(prefix, 10))}</span></div>
            ${['failed', 'unknown', 'canceled'].includes(item.status) && reason ? `<div class="evt-shot-error" title="${esc(reason)}"><b>原因</b> ${esc(shortText(reason, 80))}</div>` : ''}
            ${['failed', 'unknown', 'canceled'].includes(item.status) && advice ? `<div class="evt-shot-advice" title="${esc(advice)}"><b>建议</b> ${esc(shortText(advice, 60))}</div>` : ''}
          </div>
          <div class="evt-shot-media">${video ? `<div class="evt-shot-video" data-drawer-video="${esc(video.path)}" data-drawer-video-item="${esc(item.id)}" title="左键播放，右键改名/替换/删除"><video src="/api/file?path=${encodeURIComponent(video.path)}" preload="metadata" muted></video><span class="evt-shot-play">▶</span></div>` : `<div class="evt-shot-video is-empty" data-drawer-video-item="${esc(item.id)}" title="右键可以上传这条分镜的成片">暂无成片</div>`}</div>
        </div>
        <div class="evt-shot-actions">${actions.join('') || '<span class="hint">没有可执行的操作</span>'}</div>
      </article>`;
    }).join('');

    const taskActions = [
      (event.draft || event.pendingSchedule) ? `<button class="btn" data-drawer-task-action="schedule">配置调度</button>` : '',
      (event.draft || event.pendingSchedule) ? `<button class="btn" data-drawer-task-action="edit">编辑任务</button>` : '',
      ['queued', 'running'].includes(event.status) ? `<button class="btn sm" data-drawer-task-action="pause">暂停</button>` : '',
      event.status === 'paused' ? `<button class="btn sm" data-drawer-task-action="resume">继续</button>` : '',
      ['draft', 'unscheduled', 'scheduled', 'queued', 'running', 'paused'].includes(event.status) ? `<button class="btn sm ghost" data-drawer-task-action="cancel">取消任务</button>` : '',
      ['draft', 'unscheduled', 'canceled', 'completed', 'failed', 'partial', 'interrupted'].includes(event.status) ? `<button class="btn sm ghost danger" data-drawer-task-action="delete">删除任务</button>` : '',
      s.failed ? `<button class="btn sm" data-drawer-task-action="retry-failed">重试失败分镜（${s.failed}）</button>` : '',
      (['completed', 'partial', 'failed', 'canceled'].includes(event.status) && (s.success || 0) > 0) ? `<button class="btn sm" data-drawer-task-action="regen-all">重新生成全部（${s.success}）</button>` : '',
      (event.removedItems || []).length ? `<button class="btn sm ghost" data-drawer-task-action="restore-item">恢复刚移除的分镜（${(event.removedItems || []).length}）</button>` : '',
    ].filter(Boolean).join('');

    const filterChips = () => {
      const other = (s.queued || 0) + (s.paused || 0) + (s.canceled || 0) + (s.skipped || 0) + (s.unknown || 0);
      const chips = [['all', '全部', s.total || 0], ['success', '成功', s.success || 0], ['failed', '失败', s.failed || 0], ['running', '执行中', s.running || 0], ['other', '其他', other]];
      return `<div class="evt-filter-chips" role="group" aria-label="按分镜状态筛选">${chips.map(([key, label, count]) => `<button type="button" data-drawer-filter="${key}" aria-selected="${key === 'all'}">${label} <b>${count}</b></button>`).join('')}</div>`;
    };

    const previous = document.getElementById('evt-drawer');
    const keptTab = previous?.querySelector('[data-drawer-tab][aria-selected="true"]')?.dataset.drawerTab || 'detail';
    const keptScroll = previous?.querySelector('.evt-drawer-body')?.scrollTop || 0;
    if (previous) previous.remove();
    const drawer = document.createElement('div');
    drawer.id = 'evt-drawer';
    drawer.className = 'evt-drawer-backdrop';
    drawer.innerHTML = `<aside class="evt-drawer" role="dialog" aria-modal="true" aria-label="任务详情">
      <header class="evt-drawer-head">
        <div><div class="eyebrow">TASK DETAIL</div><h2>${esc(event.title)}</h2><div class="hint">${esc(event.id)} · ${esc(SOURCE[event.source] || event.source)} · 创建 ${new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false })}</div></div>
        <div class="evt-drawer-head-right">${taskBadge(event.status)}<button type="button" class="btn ghost sm" data-drawer-close>关闭</button></div>
      </header>
      <nav class="evt-drawer-tabs" role="tablist">
        <button type="button" data-drawer-tab="detail" aria-selected="true">分镜与成片</button>
        <button type="button" data-drawer-tab="overview" aria-selected="false">执行记录</button>
        <button type="button" data-drawer-tab="report" aria-selected="false">任务报告</button>
      </nav>
      <div class="evt-drawer-body">
        <section class="evt-drawer-panel" data-drawer-panel="overview">
          <div class="evt-summary">
            <div class="evt-summary-top">${taskBadge(event.status)}<div class="evt-progress"><span style="width:${pct}%"></span></div><b>${s.done || 0}/${s.total || 0}</b></div>
            <div class="evt-kpis">
              <div><span>总条目</span><b>${s.total || 0}</b></div>
              <div><span>成功</span><b class="is-ok">${s.success || 0}</b></div>
              <div><span>失败</span><b class="is-bad">${s.failed || 0}</b></div>
              <div><span>执行中</span><b>${s.running || 0}</b></div>
              <div><span>调度</span><b>${event.schedule?.startAt ? new Date(event.schedule.startAt).toLocaleString('zh-CN', { hour12: false }) : (event.pendingSchedule ? '待调度' : '立即')}</b></div>
              <div><span>耗时</span><b>${duration(event)}</b></div>
            </div>
            ${taskActions ? `<div class="evt-detail-actions">${taskActions}</div>` : ''}
          </div>
          ${filterChips()}
          <div class="evt-drawer-section">
            <div class="evt-section-head"><h3>执行历史</h3><span id="drawer-attempt-count" class="hint">按运行时间倒序</span></div>
            <div id="drawer-attempts" class="evt-attempt-list"><div class="hint">加载中…</div></div>
            <div class="hint" data-drawer-filter-empty hidden>当前筛选下没有执行记录。</div>
            <div id="drawer-log" class="evt-drawer-log"><div class="hint">点击一条执行记录查看日志。</div></div>
          </div>
        </section>
        <section class="evt-drawer-panel" data-drawer-panel="detail" hidden>
          <div class="evt-drawer-section">
            ${filterChips()}
            <div class="evt-section-head"><h3>分镜列表</h3><span class="hint">共 ${(event.items || []).length} 条</span></div>
            <div class="evt-shot-list">${itemCards || '<div class="hint">这个任务还没有分镜。</div>'}</div>
            <div class="hint" data-drawer-filter-empty hidden>当前筛选下没有分镜。</div>
          </div>
        </section>
        <section class="evt-drawer-panel" data-drawer-panel="report" hidden>
          <div id="drawer-report" class="evt-drawer-section"><div class="hint">加载中…</div></div>
        </section>
      </div>
    </aside>`;
    document.body.append(drawer);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => drawer.classList.add('is-open'));
    const logBox = drawer.querySelector('#drawer-log');
    const attemptBox = drawer.querySelector('#drawer-attempts');

    let drawerFilter = 'all';
    const matchesFilter = (status) => drawerFilter === 'all'
      || (drawerFilter === 'other' ? !['success', 'failed', 'running'].includes(status) : status === drawerFilter);
    const applyFilter = () => {
      drawer.querySelectorAll('[data-drawer-filter]').forEach((chip) => chip.setAttribute('aria-selected', String(chip.dataset.drawerFilter === drawerFilter)));
      drawer.querySelectorAll('[data-drawer-item-status],[data-drawer-attempt-status]').forEach((card) => {
        card.hidden = !matchesFilter(card.dataset.drawerItemStatus || card.dataset.drawerAttemptStatus);
      });
      drawer.querySelectorAll('[data-drawer-filter-empty]').forEach((hint) => {
        const panel = hint.closest('[data-drawer-panel]');
        const cards = panel ? [...panel.querySelectorAll('[data-drawer-item-status],[data-drawer-attempt-status]')] : [];
        hint.hidden = !(cards.length && cards.every((card) => card.hidden));
      });
    };

    const showTab = (name) => {
      drawer.querySelectorAll('[data-drawer-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.drawerTab === name)));
      drawer.querySelectorAll('[data-drawer-panel]').forEach((panel) => { panel.hidden = panel.dataset.drawerPanel !== name; });
    };

    showTab(keptTab);
    applyFilter();
    requestAnimationFrame(() => { drawer.querySelector('.evt-drawer-body').scrollTop = keptScroll; });

    const showLog = async (attemptId) => {
      try {
        const data = await api('/api/task-attempts/' + encodeURIComponent(attemptId) + '/logs');
        logBox.innerHTML = '<div class="evt-section-head"><h3>执行日志</h3></div><pre class="evt-log">' + esc((data.lines || []).map((line) => line.text || line.message || '').join('\n')) + '</pre>' + (data.hasMore ? `<button class="btn sm ghost" data-drawer-more-log="${esc(data.id)}" data-after="${data.next}">继续加载</button>` : '');
      } catch (error) { toast(error.message, true); }
    };

    const loadAttempts = async (page = 1, append = false) => {
      const data = await api('/api/events/' + encodeURIComponent(id) + '/attempts?page=' + page);
      const attempts = (data.items || []).flatMap((group) => group.attempts.map((attempt) => ({ ...attempt, title: group.title })));
      const cards = attempts.map((attempt) => {
        const started = attempt.startedAt ? new Date(attempt.startedAt) : null;
        const took = started ? (attempt.finishedAt ? fmtMs(Math.max(0, attempt.finishedAt - attempt.startedAt)) : '进行中') : '未开始';
        return `<button type="button" class="evt-attempt-card" data-drawer-attempt-log="${esc(attempt.id)}" data-drawer-attempt-status="${esc(attempt.status)}" title="创建 ${new Date(attempt.createdAt).toLocaleString('zh-CN', { hour12: false })}"><div class="evt-attempt-top"><b>${esc(attempt.title || '分镜')}</b>${itemStatusBadge(attempt.status)}</div><div class="evt-attempt-meta">运行时间 ${started ? started.toLocaleString('zh-CN', { hour12: false }) : '—'} · 耗时 ${took}</div>${attempt.error ? `<div class="evt-attempt-error">${esc(shortText(attempt.error, 100))}</div>` : ''}</button>`;
      }).join('');
      drawer.querySelector('#drawer-attempt-count').textContent = '共 ' + (data.total || 0) + ' 次 · 按运行时间倒序';
      if (append) attemptBox.insertAdjacentHTML('beforeend', cards);
      else attemptBox.innerHTML = cards || '<div class="hint">还没有执行记录。</div>';
      attemptBox.querySelector('[data-drawer-attempt-more]')?.remove();
      if ((data.total || 0) > page * 10) attemptBox.insertAdjacentHTML('beforeend', `<button class="btn sm ghost" data-drawer-attempt-more data-page="${page + 1}">加载更多</button>`);
      applyFilter();
    };

    const loadReport = async () => {
      const reportBox = drawer.querySelector('#drawer-report');
      try {
        const report = await api('/api/events/' + encodeURIComponent(id) + '/report');
        const rows = report.items || [];
        const durations = rows.filter((row) => Number.isFinite(row.durationMs) && row.durationMs > 0).sort((a, b) => b.durationMs - a.durationMs);
        const maxDuration = durations.length ? durations[0].durationMs : 1;
        const totalStates = (report.success || 0) + (report.failed || 0) + (report.canceled || 0) + (report.skipped || 0) + (report.unknown || 0) || 1;
        const failures = (report.failures || []).map((failure) => `<li><div><b>${esc(failure.provider || '未知')}</b><span class="hint">${esc(failure.channelId || '-')}</span></div><p>${esc(String(failure.error || '').slice(0, 300))}</p><em>×${failure.count}</em></li>`).join('');
        const reasons = (report.reasons || []).map((row) => `<tr><td><span class="badge">${esc(row.label || row.category || '未知原因')}</span></td><td>${esc(row.reason || '未知原因')}</td><td class="tnum">${row.count}</td><td class="tnum">${report.failed ? Math.round((row.count / report.failed) * 100) : 0}%</td><td class="hint">${esc(row.advice || '—')}</td></tr>`).join('');
        reportBox.innerHTML = `<div class="evt-section-head"><h3>任务报告</h3><a class="btn sm ghost" href="/api/events/${encodeURIComponent(id)}/report?format=csv" download>导出 CSV</a></div>
          <div class="evt-report-grid"><div><span>成功率</span><b>${report.successRate == null ? '—' : report.successRate + '%'}</b></div><div><span>成功 / 失败</span><b>${report.success} / ${report.failed}</b></div><div><span>取消 / 跳过 / 未知</span><b>${report.canceled} / ${report.skipped} / ${report.unknown}</b></div><div><span>耗时 P50 / P90 / 最长</span><b>${fmtMs(report.durationMs.p50)} / ${fmtMs(report.durationMs.p90)} / ${fmtMs(report.durationMs.max)}</b></div></div>
          <div class="evt-report-block"><h4>状态分布</h4><div class="evt-dist-bar"><i class="ok" style="width:${(report.success / totalStates) * 100}%"></i><i class="bad" style="width:${(report.failed / totalStates) * 100}%"></i><i class="muted" style="width:${((report.canceled + report.skipped + report.unknown) / totalStates) * 100}%"></i></div><div class="evt-dist-legend"><span><i class="ok"></i>成功 ${report.success}</span><span><i class="bad"></i>失败 ${report.failed}</span><span><i class="muted"></i>其他 ${report.canceled + report.skipped + report.unknown}</span></div></div>
          ${durations.length ? `<div class="evt-report-block"><h4>子任务耗时</h4><div class="evt-bars">${durations.slice(0, 20).map((row) => `<div class="evt-bar-row"><span title="${esc(row.title)}">${esc(shortText(row.title, 12))}</span><div class="evt-bar"><i style="width:${Math.max(2, (row.durationMs / maxDuration) * 100)}%"></i></div><em>${fmtMs(row.durationMs)}</em><small>×${row.attempts || 1}</small></div>`).join('')}</div></div>` : ''}
          ${reasons ? `<div class="evt-report-block"><h4>失败原因归因</h4><div class="table-wrap"><table class="jobs evt-reason-table"><thead><tr><th>类别</th><th>原因</th><th>次数</th><th>占比</th><th>建议</th></tr></thead><tbody>${reasons}</tbody></table></div></div>` : ''}
          ${failures ? `<div class="evt-report-block"><h4>失败明细（渠道 · 原始错误）</h4><ul class="evt-failures">${failures}</ul></div>` : ''}`;
      } catch (error) { reportBox.innerHTML = `<div class="hint">报告加载失败：${esc(error.message)}</div>`; }
    };

    const refreshAfterOutput = async () => {
      try { await load(); } catch { /* 列表刷新失败不影响抽屉操作 */ }
      await openDetail(id);
    };

    /** 右键成片块：播放 / 在文件夹中显示 / 重命名 / 替换 / 删除 */
    drawer.addEventListener('contextmenu', (evt) => {
      const box = evt.target.closest('[data-drawer-video-item]');
      if (!box) return;
      evt.preventDefault();
      evt.stopPropagation();
      const itemId = box.dataset.drawerVideoItem;
      const item = (event.items || []).find((row) => row.id === itemId) || {};
      const job = jobByItem.get(item.id) || jobByItem.get(item.refId) || null;
      const out = job && (job.outputs || []).find((entry) => entry.type === 'video' && entry.path);
      const jobId = item.refId || (job && job.id) || '';
      const videoPath = out ? out.path : (box.dataset.drawerVideo || '');
      const label = item.title || item.shotLabel || '这条分镜';
      const entries = [];
      if (videoPath) {
        entries.push({ label: '播放成片', onSelect: () => openVideoPreview(videoPath, { jobId, title: label, onChanged: refreshAfterOutput }) });
        entries.push({ label: '在文件夹中显示', onSelect: () => api('/api/reveal', { method: 'POST', body: { path: videoPath } }).catch((error) => toast(error.message, true)) });
        entries.push({ sep: true });
      }
      if (jobId) {
        if (videoPath) entries.push({ label: '重命名成片…', onSelect: () => openOutputRename(jobId, videoPath, label, refreshAfterOutput) });
        entries.push({
          label: videoPath ? '替换成片…' : '上传成片…',
          onSelect: () => openOutputSourcePicker({
            jobId,
            outPath: videoPath,
            title: item.title || item.shotLabel || '这条分镜',
            onDone: refreshAfterOutput,
          }),
        });
        if (videoPath) entries.push({ label: '删除成片', danger: true, onSelect: () => openOutputDelete(jobId, videoPath, label, refreshAfterOutput) });
      } else {
        entries.push({ label: '这条分镜还没有提交记录', onSelect: () => {} });
      }
      openContextMenu(evt.clientX, evt.clientY, entries);
    });

    drawer.addEventListener('click', async (clickEvent) => {
      const close = clickEvent.target.closest('[data-drawer-close]');
      if (close) return closeDrawer();
      const tab = clickEvent.target.closest('[data-drawer-tab]');
      if (tab) return showTab(tab.dataset.drawerTab);
      const chip = clickEvent.target.closest('[data-drawer-filter]');
      if (chip) { drawerFilter = chip.dataset.drawerFilter; applyFilter(); return; }
      const video = clickEvent.target.closest('[data-drawer-video]');
      if (video) {
        const owner = (event.items || []).find((row) => row.id === video.dataset.drawerVideoItem) || {};
        return openVideoPreview(video.dataset.drawerVideo, {
          jobId: owner.refId || '',
          title: owner.title || owner.shotLabel || '成片预览',
          onChanged: refreshAfterOutput,
        });
      }
      const shotCard = clickEvent.target.closest('.evt-shot-card');
      if (shotCard && !clickEvent.target.closest('.evt-shot-actions')) {
        const itemId = shotCard.dataset.drawerItem;
        const owner = (event.items || []).find((row) => row.id === itemId);
        if (owner) {
          return openShotDetail({
            eventId: id,
            eventTitle: event.title,
            item: owner,
            job: jobByItem.get(owner.id) || jobByItem.get(owner.refId) || null,
          });
        }
      }
      const taskAction = clickEvent.target.closest('[data-drawer-task-action]');
      if (taskAction) {
        const action = taskAction.dataset.drawerTaskAction;
        if (action === 'edit') { closeDrawer(); return openCreatePage(id); }
        if (action === 'schedule') { closeDrawer(); return openSchedule(id); }
        if (action === 'delete') { closeDrawer(); return confirmDelete(id); }
        if (action === 'regen-all') {
          const targets = (event.items || []).filter((row) => ['success', 'failed', 'canceled', 'skipped'].includes(row.status));
          if (!targets.length) { toast('这个任务没有可重新生成的分镜'); return; }
          openModal(`<div class="modal-head"><div><h2>重新生成全部</h2><div class="hint">保留现有成片，重新提交一遍生成新视频</div></div><button class="btn ghost sm" data-close="1">关闭</button></div>
            <div class="modal-body"><p>这次会重新提交 <b>${targets.length}</b> 条分镜（含已成功的 ${s.success || 0} 条）。</p>
              <ul class="hint"><li>旧成片不会被覆盖，新视频落在新的任务目录里，媒体库里两条都能看到；</li><li>重新生成会再次消耗额度；</li><li>按任务里的并发数排队执行，可以随时暂停或取消。</li></ul></div>
            <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">取消</button><button class="btn primary" id="drawer-regen-all-ok">确认重新生成 ${targets.length} 条</button></div>`);
          document.querySelector('#drawer-regen-all-ok').onclick = async () => {
            const button = document.querySelector('#drawer-regen-all-ok');
            button.disabled = true;
            let ok = 0;
            for (const row of targets) {
              try {
                await api('/api/events/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(row.id) + '/retry', { method: 'POST', body: {} });
                ok++;
              } catch (error) { /* 单条失败不打断整批，最后汇总 */ }
            }
            closeModal();
            await load();
            await openDetail(id);
            toast(ok === targets.length ? `已重新提交 ${ok} 条分镜` : `已重新提交 ${ok}/${targets.length} 条，其余失败`, ok !== targets.length);
          };
          return;
        }
        if (action === 'restore-item') {
          try {
            await api('/api/events/' + encodeURIComponent(id) + '/items/restore', { method: 'POST', body: {} });
            await load();
            await openDetail(id);
            toast('分镜已恢复');
          } catch (error) { toast(error.message, true); }
          return;
        }
        if (action === 'retry-failed') {
          const failed = Number(s.failed) || 0;
          if (!failed) { toast('这个任务没有失败的分镜'); return; }
          openModal(`<div class="modal-head"><div><h2>重试失败分镜</h2><div class="hint">只重发失败的分镜，已成功的分镜不会重复提交</div></div><button class="btn ghost sm" data-close="1">关闭</button></div>
            <div class="modal-body"><p>这次只会重新提交本任务里 <b>${failed}</b> 条<b>失败</b>分镜。</p>
              <ul class="hint"><li>已成功、已取消、已跳过的分镜不会重复提交；</li><li>不会重发同一个项目的其它任务；</li><li>失败分镜重新生成会再次消耗额度。</li></ul></div>
            <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">取消</button><button class="btn primary" id="drawer-retry-failed-ok">确认重试 ${failed} 条</button></div>`);
          document.querySelector('#drawer-retry-failed-ok').onclick = async () => {
            closeModal();
            try {
              const data = await api('/api/events/' + encodeURIComponent(id) + '/retry-failed', { method: 'POST', body: {} });
              await load();
              await openDetail(id);
              toast('已重新排队 ' + (data && data.retried != null ? data.retried : failed) + ' 条失败分镜');
            } catch (error) { toast(error.message, true); }
          };
          return;
        }
        try {
          await api('/api/events/' + encodeURIComponent(id) + '/' + action, { method: 'POST', body: {} });
          await load();
          await openDetail(id);
        } catch (error) { toast(error.message, true); }
        return;
      }
      const itemAction = clickEvent.target.closest('[data-drawer-item-action]');
      if (itemAction) {
        const action = itemAction.dataset.drawerItemAction;
        const itemId = itemAction.dataset.item;
        if (action === 'detail') {
          const item = (event.items || []).find((row) => row.id === itemId);
          if (item) openShotDetail({ eventId: id, eventTitle: event.title, item, job: jobByItem.get(item.id) || jobByItem.get(item.refId) || null });
          return;
        }
        if (action === 'edit') {
          const item = (event.items || []).find((row) => row.id === itemId);
          if (item) openReviseModal(id, item, jobByItem.get(item.id) || jobByItem.get(item.refId) || null);
          return;
        }
        if (action === 'regen') {
          const item = (event.items || []).find((row) => row.id === itemId) || {};
          openModal(`<div class="modal-head"><h2>重新生成</h2><button class="btn" data-close="1">关闭</button></div>
            <div class="modal-body"><p>重新提交「${esc(item.title || '这条分镜')}」，生成一个新视频。</p>
              <ul class="hint"><li>现有成片保留，新视频落在新目录，媒体库两条都在；</li><li>重新生成会再次消耗额度。</li></ul></div>
            <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">取消</button><button class="btn primary" id="drawer-item-regen-ok">确认重新生成</button></div>`);
          document.querySelector('#drawer-item-regen-ok').onclick = async () => {
            try {
              await api('/api/events/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(itemId) + '/retry', { method: 'POST', body: {} });
              closeModal();
              await load();
              await openDetail(id);
              toast(`${item.title || '分镜'}已重新提交，旧成片保留`);
            } catch (error) { toast(error.message, true); }
          };
          return;
        }
        if (action === 'delete') {
          openModal(`<div class="modal-head"><h2>移除分镜</h2><button class="btn" data-close="1">关闭</button></div><div class="modal-body"><p>只从任务里移除这条分镜，不删除成片和素材。</p><p class="hint">移除后还能用「撤销」或任务里的「恢复分镜」放回来。</p></div><div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">取消</button><button class="btn danger" id="drawer-item-delete-ok">移除</button></div>`);
          document.querySelector('#drawer-item-delete-ok').onclick = async () => {
            try {
              const itemTitle = ((event.items || []).find((row) => row.id === itemId) || {}).title || '这条分镜';
              await api('/api/events/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(itemId), { method: 'DELETE' });
              closeModal();
              await load();
              await openDetail(id);
              toast(`${itemTitle}已移除`, false, {
                label: '撤销',
                timeout: 12000,
                onClick: async () => {
                  await api('/api/events/' + encodeURIComponent(id) + '/items/restore', { method: 'POST', body: { itemId } });
                  await load();
                  await openDetail(id);
                  toast('分镜已恢复');
                },
              });
            } catch (error) { toast(error.message, true); }
          };
          return;
        }
        if (action === 'probe') {
          try {
            const result = await api('/api/tasks/' + encodeURIComponent(itemAction.dataset.ref) + '/probe', { method: 'POST', body: {} });
            showTab('overview');
            logBox.innerHTML = '<div class="evt-section-head"><h3>探针结果</h3></div><pre class="evt-log">' + esc(JSON.stringify(result, null, 2)) + '</pre>';
          } catch (error) { toast(error.message, true); }
          return;
        }
        try {
          const endpoint = action === 'cancel' ? 'skip' : action;
          await api('/api/events/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(itemId) + '/' + endpoint, { method: 'POST', body: {} });
          await load();
          await openDetail(id);
          toast(action === 'retry' ? '已重新排队' : action === 'resume-original' ? '已安排继续查询' : '已取消这条分镜');
        } catch (error) { toast(error.message, true); }
        return;
      }
      const attempt = clickEvent.target.closest('[data-drawer-attempt-log]');
      if (attempt) return showLog(attempt.dataset.drawerAttemptLog);
      const more = clickEvent.target.closest('[data-drawer-attempt-more]');
      if (more) return loadAttempts(Number(more.dataset.page), true);
      const moreLog = clickEvent.target.closest('[data-drawer-more-log]');
      if (moreLog) {
        try {
          const data = await api('/api/task-attempts/' + encodeURIComponent(moreLog.dataset.drawerMoreLog) + '/logs?after=' + moreLog.dataset.after);
          logBox.querySelector('pre').textContent += '\n' + (data.lines || []).map((line) => line.text || line.message || '').join('\n');
          moreLog.dataset.after = data.next;
          moreLog.hidden = !data.hasMore;
        } catch (error) { toast(error.message, true); }
      }
    });

    drawer.addEventListener('click', (event) => { if (event.target === drawer) closeDrawer(); });
    loadAttempts().catch(() => { attemptBox.innerHTML = '<div class="hint">执行历史读取失败。</div>'; });
    loadReport();
  }

  function shotJobInfo(item, job) {
    const out = job && (job.outputs || []).find((entry) => entry.type === 'video' && entry.path);
    return { out: out || null, remoteId: item.remoteId || (job && job.remotePromptId) || '' };
  }

  /** 分镜详情弹窗：任务信息 + 提示词 + 成片，外加子任务级操作。 */
  function openShotDetail(context) {
    const { eventId, eventTitle, item, job } = context;
    const input = item.input || {};
    const prefix = String(input.prefixPrompt || '');
    let body = input.userPrompt == null ? '' : String(input.userPrompt);
    if (!body) {
      body = String(input.prompt || '');
      if (prefix && body.startsWith(prefix)) body = body.slice(prefix.length).replace(/^\s*\n+/, '');
    }
    const { out, remoteId } = shotJobInfo(item, job);
    const managerBase = 'http://127.0.0.1:17778/tasks';
    const reason = (job && job.failureAnalysis && job.failureAnalysis.reason) || item.error || '';
    const advice = (job && job.failureAnalysis && job.failureAnalysis.advice) || '';
    const started = item.startedAt || (job && job.startedAt);
    const finished = item.finishedAt || (job && job.finishedAt);
    const timeText = (value) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—');
    const refresh = async () => {
      closeModal();
      try { await load(); } catch { /* 列表刷新失败也能继续看详情 */ }
      await openDetail(eventId);
    };
    const panel = openModal(`<div class="modal-head">
        <div><h2>${esc(item.title || item.shotLabel || '分镜')}</h2>
          <div class="hint">${esc(eventTitle || '任务')} · 子任务详情与操作</div></div>
        <span class="grow"></span>${itemStatusBadge(item.status)}
        <button class="btn ghost sm" data-close="1">关闭</button>
      </div>
      <div class="modal-body">
        <div class="shot-modal-grid">
          <div><span>任务</span><b>${esc(eventTitle || '—')}</b></div>
          <div><span>分镜</span><b>${esc(item.title || item.shotLabel || '—')}</b></div>
          <div><span>状态</span><b>${esc(item.status || '—')}</b></div>
          <div><span>重试次数</span><b>${Number(item.attempts) || 0}</b></div>
          <div><span>开始</span><b>${esc(timeText(started))}</b></div>
          <div><span>结束</span><b>${esc(timeText(finished))}</b></div>
          <div><span>耗时</span><b>${itemDuration(item, job)}</b></div>
          <div><span>比例</span><b>${esc(itemRatio(item, job) || '—')}</b></div>
          <div><span>管理器任务</span><b>${remoteId ? `<a href="${managerBase}#${encodeURIComponent(remoteId)}" target="_blank" rel="noreferrer">${esc(remoteId)}</a>` : '—'}</b></div>
        </div>
        ${reason ? `<div class="evt-shot-error"><b>原因</b> ${esc(reason)}</div>` : ''}
        ${advice ? `<div class="evt-shot-advice"><b>建议</b> ${esc(advice)}</div>` : ''}

        <div class="shot-modal-section">
          <div class="evt-section-head"><h3>成片</h3><span class="grow"></span>
            ${out ? '<button class="btn sm ghost" id="shot-out-rename">重命名</button><button class="btn sm ghost" id="shot-out-replace">替换成片</button><button class="btn sm ghost danger" id="shot-out-delete">删除成片</button>' : '<button class="btn sm primary" id="shot-out-add">上传成片</button>'}
          </div>
          <div class="shot-modal-video">${out
            ? `<video src="/api/file?path=${encodeURIComponent(out.path)}" controls preload="metadata" playsinline></video>`
            : '<div class="hint" style="padding:26px">这条分镜还没有成片</div>'}</div>
          ${out ? `<div class="hint" style="margin-top:6px">${esc(out.name)} · ${fmtSize(out.bytes || 0)}</div>` : ''}
        </div>

        <div class="shot-modal-section">
          <div class="evt-section-head"><h3>视频提示词</h3><span class="grow"></span><button class="btn sm ghost" id="shot-copy-prompt">复制</button></div>
          <div class="shot-modal-prompt">${esc(body || '（没有记录提示词）')}</div>
        </div>

        ${prefix ? `<div class="shot-modal-section">
          <div class="evt-section-head"><h3>前置提示词</h3><span class="grow"></span><button class="btn sm ghost" id="shot-copy-prefix">复制</button></div>
          <div class="shot-modal-prompt">${esc(prefix)}</div>
        </div>` : ''}
      </div>
      <div class="modal-foot">
        <button class="btn ghost" id="shot-open-manager" ${remoteId ? '' : 'disabled'}>打开管理器任务</button>
        <span class="grow"></span>
        <button class="btn" id="shot-edit">编辑提示词</button>
        ${['success', 'failed', 'canceled', 'skipped'].includes(item.status) ? `<button class="btn primary" id="shot-regen">${item.status === 'success' ? '重新生成' : '重试这条'}</button>` : ''}
      </div>`);
    panel.classList.add('modal-wide');

    const copy = (text) => navigator.clipboard.writeText(text).then(() => toast('已复制'), () => toast('复制失败，请手动选择', true));
    panel.querySelector('#shot-copy-prompt').onclick = () => copy(body || '');
    const copyPrefix = panel.querySelector('#shot-copy-prefix');
    if (copyPrefix) copyPrefix.onclick = () => copy(prefix);
    panel.querySelector('#shot-edit').onclick = () => openReviseModal(eventId, item, job);
    const regen = panel.querySelector('#shot-regen');
    if (regen) regen.onclick = async () => {
      regen.disabled = true;
      try {
        await api('/api/events/' + encodeURIComponent(eventId) + '/items/' + encodeURIComponent(item.id) + '/retry', { method: 'POST', body: {} });
        closeModal();
        await load();
        await openDetail(eventId);
        toast(item.status === 'success' ? '已重新提交，旧成片保留' : '已重新排队');
      } catch (error) { regen.disabled = false; toast(error.message, true); }
    };
    const openManager = panel.querySelector('#shot-open-manager');
    if (openManager) openManager.onclick = () => { if (remoteId) window.open(managerBase + '#' + encodeURIComponent(remoteId), '_blank', 'noreferrer'); };
    const runReplace = (jobId, outPath, label) => openOutputSourcePicker({ jobId, outPath, title: label, onDone: refresh });
    const jobId = item.refId || (job && job.id) || '';
    const shotLabel = item.title || item.shotLabel || '这条分镜';
    const replaceBtn = panel.querySelector('#shot-out-replace') || panel.querySelector('#shot-out-add');
    if (replaceBtn) replaceBtn.onclick = () => { if (jobId) runReplace(jobId, out ? out.path : '', shotLabel); };
    const renameBtn = panel.querySelector('#shot-out-rename');
    if (renameBtn) renameBtn.onclick = () => openOutputRename(jobId, out.path, item.title || '成片', refresh);
    const deleteBtn = panel.querySelector('#shot-out-delete');
    if (deleteBtn) deleteBtn.onclick = () => openOutputDelete(jobId, out.path, item.title || '成片', refresh);
  }

  function openReviseModal(eventId, item, job) {
    const input = item.input || {};
    const prefix = String(input.prefixPrompt || '');
    let body = input.userPrompt == null ? '' : String(input.userPrompt);
    if (!body) {
      body = String(input.prompt || '');
      if (prefix && body.startsWith(prefix)) body = body.slice(prefix.length).replace(/^\s*\n+/, '');
    }
    const { out } = shotJobInfo(item, job || null);
    const jobId = item.refId || (job && job.id) || '';
    const refresh = async () => { closeModal(); try { await load(); } catch { /* ignore */ } await openDetail(eventId); };
    const panel = openModal(`<div class="modal-head">
        <div><h2>编辑分镜 · ${esc(item.title || item.refId || '分镜')}</h2><div class="hint">提示词和成片都只影响这一条子任务</div></div>
        <button class="btn ghost sm" id="revise-back">返回详情</button>
      </div>
      <div class="modal-body revise-form">
        <p class="hint">这里改的是真正发给豆包的提示词。保存后不会自动提交；点「保存并重试」才会按新内容重新生成这一条。</p>
        ${out ? `<div class="revise-media"><div class="evt-section-head"><h3>当前成片</h3><span class="grow"></span><button class="btn sm ghost" id="revise-replace">替换视频</button><button class="btn sm ghost danger" id="revise-delete">删除视频</button></div>
          <video src="/api/file?path=${encodeURIComponent(out.path)}" controls preload="metadata" playsinline></video><div class="hint">${esc(out.name)} · ${fmtSize(out.bytes || 0)}</div></div>`
        : `<div class="revise-media"><div class="evt-section-head"><h3>当前成片</h3><span class="grow"></span><button class="btn sm ghost" id="revise-add">上传视频</button></div><div class="hint">这条分镜还没有成片，可以直接上传一个。</div></div>`}
        <label>视频前置提示词<em>会拼在视频提示词前面；只影响这一条</em><textarea class="textarea" id="revise-prefix" rows="3" placeholder="留空表示不加前置">${esc(prefix)}</textarea></label>
        <label>视频提示词<em>删掉触发违禁的字句即可，不用重传整个文件</em><textarea class="textarea" id="revise-prompt" rows="12" placeholder="这一条要生成什么">${esc(body)}</textarea></label>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn ghost" id="revise-cancel">取消</button><button class="btn" id="revise-save">仅保存</button><button class="btn primary" id="revise-retry">保存并重试</button></div>`);
    panel.classList.add('modal-wide');
    const back = () => { closeModal(); return openDetail(eventId).catch((err) => toast(err.message, true)); };
    panel.querySelector('#revise-back').onclick = back;
    panel.querySelector('#revise-cancel').onclick = back;
    const mediaBtn = panel.querySelector('#revise-replace') || panel.querySelector('#revise-add');
    if (mediaBtn) mediaBtn.onclick = () => openOutputSourcePicker({
      jobId,
      outPath: out ? out.path : '',
      title: item.title || item.shotLabel || '这条分镜',
      onDone: async () => { await refresh(); openReviseModal(eventId, item, job); },
    });
    const deleteMedia = panel.querySelector('#revise-delete');
    if (deleteMedia) deleteMedia.onclick = () => openOutputDelete(jobId, out.path, item.title || '成片', async () => { await refresh(); openReviseModal(eventId, item, job); });
    const submit = async (retry) => {
      const prompt = String(panel.querySelector('#revise-prompt').value || '');
      const prefixPrompt = String(panel.querySelector('#revise-prefix').value || '');
      if (!prompt.trim()) { toast('视频提示词不能为空', true); return; }
      const buttons = panel.querySelectorAll('#revise-save,#revise-retry');
      buttons.forEach((button) => { button.disabled = true; });
      try {
        await api('/api/events/' + encodeURIComponent(eventId) + '/items/' + encodeURIComponent(item.id) + '/revise', {
          method: 'POST',
          body: { prompt, prefixPrompt },
        });
        if (retry) {
          await api('/api/events/' + encodeURIComponent(eventId) + '/items/' + encodeURIComponent(item.id) + '/retry', { method: 'POST', body: {} });
        }
        closeModal();
        await openDetail(eventId);
        toast(retry ? '已保存并重新排队' : '提示词已保存；点「重试」按新内容重新提交');
      } catch (err) {
        buttons.forEach((button) => { button.disabled = false; });
        toast(err.message, true);
      }
    };
    panel.querySelector('#revise-save').onclick = () => submit(false);
    panel.querySelector('#revise-retry').onclick = () => submit(true);
  }

  /**
   * 任务清单：任务 → 镜头 → 提示词 → 成片路径 的完整映射。
   * 可以当场复制 / 下载，也可以落一份到项目 exports/任务清单/ 里随时读。
   */
  async function openManifestModal() {
    const kind = state.taskMedia === 'image' ? 'image' : 'video';
    const data = await api('/api/tasks/manifest?kind=' + kind);
    const text = JSON.stringify(data, null, 2);
    const counts = data.counts || {};
    const stamp = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fileName = `任务清单_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.json`;
    const preview = text.length > 24000 ? text.slice(0, 24000) + '\n…（预览截断，导出的是完整内容）' : text;
    openModal(`<div class="modal-head">
        <div><h2>任务清单 JSON</h2><div class="hint">任务 → 镜头 → 提示词 → 成片路径，一条不漏，供后续管理和读取</div></div>
        <span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button>
      </div>
      <div class="modal-body">
        <div class="shot-modal-grid">
          <div><span>任务</span><b>${counts.tasks || 0}</b></div>
          <div><span>镜头</span><b>${counts.shots || 0}</b></div>
          <div><span>成片</span><b>${counts.videos || 0}</b></div>
          <div><span>项目</span><b>${esc((data.project && data.project.name) || '未选择')}</b></div>
          <div><span>类型</span><b>${kind === 'image' ? '图像' : '视频'}</b></div>
          <div><span>生成时间</span><b>${esc(new Date(data.generatedAt).toLocaleString('zh-CN', { hour12: false }))}</b></div>
        </div>
        <div class="hint">每条镜头是一条记录：<code>shotLabel</code> 镜头名、<code>prompt</code> / <code>userPrompt</code> 提示词、<code>video.path</code> 成片绝对路径、<code>video.exists</code> 是否还在磁盘上。<code>index</code> 就是镜头顺序。</div>
        <pre class="manifest-preview">${esc(preview)}</pre>
      </div>
      <div class="modal-foot">
        <span class="grow"></span>
        <button class="btn ghost" id="manifest-copy">复制 JSON</button>
        <button class="btn" id="manifest-download">下载</button>
        <button class="btn primary" id="manifest-save">保存到项目</button>
      </div>`);
    const panel = document.querySelector('#modal-panel');
    panel.classList.add('modal-wide');
    panel.querySelector('#manifest-copy').onclick = () => navigator.clipboard.writeText(text)
      .then(() => toast('任务清单已复制'), () => toast('复制失败，请用「下载」', true));
    panel.querySelector('#manifest-download').onclick = () => {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('已下载 ' + fileName);
    };
    panel.querySelector('#manifest-save').onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const saved = await api('/api/tasks/manifest/save', { method: 'POST', body: { kind } });
        closeModal();
        toast('已保存到 ' + saved.file);
      } catch (error) {
        button.disabled = false;
        toast(error.message, true);
      }
    };
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      if (state.route !== 'tasks' || document.querySelector('#modal:not([hidden])')) return;
      if (['manage', 'schedule', 'monitor', 'logs'].includes(currentTaskTab())) load({ keepFocus: true });
    }, 5000);
  }

  function bind(root) {
    if (currentTaskTab() === 'create') { bindCreate(root); start(); return; }
    root.querySelector('[data-events-search]')?.addEventListener('submit',async e=>{e.preventDefault();state.taskEventQuery=new FormData(e.target).get('query')||'';state.taskPages={...(state.taskPages||{}),events:1};lastSignature='';await load();});
    const reloadFilters=()=>{state.taskPages={...(state.taskPages||{}),events:1};lastSignature='';load();};
    root.querySelector('#event-status')?.addEventListener('change',e=>{state.taskEventStatus=e.target.value||'';reloadFilters();});
    root.querySelector('#event-month')?.addEventListener('change',e=>{state.taskEventMonth=e.target.value||'';reloadFilters();});
    root.querySelector('#event-sort')?.addEventListener('change',e=>{state.taskEventSort=e.target.value||'runtime_desc';reloadFilters();});
    root.addEventListener('click', (event) => {
      const filter=event.target.closest('[data-event-status]');
      if(filter){state.taskEventStatus=filter.dataset.eventStatus;state.taskPages={...(state.taskPages||{}),events:1};lastSignature='';load();return;}
      const reset=event.target.closest('[data-event-filter-reset]');
      if(reset){state.taskEventStatus='';state.taskEventMonth='';state.taskEventSort='runtime_desc';state.taskEventQuery='';state.taskPages={...(state.taskPages||{}),events:1};lastSignature='';load();return;}
      const openRow=event.target.closest('[data-event-open]');
      if(openRow && !event.target.closest('button,a')){openDetail(openRow.dataset.eventOpen).catch(err=>toast(err.message,true));return;}
      const schedule=event.target.closest('[data-event-schedule]');
      if(schedule){openSchedule(schedule.dataset.eventSchedule).catch(err=>toast(err.message,true));return;}
      const create = event.target.closest('[data-event-create]');
      if (create) { openCreatePage().catch((err) => toast(err.message, true)); return; }
      const detail = event.target.closest('[data-event-detail]');
      if (detail) { openDetail(detail.dataset.eventDetail).catch((err) => toast(err.message, true)); return; }
      const attempts = event.target.closest('[data-event-attempts]');
      if (attempts) { openAttempts(attempts.dataset.eventAttempts).catch((err) => toast(err.message, true)); return; }
      const logView = event.target.closest('[data-event-log-view]');
      if (logView) { openLogs(logView.dataset.eventLogView).catch((err) => toast(err.message, true)); return; }
      const remove = event.target.closest('[data-event-delete]');
      if (remove) { confirmDelete(remove.dataset.eventDelete).catch((err) => toast(err.message, true)); return; }
      const trash = event.target.closest('[data-event-trash]');
      if (trash) { openTrashModal().catch((err) => toast(err.message, true)); return; }
      const manifestButton = event.target.closest('[data-event-manifest]');
      if (manifestButton) { openManifestModal().catch((err) => toast(err.message, true)); return; }
      const action = event.target.closest('[data-event-action]');
      if (action) { runAction(action.dataset.eventAction, action.dataset.id).catch((err) => toast(err.message, true)); return; }
      const itemAction = event.target.closest('[data-event-item-action]');
      if (itemAction) { runItemAction(itemAction.dataset.eventItemAction, itemAction.dataset.item).catch((err) => toast(err.message, true)); }
    });
    start();
    if (!state.events) load();
  }

  async function runAction(action, id) {
    await api('/api/events/' + encodeURIComponent(id) + '/' + action, { method: 'POST', body: {} });
    await load();
    if (document.querySelector('#modal:not([hidden])')) await openDetail(id).catch(() => {});
    toast('已' + ({ pause: '暂停', resume: '继续', cancel: '取消', 'retry-failed': '重试失败项' }[action] || action));
  }
  async function runItemAction(action, itemId) {
    const panel = document.querySelector('#modal:not([hidden])');
    const eventId = modalEventId;
    if (!eventId) return;
    await api('/api/events/' + encodeURIComponent(eventId) + '/items/' + encodeURIComponent(itemId) + '/' + action, { method: 'POST', body: {} });
    await openDetail(eventId);
  }

  document.addEventListener('click', (event) => {
    const edit=event.target.closest('[data-event-edit]');if(edit){openCreatePage(edit.dataset.eventEdit).catch(err=>toast(err.message,true));return;}
    const remove=event.target.closest('[data-event-delete]');
    if(remove){if(!remove.closest('#modal'))return;confirmDelete(remove.dataset.eventDelete).catch(err=>toast(err.message,true));return;}
    const action = event.target.closest('[data-event-action]');
    if (!action || !action.closest('#modal')) return;
    event.preventDefault();
    runAction(action.dataset.eventAction, action.dataset.id).catch((err) => toast(err.message, true));
  });

  async function openRangeReport(days) {
    const report = await api('/api/events/report?days=' + encodeURIComponent(days)+'&kind='+encodeURIComponent(taskMedia()));
    const daily = (report.daily || []).map((d) => `<tr><td>${esc(d.day)}</td><td>${d.events}</td><td>${d.items}</td><td>${d.success}</td><td>${d.failed}</td></tr>`).join('');
    openModal(`<div class="modal-head"><h2>近 ${report.days} 天报告</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body">
        <div class="evt-report-row"><b>成功率</b><span>${report.successRate == null ? '—' : report.successRate + '%'}</span><span class="hint">事件 ${report.events} · 条目 ${report.items} · 成功 ${report.success} · 失败 ${report.failed} · 未知 ${report.unknown}</span></div>
        ${daily ? `<div class="table-wrap"><table class="jobs"><thead><tr><th>日期</th><th>事件</th><th>条目</th><th>成功</th><th>失败</th></tr></thead><tbody>${daily}</tbody></table></div>` : '<div class="hint">这段时间还没有事件。</div>'}
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>`);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('#modal:not([hidden])') && document.getElementById('evt-drawer')) closeDrawer();
  });

  return { render, renderCreate, renderSchedule, renderMonitor, renderLogs, load, bind, resetForProject, openCreatePage, openDetail, openSchedule, openAttempts, openLogs, confirmDelete };
})();
