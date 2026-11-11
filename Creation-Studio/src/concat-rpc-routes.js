'use strict';
/**
 * /api/concat/* —— 引擎的传输层（不是接口层）
 *
 * 前后端分离：剪辑台页面是 Concat 原生服务的客户端。方法名、参数、错误码都是引擎的，
 * 这个文件只负责把它们搬过去，绝不认识任何一条业务命令 —— 加新命令不用动这里。
 *
 *   GET  /api/concat/engine              引擎状态（在不在、pid、版本、root）
 *   POST /api/concat/engine/start        起引擎（页面第一次进来时点一下也行，或直接调 rpc 自动起）
 *   POST /api/concat/engine/stop         停引擎
 *   POST /api/concat/rpc                 {calls:[{id,method,params,lane?}], drain?}
 *                                        → {replies:[...], events:[...], engine:{...}}
 *   GET  /api/concat/frame?path=&t=&w=&h=  一帧 PNG（走 frame 通道，二进制直出，不进 JSON）
 *   POST /api/concat/pick                原生文件选择框 → {files:[绝对路径]}（media.import 要路径）
 *
 * 只认回环：这条口能改盘上的工程、能跑导出，不能给局域网。
 */
const engine = require('./concat-engine');
const fs = require('node:fs');
const path = require('node:path');

const PREFIX = '/api/concat';

function bad(status, message) {
  const error = Error(message);
  error.status = status;
  return error;
}

function isLoopback(req) {
  const raw = (req.socket && (req.socket.remoteAddress || '')) || '';
  return raw === '::1' || raw === '127.0.0.1' || /^::ffff:127\./.test(raw);
}

module.exports = async function concatRpcRoutes(req, res, url, { ok, readBody }) {
  const pathname = url.pathname;
  if (pathname !== PREFIX && !pathname.startsWith(PREFIX + '/')) return false;
  // /api/concat/assets/* 是素材缓存（缩略图、波形），归 concat-asset-routes
  if (pathname.startsWith(PREFIX + '/assets')) return false;
  if (!isLoopback(req)) throw bad(403, '剪辑台接口只对本机开放');

  const method = req.method.toUpperCase();
  const what = pathname.slice(PREFIX.length) || '/';

  if (method === 'GET' && what === '/engine') {
    ok(res, engine.status());
    return true;
  }

  if (method === 'POST' && what === '/engine/start') {
    const info = await engine.ping().catch((error) => ({ error: error.message }));
    ok(res, { engine: info.engine || null, status: engine.status(), error: info.error || null });
    return true;
  }

  if (method === 'POST' && what === '/engine/stop') {
    engine.stop();
    ok(res, engine.status());
    return true;
  }

  if (method === 'POST' && what === '/rpc') {
    const body = await readBody(req);
    const raw = Array.isArray(body.calls) ? body.calls : (body.method ? [body] : []);
    if (!raw.length && body.drain === false) throw bad(400, '缺少 calls');
    const calls = raw.map((row, index) => {
      const method = String((row && row.method) || '').trim();
      if (!method) throw bad(400, '第 ' + (index + 1) + ' 条缺少 method');
      const call = { method, params: (row && row.params) || {} };
      if (row && row.lane === 'frame') call.lane = 'frame';
      if (row && row.id !== undefined) call.id = row.id;
      return call;
    });
    const replies = await engine.callMany(calls);
    const payload = { replies, engine: engine.status() };
    if (body.drain !== false) payload.events = engine.drain();
    ok(res, payload);
    return true;
  }

  if (method === 'GET' && what === '/health') {
    // 环境自检：能写盘的目录、引擎的 titles 缓存（写不进去时预览里就没有文字和图形，且引擎只 warn）
    const status = engine.status();
    const warnings = [];
    if (!status.exeExists) warnings.push('找不到引擎 concat-cli：' + (status.exe || ''));
    if (!status.running) warnings.push('引擎没起来：' + (status.error || '点页面里的引擎重试，或看服务端日志'));
    let dirs = null;
    try {
      const replies = await engine.callMany([{ method: 'version', params: {} }]);
      const reply = replies && replies[0];
      if (reply && reply.ok && reply.result) dirs = reply.result.dirs || null;
    } catch (error) { /* 引擎不通，上面那条已经说了 */ }
    if (dirs && dirs.data) {
      const titles = path.join(dirs.data, 'titles');
      try {
        fs.mkdirSync(titles, { recursive: true });
        const probe = path.join(titles, '.probe-' + process.pid + '-' + Date.now());
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
      } catch (error) {
        warnings.push('引擎写不了文字/图形缓存 ' + titles + '（' + (error.code || error.message) + '）：预览里会看不到文字和贴纸');
      }
    }
    ok(res, { warnings, dirs, engine: status });
    return true;
  }

  if (method === 'POST' && what === '/pick') {
    // 后缀白名单 / 单选 / 标题都可交给页面定：字幕导入要 .srt .vtt，模板填槽要单文件
    const body = await readBody(req).catch(() => ({}));
    const exts = Array.isArray(body.exts) ? body.exts.map((ext) => String(ext).toLowerCase()).slice(0, 24) : [];
    const picked = await require('./media-picker').pickMediaFiles({
      exts,
      single: body.single === true,
      title: typeof body.title === 'string' ? body.title.slice(0, 120) : '',
    });
    ok(res, picked);
    return true;
  }

  if (method === 'GET' && what === '/frame') {
    const target = String(url.searchParams.get('path') || '').trim();
    if (!target) throw bad(400, '缺少 path');
    const time = Number(url.searchParams.get('t') || 0);
    const width = Number(url.searchParams.get('w') || 0);
    const height = Number(url.searchParams.get('h') || 0);
    const params = { path: target, time: Number.isFinite(time) ? time : 0 };
    if (width > 0) params.width = Math.round(width);
    if (height > 0) params.height = Math.round(height);
    // 引擎源码已收 nearest / proxy 两个开关（拖播放头用最近一帧、跟手读代理档）；
    // 老二进制会忽略未知字段，所以这里直通是安全的
    if (url.searchParams.get('nearest') === '1') params.nearest = true;
    if (url.searchParams.get('proxy') === '1') params.proxy = true;
    let shot;
    try {
      shot = await engine.call('preview.frame', params, { lane: 'frame' });
    } catch (error) {
      throw bad(error.status === 504 ? 504 : 409, error.message);
    }
    const png = shot && shot.png ? Buffer.from(shot.png, 'base64') : null;
    if (!png) throw bad(502, '引擎没有给出画面');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': png.length,
      'Cache-Control': 'no-store',
    });
    res.end(png);
    return true;
  }

  throw bad(404, '未知的剪辑台接口：' + pathname);
};
