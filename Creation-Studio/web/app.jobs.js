'use strict';

/* app.jobs.js — 连接器作业
 * 由 web/app.js 按原段注释切分而来（第 2482–2611 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */

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
