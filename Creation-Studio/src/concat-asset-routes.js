'use strict';
/**
 * /api/concat/assets/* —— 引擎没有的素材加工（缩略图、波形、音视频流）
 *
 * 引擎的 21 个方法里没有缩略图和波形：原生窗口是在自己进程里现算的。浏览器要显示
 * 素材卡和波形，就得有人在服务端算一次、缓存起来。这一层只做这件事，不认识工程。
 *
 * 时间线的声音也是这样：引擎能渲染导出，但不给预览用的混音流。播放时页面按片段
 * 拉原文件的音轨自己同步，所以需要一个能按 Range 直出的口。
 *
 *   GET /api/concat/assets/thumb?path=<文件>&t=<秒>&w=<像素宽>
 *   GET /api/concat/assets/wave?path=<文件>&b=<峰值个数>
 *   GET /api/concat/assets/media?path=<文件>         音视频原文件（支持 Range）
 *
 * 只认回环，只认音视频/图片后缀。
 */
const fs = require('node:fs');
const path = require('node:path');
const assets = require('./concat-assets');

const PREFIX = '/api/concat/assets';

const STREAM_MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg', '.wma': 'audio/x-ms-wma', '.aif': 'audio/aiff', '.aiff': 'audio/aiff',
};

function bad(status, message) {
  const error = Error(message);
  error.status = status;
  return error;
}

// 字幕/纯文本：只认这三种后缀，别把 /doc 变成任意文件读取
const SUB_TEXT_EXT = new Set(['.srt', '.vtt', '.txt']);

function isLoopback(req) {
  const raw = (req.socket && (req.socket.remoteAddress || '')) || '';
  return raw === '::1' || raw === '127.0.0.1' || /^::ffff:127\./.test(raw);
}

/** 按 Range 直出：<audio> 要跳着播就靠它，缺了就只能从 0 播到底。 */
function stream(req, res, file, type) {
  const size = fs.statSync(file).size;
  const range = req.headers.range;
  if (range) {
    const hit = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    let start = parseInt((hit && hit[1]) || '', 10);
    let end = parseInt((hit && hit[2]) || '', 10);
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= size) end = size - 1;
    if (start > end) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + size });
      res.end();
      return true;
    }
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

module.exports = async function concatAssetRoutes(req, res, url) {
  const pathname = url.pathname;
  if (pathname !== PREFIX && !pathname.startsWith(PREFIX + '/')) return false;
  if (!isLoopback(req)) throw bad(403, '剪辑台接口只对本机开放');
  if (req.method.toUpperCase() !== 'GET') throw bad(405, '只支持 GET');

  const what = pathname.slice(PREFIX.length) || '/';
  const file = url.searchParams.get('path') || '';

  if (what === '/thumb') {
    const time = Number(url.searchParams.get('t') || 0);
    const width = Number(url.searchParams.get('w') || 160);
    const shot = await assets.thumb(file, Number.isFinite(time) ? time : 0, width);
    res.writeHead(200, {
      'Content-Type': shot.mime,
      'Content-Length': shot.buffer.length,
      'Cache-Control': 'private, max-age=86400',
    });
    res.end(shot.buffer);
    return true;
  }

  if (what === '/wave') {
    const buckets = Number(url.searchParams.get('b') || 600);
    const result = await assets.wave(file, buckets);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=86400' });
    res.end(JSON.stringify(result));
    return true;
  }

  if (what === '/media') {
    if (!file) throw bad(400, '缺少 path');
    const resolved = path.resolve(file);
    const type = STREAM_MIME[path.extname(resolved).toLowerCase()];
    if (!type) throw bad(400, '不是音视频文件：' + path.basename(resolved));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw bad(404, '文件不存在');
    return stream(req, res, resolved, type);
  }

  // 字幕文件读成文本：浏览器读不到绝对路径上的文件，导入 SRT/VTT 得有人代劳
  if (what === '/doc') {
    if (!file) throw bad(400, '缺少 path');
    const resolved = path.resolve(file);
    const ext = path.extname(resolved).toLowerCase();
    if (!SUB_TEXT_EXT.has(ext)) throw bad(400, '只读字幕文本（.srt / .vtt / .txt）：' + path.basename(resolved));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw bad(404, '文件不存在');
    if (fs.statSync(resolved).size > 4 * 1024 * 1024) throw bad(400, '文件太大（字幕最多 4 MB）');
    const text = fs.readFileSync(resolved, 'utf8').replace(/^\uFEFF/, '');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ path: resolved, name: path.basename(resolved), text }));
    return true;
  }

  throw bad(404, '未知的素材接口：' + pathname);
};
