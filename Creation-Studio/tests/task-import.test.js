'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const taskImport = require('../src/task-import');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const tempDirs = [];
function tempImage(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-import-'));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, PNG);
  return file;
}
test.after(() => { for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true }); });

function jsonBuffer(data) { return Buffer.from(JSON.stringify(data), 'utf8'); }

test('JSON 模板可解析，示例里的占位参考图会按行报错', () => {
  const result = taskImport.parseFile({ name: 'template.json', data: taskImport.jsonTemplate() });
  assert.equal(result.format, 'json');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].title, '镜头 01');
  assert.ok(result.items[0].prompt.includes('雨夜'));
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /第 1 行 参考图不存在/);
  assert.equal(result.stats.items, 2);
});

test('JSON 固定结构：参考图路径、说明、时长、画幅、张数都能解析', () => {
  const image = tempImage('ref.png');
  const result = taskImport.parseFile({
    name: 'tasks.json',
    data: jsonBuffer({
      version: 1,
      items: [{
        title: '镜头 A',
        prompt: '一只猫在窗台看雨',
        images: [{ path: image, note: '女主正面' }, image],
        duration: 12,
        ratio: '9:16',
        resolution: '768p竖',
        count: 2,
      }],
    }),
  });
  assert.deepEqual(result.errors, []);
  const item = result.items[0];
  assert.equal(item.title, '镜头 A');
  assert.equal(item.duration, 12);
  assert.equal(item.ratio, '9:16');
  assert.equal(item.resolution, '768p竖');
  assert.equal(item.count, 2);
  assert.equal(item.images.length, 2);
  assert.equal(item.images[0].note, '女主正面');
  assert.equal(item.images[1].name, 'ref.png');
  assert.equal(item.images[0].exists, true);
  assert.equal(result.stats.images, 2);
});

test('JSON 不再接受一行一条的文本，也不接受缺 items 的结构', () => {
  assert.throws(() => taskImport.parseFile({ name: 'tasks.json', data: Buffer.from('第一行提示词\n第二行提示词') }), /JSON 解析失败/);
  assert.throws(() => taskImport.parseFile({ name: 'tasks.json', data: jsonBuffer({ tasks: [{ prompt: 'a' }] }) }), /缺少 items 数组/);
  assert.throws(() => taskImport.parseFile({ name: 'tasks.json', data: jsonBuffer({ items: [] }) }), /items 数组是空的/);
});

test('JSON 结构校验：空提示词、非法时长 / 画幅 / 张数、参考图缺失', () => {
  const result = taskImport.parseFile({
    name: 'bad.json',
    data: jsonBuffer({
      items: [
        { prompt: '' },
        { prompt: 'ok', duration: 20, ratio: '21:9', count: 9, images: [{ path: 'D:/not-exists/x.png' }] },
      ],
    }),
  });
  assert.equal(result.errors.length, 5);
  assert.ok(result.errors.some((text) => /第 1 行 提示词为空/.test(text)));
  assert.ok(result.errors.some((text) => /时长必须是 1–15/.test(text)));
  assert.ok(result.errors.some((text) => /画幅只能是/.test(text)));
  assert.ok(result.errors.some((text) => /生成张数必须是 1–4/.test(text)));
  assert.ok(result.errors.some((text) => /第 2 行 参考图不存在/.test(text)));
});

test('Excel 模板：第一张表按固定表头解析，说明表不参与', () => {
  const result = taskImport.parseFile({ name: 'template.xlsx', data: taskImport.xlsxTemplate() });
  assert.equal(result.format, 'xlsx');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].title, '镜头 01');
  assert.equal(result.items[0].duration, 10);
  assert.equal(result.items[0].ratio, '16:9');
  assert.equal(result.items[0].count, 1);
  assert.deepEqual(result.items[0].images.map((image) => image.note), ['女主正面', '女主背影']);
  assert.equal(result.errors.length, 2);
});

test('Excel 自定义行：多张参考图用分号分隔，留空列使用默认值', () => {
  const imageA = tempImage('a.png');
  const imageB = tempImage('b.png');
  const xlsx = taskImport.buildXlsx([{
    name: '任务',
    rows: [
      taskImport.HEADERS,
      ['镜头 X', '雨夜街头，镜头推近', `${imageA};${imageB}`, '角色;首帧', '15', '4:3', '1080p横', '3'],
      ['镜头 Y', '清晨的咖啡馆', '', '', '', '', '', ''],
    ],
  }]);
  const result = taskImport.parseFile({ name: 'custom.xlsx', data: xlsx });
  assert.deepEqual(result.errors, []);
  const [first, second] = result.items;
  assert.equal(first.title, '镜头 X');
  assert.equal(first.images.length, 2);
  assert.equal(first.images[0].note, '角色');
  assert.equal(first.duration, 15);
  assert.equal(first.ratio, '4:3');
  assert.equal(first.resolution, '1080p横');
  assert.equal(first.count, 3);
  assert.equal(second.duration, null);
  assert.equal(second.ratio, null);
});

test('Excel 表头必须与模板一致', () => {
  const xlsx = taskImport.buildXlsx([{ name: '任务', rows: [['标题', '描述', '', '', '', '', '', ''], ['a', 'b', '', '', '', '', '', '']] }]);
  assert.throws(() => taskImport.parseFile({ name: 'bad.xlsx', data: xlsx }), /表头必须依次为/);
});

test('Excel 空表与空行处理', () => {
  const onlyHeader = taskImport.buildXlsx([{ name: '任务', rows: [taskImport.HEADERS] }]);
  assert.throws(() => taskImport.parseFile({ name: 'empty.xlsx', data: onlyHeader }), /只有表头/);
  const withBlank = taskImport.buildXlsx([{ name: '任务', rows: [taskImport.HEADERS, ['', '', '', '', '', '', '', ''], ['ok', '提示词', '', '', '', '', '', '']] }]);
  const result = taskImport.parseFile({ name: 'blank.xlsx', data: withBlank });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].line, 3);
});

test('只接受 .json 与 .xlsx', () => {
  assert.throws(() => taskImport.parseFile({ name: 'a.csv', data: Buffer.from('x') }), /只支持 \.json 或 \.xlsx/);
  assert.throws(() => taskImport.parseFile({ name: 'a.txt', data: Buffer.from('x') }), /只支持 \.json 或 \.xlsx/);
  assert.throws(() => taskImport.parseFile({ name: 'a.xlsx', data: Buffer.from('not a zip') }), /不是有效的 \.xlsx/);
});
