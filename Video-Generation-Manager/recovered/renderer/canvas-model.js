!function (e, o) {
  "object" == typeof module && module.exports ? module.exports = o() : e.CanvasModel = o();
}("undefined" != typeof globalThis ? globalThis : this, function () {
  "use strict";

  const e = "manager:infinite-canvas:v1",
    o = "manager:infinite-canvas:v2",
    t = 320,
    r = 270,
    n = 1e4,
    i = 1e3,
    s = .1;
  function a(e) {
    if ("number" != typeof e || !Number.isFinite(e) || Math.abs(e) > 1e12) throw new Error("\u753b\u5e03\u5750\u6807\u65e0\u6548");
    return e;
  }
  function d(e, o) {
    if ("string" != typeof e || e.length > o) throw new Error("\u753b\u5e03\u5185\u5bb9\u8d85\u51fa\u9650\u5236\u6216\u683c\u5f0f\u65e0\u6548");
    return e;
  }
  function c(e, o = !1) {
    if (o && "" === e) return "";
    if (d(e, 8192), !["http:", "https:", "file:"].includes(new URL(e).protocol)) throw new Error("\u7d20\u6750\u5730\u5740\u65e0\u6548");
    return e;
  }
  function f(e) {
    if (!e || 1 !== e.version) throw new Error("\u753b\u5e03\u6570\u636e\u7248\u672c\u4e0d\u517c\u5bb9\uff0c\u539f\u6570\u636e\u5df2\u4fdd\u7559");
    if (!Array.isArray(e.nodes) || e.nodes.length > i) throw new Error("\u753b\u5e03\u5361\u7247\u6570\u91cf\u8d85\u51fa\u9650\u5236");
    const o = {
      x: a(e.viewport?.x),
      y: a(e.viewport?.y),
      zoom: a(e.viewport?.zoom)
    };
    if (o.zoom < s || o.zoom > 3) throw new Error("\u753b\u5e03\u7f29\u653e\u65e0\u6548");
    const t = new Set();
    return {
      version: 1,
      viewport: o,
      nodes: e.nodes.map(e => {
        const o = d(e?.id, 80);
        if (!o || t.has(o)) throw new Error("\u753b\u5e03\u5361\u7247\u6807\u8bc6\u65e0\u6548\u6216\u91cd\u590d");
        t.add(o);
        const r = {
          id: o,
          type: e.type,
          title: d(e.title, 120),
          x: a(e.x),
          y: a(e.y)
        };
        if ("text" === e.type) r.text = d(e.text, n);else {
          if ("image" !== e.type && "video" !== e.type) throw new Error("\u753b\u5e03\u5361\u7247\u7c7b\u578b\u65e0\u6548");
          r.source = {
            url: c(e.source?.url),
            preview: c(e.source?.preview || "", !0),
            resourceId: d(e.source?.resourceId || "", 200)
          };
        }
        return r;
      })
    };
  }
  function u(e, o) {
    return {
      x: (e.x - o.x) / o.zoom,
      y: (e.y - o.y) / o.zoom
    };
  }
  function m(e, o = "\u65e0\u9650\u753b\u5e03 1") {
    return {
      version: 2,
      id: e,
      title: o,
      viewport: {
        x: 0,
        y: 0,
        zoom: 1
      },
      nodes: [],
      edges: []
    };
  }
  function l() {
    return {
      version: 2,
      activeId: "canvas-1",
      canvases: [m("canvas-1")],
      assets: [],
      appearance: {
        theme: "dark",
        grid: "lines"
      }
    };
  }
  function h(e) {
    const o = {
      id: d(e?.id, 80),
      type: e?.type,
      title: d(e?.title, 120),
      x: a(e?.x),
      y: a(e?.y),
      width: a(e?.width),
      height: a(e?.height)
    };
    if (!o.id || o.width < 120 || o.width > 4e3 || o.height < 100 || o.height > 4e3) throw new Error("\u8282\u70b9\u5c3a\u5bf8\u6216\u6807\u8bc6\u65e0\u6548");
    if ("text" === e.type) {
      if (o.text = d(e.text, n), void 0 !== e.fontSize && (o.fontSize = a(e.fontSize), o.fontSize < 12 || o.fontSize > 64)) throw new Error("\u5b57\u53f7\u65e0\u6548");
    } else if (["image", "video", "audio"].includes(e.type)) {
      if (o.source = e.source ? {
        url: c(e.source.url),
        preview: c(e.source.preview || "", !0),
        resourceId: d(e.source.resourceId || "", 200)
      } : null, e.generation && ["image", "video"].includes(e.type)) {
        const t = h({
          ...e,
          type: "config",
          config: e.generation
        });
        if (o.generation = t.config, t.job && (o.job = t.job), (o.generation.mode || "video") !== e.type) throw new Error("\u8282\u70b9\u751f\u6210\u6a21\u5f0f\u4e0d\u5339\u914d");
      }
    } else if ("config" === e.type) {
      const t = e.config || {};
      if (!(["doubao", "dola"].includes(t.platform) && ["seedance2.0fast", "seedance2.0mini", "dreamina-seedance2.5", "seedance2.5"].includes(t.model) && [5, 10, 15, 30].includes(t.duration) && ["16:9", "9:16"].includes(t.ratio))) throw new Error("\u751f\u6210\u914d\u7f6e\u65e0\u6548");
      if ("dreamina-seedance2.5" === t.model && "dola" !== t.platform) throw new Error("\u8be5\u914d\u7f6e\u4ec5\u652f\u6301 Dola");
      if ("seedance2.5" === t.model && "doubao" !== t.platform) throw new Error("\u8be5\u914d\u7f6e\u4ec5\u652f\u6301\u8c46\u5305");
      if (30 === t.duration && !("dola" === t.platform && "dreamina-seedance2.5" === t.model || "doubao" === t.platform && "seedance2.5" === t.model)) throw new Error("30 \u79d2\u4ec5\u652f\u6301\u5bf9\u5e94\u5e73\u53f0\u7684 Seedance 2.5");
      if (o.config = {
        platform: t.platform,
        model: t.model,
        duration: t.duration,
        ratio: t.ratio,
        prompt: d(t.prompt || "", n),
        accountId: d(t.accountId || "", 200)
      }, void 0 !== t.mode) {
        if (!["image", "text", "video"].includes(t.mode)) throw new Error("\u751f\u6210\u6a21\u5f0f\u65e0\u6548");
        if (o.config.mode = t.mode, o.config.channelModel = d(t.channelModel || "", 200), o.config.count = t.count ?? 1, o.config.quality = t.quality || "auto", o.config.imageRatio = t.imageRatio || "1:1", o.config.reasoning = t.reasoning || "auto", !Number.isInteger(o.config.count) || o.config.count < 1 || o.config.count > 4 || !["auto", "low", "medium", "high"].includes(o.config.quality) || !["1:1", "16:9", "9:16"].includes(o.config.imageRatio) || !["auto", "none", "low", "medium", "high"].includes(o.config.reasoning)) throw new Error("\u6a21\u578b\u53c2\u6570\u65e0\u6548");
        for (const e of ["imageCount", "textCount"]) if (void 0 !== t[e]) {
          if (!Number.isInteger(t[e]) || t[e] < 1 || t[e] > 4) throw new Error("\u6a21\u578b\u53c2\u6570\u65e0\u6548");
          o.config[e] = t[e];
        }
      }
      e.job && (o.job = {
        requestId: d(e.job.requestId, 80),
        taskId: d(e.job.taskId || "", 80),
        phase: d(e.job.phase || "", 30),
        resultNodeId: d(e.job.resultNodeId || "", 80)
      });
    } else if ("account" === e.type) o.accountId = d(e.accountId || "", 200);else {
      if ("group" !== e.type) throw new Error("\u8282\u70b9\u7c7b\u578b\u65e0\u6548");
      if (!Array.isArray(e.members) || e.members.length > i) throw new Error("\u5206\u7ec4\u65e0\u6548");
      o.members = [...new Set(e.members.map(e => d(e, 80)))];
    }
    return o;
  }
  function p(e) {
    if (2 !== e?.version) throw new Error("\u753b\u5e03\u7248\u672c\u4e0d\u517c\u5bb9");
    const o = d(e.id, 80),
      t = d(e.title, 120);
    if (!o || !t.trim() || !Array.isArray(e.nodes) || e.nodes.length > i || !Array.isArray(e.edges) || e.edges.length > 3e3) throw new Error("\u753b\u5e03\u7ed3\u6784\u65e0\u6548\u6216\u8d85\u51fa\u9650\u5236");
    const r = {
      x: a(e.viewport?.x),
      y: a(e.viewport?.y),
      zoom: a(e.viewport?.zoom)
    };
    if (r.zoom < s || r.zoom > 3) throw new Error("\u753b\u5e03\u7f29\u653e\u65e0\u6548");
    const n = e.nodes.map(h),
      c = new Map(n.map(e => [e.id, e]));
    if (c.size !== n.length) throw new Error("\u8282\u70b9\u6807\u8bc6\u91cd\u590d");
    for (const e of n.filter(e => "group" === e.type)) if (e.members.some(e => !c.has(e) || "group" === c.get(e).type)) throw new Error("\u5206\u7ec4\u6210\u5458\u65e0\u6548");
    const f = new Set(),
      u = new Set(),
      m = new Map(n.map(e => [e.id, []])),
      l = e.edges.map(e => {
        const o = {
            id: d(e?.id, 80),
            from: d(e?.from, 80),
            to: d(e?.to, 80)
          },
          t = JSON.stringify([o.from, o.to]);
        if (!o.id || f.has(o.id) || u.has(t) || o.from === o.to || !c.has(o.from) || !c.has(o.to)) throw new Error("\u8fde\u7ebf\u65e0\u6548\u6216\u91cd\u590d");
        return f.add(o.id), u.add(t), m.get(o.from).push(o.to), o;
      }),
      p = new Set(),
      g = new Set();
    function w(e) {
      if (p.has(e)) throw new Error("\u8282\u70b9\u4e0d\u80fd\u5f62\u6210\u5faa\u73af\u5f15\u7528");
      if (!g.has(e)) {
        p.add(e);
        for (const o of m.get(e)) w(o);
        p.delete(e), g.add(e);
      }
    }
    return n.forEach(e => w(e.id)), {
      version: 2,
      id: o,
      title: t,
      viewport: r,
      nodes: n,
      edges: l
    };
  }
  function g(e) {
    if (2 !== e?.version || !Array.isArray(e.canvases) || e.canvases.length < 1 || e.canvases.length > 30 || !Array.isArray(e.assets) || e.assets.length > 500) throw new Error("\u5de5\u4f5c\u533a\u7248\u672c\u6216\u7ed3\u6784\u4e0d\u517c\u5bb9\uff0c\u539f\u6570\u636e\u5df2\u4fdd\u7559");
    const o = e.canvases.map(p),
      t = new Set(o.map(e => e.id));
    if (t.size !== o.length || !t.has(e.activeId)) throw new Error("\u5f53\u524d\u753b\u5e03\u6807\u8bc6\u65e0\u6548");
    const r = void 0 === e.folders ? void 0 : e.folders;
    if (void 0 !== r && (!Array.isArray(r) || r.length > 100 || r.some(e => "string" != typeof e?.id || !e.id || e.id.length > 80 || "string" != typeof e.title || !e.title.trim() || e.title.length > 120) || new Set(r.map(e => e.id)).size !== r.length)) throw new Error("\u8d44\u4ea7\u6587\u4ef6\u5939\u65e0\u6548");
    const n = e.assets.map(e => {
      const o = h(e);
      if (e.folderId) {
        if (!r?.some(o => o.id === e.folderId)) throw new Error("\u8d44\u4ea7\u6587\u4ef6\u5939\u5f15\u7528\u65e0\u6548");
        o.folderId = e.folderId;
      }
      return o;
    });
    if (n.some(e => !["text", "image", "video", "audio"].includes(e.type)) || new Set(n.map(e => e.id)).size !== n.length) throw new Error("\u8d44\u4ea7\u65e0\u6548");
    const i = e.appearance || {
      theme: "dark",
      grid: "lines"
    };
    if (!["dark", "light"].includes(i.theme) || !["lines", "dots", "none"].includes(i.grid)) throw new Error("\u753b\u5e03\u5916\u89c2\u65e0\u6548");
    return {
      version: 2,
      activeId: e.activeId,
      canvases: o,
      assets: n,
      appearance: {
        theme: i.theme,
        grid: i.grid
      },
      ...(r ? {
        folders: r.map(e => ({
          id: e.id,
          title: e.title
        }))
      } : {})
    };
  }
  const w = e => JSON.parse(JSON.stringify(e));
  function y(e, o, t, r) {
    const n = new Set(o);
    if ([...n].some(o => !e.nodes.some(e => e.id === o))) throw new Error("\u53c2\u8003\u8282\u70b9\u4e0d\u5b58\u5728");
    const i = [...e.edges];
    for (const o of e.nodes.filter(e => n.has(e.id))) {
      if (o.id === t) throw new Error("\u8fde\u7ebf\u4e0d\u80fd\u5f15\u7528\u81ea\u8eab");
      i.some(e => e.from === o.id && e.to === t) || i.push({
        id: r(),
        from: o.id,
        to: t
      });
    }
    return p({
      ...e,
      edges: i
    });
  }
  function v(e, o) {
    const t = new Set(e.edges.filter(e => e.to === o).map(e => e.from));
    for (const o of e.nodes) t.has(o.id) && "group" === o.type && o.members.forEach(e => t.add(e));
    return e.nodes.filter(e => t.has(e.id) && "group" !== e.type);
  }
  function x(e) {
    const o = {},
      t = {
        text: "\u6587\u672c",
        image: "\u56fe\u7247",
        video: "\u89c6\u9891",
        audio: "\u97f3\u9891"
      };
    return e.filter(e => t[e.type] && ("text" === e.type || e.source)).map(e => ({
      node: e,
      label: t[e.type] + (o[e.type] = (o[e.type] || 0) + 1)
    }));
  }
  function E(e, o) {
    const t = e.nodes.find(e => e.id === o),
      r = v(e, o);
    return "image" === t?.type && t.generation && t.source && r.unshift(t), x(r);
  }
  function b(e, o) {
    const t = x(o);
    return e.replace(/@\{([^}]+)\}/g, (e, o) => {
      const r = t.find(e => e.node.id === o),
        n = r?.node;
      if (!n) throw new Error("\u63d0\u793a\u8bcd\u5f15\u7528\u5df2\u65ad\u5f00\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9\u53c2\u8003\u8282\u70b9");
      return "text" === n.type ? n.text : "@" + r.label;
    });
  }
  return {
    STORAGE_KEY: e,
    WORKSPACE_KEY: o,
    CARD_WIDTH: t,
    CARD_HEIGHT: r,
    MAX_TEXT: n,
    MAX_NODES: i,
    emptyDocument: function () {
      return {
        version: 1,
        viewport: {
          x: 0,
          y: 0,
          zoom: 1
        },
        nodes: []
      };
    },
    validateDocument: f,
    screenToWorld: u,
    zoomAtPoint: function (e, o, t) {
      const r = u(t, e);
      return o = Math.min(3, Math.max(s, o)), {
        x: t.x - r.x * o,
        y: t.y - r.y * o,
        zoom: o
      };
    },
    fitViewport: function (e, o, n) {
      if (!e.length) return {
        x: 0,
        y: 0,
        zoom: 1
      };
      const i = Math.min(...e.map(e => e.x)),
        a = Math.min(...e.map(e => e.y)),
        d = Math.max(...e.map(e => e.x + (e.width || t))),
        c = Math.max(...e.map(e => e.y + (e.height || r))),
        f = Math.max(s, Math.min(1, (o - 80) / (d - i), (n - 80) / (c - a)));
      return {
        x: o / 2 - (i + d) / 2 * f,
        y: n / 2 - (a + c) / 2 * f,
        zoom: f
      };
    },
    visibleNodes: function (e, o, n, i) {
      return e.filter(e => {
        const s = e.x * o.zoom + o.x,
          a = e.y * o.zoom + o.y;
        return s + (e.width || t) * o.zoom >= -120 && s <= n + 120 && a + (e.height || r) * o.zoom >= -120 && a <= i + 120;
      });
    },
    createCanvasStorage: function (o) {
      let t = !1;
      return {
        load() {
          t = !1;
          const r = o.getItem(e),
            n = null === r ? {
              version: 1,
              viewport: {
                x: 0,
                y: 0,
                zoom: 1
              },
              nodes: []
            } : f(JSON.parse(r));
          return t = !0, n;
        },
        save(r) {
          if (!t) throw new Error("\u753b\u5e03\u672a\u6210\u529f\u8bfb\u53d6\uff0c\u7981\u6b62\u8986\u76d6\u539f\u6570\u636e");
          const n = JSON.stringify(f(r));
          if (n.length > 2097152) throw new Error("\u753b\u5e03\u5185\u5bb9\u8fc7\u5927\uff0c\u8bf7\u51cf\u5c11\u6587\u672c\u6216\u5361\u7247");
          o.setItem(e, n);
        }
      };
    },
    emptyCanvas: m,
    emptyWorkspace: l,
    validateCanvas: p,
    validateWorkspace: g,
    createWorkspaceStorage: function (n) {
      let i = !1;
      return {
        load() {
          i = !1;
          const s = n.getItem(o);
          let a;
          if (null !== s) a = g(JSON.parse(s));else {
            a = l();
            const o = n.getItem(e);
            if (null !== o) {
              const e = f(JSON.parse(o));
              a.canvases[0].viewport = e.viewport, a.canvases[0].nodes = e.nodes.map(e => ({
                ...e,
                width: t,
                height: r
              }));
            }
            a = g(a);
          }
          return i = !0, a;
        },
        save(e) {
          if (!i) throw new Error("\u5de5\u4f5c\u533a\u672a\u6210\u529f\u8bfb\u53d6\uff0c\u7981\u6b62\u8986\u76d6\u539f\u6570\u636e");
          const t = JSON.stringify(g(e));
          if (t.length > 8388608) throw new Error("\u753b\u5e03\u5185\u5bb9\u8fc7\u5927\uff0c\u8bf7\u51cf\u5c11\u8282\u70b9\u6216\u6587\u672c");
          n.setItem(o, t);
        }
      };
    },
    connectNodes: function (e, o, t, r) {
      return p({
        ...e,
        edges: [...e.edges, {
          id: r,
          from: o,
          to: t
        }]
      });
    },
    connectSelection: y,
    createConnectedNode: function (e, o, t, r) {
      const n = w(t);
      return delete n.job, y(p({
        ...e,
        nodes: [...e.nodes, n]
      }), o, n.id, r);
    },
    removeNodes: function (e, o) {
      const t = new Set(o);
      for (const o of e.nodes) t.has(o.id) && "group" === o.type && o.members.forEach(e => t.add(e));
      return p({
        ...e,
        nodes: e.nodes.filter(e => !t.has(e.id)).map(e => "group" === e.type ? {
          ...e,
          members: e.members.filter(e => !t.has(e))
        } : e),
        edges: e.edges.filter(e => !t.has(e.from) && !t.has(e.to))
      });
    },
    selectionFragment: function (e, o) {
      const t = new Set(o);
      for (const o of e.nodes) t.has(o.id) && "group" === o.type && o.members.forEach(e => t.add(e));
      return {
        format: "manager-canvas-selection",
        nodes: w(e.nodes.filter(e => t.has(e.id)).map(e => "group" === e.type ? {
          ...e,
          members: e.members.filter(e => t.has(e))
        } : e)),
        edges: w(e.edges.filter(e => t.has(e.from) && t.has(e.to)))
      };
    },
    pasteFragment: function (e, o, t, r) {
      if ("manager-canvas-selection" !== o?.format || !Array.isArray(o.nodes) || !o.nodes.length) throw new Error("\u526a\u8d34\u677f\u8282\u70b9\u65e0\u6548");
      const n = p({
          ...m("clipboard", "\u526a\u8d34\u677f"),
          nodes: o.nodes,
          edges: o.edges
        }),
        i = new Map(n.nodes.map(e => [e.id, r()])),
        s = Math.min(...n.nodes.map(e => e.x)),
        a = Math.min(...n.nodes.map(e => e.y)),
        d = n.nodes.map(e => {
          const o = {
            ...e,
            id: i.get(e.id),
            x: t.x + e.x - s,
            y: t.y + e.y - a,
            ...("group" === e.type ? {
              members: e.members.map(e => i.get(e))
            } : {})
          };
          return delete o.job, o;
        }),
        c = n.edges.map(e => ({
          id: r(),
          from: i.get(e.from),
          to: i.get(e.to)
        }));
      return {
        canvas: p({
          ...e,
          nodes: [...e.nodes, ...d],
          edges: [...e.edges, ...c]
        }),
        ids: d.map(e => e.id)
      };
    },
    alignNodes: function (e, o, t) {
      const r = new Set(o),
        n = e.filter(e => r.has(e.id));
      if (n.length < 2) return w(e);
      const i = Math.min(...n.map(e => e.x)),
        s = Math.max(...n.map(e => e.x + e.width)),
        a = Math.min(...n.map(e => e.y)),
        d = Math.max(...n.map(e => e.y + e.height));
      return e.map(e => {
        const o = {
          ...e
        };
        if (!r.has(e.id)) return o;
        if ("left" === t) o.x = i;else if ("right" === t) o.x = s - e.width;else if ("center" === t) o.x = (i + s - e.width) / 2;else if ("top" === t) o.y = a;else if ("bottom" === t) o.y = d - e.height;else {
          if ("middle" !== t) throw new Error("\u6392\u5217\u65b9\u5f0f\u65e0\u6548");
          o.y = (a + d - e.height) / 2;
        }
        return o;
      });
    },
    arrangeNodes: function (e, o, t) {
      if (!["horizontal", "vertical", "grid", "uniform"].includes(t)) throw new Error("\u6392\u5217\u65b9\u5f0f\u65e0\u6548");
      const r = new Set(o),
        n = e.filter(e => r.has(e.id));
      if (n.length < 2) return w(e);
      const i = Math.min(...n.map(e => e.x)),
        s = Math.min(...n.map(e => e.y)),
        a = Math.max(...n.map(e => e.width)),
        d = Math.max(...n.map(e => e.height)),
        c = [...n].sort("horizontal" === t ? (e, o) => e.x - o.x || e.y - o.y : (e, o) => e.y - o.y || e.x - o.x),
        f = new Map(),
        u = Math.ceil(Math.sqrt(n.length));
      let m = 0;
      return c.forEach((e, o) => {
        "horizontal" === t ? (f.set(e.id, {
          x: i + m,
          y: s + (d - e.height) / 2
        }), m += e.width + 32) : "vertical" === t ? (f.set(e.id, {
          x: i + (a - e.width) / 2,
          y: s + m
        }), m += e.height + 32) : "grid" === t ? f.set(e.id, {
          x: i + o % u * (a + 32) + (a - e.width) / 2,
          y: s + Math.floor(o / u) * (d + 32) + (d - e.height) / 2
        }) : f.set(e.id, {
          width: a,
          height: d
        });
      }), e.map(e => ({
        ...e,
        ...f.get(e.id)
      }));
    },
    createHistory: function (e) {
      let o = p(e),
        t = "",
        r = 0;
      const n = [],
        i = [];
      return {
        record(e, s = "") {
          const a = p(e);
          if (JSON.stringify(a) === JSON.stringify(o)) return;
          const d = Date.now();
          (!s || s !== t || d - r > 750) && (n.push(o), n.length > 40 && n.shift()), o = a, i.length = 0, t = s, r = d;
        },
        undo: () => (n.length && (i.push(o), o = n.pop()), t = "", w(o)),
        redo: () => (i.length && (n.push(o), o = i.pop()), t = "", w(o)),
        get canUndo() {
          return n.length > 0;
        },
        get canRedo() {
          return i.length > 0;
        }
      };
    },
    restoreCanvasEdit: function (e, o, t) {
      const r = w(e);
      r.viewport = w(o.viewport);
      for (const e of r.nodes) if ("config" === e.type || e.generation) {
        const r = t.get(e.id);
        if (r ? e.job = w(r) : delete e.job, e.generation && "succeeded" === r?.phase && r.resultNodeId === e.id) {
          const t = o.nodes.find(o => o.id === e.id);
          t?.source && (e.source = w(t.source));
        }
      }
      return p(r);
    },
    selectionActions: function (e) {
      return e.length ? e.length > 1 ? ["copy", "asset", "group", "align", "arrange", "remove"] : {
        text: ["info", "copy", "asset", "image", "smaller", "larger", "remove"],
        image: ["info", "copy", "asset", "edit", "upload", "remove"],
        video: ["info", "copy", "edit", "upload", "remove"],
        audio: ["info", "copy", "asset", "upload", "remove"],
        config: ["info", "copy", "configure", "remove"],
        account: ["info", "copy", "remove"],
        group: ["info", "copy", "ungroup", "remove"]
      }[e[0]] || [] : [];
    },
    selectedMedia: function (e, o) {
      const t = new Set(o);
      return e.filter(e => t.has(e.id) && ["image", "video"].includes(e.type) && e.source?.url).map(e => ({
        id: e.id,
        type: e.type,
        title: e.title,
        url: e.source.url
      }));
    },
    connectedReferences: v,
    referenceEntries: E,
    formatMentions: function (e, o) {
      return e.replace(/@\{([^}]+)\}/g, (e, t) => {
        const r = o.find(e => e.node.id === t);
        return r ? "@" + r.label : e;
      });
    },
    encodeMentions: function (e, o) {
      return e.replace(/@(\u56fe\u7247|\u89c6\u9891|\u97f3\u9891|\u6587\u672c)(\d+)/g, (e, t, r) => {
        const n = o.find(e => e.label === t + r);
        return n ? "@{" + n.node.id + "}" : e;
      });
    },
    resolveMentions: b,
    generationInput: function (e, o) {
      const t = (e = p(e)).nodes.find(e => e.id === o && ("config" === e.type || e.generation)),
        r = t?.generation ? {
          ...t,
          config: t.generation
        } : t;
      if (!r) throw new Error("\u751f\u6210\u914d\u7f6e\u4e0d\u5b58\u5728");
      const n = v(e, o);
      if (n.some(e => ("video" === e.type || "audio" === e.type) && e.source)) throw new Error("\u73b0\u6709\u89c6\u9891\u6d41\u7a0b\u4ec5\u652f\u6301\u56fe\u7247\u53c2\u8003\uff0c\u8bf7\u79fb\u9664\u89c6\u9891\u6216\u97f3\u9891\u8fde\u7ebf");
      const i = E(e, o),
        s = i.filter(e => "image" === e.node.type).map(e => e.node.source.url),
        a = [...n.filter(e => "text" === e.type && !r.config.prompt.includes("@{" + e.id + "}")).map(e => e.text), b(r.config.prompt, i.map(e => e.node))].filter(Boolean).join("\n"),
        d = n.filter(e => "account" === e.type && e.accountId).map(e => e.accountId);
      if (d.length > 1) throw new Error("\u6bcf\u4e2a\u751f\u6210\u914d\u7f6e\u53ea\u80fd\u8fde\u63a5\u4e00\u4e2a\u8d26\u53f7");
      return {
        ...r.config,
        prompt: a,
        references: s,
        accountId: d[0] || r.config.accountId
      };
    }
  };
});
