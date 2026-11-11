#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剪映引擎 API 访问层（纯 ctypes）

关键教训：**符号名不要硬编码**。videoeditor.dll 里这些 MSVC 修饰名长度 130~150，
手抄极易差一个字符，GetProcAddress 就返回 127（ERROR_PROC_NOT_FOUND）。
正确做法是从 PE 导出表里读原始字节，再拿去 GetProcAddress。

用法：
    python tools/jianying-api/engine_api.py probe            # 列出关键入口与地址
    python tools/jianying-api/engine_api.py code --keyword JsonApiClient
"""
import ctypes
import os
import struct
import sys
from ctypes import wintypes

DEFAULT_INSTALL = r"D:\notebook\software\JianyingPro\11.5.0.14471"


# --------------------------------------------------------------------------- #
# PE 导出表
# --------------------------------------------------------------------------- #

def parse_exports(path):
    """返回 [(name_bytes, func_rva, section_name)]。"""
    d = open(path, "rb").read()
    pe = struct.unpack_from("<I", d, 0x3C)[0]
    nsec = struct.unpack_from("<H", d, pe + 6)[0]
    optsz = struct.unpack_from("<H", d, pe + 20)[0]
    opt = pe + 24
    magic = struct.unpack_from("<H", d, opt)[0]
    exp_rva = struct.unpack_from("<II", d, opt + (112 if magic == 0x20B else 96))[0]

    secs = []
    so = opt + optsz
    for i in range(nsec):
        o = so + i * 40
        nm = d[o:o + 8].rstrip(b"\0").decode("ascii", "replace")
        vs, va, rs, ra = struct.unpack_from("<IIII", d, o + 8)
        secs.append((nm, va, vs, ra, rs))

    def rva2off(r):
        for _n, va, vs, ra, rs in secs:
            if va <= r < va + max(vs, rs):
                return ra + (r - va)
        return None

    if not exp_rva:
        return []
    eo = rva2off(exp_rva)
    total, named = struct.unpack_from("<II", d, eo + 20)
    afun, anam = struct.unpack_from("<II", d, eo + 28)
    foo = rva2off(afun)
    noff = rva2off(anam)
    out = []
    for i in range(named):
        nr = struct.unpack_from("<I", d, noff + i * 4)[0]
        o = rva2off(nr)
        end = d.index(b"\0", o)
        name = d[o:end]
        frva = struct.unpack_from("<I", d, foo + i * 4)[0]
        where = "?"
        for sn, va, vs, ra, rs in secs:
            if va <= frva < va + max(vs, rs):
                where = sn
                break
        out.append((name, frva, where))
    return out


# --------------------------------------------------------------------------- #
# 加载 + 取址
# --------------------------------------------------------------------------- #

class Engine:
    def __init__(self, install_dir=DEFAULT_INSTALL, keep_cwd=True):
        self.install_dir = os.path.abspath(install_dir)
        self.dll_path = os.path.join(self.install_dir, "videoeditor.dll")
        if not os.path.exists(self.dll_path):
            raise SystemExit("找不到 %s" % self.dll_path)

        self.k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.k32.LoadLibraryW.restype = wintypes.HMODULE
        self.k32.LoadLibraryW.argtypes = [wintypes.LPCWSTR]
        self.k32.GetProcAddress.restype = ctypes.c_void_p
        self.k32.GetProcAddress.argtypes = [wintypes.HMODULE, ctypes.c_char_p]

        # 关键：引擎在 openSession / invoke 时会按相对路径找 Resources、配置等，
        # 因此加载后必须把当前目录留在安装目录（jy-draftc 的 Module 也是这么做的）。
        self._prev_cwd = os.getcwd()
        self._cookie = os.add_dll_directory(self.install_dir)
        os.chdir(self.install_dir)
        try:
            self.handle = self.k32.LoadLibraryW(self.dll_path)
        finally:
            if not keep_cwd:
                os.chdir(self._prev_cwd)
        if not self.handle:
            raise SystemExit("LoadLibraryW 失败: err=%d" % ctypes.get_last_error())

        self.base = self.handle
        self.exports = parse_exports(self.dll_path)
        self._by_name = {n: (rva, sec) for n, rva, sec in self.exports}
        self._bytes = {n: rva for n, rva, _s in self.exports}

    def find(self, keyword, limit=20):
        kw = keyword.encode() if isinstance(keyword, str) else keyword
        return [(n, rva, s) for n, rva, s in self.exports if kw in n][:limit]

    def resolve(self, name):
        """name 可以是 bytes（推荐，来自导出表）或含关键字的 str。"""
        if isinstance(name, str):
            hits = self.find(name, 1)
            if not hits:
                raise KeyError("没有含「%s」的导出" % name)
            name = hits[0][0]
        addr = self.k32.GetProcAddress(self.handle, name)
        if not addr:
            raise OSError("GetProcAddress 失败 err=%d: %r" % (ctypes.get_last_error(), name[:80]))
        return addr

    def read_code(self, addr, n=48):
        return bytes((ctypes.c_ubyte * n).from_address(addr))

    def follow_thunk(self, addr, max_hops=4):
        cur = addr
        hops = []
        for _ in range(max_hops):
            c = self.read_code(cur, 8)
            if c[0] == 0xFF and c[1] == 0x25:
                disp = int.from_bytes(c[2:6], "little", signed=True)
                ptr = (ctypes.c_void_p * 1).from_address(cur + 6 + disp)
                nxt = ptr[0] or 0
                hops.append(("jmp[rip]", nxt))
                if not nxt:
                    break
                cur = nxt
            elif c[0] == 0xE9:
                disp = int.from_bytes(c[1:5], "little", signed=True)
                cur = cur + 5 + disp
                hops.append(("jmp rel32", cur))
            else:
                hops.append(("body", cur))
                break
        return cur, hops


PROBES = [
    ("JsonApiClient.invokeJsonRequest", "invokeJsonRequest"),
    ("JsonApiClient.dumpsRequest", "dumpsRequest"),
    ("Server::instance", "?instance@Server@lyra@@SA"),
    ("Server::startup", "?startup@Server@lyra@@"),
    ("IVeNetworkMgr::create", "?create@IVeNetworkMgr@lyra@@SA"),
    ("EncryptUtils::decrypt", "?decrypt@EncryptUtils@lvve@@"),
]


def cmd_probe(args):
    eng = Engine(args.install_dir)
    print("videoeditor.dll base=0x%X  exports=%d" % (eng.base, len(eng.exports)))
    for label, key in PROBES:
        try:
            addr = eng.resolve(key)
            body, hops = eng.follow_thunk(addr)
            via = " → ".join("%s 0x%X" % h for h in hops)
            print("%-32s 0x%X  (%s)" % (label, addr, via))
        except Exception as exc:  # noqa: BLE001
            print("%-32s ✘ %s" % (label, exc))
    return 0


def cmd_code(args):
    eng = Engine(args.install_dir)
    hits = eng.find(args.keyword, args.limit)
    print("匹配 %d 个导出" % len(hits))
    for name, rva, sec in hits:
        print("\n== %s" % name.decode("ascii", "replace"))
        addr = eng.resolve(name)
        body, hops = eng.follow_thunk(addr)
        print("   addr=0x%X rva=0x%X sec=%s" % (addr, addr - eng.base, sec))
        for h in hops:
            print("   %s 0x%X" % h)
        print("   body:", " ".join("%02X" % b for b in eng.read_code(body, args.bytes)))
    return 0


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["probe", "code"])
    ap.add_argument("--install-dir", default=DEFAULT_INSTALL)
    ap.add_argument("--keyword", default="JsonApiClient")
    ap.add_argument("--limit", type=int, default=3)
    ap.add_argument("--bytes", type=int, default=40)
    args = ap.parse_args()
    return cmd_probe(args) if args.cmd == "probe" else cmd_code(args)


if __name__ == "__main__":
    sys.exit(main())
