'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const config = require('./config');
const db = require('./db');
const quotas = require('./quotas');
const processLog = require('./process-log');
const tenantContext = require('./tenant-context');
const tenantScope = require('./tenant-scope');
const projects = require('./projects');
const workspace = require('./workspace');
const projectPaths = require('./project-paths');
const workbenchStore = require('./workbench-store');
const workflows = require('./workflows');
const providers = require('./providers');
const channels = require('./channels');
const videoPlugins=require('./video-plugins');
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
let dirty = new Set(); // 需要落库的任务 id

/* ------------------------------- 任务落库 ------------------------------- */

function repo() { return db.open(); }

function upsertJob(job) {
  const now = Date.now();
  const tenantId = job.tenantId || tenantScope.tenantOfProject(job.projectId) || 'tnt_default';
  repo().prepare(`INSERT INTO jobs(id, project_id, tenant_id, status, order_no, created_at, updated_at, data)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, tenant_id=excluded.tenant_id,
      status=excluded.status, order_no=excluded.order_no, updated_at=excluded.updated_at, data=excluded.data`)
    .run(
      String(job.id), String(job.projectId || ''), String(tenantId), String(job.status || ''),
      Number(job.order) || 0, Number(job.createdAt) || now, now, JSON.stringify(job),
    );
}

function deleteJobRow(id) {
  repo().prepare('DELETE FROM jobs WHERE id = ?').run(String(id));
}

function markDirty(job) {
  if (job && job.id) dirty.add(job.id);
}

/** 只写变更行；失败时把 id 放回脏集合，等下一次变更再试。 */
function flushDirty() {
  if (!dirty.size) return;
  const ids = [...dirty];
  dirty = new Set();
  const byId = new Map(state.jobs.map((job) => [job.id, job]));
  const conn = repo();
  conn.exec('BEGIN');
  try {
    for (const id of ids) {
      const job = byId.get(id);
      if (job) upsertJob(job);
      else deleteJobRow(id);
    }
    conn.exec('COMMIT');
  } catch (error) {
    try { conn.exec('ROLLBACK'); } catch { /* ignore */ }
    for (const id of ids) dirty.add(id);
    throw error;
  }
}

const IMPORT_MARK = 'jobs_import';

/**
 * 老版本的任务在 data/jobs.json 里。第一次启动新版本时导入一次：
 * 先备份 → 单事务写入 → 逐条校验 → 成功后才把原文件改名，失败保留原文件。
 */
function importLegacyJobs() {
  const conn = repo();
  if (conn.prepare('SELECT value FROM meta WHERE key = ?').get(IMPORT_MARK)) return;
  if (!fs.existsSync(STATE_FILE)) {
    conn.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)').run(IMPORT_MARK, String(Date.now()));
    return;
  }
  const raw = fs.readFileSync(STATE_FILE, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch (error) {
    throw new Error('jobs.json 不是合法 JSON，已保留原文件：' + error.message);
  }
  const rows = (Array.isArray(data && data.jobs) ? data.jobs : []).filter((job) => job && job.id);
  try { fs.copyFileSync(STATE_FILE, STATE_FILE + '.bak-' + Date.now()); } catch { /* 备份失败不阻塞导入 */ }
  conn.exec('BEGIN');
  try {
    for (const job of rows) {
      const createdAt = Number(job.createdAt) || Date.now();
      conn.prepare(`INSERT OR IGNORE INTO jobs(id, project_id, tenant_id, status, order_no, created_at, updated_at, data)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        String(job.id), String(job.projectId || ''), String(job.tenantId || 'tnt_default'), String(job.status || ''),
        Number(job.order) || 0, createdAt, createdAt, JSON.stringify(job),
      );
    }
    const missing = rows.filter((job) => !conn.prepare('SELECT 1 FROM jobs WHERE id = ?').get(String(job.id)));
    if (missing.length) throw new Error('任务导入不完整，缺少 ' + missing.length + ' 条');
    conn.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)').run(IMPORT_MARK, String(Date.now()));
    conn.exec('COMMIT');
  } catch (error) {
    try { conn.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
  try { fs.renameSync(STATE_FILE, STATE_FILE.replace(/\.json$/, '.imported.json')); } catch { /* 改名失败不影响数据 */ }
}

function loadState() {
  try { importLegacyJobs(); } catch (error) {
    // 导入失败时保留 jobs.json，服务继续用库里已有的任务，避免启动即挂。
    processLog.line('jobs-import-failed', error);
  }
  state.jobs = repo().prepare('SELECT tenant_id, data FROM jobs ORDER BY created_at, id').all().map((row) => {
    const job = JSON.parse(row.data);
    if (!job.tenantId) job.tenantId = row.tenant_id;
    return job;
  });
  for (const job of state.jobs) {
    if (job.status === 'running' || (job.status === 'queued' && job.remotePromptId && !job.eventId)) {
      job.status = 'interrupted';
      job.stage = '已中断（待对账）';
      job.error = job.provider === 'manager' && job.remotePromptId ? '服务重启，任务已中断；可点「继续查询／下载」恢复原任务' : '服务重启，任务已中断；可点「重试」重新提交';
      job.finishedAt = Date.now();
      job.progress = 0;
      markDirty(job);
    }
  }
  // 只落中断标记，不要在这里跑一遍工作台终态同步（那是任务结束时的职责）。
  try { flushDirty(); } catch (error) { processLog.line('jobs-flush-failed', error); }
  ensureDir(LOG_DIR);
}

let saveTimer = null;
function saveState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { flushDirty(); } catch (error) { processLog.line('jobs-flush-failed', error); }
  }, 120);
}

function flushState() {
  for(const job of state.jobs)if(job.runId&&['success','failed','canceled'].includes(job.status))workbenchStore.store().finish(job.runId,job.status,job.outputs||[],job.error);
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try { flushDirty(); } catch (error) { processLog.line('jobs-flush-failed', error); }
}

function sameProject(job, projectId) {
  const value = String(projectId == null ? '' : projectId);
  if (!value) return !job.projectId || job.projectId === 'unassigned';
  return String(job.projectId || '') === value;
}

/**
 * 不带参数时返回全部任务（调度器内部使用）；带 projectId 时只返回该项目的任务。
 * 传空字符串表示「未归档」。
 */
function list(projectId) {
  const rows = arguments.length ? state.jobs.filter((job) => sameProject(job, projectId)) : state.jobs;
  return rows.map((j) => ({ ...j, logs: undefined }));
}

function get(id) {
  return state.jobs.find((j) => j.id === id) || null;
}

function jobProjectRoot(job) {
  const project = job && job.projectId ? projects.get(job.projectId) : null;
  if (project) return workspace.pathsFor(project).media;
  return ensureDir(config.load().saveFolder);
}

function listByProjectPage(projectId, page = 1, size = 10) {
  const rows = list(projectId);
  const total = rows.length;
  const pageSize = Math.max(1, Number(size) || 10);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.max(1, Math.min(pages, Number(page) || 1));
  const sorted = rows.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { jobs: sorted.slice((current - 1) * pageSize, current * pageSize), total, page: current, pageSize };
}

/** 迁移：把没有项目归属的历史任务归到目标项目。 */
function adoptLegacy(projectId) {
  const target = String(projectId || '');
  if (!target) return 0;
  let changed = 0;
  for (const job of state.jobs) {
    if (job.projectId && job.projectId !== 'unassigned') continue;
    job.projectId = target;
    markDirty(job);
    changed += 1;
  }
  if (changed) flushState();
  return changed;
}

function log(job, level, text) {
  const entry = { t: Date.now(), level, text: String(text).slice(0, 1000) };
  job.logs = job.logs || [];
  job.logs.push(entry);
  if (job.logs.length > 300) job.logs.splice(0, job.logs.length - 300);
  markDirty(job);
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
  markDirty(job);
  saveState();
  emitter.emit('job', publicJob(job));
}

function slots() {
  const cfg = config.load();
  const out = [];
  for (const key of cfg.autodlKeys.filter((k) => k.enabled)) out.push({ key: 'key:' + key.id, provider: 'autodl', id: key.id, name: key.name });
  for(const ch of (cfg.channels.video||[]).filter(c=>c.enabled!==false)){const plugin=videoPlugins.forType(ch.type);if(plugin)out.push(...plugin.adapter.slots(ch,cfg));}
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
      let next, slot, nextTenant = '';
      for (const candidate of queued) {
        // 每个任务按所属项目切到对应租户，否则会拿到别的租户的渠道和工作流。
        const tenantId = candidate.tenantId || tenantScope.tenantOfProject(candidate.projectId);
        const quota = quotas.get(tenantId);
        if (quota.maxConcurrentTasks) {
          const running = state.jobs.filter((job) => job.status === 'running' && (job.tenantId || '') === tenantId).length;
          if (running >= quota.maxConcurrentTasks) continue;
        }
        const picked = tenantContext.run(tenantId, () => {
          const wf = workflows.get(candidate.workflowId);
          if (!wf) return { missing: true };
          return { wf, slot: availableSlot(wf.provider, wf.channelId, wf.platform) };
        });
        if (picked.missing) {
          failJob(candidate, new Error('工作流不存在或渠道已停用'));
          continue;
        }
        if (!picked.slot) continue;
        next = candidate;
        slot = picked.slot;
        nextTenant = tenantId;
        break;
      }
      if (!next) break;
      slotBusy.set(slot.key, next.id);
      active.set(next.id, { slot, canceled: false });
      next.slotName = slot.name;
      if (slot.provider === 'autodl') next.keyId = slot.id;
      else next.channelId = slot.id;
      if (slot.provider === 'manager') next.platform = slot.platform;
      tenantContext.run(nextTenant, () => run(next, slot)).catch((err) => {
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
  const tenantId = config.load().tenantId;
  quotas.assertStorage(tenantId, 0);
  // 排队不占并发；只有直接开跑的任务在创建时检查一次，后台 pump 还会再兜底。
  if (!input.held) quotas.assertConcurrent(tenantId, count);
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
      held: !!input.held,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      projectId: input.projectId || 'unassigned',
      // 记下创建时的租户；后台执行不再依赖请求上下文。
      tenantId,
      itemId: input.itemId || null,
      eventId: input.eventId || null,
      eventItemId: input.eventItemId || null,
      taskTitle: String(input.taskTitle || ''),
      shotLabel: String(input.shotLabel || ''),
      model:input.model||null,
      userPrompt: input.userPrompt == null ? prompt : input.userPrompt,
      prefixPrompt: input.prefixPrompt,
      styleId: input.styleId,
      workflowId: wf.id,
      pluginId: wf.pluginId,
      pluginVersion: wf.pluginVersion,
      provider: wf.provider,
      channelId: wf.channelId || null,
      platform: wf.platform || '',
      prompt,
      images: (input.images || []).filter(Boolean),
      audios: (input.audios || []).filter(Boolean),
      videos: (input.videos || []).filter(Boolean),
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
    job.runId = workbenchStore.store().begin({...job,kind:'video',jobId:job.id,channelName:(channels.get('video',job.channelId)||{}).name,model:job.model||(channels.get('video',job.channelId)||{}).model});
    state.jobs.push(job);
    markDirty(job);
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

function reconcile(id, patch = {}) {
  const job = get(id);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: Date.now() });
  log(job, 'info', '重启对账：' + (patch.stage || patch.status || ''));
  touch(job);
  saveState();
  return job;
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
    if(job.remotePromptId&&job.channelId){
      const channel=channels.get('video',job.channelId);const plugin=channel&&videoPlugins.forType(channel.type);
      if(plugin?.adapter.cancel)Promise.resolve().then(()=>plugin.adapter.cancel(channel,job.remotePromptId)).then(ok=>log(job,'warn',ok?'已请求渠道取消远程任务':'渠道未确认取消')).catch(err=>log(job,'warn','远程取消失败：'+err.message));
    }
    touch(job);
    return job;
  }
  throw new Error('任务已结束，无法取消');
}

async function resume(id){
 const job=get(id);if(!job)throw Error('任务不存在');
 const wf=workflows.get(job.workflowId);const plugin=job.pluginId?videoPlugins.requireVersion(job.pluginId,job.pluginVersion):wf&&videoPlugins.forWorkflow(wf);
 if(!plugin?.adapter.resumeJob)throw Error('该渠道插件不支持继续原任务');
 return plugin.adapter.resumeJob(job,videoContext(job,wf));
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
  job.failureAnalysis = null;
  job.failureCategory = '';
  job.failureReason = '';
  job.failureAdvice = '';
  job.outputs = [];
  job.startedAt = null;
  job.finishedAt = null;
  job.logs = [];
  job.held = false;
  job.resumeRemote = false;job.remotePromptId=null;
  log(job, 'info', '重新排队');
  touch(job);
  setImmediate(pump);
  return job;
}

/**
 * 修改一条已结束任务的提示词，供「失败后改词重试」使用。
 * 只改本地提交快照；真正重新提交仍由 retry() 负责，避免误触发生成。
 */
function revisePrompt(id, patch = {}) {
  const job = get(id);
  if (!job) throw new Error('任务记录不存在');
  if (job.status === 'queued' || job.status === 'running') throw new Error('任务正在执行，不能修改提示词');
  const before = String(job.prompt || '').length;
  if (patch.prompt != null) job.prompt = String(patch.prompt);
  if (patch.userPrompt != null) job.userPrompt = String(patch.userPrompt);
  if (patch.prefixPrompt != null) job.prefixPrompt = String(patch.prefixPrompt);
  // 模型 / 画幅也是要发给管理器的参数，改完随重试一起生效
  const notes = [];
  if (patch.model != null && String(patch.model).trim() !== String(job.model || '').trim()) {
    notes.push(`模型 ${job.model || '默认'} → ${String(patch.model).trim() || '默认'}`);
    job.model = String(patch.model).trim() || null;
  }
  if (patch.aspectRatio != null && String(patch.aspectRatio).trim() !== String(job.aspectRatio || '').trim()) {
    notes.push(`画幅 ${job.aspectRatio || '—'} → ${String(patch.aspectRatio).trim()}`);
    job.aspectRatio = String(patch.aspectRatio).trim();
  }
  if (patch.duration != null && Number(patch.duration) && Number(patch.duration) !== Number(job.duration)) {
    notes.push(`时长 ${job.duration} → ${Number(patch.duration)} 秒`);
    job.duration = Number(patch.duration);
  }
  // 参考图：重试时按新顺序（图1、图2…）重新上传给管理器
  if (Array.isArray(patch.images)) {
    const hadImages = (job.images || []).length;
    job.images = patch.images.filter(Boolean);
    notes.push(`参考图 ${hadImages} → ${job.images.length} 张`);
  }
  job.excerpt = deriveExcerpt(job.prompt);
  log(job, 'info', `提示词已修改（${before} → ${String(job.prompt || '').length} 字）${notes.length ? '；' + notes.join('；') : ''}，等待重试`);
  touch(job);
  return publicJob(job);
}

/** 给旧任务补分镜名/任务名，保证重试出来的成片不再叫 01-video。 */
function setShotMeta(id, patch = {}) {
  const job = get(id);
  if (!job) return null;
  if (patch.shotLabel != null) job.shotLabel = String(patch.shotLabel);
  if (patch.taskTitle != null) job.taskTitle = String(patch.taskTitle);
  markDirty(job);
  saveState();
  emitter.emit('job', publicJob(job));
  return publicJob(job);
}

function remove(id) {
  const idx = state.jobs.findIndex((j) => j.id === id);
  if (idx < 0) throw new Error('任务不存在');
  if (state.jobs[idx].status === 'running') throw new Error('任务正在执行，先取消再删除');
  state.jobs.splice(idx, 1);
  dirty.delete(id);
  deleteJobRow(id);
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
    if (job) { job.order = base + index + 1; markDirty(job); }
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
    require('./task-assets').verify(job);
    const wf = workflows.get(job.workflowId);
    if (!wf) throw new Error('工作流不存在');
    const check = workflows.validate(wf, job);
    if (check.errors.length) throw new Error(check.errors.join('；'));
    const plugin=job.pluginId?videoPlugins.requireVersion(job.pluginId,job.pluginVersion):videoPlugins.forWorkflow(wf);
    if(!plugin)throw Error('视频渠道插件未安装');
    await plugin.adapter.execute(videoContext(job,wf,a,slot));
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
  const dir = path.join(jobProjectRoot(job), dayFolder(), job.id + (job.outputVersion ? '-'+job.outputVersion : ''));
  ensureDir(dir);
  return dir;
}

function writeJobMeta(job, dir, extra = {}) {
  const wf = workflows.get(job.workflowId);
  const params = {
    id: job.id,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    title: job.title || '',
    shotLabel: job.shotLabel || '',
    taskTitle: job.taskTitle || '',
    eventId: job.eventId || '',
    eventItemId: job.eventItemId || '',
    prompt: job.prompt,
    userPrompt: job.userPrompt,
    prefixPrompt: job.prefixPrompt,
    styleId: job.styleId,
    projectId: job.projectId,
    itemId: job.itemId,
    workflowId: job.workflowId,
    pluginId: job.pluginId,
    pluginVersion: job.pluginVersion,
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

/** 成片按分镜名落盘；没有分镜名的旧任务继续用 01-video 这类编号。 */
function outputName(job, kind, ext, index = 1) {
  const label = sanitizeFilename(String(job.shotLabel || ''), '');
  const suffix = index > 1 ? '-' + index : '';
  if (label) return label + suffix + ext;
  return String(index).padStart(2, '0') + '-' + kind + suffix + ext;
}

/** 批量把已有成片改成目标文件名；同时更新 jobs.json 和落盘 params.json。 */
function renameOutputs(plan) {
  if (!Array.isArray(plan) || !plan.length) return { moved: [] };
  const keyOf = (file) => path.resolve(file).toLowerCase();
  const rows = plan
    .map((row) => ({ ...row, from: path.resolve(row.oldPath), to: path.resolve(row.newPath) }))
    .filter((row) => keyOf(row.from) !== keyOf(row.to));
  if (!rows.length) return { moved: [] };
  const oldPaths = new Set(rows.map((row) => keyOf(row.from)));
  const targets = new Set();
  for (const row of rows) {
    if (!fs.existsSync(row.from)) throw new Error('文件不存在：' + row.from);
    const target = keyOf(row.to);
    if (targets.has(target)) throw new Error('多个成片要改成同一个文件名：' + row.to);
    if (fs.existsSync(row.to) && !oldPaths.has(target)) throw new Error('目标文件已存在：' + row.to);
    targets.add(target);
  }
  const prepared = [];
  try {
    rows.forEach((row, index) => {
      const job = state.jobs.find((j) => (j.outputs || []).some((out) => out.path && keyOf(out.path) === keyOf(row.from)));
      const out = job ? (job.outputs || []).find((item) => item.path && keyOf(item.path) === keyOf(row.from)) : null;
      const temp = row.from + '.rename-' + process.pid + '-' + index;
      fs.renameSync(row.from, temp);
      prepared.push({ ...row, job, out, temp });
    });
  } catch (err) {
    for (const row of prepared) {
      try { fs.renameSync(row.temp, row.from); } catch { /* 尽力恢复 */ }
    }
    throw err;
  }
  const moved = [];
  for (const row of prepared) {
    fs.renameSync(row.temp, row.to);
    if (row.job && row.out) {
      markDirty(row.job);
      row.out.name = path.basename(row.to);
      row.out.path = row.to;
      row.job.outputDir = path.dirname(row.to);
      try {
        const file = path.join(path.dirname(row.to), 'params.json');
        const params = readJson(file, null);
        if (params) {
          params.outputs = Array.isArray(params.outputs)
            ? params.outputs.map((item) => item.file === path.basename(row.from) ? { ...item, file: path.basename(row.to) } : item)
            : params.outputs;
          params.outputLabel = path.basename(row.to, path.extname(row.to));
          params.taskTitle = row.job.taskTitle || row.taskTitle || params.taskTitle || '';
          params.shotLabel = row.job.shotLabel || row.shotTitle || params.shotLabel || '';
          params.eventId = row.job.eventId || params.eventId || '';
          params.eventItemId = row.job.eventItemId || params.eventItemId || '';
          writeJson(file, params);
        }
      } catch { /* 元数据失败不影响文件已经改名 */ }
    }
    moved.push({ from: row.from, to: row.to, jobId: row.job ? row.job.id : '' });
  }
  if (moved.length) {
    saveState();
    emitter.emit('refresh');
  }
  return { moved };
}

/**
 * 手动维护成片：重命名 / 删除 / 替换。
 * 三条路径都保持 jobs.json、落盘 params.json 与磁盘文件一致；
 * 删除和替换不会真正销毁旧文件，而是移到 <项目>/media/_trash/<日期>/ 里，随时能找回。
 */
function findOutput(jobId, outPath) {
  const job = get(jobId);
  if (!job) throw Object.assign(new Error('任务不存在'), { status: 404 });
  const key = path.resolve(String(outPath || '')).toLowerCase();
  const out = (job.outputs || []).find((item) => item.path && path.resolve(item.path).toLowerCase() === key);
  if (!out) throw Object.assign(new Error('这个任务里没有这条成片'), { status: 404 });
  return { job, out };
}

function trashDirFor(job) {
  return ensureDir(path.join(jobProjectRoot(job), '_trash', dayFolder()));
}

function parkFile(job, file, suffix = '') {
  const dir = trashDirFor(job);
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  let target = path.join(dir, base + suffix + ext);
  let i = 2;
  while (fs.existsSync(target)) { target = path.join(dir, `${base}${suffix} (${i})${ext}`); i++; }
  fs.renameSync(file, target);
  return target;
}

function syncParamsOutputs(job) {
  const dir = job.outputDir || (job.outputs && job.outputs[0] ? path.dirname(job.outputs[0].path) : '');
  if (!dir) return;
  const file = path.join(dir, 'params.json');
  const params = readJson(file, null);
  if (!params) return;
  params.outputs = (job.outputs || []).map((item) => ({ type: item.type, file: item.name, bytes: item.bytes, url: item.url }));
  writeJson(file, params);
}

/** 重命名成片：文件名、jobs.json、params.json 一起改。 */
function renameOutput(jobId, outPath, newName) {
  const { job, out } = findOutput(jobId, outPath);
  const ext = path.extname(out.path) || '.mp4';
  let clean = sanitizeFilename(String(newName || '').trim(), '');
  if (!clean) throw Object.assign(new Error('文件名不能为空'), { status: 400 });
  if (!clean.toLowerCase().endsWith(ext.toLowerCase())) clean += ext;
  const next = path.join(path.dirname(out.path), clean);
  if (path.resolve(next).toLowerCase() === path.resolve(out.path).toLowerCase()) return { job, out, moved: null };
  const result = renameOutputs([{ oldPath: out.path, newPath: next, shotTitle: out.name }]);
  const fresh = get(job.id);
  return { job: fresh, out: (fresh.outputs || []).find((item) => path.resolve(item.path).toLowerCase() === path.resolve(next).toLowerCase()) || out, moved: result.moved[0] || null };
}

/** 删除成片：文件挪进回收目录，任务里的这条输出记录一并去掉。 */
function deleteOutput(jobId, outPath) {
  const { job, out } = findOutput(jobId, outPath);
  let parked = '';
  if (fs.existsSync(out.path)) parked = parkFile(job, out.path, '');
  job.outputs = (job.outputs || []).filter((item) => item !== out);
  log(job, 'info', `成片 ${out.name} 已删除${parked ? '（可在 ' + path.basename(path.dirname(parked)) + '/_trash 找回）' : ''}`);
  touch(job);
  syncParamsOutputs(job);
  return { removed: { name: out.name, path: out.path }, parked, job };
}

/** 替换成片：旧文件进回收目录，新文件（已经落盘的临时文件）顶到原来的位置。 */
function replaceOutput(jobId, outPath, tempFile, options = {}) {
  const { job, out } = findOutput(jobId, outPath);
  if (!tempFile || !fs.existsSync(tempFile)) throw Object.assign(new Error('上传的文件不存在'), { status: 400 });
  const ext = path.extname(tempFile) || path.extname(out.path) || '.mp4';
  const wanted = sanitizeFilename(String(options.name || '').trim(), '');
  let clean = wanted || path.basename(out.path, path.extname(out.path)) + ext;
  if (!clean.toLowerCase().endsWith(ext.toLowerCase())) clean += ext;
  const target = path.join(path.dirname(out.path), clean);
  let parked = '';
  if (fs.existsSync(out.path)) parked = parkFile(job, out.path, '-替换前');
  if (path.resolve(target).toLowerCase() !== path.resolve(tempFile).toLowerCase()) fs.renameSync(tempFile, target);
  const bytes = fs.statSync(target).size;
  out.name = path.basename(target);
  out.path = target;
  out.bytes = bytes;
  out.replacedAt = Date.now();
  job.outputDir = path.dirname(target);
  log(job, 'info', `成片已替换为 ${out.name}（${formatBytes(bytes)}）`);
  touch(job);
  syncParamsOutputs(job);
  return { out, parked, job };
}

/** 给原本没有成片的任务补一条：把上传的临时文件搬进任务目录并登记。 */
function addOutput(jobId, tempFile, options = {}) {
  const job = get(jobId);
  if (!job) throw Object.assign(new Error('任务不存在'), { status: 404 });
  if (!tempFile || !fs.existsSync(tempFile)) throw Object.assign(new Error('上传的文件不存在'), { status: 400 });
  const dir = ensureDir(job.outputDir || path.join(jobProjectRoot(job), dayFolder(), job.id + (job.outputVersion ? '-' + job.outputVersion : '')));
  const ext = path.extname(tempFile) || '.mp4';
  let clean = sanitizeFilename(String(options.name || '').trim(), '');
  if (!clean) clean = '成片' + ext;
  if (!clean.toLowerCase().endsWith(ext.toLowerCase())) clean += ext;
  let target = path.join(dir, clean);
  let i = 2;
  while (fs.existsSync(target)) { target = path.join(dir, path.basename(clean, ext) + ' (' + i + ')' + ext); i++; }
  fs.copyFileSync(tempFile, target);
  fs.rmSync(tempFile, { force: true });
  const bytes = fs.statSync(target).size;
  job.outputDir = dir;
  job.outputs = Array.isArray(job.outputs) ? job.outputs : [];
  const out = { type: 'video', name: path.basename(target), path: target, bytes, url: '' };
  projectPaths.attach(job.projectId, out);
  job.outputs.push(out);
  log(job, 'info', `手动上传成片 ${out.name}（${formatBytes(bytes)}）`);
  touch(job);
  syncParamsOutputs(job);
  return { out, job };
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
    const name = outputName(job, kind, ext, index);
    const file = path.join(dir, name);
    fs.writeFileSync(file, res.buffer);
    job.outputs.push(projectPaths.attach(job.projectId, { type: kind, name, path: file, bytes: res.buffer.length, url: item.url }));
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

function videoContext(job,wf,a,slot){return {job,workflow:wf,signal:a,slot,config,channels,touch,log,checkCanceled,sleep,timeoutMs:JOB_TIMEOUT_MS,dataUrl,formatBytes,jobDir,saveOutputs,writeJobMeta,outputName,workbenchStore,fetchBuffer,failJob,flushState,pump};}
const clientIds = new Map();
function getClientId(base) {
  const key = String(base || '');
  if (!clientIds.has(key)) clientIds.set(key, 'wmd-desktop-' + uid('').slice(0, 8));
  return clientIds.get(key);
}

module.exports = {
  emitter,
  loadState,
  list,
  listByProjectPage,
  adoptLegacy,
  jobProjectRoot,
  get,
  addJobs,
  cancel,
  retry,
  revisePrompt,
  renameOutputs,
  findOutput,
  renameOutput,
  deleteOutput,
  replaceOutput,
  addOutput,
  setShotMeta,
  resume,
  remove,
  setHeld,
  reorder,
  pump,
  slotStats,
  readLog,
  reconcile,
  flushState,
};
