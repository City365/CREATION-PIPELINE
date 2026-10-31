'use strict';
/**
 * 任务清单（manifest）：把「任务 → 镜头 → 提示词 → 成片位置」导成一份稳定的 JSON。
 * 后续做剪辑、对账、交给别的工具读取，都以这份结构为准，不再靠猜目录。
 */
const fs = require('node:fs');
const path = require('node:path');
const events = require('./events');
const jobs = require('./jobs');
const projects = require('./projects');
const library = require('./library');

const pad = (n) => String(n).padStart(2, '0');
function stampText(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function itemStatusOf(hydrated, item) {
  const row = (hydrated.items || []).find((entry) => entry.id === item.id);
  return (row && row.status) || item.status || '';
}

function shotOf(item, index, job, hydrated) {
  const input = item.input || {};
  const video = job ? (job.outputs || []).find((out) => out.type === 'video' && out.path) : null;
  const startedAt = item.startedAt || (job && job.startedAt) || null;
  const finishedAt = item.finishedAt || (job && job.finishedAt) || null;
  return {
    index: index + 1,
    itemId: item.id,
    shotLabel: item.shotLabel || item.title || '镜头 ' + pad(index + 1),
    status: itemStatusOf(hydrated, item),
    jobId: item.refId || '',
    remotePromptId: item.remoteId || (job && job.remotePromptId) || '',
    attempts: Number(item.attempts) || 0,
    prompt: String(input.prompt || ''),
    userPrompt: input.userPrompt == null ? '' : String(input.userPrompt),
    prefixPrompt: String(input.prefixPrompt || ''),
    ratio: input.ratio || input.aspectRatio || '',
    duration: input.duration == null ? null : Number(input.duration),
    images: (Array.isArray(input.images) ? input.images : []).map((img) => ({
      path: img.path || '',
      name: img.name || (img.path ? path.basename(img.path) : ''),
      note: img.note || '',
    })),
    video: video
      ? {
        path: video.path,
        name: video.name || path.basename(video.path),
        bytes: video.bytes || (fs.existsSync(video.path) ? fs.statSync(video.path).size : 0),
        exists: fs.existsSync(video.path),
        url: '/api/file?path=' + encodeURIComponent(video.path),
      }
      : null,
    createdAt: item.createdAt || (job && job.createdAt) || null,
    startedAt,
    finishedAt,
    durationMs: startedAt && finishedAt ? Math.max(0, finishedAt - startedAt) : null,
    error: item.error || (job && job.error) || null,
  };
}

function build(projectId, kind = 'video') {
  const wanted = String(projectId || '');
  const project = wanted ? (() => { try { return projects.get(wanted); } catch { return null; } })() : null;
  const allJobs = (() => {
    const cached = jobs.list(wanted || undefined);
    if (cached.length) return cached;
    // 进程刚起来还没读过任务记录时兜底加载一次，避免清单里成片全空
    try { jobs.loadState(); } catch { /* 读不到就按空处理 */ }
    return jobs.list(wanted || undefined);
  })();
  const jobMap = new Map(allJobs.map((job) => [job.id, job]));
  const rows = events.repository.read().filter((raw) => {
    const pid = (raw.spec && raw.spec.projectId) || '';
    if (wanted) return pid === wanted;
    return !pid;
  }).filter((raw) => (raw.kind || 'video') === kind);

  const tasks = rows.map((raw) => {
    const hydrated = events.hydrate(raw, { jobMap });
    const shots = (raw.items || []).map((item, index) => shotOf(item, index, jobMap.get(item.refId) || null, hydrated));
    const withVideo = shots.filter((shot) => shot.video && shot.video.exists).length;
    return {
      eventId: raw.id,
      title: raw.title || '',
      kind: raw.kind || 'video',
      status: hydrated.status || raw.status || '',
      source: raw.source || '',
      createdAt: raw.createdAt || null,
      startedAt: raw.startedAt || null,
      finishedAt: raw.finishedAt || null,
      schedule: raw.schedule || null,
      policy: raw.policy || null,
      stats: hydrated.stats || {},
      shotCount: shots.length,
      videoCount: withVideo,
      shots,
    };
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    project: project ? { id: project.id, name: project.name } : { id: wanted, name: '' },
    kind,
    counts: {
      tasks: tasks.length,
      shots: tasks.reduce((sum, task) => sum + task.shotCount, 0),
      videos: tasks.reduce((sum, task) => sum + task.videoCount, 0),
    },
    tasks,
  };
}

/** 把清单写到项目的 exports 目录，返回文件路径。 */
function save(projectId, kind = 'video') {
  const manifest = build(projectId, kind);
  const root = library.exportsRoot(projectId);
  const dir = path.join(root, '任务清单');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `任务清单_${stampText()}.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
  return { file, manifest };
}

module.exports = { build, save, stampText };
