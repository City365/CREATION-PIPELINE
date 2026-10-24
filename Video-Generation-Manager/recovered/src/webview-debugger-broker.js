"use strict";

const e = require("node:crypto");
function t(e, t, n, o) {
  const r = Number.parseInt(e, 10);
  return Number.isFinite(r) ? Math.max(n, Math.min(o, r)) : t;
}
class n {
  constructor(e = {}) {
    this.states = new Map(), this.eventLimit = t(e.eventLimit, 4e3, 100, 2e4), this.commandTimeoutMs = t(e.commandTimeoutMs, 15e3, 10, 12e4), this.log = "function" == typeof e.log ? e.log : () => {};
  }
  append(e, t, n = {}) {
    const o = {
      cursor: e.nextCursor++,
      method: String(t || ""),
      params: n && "object" == typeof n ? n : {}
    };
    e.events.push(o), e.events.length > this.eventLimit && e.events.splice(0, e.events.length - this.eventLimit);
    for (const t of [...e.waiters]) try {
      t();
    } catch {}
    e.waiters.clear();
  }
  releaseState(e, t = "replaced") {
    if (e) {
      e.closed = !0;
      for (const t of [...e.waiters]) try {
        t();
      } catch {}
      e.waiters.clear(), this.log("webview-debugger-state-released", {
        accountId: e.accountId,
        webContentsId: e.webContentsId,
        reason: t
      });
    }
  }
  register(e, t) {
    const n = String(e || "");
    if (!n || !t) return null;
    const o = Number(t.id || 0),
      r = this.states.get(n);
    if (r?.webContentsId === o && !r.closed) return r;
    r && this.releaseState(r, "target-replaced");
    const s = {
      accountId: n,
      contents: t,
      webContentsId: o,
      ownerToken: "",
      attached: !1,
      closed: !1,
      events: [],
      nextCursor: 1,
      waiters: new Set()
    };
    return this.states.set(n, s), t.debugger.on("message", (e, t, o) => {
      s.closed || this.states.get(n) !== s || this.append(s, t, o);
    }), t.debugger.on("detach", (e, t) => {
      s.closed || this.states.get(n) !== s || (s.attached = !1, this.append(s, "Inspector.detached", {
        reason: String(t || "detached")
      }), this.log("webview-debugger-detached", {
        accountId: n,
        webContentsId: o,
        reason: String(t || "detached")
      }));
    }), t.once("destroyed", () => {
      this.states.get(n) === s && (this.states.delete(n), this.releaseState(s, "webcontents-destroyed"));
    }), s;
  }
  requireState(e = {}) {
    const t = String(e.accountId || ""),
      n = this.states.get(t);
    if (!n || n.closed || n.contents?.isDestroyed?.()) throw new Error(`\u8d26\u53f7\u201c${t}\u201d\u7684 WebView \u8c03\u8bd5\u76ee\u6807\u4e0d\u5b58\u5728`);
    if (e.webContentsId && Number(e.webContentsId) !== n.webContentsId) throw new Error(`\u8d26\u53f7\u201c${t}\u201d\u7684 WebView \u5df2\u88ab\u66ff\u6362`);
    return n;
  }
  requireOwner(e = {}) {
    const t = this.requireState(e),
      n = String(e.ownerToken || "");
    if (!n || n !== t.ownerToken) throw new Error(`\u8d26\u53f7\u201c${t.accountId}\u201d\u7684\u8c03\u8bd5\u4f1a\u8bdd\u5df2\u5931\u6548`);
    return t;
  }
  async attach(t = {}) {
    const n = this.requireState(t);
    return n.attached && n.contents.debugger.isAttached() || (n.contents.debugger.isAttached() || n.contents.debugger.attach("1.3"), n.attached = !0), n.ownerToken = String(t.ownerToken || e.randomUUID()), this.log("webview-debugger-attached", {
      accountId: n.accountId,
      webContentsId: n.webContentsId,
      transport: "webcontents-debugger-ipc"
    }), {
      ok: !0,
      accountId: n.accountId,
      webContentsId: n.webContentsId,
      ownerToken: n.ownerToken,
      cursor: n.nextCursor - 1,
      transport: "webcontents-debugger-ipc"
    };
  }
  async send(e = {}) {
    const n = this.requireOwner(e);
    if (!n.attached || !n.contents.debugger.isAttached()) throw new Error(`\u8d26\u53f7\u201c${n.accountId}\u201d\u7684\u5185\u90e8\u8c03\u8bd5\u8fde\u63a5\u5df2\u65ad\u5f00`);
    const o = String(e.method || ""),
      r = e.params && "object" == typeof e.params ? e.params : {};
    if ("Page.reload" === o) {
      if (r.ignoreCache && "function" == typeof n.contents.reloadIgnoringCache) n.contents.reloadIgnoringCache();else {
        if ("function" != typeof n.contents.reload) throw new Error(`\u8d26\u53f7\u201c${n.accountId}\u201d\u4e0d\u652f\u6301\u72ec\u7acb\u5237\u65b0`);
        n.contents.reload();
      }
      return this.log("webview-native-reload", {
        accountId: n.accountId,
        webContentsId: n.webContentsId,
        ignoreCache: Boolean(r.ignoreCache)
      }), {};
    }
    let s = null;
    const c = t(e.commandTimeoutMs, this.commandTimeoutMs, 10, 12e4);
    try {
      return await Promise.race([n.contents.debugger.sendCommand(o, r), new Promise((e, t) => {
        s = setTimeout(() => {
          const e = new Error(`CDP ${o} command timed out (${c}ms)`);
          e.code = "CDP_COMMAND_TIMEOUT", this.log("webview-debugger-command-timeout", {
            accountId: n.accountId,
            webContentsId: n.webContentsId,
            method: o,
            timeoutMs: c
          }), t(e);
        }, c);
      })]);
    } finally {
      s && clearTimeout(s);
    }
  }
  eventsAfter(e, t, n) {
    return e.events.filter(e => e.cursor > t).slice(0, n);
  }
  async poll(e = {}) {
    const n = this.requireOwner(e),
      o = Math.max(0, Number(e.cursor || 0)),
      r = t(e.maxEvents, 250, 1, 1e3),
      s = t(e.waitMs, 500, 0, 1e3);
    let c = this.eventsAfter(n, o, r);
    if (!c.length && s > 0 && !n.closed) {
      if (await new Promise(e => {
        const t = setTimeout(() => {
            n.waiters.delete(o), e();
          }, s),
          o = () => {
            clearTimeout(t), n.waiters.delete(o), e();
          };
        n.waiters.add(o);
      }), n.closed) throw new Error(`\u8d26\u53f7\u201c${n.accountId}\u201d\u7684 WebView \u5df2\u5173\u95ed`);
      c = this.eventsAfter(n, o, r);
    }
    return {
      ok: !0,
      accountId: n.accountId,
      webContentsId: n.webContentsId,
      cursor: c.length ? c[c.length - 1].cursor : o,
      events: c
    };
  }
  async detach(e = {}) {
    const t = this.requireState(e),
      n = String(e.ownerToken || "");
    return t.ownerToken && n && n !== t.ownerToken ? {
      ok: !0,
      detached: !1,
      reason: "owner-replaced"
    } : (t.ownerToken = "", t.attached && t.contents.debugger.isAttached() && t.contents.debugger.detach(), t.attached = !1, {
      ok: !0,
      detached: !0
    });
  }
}
module.exports = {
  WebviewDebuggerBroker: n
};
