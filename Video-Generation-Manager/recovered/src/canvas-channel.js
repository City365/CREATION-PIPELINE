"use strict";

const e = require("node:fs"),
  t = require("node:path"),
  r = require("node:crypto"),
  {
    pathToFileURL: n
  } = require("node:url"),
  {
    validateCanvas: o,
    emptyCanvas: s
  } = require("../renderer/canvas-model");
function a({
  directory: a,
  mediaDirectory: i,
  safeStorage: c,
  approveReference: l,
  fetchRequest: u = globalThis.fetch
}) {
  const d = t.join(a, "canvas-channel.json"),
    f = t.join(a, "canvas-channel-tasks.json"),
    g = new Map(),
    p = new Map();
  let m = [];
  function h(t, r) {
    try {
      return JSON.parse(e.readFileSync(t, "utf8"));
    } catch (e) {
      if ("ENOENT" === e.code) return r;
      throw new Error("\u753b\u5e03\u6e20\u9053\u6570\u636e\u8bfb\u53d6\u5931\u8d25\uff0c\u539f\u6570\u636e\u5df2\u4fdd\u7559");
    }
  }
  function y(t, n) {
    e.mkdirSync(a, {
      recursive: !0
    });
    const o = t + "." + r.randomUUID() + ".tmp";
    try {
      e.writeFileSync(o, JSON.stringify(n), {
        flag: "wx"
      }), e.renameSync(o, t);
    } finally {
      e.existsSync(o) && e.unlinkSync(o);
    }
  }
  if (m = h(f, []), !Array.isArray(m) || m.length > 500) throw new Error("\u753b\u5e03\u6e20\u9053\u4efb\u52a1\u8bb0\u5f55\u65e0\u6548");
  let w = !1;
  for (const e of m) ["queued", "running"].includes(e.status) && (e.status = "unknown", e.message = "\u4e0a\u6b21\u8bf7\u6c42\u7ed3\u679c\u672a\u786e\u8ba4\uff0c\u8bf7\u68c0\u67e5\u6e20\u9053\u8bb0\u5f55\uff1b\u4e0d\u4f1a\u81ea\u52a8\u91cd\u53d1", w = !0);
  function b(e) {
    const t = new URL(e);
    if (t.username || t.password || t.search || t.hash || !("https:" === t.protocol || "http:" === t.protocol && ["127.0.0.1", "localhost", "[::1]"].includes(t.hostname))) throw new Error("\u6e20\u9053\u5730\u5740\u9700\u4e3a HTTPS \u6216\u672c\u673a\u670d\u52a1");
    return t.href.replace(/\/+$/, "").replace(/(?:\/v1)?$/, "/v1");
  }
  function E() {
    const e = h(d, null);
    if (!e) return null;
    if (!c?.isEncryptionAvailable()) throw new Error("\u7cfb\u7edf\u5bc6\u94a5\u52a0\u5bc6\u4e0d\u53ef\u7528");
    return {
      ...e,
      url: b(e.url),
      apiKey: c.decryptString(Buffer.from(e.encryptedKey, "base64"))
    };
  }
  function S() {
    const e = h(d, null);
    return e ? {
      url: e.url,
      imageModel: e.imageModel,
      textModel: e.textModel,
      configured: !!e.encryptedKey
    } : {
      url: "",
      imageModel: "",
      textModel: "",
      configured: !1
    };
  }
  function v(e) {
    for (const t of ["canvasId", "nodeId", "requestId"]) if ("string" != typeof e?.[t] || !e[t] || e[t].length > 80) throw new Error("\u753b\u5e03\u4efb\u52a1\u6807\u8bc6\u65e0\u6548");
  }
  w && y(f, m);
  const x = e => r.createHash("sha256").update(JSON.stringify([e.canvasId, e.nodeId, e.requestId])).digest("hex");
  function M(e) {
    v(e);
    const t = m.find(t => t.id === e.taskId);
    if (!t || t.scope !== x(e)) throw new Error("\u8be5\u4efb\u52a1\u4e0d\u5c5e\u4e8e\u5f53\u524d\u753b\u5e03\u8282\u70b9");
    return t;
  }
  return {
    context: S,
    configure: async function (e) {
      const t = b(e?.url);
      for (const t of ["imageModel", "textModel"]) if ("string" != typeof e[t] || e[t].length > 200 || /[\r\n]/.test(e[t])) throw new Error("\u6a21\u578b\u540d\u79f0\u65e0\u6548");
      if (!c?.isEncryptionAvailable()) throw new Error("\u7cfb\u7edf\u5bc6\u94a5\u52a0\u5bc6\u4e0d\u53ef\u7528");
      const r = h(d, null),
        n = e.apiKey || E()?.apiKey;
      if ("string" != typeof n || !n.trim() || n.length > 4096 || /[\r\n]/.test(n)) throw new Error("\u8bf7\u586b\u5199 API Key");
      if (r && r.url !== t && !e.apiKey) throw new Error("\u66f4\u6362\u6e20\u9053\u5730\u5740\u65f6\u8bf7\u91cd\u65b0\u586b\u5199\u5bc6\u94a5");
      return y(d, {
        url: t,
        imageModel: e.imageModel.trim(),
        textModel: e.textModel.trim(),
        encryptedKey: c.encryptString(n.trim()).toString("base64")
      }), S();
    },
    submit: function (a) {
      v(a);
      const c = x(a);
      if (p.has(c)) return p.get(c);
      const d = async function (a) {
        v(a);
        const c = x(a),
          d = m.find(e => e.scope === c);
        if (d) return {
          id: d.id,
          status: d.status
        };
        const p = o({
          ...s("validate"),
          nodes: [{
            id: "config",
            type: "config",
            title: "\u751f\u6210\u914d\u7f6e",
            x: 0,
            y: 0,
            width: 340,
            height: 240,
            config: a
          }]
        }).nodes[0].config;
        if (!["image", "text"].includes(p.mode) || !p.prompt.trim()) throw new Error("\u8bf7\u586b\u5199\u63d0\u793a\u8bcd\u5e76\u9009\u62e9\u751f\u6210\u6a21\u5f0f");
        const h = E();
        if (!h || !h[p.mode + "Model"]) throw new Error("\u8bf7\u5148\u914d\u7f6e\u6a21\u578b\u6e20\u9053");
        if (p.channelModel && p.channelModel !== h[p.mode + "Model"]) throw new Error("\u6a21\u578b\u6e20\u9053\u5df2\u66f4\u6539\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9\u6a21\u578b");
        if (!Array.isArray(a.references) || a.references.length > 9) throw new Error("\u53c2\u8003\u56fe\u6700\u591a 9 \u5f20");
        const w = [];
        for (const r of a.references) {
          const n = await l(r),
            o = {
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".webp": "image/webp",
              ".gif": "image/gif"
            }[t.extname(n).toLowerCase()];
          if (!o || (await e.promises.stat(n)).size > 20971520) throw new Error("\u53c2\u8003\u56fe\u683c\u5f0f\u65e0\u6548\u6216\u8d85\u8fc7 20 MB");
          w.push({
            file: n,
            mime: o,
            bytes: await e.promises.readFile(n)
          });
        }
        if (m.length >= 500) throw new Error("\u753b\u5e03\u6e20\u9053\u4efb\u52a1\u6570\u91cf\u5df2\u8fbe\u4e0a\u9650");
        const b = {
          id: "channel-" + r.randomUUID(),
          scope: c,
          status: "queued",
          mode: p.mode
        };
        return m.push(b), y(f, m), async function (o, s, a, c, l) {
          const d = new AbortController();
          g.set(o.id, d);
          const p = setTimeout(() => d.abort(), 6e5);
          let h;
          o.status = "running", y(f, m);
          try {
            const s = {
              Authorization: "Bearer " + c.apiKey
            };
            let f, g;
            if ("text" === a.mode) {
              const e = [{
                type: "text",
                text: a.prompt
              }, ...l.map(e => ({
                type: "image_url",
                image_url: {
                  url: "data:" + e.mime + ";base64," + e.bytes.toString("base64")
                }
              }))];
              f = JSON.stringify({
                model: c.textModel,
                messages: [{
                  role: "user",
                  content: e
                }],
                n: a.count,
                stream: !1,
                ...("auto" !== a.reasoning ? {
                  reasoning_effort: a.reasoning
                } : {})
              }), s["Content-Type"] = "application/json", g = "/chat/completions";
            } else {
              const e = {
                model: c.imageModel,
                prompt: a.prompt,
                n: a.count,
                size: {
                  "1:1": "1024x1024",
                  "16:9": "1536x1024",
                  "9:16": "1024x1536"
                }[a.imageRatio],
                quality: a.quality
              };
              if (l.length) {
                f = new FormData();
                for (const [t, r] of Object.entries(e)) f.append(t, String(r));
                for (const e of l) f.append("image[]", new Blob([e.bytes], {
                  type: e.mime
                }), t.basename(e.file));
                g = "/images/edits";
              } else f = JSON.stringify(e), s["Content-Type"] = "application/json", g = "/images/generations";
            }
            if (h = await u(c.url + g, {
              method: "POST",
              headers: s,
              body: f,
              signal: d.signal,
              redirect: "error"
            }), !h.ok) return o.status = h.status >= 500 ? "unknown" : "failed", void (o.message = "\u6e20\u9053\u8bf7\u6c42\u5931\u8d25\uff08HTTP " + h.status + "\uff09\uff0c\u8bf7\u68c0\u67e5\u6e20\u9053\u8bbe\u7f6e" + ("unknown" === o.status ? "\u53ca\u751f\u6210\u8bb0\u5f55\uff0c\u52ff\u91cd\u590d\u63d0\u4ea4" : ""));
            const p = await async function (e) {
              if (!e.body?.getReader) return e.json();
              const t = e.body.getReader(),
                r = [];
              let n = 0;
              try {
                for (;;) {
                  const {
                    value: e,
                    done: o
                  } = await t.read();
                  if (o) break;
                  if (n += e.byteLength, n > 157286400) throw new Error("result too large");
                  r.push(Buffer.from(e));
                }
                return JSON.parse(Buffer.concat(r).toString("utf8"));
              } finally {
                await t.cancel().catch(() => {}), t.releaseLock();
              }
            }(h);
            if ("cancelled" === o.status) return;
            if ("text" === a.mode) {
              if (!Array.isArray(p.choices) || !p.choices.length || p.choices.length > 4) throw new Error("invalid result");
              o.results = p.choices.map(e => {
                const t = e.message?.content;
                if ("string" != typeof t || !t || t.length > 1e4) throw new Error("invalid result");
                return {
                  type: "text",
                  text: t
                };
              });
            } else {
              if (!Array.isArray(p.data) || !p.data.length || p.data.length > 4) throw new Error("invalid result");
              o.results = [];
              for (const s of p.data) {
                let a;
                if ("string" == typeof s.b64_json && s.b64_json.length <= 146800640) {
                  const o = Buffer.from(s.b64_json, "base64"),
                    c = o.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? ".png" : 255 === o[0] && 216 === o[1] ? ".jpg" : "RIFF" === o.subarray(0, 4).toString() && "WEBP" === o.subarray(8, 12).toString() ? ".webp" : "";
                  if (!c || o.length > 104857600) throw new Error("invalid image");
                  e.mkdirSync(i, {
                    recursive: !0
                  });
                  const l = t.join(i, r.randomUUID() + c);
                  e.writeFileSync(l, o, {
                    flag: "wx"
                  }), a = n(l).href;
                } else {
                  if ("string" != typeof s.url) throw new Error("invalid image");
                  {
                    const e = new URL(s.url);
                    if (!["https:", "http:"].includes(e.protocol) || e.username || e.password) throw new Error("invalid URL");
                    a = e.href;
                  }
                }
                o.results.push({
                  type: "image",
                  url: a
                });
              }
            }
            o.status = "succeeded", o.message = "";
          } catch {
            "cancelled" !== o.status && (o.status = "unknown", o.message = "\u6e20\u9053\u8fd4\u56de\u7ed3\u679c\u672a\u786e\u8ba4\uff0c\u8bf7\u68c0\u67e5\u6e20\u9053\u751f\u6210\u8bb0\u5f55\uff1b\u672c\u8282\u70b9\u4e0d\u4f1a\u91cd\u590d\u63d0\u4ea4");
          } finally {
            clearTimeout(p), g.delete(o.id), y(f, m);
          }
        }(b, 0, p, h, w).catch(() => {
          b.status = "unknown", b.message = "\u4efb\u52a1\u8bb0\u5f55\u4fdd\u5b58\u5931\u8d25\uff0c\u539f\u6570\u636e\u5df2\u4fdd\u7559\uff1b\u8bf7\u68c0\u67e5\u6e20\u9053\u8bb0\u5f55";
        }), {
          id: b.id,
          status: b.status
        };
      }(a);
      return p.set(c, d), d.catch(() => p.delete(c)), d;
    },
    status: function (e) {
      const t = M(e);
      return {
        id: t.id,
        status: t.status,
        progress: "succeeded" === t.status ? 100 : 0,
        message: t.message || "",
        results: t.results || []
      };
    },
    cancel: function (e) {
      const t = M(e);
      return ["succeeded", "failed", "cancelled"].includes(t.status) || (t.status = "cancelled", t.message = "\u5df2\u505c\u6b62\u63a5\u6536\u672c\u8282\u70b9\u751f\u6210\u7ed3\u679c", g.get(t.id)?.abort(), y(f, m)), {
        cancelled: "cancelled" === t.status,
        alreadySubmitted: !0
      };
    }
  };
}
module.exports = {
  createCanvasChannel: a
};
