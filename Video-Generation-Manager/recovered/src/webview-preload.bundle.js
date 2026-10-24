"use strict";

const t = (() => {
    const t = {
      exports: {}
    };
    return t.exports, t.exports = {
      installBrowserFingerprint: function (t) {
        if (!t || "object" != typeof t) return !1;
        const e = new WeakMap(),
          n = Function.prototype.toString,
          o = (t, o) => {
            try {
              e.set(t, n.call(o));
            } catch {}
            return t;
          },
          r = (t, e, n) => {
            if (!t) return;
            const r = Object.getOwnPropertyDescriptor(t, e)?.get,
              i = o(function () {
                return n;
              }, r || function () {});
            try {
              Object.defineProperty(t, e, {
                configurable: !0,
                enumerable: !r || Object.getOwnPropertyDescriptor(t, e)?.enumerable,
                get: i
              });
            } catch {}
          },
          i = (t, e, n) => {
            const r = t?.[e];
            if ("function" != typeof r) return null;
            const i = o(n(r), r);
            try {
              return Object.defineProperty(t, e, {
                configurable: !0,
                enumerable: !1,
                writable: !0,
                value: i
              }), r;
            } catch {
              return null;
            }
          },
          a = o(function () {
            return e.has(this) ? e.get(this) : n.call(this);
          }, n);
        try {
          Object.defineProperty(Function.prototype, "toString", {
            configurable: !0,
            writable: !0,
            value: a
          });
        } catch {}
        const c = t.navigator || {},
          l = globalThis.Navigator?.prototype;
        r(l, "userAgent", t.userAgent), r(l, "appVersion", t.appVersion), r(l, "platform", c.platform), r(l, "vendor", c.vendor), r(l, "language", t.languages?.[0] || "zh-CN"), r(l, "languages", Object.freeze([...(t.languages || ["zh-CN"])])), r(l, "hardwareConcurrency", c.hardwareConcurrency), r(l, "deviceMemory", c.deviceMemory), r(l, "maxTouchPoints", c.maxTouchPoints), r(l, "webdriver", Boolean(c.webdriver));
        const s = t.userAgentData || {},
          u = Object.freeze((s.brands || []).map(t => Object.freeze({
            ...t
          }))),
          d = Object.freeze((s.fullVersionList || []).map(t => Object.freeze({
            ...t
          }))),
          p = {
            brands: u,
            mobile: Boolean(s.mobile),
            platform: s.platform || "Windows",
            async getHighEntropyValues(t) {
              const e = {
                architecture: s.architecture,
                bitness: s.bitness,
                brands: u,
                fullVersionList: d,
                mobile: Boolean(s.mobile),
                model: s.model,
                platform: s.platform,
                platformVersion: s.platformVersion,
                uaFullVersion: s.uaFullVersion,
                wow64: Boolean(s.wow64)
              };
              return Object.fromEntries(["brands", "mobile", "platform", ...Array.from(t || [])].filter((t, n, o) => o.indexOf(t) === n && t in e).map(t => [t, e[t]]));
            },
            toJSON() {
              return {
                brands: this.brands,
                mobile: this.mobile,
                platform: this.platform
              };
            }
          };
        r(l, "userAgentData", Object.freeze(p));
        const f = t.screen || {},
          m = globalThis.Screen?.prototype;
        for (const t of ["width", "height", "availWidth", "availHeight", "availLeft", "availTop", "colorDepth", "pixelDepth"]) r(m, t, f[t]);
        r(globalThis, "devicePixelRatio", f.devicePixelRatio);
        const g = t.webgl || {},
          y = t => {
            i(t, "getParameter", t => function (e) {
              return 37445 === e ? g.vendor : 37446 === e ? g.renderer : t.apply(this, arguments);
            });
          };
        y(globalThis.WebGLRenderingContext?.prototype), y(globalThis.WebGL2RenderingContext?.prototype);
        const h = t.canvas || {},
          b = (t, e, n) => {
            if (!t?.data?.length || e <= 0 || n <= 0) return t;
            const o = Number(h.xSalt || 0) % e,
              r = Number(h.ySalt || 0) % n,
              i = Number(h.channel || 0) % 3,
              a = Math.min(t.data.length - 4, 4 * (r * e + o)),
              c = a + i,
              l = t.data[c],
              s = Number(h.delta || 1) >= 0 ? 1 : 2;
            return t.data[c] = l ^ s, t.data[a + 3] = 1 ^ t.data[a + 3], t;
          },
          w = globalThis.CanvasRenderingContext2D?.prototype,
          v = w?.getImageData,
          A = w?.putImageData;
        i(w, "getImageData", t => function (e, n, o, r) {
          const i = t.apply(this, arguments);
          return b(i, Number(o), Number(r));
        });
        const S = globalThis.HTMLCanvasElement?.prototype,
          _ = t => {
            if (!t?.width || !t?.height || !globalThis.document) return null;
            const e = document.createElement("canvas");
            e.width = t.width, e.height = t.height;
            const n = e.getContext("2d");
            if (!n || "function" != typeof v || "function" != typeof A) return null;
            n.drawImage(t, 0, 0);
            const o = e.width,
              r = e.height,
              i = Number(h.xSalt || 0) % o,
              a = Number(h.ySalt || 0) % r,
              c = v.call(n, i, a, 1, 1);
            return b(c, 1, 1), A.call(n, c, i, a), e;
          };
        i(S, "toDataURL", t => function () {
          try {
            const e = _(this);
            if (e) return t.apply(e, arguments);
          } catch {}
          return t.apply(this, arguments);
        }), i(S, "toBlob", t => function () {
          try {
            const e = _(this);
            if (e) return t.apply(e, arguments);
          } catch {}
          return t.apply(this, arguments);
        });
        const E = t.audio || {},
          x = (t, e) => {
            if (!t?.length) return t;
            const n = Number(E.indexSalt || 0) % t.length;
            return "byte" === e ? t[n] = Math.max(0, Math.min(255, t[n] + (E.delta >= 0 ? 1 : -1))) : t[n] += Number(E.delta || 0), t;
          },
          D = globalThis.AnalyserNode?.prototype;
        return i(D, "getFloatFrequencyData", t => function (e) {
          const n = t.apply(this, arguments);
          return x(e, "float"), n;
        }), i(D, "getFloatTimeDomainData", t => function (e) {
          const n = t.apply(this, arguments);
          return x(e, "float"), n;
        }), i(D, "getByteFrequencyData", t => function (e) {
          const n = t.apply(this, arguments);
          return x(e, "byte"), n;
        }), !0;
      }
    }, t.exports;
  })(),
  e = (() => {
    const t = {
      exports: {}
    };
    return t.exports, t.exports = {
      installDolaDurationRequestPatch: function (t = !1) {
        if (window.__DBM_DOLA_DURATION_REQUEST_PATCH__) return;
        window.__DBM_DOLA_DURATION_REQUEST_PATCH__ = !0;
        const e = "dbm_dola_video_duration_override",
          n = "dbm_dola_enable_30s_v1",
          o = "data-dbm-dola-duration-option",
          r = ['[data-input-engine-actionbar-control-key="video-duration"]', '[data-input-engine-actionbar-control-key="duration"]', '[data-input-engine-actionbar-control-key*="duration"]'].join(", "),
          i = ['[role="menu"]', '[role="listbox"]', '[data-slot="dropdown-menu-content"]', '[data-slot="select-content"]', '[data-slot="popover-content"]'].join(", ");
        function a(t) {
          return "string" == typeof t ? t : t && (t.url || t.href) || String(t || "");
        }
        function c(t) {
          try {
            const e = new URL(a(t), location.href),
              n = e.hostname.replace(/^www\./i, "").toLowerCase();
            return ("dola.com" === n || n.endsWith(".dola.com")) && /\/chat\/completion\/?$/i.test(e.pathname);
          } catch {
            return !1;
          }
        }
        function l() {
          try {
            const t = new URL(location.href).hostname.replace(/^www\./i, "").toLowerCase();
            return "dola.com" === t || t.endsWith(".dola.com");
          } catch {
            return !1;
          }
        }
        let s = !1;
        function u() {
          const t = document.querySelector('[data-input-engine-actionbar-control-key="video-model"], [data-input-engine-actionbar-control-key="model"]'),
            e = String(t?.textContent || t?.innerText || "").replace(/\s+/g, " ").trim();
          return e && (s = /2\.5|seedance[^\d]*2[^\d]*5/i.test(e)), s;
        }
        function d() {
          try {
            return "1" === localStorage.getItem(n);
          } catch {
            return !1;
          }
        }
        function p() {
          return d() || function () {
            try {
              return "30" === localStorage.getItem(e);
            } catch {
              return !1;
            }
          }();
        }
        function f(t, e = 0) {
          if (!t || "object" != typeof t || e > 12) return !1;
          let n = !1;
          if (!Array.isArray(t) && 17 === Number(t.ability_type) && Object.prototype.hasOwnProperty.call(t, "ability_param")) {
            const e = function (t) {
              if ("string" == typeof t) try {
                const e = JSON.parse(t);
                return !e || "object" != typeof e || Array.isArray(e) ? null : (e.duration = 30, JSON.stringify(e));
              } catch {
                return null;
              }
              return t && "object" == typeof t && !Array.isArray(t) ? (t.duration = 30, t) : null;
            }(t.ability_param);
            null !== e && (t.ability_param = e, n = !0);
          }
          for (const o of Array.isArray(t) ? t : Object.values(t)) o && "object" == typeof o && f(o, e + 1) && (n = !0);
          return n;
        }
        function m(t, n) {
          let o = "";
          try {
            o = localStorage.getItem(e) || "";
          } catch {}
          const r = "30" === o;
          if (!r && !d() || !u() || "string" != typeof t || !t.trim() || !c(n)) return t;
          try {
            const n = JSON.parse(t);
            return f(n) ? (r && localStorage.removeItem(e), JSON.stringify(n)) : t;
          } catch {
            return t;
          }
        }
        let g = null;
        function y() {
          if (g) return !0;
          const t = window.fetch,
            e = "function" == typeof window.Request ? window.Request : null,
            n = "function" == typeof XMLHttpRequest ? XMLHttpRequest.prototype : null,
            o = n?.open,
            r = n?.send;
          if ("function" != typeof t && "function" != typeof e && "function" != typeof r) return !1;
          let i = null,
            l = null,
            s = null,
            f = null;
          const y = () => {
              i && window.fetch === i && (window.fetch = t), l && window.Request === l && (window.Request = e), s && n?.open === s && (n.open = o), f && n?.send === f && (n.send = r), g === y && (g = null);
            },
            h = () => {
              d() || setTimeout(y, 0);
            };
          return g = y, "function" == typeof t && (i = function (n, o) {
            const r = o?.body;
            if (void 0 === r && n && "function" == typeof n.clone && c(n) && p() && u()) {
              const r = this;
              return n.clone().text().then(i => {
                const c = m(i, a(n));
                if (c === i) throw new Error("Dola Seedance 2.5 \u7684 30s \u8bf7\u6c42\u6b63\u6587\u672a\u80fd\u6539\u5199\uff0c\u5df2\u505c\u6b62\u63d0\u4ea4");
                const l = new e(n, {
                    ...o,
                    body: c
                  }),
                  s = t.call(r, l);
                return h(), s;
              }, () => {
                throw new Error("Dola Seedance 2.5 \u7684 30s \u8bf7\u6c42\u6b63\u6587\u65e0\u6cd5\u8bfb\u53d6\uff0c\u5df2\u505c\u6b62\u63d0\u4ea4");
              });
            }
            const i = m(r, a(n));
            if (i === r) return arguments.length > 1 ? t.call(this, n, o) : t.call(this, n);
            const l = t.call(this, n, {
              ...o,
              body: i
            });
            return h(), l;
          }, window.fetch = i), "function" == typeof e && (l = function (t, n) {
            const o = n?.body,
              r = m(o, a(t)),
              i = arguments.length > 1 ? new e(t, r === o ? n : {
                ...n,
                body: r
              }) : new e(t);
            return r !== o && h(), i;
          }, Object.setPrototypeOf(l, e), l.prototype = e.prototype, window.Request = l), "function" == typeof o && (s = function (t, e) {
            return this.__dbmDolaDurationRequestUrl = a(e), o.apply(this, arguments);
          }, n.open = s), "function" == typeof r && (f = function (t) {
            const e = m(t, this.__dbmDolaDurationRequestUrl || ""),
              n = r.call(this, e);
            return e !== t && h(), n;
          }, n.send = f), !0;
        }
        function h() {
          if (!window.__DBM_DOLA_DURATION_MENU_ENHANCEMENT__ && l() && "function" == typeof document?.querySelectorAll && (window.__DBM_DOLA_DURATION_MENU_ENHANCEMENT__ = !0, window.__DBM_DOLA_SELECT_AUTOMATED_DURATION_30__ = () => {
            if (!u()) return !1;
            const t = Array.from(document.querySelectorAll(r)).find(t => a(t));
            if (!t) return !1;
            try {
              localStorage.setItem(e, "30");
            } catch {
              return !1;
            }
            if (!y()) {
              try {
                localStorage.removeItem(e);
              } catch {}
              return !1;
            }
            return S(t), v(t), !0;
          }, document.addEventListener("click", t => {
            const e = t.target?.closest?.(r);
            e && S(e);
            const n = t.target?.closest?.("#flow-end-msg-send");
            n && d() && y();
          }, !0), t)) {
            const t = Array.from(document.querySelectorAll(r)).find(t => a(t));
            t && S(t);
          }
          function a(t) {
            if (!t?.isConnected || "function" != typeof getComputedStyle) return !1;
            const e = getComputedStyle(t);
            if ("none" === e.display || "hidden" === e.visibility || 0 === Number(e.opacity)) return !1;
            const n = t.getBoundingClientRect();
            return n.width > 2 && n.height > 2;
          }
          function c(t) {
            const e = function (t) {
              return String(t?.innerText || t?.textContent || "").replace(/\s+/g, "").replace(/[\u2713\u2714\u221a]/g, "").trim();
            }(t).match(/^(5|10|15|30)(s|\u79d2)$/i);
            return e ? Number(e[1]) : 0;
          }
          function s(t) {
            return Array.from(t?.querySelectorAll?.('[role="menuitem"], [role="option"], li, button, div') || []).filter(e => e !== t && a(e) && c(e) > 0);
          }
          function f(t, e) {
            const n = t => String(t || "").replace(/(?:5|10|15|30)(s|\u79d2)/gi, `${e}s`);
            try {
              const e = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
              let o = !1;
              for (; e.nextNode();) {
                const t = n(e.currentNode.nodeValue);
                t !== e.currentNode.nodeValue && (e.currentNode.nodeValue = t, o = !0);
              }
              if (o) return;
            } catch {}
            t.textContent = `${e}s`;
          }
          function m(t, e) {
            t?.setAttribute?.("aria-selected", e ? "true" : "false"), e ? t?.setAttribute?.("data-state", "checked") : t?.removeAttribute?.("data-state");
            for (const n of Array.from(t?.querySelectorAll?.("svg") || [])) n.style.visibility = e ? "visible" : "hidden";
          }
          function h(t) {
            try {
              localStorage.setItem(n, t ? "1" : "0");
            } catch {}
            t ? y() : g?.();
          }
          function b(t) {
            const e = u() && p();
            for (const n of s(t)) {
              const t = c(n);
              e ? m(n, 30 === t) : "30" === n.getAttribute(o) && m(n, !1);
            }
          }
          function w(t) {
            u() && p() && t?.matches?.(r) && a(t) && f(t, 30);
          }
          function v(t) {
            for (const e of [0, 50, 120, 300]) setTimeout(() => w(t), e);
          }
          function A(t) {
            const n = function (t) {
              const e = [],
                n = t?.getAttribute?.("aria-controls") || "";
              n && "function" == typeof document.getElementById && e.push(document.getElementById(n)), e.push(...Array.from(document.querySelectorAll(i)));
              const o = t?.getBoundingClientRect?.();
              return Array.from(new Set(e)).filter(t => t && a(t)).filter(t => {
                const e = new Set(s(t).map(c));
                return e.has(5) && e.has(10);
              }).sort((t, e) => {
                if (!o) return 0;
                const n = t => {
                  const e = t.getBoundingClientRect();
                  return Math.abs(e.left - o.left) + Math.abs(e.top - o.bottom);
                };
                return n(t) - n(e);
              })[0] || null;
            }(t);
            if (!n || !u()) return;
            let r = s(n);
            if (r.length) {
              if (!r.some(t => 30 === c(t))) {
                const e = r.find(t => 10 === c(t)) || r[0];
                if (!e?.parentElement) return;
                const i = e.cloneNode(!0);
                i.removeAttribute("aria-selected"), i.removeAttribute("data-state"), i.setAttribute(o, "30"), i.setAttribute("aria-selected", "false"), i.style.marginLeft = "6px", i.style.border = "1px solid rgba(99,102,241,.55)", i.style.background = "rgba(99,102,241,.12)", f(i, 30), m(i, !1), i.addEventListener("click", e => {
                  e.preventDefault(), e.stopPropagation(), h(!0), b(n), v(t), setTimeout(() => {
                    try {
                      const t = {
                        key: "Escape",
                        code: "Escape",
                        keyCode: 27,
                        which: 27,
                        bubbles: !0,
                        cancelable: !0
                      };
                      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", t)), document.dispatchEvent(new KeyboardEvent("keydown", t)), document.dispatchEvent(new KeyboardEvent("keyup", t));
                    } catch {}
                  }, 60);
                }, !0), e.parentElement.appendChild(i);
              }
              r = s(n);
              for (const t of r) {
                const n = c(t);
                [5, 10, 15].includes(n) && !t.hasAttribute("data-dbm-native-duration") && (t.setAttribute("data-dbm-native-duration", String(n)), t.addEventListener("click", () => {
                  h(!1);
                  try {
                    localStorage.removeItem(e);
                  } catch {}
                }, !0));
              }
              b(n);
            }
          }
          function S(t) {
            if (t && u()) for (const e of [0, 50, 120, 300]) setTimeout(() => A(t), e);
          }
        }
        window.__DBM_DOLA_ENABLE_DURATION_INTERCEPTOR__ = y, l() && d() && y(), "function" == typeof setTimeout && "function" == typeof document?.querySelectorAll && ("loading" === document.readyState ? document.addEventListener("DOMContentLoaded", h, {
          once: !0
        }) : setTimeout(h, 0));
      }
    }, t.exports;
  })(),
  {
    contextBridge: n,
    ipcRenderer: o
  } = require("electron"),
  {
    installBrowserFingerprint: r
  } = t,
  {
    installDolaDurationRequestPatch: i
  } = e;
try {
  const t = o.sendSync("browser-fingerprint:get");
  t && n.executeInMainWorld({
    func: r,
    args: [t]
  });
} catch {}
const a = "dbm:dola-enable-duration-interceptor",
  c = ['[data-input-engine-actionbar-control-key="video-duration"]', '[data-input-engine-actionbar-control-key="duration"]', '[data-input-engine-actionbar-control-key*="duration"]'].join(", ");
function l(t = !1) {
  if (/(^|\.)dola\.com$/i.test(location.hostname)) try {
    n.executeInMainWorld({
      func: i,
      args: [Boolean(t)]
    });
  } catch {}
}
try {
  document.addEventListener(a, () => {
    l(!1);
  }, !0), document.addEventListener("click", t => {
    t.target?.closest?.(c) && l(!0);
  }, !0);
} catch {}
const s = new Set();
let u = [],
  d = null,
  p = [];
const f = "dbm-dola-no-watermark-style",
  m = "dbm-dola-no-watermark-download",
  g = "data-dbm-dola-download-host";
function y(t) {
  try {
    const e = new URL(String(t || ""), location.href);
    return ["http:", "https:"].includes(e.protocol) ? e.toString() : "";
  } catch {
    return "";
  }
}
function h(t, e = "") {
  const n = `${t} ${e}`.toLowerCase();
  return /video\/(mp4|webm|quicktime)|\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(n) ? "video" : /image\/(jpeg|png|webp|gif)|\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(n) ? "image" : "";
}
function b(t) {
  const e = y(t.url),
    n = t.type || h(e, t.mime);
  e && n && !s.has(e) && !/avatar|emoji|icon|logo|favicon/i.test(e) && (s.add(e), "video" === n && (p = [e, ...p.filter(t => t !== e)].slice(0, 20)), u.push({
    ...t,
    url: e,
    type: n
  }), u.length > 100 && (u = u.slice(-100)), clearTimeout(d), d = setTimeout(() => {
    u.length && o.sendToHost("manager:resources", u.splice(0));
  }, 350));
}
function w(t) {
  if (!(t instanceof Element)) return;
  const e = t.matches("img,video,source") ? [t] : [...t.querySelectorAll("img,video,source")];
  for (const t of e) {
    const e = t.currentSrc || t.src || t.getAttribute("src");
    if (!e) continue;
    const n = t.getBoundingClientRect();
    "IMG" === t.tagName && n.width > 0 && n.height > 0 && (n.width < 160 || n.height < 120) || b({
      url: e,
      type: "VIDEO" === t.tagName || "SOURCE" === t.tagName ? "video" : "image",
      preview: "VIDEO" === t.tagName ? t.poster : e,
      name: t.getAttribute("alt") || t.getAttribute("title") || ""
    });
  }
}
function v() {
  return /(^|\.)dola\.com$/i.test(location.hostname) || "dola" === document.documentElement?.dataset?.dbmPlatform;
}
function A() {
  if (document.getElementById(f)) return;
  const t = document.createElement("style");
  t.id = f, t.textContent = `\n    .${m} {\n      position: absolute !important;\n      right: 12px !important;\n      bottom: 12px !important;\n      z-index: 2147483646 !important;\n      min-width: 104px !important;\n      height: 34px !important;\n      padding: 0 13px !important;\n      border: 1px solid rgba(255,255,255,.34) !important;\n      border-radius: 999px !important;\n      background: rgba(12,18,28,.88) !important;\n      color: #8ff0ce !important;\n      box-shadow: 0 6px 18px rgba(0,0,0,.28) !important;\n      backdrop-filter: blur(8px) !important;\n      font: 600 13px/32px "Microsoft YaHei UI",sans-serif !important;\n      cursor: pointer !important;\n      white-space: nowrap !important;\n    }\n    .${m}:hover { background: rgba(24,78,63,.94) !important; }\n    .${m}:disabled { cursor: wait !important; opacity: .78 !important; }\n  `, document.documentElement.appendChild(t);
}
function S(t) {
  if (!(t instanceof HTMLVideoElement && t.isConnected)) return !1;
  const e = t.getBoundingClientRect(),
    n = getComputedStyle(t);
  return e.width >= 180 && e.height >= 100 && "none" !== n.display && "hidden" !== n.visibility;
}
function _(t) {
  if (!(t instanceof Element && t.isConnected)) return !1;
  const e = t.getBoundingClientRect(),
    n = getComputedStyle(t);
  return e.width >= 180 && e.height >= 100 && "none" !== n.display && "hidden" !== n.visibility;
}
function E(t) {
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
function x(t) {
  return [t.currentSrc, t.src, t.querySelector("source")?.src, t.getAttribute("data-src"), ...p].map(y).find(Boolean) || "";
}
function D() {
  return `Dola_\u65e0\u6c34\u5370\u89c6\u9891_${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}.mp4`;
}
function T(t = document) {
  if (!v()) return;
  A();
  const e = [],
    n = [],
    r = [];
  t instanceof HTMLVideoElement && n.push(t), t instanceof Element && /(?:^|\s)block-video(?:-|\s|$)/i.test(t.className || "") && r.push(t), t?.querySelectorAll && (n.push(...t.querySelectorAll("video")), r.push(...t.querySelectorAll('[class*="block-video"]')));
  for (const t of n) {
    if (!S(t)) continue;
    const n = E(t);
    n && e.push(n);
  }
  for (const t of r) _(t) && e.push(t);
  for (const t of Array.from(new Set(e))) {
    if (!t || t.querySelector(`:scope > .${m}`)) continue;
    t.style.setProperty("position", "relative", "important"), t.setAttribute(g, "true");
    const e = document.createElement("button");
    e.type = "button", e.className = m, e.textContent = "\u65e0\u6c34\u5370\u4e0b\u8f7d", e.title = "\u89e3\u6790\u5e76\u4e0b\u8f7d Dola \u5b98\u65b9\u65e0\u6c34\u5370\u539f\u7247", e.addEventListener("click", n => {
      if (n.preventDefault(), n.stopPropagation(), n.stopImmediatePropagation?.(), e.disabled) return;
      const r = t.querySelector("video"),
        i = r ? x(r) : "",
        a = String(t.closest("[data-message-id]")?.getAttribute("data-message-id") || "");
      if (!i && !a) return e.textContent = "\u672a\u627e\u5230\u89c6\u9891", void setTimeout(() => {
        e.textContent = "\u65e0\u6c34\u5370\u4e0b\u8f7d";
      }, 2400);
      const c = `dola-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      e.dataset.requestId = c, e.disabled = !0, e.textContent = "\u4e0b\u8f7d\u4e2d\u2026", o.sendToHost("manager:dola-no-watermark-download", {
        requestId: c,
        url: i,
        messageId: a,
        filename: D(),
        type: "video"
      });
    }, !0), t.appendChild(e);
  }
}
window.addEventListener("DOMContentLoaded", () => {
  w(document.body), T(document);
  let t = 0;
  new MutationObserver(e => {
    for (const t of e) for (const e of t.addedNodes) w(e);
    clearTimeout(t), t = setTimeout(() => T(document), 180);
  }).observe(document.documentElement, {
    childList: !0,
    subtree: !0,
    attributes: !0
  }), setInterval(() => T(document), 1200);
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
  const e = t.data?.data || {},
    n = y(e.url),
    r = y(e.backupUrl);
  n && "video" === e.type && e.confirmedNoWatermark && o.sendToHost("manager:no-watermark-download", {
    url: n,
    backupUrl: r,
    filename: String(e.filename || `\u8c46\u5305\u5b98\u65b9\u65e0\u6c34\u5370_${Date.now()}.mp4`),
    type: "video"
  });
});
try {
  new PerformanceObserver(t => {
    for (const e of t.getEntries()) {
      const t = h(e.name, e.initiatorType);
      t && b({
        url: e.name,
        type: t
      });
    }
  }).observe({
    type: "resource",
    buffered: !0
  });
} catch {}
