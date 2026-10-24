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
  const status = !ch ? '没有图像渠道 · 先在左侧新增一个'
    : item ? `${item.name}${item.width ? ` · ${item.width}×${item.height}` : ''}${item.bytes ? ` · ${fmtBytes(item.bytes)}` : ''}${im.selection ? ' · 已选区' : ''}`
    : (tab === 'reverse' ? '选择源图后点「反推提示词」' : '就绪 - 在左侧写提示词，点「图像生成」');
  const thumbs = (tab !== 'reverse' && (im.results || []).length)
    ? im.results.map((it, i) => `<button type="button" class="zd-tab ${i === (im.previewIndex || 0) ? 'zd-tab-active' : ''}" data-preview="${i}" title="${esc(it.name)}">
        <span class="zd-tab-name">${esc(it.name)}</span><span class="zd-tab-size">${it.width || ''}${it.height ? '×' + it.height : ''}</span>
      </button>`).join('')
    : '';

  return `<div class="zd-toolbar">
    <div class="zd-tool-group zd-filemenu" id="img-filemenu">
      <button type="button" class="zd-tool zd-filemenu-btn" data-act="img-file-menu" title="文件">
        <span class="zd-tool-label">文件</span>
      </button>
      <div class="zd-filemenu-pop">
        <button type="button" class="zd-filemenu-item" data-act="pick-result">打开图片<span class="zd-filemenu-keys">Ctrl+O</span></button>
        <button type="button" class="zd-filemenu-item" data-act="image-paste">粘贴剪贴板<span class="zd-filemenu-keys">Ctrl+V</span></button>
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
    <span class="zd-toolbar-spacer"></span>
    <button type="button" class="zd-tool" data-act="asset-result" ${im.previewIndex != null && (im.results || []).length ? '' : 'disabled'} title="把结果存进素材库"><span class="zd-tool-label">存素材库</span></button>
    <button type="button" class="zd-tool" data-act="use-result" ${(im.results || []).length ? '' : 'disabled'} title="把结果作为视频参考图"><span class="zd-tool-label">去视频</span></button>
  </div>
  <div class="zd-tabs">
    ${thumbs}
    <button type="button" class="zd-tab-add" data-act="pick-result" title="从素材库选图打开">+</button>
    <span class="zd-tabs-spacer"></span>
  </div>
  <div class="zd-canvas-area">
    ${item ? imageViewerHtml(item) : `<div class="zd-empty">
        <div class="zd-empty-card">
          <div class="zd-empty-frame">${IMG_ICON}</div>
          <div class="zd-empty-title">${ch ? '把图片拖到这里开始' : '先新增一个图像渠道'}</div>
          <div class="zd-empty-sub">${ch ? '或从素材库选图 · 也可以直接文生图，结果会显示在这里' : '支持 OpenAI Images / Gemini / Chat 生图，以及任意中转站'}</div>
          <div class="zd-empty-actions">
            ${ch ? `<button type="button" class="zd-btn zd-btn-primary" data-act="pick-result">打开图片</button>` : `<button type="button" class="zd-btn zd-btn-primary" data-act="add-image-channel">新增图像渠道</button>`}
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
  </div>`;
}

async function imageSaveDataUrl(dataUrl) {
  const data = await api('/api/images/save', { method: 'POST', body: { data: dataUrl } });
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
    <div class="modal-head"><h2>图像大小</h2><span class="grow"></span><button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="row">
        <div class="field grow"><label>宽（像素）</label><input class="input" id="img-w" type="number" min="1" value="${nw}" /></div>
        <div class="field grow"><label>高（像素）</label><input class="input" id="img-h" type="number" min="1" value="${nh}" /></div>
      </div>
      <label class="hint"><input type="checkbox" id="img-lock" checked /> 锁定比例（${nw}×${nh}）</label>
    </div>
    <div class="modal-foot">
      <button type="button" class="h3-btn h3-btn-sm h3-btn-ghost" data-close="1">取消</button>
      <button type="button" class="h3-btn h3-btn-sm h3-btn-primary" id="img-size-go">应用</button>
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

function bindImageCanvas(root) {
  const frame = $('#img-frame');
  const marquee = $('#img-marquee');
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
    window.addEventListener('mousemove', (event) => {
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
    });
    window.addEventListener('mouseup', (event) => {
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
    });
  }

  root.addEventListener('click', async (event) => {
    if (event.target.closest('.zd-filemenu-btn')) {
      const menu = $('#img-filemenu');
      if (menu) menu.classList.toggle('zd-filemenu-open');
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
    } catch (err) { toast(err.message, true); }
  });

  document.addEventListener('keydown', (event) => {
    if (state.route !== 'image') return;
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) { event.preventDefault(); imageUndo(); }
    else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) { event.preventDefault(); imageRedo(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); state.image.selection = { x: 0, y: 0, w: 1, h: 1 }; render(); }
    else if (event.key === 'Escape') { state.image.selection = null; render(); }
  });
}
