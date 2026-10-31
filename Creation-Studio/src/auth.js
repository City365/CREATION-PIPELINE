'use strict';
/** 本机账号：首个注册用户即管理员；密码 scrypt 加盐；会话 token 持久化到 data/sessions.json。 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

function dataDir() {
  return config.load().dataDir || path.join(__dirname, '..', 'data');
}

function usersFile() {
  return path.join(dataDir(), 'users.json');
}

function sessionsFile() {
  return path.join(dataDir(), 'sessions.json');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function users() {
  const list = readJson(usersFile(), []);
  return Array.isArray(list) ? list : [];
}

function saveUsers(list) {
  writeJson(usersFile(), list);
}

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, createdAt: user.createdAt, isAdmin: !!user.isAdmin };
}

function enabled() {
  return users().length > 0;
}

function register(username, password) {
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5.-]{2,32}$/.test(name)) throw new Error('用户名 2–32 位，支持中英文、数字、下划线');
  if (String(password || '').length < 6) throw new Error('密码至少 6 位');
  const list = users();
  if (list.some((u) => u.username.toLowerCase() === name.toLowerCase())) throw new Error('用户名已存在');
  const isFirst = list.length === 0;
  if (!isFirst) throw new Error('已有账号，请直接登录（本机只允许一个账号）');
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: 'user-' + crypto.randomBytes(6).toString('hex'),
    username: name,
    salt,
    hash: hash(password, salt),
    isAdmin: true,
    createdAt: Date.now(),
    activeProjectId: '',
  };
  list.push(user);
  saveUsers(list);
  return publicUser(user);
}

function login(username, password) {
  const name = String(username || '').trim();
  const user = users().find((u) => u.username.toLowerCase() === name.toLowerCase());
  if (!user) throw new Error('用户名或密码不对');
  const digest = hash(password, user.salt);
  const expected = Buffer.from(user.hash, 'hex');
  const actual = Buffer.from(digest, 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('用户名或密码不对');
  }
  const token = crypto.randomBytes(24).toString('hex');
  const sessions = readJson(sessionsFile(), {});
  sessions[token] = { userId: user.id, createdAt: Date.now(), expiresAt: Date.now() + 30 * 24 * 3600 * 1000 };
  writeJson(sessionsFile(), sessions);
  return { token, user: publicUser(user) };
}

function userByToken(token) {
  if (!token) return null;
  const sessions = readJson(sessionsFile(), {});
  const row = sessions[token];
  if (!row || row.expiresAt < Date.now()) return null;
  return users().find((u) => u.id === row.userId) || null;
}

function logout(token) {
  if (!token) return;
  const sessions = readJson(sessionsFile(), {});
  if (sessions[token]) {
    delete sessions[token];
    writeJson(sessionsFile(), sessions);
  }
}

function setActiveProject(userId, projectId) {
  const list = users();
  const user = list.find((u) => u.id === userId);
  if (!user) return;
  user.activeProjectId = String(projectId || '');
  saveUsers(list);
}

function tokenFromRequest(req) {
  const cookie = String(req.headers.cookie || '');
  const hit = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('wmd_session='));
  if (hit) return decodeURIComponent(hit.slice('wmd_session='.length));
  const auth = String(req.headers.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1] : '';
}

module.exports = { enabled, register, login, logout, userByToken, publicUser, tokenFromRequest, users, setActiveProject, usersFile };
