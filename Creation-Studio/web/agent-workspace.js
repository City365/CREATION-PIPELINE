/* Tabbed project workspace: file browser, persistent tree, independent previews. */
(() => {
  const scopes = new Map(); let current = null, context = null;
  let widthPercent=30;
  try { const saved=Number(localStorage.getItem('wmd.agentWorkspaceWidth'));if(saved>=10&&saved<=85)widthPercent=saved; } catch {}
  function resizeWidth(percent,save=true) {
    widthPercent=Math.max(10,Math.min(85,Number(percent)||30));
    const pane=document.querySelector('[data-agent-workspace]');
    pane?.style.setProperty('--aw-width',widthPercent+'%');
    pane?.querySelector('[data-aw-resize]')?.setAttribute('aria-valuenow',String(Math.round(widthPercent)));
    if(save)try{localStorage.setItem('wmd.agentWorkspaceWidth',String(widthPercent));}catch{}
    return widthPercent;
  }
  const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">'+({file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>',folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>'}[name]||'')+'</svg>';
  async function api(c,path,body) {
    const response=await fetch('/api/agent'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Project-Id':c.projectId},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json(); if(!response.ok)throw Error(typeof result.detail==='string'?result.detail:'工作区请求失败'); return result;
  }
  function ensure(c) {
    const key=c.projectId+':'+c.sessionId;
    if(!scopes.has(key))scopes.set(key,{key,tabs:[{id:'start',type:'start',name:'新标签页'}],active:'start',tree:false,expanded:new Set(['']),directories:new Map(),query:'',rootName:c.projectName||'项目工作区',busy:false});
    current=scopes.get(key);context=c;return current;
  }
  function selected(s=current) { return s?.tabs.find(t=>t.id===s.active); }
  function sync(c) {
    const tab=selected();
    if(tab?.type==='file' && c.previewFile?.id===tab.file?.id)Object.assign(tab,{data:c.previewData,error:c.previewError,sheet:c.previewSheet,source:c.previewSource});
  }
  function apply(s=current) {
    if(s!==current)return;
    const tab=selected(s);
    context.apply({file:tab?.type==='file'?tab.file:null,data:tab?.data||null,error:tab?.error||'',sheet:tab?.sheet||0,source:!!tab?.source,media:tab?.type==='media'?tab.media:null});
  }
  function paint(s=current,full=false) {
    if(s!==current)return;
    const host=document.querySelector('[data-agent-workspace]');
    const scroll=host?.querySelector('.aw-tree')?.scrollTop||0;
    const focused=host?.contains(document.activeElement)?document.activeElement?.dataset?.path:null;
    if(full){apply(s);context.render();}else if(host)host.outerHTML=html(context);
    const next=document.querySelector('[data-agent-workspace]');
    if(next?.querySelector('.aw-tree'))next.querySelector('.aw-tree').scrollTop=scroll;
    if(focused){const button=[...(next?.querySelectorAll('.aw-tree-row')||[])].find(b=>b.dataset.path===focused);button?.focus({preventScroll:true});}
  }
  async function directory(path='',more=false,s=current,c=context) {
    const old=s.directories.get(path);
    if(old?.loading)return;
    s.directories.set(path,{...old,loading:true,error:''});paint(s);
    try {
      const data=await api(c,'/workspace/tree?'+new URLSearchParams({path,offset:String(more?old?.nextOffset||0:0)}));
      s.rootName=data.rootName;
      s.directories.set(path,{...data,items:more?[...(old?.items||[]),...data.items]:data.items,loading:false});
    } catch(err) { s.directories.set(path,{...old,error:err.message,loading:false}); }
    paint(s);
  }
  async function showFiles() {
    const s=current,c=context;s.tree=true;const tab=selected(s);
    if(tab?.type==='start'){tab.type='browser';tab.name='打开文件';}
    if(!s.directories.has(''))await directory('',false,s,c);
    // Open the current conversation path while keeping other project branches collapsed.
    for(const path of ['智能体工作区','智能体工作区/对话','智能体工作区/对话/'+c.sessionId]) {
      const parent=path.split('/').slice(0,-1).join('/');
      if(!s.directories.get(parent)?.items?.some(i=>i.relative_path===path && i.kind==='directory'))break;
      s.expanded.add(path);if(!s.directories.has(path))await directory(path,false,s,c);
    }
    paint(s);
  }
  async function loadFile(tab,s=current,c=context,sheet=0,force=false) {
    if(tab.loading && !force)return;
    const revision=(tab.revision||0)+1;tab.revision=revision;tab.loading=true;tab.error='';tab.sheet=sheet;
    paint(s,true);
    try {
      if(!tab.file?.name || tab.file.name==='文件')tab.file=await api(c,'/workspace/files/'+encodeURIComponent(tab.file.id));
      tab.name=tab.file.name;
      const data=await api(c,'/workspace/files/'+encodeURIComponent(tab.file.id)+'/preview?sheet='+sheet);
      if(tab.revision===revision)tab.data=data;
    } catch(err){if(tab.revision===revision)tab.error=err.message;}
    if(tab.revision===revision){tab.loading=false;if(s===current && s.active===tab.id)paint(s,true);}
  }
  async function openFile(id,meta=null,sheet=0,force=false) {
    const s=current,c=context;if(!s)return;
    sync(c.state());
    const key='file:'+id;let tab=s.tabs.find(t=>t.id===key);
    if(!tab){tab={id:key,type:'file',name:meta?.name||'文件',file:meta||{id,name:'文件'},data:null};s.tabs.push(tab);}
    s.active=key;s.tree=true;if(!s.directories.has(''))directory('',false,s,c);
    if(meta)tab.file=meta;tab.name=tab.file.name;
    apply(s);context.open();
    if(tab.data && !force && sheet===(tab.sheet||0))paint(s,true);else await loadFile(tab,s,c,sheet,force);
  }
  function newTab() {
    if(current.tabs.length===1 && selected()?.type==='start')return paint(current,true);
    sync(context.state());const id='start:'+Date.now()+':'+Math.random().toString(36).slice(2,5);
    current.tabs.push({id,type:'start',name:'新标签页'});current.active=id;paint(current,true);
  }
  function select(id) {sync(context.state());if(!current.tabs.some(t=>t.id===id))return;current.active=id;paint(current,true);}
  function close(id) {
    const s=current,index=s.tabs.findIndex(t=>t.id===id);if(index<0)return;
    s.tabs.splice(index,1);
    if(!s.tabs.length){s.tabs.push({id:'start',type:'start',name:'新标签页'});s.active='start';}
    else if(s.active===id)s.active=s.tabs[Math.max(0,index-1)].id;
    paint(s,true);
  }
  function tree(path='',level=0) {
    const s=current,dir=s.directories.get(path),q=s.query.trim().toLowerCase();
    if(!dir)return '<div class="aw-tree-note">尚未加载</div>';
    if(dir.error)return '<div class="aw-tree-note" role="alert">'+esc(dir.error)+'<button data-aw="refresh-dir" data-path="'+esc(path)+'">重试</button></div>';
    const rows=(dir.items||[]).filter(n=>!q||n.kind==='directory'||n.name.toLowerCase().includes(q));
    return rows.map(node=>{
      const expanded=s.expanded.has(node.relative_path),isDir=node.kind==='directory';
      const active=selected()?.file?.relative_path===node.relative_path;
      return '<div class="aw-tree-item" role="treeitem" aria-level="'+(level+1)+'" '+(isDir?'aria-expanded="'+expanded+'"':'aria-selected="'+active+'"')+'><button class="aw-tree-row '+(active?'is-selected':'')+'" data-aw="'+(isDir?'folder':'file')+'" data-path="'+esc(node.relative_path)+'" title="'+esc(node.relative_path)+'" style="--level:'+level+'" '+(!isDir&&!node.previewable?'disabled':'')+'><span class="aw-chevron">'+(isDir?(expanded?'⌄':'›'):'')+'</span>'+icon(isDir?'folder':'file')+'<span>'+esc(node.name)+'</span></button>'+(isDir&&expanded?'<div role="group">'+tree(node.relative_path,level+1)+'</div>':'')+'</div>';
    }).join('')+(dir.loading?'<div class="aw-tree-note" role="status">正在加载…</div>':'')+(!rows.length&&!dir.loading?'<div class="aw-tree-note">'+(q?'此目录暂无匹配文件':'空文件夹')+'</div>':'')+(dir.nextOffset!=null?'<button class="aw-tree-more" data-aw="more" data-path="'+esc(path)+'">加载更多文件</button>':'');
  }
  function html(c) {
    ensure(c);sync(c.state());const s=current,tab=selected(s);
    const preview=tab?.type==='file'||tab?.type==='media';
    return '<aside class="agent-workspace '+(s.tree?'has-tree ':'')+(c.expanded?'is-expanded':'')+'" data-agent-workspace aria-label="工作区" style="--aw-width:'+widthPercent+'%">'+
      '<div class="aw-resizer" data-aw-resize role="separator" tabindex="0" aria-label="调整工作区宽度" aria-orientation="vertical" aria-valuemin="10" aria-valuemax="85" aria-valuenow="'+Math.round(widthPercent)+'" title="拖动调整宽度，双击恢复 30%"></div>'+
      '<header class="aw-tabbar"><div class="aw-tabs" role="tablist" aria-label="工作区标签">'+s.tabs.map(t=>'<div class="aw-tab '+(s.active===t.id?'is-active':'')+'"><button role="tab" aria-selected="'+(s.active===t.id)+'" data-aw="tab" data-id="'+esc(t.id)+'" title="'+esc(t.name)+'">'+icon(t.type==='browser'?'folder':'file')+'<span>'+esc(t.name)+'</span></button><button class="aw-tab-close" data-aw="close-tab" data-id="'+esc(t.id)+'" aria-label="关闭标签 '+esc(t.name)+'">'+icon('close')+'</button></div>').join('')+'</div><button class="aw-icon" data-aw="new" aria-label="新建标签页" title="新建标签页">'+icon('plus')+'</button><button class="aw-icon" data-act="ask-expand-preview" aria-label="展开工作区" title="展开工作区">'+icon('expand')+'</button><button class="aw-icon" data-act="ask-close-cap" aria-label="关闭工作区" title="关闭工作区">'+icon('close')+'</button></header>'+
      '<div class="aw-toolbar"><div class="aw-breadcrumb" title="'+esc(tab?.file?.relative_path||s.rootName)+'">'+esc(tab?.file?.relative_path||s.rootName)+'</div><button class="aw-icon '+(s.tree?'is-active':'')+'" data-aw="toggle-tree" aria-label="文件目录" aria-pressed="'+s.tree+'" title="文件目录">'+icon('folder')+'</button></div>'+
      '<div class="aw-layout"><section class="aw-preview" aria-label="文件预览">'+(preview?c.previewHtml():tab?.type==='trajectory'?c.trajectoryHtml():
        '<div class="aw-start"><div class="aw-start-icon">'+icon('folder')+'</div><h2>'+(tab?.type==='browser'?'打开文件':'工作区')+'</h2><p>'+(tab?.type==='browser'?'从右侧目录树选择文件预览':'选择工具，在独立标签页中查看项目文件和执行过程')+'</p><div class="aw-tools"><button data-aw="files">'+icon('folder')+'<span>文件</span></button><button data-aw="trajectory">'+icon('list')+'<span>执行过程</span></button><button data-act="ask-files-pick">'+icon('plus')+'<span>引用项目素材</span></button></div></div>')+'</section>'+
      (s.tree?'<aside class="aw-explorer" aria-label="项目文件目录"><div class="aw-explorer-head"><b>'+esc(s.rootName)+'</b><button class="aw-icon" data-aw="refresh-dir" data-path="" title="刷新目录" aria-label="刷新目录">↻</button></div><label class="aw-search"><span>⌕</span><input aria-label="筛选已展开文件" placeholder="筛选已展开文件…" value="'+esc(s.query)+'" data-aw-filter /></label><div class="aw-tree" role="tree" aria-label="项目文件树">'+tree()+'</div></aside>':'')+'</div></aside>';
  }
  async function action(button) {
    const type=button.dataset.aw,path=button.dataset.path||'';
    if(type==='new')return newTab();
    if(type==='files')return showFiles();
    if(type==='toggle-tree'){current.tree=!current.tree;if(current.tree&&!current.directories.has(''))directory('');return paint();}
    if(type==='tab')return select(button.dataset.id);
    if(type==='close-tab')return close(button.dataset.id);
    if(type==='refresh-dir')return directory(path);
    if(type==='more')return directory(path,true);
    if(type==='trajectory'){
      let tab=current.tabs.find(t=>t.type==='trajectory');if(!tab){tab={id:'trajectory',type:'trajectory',name:'执行过程'};current.tabs.push(tab);}
      select(tab.id);context.loadTrajectory();return;
    }
    if(type==='folder'){
      if(current.expanded.has(path))current.expanded.delete(path);else{current.expanded.add(path);if(!current.directories.has(path))return directory(path);}
      return paint();
    }
    if(type==='file') {
      const s=current,c=context;
      try{const file=await api(c,'/workspace/open',{relative_path:path});if(s===current)await openFile(file.id,file);}
      catch(err){c.toast(err.message,true);}
    }
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-aw]');if(!button)return;event.preventDefault();action(button).catch(err=>context?.toast(err.message,true));});
  document.addEventListener('input',event=>{
    if(!event.target.matches('[data-aw-filter]'))return;
    current.query=event.target.value;const host=document.querySelector('.aw-tree');if(host)host.innerHTML=tree();
  });
  document.addEventListener('keydown',event=>{
    if(!event.target.matches('.aw-tree-row'))return;
    const buttons=[...document.querySelectorAll('.aw-tree-row:not(:disabled)')],at=buttons.indexOf(event.target);
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[Math.max(0,Math.min(buttons.length-1,at+(event.key==='ArrowDown'?1:-1)))]?.focus();}
    if(event.key==='ArrowRight'&&event.target.dataset.aw==='folder'&&!current.expanded.has(event.target.dataset.path)){event.preventDefault();action(event.target);}
    if(event.key==='ArrowLeft'&&event.target.dataset.aw==='folder'&&current.expanded.has(event.target.dataset.path)){event.preventDefault();action(event.target);}
  });
  let resizeDrag=null;
  function endResize(event) {
    if(!resizeDrag)return;
    if(event&&event.pointerId!==undefined&&event.pointerId!==resizeDrag.pointerId)return;
    resizeWidth(widthPercent,true);resizeDrag=null;
    document.documentElement.classList.remove('aw-is-resizing');
  }
  document.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-aw-resize]');
    if(!handle||event.button!==0)return;
    const pane=handle.closest('[data-agent-workspace]');
    if(pane.classList.contains('is-expanded'))return;
    event.preventDefault();
    const parent=pane.parentElement,box=pane.getBoundingClientRect();
    const history=parent.querySelector('.ask-history');
    const available=parent.getBoundingClientRect().width;
    const historyWidth=history?.getBoundingClientRect().width||0;
    resizeDrag={pointerId:event.pointerId,startX:event.clientX,startWidth:box.width,total:available,max:Math.max(260,available-historyWidth-260)};
    handle.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add('aw-is-resizing');
  });
  document.addEventListener('pointermove',event=>{
    if(!resizeDrag||event.pointerId!==resizeDrag.pointerId)return;
    const width=Math.max(260,Math.min(resizeDrag.max,resizeDrag.startWidth+resizeDrag.startX-event.clientX));
    resizeWidth(width/resizeDrag.total*100,false);
  });
  document.addEventListener('pointerup',endResize);
  document.addEventListener('pointercancel',endResize);
  document.addEventListener('lostpointercapture',endResize);
  document.addEventListener('dblclick',event=>{if(event.target.closest('[data-aw-resize]'))resizeWidth(30);});
  document.addEventListener('keydown',event=>{
    if(!event.target.matches('[data-aw-resize]'))return;
    if(event.key==='Home'){event.preventDefault();resizeWidth(30);}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();resizeWidth(widthPercent+(event.key==='ArrowLeft'?2:-2));}
  });
  window.AgentWorkspace={html,resizeWidth,openFile,newTab,showFiles,sync,file:id=>current?.tabs.find(t=>t.file?.id===id)?.file,select,closeCurrent:()=>close(current.active),refresh:()=>{for(const path of current?.expanded||[])directory(path);},page:()=>{},
    openMedia(media){const id='media:'+media.url;let tab=current.tabs.find(t=>t.id===id);if(!tab){tab={id,type:'media',name:media.name||'媒体',media};current.tabs.push(tab);}select(id);},
    active:()=>selected(),stop:()=>{}}
})();
