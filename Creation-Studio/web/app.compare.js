'use strict';

/* app.compare.js — 对比
 * 由 web/app.js 按原段注释切分而来（第 5143–5529 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */

/* ------------------------------------------------------------------ 对比 */

function compareItem(side) {
  return state.compare[side] || null;
}

function comparePaneHtml(side) {
  const item = compareItem(side);
  const label = side.toUpperCase();
  if (!item) {
    return `<div class="cmp-pane is-empty" data-side="${side}">
      <span class="cmp-badge">${label}</span>
      <div class="cmp-empty">
        <span class="cmp-empty-ico">${IMG_ICON}</span>
        <span>拖入图片 / 视频，或从下面选择</span>
        <div class="cmp-empty-actions">
          <button type="button" class="wmd-btn wmd-btn-sm" data-act="cmp-pick" data-side="${side}">媒体库</button>
          <button type="button" class="wmd-btn wmd-btn-sm" data-act="cmp-local" data-side="${side}">本地文件</button>
        </div>
      </div>
    </div>`;
  }
  const media = item.kind === 'video'
    ? `<video src="/api/file?path=${enc(item.path)}" data-cmp-video="${side}" playsinline preload="metadata" ${side === 'right' ? 'muted' : ''}></video>`
    : `<img src="/api/file?path=${enc(item.path)}" alt="" />`;
  return `<div class="cmp-pane" data-side="${side}">
    <span class="cmp-badge">${label}</span>
    <span class="cmp-name">${esc(item.name)}</span>
    <button type="button" class="cmp-clear" data-act="cmp-clear" data-side="${side}" title="移除">×</button>
    ${media}
  </div>`;
}

function renderCompare() {
  const c = state.compare;
  const overlay = c.mode === 'overlay';
  return `
  <div class="cmp">
    <div class="cmp-head">
      <span class="cmp-title">对比</span>
      <span class="cmp-pick">A—${c.left ? esc(c.left.name) : ''}</span>
      <span class="cmp-pick">B—${c.right ? esc(c.right.name) : ''}</span>
      <span class="wmd-toolbar-spacer"></span>
      <div class="cmp-mode">
        <button type="button" class="wmd-seg-item ${overlay ? '' : 'is-active'}" data-act="cmp-mode" data-mode="side">对比模式</button>
        <button type="button" class="wmd-seg-item ${overlay ? 'is-active' : ''}" data-act="cmp-mode" data-mode="overlay">叠加对比</button>
      </div>
      <button type="button" class="wmd-link wmd-slots-link" data-act="cmp-swap" title="交换 A / B">⇄ 交换 A/B</button>
      <button type="button" class="wmd-link wmd-slots-link" data-act="cmp-clear-all" title="清空两侧">清空</button>
      <button type="button" class="wmd-btn wmd-btn-sm" data-act="cmp-export" title="把当前两帧并排导出成 PNG，存进素材库">导出并排合成</button>
    </div>

    <div class="cmp-stage ${overlay ? 'is-overlay' : ''}">
      ${comparePaneHtml('left')}
      ${comparePaneHtml('right')}
      ${overlay ? `<input class="cmp-opacity" id="cmp-opacity" type="range" min="0" max="100" step="1" value="${c.opacity == null ? 50 : c.opacity}" title="叠加不透明度" />` : ''}
    </div>

    <div class="cmp-dock">
      <div class="cmp-transport">
        <button type="button" class="wmd-iconbtn is-sm" data-act="cmp-prev" title="上一帧">${ICON.skipBack}</button>
        <button type="button" class="wmd-iconbtn is-sm" data-act="cmp-play" title="播放 / 暂停（空格）">${ICON.play}</button>
        <button type="button" class="wmd-iconbtn is-sm" data-act="cmp-next" title="下一帧">${ICON.skipFwd}</button>
        <span class="cmp-time tnum" id="cmp-time">00:00</span>
        <input class="cmp-seek" id="cmp-seek" type="range" min="0" max="1000" step="1" value="0" />
        <span class="cmp-time tnum" id="cmp-duration">00:00</span>
        <label class="cmp-loop" title="循环播放"><input type="checkbox" id="cmp-loop" ${c.loop ? 'checked' : ''} /> 循环</label>
        <select class="wmd-select cmp-speed" id="cmp-speed" title="播放速度">
          ${[0.25, 0.5, 0.75, 1, 1.5, 2].map((s) => `<option value="${s}" ${Number(s) === Number(c.speed || 1) ? 'selected' : ''}>${s}x</option>`).join('')}
        </select>
      </div>
      <div class="cmp-note">拖入文件，或点「媒体库 / 本地文件」加载；空格播放/暂停，← → 逐帧；两次选同一素材可对比不同重绘</div>
    </div>
  </div>`;
}

function compareVideos() {
  return $$('#view video[data-cmp-video]');
}

function compareTime(target) {
  const vids = compareVideos();
  const primary = vids[0] || null;
  if (!primary) return 0;
  return target === 'max' ? Math.max(...vids.map((v) => v.currentTime || 0)) : (primary.currentTime || 0);
}

function fmtClock(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const rest = Math.floor(s % 60);
  return String(m).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
}

function syncCompareSeek() {
  const vids = compareVideos();
  if (!vids.length) return;
  const t = compareTime();
  vids.forEach((v) => { if (Math.abs((v.currentTime || 0) - t) > 0.25) v.currentTime = t; });
  const seek = $('#cmp-seek');
  const dur = vids.length ? Math.max(...vids.map((v) => v.duration || 0)) : 0;
  if (seek) seek.value = String(Math.round((t / (dur || 1)) * 1000));
  const time = $('#cmp-time');
  if (time) time.textContent = fmtClock(t);
  const duration = $('#cmp-duration');
  if (duration) duration.textContent = fmtClock(dur);
}

function bindCompare(root) {
  if (state.compare._key) document.removeEventListener('keydown', state.compare._key);
  const vids = compareVideos();
  vids.forEach((v) => {
    v.controls = false;
    v.addEventListener('timeupdate', () => syncCompareSeek());
    v.addEventListener('loadedmetadata', () => syncCompareSeek());
    v.addEventListener('ended', () => {
      if (!state.compare.loop) return;
      vids.forEach((x) => { x.currentTime = 0; x.play().catch(() => {}); });
    });
  });
  syncCompareSeek();

  const seek = $('#cmp-seek');
  if (seek) {
    seek.oninput = () => {
      const dur = vids.length ? Math.max(...vids.map((v) => v.duration || 0)) : 0;
      const t = (Number(seek.value) / 1000) * dur;
      vids.forEach((v) => { v.currentTime = t; });
      syncCompareSeek();
    };
  }
  const opacity = $('#cmp-opacity');
  if (opacity) {
    opacity.oninput = () => {
      state.compare.opacity = Number(opacity.value);
      const right = $('.cmp-pane[data-side="right"]');
      if (right) right.style.opacity = String(state.compare.opacity / 100);
    };
  }
  const speed = $('#cmp-speed');
  if (speed) {
    speed.onchange = () => {
      state.compare.speed = Number(speed.value) || 1;
      compareVideos().forEach((v) => { v.playbackRate = state.compare.speed; });
    };
  }
  const loop = $('#cmp-loop');
  if (loop) loop.onchange = () => { state.compare.loop = loop.checked; };

  const onKey = (event) => {
    if (state.route !== 'compare') return;
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const hit = (sel) => { const el = document.querySelector(sel); if (el) { event.preventDefault(); el.click(); } };
    if (event.key === ' ') hit('[data-act="cmp-play"]');
    if (event.key === 'ArrowRight') hit('[data-act="cmp-next"]');
    if (event.key === 'ArrowLeft') hit('[data-act="cmp-prev"]');
  };
  document.addEventListener('keydown', onKey);
  state.compare._key = onKey; // 重绘时不需要手动摘，页面切换后守卫会直接返回

  compareVideos().forEach((v) => {
    v.addEventListener('click', () => document.querySelector('[data-act="cmp-play"]').click());
  });

  root.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    const side = target.dataset.side;
    try {
      if (act === 'cmp-mode') { state.compare.mode = target.dataset.mode; return render(); }
      if (act === 'cmp-swap') { const a = state.compare.left; state.compare.left = state.compare.right; state.compare.right = a; return render(); }
      if (act === 'cmp-clear') { state.compare[side] = null; return render(); }
      if (act === 'cmp-clear-all') { state.compare.left = null; state.compare.right = null; return render(); }
      if (act === 'cmp-pick') return openComparePicker(side);
      if (act === 'cmp-local') return pickCompareLocal(side);
      if (act === 'cmp-play') {
        const vids = compareVideos();
        if (!vids.length) return;
        const playing = vids.some((v) => !v.paused);
        if (playing) vids.forEach((v) => v.pause());
        else {
          const t = compareTime();
          vids.forEach((v) => { if (Math.abs((v.currentTime || 0) - t) > 0.25) v.currentTime = t; v.playbackRate = Number(state.compare.speed) || 1; v.play().catch(() => {}); });
        }
        return;
      }
      if (act === 'cmp-prev' || act === 'cmp-next') {
        const step = act === 'cmp-next' ? 1 / 30 : -1 / 30;
        const vids = compareVideos();
        const t = Math.max(0, compareTime() + step);
        vids.forEach((v) => { v.currentTime = t; });
        return syncCompareSeek();
      }
      if (act === 'cmp-export') return exportCompare();
    } catch (err) { toast(err.message, true); }
  });
}

function openComparePicker(side) {
  const items = ((state.media && state.media.items) || []).filter((i) => i.kind === 'video' || i.kind === 'image');
  openModal(`
    <div class="modal-head"><h2>选择素材 · ${side === 'left' ? 'A' : 'B'}</h2><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body">
      ${items.length ? `<div class="grid-cards">${items.map((item, i) => `
        <div class="asset-card" data-pick="${i}">
          <div class="asset-thumb">${item.kind === 'video' ? `<video src="${item.url}#t=0.5" preload="metadata" muted></video>` : `<img src="${item.url}" loading="lazy" alt="" />`}</div>
          <div class="asset-meta"><span class="name">${esc(item.name)}</span><span class="sub">${esc(item.day || '')} · ${fmtBytes(item.bytes || 0)}</span></div>
        </div>`).join('')}</div>` : `<div class="empty"><strong>媒体库还没有成片</strong><p>先在视频创作台生成，或点右侧「本地文件」直接选一个视频。</p></div>`}
    </div>`);
  $$('#modal-panel [data-pick]').forEach((card) => {
    card.onclick = () => {
      const item = items[Number(card.dataset.pick)];
      state.compare[side] = { path: item.path, name: item.name, kind: item.kind, url: item.url };
      closeModal();
      render();
    };
  });
}

function pickCompareLocal(side) {
  const input = $('#file-input');
  input.accept = 'video/*,image/*';
  input.onchange = async () => {
    const file = (input.files || [])[0];
    input.value = '';
    if (!file) return;
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
      const saved = await api('/api/upload', { method: 'POST', body: { name: file.name, data } });
      state.compare[side] = { path: saved.path, name: saved.name, kind: file.type.startsWith('video') ? 'video' : 'image' };
      render();
    } catch (err) { toast(err.message, true); }
  };
  input.click();
}

async function exportCompare() {
  const left = compareItem('left');
  const right = compareItem('right');
  if (!left || !right) return toast('两侧都要有素材', true);
  const draw = (item) => new Promise((resolve, reject) => {
    if (item.kind === 'image') {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('读取图片失败'));
      img.src = '/api/file?path=' + encodeURIComponent(item.path);
      return;
    }
    const v = document.querySelector(`video[data-cmp-video="${item === left ? 'left' : 'right'}"]`);
    if (!v) return reject(new Error('视频还没准备好'));
    v.pause();
    resolve(v);
  });
  const [a, b] = await Promise.all([draw(left), draw(right)]);
  const w = 960;
  const fit = (source) => {
    const sw = source.videoWidth || source.naturalWidth || w;
    const sh = source.videoHeight || source.naturalHeight || 540;
    return { sw, sh, h: Math.round((sh / sw) * w) };
  };
  const fa = fit(a);
  const fb = fit(b);
  const height = Math.max(fa.h, fb.h);
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(a, 0, 0, w, fa.h);
  ctx.drawImage(b, w, 0, w, fb.h);
  const data = canvas.toDataURL('image/png');
  const name = 'compare-' + Date.now() + '.png';
  await api('/api/assets/upload', { method: 'POST', body: { name, data } });
  state.assets = await api('/api/assets');
  toast('已导出并排合成到素材库：' + name);
}


function askImageUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return '';
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(url)) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^\/(api|media|assets|wallpapers)\//.test(url)) return url;
  return '';
}

function mdInline(text) {
  let html = esc(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g, (whole, alt, src) => {
    const url = askImageUrl(src);
    if (!url) return whole;
    return `<span class="ask-inline-media"><img class="ask-inline-img" src="${url}" alt="${alt}" loading="lazy" data-act="ask-open-inline" data-url="${url}" data-label="${alt || '图片'}" /><span class="ask-inline-missing">图片未能加载 · ${esc(alt || url)}</span></span>`;
  });
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return html;
}

function markdownLite(text) {
  // 全角竖线也当表格分隔符：模型偶尔会混用 ｜ 和 |
  const src = String(text || '').replace(/\r\n/g, '\n').replace(/｜/g, '|');
  const chunks = src.split(/```/);
  let out = '';
  for (let c = 0; c < chunks.length; c += 1) {
    if (c % 2 === 1) {
      const code = chunks[c].replace(/^[a-zA-Z0-9_+-]*\n/, '').replace(/\n$/, '');
      out += '<pre class="script-code"><code>' + esc(code) + '</code></pre>';
      continue;
    }
    const lines = chunks[c].split('\n');
    let i = 0;
    let para = [];
    let list = null;
    const flushPara = () => {
      if (para.length) {
        out += '<p>' + para.map(mdInline).join('<br>') + '</p>';
        para = [];
      }
    };
    const flushList = () => {
      if (list) {
        out += '<' + list.type + '>' + list.items.map((t) => '<li>' + mdInline(t) + '</li>').join('') + '</' + list.type + '>';
        list = null;
      }
    };
    let guard = 0;
    while (i < lines.length) {
      if (++guard > 8000) break;
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) { flushPara(); flushList(); i += 1; continue; }
      if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        flushPara(); flushList();
        const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
        const header = cells(trimmed);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().includes('|')) { rows.push(cells(lines[i].trim())); i += 1; }
        out += '<div class="md-table"><table><thead><tr>' + header.map((h) => '<th>' + mdInline(h) + '</th>').join('') + '</tr></thead><tbody>'
          + rows.map((r) => '<tr>' + header.map((_, idx) => '<td>' + mdInline(r[idx] || '') + '</td>').join('') + '</tr>').join('')
          + '</tbody></table></div>';
        continue;
      }
      const h = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (h) { flushPara(); flushList(); const level = Math.min(6, h[1].length); out += '<h' + level + '>' + mdInline(h[2]) + '</h' + level + '>'; i += 1; continue; }
      if (/^([-*_])\1{2,}$/.test(trimmed)) { flushPara(); flushList(); out += '<hr>'; i += 1; continue; }
      if (/^>\s?/.test(trimmed)) {
        flushPara(); flushList();
        const quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
        out += '<blockquote>' + markdownLite(quote.join('\n')) + '</blockquote>';
        continue;
      }
      const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (ol) {
        flushPara();
        if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
        list.items.push(ol[1]); i += 1; continue;
      }
      const ul = /^\s*[-*+]\s+(.+)$/.exec(line);
      if (ul) {
        flushPara();
        if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
        list.items.push(ul[1]); i += 1; continue;
      }
      flushList();
      para.push(trimmed);
      i += 1;
    }
    flushPara(); flushList();
  }
  return out;
}
