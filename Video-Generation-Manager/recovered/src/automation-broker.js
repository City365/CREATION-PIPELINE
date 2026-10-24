"use strict";

const e = require("node:crypto"),
  r = require("node:net"),
  t = 1048576,
  n = Object.freeze({
    "debugger-attach": "attach",
    "debugger-send": "send",
    "debugger-poll": "poll",
    "debugger-detach": "detach"
  });
function o(e) {
  return `\\\\.\\pipe\\${String(e || "")}`;
}
function i(e) {
  return Boolean(e && /^dbm-[A-Za-z0-9_-]{24,120}$/.test(String(e.pipeName || "")) && /^[A-Za-z0-9_-]{43,128}$/.test(String(e.token || "")) && Buffer.from(String(e.token), "base64url").length >= 32 && Buffer.from(String(e.token), "base64url").toString("base64url") === String(e.token));
}
function s(r, t) {
  const n = Buffer.from(String(r || ""), "utf8"),
    o = Buffer.from(String(t || ""), "utf8");
  return n.length === o.length && n.length > 0 && e.timingSafeEqual(n, o);
}
function a({
  pipeName: e,
  token: a,
  evaluate: c,
  setAccountCooldown: u,
  debuggerBroker: g,
  metadata: d = () => ({})
}) {
  const f = {
    pipeName: String(e || ""),
    token: String(a || "")
  };
  if (!i(f)) throw new Error("\u7ba1\u7406\u5668\u81ea\u52a8\u5316\u7ba1\u9053\u914d\u7f6e\u65e0\u6548");
  if ("function" != typeof c) throw new Error("\u7ba1\u7406\u5668\u81ea\u52a8\u5316\u6267\u884c\u5668\u7f3a\u5931");
  const l = new Set();
  let m = !1;
  const S = r.createServer(e => {
    l.add(e), e.setEncoding("utf8");
    let r = "",
      o = !1;
    function i(r) {
      o || (o = !0, e.end(`${JSON.stringify(r)}\n`));
    }
    e.on("data", e => {
      if (o) return;
      if (r += e, Buffer.byteLength(r, "utf8") > t) return void i({
        ok: !1,
        error: "REQUEST_TOO_LARGE",
        message: "\u81ea\u52a8\u5316\u8bf7\u6c42\u4f53\u8fc7\u5927"
      });
      const a = r.indexOf("\n");
      if (a < 0) return;
      let l;
      try {
        l = JSON.parse(r.slice(0, a));
      } catch {
        return void i({
          ok: !1,
          error: "INVALID_JSON",
          message: "\u81ea\u52a8\u5316\u8bf7\u6c42\u683c\u5f0f\u65e0\u6548"
        });
      }
      const m = String(l?.id || "").slice(0, 128);
      if (!s(l?.token, f.token)) return void i({
        id: m,
        ok: !1,
        error: "UNAUTHORIZED",
        message: "\u81ea\u52a8\u5316\u4ee4\u724c\u65e0\u6548"
      });
      const S = String(l?.action || "");
      if ("ping" === S) return void Promise.resolve(d()).then(e => {
        i({
          id: m,
          ok: !0,
          result: {
            pid: process.pid,
            ...(e || {})
          }
        });
      }).catch(e => {
        i({
          id: m,
          ok: !1,
          error: "BROKER_ERROR",
          message: String(e?.message || e)
        });
      });
      if ("set-account-cooldown" === S) {
        const e = String(l?.accountId || "").trim(),
          r = !1 !== l?.active,
          t = Number(l?.until || 0),
          n = String(l?.reason || "");
        return "function" != typeof u || !e || e.length > 200 || r && (!Number.isFinite(t) || t <= 0 || n.length > 100) ? void i({
          id: m,
          ok: !1,
          error: "INVALID_REQUEST",
          message: "\u8d26\u53f7\u51b7\u5374\u6807\u8bb0\u53c2\u6570\u65e0\u6548"
        }) : void Promise.resolve().then(() => u({
          accountId: e,
          active: r,
          until: t,
          reason: n
        })).then(e => {
          i({
            id: m,
            ok: !0,
            result: e
          });
        }).catch(e => {
          i({
            id: m,
            ok: !1,
            error: String(e?.code || "ACCOUNT_COOLDOWN_FAILED"),
            message: String(e?.message || e)
          });
        });
      }
      const p = n[S];
      if (p) {
        const e = l?.input;
        return g && "function" == typeof g[p] && e && "object" == typeof e && !Array.isArray(e) ? void Promise.resolve().then(() => g[p](e)).then(e => {
          i({
            id: m,
            ok: !0,
            result: e
          });
        }).catch(e => {
          i({
            id: m,
            ok: !1,
            error: String(e?.code || "DEBUGGER_FAILED"),
            message: String(e?.message || e)
          });
        }) : void i({
          id: m,
          ok: !1,
          error: "INVALID_REQUEST",
          message: "\u7ba1\u7406\u5668\u8c03\u8bd5\u8bf7\u6c42\u53c2\u6570\u65e0\u6548"
        });
      }
      if ("evaluate" !== S) return void i({
        id: m,
        ok: !1,
        error: "ACTION_FORBIDDEN",
        message: "\u81ea\u52a8\u5316\u64cd\u4f5c\u4e0d\u53d7\u652f\u6301"
      });
      const h = String(l?.expression || ""),
        k = String(l?.target || "main");
      !h || h.length > 524288 || !["main", "license"].includes(k) ? i({
        id: m,
        ok: !1,
        error: "INVALID_REQUEST",
        message: "\u81ea\u52a8\u5316\u6267\u884c\u53c2\u6570\u65e0\u6548"
      }) : Promise.resolve(c({
        expression: h,
        target: k
      })).then(e => {
        i({
          id: m,
          ok: !0,
          result: e
        });
      }).catch(e => {
        i({
          id: m,
          ok: !1,
          error: "EVALUATION_FAILED",
          message: String(e?.message || e)
        });
      });
    }), e.on("error", () => {}), e.on("close", () => l.delete(e));
  });
  return {
    close: function () {
      for (const e of l) e.destroy();
      return l.clear(), m ? new Promise(e => S.close(() => {
        m = !1, e();
      })) : Promise.resolve();
    },
    listen: function () {
      return m ? Promise.resolve() : new Promise((e, r) => {
        const t = e => {
            S.off("listening", n), r(e);
          },
          n = () => {
            S.off("error", t), m = !0, e();
          };
        S.once("error", t), S.once("listening", n), S.listen(o(f.pipeName));
      });
    },
    pipeName: f.pipeName
  };
}
module.exports = {
  createAutomationBroker: a,
  isValidAutomationRequest: i,
  managerPipePath: o
};
