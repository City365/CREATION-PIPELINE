'use strict';
// 智能推荐：逐题分页问句条（‹ 1 of N ›）、单选/多选、自行撰写与点击接线
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const start = source.indexOf('// 智能推荐：对话里只留一行记录');
const end = source.indexOf('function askMessageHtml(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到问句条渲染函数');

let CURRENT = null;
const box = {};
new Function('module', 'exports', `
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function askState() { return CURRENT; }
function $() { return null; }
${source.slice(start, end)}
module.exports = { askChoiceNoteHtml, askChoicePanelHtml, askChoiceQuestions, askQuickHtml, set(v) { CURRENT = v; } };
`)(box, box.exports);
const { askChoiceNoteHtml, askChoicePanelHtml, askChoiceQuestions, askQuickHtml, set } = box.exports;

const CARD = {
  id: 'ch_1',
  questions: [
    {
      id: 'q1',
      question: '第 3 集接下来走哪条？',
      multi: false,
      allow_text: true,
      options: [
        { id: 'q1o1', label: '拆成分镜剧本', why: '逐场拆成镜头表', value: '用「分集剧本转分镜剧本」技能处理第 3 集', recommended: true },
        { id: 'q1o2', label: '先审一遍剧本', why: '先挑逻辑问题', value: '审校第 3 集剧本', recommended: false },
      ],
    },
    {
      id: 'q2',
      question: '这次要哪些素材？',
      multi: true,
      allow_text: true,
      options: [
        { id: 'q2o1', label: '角色四视图', why: '锁形象一致性', value: '生成角色四视图', recommended: true },
        { id: 'q2o2', label: '场景参考图', why: '锁场景一致性', value: '生成场景参考图', recommended: false },
        { id: 'q2o3', label: '道具特写', why: '关键道具备查', value: '生成道具参考图', recommended: false },
      ],
    },
  ],
};

const state = (patch) => set({ choice: { card: CARD, answers: {}, custom: {}, text: '', page: 0, closed: false, ...patch } });

test('一页只显示一个问题，头部有 1 of 2 与翻页箭头', () => {
  state({});
  const html = askChoicePanelHtml();
  assert.match(html, /ask-qpanel-title">问题</);
  assert.match(html, /ask-qpanel-of">1 of 2</);
  assert.match(html, /data-act="ask-choice-page" data-delta="-1" disabled title="上一个问题"/);
  assert.match(html, /data-act="ask-choice-page" data-delta="1"  title="下一个问题"/);
  assert.match(html, /第 3 集接下来走哪条？/);
  assert.ok(!/ask-qpanel-question">[^<]*这次要哪些素材/.test(html), '第二页的问题不应同时出现');
  assert.equal((html.match(/data-act="ask-choice-pick"/g) || []).length, 2, '只渲染当前页的选项');
});

test('第二页显示多选标记与勾选框；进度点标出已完成与当前', () => {
  state({ page: 1, answers: { q1: ['q1o1'] } });
  const html = askChoicePanelHtml();
  assert.match(html, /ask-qpanel-of">2 of 2</);
  assert.match(html, /这次要哪些素材？/);
  assert.match(html, /ask-qpanel-multi">可多选</);
  assert.match(html, /ask-qpanel-dot is-done/);
  assert.match(html, /ask-qpanel-dot is-on/);
  assert.match(html, /ask-qpanel-key"><\/span>/, '多选项未选中时是空勾选框');
});

test('单选高亮 + 箭头；多选可以勾多个', () => {
  state({ answers: { q1: ['q1o2'] } });
  const first = askChoicePanelHtml();
  assert.match(first, /class="ask-qpanel-opt is-on" role="radio" aria-checked="true"/);
  assert.match(first, /ask-qpanel-go" aria-hidden="true">→</);

  state({ page: 1, answers: { q1: ['q1o1'], q2: ['q2o1', 'q2o3'] } });
  const second = askChoicePanelHtml();
  assert.equal((second.match(/ask-qpanel-key">✓</g) || []).length, 2);
  assert.match(second, /class="ask-qpanel-opt is-on is-multi" role="checkbox" aria-checked="true"/);
});

test('按钮：非最后一页是「下一步」且未答时禁用；最后一页是「发送」', () => {
  state({});
  const first = askChoicePanelHtml();
  assert.match(first, /data-act="ask-choice-page" data-delta="1" disabled title="回答后进入下一个问题">下一步</);

  state({ answers: { q1: ['q1o1'] } });
  assert.ok(!/disabled title="回答后进入下一个问题">下一步</.test(askChoicePanelHtml()));

  state({ page: 1, answers: { q1: ['q1o1'], q2: ['q2o1'] } });
  const last = askChoicePanelHtml();
  assert.match(last, /data-act="ask-choice-send" data-delta="1"  title="提交这组问题的答案">发送</);
});

test('自行撰写：当前页写了字就能继续；切页保留各自的自定义回答', () => {
  state({ text: '先给我看两集的分镜样例' });
  assert.ok(!/disabled title="回答后进入下一个问题">下一步</.test(askChoicePanelHtml()));

  state({ page: 0, custom: { q1: '先给我看分镜样例' }, text: '先给我看分镜样例' });
  assert.match(askChoicePanelHtml(), /value="先给我看分镜样例"/);

  // 翻到第二页后，第一页的问题仍未作答但已记下自定义回答
  state({ page: 1, custom: { q1: '先给我看分镜样例' }, text: '' });
  assert.match(askChoicePanelHtml(), /2 of 2/);
});

test('单问题面板不显示翻页器，按钮直接是「发送」', () => {
  const single = { id: 'ch_s', questions: [{ ...CARD.questions[0] }] };
  set({ choice: { card: single, answers: { q1: ['q1o1'] }, custom: {}, text: '', page: 0, closed: false } });
  const html = askChoicePanelHtml();
  assert.ok(!html.includes('ask-qpanel-pager'));
  assert.match(html, />发送</);
});

test('老格式（扁平 question/options）仍然能渲染', () => {
  const legacy = { id: 'ch_old', question: '走哪条？', options: [{ id: 'o1', label: 'A', value: 'A', recommended: true }, { id: 'o2', label: 'B', value: 'B' }], multi: false, allow_text: true };
  assert.equal(askChoiceQuestions(legacy).length, 1);
  set({ choice: { card: legacy, answers: {}, custom: {}, text: '', page: 0, closed: false } });
  assert.match(askChoicePanelHtml(), /走哪条？/);
});

test('对话里的记录行：等待 / 已选择 N 项 / 已回复 / 已跳过', () => {
  assert.match(askChoiceNoteHtml({ role: 'assistant', choices: [CARD] }), /等 2 个问题/);
  const done = askChoiceNoteHtml({ role: 'assistant', choices: [CARD], choiceAnswers: { ch_1: [{ question: 'q1', label: '拆成分镜剧本' }] } });
  assert.match(done, /已选择 1 项/);
  const typed = askChoiceNoteHtml({ role: 'assistant', choices: [CARD], choiceTyped: { ch_1: '先看样例' } });
  assert.match(typed, /已回复：先看样例/);
  assert.match(askChoiceNoteHtml({ role: 'assistant', choices: [CARD], choiceSkipped: 'ch_1' }), /已跳过/);
});

test('兜底快捷项：正文以问句收尾才出现，有卡就不出现', () => {
  assert.match(askQuickHtml({ role: 'assistant', text: '要我现在开始跑吗？' }, 3), /按推荐继续/);
  assert.equal(askQuickHtml({ role: 'assistant', text: '要现在开始吗？', choices: [CARD] }, 0), '');
  assert.equal(askQuickHtml({ role: 'assistant', text: '正在想…', _streaming: true }, 0), '');
});

test('翻页与发送：记住当前页手写答案，合并成一条可执行消息', () => {
  const page = source.slice(source.indexOf('function askChoicePage('), source.indexOf('function askChoiceSummary('));
  assert.match(page, /p\.custom\[q\.id\] = text/);
  assert.match(page, /p\.page = to/);
  assert.match(page, /if \(next && p\.custom && p\.custom\[next\.id\]\) p\.text = p\.custom\[next\.id\]/);

  const send = source.slice(source.indexOf('function askChoiceSend('), source.indexOf('function askChoiceSkip('));
  assert.match(send, /p\.custom\[currentQ\.id\] = currentText/);
  assert.match(send, /【智能推荐 · 用户已确认】/);
  assert.match(send, /按以上选择继续，不要再重复确认。/);
  assert.match(send, /if \(summary\.skills\.length\) a\.skillId = summary\.skills\[0\]/);
  assert.match(send, /return askSend\(message\)/);

  const summary = source.slice(source.indexOf('function askChoiceSummary('), source.indexOf('function askChoiceSend('));
  assert.match(summary, /'（自定）' \+ typed/);
});

test('点击接线：选择 / 翻页 / 发送 / 跳过', () => {
  assert.ok(source.includes('askChoicePick(btn.dataset.question, btn.dataset.option)'));
  assert.ok(source.includes('askChoicePage(Number(btn.dataset.delta) || 1)'));
  assert.ok(source.includes('askChoiceSend()'));
  const skip = source.slice(source.indexOf('function askChoiceSkip('), source.indexOf('function askMessageHtml('));
  assert.match(skip, /msg\.choiceSkipped = p\.card\.id/);
  assert.ok(!/askSend/.test(skip));
});

test('事件落地与位置：questions 数组进消息，面板挂在输入框上方', () => {
  const apply = source.slice(source.indexOf('function askApplyEvent('), source.indexOf('async function askQueueReply('));
  assert.match(apply, /Array\.isArray\(data\.questions\)/);
  assert.match(apply, /page: 0/);

  const composer = source.slice(source.indexOf('function askComposerHtml()'), source.indexOf('function askEfforts()'));
  assert.match(composer, /\$\{askChoicePanelHtml\(\)\}\s*<div class="ask-composer">/);

  const send = source.slice(source.indexOf('async function askSend('), source.indexOf('async function askStop('));
  assert.match(send, /stale\.choiceSkipped = a\.choice\.card\.id/);
});

test('智能体提示词：自带问答机制、多问题与多选都写清楚了', () => {
  const policy = fs.readFileSync(path.join(__dirname, '../agent_backend/app/chat_policy.py'), 'utf8');
  assert.match(policy, /【智能推荐 · 用面板问用户】/);
  assert.match(policy, /不属于任何技能/);
  assert.match(policy, /1–4 个问题/);
  assert.match(policy, /multi=true/);
  assert.match(policy, /一轮最多 3 次调用/);
});
