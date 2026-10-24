"use strict";

const s = "fangyue-cookie-export",
  t = 1,
  e = "fangyue-cookie-export",
  o = new Set(["passport_csrf_token", "passport_csrf_token_wap_state", "passport_auth_status_ss", "passport_mfa_token", "uid_tt_ss", "sessionid_ss", "sid_ucp_v1", "ssid_ucp_v1"]),
  n = new Set(["passport_csrf_token_wap_state", "odin_tt", "passport_auth_status", "passport_auth_status_ss", "passport_mfa_token", "d_ticket", "sid_guard", "uid_tt", "uid_tt_ss", "sid_tt", "sessionid", "sessionid_ss", "has_biz_token", "sid_ucp_v1", "ssid_ucp_v1", "store-idc", "store-country-code", "store-country-code-src"]);
function i(s) {
  const t = String(s || "").trim().toLowerCase().replace(/-/g, "_");
  return "none" === t ? "no_restriction" : ["unspecified", "no_restriction", "lax", "strict"].includes(t) ? t : "";
}
function r(s) {
  return "dola" === String(s?.instanceKind || "").trim().toLowerCase() && Array.isArray(s?.cookies) && s.cookies.length > 0 && s.cookies.every(s => !0 === s?.isSession && !0 !== s?.isSecure && !0 !== s?.isHttpOnly && !String(s?.expiresUtc || "").trim());
}
function a(s) {
  const t = Array.isArray(s) ? s.find(s => "sid_guard" === String(s?.name || "")) : null;
  if (!t?.value) return null;
  try {
    const s = decodeURIComponent(String(t.value)).split("|"),
      e = Number(s[1]),
      o = Number(s[2]);
    return !Number.isFinite(e) || !Number.isFinite(o) || e <= 0 || o <= 0 || o > 31622400 ? null : e + o;
  } catch {
    return null;
  }
}
function c(s, t = {}) {
  const e = String(s?.name || ""),
    r = !0 === t.repairDolaMetadata;
  let a = String(s?.domain || ""),
    c = Boolean(s?.hostOnly);
  r && "msToken" === e && /^\.?dola\.com$/i.test(a) && (a = "www.dola.com", c = !0);
  const u = {
      name: e,
      value: String(s?.value || ""),
      domain: a,
      path: String(s?.path || "/"),
      secure: r ? o.has(e) : Boolean(s?.isSecure),
      httpOnly: r ? n.has(e) : Boolean(s?.isHttpOnly),
      hostOnly: c
    },
    p = i(s?.sameSite);
  if (p && (u.sameSite = p), !s?.isSession && s?.expiresUtc) {
    const t = Date.parse(s.expiresUtc) / 1e3;
    Number.isFinite(t) && (u.expirationDate = t);
  } else r && Number.isFinite(t.expirationDate) && (u.expirationDate = t.expirationDate);
  return u;
}
function u() {
  return {
    sourceAccounts: [],
    sessionData: {},
    sourceFingerprints: {},
    backupVersion: 0
  };
}
function p(t) {
  if (t?.format !== s || 1 !== Number(t?.schemaVersion) || !Array.isArray(t?.cookies) || !String(t?.instanceKind || "").trim()) return null;
  const o = r(t),
    n = o ? a(t.cookies) : null;
  return {
    sourceAccounts: [{
      id: e,
      platform: String(t.instanceKind).trim(),
      name: String(t.instanceName || "").trim()
    }],
    sessionData: {
      [e]: {
        cookies: t.cookies.map(s => c(s, {
          repairDolaMetadata: o,
          expirationDate: n
        })),
        localStorage: []
      }
    },
    sourceFingerprints: {},
    backupVersion: 2
  };
}
function l(s) {
  const t = p(s);
  if (t) return t;
  const e = u();
  return e.sourceAccounts = Array.isArray(s) ? s : Array.isArray(s?.accounts) ? s.accounts : [], "doubao-manager-backup" === s?.format && s.version >= 2 && (e.sessionData = s.sessions || {}, e.backupVersion = s.version, s.version >= 3 && s.fingerprints && "object" == typeof s.fingerprints && (e.sourceFingerprints = s.fingerprints)), e;
}
function d(s) {
  const t = u();
  t.backupVersion = 2;
  const e = String(s || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const [s, o] of e.entries()) {
    const e = o.trim();
    if (!e) continue;
    const n = t => {
        throw new Error(`Dola TXT \u7b2c ${s + 1} \u884c\uff1a${t}`);
      },
      i = new Set(),
      r = [];
    for (const s of e.split(";")) {
      const t = s.trim();
      if (!t) continue;
      const e = t.indexOf("=");
      e <= 0 && n("Cookie \u683c\u5f0f\u9519\u8bef\uff0c\u5e94\u4e3a \u540d\u79f0=\u503c\uff0c\u4ee5\u5206\u53f7\u5206\u9694");
      const o = t.slice(0, e).trim(),
        a = t.slice(e + 1).trim();
      /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(o) && !/[\u0000-\u0020\u007f]/.test(a) || n("Cookie \u540d\u79f0\u6216\u503c\u683c\u5f0f\u9519\u8bef"), i.has(o) && n("\u5b58\u5728\u91cd\u590d\u7684 Cookie \u540d\u79f0"), i.add(o), r.push({
        name: o,
        value: a,
        domain: ".dola.com",
        path: "/",
        isSession: !0
      });
    }
    r.some(s => ["sessionid", "sessionid_ss"].includes(s.name) && s.value) || n("\u7f3a\u5c11\u975e\u7a7a\u7684 sessionid \u6216 sessionid_ss");
    const u = `dola-txt-line-${s + 1}`;
    t.sourceAccounts.push({
      id: u,
      platform: "dola",
      name: ""
    });
    const p = a(r);
    t.sessionData[u] = {
      cookies: r.map(s => c(s, {
        repairDolaMetadata: !0,
        expirationDate: p
      })),
      localStorage: []
    };
  }
  if (!t.sourceAccounts.length) throw new Error("TXT \u6587\u4ef6\u4e2d\u6ca1\u6709\u53ef\u5bfc\u5165\u7684 Dola Cookie \u8d26\u53f7");
  return t;
}
module.exports = {
  parseJsonAccountImport: l,
  parseDolaTextCookieImport: d
};
