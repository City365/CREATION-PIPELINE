"use strict";

const {
  contextBridge: a,
  ipcRenderer: e
} = require("electron");
a.exposeInMainWorld("canvasAPI", {
  listMedia: () => e.invoke("canvas:media"),
  importMedia: a => e.invoke("canvas:import-media", a),
  exportCanvas: a => e.invoke("canvas:export", a),
  exportMedia: a => e.invoke("canvas:export-media", a),
  writeClipboard: a => e.invoke("canvas:clipboard-write", a),
  readClipboard: () => e.invoke("canvas:clipboard-read"),
  context: () => e.invoke("canvas:context"),
  configureChannel: a => e.invoke("canvas:channel-configure", a),
  submit: a => e.invoke("canvas:task-submit", a),
  status: a => e.invoke("canvas:task-status", a),
  cancel: a => e.invoke("canvas:task-cancel", a)
});
