"use strict";

const r = require("node:crypto"),
  e = require("node:fs"),
  t = Buffer.from("DBMRSLV1", "ascii"),
  o = Buffer.from("com.doubaomanager.desktop:7.8.7:resolver-v1", "utf8"),
  u = "L1Y4wuVn59VCcScGVduAjTfVXYiLjn6D7LnXgir1gf4=",
  f = "AN8FVJ7NFlreV8aDU3pO/ZkbaH0FH1XDG+2XXTNL1O4=";
function a() {
  const r = Buffer.from(u, "base64"),
    e = Buffer.from(f, "base64"),
    t = Buffer.alloc(r.length);
  for (let o = 0; o < r.length; o += 1) t[o] = r[o] ^ e[o];
  return t;
}
function n(u) {
  const f = e.readFileSync(u);
  if (f.length < 37 || !f.subarray(0, 8).equals(t)) throw new Error("\u8fd0\u884c\u65f6\u4ee3\u7801\u683c\u5f0f\u65e0\u6548");
  const n = f.subarray(8, 20),
    s = f.subarray(20, 36),
    c = f.subarray(36),
    i = r.createDecipheriv("aes-256-gcm", a(), n);
  return i.setAAD(o), i.setAuthTag(s), Buffer.concat([i.update(c), i.final()]).toString("utf8");
}
module.exports = {
  decryptRuntimeResolver: n
};
