'use strict';
// Summary 面板的上下文分项：固定环节、堆叠条、英文标题
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const start = source.indexOf('// 最近一次运行带来的上下文分项统计');
const end = source.indexOf('function askSummaryHtml(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到上下文分项渲染函数');

const box = {};
new Function('module', 'exports', `
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = { project: { name: '我的同桌测试', dir: 'D:\\\\notebook\\\\AIGC\\\\WENYUN.M-DESKTOP-Projects\\\\我的同桌测试-643a02' } };
const askProjectId = () => 'proj-b1a9643a02';
let CURRENT = { toolsSupported: true, skillId: '' };
const askState = () => CURRENT;
const askSkill = () => ({ name: '小说创作' });
const askFmtTokens = (value) => {
  const n = Math.max(0, Math.round(Number(value) || 0));
  if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + 'm';
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0) + 'k';
  return String(n);
};
${source.slice(start, end)}
module.exports = { askContextReport, askContextBlockHtml, askEnvironmentHtml, askFolderName, askConnectorsHtml, askOutputsHtml, askChangesHtml, askFileKind, setConn: (v) => { CURRENT = { ...CURRENT, ...v }; } };
`)(box, box.exports);

const { askContextReport, askContextBlockHtml, askEnvironmentHtml, askFolderName, askConnectorsHtml, askOutputsHtml, askChangesHtml, askFileKind, setConn } = box.exports;

const REPORT = {
  schema_version: 'context-report/1',
  window: 1000000,
  used: 139400,
  used_percent: 13.94,
  reserved: 150000,
  free: 710600,
  messages: 22,
  tool_count: 26,
  skill_count: 4,
  tool_names: ['read_file', 'write_file', 'run_command'],
  items: [
    { key: 'messages', label: 'Messages', tokens: 75400, percent: 7.54 },
    { key: 'tools', label: 'System tools', tokens: 40000, percent: 4 },
    { key: 'skills', label: 'Skills', tokens: 14000, percent: 1.4 },
    { key: 'system', label: 'System prompt', tokens: 10000, percent: 1 },
    { key: 'buffer', label: 'Autocompact buffer', tokens: 150000, percent: 15 },
    { key: 'free', label: 'Free space', tokens: 710600, percent: 71.06 },
  ],
};

const chatWith = (...executions) => ({
  messages: executions.map((report, index) => ({ id: 'm' + index, role: 'assistant', text: 'x', execution: report ? { context: { report } } : { status: 'completed' } })),
});

test('分项统计取最近一次运行的回执', () => {
  const older = { ...REPORT, window: 500000 };
  assert.equal(askContextReport(chatWith(older, REPORT)).window, 1000000);
  assert.equal(askContextReport(chatWith(REPORT, null)).window, 1000000);
  assert.equal(askContextReport(chatWith(null)), null);
  assert.equal(askContextReport(null), null);
});

test('没有运行时给出清晰的空状态，不假装有数字', () => {
  const html = askContextBlockHtml(chatWith(null), { ratio: 0.23, used: 23000, total: 100000 });
  assert.match(html, /23% used/);
  assert.match(html, /这个会话还没跑过/);
  assert.doesNotMatch(html, /Messages/);
});

test('有运行回执时六个固定环节各一行，标题为英文', () => {
  const html = askContextBlockHtml(chatWith(REPORT), { ratio: 0.1, used: 1, total: 1000000 });
  for (const label of ['Messages', 'System tools', 'Skills', 'System prompt', 'Autocompact buffer', 'Free space']) {
    assert.match(html, new RegExp('>' + label + '<'));
  }
  assert.match(html, /14% used/);
  assert.match(html, /75400|75\.4k/);
  assert.equal(html.includes('messages ·'), false, '只要固定模块，不加额外计数行');
  assert.equal(html.includes('估算口径'), false, '面板不该解释 token 怎么算的');
  assert.equal(html.includes('这是给输出'), false);
  // 每项占比例挂在堆叠条上，宽度按窗口归一
  assert.match(html, /class="ask-ctx-seg is-messages" style="width:7\.54%"/);
  assert.match(html, /class="ask-ctx-seg is-free" style="width:71\.06%"/);
});

test('中文标题不再出现在上下文分项里', () => {
  const html = askContextBlockHtml(chatWith(REPORT), { ratio: 0, used: 0, total: 1 });
  assert.doesNotMatch(html, /暂无分项计量|系统提示词|>消息<|>工具<|>技能</);
});

test('工具清单可以点开看具体工具名（对应参考里的 MCP tools 展开）', () => {
  const html = askContextBlockHtml(chatWith(REPORT), { ratio: 0, used: 0, total: 1 });
  assert.match(html, /<details class="ask-ctx-tools"><summary>Tools · 26<\/summary>/);
  assert.match(html, /<span>read_file<\/span>/);
  assert.match(html, /<span>run_command<\/span>/);
});

test('环境只有三行：本机 / 项目文件夹 / git 分支（没有 git 逻辑就显示 null）', () => {
  const html = askEnvironmentHtml();
  assert.match(html, /This Computer/);
  assert.match(html, /我的同桌测试-643a02/);
  assert.match(html, />null</);
  assert.equal((html.match(/ask-env-row/g) || []).length, 3);
  assert.doesNotMatch(html, /Workspace|Project<|Path<|Model|Permission/);
});

test('项目文件夹名取目录最后一段，不同项目不同', () => {
  assert.equal(askFolderName('D:\\notebook\\AIGC\\WENYUN.M-DESKTOP-Projects\\我的同桌测试-643a02'), '我的同桌测试-643a02');
  assert.equal(askFolderName('D:\\x\\骨灯短剧'), '骨灯短剧');
  assert.equal(askFolderName(''), '');
});

test('折叠箭头在文字后面（简单 ›），不用系统自带的黑色三角', () => {
  const css = fs.readFileSync(path.join(__dirname, '../web/agent-workspace.css'), 'utf8');
  assert.match(css, /\.ask-summary summary::-webkit-details-marker \{ display: none; \}/);
  assert.match(css, /\.ask-summary summary::marker \{ content: ''; \}/);
  assert.match(css, /\.ask-summary summary::after \{ content: '›'/);
  assert.match(css, /\.ask-summary details\[open\] > summary::after \{ transform: rotate\(90deg\); \}/);
});

test('Connectors 用 T / S / C 小徽标，没有的显示 null', () => {
  setConn({ toolsSupported: true, skillId: '' });
  const html = askConnectorsHtml();
  assert.equal((html.match(/ask-conn-badge/g) || []).length, 3);
  assert.match(html, />T</);
  assert.match(html, />S</);
  assert.match(html, />C</);
  assert.match(html, /Tools · available/);
  assert.match(html, /Skill · null/);
  assert.match(html, /MCP · null/);
  setConn({ toolsSupported: false, skillId: 'novel' });
  const on = askConnectorsHtml();
  assert.match(on, /Tools · unavailable/);
  assert.match(on, /Skill · 小说创作/);
});

test('输出文件按类型给图标：md 文本、xlsx 表格、py 代码…', () => {
  assert.equal(askFileKind('夹层·档案员系列开篇（定稿）.md'), 'text');
  assert.equal(askFileKind('分集表.xlsx'), 'sheet');
  assert.equal(askFileKind('render.js'), 'code');
  assert.equal(askFileKind('build.py'), 'code');
  assert.equal(askFileKind('封面.png'), 'image');
  assert.equal(askFileKind('成片.mp4'), 'video');
  assert.equal(askFileKind('配音.mp3'), 'audio');
  assert.equal(askFileKind('合同.pdf'), 'pdf');
  assert.equal(askFileKind('包.bin'), 'file');
  const html = askOutputsHtml([{ type: 'artifact', file: { id: 'f1', name: '分集表.xlsx' } }, { type: 'artifact', file: { id: 'f2', name: '第一集.md' } }]);
  assert.match(html, /ask-file-ico/);
  assert.match(html, /<span class="ask-file-name">分集表.xlsx<\/span>/);
  assert.equal((html.match(/<svg/g) || []).length, 2);
});

test('没有输出文件就显示灰色的 null', () => {
  const html = askOutputsHtml([], null);
  assert.equal(html, '<div class="ask-output-empty">null</div>');
});

test('Changes 固定一个小图标 + null，不再摆 +0 −0', () => {
  const html = askChangesHtml();
  assert.match(html, /ask-changes-ico/);
  assert.match(html, /<span class="ask-changes-text">null<\/span>/);
  assert.match(html, /Create PR/);
  assert.match(html, /disabled/);
  assert.equal(html.includes('+0'), false);
});
