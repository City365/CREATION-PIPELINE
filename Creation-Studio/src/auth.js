'use strict';
/**
 * 本机账号：密码 scrypt 加盐，存在 SQLite（src/db.js）里，不再用可被随手改写的 JSON。
 *
 * 多租户：每个用户归属一个租户（tenantId），在租户里的角色是 owner / admin / member。
 * - 第一个注册的人是平台管理员（isAdmin），落在默认租户里；
 * - 之后由管理员创建用户，或者（配置 signup.open 时）自助注册，每人自动开一个新租户；
 * - 会话只记用户，租户和角色每次从用户记录里读，改角色立即生效。
 */
const crypto = require('node:crypto');
const path = require('node:path');
const config = require('./config');
const db = require('./db');
const tenants = require('./tenants');

const SESSION_TTL = 30 * 24 * 3600 * 1000;

function usersFile() {
  return db.file();
}

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    salt: row.salt,
    hash: row.hash,
    isAdmin: Boolean(row.is_admin),
    tenantId: row.tenant_id,
    role: row.role,
    activeProjectId: row.active_project_id || '',
    createdAt: row.created_at,
  };
}

function users() {
  return db.open().prepare('SELECT * FROM users ORDER BY created_at').all().map(toUser);
}

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    isAdmin: !!user.isAdmin,
    tenantId: user.tenantId || tenants.DEFAULT_TENANT,
    role: user.role || (user.isAdmin ? 'owner' : 'member'),
  };
}

function enabled() {
  return Boolean(db.open().prepare('SELECT 1 AS n FROM users LIMIT 1').get());
}

function signupOpen() {
  try {
    return Boolean(config.load().signup && config.load().signup.open);
  } catch {
    return false;
  }
}

function checkCredentials(username, password) {
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9_一-龥.-]{2,32}$/.test(name)) throw new Error('用户名 2–32 位，支持中英文、数字、下划线');
  if (String(password || '').length < 6) throw new Error('密码至少 6 位');
  return name;
}

/**
 * 注册/创建用户。
 * - 没有用户时：建默认租户，第一个用户是平台管理员 + 租户 owner。
 * - 管理员创建（asAdmin）：加入指定租户，角色按参数（默认 member）。
 * - 自助注册（需要 signup.open）：给新用户开一个新租户，自己是 owner。
 */
function register(username, password, options = {}) {
  const name = checkCredentials(username, password);
  const conn = db.open();
  if (conn.prepare('SELECT 1 AS n FROM users WHERE username_key = ? LIMIT 1').get(name.toLowerCase())) throw new Error('用户名已存在');
  const total = conn.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const first = total === 0;
  const asAdmin = Boolean(options.asAdmin);

  let tenant;
  let role;
  if (first) {
    tenants.ensure();
    tenant = tenants.get(tenants.DEFAULT_TENANT) || tenants.ensure()[0];
    role = 'owner';
  } else if (asAdmin) {
    tenant = options.tenantId ? tenants.get(options.tenantId) : (tenants.get(tenants.DEFAULT_TENANT) || tenants.ensure()[0]);
    if (!tenant) throw new Error('租户不存在');
    role = ['owner', 'admin', 'member'].includes(options.role) ? options.role : 'member';
  } else if (signupOpen()) {
    tenant = tenants.create(String(options.tenantName || '').trim() || name + ' 的空间');
    role = 'owner';
  } else {
    throw new Error('已有账号，请联系管理员创建用户');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: 'user-' + crypto.randomBytes(6).toString('hex'),
    username: name,
    salt,
    hash: hash(password, salt),
    isAdmin: first,
    tenantId: tenant.id,
    role,
    createdAt: Date.now(),
  };
  conn.prepare(`INSERT INTO users(id, username, username_key, salt, hash, is_admin, tenant_id, role, active_project_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    user.id, user.username, user.username.toLowerCase(), user.salt, user.hash,
    user.isAdmin ? 1 : 0, user.tenantId, user.role, '', user.createdAt,
  );
  return publicUser(toUser(conn.prepare('SELECT * FROM users WHERE id = ?').get(user.id)));
}

function login(username, password) {
  const name = String(username || '').trim();
  const row = db.open().prepare('SELECT * FROM users WHERE username_key = ?').get(name.toLowerCase());
  const user = toUser(row);
  if (!user) throw new Error('用户名或密码不对');
  const digest = hash(password, user.salt);
  const expected = Buffer.from(user.hash, 'hex');
  const actual = Buffer.from(digest, 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error('用户名或密码不对');
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const conn = db.open();
  conn.prepare('INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, user.id, now, now + SESSION_TTL);
  // 顺手清理过期会话，避免库越积越多
  conn.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  return { token, user: publicUser(user) };
}

function userByToken(token) {
  if (!token) return null;
  const conn = db.open();
  const session = conn.prepare('SELECT * FROM sessions WHERE token = ?').get(String(token));
  if (!session || session.expires_at < Date.now()) return null;
  return toUser(conn.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id));
}

function logout(token) {
  if (!token) return;
  db.open().prepare('DELETE FROM sessions WHERE token = ?').run(String(token));
}

function setActiveProject(userId, projectId) {
  db.open().prepare('UPDATE users SET active_project_id = ? WHERE id = ?').run(String(projectId || ''), String(userId || ''));
}

/* ----------------------------- 成员管理（租户内） ----------------------------- */

function members(tenantId) {
  return db.open().prepare('SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at').all(String(tenantId || '')).map((row) => publicUser(toUser(row)));
}

function findById(id) {
  return toUser(db.open().prepare('SELECT * FROM users WHERE id = ?').get(String(id || '')));
}

/** 改角色 / 重置密码。调用方负责权限判断（只能管自己租户的人）。 */
function updateUser(id, patch = {}) {
  const conn = db.open();
  const user = toUser(conn.prepare('SELECT * FROM users WHERE id = ?').get(String(id || '')));
  if (!user) throw new Error('用户不存在');
  if (patch.role !== undefined) {
    if (!['owner', 'admin', 'member'].includes(patch.role)) throw new Error('角色无效');
    conn.prepare('UPDATE users SET role = ? WHERE id = ?').run(patch.role, user.id);
  }
  if (patch.password) {
    if (String(patch.password).length < 6) throw new Error('密码至少 6 位');
    const salt = crypto.randomBytes(16).toString('hex');
    conn.prepare('UPDATE users SET salt = ?, hash = ? WHERE id = ?').run(salt, hash(patch.password, salt), user.id);
    // 改密码后让旧会话全部失效
    conn.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  }
  return publicUser(toUser(conn.prepare('SELECT * FROM users WHERE id = ?').get(user.id)));
}

function removeUser(id) {
  const conn = db.open();
  const user = toUser(conn.prepare('SELECT * FROM users WHERE id = ?').get(String(id || '')));
  if (!user) throw new Error('用户不存在');
  if (user.isAdmin) throw new Error('平台管理员不能删除');
  // 项目回指 owner_user_id；删用户不处理项目会留下没人能管的孤儿项目。
  const owned = conn.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_user_id = ?').get(user.id).n;
  if (owned) throw new Error('这个用户名下还有 ' + owned + ' 个项目，先删除或转移项目');
  conn.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  // 执行端令牌属于这个用户，删用户后不能再留着远程下发能力。
  conn.prepare('DELETE FROM executor_channels WHERE user_id = ?').run(user.id);
  conn.prepare('DELETE FROM user_prefs WHERE user_id = ?').run(user.id);
  conn.prepare('DELETE FROM access_codes WHERE user_id = ?').run(user.id);
  conn.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  return true;
}

/** 自助改密：先校验原密码，成功后旧会话全部失效。 */
function changePassword(userId, oldPassword, newPassword) {
  const user = findById(userId);
  if (!user) throw new Error('用户不存在');
  const expected = Buffer.from(user.hash, 'hex');
  const actual = Buffer.from(hash(oldPassword, user.salt), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error('原密码不对');
  if (String(newPassword || '').length < 6) throw new Error('密码至少 6 位');
  updateUser(user.id, { password: newPassword });
  return true;
}

function tokenFromRequest(req) {
  const cookie = String(req.headers.cookie || '');
  const hit = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('wmd_session='));
  if (hit) return decodeURIComponent(hit.slice('wmd_session='.length));
  const auth = String(req.headers.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1] : '';
}

module.exports = {
  enabled, register, login, logout, userByToken, publicUser, tokenFromRequest,
  users, setActiveProject, usersFile, members, findById, updateUser, removeUser, changePassword, signupOpen,
};
