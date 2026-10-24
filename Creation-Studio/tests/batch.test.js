'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-batch-'));
process.env.H3_DATA_DIR = path.join(tmp, 'data');

const batch = require('../src/batch');
const config = require('../src/config');

fs.mkdirSync(path.join(tmp, 'assets', '示例1'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'assets', '示例1', 'a.png'), 'png');
fs.writeFileSync(path.join(tmp, 'assets', '示例1', 'b.png'), 'png');
fs.writeFileSync(path.join(tmp, 'assets', '示例1', '1.mp3'), 'mp3');
config.save({ assetFolder: path.join(tmp, 'assets'), saveFolder: path.join(tmp, 'media') });

const sample = {
  format: 'zealman-h3-batch',
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

