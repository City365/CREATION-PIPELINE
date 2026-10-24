"use strict";

(() => {
  const e = window.CanvasModel,
    t = window.canvasAPI,
    n = e.createWorkspaceStorage(localStorage),
    o = e => document.getElementById(e),
    a = o("canvasViewport"),
    i = o("canvasWorld"),
    c = new Map(),
    s = new Map(),
    d = new Set(),
    r = new Map(),
    l = new Map(),
    p = e => JSON.parse(JSON.stringify(e));
  let u,
    m,
    h,
    f,
    v,
    g,
    y,
    x,
    M,
    b = !1,
    w = !1,
    k = "",
    E = !1,
    C = !1,
    S = "",
    I = [],
    z = {
      accounts: [],
      ready: !1,
      capabilities: {}
    },
    L = !1,
    N = !1,
    T = "",
    q = "boards",
    $ = "",
    D = !1,
    j = "",
    A = [],
    H = !1;
  const O = {
      text: "\u6587\u672c",
      image: "\u56fe\u7247",
      video: "\u89c6\u9891",
      audio: "\u97f3\u9891",
      config: "\u751f\u6210\u914d\u7f6e",
      account: "\u8d26\u53f7",
      group: "\u7ec4"
    },
    W = {
      panel: "M3 3h18v18H3zM9 3v18M6 8l-2 4 2 4",
      menu: "M4 6h16M4 12h16M4 18h16",
      cursor: "M4 3l6 17 3-7 7-3z",
      undo: "M9 5l-5 5 5 5M4 10h9a6 6 0 0 1 0 12",
      redo: "M15 5l5 5-5 5M20 10h-9a6 6 0 0 0 0 12",
      text: "M5 5h14M12 5v15M8 20h8",
      image: "M3 4h18v16H3zM3 16l6-6 5 5 3-3 4 4M15 8h.01",
      video: "M3 6h12v12H3zM15 10l6-3v10l-6-3",
      settings: "M3 7h8M15 7h6M3 17h3M10 17h11M11 4v6M6 14v6",
      account: "M8 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0M4 21v-3a8 8 0 0 1 16 0v3",
      group: "M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 8h8v8H8z",
      upload: "M12 17V3M7 8l5-5 5 5M4 15v6h16v-6",
      palette: "M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h5a3 3 0 0 0 3-3 9 9 0 0 0-9-7M7 9h.01M11 6h.01M16 7h.01M6 14h.01",
      erase: "M3 15l10-11 8 7-10 10H8zM10 10l8 8M10 21h11",
      keyboard: "M2 5h20v14H2zM5 9h1M9 9h1M13 9h1M17 9h1M5 12h1M9 12h1M13 12h1M17 12h1M6 16h12",
      map: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M16.24 7.76l-2.83 5.65-5.65 2.83 2.83-5.65z",
      fit: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
      copy: "M8 8h13v13H8zM16 8V3H3v13h5",
      folder: "M3 5h7l2 3h9v12H3zM12 12v5M9.5 14.5h5",
      trash: "M4 6h16M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
      info: "M12 8h.01M12 11v6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
      minus: "M5 12h14",
      plus: "M5 12h14M12 5v14",
      home: "M3 10l9-7 9 7M5 9v12h14V9M10 21v-7h4v7",
      download: "M12 3v13M7 11l5 5 5-5M4 17v4h16v-4",
      play: "M8 4l12 8-12 8z",
      audio: "M9 18V5l12-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3M21 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3",
      grid: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
      horizontal: "M3 4h18v16H3zM9 4v16M15 4v16",
      vertical: "M3 4h18v16H3zM3 9h18M3 15h18"
    };
  function F(e, t = {}) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", e);
    for (const [e, o] of Object.entries(t)) n.setAttribute(e, o);
    return n;
  }
  document.querySelectorAll("[data-icon]").forEach(e => {
    const t = F("svg", {
      viewBox: "0 0 24 24",
      width: 16,
      height: 16,
      "aria-hidden": "true"
    });
    t.append(F("path", {
      d: W[e.dataset.icon]
    })), e.append(t);
  });
  const B = () => crypto.randomUUID(),
    P = () => ({
      x: a.clientWidth / 2,
      y: a.clientHeight / 2
    }),
    R = e => {
      const t = a.getBoundingClientRect();
      return {
        x: e.clientX - t.left,
        y: e.clientY - t.top
      };
    },
    K = e => m.nodes.find(t => t.id === e),
    J = () => (s.has(m.id) || s.set(m.id, e.createHistory(m)), s.get(m.id));
  function V(e, t = !1) {
    o("canvasStatus").textContent = e, o("canvasStatus").classList.toggle("error", t);
  }
  function X(e) {
    try {
      const t = e();
      t?.catch && t.catch(e => V(e.message, !0));
    } catch (e) {
      V(e.message, !0);
    }
  }
  function U() {
    if (clearTimeout(h), b && w) try {
      n.save(u), w = !1, V(`\u5df2\u4fdd\u5b58 \xb7 ${m.nodes.length} \u5f20\u5361\u7247 \xb7 ${m.edges.length} \u6761\u8fde\u7ebf`);
    } catch (e) {
      V(`\u4fdd\u5b58\u5931\u8d25\uff1a${e.message}\uff0c\u539f\u6570\u636e\u5df2\u4fdd\u7559`, !0);
    }
  }
  function G() {
    w = !0, V("\u5f85\u4fdd\u5b58\u2026"), clearTimeout(h), h = setTimeout(U, 300), fe();
  }
  function Y(t, n = !0, o = "") {
    t = e.validateCanvas(t), n && J().record(t, o), u.canvases[u.canvases.findIndex(e => e.id === m.id)] = t, m = t;
    for (const e of d) K(e) || d.delete(e);
    m.edges.some(e => e.id === k) || (k = ""), G();
  }
  function _(e, t = "") {
    if (!b) return;
    const n = p(m);
    e(n), Y(n, !0, t);
  }
  function Z(t) {
    const n = J()[t](),
      o = new Map(n.nodes.filter(e => l.has(m.id + ":" + e.id)).map(e => [e.id, l.get(m.id + ":" + e.id)]));
    Y(e.restoreCanvasEdit(n, m, o), !1);
  }
  function Q(e, t = !1) {
    t || d.clear(), e.forEach(e => d.add(e)), k = "", D = !1, o("alignmentOptions").hidden = !0, ne(), fe();
  }
  function ee() {
    const e = new Set(d);
    for (const t of m.nodes) e.has(t.id) && "group" === t.type && t.members.forEach(t => e.add(t));
    return e;
  }
  function te() {
    const e = ee();
    return m.nodes.filter(t => e.has(t.id) && ("text" === t.type || ["image", "video", "audio"].includes(t.type) && t.source || "account" === t.type && t.accountId)).map(e => e.id);
  }
  function ne() {
    M = null, o("connectionMenu").hidden = !0;
  }
  function oe(t, n) {
    if (!b) return;
    const o = n || e.screenToWorld(P(), m.viewport),
      a = t.width || 340,
      i = t.height || ("account" === t.type ? 150 : 240),
      c = {
        ...t,
        id: B(),
        title: t.title || O[t.type],
        width: a,
        height: i,
        x: o.x - a / 2,
        y: o.y - i / 2
      };
    if (!n) {
      let e;
      do {
        e = m.nodes.find(e => "group" !== e.type && Math.abs(e.x - c.x) < Math.max(e.width, a) + 24 && Math.abs(e.y - c.y) < Math.max(e.height, i) + 24), e && (c.x = e.x + e.width + 40);
      } while (e);
    }
    return _(e => {
      e.nodes.push(c), n || (e.viewport.x = P().x - (c.x + a / 2) * e.viewport.zoom, e.viewport.y = P().y - (c.y + i / 2) * e.viewport.zoom);
    }), Q([c.id]), c.id;
  }
  function ae() {
    k ? (_(e => {
      e.edges = e.edges.filter(e => e.id !== k);
    }), k = "") : Y(e.removeNodes(m, [...d])), d.clear(), fe();
  }
  function ie(e, t, n, o) {
    const a = document.createElement("select");
    a.setAttribute("aria-label", n);
    for (const t of e) {
      const e = document.createElement("option");
      e.value = t.value, e.textContent = t.label, a.append(e);
    }
    return a.value = t, a.addEventListener("change", () => X(() => o(a.value))), a;
  }
  function ce(e, t, n) {
    const o = document.createElement("button");
    return o.textContent = e, o.setAttribute("aria-label", t), o.addEventListener("click", e => X(() => n(e))), o;
  }
  function se(e) {
    const t = F("svg", {
      viewBox: "0 0 24 24",
      width: 16,
      height: 16,
      "aria-hidden": "true"
    });
    return t.append(F("path", {
      d: W[e] || W.text
    })), t;
  }
  const de = e => e?.config || e?.generation,
    re = e => "dola" === e.platform && "dreamina-seedance2.5" === e.model || "doubao" === e.platform && "seedance2.5" === e.model;
  function le(e, t) {
    _(n => {
      const o = n.nodes.find(t => t.id === e),
        a = de(o);
      Object.assign(a, t), "doubao" === a.platform && "dreamina-seedance2.5" === a.model && (a.model = "seedance2.0fast"), "dola" === a.platform && "seedance2.5" === a.model && (a.model = "seedance2.0fast"), 30 !== a.duration || re(a) || (a.duration = 15);
    }, "config:" + e);
  }
  function pe(e) {
    $ = e;
    const t = K(e),
      n = de(t);
    if (!n) return;
    const a = o("parameterFields");
    a.replaceChildren();
    const i = n.mode || "video",
      c = "video" === i ? [["platform", "\u751f\u6210\u5e73\u53f0", [["doubao", "\u8c46\u5305"], ["dola", "Dola"]]], ["duration", "\u89c6\u9891\u65f6\u957f", [5, 10, 15, 30].map(e => [String(e), 30 === e ? "30 \u79d2\uff08\u8c46\u5305\u9700\u4f1a\u5458\u652f\u6301\uff09" : e + " \u79d2"])], ["ratio", "\u753b\u5e45\u6bd4\u4f8b", [["16:9", "16:9"], ["9:16", "9:16"]]]] : "image" === i ? [["quality", "\u8d28\u91cf", ["auto", "low", "medium", "high"].map((e, t) => [e, ["\u81ea\u52a8", "\u4f4e", "\u4e2d", "\u9ad8"][t]])], ["imageRatio", "\u6bd4\u4f8b", ["1:1", "16:9", "9:16"].map(e => [e, e])], ["count", "\u5f20\u6570", [1, 2, 3, 4].map(e => [String(e), e + " \u5f20"])]] : [["reasoning", "\u63a8\u7406", ["auto", "none", "low", "medium", "high"].map((e, t) => [e, ["\u81ea\u52a8", "\u5173\u95ed", "\u4f4e", "\u4e2d", "\u9ad8"][t]])], ["count", "\u6b21\u6570", [1, 2, 3, 4].map(e => [String(e), e + " \u6b21"])]];
    for (const [t, o, i] of c) {
      const c = document.createElement("div");
      c.className = "parameter-field";
      const s = document.createElement("label");
      s.textContent = o;
      const d = ie(i.map(([e, t]) => ({
        value: e,
        label: t
      })), String(n[t] ?? ("count" === t ? 1 : "auto")), o, n => le(e, {
        [t]: ["count", "duration"].includes(t) ? Number(n) : n
      }));
      d.dataset.field = t, d.dataset.nodeId = e, d.id = "config-param-" + t, s.htmlFor = d.id, c.append(s, d), a.append(c);
      const r = d.querySelector('option[value="30"]');
      r && (r.disabled = !re(n));
    }
    o("nodeParameters").open || o("nodeParameters").showModal(), fe();
  }
  function ue(t) {
    const n = t.id,
      o = document.createElement("article");
    o.className = "canvas-card " + t.type, o.dataset.id = n;
    const a = document.createElement("div");
    a.className = "card-handle";
    const i = document.createElement("input");
    if (i.className = "card-title", i.value = t.title, i.maxLength = 120, i.setAttribute("aria-label", "\u8282\u70b9\u540d\u79f0"), i.readOnly = !0, i.addEventListener("blur", () => {
      i.readOnly = !0;
    }), i.addEventListener("input", () => X(() => _(e => {
      e.nodes.find(e => e.id === n).title = i.value;
    }, "title:" + n))), a.append(i), o.append(a), "text" === t.type) {
      const a = document.createElement("textarea");
      a.className = "card-text", a.value = t.text, a.maxLength = e.MAX_TEXT, a.placeholder = "\u53cc\u51fb\u7f16\u8f91\u6587\u5b57", a.setAttribute("aria-label", "\u6587\u672c\u5185\u5bb9"), a.readOnly = !0, a.addEventListener("blur", () => {
        a.readOnly = !0;
      }), a.addEventListener("input", () => X(() => _(e => {
        e.nodes.find(e => e.id === n).text = a.value;
      }, "text:" + n))), o.append(a);
    } else if (["image", "video", "audio"].includes(t.type)) {
      if (t.source) {
        const e = document.createElement("image" === t.type ? "img" : t.type);
        e.className = "card-media", e.draggable = !1, "image" === t.type ? (e.alt = t.title, e.loading = "lazy") : (e.controls = !0, e.preload = "metadata", "video" === t.type && (e.poster = t.source.preview)), e.addEventListener("error", () => {
          if (o.querySelector(".media-error")) return;
          e.hidden = !0;
          const t = document.createElement("div");
          t.className = "media-error", t.textContent = "\u7d20\u6750\u6682\u65f6\u65e0\u6cd5\u9884\u89c8\uff0c\u8bf7\u68c0\u67e5\u7d20\u6750\u662f\u5426\u4ecd\u53ef\u8bbf\u95ee\u3002", o.append(t);
        }), e.src = t.source.url, o.append(e);
      } else {
        const e = ce("\u7a7a" + O[t.type] + "\u8282\u70b9", "\u6dfb\u52a0" + O[t.type], () => ze(n));
        e.className = "media-placeholder", e.prepend(se(t.type)), o.append(e);
      }
    } else if ("config" === t.type) {
      const e = document.createElement("div");
      e.className = "config-body";
      const a = document.createElement("div");
      a.className = "config-caption", a.textContent = "\u751f\u6210\u914d\u7f6e";
      const i = document.createElement("div");
      i.className = "config-modes";
      for (const [e, o, a] of [["image", "\u751f\u56fe", "image"], ["text", "\u6587\u672c", "text"], ["video", "\u89c6\u9891", "video"]]) {
        const c = ce(o, "\u751f\u6210\u6a21\u5f0f\uff1a" + o, () => {
          const t = K(n).config,
            o = t.mode || "video";
          le(n, {
            mode: e,
            channelModel: z.channel?.[e + "Model"] || "",
            count: t[e + "Count"] || ("image" === e ? 3 : 1),
            ...("video" !== o ? {
              [o + "Count"]: t.count || 1
            } : {})
          });
        });
        c.dataset.mode = e, c.classList.toggle("active", (t.config.mode || "video") === e), c.prepend(se(a)), i.append(c);
      }
      a.append(i), e.append(a);
      const c = document.createElement("div");
      c.className = "reference-summary", e.append(c);
      const s = ce("\u7ec4\u88c5\u63d0\u793a\u8bcd", "\u7ec4\u88c5\u63d0\u793a\u8bcd", () => ve(n));
      s.className = "assemble-prompt", s.prepend(se("settings")), e.append(s);
      const d = document.createElement("div");
      d.className = "config-row";
      const r = t.config.mode || "video",
        l = ie("video" === r ? [{
          value: "seedance2.0fast",
          label: "Seedance 2.0 Fast"
        }, {
          value: "seedance2.0mini",
          label: "Seedance 2.0 Mini"
        }, {
          value: "dreamina-seedance2.5",
          label: "Seedance 2.5\uff08Dola\uff09"
        }, {
          value: "seedance2.5",
          label: "Seedance 2.5\uff08\u8c46\u5305\uff09"
        }] : [{
          value: z.channel?.[r + "Model"] || "",
          label: z.channel?.[r + "Model"] || "\u914d\u7f6e\u6a21\u578b\u6e20\u9053"
        }], "video" === r ? t.config.model : t.config.channelModel || "", "video" === r ? "\u89c6\u9891\u6a21\u578b" : "\u6e20\u9053\u6a21\u578b", e => le(n, {
          ["video" === r ? "model" : "channelModel"]: e
        }));
      l.dataset.field = "video" === r ? "model" : "channelModel", d.append(l);
      const p = ce("", "\u751f\u6210\u53c2\u6570", () => pe(n));
      p.className = "config-parameters", d.append(p), e.append(d);
      const u = ce("\u5f00\u59cb\u751f\u6210", "\u5f00\u59cb\u751f\u6210", () => je(n));
      u.prepend(se("play")), u.className = "generate-button", e.append(u);
      const m = document.createElement("div");
      m.className = "task-status", e.append(m);
      const h = ce("\u53d6\u6d88\u5f53\u524d\u4efb\u52a1", "\u53d6\u6d88\u5f53\u524d\u4efb\u52a1", () => Ae(n));
      h.className = "cancel-task", h.hidden = !0, e.append(h), o.append(e);
    } else if ("account" === t.type) {
      const e = document.createElement("div");
      e.className = "account-body";
      const a = document.createElement("span");
      a.className = "account-heading", a.textContent = "\u9009\u62e9\u8d26\u53f7", a.prepend(se("account")), e.append(a);
      const i = document.createElement("small");
      i.textContent = "\u7ba1\u7406\u5668\u8d26\u53f7", e.append(i);
      const c = ie([{
        value: "",
        label: "\u9009\u62e9\u5df2\u6709\u8d26\u53f7"
      }, ...z.accounts.map(e => ({
        value: e.id,
        label: ("dola" === e.platform ? "Dola \xb7 " : "\u8c46\u5305 \xb7 ") + e.name
      }))], t.accountId, "\u5df2\u6709\u8d26\u53f7", e => _(t => {
        t.nodes.find(e => e.id === n).accountId = e;
      }));
      e.append(c), o.append(e);
    } else {
      const e = document.createElement("div");
      e.className = "group-caption", e.textContent = "\u7ec4", o.append(e);
    }
    for (const e of ["input", "output"]) {
      const t = document.createElement("button");
      t.className = "node-port " + e, t.dataset.port = e, t.setAttribute("aria-label", "input" === e ? "\u8fde\u63a5\u8f93\u5165" : "\u8fde\u63a5\u8f93\u51fa"), o.append(t);
    }
    const c = document.createElement("button");
    return c.className = "resize-handle", c.setAttribute("aria-label", "\u8c03\u6574\u8282\u70b9\u5c3a\u5bf8"), o.append(c), o;
  }
  function me() {
    if (o("minimap").hidden) return;
    const t = o("minimap");
    t.replaceChildren();
    const n = e.screenToWorld({
        x: 0,
        y: 0
      }, m.viewport),
      i = a.clientWidth / m.viewport.zoom,
      c = a.clientHeight / m.viewport.zoom,
      s = Math.min(n.x, ...m.nodes.map(e => e.x)),
      r = Math.min(n.y, ...m.nodes.map(e => e.y)),
      l = Math.max(n.x + i, ...m.nodes.map(e => e.x + e.width)),
      p = Math.max(n.y + c, ...m.nodes.map(e => e.y + e.height)),
      u = Math.min(170 / (l - s), 105 / (p - r)),
      h = 5 + (170 - (l - s) * u) / 2,
      f = 5 + (105 - (p - r) * u) / 2;
    t.setAttribute("viewBox", "0 0 180 115"), g = {
      left: s,
      top: r,
      scale: u,
      dx: h,
      dy: f
    };
    for (const e of m.nodes) t.append(F("rect", {
      x: h + (e.x - s) * u,
      y: f + (e.y - r) * u,
      width: Math.max(2, e.width * u),
      height: Math.max(2, e.height * u),
      fill: d.has(e.id) ? "#8790f5" : "#687387",
      stroke: "none",
      rx: 1
    }));
    t.append(F("rect", {
      x: h + (n.x - s) * u,
      y: f + (n.y - r) * u,
      width: i * u,
      height: c * u,
      stroke: "#8790f5"
    }));
  }
  function he() {
    if (!b) return;
    const t = m.viewport;
    i.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.zoom})`, o("resetZoom").textContent = `${Math.round(100 * t.zoom)}%`, o("zoomSlider").value = Math.round(100 * t.zoom), a.style.backgroundSize = `${48 * t.zoom}px ${48 * t.zoom}px`, a.style.backgroundPosition = `${t.x}px ${t.y}px`, document.body.classList.toggle("light", "light" === u.appearance.theme), "none" === u.appearance.grid ? a.style.backgroundImage = "none" : "dots" === u.appearance.grid ? a.style.backgroundImage = "radial-gradient(var(--line) 1px,transparent 1px)" : a.style.backgroundImage = "", document.activeElement !== o("canvasTitle") && (o("canvasTitle").value = m.title);
    const n = new Set(e.visibleNodes(m.nodes, t, a.clientWidth, a.clientHeight).map(e => e.id));
    d.forEach(e => n.add(e));
    for (const [e, t] of c) n.has(e) && K(e) || (t.card.querySelector("video,audio")?.pause(), t.card.remove(), c.delete(e));
    for (const t of m.nodes) {
      if (!n.has(t.id)) continue;
      const a = t.type + ":" + (t.source?.url || "") + ("config" === t.type ? ":" + (t.config.mode || "video") + ":" + JSON.stringify(z.channel) : "") + ("account" === t.type ? ":" + z.accounts.map(e => e.id).join(",") : "");
      if (c.has(t.id) && c.get(t.id).key !== a && (c.get(t.id).card.remove(), c.delete(t.id)), !c.has(t.id)) {
        const e = ue(t);
        c.set(t.id, {
          card: e,
          key: a
        }), o("canvasNodes").append(e);
      }
      const i = c.get(t.id).card;
      i.style.left = t.x + "px", i.style.top = t.y + "px", i.style.width = t.width + "px", i.style.height = t.height + "px", i.classList.toggle("selected", d.has(t.id));
      const s = i.querySelector(".card-title");
      document.activeElement !== s && (s.value = t.title);
      const l = i.querySelector(".card-text");
      if (l && (document.activeElement !== l && (l.value = t.text), l.style.fontSize = (t.fontSize || 13) + "px"), "config" === t.type) {
        i.querySelectorAll("[data-field]").forEach(e => {
          document.activeElement !== e && (e.value = String(t.config[e.dataset.field]));
        });
        const n = i.querySelector('[data-field="model"] option[value="dreamina-seedance2.5"]');
        n && (n.disabled = "doubao" === t.config.platform);
        const o = i.querySelector('[data-field="model"] option[value="seedance2.5"]');
        o && (o.disabled = "doubao" !== t.config.platform);
        const a = e.connectedReferences(m, t.id),
          c = i.querySelector(".reference-summary");
        c.replaceChildren();
        for (const [e, t, n] of [["text", "\u63d0\u793a\u8bcd", "\u4e2a"], ["image", "\u53c2\u8003\u56fe", "\u5f20"], ["video", "\u53c2\u8003\u89c6\u9891", "\u4e2a"], ["audio", "\u53c2\u8003\u97f3\u9891", "\u4e2a"]]) {
          const o = document.createElement("span");
          o.textContent = t + " " + a.filter(t => t.type === e).length + " " + n, c.append(o);
        }
        const s = t.config.mode || "video";
        i.querySelector(".config-parameters").textContent = "video" === s ? `${t.config.duration} \u79d2 \xb7 ${t.config.ratio}` : "image" === s ? `${{
          auto: "\u81ea\u52a8",
          low: "\u4f4e",
          medium: "\u4e2d",
          high: "\u9ad8"
        }[t.config.quality || "auto"]} \xb7 ${t.config.imageRatio || "1:1"} \xb7 ${t.config.count || 1} \u5f20` : `\u63a8\u7406 \xb7 ${t.config.reasoning || "auto"} \xb7 ${t.config.count || 1} \u6b21`, i.querySelector(".config-parameters").prepend(se("settings"));
        const d = t.job && !["succeeded", "failed", "cancelled"].includes(t.job.phase),
          l = "video" === s || z.channel?.configured && !!z.channel?.[s + "Model"];
        i.querySelector(".generate-button").disabled = !!d || !l, i.querySelector(".generate-button").title = l ? "" : "\u8bf7\u5148\u914d\u7f6e\u6a21\u578b\u6e20\u9053", i.querySelector(".cancel-task").hidden = !t.job?.taskId || !d, i.querySelector(".task-status").textContent = r.get(t.id) || (d && !t.job.taskId ? "\u63d0\u4ea4\u7ed3\u679c\u672a\u786e\u8ba4\uff0c\u8bf7\u68c0\u67e5\u73b0\u6709\u4efb\u52a1\uff1b\u672c\u8282\u70b9\u4e0d\u4f1a\u91cd\u590d\u63d0\u4ea4" : d ? "\u7b49\u5f85\u4efb\u52a1\u72b6\u6001\u2026" : t.job ? $e(t.job.phase) : l ? "" : "\u8bf7\u5148\u914d\u7f6e\u6a21\u578b\u6e20\u9053");
      }
      "account" === t.type && (i.querySelector("select").value = t.accountId);
    }
    o("undoCanvas").disabled = !J().canUndo, o("redoCanvas").disabled = !J().canRedo;
    const s = m.nodes.filter(e => d.has(e.id));
    o("selectionToolbar").hidden = 0 === s.length;
    const l = e.selectionActions(s.map(e => e.type));
    document.querySelectorAll("#selectionToolbar [data-action]").forEach(e => {
      e.hidden = !l.includes(e.dataset.action);
    }), o("deleteSelected").hidden = !s.length && !k;
    const h = s.length > 1;
    o("selectionToolbar").classList.toggle("multi", h), o("arrangementTools").hidden = !h, o("selectionMore").hidden = !h, o("nodeActionTools").hidden = h && !D;
    const f = e.selectedMedia(m.nodes, [...d]);
    o("exportMedia").hidden = !f.length && !H, o("exportMedia").disabled = H || !f.length, o("exportMedia").querySelector("span").textContent = H ? "\u6b63\u5728\u4fdd\u5b58\u2026" : "\u53e6\u5b58\u4e3a", o("selectionBounds").hidden = !h || !te().length, h || (o("alignmentOptions").hidden = !0);
    const g = s.find(e => "text" === e.type);
    if (Fe.hidden = !g || 1 === s.length, g && document.activeElement !== Fe && (Fe.value = String(g.fontSize || 13)), s.length) {
      const e = Math.min(...s.map(e => e.x)),
        n = Math.max(...s.map(e => e.x + e.width)),
        i = Math.min(...s.map(e => e.y)),
        c = Math.max(...s.map(e => e.y + e.height)),
        d = Math.min(a.clientWidth / 2, o("selectionToolbar").offsetWidth / 2 + 8);
      o("selectionToolbar").style.left = Math.max(d, Math.min(a.clientWidth - d, (e + n) / 2 * t.zoom + t.x)) + "px", o("selectionToolbar").style.top = Math.max(52, Math.min(a.clientHeight - 100, i * t.zoom + t.y - 48)) + "px";
      const r = o("selectionBounds");
      r.style.left = e * t.zoom + t.x - 8 + "px", r.style.top = i * t.zoom + t.y - 8 + "px", r.style.width = (n - e) * t.zoom + 16 + "px", r.style.height = (c - i) * t.zoom + 16 + "px", o("alignmentOptions").style.left = Math.max(12, Math.min(a.clientWidth - 160, parseFloat(o("selectionToolbar").style.left) - o("selectionToolbar").offsetWidth / 2)) + "px", o("alignmentOptions").style.top = parseFloat(o("selectionToolbar").style.top) + 40 + "px";
    }
    if (o("nodeCount").textContent = C ? "" : m.nodes.length || "", o("nodeParameters").open) {
      const e = de(K($));
      e && document.querySelectorAll("#parameterFields [data-field]").forEach(t => {
        document.activeElement !== t && (t.value = String(e[t.dataset.field]));
        const n = t.querySelector('option[value="30"]');
        n && (n.disabled = !re(e));
      });
    }
    ge(), function () {
      const e = o("nodeSearch").value.toLowerCase(),
        t = o("nodeFilter").value,
        n = o("nodeList");
      n.replaceChildren(), o("listHeading").textContent = C ? "\u6211\u7684\u8d44\u4ea7" : "\u753b\u5e03\u5143\u7d20", o("elementsTab").classList.toggle("active", !C), o("assetsTab").classList.toggle("active", C), o("assetNavigation").hidden = !C, document.querySelector(".sidebar-heading").hidden = C, o("nodeSearch").placeholder = C ? "\u641c\u7d22\u8d44\u4ea7" : "\u641c\u7d22\u8282\u70b9";
      const a = o("assetFolders");
      if (a.replaceChildren(), C) for (const e of [{
        id: "",
        title: "\u672a\u5206\u7c7b"
      }, ...(u.folders || [])]) {
        const t = ce(e.title, "\u8d44\u4ea7\u6587\u4ef6\u5939 " + e.title, () => {
          S = e.id, fe();
        });
        t.classList.toggle("active", S === e.id), t.prepend(se("folder"));
        const n = document.createElement("small");
        n.textContent = u.assets.filter(t => (t.folderId || "") === e.id).length, t.append(n), a.append(t);
      }
      const i = C ? [...u.assets.filter(e => (e.folderId || "") === S), ...(S ? [] : I.map(e => ({
        ...e,
        title: e.name
      })))] : m.nodes;
      for (const o of i.filter(n => (C || !t || n.type === t) && n.title.toLowerCase().includes(e))) {
        const e = ce("", C ? "\u6dfb\u52a0\u8d44\u4ea7\u5230\u753b\u5e03" : "\u5b9a\u4f4d\u5230\u8282\u70b9", e => {
          if (C) {
            if (o.source || "text" === o.type) {
              const e = p(o);
              delete e.id, oe(e);
            } else Se(o);
          } else e.ctrlKey || e.metaKey ? (d.has(o.id) ? d.delete(o.id) : d.add(o.id), D = !1, fe()) : (Q([o.id]), m.viewport.x = P().x - (o.x + o.width / 2) * m.viewport.zoom, m.viewport.y = P().y - (o.y + o.height / 2) * m.viewport.zoom, G());
        });
        e.className = "node-list-item", e.classList.toggle("active", d.has(o.id) && !C);
        const t = "text" === o.type ? se("text") : se("config" === o.type ? "settings" : o.type),
          a = document.createElement("span");
        if (a.textContent = o.title, "image" === o.type && (o.source?.url || o.url)) {
          const t = document.createElement("img");
          t.src = o.source?.url || o.url, t.alt = "", t.loading = "lazy", e.append(t);
        } else e.append(t);
        if (!C && "text" !== o.type) {
          const e = document.createElement("small");
          e.textContent = O[o.type], a.append(e);
        }
        e.append(a), n.append(e);
      }
      if (!n.childNodes.length) {
        const e = document.createElement("div");
        e.className = "node-list-empty", e.textContent = C ? "\u6682\u65e0\u8d44\u4ea7\uff0c\u5bfc\u5165\u7d20\u6750\u6216\u4fdd\u5b58\u9009\u4e2d\u8282\u70b9" : "\u753b\u5e03\u6682\u65e0\u8282\u70b9", n.append(e);
      }
    }(), function () {
      const t = o("canvasEdges");
      t.replaceChildren();
      for (const e of m.edges) {
        const n = K(e.from),
          o = K(e.to),
          a = n.x + n.width + 16,
          i = n.y + n.height / 2,
          c = o.x - 16,
          s = o.y + o.height / 2,
          d = Math.max(60, .45 * Math.abs(c - a)),
          r = F("path", {
            d: `M${a},${i} C${a + d},${i} ${c - d},${s} ${c},${s}`,
            class: "canvas-edge" + (k === e.id ? " selected" : ""),
            "data-edge": e.id
          });
        t.append(r);
      }
      if ("connect" === v?.kind) {
        const n = e.screenToWorld(v.current, m.viewport);
        for (const e of v.ids) {
          const o = K(e);
          o && t.append(F("path", {
            d: `M${o.x + o.width + 16},${o.y + o.height / 2} L${n.x},${n.y}`,
            class: "canvas-edge selected"
          }));
        }
      }
    }(), me();
  }
  function fe() {
    cancelAnimationFrame(f), f = requestAnimationFrame(he);
  }
  function ve(e) {
    T = e, Q([e]), ge();
    const t = K(e);
    if (a.clientHeight <= 720 && t) {
      const e = t.y * m.viewport.zoom + m.viewport.y,
        n = Math.max(100, a.clientHeight - 105 - o("promptComposer").offsetHeight - t.height * m.viewport.zoom - 16);
      e > n && (m.viewport.y -= e - n, G(), ge());
    }
    o("composerPrompt").focus();
  }
  function ge() {
    const t = K(T),
      n = de(t);
    if (o("promptComposer").hidden = !n || !d.has(T), o("promptComposer").hidden) return;
    const i = o("promptComposer"),
      c = i.offsetWidth / 2 + 12;
    i.style.left = Math.max(c, Math.min(a.clientWidth - c, (t.x + t.width / 2) * m.viewport.zoom + m.viewport.x)) + "px", i.style.top = Math.max(54, Math.min(a.clientHeight - i.offsetHeight - (a.clientWidth < 1100 ? 105 : 20), (t.y + t.height) * m.viewport.zoom + m.viewport.y + 16)) + "px";
    const s = e.referenceEntries(m, t.id);
    document.activeElement === o("composerPrompt") && j === t.id || (A = s, j = t.id, o("composerPrompt").value = e.formatMentions(n.prompt, s));
    const l = o("composerGeneration");
    if (l.hidden = !t.generation, o("composerTitle").hidden = !!t.generation, t.generation) {
      const e = n.mode || "video",
        o = t.id + ":" + JSON.stringify(z.channel);
      if (l.dataset.key !== o) {
        l.dataset.key = o, l.replaceChildren();
        const a = document.createElement("div");
        a.className = "config-row";
        const i = ie("video" === e ? [{
          value: "seedance2.0fast",
          label: "Seedance 2.0 Fast"
        }, {
          value: "seedance2.0mini",
          label: "Seedance 2.0 Mini"
        }, {
          value: "dreamina-seedance2.5",
          label: "Seedance 2.5\uff08Dola\uff09"
        }, {
          value: "seedance2.5",
          label: "Seedance 2.5\uff08\u8c46\u5305\uff09"
        }] : [{
          value: z.channel?.imageModel || "",
          label: z.channel?.imageModel || "\u914d\u7f6e\u6a21\u578b\u6e20\u9053"
        }], "video" === e ? n.model : n.channelModel || "", "\u751f\u6210\u6a21\u578b", n => le(t.id, {
          ["video" === e ? "model" : "channelModel"]: n
        }));
        i.dataset.field = "video" === e ? "model" : "channelModel", a.append(i);
        const c = ce("", "\u751f\u6210\u53c2\u6570", () => pe(t.id));
        c.className = "config-parameters", a.append(c);
        const s = ce("\u25b7", "\u751f\u6210", () => je(t.id));
        s.className = "generate-button", a.append(s), l.append(a);
        const d = document.createElement("div");
        d.className = "task-status", l.append(d);
        const r = ce("\u53d6\u6d88\u5f53\u524d\u4efb\u52a1", "\u53d6\u6d88\u5f53\u524d\u4efb\u52a1", () => Ae(t.id));
        r.className = "cancel-task", l.append(r);
      }
      const a = l.querySelector("select");
      document.activeElement !== a && (a.value = "video" === e ? n.model : n.channelModel || "");
      const i = a.querySelector('option[value="dreamina-seedance2.5"]');
      i && (i.disabled = "doubao" === n.platform);
      const c = a.querySelector('option[value="seedance2.5"]');
      c && (c.disabled = "doubao" !== n.platform), l.querySelector(".config-parameters").textContent = "video" === e ? `${n.duration} \u79d2 \xb7 ${n.ratio}` : `${n.quality || "\u81ea\u52a8"} \xb7 ${n.imageRatio || "1:1"} \xb7 ${n.count || 1} \u5f20`;
      const s = t.job && !["succeeded", "failed", "cancelled"].includes(t.job.phase),
        d = "video" === e || z.channel?.configured && z.channel?.imageModel;
      l.querySelector(".generate-button").disabled = !!s || !d, l.querySelector(".cancel-task").hidden = !s || !t.job?.taskId, l.querySelector(".task-status").textContent = r.get(t.id) || (d ? "" : "\u8bf7\u5148\u914d\u7f6e\u6a21\u578b\u6e20\u9053");
    }
    const p = o("composerReferences");
    p.replaceChildren();
    for (const e of s) {
      const t = e.node,
        n = ce(t.title, "\u5f15\u7528 " + t.title + " " + e.label, () => ye(t.id));
      if (n.dataset.referenceId = t.id, n.dataset.referenceLabel = e.label, n.title = t.title + " \xb7 " + e.label, "image" === t.type && t.source) {
        n.textContent = "";
        const e = document.createElement("img");
        e.src = t.source.url, e.alt = t.title, n.append(e);
      }
      p.append(n);
      const o = document.createElement("span");
      o.className = "reference-number", o.textContent = e.label, n.append(o);
    }
    p.append(ce("\uff0b", "\u4ece\u753b\u5e03\u9009\u62e9\u53c2\u8003\u8282\u70b9", () => function (t) {
      const n = o("referenceNodes");
      n.replaceChildren();
      for (const a of m.nodes.filter(e => e.id !== t && ["text", "image", "video", "audio", "group", "account"].includes(e.type))) {
        const i = m.edges.some(e => e.from === a.id && e.to === t),
          c = ce((i ? "\u2713 " : "\uff0b ") + a.title, "\u5f15\u7528\u8282\u70b9 " + a.title, () => {
            i ? _(e => {
              e.edges = e.edges.filter(e => !(e.from === a.id && e.to === t));
            }) : Y(e.connectNodes(m, a.id, t, B())), o("referenceDialog").close();
          });
        n.append(c);
      }
      n.childNodes.length || (n.textContent = "\u5148\u5728\u753b\u5e03\u6dfb\u52a0\u6587\u672c\u3001\u56fe\u7247\u6216\u5176\u4ed6\u53c2\u8003\u8282\u70b9"), o("referenceDialog").showModal();
    }(t.id)));
  }
  function ye(t) {
    const n = o("composerPrompt"),
      a = A.find(e => e.node.id === t);
    if (!a) return;
    const i = n.selectionStart,
      c = n.selectionEnd;
    n.setRangeText("@" + a.label, i, c, "end"), le(T, {
      prompt: e.encodeMentions(n.value, A)
    }), o("mentionList").hidden = !0, n.focus();
  }
  function xe() {
    const e = K([...d][0]);
    if (!e) return;
    const t = o("nodeInfoDetails");
    t.replaceChildren();
    for (const [n, o] of [["ID", e.id], ["\u540d\u79f0", e.title], ["\u7c7b\u578b", O[e.type]], ["\u5c3a\u5bf8", `${Math.round(e.width)} \xd7 ${Math.round(e.height)}`], ["\u4f4d\u7f6e", `${Math.round(e.x)}, ${Math.round(e.y)}`], ["\u72b6\u6001", e.job ? $e(e.job.phase) : "idle"]]) {
      const e = document.createElement("dt"),
        a = document.createElement("dd");
      e.textContent = n, a.textContent = o, t.append(e, a);
    }
    o("nodeInfoJson").textContent = JSON.stringify(e, null, 2), o("infoDetails").click(), o("nodeInfoDialog").showModal();
  }
  function Me(e = "boards") {
    U(), q = e, o("canvasLibraryPage").hidden = !1, o("canvasMenu").hidden = !0, be();
  }
  function be() {
    const n = "assets" === q;
    o("libraryBoards").classList.toggle("active", !n), o("libraryAssets").classList.toggle("active", n), o("libraryKind").textContent = n ? "\u8d44\u4ea7\u5e93" : "\u753b\u5e03\u5e93", o("canvasLibraryPage").querySelector("h1").textContent = n ? "\u6211\u7684\u8d44\u4ea7" : "\u65e0\u9650\u753b\u5e03", o("libraryImport").hidden = n, o("libraryNew").hidden = n;
    const a = o("libraryItems");
    a.replaceChildren();
    for (const i of n ? u.assets : u.canvases) {
      const c = document.createElement("article");
      c.className = "library-card";
      const d = ce("", "\u6253\u5f00 " + i.title, () => {
        if (n) {
          const e = p(i);
          delete e.id, oe(e);
        } else Ne(i.id);
        o("canvasLibraryPage").hidden = !0;
      });
      if (d.className = "library-open", n && i.source && "image" === i.type) {
        const e = document.createElement("img");
        e.src = i.source.url, e.alt = "", d.append(e);
      }
      const r = document.createElement("strong");
      r.textContent = i.title;
      const l = document.createElement("p");
      l.textContent = n ? "text" === i.type ? i.text.slice(0, 120) : O[i.type] : `${i.nodes.length} \u4e2a\u8282\u70b9 \xb7 ${i.edges.length} \u6761\u8fde\u7ebf`, d.append(r, l), c.append(d);
      const h = document.createElement("div");
      if (h.className = "library-actions", !n) {
        const e = ce("", "\u5bfc\u51fa " + i.title, () => t.exportCanvas(i));
        e.append(se("download")), h.append(e);
      }
      const f = ce("", "\u91cd\u547d\u540d " + i.title, () => {
        qe("\u91cd\u547d\u540d", "", () => {
          const t = e.value.trim();
          t && (n ? (i.title = t, G()) : i.id === m.id ? _(e => {
            e.title = t;
          }) : (i.title = t, G()), be());
        });
        const e = document.createElement("input");
        e.maxLength = 120, e.value = i.title, e.setAttribute("aria-label", "\u65b0\u540d\u79f0"), o("confirmText").append(e), e.focus();
      });
      f.append(se("settings"));
      const v = ce("", "\u5220\u9664 " + i.title, () => qe("\u5220\u9664 " + i.title + "\uff1f", "\u79fb\u9664\u672c\u5730\u8bb0\u5f55\uff0c\u539f\u7d20\u6750\u6587\u4ef6\u4fdd\u7559\u3002", () => {
        n ? u.assets = u.assets.filter(e => e.id !== i.id) : (u.canvases = u.canvases.filter(e => e.id !== i.id), u.canvases.length || u.canvases.push(e.emptyCanvas(B())), m.id === i.id && Ne(u.canvases[0].id), s.delete(i.id)), G(), be();
      }));
      v.append(se("trash")), h.append(f, v), c.append(h), a.append(c);
    }
    a.childNodes.length || (a.textContent = "\u6682\u65e0\u8d44\u4ea7\uff0c\u5bfc\u5165\u7d20\u6750\u6216\u4fdd\u5b58\u8282\u70b9\u540e\u4f1a\u663e\u793a\u5728\u8fd9\u91cc\u3002");
  }
  function we(t, n = P()) {
    b && (m.viewport = e.zoomAtPoint(m.viewport, t, n), G());
  }
  function ke(t) {
    if (!v) return;
    const n = v;
    v = null, "connect" === n.kind && "pointerup" === t?.type && X(() => {
      const i = document.elementFromPoint(t.clientX, t.clientY),
        c = i?.closest(".canvas-card");
      c ? Y(e.connectSelection(m, n.ids, c.dataset.id, B)) : !i?.closest(".floating-dock,#promptComposer,.canvas-topbar,.popover,dialog") && Math.hypot(R(t).x - n.start.x, R(t).y - n.start.y) > 4 && function (t, n) {
        M = {
          boardId: m.id,
          ids: [...t],
          position: e.screenToWorld(n, m.viewport)
        };
        const i = o("connectionMenu");
        o("connectionCount").textContent = `\u5f15\u7528\u5df2\u9009 ${t.length} \u4e2a\u8282\u70b9\u751f\u6210`, i.hidden = !1, i.style.left = Math.max(12, Math.min(a.clientWidth - i.offsetWidth - 12, n.x)) + "px", i.style.top = Math.max(50, Math.min(a.clientHeight - i.offsetHeight - 85, n.y)) + "px";
      }(n.ids, R(t));
    }), ["move", "resize"].includes(n.kind) && J().record(m), o("selectionBox").hidden = !0, a.classList.remove("dragging"), fe(), U();
  }
  function Ee() {
    const e = m.nodes.filter(e => d.has(e.id) && "group" !== e.type);
    if (!e.length) return;
    const t = Math.min(...e.map(e => e.x)) - 24,
      n = Math.min(...e.map(e => e.y)) - 46,
      o = Math.max(...e.map(e => e.x + e.width)) + 24,
      a = Math.max(...e.map(e => e.y + e.height)) + 24,
      i = B();
    _(c => {
      c.nodes.unshift({
        id: i,
        type: "group",
        title: "\u7ec4",
        x: t,
        y: n,
        width: o - t,
        height: a - n,
        members: e.map(e => e.id)
      });
    }), Q([i]);
  }
  async function Ce() {
    if (!d.size) return;
    const n = e.selectionFragment(m, [...d]);
    await t.writeClipboard(JSON.stringify(n)), V("\u5df2\u590d\u5236\u9009\u4e2d\u8282\u70b9");
  }
  function Se(e, t, n) {
    const o = {
      url: e.url,
      preview: e.preview || "",
      resourceId: e.resourceId || ""
    };
    return t ? (_(n => {
      const a = n.nodes.find(e => e.id === t);
      if (a.type !== e.type) throw new Error("\u7d20\u6750\u7c7b\u578b\u4e0e\u8282\u70b9\u4e0d\u4e00\u81f4");
      a.source = o, a.title = e.name.slice(0, 120);
    }), t) : oe({
      type: e.type,
      title: e.name.slice(0, 120),
      source: o
    }, n);
  }
  o("composerPrompt").oninput = () => X(() => {
    const t = o("composerPrompt");
    le(T, {
      prompt: e.encodeMentions(t.value, A)
    });
    const n = t.value.slice(0, t.selectionStart).endsWith("@");
    if (o("mentionList").hidden = !n, n) {
      const e = o("mentionList");
      e.replaceChildren();
      for (const n of A) {
        const o = n.node,
          a = ce("", "\u63d2\u5165\u5f15\u7528 " + o.title + " " + n.label, () => {
            t.setRangeText("", t.selectionStart - 1, t.selectionStart, "end"), ye(o.id);
          });
        if (a.dataset.referenceId = o.id, a.dataset.referenceLabel = n.label, "image" === o.type) {
          const e = document.createElement("img");
          e.src = o.source.url, e.alt = "", a.append(e);
        } else a.append(se(o.type));
        const i = document.createElement("span"),
          c = document.createElement("strong"),
          s = document.createElement("small");
        c.textContent = o.title.replace(/\.(png|jpe?g|webp|gif|bmp|mp4|webm|wav|mp3)$/i, ""), s.textContent = n.label, i.append(c, s), a.append(i), e.append(a);
      }
    }
  }), o("closeComposer").onclick = () => {
    T = "", o("promptComposer").hidden = !0;
  }, o("infoDetails").onclick = () => {
    o("nodeInfoDetails").hidden = !1, o("nodeInfoJson").hidden = !0, o("infoDetails").classList.add("active"), o("infoJson").classList.remove("active");
  }, o("infoJson").onclick = () => {
    o("nodeInfoDetails").hidden = !0, o("nodeInfoJson").hidden = !1, o("infoJson").classList.add("active"), o("infoDetails").classList.remove("active");
  }, a.addEventListener("wheel", e => {
    !b || e.target.closest("textarea,#promptComposer,.popover") && !e.ctrlKey || (e.preventDefault(), we(m.viewport.zoom * Math.exp(.002 * -Math.max(-100, Math.min(100, e.deltaY))), R(e)));
  }, {
    passive: !1
  }), a.addEventListener("pointerdown", e => X(() => {
    if (!b || v || ![0, 1].includes(e.button) || e.target.closest(".floating-dock,.canvas-topbar,.popover,#minimap,#promptComposer")) return;
    const t = e.target.closest(".canvas-card"),
      n = R(e);
    if (e.target.closest("#selectionOutput")) {
      const t = te();
      if (!t.length) return;
      return ne(), v = {
        kind: "connect",
        ids: t,
        start: n,
        current: n,
        pointerId: e.pointerId
      }, e.preventDefault(), a.setPointerCapture(e.pointerId), a.classList.add("dragging"), void fe();
    }
    if (ne(), o("alignmentOptions").hidden = !0, D = !1, e.target.dataset.edge) return d.clear(), k = e.target.dataset.edge, fe(), void e.preventDefault();
    if (t && 0 === e.button && !E) {
      const o = t.dataset.id;
      if (e.target.closest(".card-handle")) {
        const a = performance.now();
        if (x?.id === o && a - x.at < 450 && Math.hypot(n.x - x.x, n.y - x.y) < 8) {
          x = null;
          const n = t.querySelector(".card-title");
          return n.readOnly = !1, n.focus(), n.select(), void e.preventDefault();
        }
        x = {
          id: o,
          at: a,
          ...n
        };
      }
      if (t.classList.contains("text") && !e.target.closest(".card-handle,.resize-handle,.node-port")) {
        const a = performance.now(),
          i = t.querySelector(".card-text");
        if (y?.id === o && a - y.at < 450 && Math.hypot(n.x - y.x, n.y - y.y) < 8) return y = null, i.readOnly = !1, i.focus(), void e.preventDefault();
        y = {
          id: o,
          at: a,
          ...n
        };
      }
      if (e.target.dataset.port) {
        if ("output" !== e.target.dataset.port) return;
        const t = d.has(o) && d.size > 1 ? te() : [o];
        v = {
          kind: "connect",
          ids: t.length ? t : [o],
          start: n,
          current: n,
          pointerId: e.pointerId
        };
      } else {
        if (e.ctrlKey || e.metaKey) {
          if (d.has(o) ? d.delete(o) : d.add(o), fe(), !e.target.closest(".card-handle")) return;
        } else d.has(o) || Q([o]);
        if (e.target.closest("input,textarea,select,video,audio") || e.target.closest("button") && !e.target.closest(".resize-handle")) return;
        const t = K(o);
        v = e.target.closest(".resize-handle") ? {
          kind: "resize",
          id: o,
          width: t.width,
          height: t.height,
          start: n,
          pointerId: e.pointerId
        } : {
          kind: "move",
          start: n,
          positions: m.nodes.filter(e => ee().has(e.id)).map(e => ({
            id: e.id,
            x: e.x,
            y: e.y
          })),
          pointerId: e.pointerId
        };
      }
    } else 1 === e.button || E ? v = {
      kind: "pan",
      start: n,
      x: m.viewport.x,
      y: m.viewport.y,
      pointerId: e.pointerId
    } : (e.ctrlKey || e.metaKey || d.clear(), k = "", v = {
      kind: "select",
      start: n,
      current: n,
      initial: [...d],
      pointerId: e.pointerId
    });
    e.preventDefault(), a.setPointerCapture(e.pointerId), a.classList.add("dragging"), fe();
  })), a.addEventListener("pointermove", e => {
    if (!v || e.pointerId !== v.pointerId) return;
    const t = R(e),
      n = t.x - (v.start?.x || 0),
      a = t.y - (v.start?.y || 0);
    if ("pan" === v.kind) m.viewport.x = v.x + n, m.viewport.y = v.y + a, G();else if ("move" === v.kind) {
      for (const e of v.positions) {
        const t = K(e.id);
        t.x = e.x + n / m.viewport.zoom, t.y = e.y + a / m.viewport.zoom;
      }
      G();
    } else if ("resize" === v.kind) {
      const e = K(v.id);
      e.width = Math.min(4e3, Math.max("config" === e.type ? 340 : 120, v.width + n / m.viewport.zoom)), e.height = Math.min(4e3, Math.max("config" === e.type ? 240 : 100, v.height + a / m.viewport.zoom)), G();
    } else if ("connect" === v.kind) v.current = t, fe();else {
      v.current = t;
      const e = Math.min(t.x, v.start.x),
        n = Math.min(t.y, v.start.y),
        a = Math.max(t.x, v.start.x),
        i = Math.max(t.y, v.start.y),
        c = o("selectionBox");
      c.hidden = !1, c.style.left = e + "px", c.style.top = n + "px", c.style.width = a - e + "px", c.style.height = i - n + "px", d.clear(), v.initial.forEach(e => d.add(e));
      for (const t of m.nodes) {
        const o = t.x * m.viewport.zoom + m.viewport.x,
          c = t.y * m.viewport.zoom + m.viewport.y;
        o < a && o + t.width * m.viewport.zoom > e && c < i && c + t.height * m.viewport.zoom > n && d.add(t.id);
      }
      fe();
    }
  }), a.addEventListener("pointerup", ke), a.addEventListener("pointercancel", ke), a.addEventListener("lostpointercapture", ke), a.addEventListener("dblclick", e => {
    const t = e.target.closest(".card-handle");
    if (t) t.querySelector("input").readOnly = !1, t.querySelector("input").focus(), t.querySelector("input").select();else {
      const t = e.target.closest(".canvas-card.text");
      if (t) {
        const e = t.querySelector("textarea");
        e.readOnly = !1, e.focus();
      }
    }
  }), a.addEventListener("dragstart", e => e.preventDefault()), a.addEventListener("dragover", e => {
    e.dataTransfer.types.includes("Files") && (e.preventDefault(), e.dataTransfer.dropEffect = "copy");
  }), a.addEventListener("drop", t => {
    t.preventDefault();
    const n = e.screenToWorld(R(t), m.viewport);
    X(() => Le([...t.dataTransfer.files], n));
  });
  let Ie = "";
  async function ze(e = "") {
    Ie = e;
    const n = o("mediaList");
    n.textContent = "\u6b63\u5728\u8bfb\u53d6\u7d20\u6750\u2026", o("mediaDialog").showModal();
    try {
      I = await t.listMedia(), n.replaceChildren();
      const a = e && K(e)?.type;
      for (const e of I.filter(e => !a || e.type === a)) {
        const t = ce("", "\u6dfb\u52a0\u7d20\u6750\u5230\u753b\u5e03", () => {
            Se(e, Ie), o("mediaDialog").close();
          }),
          a = document.createElement("span");
        a.textContent = e.name;
        const i = document.createElement("span");
        i.textContent = O[e.type], t.append(a, i), n.append(t);
      }
      n.childNodes.length || (n.textContent = "\u6682\u65e0\u5339\u914d\u7d20\u6750\uff0c\u8bf7\u5bfc\u5165\u672c\u5730\u7d20\u6750\u3002");
    } catch (e) {
      n.textContent = "\u7d20\u6750\u8bfb\u53d6\u5931\u8d25\uff1a" + e.message;
    }
  }
  async function Le(e, n, a = "") {
    if (b) {
      for (const [o, i] of e.entries()) {
        if (i.size > 104857600) throw new Error("\u5355\u4e2a\u7d20\u6750\u4e0d\u80fd\u8d85\u8fc7 100 MB");
        if (u.assets.length >= 500) throw new Error("\u8d44\u4ea7\u6570\u91cf\u5df2\u8fbe 500 \u4e2a");
        const e = Se(await t.importMedia({
          name: i.name,
          bytes: await i.arrayBuffer()
        }), 0 === o ? a : "", n ? {
          x: n.x + 40 * o,
          y: n.y + 40 * o
        } : void 0);
        u.assets.push({
          ...p(K(e)),
          id: B(),
          ...(S ? {
            folderId: S
          } : {})
        }), G();
      }
      U(), o("mediaInput").value = "";
    }
  }
  function Ne(e) {
    if (b && e !== m.id) {
      ke(), U(), u.activeId = e, m = u.canvases.find(t => t.id === e), d.clear(), k = "";
      for (const {
        card: e
      } of c.values()) e.querySelector("video,audio")?.pause(), e.remove();
      c.clear(), G(), o("canvasMenu").hidden = !0;
    }
  }
  function Te() {
    if (u.canvases.length >= 30) throw new Error("\u753b\u5e03\u6570\u91cf\u5df2\u8fbe 30 \u4e2a");
    const t = e.emptyCanvas(B(), "\u65e0\u9650\u753b\u5e03 " + (u.canvases.length + 1));
    u.canvases.push(t), Ne(t.id), G();
  }
  function qe(e, t, n) {
    o("confirmTitle").textContent = e, o("confirmText").textContent = t, o("confirmDialog").showModal(), o("confirmAccept").onclick = () => {
      o("confirmDialog").close(), X(n);
    };
  }
  function $e(e) {
    return {
      queued: "\u6392\u961f\u4e2d",
      running: "\u751f\u6210\u4e2d",
      succeeded: "\u751f\u6210\u5b8c\u6210",
      failed: "\u751f\u6210\u5931\u8d25",
      cancelled: "\u5df2\u53d6\u6d88"
    }[e] || e;
  }
  function De(t, n, o) {
    const a = u.canvases.findIndex(e => e.id === t);
    if (a < 0) return;
    const i = p(u.canvases[a]),
      c = i.nodes.find(e => e.id === n);
    c && (o(c, i), l.set(t + ":" + c.id, p(c.job)), u.canvases[a] = e.validateCanvas(i), m.id === t && (m = u.canvases[a]), G());
  }
  async function je(n) {
    const o = m.id,
      a = K(n),
      i = de(a);
    if (a.job && !["succeeded", "failed", "cancelled"].includes(a.job.phase)) return;
    if (!("video" === (i.mode || "video") || z.channel?.configured && z.channel?.[i.mode + "Model"])) throw new Error("\u8bf7\u5148\u914d\u7f6e\u6a21\u578b\u6e20\u9053");
    const c = e.generationInput(m, n);
    if (!c.prompt.trim()) throw new Error("\u8bf7\u586b\u5199\u63d0\u793a\u8bcd\u6216\u8fde\u63a5\u6587\u672c\u8282\u70b9");
    const s = B();
    De(o, n, e => {
      e.job = {
        requestId: s,
        taskId: "",
        phase: "queued",
        resultNodeId: ""
      };
    }), U(), r.set(n, "video" === (i.mode || "video") ? "\u6b63\u5728\u63d0\u4ea4\u5230\u73b0\u6709\u89c6\u9891\u961f\u5217\u2026" : "\u6b63\u5728\u63d0\u4ea4\u5230\u6a21\u578b\u6e20\u9053\u2026"), fe();
    try {
      const e = await t.submit({
        ...c,
        canvasId: o,
        nodeId: n,
        requestId: s
      });
      if (e.uncertain) return r.set(n, e.message), De(o, n, e => {
        e.job.phase = "unknown";
      }), void U();
      De(o, n, t => {
        t.job.taskId = e.id, t.job.phase = e.status;
      }), U(), await He();
    } catch (e) {
      throw r.set(n, e.message), De(o, n, e => {
        e.job.phase = "failed";
      }), e;
    }
  }
  async function Ae(e) {
    const n = K(e);
    if (!n.job?.taskId) return;
    const o = await t.cancel({
      canvasId: m.id,
      nodeId: e,
      requestId: n.job.requestId,
      taskId: n.job.taskId
    });
    V(n.job.taskId.startsWith("channel-") ? "\u5df2\u505c\u6b62\u63a5\u6536\u672c\u8282\u70b9\u7ed3\u679c\uff0c\u6e20\u9053\u5df2\u53d1\u51fa\u7684\u8bf7\u6c42\u4e0d\u4f1a\u91cd\u53d1" : o.alreadySubmitted ? "\u5e73\u53f0\u5df2\u63a5\u5355\uff0c\u5df2\u505c\u6b62\u540e\u7eed\u5904\u7406" : "\u5df2\u53d6\u6d88\u5f53\u524d\u753b\u5e03\u4efb\u52a1"), await He();
  }
  async function He() {
    if (b && !N && !L) {
      L = !0;
      try {
        for (const e of u.canvases) for (const n of e.nodes.filter(e => e.job?.taskId && !["succeeded", "failed", "cancelled"].includes(e.job.phase))) try {
          const o = await t.status({
            canvasId: e.id,
            nodeId: n.id,
            requestId: n.job.requestId,
            taskId: n.job.taskId
          });
          if (N) return;
          r.set(n.id, `${$e(o.status)} ${o.progress}%\n${o.message}`), De(e.id, n.id, (e, t) => {
            if (e.job.phase = o.status, "succeeded" === o.status && (o.resultUrl || o.results?.length) && !e.job.resultNodeId) for (const [n, a] of (o.results || [{
              type: "video",
              url: o.resultUrl
            }]).entries()) {
              if (0 === n && e.generation && e.type === a.type) {
                e.source = {
                  url: a.url,
                  preview: "",
                  resourceId: ""
                }, e.job.resultNodeId = e.id;
                continue;
              }
              const o = B();
              t.nodes.push({
                id: o,
                type: a.type,
                title: "\u751f\u6210" + O[a.type],
                x: e.x + e.width + 80,
                y: e.y + 280 * n,
                width: 340,
                height: 240,
                ...("text" === a.type ? {
                  text: a.text
                } : {
                  source: {
                    url: a.url,
                    preview: "",
                    resourceId: ""
                  }
                })
              }), t.edges.push({
                id: B(),
                from: e.id,
                to: o
              }), e.job.resultNodeId ||= o;
            }
          });
        } catch (e) {
          r.set(n.id, "\u72b6\u6001\u67e5\u8be2\u5931\u8d25\uff1a" + e.message + "\uff0c\u4efb\u52a1\u4e0d\u4f1a\u91cd\u590d\u63d0\u4ea4"), fe();
        }
        U();
      } finally {
        L = !1;
      }
    }
  }
  o("addText").onclick = () => X(() => oe({
    type: "text",
    text: ""
  })), o("addImage").onclick = () => X(() => {
    ve(oe({
      type: "image",
      source: null,
      generation: Oe("image")
    }));
  }), o("addVideo").onclick = () => X(() => {
    ve(oe({
      type: "video",
      source: null,
      generation: Oe("video")
    }));
  });
  const Oe = e => ({
    platform: "doubao",
    model: "seedance2.0fast",
    duration: 15,
    ratio: "16:9",
    prompt: "",
    accountId: "",
    ...(e && "video" !== e ? {
      mode: e,
      channelModel: z.channel?.[e + "Model"] || "",
      count: "image" === e ? 3 : 1,
      quality: "auto",
      imageRatio: "1:1",
      reasoning: "auto"
    } : {})
  });
  o("addConfig").onclick = () => X(() => {
    ve(oe({
      type: "config",
      config: Oe(z.channel?.configured ? "image" : "video")
    }));
  }), o("addAccount").onclick = () => X(() => oe({
    type: "account",
    accountId: ""
  })), o("addGroup").onclick = o("makeGroup").onclick = () => X(Ee), o("copyNodes").onclick = () => X(Ce), o("removeSelection").onclick = () => X(ae), o("exportMedia").onclick = () => X(async () => {
    if (H) return;
    const n = e.selectedMedia(m.nodes, [...d]);
    if (n.length) {
      H = !0, fe(), V(`\u6b63\u5728\u53e6\u5b58 ${n.length} \u4e2a\u56fe\u7247\u6216\u89c6\u9891\u2026`);
      try {
        const e = await t.exportMedia(n);
        if (e.canceled) return void V("\u5df2\u53d6\u6d88\u53e6\u5b58");
        const o = e.failed.slice(0, 3).map(e => `${e.name || "\u6210\u54c1"}\uff1a${e.message}`).join("\uff1b");
        V((1 === n.length && 1 === e.saved.length ? `\u5df2\u53e6\u5b58\u4e3a ${e.saved[0].name}` : `\u5df2\u53e6\u5b58 ${e.saved.length} \u4e2a\u6587\u4ef6`) + (e.failed.length ? `\uff0c\u5931\u8d25 ${e.failed.length} \u4e2a\u3002${o}` : ""), !!e.failed.length);
      } finally {
        H = !1, fe();
      }
    }
  }), o("deleteSelected").onclick = () => X(ae), o("nodeInfo").onclick = () => X(xe);
  const We = e => _(t => {
    for (const n of t.nodes) d.has(n.id) && "text" === n.type && (n.fontSize = Math.max(12, Math.min(64, (n.fontSize || 13) + e)));
  }, "font-size");
  o("smallerFont").onclick = () => X(() => We(-2)), o("largerFont").onclick = () => X(() => We(2)), o("configureNode").onclick = () => X(() => ve([...d][0])), o("uploadNode").onclick = () => X(() => ze([...d][0])), o("ungroupNodes").onclick = () => X(() => {
    const e = new Set(d);
    _(t => {
      t.nodes = t.nodes.filter(t => !(e.has(t.id) && "group" === t.type)), t.edges = t.edges.filter(e => t.nodes.some(t => t.id === e.from) && t.nodes.some(t => t.id === e.to));
    }), Q([]);
  }), o("textToImage").onclick = () => X(() => function () {
    const t = K([...d][0]);
    if (!t) return;
    const n = oe({
      type: "config",
      config: Oe("image")
    }, {
      x: t.x + t.width + 230,
      y: t.y + 120
    });
    Y(e.connectNodes(m, t.id, n, B())), Q([n]), ve(n);
  }()), o("editNode").onclick = () => X(() => {
    const e = [...d][0],
      t = K(e);
    t.generation || _(n => {
      n.nodes.find(t => t.id === e).generation = Oe(t.type);
    }), ve(e);
  });
  const Fe = ie([12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map(e => ({
    value: String(e),
    label: e + "px"
  })), "13", "\u6587\u672c\u5b57\u53f7", e => _(t => {
    for (const n of t.nodes) d.has(n.id) && "text" === n.type && (n.fontSize = Number(e));
  }, "font-size"));
  let Be;
  async function Pe() {
    if ("function" == typeof t.context) try {
      const e = await t.context();
      N || (z = e, fe());
    } catch (e) {
      V(e.message, !0);
    }
  }
  Fe.id = "nodeFontSize", o("selectionToolbar").insertBefore(Fe, o("arrangementTools")), document.querySelectorAll("[data-align]").forEach(t => {
    t.onclick = () => X(() => {
      return n = t.dataset.align, _(t => {
        const o = new Map(t.nodes.map(e => [e.id, {
          x: e.x,
          y: e.y
        }]));
        t.nodes = e.alignNodes(t.nodes, [...d], n);
        for (const e of t.nodes.filter(e => "group" === e.type && d.has(e.id))) for (const n of e.members) if (!d.has(n)) {
          const a = t.nodes.find(e => e.id === n);
          a.x += e.x - o.get(e.id).x, a.y += e.y - o.get(e.id).y;
        }
      }), void (o("alignmentOptions").hidden = !0);
      var n;
    });
  }), document.querySelectorAll("[data-arrange]").forEach(t => {
    t.onclick = () => X(() => {
      return n = t.dataset.arrange, void _(t => {
        const o = new Map(t.nodes.map(e => [e.id, {
          x: e.x,
          y: e.y
        }]));
        t.nodes = e.arrangeNodes(t.nodes, [...d], n);
        for (const e of t.nodes.filter(e => "group" === e.type && d.has(e.id))) for (const n of e.members) if (!d.has(n)) {
          const a = t.nodes.find(e => e.id === n);
          a.x += e.x - o.get(e.id).x, a.y += e.y - o.get(e.id).y;
        }
      });
      var n;
    });
  }), o("alignMenuButton").onclick = () => {
    o("alignmentOptions").hidden = !o("alignmentOptions").hidden, D = !1, fe();
  }, o("selectionMore").onclick = () => {
    D = !D, o("alignmentOptions").hidden = !0, fe();
  }, document.querySelectorAll("[data-connected]").forEach(t => {
    t.onclick = () => X(() => function (t) {
      const n = M;
      if (!n || n.boardId !== m.id) return;
      const o = "config" === t ? "video" : t,
        a = B(),
        i = {
          id: a,
          type: ["text", "config"].includes(t) ? "config" : t,
          title: O["text" === t ? "config" : t],
          x: n.position.x - 170,
          y: n.position.y - 120,
          width: 340,
          height: 240
        };
      "config" === i.type ? i.config = Oe(o) : (i.source = null, i.generation = Oe(o));
      const c = e.createConnectedNode(m, n.ids, i, B);
      ne(), Y(c), Q([a]), ve(a);
    }(t.dataset.connected));
  }), o("cancelConnection").onclick = ne, o("saveAsset").onclick = () => X(() => {
    const t = m.nodes.filter(e => d.has(e.id) && ["text", "image", "video", "audio"].includes(e.type) && ("text" === e.type ? e.text.trim() : e.source)).map(e => {
      const t = {
        ...p(e),
        id: B(),
        ...(S ? {
          folderId: S
        } : {})
      };
      return delete t.job, t;
    });
    if (!t.length) throw new Error("\u6ca1\u6709\u53ef\u4fdd\u5b58\u7684\u5185\u5bb9");
    const n = e.validateWorkspace({
      ...u,
      assets: [...u.assets, ...t]
    });
    u = n, m = u.canvases.find(e => e.id === m.id), G(), V("\u5df2\u52a0\u5165\u6211\u7684\u8d44\u4ea7");
  }), o("selectionMode").onclick = () => {
    a.focus(), Q([]);
  }, o("undoCanvas").onclick = () => X(() => Z("undo")), o("redoCanvas").onclick = () => X(() => Z("redo")), o("resetZoom").onclick = () => we(1), o("zoomSlider").oninput = () => we(Number(o("zoomSlider").value) / 100), o("fitCanvas").onclick = () => {
    m.viewport = e.fitViewport(m.nodes, a.clientWidth, a.clientHeight), G();
  }, o("toggleMinimap").onclick = () => {
    o("minimap").hidden = !o("minimap").hidden, me();
  }, o("minimap").onclick = e => {
    if (!g) return;
    const t = o("minimap").getBoundingClientRect(),
      n = g,
      a = n.left + (180 * (e.clientX - t.left) / t.width - n.dx) / n.scale,
      i = n.top + (115 * (e.clientY - t.top) / t.height - n.dy) / n.scale;
    m.viewport.x = P().x - a * m.viewport.zoom, m.viewport.y = P().y - i * m.viewport.zoom, G();
  }, o("addMedia").onclick = () => X(() => ze()), o("closeMedia").onclick = () => o("mediaDialog").close(), o("chooseMediaFiles").onclick = () => o("mediaInput").click(), o("mediaInput").onchange = () => X(async () => {
    await Le([...o("mediaInput").files], void 0, Ie), Ie = "", o("mediaDialog").close();
  }), o("elementsTab").onclick = () => {
    C = !1, fe();
  }, o("assetsTab").onclick = () => X(async () => {
    C = !0, fe(), I = await t.listMedia(), fe();
  }), o("assetAdd").onclick = () => X(() => ze()), o("folderNew").onclick = () => X(() => {
    if ((u.folders || []).length >= 100) throw new Error("\u8d44\u4ea7\u6587\u4ef6\u5939\u5df2\u8fbe\u4e0a\u9650");
    qe("\u65b0\u5efa\u6587\u4ef6\u5939", "", () => {
      const t = e.value.trim();
      if (!t) return;
      const n = B();
      u.folders ||= [], u.folders.push({
        id: n,
        title: t
      }), S = n, G();
    });
    const e = document.createElement("input");
    e.maxLength = 120, e.placeholder = "\u6587\u4ef6\u5939\u540d\u79f0", e.setAttribute("aria-label", "\u6587\u4ef6\u5939\u540d\u79f0"), o("confirmText").append(e), e.focus();
  }), o("nodeSearch").oninput = fe, o("nodeFilter").onchange = fe, o("selectAll").onclick = () => Q(m.nodes.map(e => e.id)), o("toggleSidebar").onclick = () => {
    document.body.classList.toggle("sidebar-hidden"), fe();
  }, o("sidebarResize").addEventListener("pointerdown", e => {
    Be = {
      x: e.clientX,
      width: o("canvasSidebar").clientWidth
    }, o("sidebarResize").setPointerCapture(e.pointerId), e.preventDefault();
  }), o("sidebarResize").addEventListener("pointermove", e => {
    Be && (o("canvasSidebar").style.width = Math.max(180, Math.min(450, Be.width + e.clientX - Be.x)) + "px", fe());
  }), o("sidebarResize").addEventListener("pointerup", () => {
    Be = null;
  }), o("sidebarResize").addEventListener("lostpointercapture", () => {
    Be = null;
  }), o("canvasMenuButton").onclick = () => {
    !function () {
      const e = o("canvasList");
      e.replaceChildren();
      for (const t of u.canvases) {
        const n = ce(t.title, "\u5207\u6362\u753b\u5e03", () => Ne(t.id));
        n.classList.toggle("active", t.id === m.id), e.append(n);
      }
    }(), o("canvasMenu").hidden = !o("canvasMenu").hidden;
  }, o("canvasHome").onclick = o("canvasLibrary").onclick = () => Me(), o("libraryBoards").onclick = () => Me(), o("libraryAssets").onclick = () => Me("assets"), o("libraryReturn").onclick = () => {
    o("canvasLibraryPage").hidden = !0, fe();
  }, o("libraryNew").onclick = () => X(() => {
    Te(), o("canvasLibraryPage").hidden = !0;
  }), o("libraryImport").onclick = () => o("documentInput").click(), o("importAssets").onclick = () => X(() => (o("canvasMenu").hidden = !0, ze())), o("menuUndo").onclick = () => X(() => {
    o("canvasMenu").hidden = !0, Z("undo");
  }), o("menuRedo").onclick = () => X(() => {
    o("canvasMenu").hidden = !0, Z("redo");
  }), o("newCanvas").onclick = () => X(Te), o("deleteCanvas").onclick = () => qe("\u5220\u9664\u5f53\u524d\u753b\u5e03\uff1f", "\u4ec5\u5220\u9664\u672c\u753b\u5e03\u5e03\u5c40\uff0c\u7d20\u6750\u6587\u4ef6\u548c\u5176\u4ed6\u753b\u5e03\u4e0d\u4f1a\u5220\u9664\u3002", () => {
    const t = m.id;
    u.canvases = u.canvases.filter(e => e.id !== t), u.canvases.length || u.canvases.push(e.emptyCanvas(B())), u.activeId = u.canvases[0].id, s.delete(t), Ne(u.activeId), G(), U();
  }), o("clearCanvas").onclick = () => qe("\u6e05\u7a7a\u753b\u5e03\uff1f", "\u4ec5\u79fb\u9664\u5f53\u524d\u753b\u5e03\u7684\u8282\u70b9\u4e0e\u8fde\u7ebf\uff0c\u53ef\u901a\u8fc7\u64a4\u9500\u6062\u590d\u3002", () => {
    _(e => {
      e.nodes = [], e.edges = [];
    }), Q([]);
  }), o("confirmCancel").onclick = () => o("confirmDialog").close(), o("canvasTitle").oninput = () => X(() => _(e => {
    e.title = o("canvasTitle").value.trim() || "\u672a\u547d\u540d\u753b\u5e03";
  }, "canvas-title")), o("canvasTitle").readOnly = !0, o("canvasTitle").ondblclick = () => {
    o("canvasTitle").readOnly = !1, o("canvasTitle").focus(), o("canvasTitle").select();
  }, o("canvasTitle").onblur = () => {
    o("canvasTitle").readOnly = !0;
  }, o("saveCanvas").onclick = U, o("exportCanvas").onclick = () => X(async () => {
    U(), (await t.exportCanvas(m)).ok && V("\u5df2\u5bfc\u51fa\u5f53\u524d\u753b\u5e03");
  }), o("importCanvas").onclick = () => o("documentInput").click(), o("documentInput").onchange = () => X(async () => {
    const t = o("documentInput").files[0];
    if (t) {
      if (t.size > 33554432) throw new Error("\u753b\u5e03\u6587\u4ef6\u8d85\u8fc7\u5927\u5c0f\u9650\u5236");
      !function (t) {
        let n = JSON.parse(t),
          o = "manager-canvas" === n.format ? n.canvas : n;
        if (1 === o.version) {
          const t = e.validateDocument(o);
          o = {
            ...e.emptyCanvas("legacy-import", "\u5bfc\u5165\u753b\u5e03"),
            viewport: t.viewport,
            nodes: t.nodes.map(t => ({
              ...t,
              width: e.CARD_WIDTH,
              height: e.CARD_HEIGHT
            }))
          };
        }
        if (o = e.validateCanvas(o), u.canvases.length >= 30) throw new Error("\u753b\u5e03\u6570\u91cf\u5df2\u8fbe\u4e0a\u9650");
        const a = e.emptyCanvas(B(), o.title),
          i = o.nodes.length ? e.pasteFragment(a, e.selectionFragment(o, o.nodes.map(e => e.id)), {
            x: Math.min(...o.nodes.map(e => e.x)),
            y: Math.min(...o.nodes.map(e => e.y))
          }, B).canvas : a;
        i.viewport = o.viewport, u.canvases.push(i), Ne(i.id), G(), U();
      }(await t.text()), o("documentInput").value = "";
    }
  }), o("shortcutsButton").onclick = () => o("shortcutsDialog").showModal(), o("appearanceButton").onclick = () => {
    o("canvasTheme").value = u.appearance.theme, o("canvasGrid").value = u.appearance.grid, o("appearanceDialog").showModal();
  }, o("settingsButton").onclick = o("librarySettings").onclick = () => X(async () => {
    await Pe();
    const e = z.channel || {};
    o("channelUrl").value = e.url || "", o("channelImageModel").value = e.imageModel || "", o("channelTextModel").value = e.textModel || "", o("channelKey").value = "", o("channelState").textContent = e.configured ? "\u5df2\u4fdd\u5b58\u6e20\u9053\uff1b\u7559\u7a7a\u5bc6\u94a5\u53ef\u4fdd\u7559\u73b0\u6709\u5bc6\u94a5" : "\u5c1a\u672a\u914d\u7f6e\u751f\u56fe\u4e0e\u6587\u672c\u6e20\u9053", o("channelDialog").showModal();
  }), o("saveChannel").onclick = () => X(async () => {
    if (!t.configureChannel) throw new Error("\u6a21\u578b\u6e20\u9053\u4e0d\u53ef\u7528");
    await t.configureChannel({
      url: o("channelUrl").value,
      apiKey: o("channelKey").value,
      imageModel: o("channelImageModel").value,
      textModel: o("channelTextModel").value
    }), o("channelKey").value = "", await Pe(), o("channelDialog").close(), V("\u5df2\u4fdd\u5b58\u6a21\u578b\u6e20\u9053");
  }), o("canvasTheme").onchange = () => {
    u.appearance.theme = o("canvasTheme").value, G();
  }, o("canvasGrid").onchange = () => {
    u.appearance.grid = o("canvasGrid").value, G();
  }, document.querySelectorAll("[data-close]").forEach(e => {
    e.onclick = () => o(e.dataset.close).close();
  }), window.addEventListener("keydown", n => {
    if (!b) return;
    const i = n.target.closest('input,textarea,select,[contenteditable="true"]');
    if ("Escape" === n.key) return M ? void ne() : (ke(), Q([]), o("canvasMenu").hidden = !0, T = "", o("mentionList").hidden = !0, void document.querySelectorAll("dialog[open]").forEach(e => e.close()));
    if (i || document.querySelector("dialog[open]")) return;
    const c = n.ctrlKey || n.metaKey,
      s = n.key.toLowerCase();
    if ("Space" === n.code) return E = !0, a.classList.add("panning"), void n.preventDefault();
    c && ["a", "c", "v", "z", "y"].includes(s) ? (n.preventDefault(), X(() => {
      if ("a" === s) Q(m.nodes.map(e => e.id));else {
        if ("c" === s) return Ce();
        if ("v" === s) return async function () {
          if (!b) return;
          const n = await t.readClipboard();
          if (n.image) return void Se(await t.importMedia({
            name: "\u526a\u8d34\u677f\u56fe\u7247.png",
            bytes: n.image
          }));
          if (!n.text) return;
          let o;
          try {
            const e = JSON.parse(n.text);
            "manager-canvas-selection" === e.format && (o = e);
          } catch {}
          if (o) {
            const t = e.screenToWorld(P(), m.viewport),
              n = e.pasteFragment(m, o, t, B);
            Y(n.canvas), Q(n.ids);
          } else {
            if (!(n.text.length <= e.MAX_TEXT)) throw new Error("\u526a\u8d34\u677f\u6587\u672c\u8d85\u8fc7\u8282\u70b9\u957f\u5ea6\u9650\u5236");
            oe({
              type: "text",
              title: "\u6587\u672c",
              text: n.text
            });
          }
        }();
        "y" === s || "z" === s && n.shiftKey ? Z("redo") : Z("undo");
      }
    })) : "Delete" !== n.key && "Backspace" !== n.key || (n.preventDefault(), X(ae));
  }), window.addEventListener("keyup", e => {
    "Space" === e.code && (E = !1, a.classList.remove("panning"));
  }), window.addEventListener("resize", fe), window.addEventListener("blur", () => {
    E = !1, a.classList.remove("panning"), b && (ke(), U());
  }), window.addEventListener("beforeunload", e => {
    b && (ke(), U(), w ? (e.preventDefault(), e.returnValue = "") : N = !0);
  });
  try {
    u = n.load();
    for (const e of u.canvases) for (const t of e.nodes) t.job && l.set(e.id + ":" + t.id, p(t.job));
    m = u.canvases.find(e => e.id === u.activeId), b = !0, he(), V(`\u5df2\u8bfb\u53d6 \xb7 ${m.nodes.length} \u5f20\u5361\u7247`), Pe(), He();
  } catch (e) {
    document.querySelectorAll("button,input,select").forEach(e => {
      e.disabled = !0;
    }), o("canvasEmpty").hidden = !1, o("canvasEmpty").textContent = "\u753b\u5e03\u8bfb\u53d6\u5931\u8d25\uff0c\u539f\u6570\u636e\u5df2\u4fdd\u7559", V(e.message, !0);
  }
  setInterval(() => {
    He();
  }, 5e3);
})();
