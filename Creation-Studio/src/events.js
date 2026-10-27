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
const channels=require('./channels');

const state = { events: [] };
const repository = require('./event-store');
function uid() { return 'evt_' + Date.now().toString(36) + '_' + crypto.randomUUID().slice(0, 8); }
function load() { state.events = repository.read(); return state.events; }
function save() { repository.write(state.events); }

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
    if (['skipped', 'canceled'].includes(item.override)) return { ...item, status: item.override, error: item.error || null };
    let source = null;
    if (item.refType === 'job') source = jobMap.get(item.refId);
    else if (item.refType === 'imageTask') source = imageMap.get(item.refId);
    if (!source && item.dispatchState === 'pending') return { ...item, status: 'queued' };
    if (!source) {
      return { ...item, status: item.status === 'queued' ? 'unknown' : item.status, error: item.error || '任务记录已不存在' };
    }
    return {
      ...item,
      status: itemStatus(source.status),
      reconcile: source.status === 'interrupted',
      remoteId:source.remotePromptId||null,provider:source.provider||null,
      error: source.error || null,
      progress: Number(source.progress || 0),
      startedAt: source.startedAt || null,
      finishedAt: source.finishedAt || null,
    };
  });
  if (event.draft) return {...event, items, status: 'draft', stats: { total: items.length, done: 0, success: 0, failed: 0, running: 0, queued: 0, unknown: 0, skipped: 0, canceled: 0 } };  if (!items.length) {
    return { ...event, items, stats: { total: 0, queued: 0, running: 0, paused: 0, done: 0, success: 0, failed: 0, canceled: 0, skipped: 0, unknown: 0 }, status: 'draft', updatedAt: Date.now() };
  }
  const stats = { total: items.length, queued: 0, running: 0, paused: 0, done: 0, success: 0, failed: 0, canceled: 0, skipped: 0, unknown: 0 };
  for (const item of items) {
    if (item.status === 'running') stats.running += 1;
    else if (item.status === 'queued') stats.queued += 1;
    else if (item.status === 'paused') stats.paused += 1;
    else if (item.status === 'success') stats.success += 1;
    else if (item.status === 'skipped') stats.skipped += 1;
    else if (item.status === 'canceled') stats.canceled += 1;
    else if (item.status === 'unknown') stats.unknown += 1;
    else stats.failed += 1;
  }
  stats.done = stats.success + stats.failed + stats.canceled + stats.skipped;
  const started = items.map((i) => i.startedAt).filter(Boolean).sort()[0] || event.startedAt || null;
  const finished = items.every((i) => ['success', 'failed', 'canceled', 'skipped', 'unknown'].includes(i.status))
    ? (items.map((i) => i.finishedAt).filter(Boolean).sort().pop() || event.finishedAt || Date.now())
    : null;
  let status = event.status;
  if (stats.running > 0) status = 'running';
  else if ((stats.queued > 0 || stats.paused > 0) && finished === null) status = 'queued';
  else if (finished !== null) {
    if (stats.success === stats.total) status = 'completed';
    else if (stats.unknown > 0) status = 'interrupted';
    else if (stats.failed === 0 && stats.canceled > 0) status = 'canceled';
    else if (stats.failed > 0 && stats.success > 0) status = 'partial';
    else if (stats.skipped > 0 && stats.failed === 0) status = 'completed';
    else if (stats.unknown > 0 && stats.failed === 0 && items.some((item) => item.reconcile)) status = 'interrupted';
    else status = 'failed';
  }
  if (event.canceled && !['running', 'queued'].includes(status)) status = 'canceled';
  if (event.paused && !['completed', 'failed', 'partial', 'canceled'].includes(status)) status = 'paused';
  // 生命周期：待调度（未分配）→ 待执行（已分配但未到时间）→ 执行中。
  const futureStart = event.schedule?.startAt && Date.parse(event.schedule.startAt) > Date.now();
  if (!['completed', 'failed', 'partial', 'canceled', 'interrupted'].includes(status)) {
    if (event.pendingSchedule) status = 'unscheduled';
    else if (futureStart && stats.running === 0 && finished === null) status = 'scheduled';
  }
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

function list(filter={}){
 const result=repository.query(filter);
 return {...result,schedulerError:state.schedulerError||null,events:result.events.map(raw=>{const e=hydrate(raw);const {items,spec,...rest}=e;const firstError=items.find(item=>item.error);return {...rest,kind:repository.kind(e),spec:{projectId:spec?.projectId,workflowId:spec?.workflowId},itemCount:items.length,lastError:firstError?String(firstError.error).slice(0,160):'',errorCount:items.filter(item=>item.error).length};})};
}

function get(id) {
  const raw = repository.get(id);
  if (!raw) { const error = new Error('事件不存在'); error.status = 404; error.code = 'EVENT_NOT_FOUND'; throw error; }
  return hydrate(raw);
}

function create(input = {}) {
  load();
  const items = Array.isArray(input.items) ? input.items : [];
  const event = {
    schemaVersion: 2,
    version:1,
    id: uid(),
    title: String(input.title || '').trim().slice(0, 120) || ('事件 ' + new Date().toLocaleString('zh-CN', { hour12: false })),
    kind: input.kind || (input.source === 'image' ? 'image' : 'video'),
    source: ['batch', 'studio', 'image', 'api'].includes(input.source) ? input.source : 'api',
    spec: {
      channelId: String(input.channelId || ''),
      workflowId: String(input.workflowId || ''),
      projectId: String(input.projectId || ''),
      itemId: input.itemId || null,
      items: items.map((item) => ({
        key: String(item.key || ''),
        title: String(item.title || '').slice(0, 80),
        prompt: String(item.prompt || ''),
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
    status: input.draft?'draft':'queued',
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

function prepareInputs(inputs,kind){return inputs.map(input=>{const copy={...input};if(kind==='image'){const ch=copy.channelId?channels.get('image',copy.channelId):channels.active('image');if(!ch)throw Object.assign(new Error('没有启用的图像渠道'),{status:422});copy.channelId=ch.id;copy.model=copy.model||ch.model;}delete copy.apiKey;delete copy.authorization;for(const field of ['images','refs','audios'])if(Array.isArray(copy[field]))copy[field]=copy[field].map(asset=>{if(!asset?.path||/^https?:/i.test(asset.path))return asset;const full=path.resolve(asset.path);if(!fs.existsSync(full))throw Object.assign(new Error('参考素材不存在：'+asset.path),{status:400});const digest=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');return {...asset,path:full,assetFingerprint:digest};});return copy;});}
function createFromJobInputs(inputs, meta = {}) {
  if (!Array.isArray(inputs) || !inputs.length) { const error = new Error('没有可创建的任务条目'); error.status = 400; throw error; }
  inputs=prepareInputs(inputs,meta.kind);
  const kind = meta.kind === 'image' ? 'image' : 'video';
  load();
  const requestKey=meta.requestId||(inputs.length===1?inputs[0].requestId:null);
  const inputHash=crypto.createHash('sha256').update(JSON.stringify({inputs,kind,projectId:meta.projectId||''})).digest('hex');
  if(requestKey){const existing=state.events.find(e=>e.requestKey===requestKey);if(existing){if(existing.inputHash!==inputHash)throw Object.assign(new Error('同一请求编号的内容发生变化'),{status:409});return get(existing.id);}}

  const event = create({ ...meta, kind, items: inputs.map(input => ({ ...input, params: input })) });
  event.requestKey=requestKey;event.inputHash=inputHash;
  event.paused = !!meta.paused;
  event.pendingSchedule = !!meta.pendingSchedule;
  event.draft = !!meta.draft;
  event.status = event.draft ? 'draft' : (event.pendingSchedule ? 'unscheduled' : 'queued');
  event.items = inputs.flatMap(input => Array.from({length: kind === 'video' ? Math.max(1,Math.min(20,Number(input.count)||1)) : 1}, () => ({ ...normalizeRef(kind === 'image' ? 'imageTask' : 'job', ''), title: input.title || input.prompt?.slice(0,60) || '生成任务', input: { ...input, count: 1 }, status: 'queued', dispatchState: 'pending' })));
  event.items.forEach((item, index) => {
    const label = String(item.title || '').trim() || ('镜头 ' + (index + 1));
    item.shotLabel = label;
    item.input = { ...item.input, shotLabel: label, taskTitle: event.title };
  });
  save();
  if (!event.draft && !event.pendingSchedule) materialize(event);
  save();
  setTimeout(safeTick, 50);
  return get(event.id);
}
function materialize(event) {
  for (const item of event.items) {
    if (item.dispatchState !== 'pending') continue;
    // Durable intent precedes executor creation; stable item key allows restart reconciliation.
    const input = { ...item.input, eventId: event.id, eventItemId: item.id, requestId: item.id };
    try {
      if (item.refType === 'imageTask') {
        const task = imageTasks().enqueue({ ...input, paused: true });
        item.refId = task.id;
      } else {
        const found = jobs.list().find(j => j.eventId === event.id && j.eventItemId === item.id);
        const task = found || jobs.addJobs({ ...input, held: true })[0];
        jobs.setHeld(task.id, true);
        item.refId = task.id;
      }
      item.dispatchState = 'ready'; item.status = 'queued';
      save();
    } catch (err) {
      item.error = String(err.message || err); event.paused = true;
      save(); throw err;
    }
  }
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
let unsubscribeImage=null,jobListener=null;
const TERMINAL_ITEM = new Set(['success', 'failed', 'canceled', 'skipped', 'unknown']);

function rawEvent(id){load();const raw=state.events.find(e=>e.id===id);if(!raw)throw Object.assign(new Error('事件不存在'),{status:404});return raw;}

/** 调度/暂停/取消等配置操作留痕，监控页用来展示每一步操作。 */
function audit(event, action, detail = '') {
  event.audit = [...(event.audit || []), { at: Date.now(), action: String(action), detail: String(detail || '') }].slice(-200);
}

function jobMapNow() {
  return new Map(jobs.list().map((j) => [j.id, j]));
}

function sourceOf(item, map) {
  if (item.refType === 'imageTask') { try { return imageTasks()?.get(item.refId); } catch { return null; } }
  return map.get(item.refId);
}
function itemStatusOf(item, map) {
  if (item.override) return item.override;
  if (item.dispatchState === 'pending') return 'queued';
  const source = sourceOf(item, map);
  return source ? itemStatus(source.status) : 'unknown';
}
function hold(item, value) {
  if (item.refType === 'imageTask') {
    const worker = imageTasks(), task = worker.get(item.refId);
    if (value && !task.held) worker.pause(item.refId);
    if (!value && task.held) worker.resume(item.refId);
  } else jobs.setHeld(item.refId, value);
}
function cancelPending(item) {
  if (item.refType === 'imageTask') imageTasks().cancelPending(item.refId);
  else jobs.cancel(item.refId);
}
function capture(event, item, map) {
  const source = sourceOf(item, map);
  if (!source) return;
  const attemptId = source.runId || source.id;
  const previous = repository.attempts(event.id,item.id).find(a => a.id === attemptId);
  const record = { id: attemptId, eventId: event.id, itemId: item.id, refId: item.refId, kind: event.kind || repository.kind(event), createdAt: source.createdAt || Date.now(), startedAt: source.startedAt, finishedAt: source.finishedAt, status: source.status, remoteId: source.remotePromptId || null, error: source.error, outputs: source.outputs || source.result?.items || [], snapshot: source.snapshot || item.input || {}, logs: item.refType === 'imageTask' ? source.logs || [] : jobs.readLog(item.refId) };
  if (!previous || previous.status !== record.status || previous.logs.length !== record.logs.length) repository.attempt(record);
}
function tick() {
  state.events=repository.active();
  const map = jobMapNow();
  let changed = false;
  const ordered = state.events.slice().sort((a,b) => (a.schedule?.order || 0) - (b.schedule?.order || 0) || a.createdAt - b.createdAt);
  const queueIds=ordered.flatMap(e=>(e.items||[]).filter(i=>i.refType==='job'&&map.get(i.refId)?.status==='queued').map(i=>i.refId));
  if(jobs.reorder&&queueIds.length){const keys=new Set(queueIds),existing=[...map.values()].filter(j=>keys.has(j.id)).sort((a,b)=>(a.order||0)-(b.order||0)).map(j=>j.id);if(existing.join(',')!==queueIds.join(','))jobs.reorder(queueIds);}
  let imageOrder=0;for(const event of ordered)for(const item of event.items||[])if(item.refType==='imageTask'&&item.refId&&imageTasks()?.setOrder)imageTasks().setOrder(item.refId,imageOrder++);
  for (const event of ordered) {
    for (const item of event.items || []) capture(event,item,map);
    if (event.legacy || event.paused || event.canceled || event.draft || event.pendingSchedule || !event.items?.length) continue;
    if (event.schedule?.startAt && Date.parse(event.schedule.startAt) > Date.now()) continue;
    if (event.items.some(i => i.dispatchState === 'pending')) { try { materialize(event); changed=true; } catch { continue; } }
    const statuses = event.items.map(item => itemStatusOf(item,map));
    if (statuses.every(status => TERMINAL_ITEM.has(status))) continue;
    if (event.policy?.onItemFail === 'stop' && statuses.includes('failed')) {
      for (const [index,item] of event.items.entries()) if (['queued','paused'].includes(statuses[index])) {
        cancelPending(item); item.override='skipped'; changed=true;
      }
      continue;
    }
    const dispatched = event.items.filter(item => { const source=sourceOf(item,map); return source && source.status==='queued' && !source.held; }).length;
    let occupied = statuses.filter(status => status==='running').length + dispatched;
    const limit = Math.max(1,Number(event.policy?.concurrency)||1);
    for (const [index,item] of event.items.entries()) {
      if (occupied>=limit) break;
      if (!['queued','paused'].includes(statuses[index])) continue;
      const source=sourceOf(item,map);
      if (!source || !source.held) continue;
      hold(item,false); occupied++; changed=true;
    }
  }
  for(const event of state.events){const current=hydrate(event,{jobMap:jobMapNow()});if(current.status!==event.status||current.finishedAt!==event.finishedAt){event.status=current.status;event.finishedAt=current.finishedAt;event.startedAt=current.startedAt;changed=true;}}
  if (changed) save();
}

function importHistory(){
 const db=repository.open();if(db.prepare("SELECT 1 FROM task_meta WHERE key='history-seeded'").get())return;
 load();const linked=new Set(state.events.flatMap(e=>(e.items||[]).map(i=>i.refId)));
 const oldJobs=jobs.list();const worker=imageTasks();let images=[];if(worker?.page){const first=worker.page(undefined,1);images=first.tasks;for(let p=2;p<=Math.ceil(first.total/10);p++)images.push(...worker.page(undefined,p).tasks);}else if(worker?.list)images=worker.list();
 for(const source of [...oldJobs.map(j=>({...j,refType:'job'})),...images.map(i=>({...i,refType:'imageTask'}))]){
  if(linked.has(source.id))continue;
  const id=uid(),item=normalizeRef(source.refType,source.id,{title:source.title||source.snapshot?.userPrompt?.slice(0,60)||'历史生成任务'});
  const raw={id,version:1,schemaVersion:2,kind:source.refType==='job'?'video':'image',title:item.title,source:source.refType==='job'?'studio':'image',legacy:true,createdAt:source.createdAt||0,startedAt:source.startedAt||null,finishedAt:source.finishedAt||null,spec:{projectId:source.projectId||'',items:[]},policy:{concurrency:1,onItemFail:'continue'},schedule:{order:0,startAt:null},items:[item]};
  const result=hydrate(raw);raw.status=result.status;raw.finishedAt=result.finishedAt;state.events.push(raw);
 }
 save();db.prepare('INSERT INTO task_meta(key,value) VALUES(?,?)').run('history-seeded',String(Date.now()));
}
function safeTick(){try{tick();state.schedulerError=null;}catch(err){state.schedulerError=String(err.message||err);console.error('事件调度停止本轮派发：'+state.schedulerError);}}
function start() {
  importHistory();
  if (tickTimer) return;
  tickTimer = setInterval(safeTick, 2000);
  const onTerminal=task=>{if(['success','failed','canceled','interrupted'].includes(task.status))setImmediate(safeTick);};
  if(imageTasks()?.on)unsubscribeImage=imageTasks().on(onTerminal);
  jobListener=onTerminal;jobs.emitter?.on('job',jobListener);
  if (tickTimer.unref) tickTimer.unref();
  tick();
}

function stop() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  unsubscribeImage?.();unsubscribeImage=null;if(jobListener)jobs.emitter?.off('job',jobListener);jobListener=null;
}

function pauseEvent(id) {
  const event = rawEvent(id);
  const map = jobMapNow();
  event.paused = true;
  for (const item of event.items) {
    if (['queued','paused'].includes(itemStatusOf(item,map))||(item.refType==='imageTask'&&itemStatusOf(item,map)==='running')) hold(item,true);
  }
  audit(event, 'pause', '暂停后续派发');
  save();
  return get(id);
}

function resumeEvent(id) {
  const event = rawEvent(id);
  event.paused = false;
  for(const item of event.items||[])if(item.refType==='imageTask'){const source=sourceOf(item,jobMapNow());if(source?.held&&source.status==='running')hold(item,false);}
  audit(event, 'resume', '继续派发');
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
      if (item.refId) cancelPending(item);
      item.override = 'canceled';
    }
  }
  event.pendingSchedule = false;
  audit(event, 'cancel', '取消未提交条目');
  save();
  return get(id);
}

/**
 * 只改一条已结束分镜的提示词，不改其它分镜，也不自动提交。
 * 保存后由用户点「重试」按新提示词重新生成。
 */
function reviseItem(id, itemId, patch = {}) {
  const event = rawEvent(id);
  const item = (event.items || []).find((i) => i.id === itemId);
  if (!item) { const error = new Error('条目不存在'); error.status = 404; throw error; }
  const map = jobMapNow();
  const status = itemStatusOf(item, map);
  if (!['failed', 'canceled', 'skipped'].includes(status)) {
    throw Object.assign(new Error('只能修改已失败、已取消或已跳过的分镜；运行中的任务请先取消'), { status: 409 });
  }
  const input = { ...(item.input || {}) };
  const currentPrefix = String(input.prefixPrompt || '').trim();
  let body;
  if (patch.prompt != null) {
    body = String(patch.prompt);
  } else {
    body = input.userPrompt == null ? '' : String(input.userPrompt);
    if (!body) {
      body = String(input.prompt || '');
      if (currentPrefix && body.startsWith(currentPrefix)) body = body.slice(currentPrefix.length).replace(/^\s*\n+/, '');
    }
  }
  if (!body.trim()) throw Object.assign(new Error('提示词不能为空'), { status: 400 });
  const prefix = patch.prefixPrompt != null ? String(patch.prefixPrompt).trim() : currentPrefix;
  const full = prefix ? prefix + '\n\n' + body : body;
  item.input = { ...input, prompt: full, userPrompt: body, prefixPrompt: prefix, applyStyle: false };
  if (item.refType === 'job' && item.refId) jobs.revisePrompt(item.refId, { prompt: full, userPrompt: body, prefixPrompt: prefix });
  const index = event.items.indexOf(item);
  const snapshot = event.spec && Array.isArray(event.spec.items) ? event.spec.items[index] : null;
  if (snapshot) {
    snapshot.prompt = full;
    if (snapshot.params && typeof snapshot.params === 'object') {
      snapshot.params = { ...snapshot.params, prompt: full, userPrompt: body, prefixPrompt: prefix, applyStyle: false };
    }
  }
  audit(event, 'revise', `修改分镜提示词 ${item.title || item.id}（${String(full).length} 字）`);
  save();
  return get(id);
}

function retryItem(id, itemId) {
  const event = rawEvent(id);
  const item = (event.items || []).find((i) => i.id === itemId);
  if (!item) { const error = new Error('条目不存在'); error.status = 404; throw error; }
  const map = jobMapNow();
  const status = itemStatusOf(item, map);
  if (status==='unknown') throw Object.assign(new Error('远端状态未知，请先对账或继续查询原任务，不能直接重新生成'),{status:409});
  if (!['failed', 'canceled', 'skipped', 'success'].includes(status)) {
    const error = new Error('条目还没结束，不能重试'); error.status = 409; error.code = 'EVENT_STATE_INVALID'; throw error;
  }
  const itemIndex = event.items.indexOf(item);
  if (item.refType === 'job' && item.refId && typeof jobs.setShotMeta === 'function') {
    jobs.setShotMeta(item.refId, { shotLabel: item.shotLabel || item.title || ('镜头 ' + (itemIndex + 1)), taskTitle: event.title });
  }
  capture(event,item,map);
  if (item.refType === 'imageTask') {
    const task=imageTasks().retry(item.refId,{paused:true}); item.refId=task.id;
  } else { jobs.retry(item.refId); jobs.setHeld(item.refId,true); }
  item.attempts=(item.attempts||0)+1;event.legacy=false;

  delete item.override;
  event.paused = false;
  event.canceled = false;
  event.status='queued';event.finishedAt=null;
  audit(event, 'retry', `重试分镜 ${item.title || item.id}`);
  save();
  setTimeout(tick, 50);
  return get(id);
}

function moveItem(id,itemId,direction){
  const event=rawEvent(id),map=jobMapNow(),from=event.items.findIndex(i=>i.id===itemId);
  if(from<0)throw Object.assign(new Error('条目不存在'),{status:404});
  if(!['queued','paused'].includes(itemStatusOf(event.items[from],map)))throw Object.assign(new Error('只能调整尚未派发条目的顺序'),{status:409});
  const step=direction==='up'?-1:1;let to=from+step;
  while(to>=0&&to<event.items.length&&!['queued','paused'].includes(itemStatusOf(event.items[to],map)))to+=step;
  if(to>=0&&to<event.items.length){[event.items[from],event.items[to]]=[event.items[to],event.items[from]];audit(event,'move',direction==='up'?'上移分镜':'下移分镜');save();}
  return get(id);
}
function skipItem(id, itemId) {
  const event = rawEvent(id);
  const item = (event.items || []).find((i) => i.id === itemId);
  if (!item) { const error = new Error('条目不存在'); error.status = 404; throw error; }
  const map = jobMapNow();
  const status = itemStatusOf(item, map);
  if (['queued', 'paused'].includes(status) && item.refId) { cancelPending(item) }
  if (!['queued', 'paused'].includes(status)) { const error = new Error('只能跳过尚未执行的条目'); error.status = 409; throw error; }
  item.override = 'skipped';
  audit(event, 'skip', `跳过分镜 ${item.title || item.id}`);
  save();
  return get(id);
}

/** 从任务里移除一条已结束的分镜；只删记录，不删成片和素材。 */
function removeItem(id, itemId) {
  const event = rawEvent(id);
  const item = (event.items || []).find((row) => row.id === itemId);
  if (!item) throw Object.assign(new Error('条目不存在'), { status: 404 });
  const status = itemStatusOf(item, jobMapNow());
  if (!['success', 'failed', 'canceled', 'skipped', 'unknown'].includes(status)) {
    throw Object.assign(new Error('只能删除已结束的分镜；运行中或排队中的分镜请先取消'), { status: 409 });
  }
  event.items = event.items.filter((row) => row.id !== itemId);
  event.legacy = false;
  audit(event, 'remove-item', `移除分镜 ${item.title || item.id}`);
  save();
  return get(id);
}

function retryFailed(id) {
  const event=get(id);
  const targets=event.items.filter(i=>i.status==='failed');
  let retried=0;
  for(const item of targets){retryItem(id,item.id);retried++;}
  return {event:get(id),retried};
}
function scheduleEvent(id, input={}) {
  const event=rawEvent(id);
  const current=get(id).status;
  if(['running','completed','failed','partial','canceled','interrupted'].includes(current)) throw Object.assign(new Error('任务已开始或已结束，不能再改调度'),{status:409});
  if(input.startAt && !Number.isFinite(Date.parse(input.startAt))) {const err=new Error('执行时间无效');err.status=400;throw err;}
  for(const item of event.items||[]){const status=itemStatusOf(item,jobMapNow());if(['queued','paused'].includes(status)&&item.refId)hold(item,true);}
  event.schedule={...event.schedule,order:Number(input.order)||0,startAt:input.startAt||null};
  event.policy={...event.policy,concurrency:Math.max(1,Math.min(4,Number(input.concurrency)||1)),onItemFail:input.onItemFail==='stop'?'stop':'continue'};
  event.pendingSchedule=false;event.draft=false;event.paused=false;event.finishedAt=null;
  const future=!!event.schedule.startAt&&Date.parse(event.schedule.startAt)>Date.now();
  if(future){
    event.status='scheduled';
    audit(event,'schedule','计划 '+new Date(event.schedule.startAt).toLocaleString('zh-CN',{hour12:false})+' 执行 · 并发 '+event.policy.concurrency);
    save();
    return get(id);
  }
  event.status='queued';
  audit(event,'schedule','立即执行 · 并发 '+event.policy.concurrency);
  save();
  materialize(event);
  save();
  setTimeout(safeTick,50);
  return get(id);
}
function lookupRef(refId){load();for(const event of state.events){const item=event.items?.find(i=>i.refId===refId);if(item)return {event,item};}const row=repository.open().prepare("SELECT event_id,item_id FROM task_attempts WHERE json_extract(payload,'$.refId')=? LIMIT 1").get(refId);if(row){const event=repository.get(row.event_id),item=event?.items.find(i=>i.id===row.item_id);if(item)return {event,item};}return null;}
async function resumeOriginal(id,itemId){const event=rawEvent(id),item=event.items.find(i=>i.id===itemId);if(!item||item.refType!=='job')throw Object.assign(new Error('该任务不支持远端续查'),{status:409});const job=jobs.get(item.refId);if(job?.provider!=='manager'||!job.remotePromptId)throw Object.assign(new Error('没有可恢复的远端任务编号'),{status:409});if(typeof jobs.setShotMeta==='function')jobs.setShotMeta(item.refId,{shotLabel:item.shotLabel||item.title||('镜头 '+(event.items.indexOf(item)+1)),taskTitle:event.title});capture(event,item,jobMapNow());event.legacy=false;event.status='queued';event.finishedAt=null;event.paused=false;event.canceled=false;save();await jobs.resume(item.refId);jobs.setHeld(item.refId,true);setTimeout(safeTick,50);return get(id);}
function updateDraft(id,inputs,meta={}){const event=rawEvent(id);inputs=prepareInputs(inputs,event.kind);event.version=(event.version||1)+1;if(!event.draft&&!event.pendingSchedule)throw Object.assign(new Error('已入队任务不能修改提交快照，请复制为新任务'),{status:409});event.title=meta.title||event.title;event.spec.items=inputs.map(input=>({...input,params:input}));event.items=inputs.flatMap(input=>Array.from({length:event.kind==='video'?Math.max(1,Math.min(20,Number(input.count)||1)):1},()=>({...normalizeRef(event.kind==='image'?'imageTask':'job',''),title:input.title||input.prompt?.slice(0,60)||'生成任务',input:{...input,count:1},dispatchState:'pending'})));event.items.forEach((item,index)=>{const label=String(item.title||'').trim()||('镜头 '+(index+1));item.shotLabel=label;item.input={...item.input,shotLabel:label,taskTitle:event.title};});save();return get(id);}
function queueEvent(id) {const event=rawEvent(id);event.draft=false;event.pendingSchedule=false;event.paused=false;const future=event.schedule?.startAt&&Date.parse(event.schedule.startAt)>Date.now();if(future){event.status='scheduled';audit(event,'queue','按计划时间等待执行');save();return get(id);}event.status='queued';audit(event,'queue','加入队列');save();materialize(event);save();setTimeout(safeTick,50);return get(id);}
/** 保存任务但先不调度：出现在调度页的「未分配」里。 */
function prepareEvent(id) {const event=rawEvent(id);const status=get(id).status;if(['running','completed','failed','partial','canceled','interrupted'].includes(status))throw Object.assign(new Error('任务已开始或已结束，不能重新调度'),{status:409});event.draft=false;event.pendingSchedule=true;event.status='unscheduled';event.paused=false;event.canceled=false;event.finishedAt=null;audit(event,'prepare','保存任务，等待调度');save();return get(id);}
/** 删除尚未开始或已取消的任务；执行中的任务必须先取消。 */
function removeEvent(id){
  const event=rawEvent(id);
  const status=get(id).status;
  if(!['draft','unscheduled','canceled','completed','failed','partial','interrupted'].includes(status))throw Object.assign(new Error('运行中或排队中的任务不能删除，请先取消'),{status:409});
  load();
  state.events=state.events.filter((item)=>item.id!==id);
  save();
  repository.remove(id);
  return {ok:true,id,title:event.title||''};
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
      status: item.override || (job ? itemStatus(job.status) : item.status),
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

function reportRange(days = 7, kind) {
  const span = Math.max(1, Math.min(90, Number(days) || 7));
  const since = Date.now() - span * 24 * 60 * 60 * 1000;
  const events = repository.read().filter(event=>!kind||repository.kind(event)===kind);
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

/** 迁移：把没有项目归属的历史事件归到目标项目，避免切换项目后旧任务彻底不可见。 */
function adoptLegacy(projectId) {
  const target = String(projectId || '');
  if (!target) return 0;
  load();
  let changed = 0;
  for (const event of state.events) {
    const current = event.spec?.projectId || '';
    if (current && current !== 'unassigned') continue;
    event.spec = { ...(event.spec || {}), projectId: target };
    for (const item of event.items || []) if (item.input) item.input.projectId = target;
    changed++;
  }
  if (changed) save();
  return changed;
}

module.exports = { repository, materialize, importHistory, lookupRef, capture, scheduleEvent, queueEvent, prepareEvent, removeEvent, updateDraft, resumeOriginal, moveItem, adoptLegacy, load, save, list, get, create, createFromJobInputs, recordJobs, recordSingleJob, recordSingleImage, itemLog, hydrate, tick, start, stop, pauseEvent, resumeEvent, cancelEvent, reviseItem, removeItem, retryItem, skipItem, retryFailed, report, reportCsv, reportRange, state };
