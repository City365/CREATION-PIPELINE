'use strict';
/**
 * 素材库结构（按任务分组）：
 *   assets/分镜/<任务>/task.json
 *   assets/分镜/<任务>/<镜头>/图一..图九 + shot.json
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
const TASK_JSON = 'task.json';

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

function relOf(root, abs) { return path.relative(root, abs).split(path.sep).join('/'); }
function urlOf(rel) { return '/api/assets/file?rel=' + encodeURIComponent(rel); }
function materialMeta(type) { return MATERIALS.find((item) => item.id === type) || MATERIALS[0]; }
function safeName(name, fallback) {
  const clean = safeSegment(String(name || '').trim());
  return clean && clean !== '.' && clean !== '..' ? clean : fallback;
}

function storyboardRoot(root) { return layoutOf(root).storyboard; }

function readTaskJson(dir) {
  const file = path.join(dir, TASK_JSON);
  return fs.existsSync(file) ? readJson(file, null) : null;
}

function writeTaskJson(dir, data) {
  writeJson(path.join(dir, TASK_JSON), { ...data, updatedAt: Date.now() });
}

/** 找任务目录：先按 id，再按标题（兼容旧目录）。 */
function findTask(root, id, title) {
  const base = storyboardRoot(root);
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()); } catch { entries = []; }
  for (const entry of entries) {
    const dir = path.join(base, entry.name);
    const data = readTaskJson(dir);
    if (id && data && data.id === id) return { dir, data, name: entry.name };
  }
  if (title) {
    const clean = safeName(title, '');
    const dir = path.join(base, clean);
    if (clean && fs.existsSync(dir)) return { dir, data: readTaskJson(dir) || { title: clean }, name: clean };
  }
  return null;
}

function ensureTask(root, task = {}) {
  const base = storyboardRoot(root);
  const found = findTask(root, task.id, task.title);
  if (found) {
    const data = { id: task.id || found.data?.id || '', title: task.title || found.data?.title || found.name, source: task.source || found.data?.source || '' };
    writeTaskJson(found.dir, data);
    return { dir: found.dir, name: found.name, data };
  }
  const title = safeName(task.title || (task.source ? path.basename(task.source, path.extname(task.source)) : ''), '未命名任务');
  let name = title;
  let dir = path.join(base, name);
  let suffix = 2;
  while (fs.existsSync(dir)) {
    name = `${title}-${suffix++}`;
    dir = path.join(base, name);
  }
  ensureDir(dir);
  const data = { id: String(task.id || ''), title, source: String(task.source || ''), createdAt: Date.now() };
  writeTaskJson(dir, data);
  return { dir, name, data };
}

function shotDir(taskDir, shot) { return path.join(taskDir, safeName(shot, '镜头')); }

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
      file = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.json') && name !== TASK_JSON).map((name) => path.join(dir, name))[0] || '';
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
    } else leftovers.push(name);
  }
  for (const name of leftovers) {
    const empty = slots.find((item) => !item.rel);
    if (!empty) break;
    const rel = relOf(root, path.join(dir, name));
    empty.rel = rel; empty.url = urlOf(rel); empty.name = name;
  }
  return slots;
}

function readShot(root, dir, task) {
  const slots = shotSlots(root, dir);
  const { file, data } = readShotJson(dir);
  let mtime = 0;
  try { mtime = fs.statSync(dir).mtimeMs; } catch { /* ignore */ }
  const images = slots.filter((slot) => slot.rel);
  return {
    name: path.basename(dir),
    rel: relOf(root, dir),
    taskId: task.id || '',
    taskTitle: task.title || '',
    taskDir: task.dirName || '',
    prompt: String(data?.prompt || data?.userPrompt || ''),
    title: String(data?.title || path.basename(dir)),
    jsonRel: file ? relOf(root, file) : '',
    json: data,
    slots,
    count: images.length,
    cover: images[0]?.url || '',
    mtime,
  };
}

function taskShots(root, dir, task) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { entries = []; }
  const shots = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const hasShot = fs.existsSync(path.join(abs, SHOT_JSON)) || fs.readdirSync(abs).some((name) => kindOf(name) === 'image');
    if (!hasShot) continue;
    shots.push(readShot(root, abs, { ...task, dirName: path.basename(dir) }));
  }
  return shots.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function listTasks(root) {
  const base = storyboardRoot(root);
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')); } catch { entries = []; }
  const tasks = [];
  const legacyShots = [];
  for (const entry of entries) {
    const dir = path.join(base, entry.name);
    const data = readTaskJson(dir);
    if (!data) {
      const flat = readShotJson(dir);
      const hasImages = fs.readdirSync(dir).some((name) => kindOf(name) === 'image');
      if (flat.data || hasImages) {
        legacyShots.push(readShot(root, dir, { id: '', title: '未分组', dirName: entry.name }));
        continue;
      }
    }
    const task = { id: String(data?.id || ''), title: String(data?.title || entry.name), source: String(data?.source || ''), dirName: entry.name, dir };
    const shots = taskShots(root, dir, task);
    tasks.push({ ...task, shots, count: shots.length, mtime: fs.statSync(dir).mtimeMs });
  }
  tasks.sort((a, b) => b.mtime - a.mtime || a.title.localeCompare(b.title, 'zh-CN'));
  if (legacyShots.length) {
    tasks.push({ id: '', title: '未分组（旧结构）', source: '', dirName: '', dir: base, legacy: true, shots: legacyShots, count: legacyShots.length, mtime: 0 });
  }
  return tasks;
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
    items.push({ name: entry.name, rel, url: urlOf(rel), kind, type: meta.id, typeLabel: meta.label, category: meta.label, bytes: st.size, mtime: st.mtimeMs });
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
  const tasks = listTasks(root);
  const shots = tasks.flatMap((task) => task.shots);
  const materials = {};
  for (const material of MATERIALS) materials[material.id] = listMaterial(root, material.id);
  const other = listOther(root);
  const flat = [];
  for (const material of MATERIALS) for (const item of materials[material.id]) flat.push({ ...item, group: '', folder: material.label });
  for (const shot of shots) {
    for (const slot of shot.slots.filter((row) => row.rel)) {
      flat.push({ name: slot.name, rel: slot.rel, url: slot.url, kind: 'image', type: 'storyboard', typeLabel: '分镜参考', group: shot.name, folder: `${shot.taskTitle} / ${shot.name}`, slot: slot.label, bytes: 0, mtime: shot.mtime });
    }
  }
  for (const item of other) flat.push({ ...item, group: '', folder: '其他' });
  const types = [
    ...MATERIALS.map((material) => ({ id: material.id, label: material.label, hint: '', count: materials[material.id].length })),
    { id: 'storyboard', label: '分镜参考', hint: '任务 / 镜头', count: shots.length },
    { id: 'other', label: '其他', hint: '未归类', count: other.length },
  ];
  return {
    root, layout: layoutOf(root), tasks, shots, materials, other, items: flat, types,
    groups: tasks.map((task) => ({ name: task.title, rel: task.dirName, count: task.count, cover: task.shots[0]?.cover || '', mtime: task.mtime })),
  };
}

function ensureTaskShot(root, taskInput, shotName) {
  const task = ensureTask(root, taskInput);
  const dir = ensureDir(shotDir(task.dir, shotName));
  const shot = path.basename(dir);
  const file = path.join(dir, SHOT_JSON);
  if (!fs.existsSync(file)) writeJson(file, { title: shot, prompt: '', images: [], slots: {}, source: '' });
  return { task, dir, shot };
}

function createShot(projectId, taskInput, name) {
  const root = rootFor(projectId);
  const { task, shot, dir } = ensureTaskShot(root, taskInput || {}, name);
  return { name: shot, taskId: task.data.id, taskTitle: task.data.title, rel: relOf(root, dir) };
}

function updateShot(projectId, taskInput, shotName, patch = {}) {
  const root = rootFor(projectId);
  const { dir, shot } = ensureTaskShot(root, taskInput || {}, shotName);
  const file = path.join(dir, SHOT_JSON);
  const data = readJson(file, {}) || {};
  if (patch.prompt != null) data.prompt = String(patch.prompt);
  if (patch.title != null) data.title = String(patch.title);
  if (patch.json && typeof patch.json === 'object') Object.assign(data, patch.json);
  data.updatedAt = Date.now();
  writeJson(file, data);
  return { name: shot, rel: relOf(root, dir) };
}

function syncJsonSlot(root, taskInput, shotName, index, image) {
  const { dir } = ensureTaskShot(root, taskInput, shotName);
  const file = path.join(dir, SHOT_JSON);
  const data = readJson(file, {}) || {};
  data.title = data.title || shotName;
  data.prompt = data.prompt || '';
  const slots = { ...(data.slots || {}) };
  const label = SLOT_LABELS[index - 1];
  if (image) slots[label] = image; else delete slots[label];
  data.slots = slots;
  data.images = SLOT_LABELS.map((slotLabel) => slots[slotLabel]).filter(Boolean).map((row) => ({
    path: row.path, name: row.name, note: row.note || '', slot: row.slot, sourcePath: row.sourcePath || '',
  }));
  writeJson(file, data);
}

function saveSlotBuffer(root, taskInput, shotName, slot, fileName, buffer, meta = {}) {
  const index = slotIndex(slot);
  const { dir } = ensureTaskShot(root, taskInput, shotName);
  const ext = path.extname(sanitizeFilename(fileName || 'image.png')) || '.png';
  removeSlotFiles(dir, index);
  const target = path.join(dir, SLOT_LABELS[index - 1] + ext);
  fs.writeFileSync(target, buffer);
  const rel = relOf(root, target);
  syncJsonSlot(root, taskInput, shotName, index, { path: target, name: path.basename(target), sourcePath: meta.sourcePath || '', note: meta.note || '' });
  return { rel, url: urlOf(rel), slot: index, label: SLOT_LABELS[index - 1] };
}

function copyToSlot(projectId, taskInput, shotName, slot, sourceRel) {
  const root = rootFor(projectId);
  const index = slotIndex(slot);
  const source = path.resolve(root, String(sourceRel || ''));
  if (!source.startsWith(path.resolve(root)) || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('素材文件不存在');
  return saveSlotBuffer(root, taskInput, shotName, index, path.basename(source), fs.readFileSync(source), { sourcePath: source });
}

function clearSlot(projectId, taskInput, shotName, slot) {
  const root = rootFor(projectId);
  const index = slotIndex(slot);
  const { dir } = ensureTaskShot(root, taskInput, shotName);
  removeSlotFiles(dir, index);
  syncJsonSlot(root, taskInput, shotName, index, null);
  return { slot: index, label: SLOT_LABELS[index - 1] };
}

function moveLegacyShots(root, taskDir, sourceName) {
  const base = storyboardRoot(root);
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()); } catch { return; }
  for (const entry of entries) {
    const dir = path.join(base, entry.name);
    if (dir === taskDir) continue;
    const taskJson = path.join(dir, TASK_JSON);
    if (fs.existsSync(taskJson)) continue;
    const shotJson = readShotJson(dir);
    if (!shotJson.data) continue;
    if (sourceName && shotJson.data.source && shotJson.data.source !== sourceName) continue;
    const target = path.join(taskDir, entry.name);
    if (fs.existsSync(target)) continue;
    try { fs.renameSync(dir, target); } catch { /* 保留原目录 */ }
  }
}

function importShots(projectId, items, sourceName = '', taskInput = {}) {
  const root = rootFor(projectId);
  const list = Array.isArray(items) ? items : [];
  const task = ensureTask(root, {
    id: taskInput.id || '',
    title: taskInput.title || (sourceName ? path.basename(sourceName, path.extname(sourceName)) : '任务'),
    source: sourceName,
  });
  moveLegacyShots(root, task.dir, sourceName);
  const shots = [];
  const warnings = [];
  list.forEach((item, index) => {
    const rawTitle = String(item.title || '').trim() || `镜头${String(index + 1).padStart(2, '0')}`;
    const base = safeName(rawTitle, `镜头${index + 1}`);
    let name = base;
    let suffix = 2;
    while (shots.some((row) => row.name === name)) name = `${base}-${suffix++}`;
    const dir = ensureDir(shotDir(task.dir, name));
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
      ratio: item.ratio || item.aspectRatio || '',
      images: saved,
      slots: Object.fromEntries(saved.map((row) => [row.slot, row])),
      extra: item.extra || {},
      source: String(sourceName || ''),
      taskId: task.data.id || '',
      importedAt: Date.now(),
    };
    writeJson(path.join(dir, SHOT_JSON), json);
    shots.push({ name, prompt: json.prompt, count: saved.length, slots: saved.length });
  });
  writeTaskJson(task.dir, { ...task.data, count: shots.length, updatedAt: Date.now() });
  return { imported: shots.length, shots, warnings, task: { id: task.data.id, title: task.data.title, dir: relOf(root, task.dir) } };
}

function deleteShot(projectId, taskInput, name) {
  const root = rootFor(projectId);
  const task = findTask(root, taskInput?.id, taskInput?.title);
  if (!task) throw new Error('任务不存在');
  const dir = shotDir(task.dir, name);
  if (!fs.existsSync(dir)) throw new Error('分镜不存在');
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true, name };
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

function renameTask(projectId, taskInput, newTitle) {
  const root = rootFor(projectId);
  const found = findTask(root, taskInput?.id, taskInput?.title);
  if (!found) throw new Error('任务不存在');
  const title = safeName(newTitle, '');
  if (!title) throw new Error('任务名称不能为空');
  const base = storyboardRoot(root);
  let target = path.join(base, title);
  if (target !== found.dir) {
    let suffix = 2;
    while (fs.existsSync(target)) target = path.join(base, `${title}-${suffix++}`);
    fs.renameSync(found.dir, target);
  }
  const data = { ...(found.data || {}), title, id: found.data?.id || '' };
  writeTaskJson(target, data);
  return { id: data.id, title, dir: path.basename(target) };
}

function deleteTask(projectId, taskInput) {
  const root = rootFor(projectId);
  const found = findTask(root, taskInput?.id, taskInput?.title);
  if (!found) throw new Error('任务不存在');
  fs.rmSync(found.dir, { recursive: true, force: true });
  return { ok: true, title: found.data?.title || found.name };
}

function renameShot(projectId, taskInput, shotName, newName) {
  const root = rootFor(projectId);
  const found = findTask(root, taskInput?.id, taskInput?.title);
  if (!found) throw new Error('任务不存在');
  const oldDir = shotDir(found.dir, shotName);
  if (!fs.existsSync(oldDir)) throw new Error('分镜不存在');
  const clean = safeName(newName, '');
  if (!clean) throw new Error('镜头名称不能为空');
  const target = path.join(found.dir, clean);
  if (target !== oldDir) {
    if (fs.existsSync(target)) throw new Error('同名镜头已存在');
    fs.renameSync(oldDir, target);
  }
  const file = path.join(target, SHOT_JSON);
  if (fs.existsSync(file)) {
    const data = readJson(file, {}) || {};
    data.title = clean;
    writeJson(file, data);
  }
  return { name: clean, taskId: found.data?.id || '', taskTitle: found.data?.title || found.name };
}

function renameMaterial(projectId, rel, newName) {
  const root = rootFor(projectId);
  const abs = path.resolve(root, String(rel || ''));
  if (!abs.startsWith(path.resolve(root)) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('素材文件不存在');
  const clean = safeName(newName, '');
  if (!clean) throw new Error('文件名不能为空');
  const ext = path.extname(abs);
  const nextName = path.extname(clean) ? clean : clean + ext;
  const target = path.join(path.dirname(abs), nextName);
  if (target !== abs) {
    if (fs.existsSync(target)) throw new Error('同名文件已存在');
    fs.renameSync(abs, target);
  }
  return { rel: relOf(root, target), name: path.basename(target), url: urlOf(relOf(root, target)) };
}

function deleteMaterial(projectId, rel) {
  const root = rootFor(projectId);
  const abs = path.resolve(root, String(rel || ''));
  if (!abs.startsWith(path.resolve(root)) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('素材文件不存在');
  fs.unlinkSync(abs);
  return { ok: true };
}

function createTask(projectId, title) {
  const root = rootFor(projectId);
  const task = ensureTask(root, { title });
  return { id: task.data.id, title: task.data.title, dir: task.name };
}

module.exports = {
  MATERIALS, SLOT_LABELS, SHOT_JSON, TASK_JSON,
  rootFor, layoutOf, ensureLayout, scan, listTasks, listMaterial,
  findTask, ensureTask, createTask, createShot, updateShot, saveSlotBuffer, copyToSlot, clearSlot, importShots, deleteShot, saveMaterialBuffer,
  renameTask, deleteTask, renameShot, renameMaterial, deleteMaterial,
  materialMeta, urlOf, relOf,
};
