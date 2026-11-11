'use strict';
/**
 * 对话侧栏的隔离约束（源码级）：侧栏只列当前项目的对话，
 * 不许再去别的项目拉 /sessions，也不许点一下就把项目切走。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();

function block(name) {
  const start = source.indexOf('async function ' + name);
  assert.notEqual(start, -1, name + ' 不存在');
  const next = source.indexOf('\nasync function ', start + 10);
  const max = next === -1 ? source.length : next;
  return source.slice(start, max);
}

test('askLoadProjectHistory 只整理当前项目，不发跨项目请求', () => {
  const body = block('askLoadProjectHistory');
  assert.match(body, /a\.projectHistory = \[\{/, '只应该有一行（当前项目）');
  assert.doesNotMatch(body, /for \(const project of projects\)/, '不能遍历所有项目');
  assert.doesNotMatch(body, /X-Project-Id/, '不能带别的项目的请求头');
  assert.doesNotMatch(body, /askApi\('\/sessions'/, '单独去拉别项目会话的代码要删掉');
});

test('侧栏头部只代表当前项目', () => {
  const start = source.indexOf('function askHistoryHtml');
  const end = source.indexOf('async function askLoadProjectHistory');
  assert.ok(start > 0 && end > start, '找不到侧栏渲染函数');
  const rows = source.slice(start, end);
  assert.match(rows, /ask-project-new-chat/, '保留当前项目的新建入口');
  assert.doesNotMatch(rows, /ask-folder-now/, '跨项目分组用的「当前」标记应该去掉');
  assert.match(rows, /只显示当前项目的对话/, '标题要说明只列当前项目');
});

test('打开对话时不允许偷偷切项目', () => {
  const open = block('askOpenProjectConversation');
  assert.doesNotMatch(open, /setActiveProject/, '点别的项目的对话不能顺手切项目');
  assert.match(open, /属于另一个项目/, '应提示对话属于另一个项目');
});

test('在项目里新建对话时同样不切项目', () => {
  const create = block('askNewChatInProject');
  assert.doesNotMatch(create, /setActiveProject/, '不能靠新建对话把项目切走');
  assert.match(create, /请先切换到该项目/, '应提示先切换项目');
});
