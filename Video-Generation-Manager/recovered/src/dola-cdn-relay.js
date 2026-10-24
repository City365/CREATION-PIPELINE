"use strict";

const e = require("node:dns"),
  r = require("node:net"),
  t = require("node:tls"),
  n = "sf-flow-web-cdn.ciciai.com",
  o = "sf-sf-flow-web-cdn-nontt.ciciaicdn.com",
  a = `MAP ${o} 127.0.0.1`,
  s = `<local>,${o}`,
  l = 3e5,
  i = 5e3,
  c = ["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"];
function u(e, r) {
  try {
    const t = new URL(String(e || ""));
    return "https:" === t.protocol && t.hostname === n && Number(r) ? (t.hostname = o, t.port = String(r), t.toString()) : "";
  } catch {
    return "";
  }
}
function d(e) {
  return "DIRECT" === String(e || "DIRECT").trim().toUpperCase();
}
function y(e) {
  return Array.from(new Set((Array.isArray(e?.Answer) ? e.Answer : []).filter(e => 1 === Number(e?.type)).map(e => String(e?.data || "")).filter(r.isIPv4)));
}
async function f(t = globalThis.fetch, n = e.promises.lookup) {
  try {
    const e = await n(o, {
        all: !0,
        family: 4
      }),
      t = Array.from(new Set((Array.isArray(e) ? e : [e]).map(e => String(e?.address || "")).filter(r.isIPv4)));
    if (t.length) return t;
  } catch {}
  if ("function" != typeof t) throw new Error("Dola CDN relay DNS lookup failed");
  let a = null;
  for (const e of c) try {
    const r = await t(`${e}?name=${encodeURIComponent(o)}&type=A`, {
      headers: {
        accept: "application/dns-json"
      }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const n = y(await r.json());
    if (n.length) return n;
    throw new Error("no IPv4 address");
  } catch (e) {
    a = e;
  }
  throw new Error(`Dola CDN relay DNS lookup failed: ${a?.message || "no IPv4 address"}`);
}
function w(e, r = t.connect, n = 5e3) {
  return new Promise((t, a) => {
    const s = r({
      host: e,
      port: 443,
      servername: o,
      rejectUnauthorized: !0
    });
    let l = !1;
    const i = e => {
      l || (l = !0, e ? (s.destroy(), a(e)) : (s.end(), t(!0)));
    };
    s.setTimeout(n), s.once("secureConnect", () => i()), s.once("timeout", () => i(new Error("Dola CDN relay TLS connection timed out"))), s.once("error", i);
  });
}
async function m(e, t = w) {
  const n = Array.from(new Set(Array.from(e || []).map(String).filter(r.isIPv4))),
    o = (await Promise.all(n.map(async e => {
      try {
        return await t(e), e;
      } catch {
        return "";
      }
    }))).filter(Boolean);
  if (!o.length) throw new Error("Dola CDN relay TLS endpoint is unreachable");
  return o;
}
function p({
  lookup: e = f,
  now: t = Date.now,
  probe: n = w,
  onUnavailable: o = null
} = {}) {
  let a = null,
    s = 0,
    i = !1,
    c = "",
    u = [],
    d = 0,
    y = null,
    p = 0;
  async function h() {
    return u.length && t() < d ? u : (y || (y = Promise.resolve().then(e).then(async e => {
      const o = Array.from(new Set(e.map(String).filter(r.isIPv4)));
      if (!o.length) throw new Error("Dola CDN relay lookup returned no IPv4 address");
      return u = await m(o, n), d = t() + l, p = 0, u;
    }).finally(() => {
      y = null;
    })), y);
  }
  function D(e) {
    const r = i;
    i = !1, c = e?.message || String(e || "Dola CDN relay is unavailable"), r && "function" == typeof o && o(new Error(c));
  }
  return {
    get port() {
      return s;
    },
    get lastUnavailableReason() {
      return c;
    },
    isHealthy: () => Boolean(a && s && i),
    async start() {
      if (a) return s;
      try {
        return await async function () {
          await h();
        }(), a = r.createServer(e => {
          !async function (e) {
            if (e.pause(), !i) return void e.destroy();
            let t;
            try {
              t = await h();
            } catch (r) {
              return D(r), void e.destroy();
            }
            const n = t.map((e, r) => t[(p + r) % t.length]);
            p = (p + 1) % t.length;
            let o = 0;
            const a = t => {
              if (e.destroyed || o >= n.length) return e.destroyed || D(t || new Error("Dola CDN relay upstream connection failed")), void e.destroy();
              const s = r.connect({
                host: n[o++],
                port: 443
              });
              let l = !1;
              s.setTimeout(15e3), s.once("connect", () => {
                l = !0, s.setTimeout(0), e.pipe(s), s.pipe(e), e.resume();
              }), s.once("timeout", () => s.destroy(new Error("Dola CDN relay connection timed out"))), s.once("error", r => {
                l ? e.destroy() : a(r);
              }), e.once("error", () => s.destroy()), e.once("close", () => s.destroy());
            };
            a();
          }(e);
        }), await new Promise((e, r) => {
          a.once("error", r), a.listen(0, "127.0.0.1", () => {
            a.removeListener("error", r), s = Number(a.address()?.port || 0), e();
          });
        }), i = !0, c = "", s;
      } catch (e) {
        throw a = null, s = 0, D(e), e;
      }
    },
    async close() {
      if (!a) return;
      const e = a;
      a = null, s = 0, i = !1, await new Promise(r => e.close(() => r()));
    }
  };
}
module.exports = {
  DOLA_CDN_HOST: n,
  DOLA_CDN_RELAY_HOST: o,
  DOLA_CDN_RELAY_PROXY_BYPASS: s,
  DOLA_CDN_RELAY_RULE: a,
  createDolaCdnRelay: p,
  dnsAddresses: y,
  lookupRelayAddresses: f,
  probeRelayAddress: w,
  reachableRelayAddresses: m,
  relayUrlForDolaCdn: u,
  shouldUseDolaCdnRelay: d
};
