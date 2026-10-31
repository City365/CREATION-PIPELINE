'use strict';
/**
 * WENYUN.M-DESKTOP 一键启动 / 守护（Windows 优先，其它平台也能跑）。
 *
 *   node scripts/launch.js            # 起管理器 + 智能体 + 创作台（前台日志）
 *   node scripts/launch.js --app      # 同上，再用 Chrome 应用窗口打开
 *   node scripts/launch.js --no-manager
 *
 * 规则：
 *   - 端口已经有健康服务时直接复用，不重复启动；
 *   - 子进程退出后自动重启（5 分钟内最多 5 次，超过就标记失败并提示）；
 *   - Ctrl+C / 关闭窗口时一起停掉子进程。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ARGS = new Set(process.argv.slice(2));
const OPEN_APP = ARGS.has('--app') || ARGS.has('--open');
const NO_MANAGER = ARGS.has('--no-manager');

const WMD_PORT = Number(process.env.WMD_PORT || 17821);
const AGENT_PORT = Number(process.env.WMD_AGENT_PORT || 17820);
const MANAGER_PORT = Number(process.env.WMD_MANAGER_PORT || 17778);
const AGENT_DIR = process.env.WMD_AGENT_DIR || path.join(ROOT, 'agent_backend');
const MANAGER_DIR = process.env.WMD_MANAGER_DIR || path.join(ROOT, '..', 'Video-Generation-Manager');
// 智能体后端优先用自己项目内的 venv；没有再退回历史共用的 ml-engineer 环境（只作兜底）。
const LOCAL_PYTHON = path.join(AGENT_DIR, '.venv', 'Scripts', 'python.exe');
const LEGACY_PYTHON = 'D:/notebook/AIGC/ml-engineer/backend/.venv/Scripts/python.exe';
const PYTHON = process.env.WMD_PYTHON || (fs.existsSync(LOCAL_PYTHON) ? LOCAL_PYTHON : LEGACY_PYTHON);
const AGENT_PROBE_PROJECT = process.env.WMD_AGENT_PROJECT || 'wmd-local';

const children = new Map();
const restarts = new Map();
const restartPending = new Set();
const restartBlocked = new Set();
const healthFailures = new Map();
let checkingServices = false;
let shuttingDown = false;

function log(tag, message) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] [${tag}] ${message}`;
  console.log(line);
}

function get(url, headers = {}, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.on('error', () => resolve(0));
  });
}

async function health(service) {
  if (service === 'desktop') return (await get(`http://127.0.0.1:${WMD_PORT}/api/health`)) === 200;
  if (service === 'agent') return (await get(`http://127.0.0.1:${AGENT_PORT}/agent/health`, { 'X-Project-Id': AGENT_PROBE_PROJECT })) === 200;
  return (await get(`http://127.0.0.1:${MANAGER_PORT}/health`)) === 200;
}

function spawnChild(name, command, args, options) {
  log(name, `启动：${path.basename(command)} ${args.join(' ')}`);
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.set(name, child);
  const tag = name;
  child.stdout.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) log(tag, line.trim().slice(0, 500));
  });
  child.stderr.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) log(tag, '! ' + line.trim().slice(0, 500));
  });
  child.on('error', (err) => {
    log(name, `启动失败：${err.message}`);
    children.delete(name);
    scheduleRestart(name);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    log(name, `退出（code=${code} signal=${signal}）`);
    children.delete(name);
    scheduleRestart(name);
  });
  return child;
}

function scheduleRestart(name) {
  if (shuttingDown || restartPending.has(name) || restartBlocked.has(name)) return;
  const now = Date.now();
  const list = (restarts.get(name) || []).filter((t) => now - t < 5 * 60 * 1000);
  if (list.length >= 5) {
    restartBlocked.add(name);
    log(name, '5 分钟内重启超过 5 次，停止自动重启；检查上面的错误日志');
    return;
  }
  list.push(now);
  restarts.set(name, list);
  const delay = 2000 * Math.min(3, list.length);
  log(name, `${Math.round(delay / 1000)} 秒后重启`);
  restartPending.add(name);
  setTimeout(async () => {
    restartPending.delete(name);
    if (shuttingDown || children.has(name) || await health(name)) return;
    if (name === 'agent') startAgent();
    else if (name === 'manager') startManager();
    else if (name === 'desktop') startDesktop();
  }, delay);
}

function startAgent() {
  if (!fs.existsSync(path.join(AGENT_DIR, 'app', 'main.py'))) {
    log('agent', `找不到 ${AGENT_DIR}/app/main.py，跳过智能体后端`);
    return;
  }
  spawnChild('agent', PYTHON, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(AGENT_PORT)], {
    cwd: AGENT_DIR,
    env: {
      ...process.env,
      AGENT_SETTINGS_PATH: process.env.AGENT_SETTINGS_PATH || path.join(AGENT_DIR, 'data', 'agent_settings.json'),
      HARNESS_AUTH_MODE: process.env.HARNESS_AUTH_MODE || 'development',
      WMD_BASE_URL: process.env.WMD_BASE_URL || `http://127.0.0.1:${WMD_PORT}`,
    },
  });
}

function startManager() {
  if (!fs.existsSync(path.join(MANAGER_DIR, 'src', 'server.js'))) {
    log('manager', `找不到 ${MANAGER_DIR}/src/server.js，跳过管理器（豆包/Gemini 不可用）`);
    return;
  }
  spawnChild('manager', process.execPath, ['src/server.js'], {
    cwd: MANAGER_DIR,
    env: { ...process.env, DBM_REBUILD_PORT: String(MANAGER_PORT) },
  });
}

function startDesktop() {
  spawnChild('desktop', process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      WMD_PORT: String(WMD_PORT),
      WMD_AGENT_URL: process.env.WMD_AGENT_URL || `http://127.0.0.1:${AGENT_PORT}`,
      WMD_MANAGER_URL: process.env.WMD_MANAGER_URL || `http://127.0.0.1:${MANAGER_PORT}`,
    },
  });
}

function findChrome() {
  const candidates = [
    process.env.WMD_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || '';
}

function openApp() {
  const chrome = findChrome();
  const url = `http://127.0.0.1:${WMD_PORT}`;
  if (!chrome) {
    log('app', `没找到 Chrome，请手动打开 ${url}`);
    return;
  }
  const profile = path.join(ROOT, 'data', 'chrome-profile');
  fs.mkdirSync(profile, { recursive: true });
  spawn(chrome, [`--app=${url}`, '--window-size=1500,980', `--user-data-dir=${profile}`], { stdio: 'ignore', detached: true }).unref();
  log('app', `已打开应用窗口 ${url}`);
}

function killChild(name) {
  const child = children.get(name);
  if (!child) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch { /* ignore */ }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('launcher', '正在停止子进程…');
  for (const name of [...children.keys()]) killChild(name);
  setTimeout(() => process.exit(code), 800);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));

(async () => {
  log('launcher', `WENYUN.M-DESKTOP :${WMD_PORT} · 智能体 :${AGENT_PORT} · 管理器 :${MANAGER_PORT}`);
  if (!(await health('manager')) && !NO_MANAGER) startManager();
  else log('manager', NO_MANAGER ? '已按参数跳过' : '已在运行，复用');

  if (!(await health('agent'))) startAgent();
  else log('agent', '已在运行，复用');

  if (!(await health('desktop'))) startDesktop();
  else log('desktop', '已在运行，复用');

  for (const name of ['manager', 'agent', 'desktop']) {
    if (NO_MANAGER && name === 'manager') continue;
    const ok = await waitHealthy(name, 30000);
    log(name, ok ? '健康检查通过' : '健康检查未通过（看上面的日志）');
  }
  if (OPEN_APP) openApp();

  // 守护：健康检查不过且子进程不在时补启
  setInterval(async () => {
    if (shuttingDown || checkingServices) return;
    checkingServices = true;
    try {
      for (const name of ['manager', 'agent', 'desktop']) {
        if (NO_MANAGER && name === 'manager') continue;
        if (restartBlocked.has(name) || restartPending.has(name)) continue;
        if (await health(name)) { healthFailures.delete(name); continue; }
        if (children.has(name)) {
          const failures = (healthFailures.get(name) || 0) + 1;
          healthFailures.set(name, failures);
          log(name, `进程健康检查失败（${failures}/3）`);
          if (failures >= 3) {
            healthFailures.delete(name);
            log(name, '连续三次检查失败，停止本启动器持有的进程，随后按重启限流恢复');
            killChild(name);
          }
          continue;
        }
        scheduleRestart(name);
      }
    } finally { checkingServices = false; }
  }, 15000);
})();

async function waitHealthy(name, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await health(name)) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}
