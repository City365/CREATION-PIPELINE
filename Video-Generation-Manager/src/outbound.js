'use strict';
/**
 * 外联客户端：管理器主动连到共享部署的创作台，取命令、本地执行、回传结果。
 *
 * 方向是「管理器 → 创作台」，所以不需要公网 IP、不需要端口映射，
 * 创作台也不用能访问到这台机器。链路只走两个接口：
 *   GET  /api/executor/poll   长轮询取命令（同时当心跳）
 *   POST /api/executor/reply  回结果；大文件先 POST /api/executor/blob
 *
 * 命令只允许打到自己这台管理器的本地 HTTP 接口上，不会转发到别的主机。
 */
const os = require('node:os');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const VERSION = '1.0.0';
const INLINE_LIMIT = 1024 * 1024;
const allowed = (p) => {
  const value = String(p || '');
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  return value === '/health' || value.startsWith('/api/');
};

class Outbound {
  constructor({settings, baseURL, token, log = () => {}}) {
    this.settings = settings;
    this.baseURL = baseURL;
    this.token = token;
    this.log = log;
    this.running = false;
    this.pair = '';
    this.state = {
      online: false,
      lastPollAt: 0,
      lastCommandAt: 0,
      lastError: '',
      lastErrorAt: 0,
      handled: 0,
      failed: 0,
      version: VERSION,
      studioUrl: '',
    };
    this.inflight = 0;
    this.loopPromise = null;
    this.generation = 0;
  }

  config() {
    const raw = (this.settings && this.settings.value && this.settings.value.remote) || {};
    return {
      enabled: Boolean(raw.enabled),
      studioUrl: String(raw.studioUrl || '').replace(/\/+$/, ''),
      token: String(raw.token || '').trim(),
      name: String(raw.name || ''),
    };
  }

  status() {
    const cfg = this.config();
    return {
      enabled: cfg.enabled,
      configured: Boolean(cfg.studioUrl && cfg.token),
      studioUrl: cfg.studioUrl,
      name: cfg.name,
      online: this.state.online,
      lastPollAt: this.state.lastPollAt,
      lastCommandAt: this.state.lastCommandAt,
      lastError: this.state.lastError,
      lastErrorAt: this.state.lastErrorAt,
      handled: this.state.handled,
      failed: this.state.failed,
      inflight: this.inflight,
      version: VERSION,
    };
  }

  start() {
    if (this.running) return this.status();
    this.running = true;
    this.loopPromise = this.loop().catch((error) => {
      this.running = false;
      this.note('外联循环退出：' + error.message);
    });
    return this.status();
  }

  stop() {
    this.running = false;
    this.state.online = false;
    return this.status();
  }

  restart() {
    this.stop();
    // 让正在挂起的长轮询自然超时退出，下一轮看到 running=false 就结束。
    const next = () => {
      this.running = false;
      this.start();
    };
    setTimeout(next, 800).unref();
    return this.status();
  }

  note(message) {
    this.state.lastError = String(message || '');
    this.state.lastErrorAt = Date.now();
    try { this.log('[remote] ' + message); } catch { /* 日志失败不影响主流程 */ }
  }

  async loop() {
    let backoff = 2000;
    const generation = ++this.generation;
    while (this.running && generation === this.generation) {
      const cfg = this.config();
      if (!cfg.enabled || !cfg.studioUrl || !cfg.token) {
        this.state.online = false;
        this.state.lastPollAt = Date.now();
        await sleep(3000);
        continue;
      }
      if (this.pair !== cfg.studioUrl + '|' + cfg.token) this.pair = cfg.studioUrl + '|' + cfg.token;
      try {
        const url = cfg.studioUrl + '/api/executor/poll'
          + '?token=' + encodeURIComponent(cfg.token)
          + '&wait=25000'
          + '&name=' + encodeURIComponent(cfg.name || os.hostname())
          + '&version=' + encodeURIComponent(VERSION);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);
        let res;
        try {
          res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        this.state.lastPollAt = Date.now();
        if (res.status === 401) {
          this.state.online = false;
          this.note('创作台拒绝了这个配对令牌，请重新配对');
          await sleep(20000);
          continue;
        }
        if (!res.ok) {
          this.state.online = false;
          this.note('创作台返回 HTTP ' + res.status);
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 60000);
          continue;
        }
        const data = await res.json().catch(() => ({}));
        const commands = Array.isArray(data.commands) ? data.commands : [];
        this.state.online = true;
        this.state.lastError = '';
        backoff = 2000;
        for (const command of commands) this.execute(command).catch(() => {});
      } catch (error) {
        this.state.online = false;
        const message = error && error.name === 'AbortError' ? '长轮询超时（创作台没响应）' : (error && error.message) || String(error);
        // 网络抖动不刷屏：只在第一次掉线时记录。
        if (this.state.online !== false || !this.state.lastError) this.note(message);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  }

  /** 执行一条命令：只打到本机管理器，结果按大小内联或先传 blob。 */
  async execute(command) {
    const id = String(command && command.id || '');
    if (!id) return;
    const cfg = this.config();
    if (!cfg.enabled) return;
    // 服务端已经超时的命令不能再补执行；留 2 秒容忍两台机器的时钟偏差。
    const expiresAt = Number(command.expiresAt) || 0;
    if (expiresAt && Date.now() > expiresAt + 2000) {
      this.state.failed += 1;
      await this.reply(cfg, { id, status: 0, error: '命令已过期，未执行' }).catch(() => {});
      return;
    }
    const target = String(command.path || '');
    const started = Date.now();
    this.state.lastCommandAt = started;
    if (!allowed(target)) {
      await this.reply(cfg, { id, status: 0, error: '不支持的命令路径：' + target.slice(0, 120) });
      this.state.failed += 1;
      return;
    }
    this.inflight += 1;
    try {
      const method = String(command.method || 'GET').toUpperCase();
      const headers = { Accept: 'application/json', Authorization: 'Bearer ' + this.token };
      const extra = command.headers && typeof command.headers === 'object' ? command.headers : {};
      if (extra['content-type'] || extra['Content-Type']) headers['Content-Type'] = extra['content-type'] || extra['Content-Type'];
      const body = command.bodyBase64 ? Buffer.from(String(command.bodyBase64), 'base64') : undefined;
      const timeoutMs = Math.max(5000, Math.min(Number(command.timeoutMs) || 600000, 900000));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      let buffer;
      try {
        res = await fetch(this.baseURL + target, { method, headers, body, signal: controller.signal });
        buffer = Buffer.from(await res.arrayBuffer());
      } finally {
        clearTimeout(timer);
      }
      const responseHeaders = {};
      for (const [key, value] of res.headers.entries()) responseHeaders[key] = value;
      if (buffer.length > INLINE_LIMIT) {
        const uploaded = await this.uploadBlob(cfg, id, buffer);
        if (!uploaded) throw new Error('回传文件失败');
        await this.reply(cfg, { id, status: res.status, headers: responseHeaders, blob: id });
      } else {
        await this.reply(cfg, {
          id,
          status: res.status,
          headers: responseHeaders,
          bodyBase64: buffer.length ? buffer.toString('base64') : '',
        });
      }
      this.state.handled += 1;
    } catch (error) {
      this.state.failed += 1;
      const message = error && error.name === 'AbortError' ? '本地请求超时' : (error && error.message) || String(error);
      await this.reply(cfg, { id, status: 0, error: message }).catch(() => {});
    } finally {
      this.inflight = Math.max(0, this.inflight - 1);
    }
  }

  async uploadBlob(cfg, id, buffer) {
    try {
      const res = await fetch(cfg.studioUrl + '/api/executor/blob?token=' + encodeURIComponent(cfg.token) + '&id=' + encodeURIComponent(id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
      });
      return res.ok;
    } catch (error) {
      this.note('上传结果文件失败：' + ((error && error.message) || error));
      return false;
    }
  }

  async reply(cfg, payload) {
    try {
      const res = await fetch(cfg.studioUrl + '/api/executor/reply?token=' + encodeURIComponent(cfg.token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch (error) {
      this.note('回传结果失败：' + ((error && error.message) || error));
      return false;
    }
  }
}

module.exports = {Outbound, VERSION};
