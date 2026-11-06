#!/usr/bin/env node
'use strict';
/**
 * 把老布局 `<projectRoot>/<项目目录>/` 搬到 `<projectRoot>/<租户>/<用户>/<项目目录>/`。
 *
 *   node scripts/migrate-project-dirs.js          只看不动（默认）
 *   node scripts/migrate-project-dirs.js --apply  真的搬（同名目标存在就跳过）
 *
 * 只做同盘 rename；跨盘时回退到复制 + 删除。搬之前请确认没有正在跑的任务。
 */
const path = require('node:path');
const fs = require('node:fs');
const db = require('../src/db');
const projects = require('../src/projects');
const workspace = require('../src/workspace');

const apply = process.argv.includes('--apply');

/**
 * 目录挪了以后，数据库里存着的绝对路径也要跟着挪，否则素材缩略图、任务产物、
 * 历史对话里的图片会全部 404。只替换「路径前缀」，不动别的文本。
 */
function rewritePaths(from, to) {
  const conn = db.open();
  const like = from + '%';
  const likeAny = '%' + from + '%';
  const counts = {};
  const run = (label, sql, args) => {
    try {
      const info = conn.prepare(sql).run(...args);
      counts[label] = (counts[label] || 0) + (info.changes || 0);
    } catch (error) {
      counts[label] = 'ERR ' + error.message;
    }
  };
  run('jobs', 'UPDATE jobs SET data = REPLACE(data, ?, ?) WHERE data LIKE ?', [from, to, likeAny]);
  run('file_aliases.from', 'UPDATE file_aliases SET from_path = REPLACE(from_path, ?, ?) WHERE from_path LIKE ?', [from, to, like]);
  run('file_aliases.to', 'UPDATE file_aliases SET to_path = REPLACE(to_path, ?, ?) WHERE to_path LIKE ?', [from, to, like]);
  run('image_history', 'UPDATE image_history SET payload = REPLACE(payload, ?, ?) WHERE payload LIKE ?', [from, to, likeAny]);
  run('media_episodes', 'UPDATE media_episodes SET payload = REPLACE(payload, ?, ?) WHERE payload LIKE ?', [from, to, likeAny]);
  run('asset_meta', 'UPDATE asset_meta SET subjects = REPLACE(subjects, ?, ?) WHERE subjects LIKE ?', [from, to, likeAny]);
  return counts;
}

function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
    return 'rename';
  } catch (error) {
    if (error.code !== 'EXDEV' && error.code !== 'EPERM') throw error;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
    return 'copy';
  }
}

function main() {
  const all = projects.list();
  if (!all.length) {
    console.log('没有项目');
    return;
  }
  let moved = 0;
  let skipped = 0;
  for (const project of all) {
    const legacy = workspace.legacyDirFor(project);
    const target = path.join(workspace.scopeDirFor(project), workspace.folderName(project));
    const hasLegacy = fs.existsSync(legacy);
    const hasTarget = fs.existsSync(target);
    const same = path.resolve(legacy) === path.resolve(target);
    const line = `${project.tenantId}/${project.ownerUserId || '(无归属)'} · ${project.name}`;
    if (same) {
      // 老路径就是新路径（父级恰好相同）或目录还不存在，什么都不用做
      if (hasLegacy) { console.log(`= 保持  ${line}`); skipped += 1; }
      else console.log(`- 新建记录，等待首次使用建目录  ${line}`);
      continue;
    }
    if (!hasLegacy) {
      console.log(`- 老目录不存在，跳过  ${line}`);
      skipped += 1;
      continue;
    }
    if (hasTarget) {
      console.log(`! 目标已存在，跳过（请人工确认）  ${line}\n    ${target}`);
      skipped += 1;
      continue;
    }
    if (!apply) {
      console.log(`→ 将移动  ${line}\n    ${legacy}\n    ${target}`);
      moved += 1;
      continue;
    }
    const how = move(legacy, target);
    const rewritten = rewritePaths(legacy, target);
    console.log(`✓ 已移动（${how}）  ${line}\n    ${target}`);
    for (const [label, count] of Object.entries(rewritten)) {
      if (count) console.log(`    改写路径 ${label}：${count}`);
    }
    moved += 1;
  }
  console.log(`\n${apply ? '完成' : '预览'}：${moved} 个${apply ? '已移动' : '待移动'}，${skipped} 个跳过${apply ? '' : '（加 --apply 执行）'}`);
}

main();
