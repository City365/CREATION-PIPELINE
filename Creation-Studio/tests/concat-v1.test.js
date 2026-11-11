'use strict';
/**
 * 剪辑台 V1：
 *   - web/concat/placing.js 的放置数学（吸附、避让、落位、拖边夹紧）
 *   - 传输层不认识任何一条业务方法（前后端分离的红线）
 *   - 页面与壳的接线（脚本、路由、静态白名单）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const SRC = path.join(ROOT, 'src');

const PL = require(path.join(WEB, 'concat', 'placing.js'));

const readWeb = (name) => fs.readFileSync(path.join(WEB, name), 'utf8');
const readSrc = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');
const readRoot = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

const FPS = 24;
const FRAME = PL.frameSec(FPS);

function clip(id, start, duration, trackId, extra) {
  return Object.assign({ id, start, duration, trackId: trackId || 'T1', kind: 'video' }, extra || {});
}

/* ------------------------------------------------------------------ 放置数学 */

test('quantize 把落点对齐到帧', () => {
  assert.equal(PL.quantize(1.0001, FRAME), 1);
  // 24fps 一帧 ≈ 0.041667s
  assert.ok(Math.abs(PL.quantize(1.02, FRAME) - 1) < 1e-9);
  assert.ok(Math.abs(PL.quantize(1 + 2.6 * FRAME, FRAME) - (1 + 3 * FRAME)) < 1e-9);
  assert.ok(Math.abs(PL.quantize(1 + 3.4 * FRAME, FRAME) - (1 + 3 * FRAME)) < 1e-9);
  assert.equal(PL.quantize(-5, FRAME), 0);
  assert.ok(Math.abs(PL.quantize(1.05, FRAME, 'floor') - 25 * FRAME) < 1e-9);
  // 位移是另一回事：符号必须保住
  assert.ok(Math.abs(PL.quantizeDelta(-0.12, FRAME) + 3 * FRAME) < 1e-9);
  assert.ok(Math.abs(PL.quantizeDelta(0.12, FRAME) - 3 * FRAME) < 1e-9);
});

test('neighbours 只给同一轨道、并排除自己', () => {
  const clips = [clip('a', 0, 2, 'T1'), clip('b', 3, 2, 'T1'), clip('c', 0, 2, 'T2')];
  const list = PL.neighbours(clips, 'T1', { a: true });
  assert.deepEqual(list.map((row) => row.id), ['b']);
});

test('freeStart 遇到同轨重叠时挪到最近的空位', () => {
  const clips = [clip('a', 0, 2), clip('b', 4, 2)];
  // 0.5..2.5 撞上 a，最近空位是 b 的尾巴或 a 的头部
  const placed = PL.freeStart(PL.neighbours(clips, 'T1', {}), 0.5, 1, FRAME);
  assert.ok(Math.abs(placed - 2) < 1e-6 || Math.abs(placed - 4) < 1e-6, '落在 2 或 4，实际 ' + placed);
  for (const other of clips) {
    assert.equal(PL.overlaps(placed, placed + 1, other.start, other.start + other.duration), false);
  }
});

test('freeStart 首尾相接不算重叠', () => {
  const clips = [clip('a', 0, 2)];
  const placed = PL.freeStart(PL.neighbours(clips, 'T1', {}), 2, 2, FRAME);
  assert.equal(placed, 2);
});

test('resolveMove：拖到别人身上会自己让开', () => {
  const clips = [clip('a', 0, 2), clip('b', 4, 2), clip('drag', 8, 1, 'T1')];
  const moving = [{ id: 'drag', start: 8, duration: 1, trackId: 'T1' }];
  const plan = PL.resolveMove({ clips, moving, deltaTime: -4.2, trackId: 'T1', fps: FPS, playhead: 0 });
  assert.equal(plan.length, 1);
  const row = plan[0];
  assert.equal(row.clipId, 'drag');
  for (const other of clips) {
    if (other.id === 'drag') continue;
    assert.equal(
      PL.overlaps(row.start, row.start + 1, other.start, other.start + other.duration),
      false,
      '落点 ' + row.start + ' 压到 ' + other.id
    );
  }
});

test('resolveMove：靠近边会吸附', () => {
  const clips = [clip('a', 0, 2), clip('drag', 8, 1, 'T1')];
  const moving = [{ id: 'drag', start: 8, duration: 1, trackId: 'T1' }];
  // 目标 2.12s，离 a 的尾巴 2s 只有 0.12s，阈值 0.2 → 吸到 2
  const plan = PL.resolveMove({
    clips, moving, deltaTime: 2.12 - 8, trackId: 'T1', fps: FPS, playhead: 99, snapThreshold: 0.2,
  });
  assert.ok(Math.abs(plan[0].start - 2) < 1e-6, '吸到 2，实际 ' + plan[0].start);
});

test('resolveMove：Alt 关掉吸附就按原样落帧', () => {
  const clips = [clip('a', 0, 2), clip('drag', 8, 1, 'T1')];
  const moving = [{ id: 'drag', start: 8, duration: 1, trackId: 'T1' }];
  const plan = PL.resolveMove({
    clips, moving, deltaTime: 2.12 - 8, trackId: 'T1', fps: FPS, playhead: 99, snapThreshold: 0,
  });
  assert.ok(Math.abs(plan[0].start - PL.quantize(2.12, FRAME)) < 1e-6, '实际 ' + plan[0].start);
});

test('resolveMove：多选一起拖，相对位置不变', () => {
  const clips = [clip('a', 0, 1), clip('b', 2, 1), clip('c', 10, 1), clip('d', 12, 1)];
  const moving = [
    { id: 'c', start: 10, duration: 1, trackId: 'T1' },
    { id: 'd', start: 12, duration: 1, trackId: 'T1' },
  ];
  const plan = PL.resolveMove({ clips, moving, deltaTime: -6, trackId: 'T1', fps: FPS, playhead: 0 });
  const c = plan.find((row) => row.clipId === 'c');
  const d = plan.find((row) => row.clipId === 'd');
  assert.ok(Math.abs((d.start - c.start) - 2) < 1e-6, '两段仍差 2 秒');
  // 不能压在 a/b 上
  for (const other of [clips[0], clips[1]]) {
    for (const row of plan) {
      const len = row.clipId === 'c' ? 1 : 1;
      assert.equal(PL.overlaps(row.start, row.start + len, other.start, other.start + other.duration), false);
    }
  }
});

test('resolveMove：换轨时按目标轨的占用重新落位', () => {
  const clips = [clip('a', 0, 2, 'T1'), clip('b', 0, 3, 'T2'), clip('drag', 6, 1, 'T1')];
  const moving = [{ id: 'drag', start: 6, duration: 1, trackId: 'T1' }];
  const plan = PL.resolveMove({ clips, moving, deltaTime: 0, trackId: 'T2', fps: FPS, playhead: 0 });
  assert.equal(plan[0].trackId, 'T2');
  assert.equal(PL.overlaps(plan[0].start, plan[0].start + 1, 0, 3), false);
});

test('clampTrim：拖尾不会短过 1/60 秒', () => {
  const target = clip('a', 0, 2);
  const delta = PL.clampTrim({ clip: target, clips: [target], edge: 'end', delta: -5, fps: FPS });
  assert.ok(Math.abs(delta - -(2 - PL.MIN_DURATION)) < 1e-9);
});

test('clampTrim：拖尾不会盖到后面的片段', () => {
  const target = clip('a', 0, 2);
  const next = clip('b', 3, 2);
  const delta = PL.clampTrim({ clip: target, clips: [target, next], edge: 'end', delta: 5, fps: FPS });
  assert.ok(Math.abs(delta - 1) < 1e-9, '最多长到 3，实际 delta ' + delta);
});

test('clampTrim：ripple 时不受邻居限制', () => {
  const target = clip('a', 0, 2);
  const next = clip('b', 3, 2);
  const delta = PL.clampTrim({ clip: target, clips: [target, next], edge: 'end', delta: 5, fps: FPS, ripple: true });
  assert.ok(delta > 1);
});

test('clampTrim：拖头最多退到前一段的尾巴', () => {
  const target = clip('a', 4, 2);
  const prev = clip('b', 0, 3);
  const delta = PL.clampTrim({ clip: target, clips: [target, prev], edge: 'start', delta: -5, fps: FPS });
  assert.ok(Math.abs(delta - -1) < 1e-9, '只能退到 3，实际 delta ' + delta);
});

test('timecode 与时长显示', () => {
  assert.equal(PL.timecode(0, 24), '00:00:00');
  assert.equal(PL.timecode(1, 24), '00:01:00');
  assert.equal(PL.timecode(61.5, 24), '01:01:12');
  assert.equal(PL.shortDuration(1.5, 24), '1.5s');
});

/* ------------------------------------------------------------------ 传输层的红线 */

test('传输层不认识任何业务方法（页面直连引擎，本层只是搬运）', () => {
  const source = readSrc('concat-rpc-routes.js');
  const business = [
    'edit.apply', 'edit.undo', 'edit.redo', 'project.open', 'project.document',
    'project.get', 'project.save', 'moveClips', 'trimClip', 'splitClips', 'removeClips',
  ];
  for (const name of business) {
    assert.equal(source.includes("'" + name + "'"), false, '传输层不该出现业务方法 ' + name);
  }
  // 只允许它自己转发的那一个：预览帧
  assert.ok(source.includes("'preview.frame'"));
  assert.ok(source.includes("engine.callMany"));
});

test('传输层只认回环', () => {
  const source = readSrc('concat-rpc-routes.js');
  assert.ok(source.includes('isLoopback(req)'));
  assert.ok(source.includes("'::1'"));
  assert.ok(source.includes("127.0.0.1"));
  assert.ok(source.includes('403'));
});

test('引擎监督进程用 concat-cli（不开窗），端口交给系统挑', () => {
  const source = readSrc('concat-engine.js');
  assert.ok(source.includes("concat-cli.exe"));
  assert.ok(source.includes("'serve'"));
  assert.ok(source.includes('127.0.0.1:0'), '端口 0，避免撞端口');
  assert.ok(source.includes('BANNER_TOKEN'));
  assert.ok(source.includes("'auth'"), '每条连接第一句必须是 auth');
  // 两个通道：预览帧不排在手感后面
  assert.ok(source.includes("lane === 'frame'"));
});

test('壳里注册的是传输层，旧的语义封装不再挂上', () => {
  const source = readSrc('server.js');
  assert.ok(source.includes("require('./concat-rpc-routes')"));
  assert.equal(source.includes("require('./concat-routes')"), false);
  assert.ok(source.includes('await concatRpcRoutes('));
  assert.equal(fs.existsSync(path.join(SRC, 'concat-routes.js')), false, '旧的语义路由文件应已删除');
  assert.equal(fs.existsSync(path.join(SRC, 'concat-session.js')), false, '旧的 MCP 会话文件应已删除');
});

test('静态白名单里有剪辑台的两个新脚本', () => {
  const source = readSrc('server.js');
  assert.ok(source.includes("'/concat/rpc.js': ['concat/rpc.js'"));
  assert.ok(source.includes("'/concat/placing.js': ['concat/placing.js'"));
});

test('页面按顺序加载 rpc、placing、剪辑台', () => {
  const html = readRoot('web/index.html');
  const rpc = html.indexOf('/concat/rpc.js');
  const placing = html.indexOf('/concat/placing.js');
  const editor = html.indexOf('/concat-editor.js');
  assert.ok(rpc > 0 && placing > 0 && editor > 0);
  assert.ok(rpc < placing && placing < editor, '顺序必须是 rpc → placing → editor');
});

/* ------------------------------------------------------------------ 页面本身 */

test('页面只用引擎原生方法，不自造接口', () => {
  const source = readWeb('concat-editor.js');
  for (const called of ["'project.open'", "'project.document'", "'project.get'", "'project.save'",
    "'edit.apply'", "'edit.undo'", "'edit.redo'", "'project.list'"]) {
    assert.ok(source.includes(called), '页面应直接调用 ' + called);
  }
  assert.equal(source.includes('/api/concat/apply'), false, '不应再走旧语义接口');
  assert.equal(source.includes('/api/concat/timeline'), false);
});

test('页面带的命令形状与引擎一致', () => {
  const source = readWeb('concat-editor.js');
  assert.ok(source.includes("op: 'moveClips'"));
  assert.ok(source.includes("op: 'trimClip'"));
  assert.ok(source.includes("op: 'splitClips'"));
  assert.ok(source.includes("op: 'removeClips'"));
  assert.ok(source.includes("op: 'updateClip'"));
  assert.ok(source.includes("op: 'setClipTransform'"));
  assert.ok(source.includes("op: 'setClipSpeed'"));
  assert.ok(source.includes("op: 'setTrackFlag'"));
  // trimClip 的字段是 clipId/edge/delta/ripple
  assert.ok(source.includes('clipId: clip.id'));
  assert.ok(source.includes('ripple: false'));
});

test('页面把放置数学交给 placing.js（引擎对同轨重叠是 no-op）', () => {
  const source = readWeb('concat-editor.js');
  assert.ok(source.includes('PL.resolveMove('));
  assert.ok(source.includes('PL.clampTrim('));
  assert.ok(source.includes('DRAG_SNAP_PX'));
  assert.ok(source.includes('event.altKey'), '按住 Alt 关掉吸附');
});

test('快捷键齐全', () => {
  const source = readWeb('concat-editor.js');
  for (const key of ['ArrowLeft', 'ArrowRight', 'Delete', 'Home', 'End']) {
    assert.ok(source.includes("'" + key + "'"), '缺少 ' + key);
  }
  assert.ok(source.includes("key.toLowerCase() === 'z'"));
  assert.ok(source.includes("key.toLowerCase() === 's'"));
  assert.ok(source.includes("key === ' '"));
});

test('版式照 Slint 前端：标题栏 + 三栏 + 时间线，与原生分区一致', () => {
  const source = readWeb('concat-editor.js');
  for (const part of ['ce-titlebar', 'ce-menu', 'ce-tabstrip', 'ce-pane-left', 'ce-pane-center',
    'ce-pane-right', 'ce-stage', 'ce-transport', 'ce-details', 'ce-tl', 'ce-tl-tools',
    'ce-ruler', 'ce-lane-head', 'ce-playhead', 'ce-meters', 'ce-status']) {
    assert.ok(source.includes(part), '缺少 ' + part);
  }
  const css = readWeb('concat-editor.css');
  // 原生 dark 调色板的令牌必须真的落到页面上
  for (const token of ['#212123', '#151517', '#cbf53f', '#1a1a1c', '#3373d1', '#34c46f', '#cf5a99']) {
    assert.ok(css.includes(token), '缺少调色板颜色 ' + token);
  }
  assert.ok(css.includes('.ce-clip-head'));
  assert.ok(css.includes('.ce-clip-body'));
  assert.ok(css.includes('.ce-edge'));
  assert.ok(css.includes('.ce-tile'));
});

test('版式自检：页签排得满、预览按比例撑满、控件不被壁纸规则刷白', () => {
  const css = readWeb('concat-editor.css');
  const source = readWeb('concat-editor.js');
  const rule = (selector) => {
    const at = css.indexOf(selector + ' {');
    assert.ok(at >= 0, '缺规则 ' + selector);
    return css.slice(at, css.indexOf('}', at));
  };

  // 页签：剪映那样一格一格的定宽格子（40px 起），挤不下就横向滚，绝不压缩文字
  const strip = rule('.ce-tabstrip');
  assert.ok(/overflow-x:\s*auto/.test(strip), '页签条要能横向滚，不能 overflow:hidden 直接裁');
  assert.ok(!/overflow-x:\s*hidden/.test(strip));
  const tab = rule('.ce-tab');
  assert.ok(/flex:\s*0 0 auto/.test(tab), '页签不能再被 flex:1 压扁');
  const minWidth = Number((tab.match(/min-width:\s*(\d+)px/) || [])[1]);
  assert.ok(minWidth >= 40, '一格至少 40px，否则两个字也要省略号：' + minWidth);
  assert.ok(!/max-width:\s*64px/.test(tab), 'max-width 会让格子在不同栏宽下变形');
  assert.ok(/flex-direction:\s*column/.test(tab), '图标在上文字在下');
  assert.ok(!/border-radius:\s*8px 8px 0 0/.test(tab), '不再是贴底的标签页造型');
  assert.ok(/\.ce-tab\.is-active i/.test(css), '选中项图标要被强调色点亮');
  assert.ok(/position:\s*sticky/.test(rule('.ce-tab-more')), '» 要钉在右端，页签多了也不滚走');
  assert.ok(/\.ce-pane-left\.is-wide/.test(css), '» 展开要有对应的宽面板');
  assert.ok(source.includes('ce-tab-more') && source.includes('toggleLeftWide'), '» 展开按钮要真的接线');
  // 页签是剪映那一排的顺序。调节不在这儿：13 根滑杆只放右栏一处，
  // 剪映的左栏「调节」是 LUT 预设浏览器，我们已经有「滤镜」。
  const labels = [...source.matchAll(/\{ key: '\w+', label: '([^']+)', icon: '[^']*' \}/g)].map((m) => m[1]);
  assert.equal(labels.length, 9, '页签数量变了，重新对一遍宽度：' + labels.join('/'));
  assert.ok(labels.every((name) => name.length <= 2), '页签标签要短：' + labels.join('/'));
  assert.deepEqual(labels, ['素材', '音频', '文本', '贴纸', '特效', '转场', '字幕', '滤镜', '模板']);
  assert.ok(!labels.includes('调节'), '调节页签要撤掉，参数只留在右栏');

  // 左栏按原生的份量给，不再是 272 那种挤成竖条
  const width = Number((rule('.ce-pane-left').match(/width:\s*(\d+)px/) || [])[1]);
  assert.ok(width >= 320, '左素材栏太窄：' + width);

  // 预览：引擎给的是画布尺寸的帧，必须按比例撑满监视器，不能原始像素飘在中间
  const img = rule('.ce-stage img');
  assert.ok(/object-fit:\s*contain/.test(img));
  assert.ok(/width:\s*100%/.test(img) && /height:\s*100%/.test(img));
  assert.ok(!/max-height:\s*100%/.test(img), 'max-* 不会放大，640×360 的帧永远只有 640 宽');

  // 壁纸模式那条全局 !important 会给 input/select 刷浅色，剪辑台必须自己扳回来
  assert.ok(css.includes('html[data-wallpaper="true"] .ce-shell :is(input, select, textarea)'));
  assert.ok(css.includes('color-scheme: dark'));
});

test('左侧面板：一排页签 + 二级竖菜单 + 内容区，十个页签都有真东西', () => {
  const source = readWeb('concat-editor.js');
  const css = readWeb('concat-editor.css');

  // 结构：页签条 / 二级竖菜单 / 内容区，三块都在
  for (const part of ['ce-tabstrip', 'ce-left-split', 'ce-subnav', 'ce-subnav-row', 'ce-left-body']) {
    assert.ok(source.includes(part), '缺结构 ' + part);
  }
  assert.ok(css.includes('.ce-left-split') && css.includes('.ce-subnav-row'), '这些块要有样式');
  assert.ok(/flex:\s*0 0 104px/.test(css), '二级菜单是固定窄栏，别抢内容区的宽度');

  // 二级菜单按页签切换，且每个页签都有默认项
  assert.ok(source.includes('subRows'), '二级菜单行要按页签算');
  for (const key of ['media', 'audio', 'text', 'subtitle', 'sticker', 'effect', 'transition', 'filter', 'template']) {
    assert.ok(source.includes(key + ':'), 'SUB_DEFAULTS 缺 ' + key);
  }

  // 每个页签的内容都来自引擎，不是摆样子
  assert.ok(source.includes("'catalogue.list', { kind: kind }"), '特效/转场/滤镜走 catalogue.list');
  assert.ok(/tab === 'filter' \? 'filter'/.test(source), '滤镜读 filter 目录');
  assert.ok(source.includes("'concat.adjust'"), '调节面板认的是 concat.adjust 这个包');
  assert.ok(source.includes('adjustParams'), '调节参数来自目录里的 params');
  assert.ok(source.includes('op: \'addShapeClip\''), '贴纸落到 addShapeClip');
  assert.ok(source.includes("op: 'updateClip', clipId: clip.id, patch: { videoEffects: chain }"), '特效/滤镜/调节都是 patch videoEffects');
  assert.ok(source.includes("'template.list'"), '包装页签读模板库');

  // 调节只留在右栏「详情」里一处：左栏不再摆那 20 个参数
  assert.ok(/adjustParams\.length/.test(source), '右栏要按目录里的参数出调节滑杆');
  assert.ok(!/activeTab === 'adjust'/.test(source), '左栏不该再有调节页签的渲染分支');

  // 每个页签内容区顶栏都一样：检索 / 布局 / 排序
  assert.ok(source.includes('ce-panel-bar') && source.includes('ce-panel-search'), '内容区要有检索');
  assert.ok(source.includes('panelView') && /panelView === \\'grid\\' \? \\'list\\'/.test(source), '要有网格↔列表的布局切换');
  assert.ok(source.includes('v-model="panelSort"'), '要有排序');
  assert.ok(source.includes('panelItems') && source.includes('panelPick'), '列表要由一份 panelItems 驱动');
  assert.ok(css.includes('.ce-cards.grid') && css.includes('.ce-cards.list'), '两种布局都要有样式');

  // 视觉：贴纸格子、调节滑杆（细轨 + 小圆点，不是浏览器默认那条粗杠）
  assert.ok(css.includes('.ce-shapes') && css.includes('.ce-shape-art'));
  assert.ok(css.includes('.ce-slider-row') && css.includes('-webkit-slider-thumb'), '滑杆要自己画');
  assert.ok(css.includes('-webkit-slider-runnable-track'), '轨道要自己画');
});

test('缩略图和波形走素材缓存（引擎没有这两样）', () => {
  const source = readWeb('concat-editor.js');
  assert.ok(source.includes('/api/concat/assets/thumb'));
  assert.ok(source.includes('/api/concat/assets/wave'));
  const assets = readSrc('concat-assets.js');
  assert.ok(assets.includes('ffmpeg'));
  assert.ok(assets.includes('-frames:v'));
  assert.ok(assets.includes('s16le'));
  assert.ok(assets.includes('CACHE'));
  const routes = readSrc('concat-asset-routes.js');
  assert.ok(routes.includes("'/thumb'"));
  assert.ok(routes.includes("'/wave'"));
  assert.ok(routes.includes('isLoopback(req)'));
});

test('轨道按原生顺序自下而上：视频在最下，文字在最上', () => {
  const source = readWeb('concat-editor.js');
  assert.ok(source.includes('tracksDesc'));
  assert.ok(source.includes('this.tracks.slice().reverse()'));
});

/* ------------------------------------------------------------------ 剪映曲库 */

test('曲库这层只是门：转发 + 试听直出，不认识曲库语义', () => {
  const routes = readSrc('music-routes.js');
  // 目标服务是独立的「剪映控制 API」，不是我们把曲库抄进本仓库
  assert.ok(routes.includes('/music/status'));
  assert.ok(routes.includes('/music/native-search'));
  assert.ok(routes.includes('/music/download'));
  assert.ok(routes.includes('isLoopback(req)'), '只认回环');
  assert.ok(routes.includes('Content-Length'), '剪映 API 用 BaseHTTPRequestHandler，必须带长度');
  assert.ok(routes.includes('WMD_JY_API'));
  assert.ok(routes.includes('WMD_JY_PYTHON'));
  // 试听：Range 直出，白名单目录
  assert.ok(routes.includes('bytes='));
  assert.ok(routes.includes('Content-Range'));
  assert.ok(routes.includes('WMD_JY_MUSIC_ROOTS'));
  assert.ok(routes.includes('AUDIO_MIME'));
});

test('server.js 挂上曲库路由', () => {
  const source = readSrc('server.js');
  assert.ok(source.includes("require('./music-routes')"));
  assert.ok(source.includes('await musicRoutes('));
});

test('页面：音频页签有两个源，曲库能搜 / 试听 / 放进时间线', () => {
  const source = readWeb('concat-editor.js');
  assert.ok(source.includes('剪映曲库'));
  assert.ok(source.includes("setAudioSource("));
  assert.ok(source.includes('/api/music/native?q='));
  assert.ok(source.includes('/api/music/search?limit='));
  assert.ok(source.includes('/api/music/download'));
  assert.ok(source.includes('/api/music/audio?path='));
  // 放进时间线走引擎原生的 media.import + addClip，不自造接口
  assert.ok(source.includes("call('media.import'"));
  assert.ok(source.includes("op: 'addClip'"));
});

test('剪映 API 自己新增了曲库端点（数据源在 tools/jianying-api）', () => {
  const server = fs.readFileSync(path.resolve(ROOT, '..', 'tools', 'jianying-api', 'server.py'), 'utf8');
  assert.ok(server.includes('def ep_music_native'));
  assert.ok(server.includes('def ep_music_download'));
  assert.ok(server.includes('def ep_music_status'));
  assert.ok(server.includes('"/music/native-search"'));
  assert.ok(server.includes('"/music/download"'));
  assert.ok(server.includes('lyra.search('));
  assert.ok(server.includes('lyra.download('));
});
test('试听走同源转发：白名单 + https + Range 透传', () => {
  const routes = readSrc('music-routes.js');
  assert.ok(routes.includes("'/preview'"), '要有 /api/music/preview');
  assert.ok(routes.includes('WMD_JY_PREVIEW_HOSTS'));
  assert.ok(routes.includes("parsed.protocol !== 'https:'"));
  assert.ok(routes.includes('hostAllowed(parsed.hostname)'));
  assert.ok(routes.includes("req.headers.range"), 'Range 要转给 CDN');
  assert.ok(routes.includes('vlabvod.com'), '默认白名单含剪映 CDN');
  // 页面不再直连 CDN：<audio> 的 src 一律同源
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes('/api/music/preview?url='));
  assert.equal(/audio\.src\s*=\s*item\.preview_url/.test(page), false, '不能把 CDN 地址直接塞给 <audio>');
});

test('曲库状态在挂载时预取，失败会重试并留可见的重试入口', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes('this.loadMusicStatus();'), 'mounted 里先探一次');
  assert.ok(page.includes('musicError'));
  assert.ok(page.includes('retryMusic'));
  assert.ok(page.includes('ce-music-retry'));
});
/* ------------------------------------------------------------------ 缺口修复 */

test('导入素材：原生文件框 → media.import，路径从服务端拿（浏览器给不了绝对路径）', () => {
  const page = readWeb('concat-editor.js');
  const routes = readSrc('concat-rpc-routes.js');
  const picker = readSrc('media-picker.js');
  const server = readSrc('server.js');

  assert.ok(page.includes("'/api/concat/pick'"), '页面要问服务端要文件路径');
  assert.ok(page.includes('importMedia') && page.includes("'media.import'"), '拿到路径就 media.import');
  assert.ok(!page.includes("input type=\"file\""), '浏览器 file 控件给不了绝对路径，不用它');
  assert.ok(routes.includes("what === '/pick'"), '要挂 POST /api/concat/pick');
  const chooser = fs.readFileSync(path.join(ROOT, 'scripts', 'pick-media.py'), 'utf8');
  assert.ok(chooser.includes('askopenfilenames'), '多选文件框');
  assert.ok(picker.includes('MEDIA_EXT') && picker.includes('.mp4') && picker.includes('.mp3'), '只放音视频/图片后缀进来');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'pick-media.py')), '选择框脚本要在 scripts 里');
  assert.ok(server.includes('concatRpcRoutes'), '路由仍由 server.js 挂');
});

test('导出：export.run 起渲染，轮询 export.status 报进度，可取消', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes("'export.run'") && page.includes("'export.status'") && page.includes("'export.cancel'"));
  assert.ok(page.includes('pollExport') && page.includes('exportPercent') && page.includes('exportStage'));
  assert.ok(page.includes('ce-export-bar'), '状态栏要显示进度和取消');
  assert.ok(page.includes("status.state === 'running'"), '按引擎的 JobState 判断');
  assert.ok(page.includes("status.state === 'done'"), '完成要报文件路径');
  // 导出文件写在工程目录里，在引擎的 root 之下
  assert.ok(page.includes('this.projectPath.replace') && page.includes("'\\\\导出-'"), '输出落在工程目录');
});

test('文本与字幕：打字走 addTextClip，改字保留原样式', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes("op: 'addTextClip'") && page.includes('style: { content: words }'));
  assert.ok(page.includes('ce-compose') && page.includes('textDraft'), '内容区要有一个打字条');
  assert.ok(page.includes('setTextContent'), '详情栏能改字');
  assert.ok(/Object\.assign\(\{\}, clip\.text \|\| \{\}, \{ content: words \}\)/.test(page), '改字要带上原有字体/字号/颜色');
  assert.ok(readWeb('concat-editor.css').includes('.ce-dtext'), '改字框要有样式');
});

test('转场：写到目标片段的 transitionIn，不是只列目录', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes('applyTransition'));
  assert.ok(/patch: \{ transitionIn: \{ id: pkg\.id, duration: 1 \} \}/.test(page), '目录里的 id 原样写进 transitionIn');
  assert.ok(page.includes('transitionTarget'), '目标是选中片段，否则播放头之后最近的视频片段');
  assert.ok(page.includes("patch: { transitionIn: null }"), '能去掉转场');
  assert.ok(!page.includes('转场要落在两个相邻片段之间'), '旧的“只列目录”说法要去掉');
});

test('模板：能把这个工程存成模板（template.save），实例化缺槽位如实说', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes("'template.save'"), '存为模板真调引擎');
  assert.ok(page.includes('saveTemplate') && page.includes('templateName'));
  assert.ok(page.includes('useTemplate') && page.includes('个占位要填文件'), 'instantiate 要每槽一文件，缺就说明白');
});

test('播放：时间游标不取整，否则播放头原地不动', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes('playCursor'), '要有不取整的时间游标');
  assert.ok(/self\.playCursor \+= dt/.test(page), '游标按真实时间累加');
  assert.ok(/playhead = PL\.quantize\(self\.playCursor/.test(page), '播放头只是游标的取整显示');
  assert.ok(!/var next = self\.playhead \+ dt/.test(page), '不能拿取整后的播放头当累加基准（floor 会永远回到同一帧）');
  assert.ok(/seek: function[\s\S]{0,200}this\.playCursor = next/.test(page), '拖播放头要把游标一起搬');
});

test('时间线：出声 + 电平表真动 + 新建时间线/轨道', () => {
  const page = readWeb('concat-editor.js');
  const routes = readSrc('concat-asset-routes.js');
  const css = readWeb('concat-editor.css');

  // 播放时按片段同步 <audio>，音频流走同源直出
  assert.ok(page.includes('soundSync') && page.includes('soundStart') && page.includes('soundStop'));
  assert.ok(page.includes("'/api/concat/assets/media?path='"));
  assert.ok(routes.includes("what === '/media'"), '要挂 /api/concat/assets/media');
  assert.ok(routes.includes("'Content-Range'"), '<audio> 跳着播要 Range');
  assert.ok(page.includes('readMeters') && page.includes('createAnalyser') && page.includes('getByteTimeDomainData'), '电平表吃 AnalyserNode');
  assert.ok(page.includes('startPlay') && /self\.soundSync\(\)/.test(page), '播放循环里每帧对齐一次');
  assert.ok(!/ce-meter-pair i \{[\s\S]{0,200}height:\s*\d+px/.test(css), '电平表高度要由数据给，不写死');
  assert.ok(page.includes('meterStyle'));

  // 时间线上的 +：真加时间线 / 轨道
  assert.ok(page.includes("op: 'addTimeline'") && page.includes("op: 'addTrack'"));
  assert.ok(page.includes('addTimeline') && page.includes('addTrack'));
});

test('零碎按钮不再只是提示：新建工程 / 全屏 / 预览质量 / 搜索聚焦', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes("'project.create'") && page.includes('createProject'), '新建工程真调 project.create');
  assert.ok(page.includes('folderName'), '文件夹名规则要照引擎的来');
  assert.ok(page.includes('toggleFullscreen') && page.includes('requestFullscreen'), '全屏按钮要真全屏');
  assert.ok(page.includes('qualityWidth') && page.includes('previewQuality'), '预览质量换帧宽');
  assert.ok(page.includes("this.$refs.panelInput"), '按 / 聚焦检索框');
  assert.ok(!page.includes('导出还没接进界面') && !page.includes('导入还没接进界面') && !page.includes('Modify 面板还没接'), '过时的占位提示要清掉');
});
/* --------------------------------------------------- 二期缺口（检查器 / 模板 / 字幕 / 框选 / 曲库） */

test('调节面板：20 个参数全摆出来（13 滑杆 + 3 色轮 + 4 曲线）', () => {
  const page = readWeb('concat-editor.js');
  const css = readWeb('concat-editor.css');
  // 引擎目录里 concat.adjust 是 13 float + 3 wheel + 4 curve；页面按 type 分三栏，不再把色轮曲线丢掉
  assert.ok(page.includes('adjustSliders') && page.includes('adjustWheels') && page.includes('adjustCurves'));
  assert.ok(page.includes("p.type === 'wheel'") && page.includes("p.type === 'curve'"));
  assert.ok(!/if \(p\.type !== 'float' && p\.type !== 'int'\) return false/.test(page), '不许再把色轮/曲线过滤掉');
  // 色轮 = 单位圆里的 <key>.x/.y + <key>.m；曲线 = <key>.<n>.x/.y
  assert.ok(page.includes("' + '.x'") || page.includes("p.key + '.x'"), '色轮写点号键 x');
  assert.ok(page.includes("p.key + '.m'"), '色轮有明度 master');
  assert.ok(page.includes("p.key + '.' + n + '.x'"), '曲线按序号写点');
  assert.ok(page.includes('wheelDown') && page.includes('wheelTrack') && page.includes('curveDown') && page.includes('curveGrab'));
  assert.ok(page.includes('commitAdjust'), '拖动期间走草稿，松手写一次');
  assert.ok(css.includes('.ce-wheel') && css.includes('.ce-curve'), '色轮圆盘与曲线画布要有样式');
});

test('关键帧：片段属性 setClipKey，效果参数 setEffectKey', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes("op: 'setClipKey'") && page.includes("op: 'clearClipKey'") && page.includes("op: 'clearClipKeys'"));
  assert.ok(page.includes("op: 'setEffectKey'") && page.includes("op: 'clearEffectKey'"));
  assert.ok(page.includes('keyFraction'), 'at 是片内比例，不是秒');
  assert.ok(/Math\.min\(1, Math\.max\(0, at\)\)/.test(page), 'at 要夹在 0..1');
  assert.ok(page.includes('clipKeyRows') && page.includes('keyCountOf'));
  assert.ok(page.includes('ce-kf'), '◆ 按钮');
  assert.ok(page.includes('toggleClipKey') && page.includes('toggleEffectKey'));
});

test('遮罩：ClipMask 整份写回（updateClip → patch.mask）', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes('maskShapes') && page.includes('maskFields'));
  assert.ok(page.includes("patch: { mask: mask }") && page.includes("patch: { mask: null }"), '值替换 / null 去掉');
  assert.ok(page.includes('setMask') && page.includes('commitMask') && page.includes('clearMask'));
  ['circle', 'rectangle', 'linear', 'mirror', 'heart', 'star'].forEach((shape) => {
    assert.ok(page.includes(shape), '引擎的 6 种遮罩形状要都在：' + shape);
  });
});

test('模板填槽：逐槽选文件后 template.instantiate', () => {
  const page = readWeb('concat-editor.js');
  const routes = readSrc('concat-rpc-routes.js');
  assert.ok(page.includes("'template.instantiate'"), '真调 instantiate');
  assert.ok(page.includes('slotPick') && page.includes('slotChoose') && page.includes('slotReady'));
  assert.ok(page.includes('fills: fills') || page.includes('fills:'), '每个占位给一个文件');
  assert.ok(page.includes('mediaId: slot.mediaId'), 'Fill 的字段是 mediaId + file');
  assert.ok(page.includes('/api/concat/pick') && page.includes('single: true'), '填槽要单选文件');
  assert.ok(routes.includes('body.exts') || routes.includes('exts'), 'pick 要能吃后缀白名单');
});

test('字幕：SRT/VTT 解析 + 一条 batch 落字', () => {
  const page = readWeb('concat-editor.js');
  const routes = readSrc('concat-asset-routes.js');
  assert.ok(page.includes('importSubtitle') && page.includes('parseSubtitles'));
  assert.ok(/--\\>/.test(page) || page.includes('-->'), '按 --> 认时间轴');
  assert.ok(page.includes("op: 'batch'"), '几十条字幕走一条 batch（一个撤销步）');
  assert.ok(page.includes('duration: Math.round(cue.duration'), '每条用它自己的时长');
  assert.ok(page.includes('splitDraft') && page.includes('subMaxChars'), '纯文本按标点拆行');
  assert.ok(routes.includes("what === '/doc'") && routes.includes('SUB_TEXT_EXT'), '服务端读字幕文本，白名单只三种后缀');
});

test('框选：时间线空白处拖出矩形选中多段', () => {
  const page = readWeb('concat-editor.js');
  const css = readWeb('concat-editor.css');
  assert.ok(page.includes('onLaneDown') && page.includes('marqueeTrack') && page.includes('marqueeCommit'));
  assert.ok(page.includes('@pointerdown="onLaneDown"'));
  assert.ok(page.includes('ce-marquee'));
  assert.ok(css.includes('.ce-marquee'));
  assert.ok(page.includes('@pointerup="onPointerUp"') || page.includes("addEventListener('pointerup'"), '松手要收口');
  assert.ok(/if \(this\.marquee\) \{ this\.marqueeCommit\(\); return; \}/.test(page), '框选优先于片段拖动收口');
});

test('曲库二期：收藏 / 最近 记在本机', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes("SHELF_FAV") && page.includes("SHELF_RECENT"));
  assert.ok(page.includes('wmd.concat.music.fav') && page.includes('wmd.concat.music.recent'));
  assert.ok(page.includes('toggleFav') && page.includes('isFav') && page.includes('rememberRecent'));
  assert.ok(page.includes('musicView'), '列表按 音乐/音效/本机/收藏/最近 切');
  // 模板里的引号是被转义过的：setMusicKind(\'fav\')
  assert.ok(page.includes("setMusicKind(\\'fav\\')") && page.includes("setMusicKind(\\'recent\\')"));
  assert.ok(page.includes('rememberRecent(Object.assign({}, item'), '放进时间线就记一次最近');
});

test('环境自检与批量导入：不让人把引擎的坑当 bug', () => {
  const page = readWeb('concat-editor.js');
  const routes = readSrc('concat-rpc-routes.js');
  assert.ok(routes.includes("what === '/health'"), '要有 /api/concat/health');
  assert.ok(routes.includes('titles') && routes.includes('引擎写不了文字/图形缓存'), 'titles 写不进去要说出来');
  assert.ok(page.includes('/api/concat/health') && page.includes('healthWarnings'));
  assert.ok(page.includes('importBatch') && page.includes('callMany'), '批量导入一次请求塞多条');
  assert.ok(/var chunk = 8;/.test(page));
});

test('抠像：Cutout 走 setClipCutout（和遮罩是两条不同的命令）', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes("op: 'setClipCutout'"), '抠像是文档命令 setClipCutout');
  assert.ok(page.includes('cutoutValue') && page.includes('setCutout') && page.includes('clearCutout'));
  assert.ok(page.includes("cutout: null"), 'null 就是去掉抠像');
  assert.ok(page.includes("mode: 'auto'") && page.includes("subject: 'auto'"), '默认 自动/自动');
  assert.ok(/feather: 0\.004/.test(page), '羽化默认值要跟引擎的 DEFAULT_FEATHER 对上');
  assert.ok(page.includes('Object.assign({ mode: \'auto\', subject: \'auto\', feather: 0.004 }, clip.cutout || {})'),
    '整份替换时已画的笔画要留着（strokes 缺了就被清掉）');
  assert.ok(!/patch: \{ cutout/.test(page), '抠像不是 updateClip 的补丁');
});

test('曲库分类：题材词芯片点一下就是一次真搜索', () => {
  const page = readWeb('concat-editor.js');
  assert.ok(page.includes('MUSIC_TOPICS') && page.includes('musicTopics'));
  assert.ok(page.includes('pickTopic') && page.includes('this.musicQuery = String(topic || \'\')'));
  assert.ok(/return this\.searchMusic\(\)/.test(page), '分类复用 searchMusic，不另开一条数据路');
  assert.ok(page.includes('ce-chips-topics'), '分类那排有自己的样式');
});

test('预览帧：拖播放头/播放时带 nearest=1（引擎源码已支持，旧 exe 会忽略）', () => {
  const page = readWeb('concat-editor.js');
  const routes = readSrc('concat-rpc-routes.js');
  assert.ok(page.includes("'&nearest=1'"), '页面要会带这个开关');
  assert.ok(/var scrub = this\.playing \|\| this\.drag \|\| this\.marquee \|\| this\.rulerDrag/.test(page));
  assert.ok(routes.includes("url.searchParams.get('nearest') === '1'"), '服务端直通 nearest');
  assert.ok(routes.includes("url.searchParams.get('proxy') === '1'"), '服务端直通 proxy');
});
