'use strict';

/* app.ops.js — 批量 / 日志 / 任务管理
 * 由 web/app.js 按原段注释切分而来（第 11054–11285 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */

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
