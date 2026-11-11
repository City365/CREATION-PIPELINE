'use strict';

/* app.studio.js — 视频创作台
 * 由 web/app.js 按原段注释切分而来（第 850–2481 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */

/* ------------------------------------------------------------------ studio */

/* ---- 视频创作台：按原版 DOM 结构（wmd-panel / wmd-slots / wmd-compose）重建 ---- */

const ICON = {
  frame: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18"></rect><path d="M7 3v18M17 3v18M3 7h4M3 17h4M17 7h4M17 17h4"></path></svg>',
  swap: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"></path><path d="M3 6h18"></path><path d="M7 22l-4-4 4-4"></path><path d="M21 18H3"></path></svg>',
  x: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>',
  copy: '<svg class="wmd-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
  trash: '<svg class="wmd-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"></path></svg>',
  wand: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 12-12M14 4l1.5 3L19 8.5 15.5 10 14 13l-1.5-3L9 8.5 12.5 7z"></path></svg>',
  caret: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>',
  audio: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l10-2v12"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle></svg>',
  play: '<svg class="wmd-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 3 14 9-14 9z"></path></svg>',
  skipBack: '<svg class="wmd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 20 9 12l10-8zM5 19V5"></path></svg>',
  skipFwd: '<svg class="wmd-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 4 10 8-10 8zM19 5v14"></path></svg>',
};

function refSlotHtml(image, index, nextEmpty) {
  const num = index + 1;
  const isNext = !image && index === nextEmpty;
  const cls = 'wmd-slot' + (image ? ' has-media' : isNext ? ' is-next' : '');
  const style = `--i:${index}`;
  if (!image) {
    return `<div class="${cls}" data-act="add-image" data-index="${index}" style="${style}" title="点击从素材库选择图像，或把图片拖到这里">
      <span class="wmd-slot-num is-empty">图${num}</span>
    </div>`;
  }
  return `<div class="${cls}" data-index="${index}" style="${style}" draggable="true" ${image.subject ? `data-subject="${num}"` : ''} title="${esc(image.name)}">
    <img class="wmd-slot-img" src="/api/file?path=${enc(image.path)}" alt="" />
    <span class="wmd-slot-num">图${num}</span>
    ${image.subject ? `<span class="wmd-slot-subject" title="&lt;Subject ${num}&gt;">S${num} ${esc(image.subject)}</span>` : ''}
    <div class="wmd-slot-actions">
      <button type="button" class="wmd-slot-act" data-act="name-subject" data-index="${index}" title="命名主体（供提示词 &lt;Subject n&gt; 引用）">${ICON.frame}</button>
      <button type="button" class="wmd-slot-act" data-act="add-image" data-index="${index}" title="更换图像">${ICON.swap}</button>
      <button type="button" class="wmd-slot-act is-danger" data-act="remove-image" data-index="${index}" title="移除">${ICON.x}</button>
    </div>
  </div>`;
}

function audioSlotHtml(audio, index) {
  const num = index + 1;
  if (!audio) {
    return `<div class="wmd-audio" data-index="${index}" title="选择内置音色或本地音频，也可把音频文件拖到这里">
      <span class="wmd-audio-num tnum">音频${num}</span>
      <button type="button" class="wmd-audio-pick" data-act="voice-pick" data-index="${index}" title="用内置音色朗读台词，生成一段音频">内置音色</button>
      <button type="button" class="wmd-audio-pick" data-act="add-audio" data-index="${index}" title="选一个本地音频文件">本地音频</button>
    </div>`;
  }
  return `<div class="wmd-audio has-media" data-index="${index}" title="${esc(audio.path)}">
    <span class="wmd-audio-num tnum">音频${num}</span>
    <span class="wmd-audio-ico">${ICON.audio}</span>
    <span class="wmd-audio-name">${esc(audio.name)}</span>
    <span class="wmd-audio-tag">${audio.voiceId ? '音色库 · ' + esc(audio.voice || '') : audio.voice ? '内置音色' : '本地音频'}${audio.seconds ? ' · ' + audio.seconds + 's' : ''}</span>
    <div class="wmd-slot-actions" style="opacity:1">
      <button type="button" class="wmd-slot-act" data-act="preview-audio" data-index="${index}" title="试听">${ICON.play}</button>
      <button type="button" class="wmd-slot-act" data-act="voice-pick" data-index="${index}" title="换内置音色">${ICON.frame}</button>
      <button type="button" class="wmd-slot-act is-danger" data-act="remove-audio" data-index="${index}" title="移除">${ICON.x}</button>
    </div>
  </div>`;
}

async function openVoiceDialog(index) {
  const s = state.studio;
  const existing = s.audios[index];
  const dialogues = [...String(s.prompt || '').matchAll(/<d>([\s\S]*?)<\/d>/g)]
    .map((m) => m[1].replace(/^\s*\[[^\]]*\]\s*/, '').trim())
    .filter(Boolean);

  let library = null;
  let libraryError = '';
  try {
    library = await api('/api/voice-library');
    state.voiceLibrary = library;
  } catch (err) {
    libraryError = err.message;
  }
  state.voiceLines = dialogues;

  const tabs = [
    ['library', '音色库' + (library && library.total ? ` ${library.total}` : '')],
    ['sapi', '系统音色'],
  ];
  state.voiceTab = state.voiceTab || 'library';

  const dialog = () => {
    const tab = state.voiceTab;
    return `
    <div class="modal-head">
      <h2>内置音色 · 音频 ${index + 1}</h2>
      <span class="grow"></span>
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button>
    </div>
    <div class="modal-body">
      <div class="wmd-page-tabs" style="height:32px;margin:-6px 0 4px;border:0;padding:0">
        ${tabs.map(([id, label]) => `<button type="button" class="wmd-page-tab ${tab === id ? 'is-on' : ''}" data-voice-tab="${id}">${label}</button>`).join('')}
      </div>
      ${tab === 'library' ? libraryPane(library, libraryError, existing) : sapiPane(dialogues, existing)}
    </div>
  `;
  };

  openModal(dialog());
  bindVoiceDialog(index, dialog);
}

function libraryPane(library, error, existing) {
  if (error) {
    return `<p class="hint">读取音色库失败：${esc(error)}</p>`;
  }
  if (!library || !library.total) {
    return `<p class="hint">还没有配置音色库目录。到「设置 → 存储目录」里填上「克隆参考音色库」的路径（盘里的 800+ 音色目录），保存后回到这里就能搜索、试听、放进音频槽。</p>`;
  }
  return `
    <div class="row" style="gap:8px">
      <input class="input" id="vl-search" placeholder="搜索音色名 / 台词关键词，例如 云小馨、东北、老妇、新闻" style="flex:1" />
      <select class="select" id="vl-group" style="width:200px">
        <option value="">全部分组（${library.total}）</option>
        ${library.groups.map((g) => `<option value="${esc(g.name)}">${esc(g.name)}（${g.count}）</option>`).join('')}
      </select>
      <button type="button" class="wmd-btn wmd-btn-sm" id="vl-refresh" title="重新扫描音色目录">重新扫描</button>
    </div>
    <div class="hint">音色库根目录：<span class="mono">${esc(library.root)}</span> · 选中后会把样本复制进 <span class="mono">data/uploads/voice/</span>，再进音频槽</div>
    <div class="vl-list" id="vl-list"></div>
    <div class="row"><span class="hint" id="vl-count"></span><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm" id="vl-more">加载更多</button></div>
  `;
}

function sapiPane(dialogues, existing) {
  return `
    <p class="hint">用系统自带的语音包离线合成 WAV（Windows System.Speech），生成后直接放进这个音频槽，再在提示词里用 &lt;Audio 1&gt; 引用。</p>
    ${dialogues.length ? `<div class="row wrap"><span class="hint">从提示词里取到的台词：</span>${dialogues.slice(0, 6).map((line, i) => `<button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-line="${i}" title="填进下面的文本框">${esc(line.slice(0, 18))}${line.length > 18 ? '…' : ''}</button>`).join('')}</div>` : ''}
    <div class="field"><label>朗读文字</label>
      <textarea class="textarea" id="voice-text" style="min-height:100px" placeholder="例如：师姐，我们快到了。">${esc(dialogues[0] || '')}</textarea>
    </div>
    <div class="row">
      <div class="field grow" style="min-width:220px"><label>音色</label>
        <select class="select" id="voice-name"><option value="">加载中…</option></select>
      </div>
      <div class="field" style="width:120px"><label>语速</label>
        <select class="select" id="voice-rate">
          <option value="-4">很慢</option>
          <option value="-2">慢</option>
          <option value="0" selected>正常</option>
          <option value="2">快</option>
          <option value="4">很快</option>
        </select>
      </div>
    </div>
    <div class="hint" id="voice-state"></div>
    <div class="modal-foot" style="padding:8px 0 0;border:0">
      <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-primary" id="voice-go">生成并放入音频槽</button>
    </div>
  `;
}

function voiceItemHtml(item) {
  const line = item.transcript || item.note || '';
  return `<div class="vl-row" data-voice="${item.id}">
    <button type="button" class="vl-play" data-act="vl-play" data-id="${item.id}" title="试听样本">${ICON.play}</button>
    <div class="vl-main">
      <div class="vl-name">${esc(item.speaker)}<span class="vl-group">${esc(item.group)}</span></div>
      ${line ? `<div class="vl-note" title="${esc(line)}">${esc(line)}</div>` : ''}
    </div>
    <span class="vl-time tnum">${item.seconds ? item.seconds + 's' : ''}</span>
    <button type="button" class="wmd-btn wmd-btn-sm" data-act="vl-use" data-id="${item.id}">使用</button>
  </div>`;
}

function bindVoiceDialog(index, dialog) {
  const panel = $('#modal-panel');
  const s = state.studio;

  panel.querySelectorAll('[data-voice-tab]').forEach((btn) => {
    btn.onclick = () => {
      state.voiceTab = btn.dataset.voiceTab;
      openModal(dialog());
      bindVoiceDialog(index, dialog);
    };
  });

  const listEl = $('#vl-list');
  if (listEl) {
    const lib = state.voiceLibrary || { items: [] };
    const search = $('#vl-search');
    const groupSel = $('#vl-group');
    const more = $('#vl-more');
    const countEl = $('#vl-count');
    let shown = 0;
    const PAGE = 60;

    const filtered = () => {
      const q = (search && search.value || '').trim().toLowerCase();
      const group = groupSel ? groupSel.value : '';
      return (lib.items || []).filter((item) => {
        if (group && item.group !== group) return false;
        if (!q) return true;
        return (item.speaker + ' ' + item.note + ' ' + item.transcript + ' ' + item.group).toLowerCase().includes(q);
      });
    };

    const renderPage = (reset) => {
      const rows = filtered();
      if (reset) { listEl.innerHTML = ''; shown = 0; }
      const slice = rows.slice(shown, shown + PAGE);
      listEl.insertAdjacentHTML('beforeend', slice.map(voiceItemHtml).join(''));
      shown += slice.length;
      if (countEl) countEl.textContent = rows.length ? `已显示 ${shown}/${rows.length}` : '没有匹配的音色';
      if (more) more.disabled = shown >= rows.length;
      listEl.querySelectorAll('[data-act="vl-play"]').forEach((btn) => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.onclick = () => previewVoiceLibrary(btn.dataset.id, btn);
      });
      listEl.querySelectorAll('[data-act="vl-use"]').forEach((btn) => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            const item = await api('/api/voice-library/pick', { method: 'POST', body: { id: btn.dataset.id } });
            s.audios[index] = item;
            closeModal();
            render();
            toast(`已使用音色：${item.voice || item.name}`);
          } catch (err) {
            toast(err.message, true);
            btn.disabled = false;
          }
        };
      });
    };

    if (search) search.oninput = () => renderPage(true);
    if (groupSel) groupSel.onchange = () => renderPage(true);
    if (more) more.onclick = () => renderPage(false);
    renderPage(true);

    const refresh = $('#vl-refresh');
    if (refresh) {
      refresh.onclick = async () => {
        refresh.disabled = true;
        try {
          state.voiceLibrary = await api('/api/voice-library?refresh=1');
          openModal(dialog());
          bindVoiceDialog(index, dialog);
          toast(`已重新扫描：${state.voiceLibrary.total} 个音色`);
        } catch (err) {
          toast(err.message, true);
          refresh.disabled = false;
        }
      };
    }
  }

  // 系统音色页
  const go = $('#voice-go');
  if (go) {
    api('/api/voices').then((data) => {
      const voices = data.voices || [];
      const sel = $('#voice-name');
      if (!sel) return;
      sel.innerHTML = voices.length
        ? voices.map((v) => `<option value="${esc(v.id)}">${esc(v.label)}</option>`).join('')
        : '<option value="">没有可用语音包</option>';
      if (!voices.length) go.disabled = true;
    }).catch((err) => toast(err.message, true));
    go.onclick = async () => {
      const text = ($('#voice-text').value || '').trim();
      if (!text) return toast('先写要读的文字', true);
      go.disabled = true;
      const stateEl = $('#voice-state');
      if (stateEl) stateEl.textContent = '正在合成…';
      try {
        const item = await api('/api/tts', {
          method: 'POST',
          body: { text, voice: $('#voice-name').value, rate: Number($('#voice-rate').value) || 0 },
        });
        s.audios[index] = item;
        closeModal();
        render();
        toast(`已生成 ${item.seconds || '?'} 秒音频`);
      } catch (err) {
        if (stateEl) stateEl.textContent = '';
        toast(err.message, true);
        go.disabled = false;
      }
    };
  }

  $$('#modal-panel [data-line]').forEach((btn) => {
    btn.onclick = () => { $('#voice-text').value = (state.voiceLines || [])[Number(btn.dataset.line)] || ''; };
  });
}

let voicePreviewEl = null;
function previewVoiceLibrary(id, btn) {
  try {
    if (voicePreviewEl) { voicePreviewEl.pause(); voicePreviewEl = null; }
    if (btn && btn.classList.contains('is-playing')) { btn.classList.remove('is-playing'); return; }
    document.querySelectorAll('.vl-play.is-playing').forEach((b) => b.classList.remove('is-playing'));
    const el = new Audio('/api/voice-library/audio?id=' + encodeURIComponent(id));
    const v = state.volume || { level: 60, muted: false };
    el.volume = Math.max(0, Math.min(100, Number(v.level) || 0)) / 100;
    el.muted = !!v.muted;
    el.onended = () => { if (btn) btn.classList.remove('is-playing'); };
    el.play().then(() => { if (btn) btn.classList.add('is-playing'); }).catch((err) => toast(err.message, true));
    voicePreviewEl = el;
  } catch (err) {
    toast(err.message, true);
  }
}

function previewAudio(audio) {
  if (!audio) return;
  const el = new Audio('/api/file?path=' + encodeURIComponent(audio.path));
  const v = state.volume || { level: 60, muted: false };
  el.volume = Math.max(0, Math.min(100, Number(v.level) || 0)) / 100;
  el.muted = !!v.muted;
  el.play().catch((err) => toast(err.message, true));
}

const SECTION_WORDS = ['主体定义', '摘要', '保留分析', '详细描述', '环境音', '非剧情配乐', '参考生成', '镜头设计', '主体描述'];

function promptPreviewHtml(text) {
  const s = state.studio;
  const source = String(text || '');
  if (!source.trim()) {
    return `<span class="wmd-prompt-placeholder">还没有提示词。点「插入骨架」按当前主体生成 6 段式骨架，或直接切到「代码」开始写。</span>`;
  }
  let html = '';
  let cursor = 0;
  const re = /<Picture\s+(\d+)>|<Subject\s+(\d+)>|<Audio\s+(\d+)>|<d>([\s\S]*?)<\/d>|\[Shot\s+(\d+)\]/gi;
  let m;
  const pushText = (raw) => {
    const value = esc(raw);
    const parts = value.split(/(主体定义|摘要|保留分析|详细描述|环境音|非剧情配乐|参考生成|镜头设计)/g);
    parts.forEach((part, i) => {
      if (i % 2 === 1) html += `<span class="wmd-chip is-section"><span>${part}</span></span>`;
      else html += part.replace(/\n/g, '<br>');
    });
  };
  while ((m = re.exec(source))) {
    pushText(source.slice(cursor, m.index));
    if (m[1]) {
      const img = s.images[Number(m[1]) - 1];
      html += `<span class="wmd-chip is-media">${img ? `<img class="wmd-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>图${m[1]}</span></span>`;
    } else if (m[2]) {
      const img = s.images[Number(m[2]) - 1];
      const label = img && img.subject ? img.subject : '主体' + m[2];
      html += `<span class="wmd-chip is-subject">${img ? `<img class="wmd-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>${esc(label)}</span></span>`;
    } else if (m[3]) {
      const aud = s.audios[Number(m[3]) - 1];
      html += `<span class="wmd-chip is-spec"><span>音频${m[3]}${aud ? ' · ' + esc(aud.name) : ''}</span></span>`;
    } else if (m[4] !== undefined) {
      html += `<span class="wmd-chip is-dialogue"><span>对白：</span><span>${esc(m[4])}</span></span>`;
    } else if (m[5]) {
      html += `<span class="wmd-chip is-spec is-clickable"><span>镜头${m[5]}</span></span>`;
    }
    cursor = m.index + m[0].length;
  }
  pushText(source.slice(cursor));
  return html;
}


function promptRichHtml(text) {
  const s = state.studio;
  const source = String(text || '');
  const langLabel = { Chinese: '中文对白', English: '英语对白', Korean: '韩语对白', Japanese: '日语对白' };
  let html = '';
  let cursor = 0;
  const re = /\(S(?<speaker>\d+)\)|<Picture\s+(?<picture>\d+)>|<Subject\s+(?<subject>\d+)>|<Audio\s+(?<audio>\d+)>|<d>\[(?<lang>[A-Za-z]+)\](?<dialogue>[\s\S]*?)<\/d>|\[Shot\s+(?<shot>\d+)\]/gi;
  let m;
  const pushText = (raw) => {
    const parts = esc(raw).split(/(主体定义|摘要|保留分析|详细描述|环境音|非剧情配乐|镜头设计|参考生成)/g);
    for (let i = 0; i < parts.length; i += 1) {
      if (i % 2 === 1) html += `<span class="wmd-chip is-section" contenteditable="false" data-token="${parts[i]}"><span>${parts[i]}</span></span>`;
      else html += parts[i].replace(/\n/g, '<br>');
    }
  };
  while ((m = re.exec(source))) {
    pushText(source.slice(cursor, m.index));
    const g = m.groups || {};
    if (g.speaker) {
      html += `<span class="wmd-chip is-spec is-clickable" contenteditable="false" data-token="(S${g.speaker})"><span>说话人${g.speaker}</span></span>`;
    } else if (g.picture) {
      const img = s.images[Number(g.picture) - 1];
      html += `<span class="wmd-chip is-media" contenteditable="false" data-token="&lt;Picture ${g.picture}&gt;">${img ? `<img class="wmd-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>图${g.picture}</span></span>`;
    } else if (g.subject) {
      const img = s.images[Number(g.subject) - 1];
      const label = img && img.subject ? img.subject : '主体' + g.subject;
      html += `<span class="wmd-chip is-subject" contenteditable="false" data-token="&lt;Subject ${g.subject}&gt;">${img ? `<img class="wmd-chip-media" src="/api/file?path=${enc(img.path)}" alt="" />` : ''}<span>${esc(label)}</span></span>`;
    } else if (g.audio) {
      const aud = s.audios[Number(g.audio) - 1];
      html += `<span class="wmd-chip is-spec" contenteditable="false" data-token="&lt;Audio ${g.audio}&gt;"><span>音频${g.audio}${aud ? ' · ' + esc(aud.name) : ''}</span></span>`;
    } else if (g.lang) {
      const lang = g.lang;
      let body = g.dialogue || '';
      let voice = '';
      if (body.startsWith('（男声画外音）')) { voice = 'male'; body = body.slice('（男声画外音）'.length); }
      else if (body.startsWith('（女声画外音）')) { voice = 'female'; body = body.slice('（女声画外音）'.length); }
      const prefix = voice === 'male' ? '男声画外音：' : voice === 'female' ? '女声画外音：' : (langLabel[lang] || lang) + '：';
      html += `<span class="wmd-chip is-dialogue" contenteditable="false" data-dialogue="1" data-dialogue-lang="${esc(lang)}"${voice ? ' data-dialogue-voice="' + voice + '"' : ''}><span contenteditable="false" class="wmd-dialogue-prefix">${prefix}</span><span contenteditable="true" data-dialogue-body="1">${esc(body)}</span></span>`;
    } else if (g.shot) {
      html += `<span class="wmd-chip is-spec is-clickable" contenteditable="false" data-token="[Shot ${g.shot}]"><span>镜头${g.shot}</span></span>`;
    }
    cursor = m.index + m[0].length;
  }
  pushText(source.slice(cursor));
  return html;
}

function richPromptText(root) {
  let out = '';
  const walk = (node) => {
    if (node.nodeType === 3) { out += node.nodeValue || ''; return; }
    if (node.nodeType !== 1) return;
    const el = node;
    if (el.dataset && el.dataset.dialogue) {
      const lang = el.dataset.dialogueLang || 'Chinese';
      const voice = el.dataset.dialogueVoice;
      const body = el.querySelector('[data-dialogue-body]');
      const text = body ? body.textContent : '';
      out += '<d>[' + lang + ']' + (voice === 'male' ? '（男声画外音）' : voice === 'female' ? '（女声画外音）' : '') + text + '</d>';
      return;
    }
    if (el.dataset && el.dataset.token) { out += el.dataset.token; return; }
    if (el.tagName === 'BR') { out += '\n'; return; }
    const block = /^(DIV|P)$/.test(el.tagName);
    if (block && out && !out.endsWith('\n')) out += '\n';
    for (const child of el.childNodes) walk(child);
    if (block && out && !out.endsWith('\n')) out += '\n';
  };
  for (const child of root.childNodes) walk(child);
  return out.replace(/\n+$/, '');
}

function studioMentionItems() {
  const s = state.studio;
  const images = (s.images || []).filter((img) => img && img.path);
  const shots = Math.max(4, images.length, 1);
  const items = [];
  images.forEach((img, i) => items.push({ group: '图像', label: '图' + (i + 1), token: '<Picture ' + (i + 1) + '>', thumb: '/api/file?path=' + encodeURIComponent(img.path) }));
  images.forEach((img, i) => items.push({ group: '主体', label: img.subject || ('主体' + (i + 1)), token: '<Subject ' + (i + 1) + '>', thumb: '/api/file?path=' + encodeURIComponent(img.path) }));
  images.forEach((img, i) => items.push({ group: '说话人', label: '说话人' + (i + 1), token: '(S' + (i + 1) + ')', thumb: '/api/file?path=' + encodeURIComponent(img.path) }));
  items.push({ group: '说话人', label: '新建说话人' + (images.length + 1), token: '(S' + (images.length + 1) + ')', icon: '👤' });
  for (const [label, lang] of [['中文对白', 'Chinese'], ['英语对白', 'English'], ['韩语对白', 'Korean'], ['日语对白', 'Japanese']]) {
    items.push({ group: '对白', label, dialogue: { lang }, icon: '💬' });
  }
  items.push({ group: '对白', label: '男性画外音', dialogue: { lang: 'Chinese', voice: 'male' }, icon: '🔊' });
  items.push({ group: '对白', label: '女性画外音', dialogue: { lang: 'Chinese', voice: 'female' }, icon: '🔊' });
  for (let i = 1; i <= shots; i += 1) items.push({ group: '镜头', label: '镜头' + i, token: '[Shot ' + i + ']', icon: '🎬' });
  items.push({ group: '镜头', label: '新建镜头' + (shots + 1), token: '[Shot ' + (shots + 1) + ']', icon: '🎬' });
  return items;
}
function bindStudioRichEditor(editor) {
  const host = $('#studio-mention-pop');
  let savedRange = null;
  let items = [];
  let index = 0;

  const close = () => { savedRange = null; items = []; if (host) { host.hidden = true; host.innerHTML = ''; } editor.removeAttribute('aria-expanded'); };
  const caretPrefix = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return null;
    const pre = range.cloneRange();
    pre.selectNodeContents(editor);
    pre.setEnd(range.startContainer, range.startOffset);
    return { text: pre.toString(), range };
  };
  const update = () => {
    const info = caretPrefix();
    if (!info) return close();
    const match = info.text.match(/@([^@\s<>]*)$/);
    if (!match) return close();
    const query = match[1].toLowerCase();
    items = studioMentionItems().filter((item) => (item.label + ' ' + item.group).toLowerCase().includes(query));
    index = Math.min(index, Math.max(0, items.length - 1));
    savedRange = info.range.cloneRange();
    if (!host) return;
    host.hidden = false;
    editor.setAttribute('aria-expanded', 'true');
    const rect = info.range.getBoundingClientRect();
    host.style.left = Math.max(8, Math.min(window.innerWidth - 300, rect.left)) + 'px';
    host.style.top = Math.min(window.innerHeight - 260, rect.bottom + 6) + 'px';
    const groups = [];
    for (const item of items) { let g = groups.find((x) => x.name === item.group); if (!g) { g = { name: item.group, items: [] }; groups.push(g); } g.items.push(item); }
    const colClass = (name) => ({ '图像': 'is-media', '主体': 'is-subject', '说话人': 'is-speaker', '对白': 'is-dialogue', '镜头': 'is-spec' })[name] || 'is-spec';
    host.innerHTML = items.length ? groups.map((g) => '<div class="wmd-mention-col ' + colClass(g.name) + '"><div class="wmd-mention-title">' + esc(g.name) + '</div>' + g.items.map((item) => '<button type="button" class="wmd-mention-item' + (items.indexOf(item) === index ? ' is-active' : '') + '" data-mi="' + items.indexOf(item) + '">' + (item.thumb ? '<img src="' + esc(item.thumb) + '" alt="" />' : '<span class="wmd-mention-ico">' + (item.icon || '·') + '</span>') + '<span class="wmd-mention-label">' + esc(item.label) + (item.desc ? '<small>' + esc(item.desc) + '</small>' : '') + '</span></button>').join('') + '</div>').join('') : '<p class="wmd-mention-empty">没有匹配素材；先在左侧添加参考图/音频。</p>';
    host.querySelectorAll('[data-mi]').forEach((btn) => {
      btn.onmousedown = (event) => event.preventDefault();
      btn.onclick = () => choose(Number(btn.dataset.mi));
    });
    host.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(host.offsetWidth || 640, 640) - 12)) + 'px';
    if (host.offsetHeight) host.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - host.offsetHeight - 12)) + 'px';
  };
  const choose = (at) => {
    const item = items[at];
    if (!item || !savedRange) return close();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    const range = savedRange;
    const textNode = range.startContainer;
    if (textNode.nodeType === 3) {
      const upto = textNode.nodeValue.slice(0, range.startOffset);
      const m = upto.match(/@([^@\s<>]*)$/);
      if (m) range.setStart(textNode, range.startOffset - m[0].length);
    }
    range.deleteContents();
    let node;
    if (item.dialogue) {
      node = document.createElement('span');
      node.className = 'wmd-chip is-dialogue';
      node.contentEditable = 'false';
      node.dataset.dialogue = '1';
      node.dataset.dialogueLang = item.dialogue.lang || 'Chinese';
      if (item.dialogue.voice) node.dataset.dialogueVoice = item.dialogue.voice;
      const prefix = document.createElement('span');
      prefix.contentEditable = 'false';
      prefix.className = 'wmd-dialogue-prefix';
      prefix.textContent = item.dialogue.voice === 'male' ? '男声画外音：' : item.dialogue.voice === 'female' ? '女声画外音：' : ({ Chinese: '中文对白', English: '英语对白', Korean: '韩语对白', Japanese: '日语对白' }[item.dialogue.lang] || item.dialogue.lang) + '：';
      const bodySpan = document.createElement('span');
      bodySpan.contentEditable = 'true';
      bodySpan.dataset.dialogueBody = '1';
      node.appendChild(prefix);
      node.appendChild(bodySpan);
      range.insertNode(node);
      const inside = document.createRange();
      inside.setStart(bodySpan, 0); inside.collapse(true);
      sel.removeAllRanges(); sel.addRange(inside);
      editor.focus();
      close();
      state.studio.prompt = richPromptText(editor);
      const count = $('#prompt-count'); if (count) count.textContent = state.studio.prompt.length + '字';
      studioPersist(); validatePromptSoon();
      return;
    }
    if (item.token) {
      node = document.createElement('span');
      node.contentEditable = 'false';
      node.dataset.token = item.token;
      if (item.token.startsWith('<Picture')) node.className = 'wmd-chip is-media';
      else if (item.token.startsWith('<Subject')) node.className = 'wmd-chip is-subject';
      else if (item.token.startsWith('(S')) node.className = 'wmd-chip is-spec is-clickable';
      else node.className = 'wmd-chip is-spec is-clickable';
      if (item.thumb) {
        const img = document.createElement('img');
        img.className = 'wmd-chip-media';
        img.src = item.thumb;
        img.alt = '';
        node.appendChild(img);
      }
      const label = document.createElement('span');
      label.textContent = item.label || item.token;
      node.appendChild(label);
    } else {
      node = document.createTextNode(item.text || '');
    }
    range.insertNode(node);
    if (item.token) {
      const space = document.createTextNode(' ');
      node.after(space);
      const after = document.createRange();
      after.setStartAfter(space); after.collapse(true);
      sel.removeAllRanges(); sel.addRange(after);
    } else if (item.caret) {
      const r2 = document.createRange();
      const pos = Math.max(0, (node.nodeValue || '').length + item.caret);
      r2.setStart(node, pos); r2.collapse(true);
      sel.removeAllRanges(); sel.addRange(r2);
    } else {
      const r2 = document.createRange(); r2.setStartAfter(node); r2.collapse(true);
      sel.removeAllRanges(); sel.addRange(r2);
    }
    editor.focus();
    close();
    state.studio.prompt = richPromptText(editor);
    const count = $('#prompt-count'); if (count) count.textContent = state.studio.prompt.length + '字';
    studioPersist();
    validatePromptSoon();
  };
  editor.addEventListener('input', () => {
    state.studio.prompt = richPromptText(editor);
    const count = $('#prompt-count'); if (count) count.textContent = state.studio.prompt.length + '字';
    studioPersist();
    update();
  });
  editor.addEventListener('click', update);
  editor.addEventListener('keyup', (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update(); });
  editor.addEventListener('keydown', (event) => {
    if (event.isComposing || !savedRange) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (items.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); index = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; update(); }
    else if (items.length && ['Enter', 'Tab'].includes(event.key)) { event.preventDefault(); choose(index); }
  });
  editor.addEventListener('blur', () => setTimeout(close, 150));
  editor.addEventListener('paste', (event) => {
    const text = event.clipboardData && event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    document.execCommand('insertText', false, text);
  });
}

function stageEmptyHtml(wf) {
  if(wf.videos) return '<div class="wmd-empty"><div class="wmd-empty-card"><h2 class="wmd-empty-title">让人物跟随参考视频动作</h2><p class="wmd-empty-desc">添加一张人物图片和一段 MP4 / WebM 动作视频，选择输出分辨率后生成。无需填写提示词或指定时长，按实际生成视频时长计费。</p><button type="button" class="wmd-btn" data-act="go-jobs">查看任务日志</button></div></div>';

  return `<div class="wmd-empty">
    <div class="wmd-empty-card">
      <h2 class="wmd-empty-title">把参考图拖到左侧开始</h2>
      <p class="wmd-empty-desc">创作台把图像与音频参考、六段式提示词提交到视频工作流，生成带对白与环境音的短视频。生成过程会在这里实时预览，完成后自动保存到你指定的文件夹。</p>
      <ol class="wmd-empty-steps">
        <li><b>1</b><span>在左侧添加 1–${wf.images} 张参考图，点图上标签为角色 / 场景命名主体。</span></li>
        <li><b>2</b><span>${wf.audios ? `可选：为 ${wf.audios} 个音频槽选本地音频，绑定到主体作为音色参考。` : '当前工作流不接收音频参考。'}</span></li>
        <li><b>3</b><span>写提示词，用 &lt;Picture 1&gt; / &lt;Subject 1&gt; / &lt;Audio 1&gt; 引用素材，&lt;d&gt;写对白&lt;/d&gt;；或先插入骨架 / 示例。</span></li>
        <li><b>4</b><span>左上角选「渠道」（管理器里的豆包 / Gemini），底部选「视频模型」，再选画幅与时长，点「生成视频」。</span></li>
      </ol>
    </div>
  </div>`;
}

// 舞台要跟着任务进度变，但不能整页重画：整页重画会让创作台一直闪，还会打断正在播的成片
function studioOwnJobs() {
  const itemId = WB.context('video').itemId;
  return (state.jobs || []).filter((j) => j.itemId === itemId);
}

/** 当前分镜出过片的那些任务，最新的在前：舞台上面那排「生成历史」用它抽卡对比。 */
function studioHistoryJobs(limit = 4) {
  return studioOwnJobs()
    .filter((j) => (j.outputs || []).some((o) => o.type === 'video'))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit);
}

function studioPickedJobId() {
  const itemId = WB.context('video').itemId;
  return (state.stagePick && state.stagePick[itemId]) || '';
}

/**
 * 舞台看的是「当前分镜最新的一条任务」：有在跑的就看正在跑的，没有才看最新的那条。
 * 以前优先用 state.lastJobId，那个值是上次会话/上次点选留下的，会把好几天前的成片
 * 钉在舞台上——明明还在生成，舞台却显示「完成 · 100%」。
 * 点过上面的历史缩略图后，空闲时优先看用户点的那一版；一有新任务在跑就回到实时任务。
 */
function studioStageJob() {
  const ownJobs = studioOwnJobs();
  if (!ownJobs.length) return null;
  const active = ownJobs
    .filter((j) => j.status === 'running' || j.status === 'queued')
    .sort((a, b) => (Number(b.status === 'running') - Number(a.status === 'running')) || ((b.createdAt || 0) - (a.createdAt || 0)))[0];
  if (active) return active;
  const picked = studioPickedJobId();
  const hit = picked ? ownJobs.find((j) => j.id === picked) : null;
  if (hit && (hit.outputs || []).some((o) => o.type === 'video')) return hit;
  return ownJobs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
}

// 结构签名：只有“任务集合或状态”变了才值得整页重画，进度百分比变化不算
let studioSignatureCache = '';
function studioStageSignature() {
  const own = studioOwnJobs();
  const stageId = (studioStageJob() || {}).id || '';
  return own.map((j) => j.id + ':' + j.status).join('|') + '#' + stageId;
}

// 出片之后舞台要把 <video> 换上去；只换 .stage-video 这一块，
// 否则用户正在文本框里打字时（我们不敢整页重画）成片永远不出现
function studioStageMediaPatch() {
  if (state.route !== 'studio') return false;
  const last = studioStageJob();
  if (!last) return false;
  const video = [...(last.outputs || [])].reverse().find((o) => o.type === 'video');
  if (!video) return false;
  const box = document.querySelector('#studio-stage .stage-video');
  if (!box || box.querySelector('video')) return false;
  box.innerHTML = `<video src="/api/file?path=${enc(video.path)}" controls playsinline></video>`;
  return true;
}

function studioLivePatch() {
  if (state.route !== 'studio') return false;
  const stage = document.getElementById('studio-stage');
  const queue = document.getElementById('studio-queue');
  if (!stage && !queue) return false;
  const last = studioStageJob();
  if (stage && last) {
    const progress = last.progress || 0;
    const bar = stage.querySelector('.stage-bar > i');
    if (bar) bar.style.width = progress + '%';
    const waiting = stage.querySelector('.stage-wait span:last-child');
    if (waiting && !stage.querySelector('.stage-video video')) waiting.textContent = (last.stage || '生成中') + ' · ' + progress + '%';
    const hint = stage.querySelector('.stage-meta .stage-line.hint span');
    if (hint) hint.textContent = (last.stage || '') + ' · ' + progress + '%';
    const badge = stage.querySelector('.stage-meta .stage-line .wmd-badge, .stage-meta .stage-line .badge');
    if (badge) badge.textContent = STATUS_LABEL[last.status] || last.status;
  }
  if (queue) {
    for (const row of queue.querySelectorAll('.stage-queue-row')) {
      const job = (state.jobs || []).find((j) => j.id === row.dataset.id);
      if (!job) continue;
      const stateCell = row.querySelector('.stage-queue-state');
      if (stateCell) stateCell.textContent = STATUS_LABEL[job.status] || job.status;
      const dot = row.querySelector('.dot');
      if (dot) dot.className = 'dot ' + (job.status === 'success' ? 'ok' : job.status === 'failed' ? 'bad' : job.status === 'running' ? 'warn' : '');
    }
    const head = queue.querySelector('.stage-queue-head .tnum');
    if (head) {
      const counts = (state.jobs || []).reduce((acc, j) => {
        if (j.status === 'queued') acc.queued += 1;
        else if (j.status === 'running') acc.running += 1;
        return acc;
      }, { queued: 0, running: 0 });
      head.textContent = counts.queued + ' 排队 · ' + counts.running + ' 生成中';
    }
  }
  return true;
}

function renderStudio() {
  const s = state.studio;
  const ownJobs = studioOwnJobs();
  const wf = currentWorkflow();
  if (!wf) return `<div class="wmd-empty"><div class="wmd-empty-card"><h2 class="wmd-empty-title">没有工作流</h2><p class="wmd-empty-desc">在 设置 → 视频生成 里添加一个管理器渠道。</p></div></div>`;
  const skillFmt = studioSkillFormat(s, wf);
  const isAuto = wf.provider === 'autodl';
  const isManager = wf.provider === 'manager';

  // 当前厂商：渠道下拉与模型下拉都只列本厂商的东西，跨厂商互不出现
  const studioVendor = vendorKeyOf(wf);
  const modelChoices = (s.channelId
    ? state.workflows.filter((w) => w.channelId === s.channelId)
    : state.workflows.filter((w) => w.provider !== 'autodl'))
    .filter((w) => vendorKeyOf(w) === studioVendor);
  const images = s.images || [];
  const audios = s.audios || [];
  const nextEmpty = images.findIndex((x) => !x);
  const mode = s.promptMode || 'tags';
  const lastJob = studioStageJob();
  const outputs = lastJob ? (lastJob.outputs || []) : [];
  const video = [...outputs].reverse().find((o) => o.type === 'video');
  const progress = lastJob ? lastJob.progress || 0 : 0;
  const keyCount = (state.config.autodlKeys || []).filter((k) => k.enabled !== false).length;
  const channel = (state.channels.video || []).find((c) => c.id === wf.channelId) || null;
  // 最近任务：最新的排前面（state.jobs 是创建顺序，直接 slice 会拿到最老的五条）
  const recent = ownJobs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);

  const allVideoChannels = (state.channels.video || []).filter((c) => c.enabled !== false);
  // 只保留「本厂商有工作流」的渠道；一个都没有时回退全量，避免下拉变空
  const vendorChannels = allVideoChannels.filter((c) =>
    state.workflows.some((w) => w.channelId === c.id && vendorKeyOf(w) === studioVendor));
  const videoChannels = vendorChannels.length ? vendorChannels : allVideoChannels;
  const autodlWorkflows = state.workflows.filter((w) => w.provider === 'autodl' && (!wf.channelId || w.channelId===wf.channelId) && vendorKeyOf(w) === studioVendor);
  const channelWorkflows = wf.channelId
    ? state.workflows.filter((w) => w.channelId === wf.channelId && vendorKeyOf(w) === studioVendor)
    : [];
  const channelOptions = videoChannels.length
    ? videoChannels.map((c) => `<option value="${esc(c.id)}" ${c.id === wf.channelId ? 'selected' : ''}>${esc(c.name)}${c.active ? ' · 默认' : ''}</option>`).join('')
    : '<option value="">没有可用的视频渠道</option>';
  const shortModel = (w) => {
    const name = String(w.label || w.id);
    const channel = videoChannels.find((c) => c.id === w.channelId);
    if (channel && name.startsWith(channel.name)) return name.slice(channel.name.length).replace(/^[\s·|/\\-—]+/, '').trim() || name;
    return name;
  };
  const modelOptions = isAuto
    ? autodlWorkflows.map((w) => `<option value="${esc(w.id)}" ${w.id === wf.id ? 'selected' : ''}>${esc(w.label)}</option>`).join('')
    : (channelWorkflows.length
      ? channelWorkflows.map((w) => `<option value="${esc(w.id)}" ${w.id === wf.id ? 'selected' : ''}>${esc(shortModel(w))}</option>`).join('')
      : `<option value="${esc(wf.id)}" selected>${esc((channel && (channel.model || channel.name)) || wf.label)}</option>`);

  // 渠道右侧的信息条（管理器地址 / AutoDL / 自定义渠道名）与上方「渠道」选择器重复，已移除。
  // 进入渠道设置仍走左侧「管理器」按钮，打开管理器工作台走顶栏「管理器」。
  const remote = '';

  const ratioOptions = (wf.ratios || []).length ? wf.ratios : ['9:16', '16:9', '1:1'];
  const currentRatio = (String(s.aspectRatio || '').match(/\d+:\d+/) || [wf.defaultRatio || '16:9'])[0];
  const aspectField = isAuto
    ? `<div class="wmd-field wmd-compose-field is-aspect">
        <div class="wmd-field-head"><span class="wmd-field-label">分辨率</span></div>
        <div class="wmd-select-wrap"><select class="wmd-select" id="p-resolution">
          ${wf.resolutions.map((r) => `<option value="${esc(r)}" ${r === (s.resolution || wf.defaultResolution) ? 'selected' : ''}>${esc(r)}</option>`).join('')}
        </select><span class="wmd-select-caret">${ICON.caret}</span></div>
      </div>`
    : `<div class="wmd-field wmd-compose-field is-aspect">
        <div class="wmd-field-head"><span class="wmd-field-label">画幅</span></div>
        <div class="wmd-select-wrap"><select class="wmd-select" id="p-aspect">
          ${ratioOptions.map((r) => `<option value="${esc(r)}" ${r === currentRatio ? 'selected' : ''}>${esc(r)}${r === '9:16' ? ' 竖屏' : r === '16:9' ? ' 横屏' : ''}</option>`).join('')}
        </select><span class="wmd-select-caret">${ICON.caret}</span></div>
      </div>`;

  // 生成历史：抽卡要能对比前几版，一排放四个，点哪个舞台就回看哪个
  const historyJobs = studioHistoryJobs(4);
  const historyStrip = historyJobs.length ? `<div class="stage-history">
        <div class="stage-history-head"><span>生成历史</span><span class="hint">点缩略图回看这一版</span></div>
        <div class="stage-history-grid">${historyJobs.map((job, index) => {
          const out = [...(job.outputs || [])].reverse().find((o) => o.type === 'video');
          const on = lastJob && job.id === lastJob.id;
          const label = index === 0 ? '最新' : '第 ' + (historyJobs.length - index) + ' 版';
          const time = new Date(job.createdAt || 0).toLocaleString('zh-CN', { hour12: false });
          return `<button type="button" class="stage-history-card${on ? ' is-on' : ''}" data-act="stage-pick" data-id="${esc(job.id)}" title="${esc(label)} · ${esc(time)} 生成 · 点一下在舞台回看">
            <video src="/api/file?path=${enc(out.path)}#t=0.5" preload="metadata" muted playsinline></video>
            <span class="stage-history-tag">${esc(label)}</span>
          </button>`;
        }).join('')}</div>
      </div>` : '';

  const stage = lastJob
    ? `<div class="stage-live">
        ${historyStrip}
        <div class="stage-video">${video
          ? `<video src="/api/file?path=${enc(video.path)}" controls playsinline></video>`
          : `<div class="stage-wait"><span class="wmd-spinner"></span><span>${esc(lastJob.stage || '生成中')} · ${progress}%</span></div>`}</div>
        <div class="stage-meta">
          <div class="stage-line"><strong>${esc(lastJob.title)}</strong><span class="grow"></span>${jobStatusBadge(lastJob)}</div>
          <div class="stage-bar"><i style="width:${progress}%"></i></div>
          <div class="stage-line hint"><span>${esc(lastJob.stage)} · ${progress}%</span><span class="grow"></span><span>${ago(lastJob.createdAt)}</span></div>
          ${lastJob.error ? `<div class="stage-line is-danger">${esc(lastJob.error)}</div>` : ''}
          <div class="stage-line">
            <button type="button" class="wmd-btn wmd-btn-sm" data-act="open-job" data-id="${esc(lastJob.id)}">查看任务</button>
            ${video ? `<button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-act="play-job" data-id="${esc(lastJob.id)}">系统播放器</button>` : ''}
            ${lastJob && lastJob.outputDir ? `<button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-act="open-job-folder" data-path="${esc(lastJob.outputDir)}">打开文件夹</button>` : ''}
          </div>
        </div>
      </div>`
    : stageEmptyHtml(wf);

  const queue = recent.length
    ? `<div class="stage-queue">
        <div class="stage-queue-head">最近任务<span class="wmd-statusbar-spacer"></span><span class="tnum">${state.stats.queued || 0} 排队 · ${state.stats.running || 0} 生成中</span></div>
        ${recent.map((job) => `<button type="button" class="stage-queue-row" data-act="open-job" data-id="${esc(job.id)}">
          <span class="dot ${job.status === 'success' ? 'ok' : job.status === 'failed' ? 'bad' : job.status === 'running' ? 'warn' : ''}"></span>
          <span class="stage-queue-title">${esc(job.title)}</span>
          <span class="stage-queue-state">${esc(STATUS_LABEL[job.status] || job.status)}</span>
        </button>`).join('')}
      </div>`
    : '';

  return `
  <div class="wmd-main studio-main">
    <aside class="wmd-panel studio-panel" style="width:${s.panelWidth ? s.panelWidth + 'px' : '67%'}">
      <div class="wmd-panel-body">
        <div class="wmd-panel-top">
          <div class="wmd-workflow">
            <span class="wmd-eyebrow">渠道</span>
            <div class="wmd-select-wrap wmd-workflow-select">
              <select class="wmd-select" id="channel-select" title="视频渠道；默认渠道在 设置 → 视频生成 里改">${channelOptions}</select>
              <span class="wmd-select-caret">${ICON.caret}</span>
            </div>
            <span class="wmd-workflow-tag ${isAuto ? 'is-autodl' : (isManager ? 'is-manager' : 'is-generic')}">${esc(wf.providerLabel || (isAuto ? 'AutoDL 官方H3' : isManager ? '管理器' : '自定义'))}</span>
          </div>
          ${remote}
        </div>

        ${wf.promptRequired === false ? '' : generationPrefixHtml('video')}

        <div class="wmd-field" ${wf.videos ? '' : 'style="display:none"'}><div class="wmd-field-head"><span class="wmd-field-label">动作参考视频（必填）</span></div><button type="button" class="wmd-btn" data-act="upload-motion-video">${esc(s.videos?.[0]?.name||'选择动作视频 MP4 / WebM')}</button>${s.videos?.length?'<button type="button" class="wmd-btn" data-act="remove-motion-video">移除视频</button>':''}<p class="hint">上传一张人物图片和一段动作视频，按实际生成时长计费。</p></div>
        <div class="wmd-slots" id="slot-strip">
          <div class="wmd-slots-head">
            <span class="wmd-eyebrow">图像参考</span>
            <span class="wmd-slots-count tnum">${images.filter(Boolean).length}/${wf.images}</span>
            <span class="wmd-slots-sep"></span>
            <span class="wmd-eyebrow">音频参考</span>
            <span class="wmd-slots-count tnum">${audios.filter(Boolean).length}/${wf.audios}</span>
            <span class="wmd-slots-spacer"></span>
            <span class="wmd-slots-note">空槽不提交，提示词勿引用</span>
            <button type="button" class="wmd-link wmd-slots-link" data-act="upload-images" title="从本机选择图片，按原比例完整放入空槽">上传图片</button>
            <button type="button" class="wmd-link wmd-slots-link" data-act="upload-audio" title="从本机选择音频放入空音频槽">上传音频</button>
            <button type="button" class="wmd-link wmd-slots-link" data-act="pick-asset" title="从素材库挑一张图放进下一个空槽">粘贴图片</button>
            <button type="button" class="wmd-link wmd-slots-link" data-act="clear-assets">清空素材</button>
          </div>
          <div class="wmd-strip">
            ${Array.from({ length: wf.images }, (_, i) => refSlotHtml(images[i], i, nextEmpty)).join('')}
            <span class="wmd-strip-split"></span>
            ${Array.from({ length: wf.audios }, (_, i) => audioSlotHtml(audios[i], i)).join('')}
          </div>
          <input type="file" id="studio-image-file" accept="image/*" multiple hidden />
        </div>

        <div class="wmd-field wmd-field-grow" ${wf.promptRequired === false ? 'style="display:none"' : ''}>
          <div class="wmd-field-head is-prompt-head">
            <span class="wmd-field-label">提示词</span>
            <span class="wmd-prompt-count tnum" id="prompt-count">${s.prompt.length}字</span>
            <span class="wmd-field-right">
              <span class="wmd-view-switch">
                <button type="button" class="${mode === 'tags' ? 'is-on' : ''}" data-act="prompt-mode" data-mode="tags">标签</button>
                <button type="button" class="${mode === 'code' ? 'is-on' : ''}" data-act="prompt-mode" data-mode="code">代码</button>
              </span>
              <button type="button" class="wmd-tool-btn" data-act="optimize" data-format="${skillFmt}" ${state.busy ? 'disabled' : ''} title="${state.busy ? '正在调用语言渠道' : '按当前视频模型的分镜格式扩写提示词'}">${state.busy ? '优化中' : '提示词优化'}</button>
              <button type="button" class="wmd-tool-btn" data-act="insert-skeleton" data-format="${skillFmt}" title="插入当前视频模型对应的分镜骨架">模板</button>
              <button type="button" class="wmd-tool-btn" data-act="examples" title="插入示例提示词">示例</button>
              <span class="wmd-prompt-tools">
                <button type="button" class="wmd-iconbtn is-sm" data-act="copy-prompt" title="复制全文">${ICON.copy}</button>
                <button type="button" class="wmd-iconbtn is-sm" data-act="clear-prompt" title="清空">${ICON.trash}</button>
              </span>
            </span>
          </div>
          <div class="wmd-prompt-wrap${mode === 'code' ? ' is-editing' : ''}">
            <div class="wmd-prompt wmd-rich-editor ${mode === 'tags' ? '' : 'is-hidden'}" id="prompt-view" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="输入 @ 引用参考图、主体、音频、说话人、对白、画外音或镜头">${mode === 'tags' ? promptRichHtml(s.prompt) : ''}</div>
            <div class="wmd-mention-pop" id="studio-mention-pop" hidden></div>            <textarea class="wmd-prompt-code ${mode === 'code' ? '' : 'is-hidden'}" id="prompt-editor" spellcheck="false"
              placeholder="输入 @ 选择已上传的图片或音频。用 <Picture 1> 引用参考图、<Subject 1> 引用主体、<Audio 1> 引用音频，用 <d>[Chinese] 台词</d> 写对白。">${esc(s.prompt)}</textarea>
            <div id="studio-reference-menu" class="studio-reference-menu" role="listbox" aria-label="参考素材" hidden></div>
          </div>
          <div class="prompt-warn ${(s.warnings || []).length ? 'show' : ''}" id="prompt-warn">${(s.warnings || []).map((w) => '· ' + esc(w)).join('<br>')}</div>
        </div>

        <div class="wmd-compose">
          <div class="wmd-compose-params${Array.isArray(wf.models) && wf.models.length ? ' is-with-name' : ''}">
            <div class="wmd-field wmd-compose-field is-model">
              <div class="wmd-field-head"><span class="wmd-field-label">视频模型</span></div>
              <div class="wmd-select-wrap"><select class="wmd-select" id="p-model" title="${esc(wf.note || '')}">
                ${modelOptions}
              </select><span class="wmd-select-caret">${ICON.caret}</span></div>
            </div>
            ${studioModelFieldHtml(wf, s)}
            ${aspectField}
            <div class="wmd-field wmd-compose-field is-duration" ${!wf.durationKey ? 'style="display:none"' : ''}>
              <div class="wmd-field-head"><span class="wmd-field-label">时长</span></div>
              <div class="wmd-select-wrap"><select class="wmd-select" id="p-duration" ${(wf.durationOptions || []).length === 1 ? 'disabled' : ''}>
                ${((wf.durationOptions && wf.durationOptions.length) ? wf.durationOptions : Array.from({ length: 15 }, (_, i) => i + 1)).map((n) => `<option value="${n}" ${n === Number(s.duration) ? 'selected' : ''}>${n} 秒</option>`).join('')}
              </select><span class="wmd-select-caret">${ICON.caret}</span></div>
            </div>
            <div class="wmd-field wmd-compose-field is-num">
              <div class="wmd-field-head"><span class="wmd-field-label">数量</span></div>
              <input class="wmd-input" id="p-count" type="number" min="1" max="5" value="${Number(s.count) || 1}" />
            </div>
            ${isManager ? '' : `<div class="wmd-field wmd-compose-field is-num">
              <div class="wmd-field-head"><span class="wmd-field-label">种子</span></div>
              <input class="wmd-input wmd-mono" id="p-seed" value="${esc(s.seed)}" placeholder="随机" />
            </div>`}
            ${wf.pass2 ? `<div class="wmd-field wmd-compose-field is-num">
              <div class="wmd-field-head"><span class="wmd-field-label">${esc(wf.pass2.label || '二次采样')}</span></div>
              <div class="wmd-select-wrap"><select class="wmd-select" id="p-megapixels2">
                ${(wf.pass2.options || []).map((m) => `<option value="${m}" ${Number(m) === Number(s.megapixels2 || wf.pass2.default) ? 'selected' : ''}>${m}</option>`).join('')}
              </select><span class="wmd-select-caret">${ICON.caret}</span></div>
            </div>` : ''}
          </div>
          <div class="wmd-generate">
            <button type="button" class="wmd-btn wmd-btn-primary wmd-btn-lg" data-act="generate" ${state.busy ? 'disabled' : ''}>生成视频</button>
          </div>
        </div>
      </div>
    </aside>

    <div class="wmd-splitter" title="拖动调整创作台宽度"></div>

    <div class="wmd-stage">
      <div class="wmd-toolbar">
        <span class="wmd-toolbar-title">舞台</span>
        <span class="wmd-toolbar-spacer"></span>
        <button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-act="go-jobs">任务日志</button>
      </div>
      <div class="wmd-stage-body">
        <div id="studio-stage">${stage}</div>
        <div id="studio-queue">${queue}</div>
      </div>
    </div>
  </div>`;
}


function bindStudio(root) {
  bindGenerationParameters(root,'video');
  const s = state.studio;
  const wf = currentWorkflow();

  bindSplitter(root, '.studio-panel', (width) => {
    s.panelWidth = width || null;
    if (width) localStorage.setItem('wmd.panelWidth', String(width));
    else localStorage.removeItem('wmd.panelWidth');
  });

  const applyWorkflowDefaults = (next) => {
    if (!next) return;
    // state.studio 可能已被 WB.adopt 换成另一个对象，这里每次取最新引用
    const s = state.studio;
    s.workflowId = next.id;
    s.skillFormat = ''; // 换了渠道 / 模型，模板与优化格式回到跟随该渠道
    s.channelId = next.channelId || '';
    s.resolution = next.defaultResolution || '';
    s.megapixels = next.megapixelsDefault || 0;
    s.megapixels2 = next.pass2 ? next.pass2.default : 0;
    s.duration = Math.min(15, next.durationDefault || 10);
    if (next.defaultRatio) s.aspectRatio = next.defaultRatio;
    localStorage.setItem('wmd.workflowId', s.workflowId);
  };

  // 供外壳（左侧二级菜单）直接切换模型：先落盘当前分镜，再换到新厂商的目录，最后套模型参数
  window.__studioSwitchWorkflow = async (id) => {
    const next = workflowById(id);
    if (!next) return false;
    try { await WB.flush('video'); } catch (error) { /* 保存失败也继续切 */ }
    await WB.reloadVendor(undefined, vendorKeyOf(next));
    applyWorkflowDefaults(next);
    render();
    return true;
  };

  const channelSel = $('#channel-select', root);
  if (channelSel) {
    channelSel.onchange = () => {
      const id = channelSel.value;
      if (!id) {
        const auto = state.workflows.find((w) => w.provider === 'autodl' && w.id === s.workflowId)
          || state.workflows.find((w) => w.provider === 'autodl');
        applyWorkflowDefaults(auto);
      } else {
        const first = state.workflows.find((w) => w.channelId === id);
        applyWorkflowDefaults(first || workflowById('ch:' + id));
      }
      render();
    };
  }

  const modelSel = $('#p-model', root);
  if (modelSel) {
    modelSel.onchange = () => {
      applyWorkflowDefaults(workflowById(modelSel.value));
      render();
    };
  }

  const editor = $('#prompt-editor', root);
  if (editor) {
    editor.oninput = () => {
      s.prompt = editor.value;
      const count = $('#prompt-count');
      if (count) count.textContent = s.prompt.length + '字';
      studioPersist();
    };
    editor.onblur = () => { validatePromptSoon(); };
    const menu = $('#studio-reference-menu', root);
    if (menu) bindStudioMentions(editor, menu);
  }

  const uploadInput = $('#studio-image-file', root);
  if (uploadInput) {
    uploadInput.onchange = async () => {
      const files = [...(uploadInput.files || [])];
      uploadInput.value = '';
      if (files.length) await studioUploadImages(files);
    };
  }
  const slotArea = $('.wmd-slots', root);
  if (slotArea) {
    slotArea.ondragover = (event) => { if (![...(event.dataTransfer.types || [])].includes('Files')) return; event.preventDefault(); slotArea.classList.add('is-drop'); };
    slotArea.ondragleave = () => slotArea.classList.remove('is-drop');
    slotArea.ondrop = async (event) => {
      const files = [...(event.dataTransfer.files || [])].filter((f) => String(f.type || '').startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      slotArea.classList.remove('is-drop');
      await studioUploadImages(files);
    };
  }

  const rich = $('#prompt-view', root);
  if (rich) bindStudioRichEditor(rich);


  const bindChange = (sel, key, cast = String) => {
    const el = $(sel, root);
    if (!el) return;
    el.onchange = () => { s[key] = cast(el.value); };
  };
  bindChange('#p-resolution', 'resolution');
  bindChange('#p-aspect', 'aspectRatio');
  const modelNameSel = $('#p-model-name', root);
  if (modelNameSel) modelNameSel.onchange = () => { s.model = modelNameSel.value; refreshStudioHint(); studioPersist(); };
  bindChange('#p-duration', 'duration', Number);
  bindChange('#p-megapixels', 'megapixels', Number);
  bindChange('#p-megapixels2', 'megapixels2', Number);
  const countEl = $('#p-count', root);
  if (countEl) countEl.onchange = () => { s.count = Math.max(1, Math.min(5, Number(countEl.value) || 1)); };
  const seedEl = $('#p-seed', root);
  if (seedEl) seedEl.oninput = () => { s.seed = seedEl.value; };

  root.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    try {
      if (act === 'remove-motion-video') {s.videos=[];return render();}
      if (act === 'upload-motion-video') {
        const picker=document.createElement('input');picker.type='file';picker.accept='video/mp4,video/webm';
        picker.onchange=async()=>{if(!picker.files[0])return;try{const context=WB.context('video');const project=state.projectId;const video=await uploadFile(picker.files[0],'video');if(project!==state.projectId||context.itemId!==WB.context('video').itemId)return toast('已切换分镜，请重新选择视频',true);s.videos=[video];render();}catch(e){toast(e.message,true);}};
        picker.click();return;
      }
      if (act === 'upload-images') { const el = $('#studio-image-file'); if (el) el.click(); return; }
      if (act === 'upload-audio') {
        const wf = currentWorkflow();
        const index = state.studio.audios.findIndex((x) => !x);
        if (!wf.audios) return toast('当前工作流不接收音频参考', true);
        if (index < 0 || index >= wf.audios) return toast('音频槽已满', true);
        return openAudioPicker(index);
      }
      if (act === 'add-image') return openImagePicker(Number(target.dataset.index));
      if (act === 'remove-image') { s.images[Number(target.dataset.index)] = null; return render(); }
      if (act === 'remove-audio') { s.audios[Number(target.dataset.index)] = null; return render(); }
      if (act === 'name-subject') {
        const index = Number(target.dataset.index);
        const img = s.images[index];
        if (!img) return;
        return askText('命名主体', img.subject, '例如：护法武僧、湖畔少女、雪山古寺', (text) => {
          img.subject = text;
          render();
        });
      }
      if (act === 'add-audio') return openAudioPicker(Number(target.dataset.index));
      if (act === 'voice-pick') return openVoiceDialog(Number(target.dataset.index));
      if (act === 'preview-audio') return previewAudio(s.audios[Number(target.dataset.index)]);
      if (act === 'prompt-mode') { s.promptMode = target.dataset.mode; return render(); }
      if (act === 'copy-prompt') {
        await navigator.clipboard.writeText(s.prompt || '');
        toast('已复制提示词');
        return;
      }
      if (act === 'insert-tag') { s.promptMode = 'code'; render(); return openTagMenu(); }
      if (act === 'insert-skeleton') {
        s.promptMode = 'code';
        const fmt = target.dataset.format === 'seedance'
          ? 'seedance'
          : target.dataset.format === 'h3' ? 'h3' : studioSkillFormat(s);
        s.skillFormat = fmt;
        const sdSkeleton = (state.prompt.seedance && state.prompt.seedance.skeleton) || state.prompt.seedanceSkeleton || '';
        if (fmt === 'seedance') {
          s.prompt = sdSkeleton;
          render();
          return toast(sdSkeleton ? '已插入 Seedance 2.0 分镜节拍稿' : 'Seedance 骨架没取到，刷新页面再试', !sdSkeleton);
        }
        s.prompt = state.prompt.skeleton;
        render();
        return toast('已插入六段式骨架');
      }
      if (act === 'examples') return openExamples();
      if (act === 'clear-prompt') { s.prompt = ''; s.warnings = []; s.promptMode = 'code'; return render(); }
      if (act === 'optimize') { s.promptMode = 'code'; return optimizePrompt(target.dataset.format === 'seedance' ? 'seedance' : 'h3'); }
      if (act === 'generate') return generate();
      if (act === 'stage-pick') {
        // 有任务在跑时舞台必须跟着实时任务（不然又会「没完成却显示完成」），回看先等它跑完
        if (studioOwnJobs().some((j) => j.status === 'running' || j.status === 'queued')) {
          return toast('这个分镜还在生成，等它跑完再回看历史');
        }
        state.stagePick = state.stagePick || {};
        state.stagePick[WB.context('video').itemId] = target.dataset.id;
        return render();
      }
      if (act === 'open-job') { return openJobDetail(target.dataset.id); }
      if (act === 'go-jobs') { state.logTab='video';localStorage.setItem('wmd.logs.tab','video');location.hash = '#logs'; return; }
      if (act === 'open-manager') {
        const ch = (state.channels.video || []).find((c) => c.id === s.channelId);
        await api('/api/open', { method: 'POST', body: { url: (ch && ch.baseUrl) || 'http://127.0.0.1:17778' } });
        return;
      }
      if (act === 'open-job-folder') {
        await api('/api/reveal', { method: 'POST', body: { path: target.dataset.path } });
        return;
      }
      if (act === 'play-job') {
        const job = state.jobs.find((j) => j.id === target.dataset.id);
        const video = job && (job.outputs || []).find((o) => o.type === 'video');
        if (video) await api('/api/media/open', { method: 'POST', body: { path: video.path, player: true } });
        return;
      }
      if (act === 'add-video-channel') return openChannelDialog('video', null);
      if (act === 'go-video-channels') return openSettings('channels');
      if (act === 'go-keys') return openSettings('keys');
      if (act === 'pick-asset') { const slot = s.images.findIndex((x) => !x); return openImagePicker(slot < 0 ? 0 : slot); }
      if (act === 'clear-assets') { s.images = s.images.map(() => null); s.audios = s.audios.map(() => null); s.videos=[]; return render(); }
      if (act === 'llm-channel') return openSettings('channels');
    } catch (err) {
      toast(err.message, true);
    }
  });

  const grid = $('#slot-strip', root);
  if (grid) {
    grid.addEventListener('dragover', (event) => { event.preventDefault(); grid.classList.add('is-drop'); });
    grid.addEventListener('dragleave', () => grid.classList.remove('is-drop'));
    grid.addEventListener('drop', async (event) => {
      event.preventDefault();
      grid.classList.remove('is-drop');
      const files = Array.from(event.dataTransfer.files || []);
      for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        const saved = await uploadFile(file, 'image');
        if (saved) {
          let slot = s.images.findIndex((x) => !x);
          if (slot < 0) slot = s.images.length;
          s.images[slot] = saved;
        }
      }
      render();
    });
  }
}

async function uploadFile(file, kind) {
  if (!/\.(mp4|webm|mp3|wav|m4a|ogg|flac)$/i.test(file.name)) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
    const saved = await api('/api/upload', { method: 'POST', body: { name: file.name, data } });
    return { path: saved.path, name: saved.name, subject: '', kind };
  }
  const response = await fetch('/api/upload/raw?name=' + encodeURIComponent(file.name), {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || '上传失败 HTTP ' + response.status);
  const saved = result.data;
  return { path: saved.path, name: saved.name, subject: '', kind };
}

function insertAtCursor(text) {
  const editor = $('#prompt-editor');
  if (!editor) return;
  const start = editor.selectionStart || 0;
  const end = editor.selectionEnd || 0;
  const value = editor.value;
  editor.value = value.slice(0, start) + text + value.slice(end);
  editor.selectionStart = editor.selectionEnd = start + text.length;
  state.studio.prompt = editor.value;
  const count = $('#prompt-count');
  if (count) count.textContent = state.studio.prompt.length + ' 字';
  editor.focus();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

async function studioUploadImages(files) {
  const s = state.studio;
  const wf = currentWorkflow();
  let index = s.images.findIndex((x) => !x);
  for (const file of files) {
    if (!file || !String(file.type || '').startsWith('image/')) { toast(file && file.name ? file.name + ' 不是图片' : '不是图片文件', true); continue; }
    if (file.size > 10 * 1024 * 1024) { toast(file.name + ' 超过 10MB', true); continue; }
    if (index < 0) {
      if ((s.images || []).length >= wf.images) { toast('参考图槽已满（' + wf.images + ' 张）', true); break; }
      index = s.images.length;
    }
    if (index >= wf.images) { toast('参考图槽已满（' + wf.images + ' 张）', true); break; }
    try {
      const data = await fileToDataUrl(file);
      const saved = await api('/api/assets/upload', { method: 'POST', body: { name: file.name, data } });
      s.images[index] = { path: saved.path, name: saved.name || file.name, subject: '', kind: 'image' };
      index += 1;
    } catch (err) { toast(file.name + ' 上传失败：' + err.message, true); }
  }
  studioPersist();
  render();
}

function studioReferenceTags(studio = state.studio, workflow = currentWorkflow()) {
  const images = studio.images.slice(0, workflow.images).filter(Boolean);
  const audios = studio.audios.slice(0, workflow.audios).filter(Boolean);
  return [
    ...images.map((img, i) => ({ label: '<Picture ' + (i + 1) + '>  ' + (img.subject || img.name || '图像 ' + (i + 1)), insert: '<Picture ' + (i + 1) + '>' })),
    ...images.flatMap((img, i) => img.subject ? [{ label: '<Subject ' + (i + 1) + '>  ' + img.subject, insert: '<Subject ' + (i + 1) + '>' }] : []),
    ...audios.map((audio, i) => ({ label: '<Audio ' + (i + 1) + '>  ' + (audio.name || '音频 ' + (i + 1)), insert: '<Audio ' + (i + 1) + '>' })),
  ];
}

function bindStudioMentions(editor, host) {
  let range = null, index = 0, items = [];
  function close() { range = null; host.hidden = true; host.innerHTML = ''; editor.removeAttribute('aria-expanded'); }
  function choose(at) {
    if (!range || !items[at]) return;
    editor.setSelectionRange(range.start, range.end);
    insertAtCursor(items[at].insert + ' ');
    close(); validatePromptSoon();
  }
  function update() {
    if (editor.selectionStart !== editor.selectionEnd) return close();
    const prefix = editor.value.slice(0, editor.selectionStart);
    const match = prefix.match(/@([^@\s<>]*)$/);
    if (!match) return close();
    const query = match[1].toLowerCase();
    range = { start: prefix.length - match[0].length, end: prefix.length };
    items = studioReferenceTags().filter(item => item.label.toLowerCase().includes(query));
    index = Math.min(index, Math.max(0, items.length - 1));
    host.hidden = false; editor.setAttribute('aria-expanded', 'true');
    host.innerHTML = items.length ? items.map((item, at) => '<button type="button" role="option" aria-selected="' + (at === index) + '" data-reference-index="' + at + '">' + esc(item.label) + '</button>').join('') : '<span>没有匹配素材，请先上传图片或音频</span>';
    host.querySelectorAll('button').forEach(button => { button.onmousedown = event => event.preventDefault(); button.onclick = () => choose(Number(button.dataset.referenceIndex)); });
  }
  editor.addEventListener('input', () => { index = 0; update(); });
  editor.addEventListener('click', update);
  editor.addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update(); });
  editor.addEventListener('keydown', event => {
    if (event.isComposing || !range) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (items.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); index = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; update(); }
    else if (items.length && ['Enter', 'Tab'].includes(event.key)) { event.preventDefault(); choose(index); }
  });
  editor.addEventListener('blur', close);
}

function openTagMenu() {
  const s = state.studio;
  const tags = studioReferenceTags();
  const extra = [
    { label: '对白  <d>[Chinese] 台词</d>', insert: '<d>[Chinese] </d>' },
    { label: '分镜  [Shot 2] At 00:04.000, ', insert: '[Shot 2] At 00:04.000, ' },
    { label: '任务类型  [reference generation]', insert: '[reference generation] ' },
    { label: '跨切台词  <scenetrans>', insert: '<scenetrans>' },
    { label: '截断标记  <cutoff>', insert: '<cutoff>' },
    { label: '保留关系  fully_preserved', insert: 'fully_preserved' },
  ];
  openModal(`
    <div class="modal-head"><h2>插入标签</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body">
      <div class="section"><h3>参考素材</h3><div class="chip-list">${tags.length ? tags.map((t, i) => `<button class="chip" data-tag="${i}">${esc(t.label)}</button>`).join('') : '<span class="hint">先添加参考图/音频</span>'}</div></div>
      <div class="section"><h3>结构与语法</h3><div class="chip-list">${extra.map((t, i) => `<button class="chip" data-extra="${i}">${esc(t.label)}</button>`).join('')}</div></div>
    </div>
  `);
  $$('#modal-panel [data-tag]').forEach((btn) => {
    btn.onclick = () => { insertAtCursor(tags[Number(btn.dataset.tag)].insert); closeModal(); };
  });
  $$('#modal-panel [data-extra]').forEach((btn) => {
    btn.onclick = () => { insertAtCursor(extra[Number(btn.dataset.extra)].insert); closeModal(); };
  });
}

function openExamples() {
  const examples = state.prompt.examples || [];
  openModal(`
    <div class="modal-head"><h2>六段式示例</h2><span class="grow"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
    <div class="modal-body">
      ${examples.map((ex, i) => `<div class="section"><div class="row"><strong>${esc(ex.title)}</strong><span class="grow"></span><button class="btn sm" data-example="${i}">插到编辑器</button></div><pre class="mono" style="white-space:pre-wrap;max-height:260px;overflow:auto;background:var(--surface-2);padding:10px;border-radius:9px;margin:0">${esc(ex.text)}</pre></div>`).join('')}
    </div>
  `);
  $$('#modal-panel [data-example]').forEach((btn) => {
    btn.onclick = () => {
      state.studio.prompt = examples[Number(btn.dataset.example)].text;
      state.studio.promptMode = 'code';
      closeModal();
      render();
    };
  });
}

/* 素材库选择器：人物 / 场景 / 道具 三个分类（对应素材库三个文件夹）+ 其他 */
const ASSET_PICKER_CATEGORIES = [['character', '人物'], ['scene', '场景'], ['prop', '道具'], ['other', '其他']];

function assetPickerItem(item, fallbackLabel) {
  return {
    path: item.path || '',
    rel: item.rel || '',
    name: item.name || '',
    url: item.url || '',
    kind: item.kind || 'image',
    bytes: item.bytes || 0,
    tag: item.typeLabel || item.category || fallbackLabel || '',
  };
}

async function openLibraryPicker(opts = {}) {
  const want = opts.accept === 'audio' ? 'audio' : 'image';
  const title = opts.title || (want === 'audio' ? '选择参考音频' : '选择参考图');
  let lib = null;
  try { lib = await api('/api/assets/library'); } catch { lib = null; }
  const legacy = ((state.assets && state.assets.items) || []).filter((i) => i.kind === want);
  const buckets = {};
  for (const [id, label] of ASSET_PICKER_CATEGORIES) {
    const raw = id === 'other'
      ? [...((lib && lib.other) || []), ...(((lib && lib.items) || []).filter((i) => i.type === 'storyboard')), ...legacy]
      : (((lib && lib.materials) || {})[id] || []);
    buckets[id] = raw.filter((i) => (i.kind || want) === want).map((i) => assetPickerItem(i, label));
  }
  const tabs = ASSET_PICKER_CATEGORIES;
  let active = (tabs.find(([id]) => buckets[id].length) || tabs[0])[0];

  const draw = () => {
    const items = buckets[active];
    const activeLabel = (tabs.find(([id]) => id === active) || tabs[0])[1];
    openModal(`
      <div class="modal-head"><h2>${esc(title)}</h2><span class="grow"></span>
        <button class="btn sm" id="picker-upload">上传本地${want === 'audio' ? '音频' : '图片'}</button>
        <button class="btn ghost sm" data-close="1">关闭</button></div>
      <div class="modal-body asset-picker">
        <div class="asset-picker-tabs">${tabs.map(([id, label]) => `<button type="button" class="chip ${id === active ? 'active' : ''}" data-picker-tab="${id}">${esc(label)}<span class="asset-picker-count">${buckets[id].length}</span></button>`).join('')}</div>
        <div class="grid-cards">${items.length ? items.map((item, i) => `
          <div class="asset-card" data-pick="${i}">
            <div class="asset-thumb">${want === 'audio' ? '♪' : `<img src="${esc(item.url)}" alt="" loading="lazy" />`}</div>
            <div class="asset-meta"><span class="name">${esc(item.name)}</span><span class="sub">${esc(item.tag)}${item.bytes ? ' · ' + fmtBytes(item.bytes) : ''}</span></div>
          </div>`).join('') : `<div class="empty">${esc(activeLabel)}文件夹里还没有${want === 'audio' ? '音频' : '图片'}，可以直接上传</div>`}</div>
      </div>`);
    $$('#modal-panel [data-picker-tab]').forEach((btn) => {
      btn.onclick = () => { active = btn.dataset.pickerTab; draw(); };
    });
    $$('#modal-panel [data-pick]').forEach((card) => {
      card.onclick = () => {
        const item = items[Number(card.dataset.pick)];
        if (item && opts.onPick) Promise.resolve(opts.onPick(item)).catch((err) => toast(err.message, true));
      };
    });
    const upload = $('#picker-upload');
    if (upload) upload.onclick = () => {
      const input = $('#file-input');
      input.accept = want === 'audio' ? 'audio/*' : 'image/*';
      input.onchange = async () => {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        try {
          const saved = await uploadFile(file, want);
          if (opts.onPick) await opts.onPick(assetPickerItem(saved, '本地上传'));
        } catch (err) { toast(err.message, true); }
      };
      input.click();
    };
  };
  draw();
}

function openImagePicker(slotIndex) {
  return openLibraryPicker({
    title: '选择参考图',
    onPick: (item) => {
      state.studio.images[slotIndex] = { path: item.path, name: item.name, subject: '', kind: 'image' };
      closeModal();
      render();
    },
  });
}

function openAudioPicker(slotIndex) {
  return openLibraryPicker({
    accept: 'audio',
    title: '选择参考音频',
    onPick: (item) => {
      state.studio.audios[slotIndex] = { path: item.path, name: item.name, kind: 'audio' };
      closeModal();
      render();
    },
  });
}

function studioAssetsPayload() {
  const s = state.studio;
  const assets = [];
  s.images.forEach((img, i) => { if (img) assets.push({ token: `<Picture ${i + 1}>`, kind: 'image', name: img.name, subjectName: img.subject || '', path: img.path }); });
  s.audios.forEach((audio, i) => { if (audio) assets.push({ token: `<Audio ${i + 1}>`, kind: 'audio', name: audio.name, path: audio.path }); });
  const subjects = s.images.map((img, i) => img && img.subject ? { ordinal: i + 1, name: img.subject, tokens: [`<Picture ${i + 1}>`] } : null).filter(Boolean);
  return { assets, subjects };
}

/**
 * 内置提示词模板跟着「渠道 + 视频模型」走：
 * 豆包 / Seedance → 白昼 v0.5 分镜格式；MiniMax H3（官网 API 工作流）→ 六段式。
 * 用户手动点过某一边时以手动为准，直到下次切渠道或模型再回到跟随。
 */
function skillFormatOf(wf) {
  const id = String((wf && wf.id) || '').toLowerCase();
  const label = String((wf && (wf.label || wf.display)) || '').toLowerCase();
  if (id.includes('doubao') || id.includes('seedance') || label.includes('豆包') || label.includes('seedance')) return 'seedance';
  return 'h3';
}

function studioSkillFormat(s, wf) {
  // 格式完全由当前视频模型决定：Seedance 页面只出现 Seedance 工具，H3 页面只出现 H3 工具
  return skillFormatOf(wf || currentWorkflow());
}

/**
 * 视频模型名称：豆包网页有模型下拉（Seedance 2.0 Mini / Fast），文案必须一字不差。
 * 工作流没带 models（Gemini、AutoDL、自定义渠道）就返回空，不往任务里塞模型。
 */
function studioModelName(wf, s) {
  const list = Array.isArray(wf && wf.models) ? wf.models : [];
  if (!list.length) return '';
  const value = String((s && s.model) || '').trim();
  return list.includes(value) ? value : '';
}

function studioModelFieldHtml(wf, s) {
  const list = Array.isArray(wf && wf.models) ? wf.models : [];
  if (!list.length) return '';
  const current = studioModelName(wf, s);
  return `<div class="wmd-field wmd-compose-field is-name">
              <div class="wmd-field-head"><span class="wmd-field-label">模型名称</span></div>
              <div class="wmd-select-wrap"><select class="wmd-select" id="p-model-name" title="发给管理器的视频模型名称，必须和网页下拉文案一字不差；不指定就沿用网页当前选中的模型">
                <option value="" ${current ? '' : 'selected'}>跟随页面当前模型</option>
                ${list.map((model) => `<option value="${esc(model)}" ${model === current ? 'selected' : ''}>${esc(model)}</option>`).join('')}
              </select><span class="wmd-select-caret">${ICON.caret}</span></div>
            </div>`;
}

/** 生成按钮下面那行参数摘要：管理器 · 16:9 · 15s（选了模型再单独一行 Seedance 2.0 Fast）。
 *  模型名比这行长，所以拆成两段：窄的时候只在两段之间折行，不会把「15s」孤零零甩到一行。 */
function studioGenerateHintParts(wf, s) {
  const isAuto = wf && wf.provider === 'autodl';
  const size = esc(isAuto ? ((s && s.resolution) || (wf && wf.defaultResolution)) : String((s && s.aspectRatio) || '').split(' ')[0]);
  const duration = wf && wf.durationKey ? ` · ${(s && s.duration)}s` : ' · 按实际生成时长';
  return {
    params: `${isAuto ? '官网 API' : esc((wf && wf.providerLabel) || '自定义')} · ${size}${duration}`,
    model: esc(studioModelName(wf, s)),
  };
}

function studioGenerateHint(wf, s) {
  const parts = studioGenerateHintParts(wf, s);
  return parts.model ? `${parts.params} · ${parts.model}` : parts.params;
}

function studioGenerateHintHtml(wf, s) {
  const parts = studioGenerateHintParts(wf, s);
  return `<span class="hint-seg">${parts.params}</span>${parts.model ? ` <span class="hint-seg">${parts.model}</span>` : ''}`;
}

function refreshStudioHint() {
  const wf = currentWorkflow();
  const hint = $('#studio-generate-hint');
  if (hint) hint.innerHTML = studioGenerateHintHtml(wf, state.studio);
  const box = hint && hint.closest('.wmd-generate-hint');
  if (box) box.classList.toggle('is-two-line', Boolean(studioModelName(wf, state.studio)));
}

let validateTimer = null;function validatePromptSoon() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(async () => {
    const s = state.studio;
    if (!s.prompt.trim()) return;
    try {
      const { assets, subjects } = studioAssetsPayload();
      const res = await api('/api/prompt/validate', { method: 'POST', body: { prompt: s.prompt, duration: s.duration, assets, subjects } });
      s.warnings = res.warnings || [];
      const warn = $('#prompt-warn');
      if (warn) {
        warn.innerHTML = s.warnings.map((w) => '· ' + esc(w)).join('<br>');
        warn.classList.toggle('show', s.warnings.length > 0);
      }
    } catch { /* silent */ }
  }, 700);
}

async function optimizePrompt(format = 'h3') {
  const s = state.studio;
  const mode = format === 'seedance' ? 'seedance' : 'h3';
  if (!s.prompt.trim()) return toast('先写点想要的画面再优化', true);
  s.skillFormat = mode;
  state.busy = true;
  render();
  try {
    const { assets, subjects } = studioAssetsPayload();
    const data = await api('/api/optimize', {
      method: 'POST',
      body: {
        prompt: s.prompt,
        assets,
        subjects,
        duration: s.duration,
        language: (state.config.prompt && state.config.prompt.language) || 'zh',
        includeImages: true,
        format: mode,
      },
    });
    s.prompt = data.prompt;
    s.warnings = data.warnings || [];
    const label = mode === 'seedance' ? 'Seedance 2.0' : 'H3';
    const stats = (mode === 'seedance' && data.stats)
      ? ` · ${data.duration ? data.duration + ' 秒 / ' : ''}${data.stats.shots} 镜 / ${data.stats.dialogue} 句`
      : '';
    toast(`优化完成 · ${label} · ${data.model || ''}${stats} · ${Math.round(data.elapsedMs / 1000)} 秒`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
    render();
  }
}

async function generate() {
  const s = state.studio;
  const workbenchContext = WB.context("video");
  await WB.flush("video");
  const wf = currentWorkflow();
  if (wf.promptRequired !== false && !s.prompt.trim()) return toast('提示词不能为空', true);
  if (wf.videos && !s.videos?.length) return toast('请添加动作参考视频',true);
  if (!s.images.filter(Boolean).length) return toast('至少添加一张参考图', true);
  state.busy = true;
  render();
  try {
    const body = {
      ...workbenchContext,
      requestId:crypto.randomUUID(),
      workflowId: wf.id,
      prompt: s.prompt,
      prefixPrompt:generationPrefixValue('video'),
      images: s.images.slice(0,wf.images).filter(Boolean).map((img) => ({ path: img.path, name: img.name, subject: img.subject || '' })),
      audios: s.audios.slice(0,wf.audios).filter(Boolean).map((audio) => ({ path: audio.path, name: audio.name })),
      videos: (s.videos || []).slice(0,wf.videos||0).map(video=>({path:video.path,name:video.name})),
      duration: s.duration,
      model: studioModelName(wf, s),
      resolution: s.resolution || wf.defaultResolution,
      aspectRatio: s.aspectRatio,
      megapixels: s.megapixels || wf.megapixelsDefault,
      megapixels2: s.megapixels2 || (wf.pass2 ? wf.pass2.default : 0),
      seed: s.seed === '' ? null : Number(s.seed),
      count: s.count || 1,
      styleId: state.project && state.project.styleId,
    };
    const data = await api('/api/jobs', { method: 'POST', body });
    state.jobs = (await api('/api/jobs')).jobs;
    // 刚提交了新任务：舞台回到实时任务，不要停在上一次回看的旧版
    if (state.stagePick) delete state.stagePick[workbenchContext.itemId];
    if (WB.context("video").itemId === workbenchContext.itemId) state.lastJobId = data.jobs[0].id;
    try { localStorage.setItem('wmd.lastJobId', state.lastJobId); } catch { /* ignore */ }
    toast(`已加入队列 ${data.jobs.length} 条`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    state.busy = false;
    render();
  }
}
