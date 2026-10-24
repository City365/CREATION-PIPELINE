"use strict";

const {
    contextBridge: e,
    ipcRenderer: o
  } = require("electron"),
  i = "--dbm-webview-preload-url=",
  n = process.argv.find(e => String(e).startsWith(i)),
  s = String(n || "").slice(26);
if (!s.startsWith("file:")) throw new Error("Missing sandboxed WebView preload URL");
e.exposeInMainWorld("managerAPI", {
  canvas: {
    open: () => o.invoke("canvas:open")
  },
  app: {
    relaunch: () => o.invoke("app:relaunch"),
    buildInfo: () => o.invoke("app:build-info")
  },
  runtime: {
    webviewPreloadUrl: s,
    noWatermarkResolver: () => o.invoke("runtime:no-watermark-resolver"),
    capabilities: () => o.invoke("runtime:capabilities"),
    debugger: {
      attach: e => o.invoke("runtime:debugger-attach", e),
      send: e => o.invoke("runtime:debugger-send", e),
      poll: e => o.invoke("runtime:debugger-poll", e),
      detach: e => o.invoke("runtime:debugger-detach", e)
    },
    report: e => o.invoke("runtime:report", e),
    onWebviewGone: e => o.on("webview:gone", (o, i) => e(i))
  },
  window: {
    minimize: () => o.send("window:minimize"),
    maximize: () => o.send("window:maximize"),
    close: () => o.send("window:close"),
    isMaximized: () => o.invoke("window:is-maximized"),
    showVerification: e => o.invoke("window:show-verification", e),
    finishVerification: (e, i) => o.invoke("window:finish-verification", e, i)
  },
  clipboard: {
    write: e => o.invoke("clipboard:write", e)
  },
  license: {
    status: () => o.invoke("license:status"),
    pluginSession: e => o.invoke("license:plugin-session", e),
    activate: e => o.invoke("license:activate", e),
    open: () => o.invoke("license:open"),
    onMessage: e => o.on("license:message", (o, i) => e(i))
  },
  platforms: {
    list: () => o.invoke("platforms:list")
  },
  accounts: {
    list: () => o.invoke("accounts:list"),
    add: e => o.invoke("accounts:add", e),
    update: (e, i) => o.invoke("accounts:update", e, i),
    delete: (e, i = {}) => o.invoke("accounts:delete", e, i),
    deleteBatch: e => o.invoke("accounts:delete-batch", e),
    export: e => o.invoke("accounts:export", e),
    import: () => o.invoke("accounts:import"),
    pendingStorage: e => o.invoke("accounts:pending-storage", e),
    storageRestored: e => o.invoke("accounts:storage-restored", e),
    onCooldownChanged: e => o.on("accounts:cooldown-changed", (o, i) => e(i))
  },
  resources: {
    list: () => o.invoke("resources:list"),
    capture: (e, i) => o.invoke("resources:capture", e, i),
    clear: () => o.invoke("resources:clear"),
    onUpdated: e => o.on("resources:updated", (o, i) => e(i))
  },
  video: {
    choose: () => o.invoke("video:choose"),
    removeWatermark: e => o.invoke("video:remove-watermark", e),
    openOutput: e => o.invoke("video:open-output", e),
    onProgress: e => o.on("video:progress", (o, i) => e(i))
  },
  downloads: {
    path: () => o.invoke("downloads:path"),
    choosePath: () => o.invoke("downloads:choose-path"),
    openPath: () => o.invoke("downloads:open-path"),
    list: () => o.invoke("downloads:list"),
    openFile: e => o.invoke("downloads:open-file", e),
    reveal: e => o.invoke("downloads:reveal", e),
    delete: e => o.invoke("downloads:delete", e),
    resource: e => o.invoke("downloads:resource", e),
    onFinished: e => o.on("download:finished", (o, i) => e(i))
  }
});
