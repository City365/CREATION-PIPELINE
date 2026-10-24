"use strict";

const n = "\u65e0\u7528\u8d26\u53f7 \u53ef\u5220\u9664",
  r = "\u989d\u5ea6\u7528\u5c3d",
  t = "NON_GENERATION_RESPONSE",
  o = "QUOTA_EXHAUSTED";
function e(e) {
  return e === t ? n : e === o ? r : "";
}
function c(n) {
  return String(n || "").trim().slice(0, 200);
}
function u(n, r = Date.now()) {
  const t = n && "object" == typeof n && !Array.isArray(n) ? n : {},
    o = {};
  for (const [n, u] of Object.entries(t)) {
    const t = c(u?.accountId || n),
      i = Number(u?.until || 0),
      a = String(u?.reason || ""),
      s = e(a);
    t && s && Number.isFinite(i) && !(i <= r) && (o[t] = {
      accountId: t,
      until: Math.trunc(i),
      reason: a,
      label: s
    });
  }
  return o;
}
function i(n, r, t = Date.now()) {
  const o = u(n, t),
    i = c(r?.accountId);
  if (!i) throw new Error("\u8d26\u53f7\u51b7\u5374\u6807\u8bb0\u7f3a\u5c11\u8d26\u53f7 ID");
  if (!1 === r?.active) return delete o[i], o;
  const a = Number(r?.until || 0),
    s = String(r?.reason || ""),
    E = e(s);
  if (!E) throw new Error("\u53ea\u5141\u8bb8\u6807\u8bb0\u8fde\u7eed\u8fd4\u56de\u5927\u6bb5\u975e\u751f\u6210\u6587\u5b57\u6216\u989d\u5ea6\u7528\u5c3d\u7684\u8d26\u53f7");
  if (!Number.isFinite(a) || a <= t) throw new Error("\u8d26\u53f7\u51b7\u5374\u622a\u6b62\u65f6\u95f4\u65e0\u6548");
  return o[i] = {
    accountId: i,
    until: Math.trunc(a),
    reason: s,
    label: E
  }, o;
}
function a(n, r, t = Date.now()) {
  return u(n, t)[c(r)] || null;
}
function s(n, r, t = Date.now()) {
  const o = u(n, t);
  for (const n of Array.isArray(r) ? r : []) delete o[c(n)];
  return o;
}
module.exports = {
  NON_GENERATION_RESPONSE: t,
  QUOTA_EXHAUSTED: o,
  QUOTA_EXHAUSTED_LABEL: r,
  UNUSABLE_ACCOUNT_LABEL: n,
  accountCooldownMarkerFor: a,
  normalizeAccountCooldownMarkers: u,
  removeAccountCooldownMarkers: s,
  updateAccountCooldownMarkers: i
};
