'use strict';
/**
 * 离线全量回归：跑 tests/*.test.js，排除会调用真实付费服务的 e2e。
 * 固定端口用例需要串行，统一 --test-concurrency=1。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const EXCLUDE = new Set([
  'autodl-e2e.test.js',
  'seedance.test.js',
  'optimize-e2e.test.js',
  'image-e2e.test.js',
  'image-tools-e2e.test.js',
  'generic-video-e2e.test.js',
  'tts.test.js',
  'autodl-motion-e2e.test.js',
  'runninghub-h3.test.js',
]);

const files = fs.readdirSync(path.join(ROOT, 'tests'))
  .filter((name) => name.endsWith('.test.js') && !EXCLUDE.has(name))
  .sort()
  .map((name) => path.join('tests', name));

console.log(`离线回归：${files.length} 个文件；排除付费 e2e：${[...EXCLUDE].join(', ')}`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  cwd: ROOT, stdio: 'inherit', windowsHide: true,
});
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status == null ? 1 : result.status);
