"use strict";

function t(t = !1) {
  if (window.__DBM_DOLA_DURATION_REQUEST_PATCH__) return;
  window.__DBM_DOLA_DURATION_REQUEST_PATCH__ = !0;
  const e = "dbm_dola_video_duration_override",
    n = "dbm_dola_enable_30s_v1",
    o = "data-dbm-dola-duration-option",
    r = ['[data-input-engine-actionbar-control-key="video-duration"]', '[data-input-engine-actionbar-control-key="duration"]', '[data-input-engine-actionbar-control-key*="duration"]'].join(", "),
    i = ['[role="menu"]', '[role="listbox"]', '[data-slot="dropdown-menu-content"]', '[data-slot="select-content"]', '[data-slot="popover-content"]'].join(", ");
  function c(t) {
    return "string" == typeof t ? t : t && (t.url || t.href) || String(t || "");
  }
  function a(t) {
    try {
      const e = new URL(c(t), location.href),
        n = e.hostname.replace(/^www\./i, "").toLowerCase();
      return ("dola.com" === n || n.endsWith(".dola.com")) && /\/chat\/completion\/?$/i.test(e.pathname);
    } catch {
      return !1;
    }
  }
  function u() {
    try {
      const t = new URL(location.href).hostname.replace(/^www\./i, "").toLowerCase();
      return "dola.com" === t || t.endsWith(".dola.com");
    } catch {
      return !1;
    }
  }
  let l = !1;
  function s() {
    const t = document.querySelector('[data-input-engine-actionbar-control-key="video-model"], [data-input-engine-actionbar-control-key="model"]'),
      e = String(t?.textContent || t?.innerText || "").replace(/\s+/g, " ").trim();
    return e && (l = /2\.5|seedance[^\d]*2[^\d]*5/i.test(e)), l;
  }
  function d() {
    try {
      return "1" === localStorage.getItem(n);
    } catch {
      return !1;
    }
  }
  function f() {
    return d() || function () {
      try {
        return "30" === localStorage.getItem(e);
      } catch {
        return !1;
      }
    }();
  }
  function y(t, e = 0) {
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
    for (const o of Array.isArray(t) ? t : Object.values(t)) o && "object" == typeof o && y(o, e + 1) && (n = !0);
    return n;
  }
  function p(t, n) {
    let o = "";
    try {
      o = localStorage.getItem(e) || "";
    } catch {}
    const r = "30" === o;
    if (!r && !d() || !s() || "string" != typeof t || !t.trim() || !a(n)) return t;
    try {
      const n = JSON.parse(t);
      return y(n) ? (r && localStorage.removeItem(e), JSON.stringify(n)) : t;
    } catch {
      return t;
    }
  }
  let m = null;
  function _() {
    if (m) return !0;
    const t = window.fetch,
      e = "function" == typeof window.Request ? window.Request : null,
      n = "function" == typeof XMLHttpRequest ? XMLHttpRequest.prototype : null,
      o = n?.open,
      r = n?.send;
    if ("function" != typeof t && "function" != typeof e && "function" != typeof r) return !1;
    let i = null,
      u = null,
      l = null,
      y = null;
    const _ = () => {
        i && window.fetch === i && (window.fetch = t), u && window.Request === u && (window.Request = e), l && n?.open === l && (n.open = o), y && n?.send === y && (n.send = r), m === _ && (m = null);
      },
      h = () => {
        d() || setTimeout(_, 0);
      };
    return m = _, "function" == typeof t && (i = function (n, o) {
      const r = o?.body;
      if (void 0 === r && n && "function" == typeof n.clone && a(n) && f() && s()) {
        const r = this;
        return n.clone().text().then(i => {
          const a = p(i, c(n));
          if (a === i) throw new Error("Dola Seedance 2.5 \u7684 30s \u8bf7\u6c42\u6b63\u6587\u672a\u80fd\u6539\u5199\uff0c\u5df2\u505c\u6b62\u63d0\u4ea4");
          const u = new e(n, {
              ...o,
              body: a
            }),
            l = t.call(r, u);
          return h(), l;
        }, () => {
          throw new Error("Dola Seedance 2.5 \u7684 30s \u8bf7\u6c42\u6b63\u6587\u65e0\u6cd5\u8bfb\u53d6\uff0c\u5df2\u505c\u6b62\u63d0\u4ea4");
        });
      }
      const i = p(r, c(n));
      if (i === r) return arguments.length > 1 ? t.call(this, n, o) : t.call(this, n);
      const u = t.call(this, n, {
        ...o,
        body: i
      });
      return h(), u;
    }, window.fetch = i), "function" == typeof e && (u = function (t, n) {
      const o = n?.body,
        r = p(o, c(t)),
        i = arguments.length > 1 ? new e(t, r === o ? n : {
          ...n,
          body: r
        }) : new e(t);
      return r !== o && h(), i;
    }, Object.setPrototypeOf(u, e), u.prototype = e.prototype, window.Request = u), "function" == typeof o && (l = function (t, e) {
      return this.__dbmDolaDurationRequestUrl = c(e), o.apply(this, arguments);
    }, n.open = l), "function" == typeof r && (y = function (t) {
      const e = p(t, this.__dbmDolaDurationRequestUrl || ""),
        n = r.call(this, e);
      return e !== t && h(), n;
    }, n.send = y), !0;
  }
  function h() {
    if (!window.__DBM_DOLA_DURATION_MENU_ENHANCEMENT__ && u() && "function" == typeof document?.querySelectorAll && (window.__DBM_DOLA_DURATION_MENU_ENHANCEMENT__ = !0, window.__DBM_DOLA_SELECT_AUTOMATED_DURATION_30__ = () => {
      if (!s()) return !1;
      const t = Array.from(document.querySelectorAll(r)).find(t => c(t));
      if (!t) return !1;
      try {
        localStorage.setItem(e, "30");
      } catch {
        return !1;
      }
      if (!_()) {
        try {
          localStorage.removeItem(e);
        } catch {}
        return !1;
      }
      return E(t), g(t), !0;
    }, document.addEventListener("click", t => {
      const e = t.target?.closest?.(r);
      e && E(e);
      const n = t.target?.closest?.("#flow-end-msg-send");
      n && d() && _();
    }, !0), t)) {
      const t = Array.from(document.querySelectorAll(r)).find(t => c(t));
      t && E(t);
    }
    function c(t) {
      if (!t?.isConnected || "function" != typeof getComputedStyle) return !1;
      const e = getComputedStyle(t);
      if ("none" === e.display || "hidden" === e.visibility || 0 === Number(e.opacity)) return !1;
      const n = t.getBoundingClientRect();
      return n.width > 2 && n.height > 2;
    }
    function a(t) {
      const e = function (t) {
        return String(t?.innerText || t?.textContent || "").replace(/\s+/g, "").replace(/[\u2713\u2714\u221a]/g, "").trim();
      }(t).match(/^(5|10|15|30)(s|\u79d2)$/i);
      return e ? Number(e[1]) : 0;
    }
    function l(t) {
      return Array.from(t?.querySelectorAll?.('[role="menuitem"], [role="option"], li, button, div') || []).filter(e => e !== t && c(e) && a(e) > 0);
    }
    function y(t, e) {
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
    function p(t, e) {
      t?.setAttribute?.("aria-selected", e ? "true" : "false"), e ? t?.setAttribute?.("data-state", "checked") : t?.removeAttribute?.("data-state");
      for (const n of Array.from(t?.querySelectorAll?.("svg") || [])) n.style.visibility = e ? "visible" : "hidden";
    }
    function h(t) {
      try {
        localStorage.setItem(n, t ? "1" : "0");
      } catch {}
      t ? _() : m?.();
    }
    function b(t) {
      const e = s() && f();
      for (const n of l(t)) {
        const t = a(n);
        e ? p(n, 30 === t) : "30" === n.getAttribute(o) && p(n, !1);
      }
    }
    function w(t) {
      s() && f() && t?.matches?.(r) && c(t) && y(t, 30);
    }
    function g(t) {
      for (const e of [0, 50, 120, 300]) setTimeout(() => w(t), e);
    }
    function A(t) {
      const n = function (t) {
        const e = [],
          n = t?.getAttribute?.("aria-controls") || "";
        n && "function" == typeof document.getElementById && e.push(document.getElementById(n)), e.push(...Array.from(document.querySelectorAll(i)));
        const o = t?.getBoundingClientRect?.();
        return Array.from(new Set(e)).filter(t => t && c(t)).filter(t => {
          const e = new Set(l(t).map(a));
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
      if (!n || !s()) return;
      let r = l(n);
      if (r.length) {
        if (!r.some(t => 30 === a(t))) {
          const e = r.find(t => 10 === a(t)) || r[0];
          if (!e?.parentElement) return;
          const i = e.cloneNode(!0);
          i.removeAttribute("aria-selected"), i.removeAttribute("data-state"), i.setAttribute(o, "30"), i.setAttribute("aria-selected", "false"), i.style.marginLeft = "6px", i.style.border = "1px solid rgba(99,102,241,.55)", i.style.background = "rgba(99,102,241,.12)", y(i, 30), p(i, !1), i.addEventListener("click", e => {
            e.preventDefault(), e.stopPropagation(), h(!0), b(n), g(t), setTimeout(() => {
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
        r = l(n);
        for (const t of r) {
          const n = a(t);
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
    function E(t) {
      if (t && s()) for (const e of [0, 50, 120, 300]) setTimeout(() => A(t), e);
    }
  }
  window.__DBM_DOLA_ENABLE_DURATION_INTERCEPTOR__ = _, u() && d() && _(), "function" == typeof setTimeout && "function" == typeof document?.querySelectorAll && ("loading" === document.readyState ? document.addEventListener("DOMContentLoaded", h, {
    once: !0
  }) : setTimeout(h, 0));
}
module.exports = {
  installDolaDurationRequestPatch: t
};
