// Minimal Chrome DevTools Protocol client for the Doubao desktop app (Electron/CEF).
import { spawn } from 'node:child_process';

export const DEFAULT_PORT = Number(process.env.DOUBAO_CDP_PORT || 9333);

export class CdpError extends Error {}

async function fetchJson(url, timeoutMs = 2000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new CdpError('HTTP ' + res.status + ' from ' + url);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function listTargets(port = DEFAULT_PORT) {
  return fetchJson('http://127.0.0.1:' + port + '/json/list');
}

export async function version(port = DEFAULT_PORT) {
  return fetchJson('http://127.0.0.1:' + port + '/json/version');
}

export async function portAlive(port = DEFAULT_PORT) {
  try {
    const v = await version(port);
    return { alive: true, browser: v.Browser };
  } catch {
    return { alive: false, browser: null };
  }
}

export function pickChatTarget(targets) {
  const pages = (targets || []).filter((t) => t.type === 'page' || t.type === 'other');
  const chat = pages.filter((t) => t.url && t.url.indexOf('doubao-chat/chat') >= 0);
  const ordered = chat.filter((t) => !/background|cross-site-support/.test(t.url));
  return ordered[0] || chat[0] || null;
}

export class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 0;
    this.pending = new Map();
    this.closed = false;
  }

  static async connect(wsUrl) {
    const client = new CdpClient(wsUrl);
    await client.open();
    return client;
  }

  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => reject(new CdpError('CDP connect timeout: ' + this.wsUrl)), 8000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new CdpError('CDP websocket error: ' + this.wsUrl)); };
      ws.onclose = () => {
        this.closed = true;
        for (const item of this.pending.values()) item.reject(new CdpError('CDP websocket closed'));
        this.pending.clear();
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const item = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) item.reject(new CdpError(msg.error.message || JSON.stringify(msg.error)));
          else item.resolve(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new CdpError('CDP closed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError('CDP timeout for ' + method));
      }, 30000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      const detail = res.exceptionDetails.exception && res.exceptionDetails.exception.description
        ? res.exceptionDetails.exception.description
        : res.exceptionDetails.text;
      throw new CdpError('evaluate failed: ' + detail);
    }
    return res.result.value;
  }

  async insertText(text) {
    await this.send('Input.insertText', { text });
  }

  async pressEnter() {
    const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base));
    await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'char', text: '\r', unmodifiedText: '\r' }, base));
    await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  }

  async pressKey(key, code, vk) {
    const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown', modifiers: 2 }, base));
    await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp', modifiers: 2 }, base));
  }

  close() {
    try { this.ws.close(); } catch {}
    this.closed = true;
  }
}
