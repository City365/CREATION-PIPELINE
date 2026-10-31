'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-channels-'));
process.env.WMD_DATA_DIR = path.join(tmpDir, 'data');
process.env.APPDATA = path.join(tmpDir, 'appdata');

const channels = require('../src/channels');
const config = require('../src/config');

test('新增语言渠道：首个自动设为当前，列表脱敏', () => {
  const ch = channels.create('llm', {
    type: 'openai-chat',
    name: '测试渠道',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-1234567890abcdef',
    model: 'gpt-test',
  });
  assert.equal(ch.name, '测试渠道');
  assert.equal(ch.active, true);
  const list = channels.list('llm');
  assert.equal(list.length, 1);
  assert.equal(list[0].hasKey, true);
  assert.equal(list[0].apiKey, undefined);
  assert.match(list[0].masked, /^sk-1…/);
  assert.equal(config.llmConfig().baseUrl, 'https://api.example.com/v1');
});

test('编辑渠道：留空 Key 时保留原 Key', () => {
  const list = channels.list('llm');
  const id = list[0].id;
  channels.update('llm', id, { name: '改名渠道', apiKey: '' });
  const secret = channels.get('llm', id);
  assert.equal(secret.name, '改名渠道');
  assert.equal(secret.apiKey, 'sk-1234567890abcdef');
});

test('多渠道切换当前 + 删除后自动接管', () => {
  const second = channels.create('llm', {
    type: 'openai-responses',
    name: '备用渠道',
    baseUrl: 'https://api2.example.com/v1',
    apiKey: 'sk-second',
    model: 'gpt-2',
  });
  assert.equal(second.active, false);
  channels.activate('llm', second.id);
  assert.equal(channels.active('llm').id, second.id);
  assert.equal(config.llmConfig().protocol, 'responses');
  channels.remove('llm', second.id);
  const rest = channels.list('llm');
  assert.equal(rest.length, 1);
  assert.equal(rest[0].active, true);
});

test('类型元数据包含三类渠道的字段', () => {
  const types = channels.publicTypes();
  assert.ok(types.llm.some((t) => t.id === 'openai-chat'));
  assert.ok(types.image.some((t) => t.id === 'openai-images'));
  assert.ok(types.video.some((t) => t.id === 'generic-task'));
  const generic = types.video.find((t) => t.id === 'generic-task');
  assert.ok(generic.fields.some((f) => f.key === 'submitPath'));
  assert.ok(generic.fields.some((f) => f.key === 'bodyTemplate'));
});

test('多账号密钥：列表显示账号数与首个前缀，清空需要显式 clearKey', () => {
  const ch = channels.create('video', {
    type: 'runninghub-h3-ai',
    name: '国际站多账号',
    baseUrl: 'https://www.runninghub.ai',
    apiKey: 'aaaa1111\nbbbb2222\ncccc3333',
  });
  const listed = channels.list('video').find((c) => c.id === ch.id);
  assert.equal(listed.hasKey, true);
  assert.equal(listed.keyCount, 3);
  assert.equal(listed.masked, '3 个账号 · aaaa…');
  assert.equal(listed.apiKey, undefined);
  channels.update('video', ch.id, { apiKey: '' });
  assert.equal(channels.get('video', ch.id).apiKey, 'aaaa1111\nbbbb2222\ncccc3333');
  channels.update('video', ch.id, { clearKey: true });
  assert.equal(channels.get('video', ch.id).apiKey, '');
  const after = channels.list('video').find((c) => c.id === ch.id);
  assert.equal(after.hasKey, false);
  assert.equal(after.masked, '');
  channels.remove('video', ch.id);
});

