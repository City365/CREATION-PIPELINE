#!/usr/bin/env node
// Local control panel + JSON API for the Doubao desktop app (http://127.0.0.1:18080).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DoubaoController } from './src/chat.mjs';
import { Device } from './src/device.mjs';
import { ClientQueue } from './src/queue.mjs';
import { DEFAULT_EXE } from './src/app.mjs';
import { DEFAULT_PORT } from './src/cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, 'web');
const PORT = Number(process.env.DOUBAO_PANEL_PORT || 18080);

const controller = new DoubaoController({ exe: DEFAULT_EXE, port: DEFAULT_PORT, paceMs: 1000 });
const device = new Device({ port: DEFAULT_PORT, paceMs: 1000 });
const cliQueue = new ClientQueue({ device, controller, stepMs: 1000, harvestDelayMs: 8000, tickMs: 1500, log: (m) => console.log(m) });
const state = { busy: false, partial: '', error: null, lastResult: null, messages: [], conversationId: null, cdpReady: false };
let job = null;
let refreshing = null;

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function refresh(full) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const data = await controller.messages();
      state.messages = data.messages;
      state.conversationId = data.conversationId;
      state.cdpReady = true;
      if (full) state.conversations = await controller.conversations();
    } catch (err) {
      state.cdpReady = false;
      state.error = err && err.message ? err.message : String(err);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function startSend(text) {
  if (job) throw new Error('上一条还在生成中');
  state.busy = true;
  state.partial = '';
  state.error = null;
  job = controller.send(text, { onProgress: (p) => { state.partial = p.text; } })
    .then(async (res) => {
      state.lastResult = res;
      await refresh(true);
      return res;
    })
    .catch((err) => { state.error = err && err.message ? err.message : String(err); })
    .finally(() => { state.busy = false; state.partial = ''; job = null; });
  return job;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const route = url.pathname;

  try {
    if (route === '/api/status') {
      const st = await controller.status().catch((err) => ({ ok: false, reason: err.message }));
      return json(res, 200, Object.assign({}, st, {
        busy: state.busy, error: state.error, cdpPort: DEFAULT_PORT,
        conversationId: st.conversationId || state.conversationId,
      }));
    }

    if (route === '/api/state') {
      if (!state.busy && Date.now() - (state.lastRefreshAt || 0) > 1500) {
        state.lastRefreshAt = Date.now();
        await refresh(false);
      }
      return json(res, 200, {
        busy: state.busy,
        partial: state.partial,
        error: state.error,
        cdpReady: state.cdpReady,
        conversationId: state.conversationId,
        messages: state.messages,
        lastResult: state.lastResult,
      });
    }

    if (route === '/api/conversations') {
      const list = await controller.conversations();
      return json(res, 200, { ok: true, conversations: list });
    }

    if (route === '/api/send' && req.method === 'POST') {
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      if (!text) return json(res, 400, { ok: false, error: '消息为空' });
      startSend(text).catch(() => {});
      return json(res, 202, { ok: true, accepted: true });
    }

    if (route === '/api/new' && req.method === 'POST') {
      if (state.busy) return json(res, 409, { ok: false, error: '生成中，稍后再试' });
      const r = await controller.newChat();
      state.messages = [];
      state.conversationId = r.conversationId;
      return json(res, 200, { ok: true, conversationId: r.conversationId });
    }

    if (route === '/api/open' && req.method === 'POST') {
      const body = await readBody(req);
      const key = body.id || body.title;
      const r = await controller.openConversation(key);
      await refresh(true);
      return json(res, 200, { ok: true, conversationId: r.conversationId, title: r.title });
    }

    if (route === '/api/stop' && req.method === 'POST') {
      const r = await controller.stop();
      return json(res, 200, r);
    }

    if (route === '/api/accounts') {
      const data = await device.listAccounts();
      return json(res, 200, data);
    }

    if (route === '/api/accounts/switch' && req.method === 'POST') {
      const body = await readBody(req);
      const key = body.name || body.index;
      const r = await device.switchAccount(key);
      state.conversationId = null;
      await refresh(true).catch(() => null);
      return json(res, 200, r);
    }

    if (route === '/api/menus') {
      const menus = await device.menus();
      return json(res, 200, menus);
    }

    if (route === '/api/queue') {
      return json(res, 200, cliQueue.snapshot());
    }

    if (route === '/api/queue/add' && req.method === 'POST') {
      const body = await readBody(req);
      const task = cliQueue.enqueue({ id: body.id, text: body.text });
      return json(res, 200, { ok: true, task: cliQueue.snapshot().tasks.find((t) => t.id === task.id) });
    }

    if (route === '/api/queue/control' && req.method === 'POST') {
      const body = await readBody(req);
      const action = String(body.action || '');
      if (action === 'start') return json(res, 200, cliQueue.start());
      if (action === 'stop') return json(res, 200, await cliQueue.stop());
      if (action === 'pause') return json(res, 200, cliQueue.pause());
      if (action === 'resume') return json(res, 200, cliQueue.resume());
      if (action === 'clear') { cliQueue.clearFinished(); return json(res, 200, cliQueue.snapshot()); }
      return json(res, 400, { ok: false, error: 'unknown action' });
    }

    if (route === '/api/reconnect' && req.method === 'POST') {
      controller.close();
      await controller.ensureConnected({ restart: true });
      await refresh(true);
      return json(res, 200, { ok: true });
    }

    if (route === '/' || route === '/index.html') {
      const html = fs.readFileSync(path.join(WEB_DIR, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      return res.end(html);
    }

    if (route === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }

    if (route === '/app.js' || route === '/styles.css') {
      const file = path.join(WEB_DIR, route.slice(1));
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)], 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (err) {
    json(res, 500, { ok: false, error: err && err.message ? err.message : String(err) });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log('豆包控制台: http://127.0.0.1:' + PORT);
  try {
    await controller.ensureConnected({ restart: true });
    await refresh(true);
    console.log('已连接到本地豆包客户端 (CDP ' + DEFAULT_PORT + ')');
  } catch (err) {
    state.error = err && err.message ? err.message : String(err);
    console.log('连接豆包失败: ' + state.error + '（页面里点「重新连接」可重试）');
  }
});

const shutdown = () => { try { controller.close(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
