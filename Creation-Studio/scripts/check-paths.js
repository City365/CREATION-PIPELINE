'use strict';
/**
 * 路径体检。
 *
 * 规范：项目里的文件一律记「相对项目根目录」的路径（rel），绝对路径只在运行时算。
 * 这个脚本把本地所有记录（jobs.json、studio.db、task-events.sqlite …）翻一遍，
 * 报出还写死着绝对路径的地方，以及换过项目根目录后还能不能自动找回来。
 *
 *   node scripts/check-paths.js            人看的表格
 *   node scripts/check-paths.js --json     机器读的结果
 *   node scripts/check-paths.js --strict   有失效路径时退出码 1（可接进 CI）
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../src/config');
const projects = require('../src/projects');
const workspace = require('../src/workspace');
const projectPaths = require('../src/project-paths');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const strict = args.includes('--strict');
const repair = args.includes('--repair');
const onlyIndex = args.indexOf('--project');
const onlyProject = onlyIndex >= 0 ? args[onlyIndex + 1] : '';

// 只看 Windows 盘符绝对路径；单条字符串超过 4000 字符的（base64、长正文）直接跳过，避免正则回溯
const ABS = /[A-Za-z]:[\\/][^"'<>,;|*?\r\n\t]+/g;
const MAX_SCAN = 4000;

function loadProjects() {
  const list = projects.list();
  const filtered = onlyProject ? list.filter((item) => item.id === onlyProject) : list;
  return filtered.map((item) => ({ ...item, dir: path.resolve(workspace.dirFor(item)) }));
}

function walkStrings(value, visit, depth = 0) {
  if (depth > 12 || value == null) return;
  if (typeof value === 'string') {
    if (value.includes('\\') || value.includes('/')) visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, visit, depth + 1);
    return;
  }
  if (typeof value === 'object') for (const item of Object.values(value)) walkStrings(item, visit, depth + 1);
}

function looksAbsolute(value) {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function classify(text, list) {
  const hits = [];
  const source = String(text);
  if (source.length > MAX_SCAN) return hits;
  for (const match of source.matchAll(ABS)) {
    const candidate = match[0].trim().replace(/[.。]+$/, '');
    if (!looksAbsolute(candidate)) continue;
    const abs = path.resolve(candidate);
    for (const project of list) {
      if (projectPaths.inside(project.dir, abs)) {
        hits.push({ projectId: project.id, path: candidate, kind: 'inside', rel: projectPaths.relOf(project.id, candidate), exists: fs.existsSync(abs) });
        break;
      }
      const healed = projectPaths.rebase(project.id, candidate);
      if (healed) {
        hits.push({ projectId: project.id, path: candidate, kind: 'legacy', rel: projectPaths.relOf(project.id, healed), exists: true });
        break;
      }
    }
  }
  return hits;
}

function scanJson(file, list) {
  if (!fs.existsSync(file)) return { source: path.basename(file), readable: 0, hits: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { source: path.basename(file), readable: 0, hits: [] };
  }
  const hits = [];
  let readable = 0;
  const visit = (text) => {
    readable += 1;
    hits.push(...classify(text, list));
  };
  walkStrings(data, visit);
  return { source: path.basename(file), readable, hits };
}

function scanSqlite(file, tables, list) {
  if (!fs.existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  const results = [];
  try {
    for (const table of tables) {
      let rows = [];
      try {
        rows = db.prepare(`SELECT * FROM ${table.name}`).all();
      } catch {
        continue;
      }
      const hits = [];
      let readable = 0;
      for (const row of rows) {
        for (const column of table.columns) {
          const value = row[column];
          if (typeof value !== 'string' || !value) continue;
          if (column.endsWith('_json') || column === 'payload' || column === 'data') {
            let parsed;
            try {
              parsed = JSON.parse(value);
            } catch {
              parsed = null;
            }
            if (parsed) {
              const visit = (text) => { readable += 1; hits.push(...classify(text, list)); };
              walkStrings(parsed, visit);
              continue;
            }
          }
          if (column === 'path' || column === 'normalized_path') {
            readable += 1;
            hits.push(...classify(value, list));
          }
        }
      }
      results.push({ source: `${path.basename(file)} · ${table.name}`, readable, hits });
    }
  } finally {
    db.close();
  }
  return results;
}

function summarize(hits) {
  const byKind = { inside: 0, legacy: 0 };
  const broken = [];
  for (const hit of hits) {
    if (hit.kind === 'inside') byKind.inside += 1;
    if (hit.kind === 'legacy') byKind.legacy += 1;
    if (!hit.exists) broken.push(hit);
  }
  return { total: hits.length, ...byKind, broken };
}

function main() {
  const list = loadProjects();
  if (!list.length) {
    console.log('没有项目，跳过路径体检。');
    return;
  }
  const dataDir = config.load().dataDir || config.DATA;
  const jsonFiles = ['jobs.json', 'image-history.json', 'studio.json', 'events.json', 'workbench.json']
    .map((name) => path.join(dataDir, name))
    .filter((file) => fs.existsSync(file));
  const sources = [
    ...jsonFiles.map((file) => scanJson(file, list)),
    ...scanSqlite(path.join(dataDir, 'studio.db'), [
      { name: 'generation_runs', columns: ['snapshot_json', 'execution_json'] },
      { name: 'media_records', columns: ['path'] },
      { name: 'image_tasks', columns: ['request_json', 'result_json'] },
      { name: 'workbench_items', columns: ['draft_json'] },
      { name: 'studio_state', columns: ['data'] },
    ], list),
    ...scanSqlite(path.join(dataDir, 'task-events.sqlite'), [
      { name: 'task_events', columns: ['payload'] },
      { name: 'task_attempts', columns: ['payload'] },
    ], list),
  ];

  const report = {
    projectRoot: config.load().projectRoot,
    projects: list.map((project) => ({ id: project.id, dir: path.resolve(workspace.dirFor(project)) })),
    sources: sources.map((source) => ({ ...source, summary: summarize(source.hits) })),
  };
  report.summary = report.sources.reduce((acc, source) => ({
    absolute: acc.absolute + source.summary.total,
    inside: acc.inside + source.summary.inside,
    legacy: acc.legacy + source.summary.legacy,
    broken: acc.broken + source.summary.broken.length,
  }), { absolute: 0, inside: 0, legacy: 0, broken: 0 });

  const missing = new Map();
  for (const source of report.sources) {
    for (const hit of source.summary.broken) missing.set(hit.path.toLowerCase(), hit.path);
  }
  report.summary.missingUnique = missing.size;

  if (repair) {
    const fileAliases = require('../src/file-aliases');
    const repaired = [];
    for (const oldPath of missing.values()) {
      const found = fileAliases.recover(oldPath);
      if (found) repaired.push({ from: oldPath, to: found });
    }
    report.repair = { repaired: repaired.length, items: repaired };
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('项目根目录：' + report.projectRoot);
    console.log('');
    for (const source of report.sources) {
      const s = source.summary;
      if (!s.total) continue;
      console.log(`${source.source.padEnd(34)} 绝对路径 ${String(s.total).padStart(5)}  指向项目内 ${String(s.inside).padStart(4)}  换根可自愈 ${String(s.legacy).padStart(4)}  失效 ${String(s.broken.length).padStart(3)}`);
    }
    console.log('');
    console.log(`合计：记录中绝对路径 ${report.summary.absolute} 条，其中指向项目目录内部 ${report.summary.inside} 条；` +
      `换过根目录、可按项目目录名找回 ${report.summary.legacy} 条；失效 ${report.summary.broken} 条（去重后 ${report.summary.missingUnique} 个文件）。`);
    if (report.repair) {
      console.log(`已按文件名找回并记入别名表：${report.repair.repaired} 个文件（旧链接现在能打开）。`);
      for (const item of report.repair.items.slice(0, 10)) console.log('  ' + item.from + ' → ' + item.to);
    }
    console.log('规范：项目内文件记 rel（相对项目根目录），绝对路径只在运行时算；新生成的图/视频都带 rel。');
  }
  if (strict && report.summary.broken) process.exit(1);
}

main();
