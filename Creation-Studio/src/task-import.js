'use strict';
/**
 * 任务文件导入：只接受「固定格式」的 JSON 与 XLSX。
 *
 * JSON：
 *   { "version": 1, "items": [{ "title", "prompt", "duration", "ratio",
 *                               "images": [{ "path", "note" }] }] }
 * XLSX（第一张表，表头按列名识别）：
 *   分镜名称 | 视频提示词 | 参考图（按顺序） | 参考图说明（按顺序） | 视频画幅 | 视频时长
 *
 * 参考图路径写在文件里（绝对路径，或相对素材库/上传目录）；多个用分号分隔，
 * 说明与路径一一对应。解析只做结构校验和文件存在性检查，渠道限制在创建时再校验。
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const batch = require('./batch');

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const MAX_IMAGES = 9;

const HEADERS = ['分镜名称', '视频提示词', '参考图（按顺序）', '参考图说明（按顺序）', '视频画幅', '视频时长', '视频模型'];
const HEADER_ALIAS = {
  title: ['分镜名称', '任务标题', '标题', '分镜', '分镜名'],
  prompt: ['视频提示词', '提示词', '描述', '内容', '任务详情'],
  prefixPrompt: ['视频前置提示词', '前置提示词', '前缀提示词'],
  images: ['参考图（按顺序）', '参考图路径', '参考图', '图片'],
  notes: ['参考图说明（按顺序）', '参考图说明', '图片说明', '素材说明'],
  duration: ['视频时长', '时长（秒）', '时长(秒)', '时长'],
  ratio: ['视频画幅', '画幅', '比例', '画面比例'],
  model: ['视频模型', '模型', '模型名称'],
};

function normHeader(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
}

const HEADER_LOOKUP = new Map();
for (const [field, aliases] of Object.entries(HEADER_ALIAS)) {
  for (const alias of aliases) HEADER_LOOKUP.set(normHeader(alias), field);
}

/* ------------------------------- 模板 ------------------------------- */

const JSON_TEMPLATE = {
  version: 1,
    说明: [
    '本文件只支持固定结构：顶层 items 数组，一条任务一个元素；单条任务也只放一行。',
    '字段：分镜名称 title、视频提示词 prompt、参考图 images（按数组顺序对应图一到图九）、视频画幅 ratio、视频时长 duration、视频模型 model。',
    '参考图写在 images 里：path 为绝对路径（或相对素材库的路径），note 说明这张图是什么。',
    'ratio / duration / model 可留空，留空时使用创建页所选渠道的默认值。',
    'model 只对管理器豆包有用：Seedance 2.0 Mini 或 Seedance 2.0 Fast；Gemini 留空。',
  ],
  items: [
    {
      title: '镜头 01',
      prompt: '雨夜的旧城街道，霓虹灯倒映在积水里，镜头从远处缓慢推近一名撑透明伞的少女，她回头看向镜头，电影感，浅景深。',
      images: [
        { path: 'D:/素材/ref-01.png', note: '女主正面' },
        { path: 'D:/素材/ref-02.png', note: '女主背影' },
      ],
      duration: 10,
      ratio: '16:9',
      model: 'Seedance 2.0 Fast',
    },
    {
      title: '镜头 02',
      prompt: '清晨的咖啡馆，窗边一束光落在桌面的手账上，镜头缓慢横移。',
      images: [],
      duration: 10,
      ratio: '9:16',
      model: '',
    },
  ],
};

function jsonTemplate() {
  return Buffer.from(JSON.stringify(JSON_TEMPLATE, null, 2) + '\n', 'utf8');
}

const XLSX_ROWS = [
  HEADERS,
  ['镜头 01', '雨夜的旧城街道，霓虹灯倒映在积水里，镜头缓慢推近一名撑透明伞的少女。', 'D:/素材/ref-01.png;D:/素材/ref-02.png', '女主正面;女主背影', '16:9', '10', 'Seedance 2.0 Fast'],
  ['镜头 02', '清晨的咖啡馆，窗边一束光落在桌面的手账上，镜头缓慢横移。', '', '', '9:16', '10', ''],
];
const XLSX_HELP = [
  ['列名', '是否必填', '说明'],
  ['分镜名称', '否', '这一镜的名字，会作为任务列表名称和素材库分镜目录名'],
  ['视频提示词', '是', '一段话描述画面、主体动作、镜头与光线'],
  ['参考图（按顺序）', '否', '绝对路径，或相对素材库的文件名；多个用英文分号 ; 分隔，顺序就是图一到图九'],
  ['参考图说明（按顺序）', '否', '与参考图一一对应，说明这张图是什么（角色 / 首帧 / 场景）'],
  ['视频画幅', '否', '16:9 / 9:16 / 1:1 / 4:3 / 3:4；留空使用渠道默认值'],
  ['视频时长', '否', '1–15 的整数秒；留空使用渠道默认值'],
  ['视频模型', '否', '只对管理器豆包生效：Seedance 2.0 Mini / Seedance 2.0 Fast；Gemini 留空'],
  [],
  ['注意', '', '表头按列名识别，顺序可以调整；多出来的列会原样保留并在页面上提示'],
  ['', '', '参考图路径不存在时，解析会在页面上标出具体行号，不会静默忽略'],
];

function xlsxTemplate() {
  return buildXlsx([
    { name: '任务', rows: XLSX_ROWS },
    { name: '填写说明', rows: XLSX_HELP },
  ]);
}

/* ------------------------------- XLSX 写 ------------------------------- */

let crcTable = null;
function crc32(buffer) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer) >>> 0;
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0 ^ -1;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function zipFiles(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8');
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    central.push({ name, method, crc, compressed: body.length, uncompressed: raw.length, offset });
    offset += local.length + name.length + body.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const entry of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(dosDate, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressed, 20);
    header.writeUInt32LE(entry.uncompressed, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    parts.push(header, entry.name);
    cdSize += header.length + entry.name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdStart, 16);
  end.writeUInt16LE(0, 20);
  parts.push(end);
  return Buffer.concat(parts);
}

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetXml(rows) {
  const body = rows.map((row, r) => {
    const cells = (row || []).map((value, c) => {
      if (value == null || value === '') return '';
      return `<c r="${columnName(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + '</sheetData></worksheet>';
}

function buildXlsx(sheets) {
  const sheetEntries = sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet.rows) }));
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('') +
    '</sheets></workbook>';
  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((sheet, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('') +
    '</Relationships>';
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((sheet, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '</Types>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  return zipFiles([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    ...sheetEntries,
  ]);
}

/* ------------------------------- XLSX 读 ------------------------------- */

function unzip(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 65535; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('不是有效的 .xlsx 文件（缺少 ZIP 结构）');
  const count = buffer.readUInt16LE(end + 10);
  const cdOffset = buffer.readUInt32LE(end + 16);
  const files = new Map();
  let pointer = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error('.xlsx 目录损坏');
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('.xlsx 条目损坏');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(start, start + compressedSize);
    files.set(name, method === 0 ? data : zlib.inflateRawSync(data));
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function decodeXml(value) {
  return String(value).replace(/&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (match, entity) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    const hex = entity[1] === 'x' || entity[1] === 'X';
    const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

function textNodes(xml) {
  return [...String(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join('');
}

function colIndex(ref) {
  const letters = String(ref || '').replace(/[^A-Z]/gi, '').toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

function readSheet(xml, shared) {
  const rows = [];
  for (const rowMatch of String(xml).matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const number = Number((/\br="(\d+)"/.exec(rowMatch[1]) || [])[1]) || rows.length + 1;
    const line = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] || '';
      const inner = cellMatch[2] || '';
      const ref = (/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1] || '';
      const type = (/\bt="([^"]+)"/.exec(attrs) || [])[1] || '';
      let value = '';
      if (type === 'inlineStr') value = textNodes(inner);
      else {
        const found = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (found) value = type === 's' ? (shared[Number(found[1])] || '') : decodeXml(found[1]);
      }
      line[colIndex(ref)] = value;
    }
    rows.push({ number, cells: line });
  }
  return rows;
}

function firstSheetPath(files) {
  const workbook = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const sheet = /<sheet\b[^>]*r:id="([^"]+)"/.exec(workbook.toString('utf8'));
    if (sheet) {
      const relXml = rels.toString('utf8');
      const rel = new RegExp(`<Relationship\\b[^>]*Id="${sheet[1]}"[^>]*?Target="([^"]+)"`).exec(relXml)
        || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*?Id="${sheet[1]}"`).exec(relXml);
      if (rel) {
        const target = rel[1].replace(/^\/+/, '');
        const resolved = path.posix.normalize(target.startsWith('xl/') ? target : 'xl/' + target);
        if (files.has(resolved)) return resolved;
      }
    }
  }
  const candidates = [...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  if (!candidates.length) throw new Error('.xlsx 里没有工作表');
  return candidates[0];
}

/* ------------------------------- 解析 ------------------------------- */

function isBlankRow(row) {
  return !(row || []).some((value) => String(value == null ? '' : value).trim() !== '');
}

function normalizePath(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return '';
  return batch.resolveFile(value, '');
}

function splitList(value) {
  return String(value == null ? '' : value).split(/[;；\n]/).map((part) => part.trim()).filter(Boolean);
}

function normalizeImages(paths, notes, line, errors) {
  const images = [];
  const list = Array.isArray(paths) ? paths : [];
  const noteList = Array.isArray(notes) ? notes : [];
  list.forEach((raw, index) => {
    const original = String(raw || '').trim();
    if (!original) return;
    const resolved = normalizePath(original);
    let exists = false;
    try { exists = !!resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile(); } catch { exists = false; }
    if (!exists) errors.push(`第 ${line} 行 参考图不存在：${original}`);
    images.push({ path: resolved, name: path.basename(resolved || original), note: String(noteList[index] || '').trim(), exists });
  });
  if (images.length > MAX_IMAGES) errors.push(`第 ${line} 行 参考图超过 ${MAX_IMAGES} 张`);
  return images;
}

function normalizeItem(raw, line, errors, warnings) {
  const title = String(raw.title == null ? '' : raw.title).trim().slice(0, 120);
  const prompt = String(raw.prompt == null ? '' : raw.prompt).trim();
  if (!prompt) errors.push(`第 ${line} 行 提示词为空`);
  if (prompt.length > 10000) errors.push(`第 ${line} 行 提示词超过 10000 个字符`);
  let duration = null;
  if (raw.duration != null && String(raw.duration).trim() !== '') {
    duration = Number(raw.duration);
    if (!Number.isInteger(duration) || duration < 1 || duration > 15) { errors.push(`第 ${line} 行 时长必须是 1–15 的整数秒`); duration = null; }
  }
  let ratio = null;
  if (raw.ratio != null && String(raw.ratio).trim() !== '') {
    // 中文输入法的全角冒号照样认
    ratio = String(raw.ratio).trim().replace(/[：]/g, ':').replace(/\s+/g, '');
    if (!RATIOS.includes(ratio)) errors.push(`第 ${line} 行 画幅只能是 ${RATIOS.join(' / ')}`);
  }
  const prefixPrompt = raw.prefixPrompt == null ? '' : String(raw.prefixPrompt).trim().slice(0, 4000);
  const model = raw.model == null ? '' : String(raw.model).trim().slice(0, 80);
  const images = normalizeImages(raw.images || [], raw.notes || [], line, errors);
  const extra = raw.extra && typeof raw.extra === 'object' ? raw.extra : {};
  for (const key of Object.keys(extra)) {
    if (['resolution', 'count', 'audios', 'audio', '参考音频', '参考音频路径', '参考音频说明', '分辨率', '生成张数', '张数'].includes(key)) delete extra[key];
  }
  void warnings;
  return { line, title, prompt, prefixPrompt, images, duration, ratio, model, extra };
}

const JSON_FIELD_ALIAS = {
  title: ['title', 'name', 'shot', '分镜', '标题'],
  prompt: ['prompt', 'content', 'description', '提示词', '描述'],
  prefixPrompt: ['prefixPrompt', 'prefix', '视频前置提示词', '前置提示词'],
  duration: ['duration', 'seconds', '时长'],
  ratio: ['ratio', 'aspectRatio', 'aspect', '画幅', '比例'],
  model: ['model', '模型', '视频模型'],
  images: ['images', 'refs', '参考图'],
};
const JSON_KNOWN_KEYS = new Set(Object.values(JSON_FIELD_ALIAS).flat());
const REMOVED_FIELDS = new Set(['resolution', 'count', 'audios', 'audio', '参考音频', '参考音频路径', '参考音频说明', '分辨率', '生成张数', '张数']);

function pickJsonField(entry, field) {
  for (const key of JSON_FIELD_ALIAS[field]) {
    if (entry[key] !== undefined && entry[key] !== null && String(entry[key]).trim() !== '') return entry[key];
  }
  return undefined;
}

function parseJson(buffer) {
  let data;
  try { data = JSON.parse(buffer.toString('utf8')); } catch (err) { throw new Error('JSON 解析失败：' + err.message); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON 顶层必须是对象，并包含 items 数组');
  const list = Array.isArray(data.items) ? data.items : (Array.isArray(data.tasks) ? data.tasks : null);
  if (!list) throw new Error('JSON 里缺少 items 数组；不支持一行一条的写法，请按模板填写');
  if (!list.length) throw new Error('items 数组是空的');
  const errors = [];
  const warnings = [];
  if (!Array.isArray(data.items) && Array.isArray(data.tasks)) warnings.push('文件使用 tasks 数组，已按 items 解析');
  const items = list.map((entry, index) => {
    const line = index + 1;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`第 ${line} 条 item 必须是对象`);
      return { line, title: '', prompt: '', images: [], duration: null, ratio: null, model: '', extra: {} };
    }
    const rawImages = pickJsonField(entry, 'images');
    const imageList = Array.isArray(rawImages) ? rawImages : [];
    const paths = imageList.map((image) => (typeof image === 'string' ? image : image && image.path));
    const notes = imageList.map((image) => (typeof image === 'string' ? '' : (image && (image.note || image.subject)) || ''));
    const extra = {};
    if (entry.extra && typeof entry.extra === 'object' && !Array.isArray(entry.extra)) Object.assign(extra, entry.extra);
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'extra' || JSON_KNOWN_KEYS.has(key) || REMOVED_FIELDS.has(key)) continue;
      if (value === undefined || value === null || String(value).trim() === '') continue;
      extra[key] = value;
    }
    if (Object.keys(extra).length) warnings.push(`第 ${line} 条有未识别字段：${Object.keys(extra).join('、')}（已原样保留）`);
    return normalizeItem({
      title: pickJsonField(entry, 'title'),
      prompt: pickJsonField(entry, 'prompt'),
      prefixPrompt: pickJsonField(entry, 'prefixPrompt'),
      duration: pickJsonField(entry, 'duration'),
      ratio: pickJsonField(entry, 'ratio'),
      model: pickJsonField(entry, 'model'),
      images: paths, notes,
      extra,
    }, line, errors, warnings);
  });
  return { format: 'json', items, errors, warnings };
}

function parseXlsx(buffer) {
  const files = unzip(buffer);
  const shared = files.get('xl/sharedStrings.xml')
    ? [...files.get('xl/sharedStrings.xml').toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textNodes(match[1]))
    : [];
  const sheet = files.get(firstSheetPath(files));
  if (!sheet) throw new Error('.xlsx 里没有工作表');
  const rows = readSheet(sheet.toString('utf8'), shared).filter((row) => !isBlankRow(row.cells));
  if (!rows.length) throw new Error('表格是空的，第一行必须是表头');
  const headerCells = rows[0].cells.map((cell) => String(cell == null ? '' : cell).trim());
  const errors = [];
  const warnings = [];
  const mapping = {};
  const extraHeaders = [];
  headerCells.forEach((cell, index) => {
    if (!cell) return;
    if (REMOVED_FIELDS.has(cell)) { warnings.push(`已忽略字段：${cell}`); return; }
    const field = HEADER_LOOKUP.get(normHeader(cell));
    if (field) {
      if (mapping[field] == null) mapping[field] = index;
    } else {
      extraHeaders.push({ name: cell, index });
    }
  });
  if (mapping.prompt == null) {
    throw new Error(`表头缺少「提示词」列；可用列名：${HEADERS.join(' | ')}`);
  }
  if (extraHeaders.length) warnings.push(`未识别的列会按原值保留：${extraHeaders.map((row) => row.name).join('、')}`);
  const items = rows.slice(1).map((row) => {
    const line = row.number;
    const cells = row.cells;
    const cell = (field) => (mapping[field] != null ? String(cells[mapping[field]] == null ? '' : cells[mapping[field]]) : '');
    const extra = {};
    for (const header of extraHeaders) {
      const value = String(cells[header.index] == null ? '' : cells[header.index]).trim();
      if (value) extra[header.name] = value;
    }
    return normalizeItem({
      title: cell('title'),
      prompt: cell('prompt'),
      prefixPrompt: cell('prefixPrompt'),
      images: splitList(cell('images')),
      notes: splitList(cell('notes')),
      duration: cell('duration'),
      ratio: cell('ratio'),
      model: cell('model'),
      extra,
    }, line, errors, warnings);
  });
  if (!items.length) throw new Error('表里只有表头，没有任务行');
  return { format: 'xlsx', items, errors, warnings };
}

function parseFile({ name = '', data } = {}) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data || ''), 'base64');
  if (!buffer.length) throw new Error('文件是空的');
  const lower = String(name || '').toLowerCase();
  let parsed;
  if (lower.endsWith('.json')) parsed = parseJson(buffer);
  else if (lower.endsWith('.xlsx')) parsed = parseXlsx(buffer);
  else throw new Error('只支持 .json 或 .xlsx；.xls、.csv、一行一条的文本都不接受');
  const images = parsed.items.reduce((sum, item) => sum + item.images.length, 0);
  return {
    name: String(name || '').slice(0, 200),
    format: parsed.format,
    items: parsed.items,
    errors: parsed.errors,
    warnings: parsed.warnings,
    stats: { items: parsed.items.length, images, ok: parsed.errors.length === 0 },
  };
}

module.exports = {
  HEADERS, RATIOS, MAX_IMAGES, jsonTemplate, xlsxTemplate, parseFile, parseJson, parseXlsx,
  buildXlsx, unzip, readSheet,
};
