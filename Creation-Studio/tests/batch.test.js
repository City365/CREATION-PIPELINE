'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-batch-'));
process.env.WMD_DATA_DIR = path.join(tmp, 'data');

const batch = require('../src/batch');
const config = require('../src/config');

fs.mkdirSync(path.join(tmp, 'assets', '示例1'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'assets', '示例1', 'a.png'), 'png');
fs.writeFileSync(path.join(tmp, 'assets', '示例1', 'b.png'), 'png');
fs.writeFileSync(path.join(tmp, 'assets', '示例1', '1.mp3'), 'mp3');
config.save({ assetFolder: path.join(tmp, 'assets'), saveFolder: path.join(tmp, 'media') });

const sample = {
  format: 'wmd-batch',
  version: 1,
  name: '测试批次',
  baseDir: '',
  defaults: { aspectRatio: '16:9', duration: 8, repeat: 2 },
  tasks: [
    {
      title: '任务一',
      images: [{ path: '示例1/a.png', subject: '角色A' }],
      audios: ['示例1/1.mp3'],
      prompt: { subject_definitions: ['<Subject 1> is A.'], summary: '[reference generation] x', retention_analysis: [], detailed_description: '[Shot 1] A.', overall_soundscape: 'Wind', non_diegetic_music: 'N/A' },
    },
    {
      title: '任务二',
      images: [{ path: '示例1/missing.png' }],
      prompt: 'summary:\n[reference generation] y',
    },
  ],
};

test('parseBatch 解析模板、相对路径、重复次数', () => {
  const result = batch.parseBatch(sample);
  assert.equal(result.tasks.length, 2);
  assert.equal(result.tasks[0].repeat, 2);
  assert.equal(result.tasks[0].images[0].exists, true);
  assert.equal(result.tasks[0].audios[0].exists, true);
  assert.equal(result.tasks[0].duration, 8);
  assert.equal(result.tasks[0].aspectRatio, '16:9 (Widescreen)');
  assert.match(result.tasks[0].prompt, /^subject_definitions:/);
  assert.equal(result.tasks[1].errors.length, 1);
  assert.ok(result.errors.length >= 1);
});

test('toJobInputs 跳过有错误的条目并按 repeat 展开', () => {
  const parsed = batch.parseBatch(sample);
  const inputs = batch.toJobInputs(parsed, 'minimax_h3_image_audio_to_video_v2_15s');
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].workflowId, 'minimax_h3_image_audio_to_video_v2_15s');
  assert.equal(inputs[0].aspectRatio, '16:9 (Widescreen)');
});

test('无效 JSON 报错', () => {
  assert.throws(() => batch.parseBatch('{oops'), /JSON 解析失败/);
  assert.throws(() => batch.parseBatch({ tasks: [] }), /没有 tasks/);
});

test('批量 JSON 携带 model 与 ratio：单任务覆盖 defaults，缺省留空', () => {
  const data = {
    defaults: { ratio: '16:9', duration: 10, model: 'Seedance 2.0 Mini' },
    tasks: [
      { title: 'A', prompt: 'p', model: 'Seedance 2.0 Fast', ratio: '9:16' },
      { title: 'B', prompt: 'p' },
      { title: 'C', prompt: 'p', aspectRatio: '1:1', '模型': 'seedance-2.0-fast' },
    ],
  };
  const parsed = batch.parseBatch(data);
  assert.equal(parsed.tasks[0].model, 'Seedance 2.0 Fast');
  assert.equal(parsed.tasks[0].aspectRatio, '9:16 (Portrait Widescreen)');
  assert.equal(parsed.tasks[1].model, 'Seedance 2.0 Mini', '没写就继承 defaults');
  assert.equal(parsed.tasks[1].aspectRatio, '16:9 (Widescreen)');
  assert.equal(parsed.tasks[2].model, 'Seedance 2.0 Fast', '中文键也认，并归一成页面文案');
  assert.equal(parsed.tasks[2].aspectRatio, '1:1 (Square)');
  const inputs = batch.toJobInputs(parsed, 'minimax_h3_image_audio_to_video_v2_15s');
  assert.equal(inputs[0].model, 'Seedance 2.0 Fast');
  assert.equal(inputs[0].aspectRatio, '9:16 (Portrait Widescreen)');
});

test('批量 JSON 不写 model 时不产生该字段，交给渠道默认', () => {
  const parsed = batch.parseBatch({ defaults: { duration: 10 }, tasks: [{ prompt: 'p' }] });
  assert.equal(parsed.tasks[0].model, '');
  const inputs = batch.toJobInputs(parsed, 'minimax_h3_image_audio_to_video_v2_15s');
  assert.equal('model' in inputs[0], false);
});

test('画幅认全角冒号，写错画幅要报错而不是悄悄换成 16:9', () => {
  const ok = batch.parseBatch({ defaults: { duration: 10 }, tasks: [{ prompt: 'p', ratio: '9：16' }] });
  assert.deepEqual(ok.tasks[0].errors, []);
  assert.equal(ok.tasks[0].aspectRatio, '9:16 (Portrait Widescreen)');
  const bad = batch.parseBatch({ defaults: { duration: 10 }, tasks: [{ prompt: 'p', ratio: '21:9' }] });
  assert.ok(bad.tasks[0].errors.some((text) => /画幅只能是/.test(text)), bad.tasks[0].errors.join(';'));
});

