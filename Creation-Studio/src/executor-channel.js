'use strict';
/**
 * 执行端通道：用户本机的管理器主动连上来，服务器反过来把请求交给它执行。
 *
 * 共享部署时服务器够不到用户机器的 127.0.0.1，所以方向要反过来：
 *   管理器 → 长轮询 /api/executor/poll 取命令 → 本地执行 → POST /api/executor/reply 回结果
 * 只依赖 Node 内置能力，不引入 WebSocket 依赖，也能穿过普通反向代理。
 *
 * 一条命令的载荷很小（方法 + 路径 + JSON），所以命令体直接走 JSON；
 * 返回的二进制（成片）可能几十兆，超过内联上限就改成单独 POST /api/executor/blob 落盘。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');

const INLINE_LIMIT = 1024 * 1024;        // 1MB 以内内联 base64，超过走 blob
const DEFAULT_TIMEOUT = 60000;
const LONG_POLL_MAX = 30000;

function dataDir() {
  return config.load().dataDir || path.join(__dirname, '..', 'data');
}

function blobDir() {
  return path.join(dataDir(), 'executor-blobs');
}

/** 令牌存 SQLite：它决定谁能远程下发命令，不能放在可随手改写的 JSON 里。 */
function toRecord(row) {
  if (!row) return null;
  return { userId: row.user_id, name: row.name, createdAt: row.created_at, lastSeen: row.last_seen };
}

function listTokens() {
  return db.open().prepare('SELECT * FROM executor_channels ORDER BY created_at').all();
}

/* --------------------------- 运行时状态（内存） --------------------------- */

const queues = new Map();      // token -> 待下发命令
const waiters = new Map();     // id -> { resolve, reject, timer }
const pollers = new Map();     // token -> Set<唤醒函数>
const runners = new Map();     // token -> { name, version, firstSeen, lastSeen, lastError, lastCommandAt }
const stats = { commands: 0, replies: 0, blobs: 0, timeouts: 0 };

function queueOf(token) {
  if (!queues.has(token)) queues.set(token, []);
  return queues.get(token);
}

function wakePollers(token) {
  const list = pollers.get(token);
  if (!list || !list.size) return;
  for (const wake of [...list]) {
    try { wake(); } catch { /* 唤醒失败不影响下一轮轮询 */ }
  }
}

/** 令牌 → 记录；不存在返回 null。 */
function authenticate(token) {
  const key = String(token || '');
  if (!key) return null;
  return toRecord(db.open().prepare('SELECT * FROM executor_channels WHERE token = ?').get(key));
}

/** 给某个用户签发一条通道令牌。默认追加，多台机器各用一条；replace=true 才换发。 */
function issue(userId, { name = '', replace = false } = {}) {
  const conn = db.open();
  const uid = String(userId || 'local');
  if (replace) conn.prepare('DELETE FROM executor_channels WHERE user_id = ?').run(uid);
  const token = 'exe_' + crypto.randomBytes(24).toString('base64url');
  const createdAt = Date.now();
  conn.prepare('INSERT INTO executor_channels(token, user_id, name, created_at, last_seen) VALUES (?,?,?,?,0)')
    .run(token, uid, String(name || ''), createdAt);
  return { token, id: tokenId(token), userId: uid, name: String(name || ''), createdAt };
}

/** 界面用的稳定短标识；不能拿它当令牌用。 */
function tokenId(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16);
}

function revoke(token) {
  const key = String(token || '');
  const result = db.open().prepare('DELETE FROM executor_channels WHERE token = ?').run(key);
  queues.delete(key);
  return Number(result.changes) > 0;
}

function tokensForUser(userId) {
  const uid = String(userId || 'local');
  return listTokens()
    .filter((row) => row.user_id === uid)
    .map((row) => ({ token: row.token, ...toRecord(row), online: runners.has(row.token) }));
}

/** 只允许撤销自己的令牌；id 是 tokenId() 的短标识。 */
function revokeForUser(userId, { id = '', token = '' } = {}) {
  const uid = String(userId || 'local');
  const rows = tokensForUser(uid);
  const hit = token
    ? rows.find((row) => row.token === String(token))
    : rows.find((row) => tokenId(row.token) === String(id || ''));
  if (!hit) return false;
  return revoke(hit.token);
}

/* ------------------------------- 命令与应答 ------------------------------- */

function takeCommand(token) {
  const queue = queueOf(token);
  const now = Date.now();
  while (queue.length) {
    const command = queue.shift();
    // 过期命令不再下发：调用方早就收到超时了，晚几秒执行等于重复副作用。
    if (!command.expiresAt || command.expiresAt > now) return command;
  }
  return null;
}

/** 调用方超时后把还没下发的命令摘掉。 */
function removeQueued(token, id) {
  const queue = queueOf(token);
  const index = queue.findIndex((command) => command.id === id);
  if (index >= 0) queue.splice(index, 1);
}

/** 取一批命令：最多 limit 条，但遇到串行命令就只给这一条。 */
function drainCommands(token, limit = 4) {
  const out = [];
  while (out.length < limit) {
    const next = takeCommand(token);
    if (!next) break;
    out.push(next);
    if (next.serial) break;
  }
  return out;
}

/**
 * 长轮询：有命令立刻返回，没有就挂起到 waitMs（默认 25 秒）再回空。
 * 管理器那边靠这个循环同时充当心跳。
 */
function poll(token, { waitMs = 25000, name = '', version = '' } = {}) {
  const rec = authenticate(token);
  if (!rec) {
    const error = new Error('通道令牌无效或已失效，请在管理器里重新配对');
    error.code = 'UNAUTHORIZED';
    throw error;
  }
  // 0 是合法值（立即返回），不能用 `|| 25000` 把 0 吞掉。
  const requested = Number(waitMs);
  const wait = Math.max(0, Math.min(LONG_POLL_MAX, Number.isFinite(requested) ? requested : 25000));
  const runner = runners.get(token) || { firstSeen: Date.now(), lastSeen: 0, name: '', version: '' };
  runner.name = String(name || runner.name || '');
  runner.version = String(version || runner.version || '');
  const wasOffline = !runners.has(token) || Date.now() - runner.lastSeen > 45000;
  runner.lastSeen = Date.now();
  runners.set(token, runner);
  if (wasOffline) touchToken(token, { lastSeen: Date.now(), name: runner.name });

  return new Promise((resolve) => {
    let done = false;
    const finish = (commands) => {
      if (done) return;
      done = true;
      list.delete(wake);
      clearTimeout(timer);
      if (!list.size) pollers.delete(token);
      resolve({ commands, serverTime: Date.now(), interval: 0 });
    };
    const wake = () => {
      const commands = drainCommands(token);
      if (commands.length || done) return finish(commands);
    };
    const timer = setTimeout(() => finish(drainCommands(token)), wait);
    if (!pollers.has(token)) pollers.set(token, new Set());
    const list = pollers.get(token);
    list.add(wake);
    const queued = drainCommands(token);
    if (queued.length) finish(queued);
  });
}

function touchToken(token, patch) {
  const key = String(token || '');
  if (!key) return;
  if (patch.lastSeen !== undefined) db.open().prepare('UPDATE executor_channels SET last_seen = ? WHERE token = ?').run(Number(patch.lastSeen) || 0, key);
  if (patch.name !== undefined) db.open().prepare('UPDATE executor_channels SET name = ? WHERE token = ?').run(String(patch.name || ''), key);
}

function rememberError(token, message) {
  const runner = runners.get(token);
  if (!runner) return;
  runner.lastError = String(message || '');
  runner.lastErrorAt = Date.now();
}

/** 管理器回传的一条结果：小结果内联，大结果先落 blob 再由这里关联。 */
function settle(token, payload) {
  const id = String(payload.id || '');
  const waiter = waiters.get(id);
  if (!waiter) return false;   // 超时后才回来的结果，直接丢掉
  waiters.delete(id);
  clearTimeout(waiter.timer);
  stats.replies += 1;
  const runner = runners.get(token);
  if (runner) runner.lastSeen = Date.now();
  if (payload.error) {
    const error = new Error(String(payload.error));
    error.status = Number(payload.status) || 0;
    error.remote = true;
    rememberError(token, payload.error);
    waiter.reject(error);
    return true;
  }
  let body = null;
  if (payload.bodyBase64) body = Buffer.from(String(payload.bodyBase64), 'base64');
  const blob = payload.blob ? String(payload.blob) : '';
  let blobBytes = 0;
  if (blob) {
    try { blobBytes = fs.statSync(blobPath(blob)).size; } catch { blobBytes = 0; }
  }
  waiter.resolve({
    status: Number(payload.status) || 200,
    headers: payload.headers && typeof payload.headers === 'object' ? payload.headers : {},
    body,
    blob,
    blobBytes,
  });
  return true;
}

/** 大结果落盘：/api/executor/blob 收到裸字节后调这里登记。 */
function saveBlob(id, buffer) {
  fs.mkdirSync(blobDir(), { recursive: true });
  const file = path.join(blobDir(), String(id).replace(/[^A-Za-z0-9_.-]/g, '') + '.bin');
  fs.writeFileSync(file, buffer);
  stats.blobs += 1;
  return file;
}

function blobPath(id) {
  const file = path.join(blobDir(), String(id).replace(/[^A-Za-z0-9_.-]/g, '') + '.bin');
  return fs.existsSync(file) ? file : '';
}

function discardBlob(id) {
  const file = blobPath(id);
  if (file) { try { fs.unlinkSync(file); } catch { /* 清理失败不影响结果 */ } }
}

/** 服务器 → 管理器的一次调用，等它回结果。 */
function request(token, { method = 'GET', path: target = '/', body = null, headers = {}, timeoutMs = DEFAULT_TIMEOUT, serial = false } = {}) {
  const rec = authenticate(token);
  if (!rec) {
    const error = new Error('通道令牌无效或已失效');
    error.status = 0;
    return Promise.reject(error);
  }
  const runner = runners.get(token);
  if (!runner || Date.now() - (runner.lastSeen || 0) > 45000) {
    const error = new Error('这个执行端还没连上（管理器没有在轮询）');
    error.status = 0;
    return Promise.reject(error);
  }
  const id = crypto.randomUUID();
  const ttl = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT);
  const command = {
    id,
    method: String(method || 'GET').toUpperCase(),
    path: String(target || '/'),
    headers: headers && typeof headers === 'object' ? headers : {},
    bodyBase64: body == null ? '' : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64'),
    serial: Boolean(serial),
    // 管理器执行前也按这个时间判断，避免长轮询断开/重连后补执行一条早就超时的命令。
    expiresAt: Date.now() + ttl,
  };
  stats.commands += 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      removeQueued(token, id);
      stats.timeouts += 1;
      const error = new Error('执行端在 ' + Math.round(timeoutMs / 1000) + ' 秒内没有返回结果');
      error.status = 0;
      reject(error);
    }, ttl);
    waiters.set(id, { resolve, reject, timer, token });
    queueOf(token).push(command);
    wakePollers(token);
  });
}

/** 当前用户的执行端状态，给界面展示。完整令牌只在签发时返回一次。 */
function status(userId) {
  const rows = tokensForUser(userId).map(({ token, ...row }) => {
    const runner = runners.get(token) || null;
    const online = Boolean(runner) && Date.now() - (runner.lastSeen || 0) < 45000;
    return {
      id: tokenId(token),
      tokenHint: token.slice(0, 8) + '…' + token.slice(-4),
      name: runner && runner.name || row.name || '',
      version: runner && runner.version || '',
      online,
      lastSeen: runner ? runner.lastSeen : row.lastSeen || 0,
      lastError: runner ? runner.lastError || '' : '',
      queued: queueOf(token).length,
      pairedAt: row.createdAt || 0,
    };
  });
  return { channels: rows, stats: { ...stats }, online: rows.some((row) => row.online) };
}

module.exports = {
  issue,
  revoke,
  revokeForUser,
  tokenId,
  authenticate,
  tokensForUser,
  poll,
  settle,
  saveBlob,
  blobPath,
  discardBlob,
  request,
  status,
  INLINE_LIMIT,
};
