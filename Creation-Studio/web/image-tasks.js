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
   if(changed&&['image','jobs','logs'].includes(state.route)){
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
 function controls(t){return ['queued','running','paused'].includes(t.status)?'<button class="btn sm" data-ij="'+(t.held?'resume':'pause')+'" data-id="'+t.id+'">'+(t.held?'继续':'暂停')+'</button>':t.status==='failed'||t.status==='interrupted'?'<button class="btn sm" data-ij="retry" data-id="'+t.id+'">重新生成</button>':'';}
 function table(){return '<section class="ij-table"><h2>图像任务与日志</h2><p>提交、等待、保存和错误会写入 SQLite，切换菜单和刷新页面不会取消任务。</p>'+ (tasks().length?'<table class="jobs"><thead><tr><th>时间 / 任务</th><th>状态</th><th>提示词</th><th>操作</th></tr></thead><tbody>'+tasks().map(t=>'<tr><td>'+fmtTime(t.createdAt)+'<small class="ij-id">'+t.id+'</small></td><td>'+esc(label[t.status]||t.status)+'<div class="hint">'+esc(t.phase)+'</div></td><td class="cell-prompt">'+esc((t.snapshot.userPrompt||t.snapshot.prompt||'').slice(0,100))+(t.error?'<p class="ij-error">'+esc(t.error)+'</p>':'')+'</td><td><button class="btn sm" data-ij="detail" data-id="'+t.id+'">日志 / 结果</button>'+controls(t)+'</td></tr>').join('')+'</tbody></table>':'<p>还没有图像任务。</p>')+'</section>';}
 async function detail(id){
  const task=await api('/api/images/tasks/'+id);modalTask=id;
  openModal('<div class="modal-head"><h2>图像任务日志</h2><button class="btn" data-close="1">关闭</button></div><div class="modal-body"><div id="ij-detail-status"></div><p class="mono">'+esc(id)+'</p><div id="ij-log-lines"></div><details><summary>生成提示词</summary><pre class="wb-prompt">'+esc(task.snapshot.userPrompt||task.snapshot.prompt||'未记录')+'</pre></details><div id="ij-outputs"></div></div><div class="modal-foot">'+controls(task)+'<button class="btn" data-ij="refresh">刷新日志</button></div>');drawDetail(task);
 }
 function drawDetail(t){if(!t)return;const status=document.querySelector('#ij-detail-status'),lines=document.querySelector('#ij-log-lines'),out=document.querySelector('#ij-outputs');if(!lines)return;status.textContent=(label[t.status]||t.status)+' · '+t.phase+(t.error?' · '+t.error:'');lines.innerHTML=t.logs.map(l=>'<div class="ij-log '+esc(l.level)+'"><time>'+new Date(l.time).toLocaleTimeString()+'</time><span>'+esc(l.message)+'</span></div>').join('');out.innerHTML=(t.result?.items||[]).map((item,n)=>'<button type="button" class="ij-result" data-ij="result" data-id="'+t.id+'" data-index="'+n+'"><img src="/api/file?path='+enc(item.path)+'" alt="'+esc(item.name)+'"><span>'+esc(item.name)+'</span></button>').join('');}
 function init(){if(initialized)return;initialized=true;refresh();setInterval(refresh,1800);
  document.addEventListener('click',async e=>{const btn=e.target.closest('[data-ij]');if(!btn)return;e.preventDefault();const action=btn.dataset.ij,id=btn.dataset.id;try{
    if(action==='all'){location.hash='#logs';return;}
    if(action==='detail'){await detail(id);return;}
    if(action==='refresh'){await refresh();if(modalTask)await detail(modalTask);return;}
    if(action==='result'){const task=tasks().find(t=>t.id===id);const item=task?.result?.items[Number(btn.dataset.index)];if(item)openMediaDetail({...item,kind:'image'});return;}
    if(action==='retry'&&!confirm('重新提交到图像渠道会产生新的生成任务，确认重新生成？'))return;
    const task=await api('/api/images/tasks/'+id+'/'+action,{method:'POST',body:{}});await refresh();
    toast(action==='pause'?task.phase:action==='resume'?'已继续后台任务':'已新建后台图像任务');if(document.querySelector('#ij-log-lines'))await detail(action==='retry'?task.id:id);
   }catch(err){toast(err.message,true);}});
 }
 return {init,refresh,panel:panelHtml,table,active};
})();
