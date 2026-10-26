'use strict';
const IJ=(()=>{
 let initialized=false,polling=false,modalTask=null;
 const label={queued:'排队中',running:'生成中',paused:'已暂停',success:'完成',failed:'失败',interrupted:'服务中断'};
 const tasks=()=>state.imageTasks||[];
 const own=()=>tasks().filter(t=>t.itemId===WB.context('image').itemId&&t.projectId===studioProjectId());
 const active=id=>tasks().some(t=>t.itemId===id&&['queued','running','paused'].includes(t.status));
 async function refresh(){
  if(polling)return;polling=true;
  try{
   const before=JSON.stringify(tasks().map(t=>[t.id,t.status,t.phase,t.logs.length]));
   state.imageTasks=(await api('/api/images/tasks')).tasks;
   for(const task of tasks())if(task.status==='success')await WB.reconcileImageTask(task);
   const changed=before!==JSON.stringify(tasks().map(t=>[t.id,t.status,t.phase,t.logs.length]));
   if(changed&&['image','jobs','logs','tasks'].includes(state.route)){
    const typing=document.activeElement?.matches('input,textarea,[contenteditable="true"]');
    if(!typing)render();else{const panel=document.querySelector('#image-task-panel');if(panel)panel.outerHTML=panelHtml();}
   }
   updateStatus();
   if(modalTask&&document.querySelector('#ij-log-lines'))drawDetail(tasks().find(t=>t.id===modalTask));
  }catch(e){const el=document.querySelector('#ij-poll-state');if(el)el.textContent='任务状态同步失败，后台任务继续；点击刷新重连';}
  finally{polling=false;}
 }
 function panelHtml(){
  const current=own(),task=current.find(t=>['queued','running','paused'].includes(t.status))||current[0];
  return '<section id="image-task-panel" class="ij-panel"><div><b>图像任务</b><span id="ij-poll-state">'+(task?esc(label[task.status]||task.status)+' · '+esc(task.phase):'任务在后台执行，切换菜单不中断')+'</span></div><div class="ij-actions">'+(task?'<button class="btn sm" data-ij="detail" data-id="'+task.id+'">查看日志</button>'+controls(task):'')+'<button class="btn sm" data-ij="all">全部图像任务 / 日志</button></div></section>';
 }
 function current(){return own().find(t=>['queued','running','paused'].includes(t.status))||null;}
 function canvas(){
  const task=current();if(!task)return '';
  const paused=task.status==='paused',title=paused?'图像任务已暂停':task.status==='queued'?'图像任务排队中':'正在生成图片…';
  return '<div id="image-task-canvas" class="img-generating ij-canvas-state" role="status" aria-live="polite"><div class="ij-canvas-card">'+(paused?'<span class="ij-pause-icon">Ⅱ</span>':'<span class="img-spin" aria-hidden="true"></span>')+'<h2>'+title+'</h2><p>'+esc(task.phase)+'</p><small>'+esc(task.snapshot.channelName||'')+' · '+esc(task.snapshot.model||'')+(task.snapshot.count?' · '+task.snapshot.count+' 张':'')+'</small><div class="ij-canvas-actions"><button class="btn" data-ij="detail" data-id="'+task.id+'">查看生成日志</button>'+controls(task)+'</div><small>生成完成后，图片会显示在这里。切换页面不会中断任务。</small></div></div>';
 }
 function controls(t){return ['queued','running','paused'].includes(t.status)?'<button class="btn sm" data-ij="'+(t.held?'resume':'pause')+'" data-id="'+t.id+'">'+(t.held?'继续':'暂停')+'</button>':t.status==='failed'||t.status==='interrupted'?'<button class="btn sm" data-ij="retry" data-id="'+t.id+'">重新生成</button>':'';}
 function logTable(rows){
  if(!rows.length)return '<div class="card"><div class="empty"><strong>还没有任务日志</strong><p>提交任务后，这里会记录每一步。</p></div></div>';
  return '<div class="table-wrap generation-log-table"><table class="jobs"><colgroup><col style="width:16%"><col style="width:28%"><col style="width:18%"><col style="width:24%"><col style="width:14%"></colgroup><thead><tr><th>时间</th><th>任务</th><th>状态</th><th>错误</th><th>操作</th></tr></thead><tbody>'+rows.map(r=>'<tr><td class="small">'+fmtTime(r.createdAt)+'</td><td><strong>'+esc(r.title)+'</strong><div class="hint mono">'+esc(r.id)+'</div></td><td>'+r.statusHtml+'</td><td class="small generation-log-error">'+(r.error?esc(r.error):'<span class="muted">—</span>')+'</td><td><div class="cell-actions">'+r.actions+'</div></td></tr>').join('')+'</tbody></table></div>';
 }
 function table(compact=false){
  const rows=tasks().map(t=>({id:t.id,createdAt:t.createdAt,title:(t.snapshot.userPrompt||t.snapshot.prompt||'图像生成任务').slice(0,60),statusHtml:'<span class="badge '+(t.status==='success'?'ok':['failed','interrupted'].includes(t.status)?'bad':t.status==='running'?'info':'')+'">'+esc(label[t.status]||t.status)+'</span><div class="hint">'+esc(t.phase)+'</div>',error:t.error,actions:'<button class="btn sm" data-ij="detail" data-id="'+t.id+'">查看日志</button>'+controls(t)}));
  return '<section class="ij-table '+(compact?'is-log-tab':'')+'">'+(compact?'':'<h2>图像任务与日志</h2><p>提交、等待、保存和错误会写入 SQLite，切换菜单和刷新页面不会取消任务。</p>')+logTable(rows)+'</section>';
 }
 async function detail(id){
  const task=await api('/api/images/tasks/'+id);modalTask=id;
  openModal('<div class="modal-head"><h2>图像任务日志</h2><button class="btn" data-close="1">关闭</button></div><div class="modal-body"><div id="ij-detail-status"></div><p class="mono">'+esc(id)+'</p><div id="ij-log-lines"></div><details><summary>生成提示词</summary><pre class="wb-prompt">'+esc(task.snapshot.userPrompt||task.snapshot.prompt||'未记录')+'</pre></details><div id="ij-outputs"></div></div><div class="modal-foot">'+controls(task)+'<button class="btn" data-ij="refresh">刷新日志</button></div>');drawDetail(task);
 }
 function drawDetail(t){if(!t)return;const status=document.querySelector('#ij-detail-status'),lines=document.querySelector('#ij-log-lines'),out=document.querySelector('#ij-outputs');if(!lines)return;status.textContent=(label[t.status]||t.status)+' · '+t.phase+(t.error?' · '+t.error:'');lines.innerHTML=t.logs.map(l=>'<div class="ij-log '+esc(l.level)+'"><time>'+new Date(l.time).toLocaleTimeString()+'</time><span>'+esc(l.message)+'</span></div>').join('');out.innerHTML=(t.result?.items||[]).map((item,n)=>'<button type="button" class="ij-result" data-ij="result" data-id="'+t.id+'" data-index="'+n+'"><img src="/api/file?path='+enc(item.path)+'" alt="'+esc(item.name)+'"><span>'+esc(item.name)+'</span></button>').join('');}
 function init(){if(initialized)return;initialized=true;refresh();setInterval(refresh,1800);
  document.addEventListener('click',async e=>{const btn=e.target.closest('[data-ij]');if(!btn)return;e.preventDefault();const action=btn.dataset.ij,id=btn.dataset.id;try{
    if(action==='all'){state.logTab='image';localStorage.setItem('h3.logs.tab','image');if(location.hash==='#logs')render();else location.hash='#logs';return;}
    if(action==='detail'){await detail(id);return;}
    if(action==='refresh'){await refresh();if(modalTask)await detail(modalTask);return;}
    if(action==='result'){const task=tasks().find(t=>t.id===id);const item=task?.result?.items[Number(btn.dataset.index)];if(item)openMediaDetail({...item,kind:'image'});return;}
    if(action==='retry'&&!confirm('重新提交到图像渠道会产生新的生成任务，确认重新生成？'))return;
    const task=await api('/api/images/tasks/'+id+'/'+action,{method:'POST',body:{}});await refresh();
    toast(action==='pause'?task.phase:action==='resume'?'已继续后台任务':'已新建后台图像任务');if(document.querySelector('#ij-log-lines'))await detail(action==='retry'?task.id:id);
   }catch(err){toast(err.message,true);}});
 }
 return {init,refresh,panel:panelHtml,table,logTable,active,current,canvas};
})();
