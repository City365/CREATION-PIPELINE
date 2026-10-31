// Launch / attach helpers for the local Doubao desktop app.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CdpClient, DEFAULT_PORT, listTargets, pickChatTarget, portAlive } from './cdp.mjs';

export const DEFAULT_APP_DIR = process.env.DOUBAO_APP_DIR || 'D:\\notebook\\software\\Doubao\\app';
export const DEFAULT_EXE = process.env.DOUBAO_EXE || path.join(DEFAULT_APP_DIR, 'Doubao.exe');

export function appInstalled(exe = DEFAULT_EXE) {
  return fs.existsSync(exe);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function runningPids() {
  return new Promise((resolve) => {
    const ps = spawn('powershell', ['-NoProfile', '-Command',
      "(Get-Process -Name Doubao -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) -join ','"]);
    let out = '';
    ps.stdout.on('data', (d) => { out += d.toString(); });
    ps.on('close', () => resolve(out.split(',').map((s) => Number(s.trim())).filter(Boolean)));
    ps.on('error', () => resolve([]));
  });
}

export async function killApp() {
  await new Promise((resolve) => {
    const ps = spawn('taskkill', ['/F', '/IM', 'Doubao.exe']);
    ps.on('close', () => resolve());
    ps.on('error', () => resolve());
  });
  for (let i = 0; i < 20; i++) {
    const pids = await runningPids();
    if (!pids.length) return true;
    await sleep(300);
  }
  return false;
}

export function launchApp({ exe = DEFAULT_EXE, port = DEFAULT_PORT, dir } = {}) {
  if (!fs.existsSync(exe)) throw new Error('Doubao.exe not found: ' + exe);
  const args = ['--remote-debugging-port=' + port, '--remote-allow-origins=*'];
  const child = spawn(exe, args, {
    cwd: dir || path.dirname(exe),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

export async function waitForPort(port = DEFAULT_PORT, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await portAlive(port);
    if (state.alive) return state;
    await sleep(400);
  }
  return { alive: false, browser: null };
}

export async function attachChatPage(port = DEFAULT_PORT, retryMs = 20000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < retryMs) {
    try {
      const targets = await listTargets(port);
      const target = pickChatTarget(targets);
      if (target && target.webSocketDebuggerUrl) {
        const client = await CdpClient.connect(target.webSocketDebuggerUrl);
        await client.send('Runtime.enable');
        return { client, target };
      }
      lastError = new Error('no doubao-chat target yet');
    } catch (err) {
      lastError = err;
    }
    await sleep(500);
  }
  throw lastError || new Error('attachChatPage failed');
}

// Make sure the app is running with the debugging port open, then attach.
export async function ensureApp({ port = DEFAULT_PORT, exe = DEFAULT_EXE, restart = true, log = () => {} } = {}) {
  const state = await portAlive(port);
  if (state.alive) {
    log('CDP already available on ' + port);
    return { launched: false, restarted: false, port };
  }
  const pids = await runningPids();
  let restarted = false;
  if (pids.length) {
    if (!restart) throw new Error('Doubao is running without --remote-debugging-port; restart it first');
    log('Doubao runs without the debugging port (pid ' + pids.join(',') + '), restarting it once');
    await killApp();
    restarted = true;
    await sleep(1200);
  }
  log('launching ' + exe);
  launchApp({ exe, port });
  const ok = await waitForPort(port, 40000);
  if (!ok.alive) throw new Error('Doubao did not expose CDP on port ' + port + ' in time');
  log('CDP ready on ' + port + (ok.browser ? ' (' + ok.browser + ')' : ''));
  return { launched: true, restarted, port };
}
