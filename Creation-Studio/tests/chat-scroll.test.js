'use strict';
// 生成过程中往上翻，不能被拽回底部。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();
const start = source.indexOf('function askFollowBottom()');
const end = source.indexOf('function askBindScrollPin(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到 askFollowBottom');

const box = {};
new Function('module', 'exports', `
let CURRENT = null;
function askState() { return CURRENT; }
${source.slice(start, end)}
module.exports = { askFollowBottom, set(v) { CURRENT = v; } };
`)(box, box.exports);
const { askFollowBottom, set } = box.exports;

test('默认跟随底部，用户往上翻后停止跟随', () => {
  set({ pinBottom: undefined });
  assert.equal(askFollowBottom(), true, '还没滚过时应跟随底部');
  set({ pinBottom: true });
  assert.equal(askFollowBottom(), true);
  set({ pinBottom: false });
  assert.equal(askFollowBottom(), false, '用户往上翻后不应跟随');
});

test('三处重绘都受“是否跟随底部”约束', () => {
  const renderAll = source.slice(source.indexOf('function askRenderAll()'), source.indexOf('// 是否跟随到底部'));
  assert.ok(renderAll.includes('askFollowBottom()'), 'askRenderAll 要判断是否跟随');
  const renderMessages = source.slice(source.indexOf('function askRenderMessages()'), source.indexOf('/* ------------------------------- 行为'));
  assert.ok(renderMessages.includes('askFollowBottom()'), 'askRenderMessages 要判断是否跟随');
  const renderStreaming = source.slice(source.indexOf('function askRenderStreaming()'), source.indexOf('function askRevealKick('));
  assert.ok(renderStreaming.includes('askFollowBottom()'), 'askRenderStreaming 要判断是否跟随');
  assert.equal(/if \(atBottom\) host\.scrollTop/.test(source), false, '旧的局部 atBottom 判断应已被替换');
});

test('发新消息会重新跟随底部', () => {
  const send = source.slice(source.indexOf('async function askSend('), source.indexOf('async function askStop('));
  assert.ok(send.includes('a.pinBottom = true'), '发消息时应重新贴底');
});

test('用户往上翻时停止逐帧重绘', () => {
  const reveal = source.slice(source.indexOf('function askRevealStep()'), source.indexOf('function askScrollBottom()'));
  assert.ok(reveal.includes('askFollowBottom()'), '逐字动画也要看是否在底部');
});

test('右侧轮次滑条：一轮一格，面板打开时隐藏', () => {
  assert.ok(source.includes('function askTurnsHtml('), '需要有轮次滑条渲染函数');
  const turns = source.slice(source.indexOf('function askTurnsHtml('), source.indexOf('function askSyncTurns('));
  assert.ok(turns.includes("a.previewFile || a.mediaPreview || a.capabilitiesOpen"), '右侧有面板时不显示滑条');
  assert.ok(turns.includes("m.role === 'user'"), '只统计用户轮次');
  assert.ok(turns.includes('data-act="ask-jump"'), '每格要能点击跳转');
  assert.ok(source.includes("if (act === 'ask-jump')"), '需要跳转的事件处理');
  const jump = source.slice(source.indexOf('function askJumpToTurn('), source.indexOf('function askMediaModalHtml('));
  assert.ok(jump.includes('pinBottom = false'), '跳转时要暂停自动贴底');
  assert.ok(jump.includes('settle'), '图片加载后要校正滚动位置');
});

test('滑条悬停提示只取问题前 20 个字', () => {
  const turns = source.slice(source.indexOf('function askTurnsHtml('), source.indexOf('function askSyncTurns('));
  assert.ok(turns.includes('data-tip='), '每格要有悬停文案');
  assert.ok(/slice\(0, 20\)/.test(turns), '只取前 20 个字符');
  assert.ok(source.includes('function askBindTurnTips('), '需要自定义浮动提示');
  assert.ok(source.includes('ask-turn-tip'), '提示元素要存在');
});

test('滑条不占布局宽度，保证聊天区和输入框对齐', () => {
  const css = fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8');
  const body = css.slice(css.indexOf('.ask-chat-body {'), css.indexOf('.ask-turns {'));
  assert.ok(body.includes('position:relative'), '容器要能承载绝对定位的滑条');
  const rail = css.slice(css.indexOf('.ask-turns {'), css.indexOf('.ask-turns button {'));
  assert.ok(rail.includes('position:absolute'), '滑条必须绝对定位，不能挤压消息区');
  assert.equal(/\.ask-turns \{[^}]*flex:none/.test(rail), false, '滑条不应再作为 flex 子项占宽');
});

/* ---- 打开预览（图片 / 文本）后不能被甩回聊天开头 ---- */

const helperStart = source.indexOf('const askScrollHold =');
const helperEnd = source.indexOf('function askBindScrollPin(');
assert.ok(helperStart > 0 && helperEnd > helperStart, '在 app.js 里找不到滚动恢复助手');

const hbox = {};
let CURRENT_STATE = null;
new Function('module', 'exports', 'document', 'requestAnimationFrame', 'setTimeout', 'askState', 'window', 'console', `
${source.slice(helperStart, helperEnd)}
module.exports = { askCaptureScroll, askRestoreScroll, askHoldScroll, askNoteScroll, askLastScroll, askReportScrollJump };
`)(hbox, hbox.exports, { body: { contains: () => true } }, (fn) => fn(), () => 0, () => CURRENT_STATE, {}, { warn: () => {} });
const { askCaptureScroll, askRestoreScroll, askNoteScroll, askLastScroll, askReportScrollJump } = hbox.exports;

// 造一个假聊天区：节点 base 是它在内容流里的纵坐标，滚动时视觉位置随 scrollTop 上移
function makeHost(heights, scrollTop = 0) {
  let base = 0;
  const nodes = heights.map((height, i) => {
    const node = {
      dataset: { msgId: 'm' + i },
      classList: { contains: (c) => c === 'ask-message' },
      height,
    };
    node.base = base;
    base += height;
    node.getBoundingClientRect = () => ({
      top: node.base - host.scrollTop,
      bottom: node.base - host.scrollTop + node.height,
    });
    return node;
  });
  const list = { children: nodes };
  const host = {
    nodes,
    scrollTop,
    clientHeight: 400,
    scrollHeight: base,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelector: (sel) => (sel === '.ask-message-list' ? list : null),
  };
  return host;
}

test('记下视口顶部压在哪条消息，重绘后按同一条复位', () => {
  const before = makeHost(Array(10).fill(300), 900);
  const view = askCaptureScroll(before);
  assert.equal(view.atBottom, false);
  assert.equal(view.id, 'm3', '顶部应是第 4 条消息');
  assert.equal(view.offset, 0);

  // 打开预览面板后正文变窄、每条变高：整块重绘 scrollTop 归零
  const after = makeHost(Array(10).fill(380), 0);
  askRestoreScroll(after, view);
  assert.equal(Math.round(after.nodes[3].getBoundingClientRect().top), 0, '第 4 条应仍贴在视口顶部');
});

test('记录消息内的偏移量，不会把半条消息顶到别处', () => {
  const before = makeHost(Array(10).fill(300), 950);
  const view = askCaptureScroll(before);
  assert.equal(view.id, 'm3');
  assert.equal(view.offset, -50, '已经划过去 50px');
  const after = makeHost(Array(10).fill(380), 0);
  askRestoreScroll(after, view);
  assert.equal(Math.round(after.nodes[3].getBoundingClientRect().top), -50, '偏移要保持一致');
});

test('本来就在底部就继续贴底', () => {
  const before = makeHost(Array(6).fill(300));
  before.scrollTop = before.scrollHeight - 400;
  const view = askCaptureScroll(before);
  assert.equal(view.atBottom, true);
  const after = makeHost(Array(6).fill(340), 0);
  askRestoreScroll(after, view);
  assert.equal(after.scrollTop, after.scrollHeight - after.clientHeight, '应停在底部');
});

test('按消息 id 重新定位，消息增删后也不会错位', () => {
  const before = makeHost(Array(10).fill(300), 900);
  const view = askCaptureScroll(before);
  const after = makeHost(Array(10).fill(300), 0);
  after.nodes.unshift({ dataset: { msgId: 'new' }, classList: { contains: () => true }, height: 200, base: 0, getBoundingClientRect: () => ({ top: 0, bottom: 200 }) });
  askRestoreScroll(after, view);
  const target = after.nodes.find((n) => n.dataset.msgId === 'm3');
  assert.equal(Math.round(target.getBoundingClientRect().top), 0, '按 id 找到同一条消息');
});

test('开预览的重绘路径都接上了记录与恢复', () => {
  const renderAll = source.slice(source.indexOf('function askRenderAll()'), source.indexOf('// 是否跟随到底部'));
  assert.ok(renderAll.includes('askCaptureScroll('), 'askRenderAll 重绘前要记录');
  assert.ok(renderAll.includes('askHoldScroll(msgs, chatScroll)'), 'askRenderAll 重绘后要恢复');
  const renderMessages = source.slice(source.indexOf('function askRenderMessages()'), source.indexOf('/* ------------------------------- 行为'));
  assert.ok(renderMessages.includes('askCaptureScroll('), 'askRenderMessages 重绘前要记录');
  assert.ok(renderMessages.includes('askHoldScroll(host, view)'), 'askRenderMessages 重绘后要恢复');
  for (const act of ['ask-open-inline', 'ask-open-media', 'ask-close-pane', 'ask-preview']) {
    assert.ok(source.includes(`'${act}'`), act + ' 事件要存在');
  }
});

/* ---- 删掉一轮之后：视口要么停在新末尾，要么跟着内容往上补，不能回到第一条 ---- */

test('锚点那一轮被删掉时按内容高度差补偿，不回开头', () => {
  const before = makeHost(Array(10).fill(300), 2400); // 视口压在第 9 条
  const view = askCaptureScroll(before);
  assert.equal(view.id, 'm8');
  // 删掉这一轮：只剩 8 条，总高 2400，新容器 scrollTop 从 0 开始
  const after = makeHost(Array(8).fill(300), 0);
  askRestoreScroll(after, view);
  assert.equal(after.scrollTop, 1800, '内容缩短 600px，位置就跟着上移 600px');
  assert.ok(after.scrollTop > 0, '不能回到开头');
  assert.ok(after.scrollTop <= after.scrollHeight - after.clientHeight, '不出界');
});

test('删掉末尾一轮时，贴底或正看着它才落到新末尾', () => {
  const del = source.slice(source.indexOf("if (act === 'ask-delete-turn')"), source.indexOf("if (act === 'ask-jump')"));
  assert.ok(del.includes('const atEnd = span.end >= before'), '要判断删的是不是末尾这一轮');
  assert.ok(del.includes('const stillThere ='), '要看视口锚点是不是被一起删掉了');
  assert.ok(del.includes('view0.atBottom'), '本来就贴底就继续贴底');
  assert.ok(del.includes('atEnd && !stillThere'), '正看着被删的那一轮时落到新末尾');
  assert.ok(del.includes("a.scrollIntent = 'bottom'"), '贴底要走显式意图');
  const renderAll = source.slice(source.indexOf('function askRenderAll()'), source.indexOf('// 是否跟随到底部'));
  assert.ok(renderAll.includes("a.scrollIntent === 'bottom'"), 'askRenderAll 要认这个意图');
  assert.ok(renderAll.includes('askHoldScroll(msgs, { atBottom: true })'), '贴底走 atBottom 分支');
  const renderMessages = source.slice(source.indexOf('function askRenderMessages()'), source.indexOf('/* ------------------------------- 行为'));
  assert.ok(renderMessages.includes("a.scrollIntent === 'bottom'"), 'askRenderMessages 也要认');
});

test('聊天区没有消息节点时也要能记录，不返回 null', () => {
  const host = { scrollTop: 800, scrollHeight: 3000, clientHeight: 400, querySelector: () => null, getBoundingClientRect: () => ({ top: 0 }) };
  const view = askCaptureScroll(host);
  assert.ok(view, '空列表也要给出记录');
  assert.equal(view.index, -1);
  assert.equal(view.top, 800);
  const after = { scrollTop: 0, scrollHeight: 2400, clientHeight: 400, querySelector: () => null, getBoundingClientRect: () => ({ top: 0 }) };
  askRestoreScroll(after, view);
  assert.equal(after.scrollTop, 200, '按缩短的 600px 往上补');
});

/* ---- 兜底：任何一条重绘路径都没来得及记录时，用随手存下的位置复位 ---- */

test('随手记下的位置只对同一条会话有效', () => {
  CURRENT_STATE = { activeId: 'c1', lastScroll: null };
  const host = makeHost(Array(6).fill(300), 900);
  askNoteScroll(host);
  assert.ok(CURRENT_STATE.lastScroll, '滚过就该记下');
  assert.equal(CURRENT_STATE.lastScroll.chatId, 'c1');
  assert.ok(askLastScroll(CURRENT_STATE), '同一条会话能用');
  CURRENT_STATE.activeId = 'c2';
  assert.equal(askLastScroll(CURRENT_STATE), null, '换了会话不能用旧位置');
});

test('位置被清零才记账，正常恢复不记', () => {
  const warn = [];
  const box = {};
  new Function('module', 'exports', 'askState', 'window', 'console', `
${source.slice(source.indexOf('function askReportScrollJump('), source.indexOf('function askBindScrollPin('))}
module.exports = { askReportScrollJump };
`)(box, box.exports, () => ({}), { __scrollJumps: warn }, { warn: () => {} });
  const { askReportScrollJump } = box.exports;
  const before = { top: 900 };
  askReportScrollJump(before, { scrollTop: 0 }, 'x');
  assert.equal(warn.length, 1, '从 900 掉到 0 要留证据');
  assert.equal(warn[0].from, 900);
  askReportScrollJump(before, { scrollTop: 880 }, 'x');
  assert.equal(warn.length, 1, '正常复位不记');
  askReportScrollJump({ top: 10 }, { scrollTop: 0 }, 'x');
  assert.equal(warn.length, 1, '本来就在顶部不算异常');
});
