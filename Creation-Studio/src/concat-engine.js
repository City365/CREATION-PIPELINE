'use strict';
/**
 * Concat 原生服务（前后端分离的那一半）
 *
 * 这里只做三件事，一件业务都不做：
 *   1. 起 `concat-cli serve`，从它的启动横幅里读端口和令牌；
 *   2. 开 TCP 连接、发 auth、把 JSON-RPC 调用原样转发；
 *   3. 把引擎广播的事件（export.progress 之类）攒起来交给上层取走。
 *
 * 方法名、参数、错误码全部是引擎的，这一层不认识它们 —— 加一条新命令不用改这里。
 * 前端因此是 Concat 的客户端，而不是我们的接口的客户端。
 *
 * 为什么用 `concat-cli` 而不是 `concat`：
 *   `concat.exe` 是编辑器窗口；不带 `--mcp` 时它会开窗。`concat-cli` 根本不链接
 *   Slint，只有引擎和 socket 两种传输，所以「后端独立启动、永不出现前端画面」。
 *
 * 为什么两条连接（lane）：
 *   json 传输挂在一条连接上是一条一条处理的。预览帧一张要 80~320ms，如果和编辑
 *   共用一条连接，拖动时会把手感拖死。cmd 与 frame 各一条，互不排队。
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const PIPELINE = path.resolve(__dirname, '..', '..');
const TARGET_DIR = path.join(PIPELINE, 'Concat', 'src', 'target');

/**
 * 引擎二进制的挑选顺序。
 * release 最快、quick 次之、debug 最慢（同一张 1080p 预览帧：56ms / 56ms / 800ms）。
 * 一律按「存在即优先」取，避免把构建档位写死在源码里。
 */
function pickCliExe() {
  if (process.env.WMD_CONCAT_CLI) return process.env.WMD_CONCAT_CLI;
  for (const profile of ['release', 'quick', 'debug']) {
    const candidate = path.join(TARGET_DIR, profile, 'concat-cli.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(TARGET_DIR, 'debug', 'concat-cli.exe');
}

/**
 * ffmpeg 运行库目录（只用于 PATH；引擎本体是静态链接 libav* 的，
 * 真正的 DLL 靠 exe 同目录那一份，见 target/<profile>/*.dll）。
 * 这里保留是为了万一有子进程要调 ffmpeg。
 */
function pickFfmpegBin() {
  if (process.env.WMD_FFMPEG_BIN) return process.env.WMD_FFMPEG_BIN;
  const candidates = [
    path.join(PIPELINE, 'outputs', 'concat-validation', 'deps', 'ffmpeg',
      'ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-shared-8.1', 'bin'),
    path.join(PIPELINE, 'outputs', 'concat-validation', 'deps', 'ffmpeg-dev', 'bin'),
  ];
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return candidates[0];
}

const CLI_EXE = pickCliExe();
const FFMPEG_BIN = pickFfmpegBin();
// 引擎只允许在 root 之下新建工程、保存、导出、写预览帧文件。
const ROOT = process.env.WMD_CONCAT_ROOT
  || (process.env.WMD_CONCAT_ROOT_ANY === '1' ? '/' : path.join(PIPELINE, 'outputs'));
const SCRATCH = path.join(PIPELINE, 'outputs', 'concat-validation', 'engine-home');

const BOOT_TIMEOUT = Number(process.env.WMD_CONCAT_BOOT_TIMEOUT || 20000);
const CALL_TIMEOUT = Number(process.env.WMD_CONCAT_TIMEOUT || 120000);
const FRAME_TIMEOUT = Number(process.env.WMD_CONCAT_FRAME_TIMEOUT || 60000);
// 引擎监听的地址。默认交给系统挑端口（:0），真实端口从启动横幅读回来；
// 想固定（别的脚本要直连）就设 WMD_CONCAT_ADDR=127.0.0.1:7420。
const LISTEN = process.env.WMD_CONCAT_ADDR || '127.0.0.1:0';
const MAX_EVENTS = 400;
const MAX_RESTARTS = 5;

const BANNER_ADDR = /JSON-RPC on ([^\s]+)/;
const BANNER_TOKEN = /token ([0-9a-fA-F]{16,})/;
const BANNER_ROOTS = /writes under (.+)$/;

let child = null;
let booting = null;
let token = '';
let addr = '';
let roots = [];
let apiVersion = '';
let lastError = '';
let restarts = 0;
let startedAt = 0;
let lastExit = null;
const events = [];
const lanes = { cmd: null, frame: null };

function log(...args) {
  if (process.env.WMD_CONCAT_DEBUG) console.log('[concat-engine]', ...args);
}

function binaryExists() {
  return fs.existsSync(CLI_EXE);
}

/* --------------------------------------------------------------- 进程 */

function buildEnv() {
  const env = Object.assign({}, process.env);
  const parts = [];
  if (fs.existsSync(FFMPEG_BIN)) parts.push(FFMPEG_BIN);
  if (env.PATH) parts.push(env.PATH);
  env.PATH = parts.join(';');
  // 引擎要写日志/字体缓存；用户目录被拒写时会把失败变成静默，指到临时目录兜底
  try { fs.mkdirSync(SCRATCH, { recursive: true }); } catch { /* ignore */ }
  if (!env.APPDATA || !fs.existsSync(env.APPDATA)) env.APPDATA = SCRATCH;
  if (!env.LOCALAPPDATA || !fs.existsSync(env.LOCALAPPDATA)) env.LOCALAPPDATA = SCRATCH;
  return env;
}

function bannerLine(line) {
  const hitAddr = BANNER_ADDR.exec(line);
  if (hitAddr && !addr) {
    addr = hitAddr[1].trim();
    log('地址', addr);
  }
  const hitToken = BANNER_TOKEN.exec(line);
  if (hitToken && !token) {
    token = hitToken[1].trim();
    log('令牌就绪');
  }
  const hitRoots = BANNER_ROOTS.exec(line);
  if (hitRoots) roots = hitRoots[1].split(',').map((s) => s.trim()).filter(Boolean);
}

function ensure() {
  if (child && addr && token) return Promise.resolve({ addr, token });
  if (booting) return booting;
  if (!binaryExists()) {
    lastError = '找不到引擎：' + CLI_EXE;
    return Promise.reject(Object.assign(new Error(lastError), { status: 500, code: 'no-engine' }));
  }
  if (restarts > MAX_RESTARTS) {
    lastError = '引擎反复退出（' + restarts + ' 次），已停止自动重启：' + (lastExit || '');
    return Promise.reject(Object.assign(new Error(lastError), { status: 503, code: 'engine-crash-loop' }));
  }

  addr = ''; token = ''; roots = []; apiVersion = ''; lastError = '';
  const minted = crypto.randomBytes(16).toString('hex');
  // 端口默认交给系统挑（:0），再把真实端口从横幅读回来，避免撞端口
  const args = ['serve', '--json', LISTEN, '--token', minted, '--root', ROOT];
  log('启动', CLI_EXE, args.join(' '));

  child = spawn(CLI_EXE, args, { env: buildEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  startedAt = Date.now();

  booting = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      booting = null;
      if (error) reject(error); else resolve({ addr, token });
    };
    const timer = setTimeout(() => finish(Object.assign(new Error('引擎 ' + Math.round(BOOT_TIMEOUT / 1000) + ' 秒没有就绪'), { status: 504 })), BOOT_TIMEOUT);
    if (timer.unref) timer.unref();

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '').trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const hitVersion = /Concat API ([\d.]+)/.exec(line);
        if (hitVersion) apiVersion = hitVersion[1];
        bannerLine(line);
        if (addr && token) {
          clearTimeout(timer);
          restarts = 0;
          finish(null);
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (!text) return;
      lastError = text.slice(0, 400);
      log('stderr', lastError);
    });

    child.on('error', (error) => {
      lastError = '引擎启动失败：' + error.message;
      clearTimeout(timer);
      finish(Object.assign(new Error(lastError), { status: 500 }));
    });

    child.on('exit', (code, signal) => {
      lastExit = 'code=' + code + (signal ? ' signal=' + signal : '');
      log('引擎退出', lastExit);
      child = null;
      addr = ''; token = '';
      closeLanes('引擎退出了（' + lastExit + '）');
      clearTimeout(timer);
      finish(Object.assign(new Error('引擎退出了（' + lastExit + '）'), { status: 502 }));
    });
  });

  return booting;
}

/* --------------------------------------------------------------- 连接 */

function makeLane(name) {
  return { name, socket: null, buffer: '', seq: 0, pending: new Map(), ready: null, authed: false };
}

function closeLanes(reason) {
  for (const key of Object.keys(lanes)) {
    const lane = lanes[key];
    if (!lane) continue;
    if (lane.socket) {
      try { lane.socket.destroy(); } catch { /* ignore */ }
    }
    for (const [, slot] of lane.pending) {
      clearTimeout(slot.timer);
      slot.reject(Object.assign(new Error(reason), { status: 502 }));
    }
    lane.pending.clear();
    lane.socket = null;
    lane.ready = null;
    lane.authed = false;
    lanes[key] = null;
  }
}

function laneFor(name) {
  const key = name === 'frame' ? 'frame' : 'cmd';
  if (!lanes[key]) lanes[key] = makeLane(key);
  return lanes[key];
}

function connect(name) {
  const lane = laneFor(name);
  if (lane.ready) return lane.ready;

  lane.ready = ensure().then(({ addr: target, token: secret }) => new Promise((resolve, reject) => {
    const [host, portText] = target.split(':');
    const port = Number(portText);
    if (!host || !Number.isFinite(port)) {
      reject(Object.assign(new Error('引擎地址看不懂：' + target), { status: 502 }));
      return;
    }
    const socket = net.connect({ host, port });
    lane.socket = socket;
    lane.buffer = '';
    socket.setEncoding('utf8');
    socket.setNoDelay(true);

    const onFail = (error) => {
      if (lane.ready === failed) lane.ready = null;
      lane.socket = null;
      lane.authed = false;
      reject(Object.assign(new Error('连不上引擎：' + error.message), { status: 502 }));
    };
    const failed = lane.ready;

    socket.once('error', onFail);
    socket.on('data', (chunk) => {
      lane.buffer += chunk;
      let index;
      while ((index = lane.buffer.indexOf('\n')) >= 0) {
        const line = lane.buffer.slice(0, index).replace(/\r$/, '').trim();
        lane.buffer = lane.buffer.slice(index + 1);
        if (!line) continue;
        let message = null;
        try { message = JSON.parse(line); } catch { log('非 JSON 行', line.slice(0, 160)); continue; }
        if (message.id === undefined || message.id === null) {
          events.push(message);
          if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
          continue;
        }
        const slot = lane.pending.get(message.id);
        if (!slot) { log('没人等的回包', line.slice(0, 160)); continue; }
        lane.pending.delete(message.id);
        clearTimeout(slot.timer);
        if (message.error) {
          slot.reject(Object.assign(new Error(message.error.message || '引擎拒绝'), {
            status: 409,
            engine: message.error,
            code: (message.error.data && message.error.data.code) || (message.error.code),
          }));
        } else {
          slot.resolve(message.result);
        }
      }
    });
    socket.on('close', () => {
      lane.socket = null;
      lane.ready = null;
      lane.authed = false;
      for (const [, slot] of lane.pending) {
        clearTimeout(slot.timer);
        slot.reject(Object.assign(new Error('引擎连接断了'), { status: 502 }));
      }
      lane.pending.clear();
    });

    socket.once('connect', () => {
      socket.removeListener('error', onFail);
      socket.on('error', (error) => log('socket error', error.message));
      // 第一条必须是 auth；连 127.0.0.1 也要
      const id = 0;
      const slot = { resolve: null, reject: null, timer: null };
      const done = new Promise((res, rej) => { slot.resolve = res; slot.reject = rej; });
      slot.timer = setTimeout(() => {
        lane.pending.delete(id);
        rej(Object.assign(new Error('引擎没有确认令牌'), { status: 502 }));
      }, 8000);
      lane.pending.set(id, slot);
      socket.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'auth', params: { token: secret } }) + '\n');
      done.then(() => {
        lane.authed = true;
        resolve(lane);
      }, (error) => {
        lane.ready = null;
        try { socket.destroy(); } catch { /* ignore */ }
        reject(error);
      });
    });
  })).catch((error) => {
    lane.ready = null;
    throw error;
  });

  return lane.ready;
}

function send(name, method, params, timeoutMs) {
  return connect(name).then((lane) => new Promise((resolve, reject) => {
    if (!lane.socket) {
      reject(Object.assign(new Error('引擎连接已关闭'), { status: 502 }));
      return;
    }
    const id = ++lane.seq;
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} });
    const timer = setTimeout(() => {
      lane.pending.delete(id);
      reject(Object.assign(new Error('引擎 ' + Math.round(timeoutMs / 1000) + ' 秒没有回包（' + method + '）'), { status: 504 }));
    }, timeoutMs);
    if (timer.unref) timer.unref();
    lane.pending.set(id, { resolve, reject, timer });
    try { lane.socket.write(body + '\n'); }
    catch (error) {
      clearTimeout(timer);
      lane.pending.delete(id);
      reject(Object.assign(error, { status: 500 }));
    }
  }));
}

/* --------------------------------------------------------------- 对外 */

/** 一条原生调用。方法名和参数原样交给引擎，返回它给的结果。 */
function call(method, params, options) {
  const opts = options || {};
  const lane = opts.lane === 'frame' ? 'frame' : 'cmd';
  const timeout = lane === 'frame' ? (opts.timeout || FRAME_TIMEOUT) : (opts.timeout || CALL_TIMEOUT);
  return send(lane, method, params, timeout);
}

/** 多条调用一起发；语义仍是引擎的，一条失败不影响其它条。 */
async function callMany(list) {
  const rows = Array.isArray(list) ? list : [];
  const out = new Array(rows.length);
  await Promise.all(rows.map(async (row, index) => {
    try {
      out[index] = { ok: true, result: await call(row.method, row.params, { lane: row.lane }) };
    } catch (error) {
      out[index] = {
        ok: false,
        error: {
          message: error.message,
          code: error.code || null,
          engine: error.engine || null,
        },
      };
    }
    if (row && row.id !== undefined) out[index].id = row.id;
  }));
  return out;
}

/** 取走攒下的事件（引擎广播：export.progress / export.done / project.edited …）。 */
function drain() {
  return events.splice(0, events.length);
}

function status() {
  return {
    exe: CLI_EXE,
    profile: path.basename(path.dirname(CLI_EXE)),
    exeExists: binaryExists(),
    ffmpeg: fs.existsSync(FFMPEG_BIN) ? FFMPEG_BIN : '',
    root: ROOT,
    listen: LISTEN,
    running: Boolean(child),
    pid: child ? child.pid : 0,
    addr,
    apiVersion,
    roots,
    restarts,
    uptimeMs: startedAt ? Date.now() - startedAt : 0,
    error: lastError,
    lastExit,
  };
}

function stop() {
  closeLanes('引擎已停止');
  const dying = child;
  child = null;
  addr = ''; token = '';
  if (!dying) return;
  try { dying.kill(); } catch { /* ignore */ }
  log('引擎已停止');
}

/** 排障用：确认引擎活着并能应答。 */
async function ping() {
  const info = await call('version', {});
  return { engine: info, status: status() };
}

module.exports = {
  call, callMany, drain, status, stop, ping, ensure,
  CLI_EXE, FFMPEG_BIN, ROOT,
  get running() { return Boolean(child); },
};
