"use strict";

const e = require("node:fs"),
  t = require("node:path");
function n(t) {
  try {
    return JSON.parse(e.readFileSync(t, "utf8"));
  } catch {
    return null;
  }
}
function i(e, t = "0.0.0") {
  const n = e && "object" == typeof e ? e : {},
    i = String(n.version || t || "0.0.0");
  return Object.freeze({
    version: i,
    buildId: String(n.buildId || `dev-${i}`),
    commit: String(n.commit || "development"),
    builtAt: String(n.builtAt || "development"),
    dirty: Boolean(n.dirty),
    component: String(n.component || "manager")
  });
}
function o(e = {}) {
  const o = t.resolve(e.appPath || process.cwd()),
    a = t.resolve(e.packagePath || t.join(o, "package.json")),
    r = n(a) || {},
    s = String(e.fallbackVersion || r.version || "0.0.0"),
    c = [t.join(o, "build-info.json"), t.join(t.dirname(a), "build-info.json")];
  for (const e of c) {
    const t = n(e);
    if (t) return i(t, s);
  }
  return i(null, s);
}
function a({
  executablePath: e = process.execPath,
  buildInfo: i = {}
} = {}) {
  const o = t.dirname(t.dirname(t.resolve(e))),
    a = n(t.join(o, "CURRENT.json")),
    r = n(t.join(o, "DEPLOYMENT.json")),
    s = e => e && e.buildId === i.buildId && e.commit === i.commit;
  return String(i.buildId || "").startsWith("dev-") ? {
    status: "development",
    label: "\u5f00\u53d1\u7248\u672c"
  } : s(a) && s(r?.release) ? "accepted" === r.status && /^[A-F0-9]{64}$/.test(r.acceptance?.sha256 || "") ? {
    status: "accepted",
    label: "\u5df2\u9a8c\u6536"
  } : "awaiting-acceptance" === r.status ? {
    status: "awaiting-acceptance",
    label: "\u5f85\u9a8c\u6536"
  } : {
    status: "unverified",
    label: "\u672a\u786e\u8ba4\u53d1\u5e03"
  } : {
    status: "unverified",
    label: "\u672a\u8bb0\u5f55\u9a8c\u6536"
  };
}
module.exports = {
  loadBuildInfo: o,
  normalizeBuildInfo: i,
  loadReleaseStatus: a
};
