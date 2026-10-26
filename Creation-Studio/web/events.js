'use strict';
/* 任务事件：列表 / 详情 / 创建（P1 最小闭环） */
const Events = (() => {
  let timer = null;
  let lastSignature = '';
  let modalEventId = null;
  const STATUS = { draft: '待调度', unscheduled: '待调度', scheduled: '待执行', queued: '待执行', running: '执行中', paused: '暂停', completed: '完成', partial: '部分失败', failed: '失败', canceled: '已取消', interrupted: '待确认', unknown: '待确认' };
  const SOURCE = { batch: '批量导入', studio: '创作台', image: '图像台', api: '接口' };
  const ITEM = { queued: '排队', running: '执行中', success: '完成', failed: '失败', canceled: '已取消', skipped: '跳过', unknown: '未知', paused: '暂停' };

  function typingInTaskPanel() {
    const el = document.activeElement;
    return !!(el && el.closest && el.closest('#task-panel') && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
  }

  async function load(options = {}) {
    const pendingRender = !!state.eventRenderPending;
    try {
      const data = await api('/api/events?kind='+encodeURIComponent(taskMedia())+'&status='+encodeURIComponent(state.taskEventStatus||'')+'&query='+encodeURIComponent(state.taskEventQuery||'')+'&page='+((state.taskPages||{}).events||1));
      const events = data.events || [];
      const signature = JSON.stringify(data.stats)+JSON.stringify([data.page,data.total,taskMedia()])+JSON.stringify(events.map((e) => [e.id, e.status, e.stats && e.stats.done, e.stats && e.stats.total, e.stats && e.stats.failed, e.stats && e.stats.running, e.title]));
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

  function badge(status) {
    const cls = status === 'completed' ? 'ok' : status === 'failed' ? 'bad' : status === 'running' ? 'info' : '';
    return `<span class="badge ${cls}">${esc(STATUS[status] || status)}</span>`;
  }

  function duration(event) {
    const start = event.startedAt;
    const end = event.finishedAt || Date.now();
    if (!start) return '—';
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    if (seconds < 60) return seconds + 's';
    return Math.floor(seconds / 60) + 'm' + String(seconds % 60).padStart(2, '0') + 's';
  }

  function render(mode = 'manage') {
    const events = state.events || [];
    const page = taskPagination(events, 'events', state.eventPaging);
    const rows = page.rows.map((event) => {
      const s = event.stats || {};
      const progress = s.total ? Math.round(((s.done || 0) / s.total) * 100) : 0;
      const when = event.schedule?.startAt ? new Date(event.schedule.startAt).toLocaleString('zh-CN', { hour12: false }) : (event.pendingSchedule ? '待调度' : '立即');
      return `<tr>
        <td data-label="状态">${badge(event.status)}</td>
        <td data-label="任务"><div class="evt-title">${esc(event.title)}</div><div class="hint">${esc(event.id)}${event.status === 'interrupted' ? ' · 待对账' : ''}</div></td>
        <td class="hint" data-label="调度">${esc(when)}</td>
        <td data-label="条目进度"><div class="evt-progress"><span style="width:${progress}%"></span></div><div class="hint">${s.done || 0}/${s.total || 0} 已处理${s.failed ? ' · ' + s.failed + ' 失败' : ''}${s.running ? ' · ' + s.running + ' 执行中' : ''}</div></td>
        <td class="tnum" data-label="耗时">${duration(event)}</td>
        <td class="hint" data-label="创建">${event.createdAt ? new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
        <td class="evt-actions" data-label="操作"><button class="btn sm" data-event-detail="${esc(event.id)}">详情</button></td>
      </tr>`;
    }).join('');
    return `
    <form class="task-search" data-events-search><label for="event-search">搜索任务</label><div><input class="input" id="event-search" name="query" value="${esc(state.taskEventQuery||'')}" placeholder="任务名称"><button class="btn" type="submit">搜索</button></div></form>
    <div class="filters">${[['','全部'],['draft,unscheduled','待调度'],['scheduled,queued','待执行'],['running','执行中'],['paused','暂停'],['completed','完成'],['partial','部分失败'],['failed','失败'],['canceled','已取消'],['interrupted','待确认']].map(([value,label])=>`<button class="chip ${(state.taskEventStatus||'')===value?'active':''}" data-event-status="${value}">${label}</button>`).join('')}</div>
    ${state.eventError ? `<div class="card" style="padding:12px;color:var(--h3-danger)">事件加载失败：${esc(state.eventError)}</div>` : ''}
    ${rows ? `<div class="table-wrap"><table class="jobs evt-table">
      <thead><tr><th>状态</th><th>任务</th><th>调度</th><th>条目进度</th><th>耗时</th><th>创建</th><th>操作</th></tr></thead>
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

  function newDraft(kind) {
    const channelId = kind === 'video' ? defaultVideoChannel() : (imageChannelList()[0]?.id || '');
    return {
      kind,
      editId: '',
      title: '',
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
    if (file.stats.audios) parts.push(`${file.stats.audios} 段音频`);
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
      const audios = (item.audios || []).map((audio, order) => `<span class="shot-ref is-audio" title="${esc(audio.path || '')}">
        <b>♪${order + 1}</b><span class="shot-ref-name">${esc(audio.name || '音频')}</span>${audio.note ? `<i>${esc(audio.note)}</i>` : ''}
        <button type="button" class="shot-ref-x" data-audio-remove="${index}:${order}" title="移除这段音频">×</button>
      </span>`).join('');
      const extras = Object.entries(item.extra || {}).filter(([, value]) => String(value).trim() !== '');
      return `<tr>
        <td class="tnum">${index + 1}</td>
        <td><input class="input" data-field="title" data-index="${index}" value="${esc(item.title || '')}" placeholder="分镜 ${index + 1}"></td>
        <td><textarea class="textarea" data-field="prompt" data-index="${index}" rows="2" placeholder="这个分镜要生成什么">${esc(item.prompt || '')}</textarea></td>
        <td><select class="select" data-field="ratio" data-index="${index}">${ratios.map((ratio) => `<option value="${esc(ratio)}" ${ratio === (item.ratio || ratios[0]) ? 'selected' : ''}>${esc(ratio)}</option>`).join('')}</select></td>
        ${isImage ? `<td><input class="input" type="number" min="1" max="4" data-field="count" data-index="${index}" value="${item.count || ''}" placeholder="1"></td>` : `<td><input class="input" data-field="resolution" data-index="${index}" value="${esc(item.resolution || '')}" placeholder="渠道默认"></td>`}
        <td><input class="input" type="number" min="1" max="15" data-field="duration" data-index="${index}" value="${item.duration || ''}" placeholder="默认"></td>
        ${isImage ? '' : `<td class="shot-model">${esc(model || '—')}</td>`}
        <td class="shot-refs">${refs}${audios}${extras.length ? `<div class="shot-extra">扩展：${esc(extras.map(([key, value]) => `${key}=${value}`).join(' · '))}</div>` : ''}${(refs || audios) ? '' : '<span class="hint">无</span>'}</td>
        <td><button type="button" class="btn sm ghost" data-remove-row="${index}">删除</button></td>
      </tr>`;
    }).join('');
    const tableClass = isImage ? 'is-image' : 'is-video';
    return `<div class="table-wrap create-table-wrap"><table class="jobs create-table ${tableClass}">
      <thead><tr><th>#</th><th>分镜</th><th>提示词</th><th>画面比例</th>${isImage ? '<th>张数</th>' : '<th>分辨率</th>'}<th>时长</th>${isImage ? '' : '<th>使用模型</th>'}<th>素材（文件 · 说明 · 顺序）</th><th></th></tr></thead>
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
    if (title) draft.title = title.value;
    if (channel) draft.channelId = channel.value;
    if (model) draft.workflowId = model.value;
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
        try {
          const synced = await api('/api/assets/shots/import', { method: 'POST', body: { items: parsed.items, source: file.name } });
          state.assetLibrary = await api('/api/assets/library');
          if (synced.imported) target.msg = `已同步 ${synced.imported} 个分镜到素材库`;
          if ((synced.warnings || []).length) toast(synced.warnings[0], true);
        } catch (err) {
          target.msg = `文件已解析，但同步素材库失败：${err.message}`;
        }
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
    const defaultResolution = String(workflow?.defaultResolution || '').trim();
    const fallbackRatio = String(workflow?.defaultRatio || (workflow?.ratios || [])[0] || '16:9');
    const rows = items.map((item, index) => {
      const prompt = String(item.prompt || '').trim();
      if (!prompt) throw new Error(`第 ${index + 1} 个分镜缺提示词`);
      const images = (item.images || []).filter((image) => image && image.path)
        .map((image) => ({ path: image.path, name: image.name || '', note: image.note || '' }));
      const audios = (item.audios || []).filter((audio) => audio && audio.path)
        .map((audio) => ({ path: audio.path, name: audio.name || '', note: audio.note || '' }));
      const title = String(item.title || '').trim() || undefined;
      const ratio = item.ratio || fallbackRatio;
      if (draft.kind === 'image') {
        return { title, prompt, prefixPrompt: String(item.prefixPrompt || '').trim() || undefined, refs: images, imageRatio: ratio, aspectRatio: ratio, imageLayoutId: 'free', count: Math.max(1, Math.min(4, Number(item.count) || 1)), channelId: draft.channelId };
      }
      return {
        title, prompt, prefixPrompt: String(item.prefixPrompt || '').trim() || undefined, images, audios,
        duration: Math.max(1, Math.min(15, Number(item.duration) || defaultDuration)),
        aspectRatio: ratio,
        resolution: String(item.resolution || '').trim() || defaultResolution,
        workflowId: draft.workflowId,
      };
    });
    const title = String(draft.title || '').trim() || String(rows[0].prompt || '').slice(0, 30);
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
      if (payload.kind === 'video') {
        try {
          await api('/api/assets/shots/import', { method: 'POST', body: { items: payload.items, source: draft.file?.name || '' } });
          state.assetLibrary = await api('/api/assets/library');
        } catch (err) {
          toast('任务已保存，但素材库同步失败：' + err.message, true);
        }
      }
      if (draft.editId) {
        await api('/api/events/' + encodeURIComponent(draft.editId) + '/draft', { method: 'POST', body: { title: payload.title, items: payload.items } });
        await api('/api/events/' + encodeURIComponent(draft.editId) + '/prepare', { method: 'POST', body: {} });
      } else {
        await api('/api/events', { method: 'POST', body: payload });
      }
      createDrafts[draft.kind] = null;
      lastSignature = '';
      state.taskEventStatus = '';
      state.taskPages = { ...(state.taskPages || {}), events: 1 };
      state.taskTab = 'schedule';
      localStorage.setItem('h3.tasks.tab', 'schedule');
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
          item[field] = ['duration', 'count'].includes(field) ? (target.value ? Number(target.value) : null) : target.value;
        }
        return;
      }
      if (target.id === 'tc-title' || target.id === 'tc-channel' || target.id === 'tc-model') readCreateHead(root);
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
        draft.file.items.push({ title: '', prompt: '', images: [], audios: [], duration: null, ratio: availableRatios(draft)[0] });
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
      const removeAudio = event.target.closest('[data-audio-remove]');
      if (removeAudio) {
        const [row, order] = String(removeAudio.dataset.audioRemove).split(':').map(Number);
        const draft = currentDraft();
        const item = draft.file?.items?.[row];
        if (item && item.audios) item.audios.splice(order, 1);
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
    return state.eventError ? `<div class="card" style="padding:12px;color:var(--h3-danger)">任务加载失败：${esc(state.eventError)}</div>` : '';
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
    openModal(`<div class="modal-head"><h2>执行记录 · ${esc(event.title)}</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body">
        <div class="monitor-config"><span>运行时间：${event.schedule?.startAt ? new Date(event.schedule.startAt).toLocaleString('zh-CN', { hour12: false }) : '立即'}</span><span>并发：${Number(event.policy?.concurrency) || 1}</span><span>失败处理：${event.policy?.onItemFail === 'stop' ? '失败即停' : '继续'}</span></div>
        <h3 class="monitor-h3">配置操作</h3><ul class="monitor-audit">${auditRows}</ul>
        <h3 class="monitor-h3">执行记录</h3>
        <div id="attempt-wrap"><div class="hint">加载中…</div></div>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>`);
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
        <td class="hint">${esc(attempt.error || '')}</td>
      </tr>`)).join('') || '<tr><td colspan="5" class="hint">还没有执行记录。</td></tr>';
      const pages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 10)));
      const button = (label, target, disabled) => `<button class="btn sm" data-attempt-page="${target}" ${disabled ? 'disabled' : ''}>${label}</button>`;
      const pager = pages > 1 ? `<nav class="task-pagination"><span>共 ${data.total} 条 · 第 ${data.page} / ${pages} 页</span><div>${button('上一页', data.page - 1, data.page <= 1)}${button('下一页', data.page + 1, data.page >= pages)}</div></nav>` : '';
      wrap.innerHTML = `<div class="table-wrap"><table class="jobs"><thead><tr><th>分镜</th><th>状态</th><th>开始</th><th>耗时</th><th>错误</th></tr></thead><tbody>${attemptRows}</tbody></table></div>${pager}`;
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
    const panel = openModal(`<div class="modal-head"><h2>分镜日志 · ${esc(event.title)}</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body"><div class="table-wrap"><table class="jobs"><thead><tr><th>分镜</th><th>状态</th><th>开始</th><th>耗时</th><th>错误</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div id="evt-item-log"></div></div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>`);
    const box = panel.querySelector('#evt-item-log');
    panel.querySelectorAll('[data-event-item-log]').forEach((button) => {
      button.onclick = async () => {
        try {
          const data = await api('/api/events/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(button.dataset.eventItemLog) + '/log');
          box.innerHTML = '<h3 class="monitor-h3">' + esc(data.item?.title || data.item?.refId || '') + '</h3>' + ((data.lines || []).length
            ? '<pre class="evt-log">' + esc(data.lines.map((line) => (line.t ? new Date(line.t).toLocaleTimeString('zh-CN', { hour12: false }) + ' ' : '') + (line.level || 'info') + ' ' + (line.text || '')).join('\n')) + '</pre>'
            : '<div class="hint">没有日志记录。</div>');
        } catch (err) { toast(err.message, true); }
      };
    });
  }

  async function confirmDelete(id) {
    const event = await api('/api/events/' + encodeURIComponent(id));
    openModal(`<div class="modal-head"><h2>删除任务</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body"><p>确定删除「${esc(event.title || event.id)}」？</p><p class="hint">删除后任务和它的执行记录都会消失，不能恢复。</p></div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">取消</button><button class="btn danger" id="evt-delete-confirm">删除</button></div>`);
    document.querySelector('#evt-delete-confirm').onclick = async () => {
      try {
        await api('/api/events/' + encodeURIComponent(id), { method: 'DELETE' });
        closeModal();
        lastSignature = '';
        state.taskPages = { ...(state.taskPages || {}), events: 1 };
        await load();
        window.render();
        toast('任务已删除');
      } catch (err) { toast(err.message, true); }
    };
  }

  async function openSchedule(id) {
    const event = await api('/api/events/' + encodeURIComponent(id));
    const local = event.schedule?.startAt ? new Date(event.schedule.startAt) : null;
    const pad = (n) => String(n).padStart(2, '0');
    const value = local ? `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}` : '';
    openModal(`<div class="modal-head"><h2>配置调度</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body">
        <div class="schedule-form">
          <label>运行时间<input class="input" id="evt-start" type="datetime-local" value="${value}" placeholder="留空 = 立即执行"></label>
          <label>并发数量<select class="select" id="evt-concurrency">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === (event.policy?.concurrency || 1) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>失败处理<select class="select" id="evt-fail"><option value="continue" ${event.policy?.onItemFail !== 'stop' ? 'selected' : ''}>继续执行其它分镜</option><option value="stop" ${event.policy?.onItemFail === 'stop' ? 'selected' : ''}>失败即停止后续</option></select></label>
          <label>执行次序<input class="input" id="evt-order" type="number" value="${event.schedule?.order || 0}"></label>
        </div>
        <p class="hint">运行时间留空表示保存后立即执行；指定时间则进入「待执行」，到点自动开始。</p>
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
    state.taskPages = {};
    state.eventRenderPending = false;
    createDrafts.video = null;
    createDrafts.image = null;
    lastSignature = '';
    state.taskTab = 'manage';
    try { localStorage.setItem('h3.tasks.tab', 'manage'); } catch { /* ignore */ }
    if (document.querySelector('#modal:not([hidden])')) closeModal();
  }

  function draftFromEvent(event) {
    const kind = event.kind === 'image' ? 'image' : 'video';
    const draft = newDraft(kind);
    draft.editId = event.id;
    draft.title = event.title || '';
    const inputs = (event.items || []).map((item) => item.input || {})?.filter((input) => input && (input.prompt || input.userPrompt)) || [];
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
        audios: inputs.reduce((sum, input) => sum + (input.audios || []).length, 0),
        ok: true,
      },
      errors: [],
      warnings: [],
      items: inputs.map((input) => ({
        title: input.title || '',
        prompt: String(input.prompt || input.userPrompt || ''),
        images: (Array.isArray(input.images) ? input.images : Array.isArray(input.refs) ? input.refs : []).map((image) => ({ path: image.path, name: image.name || '', note: image.note || '' })),
        audios: (Array.isArray(input.audios) ? input.audios : []).map((audio) => ({ path: audio.path, name: audio.name || '', note: audio.note || '' })),
        duration: input.duration || null,
        ratio: input.aspectRatio || input.imageRatio || '16:9',
        resolution: input.resolution || '',
        count: input.count || null,
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
      if (taskMedia() !== kind) { state.taskMedia = kind; localStorage.setItem('h3.tasks.media', kind); }
      state.taskEventStatus = '';
    } else if (!createDrafts[taskMedia()]) {
      createDrafts[taskMedia()] = newDraft(taskMedia());
    }
    state.taskTab = 'create';
    localStorage.setItem('h3.tasks.tab', 'create');
    if (document.querySelector('#modal:not([hidden])')) closeModal();
    window.render();
  }

  async function openDetail(id) {
    const event = await api('/api/events/' + encodeURIComponent(id)+'?paged=1&page='+((state.taskPages||{}).detail||1));
    modalEventId = id;
    const s = event.stats || {};
    const detailPage=taskPagination(event.items||[],'detail',event.itemPaging);
    const items = detailPage.rows.map((item) => `<tr>
      <td>${itemStatusBadge(item.status)}</td>
      <td>${esc(item.title || item.refId)}<div class="hint">${esc(item.refType)} · ${esc(item.refId)}</div></td>
      <td class="hint">${esc(item.error || '—')}</td>
      <td class="evt-actions">${['queued','paused'].includes(item.status)?`<button class="btn sm" data-event-item-action="up" data-item="${esc(item.id)}">上移</button><button class="btn sm" data-event-item-action="down" data-item="${esc(item.id)}">下移</button>`:''}<button class="btn sm ghost" data-event-item-log="${esc(item.id)}" ${item.refId?'':'disabled'}>日志</button><button class="btn sm ghost" data-event-item-probe="${esc(item.refId)}" ${item.refId?'':'disabled'} data-ref-type="${esc(item.refType)}">探针</button>${item.remoteId&&item.provider==='manager'&&['failed','unknown','canceled'].includes(item.status)?`<button class="btn sm" data-event-item-action="resume-original" data-item="${esc(item.id)}">继续查询／下载</button>`:''}${['failed','canceled','skipped'].includes(item.status) ? `<button class="btn sm" data-event-item-action="retry" data-item="${esc(item.id)}">重试</button>` : ''}${['queued','paused'].includes(item.status) ? `<button class="btn sm ghost" data-event-item-action="skip" data-item="${esc(item.id)}" ${item.refId?'':'disabled'}>跳过</button>` : ''}</td>
    </tr>`).join('');
    const panel = openModal(`<div class="modal-head"><h2>${esc(event.title)}</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body">
        <div class="hint">${esc(event.id)} · ${esc(SOURCE[event.source] || event.source)} · 创建 ${new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
        ${event.status==='draft'?`<button class="btn" data-event-edit="${esc(event.id)}">编辑草稿</button><button class="btn primary" data-event-action="queue" data-id="${esc(event.id)}">加入队列</button><button class="btn ghost" data-event-delete="${esc(event.id)}">删除</button>`:''}
        ${event.status==='unscheduled'?`<button class="btn" data-event-edit="${esc(event.id)}">编辑任务</button><button class="btn ghost" data-event-action="cancel" data-id="${esc(event.id)}">取消任务</button><button class="btn ghost" data-event-delete="${esc(event.id)}">删除</button>`:''}
        ${event.status==='canceled'?`<button class="btn ghost" data-event-delete="${esc(event.id)}">删除</button>`:''}
        <div class="row evt-actions" style="gap:8px;flex-wrap:wrap;margin:8px 0">
          ${['queued','running'].includes(event.status) ? `<button class="btn sm" data-event-action="pause" data-id="${esc(event.id)}">暂停</button>` : ''}
          ${event.status === 'paused' ? `<button class="btn sm" data-event-action="resume" data-id="${esc(event.id)}">继续</button>` : ''}
          ${['queued','running','paused'].includes(event.status) ? `<button class="btn sm ghost" data-event-action="cancel" data-id="${esc(event.id)}">取消</button>` : ''}
          ${s.failed ? `<button class="btn sm" data-event-action="retry-failed" data-id="${esc(event.id)}">重试失败项</button>` : ''}
        </div>
        <div class="row" style="gap:16px;flex-wrap:wrap">
          <span>状态：${badge(event.status)}</span>
          <span>条目：${s.done || 0}/${s.total || 0} 完成</span>
          <span>失败：${s.failed || 0}</span>
          <span>执行中：${s.running || 0}</span>
          <span>未知：${s.unknown || 0}</span>
        </div>
        ${items ? `<div class="table-wrap"><table class="jobs"><thead><tr><th>状态</th><th>条目</th><th>错误</th><th>操作</th></tr></thead><tbody>${items}</tbody></table></div>` : '<div class="hint">这个事件还没有条目。</div>'}
        ${detailPage.footer}<div id="evt-report"></div><div id="evt-attempts"></div>
        <div id="evt-item-log"></div>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>`);
    panel.classList.add('modal-wide');
    const logBox = document.querySelector('#evt-item-log');
    api('/api/events/'+encodeURIComponent(id)+'/attempts?page='+((state.taskPages||{}).attempts||1)).then(data=>{const target=document.querySelector('#evt-attempts');if(!target)return;const attempts=data.items.flatMap(i=>i.attempts.map(a=>({...a,title:i.title})));const page=taskPagination(attempts,'attempts',data);target.innerHTML=attempts.length?'<details><summary>执行历史（'+data.total+'）</summary>'+page.rows.map(a=>'<div class="evt-report-row"><span>'+esc(a.title)+' · '+esc(a.status)+' · '+new Date(a.createdAt).toLocaleString()+'</span><button class="btn sm" data-attempt-log="'+esc(a.id)+'">查看本次日志</button></div>').join('')+page.footer+'</details>':'';}).catch(()=>{});
    panel.addEventListener('click',async e=>{const page=e.target.closest('[data-task-page]');if(page){state.taskPages={...(state.taskPages||{}),[page.dataset.pageKey]:Number(page.dataset.taskPage)};await openDetail(id);return;}const attempt=e.target.closest('[data-attempt-log]');if(attempt){try{const data=await api('/api/task-attempts/'+encodeURIComponent(attempt.dataset.attemptLog)+'/logs');logBox.innerHTML='<pre class="evt-log">'+esc(data.lines.map(l=>l.text||l.message||'').join('\n'))+'</pre>'+(data.hasMore?'<button class="btn" data-more-attempt="'+esc(data.id)+'" data-after="'+data.next+'">继续加载</button>':'');}catch(err){toast(err.message,true);}}const more=e.target.closest('[data-more-attempt]');if(more){const data=await api('/api/task-attempts/'+encodeURIComponent(more.dataset.moreAttempt)+'/logs?after='+more.dataset.after);logBox.querySelector('pre').textContent+='\n'+data.lines.map(l=>l.text||l.message||'').join('\n');more.dataset.after=data.next;more.hidden=!data.hasMore;}});

    const reportBox = document.querySelector('#evt-report');
    api('/api/events/' + encodeURIComponent(id) + '/report').then((report) => {
      const failures = (report.failures || []).map((f) => `<li>${esc(f.provider || '未知')} · ${esc(f.channelId || '-')} · ${esc(f.error.slice(0, 120))} ×${f.count}</li>`).join('');
      reportBox.innerHTML = `<div class="evt-report">
        <div class="evt-report-row"><b>成功率</b><span>${report.successRate == null ? '—' : report.successRate + '%'}</span><span class="hint">成功 ${report.success} / 失败 ${report.failed} / 取消 ${report.canceled} / 跳过 ${report.skipped} / 未知 ${report.unknown}</span></div>
        <div class="evt-report-row"><b>耗时</b><span>P50 ${fmtMs(report.durationMs.p50)} · P90 ${fmtMs(report.durationMs.p90)} · 最长 ${fmtMs(report.durationMs.max)}</span></div>
        ${failures ? `<div class="evt-report-row"><b>失败归因</b><ul class="evt-failures">${failures}</ul></div>` : ''}
        <div class="evt-report-row"><a class="btn sm" href="/api/events/${encodeURIComponent(id)}/report?format=csv" download>导出 CSV</a></div>
      </div>`;
    }).catch(() => { reportBox.innerHTML = ''; });
    document.querySelectorAll('[data-event-item-probe]').forEach((button) => {
      button.onclick = async () => {
        try {
          const result = await api('/api/tasks/' + encodeURIComponent(button.dataset.eventItemProbe) + '/probe', { method: 'POST', body: {} });
          logBox.innerHTML = '<h3 style="margin:12px 0 6px">探针结果</h3><pre class="evt-log">' + esc(JSON.stringify(result, null, 2)) + '</pre>';
        } catch (err) {
          toast(err.message, true);
        }
      };
    });
    document.querySelectorAll('[data-event-item-action]').forEach((button) => {
      button.onclick = () => runItemAction(button.dataset.eventItemAction, button.dataset.item).catch((err) => toast(err.message, true));
    });
    document.querySelectorAll('[data-event-item-log]').forEach((button) => {
      button.onclick = async () => {
        const data = await api('/api/events/' + encodeURIComponent(id) + '/items/' + encodeURIComponent(button.dataset.eventItemLog) + '/log');
        logBox.innerHTML = '<h3 style="margin:12px 0 6px">条目日志：' + esc(data.item?.title || data.item?.refId || '') + '</h3>' +
          ((data.lines || []).length
            ? '<pre class="evt-log">' + esc(data.lines.map((l) => (l.t ? new Date(l.t).toLocaleTimeString('zh-CN', { hour12: false }) + ' ' : '') + (l.level || 'info') + ' ' + (l.text || '')).join('\n')) + '</pre>'
            : '<div class="hint">没有日志记录。</div>');
      };
    });
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
    root.addEventListener('click', (event) => {
      const filter=event.target.closest('[data-event-status]');
      if(filter){state.taskEventStatus=filter.dataset.eventStatus;state.taskPages={...(state.taskPages||{}),events:1};lastSignature='';load();return;}
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

  return { render, renderCreate, renderSchedule, renderMonitor, renderLogs, load, bind, resetForProject, openCreatePage, openDetail, openSchedule, openAttempts, openLogs, confirmDelete };
})();
