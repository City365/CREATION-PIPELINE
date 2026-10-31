'use strict';
/**
 * 按会话 id 提取成片（客户端模式）。
 *
 * 不依赖任务：用户只要给一个豆包会话 id（或完整地址），就能扫出这个会话里
 * 有几条视频、分别挂在哪条消息上，并按需把原片下载下来。
 * 不发送任何消息，也不消耗视频额度。
 */
const path = require('node:path');
const client = require('./client');
const drive = require('./drive');
const { resolveFallbackVideo } = require('../adapters/doubao-fallback');
const { withClientLock, downloadMedia } = require('./executor');

/** 接受 "38449986875815426"、完整地址或带 local_ 的地址，取出会话 id。 */
function parseConversationId(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('请填写会话 id 或会话地址');
  const matched = /\/chat\/([^/?#]+)/.exec(raw);
  const id = (matched ? matched[1] : raw).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9_-]{6,}$/.test(id)) throw new Error('会话 id 格式无效，例如 38449986875815426');
  return id;
}

/** 扫出会话里所有带视频的消息（DOM 顺序即时间顺序）。 */
async function listVideos(page) {
  return page.evaluate(() => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const rows = [];
    for (const el of document.querySelectorAll('[data-message-id]')) {
      const holder = el.closest('[data-testid="receive_message"]') || el;
      if (!holder.querySelector('[class*="block-video"], video')) continue;
      const id = el.getAttribute('data-message-id');
      if (!id || rows.some((row) => row.messageId === id)) continue;
      rows.push({ messageId: id, text: norm(holder.innerText).slice(0, 80) });
    }
    return rows.map((row, index) => ({ ...row, index: index + 1 }));
  }).catch(() => []);
}

async function extractVideos({
  conversationId,
  accountName = '',
  messageId = '',
  all = false,
  download = false,
  directory,
  ffprobe,
  log = () => {},
}) {
  const id = parseConversationId(conversationId);
  await client.ensureReady({ restart: false });
  return withClientLock(async () => {
    let page = (await client.connect()).page;
    if (accountName) {
      const switched = await drive.switchAccount(page, accountName, {
        reconnect: async () => (await client.reconnect()).page,
      }).catch((error) => ({ error }));
      if (switched && switched.error) throw new Error('切换账号失败：' + switched.error.message);
      page = (await client.connect()).page;
    }
    // 客户端会弹推广弹窗，遮罩一盖，点左侧会话就点不动。
    await drive.dismissDialogs(page, { max: 2 }).catch(() => {});
    const opened = await drive.openConversation(page, { id });
    if (!opened) throw new Error('左侧最近列表里没有找到会话 ' + id + '，请先在客户端里打开一次这个会话');
    await drive.expandMessages(page);

    const videos = await listVideos(page);
    if (!videos.length) return { conversationId: id, account: accountName || '', videos: [], extracted: [] };

    const targets = messageId
      ? videos.filter((row) => row.messageId === String(messageId))
      : all
        ? videos
        : [videos[videos.length - 1]];
    if (!targets.length) throw new Error('会话里没有这条消息的视频：' + messageId);

    const signal = new AbortController().signal;
    const extracted = [];
    for (const target of targets) {
      const plan = await resolveFallbackVideo({ page, messageIds: [target.messageId], signal });
      const entry = { ...target, url: plan.url || '', width: plan.width || 0, height: plan.height || 0 };
      if (!plan.url) {
        entry.error = '没有解析到原片地址';
        extracted.push(entry);
        continue;
      }
      if (download) {
        const destination = path.join(directory, id + '-' + target.index + '.mp4');
        try {
          const file = await downloadMedia({ url: plan.url, page, destination, signal, ffprobe });
          Object.assign(entry, { file: path.basename(file.path), path: file.path, size: file.size, duration: file.duration });
          log('已下载会话 ' + id + ' 的第 ' + target.index + ' 个视频：' + path.basename(file.path));
        } catch (error) {
          entry.error = error.message;
        }
      }
      extracted.push(entry);
    }
    return { conversationId: id, account: accountName || '', videos, extracted };
  });
}

module.exports = { extractVideos, listVideos, parseConversationId };
