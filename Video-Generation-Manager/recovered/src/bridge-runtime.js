"use strict";

const e = require("node:fs"),
  r = require("node:path"),
  n = require("node:crypto"),
  {
    spawn: t
  } = require("node:child_process"),
  o = process.versions.electron ? require("original-fs") : e,
  i = "bridge-token-v1",
  c = "bridge-start.lock",
  s = e => /^[A-Za-z0-9_-]{43,128}$/.test(e) && Buffer.from(e, "base64url").length >= 32,
  a = e => n.createHash("sha256").update(o.readFileSync(e)).digest("hex").toUpperCase();
function l(n, t, o) {
  const i = JSON.parse(e.readFileSync(r.join(n, "manifest.json"), "utf8"));
  if ("dbm-canvas-bridge-v1" !== i.format || i.buildId !== t.buildId || i.version !== t.version) throw new Error("\u89c6\u9891\u670d\u52a1\u4e0e\u7ba1\u7406\u5668\u6784\u5efa\u7248\u672c\u4e0d\u4e00\u81f4\uff0c\u8bf7\u91cd\u65b0\u5b89\u88c5\u5b8c\u6574\u7248\u672c");
  for (const [e, t] of Object.entries(i.files || {})) if (!e || e.includes("..") || e.includes("\\") || r.isAbsolute(e) || !/^[A-F0-9]{64}$/.test(t) || a(r.join(n, e)) !== t) throw new Error("\u5185\u7f6e\u89c6\u9891\u670d\u52a1\u6587\u4ef6\u6821\u9a8c\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u5b89\u88c5\u5b8c\u6574\u7248\u672c");
  for (const e of ["node.exe", "node-license.txt", "bridge/bridge.js", "bridge/bridge-core.bin", "bridge/license-protocol.js"]) if (!Object.hasOwn(i.files || {}, e)) throw new Error("\u5185\u7f6e\u89c6\u9891\u670d\u52a1\u6587\u4ef6\u4e0d\u5b8c\u6574");
  if (o && (a(o) !== i.managerExecutableSha256 || a(r.join(r.dirname(o), "resources", "app.asar")) !== i.managerAppAsarSha256)) throw new Error("\u5185\u7f6e\u89c6\u9891\u670d\u52a1\u7ed1\u5b9a\u7684\u7ba1\u7406\u5668\u6587\u4ef6\u4e0d\u4e00\u81f4");
  return i;
}
function u({
  getDirectory: o,
  getBundleDirectory: a,
  getBuildInfo: u,
  getManagerExe: d,
  fetchRequest: f = globalThis.fetch,
  spawnProcess: w = t,
  verifyBundle: y = l,
  now: h = () => Date.now(),
  wait: E = e => new Promise(r => setTimeout(r, e)),
  env: g = process.env
}) {
  let S = null,
    p = null,
    _ = !1,
    b = "";
  const O = () => r.resolve(o());
  function m() {
    return e.readFileSync(r.join(O(), i), "utf8").trim();
  }
  async function v(e, r = "GET", n) {
    return f("http://127.0.0.1:17777" + e, {
      method: r,
      headers: {
        "X-Bridge-Token": b,
        "Content-Type": "application/json"
      },
      body: void 0 === n ? void 0 : JSON.stringify(n),
      signal: AbortSignal.timeout(2500)
    });
  }
  async function T() {
    let e, n;
    try {
      e = await v("/health");
    } catch (e) {
      if ("ECONNREFUSED" === (e.cause?.code || e.code)) return null;
      throw new Error("\u672c\u5730\u89c6\u9891\u670d\u52a1\u6ca1\u6709\u54cd\u5e94\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5");
    }
    if (401 === e.status) throw new Error("\u672c\u5730\u89c6\u9891\u670d\u52a1\u4ee4\u724c\u4e0d\u4e00\u81f4\uff0c\u8bf7\u68c0\u67e5\u5df2\u8fd0\u884c\u7684\u6865\u63a5");
    if (!e.ok) throw new Error("\u672c\u5730\u89c6\u9891\u670d\u52a1\u7aef\u53e3\u88ab\u5360\u7528\u6216\u670d\u52a1\u5f02\u5e38\uff0c\u8bf7\u68c0\u67e5\u5df2\u8fd0\u884c\u7684\u6865\u63a5");
    try {
      n = await e.json();
    } catch {
      throw new Error("\u672c\u5730\u89c6\u9891\u670d\u52a1\u7aef\u53e3\u88ab\u5176\u4ed6\u7a0b\u5e8f\u5360\u7528");
    }
    if (!function (e) {
      const n = u();
      return e?.ok && e.version === n.version && e.manager_build_id === n.buildId && r.resolve(e.dola_exe || "").toLowerCase() === r.resolve(d()).toLowerCase();
    }(n)) throw new Error("\u5df2\u8fd0\u884c\u7684\u89c6\u9891\u670d\u52a1\u4e0e\u5f53\u524d\u7ba1\u7406\u5668\u4e0d\u4e00\u81f4\uff0c\u8bf7\u6210\u5bf9\u66f4\u65b0\u5e76\u68c0\u67e5\u8fd0\u884c\u8def\u5f84");
    return n;
  }
  return {
    ensure: function () {
      return S || (S = async function () {
        b = await async function () {
          try {
            e.mkdirSync(O(), {
              recursive: !0
            });
            for (let t = 0; t < 40; t++) {
              try {
                const n = m();
                if (s(n)) return n;
                if (h() - e.statSync(r.join(O(), i)).mtimeMs < 5e3) {
                  await E(50);
                  continue;
                }
                throw new Error("\u672c\u5730\u89c6\u9891\u670d\u52a1\u4ee4\u724c\u65e0\u6548\uff0c\u8bf7\u68c0\u67e5\u8fd0\u884c\u76ee\u5f55");
              } catch (e) {
                if ("ENOENT" !== e.code) throw e;
              }
              const t = n.randomBytes(48).toString("base64url");
              let o;
              try {
                o = e.openSync(r.join(O(), i), "wx", 384);
              } catch (e) {
                if ("EEXIST" === e.code) {
                  await E(50);
                  continue;
                }
                throw e;
              }
              try {
                e.writeFileSync(o, t + "\n"), e.fsyncSync(o);
              } finally {
                e.closeSync(o);
              }
              return t;
            }
            throw new Error("\u672c\u5730\u89c6\u9891\u670d\u52a1\u4ee4\u724c\u6b63\u5728\u521d\u59cb\u5316\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5");
          } catch (e) {
            if (e.code) throw new Error("\u65e0\u6cd5\u5efa\u7acb\u672c\u5730\u89c6\u9891\u670d\u52a1\u8fd0\u884c\u76ee\u5f55\uff0c\u8bf7\u68c0\u67e5\u5199\u5165\u6743\u9650");
            throw e;
          }
        }();
        const t = await T();
        if (t) return _ = !0, t;
        const o = await async function () {
          const n = r.join(O(), c),
            t = h() + 25e3;
          for (; h() < t;) {
            try {
              const r = e.openSync(n, "wx", 384);
              try {
                e.writeFileSync(r, String(process.pid) + "\n"), e.fsyncSync(r);
              } finally {
                e.closeSync(r);
              }
              return {
                file: n
              };
            } catch (e) {
              if ("EEXIST" !== e.code) throw new Error("\u65e0\u6cd5\u5efa\u7acb\u672c\u5730\u89c6\u9891\u670d\u52a1\u542f\u52a8\u9501\uff0c\u8bf7\u68c0\u67e5\u5199\u5165\u6743\u9650");
            }
            const r = await T();
            if (r) return {
              live: r
            };
            try {
              const r = Number(e.readFileSync(n, "utf8").trim());
              let t = !1;
              if (Number.isSafeInteger(r) && r > 0) try {
                process.kill(r, 0);
              } catch (e) {
                t = "ESRCH" === e.code;
              }
              if (t && h() - e.statSync(n).mtimeMs > 3e4) {
                e.unlinkSync(n);
                continue;
              }
            } catch (e) {
              if ("ENOENT" !== e.code) throw new Error("\u65e0\u6cd5\u8bfb\u53d6\u672c\u5730\u89c6\u9891\u670d\u52a1\u542f\u52a8\u9501");
            }
            await E(100);
          }
          throw new Error("\u7b49\u5f85\u672c\u5730\u89c6\u9891\u670d\u52a1\u542f\u52a8\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5");
        }();
        if (o.live) return _ = !0, o.live;
        try {
          const n = await T();
          if (n) return _ = !0, n;
          const t = a();
          try {
            y(t, u(), d());
          } catch (e) {
            throw new Error("ENOENT" === e.code ? "\u5185\u7f6e\u89c6\u9891\u670d\u52a1\u6587\u4ef6\u7f3a\u5931\uff0c\u8bf7\u91cd\u65b0\u5b89\u88c5\u5b8c\u6574\u7ba1\u7406\u5668" : "\u5185\u7f6e\u89c6\u9891\u670d\u52a1\u6821\u9a8c\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u5b89\u88c5\u5b8c\u6574\u7ba1\u7406\u5668");
          }
          const o = {
            ...g,
            ZZ_DOUBAO_DOLA_EXE: d(),
            ZZ_DOUBAO_BRIDGE_PORT: "17777",
            ZZ_DOUBAO_BRIDGE_TOKEN: b,
            ZZ_DOUBAO_BRIDGE_DATA_DIR: O()
          };
          for (const e of ["ELECTRON_RUN_AS_NODE", "DBM_ALLOW_MULTI_INSTANCE", "DBM_AUTOMATION_PIPE_NAME", "DBM_AUTOMATION_PIPE_TOKEN"]) delete o[e];
          const i = e.openSync(r.join(O(), "bridge-launch.log"), "a");
          let c;
          try {
            c = w(r.join(t, "node.exe"), [r.join(t, "bridge", "bridge.js")], {
              cwd: t,
              env: o,
              windowsHide: !0,
              stdio: ["ignore", i, i]
            });
          } finally {
            e.closeSync(i);
          }
          let s = !1;
          c.once("error", () => {
            s = !0;
          }), c.once("exit", () => {
            p === c && (p = null);
          }), p = c, _ = !0, c.unref?.();
          const l = h() + 2e4;
          for (; h() < l;) {
            if (s || null !== c.exitCode) throw new Error("\u5185\u7f6e\u89c6\u9891\u670d\u52a1\u542f\u52a8\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u670d\u52a1\u65e5\u5fd7\u540e\u91cd\u8bd5");
            const e = await T();
            if (e) return _ = !0, e;
            await E(100);
          }
          throw new Error("\u5185\u7f6e\u89c6\u9891\u670d\u52a1\u542f\u52a8\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5");
        } finally {
          e.existsSync(o.file) && e.readFileSync(o.file, "utf8").trim() === String(process.pid) && e.unlinkSync(o.file);
        }
      }().finally(() => {
        S = null;
      })), S;
    },
    readToken: m,
    prepareQuit: async function () {
      if (S && (await S), !_) return !0;
      const e = await T();
      if (!e) return _ = !1, !0;
      if (0 !== e.active_workers || 0 !== e.queued_tasks) return !1;
      if (p && e.bridge_pid === p.pid) {
        const e = await v("/shutdown-if-idle", "POST", {
          bridge_pid: p.pid
        });
        if (409 === e.status) return !1;
        if (!e.ok) throw new Error("\u672c\u5730\u89c6\u9891\u670d\u52a1\u6682\u65f6\u65e0\u6cd5\u9000\u51fa\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5");
        const r = p,
          n = h() + 8e3;
        for (; r && null === r.exitCode && h() < n;) await E(100);
        if (null === r?.exitCode) throw new Error("\u672c\u5730\u89c6\u9891\u670d\u52a1\u4ecd\u5728\u9000\u51fa\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5");
      }
      return _ = !1, !0;
    },
    get engaged() {
      return _ || Boolean(S);
    }
  };
}
module.exports = {
  createBridgeRuntime: u,
  verifyBridgeBundle: l,
  validToken: s,
  hashFile: a
};
