'use strict';
/**
 * engine-probe.js —— headless 引擎链路自测（不碰窗口、不起网页）
 *
 *   node tools\concat-dev\engine-probe.js [项目目录]
 *
 * 做四件事并按顺序断言：
 *   version → project.open → timeline_read → preview_frame（拿到真 PNG）
 * 证据写 outputs\concat-validation\engine-probe.json，帧写 engine-probe-frame.png。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'outputs', 'concat-validation');
const engine = require(path.join(ROOT, 'Creation-Studio', 'src', 'concat-session.js'));

const PROJECT = process.argv[2]
  || path.join(OUT, '源码接口-1794284485366')
  || '';

const report = { startedAt: new Date().toISOString(), project: PROJECT, checks: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  console.log((pass ? '[OK]   ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
}

(async () => {
  try {
    const st = await engine.status();
    check('引擎二进制在', st.exeExists, st.exe);

    const v = await engine.version();
    check('concat_version 通', Boolean(v), JSON.stringify(v).slice(0, 160));

    const opened = await engine.open(PROJECT);
    check('project.open 通（headless 会话）', Boolean(opened), JSON.stringify(opened).slice(0, 120));

    const tl = await engine.timeline(PROJECT);
    report.timeline = tl;
    const lanes = tl && (tl.tracks || tl.lanes || []);
    const clips = (lanes || []).reduce((sum, lane) => sum + ((lane.clips || []).length), 0);
    check('timeline_read 拿到时间线', Array.isArray(lanes) || Boolean(tl), 'lanes=' + (lanes ? lanes.length : '?') + ' clips=' + clips);

    const state = await engine.get(PROJECT);
    report.state = state;
    const duration = state && state.project && state.project.duration;
    check('project_get 拿到工程状态', Boolean(state), 'duration=' + duration + ' canUndo=' + (state && state.canUndo));

    const t = Math.min(1, (duration || 3) / 3);
    const frame = await engine.preview(PROJECT, t, 640, 360);
    const file = path.join(OUT, 'engine-probe-frame.png');
    fs.writeFileSync(file, frame.buffer);
    report.frame = { bytes: frame.buffer.length, mime: frame.mime, file };
    check('preview_frame 回了一张 PNG', frame.buffer.length > 2000 && frame.buffer.slice(1, 4).toString() === 'PNG',
      frame.buffer.length + ' bytes @t=' + t);

    report.verdict = report.checks.every((c) => c.pass) ? 'passed' : 'failed';
  } catch (error) {
    report.verdict = 'failed';
    report.error = error && (error.stack || error.message);
    console.error('[ERROR]', error && error.message);
  } finally {
    engine.stop('probe');
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'engine-probe.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log('\n结果：' + report.verdict);
    setTimeout(() => process.exit(report.verdict === 'passed' ? 0 : 1), 300);
  }
})();
