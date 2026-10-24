"use strict";

const e = require("node:fs"),
  t = require("node:path"),
  r = require("node:crypto"),
  {
    pathToFileURL: a
  } = require("node:url"),
  {
    validateCanvas: n,
    emptyCanvas: o
  } = require("../renderer/canvas-model");
function i({
  getBridgeDirectory: i,
  getBuildInfo: s,
  getManagerExe: c,
  getAccounts: u,
  approveReference: d,
  ensureBridge: l = async () => {},
  fetchRequest: g = globalThis.fetch,
  readToken: f = () => e.readFileSync(t.join(i(), "bridge-token-v1"), "utf8").trim()
}) {
  let h = null;
  const w = new Map(),
    m = e => r.createHash("sha256").update(JSON.stringify([e.canvasId, e.nodeId])).digest("hex");
  function p(e) {
    for (const t of ["canvasId", "nodeId", "requestId"]) if ("string" != typeof e?.[t] || !e[t] || e[t].length > 80) throw new Error("\u753b\u5e03\u4efb\u52a1\u6807\u8bc6\u65e0\u6548");
  }
  async function _(e, t = "GET", r, a = !1) {
    let n;
    try {
      n = f();
    } catch {
      throw new Error("\u65e0\u6cd5\u8bfb\u53d6\u672c\u5730\u89c6\u9891\u670d\u52a1\u4ee4\u724c\uff0c\u8bf7\u68c0\u67e5\u8fd0\u884c\u76ee\u5f55\u6743\u9650\u540e\u91cd\u8bd5");
    }
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(n)) throw new Error("\u672c\u5730\u89c6\u9891\u670d\u52a1\u4ee4\u724c\u65e0\u6548\uff0c\u8bf7\u68c0\u67e5\u8fd0\u884c\u76ee\u5f55");
    const o = {
      "X-Bridge-Token": n,
      "Content-Type": "application/json"
    };
    let i, s;
    a && (o["X-Plugin-License-Token"] = (await y()).token);
    try {
      i = await g("http://127.0.0.1:17777" + e, {
        method: t,
        headers: o,
        body: void 0 === r ? void 0 : JSON.stringify(r),
        signal: AbortSignal.timeout(45e3)
      });
    } catch {
      throw Object.assign(new Error("POST" === t && "/v1/video/generations" === e ? "\u4efb\u52a1\u63d0\u4ea4\u7ed3\u679c\u672a\u786e\u8ba4\uff0c\u8bf7\u52ff\u91cd\u590d\u521b\u5efa\u65b0\u4efb\u52a1" : "\u672c\u5730\u89c6\u9891\u670d\u52a1\u8fde\u63a5\u4e2d\u65ad\uff0c\u8bf7\u91cd\u8bd5"), {
        uncertain: "POST" === t && "/v1/video/generations" === e
      });
    }
    try {
      s = await i.json();
    } catch {
      throw Object.assign(new Error("\u6865\u63a5\u54cd\u5e94\u65e0\u6cd5\u786e\u8ba4\uff0c\u8bf7\u68c0\u67e5\u73b0\u6709\u4efb\u52a1"), {
        uncertain: "POST" === t && "/v1/video/generations" === e
      });
    }
    if (!i.ok) throw Object.assign(new Error(String(s.message || s.error || "\u6865\u63a5 HTTP " + i.status).slice(0, 300)), {
      uncertain: "POST" === t && "/v1/video/generations" === e && i.status >= 500
    });
    return s;
  }
  async function v() {
    await l();
    const e = await _("/health");
    if (!e.ok || e.manager_build_id !== s().buildId || t.resolve(e.dola_exe || "") !== t.resolve(c())) throw new Error("\u7ba1\u7406\u5668\u4e0e\u63d2\u4ef6\u6784\u5efa\u7248\u672c\u4e0d\u4e00\u81f4\uff0c\u8bf7\u6210\u5bf9\u66f4\u65b0");
    return e;
  }
  async function y() {
    if (h && h.expiresAt > Date.now() + 3e4) return h;
    const e = await _("/v1/license/session", "POST", {});
    if (!e.active || e.manager_build_id !== s().buildId || !e.authorization_token) throw new Error("\u7ba1\u7406\u5668\u6388\u6743\u4f1a\u8bdd\u65e0\u6548\u6216\u6784\u5efa\u4e0d\u5339\u914d");
    return h = {
      token: e.authorization_token,
      expiresAt: Date.parse(e.authorization_expires_at) || Date.now() + 48e4
    }, h;
  }
  async function b(e) {
    if (p(e), !/^[0-9a-f-]{36}$/i.test(e.taskId || "")) throw new Error("\u753b\u5e03\u4efb\u52a1\u7f16\u53f7\u65e0\u6548");
    await v();
    const t = await _("/v1/video/generations/" + e.taskId, "GET", void 0, !0);
    if ("manager-canvas" !== t.host_session_id || t.host_task_group_id !== m(e)) throw new Error("\u8be5\u4efb\u52a1\u4e0d\u5c5e\u4e8e\u5f53\u524d\u753b\u5e03\u8282\u70b9");
    return t;
  }
  return {
    context: async function () {
      const e = u().filter(e => ["doubao", "dola"].includes(e.platform)).map(e => ({
        id: e.id,
        name: e.name,
        platform: e.platform,
        group: e.group || ""
      }));
      try {
        const t = await v();
        return await y(), {
          accounts: e,
          ready: !0,
          capabilities: t.capabilities?.targets || {},
          message: ""
        };
      } catch (t) {
        return {
          accounts: e,
          ready: !1,
          capabilities: {},
          message: t.message
        };
      }
    },
    submit: function (e) {
      p(e);
      const t = m(e) + ":" + e.requestId;
      if (w.has(t)) return w.get(t);
      if (w.size >= 500) throw new Error("\u672c\u6b21\u4f1a\u8bdd\u7684\u753b\u5e03\u4efb\u52a1\u8fc7\u591a\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u7ba1\u7406\u5668");
      const a = async function (e) {
        const t = n({
          ...o("validate", "\u751f\u6210\u914d\u7f6e"),
          nodes: [{
            id: "config",
            type: "config",
            title: "\u751f\u6210\u914d\u7f6e",
            x: 0,
            y: 0,
            width: 320,
            height: 360,
            config: e
          }]
        }).nodes[0].config;
        if (!t.prompt.trim() || t.prompt.length > 1e4) throw new Error("\u8bf7\u586b\u5199\u63d0\u793a\u8bcd");
        if (t.accountId && !u().some(e => e.id === t.accountId && e.platform === t.platform)) throw new Error("\u6240\u9009\u8d26\u53f7\u4e0d\u5b58\u5728\u6216\u5e73\u53f0\u4e0d\u4e00\u81f4");
        if (!Array.isArray(e.references) || e.references.length > 9) throw new Error("\u53c2\u8003\u56fe\u6700\u591a 9 \u5f20");
        const a = [];
        for (const t of e.references) a.push(await d(t));
        const i = await v(),
          s = i.capabilities?.targets?.[t.platform];
        if (!s?.models?.includes(t.model) || !s.durations?.includes(t.duration) || !s.ratios?.includes(t.ratio)) throw new Error("\u73b0\u6709\u63d2\u4ef6\u4e0d\u652f\u6301\u8be5\u6a21\u578b\u3001\u65f6\u957f\u6216\u6bd4\u4f8b");
        if (!Number.isInteger(i.max_concurrency) || i.max_concurrency < 1 || i.max_concurrency > 6) throw new Error("\u73b0\u6709\u5e76\u53d1\u8bbe\u7f6e\u65e0\u6548");
        const c = await _("/v1/video/generations", "POST", {
          prompt: t.prompt,
          image_paths: a,
          image_path: a[0] || "",
          model: t.model,
          duration: t.duration,
          ratio: t.ratio,
          target_platform: t.platform,
          account_id: t.accountId,
          remove_watermark: !0,
          timeout: 9999,
          verification_timeout: 600,
          max_concurrency: i.max_concurrency,
          host_session_id: "manager-canvas",
          host_task_group_id: m(e),
          client_request_id: r.createHash("sha256").update(m(e) + ":" + e.requestId).digest("hex").slice(0, 32)
        }, !0);
        if (!/^[0-9a-f-]{36}$/i.test(c.id || "")) throw Object.assign(new Error("\u6865\u63a5\u672a\u8fd4\u56de\u6709\u6548\u4efb\u52a1\u7f16\u53f7\uff0c\u8bf7\u68c0\u67e5\u73b0\u6709\u4efb\u52a1"), {
          uncertain: !0
        });
        return {
          id: c.id,
          status: c.status
        };
      }(e).catch(e => {
        if (e.uncertain) return {
          uncertain: !0,
          message: e.message
        };
        throw w.delete(t), e;
      });
      return w.set(t, a), a;
    },
    status: async function (e) {
      const t = await b(e);
      let r = "";
      return "succeeded" === t.status && t.result?.file_path ? r = a(t.result.file_path).href : "succeeded" === t.status && /^https?:\/\//i.test(t.result?.video_url || "") && (r = t.result.video_url), {
        id: t.id,
        status: t.status,
        stage: t.stage || "",
        progress: t.progress || 0,
        message: String(t.message || t.error?.message || "").slice(0, 500),
        resultUrl: r
      };
    },
    cancel: async function (e) {
      await b(e);
      const t = await _("/v1/video/generations/" + e.taskId + "/cancel", "POST", {
        reason: "\u7528\u6237\u53d6\u6d88\u5f53\u524d\u753b\u5e03\u8282\u70b9\u4efb\u52a1"
      }, !0);
      return {
        cancelled: !!t.cancelled,
        alreadySubmitted: !!t.already_submitted
      };
    }
  };
}
module.exports = {
  createCanvasGeneration: i
};
