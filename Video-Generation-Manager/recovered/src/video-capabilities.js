"use strict";

const e = Object.freeze({
  schemaVersion: 1,
  targets: Object.freeze({
    doubao: Object.freeze({
      name: "\u8c46\u5305",
      models: Object.freeze(["seedance2.0fast", "seedance2.0mini", "seedance2.5"]),
      durations: Object.freeze(["auto", 5, 10, 15, 30]),
      watermark: "official-no-watermark"
    }),
    dola: Object.freeze({
      name: "Dola",
      models: Object.freeze(["seedance2.0fast", "seedance2.0mini", "dreamina-seedance2.5"]),
      durations: Object.freeze(["auto", 5, 10, 15, 30]),
      watermark: "official-no-watermark",
      executionEngine: "manager-chromium-webview",
      cdpIsolation: "webcontents-debugger-ipc"
    })
  })
});
function a(e = {}) {
  const a = "dola" === e.targetPlatform ? "dola" : "doubao",
    r = String(e.model || "").toLowerCase().replace(/[\s_-]+/g, ""),
    n = "dola" === a && (r.includes("dreamina") || r.includes("2.5")) ? "dreamina-seedance2.5" : "doubao" === a && r.includes("2.5") && !r.includes("dreamina") ? "seedance2.5" : r.includes("mini") ? "seedance2.0mini" : "seedance2.0fast",
    o = String(e.duration ?? "10").trim().toLowerCase();
  let t = "auto";
  if ("auto" !== o) {
    const e = Number.parseInt(o, 10);
    t = ("dola" === a && "dreamina-seedance2.5" === n || "doubao" === a && "seedance2.5" === n) && e >= 30 ? 30 : e >= 15 ? 15 : e >= 10 ? 10 : 5;
  }
  return {
    targetPlatform: a,
    model: n,
    duration: t,
    removeWatermark: !1 !== e.removeWatermark
  };
}
module.exports = {
  VIDEO_CAPABILITIES: e,
  normalizeVideoTask: a
};
