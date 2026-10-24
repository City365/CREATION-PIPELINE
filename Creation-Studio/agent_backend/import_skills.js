'use strict';
/**
 * 把 A9 技能目录（SKILL.md + references）导入 H3 智能体后端，作为 kind=skill 的插件。
 *
 *   node agent_backend/import_skills.js [技能目录] [--dry]
 *
 * 默认导入 01_小说拆集、02_分集转剧本、04_剧本转分镜；同名技能会原地更新。
 * 目标后端：H3_AGENT_URL（默认 http://127.0.0.1:17820），项目：H3_PROJECT（默认 h3-studio）。
 */
const fs = require('node:fs');
const path = require('node:path');

const SKILLS_ROOT = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : 'C:/Users/Mr.luo/Desktop/相关提示词/A9版本全流程/skills';
const DRY = process.argv.includes('--dry');
const AGENT = (process.env.H3_AGENT_URL || 'http://127.0.0.1:17820').replace(/\/+$/, '');
const PROJECT = process.env.H3_PROJECT || 'h3-studio';

const ADAPTER = [
  '【本机适配】',
  '你运行在 H3 Studio 创作台的对话里：没有项目文件夹、没有 split.mjs / check.mjs 等脚本，也没有外部命令权限。',
  '请直接输出文本结果（需要文件时用交付文件工具生成），SKILL.md 里的校验清单当作自检项逐条核对，不要声称执行了脚本。',
  '上游内容由用户粘贴或作为附件提供；下游产物直接输出在对话里，供下一步继续。',
].join('\n');

const DEFS = [
  {
    dir: '01_小说拆集',
    name: '小说拆集',
    description: 'A9 · 小说 → 分集：按剧情单元切集，原文逐段覆盖、不改写不删减，产出各集小说与分集索引。',
  },
  {
    dir: '02_分集转剧本',
    name: '分集转剧本',
    description: 'A9 · 一集小说 → 一集剧本：按场次切，画面写可见动作，台词保留原意，只输出剧本。',
  },
  {
    dir: '04_剧本转分镜',
    name: '剧本转分镜',
    description: 'A9 · 一集剧本 → 定时分组 + 导演分镜 JSON + 资产清单（CINEMA-SHOT v18.4，默认 15 秒）。',
  },
];

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
}

function bodyOfSkillMd(text) {
  return text.replace(/^---[\s\S]*?---\s*/, '').trim();
}

function compose(def) {
  const dir = path.join(SKILLS_ROOT, def.dir);
  const skillMd = read(path.join(dir, 'SKILL.md'));
  const parts = [ADAPTER, '', '---', '', bodyOfSkillMd(skillMd)];
  if (def.dir === '04_剧本转分镜') {
    const extra = read(path.join(dir, 'references', '补充导演提示词.txt'));
    const presets = path.join(dir, 'references', '预设');
    const files = fs.readdirSync(presets).filter((f) => f.endsWith('.txt'));
    const pick = files.find((f) => f.includes('15S')) || files[0];
    const preset = read(path.join(presets, pick));
    parts.push('', '---', '', '## 补充导演提示词（每组执行时使用）', '', extra);
    parts.push('', '---', '', '## 预设：CINEMA-SHOT v18.4 15S（完整版）', '',
      '说明：目录里还有 10S / 12S / 30S 版本，结构相同，仅"15秒 / 15S"这类时长参数不同；用户指定其它时长时按同样结构替换时长即可。',
      '', preset);
  } else {
    const prompt = read(path.join(dir, 'references', 'prompt.txt'));
    parts.push('', '---', '', '## 执行提示词（references/prompt.txt）', '', prompt);
  }
  return parts.join('\n');
}

async function api(method, url, body) {
  const res = await fetch(AGENT + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Project-Id': PROJECT },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(method + ' ' + url + ' -> ' + res.status + ' ' + (data.detail || data.error || text.slice(0, 200)));
  return data;
}

(async () => {
  const existing = await api('GET', '/agent/plugins?kind=skill');
  const byName = new Map((Array.isArray(existing) ? existing : []).map((p) => [p.name, p]));
  for (const def of DEFS) {
    const instructions = compose(def);
    const payload = {
      kind: 'skill',
      name: def.name,
      description: def.description,
      enabled: true,
      config: { instructions, source: 'A9/' + def.dir },
    };
    console.log(`${def.name}: ${instructions.length} 字符`);
    if (DRY) continue;
    const old = byName.get(def.name);
    if (old) {
      await api('PUT', '/agent/plugins/' + encodeURIComponent(old.id), payload);
      console.log('  已更新 ' + old.id);
    } else {
      const created = await api('POST', '/agent/plugins', payload);
      console.log('  已创建 ' + created.id);
    }
  }
  if (!DRY) {
    const list = await api('GET', '/agent/plugins?kind=skill');
    console.log('当前技能：' + list.map((p) => p.name + '(' + String(p.config.instructions).length + ')').join('、'));
  }
})();
