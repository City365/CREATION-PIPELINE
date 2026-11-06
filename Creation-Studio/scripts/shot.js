#!/usr/bin/env node
/**
 * 用系统 Edge（headless + CDP）给创作台页面截图，方便改 UI 时看真实渲染结果。
 *
 *   node scripts/shot.js <url> <out.png> [宽] [高] [等待毫秒]
 *
 * 会自动从 data/wmd.sqlite 里取一个未过期的会话 token 写进 cookie，
 * 因此登录后的页面也能直接截。Edge 路径可用 EDGE_PATH 覆盖。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.SHOT_PORT || 9333);
const ROOT = path.join(__dirname, '..');

function sessionToken() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(ROOT, 'data', 'wmd.sqlite'));
    const row = db
      .prepare('SELECT token FROM sessions WHERE expires_at > ? ORDER BY created_at DESC LIMIT 1')
      .get(Date.now());
    db.close();
    return row && row.token;
  } catch (error) {
    return '';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPort() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
    } catch (error) {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error('Edge 调试端口没起来：' + PORT);
}

async function main() {
  const [url, out, w = '1736', h = '959', wait = '2600'] = process.argv.slice(2);
  if (!url || !out) throw new Error('用法: node scripts/shot.js <url> <out.png> [宽] [高] [等待毫秒]');
  const width = Number(w);
  const height = Number(h);
  const outFile = path.resolve(out);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-shot-'));
  const child = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    await waitPort();
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); reject(new Error('CDP 超时: ' + method)); } }, 20000);
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !pending.has(msg.id)) return;
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message + ' @ ' + (msg.error.data || '')));
      else resolve(msg.result);
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    await send('Network.enable');
    await send('Runtime.enable');
    const errors = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        errors.push(d.exception ? (d.exception.description || d.text) : d.text);
      }
    });
    const token = sessionToken();
    const origin = new URL(url).origin;
    if (token && process.env.SHOT_NO_AUTH !== '1') {
      await send('Network.setCookie', {
        name: 'wmd_session', value: token, domain: new URL(url).hostname, path: '/',
        httpOnly: true, sameSite: 'Lax',
      });
    }
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    await send('Page.enable');
    await send('Page.navigate', { url });
    await sleep(Number(wait));
    // SHOT_EVAL：截图前在页面里跑一段 JS（例如填搜索框、切主题），方便验证交互态
    const script = process.env.SHOT_EVAL;
    let evalValue;
    if (script) {
      const result = await send('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true });
      if (result && result.exceptionDetails) throw new Error('SHOT_EVAL 出错: ' + (result.exceptionDetails.text || ''));
      evalValue = result && result.result ? result.result.value : undefined;
      await sleep(400);
    }
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ ok: true, out: outFile, bytes: fs.statSync(outFile).size, origin, loggedIn: Boolean(token), eval: evalValue, pageErrors: errors.slice(0, 5) }));
    ws.close();
  } finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (error) { /* windows lock */ }
  }
}

main().catch((error) => {
  console.error('[shot] ' + error.message);
  process.exit(1);
});
