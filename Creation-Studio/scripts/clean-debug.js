'use strict';
/**
 * 把 data/ 根目录下的调试产物移进 data/debug/，不删除任何东西。
 *
 *   node scripts/clean-debug.js            # 只列出会移动什么
 *   node scripts/clean-debug.js --apply    # 真正移动，并写 manifest
 *
 * 只处理白名单里的模式：截图、根目录日志、临时脚本、p0/p1/p2/p4 证据、
 * 旧 config 备份、迁移副本、调试目录。数据库、迁移存档（*.imported.json）、
 * 业务目录（media/assets/uploads/...）和正在使用的状态文件一律不动。
 */
const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const DATA = path.resolve(process.env.WMD_DATA_DIR || path.join(__dirname, '..', 'data'));
const DEBUG = path.join(DATA, 'debug');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');

const KEEP_FILES = new Set([
  'config.json', 'secret.key', 'internal-token.json', 'service-pids.json',
  'workspace-migration.json', 'styles.json', 'voice-library.json',
  // 启动器快捷方式，不是调试产物
  'run-launch-hidden.vbs',
]);
const KEEP_DIRS = new Set([
  'debug', 'backups', 'logs', 'media', 'assets', 'uploads', 'styles', 'ref-images',
  'waveforms', 'creative', 'chrome-profile', 'frames', 'scene-view-prompts', 'executor-blobs',
]);
const DEBUG_DIRS = new Set(['agent-timeout-diagnostic', 'doubao-grab', 'integration-src', 'workbench-acceptance']);

const manifest = { dataDir: DATA, apply: APPLY, at: new Date().toISOString(), moved: [], skipped: [], warnings: [] };

function sizeOf(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const entry of fs.readdirSync(file, { withFileTypes: true })) {
      total += sizeOf(path.join(file, entry.name));
    }
    return total;
  } catch { return 0; }
}

function uniqueDest(dir, name) {
  let target = path.join(dir, name);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let index = 2;
  while (fs.existsSync(target)) target = path.join(dir, base + '-' + index++ + ext);
  return target;
}

function relocate(from, category, base = DEBUG) {
  const dir = path.join(base, category);
  const dest = uniqueDest(dir, path.basename(from));
  const bytes = sizeOf(from);
  manifest.moved.push({ from: path.relative(DATA, from), to: path.relative(DATA, dest), bytes });
  if (!APPLY) return;
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.renameSync(from, dest);
  } catch (error) {
    manifest.moved.pop();
    manifest.skipped.push({ from: path.relative(DATA, from), reason: error.message });
  }
}

function hasPlaintextSecret(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return /"(apiKey|token|executorToken)"\s*:\s*"[^"\s][^"]*"/.test(text);
  } catch { return false; }
}

function classifyFile(name) {
  if (KEEP_FILES.has(name)) return null;
  if (/\.imported\.json$/i.test(name)) return null;
  if (/^wmd\.before-.*\.sqlite$/i.test(name)) return { category: 'migration', base: path.join(DATA, 'backups') };
  if (/\.(png|jpe?g|webp)$/i.test(name)) return { category: 'screenshots' };
  if (/\.(log|err)$/i.test(name) || /\.log\.err$/i.test(name)) return { category: 'logs' };
  if (/^_.*\.js$/i.test(name) || name === 'tmp-dbg.js') return { category: 'debug-scripts' };
  if (/^p[0-9]+-.*\.json$/i.test(name) || /^scene-.*-evidence\.json$/i.test(name)) return { category: 'evidence' };
  if (name === 'script-chats.json') return { category: 'legacy-data' };
  if (/^backups-config-.*\.json$/i.test(name) || /^config\.json\.(bak-|before-)/.test(name)) {
    if (hasPlaintextSecret(path.join(DATA, name))) {
      manifest.warnings.push('config 备份里含旧明文密钥：' + name + '（已移入 debug/config-backups，确认不再回滚后请删除）');
    }
    return { category: 'config-backups' };
  }
  if (/^jobs\.json\.bak-/.test(name) || /^image-history\.json\.before-import-/.test(name)
    || /^events-trash\.json\.before-import-/.test(name) || /^studio\.db\.before-/.test(name)) {
    return { category: 'migration-copies' };
  }
  return null;
}

function run() {
  if (!fs.existsSync(DATA)) throw new Error('数据目录不存在：' + DATA);
  for (const entry of fs.readdirSync(DATA, { withFileTypes: true })) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (KEEP_DIRS.has(name)) continue;
      if (DEBUG_DIRS.has(name) || /^lifecycle-backup-/.test(name)) {
        relocate(path.join(DATA, name), 'dirs');
        continue;
      }
      manifest.skipped.push({ from: name + '/', reason: '未识别的目录，保留' });
      continue;
    }
    const rule = classifyFile(name);
    if (!rule) {
      if (!KEEP_FILES.has(name) && !/\.imported\.json$/i.test(name) && !/\.sqlite(-wal|-shm)?$/i.test(name)) {
        manifest.skipped.push({ from: name, reason: '未识别的文件，保留' });
      }
      continue;
    }
    relocate(path.join(DATA, name), rule.category, rule.base);
  }

  if (APPLY) {
    fs.mkdirSync(DEBUG, { recursive: true });
    const file = path.join(DEBUG, 'cleanup-manifest-' + stamp + '.json');
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    console.log('已移动 ' + manifest.moved.length + ' 项，清单：' + path.relative(process.cwd(), file));
  } else {
    console.log('预览（加 --apply 才会移动）：');
  }
  for (const item of manifest.moved) {
    console.log((APPLY ? '  moved  ' : '  would  ') + item.from + ' → ' + item.to + '  (' + item.bytes + ' B)');
  }
  for (const warning of manifest.warnings) console.log('  warn   ' + warning);
  for (const item of manifest.skipped) console.log('  keep   ' + item.from + '  (' + item.reason + ')');
}

try {
  run();
} catch (error) {
  console.error('清理失败：' + error.message);
  process.exitCode = 1;
}
