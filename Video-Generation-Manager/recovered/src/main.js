"use strict";

const e = require("node:crypto"),
  r = require("node:fs"),
  a = require("node:path"),
  i = a.join(__dirname, "main.jsc"),
  d = e.createHash("sha256").update(r.readFileSync(i)).digest("hex");
if ("a6f40e86a5ee43886c39a9d1a529f0f464f78429bf203126d96bb3b05d0ff653" !== d) throw new Error("\u7a0b\u5e8f\u6838\u5fc3\u5b8c\u6574\u6027\u6821\u9a8c\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u5b89\u88c5 V2.0");
require("bytenode"), require(i);
