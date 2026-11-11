'use strict';

/* app.oneclick.js — 一键成片 / 剪辑台 / 智能上剧
 * 由 web/app.js 按原段注释切分而来（第 5530–5595 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */

/* -------------------------------------------------- 一键成片 */

// 三个模式只有入参不同，成片管线是同一套。表单按模式分开做，先把菜单和壳子立起来。
window.__oneclickSetMode = (mode) => {
  const next = ONECLICK_MODES.find((m) => m.id === mode);
  if (!next) return false;
  state.oneclick.mode = next.id;
  if (state.route !== 'oneclick') {
    location.hash = '#oneclick?mode=' + next.id;
    return true;
  }
  syncHash('oneclick', { mode: next.id });
  render();
  return true;
};

function renderOneClick() {
  const mode = ONECLICK_MODES.find((m) => m.id === state.oneclick.mode) || ONECLICK_MODES[0];
  return `
  <div class="page-head">
    <div>
      <h1>一键成片</h1>
      <p class="hint">${esc(mode.name)} · 入参：${esc(mode.input)}</p>
    </div>
    <div class="page-actions"><span class="chip">待接入</span></div>
  </div>
  <div class="card">
    <div class="empty">
      <strong>${esc(mode.name)}的输入区还没做</strong>
      <p>三个模式只是入参不同（小说正文 / 剧本 / 一句话灵感），后面的成片管线是同一套。输入区按模式分别做，先留空。</p>
    </div>
  </div>`;
}

/* -------------------------------------------------- 剪辑台 / 智能上剧 */

// 剪辑台：系统里的一个页面。左边剪、右边说，引擎在后台 headless 跑。
// 宿主节点自撑满高度，避免和 page-scroll 的滚动容器打架。
function renderConcat() {
  return '<div class="ce-page-host" id="ce-host"></div>';
}

function renderSmartRelease() {
  return `
  <div class="page-head">
    <div>
      <h1>智能上剧</h1>
      <p class="hint">把剪好的成片按集号组织成剧集，管排期和上线状态。</p>
    </div>
    <div class="page-actions"><span class="chip">待接入</span></div>
  </div>
  <div class="card">
    <div class="empty">
      <strong>成剧管线还没接</strong>
      <p>成片一集一集躺在媒体库里，现在还没有一个地方把它们按集组织成剧、记录哪一集剪到哪一步、什么时候上线。</p>
    </div>
  </div>`;
}
