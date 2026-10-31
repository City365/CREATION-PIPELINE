// High level controller: send a message to Doubao and wait for the streaming answer.
import { CdpClient } from './cdp.mjs';
import { CSS, RECT_SRC, SRC } from './dom.mjs';
import { DEFAULT_PORT, pickChatTarget, listTargets } from './cdp.mjs';
import { ensureApp } from './app.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class DoubaoController {
  constructor(options = {}) {
    this.port = options.port || DEFAULT_PORT;
    this.exe = options.exe;
    this.client = null;
    this.target = null;
    this.log = options.log || (() => {});
    this.defaultTimeoutMs = options.timeoutMs || 180000;
    this.defaultStableMs = options.stableMs || 1200;
    this.pollMs = options.pollMs || 500;
    // 打字完成到按下回车之间的停顿，避免操作过快。
    this.paceMs = Number(options.paceMs) || 1000;
  }

  async ensureConnected({ restart = true } = {}) {
    if (this.client && !this.client.closed) return this.client;
    await ensureApp({ port: this.port, exe: this.exe, restart, log: this.log });
    const targets = await listTargets(this.port);
    const target = pickChatTarget(targets);
    if (!target) throw new Error('Doubao chat page not found on CDP port ' + this.port);
    this.client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await this.client.send('Runtime.enable');
    this.target = target;
    const ready = await this.waitForEditor(45000);
    if (!ready) this.log('chat input is not ready yet (page still loading)');
    return this.client;
  }

  async evaluate(src) {
    if (!this.client || this.client.closed) await this.ensureConnected();
    try {
      return await this.client.evaluate(src);
    } catch (err) {
      this.client = null;
      throw err;
    }
  }

  async probe() {
    return this.evaluate(SRC.probe);
  }

  async waitForSelector(selector, timeoutMs = 8000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const ok = await this.evaluate('(() => !!document.querySelector(' + JSON.stringify(selector) + '))()').catch(() => false);
      if (ok) return true;
      await sleep(300);
    }
    return false;
  }

  async waitForEditor(timeoutMs = 45000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const p = await this.probe().catch(() => null);
      if (p && p.hasEditor) return true;
      await sleep(500);
    }
    return false;
  }

  async status() {
    const st = await this.probe();
    return {
      ok: true,
      port: this.port,
      url: st.url,
      conversationId: conversationIdOf(st.url),
      busy: st.busy,
      hasEditor: st.hasEditor,
      messages: st.botCount + st.userCount,
    };
  }

  async readPage() {
    return this.evaluate(SRC.messages);
  }

  async messages() {
    const data = await this.evaluate(SRC.messages);
    return {
      url: data.url,
      conversationId: conversationIdOf(data.url),
      busy: data.busy,
      messages: data.messages,
    };
  }

  async conversations() {
    return this.evaluate(SRC.conversations);
  }

  async clickSelector(selector) {
    const rect = await this.evaluate(RECT_SRC(selector));
    if (!rect) throw new Error('element not found: ' + selector);
    const base = { x: rect.x, y: rect.y, button: 'left', clickCount: 1 };
    await this.client.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseMoved' }, base));
    await this.client.send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, base));
    await sleep(60);
    await this.client.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, base));
    return rect;
  }

  async newChat() {
    const before = (await this.probe()).url;
    await this.clickSelector(CSS.newChat);
    await sleep(this.paceMs);
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      const now = await this.probe();
      if (now.url !== before) return { url: now.url, conversationId: conversationIdOf(now.url) };
      if (!now.hasEditor) continue;
    }
    return { url: (await this.probe()).url, conversationId: null };
  }

  async openConversation(target) {
    let list = [];
    const listStart = Date.now();
    while (Date.now() - listStart < 20000) {
      list = await this.conversations().catch(() => []);
      if (list.length) break;
      await sleep(500);
    }
    let item = null;
    if (target === 'latest') item = list[0] || null;
    else if (typeof target === 'number') item = list[target] || null;
    else if (/^\d{8,}$/.test(String(target))) item = list.find((c) => c.id === target) || null;
    if (!item && typeof target === 'string') item = list.find((c) => c.title.indexOf(target) >= 0) || null;
    if (!item) throw new Error('conversation not found: ' + target);
    const currentUrl = (await this.probe()).url;
    if (conversationIdOf(currentUrl) === item.id) {
      return { title: item.title, conversationId: item.id, url: currentUrl, alreadyOpen: true };
    }
    await this.clickSelector('[data-conversation-id="' + item.id + '"]');
    await sleep(this.paceMs);
    let url = '';
    for (let i = 0; i < 40; i++) {
      await sleep(300);
      url = (await this.probe().catch(() => ({}))).url || '';
      if (conversationIdOf(url) === item.id) break;
      if (i === 20) await this.clickSelector('[data-conversation-id="' + item.id + '"]').catch(() => null);
    }

    return { title: item.title, conversationId: conversationIdOf(url), url };
  }

  async stop() {
    try {
      await this.clickSelector(CSS.breakButton);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  async typeIntoEditor(text) {
    const state = await this.evaluate(SRC.focusEditor);
    if (!state.ok) throw new Error('Doubao input box not available: ' + state.reason);
    if (state.text && state.text.trim()) {
      await this.client.pressKey('a', 'KeyA', 65);
      await this.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
      await this.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
      await sleep(120);
    }
    await this.client.insertText(text);
    await sleep(150);
    const ready = await this.probe();
    if (!ready.sendButton) {
      // TipTap sometimes needs one more input event before the send button shows up.
      await this.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 });
      await sleep(200);
    }
    return this.probe();
  }

  // Type + enter only. Returns the baseline so a later poll can tell the new answer apart.
  async submit(text) {
    await this.ensureConnected();
    const before = await this.evaluate(SRC.messages);
    if (before.busy) {
      const err = new Error('Doubao is still answering the previous message');
      err.code = 'BUSY';
      throw err;
    }
    const baseId = before.lastBotId || '';
    const baseText = before.lastBotText || '';
    const started = Date.now();
    await this.typeIntoEditor(String(text));
    await sleep(this.paceMs);
    // 输入框有字后才会出现发送按钮；没有就再补一次输入事件。
    await this.waitForSelector(CSS.sendButton, 6000).catch(() => null);
    const beforeProbe = await this.evaluate(SRC.probe);
    await this.client.pressEnter();

    // 发送成功的判据是出现「我」的气泡；回退手段是点发送按钮。
    let submitted = false;
    for (let i = 0; i < 24 && !submitted; i++) {
      await sleep(600);
      const p = await this.evaluate(SRC.probe).catch(() => null);
      if (p && p.userCount > beforeProbe.userCount) { submitted = true; break; }
      if (i === 6) await this.clickSelector(CSS.sendButton).catch(() => null);
      if (i === 14) {
        await this.evaluate(SRC.focusEditor).catch(() => null);
        await this.client.pressEnter();
      }
    }
    if (!submitted) throw new Error('消息没有发出去（页面没出现用户气泡）');

    // 新会话先给 local_ 临时 id，稍后才变成真正的数字会话 id。
    let conversationId = conversationIdOf((await this.evaluate(SRC.probe)).url);
    for (let i = 0; i < 60; i++) {
      if (conversationId && /^\d{8,}$/.test(conversationId)) break;
      await sleep(500);
      const url = (await this.evaluate(SRC.probe).catch(() => null) || {}).url;
      conversationId = conversationIdOf(url) || conversationId;
    }
    return { ok: true, baseId, baseText, conversationId, localId: /^local_/.test(String(conversationId)), sentAt: Date.now(), elapsedMs: Date.now() - started };

  }

  // Poll until the assistant answer stops growing (or the action bar shows up).
  async waitReply(options = {}) {
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;
    const stableMs = options.stableMs || this.defaultStableMs;
    const onProgress = options.onProgress || null;
    const baseId = options.baseId || '';
    const baseText = options.baseText || '';
    const started = Date.now();
    let lastText = '';
    let lastChange = Date.now();
    let sawBot = false;
    while (Date.now() - started < timeoutMs) {
      await sleep(this.pollMs);
      let snap;
      try {
        snap = await this.evaluate(SRC.messages);
      } catch (err) {
        if (String(err && err.message).indexOf('closed') >= 0) break;
        throw err;
      }
      const text2 = snap.lastBotText || '';
      const isNewAnswer = (snap.lastBotId && snap.lastBotId !== baseId) || (!!text2 && text2 !== baseText);
      if (isNewAnswer) sawBot = true;
      if (text2 !== lastText) { lastText = text2; lastChange = Date.now(); }
      if (onProgress) {
        try { onProgress({ text: lastText, busy: snap.busy, elapsedMs: Date.now() - started }); } catch {}
      }
      const quietFor = Date.now() - lastChange;
      if (process.env.DOUBAO_DEBUG) {
        console.error('[poll] id=' + (snap.lastBotId || '-') + '/' + (baseId || '-') + ' new=' + isNewAnswer + ' sawBot=' + sawBot + ' finished=' + snap.lastBotFinished + ' busy=' + snap.busy + ' quiet=' + quietFor + ' len=' + lastText.length);
      }
      if (sawBot && lastText.trim() && (snap.lastBotFinished || (!snap.busy && quietFor >= stableMs))) {
        return {
          ok: true,
          text: lastText,
          conversationId: conversationIdOf(snap.url),
          elapsedMs: Date.now() - started,
        };
      }
    }
    return {
      ok: false,
      reason: 'timeout',
      text: lastText,
      elapsedMs: Date.now() - started,
      conversationId: conversationIdOf((await this.evaluate(SRC.probe)).url),
    };
  }

  // Send one message and wait for the assistant answer to finish streaming.
  async send(text, options = {}) {
    const submitted = await this.submit(text);
    const reply = await this.waitReply({
      baseId: submitted.baseId,
      baseText: submitted.baseText,
      timeoutMs: options.timeoutMs,
      stableMs: options.stableMs,
      onProgress: options.onProgress,
    });
    return Object.assign({}, reply, { conversationId: reply.conversationId || submitted.conversationId });
  }


  close() {
    if (this.client) this.client.close();
    this.client = null;
  }
}

const CSS_conversationItem = '[data-testid="conversation-list-v2-item"]';

export function conversationIdOf(url) {
  if (!url) return null;
  const cleaned = String(url).split('?')[0].split('#')[0].replace(/\/+$/, '');
  const m = cleaned.match(/chat\/([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  return m[1] === 'chat' ? null : m[1];
}
