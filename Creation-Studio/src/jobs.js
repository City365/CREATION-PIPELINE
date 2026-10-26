'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const config = require('./config');
const workbenchStore = require('./workbench-store');
const workflows = require('./workflows');
const providers = require('./providers');
const channels = require('./channels');
const genericVideo = require('./generic-video');
const managerVideo = require('./manager-video');
const {
  ensureDir, readJson, writeJson, uid, dayFolder, stamp, sanitizeFilename,
  kindOf, formatBytes, sleep, publicError, fetchBuffer,
} = require('./util');

const STATE_FILE = path.join(config.DATA, 'jobs.json');
const LOG_DIR = path.join(config.DATA, 'logs');
const POLL_MS = 3000;
const JOB_TIMEOUT_MS = 90 * 60 * 1000;

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const state = { jobs: [] };
const active = new Map(); // jobId -> { slot, canceled }
const slotBusy = new Map(); // slotKey -> jobId
let pumping = false;

function loadState() {
  const data = readJson(STATE_FILE, { jobs: [] });
  state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
  for (const job of state.jobs) {
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'failed';
      job.stage = '已中断';
      job.error = job.provider === 'manager' && job.remotePromptId ? '服务重启，任务已中断；可点「继续查询／下载」恢复原任务' : '服务重启，任务已中断；可点「重试」重新提交';
      job.finishedAt = Date.now();
      job.progress = 0;
    }
  }
  saveState();
  ensureDir(LOG_DIR);
}

let saveTimer = null;
function saveState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeJson(STATE_FILE, { jobs: state.jobs });
  }, 120);
}

function flushState() {
  for(const job of state.jobs)if(job.runId&&['success','failed','canceled'].includes(job.status))workbenchStore.store().finish(job.runId,job.status,job.outputs||[],job.error);
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeJson(STATE_FILE, { jobs: state.jobs });
}

function list() {
  return state.jobs.map((j) => ({ ...j, logs: undefined }));
}

function get(id) {
  return state.jobs.find((j) => j.id === id) || null;
}

function log(job, level, text) {
  const entry = { t: Date.now(), level, text: String(text).slice(0, 1000) };
  job.logs = job.logs || [];
  job.logs.push(entry);
  if (job.logs.length > 300) job.logs.splice(0, job.logs.length - 300);
  try {
    ensureDir(LOG_DIR);
    fs.appendFileSync(path.join(LOG_DIR, job.id + '.log'), `[${stamp()}] ${level.toUpperCase()} ${entry.text}\n`, 'utf8');
  } catch { /* ignore */ }
  emitter.emit('job', publicJob(job));
}

function publicJob(job) {
  return { ...job, logs: undefined };
}

function readLog(id) {
  try {
    const text = fs.readFileSync(path.join(LOG_DIR, id + '.log'), 'utf8');
    return text.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const m = /^\[([^\]]+)\]\s+([A-Z]+)\s+([\s\S]*)$/.exec(line);
      return m ? { t: 0, level: m[2].toLowerCase(), text: m[1] + ' ' + m[3] } : { t: 0, level: 'info', text: line };
    });
  } catch {
    return [];
  }
}

function touch(job, patch = {}) {
  Object.assign(job, patch);
  if(job.runId) workbenchStore.store().finish(job.runId,job.status,job.outputs||[],job.error);
  saveState();
  emitter.emit('job', publicJob(job));
}

function slots() {
  const cfg = config.load();
  const out = [];
  for (const key of cfg.autodlKeys.filter((k) => k.enabled)) out.push({ key: 'key:' + key.id, provider: 'autodl', id: key.id, name: key.name });
  for (const ch of (cfg.channels.video || []).filter((c) => c.enabled !== false)) {
    if (ch.type === 'manager-video') {
      out.push({ key: 'ch:' + ch.id + ':doubao', provider: 'manager', id: ch.id, platform: 'doubao', name: ch.name + ' · 豆包' });
      out.push({ key: 'ch:' + ch.id + ':gemini', provider: 'manager', id: ch.id, platform: 'gemini', name: ch.name + ' · Gemini' });
    } else {
      out.push({ key: 'ch:' + ch.id, provider: 'generic', id: ch.id, name: ch.name });
    }
  }
  return out;
}

function slotStats() {
  return {
    total: slots().length,
    busy: slotBusy.size,
    concurrency: config.load().concurrency,
    queued: state.jobs.filter((j) => j.status === 'queued').length,
    running: state.jobs.filter((j) => j.status === 'running').length,
  };
}

function availableSlot(provider, channelId, platform) {
  const busyCount = slotBusy.size;
  if (busyCount >= config.load().concurrency) return null;
  return slots().find((s) => s.provider === provider
    && (!channelId || s.id === channelId)
    && (!platform || s.platform === platform)
    && !slotBusy.has(s.key)) || null;
}

function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const queued = state.jobs
        .filter((j) => j.status === 'queued' && !j.held)
        .sort((a, b) => (a.order || 0) - (b.order || 0) || a.createdAt - b.createdAt);
      let next, slot;
      for (const candidate of queued) {
        const wf = workflows.get(candidate.workflowId);
        if (!wf) {
          failJob(candidate, new Error('工作流不存在或渠道已停用'));
          continue;
        }
        const available = availableSlot(wf.provider, wf.channelId, wf.platform);
        if (available) { next = candidate; slot = available; break; }
      }
      if (!next) break;
      slotBusy.set(slot.key, next.id);
      active.set(next.id, { slot, canceled: false });
      next.slotName = slot.name;
      if (slot.provider === 'autodl') next.keyId = slot.id;
      else next.channelId = slot.id;
      if (slot.provider === 'manager') next.platform = slot.platform;
      run(next, slot).catch((err) => {
        // run() handles its own errors; this is a safety net.
        failJob(next, err);
      }).finally(() => {
        slotBusy.delete(slot.key);
        active.delete(next.id);
        if (state.jobs.some((j) => j.status === 'queued' && !j.held)) setImmediate(pump);
      });
    }
  } finally {
    pumping = false;
  }
}

function addJobs(input) {
  const wf = workflows.get(input.workflowId);
  if (!wf) throw new Error('工作流不存在');
  const exists = slots().some((s) => s.provider === wf.provider
    && (!wf.channelId || s.id === wf.channelId)
    && (!wf.platform || s.platform === wf.platform));
  if (!exists) {
    throw new Error(wf.provider === 'autodl'
      ? '没有启用的官网 API Key，请先在设置里添加'
      : wf.provider === 'manager'
        ? '管理器渠道没启用或已删除，请到 设置 → 视频生成 检查'
        : '这个视频渠道已停用或删除，请到「渠道管理」检查');
  }
  const count = Math.max(1, Math.min(20, Number(input.count) || 1));
  const baseOrder = state.jobs.reduce((max, j) => Math.max(max, j.order || 0), 0);
  const created = [];
  const prompt = String(input.prompt || '').trim();
  for (let i = 0; i < count; i++) {
    const seed = input.seed == null || input.seed === '' ? randomSeed() : Number(input.seed);
    const job = {
      id: 'job-' + Date.now().toString(36) + '-' + uid('').slice(0, 4),
      order: baseOrder + i + 1,
      title: String(input.title || deriveTitle(prompt)).slice(0, 60),
      excerpt: deriveExcerpt(prompt),
      status: 'queued',
      stage: '排队中',
      progress: 0,
      held: false,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      projectId: input.projectId || 'unassigned',
      itemId: input.itemId || null,
      eventId: input.eventId || null,
      userPrompt: input.userPrompt == null ? prompt : input.userPrompt,
      prefixPrompt: input.prefixPrompt,
      styleId: input.styleId,
      workflowId: wf.id,
      provider: wf.provider,
      channelId: wf.channelId || null,
      platform: wf.platform || '',
      prompt,
      images: (input.images || []).filter(Boolean),
      audios: (input.audios || []).filter(Boolean),
      duration: Number(input.duration) || wf.durationDefault,
      resolution: input.resolution || wf.defaultResolution || '',
      aspectRatio: input.aspectRatio || workflows.ASPECTS[0].key,
      megapixels: Number(input.megapixels) || wf.megapixelsDefault || 0,
      megapixels2: Number(input.megapixels2) || (wf.pass2 ? wf.pass2.default : 0),
      seed,
      repeatIndex: i + 1,
      repeatCount: count,
      remotePromptId: null,
      outputDir: null,
      outputs: [],
      error: null,
      logs: [],
    };
    job.runId = workbenchStore.store().begin({...job,kind:'video',jobId:job.id,channelName:(channels.get('video',job.channelId)||{}).name,model:(channels.get('video',job.channelId)||{}).model});
    state.jobs.push(job);
    created.push(job);
    log(job, 'info', `已加入队列（${i + 1}/${count}），工作流 ${wf.id}`);
  }
  saveState();
  setImmediate(pump);
  return created;
}

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 48);
}

function deriveTitle(prompt) {
  const text = String(prompt || '');
  const summary = /(?:^|\n)\s*summary\s*[:：]\s*([^\n]+)/i.exec(text);
  if (summary) {
    return summary[1].replace(/^\[[^\]]*\]\s*/, '').trim().slice(0, 48) || '未命名任务';
  }
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*[:：]/i.test(l));
  return (line || '未命名任务').replace(/<[^>]+>/g, '').slice(0, 48);
}

function deriveExcerpt(prompt) {
  const text = String(prompt || '');
  const pick = (key, nextKeys) => {
    const re = new RegExp(`(?:^|\\n)\\s*${key}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${nextKeys.join('|')})\\s*[:：]|$)`, 'i');
    const hit = re.exec(text);
    return hit ? hit[1] : '';
  };
  const body = pick('detailed_description', ['overall_soundscape', 'non_diegetic_music', 'summary', 'retention_analysis', 'subject_definitions'])
    || pick('summary', ['subject_definitions', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'])
    || text;
  return body.replace(/\[Shot\s+\d+\]/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function cancel(id) {
  const job = get(id);
  if (!job) throw new Error('任务不存在');
  if (job.status === 'queued') {
    job.status = 'canceled';
    job.stage = '已取消';
    job.finishedAt = Date.now();
    log(job, 'warn', '已取消排队中的任务');
    touch(job);
    return job;
  }
  if (job.status === 'running') {
    const a = active.get(id);
    if (a) a.canceled = true;
    job.stage = '正在取消…';
    log(job, 'warn', '已请求取消，等待当前请求返回');
    if (job.provider === 'manager' && job.remotePromptId && job.channelId) {
      const channel = channels.get('video', job.channelId);
      if (channel) {
        managerVideo.cancel(channel, job.remotePromptId)
          .then((ok) => log(job, 'warn', ok ? '已请求管理器取消平台任务' : '管理器取消请求被拒绝'))
          .catch((err) => log(job, 'warn', '管理器取消失败：' + err.message));
      }
    }
    touch(job);
    return job;
  }
  throw new Error('任务已结束，无法取消');
}

async function resume(id) {
  const job = get(id);
  if (!job || job.provider !== 'manager' || !job.remotePromptId) throw new Error('任务没有可继续的管理器编号');
  if (!['failed', 'canceled'].includes(job.status)) throw new Error('任务尚未结束或已完成');
  const channel = channels.get('video', job.channelId);
  if (!channel) throw new Error('管理器渠道已删除');
  // Restore the existing remote task; never call the generation submission endpoint.
  await managerVideo.resume(channel, job.remotePromptId);
  if (!['failed', 'canceled'].includes(job.status)) return job;
  job.resumeRemote = true; job.status = 'queued'; job.stage = '继续查询原任务';
  job.error = null; job.finishedAt = null; job.held = false;
  log(job, 'info', '继续原管理器任务 ' + job.remotePromptId + '，不重新生成');
  touch(job); setImmediate(pump); return job;
}

function retry(id) {
  const job = get(id);
  if (!job) throw new Error('任务不存在');
  if (job.status === 'queued' || job.status === 'running') throw new Error('任务仍在队列中');
  job.runId = workbenchStore.store().begin({...job,kind:'video',jobId:null,status:'queued',createdAt:Date.now()});
  job.outputVersion = job.runId.slice(0,8);
  job.status = 'queued';
  job.stage = '排队中';
  job.progress = 0;
  job.error = null;
  job.outputs = [];
  job.startedAt = null;
  job.finishedAt = null;
  job.logs = [];
  job.held = false;
  job.resumeRemote = false;
  log(job, 'info', '重新排队');
  touch(job);
  setImmediate(pump);
  return job;
}

function remove(id) {
  const idx = state.jobs.findIndex((j) => j.id === id);
  if (idx < 0) throw new Error('任务不存在');
  if (state.jobs[idx].status === 'running') throw new Error('任务正在执行，先取消再删除');
  state.jobs.splice(idx, 1);
  saveState();
  return true;
}

function setHeld(id, held) {
  const job = get(id);
  if (!job) throw new Error('任务不存在');
  job.held = !!held;
  log(job, 'info', held ? '已锁定，不参与自动排队' : '已解锁');
  touch(job);
  if (!held) setImmediate(pump);
  return job;
}

function reorder(ids) {
  const set = new Set(ids);
  const rest = state.jobs.filter((j) => !set.has(j.id)).map((j) => j.order || 0);
  const base = rest.length ? Math.max(...rest) : 0;
  ids.forEach((id, index) => {
    const job = get(id);
    if (job) job.order = base + index + 1;
  });
  state.jobs.sort((a, b) => (a.order || 0) - (b.order || 0));
  saveState();
  emitter.emit('refresh');
  return true;
}

function checkCanceled(job, a) {
  if (a && a.canceled) {
    job.status = 'canceled';
    job.stage = '已取消';
    job.finishedAt = Date.now();
    log(job, 'warn', '任务已取消');
    flushState();
    throw new Error('__canceled__');
  }
}

function failJob(job, err) {
  if (err && err.message === '__canceled__') return;
  job.status = 'failed';
  job.stage = '失败';
  job.error = publicError(err);
  job.finishedAt = Date.now();
  log(job, 'error', job.error);
  flushState();
}

async function run(job, slot) {
  const a = active.get(job.id);
  job.status = 'running';
  job.stage = '准备中';
  job.startedAt = Date.now();
  job.progress = 5;
  touch(job);
  try {
    const wf = workflows.get(job.workflowId);
    if (!wf) throw new Error('工作流不存在');
    const check = workflows.validate(wf, job);
    if (check.errors.length) throw new Error(check.errors.join('；'));
    if (wf.provider === 'autodl') await runAutodl(job, wf, a);
    else if (wf.provider === 'manager') await runManagerVideo(job, wf, a, slot);
    else await runGenericVideo(job, wf, a, slot);
    if (job.status !== 'canceled') {
      job.status = 'success';
      job.stage = '完成';
      job.progress = 100;
      job.finishedAt = Date.now();
      log(job, 'success', '任务完成：' + job.outputs.map((o) => o.name).join(', '));
      flushState();
    }
  } catch (err) {
    failJob(job, err);
  }
}

/* ------------------------------- 落盘 ------------------------------- */

function jobDir(job) {
  const cfg = config.load();
  const dir = path.join(ensureDir(cfg.saveFolder), dayFolder(), job.id + (job.outputVersion ? '-'+job.outputVersion : ''));
  ensureDir(dir);
  return dir;
}

function writeJobMeta(job, dir, extra = {}) {
  const wf = workflows.get(job.workflowId);
  const params = {
    id: job.id,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    prompt: job.prompt,
    userPrompt: job.userPrompt,
    prefixPrompt: job.prefixPrompt,
    styleId: job.styleId,
    projectId: job.projectId,
    itemId: job.itemId,
    workflowId: job.workflowId,
    provider: job.provider,
    apiUrl: extra.apiUrl || '',
    worker: extra.worker || '',
    aspectRatio: job.aspectRatio,
    resolution: job.resolution,
    megapixels: job.megapixels,
    megapixels2: job.megapixels2,
    duration: job.duration,
    seed: job.seed,
    estimatedSize: extra.estimatedSize || '',
    inputValues: extra.inputValues || null,
    remotePromptId: job.remotePromptId,
    outputs: job.outputs.map((o) => ({ type: o.type, file: o.name, bytes: o.bytes, url: o.url })),
    refImages: job.images.map((i) => i.path),
    refAudios: job.audios.map((i) => i.path),
    workflow: wf ? wf.label : '',
  };
  writeJson(path.join(dir, 'params.json'), params);
  fs.writeFileSync(path.join(dir, 'prompt.txt'), job.prompt + '\n', 'utf8');
}

async function saveOutputs(job, dir, items, a) {
  let index = 0;
  for (const item of items) {
    checkCanceled(job, a);
    index++;
    const kind = item.type === 'video' ? 'video' : item.type === 'audio' ? 'audio' : 'image';
    let ext = path.extname(item.filename || '') || (kind === 'video' ? '.mp4' : kind === 'audio' ? '.mp3' : '.png');
    const res = await providers.download(item.url);
    if (!ext) ext = kind === 'video' ? '.mp4' : '.png';
    const name = `${String(index).padStart(2, '0')}-${kind}${ext}`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, res.buffer);
    job.outputs.push({ type: kind, name, path: file, bytes: res.buffer.length, url: item.url });
    log(job, 'info', `已下载 ${name}（${formatBytes(res.buffer.length)}）`);
    touch(job, { progress: Math.min(99, job.progress + 2) });
  }
}

/* ------------------------------- 官网 API 执行 ------------------------------- */

function dataUrl(filePath, name) {
  const mime = require('./util').mimeFor(name || filePath);
  const buf = fs.readFileSync(filePath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function runAutodl(job, wf, a) {
  const key = config.keyById(job.keyId) || config.load().autodlKeys.find((k) => k.enabled);
  if (!key) throw new Error('没有启用的官网 API Key，请在设置里添加');
  job.apiUrl = providers.AUTODL_BASE;
  job.stage = '编码参考素材…';
  touch(job, { progress: 10 });
  const payload = { prompt: job.prompt, resolution: job.resolution || wf.defaultResolution };
  payload[wf.durationKey] = job.duration;
  if (wf.seedKey) payload[wf.seedKey] = job.seed;
  const images = job.images.slice(0, wf.images);
  for (let i = 0; i < images.length; i++) {
    checkCanceled(job, a);
    payload[`ref_image_${i}`] = dataUrl(images[i].path, images[i].name);
    log(job, 'info', `图像 ${i + 1} → ref_image_${i}（base64）`);
  }
  const audios = job.audios.slice(0, wf.audios);
  for (let i = 0; i < audios.length; i++) {
    checkCanceled(job, a);
    payload[`ref_audio_${i}`] = dataUrl(audios[i].path, audios[i].name);
    log(job, 'info', `音频 ${i + 1} → ref_audio_${i}（base64）`);
  }
  const masked = { ...payload };
  for (const [k, v] of Object.entries(masked)) {
    if (typeof v === 'string' && v.startsWith('data:')) masked[k] = v.slice(0, v.indexOf(',') + 1) + `<base64 ${formatBytes(v.length * 0.75)}>`;
  }
  job.inputValues = masked;

  job.stage = '提交到官网…';
  touch(job, { progress: 20 });
  const taskId = await providers.submitAutodl(key.token, wf.id, payload);
  job.remotePromptId = taskId;
  log(job, 'info', '官网任务已提交：task_id=' + taskId);
  touch(job, { progress: 25, stage: '官网排队中…' });

  const started = Date.now();
  let result = null;
  while (Date.now() - started < JOB_TIMEOUT_MS) {
    checkCanceled(job, a);
    await sleep(4000);
    checkCanceled(job, a);
    result = await providers.pollAutodl(key.token, taskId);
    if (result.status === 'failed') throw new Error('官网任务失败：' + (result.message || result.rawStatus));
    if (result.status === 'success' && result.url) break;
    touch(job, {
      progress: Math.min(88, 25 + Math.round((Date.now() - started) / 1000 / 6)),
      stage: result.status === 'queued' ? '官网排队中…' : '生成中…',
    });
  }
  if (!result || !result.url) throw new Error('官网任务超时或未返回结果地址');

  job.stage = '下载结果…';
  touch(job, { progress: 90 });
  const dir = jobDir(job);
  job.outputDir = dir;
  const ext = (result.url.match(/\.(mp4|webm|mov|m4v)(?:\?|$)/i) || [])[1] || 'mp4';
  await saveOutputs(job, dir, [{ type: 'video', filename: 'video.' + ext, url: result.url }], a);
  writeJobMeta(job, dir, { apiUrl: providers.AUTODL_BASE, worker: key.name, inputValues: masked });
  job.stage = '完成';
}

async function runGenericVideo(job, wf, a, slot) {
  const channel = channels.get('video', slot.id);
  if (!channel) throw new Error('视频渠道已删除，请重新选择');
  job.apiUrl = channel.baseUrl;
  job.stage = '提交到自定义渠道…';
  touch(job, { progress: 10 });
  log(job, 'info', `使用渠道「${channel.name}」（${channel.type}）提交`);
  const submitted = await genericVideo.submit(channel, job);
  job.remotePromptId = submitted.taskId;
  log(job, 'info', '任务已提交：id=' + submitted.taskId);
  touch(job, { progress: 20, stage: '生成中…' });

  const started = Date.now();
  let result = null;
  while (Date.now() - started < JOB_TIMEOUT_MS) {
    checkCanceled(job, a);
    await sleep(4000);
    checkCanceled(job, a);
    result = await genericVideo.poll(channel, submitted.taskId);
    if (result.status === 'failed') throw new Error('渠道任务失败：' + (result.message || result.rawStatus));
    if (result.status === 'success') break;
    const byTime = 20 + Math.round((Date.now() - started) / 1000 / 8);
    touch(job, {
      progress: Math.min(88, Number.isFinite(result.progress) && result.progress > 0 ? Math.max(20, Math.min(88, result.progress)) : byTime),
      stage: '生成中…',
    });
  }
  if (!result || result.status !== 'success') throw new Error('生成超时或渠道未返回结果');

  job.stage = '下载结果…';
  touch(job, { progress: 90 });
  const dir = jobDir(job);
  job.outputDir = dir;
  const url = result.url || genericVideo.downloadUrl(channel, submitted.taskId);
  const absolute = /^https?:\/\//i.test(url) ? url : channel.baseUrl.replace(/\/+$/, '') + (url.startsWith('/') ? '' : '/') + url;
  const headers = {};
  if (channel.apiKey) headers.Authorization = 'Bearer ' + String(channel.apiKey).replace(/^\s*Bearer\s+/i, '').trim();
  const res = await fetchBuffer(absolute, { headers, timeoutMs: 300000 });
  let ext = '.mp4';
  try {
    ext = path.extname(new URL(absolute).pathname) || '.mp4';
  } catch { /* keep mp4 */ }
  if (!/^\.(mp4|webm|mov|m4v)$/i.test(ext)) ext = /webm/i.test(res.contentType) ? '.webm' : '.mp4';
  const name = '01-video' + ext.toLowerCase();
  const file = path.join(dir, name);
  fs.writeFileSync(file, res.buffer);
  job.outputs.push({ type: 'video', name, path: file, bytes: res.buffer.length, url: absolute });
  log(job, 'info', `已下载 ${name}（${formatBytes(res.buffer.length)}）`);
  writeJobMeta(job, dir, {
    apiUrl: channel.baseUrl,
    worker: channel.name,
    inputValues: {
      channelId: channel.id,
      channel: channel.name,
      type: channel.type,
      model: channel.model,
      size: genericVideo.sizeFor(job.aspectRatio),
      duration: job.duration,
      seed: job.seed,
    },
  });
  job.stage = '完成';
}

async function runManagerVideo(job, wf, a, slot) {
  const channel = channels.get('video', slot.id);
  if (!channel) throw new Error('管理器渠道已删除，请重新选择');
  const platform = wf.platform || (slot && slot.platform) || 'doubao';
  job.apiUrl = managerVideo.baseUrl(channel);
  job.stage = '提交到管理器…';
  touch(job, { progress: 10 });
  log(job, 'info', `管理器渠道「${channel.name}」· ${managerVideo.PLATFORM_LABEL[platform] || platform}`);
  const submitted = job.resumeRemote && job.remotePromptId
    ? { taskId: job.remotePromptId, account: { name: '原任务账号' } }
    : await managerVideo.submit(channel, job, platform);
  job.remotePromptId = submitted.taskId;
  log(job, 'info', `已交给管理器账号「${submitted.account.name}」，任务 ${submitted.taskId}`);
  touch(job, { progress: 18, stage: '生成中…' });

  const started = Date.now();
  let result = null;
  while (Date.now() - started < JOB_TIMEOUT_MS) {
    checkCanceled(job, a);
    await sleep(5000);
    checkCanceled(job, a);
    result = await managerVideo.poll(channel, submitted.taskId);
    if(job.runId)workbenchStore.store().execution(job.runId,result);
    if (result.status === 'failed') throw new Error('管理器任务失败：' + (result.message || result.rawStatus));
    if (result.status === 'success') break;
    const byTime = 18 + Math.round((Date.now() - started) / 1000 / 4);
    touch(job, {
      progress: Math.min(88, Number(result.progress) > 0 ? Math.max(18, Math.min(88, result.progress)) : byTime),
      stage: result.message ? '生成中 · ' + String(result.message).slice(0, 40) : '生成中…',
    });
  }
  if (!result || result.status !== 'success') throw new Error('管理器生成超时或未返回成片');

  job.stage = '下载成片…';
  touch(job, { progress: 92 });
  const dir = jobDir(job);
  job.outputDir = dir;
  const { buffer, contentType } = await managerVideo.download(channel, submitted.taskId);
  const ext = /webm/i.test(contentType) ? '.webm' : '.mp4';
  const name = '01-video' + ext;
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  job.outputs.push({ type: 'video', name, path: file, bytes: buffer.length, url: managerVideo.baseUrl(channel) + '/api/tasks/' + submitted.taskId + '/file' });
  log(job, 'info', `已下载 ${name}（${formatBytes(buffer.length)}）`);
  writeJobMeta(job, dir, {
    apiUrl: managerVideo.baseUrl(channel),
    worker: channel.name + ' · ' + (managerVideo.PLATFORM_LABEL[platform] || platform),
    inputValues: {
      channelId: channel.id,
      channel: channel.name,
      platform,
      model: channel.model || '',
      duration: job.duration,
      ratio: managerVideo.shortAspect(job.aspectRatio),
      managerTaskId: submitted.taskId,
      managerAccount: submitted.account.name,
    },
  });
  job.stage = '完成';
}

const clientIds = new Map();
function getClientId(base) {
  const key = String(base || '');
  if (!clientIds.has(key)) clientIds.set(key, 'h3-desktop-' + uid('').slice(0, 8));
  return clientIds.get(key);
}

module.exports = {
  emitter,
  loadState,
  list,
  get,
  addJobs,
  cancel,
  retry,
  resume,
  remove,
  setHeld,
  reorder,
  pump,
  slotStats,
  readLog,
  flushState,
};
