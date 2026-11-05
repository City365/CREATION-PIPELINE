/* Host-owned adapters: image layers, structured scenes and local video editing. */
let creativeModalGuard = null;
const creativeState = {scene:null,sceneProject:null,sceneDocs:[],scenePrompts:[],sceneBusy:false,sceneView:'plan',references:[],sceneAbort:0};
function ceProject(){return state.projectId||'default';}
function ceCall(path,body){return api('/api/creative/'+path,body===undefined?undefined:{method:'POST',body:{...body,projectId:ceProject()}});}
function ceQuery(path){return ceCall(path+(path.includes('?')?'&':'?')+'projectId='+encodeURIComponent(ceProject()));}
function ceDownload(name,data,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function openLayerEditor(item){
  const project=ceProject();let doc=null,dirty=false,loading=true,closed=false,timer=null,savePending=null;
  const docs=await ceQuery('documents/image');
  openModal('<div class="modal-head"><h2>图层编辑</h2><input class="input ce-name" id="layer-name" value="'+esc(item?.name||'未命名图层工程')+'"><select class="select" id="layer-doc"><option value="">打开已保存工程…</option>'+docs.map(d=>'<option value="'+esc(d.id)+'">'+esc(d.name)+'</option>').join('')+'</select><button class="btn primary" id="layer-save">保存工程</button><button class="btn" id="layer-export">导出到画布</button><button class="btn" data-close="1">关闭</button></div><div id="layer-status" class="hint">正在加载本地图层编辑器…</div><iframe id="layer-frame" class="ce-layer-frame" title="图层编辑器" src="/integrations/minipaint/index.html"></iframe>');
  $('#modal-panel').classList.add('modal-wide','ce-full');const frame=$('#layer-frame');
  const status=t=>{const el=$('#layer-status');if(el)el.textContent=t;};
  async function save(){if(loading||closed)return; if(savePending)return savePending;savePending=(async()=>{const layers=JSON.parse(frame.contentWindow.FileSave.export_as_json());const name=$('#layer-name').value.trim()||'未命名图层工程';const version=changeVersion;const saved=await api('/api/creative/documents/image',{method:'POST',body:{projectId:project,document:{...doc,name,layers}}});doc=saved;if(version===changeVersion)dirty=false;status('已保存 '+new Date().toLocaleTimeString()+' · '+layers.layers.length+' 个图层');})().catch(e=>{status('保存失败：'+e.message);throw e;}).finally(()=>savePending=null);return savePending;}
  let changeVersion=0;
  function changed(){if(loading||closed)return;dirty=true;changeVersion++;status('有修改 · 正在等待自动保存');clearTimeout(timer);timer=setTimeout(()=>save().catch(()=>{}),1800);}
  creativeModalGuard=()=>{if((dirty||savePending)&&!window.confirm('图层修改尚未保存完成，仍要关闭吗？'))return false;closed=true;clearTimeout(timer);creativeModalGuard=null;return true;};
  $('#layer-name').oninput=changed;
  frame.onload=async()=>{try{const w=frame.contentWindow;await new Promise((resolve,reject)=>{let tries=0;const tick=()=>{if(closed)return reject(Error('已关闭'));if(w.FileSave?.export_as_json&&w.FileOpen&&w.Layers)return resolve();if(++tries>200)return reject(Error('编辑器初始化超时'));setTimeout(tick,50);};tick();});w.FileOpen.Base_gui.Tools_translate.translate('zh');const original=w.State.do_action.bind(w.State);w.State.do_action=async function(...args){const result=await original(...args);changed();return result;};
    if(item?.url){const response=await fetch(item.url);if(!response.ok)throw Error('源图加载失败');const blob=await response.blob();const data=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob);});w.FileOpen.file_open_data_url_handler(data);await new Promise(resolve=>setTimeout(resolve,400));}
    loading=false;status('本地编辑 · 支持图层工程保存与自动保存');if(item)changed();
  }catch(e){status(e.message);}};
  $('#layer-save').onclick=()=>save().catch(e=>toast(e.message,true));
  $('#layer-doc').onchange=async e=>{if(!e.target.value)return;if(dirty&&!confirm('放弃当前尚未保存的修改并打开工程？'))return;clearTimeout(timer);loading=true;try{const saved=await api('/api/creative/documents/image?projectId='+encodeURIComponent(project)+'&id='+encodeURIComponent(e.target.value));await frame.contentWindow.FileOpen.load_json(JSON.stringify(saved.layers));doc=saved;$('#layer-name').value=saved.name;dirty=false;status('已恢复 '+saved.name);}catch(error){toast(error.message,true);}finally{loading=false;}};
  $('#layer-export').onclick=async e=>{e.target.disabled=true;try{await save();const w=frame.contentWindow;const c=document.createElement('canvas');c.width=w.AppConfig.WIDTH;c.height=w.AppConfig.HEIGHT;w.Layers.convert_layers_to_canvas(c.getContext('2d'));const image=await imageSaveDataUrl(c.toDataURL('image/png'));imagePushHistory();state.image.results=[...(state.image.results||[]),image];state.image.previewIndex=state.image.results.length-1;imagePushHistory();toast('已导出新图片到画布，图层工程已保留');}catch(error){toast(error.message,true);}finally{e.target.disabled=false;}};
}

/* ---------------------------------------------------------------- 场景建模
   流程与「图像反推」一致：源图（可选）→ 场景描述 → 四条机位提示词 → 逐张出图 → 合成 16:9 四宫格。 */
const SCENE_VIEW_DEFS = [['front', '正视', '正面机位'], ['side', '侧视', '侧面机位'], ['back', '反视', '背面机位'], ['top', '俯视', '俯视全景']];
/* 每个「画面」条目各自一份场景建模数据：新建/切换条目不能继承上一个的内容。
   条目 id 来自画面目录（WB），没有条目时退回项目级默认，保证旧数据还能读出来。 */
function ceSceneItemId() {
  try { return (typeof WB !== 'undefined' && WB.context && WB.context('image').itemId) || ''; } catch { return ''; }
}
function sceneFlowKey() { return 'wmd.sceneFlow.' + ceProject() + (ceSceneItemId() ? '.' + ceSceneItemId() : ''); }
function sceneFlow() {
  const key = sceneFlowKey();
  if (creativeState.flowKey !== key) {
    creativeState.flowKey = key;
    // 先看这个条目自己的本地存档，再看它自己的草稿；都没有才是空场景，绝不继承别的画面
    const saved = sceneFlowSavedFor(key);
    const views = SCENE_VIEW_DEFS.map(([id, label, hint]) => {
      const old = (saved && saved.views || []).find((v) => v.id === id) || {};
      return { id, label, hint, prompt: old.prompt || '', image: old.image || null };
    });
    creativeState.flow = {
      name: '', description: '', source: null, prefix: '', summary: '', composite: null,
      llmChannel: '', imageChannel: '', busy: '', viewBusy: {}, ...(saved || {}), views,
      // 记住这份数据属于哪个条目：跑批途中切换画面时，结果不能写进别的条目
      _key: key, _itemId: ceSceneItemId(),
    };
  }
  return creativeState.flow;
}
function sceneFlowSave() {
  const f = creativeState.flow;
  if (!f) return;
  const payload = {
    name: f.name, description: f.description, source: f.source, prefix: f.prefix, summary: f.summary,
    composite: f.composite, llmChannel: f.llmChannel, imageChannel: f.imageChannel,
    views: f.views.map((v) => ({ id: v.id, prompt: v.prompt, image: v.image })),
  };
  try { localStorage.setItem(f._key || sceneFlowKey(), JSON.stringify(payload)); } catch { /* 本地保存失败不影响使用 */ }
  // 同时写进当前「画面」条目的草稿，换机器/清缓存也能跟着条目走；条目已经换了就不写
  try {
    const owner = f._itemId || '';
    const active = ceSceneItemId();
    if (typeof state !== 'undefined' && state.image && (!owner || owner === active)) {
      state.image.sceneFlow = payload;
      if (typeof WB !== 'undefined' && WB.schedule) WB.schedule('image');
    }
  } catch { /* ignore */ }
}
function sceneFlowSavedFor(key) {
  try {
    const local = JSON.parse(localStorage.getItem(key) || 'null');
    if (local && (local.views || local.name || local.description)) return local;
  } catch { /* ignore */ }
  try {
    const draft = (typeof state !== 'undefined' && state.image && state.image.sceneFlow) || null;
    if (draft && (draft.views || draft.name || draft.description)) return draft;
  } catch { /* ignore */ }
  return null;
}
function sceneProjectStylePrefix() { return String((state.styleDetail && state.styleDetail.scene) || '').trim(); }
function sceneCaptureInputs() {
  const f = creativeState.flow;
  if (!f) return;
  const name = document.querySelector('#scn-name');
  const description = document.querySelector('#scn-description');
  const prefix = document.querySelector('#scn-prefix');
  if (name) f.name = name.value;
  if (description) f.description = description.value;
  if (prefix) f.prefix = prefix.value;
  sceneFlowSave();
}
function sceneBusyText(kind) { return kind === 'describe' ? '反推中…' : kind === 'prompts' ? '生成提示词…' : kind === 'composite' ? '合成中…' : '生成中…'; }

function sceneSourceHtml(f) {
  const src = f.source;
  const busy = f.busy === 'describe';
  const preview = src ? (src.url || '/api/file?path=' + encodeURIComponent(src.path)) : '';
  return `<div class="scn-source">
    <div class="scn-source-stage ${src ? 'is-filled' : 'is-empty'} ${busy ? 'is-busy' : ''}" data-scn-drop="1" tabindex="0" title="${src ? '点一下选中，Backspace 删除' : '点一下选中这里，Ctrl+V 粘贴图片'}">
      ${src ? `<img src="${esc(preview)}" alt="">` : '<span>拖入场景图 · 选中后 Ctrl+V 粘贴</span>'}
      ${busy ? '<div class="scn-stage-busy"><i class="scn-spin"></i>正在读图反推描述…</div>' : ''}
      <input type="file" accept="image/*" hidden data-scn-file="1">
    </div>
    <div class="scn-source-actions">
      <button type="button" class="btn sm" data-scn="library" ${f.busy ? 'disabled' : ''}>素材库</button>
      <button type="button" class="btn sm" data-scn="upload" ${f.busy ? 'disabled' : ''}>上传</button>
      <button type="button" class="btn sm" data-scn="describe" ${src && !f.busy ? '' : 'disabled'}>${busy ? sceneBusyText('describe') : '反推描述'}</button>
      ${src ? `<button type="button" class="btn sm danger" data-scn="drop-source" ${f.busy ? 'disabled' : ''}>删除</button>` : ''}
    </div>
    ${busy ? '<div class="scn-busy"><i class="scn-spin"></i>正在用推理模型读图，结果会填进上面的「场景描述」</div>' : ''}
  </div>`;
}

function sceneWaitElapsedText(startedAt) {
  const seconds = Math.max(0, Math.round((Date.now() - (Number(startedAt) || Date.now())) / 1000));
  return seconds >= 60 ? `已等 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `已等 ${seconds} 秒`;
}

/** 出图中：图片区中间转圈 + 已等时长 + 进度条（整批生成时按第几张走） */
function sceneWaitHtml(view, f, startedAt) {
  const all = f.busy === 'all';
  const withPrompt = f.views.filter((x) => String(x.prompt || '').trim());
  const index = withPrompt.findIndex((x) => x.id === view.id) + 1;
  const done = withPrompt.filter((x) => x.image).length;
  const bar = all && withPrompt.length
    ? `<div class="scn-wait-bar is-live"><i style="width:${Math.max(6, Math.round((done / withPrompt.length) * 100))}%"></i></div>`
    : '<div class="scn-wait-bar is-indeterminate"><i></i></div>';
  const title = all && index > 0 ? `第 ${index}/${withPrompt.length} 张 · 生成中` : '正在生成';
  return `<div class="scn-wait" data-scn-wait="${esc(view.id)}">
    <span class="scn-ring" aria-hidden="true"></span>
    <b>${esc(title)}</b>
    <em data-scn-wait-elapsed="${Number(startedAt) || Date.now()}">${esc(sceneWaitElapsedText(startedAt))}</em>
    ${bar}
  </div>`;
}

let sceneWaitTimer = 0;
function sceneWaitTick() {
  const nodes = document.querySelectorAll('[data-scn-wait-elapsed]');
  const elapsed = document.querySelectorAll('[data-scn-elapsed]');
  if (!nodes.length && !elapsed.length) { if (sceneWaitTimer) { clearInterval(sceneWaitTimer); sceneWaitTimer = 0; } return; }
  for (const node of nodes) {
    const text = sceneWaitElapsedText(node.dataset.scnWaitElapsed);
    if (node.textContent !== text) node.textContent = text;
  }
  // 「反推提示词」跑在智能体里要几分钟，给个已等时长，用户不会以为卡死
  for (const node of elapsed) {
    const text = sceneWaitElapsedText(node.dataset.scnElapsed).replace('已等 ', '');
    if (node.textContent !== text) node.textContent = text;
  }
}
function sceneStartWaitTicker() {
  if (!document.querySelector('[data-scn-wait-elapsed]') && !document.querySelector('[data-scn-elapsed]')) {
    if (sceneWaitTimer) { clearInterval(sceneWaitTimer); sceneWaitTimer = 0; }
    return;
  }
  if (!sceneWaitTimer) sceneWaitTimer = setInterval(sceneWaitTick, 1000);
  sceneWaitTick();
}

function sceneViewCard(v) {
  const f = sceneFlow();
  const startedAt = typeof f.viewBusy[v.id] === 'number' ? f.viewBusy[v.id] : 0;
  const active = !!startedAt;
  const queued = !active && f.busy === 'all' && !v.image;
  const busy = active || f.busy === 'all';
  const buttonText = active ? '生成中…' : queued ? '排队中…' : v.image ? '重画' : '生成';
  const placeholder = !v.image
    ? (queued
      ? `<span class="scn-shot-empty">排队中 · 等前面一张出完</span>`
      : `<span class="scn-shot-empty">${v.prompt ? '等待生成' : '先出提示词'}</span>`)
    : '';
  return `<article class="scn-card ${v.image ? 'has-image' : ''}">
    <header class="scn-card-head">
      <b>${esc(v.label)}</b><span>${esc(v.hint)}</span>
      <button type="button" class="btn sm" data-scn-gen="${esc(v.id)}" ${v.prompt && !busy ? '' : 'disabled'}>${buttonText}</button>
    </header>
    <textarea class="scn-prompt" data-scn-prompt="${esc(v.id)}" placeholder="四条机位提示词生成后会自动填进这里，也可以自己改写">${esc(v.prompt)}</textarea>
    <div class="scn-shot">${v.image ? `<img src="${esc(v.image.url)}" alt="">` : ''}${placeholder}${active ? sceneWaitHtml(v, f, startedAt) : ''}</div>
  </article>`;
}

function sceneWorkspaceHtml() {
  const f = sceneFlow();
  const llm = ((state.channels || {}).llm || []).filter((c) => c.enabled !== false);
  const imgs = ((state.channels || {}).image || []).filter((c) => c.enabled !== false);
  const llmId = f.llmChannel || (llm.find((c) => c.active) || llm[0] || {}).id || '';
  const imgId = f.imageChannel || state.image.channelId || (imgs.find((c) => c.active) || imgs[0] || {}).id || '';
  const ready = f.views.every((v) => v.image);
  const prefix = f.prefix || sceneProjectStylePrefix();
  return `<div class="ce-scene scn">
    <div class="scn-topbar">
      <label class="scn-topbar-field">推理模型<select class="select" id="scn-llm">${llm.map((c) => `<option value="${esc(c.id)}" ${c.id === llmId ? 'selected' : ''}>${esc(c.model || c.name)}</option>`).join('') || '<option value="">没有可用的推理模型</option>'}</select></label>
      <label class="scn-topbar-field">生图模型<select class="select" id="scn-image">${imgs.map((c) => `<option value="${esc(c.id)}" ${c.id === imgId ? 'selected' : ''}>${esc(c.model || c.name)}</option>`).join('') || '<option value="">没有可用的生图模型</option>'}</select></label>
      <label class="scn-topbar-field scn-topbar-prefix">场景前置提示词<input class="input" id="scn-prefix" value="${esc(prefix)}" placeholder="同一场景共用；默认取项目风格的场景层" title="${esc(prefix)}"></label>
    </div>
    <aside class="ce-side scn-side">
      <label>名称<input class="input" id="scn-name" value="${esc(f.name)}" placeholder="例如：青竹书房"></label>
      <label class="scn-desc">场景描述<textarea id="scn-description" class="textarea scn-textarea" rows="8" placeholder="空间用途、门窗、家具与摆放、材质色彩、光线；没有图就直接写，有图可以先反推">${esc(f.description)}</textarea></label>
      <div class="scn-label">源图（可选）</div>
      ${sceneSourceHtml(f)}
      <div class="scn-actions">
        <button type="button" class="btn primary" data-scn="prompts" ${f.busy ? 'disabled' : ''}>${f.busy === 'prompts' ? sceneBusyText('prompts') : '生成四视图提示词'}</button>
        <button type="button" class="btn" data-scn="reset" ${f.busy ? 'disabled' : ''}>清空</button>
      </div>
      ${f.busy === 'prompts' ? `<div class="scn-busy"><i class="scn-spin"></i>智能体正在按「场景4视图反推」技能推理（读技能 → 建坐标 → 算机位 → 写提示词，约 3–5 分钟）：已等 <span data-scn-elapsed="${Number(f.promptsStartedAt) || Date.now()}">0 秒</span></div>` : ''}
      <p class="hint">有图：先反推成场景描述，再推理四条机位提示词；没图：直接按描述推理。四条提示词同一空间，只换机位。</p>
    </aside>
    <section class="ce-main scn-main">
      <div class="scn-board">
        <header class="scn-board-head">
          <div><b>四视图</b><span>${esc(f.summary || '提示词可以手改，改完再出图')}</span></div>
          <div class="scn-board-actions">
            <button type="button" class="btn" data-scn="gen-all" ${f.views.every((v) => v.prompt) && !f.busy ? '' : 'disabled'}>${f.busy === 'all' ? '生成中…' : '生成四张'}</button>
          </div>
        </header>
        <div class="scn-grid">${f.views.map(sceneViewCard).join('')}</div>
        <footer class="scn-strip">
          <span class="scn-strip-label">16:9 四宫格</span>
          <button type="button" class="btn sm" data-scn="composite" ${ready && f.busy !== 'composite' ? '' : 'disabled'}>${f.busy === 'composite' ? sceneBusyText('composite') : f.composite ? '重新合成' : '合成四宫格'}</button>
          <button type="button" class="btn sm" data-scn="save-composite" ${f.composite ? '' : 'disabled'}>存素材库</button>
          <span class="scn-strip-spacer"></span>
          ${f.composite ? `<a class="scn-strip-thumb" href="${esc(f.composite.url || '/api/file?path=' + encodeURIComponent(f.composite.path))}" target="_blank" rel="noopener"><img src="${esc(f.composite.url || '/api/file?path=' + encodeURIComponent(f.composite.path))}" alt="四宫格"></a>` : ''}
        </footer>
      </div>
    </section>
  </div>`;
}

function sceneLoadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Error('图片加载失败'));
    img.src = url;
  });
}

async function sceneCompositeDataUrl() {
  const f = sceneFlow();
  if (!f.views.every((v) => v.image)) throw Error('四张机位图齐了才能合成');
  const W = 1920, H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#0f1418';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {
    const view = f.views[i];
    const img = await sceneLoadImage(view.image.url || '/api/file?path=' + encodeURIComponent(view.image.path));
    const cw = W / 2, ch = H / 2, x = (i % 2) * cw, y = Math.floor(i / 2) * ch;
    const scale = Math.max(cw / img.width, ch / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    g.drawImage(img, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
  }
  return canvas.toDataURL('image/png');
}

async function sceneStoreSource(file) {
  const f = sceneFlow();
  const dataUrl = await fileToDataUrl(file);
  const saved = await imageSaveDataUrl(dataUrl);
  f.source = { path: saved.path, name: saved.name || file.name || '场景图', url: saved.url };
  sceneFlowSave();
  render();
  toast('已加入场景源图');
}

function bindSceneWorkspace(root) {
  const f = sceneFlow();
  const projectKey = ceProject();
  const reRender = () => { sceneCaptureInputs(); render(); };

  const name = root.querySelector('#scn-name');
  if (name) name.oninput = () => { f.name = name.value; sceneFlowSave(); };
  const description = root.querySelector('#scn-description');
  if (description) description.oninput = () => { f.description = description.value; sceneFlowSave(); };
  const prefix = root.querySelector('#scn-prefix');
  if (prefix) prefix.oninput = () => { f.prefix = prefix.value; sceneFlowSave(); };
  const llm = root.querySelector('#scn-llm');
  if (llm) llm.onchange = () => { f.llmChannel = llm.value; sceneFlowSave(); };
  const imageCh = root.querySelector('#scn-image');
  if (imageCh) imageCh.onchange = () => { f.imageChannel = imageCh.value; if (state.image) state.image.channelId = imageCh.value; sceneFlowSave(); };

  root.querySelectorAll('[data-scn-prompt]').forEach((el) => {
    el.oninput = () => {
      const view = f.views.find((v) => v.id === el.dataset.scnPrompt);
      if (view) { view.prompt = el.value; sceneFlowSave(); }
    };
  });

  const stage = root.querySelector('[data-scn-drop]');
  const fileInput = root.querySelector('[data-scn-file]');
  if (stage) {
    stage.onclick = () => stage.focus();
    stage.addEventListener('paste', (event) => {
      const file = [...((event.clipboardData && event.clipboardData.files) || [])].find((x) => String(x.type || '').startsWith('image/'));
      if (!file) return;
      event.preventDefault(); event.stopPropagation();
      sceneStoreSource(file).catch((err) => toast(err.message, true));
    });
    const field = stage.closest('.scn-source') || stage;
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (!f.source) return;
      event.preventDefault(); event.stopPropagation();
      f.source = null; sceneFlowSave();
      const again = stage.isConnected; render();
      if (again) setTimeout(() => document.querySelector('[data-scn-drop]')?.focus(), 0);
    });
    stage.ondragover = (event) => {
      if (![...((event.dataTransfer && event.dataTransfer.types) || [])].includes('Files')) return;
      event.preventDefault(); stage.classList.add('is-drop');
    };
    stage.ondragleave = () => stage.classList.remove('is-drop');
    stage.ondrop = (event) => {
      const file = [...((event.dataTransfer && event.dataTransfer.files) || [])].find((x) => String(x.type || '').startsWith('image/'));
      if (!file) return;
      event.preventDefault(); stage.classList.remove('is-drop');
      sceneStoreSource(file).catch((err) => toast(err.message, true));
    };
  }
  if (fileInput) fileInput.onchange = () => {
    const file = (fileInput.files || [])[0];
    fileInput.value = '';
    if (file) sceneStoreSource(file).catch((err) => toast(err.message, true));
  };

  const llmId = () => f.llmChannel || root.querySelector('#scn-llm')?.value || '';
  const imageId = () => f.imageChannel || root.querySelector('#scn-image')?.value || '';

  async function describe() {
    if (!f.source) return toast('先选一张场景图', true);
    f.busy = 'describe'; render();
    try {
      const data = await ceCall('scene/describe', { path: f.source.path, channelId: llmId() });
      if (projectKey !== ceProject()) return;
      f.description = data.description;
      sceneFlowSave();
      toast('已反推成场景描述');
    } catch (err) { toast(err.message, true); }
    finally { f.busy = ''; render(); }
  }

  // 把一套推理结果写进当前画面：四条提示词 + 摘要 + 合集
  function sceneApplyPrompts(data) {
    if (!data || !Array.isArray(data.views)) return false;
    let filled = 0;
    f.summary = data.summary || '';
    for (const view of data.views) {
      const target = f.views.find((v) => v.id === view.id);
      if (target && view.prompt) { target.prompt = view.prompt; filled += 1; }
    }
    if (data.composite && !f.composite) f.compositeNote = data.composite;
    sceneFlowSave();
    return filled > 0;
  }

  async function makePrompts() {
    sceneCaptureInputs();
    if (!String(f.description || '').trim()) return toast('先写场景描述，或用源图反推', true);
    const itemId = ceSceneItemId();
    f.promptsStartedAt = Date.now();
    f.busy = 'prompts'; render();
    try {
      const data = await ceCall('scene/view-prompts', {
        name: f.name, description: f.description, channelId: llmId(), itemId, sourcePath: f.source ? f.source.path : '',
      });
      if (projectKey !== ceProject()) return;
      if (!sceneApplyPrompts(data)) throw new Error('智能体没有返回可用的四条机位提示词');
      toast('四条机位提示词已生成');
    } catch (err) {
      // 推理要好几分钟，连接断了（服务重启、超时）时把这条画面上一次的存底取回来，不让白等
      let rescued = false;
      try {
        const last = await api('/api/creative/scene/view-prompts/last?projectId=' + encodeURIComponent(ceProject()) + '&itemId=' + encodeURIComponent(itemId || ''));
        if (projectKey === ceProject() && sceneApplyPrompts(last)) {
          rescued = true;
          toast('已取回上次的推理结果（刚才的连接中断了，结果没丢）');
        }
      } catch { /* 没有存底就照原样报错 */ }
      if (!rescued) toast(err.message, true);
    }
    finally { f.busy = ''; f.promptsStartedAt = 0; render(); }
  }

  // 出图参考：源图只借材质；非正视时把已经出好的正视图当参考，但机位必须按本图换——
  // 否则四张会被参考图带着画成一模一样的构图。
  function sceneViewReferences(view) {
    const sourceRef = f.source && f.source.path
      ? { path: f.source.path, name: f.source.name || '场景源图', role: '场景源图：只借材质、家具造型与配色；机位必须按本图机位重画，不许照抄这张图的视角与构图' }
      : null;
    if (view.id === 'front') return sourceRef ? [sourceRef] : [];
    // 非正视优先挂已经出好的正视图：源图那张的角度会把这四张都带成同一个构图，所以只留正视图
    const front = f.views.find((v) => v.id === 'front' && v.image && v.image.path);
    if (front) {
      return [{ path: front.image.path, name: '同一空间正视图', role: '同一房间的正视图：只借家具造型、材质与配色；本图必须换成本图机位，不许复制这张图的构图、遮挡与视角' }];
    }
    return sourceRef ? [sourceRef] : [];
  }

  async function generateOne(view) {
    if (!view.prompt.trim()) return toast('这条机位还没有提示词', true);
    sceneCaptureInputs();
    f.viewBusy[view.id] = Date.now(); render();
    try {
      const data = await ceCall('scene/view-image', {
        view: view.id, prompt: view.prompt, prefix: f.prefix || sceneProjectStylePrefix(),
        channelId: imageId(), sourcePath: f.source ? f.source.path : '',
        references: sceneViewReferences(view),
      });
      if (projectKey !== ceProject()) return;
      if (data.items && data.items[0]) view.image = data.items[0];
      sceneFlowSave();
    } catch (err) { toast(err.message, true); }
    finally { delete f.viewBusy[view.id]; render(); }
  }

  async function generateAll() {
    sceneCaptureInputs();
    f.busy = 'all'; render();
    try {
      for (const view of f.views) {
        if (!view.prompt.trim()) continue;
        f.viewBusy[view.id] = Date.now(); render();
        try {
          const data = await ceCall('scene/view-image', {
            view: view.id, prompt: view.prompt, prefix: f.prefix || sceneProjectStylePrefix(),
            channelId: imageId(), sourcePath: f.source ? f.source.path : '',
            references: sceneViewReferences(view),
          });
          if (projectKey !== ceProject()) return;
          if (data.items && data.items[0]) view.image = data.items[0];
          sceneFlowSave();
        } catch (err) { toast(view.label + '：' + err.message, true); }
        finally { delete f.viewBusy[view.id]; render(); }
      }
      toast('四张机位图已生成');
    } finally { f.busy = ''; render(); }
  }

  async function composite() {
    f.busy = 'composite'; render();
    try {
      const dataUrl = await sceneCompositeDataUrl();
      const saved = await imageSaveDataUrl(dataUrl);
      if (projectKey !== ceProject()) return;
      f.composite = { path: saved.path, name: saved.name, url: saved.url };
      sceneFlowSave();
      toast('已合成 16:9 四宫格');
    } catch (err) { toast(err.message, true); }
    finally { f.busy = ''; render(); }
  }

  root.addEventListener('click', async (event) => {
    const genButton = event.target.closest('[data-scn-gen]');
    if (genButton) {
      const view = f.views.find((v) => v.id === genButton.dataset.scnGen);
      if (view) generateOne(view).catch((err) => toast(err.message, true));
      return;
    }
    const button = event.target.closest('[data-scn]');
    if (!button) return;
    const action = button.dataset.scn;
    sceneCaptureInputs();
    try {
      if (action === 'upload') return fileInput && fileInput.click();
      if (action === 'drop-source') { f.source = null; sceneFlowSave(); return render(); }
      if (action === 'library') {
        return openLibraryPicker({
          title: '选择场景图',
          onPick: (item) => {
            f.source = { path: item.path, name: item.name, url: item.url };
            sceneFlowSave(); closeModal(); render();
            toast('已选择场景图：' + item.name);
          },
        });
      }
      if (action === 'describe') return describe();
      if (action === 'prompts') return makePrompts();
      if (action === 'gen-all') return generateAll();
      if (action === 'composite') return composite();
      if (action === 'save-composite') {
        if (!f.composite) return;
        await api('/api/assets/from-file', { method: 'POST', body: { path: f.composite.path } });
        state.assets = await api('/api/assets').catch(() => state.assets);
        return toast('四宫格已存进素材库');
      }
      if (action === 'reset') {
        creativeState.flow = null;
        creativeState.flowKey = '';
        try { localStorage.removeItem(sceneFlowKey()); } catch { /* ignore */ }
        return render();
      }
    } catch (err) { toast(err.message, true); }
  });

  // 出图期间让「已等 xx 秒」自己走：只改文字，不重画整页，画面不闪
  sceneStartWaitTicker();
}




