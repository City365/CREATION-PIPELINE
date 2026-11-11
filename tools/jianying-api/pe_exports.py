#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""枚举 PE32+ DLL 的导出表（纯标准库，不需要 dumpbin）。

用法：
    python tools/jianying-api/pe_exports.py <dll> [--grep 关键词,关键词]
"""
import argparse
import struct
import sys


def parse(path):
    d = open(path, "rb").read()
    pe = struct.unpack_from("<I", d, 0x3C)[0]
    if d[pe:pe + 4] != b"PE\0\0":
        raise SystemExit("不是 PE 文件: %s" % path)
    nsec = struct.unpack_from("<H", d, pe + 6)[0]
    optsz = struct.unpack_from("<H", d, pe + 20)[0]
    opt = pe + 24
    magic = struct.unpack_from("<H", d, opt)[0]
    dd = opt + (112 if magic == 0x20B else 96)
    exp_rva, exp_sz = struct.unpack_from("<II", d, dd)

    secs = []
    so = opt + optsz
    for i in range(nsec):
        o = so + i * 40
        name = d[o:o + 8].rstrip(b"\0").decode("ascii", "replace")
        vs, va, rs, ra = struct.unpack_from("<IIII", d, o + 8)
        secs.append((name, va, vs, ra, rs))

    def rva2off(r):
        for _n, va, vs, ra, rs in secs:
            if va <= r < va + max(vs, rs):
                return ra + (r - va)
        return None

    info = {"path": path, "is64": magic == 0x20B, "sections": secs,
            "dll_name": None, "exports": [], "named": 0, "total": 0}
    if not exp_rva:
        return info
    eo = rva2off(exp_rva)
    if eo is None:
        return info
    name_rva = struct.unpack_from("<I", d, eo + 12)[0]
    if name_rva:
        no = rva2off(name_rva)
        end = d.index(b"\0", no)
        info["dll_name"] = d[no:end].decode("ascii", "replace")
    total, named = struct.unpack_from("<II", d, eo + 20)
    info["total"], info["named"] = total, named
    anam = struct.unpack_from("<I", d, eo + 32)[0]
    noff = rva2off(anam)
    names = []
    for i in range(named):
        nr = struct.unpack_from("<I", d, noff + i * 4)[0]
        o = rva2off(nr)
        if o is None:
            continue
        end = d.index(b"\0", o)
        names.append(d[o:end].decode("utf-8", "replace"))
    info["exports"] = names
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dll")
    ap.add_argument("--grep", default=None, help="逗号分隔关键词")
    ap.add_argument("--list", action="store_true", help="打印全部导出名")
    args = ap.parse_args()

    info = parse(args.dll)
    print("== %s" % info["path"])
    print("   PE%s  dll_name=%s  exports=%d  named=%d" % (
        "32+" if info["is64"] else "32", info["dll_name"], info["total"], info["named"]))
    names = info["exports"]
    if args.grep:
        keys = [k.strip() for k in args.grep.split(",") if k.strip()]
        hit = sorted({n for n in names if any(k in n for k in keys)})
        print("   matched=%d" % len(hit))
        for n in hit:
            print("   ", n)
    elif args.list:
        for n in names:
            print(n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
