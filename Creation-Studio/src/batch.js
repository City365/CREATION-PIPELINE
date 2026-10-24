'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const workflows = require('./workflows');
const prompts = require('./prompts');
const { sanitizeFilename, kindOf } = require('./util');

const SECTION_ORDER = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'];

function isAbsolute(p) {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}

function resolveFile(p, baseDir) {
  const raw = String(p || '').trim().replace(/\\/g, path.sep).replace(/\//g, path.sep);
  if (!raw) return '';
  if (isAbsolute(raw)) return path.normalize(raw);
  const candidates = [];
  if (baseDir) candidates.push(path.resolve(baseDir, raw));
  const cfg = config.load();
  candidates.push(path.resolve(cfg.assetFolder, raw));
  candidates.push(path.resolve(cfg.uploadFolder, raw));
  if (/^素材库[\\/]/.test(raw)) candidates.push(path.resolve(cfg.assetFolder, raw.replace(/^素材库[\\/]/, '')));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    } catch { /* ignore */ }
  }
  return path.resolve(baseDir || cfg.assetFolder, raw);
}

function promptText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && !Array.isArray(value)) {
    return SECTION_ORDER
      .filter((k) => value[k] !== undefined && value[k] !== null && String(value[k]).trim() !== '')
      .map((k) => `${k}:\n${Array.isArray(value[k]) ? value[k].map((v) => String(v).trim()).filter(Boolean).join('\n') : String(value[k]).trim()}`)
      .join('\n\n');
  }
  if (Array.isArray(value)) return value.map((v) => String(v)).join('\n').trim();
  return String(value).trim();
}

function pickAspect(value, fallback) {
  if (!value) return fallback;
  const raw = String(value).trim();
  const hit = workflows.ASPECTS.find((a) => a.key === raw || a.short === raw || raw.includes(a.short));
  return hit ? hit.key : fallback;
}

function parseBatch(input, opts = {}) {
  const cfg = config.load();
  let data = input;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch (err) { throw new Error('JSON 解析失败：' + err.message); }
  }
  if (!data || typeof data !== 'object') throw new Error('JSON 内容为空');
  const baseDirRaw = String(data.baseDir || opts.baseDir || '').trim();
  const baseDir = baseDirRaw ? path.resolve(opts.fileDir || cfg.assetFolder, baseDirRaw) : path.resolve(opts.fileDir || cfg.assetFolder);
  const defaults = data.defaults && typeof data.defaults === 'object' ? data.defaults : {};
  const rawTasks = Array.isArray(data.tasks) ? data.tasks : Array.isArray(data.items) ? data.items : null;
  if (!rawTasks || !rawTasks.length) throw new Error('JSON 里没有 tasks 数组');

  const warnings = [];
  if (data.baseDir && !fs.existsSync(baseDir)) warnings.push('baseDir 不存在：' + baseDir);
  if (defaults.workflow || rawTasks.some((t) => t && (t.workflow || t.workflow_id || t.api))) {
    warnings.push('JSON 里的 workflow/api 字段已忽略，整批使用页面上方选择的工作流');
  }

  const tasks = rawTasks.map((task, index) => {
    const errors = [];
    const t = task && typeof task === 'object' ? task : {};
    const prompt = promptText(t.prompt);
    if (!prompt) errors.push('prompt 为空');
    const imagesRaw = Array.isArray(t.images) ? t.images : [];
    const images = imagesRaw.map((img) => {
      const item = typeof img === 'string' ? { path: img } : img || {};
      const resolved = resolveFile(item.path, baseDir);
      const exists = !!resolved && fs.existsSync(resolved);
      if (!exists) errors.push('参考图不存在：' + (item.path || ''));
      return {
        path: resolved,
        name: path.basename(resolved || 'image'),
        subject: String(item.subject || '').trim(),
        exists,
      };
    }).filter((i) => i.path);
    const audiosRaw = Array.isArray(t.audios) ? t.audios : [];
    const audios = [];
    for (const audio of audiosRaw) {
      if (audio && typeof audio === 'object' && audio.voice && !audio.path) {
        errors.push(`内置音色「${audio.voice}」需要本地音频文件，当前版本不支持内置音色`);
        continue;
      }
      const p = typeof audio === 'string' ? audio : audio && audio.path;
      const resolved = resolveFile(p, baseDir);
      const exists = !!resolved && fs.existsSync(resolved);
      if (!exists) errors.push('参考音频不存在：' + (p || ''));
      else audios.push({ path: resolved, name: path.basename(resolved), exists: true });
    }
    const duration = Number(t.duration ?? defaults.duration ?? 10);
    if (!Number.isInteger(duration) || duration < 1 || duration > 15) errors.push('duration 必须是 1–15 的整数秒');
    const repeat = Math.max(1, Math.min(20, Number(t.repeat ?? defaults.repeat ?? 1)));
    return {
      index: index + 1,
      title: String(t.title || t.name || `任务 ${index + 1}`).slice(0, 60),
      prompt,
      images,
      audios,
      aspectRatio: pickAspect(t.aspectRatio ?? defaults.aspectRatio, workflows.ASPECTS[0].key),
      resolution: String(t.resolution ?? defaults.resolution ?? ''),
      megapixels: Number(t.megapixels ?? defaults.megapixels ?? 0) || 0,
      megapixels2: Number(t.megapixels2 ?? defaults.megapixels2 ?? 0) || 0,
      duration,
      repeat,
      errors,
    };
  });

  return {
    name: String(data.name || opts.name || '未命名批次'),
    baseDir,
    tasks,
    warnings,
    errors: tasks.flatMap((t) => t.errors.map((e) => `#${t.index} ${e}`)),
  };
}

function toJobInputs(batch, workflowId) {
  const wf = workflows.get(workflowId);
  if (!wf) throw new Error('工作流不存在');
  const out = [];
  for (const task of batch.tasks) {
    if (task.errors.length) continue;
    for (let i = 0; i < task.repeat; i++) {
      out.push({
        title: task.title,
        prompt: task.prompt,
        images: task.images.map((img) => ({ path: img.path, name: img.name, subject: img.subject })),
        audios: task.audios.map((a) => ({ path: a.path, name: a.name })),
        workflowId,
        aspectRatio: task.aspectRatio,
        resolution: task.resolution || wf.defaultResolution,
        megapixels: task.megapixels || wf.megapixelsDefault,
        megapixels2: task.megapixels2 || (wf.pass2 ? wf.pass2.default : 0),
        duration: task.duration,
        count: 1,
      });
    }
  }
  return out;
}

module.exports = { parseBatch, toJobInputs, promptText, resolveFile, SECTION_ORDER };
