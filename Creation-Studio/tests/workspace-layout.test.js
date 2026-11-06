'use strict';
/**
 * 项目目录层级：新项目落 `<projectRoot>/<租户>/<用户>/<项目目录>/`；
 * 老版本只有 `<projectRoot>/<项目目录>/` 的，只要目录还在就继续用它，不擅自搬家。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-layout-'));
const projectRoot = path.join(dataDir, 'projects');
process.env.WMD_DATA_DIR = dataDir;
process.env.APPDATA = path.join(dataDir, 'appdata');

const config = require('../src/config');
const workspace = require('../src/workspace');
const projects = require('../src/projects');

function prepare() {
  const cfg = config.load();
  config.save({ ...cfg, projectRoot });
}

test('新项目落在 租户/用户/项目 三层目录里', () => {
  prepare();
  const project = projects.create({ tenantId: 'tnt_default', ownerUserId: 'user-abc123456', name: '层级测试' });
  const dir = workspace.dirFor(project);
  const rel = path.relative(projectRoot, dir).split(path.sep);
  assert.equal(rel.length, 3, `应是 租户/用户/项目 三层，实际 ${dir}`);
  assert.match(rel[0], /^(默认租户|tenant)-default$/, '第一层应是租户段：' + rel[0]);
  assert.match(rel[1], /^user-123456$/, '第二层应是用户段：' + rel[1]);
  assert.equal(rel[2], project.folder);
  assert.ok(fs.existsSync(dir), '目录要真的建出来');
  for (const sub of ['assets', 'media', 'uploads', 'exports']) {
    assert.ok(fs.existsSync(path.join(dir, sub)), '缺少子目录 ' + sub);
  }
});

test('老布局目录还在时继续用老路径', () => {
  prepare();
  const project = projects.create({ tenantId: 'tnt_default', ownerUserId: 'user-abc123456', name: '老项目' });
  const legacy = workspace.legacyDirFor(project);
  fs.mkdirSync(path.join(legacy, 'assets'), { recursive: true });
  assert.equal(workspace.dirFor(project), legacy, '老目录存在就不要换地方');
});

test('不同用户的项目目录互不重叠', () => {
  prepare();
  const a = projects.create({ tenantId: 'tnt_default', ownerUserId: 'user-aaa111222', name: '同项目名' });
  const b = projects.create({ tenantId: 'tnt_default', ownerUserId: 'user-bbb333444', name: '同项目名' });
  const dirA = workspace.dirFor(a);
  const dirB = workspace.dirFor(b);
  assert.notEqual(dirA, dirB);
  assert.equal(path.relative(dirA, dirB).startsWith('..'), true, '不能互为父子目录');
});

test('没有归属人的项目会被挂到租户负责人名下', () => {
  prepare();
  const conn = require('../src/db').open();
  conn.prepare("INSERT INTO users(id, username, username_key, salt, hash, is_admin, tenant_id, role, active_project_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run('user-owner00001', 'owner', 'owner', 's', 'h', 0, 'tnt_default', 'owner', '', Date.now());
  conn.prepare("INSERT INTO projects(id, tenant_id, owner_user_id, name, description, style_id, folder, source_folders, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run('proj-orphan000001', 'tnt_default', '', '无主项目', '', '', '无主项目-000001', '[]', Date.now(), Date.now());
  const claimed = projects.claimOrphans();
  assert.ok(claimed.some((row) => row.id === 'proj-orphan000001'), '应该有项目被认领');
  assert.equal(projects.get('proj-orphan000001').ownerUserId, 'user-owner00001');
  assert.deepEqual(
    projects.list('tnt_default', 'user-owner00001').map((p) => p.id).includes('proj-orphan000001'),
    true,
    '认领后应该出现在负责人的项目列表里',
  );
});

test.after(() => {
  // Windows 下 sqlite 句柄可能还开着，清不掉就算了（临时目录）
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});
