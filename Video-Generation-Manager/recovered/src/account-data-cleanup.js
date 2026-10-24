"use strict";

const e = require("node:fs"),
  t = require("node:path"),
  {
    accountProfileSegment: r
  } = require("./dola-external-oauth"),
  o = "pending-account-data-deletions.json";
function n(e) {
  return String(e || "").replace(/[^A-Za-z0-9-]/g, "");
}
function a(e, r) {
  const o = t.relative(t.resolve(e), t.resolve(r));
  return Boolean(o && !o.startsWith("..") && !t.isAbsolute(o));
}
function s(e, o) {
  const a = t.resolve(e),
    s = n(o);
  return s ? [t.join(a, "Partitions", `account_${s}`), t.join(a, "Partitions", `doubao-manager-${s}`), t.join(a, "external-oauth", r(o))] : [];
}
function c(e) {
  return t.join(t.resolve(e), o);
}
function i(t, r = e) {
  try {
    const e = JSON.parse(r.readFileSync(c(t), "utf8"));
    return Array.isArray(e) ? e.map(String) : [];
  } catch {
    return [];
  }
}
function u(r, o, n = e) {
  const s = t.resolve(r),
    u = new Set(i(s, n));
  for (const e of o || []) {
    const r = t.resolve(String(e || ""));
    a(s, r) && u.add(r);
  }
  const l = [...u];
  return l.length && n.writeFileSync(c(s), JSON.stringify(l, null, 2), "utf8"), l;
}
function l(r, o = e) {
  const n = t.resolve(r),
    s = [],
    u = [];
  for (const e of i(n, o)) {
    const r = t.resolve(e);
    if (a(n, r)) try {
      o.existsSync(r) && o.rmSync(r, {
        recursive: !0,
        force: !0,
        maxRetries: 10,
        retryDelay: 100
      }), s.push(r);
    } catch {
      u.push(r);
    }
  }
  const l = c(n);
  if (u.length) o.writeFileSync(l, JSON.stringify(u, null, 2), "utf8");else try {
    o.rmSync(l, {
      force: !0
    });
  } catch {}
  return {
    removed: s,
    remaining: u
  };
}
async function f({
  accountId: r,
  dataDir: o,
  targetSession: n,
  webContents: c = [],
  fileSystem: i = e,
  wait: u = e => new Promise(t => setTimeout(t, e))
}) {
  const l = [];
  for (const e of c) try {
    e && !e.isDestroyed?.() && e.destroy();
  } catch (e) {
    l.push(`\u5173\u95ed\u8d26\u53f7\u9875\u9762\u5931\u8d25\uff1a${e.message || e}`);
  }
  const f = [["flushStorageData", () => n?.flushStorageData?.()], ["clearCache", () => n?.clearCache?.()], ["clearAuthCache", () => n?.clearAuthCache?.()], ["clearStorageData", () => n?.clearStorageData?.()], ["flushCookies", () => n?.cookies?.flushStore?.()], ["flushStorageData", () => n?.flushStorageData?.()]];
  let g = !1;
  for (const [e, t] of f) try {
    await t(), "clearStorageData" === e && (g = !0);
  } catch (t) {
    l.push(`${e}\uff1a${t.message || t}`);
  }
  await u(300);
  const d = [],
    h = [],
    y = t.resolve(o);
  for (const e of s(y, r)) if (a(y, e)) try {
    i.existsSync(e) && (i.rmSync(e, {
      recursive: !0,
      force: !0,
      maxRetries: 4,
      retryDelay: 100
    }), d.push(e));
  } catch (t) {
    h.push({
      directory: e,
      message: t.message || String(t)
    });
  } else h.push({
    directory: e,
    message: "\u76ee\u6807\u76ee\u5f55\u4e0d\u5728\u8d26\u53f7\u6570\u636e\u6839\u76ee\u5f55\u5185"
  });
  return {
    storageCleared: g,
    storageErrors: l,
    removedDirectories: d,
    failedDirectories: h
  };
}
async function g({
  accounts: e = [],
  accountIds: t = [],
  clearAccountData: r
}) {
  const o = new Set((Array.isArray(t) ? t : []).map(e => String(e || "")).filter(Boolean)),
    n = [],
    a = [],
    s = [];
  for (const t of e) {
    if (!o.has(String(t?.id || ""))) continue;
    let e;
    try {
      e = await r(t);
    } catch (t) {
      e = {
        storageCleared: !1,
        storageErrors: [t?.message || String(t)],
        removedDirectories: [],
        failedDirectories: []
      };
    }
    if (!0 === e?.storageCleared) {
      n.push({
        account: t,
        cleanup: e
      });
      for (const t of e.failedDirectories || []) t?.directory && s.push(t.directory);
    } else a.push({
      account: t,
      cleanup: e,
      message: e?.storageErrors?.[0] || "\u672a\u80fd\u6e05\u9664\u8d26\u53f7\u6d4f\u89c8\u5668\u6570\u636e"
    });
  }
  const c = new Set(n.map(e => String(e.account.id)));
  return {
    removedAccounts: n.map(e => e.account),
    remainingAccounts: e.filter(e => !c.has(String(e?.id || ""))),
    cleanups: n,
    failures: a,
    pendingDirectories: s,
    restartRequired: s.length > 0
  };
}
module.exports = {
  accountDataDirectories: s,
  clearAccountBrowserData: f,
  isPathInside: a,
  pendingDeletionFile: c,
  processPendingAccountDataDeletions: l,
  readPendingDeletions: i,
  removeAccountsWithData: g,
  schedulePendingAccountDataDeletion: u,
  safeAccountId: n
};
