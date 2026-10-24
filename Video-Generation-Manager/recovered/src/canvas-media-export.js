"use strict";

const e = require("node:fs"),
  t = require("node:path"),
  r = require("node:crypto"),
  {
    fileURLToPath: o
  } = require("node:url"),
  {
    Readable: a
  } = require("node:stream"),
  {
    pipeline: i
  } = require("node:stream/promises");
function n(e) {
  if (!Array.isArray(e) || !e.length || e.length > 1e3) throw new Error("\u8bf7\u9009\u62e9\u9700\u8981\u53e6\u5b58\u7684\u56fe\u7247\u6216\u89c6\u9891");
  const t = new Set();
  return e.map(e => {
    if (!e || "string" != typeof e.id || !e.id || e.id.length > 80 || t.has(e.id) || !["image", "video"].includes(e.type) || "string" != typeof e.title || e.title.length > 120 || "string" != typeof e.url || !e.url || e.url.length > 8192) throw new Error("\u9009\u4e2d\u5a92\u4f53\u4fe1\u606f\u65e0\u6548");
    let r;
    try {
      r = new URL(e.url);
    } catch {
      throw new Error("\u9009\u4e2d\u5a92\u4f53\u5730\u5740\u65e0\u6548");
    }
    if (!["file:", "http:", "https:"].includes(r.protocol) || r.username || r.password || "file:" === r.protocol && r.hostname && "localhost" !== r.hostname) throw new Error("\u9009\u4e2d\u5a92\u4f53\u5730\u5740\u65e0\u6548");
    return t.add(e.id), {
      id: e.id,
      type: e.type,
      title: e.title,
      url: r.href
    };
  });
}
function s(e, t, r) {
  const o = (t, r) => e.subarray(t, r).toString("ascii");
  if ("image" === t) {
    if (e.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ".png";
    if (255 === e[0] && 216 === e[1] && 255 === e[2]) return ".jpeg" === r ? ".jpeg" : ".jpg";
    if (["GIF87a", "GIF89a"].includes(o(0, 6))) return ".gif";
    if ("RIFF" === o(0, 4) && "WEBP" === o(8, 12)) return ".webp";
    if ("BM" === o(0, 2) && e.length >= 26) return ".bmp";
    if ("ftyp" === o(4, 8) && /avif|avis/.test(o(8, 64))) return ".avif";
  } else {
    if ("ftyp" === o(4, 8) && e.length >= 16 && !/avif|avis|heic|heif/.test(o(8, 64))) return "qt  " === o(8, 12) ? ".mov" : ".m4v" === r ? ".m4v" : ".mp4";
    if (e.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) && e.includes(Buffer.from("webm"))) return ".webm";
    if (".mov" === r && ["moov", "mdat", "wide"].includes(o(4, 8))) return ".mov";
  }
  throw new Error("\u7ed3\u679c\u5185\u5bb9\u4e0d\u662f\u6709\u6548\u7684" + ("image" === t ? "\u56fe\u7247" : "\u89c6\u9891") + "\u6587\u4ef6");
}
function c(e, r, o = e.title) {
  let a;
  try {
    a = decodeURIComponent(new URL(e.url).pathname.split("/").pop());
  } catch {
    a = "";
  }
  let i = (o.trim() || a || ("image" === e.type ? "\u56fe\u7247" : "\u89c6\u9891")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "");
  const n = t.extname(i);
  return /^\.(?:png|jpe?g|gif|webp|bmp|avif|mp4|mov|m4v|webm)$/i.test(n) && (i = i.slice(0, -n.length)), i = i.replace(/[. ]+$/, "").slice(0, 120) || "\u6210\u54c1", /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(i) && (i = "_" + i), i + r;
}
function l(e) {
  const r = "image" === e.type ? /^\.(?:png|jpe?g|gif|webp|bmp|avif)$/ : /^\.(?:mp4|mov|m4v|webm)$/;
  return c(e, [t.extname(new URL(e.url).pathname), t.extname(e.title)].map(e => e.toLowerCase()).find(e => r.test(e)) || ("image" === e.type ? ".png" : ".mp4"));
}
function f(e) {
  return "ENOENT" === e.code ? "\u539f\u6587\u4ef6\u6216\u76ee\u6807\u6587\u4ef6\u5939\u4e0d\u5b58\u5728" : ["EACCES", "EPERM", "EROFS"].includes(e.code) ? "\u6ca1\u6709\u8bfb\u53d6\u539f\u6587\u4ef6\u6216\u5199\u5165\u76ee\u6807\u6587\u4ef6\u5939\u7684\u6743\u9650" : "ENOSPC" === e.code ? "\u76ee\u6807\u78c1\u76d8\u7a7a\u95f4\u4e0d\u8db3" : ["AbortError", "TimeoutError"].includes(e.name) ? "\u7ed3\u679c\u4e0b\u8f7d\u8d85\u65f6\uff0c\u8bf7\u91cd\u8bd5\u53e6\u5b58" : e.code ? "\u6587\u4ef6\u53e6\u5b58\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6587\u4ef6\u548c\u76ee\u6807\u6587\u4ef6\u5939" : String(e.message || "\u7ed3\u679c\u4e0b\u8f7d\u5931\u8d25").slice(0, 300);
}
function p({
  getRoots: p,
  chooseDirectory: m,
  chooseFile: u,
  fetchRequest: w = globalThis.fetch
}) {
  let h = !1;
  async function d(n, l, f) {
    const m = new URL(n.url),
      u = AbortSignal.timeout(3e5);
    let h;
    if ("file:" === m.protocol) h = e.createReadStream(await async function (r) {
      const a = await e.promises.realpath(o(r));
      if (!(await Promise.all(p().filter(Boolean).map(t => e.promises.realpath(t).catch(() => "")))).some(e => {
        const r = e && t.relative(e, a);
        return e && r && ".." !== r && !r.startsWith(".." + t.sep) && !t.isAbsolute(r);
      }) || !(await e.promises.stat(a)).isFile()) throw new Error("\u539f\u6587\u4ef6\u4e0d\u5728\u753b\u5e03\u6216\u4e0b\u8f7d\u7d20\u6750\u76ee\u5f55\u4e2d");
      return a;
    }(m));else {
      let e;
      try {
        e = await async function (e, t) {
          const r = new Set();
          for (let o = 0; o <= 5; o++) {
            if (r.has(e.href)) throw new Error("\u7ed3\u679c\u94fe\u63a5\u53d1\u751f\u5faa\u73af\u8df3\u8f6c");
            r.add(e.href);
            const a = await w(e.href, {
              signal: t,
              redirect: "manual"
            });
            if (![301, 302, 303, 307, 308].includes(a.status)) return a;
            const i = a.headers.get("location");
            if (await a.body?.cancel().catch(() => {}), !i || 5 === o) throw new Error("\u7ed3\u679c\u94fe\u63a5\u8df3\u8f6c\u65e0\u6548\u6216\u8fc7\u591a");
            if (e = new URL(i, e), !["http:", "https:"].includes(e.protocol) || e.username || e.password) throw new Error("\u7ed3\u679c\u94fe\u63a5\u8df3\u8f6c\u5730\u5740\u65e0\u6548");
          }
        }(m, u);
      } catch (e) {
        if (u.aborted) throw u.reason;
        throw new Error("\u7ed3\u679c\u94fe\u63a5\u65e0\u6cd5\u4e0b\u8f7d\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u6216\u94fe\u63a5\u662f\u5426\u5931\u6548");
      }
      if (!e.ok || !e.body) throw await e.body?.cancel().catch(() => {}), new Error(`\u7ed3\u679c\u94fe\u63a5\u4e0b\u8f7d\u5931\u8d25\uff08HTTP ${e.status}\uff09`);
      const t = (e.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (t && !t.startsWith(n.type + "/") && !["application/octet-stream", "binary/octet-stream"].includes(t)) throw await e.body.cancel().catch(() => {}), new Error("\u7ed3\u679c\u94fe\u63a5\u8fd4\u56de\u7684\u5185\u5bb9\u7c7b\u578b\u4e0d\u6b63\u786e");
      h = a.fromWeb(e.body);
    }
    const d = t.join(l, ".dbm-canvas-" + r.randomUUID() + ".tmp");
    let y = !1;
    const g = e.createWriteStream(d, {
      flags: "wx",
      mode: 384
    });
    g.once("open", () => {
      y = !0;
    });
    try {
      await i(h, g, {
        signal: u
      });
      const r = await e.promises.open(d, "r");
      let o;
      try {
        const e = Buffer.alloc(4096),
          t = await r.read(e, 0, e.length, 0);
        o = e.subarray(0, t.bytesRead);
      } finally {
        await r.close();
      }
      const a = s(o, n.type, t.extname(m.pathname).toLowerCase()),
        p = await async function (r, o, a) {
          const i = t.extname(a),
            n = a.slice(0, -i.length);
          for (let s = 0; s < 1e3; s++) {
            const c = t.join(o, s ? `${n} (${s + 1})${i}` : a);
            try {
              try {
                await e.promises.link(r, c);
              } catch (t) {
                if (!["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EINVAL", "EXDEV"].includes(t.code)) throw t;
                await e.promises.copyFile(r, c, e.constants.COPYFILE_EXCL);
              }
              return c;
            } catch (e) {
              if ("EEXIST" !== e.code) throw e;
            }
          }
          throw new Error("\u540c\u540d\u6587\u4ef6\u8fc7\u591a\uff0c\u8bf7\u66f4\u6362\u76ee\u6807\u6587\u4ef6\u5939");
        }(d, l, c(n, a, f));
      return {
        id: n.id,
        name: t.basename(p),
        filePath: p
      };
    } finally {
      y && (await e.promises.unlink(d).catch(e => {
        if ("ENOENT" !== e.code) throw e;
      }));
    }
  }
  return {
    exportMedia: async function (r) {
      if (h) throw new Error("\u6b63\u5728\u53e6\u5b58\u9009\u4e2d\u5a92\u4f53\uff0c\u8bf7\u7b49\u5f85\u5b8c\u6210");
      const o = n(r);
      h = !0;
      try {
        const r = 1 === o.length,
          a = r ? await u({
            ...o[0]
          }, l(o[0])) : await m();
        if (!a) return {
          canceled: !0
        };
        if (r && ("string" != typeof a || !t.isAbsolute(a) || !t.basename(a).trim())) throw new Error("\u6240\u9009\u4fdd\u5b58\u8def\u5f84\u65e0\u6548");
        const i = r ? t.basename(a) : void 0,
          n = await e.promises.realpath(r ? t.dirname(a) : a);
        if (!(await e.promises.stat(n)).isDirectory()) throw new Error("\u8bf7\u9009\u62e9\u76ee\u6807\u6587\u4ef6\u5939");
        const s = [],
          c = [];
        for (const e of o) try {
          s.push(await d(e, n, i));
        } catch (t) {
          c.push({
            id: e.id,
            name: e.title,
            message: f(t)
          });
        }
        return {
          ok: 0 === c.length,
          saved: s,
          failed: c
        };
      } finally {
        h = !1;
      }
    }
  };
}
module.exports = {
  createCanvasMediaExporter: p
};
