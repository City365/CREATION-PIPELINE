'use strict';
/**
 * dock-http-probe.js —— 停靠链路的真 HTTP 端到端验收
 *
 *   node tools\concat-dev\dock-http-probe.js
 *
 * 做的是和浏览器一模一样的事：起创作台后端（独立端口 + 独立数据目录，不碰你的库），
 * 然后 GET /api/local/dock → POST dock → GET 校验 → POST restore，
 * 每一步都断言原生窗口真的动了。证据写 outputs\concat-validation\dock-http-probe.json。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const STUDIO = path.join(ROOT, 'Creation-Studio');
const OUT = path.join(ROOT, 'outputs', 'concat-validation');
const PORT = Number(process.env.PROBE_PORT || 17899);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = path.join(OUT, 'studio-dock-probe');
const LOG = path.join(OUT, 'studio-dock-probe.log');

const report = { startedAt: new Date().toISOString(), base: BASE, checks: [] };
let server = null;

function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  console.log((pass ? '[OK]   ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, route, body) {
  const res = await fetch(BASE + route, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, payload };
}

async function waitHealthy(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return true;
    } catch { /* 还没起来 */ }
    await sleep(400);
  }
  return false;
}

function near(a, b, tol = 8) { return Math.abs(Number(a) - Number(b)) <= tol; }

function stopServer() {
  if (!server || server.killed) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill('SIGTERM');
  } catch { /* ignore */ }
}

(async () => {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const logStream = fs.createWriteStream(LOG, { flags: 'w' });
    server = spawn(process.execPath, ['src/server.js'], {
      cwd: STUDIO,
      env: Object.assign({}, process.env, { WMD_PORT: String(PORT), WMD_DATA_DIR: DATA }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    server.stdout.pipe(logStream);
    server.stderr.pipe(logStream);

    const healthy = await waitHealthy();
    check('创作台后端起来了', healthy, healthy ? BASE : '看 ' + LOG);
    if (!healthy) throw new Error('后端没起来');

    let info = await api('GET', '/api/local/dock');
    check('GET /api/local/dock 通', info.status === 200 && info.payload.ok === true, 'status=' + info.status);
    report.statusBefore = info.payload.data;
    check('状态里有二进制路径与存在性', Boolean(info.payload.data && info.payload.data.exe), info.payload.data && info.payload.data.exe);

    if (!info.payload.data.running) {
      const launched = await api('POST', '/api/local/dock/launch', {});
      report.launched = launched.payload;
      check('POST /launch 把 Concat 拉起来了', launched.status === 200 && launched.payload.data && launched.payload.data.ok === true,
        launched.payload.error || ('pid=' + (launched.payload.data && launched.payload.data.pid)));
    }

    const box = { x: 320, y: 180, w: 980, h: 600, scale: 1, borderless: true };
    const docked = await api('POST', '/api/local/dock/dock', box);
    report.dock = docked.payload;
    check('POST /dock 返回成功', docked.status === 200 && docked.payload.ok === true, docked.payload.error || '');
    const rect = docked.payload.data && docked.payload.data.rect;
    check('窗口落到了要求的矩形（±8px）',
      Boolean(rect) && near(rect.x, box.x) && near(rect.y, box.y) && near(rect.w, box.w) && near(rect.h, box.h),
      JSON.stringify(rect) + ' 要求 ' + JSON.stringify(box));

    const after = await api('GET', '/api/local/dock');
    report.statusAfter = after.payload.data;
    check('GET 复查一致（不是回包骗人）',
      after.payload.data && after.payload.data.rect && near(after.payload.data.rect.x, box.x),
      JSON.stringify(after.payload.data && after.payload.data.rect));
    check('去掉标题栏（伪嵌入的前提）', after.payload.data && after.payload.data.borderless === true, 'borderless=' + (after.payload.data && after.payload.data.borderless));

    const small = await api('POST', '/api/local/dock/dock', { x: 0, y: 0, w: 100, h: 80, scale: 1 });
    check('预留区太小时给人话拒绝（400）', small.status === 400, small.payload.error || '');

    const other = await api('POST', '/api/local/dock/dock', { x: 120, y: 90, w: 1280, h: 720, scale: 1, borderless: true });
    check('连续拖动（第二次报矩形）跟得上',
      other.status === 200 && other.payload.data && near(other.payload.data.rect.x, 120) && near(other.payload.data.rect.w, 1280),
      JSON.stringify(other.payload.data && other.payload.data.rect));

    const restored = await api('POST', '/api/local/dock/restore', {});
    report.restore = restored.payload;
    check('POST /restore 还原成功', restored.status === 200 && restored.payload.ok === true, restored.payload.error || '');
    check('标题栏回来了', restored.payload.data && restored.payload.data.borderless === false, JSON.stringify(restored.payload.data && restored.payload.data.rect));

    report.verdict = report.checks.every((c) => c.pass) ? 'passed' : 'failed';
  } catch (error) {
    report.verdict = 'failed';
    report.error = error && (error.stack || error.message);
    console.error('[ERROR]', error);
  } finally {
    stopServer();
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, 'dock-http-probe.json');
    fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
    console.log('\n结果：' + report.verdict + ' → ' + file);
    await sleep(600);
    process.exit(report.verdict === 'passed' ? 0 : 1);
  }
})();
