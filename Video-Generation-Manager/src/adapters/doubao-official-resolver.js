!function () {
  const t = "2026-10-22-local-v24-watermark-check";
  if (window.__AIAM_DOUBAO_CREATION_DOWNLOAD__ === t) return;
  if (window.__AIAM_DOUBAO_CREATION_DOWNLOAD__ = t, !/(^|\.)doubao\.com$/i.test(location.hostname)) return;
  const e = "aiam-doubao-creation-download-style",
    n = "aiam-doubao-creation-panel",
    o = "aiam-doubao-creation-status",
    r = "aiam-doubao-creation-hit",
    i = "dbm-doubao-no-watermark-download";
  let a = !1,
    s = null,
    c = {
      time: 0,
      nodes: []
    },
    d = [];
  function u() {
    if (document.getElementById(e)) return;
    const t = document.createElement("style");
    t.id = e, t.textContent = `\n      .${n} {\n        position: fixed !important;\n        right: 24px !important;\n        top: 82px !important;\n        z-index: 2147483647 !important;\n        display: flex !important;\n        align-items: center !important;\n        gap: 8px !important;\n        padding: 8px !important;\n        border-radius: 12px !important;\n        background: rgba(255,255,255,.96) !important;\n        color: #111827 !important;\n        box-shadow: 0 12px 32px rgba(15,23,42,.18) !important;\n        border: 1px solid rgba(15,23,42,.08) !important;\n        font-size: 13px !important;\n      }\n      .${n} button {\n        height: 32px !important;\n        padding: 0 12px !important;\n        border: none !important;\n        border-radius: 999px !important;\n        background: #111827 !important;\n        color: #fff !important;\n        font-size: 13px !important;\n        font-weight: 700 !important;\n        cursor: pointer !important;\n      }\n      .${n} span { color: #64748b !important; white-space: nowrap !important; }\n      .${o} {\n        position: fixed !important;\n        right: 24px !important;\n        top: 132px !important;\n        z-index: 2147483647 !important;\n        max-width: 420px !important;\n        padding: 9px 13px !important;\n        border-radius: 999px !important;\n        background: rgba(17,24,39,.92) !important;\n        color: #fff !important;\n        font-size: 13px !important;\n        line-height: 1.35 !important;\n        pointer-events: none !important;\n        box-shadow: 0 10px 26px rgba(0,0,0,.24) !important;\n      }\n      .${r} {\n        outline: 3px solid #2563eb !important;\n        outline-offset: -3px !important;\n        box-shadow: inset 0 0 0 9999px rgba(37,99,235,.10) !important;\n      }\n      html.aiam-doubao-creation-select * { cursor: crosshair !important; }\n      .${i} {\n        position: absolute !important;\n        right: 12px !important;\n        bottom: 12px !important;\n        z-index: 2147483646 !important;\n        min-width: 104px !important;\n        height: 34px !important;\n        padding: 0 13px !important;\n        border: 1px solid rgba(255,255,255,.34) !important;\n        border-radius: 999px !important;\n        background: rgba(12,18,28,.88) !important;\n        color: #8ff0ce !important;\n        box-shadow: 0 6px 18px rgba(0,0,0,.28) !important;\n        backdrop-filter: blur(8px) !important;\n        font: 600 13px/32px "Microsoft YaHei UI",sans-serif !important;\n        cursor: pointer !important;\n      }\n      .${i}:hover { background: rgba(24,78,63,.94) !important; }\n      .${i}:disabled { cursor: wait !important; opacity: .78 !important; }\n    `, document.documentElement.appendChild(t);
  }
  function l(t) {
    u();
    let e = document.querySelector(`.${o}`);
    e || (e = document.createElement("div"), e.className = o, document.documentElement.appendChild(e)), e.textContent = t, clearTimeout(e.__timer), e.__timer = setTimeout(() => e.remove(), 3200);
  }
  function m(t) {
    return new Promise(e => setTimeout(e, t));
  }
  function p(t) {
    a = Boolean(t), document.documentElement.classList.toggle("aiam-doubao-creation-select", a), !a && s && (s.classList.remove(r), s = null), f(), a && l("\u8bf7\u9009\u62e9\u4e00\u4e2a\u8c46\u5305 AI \u521b\u4f5c\u89c6\u9891\u5361\u7247");
  }
  function f() {
    const t = document.querySelector(`.${n}`);
    if (!t) return;
    const e = t.querySelector("button"),
      o = t.querySelector("span");
    e && (e.textContent = a ? "\u9009\u62e9\u4e2d..." : "\u9009\u62e9\u89c6\u9891\u4e0b\u8f7d\u539f\u89c6\u9891"), o && (o.textContent = a ? "\u73b0\u5728\u70b9\u4e00\u4e2a\u89c6\u9891\u4f5c\u54c1" : "\u53ea\u4e0b\u8f7d\u660e\u786e\u65e0\u6c34\u5370\u7684\u89c6\u9891\u5b57\u6bb5");
  }
  function g(t) {
    if (!t || !t.isConnected) return !1;
    const e = t.getBoundingClientRect(),
      n = getComputedStyle(t);
    return e.width >= 48 && e.height >= 48 && e.bottom > 0 && e.right > 0 && e.top < window.innerHeight && e.left < window.innerWidth && "none" !== n.display && "hidden" !== n.visibility;
  }
  function h(t) {
    let e = t,
      n = t,
      o = Number.POSITIVE_INFINITY;
    for (let t = 0; e && e !== document.body && t < 10; t += 1) {
      if (g(e)) {
        const t = e.getBoundingClientRect();
        if (t.width >= 120 && t.height >= 120 && t.width <= 680 && t.height <= 680) {
          const r = t.width * t.height;
          r < o && (n = e, o = r);
        }
      }
      e = e.parentElement;
    }
    return n;
  }
  function _(t) {
    const e = (document.elementsFromPoint?.(t.clientX, t.clientY) || []).filter(t => t instanceof Element && !t.closest(`.${n},.${o}`) && ("VIDEO" === t.tagName || "IMG" === t.tagName ? g(t) : !(!t.querySelector?.("video,img") || !g(t)))),
      r = e.find(t => {
        const e = String(t.currentSrc || t.src || "");
        return ("VIDEO" === t.tagName || "IMG" === t.tagName) && e && !e.startsWith("data:");
      }) || e[0];
    return r ? h(r) : null;
  }
  function w(t) {
    const e = [],
      n = new WeakSet();
    let o = t;
    for (; o && o !== document.documentElement;) {
      const t = Object.keys(o).find(t => t.startsWith("__reactFiber") || t.startsWith("__reactProps"));
      let r = t ? o[t] : null,
        i = 0;
      for (; r && i < 80;) i += 1, y(r.memoizedProps || r.pendingProps || r, e, n, 0), r = r.return;
      o = o.parentElement;
    }
    return e;
  }
  function y(t, e, n, o) {
    if (!t || "object" != typeof t || o > 5 || n.has(t)) return;
    n.add(t);
    const r = Object.keys(t),
      i = r.join(" ").toLowerCase();
    /video|media|creation|item|work|asset|download|origin|original|play|url/.test(i) && e.push(t);
    for (const i of r.slice(0, 80)) {
      const r = t[i];
      r && "object" == typeof r && y(r, e, n, o + 1);
    }
  }
  function b(t) {
    if ("string" != typeof t) return "";
    const e = t.trim().replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
    return /^https?:\/\//i.test(e) ? e : "";
  }
  function S(t) {
    const e = b(t);
    if (!e) return "";
    try {
      const t = new URL(e, location.href);
      return decodeURIComponent(t.pathname).replace(/~[^/]*$/, "").toLowerCase();
    } catch (t) {
      return e.split("?")[0].replace(/~[^/]*$/, "").toLowerCase();
    }
  }
  function k(t, e) {
    const n = `${e} ${t}`.toLowerCase();
    let o = 0;
    return /no[_-]?watermark|without[_-]?watermark|logo_type=no_watermark|watermark=false/.test(n) && (o += 200), /origin|original|source|raw|master|download/.test(n) && (o += 80), /main_url|play_url|video_url/.test(n) && (o += 30), /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(t) && (o += 20), /backup|thumb|cover|poster|preview/.test(n) && (o -= 40), o;
  }
  function v(t) {
    const e = String(t || "");
    if (/^https?:\/\//i.test(e)) return e;
    try {
      const t = performance.getEntriesByType?.("resource") || [];
      for (const n of t.slice().reverse()) {
        const t = String(n.name || "");
        if (t.includes(e)) return t;
      }
      const n = t.slice().reverse().find(t => /\/samantha\//.test(String(t.name || "")));
      if (n?.name) {
        const t = new URL(n.name);
        return t.pathname = e, t.href;
      }
    } catch (t) {}
    return e;
  }
  function I(t, e, n, o, r = 0, i = !1) {
    if (!(r > 12 || null == t)) {
      if ("string" == typeof t) {
        const o = b(t);
        if (!o || !function (t, e) {
          return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(t) || /\/video\//i.test(t) || /video|play_url|main_url|backup_url|download_url|source_url|origin_url|original_url|raw_url|master_url/i.test(e);
        }(o, e)) return;
        const r = function (t, e) {
          const n = function (t, e) {
            const n = `${e} ${t}`.toLowerCase();
            return /video_gen_watermark_dyn|with_watermark=1|with_watermark=true|wm=1|watermark=true|no_watermark=false|aigc_busi_mark|aigc_resize_mark/.test(n) ? "watermark-signal" : /thumb|cover|poster|preview/.test(n) && !/download|origin|original|source|raw|master/i.test(n) ? "preview-only" : "";
          }(t, e);
          return {
            url: t,
            path: e,
            score: k(t, e),
            rejectReason: n,
            accepted: !n
          };
        }(o, e);
        if (!i && !r.accepted) return;
        return void n.push(r);
      }
      if (Array.isArray(t)) t.forEach((t, a) => I(t, `${e}[${a}]`, n, o, r + 1, i));else if ("object" == typeof t && !o.has(t)) {
        o.add(t);
        for (const [a, s] of Object.entries(t)) I(s, e ? `${e}.${a}` : a, n, o, r + 1, i);
      }
    }
  }
  function x(t, e, n, o = 0) {
    if (o > 8 || null == t || "object" != typeof t || n.has(t)) return;
    n.add(t);
    const r = t.node_id || t.nodeId || t.node_id_str || t.nodeIdStr,
      i = t.id && "string" == typeof t.key && /^v\d/i.test(t.key) ? t.id : "";
    if (/^\d{8,}$/.test(String(r || "")) && e.push(String(r)), /^\d{8,}$/.test(String(i || "")) && e.push(String(i)), Array.isArray(t)) t.forEach(t => x(t, e, n, o + 1));else for (const r of Object.values(t).slice(0, 140)) x(r, e, n, o + 1);
  }
  function $(t, e, n, o = 0) {
    if (o > 8 || null == t || "object" != typeof t || n.has(t)) return;
    n.add(t);
    const r = t.message_id || t.messageId || t.message_id_str || t.messageIdStr;
    /^\d{8,}$/.test(String(r || "")) && e.push(String(r));
    for (const [r, i] of Object.entries(t)) {
      const t = "string" == typeof i || "number" == typeof i ? String(i) : "";
      t && t.length <= 180 && /(^|_|\b)(message_id|messageid|msg_id|msgid|creation_task_id|creationtaskid|task_id|taskid)(_|$|\b)/i.test(r) && e.push(t.trim()), i && "object" == typeof i && $(i, e, n, o + 1);
    }
  }
  function E(t, e, n, o = 0) {
    if (o > 8 || null == t || "object" != typeof t || n.has(t)) return;
    n.add(t);
    const r = t.node_id_str || t.nodeIdStr || t.node_id || t.nodeId;
    /^\d{8,}$/.test(String(r || "")) && e.push(String(r));
    for (const [r, i] of Object.entries(t)) {
      const t = "string" == typeof i || "number" == typeof i ? String(i) : "";
      t && t.length <= 180 && /(^|_|\b)(node_id|nodeid)(_|$|\b)/i.test(r) && e.push(t.trim()), i && "object" == typeof i && E(i, e, n, o + 1);
    }
  }
  async function A(t) {
    const e = z((t || []).map(t => String(t || "").trim()).filter(t => /^\d{8,}$/.test(t)), t => t, 40);
    if (!e.length) return [];
    const n = await fetch(v("/samantha/aispace/message_node_info"), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "agw-js-conv": "str",
          origin: location.origin,
          referer: location.href
        },
        credentials: "include",
        body: '{"message_ids":['+e.join(',')+'],"message_ids_str":'+JSON.stringify(e)+'}'
      }),
      o = await n.json();
    window.__LOCAL_MESSAGE_NODE_DEBUG__={status:n.status,code:o.code,message:o.msg||o.message||'',keys:Object.keys(o),dataKeys:Object.keys(o.data||{}),data:o.data};
    if (0 !== o.code) return [];
    const r = [];
    E(o?.data||o,r,new WeakSet());return z(r,t=>t,40);
  }
  async function O(t, e) {
    const n = await fetch(v(t), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "agw-js-conv": "str",
          origin: location.origin,
          referer: location.href
        },
        credentials: "include",
        body: JSON.stringify(e || {})
      }),
      o = await n.json();
    if (0 !== o.code) throw new Error(o.msg || o.message || `\u63a5\u53e3\u8fd4\u56de ${o.code}`);
    return o;
  }
  function C(t, e, n, o = 0) {
    if (o > 10 || !t || "object" != typeof t || n.has(t)) return;
    n.add(t);
    const r = null != t.id ? String(t.id) : "",
      i = null != t.key ? String(t.key) : "",
      a = null != t.name ? String(t.name) : "";
    if (/^\d{8,}$/.test(r) && (i || a || t.node_type)) {
      const n = [],
        o = t.node_cover || t.nodeCover || {},
        s = o?.list_view?.cover_url || o?.listView?.coverUrl || "",
        c = o?.thumbnail_view?.cover_url || o?.thumbnailView?.coverUrl || "";
      s && n.push(String(s)), c && n.push(String(c)), e.push({
        id: r,
        key: i,
        name: a,
        nodeType: Number(t.node_type || t.nodeType || 0),
        messageId: String(t?.content?.message_id_str || t?.content?.message_id || ""),
        creationTaskId: String(t?.content?.creation_task_id_str || ""),
        coverUrl: n[0] || "",
        width: Number(t?.content?.width || t.width || 0),
        height: Number(t?.content?.height || t.height || 0),
        duration: Number(t?.content?.duration || t.duration || 0),
        size: Number(t.size || t?.content?.size || 0),
        coverKeys: z(n.map(S), t => t, 8)
      });
    }
    if (Array.isArray(t)) t.forEach(t => C(t, e, n, o + 1));else for (const r of Object.values(t).slice(0, 160)) r && "object" == typeof r && C(r, e, n, o + 1);
  }
  async function N(t = {}) {
    if (!Boolean(t.force) && Date.now() - c.time < 45e3 && c.nodes.length) return c.nodes;
    const e = await O("/samantha/aispace/homepage", {}),
      n = [];
    C(e?.data || e, n, new WeakSet());
    const o = n.find(t => /\u6211\u7684\u521b\u4f5c|\u93b4\u6220\u6b91\u9352\u6d97\u7d94/.test(String(t.name || ""))) || n.find(t => 1 === t.nodeType && t.key === t.id) || n[0];
    if (!o?.id) return [];
    d = [];
    const r = async (t = 1) => {
      const e = [];
      let n = "";
      for (let r = 0; r < 8; r += 1) {
        const i = {
          node_id: o.id,
          need_full_path: !0,
          sort_param: {
            need_sort_config: !0,
            sort_order: 1,
            sort_type: 0
          },
          size: 50
        };
        n && (i.cursor = n, i.next_cursor_with_sort = n);
        const a = await O("/samantha/aispace/node_info", i),
          s = e.length;
        C(a?.data || a, e, new WeakSet());
        const c = a?.data || {};
        if (d.push({
          page: 1 === t ? r + 1 : `retry_${t}_${r + 1}`,
          sentCursor: n,
          added: e.length - s,
          hasMore: Boolean(c.has_more),
          nextCursor: String(c.next_cursor || c.nextCursor || "")
        }), n = String(c.next_cursor || c.nextCursor || ""), !c.has_more || !n) break;
        if (e.some(R)) break;
      }
      return z(e, t => t.id, 200);
    };
    let i = [];
    for (let t = 1; t <= 4 && (i = await r(t), !i.some(R)) && T().length; t += 1) d.push({
      page: `wait_video_nodes_${t}`,
      sentCursor: "",
      added: 0,
      hasMore: !1,
      nextCursor: ""
    }), await m(1800);
    const a = i.some(R) ? i : await async function (t = 10) {
      const e = [],
        n = [{
          nodeType: 6,
          size: Math.max(50, t)
        }, {
          node_type: 6,
          size: Math.max(50, t)
        }];
      for (const o of n) try {
        const n = await O("/samantha/aispace/node_lastest_used", o);
        C(n?.data || n, e, new WeakSet());
        const r = z(e.filter(R), t => t.id, t);
        if (d.push({
          page: "latest_used_" + (null != o.nodeType ? "nodeType" : "node_type"),
          sentCursor: "",
          added: r.length,
          hasMore: Boolean(n?.data?.has_more || n?.data?.hasMore),
          nextCursor: String(n?.data?.next_cursor || n?.data?.nextCursor || "")
        }), r.length) return r;
      } catch (t) {
        d.push({
          page: "latest_used_error_" + (null != o.nodeType ? "nodeType" : "node_type"),
          sentCursor: "",
          added: 0,
          hasMore: !1,
          nextCursor: "",
          error: t.message || String(t)
        });
      }
      return [];
    }(10);
    return c = {
      time: Date.now(),
      nodes: a
    }, c.nodes;
  }
  function T(t = 30) {
    const e = Array.from(document.querySelectorAll("img,video,source")).filter(g),
      n = [];
    for (const o of e) {
      const e = [o.currentSrc, o.src, o.poster, String(o.srcset || o.srcSet || "").split(",")[0]?.trim()?.split(/\s+/)[0]];
      for (const t of e) {
        const e = S(t || "");
        e && /tos-cn-p-9ecd54|tplv-noop|videoweb/i.test(String(t || "")) && n.push(e);
      }
      if (n.length >= t) break;
    }
    return z(n, t => t, t);
  }
  function M(t) {
    const e = function (t = 30) {
      const e = T(t);
      if (e.length) return e;
      const n = Array.from(document.querySelectorAll("img,video,source")).filter(g),
        o = [];
      for (const e of n) {
        const n = [e.currentSrc, e.src, e.poster, String(e.srcset || e.srcSet || "").split(",")[0]?.trim()?.split(/\s+/)[0]];
        for (const t of n) {
          const e = S(t || "");
          e && o.push(e);
        }
        if (o.length >= t) break;
      }
      return z(o, t => t, t);
    }();
    return e.length ? t.slice().sort((t, n) => {
      const o = Math.min(...(t.coverKeys || []).map(t => e.indexOf(t)).filter(t => t >= 0), Number.POSITIVE_INFINITY),
        r = Math.min(...(n.coverKeys || []).map(t => e.indexOf(t)).filter(t => t >= 0), Number.POSITIVE_INFINITY);
      return o !== r ? o - r : 0;
    }) : t;
  }
  function U(t) {
    const e = String(t || "").toLowerCase();
    if (!e || /video_gen_watermark_dyn|with_watermark=(?:1|true)|watermark=true|no_watermark=false/i.test(e)) return !1;
    try {
      const e = new URL(t, location.href);
      if (/(^|[.-])videoweb-download\.doubao\.com$/i.test(e.hostname) && "true" === e.searchParams.get("download")) return !0;
      if (/(^|[.-])videoweb\.doubao\.com$/i.test(e.hostname) && "true" === e.searchParams.get("download")) return !0;
      if (e.hostname.includes("doubao.com") && e.pathname.includes("/download") && "true" === e.searchParams.get("download")) return !0;
    } catch (t) {}
    return /download=true/.test(e) && /video_mp4|mime_type=video_mp4/.test(e);
  }
  async function j(t) {
    const e = String(t || "").trim();
    if (!/^\d{8,}$/.test(e)) throw new Error("\u7f3a\u5c11\u4f5c\u54c1\u8282\u70b9ID");
    const n = await fetch(v("/samantha/aispace/get_download_info"), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "agw-js-conv": "str",
          origin: location.origin,
          referer: location.href
        },
        credentials: "include",
        body: JSON.stringify({
          requests: [{
            node_id: e
          }]
        })
      }),
      o = await n.json();
    if (0 !== o.code) throw new Error(o.msg || `\u63a5\u53e3\u8fd4\u56de ${o.code}`);
    const r = o?.data?.download_infos?.[0],
      i = r?.main_url || r?.mainUrl || "",
      a = r?.backup_url || r?.backupUrl || "";
    if (!i) throw new Error("\u63a5\u53e3\u6ca1\u6709\u8fd4\u56de\u89c6\u9891\u4e0b\u8f7d\u5730\u5740");
    if (!U(i)) throw new Error("\u63a5\u53e3\u8fd4\u56de\u7684\u4e0d\u662f\u786e\u8ba4\u65e0\u6c34\u5370\u4e0b\u8f7d\u6d41");
    return {
      mainUrl: i,
      backupUrl: a,
      nodeId: e
    };
  }
  async function D(t) {
    const e = z((t || []).map(t => String(t || "").trim()).filter(t => /^\d{8,}$/.test(t)), t => t, 80);
    if (!e.length) return [];
    const n = [];
    for (const t of e) try {
      const e = await j(t);
      n.push({
        nodeId: t,
        mainUrl: e.mainUrl,
        backupUrl: e.backupUrl || "",
        ok: !0
      });
    } catch (e) {
      n.push({
        nodeId: t,
        mainUrl: "",
        backupUrl: "",
        ok: !1,
        error: e?.message || String(e)
      });
    }
    return n;
  }
  function R(t) {
    return !!t && (6 === t.nodeType || /^v\d/i.test(String(t.key || "")) || /\.mp4$/i.test(String(t.name || "")));
  }
  function B(t, e) {
    const n = String(t?.name || "").replace(/\s+/g, " ").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim().slice(0, 48);
    return n && !/^video(?:\.mp4)?$/i.test(n) ? `\u8c46\u5305\u521b\u4f5c_${n}` : `\u8c46\u5305\u521b\u4f5c\u539f\u89c6\u9891_${String(e + 1).padStart(3, "0")}`;
  }
  function L(t, e, n, o, r = 0) {
    if (!(r > 8 || null == t || "object" != typeof t || o.has(t))) {
      o.add(t);
      for (const [i, a] of Object.entries(t)) {
        const t = e ? `${e}.${i}` : i;
        if (null != a && /(^|_|\b)(id|item|item_id|itemid|creation|creation_id|media|media_id|vid|video|video_id|task|task_id|key)(_|$|\b)/i.test(i)) {
          const e = "string" == typeof a || "number" == typeof a ? String(a) : "";
          e && e.length <= 180 && n.push({
            path: t,
            value: e
          });
        }
        a && "object" == typeof a && L(a, t, n, o, r + 1);
      }
    }
  }
  function W(t, e, n, o = 0) {
    if (o > 8 || null == t || "object" != typeof t || n.has(t)) return;
    n.add(t);
    const r = {
      type: "string" == typeof t.type ? t.type : "",
      id: null != t.id ? String(t.id) : "",
      nodeId: null != t.nodeId ? String(t.nodeId) : null != t.node_id ? String(t.node_id) : "",
      key: null != t.key ? String(t.key) : "",
      uri: null != t.uri ? String(t.uri) : "",
      name: null != t.name ? String(t.name).slice(0, 120) : "",
      title: null != t.title ? String(t.title).slice(0, 120) : ""
    };
    if ((/^(image|video|audio|file)$/i.test(r.type) || r.nodeId || r.uri || r.key) && (r.id || r.nodeId || r.uri || r.key) && e.push(r), Array.isArray(t)) t.forEach(t => W(t, e, n, o + 1));else for (const r of Object.values(t).slice(0, 120)) r && "object" == typeof r && W(r, e, n, o + 1);
  }
  function P(t, e = 40) {
    const n = [],
      o = [];
    for (const e of t || []) x(e, n, new WeakSet()), W(e, o, new WeakSet());
    for (const t of o) /^\d{8,}$/.test(String(t.nodeId || "")) && n.push(String(t.nodeId)), /^\d{8,}$/.test(String(t.id || "")) && /^v\d/i.test(String(t.key || "")) && n.push(String(t.id));
    return z(n, t => t, e);
  }
  function q() {
    const t = Array.from(document.querySelectorAll("video,img")).filter(g).sort((t, e) => {
        const n = "VIDEO" === t.tagName ? 1 : 0,
          o = "VIDEO" === e.tagName ? 1 : 0;
        if (n !== o) return o - n;
        const r = t.getBoundingClientRect(),
          i = e.getBoundingClientRect();
        return i.width * i.height - r.width * r.height;
      }),
      e = [],
      n = new WeakSet();
    for (const o of t.slice(0, 24)) {
      const t = h(o);
      t && !n.has(t) && (n.add(t), e.push(...P(w(t), 20)), e.push(...P(w(o), 20)));
    }
    return z(e, t => t, 40);
  }
  async function V(t) {
    let e = null;
    for (const n of z(t || [], t => t, 50)) try {
      const t = await j(n);
      return K(t.mainUrl, t.backupUrl), l("\u5df2\u53d1\u9001\u8c46\u5305\u521b\u4f5c\u539f\u89c6\u9891\u4e0b\u8f7d"), {
        ok: !0,
        lastError: null
      };
    } catch (t) {
      e = t;
    }
    return {
      ok: !1,
      lastError: e
    };
  }
  function z(t, e, n = 80) {
    const o = [],
      r = new Set();
    for (const i of t) {
      const t = e(i);
      if (t && !r.has(t) && (r.add(t), o.push(i), o.length >= n)) break;
    }
    return o;
  }
  function K(t, e = "") {
    const n = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    window.postMessage({
      type: "electronDownload",
      data: {
        url: t,
        backupUrl: e,
        filename: `\u8c46\u5305_\u521b\u4f5c\u539f\u89c6\u9891_${n}.mp4`,
        type: "video",
        source: "doubao-creation-card",
        confirmedNoWatermark: !0
      }
    }, "*");
  }
  async function F(t) {
    const e = w(t),
      n = P(e, 30),
      o = z(e.flatMap(t => {
        const e = [];
        return $(t, e, new WeakSet()), e;
      }), t => t, 40);
    let r = null,
      i = [];
    try {
      i = await async function (t, e = []) {
        const n = await N(),
          o = function (t) {
            const e = [],
              n = [];
            let o = t;
            for (let t = 0; o && o !== document.body && t < 7; t += 1) n.push(o), o.querySelectorAll && n.push(...o.querySelectorAll("img,video,source")), o = o.parentElement;
            for (const t of n) {
              const n = S(t.currentSrc || t.src || t.poster || "");
              n && e.push(n);
              const o = String(t.srcset || t.srcSet || "");
              for (const t of o.split(",")) {
                const n = S(t.trim().split(/\s+/)[0]);
                n && e.push(n);
              }
            }
            return z(e, t => t, 20);
          }(t),
          r = new Set((e || []).map(t => String(t || "")));
        return z(n.filter(t => {
          const e = o.some(e => t.coverKeys?.includes(e)),
            n = t.messageId && r.has(t.messageId),
            i = t.creationTaskId && r.has(t.creationTaskId);
          return e || n || i;
        }).filter(t => 6 === t.nodeType || /^v\d/i.test(t.key) || /\.mp4$/i.test(t.name)).map(t => t.id), t => t, 20);
      }(t, o);
    } catch (t) {
      r = t;
    }
    const a = z([...i, ...n, ...q()], t => t, 50),
      s = await V(a);
    if (s.ok) return !0;
    r = s.lastError, await async function (t) {
      if (!t || !t.isConnected) return !1;
      p(!1);
      const e = t.querySelector?.("video,img") || t;
      e.scrollIntoView?.({
        block: "center",
        inline: "center"
      }), await m(350);
      const n = e.getBoundingClientRect(),
        o = n.left + n.width / 2,
        r = n.top + n.height / 2,
        i = {
          bubbles: !0,
          cancelable: !0,
          view: window,
          clientX: o,
          clientY: r
        };
      for (const t of ["pointerover", "mouseover", "mouseenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) e.dispatchEvent(new MouseEvent(t, i));
      return await m(2200), !0;
    }(t);
    const c = q().filter(t => !a.includes(t)),
      d = await V(c);
    if (d.ok) return !0;
    if (r = d.lastError || r, o.length) try {
      const t = await A(o);
      for (const e of t) if (!a.includes(e)) try {
        const t = await j(e);
        return K(t.mainUrl, t.backupUrl), l("\u5df2\u53d1\u9001\u8c46\u5305\u521b\u4f5c\u539f\u89c6\u9891\u4e0b\u8f7d"), !0;
      } catch (t) {
        r = t;
      }
    } catch (t) {
      r = t;
    }
    const u = function (t) {
      const e = [];
      for (const n of t) I(n, "", e, new WeakSet());
      const n = [],
        o = new Set();
      for (const t of e) o.has(t.url) || (o.add(t.url), n.push(t));
      return n.filter(t => t.accepted).sort((t, e) => e.score - t.score)[0] || null;
    }(e);
    return u?.url && U(u.url) ? (K(u.url), l("\u5df2\u53d1\u9001\u8c46\u5305\u521b\u4f5c\u539f\u89c6\u9891\u4e0b\u8f7d"), !0) : (l(`\u672a\u53d1\u73b0\u786e\u8ba4\u65e0\u6c34\u5370\u4e0b\u8f7d\u6d41\uff0c\u5df2\u505c\u6b62\u4e0b\u8f7d\uff08\u626b\u63cf ${e.length} \u7ec4\u5361\u7247\u6570\u636e\uff09${r ? `\uff1a${r.message || r}` : ""}`), !1);
  }
  function Y(t = document) {
    if (!window.__DBM_NO_WATERMARK_DOWNLOAD_HOST__) return;
    const e = Array.from(t.querySelectorAll?.("[data-message-id]") || []);
    t instanceof Element && t.matches("[data-message-id]") && e.unshift(t);
    for (const t of e) {
      if (t.querySelector(`.${i}`)) continue;
      const e = Array.from(t.querySelectorAll("video,img")).find(t => {
        const e = t.getBoundingClientRect(),
          n = String(t.currentSrc || t.src || t.poster || "");
        return e.width >= 220 && e.height >= 120 && /video|tos-cn-p-9ecd54|videoweb/i.test(n);
      });
      if (!e) continue;
      const n = e.closest('[class*="block-video"]') || e.parentElement;
      if (!n) continue;
      n.style.setProperty("position", "relative", "important");
      const o = document.createElement("button");
      o.type = "button", o.className = i, o.textContent = "\u65e0\u6c34\u5370\u4e0b\u8f7d", o.title = "\u89e3\u6790\u8c46\u5305\u5b98\u65b9\u65e0\u6c34\u5370\u539f\u7247\u94fe\u63a5\u5e76\u4e0b\u8f7d", o.addEventListener("click", async e => {
        if (e.preventDefault(), e.stopPropagation(), e.stopImmediatePropagation?.(), !o.disabled) {
          o.disabled = !0, o.textContent = "\u89e3\u6790\u4e2d\u2026";
          try {
            if (!(await F(t))) throw new Error("\u672a\u89e3\u6790\u5230\u5b98\u65b9\u65e0\u6c34\u5370\u539f\u7247");
            o.textContent = "\u4e0b\u8f7d\u4e2d\u2026";
          } catch (t) {
            o.textContent = "\u89e3\u6790\u5931\u8d25", l(t?.message || String(t)), setTimeout(() => {
              o.disabled = !1, o.textContent = "\u65e0\u6c34\u5370\u4e0b\u8f7d";
            }, 2600);
          }
        }
      }, !0), n.appendChild(o);
    }
  }
  function G() {
    window.__AIAM_DOUBAO_CREATION_SELECTION__ !== t && (window.__AIAM_DOUBAO_CREATION_SELECTION__ = t, document.addEventListener("mousemove", t => {
      if (!a) return;
      const e = _(t);
      e !== s && (s && s.classList.remove(r), s = e || null, s && s.classList.add(r));
    }, !0), document.addEventListener("click", async t => {
      if (!a) return;
      if (t.target?.closest?.(`.${n},.${o}`)) return;
      const e = _(t);
      e && (t.preventDefault(), t.stopPropagation(), t.stopImmediatePropagation?.(), await F(e), p(!1));
    }, !0));
  }
  function H() {
    if (!document.body) return setTimeout(H, 100);
    u(), G(), function () {
      if (!window.__DBM_NO_WATERMARK_DOWNLOAD_HOST__) return;
      Y(document);
      let t = 0;
      new MutationObserver(() => {
        clearTimeout(t), t = setTimeout(() => Y(document), 180);
      }).observe(document.documentElement, {
        childList: !0,
        subtree: !0
      }), window.addEventListener("message", t => {
        if (t.source !== window || "dbm:no-watermark-result" !== t.data?.type) return;
        const e = t.data.result || {};
        for (const t of document.querySelectorAll(`.${i}:disabled`)) t.textContent = e.ok ? "\u4e0b\u8f7d\u5b8c\u6210" : "\u4e0b\u8f7d\u5931\u8d25", e.ok || l(e.message || "\u5b98\u65b9\u65e0\u6c34\u5370\u539f\u7247\u4e0b\u8f7d\u5931\u8d25"), setTimeout(() => {
          t.disabled = !1, t.textContent = "\u65e0\u6c34\u5370\u4e0b\u8f7d";
        }, e.ok ? 1800 : 3e3);
      });
    }();
  }
  window.__AIAM_DOUBAO_CREATION_START_SELECT__ = () => (function () {
    u();
    let t = document.querySelector(`.${n}`);
    if (t) return f(), t;
    t = document.createElement("div"), t.className = n;
    const e = document.createElement("button");
    e.type = "button", e.textContent = "\u9009\u62e9\u89c6\u9891\u4e0b\u8f7d\u539f\u89c6\u9891", e.addEventListener("click", t => {
      t.preventDefault(), t.stopPropagation(), p(!a);
    }, !0);
    const o = document.createElement("span");
    o.textContent = "\u53ea\u4e0b\u8f7d\u660e\u786e\u65e0\u6c34\u5370\u7684\u89c6\u9891\u5b57\u6bb5", t.append(e, o), document.documentElement.appendChild(t);
  }(), G(), p(!0), !0), window.__AIAM_DOUBAO_CREATION_SCAN_TO_RESOURCE_PANEL__ = async function () {
    if (!/\/chat\/create-image/i.test(location.pathname) || !/(?:^|[?&])tab=myCreation(?:&|$)/i.test(location.search || "")) return l("\u6b63\u5728\u6253\u5f00\u8c46\u5305\u201c\u6211\u7684\u521b\u4f5c\u201d\u9875\u9762\uff0c\u8bf7\u7a0d\u540e\u518d\u70b9\u4e00\u6b21\u626b\u63cf"), location.href = "https://www.doubao.com/chat/create-image?tab=myCreation", {
      ok: !1,
      count: 0,
      navigated: !0
    };
    l("\u6b63\u5728\u626b\u63cf\u8c46\u5305\u6211\u7684\u521b\u4f5c\u89c6\u9891...");
    const t = M((await N({
        force: !0
      })).filter(R)),
      e = t.slice(0, 10);
    if (!e.length) return l("\u6ca1\u6709\u626b\u63cf\u5230\u8c46\u5305\u521b\u4f5c\u89c6\u9891\uff0c\u8bf7\u786e\u8ba4\u5f53\u524d\u5728\u201c\u6211\u7684\u521b\u4f5c\u201d\u9875\u9762"), {
      ok: !1,
      count: 0
    };
    const n = await D(e.map(t => t.id)),
      o = new Map(n.filter(t => t.ok).map(t => [t.nodeId, t])),
      r = [];
    return e.forEach((t, e) => {
      const n = o.get(t.id);
      n?.mainUrl && r.push({
        vid: t.key || t.id,
        nodeId: t.id,
        title: B(t, e),
        thumbUrl: t.coverUrl || "",
        videoUrl: n.mainUrl,
        backupUrl: n.backupUrl || "",
        width: t.width || 0,
        height: t.height || 0,
        source: "doubao-creation-resource-panel",
        replaceDoubaoCreationScan: !0,
        definition: "\u539f\u89c6\u9891",
        confirmedNoWatermark: !0
      });
    }), r.length ? (window.postMessage({
      type: "videoDataExtracted",
      data: r
    }, "*"), l(`\u5df2\u52a0\u5165\u53f3\u4fa7\u8d44\u6e90\u680f ${r.length} \u4e2a\u8c46\u5305\u6700\u65b0\u539f\u89c6\u9891\uff08\u6700\u591a 10 \u4e2a\uff09`), {
      ok: !0,
      count: r.length,
      totalVideoNodes: t.length,
      limit: 10
    }) : (l(`\u626b\u63cf\u5230 ${t.length} \u4e2a\u89c6\u9891\uff0c\u4f46\u6700\u65b0 ${e.length} \u4e2a\u6ca1\u6709\u660e\u786e\u65e0\u6c34\u5370\u4e0b\u8f7d\u6d41`), {
      ok: !1,
      count: 0
    });
  }, window.__AIAM_DOUBAO_CREATION_SCAN_DEBUG__ = async function () {
    const t = await N({
        force: !0
      }),
      e = M(t.filter(R)),
      n = e.slice(0, 10),
      o = await D(n.map(t => t.id));
    return {
      url: location.href,
      totalNodes: t.length,
      videoNodes: e.length,
      selectedVideoNodes: n.length,
      limit: 10,
      pages: d,
      sampleAllNodes: t.slice(0, 10).map(t => ({
        id: t.id,
        key: t.key,
        name: t.name,
        nodeType: t.nodeType,
        typeOfNodeType: typeof t.nodeType
      })),
      sampleNodes: n.slice(0, 5).map(t => ({
        id: t.id,
        key: t.key,
        name: t.name,
        nodeType: t.nodeType,
        coverUrl: t.coverUrl,
        coverKeys: t.coverKeys
      })),
      downloadInfos: o.map(t => ({
        nodeId: t.nodeId,
        ok: t.ok,
        error: t.error || "",
        mainUrl: String(t.mainUrl || "").slice(0, 220)
      }))
    };
  }, window.__AIAM_DOUBAO_CREATION_DUMP_VISIBLE__ = function () {
    return z(Array.from(document.querySelectorAll("video,img")).filter(g), t => {
      const e = t.getBoundingClientRect(),
        n = t.currentSrc || t.src || "";
      return `${t.tagName}:${Math.round(e.left)}:${Math.round(e.top)}:${Math.round(e.width)}:${Math.round(e.height)}:${n.slice(0, 120)}`;
    }, 80).map((t, e) => {
      const n = h(t),
        o = t.getBoundingClientRect(),
        r = n.getBoundingClientRect(),
        i = w(t),
        a = [],
        s = [],
        c = [];
      for (const t of i) I(t, "", a, new WeakSet(), 0, !0), L(t, "", s, new WeakSet()), W(t, c, new WeakSet());
      return {
        index: e,
        text: String(n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
        rect: {
          left: Math.round(o.left),
          top: Math.round(o.top),
          width: Math.round(o.width),
          height: Math.round(o.height)
        },
        cardRect: {
          left: Math.round(r.left),
          top: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height)
        },
        tagName: t.tagName,
        src: String(t.currentSrc || t.src || "").slice(0, 800),
        hasVideoElement: "VIDEO" === t.tagName || Boolean(n.querySelector("video")),
        hasImageElement: "IMG" === t.tagName || Boolean(n.querySelector("img")),
        recordCount: i.length,
        ids: z(s, t => `${t.path}:${t.value}`, 80),
        mediaRecords: z(c, t => `${t.type}:${t.id}:${t.nodeId}:${t.key}:${t.uri}`, 80),
        candidates: z(a, t => t.url, 80).sort((t, e) => Number(e.accepted) - Number(t.accepted) || e.score - t.score).map(t => ({
          path: t.path,
          score: t.score,
          accepted: t.accepted,
          rejectReason: t.rejectReason,
          url: t.url
        }))
      };
    });
  }, window.__AIAM_DOUBAO_CREATION_DUMP_VERSION__ = t, "loading" === document.readyState ? document.addEventListener("DOMContentLoaded", H, {
    once: !0
  }) : H();

  async function resolveMessageDownloads(ids){
    const results=[];
    for(const card of window.__LOCAL_DOUBAO_RESOLVER__.inspectMessages(ids))for(const vid of card.videoIds||[]){
      for(const endpoint of ['/samantha/video/get_play_info','/samantha/media/get_play_info']){
        try{const url=new URL(endpoint,location.origin);url.search='?aid=497858&device_platform=web&samantha_web=1&use-olympus-account=1&version_code=20800&pkg_type=release_version&web_tab_id='+crypto.randomUUID();const response=await fetch(url,{method:'POST',credentials:'include',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify(endpoint.includes('/media/')?{key:vid,media_type:'video'}:{vid}),signal:AbortSignal.timeout(8000)});const payload=await response.json();const candidates=[];I(payload.data,'data',candidates,new WeakSet(),0,true);results.push({messageId:card.id,vid,endpoint,status:response.status,code:payload.code,message:payload.msg||payload.message,data:payload.data,candidates:z(candidates,c=>c.url,20)});}catch(e){results.push({messageId:card.id,vid,endpoint,error:e.message});}
      }
    }
    return results;
  }
  // Rebuild API: only resolve node IDs belonging to the caller-selected message.
  window.__LOCAL_DOUBAO_RESOLVER__ = { nodesForMessages:A,downloadInfo:j,resolveMessageDownloads,debug:()=>({...window.__LOCAL_MESSAGE_NODE_DEBUG__,play:window.__LOCAL_PLAY_INFO_DEBUG__}), inspectMessages(ids){return ids.map(id=>{const root=document.querySelector('[data-message-id="'+id+'"]');if(!root)return {id,missing:true};const records=[],seen=new WeakSet();for(const element of [root,...root.querySelectorAll('video,img,[class*="video"],[class*="media"]')].slice(0,120)){for(const key of Object.keys(element).filter(k=>k.startsWith('__reactProps')||k.startsWith('__reactFiber'))){const fiber=element[key];const props=fiber?.memoizedProps||fiber?.pendingProps||fiber;records.push(props);y(props,records,seen,0);}}const nodes=P(records),media=[],candidates=[],identifiers=[];for(const record of records){W(record,media,new WeakSet());I(record,'',candidates,new WeakSet(),0,true);L(record,'',identifiers,new WeakSet());}return {id,nodes,videoIds:z(identifiers.map(x=>x.value).filter(x=>/^v[0-9a-zA-Z_-]{10,}$/.test(x)),x=>x,10),media:media.slice(0,30),candidates:z(candidates,c=>c.url,30),identifiers:z(identifiers,c=>c.path+':'+c.value,40),html:root.outerHTML.slice(0,14000)};});} };
}();
