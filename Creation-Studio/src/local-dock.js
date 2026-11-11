'use strict';
/**
 * 原生窗口停靠（M1 伪嵌入）· 后端
 *
 * 浏览器没法把 Slint 原生窗口塞进 DOM，但可以让它精确地坐在页面预留区域的正上方：
 * 前端报矩形 → 本模块 → 常驻的 dock-agent.ps1 → SetWindowPos → 原生窗口落位。
 *
 * 为什么是常驻子进程而不是每次 spawn：
 *   启动一次 powershell 要 600~900ms，而拖动分栏、滚动页面每秒会报十几次坐标。
 *   dock-agent 启动时 Add-Type 一次，之后每条 JSON 行只做一次 SetWindowPos。
 *
 * 坐标约定：前端报的是 CSS 像素 + devicePixelRatio，本模块统一乘成物理像素再交给代理。
 * 代理进程本身声明了 PER_MONITOR_AWARE_V2，所以拿到的矩形就是屏幕物理像素。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PIPELINE = path.resolve(__dirname, '..', '..');
const AGENT_SCRIPT = process.env.WMD_DOCK_AGENT
  || path.join(PIPELINE, 'tools', 'concat-dev', 'dock-agent.ps1');
const CONCAT_EXE = process.env.WMD_CONCAT_EXE
  || path.join(PIPELINE, 'Concat', 'src', 'target', 'debug', 'concat.exe');
const FFMPEG_BIN = process.env.WMD_FFMPEG_BIN
  || path.join(PIPELINE, 'outputs', 'concat-validation', 'deps', 'ffmpeg',
    'ffmpeg-n8.1.3-9-g29e619e767-win64-lgpl-shared-8.1', 'bin');
const POWERSHELL = process.env.WMD_POWERSHELL
  || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const IDLE_MS = 90 * 1000;      // 这么久没人用就把代理收掉，别在任务管理器里留一个幽灵
const CALL_MS = 4000;           // 单条命令等回包的上限

let agent = null;               // { child, ready, seq }
const pending = new Map();      // seq → { resolve, reject, timer }
let readyPromise = null;
let idleTimer = null;
let lastRect = null;            // 上一次成功停靠的物理矩形，重连后可复用
let lastError = '';

function log(...args) {
  if (process.env.WMD_DOCK_DEBUG) console.log('[dock]', ...args);
}

function touchIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { stopAgent('idle'); }, IDLE_MS);
  if (idleTimer.unref) idleTimer.unref();
}

function clearPending(reason) {
  for (const [, slot] of pending) {
    clearTimeout(slot.timer);
    slot.reject(Object.assign(new Error(reason), { dock: true }));
  }
  pending.clear();
}

function startAgent() {
  if (agent) return readyPromise;
  if (!fs.existsSync(AGENT_SCRIPT)) {
    lastError = '停靠代理脚本不存在：' + AGENT_SCRIPT;
    return Promise.reject(Object.assign(new Error(lastError), { dock: true, status: 500 }));
  }

  const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', AGENT_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  agent = { child, seq: 0, ready: false };
  let buffer = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '').trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message = null;
      try { message = JSON.parse(line); } catch { log('非 JSON 行', line.slice(0, 200)); continue; }
      if (message.cmd === 'ready') { agent.ready = true; continue; }
      const slot = pending.get(message.seq);
      if (!slot) { log('没人等的回包', line.slice(0, 200)); continue; }
      pending.delete(message.seq);
      clearTimeout(slot.timer);
      slot.resolve(message);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { lastError = String(chunk).trim().slice(0, 500); log('stderr', lastError); });

  child.on('error', (error) => {
    lastError = '停靠代理启动失败：' + error.message;
    clearPending(lastError);
    agent = null;
    readyPromise = null;
  });

  child.on('exit', (code, signal) => {
    log('代理退出', code, signal);
    clearPending('停靠代理已退出，请重试');
    agent = null;
    readyPromise = null;
  });

  readyPromise = new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (!agent) return reject(Object.assign(new Error(lastError || '停靠代理没起来'), { dock: true, status: 500 }));
      if (agent.ready) return resolve();
      if (Date.now() - started > 15000) return reject(Object.assign(new Error('停靠代理 15 秒没有就绪'), { dock: true, status: 500 }));
      setTimeout(tick, 40);
    };
    tick();
  });

  touchIdle();
  return readyPromise;
}

function stopAgent(reason) {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (!agent) return;
  const { child } = agent;
  clearPending('停靠代理已停止');
  agent = null;
  readyPromise = null;
  try { child.stdin.write(JSON.stringify({ seq: 0, cmd: 'stop' }) + '\n'); } catch { /* 已经凉了 */ }
  const killTimer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 400);
  if (killTimer.unref) killTimer.unref();
  log('代理停止：', reason || '手动');
}

async function call(cmd, payload = {}) {
  await startAgent();
  if (!agent) throw Object.assign(new Error(lastError || '停靠代理不可用'), { dock: true, status: 500 });
  const seq = ++agent.seq;
  const body = Object.assign({ seq, cmd }, payload);
  touchIdle();
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(seq);
      reject(Object.assign(new Error('停靠代理 4 秒没有回包'), { dock: true, status: 504 }));
    }, CALL_MS);
    pending.set(seq, { resolve, reject, timer });
    try { agent.child.stdin.write(JSON.stringify(body) + '\n'); }
    catch (error) { clearTimeout(timer); pending.delete(seq); reject(Object.assign(error, { dock: true, status: 500 })); }
  });
}

/** 当前是不是有 concat 窗口；顺带把窗口信息带回去。 */
async function status() {
  const reply = await call('status');
  const running = Boolean(reply && reply.running);
  return {
    ok: true,
    agent: Boolean(agent && agent.ready),
    running,
    hwnd: reply && reply.hwnd || null,
    title: reply && reply.title || '',
    rect: reply && reply.rect || null,
    dpi: reply && reply.dpi || 96,
    borderless: Boolean(reply && reply.borderless),
    topmost: Boolean(reply && reply.topmost),
    maximized: Boolean(reply && reply.maximized),
    windows: (reply && reply.windows) || [],
    virtualScreen: reply && reply.virtualScreen || null,
    docked: lastRect,
    exe: CONCAT_EXE,
    exeExists: fs.existsSync(CONCAT_EXE),
    error: running ? '' : (reply && reply.error || '')
  };
}

/**
 * 把窗口停到物理像素矩形里。
 * @param {{x:number,y:number,w:number,h:number,scale?:number,borderless?:boolean}} box
 */
async function dock(box) {
  const scale = Number(box.scale) > 0 ? Number(box.scale) : 1;
  const rect = {
    x: Math.round(Number(box.x || 0) * scale),
    y: Math.round(Number(box.y || 0) * scale),
    w: Math.max(200, Math.round(Number(box.w || 0) * scale)),
    h: Math.max(120, Math.round(Number(box.h || 0) * scale))
  };
  const reply = await call('dock', {
    x: rect.x, y: rect.y, w: rect.w, h: rect.h,
    borderless: box.borderless !== false,
    topmost: box.topmost !== false
  });
  if (!reply || reply.ok === false) {
    return { ok: false, running: false, error: (reply && reply.error) || '停靠失败', requested: rect };
  }
  lastRect = reply.rect || rect;
  return {
    ok: true,
    running: true,
    hwnd: reply.hwnd,
    rect: lastRect,
    dpi: reply.dpi,
    borderless: Boolean(reply.borderless),
    topmost: reply.topmost !== false,
    applied: reply.applied !== false,
    requested: rect
  };
}

/** 还原成普通窗口：标题栏、边框都装回去，放到屏幕中间偏左上。 */
async function restore() {
  const reply = await call('restore');
  lastRect = null;
  if (!reply || reply.ok === false) return { ok: false, running: false, error: (reply && reply.error) || '还原失败' };
  return { ok: true, running: true, hwnd: reply.hwnd, rect: reply.rect, borderless: false };
}

/** concat 没开就替用户开一个（前端按钮点一下就能进剪辑台）。 */
async function launch(options = {}) {
  if (!fs.existsSync(CONCAT_EXE)) {
    return { ok: false, error: '找不到 Concat 二进制：' + CONCAT_EXE + '（先跑 dev.ps1 build concat）' };
  }
  const probe = await status().catch((error) => ({ running: false, error: error.message }));
  if (probe.running) return { ok: true, already: true, pid: null, status: probe };

  const env = Object.assign({}, process.env);
  const parts = [];
  if (fs.existsSync(FFMPEG_BIN)) parts.push(FFMPEG_BIN);
  if (env.PATH) parts.push(env.PATH);
  env.PATH = parts.join(';');

  const args = [];
  if (options.project && fs.existsSync(options.project)) args.push('--project', options.project);
  const child = spawn(CONCAT_EXE, args, {
    cwd: path.dirname(CONCAT_EXE),
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();

  // 等窗口真的出现**并且稳定**再回话：Slint 冷启动会先冒启动页，
  // 只看「有没有窗口」会把启动页当成主窗口报出去，页面那边就停错了对象。
  const deadline = Date.now() + 30000;
  let last = null;
  let stable = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 350));
    last = await status().catch(() => null);
    if (!last || !last.running) { stable = null; continue; }
    const box = last.rect || {};
    if (!box.w || box.w < 400 || (box.h || 0) < 300) { stable = null; continue; }
    if (stable && stable.hwnd === last.hwnd && stable.rect.w === box.w && stable.rect.h === box.h && stable.rect.x === box.x) {
      return { ok: true, already: false, pid: child.pid, status: last };
    }
    stable = { hwnd: last.hwnd, rect: { x: box.x, y: box.y, w: box.w, h: box.h } };
  }
  return { ok: false, pid: child.pid, error: 'Concat 起来了但 30 秒内没等到稳定的主窗口', status: last };
}

function isRunning() {
  return Boolean(agent && agent.ready);
}

module.exports = { status, dock, restore, launch, stop: stopAgent, isRunning, AGENT_SCRIPT, CONCAT_EXE, FFMPEG_BIN };
