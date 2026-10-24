"use strict";

const {
    contextBridge: t,
    ipcRenderer: e
  } = require("electron"),
  {
    installBrowserFingerprint: n
  } = require("./browser-fingerprint-inject"),
  {
    installDolaDurationRequestPatch: o
  } = require("./dola-duration-request-patch");
try {
  const o = e.sendSync("browser-fingerprint:get");
  o && t.executeInMainWorld({
    func: n,
    args: [o]
  });
} catch {}
const r = "dbm:dola-enable-duration-interceptor",
  i = ['[data-input-engine-actionbar-control-key="video-duration"]', '[data-input-engine-actionbar-control-key="duration"]', '[data-input-engine-actionbar-control-key*="duration"]'].join(", ");
function a(e = !1) {
  if (/(^|\.)dola\.com$/i.test(location.hostname)) try {
    t.executeInMainWorld({
      func: o,
      args: [Boolean(e)]
    });
  } catch {}
}
try {
  document.addEventListener(r, () => {
    a(!1);
  }, !0), document.addEventListener("click", t => {
    t.target?.closest?.(i) && a(!0);
  }, !0);
} catch {}
const d = new Set();
let c = [],
  s = null,
  l = [];
const u = "dbm-dola-no-watermark-style",
  m = "dbm-dola-no-watermark-download",
  p = "data-dbm-dola-download-host";
function g(t) {
  try {
    const e = new URL(String(t || ""), location.href);
    return ["http:", "https:"].includes(e.protocol) ? e.toString() : "";
  } catch {
    return "";
  }
}
function f(t, e = "") {
  const n = `${t} ${e}`.toLowerCase();
  return /video\/(mp4|webm|quicktime)|\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(n) ? "video" : /image\/(jpeg|png|webp|gif)|\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(n) ? "image" : "";
}
function h(t) {
  const n = g(t.url),
    o = t.type || f(n, t.mime);
  n && o && !d.has(n) && !/avatar|emoji|icon|logo|favicon/i.test(n) && (d.add(n), "video" === o && (l = [n, ...l.filter(t => t !== n)].slice(0, 20)), c.push({
    ...t,
    url: n,
    type: o
  }), c.length > 100 && (c = c.slice(-100)), clearTimeout(s), s = setTimeout(() => {
    c.length && e.sendToHost("manager:resources", c.splice(0));
  }, 350));
}
function b(t) {
  if (!(t instanceof Element)) return;
  const e = t.matches("img,video,source") ? [t] : [...t.querySelectorAll("img,video,source")];
  for (const t of e) {
    const e = t.currentSrc || t.src || t.getAttribute("src");
    if (!e) continue;
    const n = t.getBoundingClientRect();
    "IMG" === t.tagName && n.width > 0 && n.height > 0 && (n.width < 160 || n.height < 120) || h({
      url: e,
      type: "VIDEO" === t.tagName || "SOURCE" === t.tagName ? "video" : "image",
      preview: "VIDEO" === t.tagName ? t.poster : e,
      name: t.getAttribute("alt") || t.getAttribute("title") || ""
    });
  }
}
function w() {
  return /(^|\.)dola\.com$/i.test(location.hostname) || "dola" === document.documentElement?.dataset?.dbmPlatform;
}
function y() {
  if (document.getElementById(u)) return;
  const t = document.createElement("style");
  t.id = u, t.textContent = `\n    .${m} {\n      position: absolute !important;\n      right: 12px !important;\n      bottom: 12px !important;\n      z-index: 2147483646 !important;\n      min-width: 104px !important;\n      height: 34px !important;\n      padding: 0 13px !important;\n      border: 1px solid rgba(255,255,255,.34) !important;\n      border-radius: 999px !important;\n      background: rgba(12,18,28,.88) !important;\n      color: #8ff0ce !important;\n      box-shadow: 0 6px 18px rgba(0,0,0,.28) !important;\n      backdrop-filter: blur(8px) !important;\n      font: 600 13px/32px "Microsoft YaHei UI",sans-serif !important;\n      cursor: pointer !important;\n      white-space: nowrap !important;\n    }\n    .${m}:hover { background: rgba(24,78,63,.94) !important; }\n    .${m}:disabled { cursor: wait !important; opacity: .78 !important; }\n  `, document.documentElement.appendChild(t);
}
function v(t) {
  if (!(t instanceof HTMLVideoElement && t.isConnected)) return !1;
  const e = t.getBoundingClientRect(),
    n = getComputedStyle(t);
  return e.width >= 180 && e.height >= 100 && "none" !== n.display && "hidden" !== n.visibility;
}
function S(t) {
  if (!(t instanceof Element && t.isConnected)) return !1;
  const e = t.getBoundingClientRect(),
    n = getComputedStyle(t);
  return e.width >= 180 && e.height >= 100 && "none" !== n.display && "hidden" !== n.visibility;
}
function x(t) {
  const e = t.getBoundingClientRect();
  let n = t.parentElement,
    o = n;
  for (let t = 0; n && n !== document.body && t < 6; t += 1) {
    const t = n.getBoundingClientRect();
    if (t.width >= .9 * e.width && t.height >= .9 * e.height && (o = n, t.width <= e.width + 80 && t.height <= e.height + 100 && n.querySelectorAll('video,[class*="block-video"]').length <= 1)) return n;
    n = n.parentElement;
  }
  return o;
}
function E(t) {
  return [t.currentSrc, t.src, t.querySelector("source")?.src, t.getAttribute("data-src"), ...l].map(g).find(Boolean) || "";
}
function k() {
  return `Dola_\u65e0\u6c34\u5370\u89c6\u9891_${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}.mp4`;
}
function C(t = document) {
  if (!w()) return;
  y();
  const n = [],
    o = [],
    r = [];
  t instanceof HTMLVideoElement && o.push(t), t instanceof Element && /(?:^|\s)block-video(?:-|\s|$)/i.test(t.className || "") && r.push(t), t?.querySelectorAll && (o.push(...t.querySelectorAll("video")), r.push(...t.querySelectorAll('[class*="block-video"]')));
  for (const t of o) {
    if (!v(t)) continue;
    const e = x(t);
    e && n.push(e);
  }
  for (const t of r) S(t) && n.push(t);
  for (const t of Array.from(new Set(n))) {
    if (!t || t.querySelector(`:scope > .${m}`)) continue;
    t.style.setProperty("position", "relative", "important"), t.setAttribute(p, "true");
    const n = document.createElement("button");
    n.type = "button", n.className = m, n.textContent = "\u65e0\u6c34\u5370\u4e0b\u8f7d", n.title = "\u89e3\u6790\u5e76\u4e0b\u8f7d Dola \u5b98\u65b9\u65e0\u6c34\u5370\u539f\u7247", n.addEventListener("click", o => {
      if (o.preventDefault(), o.stopPropagation(), o.stopImmediatePropagation?.(), n.disabled) return;
      const r = t.querySelector("video"),
        i = r ? E(r) : "",
        a = String(t.closest("[data-message-id]")?.getAttribute("data-message-id") || "");
      if (!i && !a) return n.textContent = "\u672a\u627e\u5230\u89c6\u9891", void setTimeout(() => {
        n.textContent = "\u65e0\u6c34\u5370\u4e0b\u8f7d";
      }, 2400);
      const d = `dola-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      n.dataset.requestId = d, n.disabled = !0, n.textContent = "\u4e0b\u8f7d\u4e2d\u2026", e.sendToHost("manager:dola-no-watermark-download", {
        requestId: d,
        url: i,
        messageId: a,
        filename: k(),
        type: "video"
      });
    }, !0), t.appendChild(n);
  }
}
window.addEventListener("DOMContentLoaded", () => {
  b(document.body), C(document);
  let t = 0;
  new MutationObserver(e => {
    for (const t of e) for (const e of t.addedNodes) b(e);
    clearTimeout(t), t = setTimeout(() => C(document), 180);
  }).observe(document.documentElement, {
    childList: !0,
    subtree: !0,
    attributes: !0
  }), setInterval(() => C(document), 1200);
}), window.addEventListener("message", t => {
  if (t.source !== window) return;
  if ("dbm:dola-no-watermark-progress" === t.data?.type) {
    const e = String(t.data.requestId || ""),
      n = Array.from(document.querySelectorAll(`.${m}`)).find(t => t.dataset.requestId === e);
    if (!n) return;
    return n.textContent = String(t.data.label || "\u5904\u7406\u4e2d\u2026"), void (t.data.done && setTimeout(() => {
      n.disabled = !1, n.textContent = "\u65e0\u6c34\u5370\u4e0b\u8f7d", delete n.dataset.requestId;
    }, t.data.ok ? 1800 : 3e3));
  }
  if ("electronDownload" !== t.data?.type) return;
  const n = t.data?.data || {},
    o = g(n.url),
    r = g(n.backupUrl);
  o && "video" === n.type && n.confirmedNoWatermark && e.sendToHost("manager:no-watermark-download", {
    url: o,
    backupUrl: r,
    filename: String(n.filename || `\u8c46\u5305\u5b98\u65b9\u65e0\u6c34\u5370_${Date.now()}.mp4`),
    type: "video"
  });
});
try {
  new PerformanceObserver(t => {
    for (const e of t.getEntries()) {
      const t = f(e.name, e.initiatorType);
      t && h({
        url: e.name,
        type: t
      });
    }
  }).observe({
    type: "resource",
    buffered: !0
  });
} catch {}
