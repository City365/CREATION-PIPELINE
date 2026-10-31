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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-import-'));
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

test('JSON 固定结构：分镜名称、视频提示词、参考图顺序、画幅、时长', () => {
  const image = tempImage('ref.png');
  const result = taskImport.parseFile({
    name: 'tasks.json',
    data: jsonBuffer({
      items: [{
        title: '镜头 A',
        prompt: '一只猫在窗台看雨',
        prefixPrompt: '冷色调',
        images: [{ path: image, note: '女主正面' }, image],
        duration: 12,
        ratio: '9:16',
      }],
    }),
  });
  assert.deepEqual(result.errors, []);
  const item = result.items[0];
  assert.equal(item.title, '镜头 A');
  assert.equal(item.prompt, '一只猫在窗台看雨');
  assert.equal(item.prefixPrompt, '冷色调');
  assert.equal(item.duration, 12);
  assert.equal(item.ratio, '9:16');
  assert.equal(item.images.length, 2);
  assert.equal(item.images[0].note, '女主正面');
  assert.equal(item.images[1].name, 'ref.png');
  assert.equal(item.images[0].exists, true);
  assert.equal('resolution' in item, false);
  assert.equal('count' in item, false);
  assert.equal('audios' in item, false);
  assert.equal(result.stats.images, 2);
});

test('JSON 兼容 tasks 数组；一行一条的文本和缺数组的结构仍拒绝', () => {
  assert.throws(() => taskImport.parseFile({ name: 'tasks.json', data: Buffer.from('第一行提示词\n第二行提示词') }), /JSON 解析失败/);
  const legacy = taskImport.parseFile({ name: 'tasks.json', data: jsonBuffer({ tasks: [{ prompt: 'a' }] }) });
  assert.equal(legacy.items.length, 1);
  assert.match(legacy.warnings.join(' '), /tasks 数组/);
  assert.throws(() => taskImport.parseFile({ name: 'tasks.json', data: jsonBuffer({ list: [] }) }), /缺少 items 数组/);
  assert.throws(() => taskImport.parseFile({ name: 'tasks.json', data: jsonBuffer({ items: [] }) }), /items 数组是空的/);
});

test('JSON 结构校验：空提示词、非法时长 / 画幅、参考图缺失', () => {
  const result = taskImport.parseFile({
    name: 'bad.json',
    data: jsonBuffer({
      items: [
        { prompt: '' },
        { prompt: 'ok', duration: 20, ratio: '21:9', images: [{ path: 'D:/not-exists/x.png' }] },
      ],
    }),
  });
  assert.equal(result.errors.length, 4);
  assert.ok(result.errors.some((text) => /第 1 行 提示词为空/.test(text)));
  assert.ok(result.errors.some((text) => /时长必须是 1–15/.test(text)));
  assert.ok(result.errors.some((text) => /画幅只能是/.test(text)));
  assert.ok(result.errors.some((text) => /第 2 行 参考图不存在/.test(text)));
});

test('Excel 模板：第一张表按固定表头解析，说明表不参与', () => {
  const result = taskImport.parseFile({ name: 'template.xlsx', data: taskImport.xlsxTemplate() });
  assert.equal(result.format, 'xlsx');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].title, '镜头 01');
  assert.equal(result.items[0].duration, 10);
  assert.equal(result.items[0].ratio, '16:9');
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
      ['镜头 X', '雨夜街头，镜头推近', `${imageA};${imageB}`, '角色;首帧', '4:3', '15'],
      ['镜头 Y', '清晨的咖啡馆', '', '', '', ''],
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
  assert.equal(second.duration, null);
  assert.equal(second.ratio, null);
});

test('Excel 按列名识别，缺提示词列才报错，多余列会保留', () => {
  const missing = taskImport.buildXlsx([{ name: '任务', rows: [['分镜名称', '说明'], ['a', 'b']] }]);
  assert.throws(() => taskImport.parseFile({ name: 'bad.xlsx', data: missing }), /表头缺少「提示词」/);
  const tempAudio = tempImage('voice.mp3');
  const xlsx = taskImport.buildXlsx([{ name: '任务', rows: [
    ['视频提示词', '分镜名称', '视频画幅', '参考音频路径', '参考音频说明', '景别'],
    ['雨夜街头', '镜头 01', '16:9', tempAudio, '女主音色', '中景'],
  ] }]);
  const result = taskImport.parseFile({ name: 'extra.xlsx', data: xlsx });
  assert.deepEqual(result.errors, []);
  assert.equal(result.items[0].title, '镜头 01');
  assert.equal(result.items[0].ratio, '16:9');
  assert.equal('audios' in result.items[0], false);
  assert.deepEqual(result.items[0].extra, { 景别: '中景' });
  assert.match(result.warnings.join(' '), /已忽略字段：参考音频路径/);
  assert.match(result.warnings.join(' '), /未识别.*景别|景别.*保留/);
});

test('Excel 空表与空行处理', () => {
  const onlyHeader = taskImport.buildXlsx([{ name: '任务', rows: [taskImport.HEADERS] }]);
  assert.throws(() => taskImport.parseFile({ name: 'empty.xlsx', data: onlyHeader }), /只有表头/);
  const withBlank = taskImport.buildXlsx([{ name: '任务', rows: [taskImport.HEADERS, ['', '', '', '', '', ''], ['ok', '提示词', '', '', '', '']] }]);
  const result = taskImport.parseFile({ name: 'blank.xlsx', data: withBlank });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].line, 3);
});

test('只接受 .json 与 .xlsx', () => {
  assert.throws(() => taskImport.parseFile({ name: 'a.csv', data: Buffer.from('x') }), /只支持 \.json 或 \.xlsx/);
  assert.throws(() => taskImport.parseFile({ name: 'a.txt', data: Buffer.from('x') }), /只支持 \.json 或 \.xlsx/);
  assert.throws(() => taskImport.parseFile({ name: 'a.xlsx', data: Buffer.from('not a zip') }), /不是有效的 \.xlsx/);
});
