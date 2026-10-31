'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-jianying-'));
process.env.WMD_DATA_DIR = path.join(dir, 'data');
const local = path.join(dir, 'local');
const draftRoot = path.join(dir, 'drafts');
const indexDir = path.join(local, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
fs.mkdirSync(indexDir, { recursive: true });
fs.mkdirSync(draftRoot, { recursive: true });
const indexFile = path.join(indexDir, 'root_meta_info.json');
fs.writeFileSync(indexFile, JSON.stringify({
  all_draft_store: [{ draft_name: '旧草稿', draft_id: 'OLD', draft_root_path: draftRoot, tm_duration: 1 }],
}), 'utf8');
process.env.LOCALAPPDATA = local;
const jianying = require('../src/jianying');

test.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ } });

function box(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, payload]);
}

function u32(...values) {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buf.writeUInt32BE(value >>> 0, index * 4));
  return buf;
}

/** 造一个只有时长/画幅/音轨标记的 mp4，给探针用。 */
function fakeMp4(file, { seconds = 5, width = 1920, height = 1080 } = {}) {
  const mvhd = box('mvhd', Buffer.concat([u32(0, 0, 0, 1000, Math.round(seconds * 1000)), Buffer.alloc(80)]));
  const tkhdPayload = Buffer.alloc(84);
  tkhdPayload.writeUInt32BE(width * 65536, 76);
  tkhdPayload.writeUInt32BE(height * 65536, 80);
  const tkhd = box('tkhd', tkhdPayload);
  const hdlrPayload = Buffer.concat([u32(0, 0), Buffer.from('vide', 'ascii'), Buffer.alloc(12), Buffer.from('v\0', 'ascii')]);
  const mdia = box('mdia', box('hdlr', hdlrPayload));
  const moov = box('moov', Buffer.concat([mvhd, box('trak', Buffer.concat([tkhd, mdia]))]));
  const ftyp = box('ftyp', Buffer.from('isom0000isommp42', 'ascii'));
  fs.writeFileSync(file, Buffer.concat([ftyp, moov]));
  return file;
}

test('探针能读出时长与画幅', () => {
  const file = fakeMp4(path.join(dir, 'clip.mp4'), { seconds: 7.5, width: 1280, height: 720 });
  const info = jianying.probe(file, 'video');
  assert.equal(Math.round(info.duration * 10) / 10, 7.5);
  assert.equal(info.width, 1280);
  assert.equal(info.height, 720);
});

test('草稿目录能识别，草稿内容按镜头顺序排好', (t) => {
  if (jianying.isRunning()) return t.skip('剪映正在运行');
  const info = jianying.status();
  assert.equal(info.available, true);
  assert.equal(info.root, path.resolve(draftRoot));
  const a = fakeMp4(path.join(dir, 'a.mp4'), { seconds: 5 });
  const b = fakeMp4(path.join(dir, 'b.mp4'), { seconds: 4 });
  const result = jianying.createDrafts([{
    name: '我的同桌测试-第1集',
    clips: [{ path: a, name: 'a.mp4', kind: 'video' }, { path: b, name: 'b.mp4', kind: 'video' }],
  }]);
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].clips, 2);
  assert.equal(Math.round(result.created[0].duration), 9);
  const draftFile = path.join(result.created[0].dir, 'draft_content.json');
  const draft = JSON.parse(fs.readFileSync(draftFile, 'utf8'));
  assert.equal(draft.version, 360000);
  assert.equal(draft.tracks.length, 1);
  assert.equal(draft.tracks[0].type, 'video');
  assert.equal(draft.tracks[0].segments.length, 2);
  assert.equal(draft.duration, 9000000);
  assert.equal(draft.canvas_config.ratio, '16:9');
  assert.equal(draft.materials.videos.length, 2);
  assert.equal(draft.materials.videos[0].path, a);
  assert.equal(draft.tracks[0].segments[1].target_timerange.start, 5000000);
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  assert.equal(index.all_draft_store[0].draft_name, '我的同桌测试-第1集');
  assert.equal(index.all_draft_store[0].draft_root_path, path.resolve(draftRoot));
  assert.equal(index.all_draft_store.some((row) => row.draft_name === '旧草稿'), true);
});

test('同名草稿不会覆盖已有文件夹', (t) => {
  if (jianying.isRunning()) return t.skip('剪映正在运行');
  const file = fakeMp4(path.join(dir, 'c.mp4'), { seconds: 3 });
  const first = jianying.createDrafts([{ name: '重名测试', clips: [{ path: file, name: 'c.mp4', kind: 'video' }] }]);
  const second = jianying.createDrafts([{ name: '重名测试', clips: [{ path: file, name: 'c.mp4', kind: 'video' }] }]);
  assert.equal(path.basename(first.created[0].dir), '重名测试');
  assert.equal(path.basename(second.created[0].dir), '重名测试 (2)');
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  assert.equal(index.all_draft_store.filter((row) => row.draft_name.startsWith('重名测试')).length, 2);
});

test('没有剪映草稿目录时给出明确提示', () => {
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = path.join(dir, 'empty-local');
  try {
    assert.equal(jianying.status().available, false);
    assert.throws(() => jianying.createDrafts([{ name: 'x', clips: [{ path: 'x.mp4', name: 'x.mp4', kind: 'video' }] }]), /没有找到剪映草稿目录/);
  } finally {
    process.env.LOCALAPPDATA = previous;
  }
});
