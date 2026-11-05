'use strict';
/**
 * 租户配额：用户数、项目数、每日任务数、存储空间、并发任务数。0 表示不限制。
 *
 * 计数直接查库：成员/项目是实时数量，任务按本地自然日统计事件数，
 * 存储按租户目录（含项目目录）求和并缓存 60 秒，并发只数正在运行的视频任务。
 * 配额检查失败抛 429，由路由层返回明确错误。
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const eventStore = require('./event-store');
const projects = require('./projects');
const workspace = require('./workspace');

const DEFAULT_TENANT = 'tnt_default';
const DEFAULTS = { maxUsers: 0, maxProjects: 0, maxTasksPerDay: 0, maxStorageBytes: 0, maxConcurrentTasks: 0 };
const FIELDS = {
  maxUsers: 'max_users',
  maxProjects: 'max_projects',
  maxTasksPerDay: 'max_tasks_per_day',
  maxStorageBytes: 'max_storage_bytes',
  maxConcurrentTasks: 'max_concurrent_tasks',
};
const LIMITS = { maxStorageBytes: 1e15 };
const storageCache = new Map();

function get(tenantId) {
  const row = db.open().prepare('SELECT * FROM tenant_quotas WHERE tenant_id = ?').get(String(tenantId || ''));
  if (!row) return { ...DEFAULTS };
  const out = {};
  for (const [key, column] of Object.entries(FIELDS)) out[key] = Number(row[column]) || 0;
  return out;
}

function set(tenantId, patch = {}) {
  const next = { ...get(tenantId) };
  for (const key of Object.keys(DEFAULTS)) {
    if (patch[key] === undefined) continue;
    const value = Number(patch[key]);
    if (!Number.isInteger(value) || value < 0 || value > (LIMITS[key] || 1000000)) throw new Error('配额必须是非负整数');
    next[key] = value;
  }
  db.open().prepare(`INSERT INTO tenant_quotas(tenant_id, max_users, max_projects, max_tasks_per_day, max_storage_bytes, max_concurrent_tasks, updated_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id) DO UPDATE SET max_users = excluded.max_users, max_projects = excluded.max_projects,
      max_tasks_per_day = excluded.max_tasks_per_day, max_storage_bytes = excluded.max_storage_bytes,
      max_concurrent_tasks = excluded.max_concurrent_tasks, updated_at = excluded.updated_at`)
    .run(String(tenantId), next.maxUsers, next.maxProjects, next.maxTasksPerDay, next.maxStorageBytes, next.maxConcurrentTasks, Date.now());
  return next;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function storageRoots(tenantId) {
  const cfg = config.load();
  const roots = [];
  if (tenantId === DEFAULT_TENANT) roots.push(cfg.saveFolder, cfg.assetFolder, cfg.uploadFolder);
  roots.push(path.join(cfg.dataDir || config.DATA, 'tenants', tenantId));
  try {
    for (const project of projects.list(tenantId)) {
      try { roots.push(workspace.pathsFor(project).dir); } catch { /* 单个项目目录异常不影响其它路径 */ }
    }
  } catch { /* 项目读取失败时只统计已知目录 */ }
  const resolved = [...new Set(roots.filter(Boolean).map((item) => path.resolve(item)))].sort((a, b) => a.length - b.length);
  const top = [];
  for (const root of resolved) {
    if (!top.some((parent) => root === parent || root.startsWith(parent + path.sep))) top.push(root);
  }
  return top;
}

/** 租户目录占用；缓存 60 秒，避免设置页每次刷新都遍历。 */
function storageUsage(tenantId, { fresh = false } = {}) {
  const id = String(tenantId || '');
  const hit = storageCache.get(id);
  if (!fresh && hit && Date.now() - hit.at < 60 * 1000) return hit;
  let bytes = 0;
  let files = 0;
  let truncated = false;
  const stack = storageRoots(id);
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (!entry.isFile()) continue;
      try { bytes += fs.statSync(full).size; files += 1; } catch { /* 文件刚被删 */ }
      if (files >= 200000) { truncated = true; break; }
    }
    if (truncated) break;
  }
  const out = { bytes, files, truncated, at: Date.now() };
  storageCache.set(id, out);
  return out;
}

function usage(tenantId) {
  const id = String(tenantId || '');
  const conn = db.open();
  const storage = storageUsage(id);
  return {
    users: conn.prepare('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?').get(id).n,
    projects: conn.prepare('SELECT COUNT(*) AS n FROM projects WHERE tenant_id = ?').get(id).n,
    tasksToday: eventStore.countSince(id, startOfToday()),
    runningTasks: conn.prepare("SELECT COUNT(*) AS n FROM jobs WHERE tenant_id = ? AND status = 'running'").get(id).n,
    storageBytes: storage.bytes,
    storageFiles: storage.files,
    storageTruncated: storage.truncated,
  };
}

function quotaError(label) {
  const error = new Error('租户配额已满：' + label);
  error.status = 429;
  return error;
}

function assertUsers(tenantId) {
  const quota = get(tenantId);
  if (!quota.maxUsers) return;
  const count = db.open().prepare('SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?').get(String(tenantId || '')).n;
  if (count >= quota.maxUsers) throw quotaError('用户数已达上限 ' + quota.maxUsers);
}

function assertProjects(tenantId) {
  const quota = get(tenantId);
  if (!quota.maxProjects) return;
  const count = db.open().prepare('SELECT COUNT(*) AS n FROM projects WHERE tenant_id = ?').get(String(tenantId || '')).n;
  if (count >= quota.maxProjects) throw quotaError('项目数已达上限 ' + quota.maxProjects);
}

function assertTasks(tenantId) {
  const quota = get(tenantId);
  if (!quota.maxTasksPerDay) return;
  const count = eventStore.countSince(String(tenantId || ''), startOfToday());
  if (count >= quota.maxTasksPerDay) throw quotaError('今日任务数已达上限 ' + quota.maxTasksPerDay);
}

/** 存储超限后不再接新任务；已有文件不删除。 */
function assertStorage(tenantId, addBytes = 0) {
  const quota = get(tenantId);
  if (!quota.maxStorageBytes) return;
  const used = storageUsage(tenantId).bytes;
  if (used + Math.max(0, Number(addBytes) || 0) > quota.maxStorageBytes) throw quotaError('存储空间已达上限');
}

/** 并发只数正在运行的任务；排队不占并发。 */
function assertConcurrent(tenantId, add = 1) {
  const quota = get(tenantId);
  if (!quota.maxConcurrentTasks) return;
  const running = db.open().prepare("SELECT COUNT(*) AS n FROM jobs WHERE tenant_id = ? AND status = 'running'").get(String(tenantId || '')).n;
  if (running + Math.max(0, Number(add) || 0) > quota.maxConcurrentTasks) throw quotaError('并发任务已达上限 ' + quota.maxConcurrentTasks);
}

function clearStorageCache(tenantId) {
  if (tenantId === undefined) storageCache.clear();
  else storageCache.delete(String(tenantId));
}

module.exports = {
  DEFAULTS, FIELDS, get, set, usage, storageUsage, clearStorageCache,
  assertUsers, assertProjects, assertTasks, assertStorage, assertConcurrent,
};
