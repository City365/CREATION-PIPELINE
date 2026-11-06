'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMockCloud, PNG } = require('./mock-cloud');

// 注意：node --test 会并行跑测试文件，端口不能和别的用例撞车（曾经 PORT+1 正好撞上
// image-e2e 的 18926，结果请求打到别人的服务上，登录态一开就全是 401）
const PORT = 18935;
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await sleep(300);
  }
}

test('Seedance 2.0 优化：节拍稿 → 白昼正文，无隔离标记', { timeout: 60000 }, async () => {
  const PORT2 = PORT + 1;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-sd-'));
  const mock = await startMockCloud();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, APPDATA: path.join(tmp, 'appdata'), WMD_PORT: String(PORT2), WMD_DATA_DIR: path.join(tmp, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${PORT2}`;
  try {
    await waitFor(async () => (await fetch(base + '/api/health')).ok, 15000);
    await fetch(base + '/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saveFolder: path.join(tmp, 'media'), assetFolder: path.join(tmp, 'assets') }),
    });
    const ch = await fetch(base + '/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'llm', type: 'openai-chat', name: 'mock llm', baseUrl: mock.url + '/v1', apiKey: 'test-key', model: 'mock-model', active: true }),
    }).then((r) => r.json());
    assert.ok(ch.ok, JSON.stringify(ch));

    const beatSheet = [
      '本组总时长：15.0s',
      '背景：清晨柳溪镇，谢七坐在酒肆檐下矮凳上，身旁立着木桶、磨石与缠满灰布的长刀；胡四执砍骨刀快步走近。',
      '看点：屠户胡四将砍骨刀拍在矮凳上，谢七冷漠接刀并寸寸查验刃口损伤。',
      '场景1：破风酒肆檐下｜外｜日',
      '',
      'Ⅰ、[画面] 时长4.0秒（0字台词）。',
      '画面：清晨屋檐断续滴水，青石板路潮湿泛青。',
      '组内快切建议：【节拍1｜0.0-1.8s｜檐下滴水全景】→【节拍2｜1.8-4.0s｜砍骨刀拍在矮凳上】',
      '',
      'Ⅱ、[画面] 时长11.0秒（11字台词）。',
      '画面：胡四俯身按刀，谢七抬眼接刀。',
      '组内快切建议：【节拍1｜0.0-2.0s｜胡四说话】→【节拍2｜2.0-11.0s｜谢七接刀】',
      '台词：胡四（现场对白）：谢七，这把是剁骨头的。',
    ].join('\n');

    const res = await fetch(base + '/api/optimize/seedance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: beatSheet, duration: 10 }),
    }).then((r) => r.json());
    assert.ok(res.ok, JSON.stringify(res));
    const text = res.data.prompt;
    assert.equal(res.data.format, 'seedance');
    assert.equal(res.data.records, 1);
    assert.equal(res.data.duration, 15, '时长应取节拍稿的本组总时长');
    assert.ok(!text.includes('*::~'), '不该带隔离标记：' + text.slice(0, 60));
    assert.ok(!text.includes('```'));
    assert.ok(!text.includes('好的，下面是'), '开场白没清掉');
    assert.ok(!text.includes('以上。'), '尾巴没清掉');
    assert.ok(text.startsWith('禁止生成字幕，禁止生成背景音乐'), text.slice(0, 60));
    assert.match(text, /音色锁定：/);
    assert.match(text, /^SHOT 1: /m);
    assert.match(text, /^时长：15秒$/m);
    assert.deepEqual(res.data.warnings, [], JSON.stringify(res.data.warnings));
    assert.equal(res.data.stats.records, 1);
    assert.equal(res.data.stats.shots, 2);
    assert.equal(res.data.stats.dialogue, 2);

    const system = mock.state.chatRequests[0].messages.find((m) => m.role === 'system').content;
    assert.match(system, /白昼 v0\.5/);
    const user = mock.state.chatRequests[0].messages.find((m) => m.role === 'user').content;
    assert.match(String(user), /组数：1 组/);
    assert.match(String(user), /时长：15 秒/);
    assert.match(String(user), /不要任何隔离标记/);
    assert.match(String(user), /用户原始内容\n本组总时长：15\.0s/);

    // 同一段正文回到校验接口，走 Seedance 校验而不是六段式
    const v = await fetch(base + '/api/prompt/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, duration: 15 }),
    }).then((r) => r.json());
    assert.ok(v.ok, JSON.stringify(v));
    assert.deepEqual(v.data.warnings, [], JSON.stringify(v.data.warnings));
    assert.equal(v.data.stats.records, 1);

    // 骨架：H3 六段式 + Seedance 节拍稿两套都在
    const promptMeta = await fetch(base + '/api/prompt').then((r) => r.json());
    assert.match(promptMeta.data.skeleton, /^subject_definitions:/);
    assert.match(promptMeta.data.seedance.skeleton, /^本组总时长：15\.0s/);
    assert.match(promptMeta.data.seedance.skeleton, /组内快切建议/);
    assert.ok(!promptMeta.data.seedance.skeleton.includes('OUTPUT_START'));
  } finally {
    child.kill();
    mock.server.close();
    await sleep(300);
  }
});

test('Skill 优化：提示词注入 → 模型 JSON → 六段输出', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-opt-'));
  const mock = await startMockCloud();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, APPDATA: path.join(tmp, 'appdata'), WMD_PORT: String(PORT), WMD_DATA_DIR: path.join(tmp, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${PORT}`;
  try {
    await waitFor(async () => (await fetch(base + '/api/health')).ok, 15000);
    const cfg = await fetch(base + '/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saveFolder: path.join(tmp, 'media'), assetFolder: path.join(tmp, 'assets') }),
    }).then((r) => r.json());
    assert.ok(cfg.ok, JSON.stringify(cfg));
    const ch = await fetch(base + '/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'llm', type: 'openai-chat', name: 'mock llm', baseUrl: mock.url + '/v1', apiKey: 'test-key', model: 'mock-model', active: true }),
    }).then((r) => r.json());
    assert.ok(ch.ok, JSON.stringify(ch));

    const res = await fetch(base + '/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '十秒，武僧在湖边对少女说话。',
        duration: 10,
        assets: [{ token: '<Picture 1>', kind: 'image', name: 'wuseng.png', subjectName: '武僧', path: path.join(tmp, 'assets', 'wuseng.png') }],
        subjects: [{ ordinal: 1, name: '武僧', tokens: ['<Picture 1>'] }],
      }),
    }).then((r) => r.json());
    assert.ok(res.ok, JSON.stringify(res));
    assert.match(res.data.prompt, /^subject_definitions:/);
    const sections = res.data.prompt.split(/\n\n/).filter((b) => /^[a-z_]+:/.test(b));
    assert.equal(sections.length, 6);
    assert.ok(Array.isArray(res.data.warnings));
    assert.equal(res.data.model, 'mock-model');

    const request = mock.state.chatRequests[0];
    assert.ok(request, '没有发出模型请求');
    assert.equal(request.model, 'mock-model');
    const system = request.messages.find((m) => m.role === 'system').content;
    assert.match(system, /MiniMax H3/);
    assert.match(system, /六段/);
    const user = request.messages.find((m) => m.role === 'user').content;
    assert.match(String(user), /<Picture 1>/);
    assert.match(String(user), /武僧/);
    assert.match(String(user), /目标时长: 10 秒/);
  } finally {
    child.kill();
    mock.server.close();
    await sleep(300);
  }
});


