// v2 scheduling: single input at a time, rotate accounts, harvest replies on the way back around.
import { EventEmitter } from 'node:events';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ClientQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.device = options.device;
    this.controller = options.controller;
    this.log = options.log || (() => {});
    this.harvestDelayMs = Number(options.harvestDelayMs) || 6000;
    this.tickMs = Number(options.tickMs) || 1200;
    // 每一步之间停一下，别催太快。
    this.stepMs = Number(options.stepMs) || 1000;
    this.accountTtlMs = Number(options.accountTtlMs) || 300000;
    this.tasks = [];
    this.accounts = [];
    this.accountsAt = 0;
    this.running = false;
    this.paused = false;
    this.busy = false;
    this.lastError = '';
    this.current = null;
    this.loopPromise = null;
  }

  snapshot() {
    return {
      running: this.running,
      paused: this.paused,
      busy: this.busy,
      current: this.current,
      accounts: this.accounts,
      lastError: this.lastError,
      tasks: this.tasks.map((t) => ({
        id: t.id, text: t.text.slice(0, 200), status: t.status, account: t.account || '',
        conversationId: t.conversationId || '', sentAt: t.sentAt || 0, finishedAt: t.finishedAt || 0,
        reply: t.reply || '', error: t.error || '',
      })),
      counts: this.counts(),
    };
  }

  counts() {
    const c = { queued: 0, sending: 0, sent: 0, done: 0, failed: 0 };
    for (const t of this.tasks) c[t.status] = (c[t.status] || 0) + 1;
    return c;
  }

  enqueue(input = {}) {
    const text = String(input.text || '').trim();
    if (!text) throw new Error('empty task text');
    const id = String(input.id || ('t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
    if (this.tasks.some((t) => t.id === id)) return this.tasks.find((t) => t.id === id);
    const task = { id, text, status: 'queued', account: '', conversationId: '', baseId: '', baseText: '', sentAt: 0, lastSeen: '', reply: '', error: '', createdAt: Date.now() };
    this.tasks.push(task);
    this.emit('change', this.snapshot());
    return task;
  }

  remove(id) {
    const i = this.tasks.findIndex((t) => t.id === id);
    if (i < 0) return false;
    if (['sending', 'sent'].includes(this.tasks[i].status)) throw new Error('task in flight');
    this.tasks.splice(i, 1);
    this.emit('change', this.snapshot());
    return true;
  }

  clearFinished() {
    this.tasks = this.tasks.filter((t) => !['done', 'failed'].includes(t.status));
    this.emit('change', this.snapshot());
  }

  async refreshAccounts(force = false) {
    if (!force && this.accounts.length && Date.now() - this.accountsAt < this.accountTtlMs) return this.accounts;
    const data = await this.device.listAccounts();
    this.accounts = (data.accounts || []).map((a) => ({ name: a.name, plan: a.plan }));
    this.accountsAt = Date.now();
    this.current = data.current || this.current;
    this.emit('change', this.snapshot());
    return this.accounts;
  }

  busyAccounts() {
    const set = new Set();
    for (const t of this.tasks) if (['sending', 'sent'].includes(t.status) && t.account) set.add(t.account);
    return set;
  }

  freeAccounts() {
    const used = this.busyAccounts();
    return this.accounts.filter((a) => !used.has(a.name));
  }

  start() {
    if (this.running) return this.snapshot();
    this.running = true;
    this.paused = false;
    this.stopping = false;
    this.emit('change', this.snapshot());
    this.loopPromise = this.loop();
    return this.snapshot();
  }

  async stop() {
    this.stopping = true;
    this.running = false;
    if (this.loopPromise) await this.loopPromise.catch(() => null);
    this.emit('change', this.snapshot());
    return this.snapshot();
  }

  pause() { this.paused = true; this.emit('change', this.snapshot()); return this.snapshot(); }
  resume() { this.paused = false; this.emit('change', this.snapshot()); return this.snapshot(); }

  async loop() {
    while (!this.stopping) {
      if (this.paused) { await sleep(this.tickMs); continue; }
      try {
        await this.tick();
        this.lastError = '';
      } catch (err) {
        this.lastError = err && err.message ? err.message : String(err);
        this.log('[queue] tick failed: ' + this.lastError);
      }
      await sleep(this.tickMs);
    }
  }

  async step(label) {
    if (process.env.DOUBAO_DEBUG) this.log('[queue] step ' + label + ' pause ' + this.stepMs + 'ms');
    await sleep(this.stepMs);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.refreshAccounts();

      // 1) one round of inputs: every free account takes one queued task, one input at a time.
      let guard = 0;
      while (guard++ < 12) {
        const queued = this.tasks.find((t) => t.status === 'queued');
        const free = this.freeAccounts();
        if (!queued || !free.length) break;
        await this.dispatch(free[0], queued);
      }

      // 2) harvest: come back around to the account that has been waiting longest.
      const pending = this.tasks
        .filter((t) => t.status === 'sent' && Date.now() - t.sentAt >= this.harvestDelayMs)
        .sort((a, b) => a.sentAt - b.sentAt);
      if (pending.length) await this.harvest(pending[0]);

      if (!this.tasks.some((t) => ['queued', 'sending', 'sent'].includes(t.status))) {
        // nothing to do; stay idle but keep the loop alive
      }
    } finally {
      this.busy = false;
    }
  }

  async dispatch(account, task) {
    task.status = 'sending';
    task.account = account.name;
    this.emit('change', this.snapshot());
    try {
      await this.step('switch');
      const sw = await this.withTimeout(this.device.switchAccount(account.name), 'switch ' + account.name);
      this.current = account.name;
      if (sw.switched) this.log('[queue] switched to ' + account.name + ' (' + sw.elapsedMs + 'ms)');
      await this.step('newChat');
      const fresh = await this.withTimeout(this.controller.newChat(), 'newChat');
      await this.step('type');
      const sub = await this.withTimeout(this.controller.submit(task.text), 'submit');
      let convId = sub.conversationId || fresh.conversationId || '';
      if (!/^\d{8,}$/.test(String(convId))) {
        // 临时 local 会话稍后才变成正式 id，从左侧列表顶部补一次。
        const list = await this.controller.conversations().catch(() => []);
        if (list && list[0] && list[0].id) convId = list[0].id;
      }
      Object.assign(task, {
        status: 'sent',
        conversationId: convId,
        baseId: sub.baseId,
        baseText: sub.baseText,
        sentAt: Date.now(),
        lastSeen: '',
      });
      this.log('[queue] sent ' + task.id + ' on ' + account.name + ' -> ' + (task.conversationId || '?'));
    } catch (err) {
      task.status = 'failed';
      task.error = err && err.message ? err.message : String(err);
      this.log('[queue] dispatch failed ' + task.id + ': ' + task.error);
    }
    this.emit('change', this.snapshot());
  }

  async withTimeout(promise, label, timeoutMs = 150000) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timeout ' + timeoutMs + 'ms')), timeoutMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async harvest(task) {
    try {
      await this.step('harvest-switch');
      const sw = await this.withTimeout(this.device.switchAccount(task.account), 'switch back ' + task.account);
      this.current = task.account;
      if (sw.switched) this.log('[queue] back to ' + task.account + ' (' + sw.elapsedMs + 'ms)');
      await this.step('open');
      const target = /^\d{8,}$/.test(String(task.conversationId)) ? task.conversationId : 'latest';
      const opened = await this.withTimeout(this.controller.openConversation(target), 'open conversation', 90000).catch((err) => {
        this.log('[queue] ' + task.id + ' open failed: ' + (err && err.message));
        return null;
      });
      if (opened && opened.conversationId) task.conversationId = opened.conversationId;
      await this.step('read');
      let snap = await this.withTimeout(this.controller.readPage().catch(() => null), 'read', 60000);
      if (!snap) {
        this.log('[queue] ' + task.id + ' harvest: page unreadable, retry later');
        return;
      }
      task.tries = (task.tries || 0) + 1;
      const text = snap.lastBotText || '';
      const isNew = (snap.lastBotId && snap.lastBotId !== task.baseId) || (!!text && text !== task.baseText);
      if (process.env.DOUBAO_DEBUG) {
        this.log('[queue] ' + task.id + ' harvest#' + task.tries + ' url=' + snap.url + ' busy=' + snap.busy + ' new=' + isNew + ' len=' + text.length);
      }
      if (!isNew || !text.trim()) {
        this.log('[queue] ' + task.id + ' no answer yet on ' + task.account + ' (harvest#' + task.tries + ')');
        return;
      }
      if (snap.busy || text !== task.lastSeen) {
        task.lastSeen = text;
        this.log('[queue] ' + task.id + ' streaming (' + text.length + ' chars)');
        return;
      }
      task.status = 'done';
      task.reply = text;
      task.finishedAt = Date.now();
      this.log('[queue] done ' + task.id + ' on ' + task.account + ' (' + text.length + ' chars)');
    } catch (err) {
      task.error = err && err.message ? err.message : String(err);
      this.log('[queue] harvest failed ' + task.id + ': ' + task.error);
    }
    this.emit('change', this.snapshot());
  }
}
