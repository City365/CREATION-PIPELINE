'use strict';
// 执行过程：把运行轨迹整理成 思考 / 运行命令 / 结果 三类行
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
const start = source.indexOf('function askTraceRows(');
const end = source.indexOf('function askTraceRowHtml(');
assert.ok(start > 0 && end > start, '在 app.js 里找不到 askTraceRows');

const box = {};
new Function('module', 'exports', `${source.slice(start, end)}\nmodule.exports = { askTraceRows };`)(box, box.exports);
const { askTraceRows } = box.exports;

const TRAJ = [
  { role: 'user', kind: 'instruction', content: '生成五张秋山' },
  { role: 'assistant', kind: 'tool_selection', content: '我先看有哪些图像渠道。', tool_calls: [{ name: 'list_creation_models', arguments: {} }] },
  { role: 'tool', kind: 'tool_result', tool_name: 'list_creation_models', status: 'success', content: '{"ok": true}' },
  { role: 'assistant', kind: 'tool_selection', content: '', tool_calls: [{ name: 'generate_image', arguments: { prompt: '深秋山道' } }] },
  { role: 'tool', kind: 'tool_result', tool_name: 'generate_image', status: 'failed', content: '{"ok": false,"error":"配额不足"}' },
  { role: 'assistant', kind: 'final', content: '五张图已生成' },
];

test('思考与工具调用都进执行过程，最终回答不重复展示', () => {
  const rows = askTraceRows({ trajectory: TRAJ });
  assert.deepEqual(rows.map((r) => r.type), ['think', 'tool', 'result', 'tool', 'result']);
  assert.equal(rows[0].text, '我先看有哪些图像渠道。');
  assert.equal(rows[1].name, 'list_creation_models');
  assert.equal(rows[3].name, 'generate_image');
});

test('工具参数压成一行并截断', () => {
  const rows = askTraceRows({ trajectory: [{ role: 'assistant', kind: 'tool_selection', content: '', tool_calls: [{ name: 'generate_image', arguments: { prompt: 'x'.repeat(300) } }] }] });
  assert.equal(rows.length, 1);
  assert.ok(rows[0].args.length <= 80);
  assert.ok(rows[0].args.startsWith('{"prompt":"xxx'));
});

test('失败的工具结果会带状态', () => {
  const rows = askTraceRows({ trajectory: TRAJ });
  const failed = rows.filter((r) => r.type === 'result' && r.status === 'failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].name, 'generate_image');
});

test('没有轨迹时返回空数组', () => {
  assert.deepEqual(askTraceRows({}), []);
  assert.deepEqual(askTraceRows({ trajectory: [] }), []);
});

test('界面不再出现旧的空占位文案', () => {
  assert.equal(source.includes('本轮没有调用工具'), false);
  assert.equal(source.includes('本轮没有计划步骤'), false);
  assert.equal(source.includes('完整用户 / 助手 / 工具记录可在右侧'), false);
  assert.ok(source.includes('ask-tool-runs'), '用真实步骤列表渲染');
  assert.ok(source.includes('askLoadMessageTrace'), '按运行 id 拉取轨迹');
  assert.ok(source.includes('trajectory?run_id='), '只取这一轮的轨迹');
});
