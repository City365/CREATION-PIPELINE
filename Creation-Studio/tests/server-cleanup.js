'use strict';
/**
 * 独立 server 测试的收尾：停进程 + 清临时目录。
 *
 * 原来三处测试都写成
 *   try { child.kill('SIGTERM'); } catch {}
 *   fs.rmSync(dir, { recursive: true, force: true });
 * 但 kill 只是**发信号**，进程还没退出，Windows 上刚打开的文件仍被持有，
 * rmSync 抛 EPERM —— 测试于是因为「清理失败」而失败，把真实结果盖掉了。
 * 并发跑整套时尤其明显（invite-reset / user-prefs-api / executor-multi-token
 * 都偶发过）。
 *
 * 这里等进程真的退出，再对目录删除做几次重试。
 */
const fs = require('node:fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stopAndClean(child, dir, options = {}) {
  const waitMs = Number(options.waitMs) || 3000;
  const attempts = Number(options.attempts) || 6;
  try {
    child.kill('SIGTERM');
  } catch {
    /* 已经退出 */
  }
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(waitMs),
  ]);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      await sleep(150);
    }
  }
  // 真删不掉就留着：临时目录由系统回收，不能让清理问题变成测试失败。
  return false;
}

module.exports = { stopAndClean, sleep };
