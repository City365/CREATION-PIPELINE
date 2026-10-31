'use strict';
/**
 * v2：连接官方豆包桌面客户端。
 *
 * 客户端是 Chromium 内核，用 --remote-debugging-port 启动后可以用 Playwright
 * 直接接管页面（DOM 级操作，不是截图点坐标），这也让「官方客户端」这条路
 * 既贴近人工使用、又比网页版少一层风控。
 *
 * 这里只管连接和进程生命周期，具体操作见 drive.js。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const DEFAULT_PORT = Number(process.env.WMD_DOUBAO_CDP_PORT || 9334);
// 客户端可能已经被别的工具用别的端口接管过，先看看这几个常见端口。
const PROBE_PORTS = [DEFAULT_PORT, 9333, 9335, 9336];
const CHAT_URL_PART = '/chat';

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
}

function exeCandidates() {
  return [
    process.env.WMD_DOUBAO_EXE,
    'D:/notebook/software/Doubao/Doubao.exe',
    path.join(localAppData(), 'Doubao', 'Doubao.exe'),
    'C:/Program Files/Doubao/Doubao.exe',
    'C:/Program Files (x86)/Doubao/Doubao.exe',
  ].filter(Boolean);
}

function findExe() {
  for (const candidate of exeCandidates()) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
    } catch { /* 下一个候选 */ }
  }
  return '';
}

function processList() {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Doubao.exe', '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    return out.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^"/.test(line));
  } catch {
    return [];
  }
}

function isRunning() {
  return processList().length > 0;
}

async function cdpVersion(port = DEFAULT_PORT, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function listTargets(port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error('读取客户端页面列表失败：HTTP ' + res.status);
  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, { timeoutMs = 30000, intervalMs = 400, label = '等待超时' } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(label);
}

/** 关掉已经在跑、但没开调试端口的客户端（否则无法接管）。 */
function stopClient() {
  try {
    execFileSync('taskkill', ['/IM', 'Doubao.exe', '/F'], { windowsHide: true, timeout: 10000 });
  } catch { /* 没在跑就算了 */ }
}

async function startClient({ port = DEFAULT_PORT, exe = '' } = {}) {
  const target = exe || findExe();
  if (!target) throw new Error('没找到豆包客户端 Doubao.exe，可在管理器设置里指定路径');
  spawn(target, [`--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  await waitFor(() => cdpVersion(port), { timeoutMs: 45000, label: '客户端启动后没有开放调试端口' });
  return target;
}

/**
 * 确保客户端可接管：
 * - 没在跑 → 用调试端口启动；
 * - 在跑且已开端口 → 直接用；
 * - 在跑但没开端口 → 报错，由界面上的「重启客户端」按钮决定是否强制重启。
 */
/** 找一个已经开着调试端口的客户端。 */
async function detectPort() {
  for (const port of PROBE_PORTS) {
    if (await cdpVersion(port)) return port;
  }
  return 0;
}

async function ensureReady({ port = DEFAULT_PORT, exe = '', restart = false } = {}) {
  const existing = await detectPort();
  if (existing) return { port: existing, started: false, exe: exe || findExe() };
  if (isRunning()) {
    if (!restart) {
      const error = new Error('豆包客户端已经在运行，但没有开启调试端口；需要重启客户端才能被接管');
      error.code = 'NEED_RESTART';
      throw error;
    }
    stopClient();
    await sleep(2500);
  }
  const target = await startClient({ port, exe });
  return { port, started: true, exe: target };
}

let cached = null;

async function connect({ port = 0 } = {}) {
  if (!port) port = (await detectPort()) || DEFAULT_PORT;
  if (cached && cached.port === port) {
    try {
      // 连接还在就直接复用；页面被关掉时重新找一次
      const page = await pickPage(cached.browser);
      if (page) return { ...cached, page };
    } catch {
      cached = null;
    }
  }
  const { chromium } = require('playwright-core');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await pickPage(browser);
  cached = { port, browser, page };
  return cached;
}

async function pickPage(browser) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const chat = pages.find((page) => page.url().includes(CHAT_URL_PART));
  if (chat) return chat;
  // 有时页面还在加载，等一小会儿
  await sleep(800);
  return browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().includes(CHAT_URL_PART)) || null;
}

/** 切账号会让客户端重建页面，旧句柄作废，必须重新连接。 */
async function reconnect({ port = 0 } = {}) {
  cached = null;
  return connect({ port });
}

async function disconnect() {
  if (!cached) return;
  try { await cached.browser.close(); } catch { /* CDP 断开不影响客户端本身 */ }
  cached = null;
}

async function status({ port = 0 } = {}) {
  if (!port) port = (await detectPort()) || DEFAULT_PORT;
  const version = await cdpVersion(port);
  return {
    port,
    exe: findExe(),
    running: isRunning(),
    attached: Boolean(version),
    browser: version ? version.Browser : '',
  };
}

module.exports = {
  DEFAULT_PORT,
  detectPort,
  findExe,
  isRunning,
  cdpVersion,
  listTargets,
  ensureReady,
  startClient,
  stopClient,
  connect,
  reconnect,
  disconnect,
  pickPage,
  status,
  sleep,
  waitFor,
};
