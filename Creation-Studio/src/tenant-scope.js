'use strict';
/**
 * 项目 → 租户。后台任务（任务泵、事件调度、图像任务、重启对账）没有 HTTP 请求上下文，
 * 必须按任务所属项目补上租户，否则会读到默认租户的渠道。
 */
const db = require('./db');

const DEFAULT_TENANT = 'tnt_default';

function tenantOfProject(projectId) {
  const id = String(projectId || '');
  if (!id || id === 'unassigned' || id === 'default') return DEFAULT_TENANT;
  const row = db.open().prepare('SELECT tenant_id FROM projects WHERE id = ?').get(id);
  return (row && row.tenant_id) || DEFAULT_TENANT;
}

module.exports = { tenantOfProject, DEFAULT_TENANT };
