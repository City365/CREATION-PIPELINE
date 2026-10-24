'use strict';
const test = require('node:test');
const assert = require('node:assert');
const prompts = require('../src/prompts');

test('骨架包含完整的六段', () => {
  const sections = prompts.parseSections(prompts.SKELETON);
  for (const key of prompts.SECTION_KEYS) {
    assert.ok(sections[key], '缺少段落 ' + key);
  }
});

test('parseSections 支持中文冒号与空行', () => {
  const text = 'subject_definitions：\n<Subject 1> is A.\n\nsummary:\n[reference generation] B.';
  const sections = prompts.parseSections(text);
  assert.equal(sections.subject_definitions, '<Subject 1> is A.');
  assert.equal(sections.summary, '[reference generation] B.');
});

test('normalizeModelOutput 解析 JSON 并重排六段', () => {
  const raw = '```json\n{"subject_definitions":["<Subject 1> is A."],"summary":"[reference generation] B","retention_analysis":["<Subject 1> (appears in [Shot 1]): fully_preserved"],"detailed_description":"[Shot 1] A.","overall_soundscape":"Wind.","non_diegetic_music":"N/A"}\n```';
  const text = prompts.normalizeModelOutput(raw);
  assert.equal(Object.keys(prompts.parseSections(text)).join(','), prompts.SECTION_KEYS.join(','));
  assert.match(text, /^subject_definitions:/);
});

test('normalizeModelOutput 兜底纯文本', () => {
  const text = prompts.normalizeModelOutput('Just prose without headings');
  assert.match(text, /detailed_description:\nJust prose/);
});

test('validatePrompt 报告缺失段落与越界分镜时间', () => {
  const prompt = 'summary:\n[reference generation] x\n[Shot 2] At 00:12.000, cut to a close-up. <Picture 3> appears.';
  const result = prompts.validatePrompt(prompt, { duration: 10, tokens: ['<Picture 1>'], subjects: [{ ordinal: 1, name: 'A' }] });
  assert.ok(result.warnings.some((w) => w.includes('缺少段落')));
  assert.ok(result.warnings.some((w) => w.includes('超出 10 秒')));
  assert.ok(result.warnings.some((w) => w.includes('<Picture 3>')));
});

test('validatePrompt 对合规提示词无致命警告', () => {
  const prompt = `subject_definitions:
<Subject 1> is A from <Picture 1>.
summary:
[reference generation] A ten-second shot.
retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - face.
detailed_description:
Cinematic realistic drama. ${'A detailed sentence describing light and motion. '.repeat(24)}
[Shot 1] A wide shot of <Subject 1>.
overall_soundscape:
Wind.
non_diegetic_music:
N/A`;
  const result = prompts.validatePrompt(prompt, { duration: 10, tokens: ['<Picture 1>'], subjects: [{ ordinal: 1, name: 'A' }] });
  assert.deepEqual(result.warnings, []);
});

