"use strict";

const o = "https://www.dola.com/chat/";
function t(o) {
  try {
    const t = new URL(String(o || "").trim());
    return ["http:", "https:"].includes(t.protocol) ? t : null;
  } catch {
    return null;
  }
}
function n(o) {
  const n = t(o);
  if (!n) return !1;
  const e = n.hostname.toLowerCase();
  return "dola.com" === e || e.endsWith(".dola.com");
}
function e(o) {
  const e = t(o);
  return Boolean(e && n(e.toString()) && /^\/chat\/?$/i.test(e.pathname));
}
function r(o) {
  const e = t(o);
  return Boolean(e && n(e.toString()) && /^\/passport\/web\/web_login_success\/?$/i.test(e.pathname));
}
function s(o) {
  const t = o?.data;
  return Boolean("error" === o?.message && "account_info_error" === t?.name && 13 === Number(t?.error_code) && 0 === Number(t?.user_id) && !String(t?.session_key || ""));
}
function a(o) {
  const e = t(o);
  return Boolean(e && n(e.toString()) && /^\/auth\/callback(?:\/|$)/i.test(e.pathname));
}
function c(o) {
  const e = t(o);
  if (!e) return !1;
  const r = e.hostname.toLowerCase();
  return !!n(e.toString()) || "accounts.google.com" === r || r.endsWith(".accounts.google.com") || "login.microsoftonline.com" === r || r.endsWith(".login.microsoftonline.com") || "appleid.apple.com" === r || r.endsWith(".appleid.apple.com") || "open.weixin.qq.com" === r || "graph.qq.com" === r || /(?:^|[./_-])(?:oauth|authorize|signin|login)(?:[./?_-]|$)/i.test(`${r}${e.pathname}`);
}
function i(o, e = !1) {
  const r = t(o);
  return !(!r || !n(r.toString())) && (!!/^(?:1|true|yes)$/i.test(r.searchParams.get("login_success") || "") || !!e && !("1" === r.searchParams.get("from_login")) && /^\/chat(?:\/|$)/i.test(r.pathname));
}
function l(o, t) {
  return Boolean(n(o) && !n(t) && c(t));
}
module.exports = {
  DOLA_CHAT_URL: o,
  isAuthPopupUrl: c,
  isDolaBrowserLoginSuccessUrl: r,
  isDolaAuthCallbackUrl: a,
  isDolaChatUrl: e,
  isDolaLoginCompletionUrl: i,
  isDolaUnauthenticatedAccountInfo: s,
  isDolaUrl: n,
  shouldOpenDolaAuthPopup: l
};
