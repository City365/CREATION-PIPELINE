'use strict';
/* Shared directory for image/video workbenches. Runtime objects retain in-flight ownership. */
const WB = (() => {
  const books={image:null,video:null}, defaults={}, timers={}, queues=new Map();
  let loadEpoch=0, locked=false;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const runtime=k=>k==='video'?state.studio:state.image;
  const current=k=>books[k]?.items.find(i=>i.id===books[k].activeId);
  const context=k=>({projectId:books[k]?.projectId||studioProjectId(),kind:k,itemId:books[k]?.activeId||null});
  function snapshot(k,source=runtime(k)) {
    const keys=k==='video'?['workflowId','channelId','prompt','promptMode','images','audios','aspectRatio','resolution','megapixels','megapixels2','duration','seed','count','panelWidth']:['channelId','tab','prompt','size','count','refs','source','reverseText','results','previewIndex','zoom','panelWidth','_imageRunId'];
    const out={};for(const key of keys)if(source[key]!==undefined)out[key]=clone(source[key]);return out;
  }
  function adopt(k,item) {
    const obj=item.runtime||(item.runtime={...clone(defaults[k]),...clone(item.draft),_restored:true,busy:false});
    if(k==='video'){state.studio=obj;state.lastJobId=(state.jobs||[]).find(j=>j.itemId===item.id)?.id||null;}
    else state.image=obj;
  }
  const cacheKey=(p,k,id)=>'h3.workbench.'+p+'.'+k+'.'+id;
  async function flush(k) {
    clearTimeout(timers[k]);const b=books[k],item=current(k);if(!b||!item)return;
    const draft=snapshot(k,item.runtime||runtime(k));
    return saveItem(b,item,draft);
  }
  function saveItem(b,item,draft) {
    item.draft=clone(draft);
    localStorage.setItem(cacheKey(b.projectId,item.kind,item.id),JSON.stringify({draft,revision:item.revision}));
    const previous=queues.get(item.id)||Promise.resolve();
    const promise=previous.catch(()=>{}).then(async()=>{
      const payload=JSON.stringify(draft);
      if(item.saved===payload)return;
      item.saving=true;
      try {
        const saved=await api('/api/workbench/items/'+item.id,{method:'PATCH',body:{projectId:b.projectId,kind:item.kind,revision:item.revision,draft}});
        item.revision=saved.revision;item.updatedAt=saved.updatedAt;item.saved=payload;item.error='';
        const local=JSON.parse(localStorage.getItem(cacheKey(b.projectId,item.kind,item.id))||'null');
        if(local&&JSON.stringify(local.draft)===payload)localStorage.removeItem(cacheKey(b.projectId,item.kind,item.id));
      } catch(e) {item.error=e.message;throw e;} finally {item.saving=false;updateStatus();}
    });
    queues.set(item.id,promise);return promise;
  }
  function updateStatus() {
    for(const k of ['video','image']){
      const el=document.querySelector('[data-wb-status="'+k+'"]'),i=current(k);
      if(el)el.textContent=i?.error?'保存失败 · 本地已保留':i?.saving?'保存中…':'已自动保存';
      if(el)el.title=i?.error||'保存到 SQLite';
    }
  }
  function schedule(k) {
    if(!current(k))return;
    clearTimeout(timers[k]);timers[k]=setTimeout(()=>flush(k).catch(e=>{updateStatus();}),450);
  }
  async function flushAll(){await Promise.all(['image','video'].map(flush));}
  async function load(p) {
    const epoch=++loadEpoch;
    for(const k of ['video','image'])if(!defaults[k])defaults[k]=snapshot(k);
    const data=await Promise.all(['video','image'].map(k=>api('/api/workbench/items?projectId='+enc(p)+'&kind='+k)));
    if(epoch!==loadEpoch||p!==studioProjectId())return;
    for(const [idx,k] of ['video','image'].entries()) {
      const b={...data[idx],projectId:p};books[k]=b;
      if(!b.items.length) {
        // Import the single legacy client draft only once. Later empty lists stay empty.
        const marker='h3.workbench.initialized.'+p+'.'+k;
        if(!b.initialized) {
          const legacy=k==='video'?snapshot(k):{};
          const item=await api('/api/workbench/items',{method:'POST',body:{projectId:p,kind:k,draft:legacy}});
          b.items=[item];b.activeId=item.id;
          localStorage.setItem(marker,'1');
        }
      } else localStorage.setItem('h3.workbench.initialized.'+p+'.'+k,'1');
      if(epoch!==loadEpoch)return;
      for(const item of b.items){
        item.saved=JSON.stringify(item.draft);
        try{
          const local=JSON.parse(localStorage.getItem(cacheKey(p,k,item.id))||'null');
          if(local&&JSON.stringify(local.draft)!==item.saved){
            if(local.revision===item.revision){item.draft=local.draft;item.saved=null;}
            else {item.error='发现本地未保存版本，可通过“恢复本地草稿”另存';item.localRecovery=local.draft;}
          }
        }catch{}
      }
      if(current(k))adopt(k,current(k));
      else if(k==='video')state.studio={...clone(defaults[k]),prompt:'',images:[],audios:[],_restored:true};
      else state.image={...clone(defaults[k]),prompt:'',results:[],source:null};
    }
  }
  function layout(k,html) {
    const b=books[k];if(!b)return html;
    const i=current(k),collapsed=localStorage.getItem('h3.workbench.collapsed.'+k)==='1';
    const rows=b.items.map((item,n)=>{
      const d=item.id===b.activeId?snapshot(k):item.draft;
      const thumb=k==='image'?(d.results||[])[0]:(d.images||[]).find(Boolean);
      const jobs=(state.jobs||[]).filter(j=>j.itemId===item.id);
      const status=jobs.find(j=>j.status==='running'||j.status==='queued') || (k==='image'?(state.imageTasks||[]).find(t=>t.itemId===item.id&&['running','queued','paused'].includes(t.status)):null);
      return '<div class="wb-row '+(item.id===b.activeId?'is-selected':'')+'" draggable="true" data-wb-id="'+esc(item.id)+'"><button type="button" class="wb-select" data-wb="select" data-id="'+esc(item.id)+'" aria-current="'+(item.id===b.activeId?'true':'false')+'">'+(thumb?.path?'<img alt="" src="/api/file?path='+enc(thumb.path)+'">':'<span class="wb-number">'+String(n+1).padStart(2,'0')+'</span>')+'<span><b>'+esc(item.title)+'</b><small>'+esc(status?(status.status==='paused'?'已暂停':STATUS_LABEL[status.status]):d.prompt?String(d.prompt).slice(0,30):'待编辑')+'</small></span></button><button type="button" class="wb-more" data-wb="menu" data-id="'+item.id+'" aria-label="管理 '+esc(item.title)+'">⋯</button></div>';
    }).join('');
    const sidebar='<aside class="wb-directory '+(collapsed?'is-collapsed':'')+'" aria-label="'+(k==='video'?'视频分镜':'图像画面')+'目录"><header><b>'+(k==='video'?'分镜目录':'画面目录')+'</b><button type="button" data-wb="collapse" title="收起 / 展开目录">'+(collapsed?'›':'‹')+'</button></header><div class="wb-tools"><button type="button" data-wb="new">＋ 新建</button><button type="button" data-wb="trash">回收站</button></div><div class="wb-list">'+(rows||'<p class="wb-empty">还没有条目，点击新建开始。</p>')+'</div><footer><span data-wb-status="'+k+'">'+(i?.error?'保存失败 · 本地已保留':'已自动保存')+'</span><button type="button" data-wb="save">保存</button></footer></aside>';
    return '<div class="wb-layout" data-workbench="'+k+'">'+sidebar+'<div class="wb-content">'+(b.activeId?html:'<div class="wb-blank"><h2>新建'+(k==='video'?'分镜':'画面')+'</h2><p>每个条目独立保存提示词、参考图和生成记录。</p><button type="button" class="btn primary" data-wb="new">＋ 新建</button></div>')+'</div></div>';
  }
  async function refresh(k) {
    const old=books[k],data=await api('/api/workbench/items?projectId='+enc(old.projectId)+'&kind='+k);
    if(books[k]!==old)return;
    for(const row of data.items){const before=old.items.find(i=>i.id===row.id);if(before){row.runtime=before.runtime;row.saved=before.saved;}}
    books[k]={...data,projectId:old.projectId};
  }
  async function selectItem(k,id){
    await flush(k);const b=books[k];const item=b.items.find(i=>i.id===id);if(!item)return;
    await api('/api/workbench/selection',{method:'PUT',body:{projectId:b.projectId,kind:k,itemId:id}});
    b.activeId=id;adopt(k,item);render();
  }
  async function newItem(k,draft,title) {
    await flush(k);const b=books[k];
    const blank=k==='video'?{...defaults[k],prompt:'',images:[],audios:[]}:{...defaults[k],prompt:'',source:null,refs:[],results:[],reverseText:''};
    const item=await api('/api/workbench/items',{method:'POST',body:{projectId:b.projectId,kind:k,title,draft:draft||blank}});
    b.items.push(item);await selectItem(k,item.id);
  }
  async function move(k,id,to) {
    await flush(k);await refresh(k);const b=books[k],ids=b.items.map(i=>i.id),index=ids.indexOf(id);
    if(index<0||to<0||to>=ids.length||index===to)return;
    ids.splice(index,1);ids.splice(to,0,id);
    await api('/api/workbench/items/reorder',{method:'POST',body:{projectId:b.projectId,kind:k,ids,version:b.version}});
    await refresh(k);render();
  }
  async function menu(k,id) {
    const item=books[k].items.find(i=>i.id===id);if(!item)return;
    openModal('<div class="modal-head"><h2>管理 '+esc(item.title)+'</h2><button class="btn" data-close="1">关闭</button></div><div class="modal-body wb-menu"><label>名称<input class="input" id="wb-title" value="'+esc(item.title)+'"></label><button class="btn" data-wb-action="rename">保存名称</button><button class="btn" data-wb-action="copy">复制分镜</button><button class="btn" data-wb-action="up">上移</button><button class="btn" data-wb-action="down">下移</button><button class="btn" data-wb-action="history">生成记录</button>'+(item.localRecovery?'<button class="btn" data-wb-action="local">恢复本地草稿为新条目</button>':'')+'<button class="btn danger" data-wb-action="delete">移入回收站</button></div>');
    document.querySelectorAll('[data-wb-action]').forEach(el=>el.onclick=async()=>{
      try{
        await flush(k);const b=books[k],action=el.dataset.wbAction;
        if(action==='copy')await newItem(k,item.id===b.activeId?snapshot(k):item.draft,item.title+' 副本');
        else if(action==='local')await newItem(k,item.localRecovery,item.title+' 本地恢复');
        else if(action==='up'||action==='down')await move(k,id,b.items.indexOf(item)+(action==='up'?-1:1));
        else if(action==='history'){await history(k,id);return;}
        else {
          const saved=await api('/api/workbench/items/'+id+(action==='delete'?'/delete':''),{method:action==='delete'?'POST':'PATCH',body:{projectId:b.projectId,kind:k,revision:item.revision,title:action==='rename'?document.querySelector('#wb-title').value:undefined}});
          Object.assign(item,saved);await refresh(k);const active=current(k);if(active)adopt(k,active);render();
        }
        closeModal();render();
      }catch(e){toast(e.message,true);}
    });
  }
  async function history(k,id){
    const b=books[k],runs=await api('/api/workbench/items/'+id+'/runs?projectId='+enc(b.projectId)+'&kind='+k);
    openModal('<div class="modal-head"><h2>生成记录</h2><button class="btn" data-close="1">关闭</button></div><div class="modal-body">'+(runs.map((r,n)=>'<article class="wb-run"><b>'+esc(STATUS_LABEL[r.status]||r.status)+' · '+new Date(r.created_at).toLocaleString()+'</b><pre>'+esc(r.snapshot.userPrompt??r.snapshot.prompt??'未记录生成提示词')+'</pre><div class="wb-run-outputs">'+r.outputs.map(o=>'<button class="btn" data-run-output="'+esc(o.path)+'">'+esc(o.name)+'</button>').join('')+'</div><button class="btn" data-run-new="'+n+'">用此记录新建</button></article>').join('')||'<p>还没有生成记录。</p>')+'</div>');
    document.querySelectorAll('[data-run-new]').forEach(el=>el.onclick=()=>newItem(k,draftFrom(runs[Number(el.dataset.runNew)].snapshot,k),'历史记录副本').then(closeModal).catch(e=>toast(e.message,true)));
    document.querySelectorAll('[data-run-output]').forEach(el=>el.onclick=()=>openMediaDetail({path:el.dataset.runOutput,name:el.textContent,kind:k,bytes:0}));
  }
  function draftFrom(s,k){return {...s,prompt:s.userPrompt??s.prompt??'',...(k==='video'?{images:s.images||s.refs||[],audios:s.audios||[]}:{refs:s.refs||s.images||[],results:[]})};}
  async function trash(k) {
    const b=books[k],data=await api('/api/workbench/items?projectId='+enc(b.projectId)+'&kind='+k+'&deleted=1');
    openModal('<div class="modal-head"><h2>回收站</h2><button class="btn" data-close="1">关闭</button></div><div class="modal-body">'+(data.items.map((i,n)=>'<p>'+esc(i.title)+' <button class="btn" data-restore="'+n+'">恢复</button></p>').join('')||'回收站为空')+'</div>');
    document.querySelectorAll('[data-restore]').forEach(el=>el.onclick=async()=>{try{const i=data.items[Number(el.dataset.restore)];await api('/api/workbench/items/'+i.id+'/restore',{method:'POST',body:{projectId:b.projectId,kind:k,revision:i.revision}});await refresh(k);if(current(k))adopt(k,current(k));closeModal();render();}catch(e){toast(e.message,true);}});
  }
  function bind(host,k) {
    if(!books[k])return;
    host.addEventListener('input',()=>setTimeout(()=>schedule(k),0));
    host.addEventListener('change',()=>setTimeout(()=>schedule(k),0));
    host.addEventListener('click',async e=>{
      const btn=e.target.closest('[data-wb]');if(!btn)return;
      if(locked)return;locked=true;
      const content=host.querySelector('.wb-content');if(content)content.inert=true;
      try {
        const action=btn.dataset.wb;
        if(action==='new')await newItem(k);
        if(action==='select')await selectItem(k,btn.dataset.id);
        if(action==='menu')await menu(k,btn.dataset.id);
        if(action==='trash')await trash(k);

        if(action==='save'){await flush(k);await refresh(k);render();toast('已保存');}
        if(action==='collapse'){localStorage.setItem('h3.workbench.collapsed.'+k,localStorage.getItem('h3.workbench.collapsed.'+k)==='1'?'0':'1');render();}
      }catch(error){toast(error.message,true);}finally{locked=false;if(content?.isConnected)content.inert=false;}
    });
    let dragged=null;
    host.addEventListener('dragstart',e=>{const row=e.target.closest('[data-wb-id]');if(!row)return;dragged=row.dataset.wbId;e.dataTransfer.setData('application/x-workbench',dragged);e.dataTransfer.effectAllowed='move';});
    host.addEventListener('dragover',e=>{if(!dragged)return;const row=e.target.closest('[data-wb-id]');if(row){e.preventDefault();host.querySelectorAll('.is-drop-target').forEach(el=>el.classList.remove('is-drop-target'));row.classList.add('is-drop-target');}});
    host.addEventListener('drop',e=>{if(!dragged)return;const row=e.target.closest('[data-wb-id]');if(!row)return;e.preventDefault();const from=dragged;dragged=null;move(k,from,books[k].items.findIndex(i=>i.id===row.dataset.wbId)).catch(err=>toast(err.message,true));});
    host.addEventListener('dragend',()=>{dragged=null;host.querySelectorAll('.is-drop-target').forEach(el=>el.classList.remove('is-drop-target'));});
    schedule(k);
  }
  async function complete(k,ctx,obj) {
    const b=books[k];
    if(b&&b.projectId===ctx.projectId){const item=b.items.find(i=>i.id===ctx.itemId);if(item){item.runtime=obj;await saveItem(b,item,snapshot(k,obj));return;}}
    if(!ctx.itemId)return;
    const item=await api('/api/workbench/items/'+ctx.itemId+'?projectId='+enc(ctx.projectId)+'&kind='+k);
    await saveItem({projectId:ctx.projectId},item,snapshot(k,obj));
  }
  async function reconcileImageTask(task){
    const b=books.image;if(!b||b.projectId!==task.projectId||!task.itemId)return;
    const item=b.items.find(i=>i.id===task.itemId);if(!item||item.runtime?._imageRunId===task.id)return;
    await (queues.get(item.id)||Promise.resolve()).catch(()=>{});
    const row=await api('/api/workbench/items/'+item.id+'?projectId='+enc(b.projectId)+'&kind=image');
    if(books.image!==b||row.draft._imageRunId!==task.id)return;
    const strip=d=>{const v=clone(d||{});for(const key of ['results','previewIndex','zoom','_imageRunId'])delete v[key];return JSON.stringify(v);};
    const saved=item.saved?JSON.parse(item.saved):item.draft;
    if(row.revision!==item.revision&&strip(row.draft)!==strip(saved)){item.error='后台结果已保存，但草稿在其他页面更新，请保留本地内容后重新打开';return;}
    item.revision=row.revision;item.draft=row.draft;item.saved=JSON.stringify(row.draft);item.error='';
    if(item.runtime){item.runtime.results=row.draft.results;item.runtime.previewIndex=0;item.runtime.zoom='fit';item.runtime._imageRunId=task.id;}
  }
  function beacon(){for(const k of ['image','video']){const b=books[k],i=current(k);if(!i)continue;const draft=snapshot(k);localStorage.setItem(cacheKey(b.projectId,k,i.id),JSON.stringify({draft,revision:i.revision}));}}
  window.addEventListener('beforeunload',beacon);
  async function mediaDetails(item){
    const host=document.querySelector('#generation-details');if(!host)return;
    try{
      const d=await api('/api/media/details?path='+enc(item.path));if(!host.isConnected)return;
      const s=d.snapshot||{},refs=s.images||s.refs||[];
      host.innerHTML=(d.missingReferences?.length?'<p class="badge warn">缺失参考素材：'+esc(d.missingReferences.join('、'))+'</p>':'')+'<h3>生成资料</h3><p>'+esc(d.title||'')+'</p><label>用户提示词</label><pre class="wb-prompt">'+esc(s.userPrompt??s.prompt??'未记录生成提示词')+'</pre>'+(s.prompt&&s.userPrompt!==undefined&&s.prompt!==s.userPrompt?'<details><summary>提交提示词（包含风格）</summary><pre class="wb-prompt">'+esc(s.prompt)+'</pre></details>':'')+(s.submittedPrompt?'<details><summary>实际发送文本</summary><pre class="wb-prompt">'+esc(s.submittedPrompt)+'</pre></details>':'')+'<div class="wb-params">'+[['渠道',s.channelName||s.channelId],['模型',s.model||s.workflowId],['尺寸 / 比例',s.size||s.aspectRatio],['分辨率',s.resolution],['时长',s.duration?String(s.duration)+' 秒':''],['种子',s.seed],['生成时间',d.createdAt?new Date(d.createdAt).toLocaleString():'']].filter(v=>v[1]!==undefined&&v[1]!==null&&v[1]!=='').map(v=>'<span>'+v[0]+'：'+esc(v[1])+'</span>').join('')+'</div><div class="wb-ref-list">'+refs.map((ref,n)=>'<figure><img alt="图'+(n+1)+'" src="/api/file?path='+enc(ref.path)+'"><figcaption>图'+(n+1)+' '+esc(ref.name||'')+'</figcaption></figure>').join('')+'</div><div class="wb-tools">'+((s.userPrompt??s.prompt)?'<button class="btn" id="wb-copy-prompt">复制提示词</button><button class="btn" id="wb-from-record">用此记录新建</button>':'')+(d.itemId&&!d.deleted?'<button class="btn" id="wb-open-origin">在创作台打开</button>':'')+'</div>';
      const copy=host.querySelector('#wb-copy-prompt');if(copy)copy.onclick=()=>navigator.clipboard.writeText(s.userPrompt??s.prompt).then(()=>toast('已复制提示词')).catch(e=>toast(e.message,true));
      const restore=host.querySelector('#wb-from-record');if(restore)restore.onclick=()=>newItem(d.kind||'image',draftFrom(s,d.kind),'生成记录副本').then(()=>{closeModal();location.hash=d.kind==='video'?'#studio':'#image';}).catch(e=>toast(e.message,true));
      const origin=host.querySelector('#wb-open-origin');if(origin)origin.onclick=async()=>{try{await flushAll();if(d.projectId!==studioProjectId()){await setActiveProject(d.projectId,{silent:true});if(d.projectId!==studioProjectId())throw Error('原项目不存在');}await selectItem(d.kind,d.itemId);closeModal();location.hash=d.kind==='video'?'#studio':'#image';}catch(e){toast(e.message,true);}};
    }catch(e){host.textContent='生成资料读取失败：'+e.message;}
  }
  return {reconcileImageTask,layout,bind,load,flush,flushAll,schedule,context,complete,mediaDetails,current,snapshot};
})();
