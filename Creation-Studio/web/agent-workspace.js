/* Project/session file panel. Separate from the chat renderer and stream state. */
(() => {
  let active = '', context = null, data = null, error = '', loading = false, revision = 0;
  let page = 1, kind = 'output', timer = null, controller = null;
  function paint() { const host=document.querySelector('[data-agent-files]'); if(host && context && active===key(context)) host.outerHTML=html(context); }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function key(c) { return [c.projectId, c.sessionId, c.kind || 'output'].join(':'); }
  async function load(force = false) {
    if (!context?.sessionId || loading && !force) return;
    if (force) controller?.abort();
    const c = context, target = active, seq = ++revision;
    loading = true; controller = new AbortController();
    try {
      const response = await fetch('/api/agent/workspace/session-files?' + new URLSearchParams({session_id:c.sessionId,kind,page:String(page)}), {headers:{'X-Project-Id':c.projectId},signal:controller.signal});
      const payload = await response.json();
      if (!response.ok) throw Error(typeof payload.detail === 'string' ? payload.detail : '无法加载工作区文件');
      if (seq !== revision || target !== active) return;
      data = payload; page = payload.page; error = '';
    } catch (err) { if (err.name !== 'AbortError' && seq === revision) error = err.message; }
    finally {
      if (seq === revision) {
        loading = false; paint(); clearTimeout(timer);
        timer = setTimeout(() => { if (document.querySelector('[data-agent-files]') && !document.hidden) load(); }, 5000);
      }
    }
  }
  function html(c) {
    const next = key(c);
    if (next !== active) {
      controller?.abort(); ++revision; loading = false; active = next; context = c; kind = c.kind || 'output'; page = 1; data = null; error = ''; clearTimeout(timer);
      setTimeout(() => load(), 0);
    } else context = c;
    const files = data?.items || [];
    return '<div class="agent-files" data-agent-files><div class="agent-files-toolbar"><span>当前对话</span><button class="ask-btn" data-act="ask-files-pick">引用素材</button><button class="ask-btn" data-act="ask-files-refresh" ' + (loading ? 'disabled' : '') + '>刷新</button></div>' +
      (error ? '<div class="agent-files-error" role="alert">'+esc(error)+'</div>' : '') +
      (!data && !error ? '<div class="ask-cap-empty" role="status">正在读取文件…</div>' : !files.length ? '<div class="ask-cap-empty">'+(kind==='input'?'本对话还没有输入材料':'本对话还没有产出文件')+'</div>' : files.map(file => {
        const state = file.missing ? '文件缺失' : file.origin === 'work' ? '工作文件' : file.origin === 'input' ? '输入材料' : '已交付';
        return '<article class="agent-file-card"><button class="agent-file-title" data-act="ask-preview" data-id="'+esc(file.id)+'">'+esc(file.name)+'</button><div class="agent-file-meta">'+esc(state)+' · '+esc(file.suffix || '文件')+' · '+esc(Math.ceil(file.size/1024))+' KB'+(file.version ? ' · v'+file.version : '')+'</div><div class="agent-file-path" title="'+esc(file.path)+'">'+esc(file.relative_path || file.path || '旧版文件，待迁移')+'</div><div class="agent-file-actions"><button class="ask-btn" data-act="ask-reveal-pane" data-id="'+esc(file.id)+'">定位</button><button class="ask-btn" data-act="ask-file-path" data-id="'+esc(file.id)+'">复制路径</button><button class="ask-btn" data-act="ask-file-source" data-id="'+esc(file.id)+'">来源</button><button class="ask-btn" data-act="ask-file-versions" data-id="'+esc(file.id)+'">版本</button></div></article>';
      }).join('')) +
      (data ? '<div class="agent-files-pager"><button class="ask-btn" data-act="ask-files-page" data-page="'+(page-1)+'" '+(page<=1?'disabled':'')+'>上一页</button><span>'+page+' / '+Math.max(1,Math.ceil(data.total/10))+' · '+data.total+' 项</span><button class="ask-btn" data-act="ask-files-page" data-page="'+(page+1)+'" '+(page*10>=data.total?'disabled':'')+'>下一页</button></div>' : '')+'</div>';
  }
  window.AgentWorkspace = {html, refresh:() => load(true), page:n=>{page=Math.max(1,n);return load(true);}, file:id=>data?.items.find(f=>f.id===id)};
})();
