'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('./config');
const projects = require('./projects');
const workspace = require('./workspace');
const generationStore = require('./generation-store');
const { readJson, writeJson, ensureDir, sanitizeFilename, safeSegment, kindOf, formatBytes, mimeFor } = require('./util');

const META_FILE = path.join(config.DATA, 'assets.json');

/* ------------------------------- 业务类型 ------------------------------- */

const ASSET_TYPES = [
  { id: 'scene', label: '场景', hint: '环境、地点、背景' },
  { id: 'character', label: '人物', hint: '角色外形、服装、身份板' },
  { id: 'prop', label: '道具', hint: '物件、武器、关键物品' },
  { id: 'firstFrame', label: '首帧', hint: '视频第一帧参考' },
  { id: 'lastFrame', label: '尾帧', hint: '视频最后一帧参考' },
  { id: 'blend', label: '溶图参考', hint: '构图、光影、色调融合' },
  { id: 'storyboard', label: '分镜参考', hint: '镜头拆解、构图分镜' },
  { id: 'other', label: '其他', hint: '暂未归类' },
];
const TYPE_IDS = new Set(ASSET_TYPES.map((t) => t.id));
const FOLDER_TYPE_DEFAULT = {
  场景: 'scene', 环境: 'scene', 背景: 'scene',
  人物: 'character', 角色: 'character', 身份板: 'character',
  道具: 'prop', 物品: 'prop',
  首帧: 'firstFrame', 尾帧: 'lastFrame', 首尾帧: 'firstFrame',
  溶图: 'blend', 溶图参考: 'blend',
  分镜: 'storyboard', 分镜参考: 'storyboard',
};

function typeMeta(id) {
  return ASSET_TYPES.find((t) => t.id === id) || ASSET_TYPES[ASSET_TYPES.length - 1];
}

function assertType(id) {
  const value = String(id || '').trim();
  if (!TYPE_IDS.has(value)) throw new Error('未知的素材类型：' + (value || '空'));
  return value;
}

function defaultTypeForFolder(folder) {
  return FOLDER_TYPE_DEFAULT[String(folder || '').trim()] || 'other';
}

/* ------------------------------- 元数据 ------------------------------- */

function normalizeMeta(raw) {
  if (raw && raw.projects && typeof raw.projects === 'object') {
    const data = { version: 2, projects: {} };
    for (const [key, row] of Object.entries(raw.projects)) {
      data.projects[key] = {
        subjects: { ...((row && row.subjects) || {}) },
        types: { ...((row && row.types) || {}) },
      };
    }
    return data;
  }
  const data = { version: 2, projects: {} };
  const subjects = raw && raw.subjects && typeof raw.subjects === 'object' ? raw.subjects : {};
  if (Object.keys(subjects).length) data.projects[''] = { subjects: { ...subjects }, types: {} };
  return data;
}

function metaData() {
  return normalizeMeta(readJson(META_FILE, null));
}

function projectRow(data, projectId) {
  const key = String(projectId || '');
  if (!data.projects[key]) data.projects[key] = { subjects: {}, types: {} };
  return data.projects[key];
}

function metaFor(projectId) {
  const row = projectRow(metaData(), projectId);
  return { subjects: { ...row.subjects }, types: { ...row.types } };
}

function updateMeta(projectId, mutate) {
  const data = metaData();
  mutate(projectRow(data, projectId));
  writeJson(META_FILE, data);
}

/** 迁移用：把旧（无项目）元数据整体挪到目标项目。 */
function moveProjectMeta(fromId, toId) {
  if (String(fromId) === String(toId)) return 0;
  let moved = 0;
  const data = metaData();
  const from = projectRow(data, fromId);
  const to = projectRow(data, toId);
  for (const [rel, subject] of Object.entries(from.subjects)) { to.subjects[rel] = subject; moved++; }
  for (const [rel, type] of Object.entries(from.types)) { to.types[rel] = type; moved++; }
  delete data.projects[String(fromId || '')];
  writeJson(META_FILE, data);
  return moved;
}

/* ------------------------------- 目录 ------------------------------- */

function projectOrNull(projectId) {
  if (!projectId) return null;
  try { return projects.get(String(projectId)); } catch { return null; }
}

function assetRoot(projectId) {
  const project = projectOrNull(projectId);
  if (project) return workspace.pathsFor(project).assets;
  return ensureDir(config.load().assetFolder);
}

function mediaRoot(projectId) {
  const project = projectOrNull(projectId);
  if (project) return workspace.pathsFor(project).media;
  return ensureDir(config.load().saveFolder);
}

function uploadRoot(projectId) {
  const project = projectOrNull(projectId);
  if (project) return workspace.pathsFor(project).uploads;
  return ensureDir(config.load().uploadFolder);
}

function exportsRoot(projectId) {
  const project = projectOrNull(projectId);
  if (project) return workspace.pathsFor(project).exports;
  return ensureDir(path.join(config.load().saveFolder, 'exports'));
}

/* ------------------------------- 扫描 ------------------------------- */

function relOf(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function imageSize(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const b = buf.subarray(0, n);
    if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
    }
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = b.toString('ascii', 12, 16);
      if (chunk === 'VP8X') {
        const w = 1 + b.readUIntLE(24, 3);
        const h = 1 + b.readUIntLE(27, 3);
        return { width: w, height: h };
      }
      if (chunk === 'VP8 ') {
        return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch { /* ignore */ }
  return { width: null, height: null };
}

const FOLDER_ORDER = ['全部', '角色', '场景', '道具', '首帧', '尾帧', '溶图参考', '分镜参考', '未归类'];
const GROUP_TYPE = 'storyboard';

function groupOfRel(rel) {
  const value = String(rel || '');
  const index = value.indexOf('/');
  return index > 0 ? value.slice(0, index) : '';
}

/**
 * 素材库只有两类实体：
 * - 根目录下的单个素材（人物/场景/道具/首帧/尾帧/溶图参考/其他），类型写在 assets.json；
 * - 顶层文件夹 = 一个分镜组，组里的图片不再分人物/道具/场景，统一算「分镜参考」。
 */
function scanAssets(projectId) {
  const root = assetRoot(projectId);
  const data = metaFor(projectId);
  const items = [];
  const groupMap = new Map();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    groupMap.set(entry.name, { name: entry.name, rel: entry.name, count: 0, cover: '', mtime: 0 });
  }
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth === 0) walk(abs, depth + 1);
        continue;
      }
      const kind = kindOf(abs);
      if (kind !== 'image' && kind !== 'audio') continue;
      const rel = relOf(root, abs);
      const group = groupOfRel(rel);
      const type = group ? GROUP_TYPE : (TYPE_IDS.has(data.types[rel]) ? data.types[rel] : 'other');
      const meta = typeMeta(type);
      const size = imageSize(abs);
      const st = fs.statSync(abs);
      items.push({
        name: entry.name,
        rel,
        path: abs,
        folder: group || '未归类',
        group,
        kind,
        type,
        typeLabel: meta.label,
        subject: (data.subjects && data.subjects[rel]) || '',
        width: size.width,
        height: size.height,
        bytes: st.size,
        mtime: st.mtimeMs,
        url: '/api/assets/file?rel=' + encodeURIComponent(rel),
      });
      if (group) {
        const row = groupMap.get(group) || { name: group, rel: group, count: 0, cover: '', mtime: 0 };
        row.count += 1;
        if (!row.cover && kind === 'image') row.cover = '/api/assets/file?rel=' + encodeURIComponent(rel);
        row.mtime = Math.max(row.mtime, st.mtimeMs);
        groupMap.set(group, row);
      }
    }
  };
  walk(root, 0);
  items.sort((a, b) => b.mtime - a.mtime);
  const typeCounts = ASSET_TYPES.map((type) => ({
    ...type,
    count: items.filter((item) => item.type === type.id).length,
  }));
  return {
    root,
    projectId: String(projectId || ''),
    items,
    types: typeCounts,
    groups: [...groupMap.values()].sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name)),
  };
}

/* ------------------------------- 写入 ------------------------------- */

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  let i = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return candidate;
}

function saveAssetUpload(projectId, fileName, buffer, group, type) {
  const root = assetRoot(projectId);
  const groupName = String(group || '').trim();
  const dir = groupName && groupName !== '全部' ? ensureDir(path.join(root, safeSegment(groupName))) : root;
  const target = uniquePath(dir, sanitizeFilename(fileName || 'image.png'));
  fs.writeFileSync(target, buffer);
  const rel = relOf(root, target);
  const assignedGroup = groupName && groupName !== '全部' ? groupName : '';
  if (assignedGroup) {
    updateMeta(projectId, (row) => { row.types[rel] = GROUP_TYPE; });
    return { path: target, rel, type: GROUP_TYPE, group: assignedGroup };
  }
  const value = type ? assertType(type) : 'other';
  if (value !== 'other') updateMeta(projectId, (row) => { row.types[rel] = value; });
  return { path: target, rel, type: value, group: '' };
}

function setSubject(projectId, rel, subject) {
  const key = String(rel);
  updateMeta(projectId, (row) => {
    row.subjects = row.subjects || {};
    if (subject) row.subjects[key] = String(subject).slice(0, 80);
    else delete row.subjects[key];
  });
  return true;
}

function setType(projectId, rel, type) {
  const key = String(rel);
  if (groupOfRel(key)) throw new Error('分镜文件夹里的图片固定是「分镜参考」，不能单独改类型');
  const value = assertType(type);
  if (value === GROUP_TYPE) throw new Error('分镜参考请通过新建分镜文件夹上传，不能直接设为该类型');
  updateMeta(projectId, (row) => {
    row.types = row.types || {};
    row.types[key] = value;
  });
  return { rel: key, type: value };
}

function assetFile(projectId, rel) {
  const root = path.resolve(assetRoot(projectId));
  const abs = path.resolve(root, String(rel));
  workspace.assertInside(root, abs);
  if (!fs.existsSync(abs)) throw new Error('文件不存在');
  return abs;
}

function moveMetaRel(projectId, fromRel, toRel, row) {
  if (row.subjects && row.subjects[fromRel]) {
    row.subjects[toRel] = row.subjects[fromRel];
    delete row.subjects[fromRel];
  }
  if (row.types && row.types[fromRel]) {
    row.types[toRel] = row.types[fromRel];
    delete row.types[fromRel];
  }
}

function renameAsset(projectId, rel, newName) {
  const root = assetRoot(projectId);
  const abs = assetFile(projectId, rel);
  const clean = sanitizeFilename(newName || '');
  if (!clean) throw new Error('文件名不能为空');
  const target = path.join(path.dirname(abs), clean);
  if (fs.existsSync(target) && target !== abs) throw new Error('同名文件已存在');
  fs.renameSync(abs, target);
  generationStore.link(abs, target, true);
  const nextRel = relOf(root, target);
  updateMeta(projectId, (row) => moveMetaRel(projectId, String(rel), nextRel, row));
  return nextRel;
}

/** group 非空表示移入该分镜文件夹；传空表示移回素材库根目录。 */
function moveAsset(projectId, rel, group) {
  const root = assetRoot(projectId);
  const abs = assetFile(projectId, rel);
  const groupName = String(group || '').trim();
  const destDir = groupName && groupName !== '全部' && groupName !== '未归类' ? ensureDir(path.join(root, safeSegment(groupName))) : root;
  const target = uniquePath(destDir, path.basename(abs));
  fs.renameSync(abs, target);
  generationStore.link(abs, target, true);
  const nextRel = relOf(root, target);
  const nextGroup = groupOfRel(nextRel);
  updateMeta(projectId, (row) => {
    const oldType = row.types && row.types[String(rel)];
    moveMetaRel(projectId, String(rel), nextRel, row);
    if (nextGroup) row.types[nextRel] = GROUP_TYPE;
    else if (oldType === GROUP_TYPE) delete row.types[nextRel];
  });
  return { rel: nextRel, group: nextGroup, type: nextGroup ? GROUP_TYPE : (metaFor(projectId).types[nextRel] || 'other') };
}

function createGroup(projectId, name) {
  const clean = safeSegment(name);
  if (!clean || clean === '全部' || clean === '未归类') throw new Error('分镜名称不能为空，也不能叫「全部/未归类」');
  ensureDir(path.join(assetRoot(projectId), clean));
  return clean;
}

function fileForAsset(projectId, rel) {
  return assetFile(projectId, rel);
}

/* ------------------------------------ 媒体库 ------------------------------------ */

function listMedia(kind, projectId) {
  const root = path.resolve(mediaRoot(projectId));
  const items = [];
  const jobs = require('./jobs');
  const events = require('./events');
  const keyOf = (file) => path.resolve(file).toLowerCase();
  const jobByPath = new Map();
  for (const job of jobs.list()) for (const out of job.outputs || []) if (out.path) jobByPath.set(keyOf(out.path), job);
  const eventCache = new Map();
  const resolveEvent = (eventId) => {
    if (!eventId) return null;
    if (!eventCache.has(eventId)) {
      try { eventCache.set(eventId, events.get(eventId)); } catch { eventCache.set(eventId, null); }
    }
    return eventCache.get(eventId);
  };
  let days = [];
  try {
    days = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { days = []; }
  for (const day of days) {
    if (day === 'images') continue;
    const dayDir = path.join(root, day);
    const jobs = fs.readdirSync(dayDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const jobEntry of jobs) {
      const jobDir = path.join(dayDir, jobEntry.name);
      let files = [];
      try { files = fs.readdirSync(jobDir, { withFileTypes: true }); } catch { continue; }
      const params = readJson(path.join(jobDir, 'params.json'), null);
      for (const entry of files) {
        if (!entry.isFile()) continue;
        const kindOfFile = kindOf(entry.name);
        if (kindOfFile !== 'video' && kindOfFile !== 'image') continue;
        if (kind && kind !== kindOfFile) continue;
        const abs = path.join(jobDir, entry.name);
        const st = fs.statSync(abs);
        const job = jobByPath.get(keyOf(abs));
        const needsMeta = !params || !params.taskTitle || !params.shotLabel;
        const event = needsMeta ? resolveEvent(job && job.eventId) : null;
        const eventItem = event ? (event.items || []).find((row) => row.id === job.eventItemId) : null;
        items.push({
          day,
          jobId: jobEntry.name,
          name: entry.name,
          path: abs,
          kind: kindOfFile,
          bytes: st.size,
          mtime: st.mtimeMs,
          title: (params && params.workflow) || '',
          taskTitle: (params && (params.taskTitle || params.eventTitle)) || (event && event.title) || (job && job.taskTitle) || '',
          shotLabel: (params && (params.title || params.shotLabel)) || (eventItem && eventItem.title) || (job && job.title) || '',
          outputLabel: (params && (params.outputLabel || params.shotLabel)) || '',
          eventId: (params && params.eventId) || (job && job.eventId) || '',
          prompt: params ? String(params.prompt || '').slice(0, 160) : '',
          url: '/api/media/file?path=' + encodeURIComponent(abs),
          rel: path.relative(root, abs).split(path.sep).join('/'),
        });
      }
    }
  }
  const imagesRoot = path.join(root, 'images');
  if (!kind || kind === 'image') {
    let imageDays = [];
    try { imageDays = fs.readdirSync(imagesRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { imageDays = []; }
    for (const day of imageDays) {
      const dir = path.join(imagesRoot, day);
      let files = [];
      try { files = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of files) {
        if (!entry.isFile() || kindOf(entry.name) !== 'image') continue;
        const abs = path.join(dir, entry.name);
        const st = fs.statSync(abs);
        items.push({
          day,
          jobId: 'images',
          name: entry.name,
          path: abs,
          kind: 'image',
          bytes: st.size,
          mtime: st.mtimeMs,
          title: '图像生成',
          prompt: '',
          url: '/api/media/file?path=' + encodeURIComponent(abs),
          rel: path.relative(root, abs).split(path.sep).join('/'),
        });
      }
    }
  }
  items.sort((a, b) => b.mtime - a.mtime);
  const project = projectOrNull(projectId);
  return { root, projectId: String(projectId || ''), projectName: project ? project.name : '', items };
}

function mediaFile(projectId, file) {
  const root = path.resolve(mediaRoot(projectId));
  const abs = path.resolve(String(file || ''));
  workspace.assertInside(root, abs);
  if (!fs.existsSync(abs)) throw new Error('文件不存在');
  return abs;
}

/* ------------------------------------- 系统打开 ------------------------------------- */

function openPath(target, { select = false } = {}) {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error('路径不存在：' + abs);
  const stat = fs.statSync(abs);
  const child = spawn('explorer.exe', select && stat.isFile() ? ['/select,', abs] : [abs], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return true;
}

function openUrl(target) {
  const url = String(target || '');
  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } else if (process.platform === 'darwin') {
    const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
  }
  return true;
}

function openWithSystemPlayer(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error('文件不存在');
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', abs], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return true;
}

module.exports = {
  ASSET_TYPES,
  typeMeta,
  defaultTypeForFolder,
  assertType,
  assetRoot,
  mediaRoot,
  uploadRoot,
  exportsRoot,
  scanAssets,
  saveAssetUpload,
  setSubject,
  setType,
  renameAsset,
  moveAsset,
  createGroup,
  createFolder: createGroup,
  fileForAsset,
  listMedia,
  mediaFile,
  moveProjectMeta,
  metaFor,
  openPath,
  openWithSystemPlayer,
  imageSize,
  openUrl,
  relOf,
};
