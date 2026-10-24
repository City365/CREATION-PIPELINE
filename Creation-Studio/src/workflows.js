'use strict';
const fs = require('node:fs');
const path = require('node:path');
const channels = require('./channels');

const LIST = JSON.parse(fs.readFileSync(path.join(__dirname, 'workflows.json'), 'utf8'));

const PROVIDER_LABEL = { autodl: '官网API', generic: '自定义', manager: '管理器' };
const PROVIDER_HINT = {
  autodl: 'AutoDL 官网 API · 只需 API Key，无需开机',
  generic: '自定义视频渠道 · 直接调你填写的接口',
  manager: '外接管理器 · 用 Chrome 账号跑豆包 / Gemini',
};

const ASPECTS = [
  { key: '9:16 (Portrait Widescreen)', short: '9:16', label: '9:16 竖屏', w: 9, h: 16 },
  { key: '16:9 (Widescreen)', short: '16:9', label: '16:9 横屏', w: 16, h: 9 },
  { key: '1:1 (Square)', short: '1:1', label: '1:1 方形', w: 1, h: 1 },
];

const DEFAULT_ID = 'minimax_h3_image_audio_to_video_v2_15s';

function all() {
  return LIST.concat(genericWorkflows()).concat(managerWorkflows());
}

/** 管理器渠道：一个渠道派生两条「视频模型」（豆包 / Gemini） */
function managerWorkflows() {
  const out = [];
  for (const ch of channels.list('video')) {
    if (!ch.enabled || ch.type !== 'manager-video') continue;
    const opts = ch.options || {};
    const seconds = Math.min(15, Math.max(5, Number(opts.seconds) || 10));
    out.push({
      id: 'mgr:' + ch.id + ':doubao',
      channelId: ch.id,
      channelType: ch.type,
      provider: 'manager',
      platform: 'doubao',
      label: ch.name + ' · 豆包',
      note: '管理器浏览器生成 · 豆包 Seedance · 5–15 秒',
      images: 9,
      optionalImages: true,
      audios: 0,
      videos: 0,
      durationKey: 'duration',
      durationDefault: seconds,
      durationOptions: Array.from({ length: 11 }, (_, i) => i + 5),
      seedKey: '',
      sizeMode: 'ratio',
      ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      defaultRatio: '16:9',
      megapixelsOptions: [],
      megapixelsDefault: 0,
      megapixelsLabel: '画幅',
    });
    out.push({
      id: 'mgr:' + ch.id + ':gemini',
      channelId: ch.id,
      channelType: ch.type,
      provider: 'manager',
      platform: 'gemini',
      label: ch.name + ' · Gemini',
      note: '管理器浏览器生成 · Gemini 视频 · 固定 10 秒',
      images: 9,
      optionalImages: true,
      audios: 0,
      videos: 0,
      durationKey: 'duration',
      durationDefault: 10,
      durationOptions: [10],
      seedKey: '',
      sizeMode: 'ratio',
      ratios: ['16:9', '9:16'],
      defaultRatio: '16:9',
      megapixelsOptions: [],
      megapixelsDefault: 0,
      megapixelsLabel: '画幅',
    });
  }
  return out;
}

function genericWorkflows() {
  return channels.list('video')
    .filter((ch) => ch.enabled && ch.type !== 'manager-video')
    .map((ch) => {
      const opts = ch.options || {};
      const durationDefault = Math.max(1, Math.min(15, Number(opts.seconds) || 10));
      return {
        id: 'ch:' + ch.id,
        channelId: ch.id,
        provider: 'generic',
        label: ch.name,
        note: ch.type === 'generic-task' ? '自定义任务式接口' : 'OpenAI 视频兼容接口',
        images: Math.max(1, Math.min(9, Number(opts.maxImages) || 1)),
        audios: 0,
        videos: 0,
        durationKey: 'duration',
        durationDefault,
        durationOptions: Array.from({ length: 15 }, (_, i) => i + 1),
        seedKey: 'seed',
        sizeMode: 'wh',
        widthKey: '',
        heightKey: '',
        megapixelsOptions: [],
        megapixelsDefault: 0,
        megapixelsLabel: '尺寸',
        aspectKey: '',
        channelType: ch.type,
      };
    });
}

function get(id) {
  if (String(id).startsWith('mgr:')) {
    return managerWorkflows().find((w) => w.id === id) || null;
  }
  if (String(id).startsWith('ch:')) {
    return genericWorkflows().find((w) => w.id === id) || null;
  }
  return LIST.find((w) => w.id === id) || null;
}

function defaultWorkflow() {
  return get(DEFAULT_ID) || LIST[0];
}

function label(wf) {
  return `[${PROVIDER_LABEL[wf.provider] || wf.provider}] ${wf.label}`;
}

function publicList() {
  return all().map((wf) => ({
    id: wf.id,
    provider: wf.provider,
    providerLabel: PROVIDER_LABEL[wf.provider] || wf.provider,
    label: wf.label,
    display: label(wf),
    note: wf.note,
    channelId: wf.channelId || '',
    channelType: wf.channelType || '',
    platform: wf.platform || '',
    ratios: wf.ratios || [],
    defaultRatio: wf.defaultRatio || '',
    images: wf.images,
    audios: wf.audios,
    videos: wf.videos || 0,
    durationKey: wf.durationKey,
    durationDefault: wf.durationDefault,
    durationOptions: wf.durationOptions || Array.from({ length: 15 }, (_, i) => i + 1),
    sizeMode: wf.sizeMode,
    resolutions: wf.resolutions || [],
    defaultResolution: wf.defaultResolution || '',
    megapixelsOptions: wf.megapixelsOptions || [],
    megapixelsDefault: wf.megapixelsDefault || 0,
    megapixelsLabel: wf.megapixelsLabel || '分辨率',
    aspectKey: wf.aspectKey || '',
    widthKey: wf.widthKey || '',
    heightKey: wf.heightKey || '',
    seedKey: wf.seedKey || '',
    pass2: wf.pass2 || null,
  }));
}

function aspect(short) {
  return ASPECTS.find((a) => a.short === short || a.key === short) || ASPECTS[0];
}

function validate(wf, input) {
  const errors = [];
  const warnings = [];
  if (!wf) return { errors: ['请选择工作流'], warnings };
  const images = (input.images || []).filter(Boolean);
  const audios = (input.audios || []).filter(Boolean);
  const videos = (input.videos || []).filter(Boolean);
  if (wf.images > 0 && images.length === 0 && !wf.optionalImages) errors.push('至少添加一张参考图');
  if (images.length > wf.images) errors.push(`该工作流最多 ${wf.images} 张参考图`);
  if (audios.length > wf.audios) errors.push(wf.audios === 0 ? '该工作流不接收参考音频' : `该工作流最多 ${wf.audios} 段参考音频`);
  if (videos.length > (wf.videos || 0)) errors.push('该工作流不接收参考视频');
  const prompt = String(input.prompt || '').trim();
  if (!prompt) errors.push('提示词不能为空');
  else if (prompt.length > 10000) errors.push('提示词不能超过 10000 个字符');
  const duration = Number(input.duration);
  if (!Number.isInteger(duration) || duration < 1 || duration > 15) errors.push('视频时长仅支持 1–15 秒的整数秒');
  if (wf.sizeMode === 'resolution') {
    const res = String(input.resolution || wf.defaultResolution || '');
    if (wf.resolutions.length && !wf.resolutions.includes(res)) errors.push(`分辨率只能是 ${wf.resolutions.join('、')}`);
  } else if (wf.sizeMode === 'aspect') {
    if (!input.aspectRatio) errors.push('请选择画幅');
    const mp = Number(input.megapixels);
    if (!Number.isFinite(mp) || mp <= 0) errors.push('请选择分辨率');
    else if (wf.megapixelsOptions.length && !wf.megapixelsOptions.includes(mp)) errors.push(`分辨率只能是 ${wf.megapixelsOptions.join(' / ')}`);
    if (wf.pass2) {
      const mp2 = Number(input.megapixels2);
      if (!Number.isFinite(mp2) || mp2 <= 0) errors.push(`请选择${wf.pass2.label || '二次采样'}`);
      else if ((wf.pass2.options || []).length && !wf.pass2.options.includes(mp2)) errors.push(`${wf.pass2.label || '二次采样'}只能是 ${wf.pass2.options.join(' / ')}`);
    }
  } else if (wf.sizeMode === 'wh') {
    if (!input.aspectRatio) errors.push('请选择画幅');
  } else if (wf.sizeMode === 'ratio') {
    const ratio = aspect(input.aspectRatio).short;
    if (!input.aspectRatio) errors.push('请选择画幅');
    else if (wf.ratios && wf.ratios.length && !wf.ratios.includes(ratio)) errors.push(`这个视频模型只支持 ${wf.ratios.join(' / ')} 画幅`);
    if (wf.durationOptions && !wf.durationOptions.includes(duration)) errors.push(`这个视频模型只支持 ${wf.durationOptions.length > 1 ? wf.durationOptions[0] + '–' + wf.durationOptions[wf.durationOptions.length - 1] : wf.durationOptions[0]} 秒`);
  }
  return { errors, warnings };
}

module.exports = {
  all, get, defaultWorkflow, label, publicList, aspect, validate,
  PROVIDER_LABEL, PROVIDER_HINT, ASPECTS, DEFAULT_ID,
};

