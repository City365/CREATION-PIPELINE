'use strict';
/**
 * 剪映草稿：把一集成片按镜头顺序写成一个剪映工程，打开剪映就能在「本地草稿」里看到。
 *
 * 做法是生成剪映 5.x 兼容的明文工程（version 360000）——新版剪映保存时会把草稿
 * 加密，但它仍要能打开老版本留下的明文草稿，所以这条路是稳定的。
 * 写入前必须关闭剪映：运行中的剪映退出时会用内存里的草稿列表覆盖 root_meta_info.json。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const config = require('./config');
const { readJson, safeSegment } = require('./util');

const SKELETON_FILE = path.join(__dirname, 'resources', 'jianying-skeleton.json');
const INDEX_PARTS = ['JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft', 'root_meta_info.json'];
const DEFAULT_SECONDS = 5;
const IMAGE_SECONDS = 3;

function localAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

function indexPath() {
  return path.join(localAppData(), ...INDEX_PARTS);
}

function readIndex() {
  const file = indexPath();
  const data = readJson(file, null);
  if (!data || !Array.isArray(data.all_draft_store)) return { file, data: null };
  return { file, data };
}

function isRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq JianyingPro.exe', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    return /JianyingPro\.exe/i.test(out);
  } catch {
    return false;
  }
}

function draftRoots() {
  const override = String(config.load().jianyingDraftRoot || '').trim();
  const { data } = readIndex();
  const roots = [];
  if (override) roots.push(path.resolve(override));
  for (const row of data ? data.all_draft_store : []) {
    const root = String(row.draft_root_path || '').trim();
    if (root && !roots.some((item) => item.toLowerCase() === path.resolve(root).toLowerCase())) roots.push(path.resolve(root));
  }
  return roots;
}

function status() {
  const { file, data } = readIndex();
  const roots = draftRoots();
  return {
    available: Boolean(data) && roots.length > 0,
    indexPath: file,
    roots,
    root: roots[0] || '',
    running: isRunning(),
  };
}

/* --------------------------------- 媒体信息 --------------------------------- */

function boxes(buf, start, end) {
  const out = [];
  let pos = start;
  let guard = 0;
  while (pos + 8 <= end && guard++ < 500) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) break;
    out.push({ type, start: pos + header, end: pos + size });
    pos += size;
  }
  return out;
}

function findBox(buf, start, end, type) {
  return boxes(buf, start, end).find((box) => box.type === type) || null;
}

function mp4Info(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    let pos = 0;
    let moov = null;
    let guard = 0;
    while (pos + 8 <= size && guard++ < 500) {
      let boxSize = Buffer.alloc(16);
      if (fs.readSync(fd, boxSize, 0, 16, pos) < 8) return null;
      let len = boxSize.readUInt32BE(0);
      const type = boxSize.toString('ascii', 4, 8);
      let header = 8;
      if (len === 1) { len = Number(boxSize.readBigUInt64BE(8)); header = 16; }
      else if (len === 0) len = size - pos;
      if (len < header) return null;
      if (type === 'moov') { moov = { start: pos + header, end: pos + len }; break; }
      pos += len;
    }
    if (!moov) return null;
    const length = Math.min(moov.end - moov.start, 64 * 1024 * 1024);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, moov.start);
    const moovEnd = length;
    let duration = 0;
    let width = 0;
    let height = 0;
    let hasAudio = false;
    const mvhd = findBox(buf, 0, moovEnd, 'mvhd');
    if (mvhd) {
      const version = buf.readUInt8(mvhd.start);
      const timescale = buf.readUInt32BE(mvhd.start + (version === 1 ? 20 : 12));
      const length32 = version === 1
        ? Number(buf.readBigUInt64BE(mvhd.start + 24))
        : buf.readUInt32BE(mvhd.start + 16);
      if (timescale > 0) duration = length32 / timescale;
    }
    for (const trak of boxes(buf, 0, moovEnd).filter((box) => box.type === 'trak')) {
      const tkhd = findBox(buf, trak.start, trak.end, 'tkhd');
      if (tkhd && tkhd.end - tkhd.start >= 8) {
        const w = buf.readUInt32BE(tkhd.end - 8) / 65536;
        const h = buf.readUInt32BE(tkhd.end - 4) / 65536;
        if (w >= 1 && h >= 1 && !width) { width = Math.round(w); height = Math.round(h); }
      }
      const mdia = findBox(buf, trak.start, trak.end, 'mdia');
      if (mdia) {
        const hdlr = findBox(buf, mdia.start, mdia.end, 'hdlr');
        if (hdlr && buf.toString('ascii', hdlr.start + 8, hdlr.start + 12) === 'soun') hasAudio = true;
      }
    }
    if (!duration) return null;
    return { duration, width, height, hasAudio };
  } catch {
    return null;
  } finally {
    if (fd) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

/** 探测成片时长/画幅；探不到就给默认值，不让一条坏文件卡住整集。 */
function probeMedia(file, kind) {
  const info = mp4Info(file);
  if (info) {
    return {
      duration: info.duration > 0 ? info.duration : DEFAULT_SECONDS,
      width: info.width || 1280,
      height: info.height || 720,
      hasAudio: info.hasAudio,
    };
  }
  return { duration: kind === 'image' ? IMAGE_SECONDS : DEFAULT_SECONDS, width: 1280, height: 720, hasAudio: kind !== 'image' };
}

/* --------------------------------- 草稿内容 --------------------------------- */

function newId() {
  return crypto.randomUUID().toUpperCase();
}

function micros(seconds) {
  return Math.max(1, Math.round(seconds * 1e6));
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

function ratioLabel(width, height) {
  if (!width || !height) return '16:9';
  const value = width / height;
  if (Math.abs(value - 16 / 9) < 0.02) return '16:9';
  if (Math.abs(value - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(value - 4 / 3) < 0.02) return '4:3';
  if (Math.abs(value - 3 / 4) < 0.02) return '3:4';
  if (Math.abs(value - 1) < 0.02) return '1:1';
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function videoMaterial(clip) {
  return {
    aigc_type: 'none', audio_fade: null, beauty_body_preset_id: '', beauty_face_preset_infos: [],
    beauty_global: {
      beauty_face_auto_preset_id: '', beauty_face_auto_preset_infos: [], beauty_face_preset_id: '',
      beauty_face_preset_infos: [], beauty_global_id: '', blush: 0, bright_enable: false, brighten: 0,
      clarity: 0, contrast: 0, enable_skin_tone: false, eye_enlarge: 0.4, face_slim: 0.4, filter_id: '',
      filter_intensity: 0.8, girl_eye_enlarge: 0, girl_face_slim: 0, id: '', male_eye_enlarge: 0,
      male_face_slim: 0, rough_enable: false, sharpen: 0, smooth_enable: false, smoothness: 0,
      smoothness_id: '', tone_enable: false, tone_intensity: 0, white_enable: false, white_intensity: 0,
    },
    category_id: '', category_name: 'local', check_flag: 63487, crop_ratio: 'free', crop_scale: 1,
    crop_position_x: 0, crop_position_y: 0, duration: micros(clip.duration), extra_type_option: 0, formula_id: '',
    freeze: null, has_audio: Boolean(clip.hasAudio), height: clip.height, id: newId(),
    intensifies_audio_path: '', intensifies_path: '', is_ai_generate_content: false, is_copyright: false,
    is_text_edit_overdub: false, is_unified_beauty_mode: false, local_id: '', local_material_id: '',
    matting: { flag: 0, has_use_quick_brush: false, has_use_quick_eraser: false, interactiveTime: [], path: '', strokes: [] },
    material_id: '', material_name: clip.name, media_path: '', object_id: '', origin_material_id: '',
    path: clip.path, picture_from: 'none', picture_set_category_id: '', picture_set_category_name: '',
    request_id: '', reverse_intensifies_path: '', reverse_path: '', smart_motion: null, source: 0,
    source_platform: 0, stable: null, team_id: '', type: 'video',
    video_algorithm: {
      algorithms: [], complement_frame_config: null, denoise: null, deflicker: null, gameplay_configs: [],
      object_segmentation_config: {
        custom_matting_config: { custom_matting_id: '', enable_matting: false, feather: 5, matting_path: '', matting_proto: '', quick_brush_path: '' },
        enable_sky_seg: false, sky_seg_path: '', stable_config: null,
      },
      smart_complement_frame: null, super_resolution: null, video_denoise_config: null,
    },
    width: clip.width,
  };
}

function segmentFor(material, clip, start) {
  const duration = micros(clip.duration);
  return {
    caption_info: null, cartoon: false,
    clip: { alpha: 1, flip: { horizontal: false, vertical: false }, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 } },
    common_keyframes: [], enable_adjust: true, enable_color_correct_adjust: false, enable_color_curves: true,
    enable_color_match_adjust: false, enable_color_wheels: true, enable_lut: true, enable_smart_color_adjust: false,
    extra_material_refs: [], group_id: '', hdr_settings: { intensity: 1, mode: 1, nits: 1000 }, id: newId(),
    intensifies_audio: false, is_placeholder: false, is_tone_modify: false, keyframe_refs: [],
    last_nonzero_volume: 1, material_id: material.id, render_index: 0,
    responsive_layout: { enable: false, horizontal_pos_layout: 0, target_follow: '', vertical_pos_layout: 0 },
    reverse: false, source_timerange: { duration, start: 0 }, speed: 1,
    target_timerange: { duration, start }, template_id: '', template_scene: 'default',
    track_attribute: 0, track_render_index: 0, uniform_scale: { on: true, value: 1 }, visible: true, volume: 1,
  };
}

function buildDraft(name, clips) {
  const skeleton = JSON.parse(fs.readFileSync(SKELETON_FILE, 'utf8'));
  const draft = skeleton;
  const now = Date.now();
  const first = clips[0] || { width: 1280, height: 720 };
  const width = first.width || 1280;
  const height = first.height || 720;
  draft.id = newId();
  draft.name = name;
  draft.canvas_config = { background: null, height, ratio: ratioLabel(width, height), width };
  draft.create_time = now * 1000;
  draft.update_time = now * 1000;
  draft.duration = 0;
  draft.tracks = [];
  const segments = [];
  let cursor = 0;
  for (const clip of clips) {
    const material = videoMaterial(clip);
    draft.materials.videos.push(material);
    segments.push(segmentFor(material, clip, cursor));
    cursor += micros(clip.duration);
  }
  draft.duration = cursor;
  if (segments.length) {
    draft.tracks.push({ attribute: 0, id: newId(), is_default_name: true, name: '', segments, type: 'video' });
  }
  return draft;
}

function draftMeta(name, dir, draft) {
  return {
    cloud_draft_cover: false, cloud_draft_sync: false, draft_cloud_last_action_download: false,
    draft_cloud_purchase_info: '', draft_cloud_template_id: '', draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '', draft_cover: '', draft_fold_path: dir, draft_id: draft.id,
    draft_is_ai_shorts: false, draft_is_cloud_temp_draft: false, draft_is_infinite_canvas_draft: false,
    draft_is_invisible: false, draft_is_pippit_draft: false, draft_is_web_article_video: false,
    draft_json_file: path.join(dir, 'draft_content.json'), draft_name: name, draft_new_version: '',
    draft_root_path: path.dirname(dir), draft_timeline_materials_size: 0, draft_type: '',
    draft_web_article_video_enter_from: '', pippit_avatar_url: '', pippit_extra_info: '', pippit_id: '',
    pippit_user_name: '', streaming_edit_draft_ready: true, tm_draft_cloud_completed: '',
    tm_draft_cloud_entry_id: -1, tm_draft_cloud_modified: 0, tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1, tm_draft_cloud_user_id: -1, tm_draft_create: draft.create_time,
    tm_draft_modified: draft.update_time, tm_draft_removed: 0, tm_duration: draft.duration,
  };
}

function uniqueDir(root, name) {
  const base = safeSegment(name) || '未命名草稿';
  let candidate = path.join(root, base);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(root, `${base} (${index})`);
    index += 1;
  }
  return candidate;
}

function backupIndex(file) {
  try {
    if (!fs.existsSync(file)) return '';
    const target = file + '.wmd-backup';
    fs.copyFileSync(file, target);
    return target;
  } catch {
    return '';
  }
}

function register(indexFile, meta) {
  const data = readJson(indexFile, null);
  if (!data || !Array.isArray(data.all_draft_store)) throw new Error('剪映草稿索引格式不认识：' + indexFile);
  data.all_draft_store = data.all_draft_store.filter((row) => row && row.draft_id !== meta.draft_id && row.draft_name !== meta.draft_name);
  data.all_draft_store.unshift(meta);
  backupIndex(indexFile);
  fs.writeFileSync(indexFile, JSON.stringify(data), 'utf8');
}

/**
 * 生成若干份草稿。
 * drafts: [{ name, clips: [{ path, name, kind }] }]
 */
function createDrafts(drafts) {
  const info = status();
  if (!info.available) throw new Error('没有找到剪映草稿目录，请先打开一次剪映');
  if (info.running) throw new Error('剪映正在运行，请先关闭剪映再导入（否则退出时会覆盖新草稿）');
  const root = info.root;
  fs.mkdirSync(root, { recursive: true });
  const created = [];
  for (const item of drafts) {
    const clips = (item.clips || []).map((clip) => {
      const probed = probeMedia(clip.path, clip.kind);
      return { ...clip, ...probed };
    });
    if (!clips.length) continue;
    const draft = buildDraft(item.name, clips);
    const dir = uniqueDir(root, item.name);
    fs.mkdirSync(dir, { recursive: true });
    const name = path.basename(dir);
    const meta = draftMeta(name, dir, draft);
    fs.writeFileSync(path.join(dir, 'draft_content.json'), JSON.stringify(draft, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, 'draft_meta_info.json'), JSON.stringify(meta, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, 'draft_virtual_store.json'), JSON.stringify({ draft_materials: [], draft_virtual_store: [] }), 'utf8');
    fs.writeFileSync(path.join(dir, 'draft_settings'),
      `[General]\ndraft_create_time=${Math.floor(draft.create_time / 1e6)}\ndraft_last_edit_time=${Math.floor(draft.update_time / 1e6)}\nreal_edit_seconds=0\nreal_edit_keys=0\n`, 'utf8');
    register(info.indexPath, meta);
    created.push({
      name,
      dir,
      clips: clips.length,
      duration: draft.duration / 1e6,
      startedAt: draft.create_time / 1000,
    });
  }
  return { root, indexPath: info.indexPath, created };
}

function probe(file, kind) {
  return probeMedia(file, kind);
}

module.exports = { status, draftRoots, indexPath, isRunning, probe, createDrafts, buildDraft };
