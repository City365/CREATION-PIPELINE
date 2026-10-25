'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { uploadTrace } = require('../src/adapters/upload-trace');
const { uploadReferences } = require('../src/automation');

test('上传诊断保留失败主机和动作，去除签名查询并释放监听器', () => {
  const page = new EventEmitter();
  const trace = uploadTrace(page);
  const request = {
    url: () => 'https://imagex.example.com/?Action=UploadImage&Signature=do-not-store',
    resourceType: () => 'xhr',
    failure: () => ({ errorText: 'net::ERR_CONNECTION_RESET' }),
  };
  page.emit('requestfailed', request);
  assert.equal(trace.events[0].action, 'UploadImage');
  assert.equal(trace.events[0].error, 'net::ERR_CONNECTION_RESET');
  assert.ok(!JSON.stringify(trace.events).includes('do-not-store'));
  trace.stop();
  page.emit('requestfailed', request);
  assert.equal(trace.events.length, 1);
  assert.equal(page.listenerCount('response'), 0);
});

test('逐张上传发布上传阶段和完成进度，不会一直停在启动中', async () => {
  const states = [];
  const updates = [];
  const page = {
    locator(selector) {
      return {
        first() { return this; },
        async count() { return selector.includes('input') ? 1 : states.length; },
        async setInputFiles(file) {
          states.push({ fileName: file, fileKey: file, status: 'Normal', uploadPercent: 100, width: 100, height: 100 });
        },
      };
    },
    async evaluate() { return structuredClone(states); },
  };
  const result = await uploadReferences(page, ['one.png', 'two.png'], {}, new AbortController().signal, 'doubao', patch => updates.push(patch));
  assert.ok(updates.every(p => p.status === 'uploading'));
  assert.ok(updates.some(p => p.message.includes('1/2')));
  assert.ok(updates.some(p => p.message.includes('2/2')));
  assert.match(updates.at(-1).message, /上传完成/);
  assert.equal(result.actualCount, 2);
});
