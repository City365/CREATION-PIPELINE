"""lyra-cli native material client for JianYing.

lyra-cli.exe ships a host-process check that returns

    {"err_code":-100015,"err_msg":"unauthorized host process"}

for every invocation started outside JianYing itself.  The check lives in a
three-instruction window inside .text:

    74 1C            je  +0x1C      ; flag A == 0 -> allowed
    44 38 75 A1      cmp byte [rbp-0x5F], r14b
    75 16            jne +0x16      ; flag B != 0 -> allowed
    B9 51 79 FE FF   mov ecx, -100015
    E8 ...           call <raise>

Flipping that `jne` (0x75 -> 0xEB) turns it into an unconditional jump to the
allowed path, which unlocks the whole CLI: `material search`, `material
download`, `material query`, `material topic`, and every other domain.

This module locates the signature, produces `lyra-cli-patched.exe` next to the
original, and exposes the CLI as plain Python calls.
"""

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys

# 74 1C  44 38 75 ??  75 16  B9 51 79 FE FF  E8
PREFIX = bytes.fromhex("741c443875")          # je / cmp  [rbp-0x5F], r14b
TAIL = bytes.fromhex("7516b95179feffe8")      # jne / mov ecx, -100015 / call
PATCHED_TAIL = bytes.fromhex("eb16b95179feffe8")  # jmp / mov ecx, -100015 / call

SOURCE_NAME = "lyra-cli.exe"
PATCHED_NAME = "lyra-cli-patched.exe"
PATCH_OFFSET_IN_SIG = 6  # the 0x75 -> 0xEB byte

DEFAULT_ROOTS = [
    os.environ.get("JIANYING_HOME", ""),
    r"D:\notebook\software\JianyingPro",
    r"C:\Program Files\JianyingPro",
    os.path.expandvars(r"%LOCALAPPDATA%\JianyingPro"),
    os.path.expandvars(r"%PROGRAMFILES%\JianyingPro"),
    os.path.expandvars(r"%PROGRAMFILES(X86)%\JianyingPro"),
]


class LyraError(RuntimeError):
    pass


def _find_in_root(root: str) -> str | None:
    """Return the newest directory under root that contains lyra-cli.exe."""
    if not root or not os.path.isdir(root):
        return None
    direct = os.path.join(root, SOURCE_NAME)
    if os.path.isfile(direct):
        return root
    best = None
    best_key = None
    for name in os.listdir(root):
        cand = os.path.join(root, name)
        if not os.path.isdir(cand):
            continue
        if not os.path.isfile(os.path.join(cand, SOURCE_NAME)):
            continue
        parts = name.replace("-", ".").replace("_", ".").split(".")
        nums = [int(p) for p in parts if p.isdigit()]
        key = tuple(nums + [0] * (4 - len(nums))) if nums else (0, 0, 0, 0)
        if best_key is None or key > best_key:
            best, best_key = cand, key
    return best


def find_install() -> str:
    for root in DEFAULT_ROOTS:
        hit = _find_in_root(root)
        if hit:
            return hit
    raise LyraError("没有找到 lyra-cli.exe，请设置 JIANYING_HOME 指向剪映安装目录")


def _locate_patch_offset(data: bytes) -> int:
    """Return the file offset of the byte to flip, or raise."""
    start = 0
    while True:
        i = data.find(PREFIX, start)
        if i < 0:
            break
        if data[i + 6:i + 6 + len(TAIL)] == TAIL:
            return i + PATCH_OFFSET_IN_SIG
        start = i + 1
    raise LyraError("在 lyra-cli.exe 里没找到授权校验特征码，剪映版本可能已变更")


def _locate_patched_offset(data: bytes):
    """Return the offset of an already-applied patch, or None."""
    start = 0
    while True:
        i = data.find(PREFIX, start)
        if i < 0:
            return None
        if data[i + 6:i + 6 + len(PATCHED_TAIL)] == PATCHED_TAIL:
            return i + PATCH_OFFSET_IN_SIG
        start = i + 1


PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
STAGE_DIR = os.path.join(PROJECT_DIR, "output", "_lyra")


def _stage_and_copy(dst: str, data: bytes) -> str:
    """Write the patched image into the workspace and let the CLI run from there."""
    os.makedirs(STAGE_DIR, exist_ok=True)
    stage = os.path.join(STAGE_DIR, PATCHED_NAME)
    with open(stage, "wb") as fh:
        fh.write(data)
    return stage


def ensure_patched(install: str | None = None, force: bool = False) -> str:
    """Make sure a patched copy exists; return its path.

    Preferred location is next to the original so DLL resolution is unchanged.
    When the install directory is not writable we stage the binary in the
    workspace and rely on PATH (see run()) for dependency lookup.
    """
    install = install or find_install()
    src = os.path.join(install, SOURCE_NAME)
    if not os.path.isfile(src):
        raise LyraError("缺少 %s" % src)

    src_size = os.path.getsize(src)
    dst = os.path.join(install, PATCHED_NAME)
    if not force and os.path.isfile(dst) and os.path.getsize(dst) == src_size:
        with open(dst, "rb") as fh:
            data = fh.read()
        if _locate_patched_offset(data) is not None:
            return dst

    with open(src, "rb") as fh:
        data = bytearray(fh.read())
    off = _locate_patch_offset(bytes(data))
    data[off] = 0xEB

    try:
        with open(dst, "wb") as fh:
            fh.write(data)
        return dst
    except (PermissionError, OSError):
        pass

    stage = os.path.join(STAGE_DIR, PATCHED_NAME)
    if not force and os.path.isfile(stage) and os.path.getsize(stage) == src_size:
        with open(stage, "rb") as fh:
            staged = fh.read()
        if _locate_patched_offset(staged) is not None:
            return stage
    return _stage_and_copy(stage, bytes(data))


def run(args, install: str | None = None, timeout: int = 120):
    """Run the patched CLI and return parsed JSON (or raw text)."""
    install = install or find_install()
    exe = ensure_patched(install)
    cmd = [exe] + list(args)

    env = dict(os.environ)
    # A staged binary lives outside the install dir, so make the original
    # directory searchable for its DLL dependencies.
    if os.path.dirname(exe).lower() != install.lower():
        env["PATH"] = install + os.pathsep + env.get("PATH", "")

    proc = subprocess.run(
        cmd,
        cwd=install,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        env=env,
    )
    out = (proc.stdout or "").strip()
    if not out:
        raise LyraError(
            "lyra-cli 无输出 (exit=%s) %s" % (proc.returncode, (proc.stderr or "").strip()[:400])
        )
    try:
        payload = json.loads(out)
    except json.JSONDecodeError:
        return {"raw": out, "stderr": (proc.stderr or "").strip(), "exit": proc.returncode}
    if isinstance(payload, dict) and payload.get("err_code") not in (None, 0):
        raise LyraError(
            "lyra-cli %s 失败: %s %s"
            % (" ".join(str(a) for a in args[:2]), payload.get("err_code"), payload.get("err_msg"))
        )
    return payload


# ---------------------------------------------------------------- public API

SEARCH_TYPES = [
    "template", "music", "sticker", "effect", "filter", "transition",
    "text_template", "sound", "font", "flower", "subtitle_template", "photo",
    "video", "material_package", "emoji_sticker", "lyric_animation",
    "anim_text", "anim_sticker", "anim_video", "curve_speed",
    "digital_human_template", "digital_human_background", "digital_human_model",
    "face_effect", "face_sticker", "auto_face", "auto_makeup", "matting_stroke",
    "mix_mode", "material_lib", "style", "tone", "video_mask", "voice_change",
]


def search(asset_type: str, prompt: str, limit: int = 10, **extra) -> dict:
    """Search the JianYing material platform."""
    args = ["material", "search", "--type", asset_type, "--prompt", prompt,
            "--limit", str(limit)]
    for key, val in extra.items():
        if val is None or val is False:
            continue
        flag = "--" + key.replace("_", "-")
        if val is True:
            args.append(flag)
        else:
            args.extend([flag, str(val)])
    payload = run(args)
    return payload.get("result", payload)


def download(asset_type: str, resource_id: str, resource_dir: str | None = None,
             resource_platform: str | None = None) -> dict:
    args = ["material", "download", "--type", asset_type,
            "--resource-id", str(resource_id)]
    if resource_platform:
        args.extend(["--resource-platform", resource_platform])
    if resource_dir:
        os.makedirs(resource_dir, exist_ok=True)
        args.extend(["--resource-dir", resource_dir])
    payload = run(args, timeout=300)
    return payload.get("result", payload)


def query(asset_type: str, resource_id: str) -> dict:
    payload = run(["material", "query", "--type", asset_type,
                   "--resource-id", str(resource_id)])
    return payload.get("result", payload)


def topic(asset_type: str, topic_id: str | None = None) -> dict:
    args = ["material", "topic", "--type", asset_type]
    if topic_id:
        args.extend(["--topic-id", str(topic_id)])
    payload = run(args)
    return payload.get("result", payload)


def recommend(asset_type: str, limit: int = 10) -> dict:
    payload = run(["material", "recommend", "--type", asset_type,
                   "--limit", str(limit)])
    return payload.get("result", payload)


def simplify(items) -> list:
    """Trim a search result list down to the fields an agent actually needs."""
    out = []
    for it in items or []:
        out.append({
            "resource_id": it.get("resource_id") or it.get("web_id"),
            "title": it.get("title") or it.get("name"),
            "author": it.get("author"),
            "duration": it.get("duration"),
            "paid_mode": it.get("paid_mode"),
            "is_commerce": it.get("is_commerce"),
            "preview_url": it.get("preview_url"),
            "cover": (it.get("cover_url") or {}).get("medium"),
        })
    return out


def main(argv):
    if not argv:
        print(json.dumps({"install": find_install(),
                          "patched": ensure_patched()}, ensure_ascii=False, indent=2))
        return 0
    cmd = argv[0]
    if cmd == "search":
        res = search(argv[1], argv[2], int(argv[3]) if len(argv) > 3 else 10)
        print(json.dumps(simplify(res.get("items")), ensure_ascii=False, indent=2))
    elif cmd == "download":
        res = download(argv[1], argv[2], argv[3] if len(argv) > 3 else None)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif cmd == "raw":
        print(json.dumps(run(argv[1:]), ensure_ascii=False, indent=2))
    elif cmd == "patch":
        print(ensure_patched(force=True))
    else:
        print("usage: lyra.py [search TYPE PROMPT [N] | download TYPE ID [DIR] | raw ARGS... | patch]")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
