'use strict';
/**
 * editor-api-test.js —— 剪辑台后端的真 HTTP 验收（和网页走同一套接口）
 *
 *   node tools\concat-dev\editor-api-test.js [项目目录]
 *
 * 前提：创作台后端已经起在 WMD_PORT（默认 17899），剪辑台页面打开过（引擎会话活着）。
 * 断言：读时间线 → 移动片段 → 撤销 → 切开 → 撤销，全部走 /api/concat/*。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'outputs', 'concat-validation');
const BASE = 'http://127.0.0.1:' + (process.env.WMD_PORT || 17899);
const PROJECT = process.argv[2] || path.join(OUT, '验证工程-1794283993259');

const report = { startedAt: new Date().toISOString(), base: BASE, project: PROJECT, checks: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  console.log((pass ? '[OK]   ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
}
const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= tol;

async function api(method, route, body) {
  const res = await fetch(BASE + route, {
    method,
    headers: body ? { 'Content-Type': 'application/json; charset=utf-8' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) throw new Error(payload.error || ('HTTP ' + res.status));
  return payload.data;
}

(async () => {
  try {
    await api('POST', '/api/concat/open', { path: PROJECT });
    const before = await api('GET', '/api/concat/timeline?path=' + encodeURIComponent(PROJECT));
    const clips0 = before.timeline.clips || [];
    report.before = { clips: clips0.length, duration: before.timeline.duration };
    check('读到时间线', clips0.length > 0, clips0.length + ' 个片段, 时长 ' + before.timeline.duration + 's');

    const clip = clips0[0];
    // 同一轨上压不到别人才能真的落在那个时间点：挪到本轨最后一个片段的尾巴后面半秒
    const sameTrack = clips0.filter((c) => c.track === clip.track && c.id !== clip.id);
    const freeStart = sameTrack.reduce((max, c) => Math.max(max, c.end), 0) + 0.5;
    await api('POST', '/api/concat/apply', {
      path: PROJECT,
      command: { op: 'moveClips', moves: [{ clipId: clip.id, start: freeStart, trackId: clip.track }] }
    });
    const moved = await api('GET', '/api/concat/timeline?path=' + encodeURIComponent(PROJECT));
    const after = (moved.timeline.clips || []).find((c) => c.id === clip.id);
    check('拖动（moveClips）落到引擎里', near(after.start, freeStart),
      'start ' + clip.start + ' → ' + after.start + '（目标 ' + freeStart + '）');

    await api('POST', '/api/concat/undo', { path: PROJECT });
    const undone = await api('GET', '/api/concat/timeline?path=' + encodeURIComponent(PROJECT));
    const back = (undone.timeline.clips || []).find((c) => c.id === clip.id);
    check('撤销回到原位', near(back.start, clip.start), 'start ' + back.start);

    const cutAt = clip.start + Math.max(0.2, (clip.end - clip.start) / 2);
    await api('POST', '/api/concat/apply', { path: PROJECT, command: { op: 'splitClips', clipIds: [clip.id], time: cutAt } });
    const split = await api('GET', '/api/concat/timeline?path=' + encodeURIComponent(PROJECT));
    const count = (split.timeline.clips || []).length;
    check('切开（splitClips）多出一个片段', count === clips0.length + 1, clips0.length + ' → ' + count);

    await api('POST', '/api/concat/undo', { path: PROJECT });
    const merged = await api('GET', '/api/concat/timeline?path=' + encodeURIComponent(PROJECT));
    check('撤销后回到原来的片段数', (merged.timeline.clips || []).length === clips0.length,
      (merged.timeline.clips || []).length + ' 个');

    const frame = await fetch(BASE + '/api/concat/frame?path=' + encodeURIComponent(PROJECT) + '&t=1&w=480');
    const bytes = Buffer.from(await frame.arrayBuffer());
    check('预览帧是 PNG', bytes.length > 2000 && bytes.slice(1, 4).toString() === 'PNG', bytes.length + ' bytes');

    report.verdict = report.checks.every((c) => c.pass) ? 'passed' : 'failed';
  } catch (error) {
    report.verdict = 'failed';
    report.error = error && (error.stack || error.message);
    console.error('[ERROR]', error && error.message);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'editor-api-test.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log('\n结果：' + report.verdict);
    process.exit(report.verdict === 'passed' ? 0 : 1);
  }
})();
