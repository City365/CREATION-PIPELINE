"use strict";

const i = new Set(["clipboard-read", "clipboard-sanitized-write", "fullscreen", "media", "notifications"]),
  o = Object.freeze({
    dola: "dola.com",
    doubao: "doubao.com",
    jimeng: "jianying.com",
    kimi: "kimi.com",
    lovart: "lovart.ai",
    oiioii: "oiioii.ai",
    qianwen: "qianwen.com"
  });
function n(i) {
  try {
    const o = new URL(String(i || ""));
    return ["https:", "http:"].includes(o.protocol) ? o : null;
  } catch {
    return null;
  }
}
function t(i, o) {
  const n = String(i || "").toLowerCase(),
    t = String(o || "").toLowerCase();
  return Boolean(t && (n === t || n.endsWith(`.${t}`)));
}
function r(i, r) {
  const e = n(r),
    c = n(i?.url);
  if (!e || !c) return !1;
  const s = o[String(i?.platform || "")];
  return s ? "https:" === e.protocol && t(e.hostname, s) : e.origin === c.origin;
}
function e({
  account: o,
  permission: n,
  requestingUrl: t
}) {
  return i.has(String(n || "")) && r(o, t);
}
module.exports = {
  ALLOWED_WEB_PERMISSIONS: i,
  isAllowedWebPermission: e,
  isTrustedAccountOrigin: r
};
