'use strict';
/**
 * /api/local/dock —— 原生窗口停靠的 HTTP 门面（M1 伪嵌入）
 *
 *   GET  /api/local/dock            当前状态：有没有 concat 窗口、窗口矩形、DPI、代理是否在线
 *   POST /api/local/dock/dock       {x,y,w,h,scale,borderless} 把窗口停到物理像素矩形
 *   POST /api/local/dock/restore    还原成普通窗口（标题栏回来）
 *   POST /api/local/dock/launch     {project?} 没开就替用户开一个 Concat
 *
 * 坐标由前端用 getBoundingClientRect + screenX/screenY 算好，单位 CSS 像素，
 * 附带 devicePixelRatio；本层统一乘成物理像素再交给停靠代理。
 *
 * 这条接口能挪原生窗口，所以只认回环地址：远程连进来的请求一律 403。
 */
const dock = require('./local-dock');

function clientIp(req) {
  return String((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
}

function isLoopback(req) {
  const ip = clientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === '';
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = async function localDockRoutes(req, res, url, { ok, readBody }) {
  const pathname = url.pathname;
  if (pathname !== '/api/local/dock' && !pathname.startsWith('/api/local/dock/')) return false;

  if (!isLoopback(req)) {
    const error = Error('窗口停靠只对这台机器生效（来自 ' + clientIp(req) + ' 的请求被拒绝）');
    error.status = 403;
    throw error;
  }

  const method = req.method.toUpperCase();

  if (method === 'GET' && pathname === '/api/local/dock') {
    ok(res, await dock.status());
    return true;
  }

  if (method === 'POST' && pathname === '/api/local/dock/dock') {
    const body = await readBody(req);
    const w = num(body.w, 0);
    const h = num(body.h, 0);
    if (w < 200 || h < 120) {
      const error = Error('预留区域太小了（' + Math.round(w) + '×' + Math.round(h) + '），至少要 200×120');
      error.status = 400;
      throw error;
    }
    const result = await dock.dock({
      x: num(body.x, 0),
      y: num(body.y, 0),
      w,
      h,
      scale: num(body.scale, 1) || 1,
      borderless: body.borderless !== false
    });
    if (!result.ok) {
      if (result.running === false) {
        const error = Error('剪辑台还没开：先在页面里点「打开剪辑台」');
        error.status = 409;
        throw error;
      }
      const error = Error(result.error || '停靠失败');
      error.status = 409;
      throw error;
    }
    ok(res, result);
    return true;
  }

  if (method === 'POST' && pathname === '/api/local/dock/restore') {
    const result = await dock.restore();
    if (!result.ok && result.running === false) {
      const error = Error('没有正在运行的剪辑台窗口');
      error.status = 409;
      throw error;
    }
    ok(res, result);
    return true;
  }

  if (method === 'POST' && pathname === '/api/local/dock/launch') {
    const body = await readBody(req);
    const result = await dock.launch({ project: body.project || '' });
    if (!result.ok) {
      const error = Error(result.error || '打不开剪辑台');
      error.status = 409;
      throw error;
    }
    ok(res, result);
    return true;
  }

  const error = Error('未知的停靠接口');
  error.status = 404;
  throw error;
};
