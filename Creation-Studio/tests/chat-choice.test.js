'use strict';
// 智能推荐：问句条（1–4 个问题、单选/多选）、对话内记录行、兜底快捷项与点击接线
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

test('多问题面板：编号、可多选标记、每题选项与推荐徽标', () => {
  set({ choice: { card: CARD, answers: {}, text: '', closed: false } });
  const html = askChoicePanelHtml();
  assert.match(html, /问题 · 2/);
  assert.match(html, /ask-qpanel-index">1</);
  assert.match(html, /ask-qpanel-index">2</);
  assert.match(html, /第 3 集接下来走哪条？/);
  assert.match(html, /这次要哪些素材？/);
  assert.match(html, /ask-qpanel-multi">可多选</, '多选题要有标记');
  assert.equal((html.match(/data-act="ask-choice-pick"/g) || []).length, 5);
  assert.equal((html.match(/data-question="/g) || []).length, 5);
  assert.equal((html.match(/ask-qpanel-rec">推荐</g) || []).length, 2);
  assert.match(html, /disabled>发送</, '一个问题都没答时不能发送');
});

test('多选：勾选多个、再点取消；单选：换成另一个', () => {
  set({ choice: { card: CARD, answers: { q1: ['q1o1'], q2: ['q2o1', 'q2o3'] }, text: '', closed: false } });
  const html = askChoicePanelHtml();
  assert.match(html, /class="ask-qpanel-opt is-on" role="radio" aria-checked="true" data-act="ask-choice-pick" data-question="q1" data-option="q1o1"/);
  assert.match(html, /class="ask-qpanel-opt is-on is-multi" role="checkbox" aria-checked="true" data-act="ask-choice-pick" data-question="q2" data-option="q2o1"/);
  assert.match(html, /data-question="q2" data-option="q2o3"/, '多选题可以同时勾两个');
  assert.equal((html.match(/ask-qpanel-key">✓</g) || []).length, 2, '多选项用勾号标记');
  assert.ok(!/disabled>发送/.test(html), '两题都答了就能发送');

  // 只答一题：仍不能发送
  set({ choice: { card: CARD, answers: { q1: ['q1o2'] }, text: '', closed: false } });
  assert.match(askChoicePanelHtml(), /disabled>发送</);
});

test('自行撰写：只有文字也能发送，和选择并存', () => {
  set({ choice: { card: CARD, answers: {}, text: '先给我看分镜样例', closed: false } });
  const html = askChoicePanelHtml();
  assert.match(html, /value="先给我看分镜样例"/);
  assert.ok(!/disabled>发送/.test(html));
  set({ choice: { card: CARD, answers: {}, text: '', closed: true } });
  assert.equal(askChoicePanelHtml(), '');
});

test('老格式（单问题扁平字段）仍然能渲染', () => {
  const legacy = { id: 'ch_old', question: '走哪条？', options: [{ id: 'o1', label: 'A', value: 'A', recommended: true }, { id: 'o2', label: 'B', value: 'B' }], multi: false, allow_text: true };
  const questions = askChoiceQuestions(legacy);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].id, 'q1');
  set({ choice: { card: legacy, answers: {}, text: '', closed: false } });
  assert.match(askChoicePanelHtml(), /走哪条？/);
});

test('对话里的记录行：等待 / 已选择 N 项 / 已回复 / 已跳过', () => {
  const waiting = askChoiceNoteHtml({ role: 'assistant', choices: [CARD] });
  assert.match(waiting, /✦ 智能推荐/);
  assert.match(waiting, /等 2 个问题/);
  assert.match(waiting, /等待选择/);

  const done = askChoiceNoteHtml({ role: 'assistant', choices: [CARD], choiceAnswers: { ch_1: [{ question: 'q1', label: '拆成分镜剧本' }, { question: 'q2', label: '角色四视图' }] } });
  assert.match(done, /is-done/);
  assert.match(done, /已选择 2 项/);

  const typed = askChoiceNoteHtml({ role: 'assistant', choices: [CARD], choiceTyped: { ch_1: '先看分镜样例' } });
  assert.match(typed, /已回复：先看分镜样例/);

  const skipped = askChoiceNoteHtml({ role: 'assistant', choices: [CARD], choiceSkipped: 'ch_1' });
  assert.match(skipped, /已跳过/);
  assert.equal(askChoiceNoteHtml({ role: 'user', choices: [CARD] }), '');
});

test('兜底快捷项：正文以问句收尾才出现，有卡就不出现', () => {
  assert.match(askQuickHtml({ role: 'assistant', text: '要我现在开始跑吗？' }, 3), /按推荐继续/);
  assert.equal(askQuickHtml({ role: 'assistant', text: '已经做完了。' }, 0), '');
  assert.equal(askQuickHtml({ role: 'assistant', text: '要现在开始吗？', choices: [CARD] }, 0), '');
  assert.equal(askQuickHtml({ role: 'assistant', text: '正在想…', _streaming: true }, 0), '');
});

test('事件落地：questions 数组进消息并抬到输入框上方', () => {
  const apply = source.slice(source.indexOf('function askApplyEvent('), source.indexOf('async function askQueueReply('));
  assert.match(apply, /data\.type === 'choice'/);
  assert.match(apply, /Array\.isArray\(data\.questions\)/);
  assert.match(apply, /a\.choice = \{ messageId: msg\.id \|\| ''/);
  assert.match(apply, /answers: \{\}/);
  assert.match(apply, /askChoiceRefresh\(\)/);
});

test('发送：多选合并成一条可执行消息，带技能就挂上', () => {
  const summary = source.slice(source.indexOf('function askChoiceSummary('), source.indexOf('function askChoiceSend('));
  assert.match(summary, /lines\.push\('- ' \+ q\.question \+ ' → ' \+ picked\.map\(\(o\) => o\.label\)\.join\('、'\)\)/);
  assert.match(summary, /if \(o\.skill_id\) skills\.push\(o\.skill_id\)/);

  const send = source.slice(source.indexOf('function askChoiceSend('), source.indexOf('function askChoiceSkip('));
  assert.match(send, /【智能推荐 · 用户已确认】/);
  assert.match(send, /'按以上选择继续，不要再重复确认。'/);
  assert.match(send, /if \(summary\.skills\.length\) a\.skillId = summary\.skills\[0\]/);
  assert.match(send, /msg\.choiceAnswers = /);
  assert.match(send, /return askSend\(message\)/);
  assert.ok(!/picked/.test(send), '不应再依赖旧的单选字段');
});

test('点击接线与跳过', () => {
  const pick = source.slice(source.indexOf('function askChoicePick('), source.indexOf('function askChoiceSummary('));
  assert.match(pick, /if \(q\.multi\) \{/);
  assert.match(pick, /current\.includes\(optionId\)/);
  assert.match(pick, /a\.choice\.answers\[q\.id\] = \[optionId\]/);
  assert.match(pick, /askChoiceRefresh\(\)/);

  const skip = source.slice(source.indexOf('function askChoiceSkip('), source.indexOf('function askMessageHtml('));
  assert.match(skip, /msg\.choiceSkipped = p\.card\.id/);
  assert.ok(!/askSend/.test(skip));

  assert.ok(source.includes('askChoicePick(btn.dataset.question, btn.dataset.option)'), '点击要带上问题 id 与选项 id');
});

test('问句条挂在输入框上方，主输入框发送时视为跳过', () => {
  const composer = source.slice(source.indexOf('function askComposerHtml()'), source.indexOf('function askEfforts()'));
  assert.match(composer, /\$\{askChoicePanelHtml\(\)\}\s*<div class="ask-composer">/);
  const send = source.slice(source.indexOf('async function askSend('), source.indexOf('async function askStop('));
  assert.match(send, /if \(a\.choice && !a\.choice\.closed\)/);
  assert.match(send, /stale\.choiceSkipped = a\.choice\.card\.id/);
});

test('智能体提示词：自带问答机制、多问题与多选都写清楚了', () => {
  const policy = fs.readFileSync(path.join(__dirname, '../agent_backend/app/chat_policy.py'), 'utf8');
  assert.match(policy, /【智能推荐 · 用面板问用户】/);
  assert.match(policy, /不属于任何技能/);
  assert.match(policy, /1–4 个问题/);
  assert.match(policy, /multi=true/);
  assert.match(policy, /写清技能名与处理范围/);
  assert.match(policy, /一轮最多 3 次调用/);
});
