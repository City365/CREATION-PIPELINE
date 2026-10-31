'use strict';

/**
 * 智能体回复里的“画面参考”：直接按英文画面描述出图，不走反推/识别。
 * 结果按 提示词+模型+尺寸 缓存到 data/ref-images/，同一条描述只出一次图。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const channels = require('./channels');
const imagegen = require('./imagegen');
const { ensureDir } = require('./util');

const MAX_PROMPT = 600;
const pending = new Map();

function dir() {
  return ensureDir(path.join(config.load().dataDir || config.DATA, 'ref-images'));
}

function indexFile() {
  return path.join(dir(), 'index.json');
}

function readIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeIndex(rows) {
  const file = indexFile();
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(rows, null, 2));
  fs.renameSync(temp, file);
}

function cacheKey(prompt, model, size) {
  return crypto.createHash('sha256').update([prompt, model || '', size || ''].join('\u0000')).digest('hex').slice(0, 24);
}

function extOf(mime) {
  const text = String(mime || '');
  if (/png/i.test(text)) return '.png';
  if (/webp/i.test(text)) return '.webp';
  if (/jpeg|jpg/i.test(text)) return '.jpg';
  return '.png';
}

// 画面比例 → 渠道能接受的尺寸；认不出比例或渠道不吃尺寸时用 auto
const OPENAI_SIZES = { '1:1': '1024x1024', '16:9': '1536x1024', '4:3': '1536x1024', '3:2': '1536x1024', '9:16': '1024x1536', '3:4': '1024x1536', '2:3': '1024x1536' };

function sizeForRatio(ratio, channel) {
  const label = String(ratio || '').trim().replace(/[：x×*/\s]/gi, ':');
  if (!OPENAI_SIZES[label]) return '';
  // gemini / chat 系渠道尺寸参数不是这套写法，交给它们自己决定
  if (channel && channel.type && channel.type !== 'openai-images') return '';
  return OPENAI_SIZES[label];
}

/**
 * 生成（或取缓存）一张画面参考图。
 * 返回 { prompt, url, path, bytes, model, size, cached }
 */
async function one(rawPrompt, options = {}) {
  const prompt = String(rawPrompt || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT);
  if (prompt.length < 4) throw new Error('画面描述太短，无法出图');
  const channel = channels.active('image');
  if (!channel) throw new Error('没有启用的图像渠道，先到设置里配一个');
  const size = String(options.size || sizeForRatio(options.ratio, channel) || (channel.options && channel.options.size) || 'auto');
  const key = cacheKey(prompt, channel.model, size);

  const hit = readIndex()[key];
  if (hit && hit.path && fs.existsSync(hit.path)) return { ...hit, cached: true };
  if (pending.has(key)) return pending.get(key);

  const task = (async () => {
    const images = await imagegen.generate(channel, { prompt, count: 1, size });
    const item = images[0];
    if (!item || !item.buffer) throw new Error('图像接口没有返回图片');
    const file = path.join(dir(), key + extOf(item.mime));
    fs.writeFileSync(file, item.buffer);
    const row = {
      prompt,
      path: file,
      url: '/api/file?path=' + encodeURIComponent(file),
      bytes: item.buffer.length,
      mime: item.mime || '',
      model: channel.model,
      size,
      createdAt: Date.now(),
    };
    const rows = readIndex();
    rows[key] = row;
    writeIndex(rows);
    return { ...row, cached: false };
  })();

  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

module.exports = { one, cacheKey, sizeForRatio, MAX_PROMPT };
