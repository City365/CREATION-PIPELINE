'use strict';
/**
 * 请求/任务级租户上下文。
 *
 * 配置里的渠道、密钥、提示词是「按租户」的，但现有代码有 48 处 config.load()、
 * 36 处 channels.* 调用，逐个加 tenantId 参数风险太大。这里用 AsyncLocalStorage
 * 把当前租户挂到异步调用链上：HTTP 请求在认证后进入租户上下文，后台任务按任务
 * 所属项目进入对应租户上下文，config.load() 据此返回该租户的配置。
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

/** 当前租户；没有上下文时返回空串，由 config 落到默认租户。 */
function current() {
  return storage.getStore() || '';
}

function run(tenantId, fn) {
  return storage.run(String(tenantId || ''), fn);
}

/**
 * 在已确定的请求内切换上下文。每个 HTTP 请求是独立的异步资源，
 * 不会影响其它请求；请求内创建的定时器/回调会继承这个租户。
 */
function enter(tenantId) {
  storage.enterWith(String(tenantId || ''));
}

module.exports = { current, run, enter };
