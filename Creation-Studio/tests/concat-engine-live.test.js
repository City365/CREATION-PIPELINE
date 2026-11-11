'use strict';
/**
 * 实时联通测试：真的起 concat-cli serve，走我们这层的中继，把一条剪辑链路跑通。
 *   create → import → addClip → move → undo → save → preview.frame
 *
 * 没有引擎二进制就跳过（别的机器上跑测试不该因为缺几十 MB 的 exe 而红）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const engine = require(path.join(ROOT, 'src', 'concat-engine.js'));

const SAMPLE = path.join(ROOT, 'web', 'skins', 'real-cafe.mp4');
const available = fs.existsSync(engine.CLI_EXE) && fs.existsSync(SAMPLE);

let workdir = '';
let projectPath = '';

test.after(async () => {
  if (projectPath) {
    try { await engine.call('project.close', { path: projectPath, save: false }); } catch (error) { /* ignore */ }
  }
  engine.stop();
  if (workdir) {
    try { fs.rmSync(workdir, { recursive: true, force: true }); } catch (error) { /* ignore */ }
  }
});

test('engine 模块能把 concat-cli serve 拉起来并握手', { skip: available ? false : '没有引擎二进制' }, async () => {
  const version = await engine.call('version', {});
  assert.equal(version.apiVersion, '0.2');
  assert.equal(version.concat, '0.2.10');
  assert.ok(version.capabilities.includes('json-rpc'));
  const status = engine.status();
  assert.ok(status.running);
  assert.ok(/^127\.0\.0\.1:\d+$/.test(status.addr), '端口应是从横幅读回来的真实端口：' + status.addr);
  assert.ok(status.restarts === 0);
});

test('一条剪辑链路：建工程 → 导入 → 加片段 → 移动 → 撤销 → 保存 → 出帧',
  { skip: available ? false : '没有引擎二进制' }, async () => {
    workdir = path.join(engine.ROOT, 'concat-live-' + crypto.randomBytes(4).toString('hex'));
    fs.mkdirSync(workdir, { recursive: true });

    const created = await engine.call('project.create', {
      location: workdir,
      name: 'live',
      video: { width: 640, height: 360, rateNum: 24, rateDen: 1 },
    });
    assert.ok(created && created.project, '建工程应回一份视图');

    // 工程目录名由引擎按名字取
    const folders = fs.readdirSync(workdir).filter((name) => fs.existsSync(path.join(workdir, name, 'concat.json')));
    assert.equal(folders.length, 1, '工程目录应有一个 concat.json');
    projectPath = path.join(workdir, folders[0]);

    await engine.call('media.import', { path: projectPath, file: SAMPLE });

    let doc = await engine.call('project.document', { path: projectPath });
    doc = doc.document || doc;
    assert.equal(doc.media.length, 1, '素材应在箱里');
    const mediaId = doc.media[0].id;
    const timeline = doc.timelines[0];
    const trackId = timeline.tracks[0].id;

    await engine.call('edit.apply', {
      path: projectPath,
      command: { op: 'addClip', mediaId, trackId, start: 0, ripple: false },
    });
    doc = await engine.call('project.document', { path: projectPath });
    doc = doc.document || doc;
    assert.equal(doc.timelines[0].clips.length, 1, '应多出一个片段');
    const clip = doc.timelines[0].clips[0];
    assert.equal(clip.start, 0);

    // 移到空位：引擎会真的挪
    await engine.call('edit.apply', {
      path: projectPath,
      command: { op: 'moveClips', moves: [{ clipId: clip.id, start: 5, trackId }] },
    });
    doc = await engine.call('project.document', { path: projectPath });
    doc = doc.document || doc;
    assert.equal(doc.timelines[0].clips[0].start, 5, '片段应移到 5 秒');

    // 撤销回 0，而且 canRedo 起来（前面还建过一个 addClip，所以 canUndo 仍为真）
    const view = await engine.call('edit.undo', { path: projectPath });
    assert.equal(view.canUndo, true);
    assert.equal(view.canRedo, true);
    doc = await engine.call('project.document', { path: projectPath });
    doc = doc.document || doc;
    assert.equal(doc.timelines[0].clips[0].start, 0, '撤销应回到 0 秒');

    // 保存真的落盘
    await engine.call('project.save', { path: projectPath });
    const savedAt = path.join(projectPath, 'concat.json');
    assert.ok(fs.existsSync(savedAt));
    const saved = JSON.parse(fs.readFileSync(savedAt, 'utf8'));
    assert.equal(saved.timelines[0].clips.length, 1);

    // 一帧预览：引擎回内联 base64 PNG
    const shot = await engine.call('preview.frame', { path: projectPath, time: 0.2, width: 160, height: 90 }, { lane: 'frame' });
    assert.ok(shot && typeof shot.png === 'string' && shot.png.length > 100, '应拿到内联 PNG');
    const png = Buffer.from(shot.png, 'base64');
    assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG 魔数');
  });

test('引擎的错误原样透出（不做二次包装）', { skip: available ? false : '没有引擎二进制' }, async () => {
  await assert.rejects(
    () => engine.call('edit.apply', { path: projectPath, command: { op: 'moveClipz', moves: [] } }),
    (error) => {
      assert.ok(error.message, '应有引擎给的说明');
      assert.ok(/unknown variant|expected one of/i.test(error.message), '应是引擎自己的措辞：' + error.message);
      return true;
    }
  );
});

test('callMany 逐条回执，一条失败不影响其它条', { skip: available ? false : '没有引擎二进制' }, async () => {
  const rows = await engine.callMany([
    { id: 'a', method: 'version' },
    { id: 'b', method: 'project.get', params: { path: projectPath } },
    { id: 'c', method: 'project.open', params: { path: 'Z:\\definitely-not-here' } },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[1].ok, true);
  assert.equal(rows[2].ok, false);
  assert.ok(rows[2].error.message);
});

test('placing.js 算出来的落点，引擎一定接（不会因为重叠被静默吞掉）',
  { skip: available ? false : '没有引擎二进制' }, async () => {
    const PL = require(path.join(ROOT, 'web', 'concat', 'placing.js'));
    const readDoc = async () => {
      const raw = await engine.call('project.document', { path: projectPath });
      return raw.document || raw;
    };

    let doc = await readDoc();
    const timeline = doc.timelines[0];
    const trackId = timeline.tracks[0].id;
    const first = timeline.clips[0];
    const fps = timeline.video.rateNum / timeline.video.rateDen;

    // 先切开，拿到两个片段，才有「重叠」可言
    await engine.call('edit.apply', {
      path: projectPath,
      command: { op: 'splitClips', clipIds: [first.id], time: first.start + 2 },
    });
    doc = await readDoc();
    assert.equal(doc.timelines[0].clips.length, 2, '切开后应有两个片段');

    const clips = doc.timelines[0].clips.slice().sort((a, b) => a.start - b.start);
    const head = clips[0];
    let tail = clips[1];

    // ① 先挪到空位：引擎照单接受
    const free = PL.resolveMove({
      clips,
      moving: [{ id: tail.id, start: tail.start, duration: tail.duration, trackId }],
      deltaTime: 10 - tail.start,
      trackId,
      fps,
      playhead: 0,
      snapThreshold: 0,
    });
    await engine.call('edit.apply', { path: projectPath, command: { op: 'moveClips', moves: free } });
    doc = await readDoc();
    tail = doc.timelines[0].clips.find((clip) => clip.id === tail.id);
    assert.ok(Math.abs(tail.start - free[0].start) < 1e-6, '空位移动应精确落地');

    // ② 再往头部身上拖：引擎自己会静默 no-op，placing 先把它挪到合法位置
    const collide = PL.resolveMove({
      clips: doc.timelines[0].clips,
      moving: [{ id: tail.id, start: tail.start, duration: tail.duration, trackId }],
      deltaTime: head.start + 0.5 - tail.start,
      trackId,
      fps,
      playhead: 0,
      snapThreshold: 0.05,
    });
    const planned = collide[0].start;
    assert.ok(Math.abs(planned - tail.start) > 1e-6, 'placing 应该给出一个不同的落点，实际 ' + planned);
    for (const other of [head]) {
      assert.equal(
        PL.overlaps(planned, planned + tail.duration, other.start, other.start + other.duration),
        false,
        'placing 给的落点压到了 ' + other.id
      );
    }
    await engine.call('edit.apply', { path: projectPath, command: { op: 'moveClips', moves: collide } });
    doc = await readDoc();
    const landed = doc.timelines[0].clips.find((clip) => clip.id === tail.id);
    assert.ok(Math.abs(landed.start - planned) < 1e-6, '引擎应落在 placing 算的位置：' + landed.start + ' vs ' + planned);

    // ③ 拖边：夹紧后的 delta 引擎照单接受
    const delta = PL.clampTrim({
      clip: landed, clips: doc.timelines[0].clips, edge: 'end', delta: -1, fps,
    });
    await engine.call('edit.apply', {
      path: projectPath,
      command: { op: 'trimClip', clipId: landed.id, edge: 'end', delta, ripple: false },
    });
    doc = await readDoc();
    const trimmed = doc.timelines[0].clips.find((clip) => clip.id === landed.id);
    assert.ok(trimmed.duration < landed.duration, '拖尾应该变短：' + trimmed.duration);
    assert.ok(Math.abs(trimmed.duration - (landed.duration + delta)) < 1e-6);

    // ④ 往回撤销：切开的那个点撤掉后，时间线应该只剩一个片段
    let view = await engine.call('project.get', { path: projectPath });
    let guard = 0;
    doc = await readDoc();
    while (doc.timelines[0].clips.length > 1 && view.canUndo && guard < 10) {
      view = await engine.call('edit.undo', { path: projectPath });
      doc = await readDoc();
      guard += 1;
    }
    assert.equal(doc.timelines[0].clips.length, 1, '撤到切开之前应只剩一个片段');
    assert.equal(view.canRedo, true, '撤销之后应该还能重做');
  });
