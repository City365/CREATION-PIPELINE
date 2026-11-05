'use strict';
/**
 * 进程级兜底。独立成模块是为了能在子进程测试里单独安装，不把 handler 带进测试运行器。
 *
 * 策略：
 * - 未处理的 Promise 拒绝：记录后继续服务，单个后台任务失败不应拖垮整个创作台；
 * - 未捕获异常：记录堆栈 → 落盘任务 → 退出 1，由启动器重启；
 * - 任何退出：记录 pid、退出码、时间，事后能判断是正常退出还是外部终止。
 */
const processLog = require('./process-log');

function install({ onFatal } = {}) {
  process.on('unhandledRejection', (reason) => processLog.line('unhandledRejection', reason));
  process.on('uncaughtException', (error) => {
    processLog.line('uncaughtException', error);
    try { if (onFatal) onFatal(); } catch { /* 落盘失败也要退出 */ }
    setTimeout(() => process.exit(1), 50);
  });
  process.on('exit', (code) => processLog.line('exit', `code=${code}`));
}

module.exports = { install };
