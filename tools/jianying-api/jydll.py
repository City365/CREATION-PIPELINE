#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剪映本地引擎 API（纯 Python ctypes，不需要编译器、不需要破解、不联网）

直接从本机 videoeditor.dll 的命名导出调用官方能力：
    EncryptUtils::decrypt   草稿解密
    EncryptUtils::encrypt   草稿回加密
    EncryptUtils::enable    打开引擎内部加密开关
    EncryptUtils::isEnable
    EncryptUtils::isFileEncrypted

这些都是 videoeditor.dll 的**公开命名导出**，与 jy-draftc 用的是同一批符号。
MSVC 的 std::string 按 32 字节布局手工构造（16 字节 SSO + size + capacity），
所以不需要 MSVC 运行时，也不需要 /MT 编译。

用法：
    python tools/jianying-api/jydll.py --info
    python tools/jianying-api/jydll.py --decrypt "<草稿目录>\\draft_content.json"
    python tools/jianying-api/jydll.py --decrypt "<json>" --out plain.json
"""
import argparse
import ctypes
import json
import os
import sys

DEFAULT_INSTALL = r"D:\notebook\software\JianyingPro\11.5.0.14471"

# MSVC x64 std::string 修饰名（与本机 11.5.0.14471 精确匹配）
SYM_DECRYPT_FLAG = (
    "?decrypt@EncryptUtils@lvve@@QEAA?AV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@"
    "std@@AEBV34@0AEA_N@Z"
)
SYM_DECRYPT_PLAIN = (
    "?decrypt@EncryptUtils@lvve@@QEAA?AV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@"
    "std@@AEBV34@0@Z"
)
SYM_ENCRYPT = (
    "?encrypt@EncryptUtils@lvve@@QEAA?AV?$basic_string@DU?$char_traits@D@std@@V?$allocator@D@2@@"
    "std@@AEBV34@@Z"
)
SYM_ENABLE = "?enable@EncryptUtils@lvve@@QEAAX_N@Z"
SYM_IS_ENABLE = "?isEnable@EncryptUtils@lvve@@QEAA_NXZ"
SYM_IS_FILE_ENCRYPTED = "?isFileEncrypted@EncryptUtils@lvve@@SA_NPEBD@Z"

PARAM_JSON = b"{}"


class _StrBuf(ctypes.Union):
    _fields_ = [("local", ctypes.c_char * 16), ("remote", ctypes.c_void_p)]


class MsvcString(ctypes.Structure):
    """MSVC x64 std::string 的内存布局：32 字节。"""
    _fields_ = [
        ("buf", _StrBuf),
        ("size", ctypes.c_size_t),
        ("capacity", ctypes.c_size_t),
    ]

    @classmethod
    def from_bytes(cls, data):
        s = cls()
        n = len(data)
        if n < 16:
            ctypes.memset(ctypes.byref(s.buf), 0, 16)
            ctypes.memmove(s.buf.local, data, n) if n else None
            s.capacity = 15
        else:
            block = ctypes.create_string_buffer(data, n + 1)
            s.buf.remote = ctypes.cast(block, ctypes.c_void_p)
            s._keepalive = block  # 防止被 GC
            s.capacity = n
        s.size = n
        return s

    def data_ptr(self):
        if self.capacity < 16:
            return ctypes.cast(ctypes.byref(self.buf), ctypes.c_void_p)
        return self.buf.remote

    def raw(self):
        """优先按 size 字段取（SSO/堆两种情况都适用）。"""
        n = int(self.size or 0)
        cap = int(self.capacity or 0)
        ptr = self.data_ptr()
        if not ptr:
            return b""
        if n and n <= max(cap, 16):
            return ctypes.string_at(ptr, n)
        return ctypes.string_at(ptr, cap) if cap else b""


class JianyingEngine:
    def __init__(self, install_dir=None, verbose=True):
        self.install_dir = os.path.abspath(install_dir or os.environ.get("JY_INSTALL_DIR") or DEFAULT_INSTALL)
        dll_path = os.path.join(self.install_dir, "videoeditor.dll")
        if not os.path.exists(dll_path):
            raise SystemExit("找不到 videoeditor.dll: %s" % dll_path)

        # 引擎依赖同目录的一堆 DLL：把该目录加入 DLL 搜索路径并切过去
        self._cwd = os.getcwd()
        self._cookie = os.add_dll_directory(self.install_dir)
        os.chdir(self.install_dir)
        try:
            self.dll = ctypes.WinDLL(dll_path)
        finally:
            os.chdir(self._cwd)

        self._decrypt_fn = None
        self._decrypt_plain_fn = None
        self._encrypt_fn = None
        self._enable_fn = None
        self._is_enable_fn = None
        self._is_file_encrypted_fn = None

        try:
            self._decrypt_fn = self._get(SYM_DECRYPT_FLAG)
        except AttributeError:
            self._decrypt_plain_fn = self._get(SYM_DECRYPT_PLAIN)
        for attr, sym in (
            ("_encrypt_fn", SYM_ENCRYPT),
            ("_enable_fn", SYM_ENABLE),
        ):
            try:
                setattr(self, attr, self._get(sym))
            except AttributeError:
                pass
        for attr, sym in (
            ("_is_enable_fn", SYM_IS_ENABLE),
            ("_is_file_encrypted_fn", SYM_IS_FILE_ENCRYPTED),
        ):
            try:
                setattr(self, attr, self._get(sym))
            except AttributeError:
                pass

        if verbose:
            print("[jydll] %s" % self.install_dir)
            print("[jydll] decrypt: %s" % ("3-arg(ok flag)" if self._decrypt_fn else "2-arg(plain)"))
            print("[jydll] encrypt: %s  isEnable: %s  isFileEncrypted: %s" % (
                bool(self._encrypt_fn), bool(self._is_enable_fn), bool(self._is_file_encrypted_fn)))

    def _get(self, symbol):
        addr = ctypes.cast(self.dll[symbol], ctypes.c_void_p).value
        return ctypes.CFUNCTYPE(
            ctypes.POINTER(MsvcString),           # 返回 std::string*
            ctypes.c_void_p,                      # this（可为 nullptr）
            ctypes.POINTER(MsvcString),           # out
            ctypes.POINTER(MsvcString),           # 输入
            ctypes.POINTER(MsvcString),           # 参数 json
            ctypes.POINTER(ctypes.c_bool),        # ok 标志
        )(addr)

    # ------------------------------------------------------------------ #
    def is_enabled(self):
        if not self._is_enable_fn:
            return None
        fn = ctypes.CFUNCTYPE(ctypes.c_bool, ctypes.c_void_p)(
            ctypes.cast(self._is_enable_fn, ctypes.c_void_p).value)
        return fn(None)

    def is_file_encrypted(self, path):
        if not self._is_file_encrypted_fn:
            return None
        fn = ctypes.CFUNCTYPE(ctypes.c_bool, ctypes.c_char_p)(
            ctypes.cast(self._is_file_encrypted_fn, ctypes.c_void_p).value)
        return fn(os.path.abspath(path).encode("utf-8"))

    def decrypt(self, blob):
        """密文 bytes → 明文 str。"""
        src = MsvcString.from_bytes(blob)
        out = MsvcString()
        param = MsvcString.from_bytes(PARAM_JSON)
        ok = ctypes.c_bool(False)
        if self._decrypt_fn:
            self._decrypt_fn(None, ctypes.byref(out), ctypes.byref(src),
                             ctypes.byref(param), ctypes.byref(ok))
            if not ok.value and out.size == 0:
                raise RuntimeError("decrypt 失败：ok=False, output_len=0")
        else:
            fn = ctypes.CFUNCTYPE(
                ctypes.POINTER(MsvcString), ctypes.c_void_p, ctypes.POINTER(MsvcString),
                ctypes.POINTER(MsvcString), ctypes.POINTER(MsvcString),
            )(ctypes.cast(self._decrypt_plain_fn, ctypes.c_void_p).value)
            fn(None, ctypes.byref(out), ctypes.byref(src), ctypes.byref(param))
        data = out.raw()
        return data.decode("utf-8", "replace")

    def encrypt(self, text):
        """明文 str → 密文 bytes（必须先 enable(true)）。"""
        if not self._encrypt_fn:
            raise RuntimeError("该 DLL 没有 encrypt 导出")
        enable = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_bool)(
            ctypes.cast(self._enable_fn, ctypes.c_void_p).value)
        enable(None, True)
        fn = ctypes.CFUNCTYPE(
            ctypes.POINTER(MsvcString), ctypes.c_void_p,
            ctypes.POINTER(MsvcString), ctypes.POINTER(MsvcString),
        )(ctypes.cast(self._encrypt_fn, ctypes.c_void_p).value)
        src = MsvcString.from_bytes(text.encode("utf-8") if isinstance(text, str) else text)
        out = MsvcString()
        fn(None, ctypes.byref(out), ctypes.byref(src))
        return out.raw()


def main():
    ap = argparse.ArgumentParser(description="剪映本地引擎 API（ctypes 版）")
    ap.add_argument("--install-dir", default=None)
    ap.add_argument("--info", action="store_true", help="打印能力与加密开关状态")
    ap.add_argument("--decrypt", help="待解密的 draft_content.json 路径")
    ap.add_argument("--out", default=None, help="明文输出路径")
    ap.add_argument("--encrypt", help="待加密的明文 json 路径")
    ap.add_argument("--roundtrip", action="store_true",
                    help="配合 --decrypt：明文→加密→再解密，校验回写闭环")
    args = ap.parse_args()

    eng = JianyingEngine(args.install_dir)

    if args.info:
        print("isEnabled      :", eng.is_enabled())
        if args.decrypt:
            print("isFileEncrypted:", eng.is_file_encrypted(args.decrypt))

    if args.decrypt:
        with open(args.decrypt, "rb") as fh:
            blob = fh.read()
        print("[jydll] 输入 %d 字节，首 16 字节: %r" % (len(blob), blob[:16]))
        text = eng.decrypt(blob)
        print("[jydll] 明文 %d 字节" % len(text.encode("utf-8")))
        try:
            doc = json.loads(text)
            print("[jydll] JSON ok: version=%s duration=%s tracks=%d materials=%d" % (
                doc.get("version"), doc.get("duration"),
                len(doc.get("tracks") or []), len(doc.get("materials") or {})))
        except Exception as exc:  # noqa: BLE001
            print("[jydll] 不是合法 JSON: %s" % exc)
            print(text[:400])
        if args.out:
            os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
            with open(args.out, "w", encoding="utf-8") as fh:
                fh.write(text)
            print("[jydll] 已写入 %s" % args.out)

        if args.roundtrip:
            enc = eng.encrypt(text)
            print("[jydll] 回加密 %d 字节，首 16: %r" % (len(enc), enc[:16]))
            back = eng.decrypt(enc)
            same = back == text
            print("[jydll] 再解密 %d 字节，与明文一致: %s" % (len(back.encode("utf-8")), same))
            if not same:
                raise SystemExit("回写闭环失败")
    return 0


if __name__ == "__main__":
    sys.exit(main())
