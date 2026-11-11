'use strict';
// 技能选择：@ 只是快捷方式。@ 一个、@ 两个、@ 完又取消、直接写名字，都要落到同一份清单。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();

const start = source.indexOf('function askSkillList(');
const end = source.indexOf('// 技能统一来源：内置技能 + 自定义技能都来自 /agent/skills');
assert.ok(start > 0 && end > start, '在 app.js 里找不到技能选择的实现');
const block = source.slice(start, end);

function makeState(skills) {
  const sandbox = {
    ASK_GENERAL: { id: '', name: '普通聊天' },
    ASK_SKILLS: skills,
    ASK_PERM_DEFAULT: 'workspace',
    state: { skillId: '', skillIds: [], skills: [], modelId: 'm1', effort: 'high', permission: 'full' },
    askState: () => sandbox.state,
  };
  // eslint-disable-next-line no-new-func
  new Function('sandbox', `with (sandbox) { ${block}\n; sandbox.api = {
    askSkillList, askSkill, askSkillName, askSkills, askSetSkills, askSkillNames,
    askParseSkillMentions, askTurnSnapshot }; }`)(sandbox);
  return sandbox;
}

const SKILLS = [
  { id: 'novel', name: '小说创作' },
  { id: 'script', name: '小说转剧本' },
  { id: 'storyboard', name: '剧本转分镜' },
];

test('正文里的 @技能名 被认成点名，并从正文剥掉', () => {
  const box = makeState(SKILLS);
  const got = box.api.askParseSkillMentions('@小说创作 把这段写成短篇');
  assert.deepEqual(got.ids, ['novel']);
  assert.equal(got.text, '把这段写成短篇');
});

test('@ 两个技能按写入顺序都留下', () => {
  const box = makeState(SKILLS);
  const got = box.api.askParseSkillMentions('@小说创作 @剧本转分镜 先写再拆');
  assert.deepEqual(got.ids, ['novel', 'storyboard']);
  assert.equal(got.text, '先写再拆');
});

test('顺序按正文里出现的位置，不按技能表里的顺序', () => {
  const box = makeState(SKILLS);
  const got = box.api.askParseSkillMentions('@剧本转分镜 再 @小说创作');
  assert.deepEqual(got.ids, ['storyboard', 'novel']);
});

test('不认识的 @ 原样留着，不能被吃掉', () => {
  const box = makeState(SKILLS);
  const got = box.api.askParseSkillMentions('帮我看看 @某个技能 的文档');
  assert.deepEqual(got.ids, []);
  assert.ok(got.text.includes('@某个技能'));
});

test('技能清单保序去重，skillId 作为第一个的镜像', () => {
  const box = makeState(SKILLS);
  box.api.askSetSkills(['storyboard', 'novel', 'storyboard', '']);
  assert.deepEqual(box.state.skillIds, ['storyboard', 'novel']);
  assert.equal(box.state.skillId, 'storyboard', '老代码读 skillId 时要还能用');
  assert.deepEqual(box.api.askSkills(), ['storyboard', 'novel']);
});

test('认不出的 id 直接丢掉，不能变成「普通聊天」发出去', () => {
  const box = makeState(SKILLS);
  box.api.askSetSkills(['plugin:已经删掉的技能']);
  assert.deepEqual(box.api.askSkills(), []);
  assert.deepEqual(box.api.askSkillNames(['plugin:已经删掉的技能', 'novel']), ['小说创作']);
});

test('一轮快照带技能、模型、思考档和权限', () => {
  const box = makeState(SKILLS);
  box.api.askSetSkills(['novel', 'script']);
  const snap = box.api.askTurnSnapshot();
  assert.deepEqual(snap, { skillIds: ['novel', 'script'], modelId: 'm1', effort: 'high', permission: 'full' });
});

test('输入区的技能标签显示全部已选技能', () => {
  const composer = source.slice(source.indexOf('function askComposerHtml('), source.indexOf('function askComposerHtml(') + 4000);
  assert.ok(composer.includes('askSkills()') && composer.includes('askSkillNames'), '标签读多选清单');
  assert.ok(composer.includes("names.join(' + ')"), '多选要一起显示');
});

test('取消 @ 会把正文里的 token 一起清掉', () => {
  const handler = source.slice(source.indexOf("if (act === 'ask-clear-skill')"), source.indexOf("if (act === 'ask-folder-toggle')"));
  assert.ok(handler.includes('askSetSkills([])'), '清空技能');
  assert.ok(handler.includes('askParseSkillMentions(value)'), '同时剥掉正文里的 @');
});

test('点 @ 是追加不是覆盖', () => {
  const pick = source.slice(source.indexOf('function askChooseMention('), source.indexOf('function askChooseFile('));
  assert.ok(pick.includes('askSetSkills([...askSkills(), id])'), '第二个技能不能把第一个顶掉');
});
