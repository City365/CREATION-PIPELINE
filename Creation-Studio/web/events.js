'use strict';
/* 任务事件：列表 / 详情 / 创建（P1 最小闭环） */
const Events = (() => {
  let timer = null;
  let lastSignature = '';
  let modalEventId = null;
  const STATUS = { draft: '草稿', queued: '排队', running: '执行中', paused: '暂停', completed: '完成', partial: '部分失败', failed: '失败', canceled: '已取消', interrupted: '待确认', unknown:'待确认' };
  const SOURCE = { batch: '批量导入', studio: '创作台', image: '图像台', api: '接口' };
  const ITEM = { queued: '排队', running: '执行中', success: '完成', failed: '失败', canceled: '已取消', skipped: '跳过', unknown: '未知', paused: '暂停' };

  async function load() {
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
      if (!changed && !hadError) return;
    } catch (err) {
      state.events = state.events || [];
      state.eventError = err.message;
    }
    if (state.route === 'tasks' && ['manage','schedule','monitor'].includes(currentTaskTab())) window.render();
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

  function render(mode='manage') {
    const events = state.events || [];
    const page = taskPagination(events, 'events', state.eventPaging);
    const rows = page.rows.map((event) => {
      const s = event.stats || {};
      const progress = s.total ? Math.round(((s.done || 0) / s.total) * 100) : 0;
      return `<tr>
        <td>${badge(event.status)}</td>
        <td><div class="evt-title">${esc(event.title)}</div><div class="hint">${esc(event.id)}${event.status === 'interrupted' ? ' · 待对账' : ''}</div></td>
        <td>${event.legacy?'历史记录':esc(SOURCE[event.source] || event.source)}${mode==='schedule'?`<div class="hint">次序 ${event.schedule?.order||0}<br>${event.schedule?.startAt?esc(event.schedule.startAt):'立即执行'}</div>`:''}</td>
        <td><div class="evt-progress"><span style="width:${progress}%"></span></div><div class="hint">${s.done || 0}/${s.total || 0} 已处理${s.failed ? ' · ' + s.failed + ' 失败' : ''}${s.running ? ' · ' + s.running + ' 执行中' : ''}</div></td>
        <td class="tnum">${duration(event)}</td>
        <td class="hint">${event.createdAt ? new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
        <td class="evt-actions"><button class="btn sm" data-event-detail="${esc(event.id)}">详情</button>${event.status==='draft'?`<button class="btn sm" data-event-action="queue" data-id="${esc(event.id)}">加入队列</button>`:''}${mode==='schedule'&&['draft','queued','running','paused'].includes(event.status)?`<button class="btn sm" data-event-schedule="${esc(event.id)}">调度设置</button>`:''}${['queued', 'running'].includes(event.status) ? `<button class="btn sm ghost" data-event-action="pause" data-id="${esc(event.id)}">暂停后续</button>` : ''}${event.status === 'paused' ? `<button class="btn sm" data-event-action="resume" data-id="${esc(event.id)}">继续</button>` : ''}${['queued', 'running', 'paused'].includes(event.status) ? `<button class="btn sm ghost" data-event-action="cancel" data-id="${esc(event.id)}">取消未提交</button>` : ''}${(event.stats && event.stats.failed) ? `<button class="btn sm" data-event-action="retry-failed" data-id="${esc(event.id)}">重试失败</button>` : ''}</td>
      </tr>`;
    }).join('');
    return `
    <form class="task-search" data-events-search><label for="event-search">搜索任务</label><div><input class="input" id="event-search" name="query" value="${esc(state.taskEventQuery||'')}" placeholder="任务名称"><button class="btn" type="submit">搜索</button></div></form>
    <div class="filters">${[['','全部'],['draft','草稿'],['queued','排队'],['running','执行中'],['paused','暂停'],['failed','失败'],['interrupted','待确认'],['completed','完成']].map(([value,label])=>`<button class="chip ${(state.taskEventStatus||'')===value?'active':''}" data-event-status="${value}">${label}</button>`).join('')}</div>
    ${state.eventError ? `<div class="card" style="padding:12px;color:var(--h3-danger)">事件加载失败：${esc(state.eventError)}</div>` : ''}
    ${rows ? `<div class="table-wrap"><table class="jobs evt-table">
      <thead><tr><th>状态</th><th>任务</th><th>来源</th><th>条目进度</th><th>耗时</th><th>创建</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${page.footer}` : `<div class="card"><div class="empty"><strong>还没有任务</strong><p>创建单条或批量任务；创作台提交的任务也会记录在这里。</p><button class="btn primary" data-event-create="1">创建任务</button></div></div>`}`;
  }

  /* ---------------- 创建任务页 ---------------- */
  /* 创建只接受固定格式的 JSON / XLSX 文件：单条任务也用一份文件（一行），参考图路径写在文件里。 */

  const createDrafts = { video: null, image: null };
  const FILE_KIND_LABEL = { json: 'JSON', xlsx: 'Excel', draft: '草稿' };

  function workflowFor(id) { return (state.workflows || []).find((w) => w.id === id) || null; }

  function defaultChannelId(kind) {
    if (kind === 'video') {
      const active = (state.channels?.video || []).find((c) => c.active && c.enabled !== false);
      const workflow = (active && (state.workflows || []).find((w) => w.channelId === active.id))
        || (state.workflows || []).find((w) => w.id === state.studio?.workflowId)
        || (state.workflows || [])[0];
      return workflow ? workflow.id : '';
    }
    const list = (state.channels?.image || []).filter((c) => c.enabled !== false);
    const channel = list.find((c) => c.active) || list[0];
    return channel ? channel.id : '';
  }

  function newDraft(kind) {
    return {
      kind,
      editId: '',
      title: '',
      channel: defaultChannelId(kind),
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

  function channelOptions(draft) {
    if (draft.kind === 'video') {
      const list = state.workflows || [];
      if (!list.length) return '<option value="">还没有可用的视频渠道</option>';
      return list.map((w) => `<option value="${esc(w.id)}"${w.id === draft.channel ? ' selected' : ''}>${esc(w.display || w.label || w.id)}</option>`).join('');
    }
    const list = (state.channels?.image || []).filter((c) => c.enabled !== false);
    if (!list.length) return '<option value="">还没有可用的图像渠道</option>';
    return list.map((c) => `<option value="${esc(c.id)}"${c.id === draft.channel ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  }

  /** 渠道能力拆成「一句话来源 + 一排标签」，避免长句把表单撑得高低不一。 */
  function channelInfo(draft) {
    if (draft.kind === 'image') {
      return {
        summary: '图像渠道在 设置 → 图片生成 维护',
        caps: ['画幅 4 种', '生成张数 1–4', '时长 / 分辨率忽略'],
      };
    }
    const workflow = workflowFor(draft.channel);
    if (!workflow) return { summary: '还没有可用的视频渠道，请先到 设置 → 视频生成 添加一条', caps: [] };
    const caps = [];
    const options = workflow.durationOptions || [];
    if (options.length > 1) caps.push(`时长 ${options[0]}–${options[options.length - 1]} 秒`);
    else if (options.length === 1) caps.push(`时长固定 ${options[0]} 秒`);
    if (workflow.sizeMode === 'ratio' && (workflow.ratios || []).length) caps.push(`画幅 ${workflow.ratios.length} 种`);
    if (workflow.sizeMode === 'resolution' && (workflow.resolutions || []).length) caps.push(`分辨率 ${workflow.resolutions.length} 档`);
    if (workflow.images) caps.push(workflow.optionalImages ? `参考图 ≤${workflow.images} 张（可选）` : `参考图 ≤${workflow.images} 张`);
    else caps.push('不需要参考图');
    if (workflow.audios) caps.push(`音频 ≤${workflow.audios} 段`);
    return { summary: String(workflow.providerLabel || workflow.provider || '已选渠道'), caps };
  }

  function fileLabel(file) {
    const format = FILE_KIND_LABEL[file.format] || String(file.format || '文件');
    return `${format} · ${file.stats.items} 条任务 · ${file.stats.images} 张参考图`;
  }

  function renderIssues(file) {
    if (!file) return '';
    const errors = file.errors || [];
    const warnings = file.warnings || [];
    const block = (list, cls, title) => (list.length
      ? `<div class="create-issues ${cls}"><b>${esc(title)}</b><ul>${list.map((text) => `<li>${esc(text)}</li>`).join('')}</ul></div>`
      : '');
    return block(errors, '', `${errors.length} 个问题，修正文件后重新上传`) + block(warnings, 'is-warn', `${warnings.length} 个提醒`);
  }

  function previewTable(file) {
    if (!file || !(file.items || []).length) return '';
    const shown = file.items.slice(0, 30);
    const rows = shown.map((item) => {
      const images = (item.images || []).length;
      const audios = (item.audios || []).length;
      return `<tr>
        <td class="tnum">${item.line}</td>
        <td>${esc(item.title || '—')}</td>
        <td><div class="create-prompt">${esc(item.prompt || '—')}</div></td>
        <td>${images ? images + ' 张' : '—'}${audios ? ' · 音频 ' + audios : ''}</td>
        <td>${item.duration ? item.duration + ' 秒' : '默认'}</td>
        <td>${esc(item.ratio || '默认')}</td>
      </tr>`;
    }).join('');
    return `<div class="table-wrap create-preview-table"><table class="jobs">
      <thead><tr><th>行</th><th>标题</th><th>提示词</th><th>参考素材</th><th>时长</th><th>画幅</th></tr></thead>
      <tbody>${rows}</tbody></table></div>${file.items.length > shown.length ? `<p class="hint">只预览前 ${shown.length} 条，共 ${file.items.length} 条。</p>` : ''}`;
  }

  function summaryText(draft) {
    const file = draft.file;
    if (!file) return '还没有上传任务文件';
    const parts = [fileLabel(file)];
    if ((file.errors || []).length) parts.push(`${file.errors.length} 个问题待修正`);
    else if (!(file.items || []).length) parts.push('文件里没有任务');
    else parts.push('提交时创建一个事件');
    return parts.join(' · ');
  }

  function formatDoc() {
    return `<details class="create-advanced"><summary>文件格式说明（固定格式，不支持一行一条的文本）</summary>
      <div class="create-doc">
        <p><b>Excel</b>：第一张表，第一行表头必须完全一致——<code>任务标题</code><code>提示词</code><code>参考图路径</code><code>参考图说明</code><code>时长（秒）</code><code>画幅</code><code>分辨率</code><code>生成张数</code>。第二张表是填写说明，不会参与解析。</p>
        <p><b>JSON</b>：<code>{"items":[{"title":"…","prompt":"…","duration":10,"ratio":"16:9","resolution":"","count":1,"images":[{"path":"D:/素材/a.png","note":"女主正面"}]}]}</code></p>
        <ul>
          <li>单条任务也放一行 / 一个 item，不再单独提供单条表单。</li>
          <li>参考图路径写绝对路径，或相对素材库的路径；多个用英文分号 <code>;</code> 分隔，说明与路径一一对应。</li>
          <li>时长 1–15 的整数；画幅 <code>16:9 / 9:16 / 1:1 / 4:3 / 3:4</code>；留空用渠道默认值。</li>
          <li>图像任务用「画幅 / 生成张数」，时长与分辨率可留空；视频任务用「时长 / 分辨率」。</li>
          <li>文件里写错参考图路径会按行号报出来，不会静默跳过。</li>
        </ul>
      </div>
    </details>`;
  }

  function renderCreate() {
    const draft = currentDraft();
    const kind = draft.kind;
    const file = draft.file;
    const busy = !!draft.busy;
    const channel = channelInfo(draft);
    return `<div class="create-page">
      <div class="task-panel-head">
        <div><h2>创建${kind === 'image' ? '图像' : '视频'}任务</h2><p>任务内容全部来自上传的文件：先下载模板，按固定列填好再上传解析。</p></div>
        <span class="task-panel-note">${draft.editId ? '正在编辑草稿' : '保存草稿不会自动执行'}</span>
      </div>
      <form class="create-form" id="task-create-form" autocomplete="off">
        <section class="create-section">
          <div class="create-section-head"><span class="create-step">1</span><div><h3>任务与渠道</h3><p>任务名称可以留空，列表里会用首条提示词代替；渠道决定用哪条线路执行。</p></div></div>
          <div class="create-grid create-grid-top">
            <label class="create-field"><span>任务名称<em>可选</em></span><input class="input" id="tc-title" value="${esc(draft.title)}" placeholder="例如：第 3 集 · 雨夜街头"><small>留空时用首条提示词代替</small></label>
            <label class="create-field"><span>${kind === 'video' ? '视频渠道' : '图像渠道'}</span><select class="select" id="tc-channel">${channelOptions(draft)}</select><small>${esc(channel.summary)}</small></label>
          </div>
          ${channel.caps.length ? `<div class="create-caps">${channel.caps.map((cap) => `<span class="create-cap">${esc(cap)}</span>`).join('')}<span class="create-cap is-note">文件里留空的参数用这里的默认值</span></div>` : ''}
          </div>
        </section>
        <section class="create-section">
          <div class="create-section-head"><span class="create-step">2</span><div><h3>任务文件</h3><p>只接受固定格式的 JSON 或 Excel（.xlsx）。先下载示例，照示例填写；单条任务也用一个文件，一行即可。</p></div></div>
          <div class="create-templates">
            <a class="btn" href="/api/task-import/template?format=json" download="task-template.json">下载 JSON 示例</a>
            <a class="btn" href="/api/task-import/template?format=xlsx" download="task-template.xlsx">下载 Excel 示例</a>
            <span class="hint">参考图路径、说明都写在文件里，不再单独选择素材。</span>
          </div>
          <label class="create-drop${busy ? ' is-busy' : ''}" id="tc-drop">
            <input type="file" id="tc-file" accept=".json,.xlsx" hidden>
            ${busy
              ? '<span>正在解析文件…</span><small>只在本机解析，不会上传到外部</small>'
              : file
                ? `<span class="create-file-name">${esc(file.name)}</span><small>${esc(fileLabel(file))} · 点击或拖入别的文件可替换${file.format === 'draft' ? '（当前是已保存草稿的条目）' : ''}</small>`
                : '<span>选择文件，或把文件拖到这里</span><small>支持 .json 与 .xlsx</small>'}
          </label>
          ${renderIssues(file)}
          ${previewTable(file)}
          ${formatDoc()}
        </section>
        <p class="create-msg" id="tc-msg">${esc(draft.msg || '')}</p>
        <div class="create-actions">
          <div class="create-summary" id="tc-summary">${esc(summaryText(draft))}</div>
          <div class="create-action-buttons">
            ${draft.editId ? '<button type="button" class="btn ghost" data-tc-cancel-edit>放弃修改</button>' : ''}
            <button type="button" class="btn" data-tc-save ${busy ? 'disabled' : ''}>${draft.editId ? '保存修改' : '保存草稿'}</button>
            <button type="button" class="btn primary" data-tc-submit ${busy ? 'disabled' : ''}>${draft.editId ? '保存并加入队列' : '加入队列并开始'}</button>
          </div>
        </div>
      </form>
    </div>`;
  }

  function readCreateForm(root) {
    const draft = currentDraft();
    const field = (selector) => root.querySelector(selector);
    if (field('#tc-title')) draft.title = field('#tc-title').value;
    if (field('#tc-channel')) draft.channel = field('#tc-channel').value;
    if (draft.msg) { draft.msg = ''; const box = root.querySelector('#tc-msg'); if (box) box.textContent = ''; }
    return draft;
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        resolve(text.slice(text.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
  }

  async function loadImportFile(file, root) {
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
    } catch (err) {
      const target = currentDraft();
      target.busy = false;
      target.file = null;
      target.msg = err.message;
    }
    window.render();
  }

  function buildCreatePayload(draft) {
    const file = draft.file;
    if (!file) throw new Error('先下载模板填写，再上传 .json 或 .xlsx 文件');
    if ((file.errors || []).length) throw new Error(`文件还有 ${file.errors.length} 个问题，请修正后重新上传`);
    const items = file.items || [];
    if (!items.length) throw new Error('文件里没有任务');
    if (!draft.channel) throw new Error(draft.kind === 'video' ? '请选择视频渠道' : '请选择图像渠道');
    const workflow = draft.kind === 'video' ? workflowFor(draft.channel) : null;
    const defaultDuration = Number(workflow?.durationDefault) || 10;
    const defaultResolution = String(workflow?.defaultResolution || '').trim();
    const defaultRatio = String(workflow?.defaultRatio || (workflow?.ratios || [])[0] || '16:9');
    const built = items.map((entry) => {
      const prompt = String(entry.prompt || '').trim();
      if (!prompt) throw new Error(`第 ${entry.line} 条没有提示词`);
      const images = (entry.images || []).filter((image) => image && image.path && !image.audio)
        .map((image) => ({ path: image.path, name: image.name || '', note: image.note || '' }));
      const audios = (entry.audios || []).filter((audio) => audio && audio.path)
        .map((audio) => ({ path: audio.path, name: audio.name || '' }));
      const base = { title: entry.title || undefined, prompt };
      if (draft.kind === 'image') {
        return {
          ...base,
          refs: images,
          imageRatio: entry.ratio || defaultRatio,
          imageLayoutId: 'free',
          aspectRatio: entry.ratio || defaultRatio,
          count: Math.max(1, Math.min(4, Number(entry.count) || 1)),
          channelId: draft.channel,
        };
      }
      return {
        ...base,
        images,
        audios,
        duration: Number(entry.duration) || defaultDuration,
        aspectRatio: entry.ratio || defaultRatio,
        resolution: entry.resolution || defaultResolution,
        workflowId: draft.channel,
      };
    });
    const title = String(draft.title || '').trim() || String(built[0].prompt || '').slice(0, 30);
    return {
      kind: draft.kind,
      title,
      source: built.length > 1 ? 'batch' : (draft.kind === 'image' ? 'image' : 'studio'),
      items: built,
      draft: true,
      requestId: draft.requestId,
      ...(draft.kind === 'video' ? { workflowId: draft.channel } : { channelId: draft.channel }),
      projectId: state.projectId || '',
    };
  }

  async function submitCreate(root, mode) {
    const draft = readCreateForm(root);
    draft.msg = '';
    let payload;
    try { payload = buildCreatePayload(draft); }
    catch (err) { failCreate(err.message); return; }
    const form = root.querySelector('#task-create-form');
    if (form) form.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    try {
      let event;
      if (draft.editId) {
        event = await api('/api/events/' + encodeURIComponent(draft.editId) + '/draft', { method: 'POST', body: { title: payload.title, items: payload.items } });
        if (mode === 'queue') event = await api('/api/events/' + encodeURIComponent(draft.editId) + '/queue', { method: 'POST', body: {} });
      } else {
        event = await api('/api/events', { method: 'POST', body: { ...payload, draft: mode === 'draft' } });
      }
      createDrafts[draft.kind] = null;
      lastSignature = '';
      toast(mode === 'draft' ? '已保存草稿，可在任务管理里继续编辑' : '已加入队列，开始执行');
      state.taskTab = 'manage';
      state.taskEventStatus = '';
      state.taskEventQuery = '';
      state.taskPages = { ...(state.taskPages || {}), events: 1 };
      localStorage.setItem('h3.tasks.tab', 'manage');
      await load();
      window.render();
      if (mode === 'queue' && event && event.id) openDetail(event.id).catch(() => {});
    } catch (err) {
      failCreate(err.message);
    }
  }

  function failCreate(message) {
    currentDraft().msg = String(message || '创建失败');
    window.render();
    const box = document.querySelector('#tc-msg');
    if (box) box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function bindCreate(root) {
    const form = root.querySelector('#task-create-form');
    if (!form) return;
    form.addEventListener('submit', (event) => event.preventDefault());
    form.addEventListener('input', (event) => {
      if (event.target.id === 'tc-title' || event.target.id === 'tc-channel') readCreateForm(root);
    });
    form.addEventListener('change', (event) => {
      if (event.target.id !== 'tc-channel') return;
      readCreateForm(root);
      window.render();
    });
    form.addEventListener('click', (event) => {
      const save = event.target.closest('[data-tc-save]');
      if (save) { submitCreate(root, 'draft').catch((err) => failCreate(err.message)); return; }
      const submit = event.target.closest('[data-tc-submit]');
      if (submit) { submitCreate(root, 'queue').catch((err) => failCreate(err.message)); return; }
      const cancelEdit = event.target.closest('[data-tc-cancel-edit]');
      if (cancelEdit) { createDrafts[currentDraft().kind] = null; window.render(); }
    });
    const input = form.querySelector('#tc-file');
    if (input) {
      input.addEventListener('change', function onChange() {
        const file = this.files && this.files[0];
        if (file) loadImportFile(file, root).catch((err) => failCreate(err.message));
        this.value = '';
      });
    }
    const drop = form.querySelector('#tc-drop');
    if (drop) {
      drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (event) => {
        event.preventDefault();
        drop.classList.remove('is-over');
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) loadImportFile(file, root).catch((err) => failCreate(err.message));
      });
    }
  }

  function draftFromEvent(event) {
    const kind = event.kind === 'image' ? 'image' : 'video';
    const draft = newDraft(kind);
    const spec = event.spec || {};
    const inputs = (event.items || []).map((item) => item.input || {});
    const first = inputs[0] || {};
    draft.editId = event.id;
    draft.title = event.title || '';
    draft.channel = (kind === 'video' ? (spec.workflowId || first.workflowId) : (spec.channelId || first.channelId)) || draft.channel;
    const items = inputs.map((input, index) => ({
      line: index + 1,
      title: input.title || '',
      prompt: String(input.prompt || input.userPrompt || ''),
      images: (Array.isArray(input.images) ? input.images : Array.isArray(input.refs) ? input.refs : [])
        .map((image) => ({ path: image.path, name: image.name || '', note: image.note || '', exists: true })),
      audios: (Array.isArray(input.audios) ? input.audios : [])
        .map((audio) => ({ path: audio.path, name: audio.name || '', exists: true })),
      duration: input.duration || null,
      ratio: input.aspectRatio || input.imageRatio || null,
      resolution: input.resolution || '',
      count: input.count || null,
    }));
    const images = items.reduce((sum, item) => sum + item.images.length, 0);
    draft.file = {
      format: 'draft',
      name: '已保存草稿 · ' + String(event.id).slice(0, 8),
      items,
      errors: [],
      warnings: ['这是已保存草稿的条目；重新上传文件会整体替换它们'],
      stats: { items: items.length, images, ok: true },
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
      <td>${badge(item.status === 'success' ? 'completed' : item.status)}</td>
      <td>${esc(item.title || item.refId)}<div class="hint">${esc(item.refType)} · ${esc(item.refId)}</div></td>
      <td class="hint">${esc(item.error || '—')}</td>
      <td class="evt-actions">${['queued','paused'].includes(item.status)?`<button class="btn sm" data-event-item-action="up" data-item="${esc(item.id)}">上移</button><button class="btn sm" data-event-item-action="down" data-item="${esc(item.id)}">下移</button>`:''}<button class="btn sm ghost" data-event-item-log="${esc(item.id)}" ${item.refId?'':'disabled'}>日志</button><button class="btn sm ghost" data-event-item-probe="${esc(item.refId)}" ${item.refId?'':'disabled'} data-ref-type="${esc(item.refType)}">探针</button>${item.remoteId&&item.provider==='manager'&&['failed','unknown','canceled'].includes(item.status)?`<button class="btn sm" data-event-item-action="resume-original" data-item="${esc(item.id)}">继续查询／下载</button>`:''}${['failed','canceled','skipped'].includes(item.status) ? `<button class="btn sm" data-event-item-action="retry" data-item="${esc(item.id)}">重试</button>` : ''}${['queued','paused'].includes(item.status) ? `<button class="btn sm ghost" data-event-item-action="skip" data-item="${esc(item.id)}" ${item.refId?'':'disabled'}>跳过</button>` : ''}</td>
    </tr>`).join('');
    const panel = openModal(`<div class="modal-head"><h2>${esc(event.title)}</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body">
        <div class="hint">${esc(event.id)} · ${esc(SOURCE[event.source] || event.source)} · 创建 ${new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
        ${event.status==='draft'?`<button class="btn" data-event-edit="${esc(event.id)}">编辑草稿</button><button class="btn primary" data-event-action="queue" data-id="${esc(event.id)}">加入队列</button>`:''}
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
      if (state.route === 'tasks' && currentTaskTab() === 'events' && !document.querySelector('#modal:not([hidden])')) load();
    }, 3000);
  }

  function bind(root) {
    if (currentTaskTab() === 'create') { bindCreate(root); start(); return; }
    root.querySelector('[data-events-search]')?.addEventListener('submit',async e=>{e.preventDefault();state.taskEventQuery=new FormData(e.target).get('query')||'';state.taskPages={...(state.taskPages||{}),events:1};lastSignature='';await load();});
    root.addEventListener('click', (event) => {
      const filter=event.target.closest('[data-event-status]');if(filter){state.taskEventStatus=filter.dataset.eventStatus;state.taskPages={...(state.taskPages||{}),events:1};lastSignature='';load();return;}
      const schedule=event.target.closest('[data-event-schedule]');if(schedule){openSchedule(schedule.dataset.eventSchedule).catch(err=>toast(err.message,true));return;}
      const create = event.target.closest('[data-event-create]');
      if (create) { openCreatePage().catch((err) => toast(err.message, true)); return; }
      const detail = event.target.closest('[data-event-detail]');
      if (detail) { openDetail(detail.dataset.eventDetail).catch((err) => toast(err.message, true)); return; }
      const action = event.target.closest('[data-event-action]');
      if (action) { runAction(action.dataset.eventAction, action.dataset.id).catch((err) => toast(err.message, true)); return; }
      const range = event.target.closest('[data-event-range]');
      if (range) { openRangeReport(range.dataset.eventRange).catch((err) => toast(err.message, true)); return; }
      const itemAction = event.target.closest('[data-event-item-action]');
      if (itemAction) { runItemAction(itemAction.dataset.eventItemAction, itemAction.dataset.item).catch((err) => toast(err.message, true)); }
    });
    start();
    if (!state.events) load();
  }

  async function openSchedule(id){
    const event=await api('/api/events/'+encodeURIComponent(id));
    openModal(`<div class="modal-head"><h2>调度设置</h2><button class="btn" data-close="1">关闭</button></div><div class="modal-body"><label>执行次序（小值优先）<input class="input" id="evt-order" type="number" value="${event.schedule?.order||0}"></label><label>执行时间（留空立即）<input class="input" id="evt-start" type="datetime-local"></label><label>条目并发<select class="select" id="evt-concurrency">${[1,2,3,4].map(n=>`<option ${n===event.policy?.concurrency?'selected':''}>${n}</option>`).join('')}</select></label><label>失败处理<select class="select" id="evt-fail"><option value="continue">继续其他条目</option><option value="stop" ${event.policy?.onItemFail==='stop'?'selected':''}>停止后续条目</option></select></label><p class="hint">调整只影响尚未派发的条目，已提交请求继续接收结果。</p></div><div class="modal-foot"><button class="btn primary" id="evt-schedule-save">保存</button></div>`);
    document.querySelector('#evt-schedule-save').onclick=async()=>{try{const start=document.querySelector('#evt-start').value;await api('/api/events/'+id+'/schedule',{method:'POST',body:{order:Number(document.querySelector('#evt-order').value),startAt:start?new Date(start).toISOString():event.schedule?.startAt||null,concurrency:Number(document.querySelector('#evt-concurrency').value),onItemFail:document.querySelector('#evt-fail').value}});closeModal();lastSignature='';await load();}catch(err){toast(err.message,true);}};
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

  return { render, renderCreate, load, bind, openCreatePage, openDetail, openRangeReport };
})();
