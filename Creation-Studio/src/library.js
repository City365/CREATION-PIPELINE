'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('./config');
const generationStore = require('./generation-store');
const { readJson, writeJson, ensureDir, sanitizeFilename, safeSegment, kindOf, formatBytes, mimeFor } = require('./util');

const META_FILE = path.join(config.DATA, 'assets.json');

function meta() {
  return readJson(META_FILE, { subjects: {} });
}

function saveMeta(data) {
  writeJson(META_FILE, data);
}

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

/* ------------------------------------ 素材库 ------------------------------------ */

function assetRoot() {
  return ensureDir(config.load().assetFolder);
}

const FOLDER_ORDER = ['全部', '角色', '场景', '道具', '未归类'];

function scanAssets() {
  const root = assetRoot();
  const data = meta();
  const items = [];
  const folders = new Map();
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
      const folder = rel.includes('/') ? rel.split('/')[0] : '未归类';
      if (!folders.has(folder)) folders.set(folder, 0);
      folders.set(folder, folders.get(folder) + 1);
      const size = imageSize(abs);
      const st = fs.statSync(abs);
      items.push({
        name: entry.name,
        rel,
        path: abs,
        folder,
        kind,
        subject: (data.subjects && data.subjects[rel]) || '',
        width: size.width,
        height: size.height,
        bytes: st.size,
        mtime: st.mtimeMs,
        url: '/api/assets/file?rel=' + encodeURIComponent(rel),
      });
    }
  };
  walk(root, 0);
  items.sort((a, b) => b.mtime - a.mtime);
  return {
    root,
    items,
    folders: [...folders.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => {
      const ia = FOLDER_ORDER.indexOf(a.name);
      const ib = FOLDER_ORDER.indexOf(b.name);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
    }),
  };
}

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

function saveAssetUpload(fileName, buffer, folder) {
  const root = assetRoot();
  const dir = folder && folder !== '全部' && folder !== '未归类' ? ensureDir(path.join(root, safeSegment(folder))) : root;
  const target = uniquePath(dir, sanitizeFilename(fileName || 'image.png'));
  fs.writeFileSync(target, buffer);
  return { path: target, rel: relOf(root, target) };
}

function setSubject(rel, subject) {
  const data = meta();
  data.subjects = data.subjects || {};
  const key = String(rel);
  if (subject) data.subjects[key] = String(subject).slice(0, 80);
  else delete data.subjects[key];
  saveMeta(data);
  return true;
}

function renameAsset(rel, newName) {
  const root = assetRoot();
  const abs = path.resolve(root, rel);
  if (path.relative(path.resolve(root),abs).startsWith('..') || path.isAbsolute(path.relative(path.resolve(root),abs))) throw new Error('非法路径');
  const clean = sanitizeFilename(newName || '');
  if (!clean) throw new Error('文件名不能为空');
  const target = path.join(path.dirname(abs), clean);
  if (fs.existsSync(target) && target !== abs) throw new Error('同名文件已存在');
  fs.renameSync(abs, target);
  generationStore.link(abs,target,true);
  const data = meta();
  if (data.subjects && data.subjects[rel]) {
    data.subjects[relOf(root, target)] = data.subjects[rel];
    delete data.subjects[rel];
    saveMeta(data);
  }
  return relOf(root, target);
}

function moveAsset(rel, folder) {
  const root = assetRoot();
  const abs = path.resolve(root, rel);
  if (path.relative(path.resolve(root),abs).startsWith('..') || path.isAbsolute(path.relative(path.resolve(root),abs))) throw new Error('非法路径');
  const destDir = !folder || folder === '全部' || folder === '未归类' ? root : ensureDir(path.join(root, safeSegment(folder)));
  const target = uniquePath(destDir, path.basename(abs));
  fs.renameSync(abs, target);
  generationStore.link(abs,target,true);
  const data = meta();
  if (data.subjects && data.subjects[rel]) {
    data.subjects[relOf(root, target)] = data.subjects[rel];
    delete data.subjects[rel];
    saveMeta(data);
  }
  return relOf(root, target);
}

function createFolder(name) {
  const clean = safeSegment(name);
  if (!clean) throw new Error('文件夹名不能为空');
  ensureDir(path.join(assetRoot(), clean));
  return clean;
}

function fileForAsset(rel) {
  const root = path.resolve(assetRoot());
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root)) throw new Error('非法路径');
  if (!fs.existsSync(abs)) throw new Error('文件不存在');
  return abs;
}

/* ------------------------------------ 媒体库 ------------------------------------ */

function listMedia(kind) {
  const root = path.resolve(ensureDir(config.load().saveFolder));
  const items = [];
  let days = [];
  try {
    days = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { days = []; }
  for (const day of days) {
    if(day === 'images') continue;
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
        items.push({
          day,
          jobId: jobEntry.name,
          name: entry.name,
          path: abs,
          kind: kindOfFile,
          bytes: st.size,
          mtime: st.mtimeMs,
          title: (params && params.workflow) || '',
          prompt: params ? String(params.prompt || '').slice(0, 160) : '',
          url: '/api/media/file?path=' + encodeURIComponent(abs),
          rel: path.relative(root, abs).split(path.sep).join('/'),
        });
      }
    }
  }
  // Generated images live under images/<date>/ instead of a job folder.
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
  return { root, items };
}

function mediaFile(file) {
  const root = path.resolve(ensureDir(config.load().saveFolder));
  const abs = path.resolve(file);
  if (!abs.startsWith(root)) throw new Error('非法路径');
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
  scanAssets,
  saveAssetUpload,
  setSubject,
  renameAsset,
  moveAsset,
  createFolder,
  fileForAsset,
  listMedia,
  mediaFile,
  openPath,
  openWithSystemPlayer,
  imageSize,
  openUrl,
};
