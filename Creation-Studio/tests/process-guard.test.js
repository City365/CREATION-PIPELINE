'use strict';
/**
 * 进程级兜底：未处理拒绝不能把进程带走，未捕获异常必须留堆栈并退出 1。
 * 用子进程跑，避免把 handler 装到测试运行器自己身上。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function run(script, env, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', script], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test('未处理的 Promise 拒绝只记录，进程继续存活', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-guard-'));
  const script = `
    require('./src/process-guard').install();
    Promise.reject(new Error('qa-rejection-marker'));
    setTimeout(() => console.log('ALIVE'), 150);
    setTimeout(() => process.exit(0), 700);
  `;
  const out = await run(script, { WMD_DATA_DIR: dir });
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /ALIVE/);
  const log = fs.readFileSync(path.join(dir, 'logs', 'process.log'), 'utf8');
  assert.match(log, /unhandledRejection/);
  assert.match(log, /qa-rejection-marker/);
  assert.match(log, /exit code=0/);
});

test('未捕获异常记录堆栈后以退出码 1 结束', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-guard-'));
  const script = `
    require('./src/process-guard').install({ onFatal: () => console.log('FLUSHED') });
    setTimeout(() => { throw new Error('qa-fatal-marker'); }, 50);
  `;
  const out = await run(script, { WMD_DATA_DIR: dir });
  assert.equal(out.code, 1, out.stderr);
  assert.match(out.stdout, /FLUSHED/);
  const log = fs.readFileSync(path.join(dir, 'logs', 'process.log'), 'utf8');
  assert.match(log, /uncaughtException/);
  assert.match(log, /qa-fatal-marker/);
  assert.match(log, /exit code=1/);
});
