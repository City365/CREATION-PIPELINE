'use strict';
/**
 * 进程级事件日志：崩溃和退出必须留下证据。
 *
 * 之前进程会以 code=1 静默退出，stderr 是空的，启动器只能看到「退出」两个字，
 * 无法判断是未处理 Promise、未捕获异常还是外部终止。这里统一写到
 * data/logs/process.log（超过 5 MB 轮转到 .1），并且同时写 stderr，
 * 保证前台启动时也能直接看到。
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 5 * 1024 * 1024;

function logFile() {
  let dir = '';
  try { dir = require('./config').load().dataDir || require('./config').DATA; } catch { /* 崩溃时配置可能不可用 */ }
  if (!dir) dir = path.join(__dirname, '..', 'data');
  return path.join(dir, 'logs', 'process.log');
}

function rotate(file) {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
    fs.renameSync(file, file + '.1');
  } catch { /* 文件不存在或没有权限，直接追加 */ }
}

function line(kind, detail) {
  const text = typeof detail === 'string'
    ? detail
    : (detail && detail.stack) || (detail && detail.message) || (() => {
      try { return JSON.stringify(detail); } catch { return String(detail); }
    })();
  const entry = `[${new Date().toISOString()}] pid=${process.pid} ${kind} ${text}\n`;
  try {
    const file = logFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotate(file);
    fs.appendFileSync(file, entry);
  } catch { /* 日志失败不能反过来把进程弄挂 */ }
  try { process.stderr.write(entry); } catch { /* ignore */ }
}

module.exports = { line, logFile };
