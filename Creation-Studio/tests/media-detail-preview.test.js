'use strict';
// 媒体库点开视频：预览框不能被 modal 的 flex 压扁后裁掉上下（原来只剩中间一条画面）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../web/styles.css'), 'utf8');

function detailModal() {
  const start = app.indexOf('function openMediaDetail(item) {');
  const end = app.indexOf('WB.mediaDetails(item);', start);
  assert.ok(start > 0 && end > start, '找不到 openMediaDetail');
  return app.slice(start, end);
}

test('媒体库详情用统一的预览容器，不再写内联尺寸', () => {
  const modal = detailModal();
  assert.ok(modal.includes('class="media-detail-preview"'), '要用预览容器类');
  assert.ok(!modal.includes('min-height:240px'), '旧的 min-height 内联会把框压成 240px');
  assert.ok(!/style="width:100%;max-height:65vh/.test(modal), '不再给 video 写内联宽高');
  assert.ok(!modal.includes('place-items:center;min-height'), '旧内联容器要去掉');
});

test('预览容器不许被 flex 压缩，画面按比例完整显示', () => {
  const rule = /\.media-detail-preview\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, '要有 .media-detail-preview 规则');
  assert.match(rule[1], /flex:\s*0 0 auto/, 'modal-body 是 flex 列，不写 flex:0 0 auto 就会被压缩后裁切');
  assert.match(rule[1], /overflow:\s*hidden/, '圆角裁切只裁容器');
  const video = /\.media-detail-preview video\s*\{([^}]*)\}/.exec(css);
  assert.ok(video, '要有视频规则');
  assert.match(video[1], /object-fit:\s*contain/, '视频要完整显示，不能裁');
  assert.match(video[1], /max-height:\s*60vh/, '高度要受视口限制');
  assert.match(video[1], /height:\s*auto/, '高度按比例算');
  const img = /\.media-detail-preview img\s*\{([^}]*)\}/.exec(css);
  assert.ok(img && /object-fit:\s*contain/.test(img[1]), '图片同样按比例完整显示');
});

test('详情弹窗其余字段不受影响', () => {
  const modal = detailModal();
  for (const label of ['任务', '分镜', '文件', '大小']) {
    assert.ok(modal.includes(`<span>${label}</span>`), `详情里仍要有「${label}」`);
  }
  assert.ok(modal.includes('导入剪映'), '底部按钮不变');
});
