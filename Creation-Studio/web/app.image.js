'use strict';

/* app.image.js — 图像创作台与画布
 * 由 web/app.js 按原段注释切分而来（第 4095–5142 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */

/* ------------------------------------------------------------------ image */

function imageChannels() {
  return state.channels.image || [];
}

function imageChannel() {
  const list = imageChannels().filter((c) => c.enabled !== false);
  return list.find((c) => c.id === state.image.channelId) || list.find((c) => c.active) || list[0] || null;
}

function imageSizeOptions(channel) {
  if (!channel) return ['auto'];
  if (channel.type === 'gemini-image') return ['1K', '2K', '4K'];
  if (channel.type === 'chat-image') return ['auto', '1024x1024', '1536x1024', '1024x1536'];
  return ['auto', '1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792'];
}

const GEAR = '<svg class="wmd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
const IMG_ICON = '<svg class="wmd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>';
const DOWN_ICON = '<svg class="wmd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m7 10 5 5 5-5"></path><path d="M12 15V3"></path></svg>';

function fileUrl(file) {
  return '/api/file?path=' + encodeURIComponent(file);
}

// 拖动分隔条调整左侧面板宽度（原版双击可复位）
function bindSplitter(root, panelSel, onResize) {
  const panel = $(panelSel, root);
  const splitter = $('.wmd-splitter', root) || $('.zs-splitter', root);
  if (!panel || !splitter) return;
  splitter.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = panel.getBoundingClientRect().width;
    const move = (ev) => {
      const max = Math.max(560, window.innerWidth - 380);
      const width = Math.round(Math.max(560, Math.min(max, startW + ev.clientX - startX)));
      panel.style.width = width + 'px';
      const inner = $('.zs-panel-inner', panel);
      if (inner) inner.style.width = width + 'px';
      onResize(width);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      render();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
  });
  splitter.addEventListener('dblclick', () => { onResize(null); render(); });
}


function imageTabsHtml(tab) {
  // 子页签已由左侧二级菜单承担，这里不再输出页内工具条（含齿轮设置）
  return '';
}

// 供左侧二级菜单直接切换图像子页签（页内按钮已移除）
window.__imageSwitchTab = (tab) => {
  if (!['edit', 'generate', 'reverse', 'scene'].includes(tab)) return false;
  state.image.tab = tab;
  syncHash('image', { tab });
  render();
  return true;
};

function generationPrefixValue(kind) {
  const value=kind==='video'?state.studio:state.image;
  if(typeof value.prefixPrompt==='string')return value.prefixPrompt;
  const style=state.styleDetail;if(!style)return '';
  if(kind==='image'){
    const layer=value.styleLayer||'free';
    if(layer==='free')return '';
    return String(style[layer]||'').trim();
  }
  return String(style.video||'').trim();
}
const prefixOpen={image:false,video:false};
const layoutOpen={image:true};
function generationPrefixHtml(kind) {
  const value=kind==='video'?state.studio:state.image;
  const open=prefixOpen[kind]!==false;
  const text=generationPrefixValue(kind);
  const flat=text.replace(/\s+/g,' ').trim();
  const toggle='<button type="button" class="btn sm ghost" data-prefix-toggle="'+kind+'" aria-expanded="'+(open?'true':'false')+'" aria-controls="'+kind+'-prefix-body" title="'+(open?'收起前置提示词':'展开前置提示词')+'">'+(open?'收起 ▴':'展开 ▾')+'</button>';
  const summary=open?'':'<p class="generation-prefix-summary">已收起：'+esc(flat?flat.slice(0,42)+(flat.length>42?'…':''):'未填写（留空则不添加）')+'</p>';
  const layer=kind==='image'?'<select class="zs-select" id="image-style-layer" aria-label="前置词类型">'+[['free','自由（不注入）'],['character','人物'],['scene','场景'],['prop','道具']].map(([id,title])=>'<option value="'+id+'" '+((value.styleLayer||'auto')===id?'selected':'')+'>'+title+'</option>').join('')+'</select>':'';
  const body=open?'<div class="generation-prefix-body" id="'+kind+'-prefix-body">'+layer+'<textarea id="'+kind+'-prefix" class="generation-parameter-text" rows="4" placeholder="填写要加在正文之前的风格要求；留空则不添加">'+esc(text)+'</textarea><small>'+esc(typeof value.prefixPrompt==='string'?'当前画面自定义前置词':state.styleDetail?'来自项目风格：'+state.styleDetail.name:'当前项目未设置前置词，可直接填写')+'</small></div>':'';
  // 收起时用负外边距抵消所在面板的行间距，让上下各只留 2px；两个页面容器的行距不同，分别取值。
  // 收起时用负外边距抵消面板行距，上下各留 2px；图片页下方紧跟“图片比例”，它收起时由它自己带负边距。
  const nextCompact=kind==='image'&&layoutOpen.image===false;
  const collapseStyle='';
  return '<div class="generation-parameter-field generation-prefix-field generation-prefix-field-'+kind+(open?'':' is-collapsed is-compact')+'"'+collapseStyle+'><div class="generation-parameter-head generation-prefix-head"><label for="'+kind+'-prefix">前置提示词</label>'+toggle+'<button type="button" class="btn sm ghost" data-prefix-reset="'+kind+'">使用项目风格</button></div>'+summary+body+'</div>';
}
function imageLayoutParametersHtml() {
  const im=state.image,ratio=im.imageRatio||'auto',selected=GenerationParams.layout(im.imageLayoutId||'free')||GenerationParams.layout('free');
  const choices=ratio==='auto'?[GenerationParams.layout('free')]:GenerationParams.available(ratio);
  const text=typeof im.layoutPrompt==='string'?im.layoutPrompt:selected.description;
  const open=layoutOpen.image!==false;
  const toggle='<button type="button" class="btn sm ghost" data-layout-toggle="image" aria-expanded="'+(open?'true':'false')+'" aria-controls="image-layout-body" title="'+(open?'收起比例与分区设置':'展开比例与分区设置')+'">'+(open?'收起 ▴':'展开 ▾')+'</button>';
  const summary=open?'':'<p class="generation-prefix-summary">已收起：'+esc(ratio==='auto'?'由模型决定':ratio)+' · '+esc(selected.name)+'</p>';
  const preview=selected.shape?'<div class="image-layout-diagram '+selected.shape+'" style="aspect-ratio:'+ratio.replace(':','/')+'">'+selected.cells.map((text,n)=>'<span class="layout-cell cell-'+n+'">'+esc(text)+'</span>').join('')+'</div>':'';
  const body=open?'<div class="generation-layout-body" id="image-layout-body"><select class="zs-select" id="image-ratio" aria-label="图片比例">'+['auto',...GenerationParams.ratios].map(r=>'<option value="'+r+'" '+(r===ratio?'selected':'')+'>'+(r==='auto'?'由模型决定':r)+'</option>').join('')+'</select><label for="image-layout">图片样式 / 分区布局</label><select class="zs-select" id="image-layout" '+(ratio==='auto'?'disabled':'')+'>'+choices.map(l=>'<option value="'+l.id+'" '+(l.id===selected.id?'selected':'')+'>'+esc(l.name)+'</option>').join('')+'</select>'+preview+'<label for="image-layout-prompt">分区说明（可编辑）</label><textarea id="image-layout-prompt" class="generation-parameter-text" rows="5" '+(ratio==='auto'?'disabled':'')+' placeholder="自由构图，或填写每个小块放置的内容">'+esc(text)+'</textarea><small>比例和分区要求会加入生成提示词；像素尺寸使用下方图片尺寸。</small></div>':'';
  const collapseStyle=open?'':' style="margin-top:-18px;margin-bottom:-18px"';
  return '<div class="generation-parameter-field generation-layout-field'+(open?'':' is-collapsed is-compact')+'"'+collapseStyle+'><div class="generation-parameter-head"><label>图片比例</label>'+toggle+'</div>'+summary+body+'</div>';
}
function bindGenerationParameters(root,kind) {
  const value=kind==='video'?state.studio:state.image;
  const prefix=root.querySelector('#'+kind+'-prefix');if(prefix)prefix.oninput=()=>{value.prefixPrompt=prefix.value;WB.schedule(kind);};
  const toggle=root.querySelector('[data-prefix-toggle="'+kind+'"]');if(toggle)toggle.onclick=()=>{prefixOpen[kind]=prefixOpen[kind]===false;render();};
  const reset=root.querySelector('[data-prefix-reset="'+kind+'"]');if(reset)reset.onclick=()=>{delete value.prefixPrompt;render();};
  if(kind!=='image')return;
  const layoutToggle=root.querySelector('[data-layout-toggle="image"]');if(layoutToggle)layoutToggle.onclick=()=>{layoutOpen.image=layoutOpen.image===false;render();};
  const layer=root.querySelector('#image-style-layer');if(layer)layer.onchange=()=>{value.styleLayer=layer.value;delete value.prefixPrompt;render();};
  const ratio=root.querySelector('#image-ratio');if(ratio)ratio.onchange=()=>{value.imageRatio=ratio.value;const selected=GenerationParams.layout(value.imageLayoutId||'free');if(!selected?.ratios.includes(ratio.value)){value.imageLayoutId='free';delete value.layoutPrompt;}render();};
  const layout=root.querySelector('#image-layout');if(layout)layout.onchange=()=>{value.imageLayoutId=layout.value;delete value.layoutPrompt;render();};
  const description=root.querySelector('#image-layout-prompt');if(description)description.oninput=()=>{value.layoutPrompt=description.value;WB.schedule('image');};
  root.addEventListener('input',e=>{if(e.target.id==='img-prompt'&&value.prefixPrompt===undefined&&prefix)prefix.value=generationPrefixValue('image');});
}

function imagePanelHtml(tab, ch) {
  const im = state.image;
  const sources = tab === 'edit' || tab === 'reverse';
  const source = im.source || null;
  const sizes = imageSizeOptions(ch);
  const tabsBar = `
    <div class="zs-field">
      <div class="zs-field-head">
        <span class="zs-field-label">生图模型</span>
        <span class="zs-field-right">
          <button type="button" class="zs-keystate ${ch ? 'zs-keystate-ready' : 'zs-keystate-missing'}" data-act="manage-image-channels" title="${ch ? '已配置模型，点击管理' : '还没有图像模型，点击新增'}">
            <span class="zs-keystate-dot"></span>${ch ? esc(ch.model || ch.name) : '未配置模型'}
          </button>
        </span>
      </div>
      <div class="zs-stack">
        <div class="zs-select-wrap">
          <select class="zs-select" id="img-channel">
            ${imageChannels().length
              ? imageChannels().map((c) => `<option value="${esc(c.id)}" ${c.id === ch.id ? 'selected' : ''}>${esc(c.model || c.name)}${c.active ? ' · 默认' : ''}</option>`).join('')
              : '<option value="">没有可用的图像模型</option>'}
          </select>
          <span class="zs-select-caret">${ICON.caret}</span>
        </div>
      </div>
    </div>`;

  if (!ch) {
    const purpose = {
      generate: '图像生成：写提示词 → 出图（文生图）',
      edit: '图像编辑：选一张源图 + 写编辑指令 → 出新图',
      reverse: '图像反推：选一张图 → 反推成可复用的提示词',
    }[tab] || '';
    return tabsBar + `
      <div class="zs-field">
        <div class="wmd-field-hint">${purpose}</div>
        <div class="wmd-field-hint">这个页签需要先有一个图像模型：OpenAI Images / Gemini / Chat 生图，或者你自己的中转接口。</div>
      </div>
      <div class="zs-panel-foot"><button type="button" class="zs-btn zs-btn-primary zs-btn-lg zs-generate-btn" data-act="add-image-channel">新增图像模型</button></div>`;
  }

  if (tab === 'reverse') {
    const busyText = im.busy === 'gen' ? '出图中…' : im.busy === 'reverse' ? '反推中…' : (im.reverseText ? '重新反推并出图' : '反推并出图');
    return tabsBar + `
      ${imageSourcePickerHtml(source)}
      <div class="zs-field">
        <div class="zs-field-head"><span class="zs-field-label">反推 → 直接出图</span>
          <span class="zs-field-right"><span class="zs-inline-actions">
            ${im.reverseText ? '<button type="button" class="zs-btn zs-btn-ghost zs-btn-sm" data-act="use-reverse" ' + (im.busy || IJ.active(WB.context('image').itemId) ? 'disabled' : '') + '>再出一张</button>' : ''}
            <button type="button" class="zs-btn zs-btn-ghost zs-btn-sm" data-act="copy-reverse" ${im.reverseText ? '' : 'disabled'}>复制提示词</button>
          </span></span>
        </div>
        ${im.reverseText
          ? `<div class="zs-reverse-prompt">
              <div class="zs-reverse-hint">反推结果就是这块，直接改；改完点「再出一张」。</div>
              <textarea class="zs-textarea" id="img-reverse-out" style="min-height:220px">${esc(im.reverseText || '')}</textarea>
            </div>`
          : '<div class="wmd-field-hint">选一张源图，点下面「反推并出图」：先反推成提示词，再用它直接出图，结果显示在右侧画布，不用切页签。</div>'}
      </div>
      ${im.busy === 'gen' ? '<div class="wmd-field-hint">正在出图，完成后右侧画布自动更新…</div>' : ''}
      <div class="zs-panel-foot">
        <button type="button" class="zs-btn zs-btn-primary zs-btn-lg zs-generate-btn" data-act="image-reverse" ${im.busy || IJ.active(WB.context('image').itemId) ? 'disabled' : ''}>${busyText}</button>
      </div>`;
  }

  return tabsBar + generationPrefixHtml('image') + imageLayoutParametersHtml() + `
    <div class="zs-field">
      <div class="zs-field-head"><span class="zs-field-label">风格类别</span></div>
      <div class="zs-select-wrap"><select class="zs-select" id="img-style-category">${[['free','自由（不注入项目风格）'],['character','人物'],['scene','场景'],['prop','道具']].map(([id,label]) => `<option value="${id}" ${(im.styleLayer || 'free') === id ? 'selected' : ''}>${label}</option>`).join('')}</select><span class="zs-select-caret">${ICON.caret}</span></div>
    </div>
    ${tab === 'edit' ? imageSourcePickerHtml(source) : ''}
    <div class="zs-field">
      <div class="zs-field-head"><span class="zs-field-label">${tab === 'edit' ? '编辑指令' : '提示词'}</span></div>
      <div class="zs-prompt">
        <textarea class="zs-textarea" id="img-prompt" style="min-height:180px" placeholder="${tab === 'edit' ? '描述要怎么改：换背景、调光线、加/删元素、保持人物不变……' : '描述你想生成的画面：主体、动作、场景、光影、风格……'}">${esc(im.prompt)}</textarea>
        <div class="zs-prompt-foot">
          <span class="zs-prompt-count" id="img-prompt-count">${im.prompt.length}字</span>
          <span class="zs-prompt-spacer"></span>
          <button type="button" class="zs-iconbtn" data-act="image-clear-prompt" title="清空">${ICON.trash}</button>
          <button type="button" class="zs-magic" data-act="image-optimize" ${im.busy || IJ.active(WB.context('image').itemId) ? 'disabled' : ''} title="用当前推理模型扩写提示词">
            <span>${im.busy ? '优化中…' : '优化提示词'}</span>
          </button>
        </div>
      </div>
    </div>
    <div class="zs-field">
      <div class="zs-field-head"><span class="zs-field-label">图片尺寸 / 数量</span></div>
      <div class="zs-row">
        <div class="zs-select-wrap">
          <select class="zs-select" id="img-size">${sizes.map((s2) => `<option value="${esc(s2)}" ${s2 === im.size ? 'selected' : ''}>${esc(s2)}</option>`).join('')}</select>
          <span class="zs-select-caret">${ICON.caret}</span>
        </div>
        <div class="zs-select-wrap">
          <select class="zs-select" id="img-count">
            ${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === Number(im.count) ? 'selected' : ''}>${n} 张</option>`).join('')}
          </select>
          <span class="zs-select-caret">${ICON.caret}</span>
        </div>
      </div>
    </div>
    <div class="zs-panel-foot">
      <button type="button" class="zs-btn zs-btn-primary zs-btn-lg zs-generate-btn" data-act="image-generate" ${im.busy || IJ.active(WB.context('image').itemId) ? 'disabled' : ''} title="每点一次发送一个任务">${im.busy || IJ.active(WB.context('image').itemId) ? '生成中…' : (tab === 'edit' ? '编辑图像' : '图像生成')}</button>
    </div>`;
}

/* ---- 图像画布：选区 / 裁剪 / 尺寸 / 撤销重做 / 文件菜单（对齐原版工具条） ---- */

function imageCurrent() {
  const im = state.image;
  const tab = im.tab || 'generate';
  const result = (im.results || [])[im.previewIndex || 0] || null;
  const source = im.source || null;
  if (tab === 'reverse') return source ? { url: source.url || fileUrl(source.path), name: source.name, kind: 'source' } : null;
  if (result) return { ...result, kind: 'result' };
  if (tab === 'edit' && source) return { url: fileUrl(source.path), name: source.name, kind: 'source' };
  return null;
}

function imagePushHistory() {
  const im = state.image;
  im.history = im.history || [];
  im.historyIndex = im.historyIndex == null ? -1 : im.historyIndex;
  im.history = im.history.slice(0, im.historyIndex + 1);
  im.history.push(JSON.parse(JSON.stringify(im.results || [])));
  im.historyIndex = im.history.length - 1;
  if (im.history.length > 20) { im.history.shift(); im.historyIndex--; }
}

function imageUndo() {
  const im = state.image;
  if (!im.history || im.historyIndex <= 0) return toast('没有可撤销的步骤', true);
  im.historyIndex -= 1;
  im.results = JSON.parse(JSON.stringify(im.history[im.historyIndex]));
  im.previewIndex = Math.min(im.previewIndex || 0, Math.max(0, im.results.length - 1));
  im.selection = null;
  render();
}

function imageRedo() {
  const im = state.image;
  if (!im.history || im.historyIndex >= im.history.length - 1) return toast('没有可重做的步骤', true);
  im.historyIndex += 1;
  im.results = JSON.parse(JSON.stringify(im.history[im.historyIndex]));
  im.previewIndex = Math.min(im.previewIndex || 0, Math.max(0, im.results.length - 1));
  im.selection = null;
  render();
}

function imageSelectionStyle(sel) {
  if (!sel) return 'display:none';
  const clamp = (n) => Math.max(0, Math.min(100, n * 100));
  return `display:block;left:${clamp(sel.x)}%;top:${clamp(sel.y)}%;width:${clamp(sel.w)}%;height:${clamp(sel.h)}%`;
}

function imageZoomLabel() {
  const z = state.image.zoom;
  if (z === 'fit' || z == null) return '适应';
  return Math.round(z * 100) + '%';
}

function imageViewerHtml(item) {
  if (!item) return '';
  const im = state.image;
  const actual = im.zoom && im.zoom !== 'fit';
  const size = actual ? `style="width:${Math.round((im.zoom || 1) * 100)}%"` : '';
  return `<div class="zd-viewer image-viewer ${actual ? 'is-actual' : ''}" id="img-viewer">
    <div class="image-frame" id="img-frame" ${size}>
      <img id="img-canvas" src="${item.url}" alt="${esc(item.name || '')}" draggable="false" />
      <div class="image-marquee" id="img-marquee" style="${imageSelectionStyle(im.selection)}"></div>
    </div>
  </div>`;
}

function imageWorkspaceHtml(tab, ch) {
  const im = state.image;
  const item = imageCurrent();
  const imageTask=IJ.current();
  const generating=!!imageTask||im.busy;
  const status = imageTask ? imageTask.phase : !ch ? '没有图像模型 · 先在左侧新增一个'
    : item ? `${item.name}${item.width ? ` · ${item.width}×${item.height}` : ''}${item.bytes ? ` · ${fmtBytes(item.bytes)}` : ''}${im.selection ? ' · 已选区' : ''}`
    : (tab === 'reverse' ? '选源图 → 反推并出图，结果显示在这里' : '就绪 - 在左侧写提示词，点「图像生成」');
  return `<div class="zd-toolbar">
    <div class="zd-tool-group zd-filemenu" id="img-filemenu">
      <button type="button" class="zd-tool zd-filemenu-btn" data-act="img-file-menu" title="文件">
        <span class="zd-tool-label">文件</span>
      </button>
      <div class="zd-filemenu-pop">
        <button type="button" class="zd-filemenu-item" data-act="image-import">导入图片文件…</button>
        <button type="button" class="zd-filemenu-item" data-act="pick-result">打开图片<span class="zd-filemenu-keys">Ctrl+O</span></button>
        <button type="button" class="zd-filemenu-item" data-act="image-paste">粘贴剪贴板<span class="zd-filemenu-keys">Ctrl+V</span></button>
        <button type="button" class="zd-filemenu-item" data-act="image-history">最近生成…</button>
        <button type="button" class="zd-filemenu-item" data-act="image-save" ${item ? '' : 'disabled'}>保存图片…</button>
        <button type="button" class="zd-filemenu-item" data-act="image-save-all" ${(im.results || []).length ? '' : 'disabled'}>保存全部…</button>
        <button type="button" class="zd-filemenu-item" data-act="image-download" ${item ? '' : 'disabled'}>下载到浏览器</button>
        <button type="button" class="zd-filemenu-item" data-act="asset-result" ${item ? '' : 'disabled'}>存到素材库</button>
        <div class="zd-filemenu-sep"></div>
        <button type="button" class="zd-filemenu-item" data-act="image-clear" ${(im.results || []).length ? '' : 'disabled'}>清空画布</button>
      </div>
    </div>
    <span class="zd-tool-sep"></span>
    <div class="zd-tool-group">
      <button type="button" class="zd-tool" data-act="image-undo" title="撤销 (Ctrl+Z)" ${(im.historyIndex || 0) > 0 ? '' : 'disabled'}><span class="zd-tool-label">撤销</span></button>
      <button type="button" class="zd-tool" data-act="image-redo" title="重做 (Ctrl+Y)" ${im.historyIndex != null && im.historyIndex < (im.history || []).length - 1 ? '' : 'disabled'}><span class="zd-tool-label">重做</span></button>
    </div>
    <span class="zd-tool-sep"></span>
    <div class="zd-tool-group">
      <button type="button" class="zd-tool" data-act="image-select-all" title="全选 (Ctrl+A)" ${item ? '' : 'disabled'}><span class="zd-tool-label">全选</span></button>
      <button type="button" class="zd-tool" data-act="image-deselect" title="取消选区 (Esc)" ${im.selection ? '' : 'disabled'}><span class="zd-tool-label">取消选区</span></button>
      <button type="button" class="zd-tool" data-act="image-crop" title="裁剪到选区" ${im.selection ? '' : 'disabled'}><span class="zd-tool-label">裁剪</span></button>
      <button type="button" class="zd-tool" data-act="image-size" title="图像大小" ${item ? '' : 'disabled'}><span class="zd-tool-label">尺寸</span></button>
    </div>
    <span class="zd-tool-sep"></span>
    <div class="zd-tool-group">
      <button type="button" class="zd-tool" data-act="image-zoom-out" title="缩小" ${item ? '' : 'disabled'}>−</button>
      <span class="zd-zoom-readout" title="当前缩放">${imageZoomLabel()}</span>
      <button type="button" class="zd-tool" data-act="image-zoom-in" title="放大" ${item ? '' : 'disabled'}>+</button>
      <button type="button" class="zd-tool" data-act="image-fit" title="适应窗口"><span class="zd-tool-label">适应</span></button>
      <button type="button" class="zd-tool" data-act="image-actual" title="实际像素"><span class="zd-tool-label zd-tool-mono">1:1</span></button>
    </div>
    <button type="button" class="zd-tool" data-act="image-layer-edit">图层编辑</button>
    <button type="button" class="zd-tool" data-act="image-basic-edit" ${item ? '' : 'disabled'}>基础编辑</button>
    <span class="zd-toolbar-spacer"></span>
    <button type="button" class="zd-tool zd-tool-primary" data-act="image-save" ${item ? '' : 'disabled'} title="保存当前图片"><span class="zd-tool-label">保存</span></button>
    <button type="button" class="zd-tool" data-act="image-save-all" ${(im.results || []).length ? '' : 'disabled'} title="保存全部结果"><span class="zd-tool-label">全部保存</span></button>
    <button type="button" class="zd-tool" data-act="asset-result" ${im.previewIndex != null && (im.results || []).length ? '' : 'disabled'} title="把结果存进素材库"><span class="zd-tool-label">存素材库</span></button>
    <button type="button" class="zd-tool" data-act="use-result" ${(im.results || []).length ? '' : 'disabled'} title="把结果作为视频参考图"><span class="zd-tool-label">去视频</span></button>
  </div>
  <div class="zd-canvas-area">
    ${IJ.canvas() || (im.busy ? `<div class="img-generating"><span class="img-spin"></span><b>正在生成图片…</b><small>${esc(ch ? ch.name : '')}${im.count > 1 ? ' · ' + im.count + ' 张' : ''}</small></div>` : '')}
    ${item ? imageViewerHtml(item) : generating ? '' : `<div class="zd-empty">
        <div class="zd-empty-card">
          <div class="zd-empty-frame">${IMG_ICON}</div>
          <div class="zd-empty-title">${ch ? '把图片拖到这里开始' : '先新增一个图像模型'}</div>
          <div class="zd-empty-sub">${ch ? '或从素材库选图 · 也可以直接文生图，结果会显示在这里' : '支持 OpenAI Images / Gemini / Chat 生图，以及任意中转站'}</div>
          <div class="zd-empty-actions">
            ${ch ? `<button type="button" class="zd-btn zd-btn-primary" data-act="pick-result">打开图片</button>
      <button type="button" class="zd-btn" data-act="image-import">导入文件</button>` : `<button type="button" class="zd-btn zd-btn-primary" data-act="add-image-channel">新增图像模型</button>`}
            ${ch ? `<button type="button" class="zd-btn" data-act="image-paste">粘贴剪贴板</button>` : ''}
          </div>
          <ul class="zd-empty-steps">
            <li><b>图像生成</b>：没有图片也可以直接在左侧输入提示词文生图，结果在这里打开。</li>
            <li><b>图像编辑</b>：打开图片后，在左侧写编辑指令并选作源图，结果回贴。</li>
            <li><b>图像反推</b>：把当前图像反推成提示词，一键送回生成或编辑。</li>
          </ul>
        </div>
      </div>`}
  </div>
  <div class="zd-statusbar">
    <span class="zd-status-main" title="${esc(status)}">${esc(status)}</span>
    <span class="zd-status-spacer"></span>
    ${(im.results || []).length > 1 ? `<span class="zd-docnav">
      <button type="button" class="zd-tool" data-act="doc-prev" title="上一张">‹</button>
      <span class="zd-docnav-count" title="当前第几张">${(im.previewIndex || 0) + 1}/${im.results.length}</span>
      <button type="button" class="zd-tool" data-act="doc-next" title="下一张">›</button>
    </span>` : ''}
  </div>`;
}

async function imageSaveDataUrl(dataUrl) {
  const sourcePath=(imageCurrent()||{}).path;
  const data = await api('/api/images/save', { method: 'POST', body: { data: dataUrl, sourcePath, ...WB.context('image') } });
  const item = data.item;
  const img = new Image();
  await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; img.src = item.url; });
  return { ...item, width: img.naturalWidth || 0, height: img.naturalHeight || 0, kind: 'image' };
}

function imageDrawToCanvas(source, sx, sy, sw, sh, dw, dh) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(dw));
  canvas.height = Math.max(1, Math.round(dh));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

async function imageCrop() {
  const im = state.image;
  const sel = im.selection;
  if (!sel) return toast('先在画布上拖一个选区', true);
  const img = $('#img-canvas');
  if (!img) return;
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const sx = Math.round(sel.x * nw);
  const sy = Math.round(sel.y * nh);
  const sw = Math.max(1, Math.round(sel.w * nw));
  const sh = Math.max(1, Math.round(sel.h * nh));
  if (sw < 8 || sh < 8) return toast('选区太小', true);
  const item = await imageSaveDataUrl(imageDrawToCanvas(img, sx, sy, sw, sh, sw, sh));
  if (!(state.image.history || []).length) imagePushHistory();
  state.image.results = [...(state.image.results || []), item];
  state.image.previewIndex = state.image.results.length - 1;
  state.image.selection = null;
  imagePushHistory();
  render();
  toast(`已裁剪 ${sw}×${sh}`);
}

function imageResizeDialog() {
  const im = state.image;
  const img = $('#img-canvas');
  if (!img) return;
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  openModal(`
    <div class="modal-head"><h2>图像大小</h2><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="row">
        <div class="field grow"><label>宽（像素）</label><input class="input" id="img-w" type="number" min="1" value="${nw}" /></div>
        <div class="field grow"><label>高（像素）</label><input class="input" id="img-h" type="number" min="1" value="${nh}" /></div>
      </div>
      <label class="hint"><input type="checkbox" id="img-lock" checked /> 锁定比例（${nw}×${nh}）</label>
    </div>
    <div class="modal-foot">
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">取消</button>
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-primary" id="img-size-go">应用</button>
    </div>`);
  const w = $('#img-w');
  const h = $('#img-h');
  const lock = $('#img-lock');
  w.oninput = () => { if (lock.checked) h.value = String(Math.max(1, Math.round(Number(w.value) * nh / nw))); };
  h.oninput = () => { if (lock.checked) w.value = String(Math.max(1, Math.round(Number(h.value) * nw / nh))); };
  $('#img-size-go').onclick = async () => {
    const targetW = Math.max(1, Math.min(8192, Number(w.value) || nw));
    const targetH = Math.max(1, Math.min(8192, Number(h.value) || nh));
    try {
      const item = await imageSaveDataUrl(imageDrawToCanvas(img, 0, 0, nw, nh, targetW, targetH));
      if (!(state.image.history || []).length) imagePushHistory();
  state.image.results = [...(state.image.results || []), item];
      state.image.previewIndex = state.image.results.length - 1;
      state.image.selection = null;
      imagePushHistory();
      closeModal();
      render();
      toast(`已调整为 ${targetW}×${targetH}`);
    } catch (err) { toast(err.message, true); }
  };
}

async function imagePaste() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('这个浏览器不支持读剪贴板');
    const items = await navigator.clipboard.read();
    for (const entry of items) {
      const type = (entry.types || []).find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await entry.getType(type);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取剪贴板失败'));
        reader.readAsDataURL(blob);
      });
      const item = await imageSaveDataUrl(dataUrl);
      if (!(state.image.history || []).length) imagePushHistory();
  state.image.results = [...(state.image.results || []), item];
      state.image.previewIndex = state.image.results.length - 1;
      imagePushHistory();
      render();
      return toast('已粘贴剪贴板图片');
    }
    toast('剪贴板里没有图片', true);
  } catch (err) {
    toast(err.message, true);
  }
}


function applyImageFit() {
  const viewer = $('.image-viewer');
  const frame = $('#img-frame');
  const img = $('#img-canvas');
  if (!viewer || !frame || !img) return;
  const zoom = state.image.zoom;
  if (zoom && zoom !== 'fit') return;
  const nw = img.naturalWidth || 0;
  const nh = img.naturalHeight || 0;
  if (!nw || !nh) return;
  const vw = Math.max(80, viewer.clientWidth - 32);
  const vh = Math.max(80, viewer.clientHeight - 32);
  const scale = Math.min(vw / nw, vh / nh);
  const w = Math.round(nw * scale);
  const h = Math.round(nh * scale);
  if (frame.dataset.fitW === String(w) && frame.dataset.fitH === String(h) && img.style.width === '100%') return;
  frame.dataset.fitW = String(w);
  frame.dataset.fitH = String(h);
  frame.style.width = w + 'px';
  frame.style.height = h + 'px';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
}

function bindImageCanvas(root) {
  // 每次重绘先把上一轮挂在 window/document 上的监听摘掉
  if (state.image._drag) {
    window.removeEventListener('mousemove', state.image._drag.move);
    window.removeEventListener('mouseup', state.image._drag.up);
    state.image._drag = null;
  }
  if (state.image._key) document.removeEventListener('keydown', state.image._key);

  const frame = $('#img-frame');
  const marquee = $('#img-marquee');
  const canvasImg = $('#img-canvas');
  const readout = $('.zd-zoom-readout');
  if (canvasImg && readout) {
    const updateReadout = () => {
      const nw = canvasImg.naturalWidth || 0;
      if (!nw) return;
      const pct = Math.round((canvasImg.getBoundingClientRect().width / nw) * 100);
      readout.textContent = pct + '%';
      readout.title = `当前缩放 ${pct}%（原图 ${nw}×${canvasImg.naturalHeight || 0}）`;
    };
    const refreshViewer = () => { applyImageFit(); updateReadout(); };
    if (canvasImg.complete) refreshViewer();
    else canvasImg.addEventListener('load', refreshViewer);
    window.requestAnimationFrame(refreshViewer);
    if (state.image._resize) window.removeEventListener('resize', state.image._resize);
    state.image._resize = refreshViewer;
    window.addEventListener('resize', refreshViewer);
  }
  if (frame && marquee) {
    let start = null;
    const rectOf = () => frame.getBoundingClientRect();
    const apply = (sel) => { marquee.style.cssText = imageSelectionStyle(sel); };
    frame.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const rect = rectOf();
      start = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
      event.preventDefault();
    });
    const move = (event) => {
      if (!start) return;
      const rect = rectOf();
      const cur = {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
      const sel = {
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      };
      apply(sel);
    };
    const up = (event) => {
      if (!start) return;
      const rect = rectOf();
      const cur = {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
      const sel = {
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      };
      start = null;
      state.image.selection = (sel.w > 0.01 && sel.h > 0.01) ? sel : null;
      apply(state.image.selection);
      const cropBtn = document.querySelector('[data-act="image-crop"]');
      if (cropBtn) cropBtn.disabled = !state.image.selection;
      const deselect = document.querySelector('[data-act="image-deselect"]');
      if (deselect) deselect.disabled = !state.image.selection;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    state.image._drag = { move, up };
  }

  root.addEventListener('click', async (event) => {
    const menuBtn = event.target.closest('.zd-filemenu-btn');
    if (menuBtn) {
      const menu = $('#img-filemenu');
      if (!menu) return;
      const open = menu.classList.toggle('zd-filemenu-open');
      const pop = menu.querySelector('.zd-filemenu-pop');
      if (open && pop) {
        const rect = menuBtn.getBoundingClientRect();
        pop.style.left = Math.round(rect.left) + 'px';
        pop.style.top = Math.round(rect.bottom + 4) + 'px';
      }
      return;
    }
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    try {
      if (act === 'image-select-all') { state.image.selection = { x: 0, y: 0, w: 1, h: 1 }; return render(); }
      if (act === 'image-deselect') { state.image.selection = null; return render(); }
      if (act === 'image-crop') return imageCrop();
      if (act === 'image-size') return imageResizeDialog();
      if (act === 'image-basic-edit') return await openRasterEditor();
      if (act === 'image-layer-edit') return await openLayerEditor(imageCurrent());
      if (act === 'image-undo') return imageUndo();
      if (act === 'image-redo') return imageRedo();
      if (act === 'image-paste') return imagePaste();
      if (act === 'image-zoom-in' || act === 'image-zoom-out') {
        const cur = state.image.zoom === 'fit' || !state.image.zoom ? 1 : state.image.zoom;
        const next = act === 'image-zoom-in' ? Math.min(4, cur * 1.25) : Math.max(0.1, cur / 1.25);
        state.image.zoom = Math.round(next * 100) / 100;
        return render();
      }
      if (act === 'image-fit') { state.image.zoom = 'fit'; return render(); }
      if (act === 'image-actual') { state.image.zoom = 1; return render(); }
      if (act === 'doc-prev' || act === 'doc-next') {
        const list = state.image.results || [];
        if (!list.length) return;
        const step = act === 'doc-prev' ? -1 : 1;
        state.image.previewIndex = ((state.image.previewIndex || 0) + step + list.length) % list.length;
        return render();
      }
    } catch (err) { toast(err.message, true); }
  });

  const onKey = (event) => {
    if (state.route !== 'image' || !$('#modal').hidden) return;
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); imageUndo(); }
    else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); imageRedo(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); state.image.selection = { x: 0, y: 0, w: 1, h: 1 }; render(); }
    else if (event.key === 'Escape') { state.image.selection = null; render(); }
  };
  document.addEventListener('keydown', onKey);
  state.image._key = onKey;
}

function openImageHistory() {
  const list = state.imageHistory || [];
  openModal(`
    <div class="modal-head"><h2>最近生成</h2><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body">
      ${list.length ? `<div class="grid-cards">${list.map((batch, i) => `<div class="asset-card" data-history="${i}">
        <div class="asset-thumb">${batch.items && batch.items[0] ? `<img src="${batch.items[0].url}" loading="lazy" />` : ''}</div>
        <div class="asset-meta">
          <span class="name">${esc((batch.prompt || '').slice(0, 40) || (batch.kind === 'edit' ? '编辑结果' : '生成结果'))}</span>
          <span class="sub">${batch.items ? batch.items.length + ' 张' : ''}${batch.createdAt ? ' · ' + new Date(batch.createdAt).toLocaleString('zh-CN', { hour12: false }) : ''}</span>
        </div>
      </div>`).join('')}</div>` : '<div class="empty">还没有生成记录</div>'}
    </div>
  `);
  $$('#modal-panel [data-history]').forEach((card) => {
    card.onclick = () => {
      const batch = list[Number(card.dataset.history)];
      if (!batch || !batch.items) return;
      state.image.results = batch.items;
      state.image.previewIndex = 0;
      state.image.selection = null;
      state.image.zoom = 'fit';
      if (batch.prompt) state.image.prompt = batch.prompt;
      closeModal();
      render();
      toast('已载入 ' + batch.items.length + ' 张');
    };
  });
}

function renderImage() {
  const tab = state.image.tab || 'generate';
  if (tab === 'scene') return '<div class="wmd-image-host is-scene">' + imageTabsHtml(tab) + sceneWorkspaceHtml() + '</div>';
  const ch = imageChannel();
  return `<div class="wmd-image-host zs-app">
    ${imageTabsHtml(tab)}
    <input type="file" id="image-import-file" accept="image/*" hidden />
    <div class="zs-main">
      <aside class="zs-panel" style="width:${state.image.panelWidth || 440}px">
        <div class="zs-panel-inner" style="width:${state.image.panelWidth || 440}px">
          <div class="zs-panel-body">${imagePanelHtml(tab, ch)}</div>
        </div>
      </aside>
      <div class="zs-splitter" title="拖动调整面板宽度"></div>
      <section class="zd-workspace">${imageWorkspaceHtml(tab, ch)}</section>
    </div>
  </div>`;
}

function bindImage(root) {
  bindGenerationParameters(root,'image');
  const im = state.image;
  const workbenchContext = WB.context("image");
  // 反推页直接出图：用给定提示词提交一次文生图，结果由后台任务回填到右侧画布，不切页签
  const imageGenerateNow = async (prompt, refs = []) => {
    const ch = imageChannel();
    if (!ch) throw new Error('请选择图像模型');
    const text = String(prompt || '').trim();
    if (!text) throw new Error('提示词是空的');
    if (IJ.active(workbenchContext.itemId)) throw new Error('当前画面已有未结束的图像任务，请等它结束');
    await WB.flush('image');
    await api('/api/images/generate', { method: 'POST', body: {
      ...workbenchContext, background: true, requestId: crypto.randomUUID(), channelId: ch.id,
      prompt: text, prefixPrompt: generationPrefixValue('image'), styleLayer: im.styleLayer || 'free',
      imageRatio: im.imageRatio || 'auto', imageLayoutId: im.imageLayoutId || 'free', layoutPrompt: im.layoutPrompt,
      size: im.size, count: im.count, styleId: state.project?.styleId, refs: Array.isArray(refs) ? refs : [],
    } });
    await IJ.refresh();
  };
  if (im.tab === 'scene') {
    root.addEventListener('click', e => { const tab=e.target.closest('[data-img-tab]'); if(tab) {sceneCaptureInputs();im.tab=tab.dataset.imgTab;render();} });
    bindSceneWorkspace(root);return;
  }
  bindSplitter(root, '.zs-panel', (width) => { im.panelWidth = width || 440; });
  bindImageCanvas(root);
  bindImageSourcePicker(root);
  root.addEventListener('keydown', event => {
    const close = event.target.closest('[data-close-document]');
    if (close && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.stopPropagation();
      imageCloseDocument(Number(close.dataset.closeDocument));
    }
  });
  const chSel = $('#img-channel', root);
  if (chSel) chSel.onchange = () => { im.channelId = chSel.value; im.size = 'auto'; render(); };
  const categorySel = $('#img-style-category', root);
  if (categorySel) categorySel.onchange = () => { im.styleLayer = categorySel.value; delete im.prefixPrompt; render(); };
  const sizeSel = $('#img-size', root);
  if (sizeSel) sizeSel.onchange = () => { im.size = sizeSel.value; };
  const countEl = $('#img-count', root);
  if (countEl) countEl.onchange = () => { im.count = Math.max(1, Math.min(4, Number(countEl.value) || 1)); };
  const importInput = $('#image-import-file', root);
  if (importInput) importInput.onchange = async () => {
    const files = [...(importInput.files || [])];
    importInput.value = '';
    if (files.length) await imageImportToCanvas(files).catch((err) => toast(err.message, true));
  };
  if (state.image._pasteHandler) document.removeEventListener('paste', state.image._pasteHandler);
  state.image._pasteHandler = async (event) => {
    if (state.route !== 'image' || document.querySelector('.modal-backdrop')) return;
    // 焦点在源图框里时由源图框自己接剪贴板，不要再往画布塞一份
    if (event.target && event.target.closest && event.target.closest('.src-picker-field')) return;
    const files = [...((event.clipboardData && event.clipboardData.files) || [])].filter((f) => String(f.type || '').startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    await imageImportToCanvas(files).catch((err) => toast(err.message, true));
  };
  document.addEventListener('paste', state.image._pasteHandler);
  const canvasArea = $('.zd-canvas-area', root);
  if (canvasArea) {
    canvasArea.ondragover = (event) => { if (![...(event.dataTransfer.types || [])].includes('Files')) return; event.preventDefault(); canvasArea.classList.add('is-drop'); };
    canvasArea.ondragleave = () => canvasArea.classList.remove('is-drop');
    canvasArea.ondrop = async (event) => {
      const files = [...(event.dataTransfer.files || [])].filter((f) => String(f.type || '').startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      canvasArea.classList.remove('is-drop');
      await imageImportToCanvas(files).catch((err) => toast(err.message, true));
    };
  }
  const promptEl = $('#img-prompt', root);
  if (promptEl) {
    promptEl.oninput = () => {
      im.prompt = promptEl.value;
      const count = $('#img-prompt-count');
      if (count) count.textContent = im.prompt.length + '字';
    };
  }
  const reverseOut = $('#img-reverse-out', root);
  if (reverseOut) reverseOut.oninput = () => { im.reverseText = reverseOut.value; };

  root.addEventListener('click', async (event) => {
    const tabBtn = event.target.closest('[data-img-tab]');
    if (tabBtn) { im.tab = tabBtn.dataset.imgTab; return render(); }
    const closeDocument = event.target.closest('[data-close-document]');
    if (closeDocument) { event.stopPropagation(); return imageCloseDocument(Number(closeDocument.dataset.closeDocument)); }
    const thumb = event.target.closest('[data-preview]');
    if (thumb) { im.previewIndex = Number(thumb.dataset.preview); return render(); }
    const clearSource = event.target.closest('[data-clear-source]');
    if (clearSource) return imageClearSource({ keepFocus: true });
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    const selected = () => (im.results || [])[im.previewIndex || 0] || null;
    try {
      if (act === 'add-image-channel') return openChannelDialog('image', null);
      if (act === 'manage-image-channels') return openSettings('channels');
      if (act === 'set-tab-generate') { im.tab = 'generate'; return render(); }
      if (act === 'image-clear-prompt') { im.prompt = ''; return render(); }
      if (act === 'image-clear') {
        im.results = [];
        im.previewIndex = 0;
        im.selection = null;
        imagePushHistory();
        return render();
      }
      if (act === 'image-import') { const el = $('#image-import-file'); if (el) el.click(); return; }
      if (act === 'pick-result') return openSourcePicker();
      if (act === 'pick-source') return openSourcePicker();
      if (act === 'copy-reverse') {
        await navigator.clipboard.writeText(im.reverseText || '');
        toast('已复制');
        return;
      }
        if (act === 'use-reverse') {
        im.prompt = im.reverseText || '';
        // 反推页里直接出图，不跳页签
        if (!String(im.prompt).trim()) return toast('提示词是空的', true);
        im.busy = 'gen'; render();
        try {
          await imageGenerateNow(im.prompt, []);
          toast('已按提示词出图');
        } catch (err) { toast(err.message, true); }
        finally { im.busy = false; render(); }
        return;
      }
      if (act === 'open-result') {
        const item = selected();
        if (item) await api('/api/media/open', { method: 'POST', body: { path: item.path } }).catch((e) => toast(e.message, true));
        return;
      }
      if (act === 'image-history') return openImageHistory();
      if (act === 'image-save') return openImageSaveDialog(false);
      if (act === 'image-save-all') return openImageSaveDialog(true);
      if (act === 'image-download') {
        const item2 = selected();
        if (!item2) return;
        const link = document.createElement('a');
        link.href = '/api/file?path=' + encodeURIComponent(item2.path) + '&download=1';
        link.download = item2.name || 'image.png';
        link.click();
        toast('已开始下载 ' + (item2.name || ''));
        return;
      }
      if (act === 'asset-result') {
        const item = selected();
        if (!item) return;
        await api('/api/assets/from-file', { method: 'POST', body: { path: item.path } });
        state.assets = await api('/api/assets');
        toast('已存进素材库');
        return;
      }
      if (act === 'use-result') {
        const item = selected();
        if (!item) return;
        let slot = state.studio.images.findIndex((x) => !x);
        if (slot < 0) slot = 0;
        state.studio.images[slot] = { path: item.path, name: item.name, subject: '', kind: 'image' };
        location.hash = '#studio';
        toast('已加入视频参考图');
        return;
      }
      if (act === 'image-optimize') {
        if (!im.prompt.trim()) return toast('先写一句想法', true);
        im.busy = true; render();
        try {
          const res = await api('/api/images/prompt', { method: 'POST', body: { prompt: im.prompt } });
          im.prompt = res.prompt;
          toast('提示词已优化');
        } catch (err) { toast(err.message, true); }
        finally { im.busy = false; await WB.complete("image",workbenchContext,im); render(); }
        return;
      }
      if (act === 'image-reverse') {
        if (!im.source) return toast('先选一张源图', true);
        if (IJ.active(workbenchContext.itemId)) return toast('当前画面已有未结束的图像任务，请等它结束', true);
        im.busy = 'reverse'; render();
        try {
          const res = await api('/api/images/reverse', { method: 'POST', body: { path: im.source.path } });
          im.reverseText = res.prompt;
          im.prompt = res.prompt;
          // 反推完立刻用这段提示词出图，结果显示在右侧画布，不跳页签
          im.busy = 'gen'; render();
          await imageGenerateNow(res.prompt, []);
          toast('反推完成，已按提示词出图');
        } catch (err) { toast(err.message, true); }
        finally { im.busy = false; await WB.complete("image",workbenchContext,im); render(); }
        return;
      }
      if (act === 'image-generate') {
        const ch=imageChannel();
        if(!ch)return toast('请选择图像模型',true);
        if(!im.prompt.trim())return toast('先写提示词',true);
        if(IJ.active(workbenchContext.itemId))return toast('当前画面已有未结束的图像任务，请查看任务日志',true);
        if((im.tab||'generate')==='edit'&&!im.source)return toast('先选源图',true);
        await WB.flush('image');
        const body={...workbenchContext,background:true,requestId:crypto.randomUUID(),channelId:ch.id,prompt:im.prompt,prefixPrompt:generationPrefixValue('image'),styleLayer:im.styleLayer||'free',imageRatio:im.imageRatio||'auto',imageLayoutId:im.imageLayoutId||'free',layoutPrompt:im.layoutPrompt,size:im.size,count:im.count,styleId:state.project?.styleId,refs:(im.tab||'generate')==='edit'&&im.source?[{path:im.source.path,name:im.source.name}]:(im.refs||[])};
        im.busy=true;render();
        try{
          await api('/api/images/generate',{method:'POST',body});
          await IJ.refresh();toast('图像任务已加入后台，切换菜单不会中断');
        }catch(e){toast(e.message,true);}finally{im.busy=false;render();}
      }
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function imageSetSource(item) {
  state.image.source = { path: item.path, name: item.name || '图片', url: item.url, width: item.width || 0, height: item.height || 0 };
  state.image._focusSource = true;
  closeModal();
  try { WB.schedule('image'); } catch {}
  render();
  toast('已选择源图：' + state.image.source.name);
}

/* 清掉源图：删除按钮与 Backspace/Delete 共用这条路径 */
function imageClearSource(opts = {}) {
  if (!state.image.source) return;
  state.image.source = null;
  if (opts.keepFocus) state.image._focusSource = true;
  try { WB.schedule('image'); } catch {}
  render();
  toast('已删除源图');
}

async function imageImportToCanvas(files) {
  const file = [...files].find((f) => String(f.type || '').startsWith('image/'));
  if (!file) return;
  const item = await imageSaveDataUrl(await fileToDataUrl(file));
  state.image.results = [...(state.image.results || []), item];
  state.image.previewIndex = state.image.results.length - 1;
  state.image.source = { path: item.path, name: item.name || file.name, url: item.url, width: item.width || 0, height: item.height || 0 };
  imagePushHistory();
  render();
  toast('已导入图片：' + (item.name || file.name));
}

async function imageSourceFromFile(file) {
  const dataUrl = await fileToDataUrl(file);
  const item = await imageSaveDataUrl(dataUrl);
  imageSetSource(item);
}

/* 源图选择器：常驻在面板里（拖入 / 粘贴 / 上传 / 素材库），不再弹窗 */
function imageSourcePickerHtml(source) {
  const previewSrc = source ? (source.url || '/api/file?path=' + encodeURIComponent(source.path)) : '';
  return `<div class="zs-field src-picker-field">
    <div class="zs-field-head">
      <span class="zs-field-label">源图</span>
      <span class="zs-field-right">
        <span class="src-picker-state" title="${esc(source ? source.name : '未选择')}">${source ? esc(source.name) : '未选择'}</span>
      </span>
    </div>
    <div class="src-stage ${source ? 'is-filled' : 'is-empty'}" data-source-drop="1" tabindex="0" title="${source ? '点一下选中，Backspace 或 Delete 删除' : '点一下选中这里，再按 Ctrl+V 粘贴图片'}">
      ${source
        ? `<img class="src-stage-img" src="${esc(previewSrc)}" alt="" />`
        : `<div class="src-stage-empty"><b>拖入图片</b><span>点一下选中这里，Ctrl+V 直接粘贴</span></div>`}
      <span class="src-stage-badge">${source ? '已选中 · Ctrl+V 换图 · Backspace 删除' : '已选中 · Ctrl+V 粘贴'}</span>
      <input type="file" accept="image/*" hidden data-source-input="1" />
    </div>
    <div class="src-actions">
      <button type="button" class="zs-btn zs-btn-sm" data-source-library="1">素材库</button>
      <button type="button" class="zs-btn zs-btn-sm" data-source-upload="1">上传</button>
      <button type="button" class="zs-btn zs-btn-sm" data-source-paste="1">粘贴</button>
      ${source ? '<button type="button" class="zs-btn zs-btn-sm src-danger" data-clear-source="1">删除</button>' : ''}
    </div>
  </div>`;
}

function bindImageSourcePicker(root) {
  const drop = $('[data-source-drop]', root);
  if (!drop) return;
  const input = $('[data-source-input]', root);
  const upload = $('[data-source-upload]', root);
  if (upload && input) upload.onclick = () => input.click();
  if (input) input.onchange = () => {
    const file = (input.files || [])[0];
    input.value = '';
    if (file) imageSourceFromFile(file).catch((err) => toast(err.message, true));
  };
  const library = $('[data-source-library]', root);
  if (library) library.onclick = () => openSourcePicker();
  drop.onclick = () => drop.focus();
  const field = drop.closest('.src-picker-field') || drop;
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    if (!state.image.source) return;
    event.preventDefault();
    event.stopPropagation();
    imageClearSource({ keepFocus: true });
  });
  if (state.image._focusSource) {
    state.image._focusSource = false;
    drop.focus();
  }
  drop.addEventListener('paste', (event) => {
    const file = [...((event.clipboardData && event.clipboardData.files) || [])].find((f) => String(f.type || '').startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    imageSourceFromFile(file).catch((err) => toast(err.message, true));
  });
  drop.ondragover = (event) => {
    if (![...((event.dataTransfer && event.dataTransfer.types) || [])].includes('Files')) return;
    event.preventDefault();
    drop.classList.add('is-drop');
  };
  drop.ondragleave = () => drop.classList.remove('is-drop');
  drop.ondrop = (event) => {
    const file = [...((event.dataTransfer && event.dataTransfer.files) || [])].find((f) => String(f.type || '').startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    drop.classList.remove('is-drop');
    imageSourceFromFile(file).catch((err) => toast(err.message, true));
  };
  const paste = $('[data-source-paste]', root);
  if (paste) paste.onclick = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('这个浏览器不支持读剪贴板');
      const entries = await navigator.clipboard.read();
      for (const entry of entries) {
        const type = (entry.types || []).find((t) => t.startsWith('image/'));
        if (!type) continue;
        const blob = await entry.getType(type);
        return imageSourceFromFile(new File([blob], '剪贴板图片.png', { type }));
      }
      toast('剪贴板里没有图片', true);
    } catch (err) { toast(err.message, true); }
  };
}

function openSourcePicker() {
  return openLibraryPicker({
    title: '选择源图',
    onPick: (item) => imageSetSource(item),
  });
}
