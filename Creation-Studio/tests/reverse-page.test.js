'use strict';
// 图像反推页：反推完直接在右侧画布出图，不再跳「图像生成」页签；反推出来的提示词常显、可直接改。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = require('./helpers/app-source')();
const css = fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8');

function section(startMarker, endMarker) {
  const start = app.indexOf(startMarker);
  const end = app.indexOf(endMarker, start + 1);
  assert.ok(start > 0 && end > start, `找不到 ${startMarker}`);
  return app.slice(start, end);
}

test('反推页：按钮是「反推并出图」，不再是「去生成」跳页签', () => {
  const panel = section("if (tab === 'reverse') {", 'return tabsBar + generationPrefixHtml');
  assert.ok(panel.includes('反推并出图'), '主按钮要写清是反推+出图');
  assert.ok(panel.includes('再出一张'), '已有结果时可以直接再出一张');
  assert.ok(!panel.includes('去生成'), '不再提供「去生成」这个跳页签的入口');
});

test('反推页：提示词常显，不折叠——那是要改的重点', () => {
  const panel = section("if (tab === 'reverse') {", 'return tabsBar + generationPrefixHtml');
  assert.ok(!panel.includes('<details'), '提示词不能收进 details');
  assert.ok(panel.includes('id="img-reverse-out"'), '提示词文本域要直接显示出来');
  assert.ok(panel.includes('zs-reverse-prompt'), '用常显的样式块');
  assert.ok(/直接改/.test(panel), '要说明这块可以直接改');
  assert.ok(css.includes('.zs-reverse-prompt'), '常显样式要在');
  assert.ok(!css.includes('.zs-reverse-more'), '折叠样式已经不需要了');
});

test('反推完立刻出图，而且不切页签', () => {
  const handler = section("if (act === 'image-reverse') {", "if (act === 'image-generate') {");
  assert.ok(handler.includes('im.reverseText = res.prompt'), '结果要落进 reverseText');
  assert.ok(handler.includes('im.prompt = res.prompt'), '同时同步成出图提示词');
  assert.ok(handler.includes('imageGenerateNow('), '要直接提交出图');
  assert.ok(!handler.includes("im.tab = 'generate'"), '不能跳到图像生成页签');
});

test('出图走后台任务，结果回填右侧画布', () => {
  const helper = section('const imageGenerateNow = async (prompt, refs = []) => {', 'if (im.tab === \'scene\')');
  assert.ok(helper.includes("api('/api/images/generate'"), '复用的还是正式生图接口');
  assert.ok(helper.includes('background: true'), '后台任务，切菜单不中断');
  assert.ok(helper.includes('await IJ.refresh()'), '提交后立刻同步任务，画布会自己更新');
  assert.ok(helper.includes('IJ.active('), '已有未结束任务时不要叠加');
  assert.ok(helper.includes('refs: Array.isArray(refs) ? refs : []'), '默认纯文生图，不带参考图');
});

test('画布状态提示改成「结果显示在这里」', () => {
  assert.ok(app.includes('选源图 → 反推并出图，结果显示在这里'), '状态条要说明结果留在当前页');
  assert.ok(!app.includes("(tab === 'reverse' ? '选择源图后点「反推提示词」'"), '旧文案要换掉');
});
