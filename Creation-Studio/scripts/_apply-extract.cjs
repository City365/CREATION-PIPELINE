'use strict';
/**
 * 用「闲鱼6-超级小豆包」把这条对话里的原片提取下来，顶替镜头 05 的成片。
 * 旧成片由 H3 自动挪进 media/_trash/，随时能找回。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MANAGER = path.resolve(ROOT, '..', 'Video-Generation-Manager');
const conn = JSON.parse(fs.readFileSync(path.join(MANAGER, 'data', 'connection.json'), 'utf8'));
const base = (conn.baseURL || 'http://127.0.0.1:17778').replace(/\/+$/, '');
const token = conn.apiToken;
const h3 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'internal-token.json'), 'utf8')).token;

const chatUrl = process.argv[2] || 'https://www.doubao.com/chat/38449980185337346';
const accountId = process.argv[3] || '7cc35d4c-a645-45db-bfe6-62e1aa427de3';
const JOB = process.argv[4] || 'job-mvrzgrbh-7f40';
const OUT = process.argv[5] || 'D:\\notebook\\AIGC\\WENYUN.M-DESKTOP-Projects\\我的同桌测试-643a02\\media\\2026-10-29\\job-mvrzgrbh-7f40-f2b596e3\\镜头 05.mp4';

(async () => {
  console.log('扫描…');
  const scanRes = await fetch(base + '/api/extract/scan', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: chatUrl, accountId }),
    signal: AbortSignal.timeout(240000),
  });
  const scan = await scanRes.json();
  if (!scanRes.ok || !scan.sessionId) throw new Error('扫描失败：' + (scan.error || scanRes.status));
  console.log('对话', scan.title, '· 视频', scan.videos.length, '条');
  if (!scan.videos.length) throw new Error('没有可用视频');
  const video = scan.videos[0];
  console.log('选中', video.key.slice(0, 12), video.methodLabel, video.duration ?? '?', '秒');

  console.log('下载…');
  const downRes = await fetch(base + '/api/extract/download', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: scan.sessionId, key: video.key, name: '' }),
    signal: AbortSignal.timeout(300000),
  });
  const file = await downRes.json();
  if (!downRes.ok || !file.path) throw new Error('下载失败：' + (file.error || downRes.status));
  console.log('下载完成', file.path, Math.round((file.size || 0) / 1048576) + 'MB');

  console.log('替换镜头 05 的成片…');
  const repRes = await fetch('http://127.0.0.1:17821/api/jobs/' + encodeURIComponent(JOB) + '/output/from-path', {
    method: 'POST',
    headers: { 'x-wmd-internal': h3, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: OUT, sourcePath: file.path, name: path.basename(OUT), mode: 'replace' }),
    signal: AbortSignal.timeout(120000),
  });
  const replaced = await repRes.json();
  if (!repRes.ok || !replaced.ok) throw new Error('替换失败：' + JSON.stringify(replaced).slice(0, 300));
  console.log(JSON.stringify({
    out: replaced.data.out,
    parked: replaced.data.parked,
    exists: fs.existsSync(replaced.data.out.path),
    bytes: fs.statSync(replaced.data.out.path).size,
  }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
