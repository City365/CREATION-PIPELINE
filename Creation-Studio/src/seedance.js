'use strict';
/**
 * Seedance 2.0（白昼 v0.5）分镜提示词：
 *   输入 = 一组镜的分镜节拍稿（本组总时长 / 背景 / 看点 / 场景1 / Ⅰ、Ⅱ、Ⅲ 节拍与台词）
 *   输出 = 白昼 v0.5 的 SHOT 正文，不带任何隔离标记（一次只交一组）
 * 与 prompts.js 的 H3 六段式互不影响：同一套语言渠道，两套契约。
 */
const fs = require('node:fs');
const path = require('node:path');

// 旧版包装标记：只用于把模型多吐出来的符号剥掉，不再写进输出。
const START = '*::~OUTPUT_START::~*';
const END = '*::~OUTPUT_END::~*';
const RECORD = '*::~RECORD::~*';

const FORMAT_SPEC = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'seedance-2.0.txt'), 'utf8');

/** 输入骨架：一组镜的分镜节拍稿，占位符留给人来填。 */
const SKELETON = `本组总时长：15.0s
背景：<地点 + 时间 + 在场角色各自在做什么 + 关键道具，一段话写完>
看点：<这一组最抓人的戏剧动作，一句话>
场景1：<地点>｜<内/外>｜<时间>

Ⅰ、[画面] 时长4.0秒（0字台词）。
画面：<这一段发生什么，含光线、道具、动作细节>
组内快切建议：【节拍1｜0.0-1.8s｜<镜头内容>】→【节拍2｜1.8-4.0s｜<镜头内容>】

Ⅱ、[画面] 时长4.5秒（11字台词）。
画面：<画面与动作>
组内快切建议：【节拍1｜0.0-2.0s｜<镜头内容>】→【节拍2｜2.0-4.5s｜<镜头内容；声音：现场对白余音>】
台词：<角色>（现场对白）：<台词>

Ⅲ、[画面] 时长6.5秒（18字台词）。
画面：<画面与动作>
组内快切建议：【节拍1｜0.0-3.5s｜<镜头内容>】→【节拍2｜3.5-6.5s｜<镜头内容>】
台词：<角色>（现场对白）：<台词>
台词：<角色>（现场对白）：<台词>`;

const HEADER_FIELDS = ['场景', '角色', '时间', '时长', '物品', '音色锁定'];
const ANCHOR_FIELDS = ['人物锚点', '场景锚点', '剧情承接'];
const MARKERS = [START, END, RECORD];

function normText(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
}

function escRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 判断一段文本是不是 Seedance 白昼格式（用于跳过 H3 六段式校验）。 */
function looksLikeSeedance(text) {
  const value = normText(text);
  if (!value) return false;
  if (MARKERS.some((m) => value.includes(m))) return true;
  if (!/^SHOT\s*\d+\s*[:：]/m.test(value)) return false;
  return /剧情承接\s*[:：]/.test(value) || /音色锁定\s*[:：]/.test(value);
}

/** 从节拍稿里读「本组总时长：15.0s」，读不到再退回调用方给的时长。 */
function detectDuration(text, fallback = 15) {
  const value = normText(text);
  const patterns = [
    /本组总时长\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?/i,
    /总时长\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?/i,
    /^时长\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?/im,
  ];
  for (const re of patterns) {
    const m = value.match(re);
    if (m) {
      const n = Math.round(Number(m[1]));
      if (n > 0) return Math.max(1, Math.min(15, n));
    }
  }
  return Math.max(1, Math.min(15, Number(fallback) || 15));
}

/** 一组镜：只有显式要求多组时才出多组。 */
function recordCountFor(_prompt, requested) {
  const n = Number(requested);
  if (Number.isFinite(n) && n > 0) return Math.min(40, Math.max(1, Math.round(n)));
  return 1;
}

function buildSeedanceMessages(ctx = {}) {
  const {
    prompt,
    assets = [],
    subjects = [],
    durationSeconds = 15,
    maxDurationSeconds = 15,
    records = 1,
  } = ctx;
  const groups = Math.max(1, Math.min(40, Number(records) || 1));
  const duration = Math.max(1, Math.min(15, Number(durationSeconds) || 15));
  const assetLines = assets.length
    ? assets.map((a) => `- ${a.token}（${a.kind === 'audio' ? '音频' : '图像'}｜${a.name || '未命名文件'}${a.subjectName ? '｜已命名主体「' + a.subjectName + '」' : ''}）`).join('\n')
    : '（本次没有参考素材，整行省略「参考：」）';
  const subjectLines = subjects.length
    ? subjects.map((s) => `- <Subject ${s.ordinal}> = 「${s.name}」，来自 ${s.tokens.join('、')}`).join('\n')
    : '（本次没有已命名主体）';
  const user = [
    '# 交付任务',
    `- 组数：${groups} 组${groups > 1 ? '（每组独立成段、中间空一行即可，剧情首尾咬合）' : '（只输出一组镜）'}`,
    `- 时长：${duration} 秒；「时长：」字段写 ${duration}秒，与输入「本组总时长」对齐，不得超过 ${maxDurationSeconds} 秒`,
    '- 输出语言：全部中文（景别与运镜保持英文）',
    '- 输出正文：不要任何隔离标记（*::~OUTPUT_START::~*、*::~RECORD::~*、*::~OUTPUT_END::~* 都不要）',
    '',
    '# 输入形态提示',
    '- 输入通常是一组分镜节拍稿：本组总时长 / 背景 / 看点 / 场景1 / Ⅰ、Ⅱ、Ⅲ 段（画面 + 组内快切建议 + 台词）。',
    '- 每个「节拍」写成一个 SHOT；台词挂到对应 SHOT 下面；背景与看点写进三个锚点。',
    '',
    '# 参考素材（白名单：只能用这些标签，不得新增或改号）',
    assetLines,
    '',
    '# 主体编号（严格使用，不得重新分配）',
    subjectLines,
    '',
    '# 用户原始内容',
    normText(prompt),
    '',
    '# 输出前自检',
    '1) 直接从「禁止生成字幕，禁止生成背景音乐」开始，最后一行是镜头或台词，不带任何标记；',
    '2) 头部 6 个字段（场景/角色/时间/时长/物品/音色锁定）齐全，顺序固定；',
    '3) 三个锚点段落（人物锚点/场景锚点/剧情承接）齐全，且与本组第一帧一致；',
    '4) 每个 SHOT 用英文景别开头，有台词的镜头紧跟台词行，没有声音的镜头不写台词行；',
    '5) 全角中文标点，无 markdown、无 emoji、无解释文字。',
  ].join('\n');
  return [
    { role: 'system', content: FORMAT_SPEC },
    { role: 'user', content: user },
  ];
}

const FIELD_RE = /^(禁止生成|场景|角色|时间|时长|物品|音色锁定|参考|人物锚点|场景锚点|剧情承接)\s*[:：]/;

/** 这一行是不是正文（字段 / SHOT / 台词 / 段落编号），用来识别开场白与尾部废话。 */
function isContentLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (FIELD_RE.test(t)) return true;
  if (/^SHOT\s*\d+\s*[:：]/.test(t)) return true;
  if (/（现场对白・|OS内心独白\s*[:：]/.test(t)) return true;
  if (/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/.test(t)) return true;
  return false;
}

/**
 * 把模型输出收敛成干净的白昼正文：
 * 剥掉围栏、开场白与任何残留的隔离标记；一次只留一组。
 */
function normalizeSeedanceOutput(raw) {  let text = normText(raw);
  if (!text) throw new Error('模型返回为空');
  text = text.replace(/^[ \t]*```[a-zA-Z]*[ \t]*$/gm, '').replace(/```[a-zA-Z]*/g, '').trim();

  // 残留标记（旧模板 / 模型自己加的）一律去掉，只保留正文。
  for (const marker of MARKERS) {
    text = text.split(marker).join('\n');
  }

  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));

  // 丢掉「好的，以下是…」这类开场白：从第一条真正的字段行起算。
  const first = lines.findIndex((line) => /^\s*(禁止生成|场景\s*[:：]|人物锚点\s*[:：]|SHOT\s*1\s*[:：])/.test(line));
  const body = first > 0 ? lines.slice(first) : lines;

  // 收尾：去掉结尾的空行与孤立的说明句。
  const compact = [];
  for (const line of body) {
    if (line === '' && compact[compact.length - 1] === '') continue;
    compact.push(line);
  }
  while (compact.length && compact[compact.length - 1] === '') compact.pop();
  // 尾巴上的「以上。」「希望对你有帮助」这类废话：不是字段、不是 SHOT、不是台词就删。
  while (compact.length) {
    const last = compact[compact.length - 1];
    if (isContentLine(last)) break;
    if (last.trim().length > 30) break;
    compact.pop();
    while (compact.length && compact[compact.length - 1] === '') compact.pop();
  }

  const result = compact.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!result) throw new Error('模型返回为空');
  return result + '\n';
}

function splitRecords(text) {
  const value = normText(text);
  const body = value
    .split(new RegExp(`^\\s*${escRe(RECORD)}\\s*$`, 'm'))
    .join('\n')
    .replace(new RegExp(`^\\s*${escRe(START)}\\s*$`, 'gm'), '')
    .replace(new RegExp(`^\\s*${escRe(END)}\\s*$`, 'gm'), '');
  return body
    .split(/\n{2,}(?=禁止生成|场景\s*[:：])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function validateSeedance(text, ctx = {}) {
  const value = normText(text);
  const warnings = [];
  if (!value) return { warnings: ['提示词为空'], stats: { records: 0, shots: 0, dialogue: 0 } };
  const records = splitRecords(value);
  const allowed = new Set((ctx.tokens || []).filter(Boolean));
  const duration = Number(ctx.duration) || 0;

  const leftovers = MARKERS.filter((m) => value.includes(m));
  if (leftovers.length) warnings.push('不要带隔离标记：' + leftovers.join('、'));
  if (!records.length) warnings.push('没有可识别的正文');

  let shots = 0;
  let dialogue = 0;
  const missingFields = new Set();
  const badDuration = [];
  records.forEach((record, index) => {
    const label = records.length > 1 ? `第 ${index + 1} 组` : '正文';
    for (const field of HEADER_FIELDS) {
      if (!new RegExp(`^${field}\\s*[:：]`, 'm').test(record)) missingFields.add(`${label}缺「${field}：」`);
    }
    for (const field of ANCHOR_FIELDS) {
      if (!new RegExp(`^${field}\\s*[:：]`, 'm').test(record)) missingFields.add(`${label}缺「${field}：」`);
    }
    const shotLines = record.match(/^SHOT\s*\d+\s*[:：]/gm) || [];
    shots += shotLines.length;
    if (!shotLines.length) warnings.push(`${label}没有 SHOT 分镜行`);
    dialogue += (record.match(/^.+?（现场对白・.+?）：/gm) || []).length
      + (record.match(/^.+?OS内心独白：/gm) || []).length;
    const dur = record.match(/^时长\s*[:：]\s*(\d+)\s*秒/m);
    if (dur && duration && Number(dur[1]) !== duration) {
      badDuration.push(`${label}写 ${dur[1]} 秒（本组 ${duration} 秒）`);
    }
  });
  if (missingFields.size) warnings.push(...[...missingFields].slice(0, 8));

  const unknown = new Set();
  for (const m of value.matchAll(/<(Picture|Video|Audio|Subject)\s+(\d+)>/g)) {
    const token = `<${m[1]} ${m[2]}>`;
    if (allowed.has(token)) continue;
    if (m[1] === 'Subject' && (ctx.subjects || []).some((s) => Number(s.ordinal) === Number(m[2]))) continue;
    unknown.add(token);
  }
  if (unknown.size) warnings.push('引用了不存在的素材标签：' + [...unknown].join('、'));
  if (badDuration.length) warnings.push('时长不一致：' + badDuration.join('、'));
  if (/```|^\s*#|^\s*[-*]\s+/m.test(value)) warnings.push('混入了 markdown 标记（围栏 / 标题 / 列表）');
  if (!dialogue) warnings.push('全篇没有台词行（现场对白或 OS 独白）');

  return { warnings, stats: { records: records.length, shots, dialogue } };
}

module.exports = {
  START,
  END,
  RECORD,
  MARKERS,
  FORMAT_SPEC,
  SKELETON,
  HEADER_FIELDS,
  ANCHOR_FIELDS,
  looksLikeSeedance,
  detectDuration,
  recordCountFor,
  buildSeedanceMessages,
  normalizeSeedanceOutput,
  validateSeedance,
  splitRecords,
};
