"use strict";

const r = require("node:path"),
  e = "DoubaoAccountManager",
  o = "DoubaoAccountManager-Dev";
function t(t = {}) {
  const a = t.env || process.env,
    n = Array.isArray(t.argv) ? t.argv : process.argv,
    s = String(a.DBM_DATA_DIR || "").trim();
  if (s) return r.resolve(s);
  const D = String(t.appData || "").trim();
  if (!D) throw new Error("appData directory is required");
  const i = n.includes("--dev") || "1" === a.DBM_DEVELOPMENT_DATA;
  return r.join(r.resolve(D), i ? o : e);
}
module.exports = {
  DEVELOPMENT_DIRECTORY_NAME: o,
  PRODUCTION_DIRECTORY_NAME: e,
  resolveDataDirectory: t
};
