'use strict';
/* 任务事件：列表 / 详情 / 创建（P1 最小闭环） */
const Events = (() => {
  let timer = null;
  let lastSignature = '';
  let modalEventId = null;
  const STATUS = { draft: '草稿', queued: '排队', running: '执行中', paused: '暂停', completed: '完成', partial: '部分失败', failed: '失败', canceled: '已取消', interrupted: '已中断' };
  const SOURCE = { batch: '批量导入', studio: '创作台', image: '图像台', api: '接口' };
  const ITEM = { queued: '排队', running: '执行中', success: '完成', failed: '失败', canceled: '已取消', skipped: '跳过', unknown: '未知', paused: '暂停' };

  async function load() {
    try {
      const data = await api('/api/events');
      const events = data.events || [];
      const signature = JSON.stringify(events.map((e) => [e.id, e.status, e.stats && e.stats.done, e.stats && e.stats.total, e.stats && e.stats.failed]));
      const changed = signature !== lastSignature;
      lastSignature = signature;
      state.events = events;
      state.eventStats = data.stats || null;
      if (!changed) return;
    } catch (err) {
      state.events = state.events || [];
      state.eventError = err.message;
    }
    if (state.route === 'tasks' && currentTaskTab() === 'events') window.render();
  }

  const fmtMs = (ms) => ms == null ? '—' : (ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's');

  function badge(status) {
    const cls = status === 'completed' ? 'ok' : status === 'failed' ? 'bad' : status === 'running' ? 'info' : '';
    return `<span class="badge ${cls}">${esc(STATUS[status] || status)}</span>`;
  }

  function duration(event) {
    const start = event.startedAt || event.createdAt;
    const end = event.finishedAt || Date.now();
    if (!start) return '—';
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    if (seconds < 60) return seconds + 's';
    return Math.floor(seconds / 60) + 'm' + String(seconds % 60).padStart(2, '0') + 's';
  }

  function render() {
    const events = state.events || [];
    const stats = state.eventStats || null;
    const rows = events.map((event) => {
      const s = event.stats || {};
      const progress = s.total ? Math.round(((s.done || 0) / s.total) * 100) : 0;
      return `<tr>
        <td>${badge(event.status)}</td>
        <td><div class="evt-title">${esc(event.title)}</div><div class="hint">${esc(event.id)}${event.status === 'interrupted' ? ' · 待对账' : ''}</div></td>
        <td>${esc(SOURCE[event.source] || event.source)}</td>
        <td><div class="evt-progress"><span style="width:${progress}%"></span></div><div class="hint">${s.done || 0}/${s.total || 0} 完成${s.failed ? ' · ' + s.failed + ' 失败' : ''}${s.running ? ' · ' + s.running + ' 执行中' : ''}</div></td>
        <td class="tnum">${duration(event)}</td>
        <td class="hint">${event.createdAt ? new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
        <td class="evt-actions"><button class="btn sm" data-event-detail="${esc(event.id)}">详情</button>${['queued', 'running'].includes(event.status) ? `<button class="btn sm ghost" data-event-action="pause" data-id="${esc(event.id)}">暂停</button>` : ''}${event.status === 'paused' ? `<button class="btn sm" data-event-action="resume" data-id="${esc(event.id)}">继续</button>` : ''}${['queued', 'running', 'paused'].includes(event.status) ? `<button class="btn sm ghost" data-event-action="cancel" data-id="${esc(event.id)}">取消</button>` : ''}${(event.stats && event.stats.failed) ? `<button class="btn sm" data-event-action="retry-failed" data-id="${esc(event.id)}">重试失败</button>` : ''}</td>
      </tr>`;
    }).join('');
    return `
    <div class="evt-toolbar">
      <button class="btn primary" data-event-create="1">创建事件</button>
      <button class="btn" data-event-refresh="1">刷新</button>
      <button class="btn" data-event-range="7">近 7 天报告</button>
      <span class="grow"></span>
      ${stats ? `<span class="hint">事件 ${stats.total} · 执行中 ${stats.running} · 排队 ${stats.queued} · 完成 ${stats.completed} · 部分失败 ${stats.partial} · 失败 ${stats.failed}</span>` : ''}
    </div>
    ${state.eventError ? `<div class="card" style="padding:12px;color:var(--h3-danger)">事件加载失败：${esc(state.eventError)}</div>` : ''}
    ${rows ? `<div class="table-wrap"><table class="jobs evt-table">
      <thead><tr><th>状态</th><th>事件</th><th>来源</th><th>条目进度</th><th>耗时</th><th>创建</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>` : `<div class="card"><div class="empty"><strong>还没有事件</strong><p>点「创建事件」导入批量 JSON，或在创作台生成一条——单条生成会自动记成一个事件。</p><button class="btn primary" data-event-create="1">创建事件</button></div></div>`}`;
  }

  function openCreate() {
    const workflows = (state.workflows || []).map((w) => `<option value="${esc(w.id)}">${esc(w.display || w.id)}</option>`).join('');
    openModal(`<div class="modal-head"><h2>创建事件</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body">
        <div class="row"><span class="muted small">工作流</span><select class="select" id="evt-workflow" style="flex:1">${workflows}</select></div>
        <div class="row"><span class="muted small">标题</span><input class="input" id="evt-title" placeholder="留空用批次名称" style="flex:1" /></div>
        <div class="hint">粘贴批量 JSON（与「批量导入」同格式）；每个任务会成为一个条目，整批是一个事件。</div>
        <textarea class="textarea mono" id="evt-json" style="min-height:260px" placeholder='{"format":"zealman-h3-batch","version":1,"tasks":[...]}'></textarea>
      </div>
      <div class="modal-foot"><span class="hint grow" id="evt-msg"></span><button class="btn" data-close="1">取消</button><button class="btn primary" id="evt-submit">创建事件</button></div>`);
    const submit = document.querySelector('#evt-submit');
    submit.onclick = async () => {
      const json = document.querySelector('#evt-json').value.trim();
      const workflowId = document.querySelector('#evt-workflow').value;
      const title = document.querySelector('#evt-title').value.trim();
      const msg = document.querySelector('#evt-msg');
      if (!json) { msg.textContent = '先粘贴批量 JSON'; return; }
      submit.disabled = true;
      try {
        const event = await api('/api/events/import', { method: 'POST', body: { json, workflowId, title } });
        msg.textContent = '';
        closeModal();
        await load();
        await load();
        openDetail(event.id);
        toast('事件已创建：' + (event.stats?.total || 0) + ' 个条目');
      } catch (err) {
        msg.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    };
  }

  async function openDetail(id) {
    const event = await api('/api/events/' + encodeURIComponent(id));
    modalEventId = id;
    const s = event.stats || {};
    const items = (event.items || []).map((item) => `<tr>
      <td>${badge(item.status === 'success' ? 'completed' : item.status)}</td>
      <td>${esc(item.title || item.refId)}<div class="hint">${esc(item.refType)} · ${esc(item.refId)}</div></td>
      <td class="hint">${esc(item.error || '—')}</td>
      <td class="evt-actions"><button class="btn sm ghost" data-event-item-log="${esc(item.id)}">日志</button><button class="btn sm ghost" data-event-item-probe="${esc(item.refId)}" data-ref-type="${esc(item.refType)}">探针</button>${['failed','canceled','skipped','unknown'].includes(item.status) ? `<button class="btn sm" data-event-item-action="retry" data-item="${esc(item.id)}">重试</button>` : ''}${['queued','paused'].includes(item.status) ? `<button class="btn sm ghost" data-event-item-action="skip" data-item="${esc(item.id)}">跳过</button>` : ''}</td>
    </tr>`).join('');
    const panel = openModal(`<div class="modal-head"><h2>${esc(event.title)}</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body">
        <div class="hint">${esc(event.id)} · ${esc(SOURCE[event.source] || event.source)} · 创建 ${new Date(event.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
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
        <div id="evt-report"></div>
        <div id="evt-item-log"></div>
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>`);
    panel.classList.add('modal-wide');
    const logBox = document.querySelector('#evt-item-log');
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
    }, 8000);
  }

  function bind(root) {
    root.addEventListener('click', (event) => {
      const create = event.target.closest('[data-event-create]');
      if (create) { openCreate(); return; }
      const refresh = event.target.closest('[data-event-refresh]');
      if (refresh) { load(); return; }
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
    const action = event.target.closest('[data-event-action]');
    if (!action || !action.closest('#modal')) return;
    event.preventDefault();
    runAction(action.dataset.eventAction, action.dataset.id).catch((err) => toast(err.message, true));
  });

  async function openRangeReport(days) {
    const report = await api('/api/events/report?days=' + encodeURIComponent(days));
    const daily = (report.daily || []).map((d) => `<tr><td>${esc(d.day)}</td><td>${d.events}</td><td>${d.items}</td><td>${d.success}</td><td>${d.failed}</td></tr>`).join('');
    openModal(`<div class="modal-head"><h2>近 ${report.days} 天报告</h2><button class="btn" data-close="1">关闭</button></div>
      <div class="modal-body">
        <div class="evt-report-row"><b>成功率</b><span>${report.successRate == null ? '—' : report.successRate + '%'}</span><span class="hint">事件 ${report.events} · 条目 ${report.items} · 成功 ${report.success} · 失败 ${report.failed} · 未知 ${report.unknown}</span></div>
        ${daily ? `<div class="table-wrap"><table class="jobs"><thead><tr><th>日期</th><th>事件</th><th>条目</th><th>成功</th><th>失败</th></tr></thead><tbody>${daily}</tbody></table></div>` : '<div class="hint">这段时间还没有事件。</div>'}
      </div>
      <div class="modal-foot"><span class="grow"></span><button class="btn" data-close="1">关闭</button></div>`);
  }

  return { render, load, bind, openCreate, openDetail, openRangeReport };
})();
