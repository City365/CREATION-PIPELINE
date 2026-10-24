"use strict";

const e = require("node:fs"),
  t = require("node:path"),
  {
    pathToFileURL: r,
    fileURLToPath: n
  } = require("node:url"),
  a = require("node:crypto"),
  {
    validateCanvas: i
  } = require("../renderer/canvas-model"),
  {
    createCanvasGeneration: o
  } = require("./canvas-generation"),
  {
    createCanvasChannel: s
  } = require("./canvas-channel"),
  {
    createCanvasMediaExporter: c
  } = require("./canvas-media-export"),
  l = {
    image: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"],
    video: [".mp4", ".webm", ".mov", ".m4v"],
    audio: [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"]
  };
function d(e) {
  return Object.keys(l).find(r => l[r].includes(t.extname(e).toLowerCase())) || "";
}
function u({
  BrowserWindow: u,
  licensedHandle: m,
  getMainWindow: f,
  getDownloadDir: p,
  getResources: w,
  getMediaDirectory: g = () => "",
  getBridgeDirectory: h,
  ensureBridge: y,
  getBuildInfo: v,
  getManagerExe: b,
  getAccounts: x = () => [],
  dialog: D,
  clipboard: C,
  safeStorage: E
}) {
  let P = null;
  const B = async r => {
      if ("string" != typeof r || !r.startsWith("file:")) throw new Error("\u53c2\u8003\u56fe\u8bf7\u5148\u4e0b\u8f7d\u6216\u5bfc\u5165\u753b\u5e03");
      const a = await e.promises.realpath(n(r)),
        i = [p(), g()].filter(Boolean);
      if (!(await Promise.all(i.map(t => e.promises.realpath(t).catch(() => "")))).some(e => {
        const r = e && t.relative(e, a);
        return e && r && !r.startsWith("..") && !t.isAbsolute(r);
      }) || "image" !== d(a) || !(await e.promises.stat(a)).isFile()) throw new Error("\u53c2\u8003\u56fe\u4e0d\u5728\u753b\u5e03\u6216\u4e0b\u8f7d\u7d20\u6750\u76ee\u5f55\u4e2d");
      return a;
    },
    j = h ? o({
      getBridgeDirectory: h,
      ensureBridge: y,
      getBuildInfo: v,
      getManagerExe: b,
      getAccounts: x,
      approveReference: B
    }) : null;
  let k;
  const F = () => {
    if (!E || !g()) throw new Error("\u6a21\u578b\u6e20\u9053\u4e0d\u53ef\u7528");
    return k ||= s({
      directory: t.dirname(g()),
      mediaDirectory: g(),
      safeStorage: E,
      approveReference: B
    });
  };
  function I(e, t) {
    if (!t || e.sender !== t.webContents || e.senderFrame !== t.webContents.mainFrame) throw new Error("\u753b\u5e03\u8bf7\u6c42\u6765\u6e90\u65e0\u6548");
  }
  m("canvas:open", async e => {
    const r = f();
    if (I(e, r), P && !P.isDestroyed()) return P.isMinimized() && P.restore(), P.show(), P.focus(), {
      ok: !0
    };
    const n = new u({
      title: "\u65e0\u9650\u753b\u5e03 \xb7 \u8c46\u5305\u7ba1\u7406\u5668",
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      show: !1,
      backgroundColor: "#171c24",
      webPreferences: {
        preload: t.join(__dirname, "canvas-preload.js"),
        partition: "persist:manager-infinite-canvas",
        sandbox: !0,
        contextIsolation: !0,
        nodeIntegration: !1
      }
    });
    P = n, n.setMenu(null), n.webContents.setWindowOpenHandler(() => ({
      action: "deny"
    })), n.webContents.on("will-navigate", e => e.preventDefault());
    const a = n.webContents.session;
    a.setPermissionRequestHandler((e, t, r) => r(!1)), a.setPermissionCheckHandler(() => !1);
    const i = () => {
      n.isDestroyed() || n.close();
    };
    r.once("closed", i), n.on("closed", () => {
      a.flushStorageData(), r.removeListener("closed", i), P === n && (P = null);
    });
    try {
      return await n.loadFile(t.join(__dirname, "..", "renderer", "canvas.html")), n.isDestroyed() || n.show(), {
        ok: !0
      };
    } catch (e) {
      throw n.isDestroyed() || n.close(), e;
    }
  }), m("canvas:media", async n => {
    I(n, P);
    const a = w().filter(e => "image" === e.type || "video" === e.type).slice(0, 500).map(e => ({
        id: `capture:${e.id}`,
        resourceId: e.id,
        type: e.type,
        name: e.name,
        url: e.url,
        preview: e.preview || ""
      })),
      i = p(),
      o = await e.promises.readdir(i, {
        withFileTypes: !0
      }).catch(e => {
        if ("ENOENT" === e.code) return [];
        throw e;
      });
    for (const e of o.filter(e => e.isFile()).slice(0, 500)) {
      const n = d(e.name);
      if (!n) continue;
      const o = r(t.join(i, e.name)).href;
      a.push({
        id: `local:${o}`,
        resourceId: "",
        type: n,
        name: e.name,
        url: o,
        preview: ""
      });
    }
    return a;
  });
  const q = (e, t) => m(e, (e, r) => (I(e, P), t(r))),
    M = c({
      getRoots: () => [p(), g()],
      chooseDirectory: async () => {
        const e = await D.showOpenDialog(P, {
          title: "\u9009\u53d6\u56fe\u7247\u548c\u89c6\u9891\u53e6\u5b58\u6587\u4ef6\u5939",
          properties: ["openDirectory", "createDirectory"]
        });
        return e.canceled ? null : e.filePaths?.[0];
      },
      chooseFile: async (e, r) => {
        const n = [...new Set([t.extname(r), ...l[e.type]])].map(e => e.slice(1)),
          a = await D.showSaveDialog(P, {
            title: "\u56fe\u7247\u548c\u89c6\u9891\u53e6\u5b58\u4e3a",
            defaultPath: r,
            filters: [{
              name: "image" === e.type ? "\u56fe\u7247\u539f\u6587\u4ef6" : "\u89c6\u9891\u539f\u6587\u4ef6",
              extensions: n
            }]
          });
        return a.canceled ? null : a.filePath;
      }
    });
  q("canvas:export-media", e => M.exportMedia(e)), q("canvas:import-media", async n => {
    const i = "string" == typeof n?.name ? t.basename(n.name.replace(/\\/g, "/")).slice(0, 180) : "",
      o = d(i),
      s = g();
    if (!o || !s || !(n.bytes instanceof ArrayBuffer) || !n.bytes.byteLength || n.bytes.byteLength > 104857600) throw new Error("\u7d20\u6750\u683c\u5f0f\u65e0\u6548\u6216\u8d85\u8fc7 100 MB");
    await e.promises.mkdir(s, {
      recursive: !0
    });
    const c = a.randomUUID(),
      l = t.join(s, c + t.extname(i).toLowerCase());
    return await e.promises.writeFile(l, Buffer.from(n.bytes), {
      flag: "wx"
    }), {
      id: c,
      type: o,
      name: i,
      url: r(l).href,
      preview: "",
      resourceId: ""
    };
  }), q("canvas:export", async t => {
    const r = i(t),
      n = await D.showSaveDialog(P, {
        title: "\u5bfc\u51fa\u5f53\u524d\u753b\u5e03",
        defaultPath: r.title.replace(/[<>:"/\\|?*]/g, "_") + ".json",
        filters: [{
          name: "\u753b\u5e03\u6587\u4ef6",
          extensions: ["json"]
        }]
      });
    return n.canceled || !n.filePath ? {
      canceled: !0
    } : (await e.promises.writeFile(n.filePath, JSON.stringify({
      format: "manager-canvas",
      canvas: r
    }, null, 2) + "\n"), {
      ok: !0
    });
  }), q("canvas:clipboard-write", e => {
    if ("string" != typeof e || e.length > 2097152) throw new Error("\u526a\u8d34\u677f\u5185\u5bb9\u8fc7\u5927");
    return C.writeText(e), !0;
  }), q("canvas:clipboard-read", () => {
    const e = C.readImage();
    if (!e.isEmpty()) {
      const t = e.toPNG();
      if (t.length > 104857600) throw new Error("\u526a\u8d34\u677f\u56fe\u7247\u8fc7\u5927");
      return {
        image: t.buffer.slice(t.byteOffset, t.byteOffset + t.length)
      };
    }
    return {
      text: C.readText().slice(0, 2097152)
    };
  }), q("canvas:context", async () => {
    const e = j ? await j.context() : {
      accounts: [],
      ready: !1,
      capabilities: {},
      message: "\u672c\u5730\u6865\u63a5\u672a\u8fde\u63a5"
    };
    return e.channel = E && g() ? F().context() : {
      configured: !1
    }, e;
  }), q("canvas:channel-configure", e => F().configure(e));
  for (const e of ["submit", "status", "cancel"]) q("canvas:task-" + e, t => {
    if ("submit" === e && ["image", "text"].includes(t?.mode) || "submit" !== e && t?.taskId?.startsWith("channel-")) return F()[e](t);
    if (!j) throw new Error("\u672c\u5730\u6865\u63a5\u672a\u8fde\u63a5");
    return j[e](t);
  });
}
module.exports = {
  registerCanvasWorkspace: u,
  mediaType: d
};
