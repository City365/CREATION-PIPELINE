'use strict';
/**
 * 素材缓存：缩略图与波形
 *
 * 引擎的 API 里没有这两样东西（它只给工程、时间线、编辑命令和合成帧），而原生的
 * Slint 前端是在自己进程里做这件事的。所以这一层补的是「引擎之外的素材加工」：
 * FFmpeg 取一帧当缩略图、取一份 PCM 算峰值当波形，带磁盘缓存。
 *
 * 它不碰工程语义：给一个文件路径和一个时间，回一张图或一组 0..1 的数。
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('./concat-engine');

const CACHE = process.env.WMD_CONCAT_CACHE
  || path.join(path.resolve(__dirname, '..', '..'), 'outputs', 'concat-validation', 'asset-cache');
const THUMB_TIMEOUT = Number(process.env.WMD_CONCAT_THUMB_TIMEOUT || 20000);
const WAVE_TIMEOUT = Number(process.env.WMD_CONCAT_WAVE_TIMEOUT || 60000);
const MAX_WAVE_BYTES = 64 * 1024 * 1024;

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v|ts|flv|wmv)$/i;
const AUDIO_EXT = /\.(wav|mp3|m4a|aac|flac|ogg|opus|aif|aiff)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic)$/i;
const ALLOWED = new RegExp(VIDEO_EXT.source + '|' + AUDIO_EXT.source + '|' + IMAGE_EXT.source, 'i');

function ffmpeg() {
  const bin = path.join(engine.FFMPEG_BIN || '', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (engine.FFMPEG_BIN && fs.existsSync(bin)) return bin;
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function ensureCache() {
  try { fs.mkdirSync(CACHE, { recursive: true }); } catch { /* ignore */ }
  return CACHE;
}

function keyOf(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 24);
}

function statOf(file) {
  const stat = fs.statSync(file);
  return { size: stat.size, mtime: Math.round(stat.mtimeMs) };
}

function assertMedia(file) {
  const target = path.resolve(String(file || ''));
  if (!target || !fs.existsSync(target)) {
    const error = Error('文件不存在：' + target);
    error.status = 404;
    throw error;
  }
  if (!fs.statSync(target).isFile()) {
    const error = Error('不是文件：' + target);
    error.status = 400;
    throw error;
  }
  if (!ALLOWED.test(target)) {
    const error = Error('不是音视频/图片文件：' + path.basename(target));
    error.status = 415;
    throw error;
  }
  return target;
}

function run(bin, args, timeoutMs, limitBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      reject(Object.assign(Error('FFmpeg 超时'), { status: 504 }));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (limitBytes && size > limitBytes) {
        try { child.kill(); } catch { /* ignore */ }
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => { if (stderr.length < 4000) stderr += text; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(Object.assign(Error('FFmpeg 起不来：' + error.message), { status: 500 }));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const buffer = Buffer.concat(chunks);
      if (code === 0 && buffer.length) resolve(buffer);
      else reject(Object.assign(Error('FFmpeg 失败（' + code + '）：' + stderr.trim().slice(0, 300)), { status: 502 }));
    });
  });
}

/**
 * 一张缩略图：把 `time` 秒那一帧缩到 `width` 宽，JPEG。
 * 同一个文件、同一时刻、同一宽度只算一次。
 */
async function thumb(file, time, width) {
  const target = assertMedia(file);
  const stat = statOf(target);
  const at = Math.max(0, Number(time) || 0);
  const box = Math.min(1024, Math.max(32, Math.round(Number(width) || 160)));
  const cache = ensureCache();
  const file_ = path.join(cache, keyOf(['thumb', target, stat.size, stat.mtime, at.toFixed(3), box]) + '.jpg');
  if (fs.existsSync(file_)) return { buffer: fs.readFileSync(file_), mime: 'image/jpeg', cached: true };

  const args = ['-v', 'error'];
  if (VIDEO_EXT.test(target) && at > 0) args.push('-ss', at.toFixed(3));
  args.push('-i', target, '-frames:v', '1', '-vf', 'scale=' + box + ':-2', '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1');
  const buffer = await run(ffmpeg(), args, THUMB_TIMEOUT, 8 * 1024 * 1024);
  try { fs.writeFileSync(file_, buffer); } catch { /* ignore */ }
  return { buffer, mime: 'image/jpeg', cached: false };
}

/**
 * 一条音频（或视频的音轨）的峰值：`buckets` 个 0..1 的数，画波形用。
 * 采样率压到 4 kHz 再算包络，一节几千字节，长片子也不会撑爆。
 */
async function wave(file, buckets) {
  const target = assertMedia(file);
  const stat = statOf(target);
  const count = Math.min(4000, Math.max(16, Math.round(Number(buckets) || 600)));
  const cache = ensureCache();
  const file_ = path.join(cache, keyOf(['wave', target, stat.size, stat.mtime, count]) + '.json');
  if (fs.existsSync(file_)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file_, 'utf8'));
      if (Array.isArray(saved.peaks) && saved.peaks.length) return saved;
    } catch { /* 缓存坏了就重算 */ }
  }

  const args = ['-v', 'error', '-i', target, '-map', '0:a:0', '-ac', '1', '-ar', '4000', '-f', 's16le', 'pipe:1'];
  const buffer = await run(ffmpeg(), args, WAVE_TIMEOUT, MAX_WAVE_BYTES);
  const samples = Math.floor(buffer.length / 2);
  const peaks = new Array(count).fill(0);
  if (samples > 0) {
    const per = Math.max(1, Math.ceil(samples / count));
    for (let i = 0; i < count; i++) {
      let peak = 0;
      const from = i * per;
      const to = Math.min(samples, from + per);
      for (let s = from; s < to; s++) {
        const value = Math.abs(buffer.readInt16LE(s * 2)) / 32768;
        if (value > peak) peak = value;
      }
      peaks[i] = Math.round(peak * 1000) / 1000;
    }
  }
  const result = { peaks, samples, rate: 4000 };
  try { fs.writeFileSync(file_, JSON.stringify(result)); } catch { /* ignore */ }
  return result;
}

function clearCache() {
  try { fs.rmSync(CACHE, { recursive: true, force: true }); } catch { /* ignore */ }
}

module.exports = { thumb, wave, clearCache, CACHE, ALLOWED };
