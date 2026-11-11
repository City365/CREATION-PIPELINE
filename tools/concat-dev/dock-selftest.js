'use strict';
/**
 * dock-selftest.js —— 停靠链路自测（不需要开网页，直接打后端模块）
 *
 *   node tools\concat-dev\dock-selftest.js
 *
 * 会做：
 *   1) 没开 Concat 就开一个（真进程、真窗口）
 *   2) 报一个矩形 → 断言窗口真的挪到了那个物理像素矩形
 *   3) 再报一个矩形 → 断言能连续移动（拖动分栏的等价物）
 *   4) 还原 → 断言标题栏回来了
 *   5) 收起代理进程
 *
 * 证据写 outputs\concat-validation\dock-selftest.json
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const dock = require(path.join(ROOT, 'Creation-Studio', 'src', 'local-dock.js'));

const OUT = path.join(ROOT, 'outputs', 'concat-validation');
const report = { startedAt: new Date().toISOString(), checks: [] };

function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  console.log((pass ? '[OK]   ' : '[FAIL] ') + name + (detail ? ' — ' + detail : ''));
}

function near(a, b, tol = 6) { return Math.abs(Number(a) - Number(b)) <= tol; }

(async () => {
  try {
    let st = await dock.status();
    check('后端能问到窗口状态', Boolean(st && typeof st.running === 'boolean'), 'running=' + st.running + ' agent=' + st.agent);
    report.exe = st.exe;
    check('二进制存在', st.exeExists, st.exe);

    let launched = null;
    if (!st.running) {
      launched = await dock.launch();
      report.launched = launched;
      check('能替用户把 Concat 拉起来', Boolean(launched.ok), launched.ok ? ('pid=' + launched.pid) : launched.error);
      st = await dock.status();
    }
    check('窗口在', st.running, 'hwnd=' + st.hwnd + ' title=' + JSON.stringify(st.title));

    const box1 = { x: 240, y: 160, w: 1000, h: 620, scale: 1, borderless: true };
    const r1 = await dock.dock(box1);
    report.dock1 = r1;
    check('第一次停靠成功', r1.ok, JSON.stringify(r1.rect));
    check('落位与要求一致（±6px）',
      r1.ok && near(r1.rect.x, box1.x) && near(r1.rect.y, box1.y) && near(r1.rect.w, box1.w) && near(r1.rect.h, box1.h),
      '要 ' + JSON.stringify(box1) + ' 得 ' + JSON.stringify(r1.rect));
    check('边框已去掉', r1.borderless === true, 'borderless=' + r1.borderless);

    const box2 = { x: 60, y: 90, w: 1440, h: 820, scale: 1, borderless: true };
    const r2 = await dock.dock(box2);
    report.dock2 = r2;
    check('第二次停靠跟着动', r2.ok && near(r2.rect.x, box2.x) && near(r2.rect.w, box2.w), JSON.stringify(r2.rect));

    // 缩放换算：150% 下报 800×500 CSS 像素，物理应变成 1200×750
    const r3 = await dock.dock({ x: 100, y: 100, w: 800, h: 500, scale: 1.5, borderless: true });
    report.dock3 = r3;
    check('缩放换算按 dpr 生效',
      r3.ok && near(r3.rect.w, 1200, 8) && near(r3.rect.h, 750, 8),
      'CSS 800x500 × 1.5 → ' + JSON.stringify(r3.rect));

    const rest = await dock.restore();
    report.restore = rest;
    check('还原成功', rest.ok, JSON.stringify(rest.rect));
    check('标题栏回来了', rest.borderless === false, 'borderless=' + rest.borderless);

    const after = await dock.status();
    report.after = after;
    check('还原后仍然是有窗口状态', after.running === true, 'hwnd=' + after.hwnd);

    dock.stop('selftest');
    check('代理已收起', dock.isRunning() === false, 'running=' + dock.isRunning());

    report.verdict = report.checks.every((c) => c.pass) ? 'passed' : 'failed';
  } catch (error) {
    report.verdict = 'failed';
    report.error = error && (error.stack || error.message);
    console.error('[ERROR]', error);
    try { dock.stop('selftest-error'); } catch { /* ignore */ }
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, 'dock-selftest.json');
    fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
    console.log('\n结果：' + report.verdict + ' → ' + file);
    process.exit(report.verdict === 'passed' ? 0 : 1);
  }
})();
