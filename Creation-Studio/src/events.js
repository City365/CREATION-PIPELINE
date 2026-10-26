'use strict';
/**
 * 任务事件（Event）：把"一次创建动作"聚合成一个可调度、可监控的对象。
 * 事件只做聚合与统计，真正的执行仍由 jobs.js / image-tasks.js 负责。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const jobs = require('./jobs');

const state = { events: [] };
const FILE = () => path.join(config.load().dataDir || config.DATA, 'events.json');
const MAX_EVENTS = 200;

function uid() {
  return 'evt_' + Date.now().toString(36) + '_' + crypto.randomUUID().slice(0, 8);
}

function file() {
  try { return FILE(); } catch { return path.join(config.DATA, 'events.json'); }
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    state.events = Array.isArray(data.events) ? data.events : [];
  } catch {
    state.events = [];
  }
  return state.events;
}

function save() {
  let target;
  try { target = file(); } catch { return; }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, events: state.events.slice(0, MAX_EVENTS) }, null, 2));
    fs.renameSync(tmp, target);
  } catch { /* 事件存储失败不能影响任务执行 */ }
}

function imageTasks() {
  try { return require('./image-tasks').tasks(); } catch { return null; }
}

function normalizeRef(refType, refId, extra = {}) {
  return {
    id: extra.id || uid() + '_i',
    refType,
    refId: String(refId),
    title: String(extra.title || '').slice(0, 80),
    status: extra.status || 'queued',
    error: null,
    attempts: 0,
    cancelMode: extra.cancelMode || 'local',
    billing: extra.billing || 'on-submit',
  };
}

function itemStatus(source) {
  const status = String(source || '');
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  if (status === 'canceled' || status === 'cancelled') return 'canceled';
  if (status === 'running') return 'running';
  if (status === 'paused' || status === 'held') return 'paused';
  if (status === 'interrupted') return 'unknown';
  if (status === 'queued') return 'queued';
  return 'queued';
}

function hydrate(event, context = {}) {
  const jobMap = context.jobMap instanceof Map ? context.jobMap : new Map(jobs.list().map((j) => [j.id, j]));
  const worker = context.worker === undefined ? imageTasks() : context.worker;
  const imageMap = new Map();
  if (worker) {
    for (const item of event.items || []) {
      if (item.refType !== 'imageTask' || imageMap.has(item.refId)) continue;
      try { imageMap.set(item.refId, worker.get(item.refId)); } catch { /* gone */ }
    }
  }
  const items = (event.items || []).map((item) => {
    if (item.override === 'skipped') return { ...item, status: 'skipped', error: item.error || null };
    let source = null;
    if (item.refType === 'job') source = jobMap.get(item.refId);
    else if (item.refType === 'imageTask') source = imageMap.get(item.refId);
    if (!source) {
      return { ...item, status: item.status === 'queued' ? 'unknown' : item.status, error: item.error || '任务记录已不存在' };
    }
    return {
      ...item,
      status: itemStatus(source.status),
      reconcile: source.status === 'interrupted',
      error: source.error || null,
      progress: Number(source.progress || 0),
      startedAt: source.startedAt || null,
      finishedAt: source.finishedAt || null,
    };
  });
  if (!items.length) {
    return { ...event, items, stats: { total: 0, queued: 0, running: 0, paused: 0, done: 0, failed: 0, canceled: 0, skipped: 0, unknown: 0 }, status: 'draft', updatedAt: Date.now() };
  }
  const stats = { total: items.length, queued: 0, running: 0, paused: 0, done: 0, failed: 0, canceled: 0, skipped: 0, unknown: 0 };
  for (const item of items) {
    if (item.status === 'running') stats.running += 1;
    else if (item.status === 'queued') stats.queued += 1;
    else if (item.status === 'paused') stats.paused += 1;
    else if (item.status === 'success') { stats.done += 1; }
    else if (item.status === 'canceled') stats.canceled += 1;
    else if (item.status === 'unknown') stats.unknown += 1;
    else stats.failed += 1;
  }
  stats.done += stats.canceled + stats.skipped;
  const started = items.map((i) => i.startedAt).filter(Boolean).sort()[0] || event.startedAt || null;
  const finished = items.every((i) => ['success', 'failed', 'canceled', 'skipped', 'unknown'].includes(i.status))
    ? (items.map((i) => i.finishedAt).filter(Boolean).sort().pop() || event.finishedAt || Date.now())
    : null;
  let status = event.status;
  if (stats.running > 0) status = 'running';
  else if (stats.queued > 0 && finished === null) status = 'queued';
  else if (finished !== null) {
    if (stats.done === stats.total) status = stats.canceled === stats.total ? 'canceled' : 'completed';
    else if (stats.failed === 0 && stats.canceled > 0) status = 'canceled';
    else if (stats.failed > 0 && stats.done > 0) status = 'partial';
    else if (stats.unknown > 0 && stats.failed === 0 && items.some((item) => item.reconcile)) status = 'interrupted';
    else status = 'failed';
  }
  if (event.canceled && !['running', 'queued'].includes(status)) status = 'canceled';
  if (event.paused && !['completed', 'failed', 'partial', 'canceled'].includes(status)) status = 'paused';
  return {
    ...event,
    items,
    stats,
    status,
    startedAt: started,
    finishedAt: finished,
    updatedAt: Date.now(),
  };
}

function list(filter = {}) {
  load();
  let events = state.events.map(hydrate);
  if (filter.status) events = events.filter((e) => e.status === filter.status);
  if (filter.source) events = events.filter((e) => e.source === filter.source);
  const summary = { total: events.length, running: 0, queued: 0, completed: 0, failed: 0, partial: 0 };
  for (const event of events) if (summary[event.status] !== undefined) summary[event.status] += 1;
  const limit = Math.max(1, Math.min(200, Number(filter.limit) || 50));
  return { events: events.slice(0, limit), stats: summary };
}

function get(id) {
  load();
  const raw = state.events.find((e) => e.id === id);
  if (!raw) { const error = new Error('事件不存在'); error.status = 404; error.code = 'EVENT_NOT_FOUND'; throw error; }
  return hydrate(raw);
}

function create(input = {}) {
  load();
  const items = Array.isArray(input.items) ? input.items : [];
  const event = {
    schemaVersion: 1,
    id: uid(),
    title: String(input.title || '').trim().slice(0, 120) || ('事件 ' + new Date().toLocaleString('zh-CN', { hour12: false })),
    source: ['batch', 'studio', 'image', 'api'].includes(input.source) ? input.source : 'api',
    spec: {
      channelId: String(input.channelId || ''),
      workflowId: String(input.workflowId || ''),
      projectId: String(input.projectId || ''),
      itemId: input.itemId || null,
      items: items.map((item) => ({
        key: String(item.key || ''),
        title: String(item.title || '').slice(0, 80),
        prompt: String(item.prompt || '').slice(0, 20000),
        images: Array.isArray(item.images) ? item.images : [],
        params: item.params || {},
      })),
    },
    policy: {
      concurrency: Math.max(1, Math.min(4, Number(input.policy?.concurrency) || 1)),
      onItemFail: input.policy?.onItemFail === 'stop' ? 'stop' : 'continue',
      retries: Math.max(0, Math.min(3, Number(input.policy?.retries) || 0)),
    },
    schedule: { order: Number(input.schedule?.order) || 0, startAt: input.schedule?.startAt || null },
    status: 'queued',
    items: [],
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  state.events.unshift(event);
  save();
  return event;
}

function attach(event, refType, refId, extra = {}) {
  const item = normalizeRef(refType, refId, extra);
  event.items.push(item);
  save();
  return item;
}

function createFromJobInputs(inputs, meta = {}) {
  if (!Array.isArray(inputs) || !inputs.length) {
    const error = new Error('没有可创建的任务条目'); error.status = 400; error.code = 'INVALID_SPEC'; throw error;
  }
  const event = create({ ...meta, items: inputs.map((input) => ({ title: input.title, prompt: input.prompt })) });
  for (const input of inputs) {
    const created = jobs.addJobs({ ...input, eventId: event.id });
    for (const job of created) {
      attach(event, 'job', job.id, { title: job.title, cancelMode: 'local' });
      try { jobs.setHeld(job.id, true); } catch { /* 调度器会兜底 */ }
    }
  }
  setTimeout(tick, 50);
  return get(event.id);
}

function recordJobs(created, source = 'studio') {
  if (!Array.isArray(created) || !created.length) return null;
  try {
    const first = created[0];
    const event = create({
      title: created.length > 1 ? (first.title + ' 等 ' + created.length + ' 条') : first.title,
      source,
      channelId: first.channelId || '',
      workflowId: first.workflowId || '',
      projectId: first.projectId || '',
      itemId: first.itemId || null,
      items: created.map((job) => ({ title: job.title, prompt: job.prompt })),
    });
    for (const job of created) attach(event, 'job', job.id, { title: job.title });
    save();
    return event.id;
  } catch {
    return null;
  }
}

function recordSingleJob(job, source = 'studio') {
  return recordJobs([job], source);
}

function recordSingleImage(task, source = 'image') {
  try {
    const event = create({
      title: (task.snapshot?.userPrompt || task.snapshot?.prompt || '单张图像任务').slice(0, 60),
      source,
      channelId: task.snapshot?.channelId || '',
      projectId: task.projectId || '',
      itemId: task.itemId || null,
      items: [{ title: '图像生成', prompt: task.snapshot?.userPrompt || '' }],
    });
    attach(event, 'imageTask', task.id, { title: '图像生成', cancelMode: 'none', billing: 'on-submit' });
    save();
    return event.id;
  } catch {
    return null;
  }
}

function itemLog(eventId, itemId) {
  const event = get(eventId);
  const item = event.items.find((i) => i.id === itemId);
  if (!item) { const error = new Error('条目不存在'); error.status = 404; throw error; }
  if (item.refType === 'job') return { item, lines: jobs.readLog(item.refId) };
  const worker = imageTasks();
  if (!worker) return { item, lines: [] };
  try {
    const task = worker.get(item.refId);
    return { item, lines: (task.logs || []).map((l) => ({ t: l.time, level: l.level, text: l.message })) };
  } catch {
    return { item, lines: [] };
  }
}

/* ---------------- 调度与整组控制（P2） ---------------- */

let tickTimer = null;
const TERMINAL_ITEM = new Set(['success', 'failed', 'canceled', 'skipped', 'unknown']);

function rawEvent(id) {
  load();
  const raw = state.events.find((e) => e.id === id);
  if (!raw) { const error = new Error('事件不存在'); error.status = 404; error.code = 'EVENT_NOT_FOUND'; throw error; }
  return raw;
}

function jobMapNow() {
  return new Map(jobs.list().map((j) => [j.id, j]));
}

function itemStatusOf(item, jobMap) {
  if (item.override === 'skipped') return 'skipped';
  if (item.override === 'canceled') return 'canceled';
  const job = jobMap.get(item.refId);
  return job ? itemStatus(job.status) : 'unknown';
}

function tick() {
  if (!state.events.length) return;
  load();
  const map = jobMapNow();
  let changed = false;
  for (const event of state.events) {
    if (event.paused || !event.items || !event.items.length) continue;
    if (TERMINAL_ITEM.has(event.lastStatus || '')) continue;
    const statuses = event.items.map((item) => itemStatusOf(item, map));
    if (statuses.every((status) => TERMINAL_ITEM.has(status))) continue;
    if (event.policy && event.policy.onItemFail === 'stop' && statuses.includes('failed')) {
      for (const [index, item] of event.items.entries()) {
        if (statuses[index] === 'running' || statuses[index] === 'queued') {
          if (statuses[index] === 'queued') { try { jobs.cancel(item.refId); } catch { /* ignore */ } }
          item.override = 'skipped';
          changed = true;
        }
      }
      continue;
    }
    // 已放行但还在排队（未 hold）的条目同样占用并发名额
    const dispatched = event.items.filter((item) => { const job = map.get(item.refId); return job && job.status === 'queued' && !job.held; }).length;
    let running = statuses.filter((status) => status === 'running').length + dispatched;
    const limit = Math.max(1, Number(event.policy && event.policy.concurrency) || 1);
    for (const [index, item] of event.items.entries()) {
      if (running >= limit) break;
      if (statuses[index] !== 'queued') continue;
      const job = map.get(item.refId);
      if (!job || job.status !== 'queued') continue;
      try { jobs.setHeld(item.refId, false); running += 1; changed = true; } catch { /* ignore */ }
    }
  }
  if (changed) save();
}

function start() {
  if (tickTimer) return;
  tickTimer = setInterval(tick, 2000);
  if (tickTimer.unref) tickTimer.unref();
  tick();
}

function stop() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

function pauseEvent(id) {
  const event = rawEvent(id);
  const map = jobMapNow();
  event.paused = true;
  for (const item of event.items) {
    if (itemStatusOf(item, map) === 'queued') { try { jobs.setHeld(item.refId, true); } catch { /* ignore */ } }
  }
  save();
  return get(id);
}

function resumeEvent(id) {
  const event = rawEvent(id);
  event.paused = false;
  save();
  tick();
  return get(id);
}

function cancelEvent(id) {
  const event = rawEvent(id);
  const map = jobMapNow();
  event.canceled = true;
  for (const item of event.items) {
    const status = itemStatusOf(item, map);
    if (status === 'queued' || status === 'paused') {
      try { jobs.cancel(item.refId); } catch { /* ignore */ }
      item.override = 'canceled';
    }
  }
  save();
  return get(id);
}

function retryItem(id, itemId) {
  const event = rawEvent(id);
  const item = (event.items || []).find((i) => i.id === itemId);
  if (!item) { const error = new Error('条目不存在'); error.status = 404; throw error; }
  const map = jobMapNow();
  const status = itemStatusOf(item, map);
  if (!['failed', 'canceled', 'skipped', 'unknown'].includes(status)) {
    const error = new Error('条目还没结束，不能重试'); error.status = 409; error.code = 'EVENT_STATE_INVALID'; throw error;
  }
  if (item.refType === 'job') {
    try { jobs.retry(item.refId); } catch { /* ignore */ }
    try { jobs.setHeld(item.refId, true); } catch { /* ignore */ }
  }
  delete item.override;
  event.paused = false;
  event.canceled = false;
  save();
  setTimeout(tick, 50);
  return get(id);
}

function skipItem(id, itemId) {
  const event = rawEvent(id);
  const item = (event.items || []).find((i) => i.id === itemId);
  if (!item) { const error = new Error('条目不存在'); error.status = 404; throw error; }
  const map = jobMapNow();
  const status = itemStatusOf(item, map);
  if (['queued', 'paused'].includes(status)) { try { jobs.cancel(item.refId); } catch { /* ignore */ } }
  item.override = 'skipped';
  save();
  return get(id);
}

function retryFailed(id) {
  const event = rawEvent(id);
  const map = jobMapNow();
  let retried = 0;
  for (const item of event.items) {
    if (item.refType !== 'job') continue;
    const status = itemStatusOf(item, map);
    if (!['failed', 'canceled', 'unknown'].includes(status)) continue;
    try { jobs.retry(item.refId); jobs.setHeld(item.refId, true); delete item.override; retried += 1; } catch { /* ignore */ }
  }
  if (retried) { event.paused = false; event.canceled = false; save(); setTimeout(tick, 50); }
  return { event: get(id), retried };
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const position = (values.length - 1) * Math.min(1, Math.max(0, ratio));
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return Math.round(values[low] + (values[high] - values[low]) * (position - low));
}

function report(id, context = {}) {
  const event = get(id);
  const jobMap = context.jobMap instanceof Map ? context.jobMap : new Map(jobs.list().map((j) => [j.id, j]));
  const rows = (event.items || []).map((item) => {
    const job = item.refType === 'job' ? jobMap.get(item.refId) : null;
    const startedAt = (job && job.startedAt) || item.startedAt || null;
    const finishedAt = (job && job.finishedAt) || item.finishedAt || null;
    return {
      itemId: item.id,
      title: item.title || item.refId,
      refType: item.refType,
      refId: item.refId,
      status: job ? itemStatus(job.status) : item.status,
      provider: (job && job.provider) || '',
      platform: (job && job.platform) || '',
      channelId: (job && job.channelId) || '',
      error: String((job && job.error) || item.error || '').slice(0, 300),
      attempts: Number(item.attempts) || 0,
      startedAt,
      finishedAt,
      durationMs: startedAt && finishedAt ? Math.max(0, finishedAt - startedAt) : null,
    };
  });
  const stats = event.stats || {};
  const judged = (stats.done || 0);
  const success = rows.filter((row) => row.status === 'success').length;
  const failed = rows.filter((row) => row.status === 'failed').length;
  const canceled = rows.filter((row) => row.status === 'canceled').length;
  const skipped = rows.filter((row) => row.status === 'skipped').length;
  const unknown = rows.filter((row) => row.status === 'unknown').length;
  const denominator = success + failed;
  const durations = rows.map((row) => row.durationMs).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const failures = new Map();
  for (const row of rows) {
    if (row.status !== 'failed') continue;
    const key = [row.provider || 'unknown', row.channelId || '-', row.error.split('\n')[0].slice(0, 80) || '未知错误'].join(' | ');
    const bucket = failures.get(key) || { provider: row.provider, channelId: row.channelId, error: row.error, count: 0 };
    bucket.count += 1;
    failures.set(key, bucket);
  }
  return {
    eventId: event.id,
    title: event.title,
    status: event.status,
    source: event.source,
    createdAt: event.createdAt,
    startedAt: event.startedAt,
    finishedAt: event.finishedAt,
    total: rows.length,
    success,
    failed,
    canceled,
    skipped,
    unknown,
    judged,
    successRate: denominator ? Math.round((success / denominator) * 1000) / 10 : null,
    durationMs: {
      p50: percentile(durations, 0.5),
      p90: percentile(durations, 0.9),
      max: durations.length ? durations[durations.length - 1] : null,
    },
    failures: [...failures.values()].sort((a, b) => b.count - a.count),
    items: rows,
  };
}

function reportCsv(id, context = {}) {
  const data = report(id, context);
  const header = ['itemId', 'title', 'status', 'provider', 'channelId', 'durationMs', 'error'];
  const lines = [header.join(',')];
  for (const row of data.items) {
    lines.push([row.itemId, row.title, row.status, row.provider, row.channelId, row.durationMs == null ? '' : row.durationMs, row.error]
      .map((value) => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"').join(','));
  }
  return { filename: data.eventId + '-report.csv', body: lines.join('\n') };
}

function reportRange(days = 7) {
  const span = Math.max(1, Math.min(90, Number(days) || 7));
  const since = Date.now() - span * 24 * 60 * 60 * 1000;
  const events = state.events.length ? state.events : load();
  const picked = events.filter((event) => Number(event.createdAt) >= since).map((event) => hydrate(event));
  const buckets = new Map();
  let success = 0;
  let failed = 0;
  let unknown = 0;
  for (const event of picked) {
    for (const item of event.items || []) {
      if (item.status === 'success') success += 1;
      else if (item.status === 'failed') failed += 1;
      else if (item.status === 'unknown') unknown += 1;
    }
    const day = new Date(Number(event.createdAt) || Date.now()).toISOString().slice(0, 10);
    const bucket = buckets.get(day) || { day, events: 0, items: 0, success: 0, failed: 0 };
    bucket.events += 1;
    bucket.items += (event.items || []).length;
    bucket.success += (event.items || []).filter((item) => item.status === 'success').length;
    bucket.failed += (event.items || []).filter((item) => item.status === 'failed').length;
    buckets.set(day, bucket);
  }
  const denominator = success + failed;
  return {
    days: span,
    since,
    events: picked.length,
    items: success + failed + unknown,
    success,
    failed,
    unknown,
    successRate: denominator ? Math.round((success / denominator) * 1000) / 10 : null,
    daily: [...buckets.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
  };
}

load();

module.exports = { load, save, list, get, create, createFromJobInputs, recordJobs, recordSingleJob, recordSingleImage, itemLog, hydrate, tick, start, stop, pauseEvent, resumeEvent, cancelEvent, retryItem, skipItem, retryFailed, report, reportCsv, reportRange, state };
