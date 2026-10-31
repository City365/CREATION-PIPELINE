'use strict';
const test = require('node:test');
const assert = require('node:assert');
const seedance = require('../src/seedance');

// 白昼 v0.5 正文：不带任何隔离标记（一组镜）
const SAMPLE = `禁止生成字幕，禁止生成背景音乐
场景：旧街理发店｜内｜傍晚
角色：谢七、胡四
时间：傍晚
时长：15秒
物品：砍骨刀、木凳、磨石
音色锁定：谢七：青年男性，中低音区，音质干净清朗，咬字清晰利落，气息平稳；胡四：中年男性，中低音区偏厚，音质粗粝，咬字直硬，气息充沛。

人物锚点：谢七坐在酒肆檐下矮木凳上，面向街面，右手空置，身侧立着豁口木桶、深青磨石与缠着粗麻灰布的直刀；胡四站在他左侧半步远，右手提着厚背砍骨刀，脸朝向谢七。
场景锚点：【空间基准・破风酒肆檐下｜外｜日】檐下摆着矮木凳与磨刀摊，青石板路潮湿泛青，清晨屋檐断续滴水，环境声为滴水与街市远处的车马声。
剧情承接：开场：清晨谢七在檐下候活，屠户胡四砸下砍骨刀，谢七接刀寸寸查验刃口，截至谢七舀水浇石的定格状态。

SHOT 1: Wide shot, cut to Medium shot：清晨屋檐断续滴水，谢七静坐矮木凳；随后胡四阔步跨入视线，把砍骨刀重重拍在凳沿，木屑轻颤。
胡四（现场对白・偏快语速 / 粗豪使唤语气 / 句号后短停）：谢七，这把是剁骨头的。

SHOT 2: Medium close-up, cut to Close-up：谢七抬眼接过砍骨刀，拇指压上刃口自刀根慢推到刀尖。
谢七（现场对白・正常语速 / 冷淡笃定语气 / 逗号短停）：卷了三处，都在前三分。

SHOT 3: Close-up, static：谢七在裤腿上蹭去指腹油脂，舀半瓢清水泼在磨石上。
`;

test('格式规格文件：指向节拍稿 → 白昼正文，并明确不带隔离标记', () => {
  const spec = seedance.FORMAT_SPEC;
  for (const field of ['场景：', '角色：', '时间：', '时长：', '物品：', '音色锁定：', '人物锚点：', '场景锚点：', '剧情承接：']) {
    assert.ok(spec.includes(field), '缺少字段说明 ' + field);
  }
  assert.match(spec, /本组总时长/);
  assert.match(spec, /组内快切建议/);
  assert.match(spec, /SHOT 1:/);
  assert.match(spec, /现场对白・/);
  assert.match(spec, /不要/, '应明确写出不要隔离标记');
  assert.ok(spec.length > 3000, '规格过短，可能没读到 prompts/seedance-2.0.txt');
});

test('骨架 = 分镜节拍稿（不是白昼正文）', () => {
  const s = seedance.SKELETON;
  assert.match(s, /^本组总时长：15\.0s/);
  assert.match(s, /^背景：/m);
  assert.match(s, /^看点：/m);
  assert.match(s, /^场景1：/m);
  assert.match(s, /^Ⅰ、\[画面\] 时长4\.0秒（0字台词）。/m);
  assert.match(s, /组内快切建议：【节拍1｜0\.0-1\.8s/);
  assert.match(s, /^台词：/m);
  assert.ok(!s.includes('OUTPUT_START'), '骨架里不该出现输出标记');
  assert.ok(!s.includes('音色锁定'), '骨架是输入稿，不该含输出字段');
  // 时长自洽：4.0 + 4.5 + 6.5 = 15.0
  const total = [...s.matchAll(/时长(\d+(?:\.\d+)?)秒/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  assert.equal(total, 15);
});

test('detectDuration：读节拍稿的总时长，读不到就回退', () => {
  assert.equal(seedance.detectDuration('本组总时长：15.0s'), 15);
  assert.equal(seedance.detectDuration('本组总时长：12.0s'), 12);
  assert.equal(seedance.detectDuration('总时长：9s'), 9);
  assert.equal(seedance.detectDuration('时长：11秒'), 11);
  assert.equal(seedance.detectDuration('随便写点剧情', 8), 8);
  assert.equal(seedance.detectDuration('本组总时长：99s'), 15, '不得超过 15 秒');
});

test('buildSeedanceMessages：系统提示 + 组数/时长/素材白名单 + 不带标记要求', () => {
  const messages = seedance.buildSeedanceMessages({
    prompt: seedance.SKELETON,
    assets: [{ token: '<Picture 1>', kind: 'image', name: 'xieqi.png', subjectName: '谢七' }],
    subjects: [{ ordinal: 1, name: '谢七', tokens: ['<Picture 1>'] }],
    durationSeconds: 15,
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /白昼 v0\.5/);
  const user = messages[1].content;
  assert.match(user, /组数：1 组/);
  assert.match(user, /时长：15 秒/);
  assert.match(user, /本组总时长/);
  assert.match(user, /不要任何隔离标记/);
  assert.match(user, /<Picture 1>（图像｜xieqi\.png｜已命名主体「谢七」）/);
  assert.match(user, /用户原始内容\n本组总时长：15\.0s/);
});

test('buildSeedanceMessages：没有素材时不编造标签', () => {
  const user = seedance.buildSeedanceMessages({ prompt: '空镜，下雪。' })[1].content;
  assert.match(user, /本次没有参考素材/);
  assert.match(user, /时长：15 秒/);
});

test('normalizeSeedanceOutput：剥掉围栏、开场白与残留标记', () => {
  const raw = '好的，下面是优化结果：\n```\n*::~OUTPUT_START::~*\n' + SAMPLE.trim() + '\n*::~OUTPUT_END::~*\n```\n以上。';
  const out = seedance.normalizeSeedanceOutput(raw);
  assert.ok(out.startsWith('禁止生成字幕，禁止生成背景音乐'), out.slice(0, 40));
  assert.ok(!out.includes('OUTPUT_START'));
  assert.ok(!out.includes('OUTPUT_END'));
  assert.ok(!out.includes('```'));
  assert.ok(!out.includes('好的，下面是'));
  assert.ok(!out.includes('以上。'));
  assert.ok(out.trimEnd().endsWith('磨石上。'));
});

test('normalizeSeedanceOutput：收紧空行、标记独占行也能剥', () => {
  const raw = `${seedance.RECORD}\n${SAMPLE.split('\n\n')[0]}\n\n\n\n${SAMPLE.split('\n\n').slice(1).join('\n\n')}`;
  const out = seedance.normalizeSeedanceOutput(raw);
  assert.ok(!/\n{3,}/.test(out), '不应留下连续空行');
  assert.ok(!out.includes('RECORD'));
  assert.equal(out.endsWith('\n'), true);
});

test('validateSeedance：合格正文无告警', () => {
  const result = seedance.validateSeedance(SAMPLE, { duration: 15 });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.stats.records, 1);
  assert.equal(result.stats.shots, 3);
  assert.equal(result.stats.dialogue, 2);
});

test('validateSeedance：残留标记 / 缺字段 / 缺 SHOT / 无台词 / markdown 都报出来', () => {
  const bad = `*::~OUTPUT_START::~*
**角色：**谢七
人物锚点：站着。
SHOT 1: 特写
* 列表项
*::~OUTPUT_END::~*`;
  const { warnings } = seedance.validateSeedance(bad, { duration: 15 });
  assert.ok(warnings.some((w) => w.includes('隔离标记')), warnings.join('|'));
  assert.ok(warnings.some((w) => w.includes('缺「场景：」')));
  assert.ok(warnings.some((w) => w.includes('缺「剧情承接：」')));
  assert.ok(warnings.some((w) => w.includes('markdown')));
  assert.ok(warnings.some((w) => w.includes('台词行')));
});

test('validateSeedance：时长与参数不一致要报，多组时不误报', () => {
  const one = seedance.validateSeedance(SAMPLE, { duration: 12 });
  assert.ok(one.warnings.some((w) => w.includes('时长不一致')));

  const two = `${SAMPLE}\n\n${SAMPLE}`;
  const multi = seedance.validateSeedance(two, { duration: 15 });
  assert.equal(multi.stats.records, 2);
  assert.ok(!multi.warnings.some((w) => w.includes('时长不一致')));
});

test('validateSeedance：越界素材标签告警', () => {
  const text = SAMPLE.replace('人物锚点：', '人物锚点：<Picture 7> 与 ');
  const { warnings } = seedance.validateSeedance(text, { tokens: ['<Picture 1>'], duration: 15 });
  assert.ok(warnings.some((w) => w.includes('<Picture 7>')));
});

test('looksLikeSeedance：认出白昼正文与旧标记，不误伤 H3 六段式', () => {
  assert.equal(seedance.looksLikeSeedance(SAMPLE), true);
  assert.equal(seedance.looksLikeSeedance('*::~OUTPUT_START::~*\n正文'), true);
  assert.equal(seedance.looksLikeSeedance('subject_definitions:\n<Subject 1> is ...\nsummary:\n一句话'), false);
  assert.equal(seedance.looksLikeSeedance('本组总时长：15.0s\n背景：…'), false);
  assert.equal(seedance.looksLikeSeedance(''), false);
});

test('recordCountFor：默认一组，只有显式要求才多组', () => {
  assert.equal(seedance.recordCountFor('本组总时长：15.0s'), 1);
  assert.equal(seedance.recordCountFor(SAMPLE), 1);
  assert.equal(seedance.recordCountFor(SAMPLE, 3), 3);
});
