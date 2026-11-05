'use strict';
/**
 * 管理器调用的统一出口。
 *
 * - 本机直连：按渠道里的 baseUrl（默认 127.0.0.1:17778）发 HTTP；
 * - 远程执行端：渠道里填了 executorToken 时，请求不直接发，而是排进执行端通道，
 *   由用户自己那台机器上的管理器取走执行、把结果回传（服务器不需要能访问用户内网）。
 *
 * 两条路径返回同样的结构，调用方不用关心任务跑在哪台机器上。
 */
const fs = require('node:fs');
const { httpJson, fetchBuffer } = require('./util');
const channels = require('./executor-channel');

const DEFAULT_BASE = 'http://127.0.0.1:17778';

function tokenOf(channel) {
  const raw = channel && (channel.executorToken || (channel.options && channel.options.executorToken));
  return String(raw || '').trim();
}

function baseUrl(channel) {
  return String((channel && channel.baseUrl) || DEFAULT_BASE).replace(/\/+$/, '');
}

function isRemote(channel) {
  return Boolean(tokenOf(channel));
}

function parseBody(result) {
  const text = result.body && result.body.length ? result.body.toString('utf8') : '';
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { text, data };
}

/** 和 httpJson 同构：{ ok, status, data, text, headers }。 */
async function requestJson(channel, target, { method = 'GET', headers = {}, body, timeoutMs = 60000 } = {}) {
  const token = tokenOf(channel);
  if (!token) return httpJson(baseUrl(channel) + target, { method, headers, body, timeoutMs });
  const result = await channels.request(token, { method, path: target, headers, body: body ?? null, timeoutMs });
  if (result.blob) {
    // JSON 调用却回了二进制：只留大小，文件立刻清掉，别把磁盘当缓存。
    const bytes = Number(result.blobBytes) || 0;
    channels.discardBlob(result.blob);
    return { ok: result.status >= 200 && result.status < 300, status: result.status, data: null, text: '', headers: result.headers, blobBytes: bytes };
  }
  const { text, data } = parseBody(result);
  return { ok: result.status >= 200 && result.status < 300, status: result.status, data, text, headers: result.headers, blobBytes: result.body ? result.body.length : 0 };
}

/** 和 fetchBuffer 同构：{ buffer, contentType }。大文件由执行端单独上传成 blob。 */
async function downloadBuffer(channel, target, { headers = {}, timeoutMs = 600000 } = {}) {
  const token = tokenOf(channel);
  if (!token) return fetchBuffer(baseUrl(channel) + target, { headers, timeoutMs });
  const result = await channels.request(token, { method: 'GET', path: target, headers, timeoutMs, serial: true });
  const contentType = (result.headers && (result.headers['content-type'] || result.headers['Content-Type'])) || 'video/mp4';
  if (result.blob) {
    const file = channels.blobPath(result.blob);
    if (!file) throw new Error('执行端回传的文件已被清理，请重试');
    const buffer = fs.readFileSync(file);
    channels.discardBlob(result.blob);
    return { buffer, contentType };
  }
  if (!result.body || !result.body.length) throw new Error('执行端没有返回文件内容');
  return { buffer: result.body, contentType };
}

module.exports = { DEFAULT_BASE, baseUrl, isRemote, tokenOf, requestJson, downloadBuffer };
