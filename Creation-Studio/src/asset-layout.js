'use strict';
/**
 * 素材库新结构：
 *   assets/分镜/<镜头>/图一..图九 + shot.json
 *   assets/素材/{人物,场景,道具}/...
 *   assets/其他/...
 */
const fs = require('node:fs');
const path = require('node:path');
const library = require('./library');
const { ensureDir, readJson, writeJson, sanitizeFilename, safeSegment, kindOf } = require('./util');

const MATERIALS = [
  { id: 'character', dir: '人物', label: '人物' },
  { id: 'scene', dir: '场景', label: '场景' },
  { id: 'prop', dir: '道具', label: '道具' },
];
const SLOT_LABELS = ['图一', '图二', '图三', '图四', '图五', '图六', '图七', '图八', '图九'];
const SHOT_JSON = 'shot.json';

function rootFor(projectId) {
  const root = library.assetRoot(projectId);
  ensureLayout(root);
  return root;
}

function layoutOf(root) {
  return {
    storyboard: path.join(root, '分镜'),
    material: path.join(root, '素材'),
    other: path.join(root, '其他'),
  };
}

function ensureLayout(root) {
  const layout = layoutOf(root);
  ensureDir(layout.storyboard);
  ensureDir(layout.other);
  for (const material of MATERIALS) ensureDir(path.join(layout.material, material.dir));
  return layout;
}

function relOf(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

function urlOf(rel) {
  return '/api/assets/file?rel=' + encodeURIComponent(rel);
}

function materialMeta(type) {
  return MATERIALS.find((item) => item.id === type) || MATERIALS[0];
}

function safeShotName(name) {
  const clean = safeSegment(String(name || '').trim());
  if (!clean || clean === '.' || clean === '..') throw new Error('分镜名称不能为空');
  return clean;
}

function shotDir(root, shot) {
  return path.join(layoutOf(root).storyboard, safeShotName(shot));
}

function slotIndex(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 9) throw new Error('图框必须是 1–9');
  return number;
}

function slotFiles(dir, slot) {
  const label = SLOT_LABELS[slot - 1];
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  return entries.filter((name) => path.basename(name, path.extname(name)) === label);
}

function removeSlotFiles(dir, slot) {
  for (const name of slotFiles(dir, slot)) {
    try { fs.unlinkSync(path.join(dir, name)); } catch { /* ignore */ }
  }
}

function readShotJson(dir) {
  const preferred = path.join(dir, SHOT_JSON);
  let file = fs.existsSync(preferred) ? preferred : '';
  if (!file) {
    try {
      file = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.json')).map((name) => path.join(dir, name))[0] || '';
    } catch { file = ''; }
  }
  if (!file) return { file: '', data: null };
  return { file, data: readJson(file, null) };
}

function shotSlots(root, dir) {
  const slots = SLOT_LABELS.map((label, index) => ({ slot: index + 1, label, rel: '', url: '', name: '' }));
  let images = [];
  try { images = fs.readdirSync(dir).filter((name) => kindOf(name) === 'image').sort(); } catch { images = []; }
  const leftovers = [];
  for (const name of images) {
    const base = path.basename(name, path.extname(name));
    const index = SLOT_LABELS.indexOf(base);
    if (index >= 0) {
      const rel = relOf(root, path.join(dir, name));
      slots[index] = { ...slots[index], rel, url: urlOf(rel), name };
    } else {
      leftovers.push(name);
    }
  }
  // 旧分镜文件夹里不是「图一」命名的图片，按顺序补进空槽，保证能看到。
  for (const name of leftovers) {
    const empty = slots.find((item) => !item.rel);
    if (!empty) break;
    const rel = relOf(root, path.join(dir, name));
    empty.rel = rel; empty.url = urlOf(rel); empty.name = name;
  }
  return slots;
}

function listShots(root) {
  const dir = layoutOf(root).storyboard;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { entries = []; }
  const shots = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const slots = shotSlots(root, abs);
    const { file, data } = readShotJson(abs);
    let mtime = 0;
    try { mtime = fs.statSync(abs).mtimeMs; } catch { /* ignore */ }
    const images = slots.filter((slot) => slot.rel);
    shots.push({
      name: entry.name,
      rel: relOf(root, abs),
      prompt: String(data?.prompt || data?.userPrompt || ''),
      title: String(data?.title || entry.name),
      jsonRel: file ? relOf(root, file) : '',
      json: data,
      slots,
      count: images.length,
      cover: images[0]?.url || '',
      mtime,
    });
  }
  return shots.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function listMaterial(root, type) {
  const meta = materialMeta(type);
  const dir = path.join(layoutOf(root).material, meta.dir);
  ensureDir(dir);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { entries = []; }
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const kind = kindOf(entry.name);
    if (kind !== 'image' && kind !== 'audio') continue;
    const abs = path.join(dir, entry.name);
    const st = fs.statSync(abs);
    const rel = relOf(root, abs);
    items.push({
      name: entry.name, rel, url: urlOf(rel), kind, type: meta.id, typeLabel: meta.label,
      category: meta.label, bytes: st.size, mtime: st.mtimeMs,
    });
  }
  return items.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name, 'zh-CN'));
}

function listOther(root) {
  const dir = layoutOf(root).other;
  ensureDir(dir);
  const items = [];
  const walk = (current, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) { if (depth < 2) walk(abs, depth + 1); continue; }
      const kind = kindOf(entry.name);
      if (kind !== 'image' && kind !== 'audio') continue;
      const st = fs.statSync(abs);
      const rel = relOf(root, abs);
      items.push({ name: entry.name, rel, url: urlOf(rel), kind, type: 'other', typeLabel: '其他', category: '其他', bytes: st.size, mtime: st.mtimeMs });
    }
  };
  walk(dir, 0);
  return items.sort((a, b) => b.mtime - a.mtime);
}

function scan(projectId) {
  const root = rootFor(projectId);
  const shots = listShots(root);
  const materials = {};
  for (const material of MATERIALS) materials[material.id] = listMaterial(root, material.id);
  const other = listOther(root);
  const flat = [];
  for (const material of MATERIALS) {
    for (const item of materials[material.id]) flat.push({ ...item, group: '', folder: material.label });
  }
  for (const shot of shots) {
    for (const slot of shot.slots.filter((row) => row.rel)) {
      flat.push({
        name: slot.name, rel: slot.rel, url: slot.url, kind: 'image', type: 'storyboard',
        typeLabel: '分镜参考', group: shot.name, folder: shot.name, slot: slot.label, bytes: 0, mtime: shot.mtime,
      });
    }
  }
  for (const item of other) flat.push({ ...item, group: '', folder: '其他' });
  const types = [
    ...MATERIALS.map((material) => ({ id: material.id, label: material.label, hint: '', count: materials[material.id].length })),
    { id: 'storyboard', label: '分镜参考', hint: '一个分镜一个文件夹', count: shots.length },
    { id: 'other', label: '其他', hint: '未归类', count: other.length },
  ];
  return {
    root,
    layout: layoutOf(root),
    shots,
    materials,
    other,
    items: flat,
    types,
    groups: shots.map((shot) => ({ name: shot.name, rel: shot.rel, count: shot.count, cover: shot.cover, mtime: shot.mtime })),
  };
}

function ensureJson(dir, shot) {
  const file = path.join(dir, SHOT_JSON);
  if (fs.existsSync(file)) return file;
  const data = { title: shot, prompt: '', images: [], slots: {}, source: '' };
  writeJson(file, data);
  return file;
}

function readJsonAt(dir) {
  const { data } = readShotJson(dir);
  return data || { title: path.basename(dir), prompt: '', images: [], slots: {} };
}

function saveSlotBuffer(root, shot, slot, fileName, buffer, meta = {}) {
  const index = slotIndex(slot);
  const dir = ensureDir(shotDir(root, shot));
  const ext = path.extname(sanitizeFilename(fileName || 'image.png')) || '.png';
  removeSlotFiles(dir, index);
  const target = path.join(dir, SLOT_LABELS[index - 1] + ext);
  fs.writeFileSync(target, buffer);
  const rel = relOf(root, target);
  syncJsonSlot(root, shot, index, { path: target, name: path.basename(target), sourcePath: meta.sourcePath || '', note: meta.note || '' });
  return { rel, url: urlOf(rel), slot: index, label: SLOT_LABELS[index - 1] };
}

function syncJsonSlot(root, shot, index, image) {
  const dir = shotDir(root, shot);
  ensureJson(dir, shot);
  const file = path.join(dir, SHOT_JSON);
  const data = readJson(file, {}) || {};
  data.title = data.title || shot;
  data.prompt = data.prompt || '';
  const slots = { ...(data.slots || {}) };
  const label = SLOT_LABELS[index - 1];
  if (image) slots[label] = image; else delete slots[label];
  data.slots = slots;
  data.images = SLOT_LABELS.map((slotLabel, i) => {
    const row = slots[slotLabel] || (i === index - 1 ? image : null);
    if (!row) return null;
    return { path: row.path, name: row.name, note: row.note || '', slot: slotLabel, sourcePath: row.sourcePath || '' };
  }).filter(Boolean);
  writeJson(file, data);
}

function saveMaterialBuffer(projectId, type, fileName, buffer) {
  const root = rootFor(projectId);
  const meta = materialMeta(type);
  const dir = ensureDir(path.join(layoutOf(root).material, meta.dir));
  const clean = sanitizeFilename(fileName || 'image.png');
  const ext = path.extname(clean);
  const base = path.basename(clean, ext);
  let target = path.join(dir, clean);
  let i = 2;
  while (fs.existsSync(target)) target = path.join(dir, `${base} (${i++})${ext}`);
  fs.writeFileSync(target, buffer);
  const rel = relOf(root, target);
  return { name: path.basename(target), rel, url: urlOf(rel), type: meta.id, typeLabel: meta.label };
}

function createShot(projectId, name, prompt = '') {
  const root = rootFor(projectId);
  const shot = safeShotName(name);
  const dir = ensureDir(shotDir(root, shot));
  const file = path.join(dir, SHOT_JSON);
  if (!fs.existsSync(file)) writeJson(file, { title: shot, prompt: String(prompt || ''), images: [], slots: {}, source: '' });
  return { name: shot, dir, rel: relOf(root, dir) };
}

function updateShot(projectId, name, patch = {}) {
  const root = rootFor(projectId);
  const dir = ensureDir(shotDir(root, name));
  ensureJson(dir, name);
  const file = path.join(dir, SHOT_JSON);
  const data = readJson(file, {}) || {};
  if (patch.prompt != null) data.prompt = String(patch.prompt);
  if (patch.title != null) data.title = String(patch.title);
  if (patch.json && typeof patch.json === 'object') Object.assign(data, patch.json);
  data.updatedAt = Date.now();
  writeJson(file, data);
  return { name, rel: relOf(root, dir) };
}

function copyToSlot(projectId, shot, slot, sourceRel) {
  const root = rootFor(projectId);
  const index = slotIndex(slot);
  const source = path.resolve(root, String(sourceRel || ''));
  if (!source.startsWith(path.resolve(root)) || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('素材文件不存在');
  return saveSlotBuffer(root, shot, index, path.basename(source), fs.readFileSync(source), { sourcePath: source });
}

function clearSlot(projectId, shot, slot) {
  const root = rootFor(projectId);
  const index = slotIndex(slot);
  const dir = ensureDir(shotDir(root, shot));
  removeSlotFiles(dir, index);
  syncJsonSlot(root, shot, index, null);
  return { slot: index, label: SLOT_LABELS[index - 1] };
}

function importShots(projectId, items, sourceName = '') {
  const root = rootFor(projectId);
  const list = Array.isArray(items) ? items : [];
  const shots = [];
  const warnings = [];
  list.forEach((item, index) => {
    const rawTitle = String(item.title || '').trim() || `镜头${String(index + 1).padStart(2, '0')}`;
    const base = safeShotName(rawTitle);
    let name = base;
    let suffix = 2;
    while (shots.some((row) => row.name === name)) name = `${base}-${suffix++}`;
    const dir = ensureDir(shotDir(root, name));
    for (let slot = 1; slot <= 9; slot += 1) removeSlotFiles(dir, slot);
    const images = Array.isArray(item.images) ? item.images.slice(0, 9) : [];
    const saved = [];
    images.forEach((image, imageIndex) => {
      const source = path.resolve(String(image.path || ''));
      if (!image.path || !fs.existsSync(source) || !fs.statSync(source).isFile()) {
        warnings.push(`第 ${index + 1} 个分镜的第 ${imageIndex + 1} 张参考图不存在：${image.path || '空'}`);
        return;
      }
      const ext = path.extname(source) || '.png';
      const target = path.join(dir, SLOT_LABELS[imageIndex] + ext);
      try { fs.copyFileSync(source, target); } catch (err) { warnings.push(`复制失败：${image.path}（${err.message}）`); return; }
      saved.push({ path: target, name: path.basename(target), note: String(image.note || ''), slot: SLOT_LABELS[imageIndex], sourcePath: source });
    });
    const json = {
      title: name,
      prompt: String(item.prompt || ''),
      prefixPrompt: String(item.prefixPrompt || ''),
      duration: item.duration == null ? null : item.duration,
      ratio: item.ratio || '',
      resolution: item.resolution || '',
      count: item.count == null ? null : item.count,
      images: saved,
      slots: Object.fromEntries(saved.map((row) => [row.slot, row])),
      audios: Array.isArray(item.audios) ? item.audios : [],
      extra: item.extra || {},
      source: String(sourceName || ''),
      importedAt: Date.now(),
    };
    writeJson(path.join(dir, SHOT_JSON), json);
    shots.push({ name, prompt: json.prompt, count: saved.length, slots: saved.length });
  });
  return { imported: shots.length, shots, warnings };
}

function deleteShot(projectId, name) {
  const root = rootFor(projectId);
  const dir = shotDir(root, name);
  if (!fs.existsSync(dir)) throw new Error('分镜不存在');
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, name };
}

module.exports = {
  MATERIALS, SLOT_LABELS, SHOT_JSON,
  rootFor, layoutOf, ensureLayout, scan, listShots, listMaterial,
  createShot, updateShot, saveSlotBuffer, copyToSlot, clearSlot, importShots, deleteShot, saveMaterialBuffer,
  materialMeta, urlOf, relOf, shotDir,
};
