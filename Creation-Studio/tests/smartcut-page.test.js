'use strict';
// 智能剪辑页：真页面、真对话、真引擎状态，不是摆着好看的壳子
//
// 这一页的契约有三条：
//   1. 对话走 /api/agent/chat 的 SSE，事件按 delta / tool_call / tool_result / media / artifact / done 分别落位；
//   2. 引擎（剪映草稿 / Concat）只是执行后端，二级菜单和页面顶部切的是同一个状态；
//   3. 剪辑单从助手正文的 ```json 里解析，没有就说没有，不摆假数据。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const html = read('web/index.html');
const app = read('web/app.js');
const nav = read('web/shell-nav.js');
const page = read('web/smartcut.js');
const css = read('web/smartcut.css');

test('页面资源接进了 index.html，且 smartcut.js 先于 app.js 加载', () => {
  assert.match(html, /<link rel="stylesheet" href="\/smartcut\.css\?v=\d+"/);
  const atPage = html.indexOf('smartcut.js');
  const atApp = html.indexOf('app.js?v=');
  assert.ok(atPage > 0 && atApp > atPage, 'smartcut.js 必须在 app.js 之前，否则 mount 时模块还没定义');
  assert.match(html, /app\.js\?v=proj5\d/);
  assert.match(html, /shell-nav\.js\?v=\d+/);
});

test('智能剪辑是真路由：不套 page-scroll，自己撑满并挂载模块', () => {
  assert.match(app, /state\.route === 'smartcut'\) html = renderSmartCut\(\);/);
  assert.doesNotMatch(app, /page-scroll' \+ renderSmartCut\(\)/);
  assert.match(app, /function renderSmartCut\(\) \{\s*return '<div class="sc-page" id="sc-page"><\/div>';/);
  assert.match(app, /SMARTCUT\.mount\(host\.querySelector\('\.sc-page'\)/);
  // 依赖是显式传进去的（项目 id / 项目名 / markdown / toast），不让模块去偷全局
  assert.match(app, /projectId: askProjectId\(\)/);
  assert.match(app, /markdown: askMarkdown/);
  assert.match(app, /toast,\s*\}\);/);
});

test('二级菜单是「执行引擎」，两项，和页面顶部同一个状态', () => {
  const at = nav.indexOf('smartcut: {');
  assert.ok(at > 0, '二级菜单里没有 smartcut');
  const block = nav.slice(at, nav.indexOf('assets: {', at));
  assert.match(block, /剪映草稿[\s\S]*?value: 'jianying'/);
  assert.match(block, /Concat 引擎[\s\S]*?value: 'concat'/);
  assert.match(nav, /route === 'smartcut' && item\.value/);
  assert.match(nav, /window\.SMARTCUT\.state\(\)\.engine/);
  assert.match(nav, /shellRoute === 'smartcut'[\s\S]*?__editSetEngine/);
  assert.match(page, /window\.__editSetEngine = function \(id\)/);
});

test('切换引擎只换执行后端，页面重新拉引擎状态并落盘', () => {
  const at = page.indexOf('function setEngine(');
  assert.ok(at > 0);
  const fn = page.slice(at, page.indexOf('window.__editSetEngine', at));
  assert.match(fn, /renderStatus\(\)/);
  assert.match(fn, /save\(\)/);
  assert.match(fn, /engineOf\(id\)\.note/);
  // 不许偷偷把剪辑单改成新引擎的东西：只提示旧单作废
  assert.match(fn, /剪辑单按旧引擎作废/);
});

test('对话走 /api/agent/chat，带 session_id 与权限档', () => {
  assert.match(page, /fetch\('\/api\/agent\/chat'/);
  assert.match(page, /session_id: S\.sid/);
  assert.match(page, /permission: 'workspace'/);
  assert.match(page, /'X-Project-Id'/);
  assert.match(page, /res\.headers\.get\('X-Agent-Run-Id'\)/);
});

test('SSE 事件全部有落点：正文、轨迹、产物、结束', () => {
  ['delta', 'replace', 'tool_call', 'tool_result', 'media', 'artifact', 'done'].forEach((type) => {
    assert.match(page, new RegExp("case '" + type + "':"), '事件 ' + type + ' 没接');
  });
  // 工具名形如 mcp__server__tool，轨迹里要拆成人看得懂的两段
  assert.match(page, /indexOf\('mcp__'\) === 0/);
  assert.match(page, /function toolName\(/);
});

test('停止按钮真的发 cancel，不是只改文字', () => {
  assert.match(page, /\/api\/agent\/runs\/' \+ encodeURIComponent\(runId\) \+ '\/cancel/);
  assert.match(page, /controller\.abort\(\)/);
  assert.match(page, /button\.classList\.toggle\('is-stop', S\.running\)/);
});

test('引擎状态读的是应用包真实探活结果，不是写死的', () => {
  assert.match(page, /fetch\('\/api\/agent\/mcp\/servers'/);
  assert.match(page, /items\.filter\(function \(x\) \{ return x\.name === engine\.server; \}\)/);
  assert.match(page, /引擎未挂：应用包 mcp_servers 里没有/);
  assert.match(page, /' 连不上 · '/);
});

test('剪辑单只从正文的 json 里解析，字段不对就不画卡', () => {
  const at = page.indexOf('function extractPlan(');
  assert.ok(at > 0);
  const fn = page.slice(at, page.indexOf('function planHtml(', at));
  assert.match(fn, /```json/);
  assert.match(fn, /Array\.isArray\(obj\.clips\)/);
  assert.match(fn, /catch \(error\)/);
  // 卡片必须来自解析结果，不在源码里写死一份样片
  assert.doesNotMatch(page, /她走了九十九天/);
  assert.doesNotMatch(page, /雪山脚下的站牌/);
});

test('样式跟着壳体主题走，不写死颜色', () => {
  assert.match(css, /var\(--wmd-bg-0\)/);
  assert.match(css, /var\(--wmd-border\)/);
  assert.match(css, /var\(--wmd-accent\)/);
  // 白昼/夜间切换靠 token，页面里不该出现 #000 / #fff 这种硬编码底色
  assert.doesNotMatch(css, /background:\s*#0{3}/);
  assert.doesNotMatch(css, /background:\s*#fff\b/);
});
