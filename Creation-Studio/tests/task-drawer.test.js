'use strict';
// 任务详情抽屉：编辑/重试/筛选/失败归因/并发上限（以源码约束为主）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const eventsWeb = fs.readFileSync(path.join(__dirname, '../web/events.js'), 'utf8');
const eventsServer = fs.readFileSync(path.join(__dirname, '../src/events.js'), 'utf8');

const drawerStart = eventsWeb.indexOf("drawer.addEventListener('click', async (clickEvent)");
const drawerEnd = eventsWeb.indexOf("drawer.addEventListener('click', (event) => { if (event.target === drawer)");
assert.ok(drawerStart > 0 && drawerEnd > drawerStart, '在 web/events.js 里找不到抽屉点击处理');

const drawerHandler = eventsWeb.slice(drawerStart, drawerEnd);

test('编辑：点击回调不能遮蔽任务对象 event', () => {
  assert.ok(drawerHandler.includes('async (clickEvent)'), '点击参数应改名，避免遮蔽任务对象');
  assert.ok(drawerHandler.includes('(event.items || []).find((row) => row.id === itemId)'), '编辑要用任务对象里的分镜');
  assert.ok(drawerHandler.includes('clickEvent.target.closest'), '点击目标从 clickEvent 读取');
  assert.ok(!drawerHandler.includes('clickEvent.items'), 'clickEvent 上没有 items');
  assert.ok(drawerHandler.includes('openReviseModal(id, item'), '找到分镜后要打开改提示词弹窗');
});

test('重试：刷新详情不能先关闭抽屉', () => {
  const openStart = eventsWeb.indexOf('async function openDetail(id)');
  const openEnd = eventsWeb.indexOf("drawer.querySelector('#drawer-attempt-count')", openStart);
  assert.ok(openStart > 0 && openEnd > openStart, '找不到 openDetail');
  const body = eventsWeb.slice(openStart, openEnd);
  assert.ok(!body.includes('closeDrawer(true)'), 'openDetail 不应先关抽屉');
  assert.ok(body.indexOf('await Promise.all') < body.indexOf("document.createElement('div')"), '先取数据，再替换抽屉');
  assert.ok(body.includes('keptTab') && body.includes('keptScroll'), '刷新时保留当前页签和滚动位置');
  assert.ok(body.includes('previous.remove()'), '新抽屉就绪后才移除旧抽屉');
});

test('重试失败项：只重发失败分镜，并写清楚范围', () => {
  assert.ok(eventsWeb.includes('重试失败分镜（'), '按钮要写明只重试失败分镜');
  assert.ok(eventsWeb.includes('只会重新提交本任务里'), '确认框要写明只提交本任务的失败分镜');
  assert.ok(eventsWeb.includes('已成功、已取消、已跳过的分镜不会重复提交'), '明确不会重发成功的分镜');
  assert.ok(eventsWeb.includes('不会重发同一个项目的其它任务'), '明确不会重发整个项目');
  assert.ok(!eventsWeb.includes("['failed', 'canceled', 'skipped', 'success'].includes(item.status)"), '成功分镜不再提供重试按钮');
});

test('任务概览/详情：支持按成功、失败等状态筛选', () => {
  assert.ok(eventsWeb.includes('data-drawer-filter="'), '要有状态筛选按钮');
  assert.ok(eventsWeb.includes("['all', '全部'") && eventsWeb.includes("['failed', '失败'"), '筛选包含失败/成功等状态');
  assert.ok(eventsWeb.includes('data-drawer-item-status='), '分镜卡片要带状态，便于筛选');
  assert.ok(eventsWeb.includes('data-drawer-attempt-status='), '执行记录卡片要带状态，便于筛选');
  assert.ok(eventsWeb.includes('const applyFilter = () =>'), '筛选要真正生效');
});

test('运行时间：概览列表新增列并按运行时间排序', () => {
  assert.ok(eventsWeb.includes('function runAt(event)'), '要有运行时间计算');
  assert.ok(eventsWeb.includes('data-label="运行时间"'), '表格要有运行时间列');
  assert.ok(eventsWeb.includes("['runtime_desc','运行时间（新→旧）']"), '提供运行时间排序选项');
  assert.ok(eventsWeb.includes("state.taskEventSort||'runtime_desc'"), '默认按运行时间排序');
  const store = fs.readFileSync(path.join(__dirname, '../src/event-store.js'), 'utf8');
  assert.ok(store.includes('runtime_desc') && store.includes('runtime_asc'), '服务端要支持运行时间排序');
  assert.ok(store.includes("$.startedAt"), '运行时间优先取实际开始时间');
  assert.ok(store.includes("$.schedule.startAt"), '未开始的用计划运行时间');
  assert.ok(eventsWeb.includes('按运行时间倒序'), '执行历史也要标明按运行时间排序');
  assert.ok(eventsWeb.includes('运行时间 ${started'), '执行记录卡片要显示运行时间');
});

test('任务报告：按失败原因归因统计', () => {
  assert.ok(eventsServer.includes('FAILURE_LABELS'), '失败原因要有类别名称');
  assert.ok(eventsServer.includes('reasons: [...reasons.values()]'), '报告返回按原因聚合的结果');
  assert.ok(eventsServer.includes('category: (analysis && analysis.category)'), '归因读取失败的类别');
  assert.ok(eventsServer.includes('reason: String((analysis && analysis.reason)'), '归因读取失败原因');
  assert.ok(eventsWeb.includes('失败原因归因'), '报告页要展示原因归因');
  assert.ok(eventsWeb.includes('report.reasons'), '报告页要读取原因统计');
});

test('调度并发：上限从 4 提到 10', () => {
  assert.ok(eventsWeb.includes('Array.from({ length: 10 }'), '并发下拉要有 1–10');
  assert.ok(eventsServer.includes('Math.min(10, Number(input.policy?.concurrency)') || eventsServer.includes('Math.min(10, Number(input.concurrency)'), '服务端上限为 10');
  assert.ok(!eventsServer.includes('Math.min(4, Number(input.policy?.concurrency)'), '不再限制为 4');
  const config = fs.readFileSync(path.join(__dirname, '../src/config.js'), 'utf8');
  assert.ok(config.includes('Math.min(10, Number(cfg.concurrency)'), '全局并发上限为 10');
});

test('详情页：在文件夹中显示要定位文件，另加手动刷新与自动刷新', () => {
  assert.ok(eventsWeb.includes("body: { path: videoPath, select: true }"), '定位成片要带 select，不能直接播放视频');
  assert.ok(eventsWeb.includes('data-drawer-refresh'), '任务详情要有刷新按钮');
  assert.ok(eventsWeb.includes("refreshBtn.textContent = '刷新中…'"), '刷新要给出即时反馈');
  assert.ok(eventsWeb.includes('drawerAutoTimer'), '详情页要有自动刷新计时器');
  assert.ok(eventsWeb.includes('stopDrawerAutoRefresh()'), '重画和关闭抽屉都要清掉计时器');
  assert.ok(eventsWeb.includes('[data-drawer-refresh]'), '刷新按钮要能绑定');
});

test('自动刷新不能整页重画（会闪屏），只打补丁', () => {
  assert.ok(eventsWeb.includes('const patchDrawer ='), '要有局部打补丁函数');
  assert.ok(eventsWeb.includes('const refreshSilently ='), '自动刷新走静默刷新');
  const timerBlock = eventsWeb.slice(eventsWeb.indexOf('drawerAutoTimer = setInterval'), eventsWeb.indexOf('const showLog = async'));
  assert.ok(timerBlock.includes('refreshSilently()'), '计时器里只能静默刷新');
  assert.ok(!timerBlock.includes('openDetail('), '计时器里不能整页重画');
  const buttonBlock = eventsWeb.slice(eventsWeb.indexOf('refreshBtn.onclick'), eventsWeb.indexOf('drawerAutoTimer = setInterval'));
  assert.ok(buttonBlock.includes('await refreshSilently()'), '刷新按钮走静默刷新');
  assert.ok(!buttonBlock.includes('openDetail('), '刷新按钮不能整页重画');
  assert.ok(eventsWeb.includes('if (!patchDrawer(nextEvent, nextJobByItem)) { await openDetail(id); return; }'), '条目增减时才允许整页重画');
  for (const marker of ['data-shot-status', 'data-shot-meta', 'data-shot-flags', 'data-shot-media', 'data-shot-actions', 'data-shot-sig']) {
    assert.ok(eventsWeb.includes(marker), `缺少可局部替换的块：${marker}`);
  }
  assert.ok(eventsWeb.includes('data-task-badge') && eventsWeb.includes('data-kpi=') && eventsWeb.includes('data-progress'), '统计区也要能局部更新');
  assert.ok(eventsWeb.includes('jobByItem.clear()'), '补丁要把新任务数据合进原来的 Map，右键/重试才拿到新值');
  assert.ok(eventsWeb.includes('.evt-shot-flags') || fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8').includes('.evt-shot-flags'), '失败提示容器要有样式');
});

test('编辑分镜：参考图能看、能换、能删，点图放大', () => {
  assert.ok(eventsWeb.includes('id="revise-refs-grid"'), '编辑弹窗要有参考图区');
  assert.ok(eventsWeb.includes('data-ref-zoom='), '缩略图要能点开大图');
  assert.ok(eventsWeb.includes('data-ref-replace=') && eventsWeb.includes('data-ref-remove='), '每张图要能替换和删除');
  assert.ok(eventsWeb.includes('function openImageLightbox('), '要有原图预览浮层');
  assert.ok(eventsWeb.includes("'/api/upload/raw?'"), '换图走原始上传接口');
  assert.ok(eventsWeb.includes('payload.images = refs.map'), '保存时把参考图列表发给 revise');
  assert.ok(eventsServer.includes('Array.isArray(patch.images)'), '服务端要接收参考图修改');
  assert.ok(eventsServer.includes('参考图不存在'), '服务端要校验图片真实存在');
});
