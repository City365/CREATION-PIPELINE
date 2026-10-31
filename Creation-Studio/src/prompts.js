'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SECTION_KEYS = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'];
const SECTION_LABEL = {
  subject_definitions: '主体定义',
  summary: '摘要',
  retention_analysis: '保留分析',
  detailed_description: '详细描述',
  overall_soundscape: '环境音',
  non_diegetic_music: '非剧情配乐',
};

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'wmd-system.txt'), 'utf8');
const EXTRA_RULES = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'wmd-extra.txt'), 'utf8');

const SKELETON = `subject_definitions:
<Subject 1> is the <角色/场景> from <Picture 1>, serving as the <主角/配角/场景>, with <发型、五官、服装、配饰等跟随特征>.
<Subject 2> is the <角色/场景> from <Picture 2>, serving as the <配角/场景>, with <跟随特征>.

summary:
[reference generation] <一句话概括这十秒里发生了什么，人物关系与情绪走向>

retention_analysis:
<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - <哪些特征必须保持，哪些允许变化>
<Subject 2> (appears in [Shot 2]): fully_preserved - <同上>

detailed_description:
<画质、色调、镜头语言的整体风格句>
[Shot 1] <景别与运镜> of <Subject N>: <画面内容、动作、环境、光线>。
[Shot 2] At 00:04.000, cut to <景别>. <画面内容>。<Subject 1> (S1) says, <d>[Chinese] <台词></d>.

overall_soundscape:
<环境音、脚步声、布料摩擦、风声等物理声>

non_diegetic_music:
<只有观众能听到的配乐；没有就写 N/A>`;

const EXAMPLES = [
  {
    title: '示例 · 湖畔相遇（竖屏 10 秒，2 图 2 音频）',
    text: `subject_definitions:
<Subject 1> is the warrior monk from <Picture 1>, serving as the protagonist, with long wild black hair tied in a topknot under a small golden crown, a red mark on the forehead, a full beard, ornate gold-trimmed shoulder armor and bracers over an open dark robe, and a long necklace of large black prayer beads.
<Subject 2> is the young woman from <Picture 2>, serving as the second lead, with long wavy dark-brown hair, a pale-yellow fitted long-sleeve top, brown leggings, white striped socks and white sneakers.

summary:
[reference generation] A ten-second cinematic fantasy encounter: the warrior monk descends in a swirl of silk and golden sparks beside the summer lake where the young woman is standing, and the two exchange a short, surprised dialogue.

retention_analysis:
<Subject 1> (appears in [Shot 2], [Shot 3]): fully_preserved - crown, beard, armor and prayer beads are retained; only pose and expression change.
<Subject 2> (appears in [Shot 1], [Shot 3]): fully_preserved - hair, outfit, socks and sneakers are retained; only pose and expression change.

detailed_description:
Cinematic high-detail fantasy drama with warm summer daylight, a soft blue sky and drifting golden particles.
[Shot 1] A wide shot of the lake bank: <Subject 2> stands among purple wildflowers and glances over her shoulder as silver-gold silk ribbons spiral down from the sky. The camera slowly pushes in.
[Shot 2] At 00:03.000, cut to a low-angle medium shot. <Subject 1> lands beside the water in a martial stance, robe and prayer beads swinging. <Subject 1> (S1) says firmly, <d>[Chinese] 此地妖气未散，姑娘快退后！</d>
[Shot 3] At 00:06.500, cut to a medium two-shot. <Subject 2> blinks in surprise, then laughs softly. <Subject 2> (S2) says, <d>[Chinese] 你是哪个剧组的？这身行头也太真了吧。</d>

overall_soundscape:
Gentle lapping water, summer insects, a sudden whoosh of wind and fluttering silk, the thud of a landing, prayer beads clacking.

non_diegetic_music:
N/A`,
  },
  {
    title: '示例 · 雪山古寺（横屏 10 秒，3 图无音频）',
    text: `subject_definitions:
<Subject 1> is the young man from <Picture 1>, serving as the black-robed swordsman, with long straight black hair in a high ponytail, a silver hair crown, and layered black sheer robes with silver embroidery.
<Subject 2> is the snow-covered mountain temple from <Picture 2>, serving as the location, with a multi-tiered pagoda, red pillars, stone guardian lions and red lanterns under snowy eaves.

summary:
[reference generation] A ten-second Chinese fantasy scene: in the snowy mountain temple the black-robed swordsman waits, and a visitor arrives before the bell rings.

retention_analysis:
<Subject 1> (appears in [Shot 2]): fully_preserved - hair crown, ponytail and black embroidered robes are retained.
<Subject 2> (appears in [Shot 1], [Shot 2]): fully_preserved - pagoda, red pillars, stone lions and lanterns are retained as the environment.

detailed_description:
Cinematic high-detail Chinese fantasy drama with a crisp blue-white winter palette, accented by red pillars and lanterns.
[Shot 1] An aerial wide shot of <Subject 2>: snow-covered rooftops beneath white mountains, light snow falling. The camera glides down toward the gate.
[Shot 2] At 00:04.000, cut to a medium shot before the temple gate. <Subject 1> stands in the snow, sleeves stirring in the wind, and looks up.

overall_soundscape:
Wind across the mountain, soft snowfall, footsteps crunching on snow, a deep temple bell at the end.

non_diegetic_music:
N/A`,
  },
];

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').trim();
}

/** Parse "key:\nvalue" blocks. Also accepts bare text (no headings). */
function parseSections(input) {
  const text = normalizeText(input);
  const sections = {};
  const re = /(^|\n)\s*(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*[:：]\s*/gi;
  const hits = [];
  let m;
  while ((m = re.exec(text))) hits.push({ key: m[2].toLowerCase(), start: m.index + m[1].length, bodyStart: re.lastIndex });
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : text.length;
    sections[hits[i].key] = text.slice(hits[i].bodyStart, end).trim();
  }
  return sections;
}

function isStructured(input) {
  const sections = parseSections(input);
  return SECTION_KEYS.every((k) => sections[k] !== undefined);
}

function joinSections(sections) {
  return SECTION_KEYS
    .filter((k) => sections[k] !== undefined && String(sections[k]).trim() !== '')
    .map((k) => `${k}:\n${String(sections[k]).trim()}`)
    .join('\n\n');
}

function stripFence(text) {
  return normalizeText(text).replace(/^```(?:json|markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();
}

/** Turn model output into a six-section prompt string. */
function normalizeModelOutput(raw) {
  let text = stripFence(raw);
  if (!text) throw new Error('模型返回为空');
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { obj = JSON.parse(text.slice(start, end + 1)); } catch { obj = null; }
    }
  }
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    const sections = {};
    for (const key of SECTION_KEYS) {
      if (obj[key] === undefined || obj[key] === null) continue;
      const value = obj[key];
      sections[key] = Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean).join('\n') : String(value).trim();
    }
    if (sections.detailed_description) return joinSections(sections);
  }
  if (isStructured(text)) return joinSections(parseSections(text));
  // Last resort: model returned prose only — place it in detailed_description with empty siblings.
  return joinSections({ detailed_description: text });
}

function buildSystemPrompt(language) {
  const langLine = language === 'en'
    ? '\n\n# 输出语言\n- 六段正文必须全部用英文书写；标签与枚举保持英文。'
    : '';
  return `${SYSTEM_PROMPT}\n\n${EXTRA_RULES}${langLine}`;
}

function buildOptimizeMessages(ctx) {
  const { prompt, assets = [], subjects = [], durationSeconds = 10, language = 'zh', maxDurationSeconds = 15 } = ctx;
  const assetLines = assets.length
    ? assets.map((a) => `- ${a.token}（${a.kind === 'audio' ? '音频' : '图像'}｜${a.name || '未命名文件'}｜${a.subjectName ? '已命名主体「' + a.subjectName + '」' : '未命名主体'}）`).join('\n')
    : '（本次没有参考素材）';
  const subjectLines = subjects.length
    ? subjects.map((s) => `- <Subject ${s.ordinal}> = 「${s.name}」，来自 ${s.tokens.join('、')}`).join('\n')
    : '（本次没有已命名主体）';
  const voiceLines = String(prompt).match(/<Audio\s+\d+>[^\n。]*[。.]/g) || [];
  const user = [
    '# 视频参数',
    `- 目标时长: ${durationSeconds} 秒（所有 [Shot N] At MM:SS.mmm 的起始时间必须严格小于该时长）`,
    `- 最大时长: ${maxDurationSeconds} 秒`,
    '',
    '# 可用参考标签（白名单，只能使用这些，不得新增或改号）',
    assetLines,
    '',
    '# 主体编号（必须严格使用这些编号，不得重新分配）',
    subjectLines,
    '',
    '# 用户原始描述',
    String(prompt).trim(),
    '',
    voiceLines.length ? '# 音色参考句（必须原样保留）\n' + voiceLines.map((v) => '- ' + v.trim()).join('\n') + '\n' : '',
    '# 附图说明',
    '随本消息附上的图片，按顺序对应上面已命名主体的素材，请照图写出真实的外观特征。',
    '',
    '请严格只输出一个 JSON 对象（不要 markdown 围栏、不要解释），六个字段：subject_definitions（数组）、summary（字符串）、retention_analysis（数组）、detailed_description（字符串）、overall_soundscape（字符串）、non_diegetic_music（字符串）。',
  ].join('\n');
  return [
    { role: 'system', content: buildSystemPrompt(language) },
    { role: 'user', content: user },
  ];
}

function englishWordCount(text) {
  const words = String(text).match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  return words.length;
}

function shotNumbers(prompt) {
  const out = new Set();
  for (const m of String(prompt).matchAll(/\[Shot\s+(\d+)\]/gi)) out.add(Number(m[1]));
  return out;
}

function shotTimes(prompt) {
  return [...String(prompt).matchAll(/\[Shot\s+(\d+)\]\s*At\s*(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?/gi)].map((m) => ({
    shot: Number(m[1]),
    seconds: Number(m[2]) * 60 + Number(m[3]) + Number(String(m[4] || '0').padEnd(3, '0')) / 1000,
  }));
}

function dialogueLines(text) {
  return [...String(text).matchAll(/<d>\[([^\]]+)\]\s*([\s\S]*?)<\/d>/g)].map((m) => ({ lang: m[1], text: m[2] }));
}

function validatePrompt(prompt, ctx = {}) {
  const text = normalizeText(prompt);
  const warnings = [];
  if (!text) return { warnings: ['提示词为空'], sections: {} };
  const sections = parseSections(text);
  const missing = SECTION_KEYS.filter((k) => !sections[k]);
  if (missing.length) warnings.push('缺少段落：' + missing.map((k) => SECTION_LABEL[k]).join('、'));
  const allowed = new Set([...(ctx.tokens || [])]);
  (ctx.subjects || []).forEach((s) => allowed.add(`<Subject ${s.ordinal}>`));
  const unknown = new Set();
  for (const m of text.matchAll(/<(Picture|Video|Audio|Subject)\s+(\d+)>/g)) {
    const token = `<${m[1]} ${m[2]}>`;
    if (allowed.has(token)) continue;
    if (m[1] === 'Subject' && (ctx.subjects || []).some((s) => s.ordinal === Number(m[2]))) continue;
    unknown.add(token);
  }
  if (unknown.size) warnings.push('引用了不存在的素材标签：' + [...unknown].join('、'));
  const duration = Number(ctx.duration || 10);
  const late = shotTimes(text).filter((s) => s.seconds >= duration);
  if (late.length) warnings.push(`镜头起始时间超出 ${duration} 秒：` + late.map((s) => `[Shot ${s.shot}] ${s.seconds.toFixed(2)}s`).join('、'));
  const words = englishWordCount(sections.detailed_description || '');
  if (words && (words < 120 || words > 600)) warnings.push(`详细描述约 ${words} 个英文词，规范建议 120–600 词`);
  const shots = shotNumbers(text);
  if (shots.size === 0) warnings.push('没有 [Shot N] 分镜标记');
  const dialogue = dialogueLines(text);
  for (const d of dialogue) {
    if (!/^[A-Za-z]{2,}$/.test(d.lang)) warnings.push(`台词语言标签「${d.lang}」应使用 English / Chinese / Japanese / Korean 这类英文全称`);
  }
  const silent = (sections.overall_soundscape || '').trim();
  if (!silent) warnings.push('环境音段落为空');
  return { warnings, sections, stats: { words, shots: shots.size, dialogue: dialogue.length } };
}

module.exports = {
  SECTION_KEYS,
  SECTION_LABEL,
  SKELETON,
  EXAMPLES,
  SYSTEM_PROMPT,
  EXTRA_RULES,
  parseSections,
  joinSections,
  isStructured,
  normalizeModelOutput,
  buildSystemPrompt,
  buildOptimizeMessages,
  validatePrompt,
  englishWordCount,
};
