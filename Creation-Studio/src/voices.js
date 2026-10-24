'use strict';
/**
 * 本地音色库（克隆参考音色）
 *
 * 用户那套 800+ 音色本质是「克隆参考音频」：一段几十秒的样本 + 文件名里带的样本台词。
 * 这里只做三件事：
 *   1. 扫描目录、从文件名/父目录解析出「音色名 / 分组 / 样本台词」，缓存成索引；
 *   2. 列表给前端（搜索、试听）；
 *   3. 选中时把样本复制进 uploadFolder/voice/，成为音频槽里的一条参考音频。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { ensureDir, readJson, writeJson } = require('./util');

const DEFAULT_ROOT = 'D:\\notebook\\AIGC\\Comic-drama\\资产文档\\800+音色';
const AUDIO_EXT = new Set(['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.aac']);
// 这些目录名只是归档分类，不是音色名
const GENERIC_DIRS = new Set([
  '800+音色', '克隆参考音色', '智声整理音色', '逗哥音色整理合集', '音色文件', '王也',
  '400个火爆音色', '常用配音', '热门音色', '影视角色', '角色扮演', '豆哥方言', '逗哥热门音色',
  '中年-男声', '孩童', '老年',
]);
const JUNK = /[-—_]?由微信公众号.*$/;

let cache = { at: 0, root: '', items: [] };

function rootFolder() {
  const cfg = config.load();
  const configured = String(cfg.voiceLibraryFolder || '').trim();
  if (configured && fs.existsSync(configured)) return configured;
  if (fs.existsSync(DEFAULT_ROOT)) return DEFAULT_ROOT;
  return '';
}

function cleanName(value) {
  return String(value || '')
    .replace(JUNK, '')
    .replace(/[（(]\s*由?公众号[^)）]*[)）]/g, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeSpeech(text) {
  const value = String(text || '');
  if (value.length < 12) return false;
  return /[。，！？；：,.!?;:]/.test(value);
}

function parseName(file, relDir) {
  const ext = path.extname(file);
  const base = cleanName(path.basename(file, ext));
  const segments = relDir.split(/[\\/]+/).filter(Boolean).map(cleanName);
  const folderName = segments[segments.length - 1] || '';
  const dashAt = base.indexOf('-');
  let speaker = base;
  let note = '';
  if (dashAt > 0) {
    speaker = cleanName(base.slice(0, dashAt));
    note = cleanName(base.slice(dashAt + 1));
  }
  // 形如 音色文件/丽娟/女直播.MP3 —— 文件名是标签，音色名在父目录
  const parentIsSpeaker = segments.length >= 2 && !GENERIC_DIRS.has(folderName) && /[\u4e00-\u9fa5A-Za-z]/.test(folderName);
  if (parentIsSpeaker && (dashAt <= 0 || speaker.length <= 2)) {
    note = base;
    speaker = folderName;
  }
  if (!speaker) speaker = folderName || '未命名';
  const transcript = looksLikeSpeech(note) ? note : '';
  return {
    speaker: speaker.slice(0, 40),
    note: note.slice(0, 120),
    transcript,
  };
}

function wavSeconds(file, size) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4096);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    if (read < 44) return 0;
    let offset = 12;
    while (offset + 8 <= read) {
      const id = head.toString('ascii', offset, offset + 4);
      const len = head.readUInt32LE(offset + 4);
      if (id === 'data') {
        const fmtAt = head.indexOf('fmt ');
        const byteRate = fmtAt >= 0 && fmtAt + 16 <= read ? head.readUInt32LE(fmtAt + 16) : 0;
        if (!byteRate) return 0;
        return Math.round(((size - (offset + 8)) / byteRate) * 10) / 10;
      }
      offset += 8 + len + (len % 2);
    }
  } catch {
    return 0;
  }
  return 0;
}

const MP3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_RATES = [44100, 48000, 32000];

function mp3Seconds(file, size) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(8192);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    let start = 0;
    if (head.toString('ascii', 0, 3) === 'ID3' && read > 10) {
      start = 10 + ((head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 | (head[8] & 0x7f) << 7 | (head[9] & 0x7f));
    }
    for (let i = start; i + 4 < read; i += 1) {
      if (head[i] !== 0xff || (head[i + 1] & 0xe0) !== 0xe0) continue;
      const version = (head[i + 1] >> 3) & 0x03; // 3 = MPEG1
      const layer = (head[i + 1] >> 1) & 0x03; // 1 = Layer III
      const bitrateIndex = (head[i + 2] >> 4) & 0x0f;
      const rateIndex = (head[i + 2] >> 2) & 0x03;
      if (version !== 3 || layer !== 1 || !MP3_BITRATES[bitrateIndex] || rateIndex === 3) continue;
      const bitrate = MP3_BITRATES[bitrateIndex];
      return Math.round(((size - i) / (bitrate * 125)) * 10) / 10;
    }
  } catch {
    return 0;
  }
  return 0;
}

function probe(file, size) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.wav') return wavSeconds(file, size);
  if (ext === '.mp3') return mp3Seconds(file, size);
  return 0;
}

function walk(root, dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXT.has(ext)) continue;
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.size < 2048) continue;
    const relDir = path.dirname(path.relative(root, full));
    const parsed = parseName(entry.name, relDir === '.' ? '' : relDir);
    const group = (relDir === '.' ? '根目录' : relDir.split(/[\\/]+/).filter(Boolean).slice(-2).join(' / ')) || '根目录';
    out.push({
      id: crypto.createHash('sha1').update(path.relative(root, full)).digest('hex').slice(0, 12),
      speaker: parsed.speaker,
      group,
      file: path.relative(root, full),
      ext: ext.replace('.', ''),
      bytes: stat.size,
      seconds: probe(full, stat.size),
      note: parsed.note,
      transcript: parsed.transcript,
      mtime: Math.round(stat.mtimeMs),
    });
  }
}

function cacheFile() {
  return path.join(config.load().dataDir, 'voice-library.json');
}

function scan({ refresh = false } = {}) {
  const root = rootFolder();
  if (!root) return { root: '', groups: [], items: [], total: 0, builtAt: Date.now() };
  const meta = readJson(cacheFile(), null);
  const sameRoot = meta && meta.root === root;
  if (!refresh && sameRoot && cache.root === root && cache.items.length) {
    return summarize(root, cache.items);
  }
  const items = [];
  walk(root, root, items);
  items.sort((a, b) => a.speaker.localeCompare(b.speaker, 'zh'));
  cache = { at: Date.now(), root, items };
  writeJson(cacheFile(), { root, builtAt: cache.at, total: items.length, items });
  return summarize(root, items);
}

function summarize(root, items) {
  const counts = new Map();
  for (const item of items) counts.set(item.group, (counts.get(item.group) || 0) + 1);
  return {
    root,
    builtAt: cache.at || Date.now(),
    total: items.length,
    groups: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    items: items.map(({ mtime, file, ...rest }) => rest),
  };
}

function find(id) {
  if (!cache.items.length) scan();
  return cache.items.find((item) => item.id === id) || null;
}

function pick(id) {
  const item = find(id);
  if (!item) throw new Error('音色不存在，刷新一下音色库');
  const root = rootFolder();
  const src = path.join(root, item.file);
  if (!fs.existsSync(src)) throw new Error('音色文件已被移动或删除');
  const cfg = config.load();
  const dir = ensureDir(path.join(cfg.uploadFolder, 'voice'));
  const original = path.basename(item.file);
  const stem = path.basename(original, path.extname(original));
  const baseName = (stem === item.speaker ? original : `${item.speaker}-${original}`).replace(/[\\/:*?"<>|]+/g, '_');
  let dest = path.join(dir, baseName);
  let index = 1;
  while (fs.existsSync(dest)) {
    const ext = path.extname(baseName);
    const stem = path.basename(baseName, ext);
    if (fs.statSync(dest).size === item.bytes) break;
    dest = path.join(dir, `${stem}-${index}${ext}`);
    index += 1;
  }
  if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
  return {
    path: dest,
    name: path.basename(dest),
    kind: 'audio',
    bytes: item.bytes,
    seconds: item.seconds,
    voice: item.speaker,
    voiceId: item.id,
    transcript: item.transcript,
  };
}

module.exports = { scan, pick, find, rootFolder, DEFAULT_ROOT };
