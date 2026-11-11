'use strict';
// 剪辑台停靠（M1 伪嵌入）：坐标怎么算、后端怎么拦、窗口怎么归位。
//
// 这一层的契约只有四条：
//   1. 坐标 = 视口原点(screenX/screenY) + 预留区(left/top)，乘 devicePixelRatio 换物理像素；
//   2. 换算只做一次（前端报 CSS 像素 + scale，后端乘），两边都乘就会偏一半；
//   3. /api/local/dock 只认回环地址：能挪原生窗口的接口不能让远程调；
//   4. 收起/还原要把标题栏还给用户，不能留一个没边框的盖子悬在页面上。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const html = read('web/index.html');
const server = read('src/server.js');
const routes = read('src/local-dock-routes.js');
const dockModule = read('src/local-dock.js');
const host = read('web/dock-host.js');
const page = read('web/smartcut.js');
const css = read('web/smartcut.css');
const agent = fs.readFileSync(path.join(ROOT, '..', 'tools', 'concat-dev', 'dock-agent.ps1'), 'utf8');

/* ---------------------------------------------------------------- 接线 */

test('前端停在 smartcut.js 之前加载，后端路由挂在 workbench 之前', () => {
  const atHost = html.indexOf('dock-host.js');
  const atPage = html.indexOf('smartcut.js');
  assert.ok(atHost > 0 && atPage > atHost, 'dock-host.js 必须先于 smartcut.js，否则 mount 时 DockHost 还不存在');
  assert.match(html, /dock-host\.js\?v=\d+/);
  assert.match(server, /const localDockRoutes = require\('\.\/local-dock-routes'\)/);
  const atRoutes = server.indexOf('await localDockRoutes(');
  const atWorkbench = server.indexOf('await workbenchRoutes(');
  assert.ok(atRoutes > 0 && atWorkbench > atRoutes, 'localDockRoutes 要在 workbenchRoutes 之前，否则 /api/local/dock 会被它当未知接口吞掉');
  assert.match(server, /'\/dock-host\.js': \['dock-host\.js', 'text\/javascript; charset=utf-8'\]/);
});

test('版面是「原生剪辑页 + 右侧对话」：左边整块画布留给窗口，右边窄栏才是对话', () => {
  // 左边画布：停靠后原生窗口正好盖满它，页面看起来就是编辑器本身
  assert.match(page, /'<div class="sc-canvas" id="sc-dock">' \+ dockEmpty\(\)/);
  assert.match(page, /class="sc-dock-stage" id="sc-dock-stage"/);
  assert.match(page, /data-dock="open"/);
  // 右边对话栏
  assert.match(page, /'<aside class="sc-rail" id="sc-rail">'/);
  assert.match(page, /id="sc-thread"/);
  // 顶条上的两个动作：打开剪辑台 / 还原成窗口，外加载对话的开关
  assert.match(page, /data-dock="restore"/);
  assert.match(page, /data-dock="toggle"/);
  assert.match(css, /\.sc-canvas \{ flex: 1; min-width: 0;/);
  assert.match(css, /\.sc-rail \{[\s\S]*?width: clamp\(340px, 26%, 460px\)/);
  assert.match(css, /\.sc-rail\.is-closed \{ display: none/);
  // 挂载时接上停靠，重新挂载前先拆旧监听
  assert.match(page, /if \(S\.dock && S\.dock\.destroy\)/);
  assert.match(page, /S\.dock = window\.DockHost\.attach\(\{/);
});
/* ---------------------------------------------------------------- 坐标 */

function loadRectOf(fake) {
  const box = { window: fake };
  const source = host
    .replace(/^\(function \(\) \{/m, '(function () {')
    .replace(/\}\)\(\);\s*$/, '})();');
  new Function('window', 'fetch', 'ResizeObserver', 'document', source)(
    fake.window, () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) }), undefined, { querySelector: () => null }
  );
  return box.window.DockHost.rectOf;
}

function fakeWindow({ screenX, screenY, dpr }) {
  const win = {
    screenX, screenY, devicePixelRatio: dpr,
    addEventListener() {}, removeEventListener() {},
    setInterval() { return 1; }, clearInterval() {},
    requestAnimationFrame() { return 1; },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) })
  };
  win.window = win;
  return win;
}

test('坐标 = 视口原点 + 预留区偏移，单位仍是 CSS 像素', () => {
  const win = fakeWindow({ screenX: 100, screenY: 50, dpr: 1 });
  const stage = { getBoundingClientRect: () => ({ left: 260, top: 140, width: 800, height: 600 }) };
  loadRectOf(win);
  const rect = win.DockHost.rectOf(stage);
  assert.deepEqual(rect, { x: 360, y: 190, w: 800, h: 600, scale: 1 });
});

test('缩放交给 scale 带过去，前端不自己乘（两边都乘会偏一半）', () => {
  const win = fakeWindow({ screenX: 0, screenY: 0, dpr: 1.5 });
  const stage = { getBoundingClientRect: () => ({ left: 40, top: 30, width: 800, height: 500 }) };
  loadRectOf(win);
  const rect = win.DockHost.rectOf(stage);
  assert.equal(rect.scale, 1.5);
  assert.equal(rect.w, 800, '前端报的还是 CSS 像素');
  assert.equal(rect.x, 40);
});

test('后端按 scale 换成物理像素，并且给窗口一个下限', () => {
  const at = dockModule.indexOf('async function dock(box)');
  assert.ok(at > 0);
  const fn = dockModule.slice(at, dockModule.indexOf('async function restore()', at));
  assert.match(fn, /const scale = Number\(box\.scale\) > 0 \? Number\(box\.scale\) : 1;/);
  assert.match(fn, /x: Math\.round\(Number\(box\.x \|\| 0\) \* scale\)/);
  assert.match(fn, /w: Math\.max\(200, Math\.round\(Number\(box\.w \|\| 0\) \* scale\)\)/);
  assert.match(fn, /h: Math\.max\(120, Math\.round\(Number\(box\.h \|\| 0\) \* scale\)\)/);
});

/* ---------------------------------------------------------------- 安全 */

test('停靠接口只认回环：远程来的请求一律 403', () => {
  assert.match(routes, /function isLoopback\(req\)/);
  assert.match(routes, /ip === '127\.0\.0\.1' \|\| ip === '::1'/);
  assert.match(routes, /if \(!isLoopback\(req\)\) \{[\s\S]*?error\.status = 403/);
  assert.match(routes, /窗口停靠只对这台机器生效/);
});

test('四个接口都在，参数不合法时给人话不摆栈', () => {
  assert.match(routes, /pathname === '\/api\/local\/dock\/dock'/);
  assert.match(routes, /pathname === '\/api\/local\/dock\/restore'/);
  assert.match(routes, /pathname === '\/api\/local\/dock\/launch'/);
  assert.match(routes, /method === 'GET' && pathname === '\/api\/local\/dock'/);
  assert.match(routes, /预留区域太小了/);
  assert.match(routes, /剪辑台还没开：先在页面里点「打开剪辑台」/);
});

/* ---------------------------------------------------------------- 代理 */

test('代理是常驻进程：stdin/stdout 走 JSON 行，短命 spawn 会被拖慢到不可用', () => {
  assert.match(dockModule, /const IDLE_MS = 90 \* 1000/);
  assert.match(dockModule, /spawn\(POWERSHELL, \['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', AGENT_SCRIPT\]/);
  assert.match(dockModule, /child\.stdout\.on\('data'/);
  assert.match(dockModule, /message\.cmd === 'ready'/);
  assert.match(dockModule, /idleTimer = setTimeout\(\(\) => \{ stopAgent\('idle'\); \}, IDLE_MS\)/);
  assert.match(agent, /while \(\$true\) \{/);
  assert.match(agent, /\[Console\]::In\.ReadLine\(\)/);
});

test('代理声明 DPI 感知，否则 150% 缩放下坐标会被系统再折一遍', () => {
  assert.match(agent, /SetProcessDpiAwarenessContext\(\[IntPtr\]\$\(-4\)\)/);
  assert.match(agent, /GetDpiForWindow/);
  assert.match(agent, /SWP_NOACTIVATE/);
});

test('还原要把标题栏和边框装回去', () => {
  assert.match(agent, /'restore' \{[\s\S]*?\$style -bor \$WS_CAPTION -bor \$WS_THICKFRAME/);
  assert.match(dockModule, /async function restore\(\)/);
  assert.match(dockModule, /lastRect = null;/);
});

test('启动 Concat 时把 ffmpeg 的 bin 塞进 PATH，否则少 DLL 直接闪退', () => {
  assert.match(dockModule, /const FFMPEG_BIN = process\.env\.WMD_FFMPEG_BIN/);
  assert.match(dockModule, /if \(fs\.existsSync\(FFMPEG_BIN\)\) parts\.push\(FFMPEG_BIN\)/);
  assert.match(dockModule, /detached: true/);
  assert.match(dockModule, /child\.unref\(\)/);
});

