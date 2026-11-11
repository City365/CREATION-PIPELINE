'use strict';
/**
 * 原生文件选择框（多选）——剪辑台「导入」按钮用
 *
 * 浏览器拿不到本地绝对路径（`<input type="file">` 只给 File 对象，不给路径），
 * 而引擎的 media.import 要的是路径。所以和 folder-picker 一样，让本机弹一次
 * Windows 选择框，把路径读回来。只认白名单后缀，只认真实存在的文件。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const MEDIA_EXT = new Set([
  '.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.flv', '.wmv', '.ts', '.mpg', '.mpeg',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma', '.aif', '.aiff',
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.heic', '.tif', '.tiff',
]);

// 字幕文件：导入 SRT/VTT 用，不进 media.import
const SUBTITLE_EXT = new Set(['.srt', '.vtt']);

let pending = null;

function defaultPython() {
  const local = path.join(__dirname, '../agent_backend/.venv/Scripts/python.exe');
  if (fs.existsSync(local)) return local;
  return 'D:/notebook/AIGC/ml-engineer/backend/.venv/Scripts/python.exe';
}

/**
 * 弹一次本机选择框，把绝对路径读回来。
 * options.exts：只认这些后缀（字幕导入传 ['.srt', '.vtt']）
 * options.single：单选
 * options.title：选择框标题
 */
function pickMediaFiles(options = {}) {
  if (pending) return pending;
  const python = options.python || process.env.WMD_PYTHON || defaultPython();
  const run = options.execFile || execFile;
  const allowed = Array.isArray(options.exts) && options.exts.length
    ? new Set(options.exts.map((ext) => String(ext).toLowerCase()))
    : null;
  const args = [path.join(__dirname, '../scripts/pick-media.py')];
  if (options.single) args.push('--single');
  if (options.title) args.push('--title', String(options.title));
  if (allowed) {
    args.push('--ext');
    for (const ext of allowed) args.push(ext);
  }
  pending = new Promise((resolve, reject) => {
    run(python, args, {
      shell: false, windowsHide: true, encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 20,
    }, (err, stdout) => {
      if (err) return reject(new Error('系统文件选择框未完成，请重试'));
      let receipt;
      try { receipt = JSON.parse(String(stdout || '').trim()); }
      catch { return reject(new Error('无法读取所选文件')); }
      const files = [];
      const seen = new Set();
      for (const raw of (receipt.files || [])) {
        const abs = path.resolve(String(raw));
        const ext = path.extname(abs).toLowerCase();
        if (allowed ? !allowed.has(ext) : !MEDIA_EXT.has(ext)) continue;
        let real;
        try { real = fs.realpathSync(abs); } catch { continue; }
        let stat;
        try { stat = fs.statSync(real); } catch { continue; }
        if (!stat.isFile()) continue;
        const key = real.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        files.push(real);
      }
      resolve({ files, cancelled: Boolean(receipt.cancelled) && !files.length, skipped: (receipt.files || []).length - files.length });
    });
  }).finally(() => { pending = null; });
  return pending;
}

module.exports = { pickMediaFiles, MEDIA_EXT, SUBTITLE_EXT };
