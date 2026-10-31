'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const agent = require('../src/v2/agent');
const { clientAccountName, withClientLock } = require('../src/v2/executor');

test('模型接口地址：OpenAI 与 Anthropic 两种协议各自补全', () => {
  assert.equal(agent.endpoint('https://api.deepseek.com/v1', 'openai'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(agent.endpoint('https://api.deepseek.com', 'openai'), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(agent.endpoint('https://x.test/v1/chat/completions', 'openai'), 'https://x.test/v1/chat/completions');
  assert.equal(agent.endpoint('https://api.anthropic.com', 'anthropic'), 'https://api.anthropic.com/v1/messages');
  assert.equal(agent.endpoint('', 'openai'), '');
});

test('模型决策：只认一个 JSON，随手带解释也能解析', () => {
  assert.deepEqual(agent.parseDecision('{"tool":"chat.new","args":{},"why":"先开新对话"}'), {
    tool: 'chat.new', args: {}, why: '先开新对话',
  });
  assert.equal(agent.parseDecision('{"done":true,"result":{"url":"https://x"}}').done, true);
  assert.equal(agent.parseDecision('好的，我先点新对话'), null);
  assert.equal(agent.parseDecision('```json\n{"tool":"chat.new"}\n```').tool, 'chat.new');
});

test('管理器账号 → 客户端账号：只认「用户…」这种显示名', () => {
  assert.equal(clientAccountName({ name: '用户vwYK1j' }), '用户vwYK1j');
  assert.equal(clientAccountName({ name: '我的号', remark: '用户490936 体验套餐' }), '用户490936 体验套餐');
  assert.equal(clientAccountName({ name: '闲鱼1', remark: '' }), '');
  assert.equal(clientAccountName(null), '');
});

test('客户端窗口是独占的：并发操作按顺序执行，不会互相穿插', async () => {
  const order = [];
  const work = (name, ms) => withClientLock(async () => {
    order.push(name + ':start');
    await new Promise((resolve) => setTimeout(resolve, ms));
    order.push(name + ':end');
  });
  await Promise.all([work('a', 30), work('b', 5), work('c', 1)]);
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
});

test('锁里的异常不会卡住后面的任务', async () => {
  await assert.rejects(withClientLock(async () => { throw new Error('炸了'); }), /炸了/);
  const value = await withClientLock(async () => 'ok');
  assert.equal(value, 'ok');
});
