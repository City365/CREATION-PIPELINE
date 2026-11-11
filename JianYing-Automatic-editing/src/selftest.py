"""全功能自检：依赖 / 剪映 / 补丁 / 搜索 / 下载 / 草稿 / 部署。

用法（在 src/ 目录下）：
    ..\\..\\.venv-jianying\\Scripts\\python.exe selftest.py
    ..\\..\\.venv-jianying\\Scripts\\python.exe selftest.py --skip-download
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

PASS, FAIL, WARN, SKIP = [], [], [], []


def ok(name, detail=""):
    PASS.append(name)
    print("  [PASS] %-34s %s" % (name, detail))


def bad(name, detail=""):
    FAIL.append((name, detail))
    print("  [FAIL] %-34s %s" % (name, detail))


def warn(name, detail=""):
    WARN.append((name, detail))
    print("  [WARN] %-34s %s" % (name, detail))


def skip(name, detail=""):
    SKIP.append(name)
    print("  [SKIP] %-34s %s" % (name, detail))


def section(title):
    print("\n=== %s ===" % title)


# --------------------------------------------------------------------------- #

def test_deps():
    section("1. 依赖")
    for mod, attr in (("pyJianYingDraft", None), ("capstone", None)):
        try:
            __import__(mod)
            from importlib.metadata import version
            ok(mod, version(mod))
        except Exception as exc:  # noqa: BLE001
            bad(mod, str(exc)[:120])


def test_jianying():
    section("2. 剪映")
    try:
        import lyra
        install = lyra.find_install()
        ok("安装目录", install)
        exe = os.path.join(install, "lyra-cli.exe")
        ok("lyra-cli.exe", "%d bytes" % os.path.getsize(exe))
    except Exception as exc:  # noqa: BLE001
        bad("安装目录", str(exc)[:160])
        return None
    return install


def test_patch():
    section("3. 授权补丁")
    try:
        import lyra
        patched = lyra.ensure_patched()
        ok("补丁路径", patched)
        with open(patched, "rb") as fh:
            data = fh.read()
        off = lyra._locate_patched_offset(data)
        if off is not None:
            ok("补丁字节", "0x%X = 0xEB (jmp)" % off)
        else:
            bad("补丁字节", "没找到已应用的补丁（0xEB）")
        return patched
    except Exception as exc:  # noqa: BLE001
        bad("补丁", str(exc)[:200])
        return None


def test_search():
    section("4. 原生搜索")
    import lyra

    cases = [
        ("music", "温柔 钢琴 治愈"),
        ("sound", "camera shutter"),
        ("sticker", "cute cat"),
        ("transition", "smooth"),
    ]
    first_music = None
    for asset_type, prompt in cases:
        try:
            res = lyra.search(asset_type, prompt, limit=2)
            items = lyra.simplify(res.get("items"))
            if items:
                ok(asset_type, "%d 条 | %s" % (len(items), items[0].get("title", "")[:28]))
                if asset_type == "music":
                    first_music = items[0]
            else:
                warn(asset_type, "0 条结果")
        except Exception as exc:  # noqa: BLE001
            bad(asset_type, str(exc)[:160])
    return first_music


def test_download(item):
    section("5. 下载")
    if not item:
        skip("下载", "没有可用的搜索结果")
        return None
    import lyra
    out_dir = os.path.join(BASE, "output", "jy-library", "downloads")
    try:
        res = lyra.download("music", item["resource_id"], out_dir)
        path = res.get("path")
        if path and os.path.exists(path):
            ok("下载", "%s (%d bytes)" % (os.path.basename(path), os.path.getsize(path)))
            return path
        bad("下载", "返回但没有文件：%s" % res)
    except Exception as exc:  # noqa: BLE001
        bad("下载", str(exc)[:200])
    return None


def test_draft(audio_path):
    section("6. 草稿构造")
    import server as api

    name = "_selftest"
    try:
        d = api.ep_create_draft({"name": name, "width": 1080, "height": 1920, "fps": 30})
        ok("draft_create", "%s %dx%d" % (d["draft"], d["width"], d["height"]))
    except Exception as exc:  # noqa: BLE001
        bad("draft_create", str(exc)[:160])
        return None

    repo = os.path.abspath(os.path.join(HERE, "..", ".."))
    clip = os.path.join(repo, "Creation-Studio", "web", "skins", "real-cafe.mp4")
    if not os.path.exists(clip):
        warn("video_add", "测试素材不存在，跳过 %s" % clip)
    else:
        try:
            r = api.ep_add_video(name, {"path": clip, "duration": 3})
            ok("video_add", json.dumps(r, ensure_ascii=False)[:80])
        except Exception as exc:  # noqa: BLE001
            bad("video_add", str(exc)[:160])

    if audio_path:
        try:
            r = api.ep_add_audio(name, {"path": audio_path, "volume": 0.6,
                                        "fade_in": 1.0, "fade_out": 1.0})
            ok("audio_add", json.dumps(r, ensure_ascii=False)[:80])
        except Exception as exc:  # noqa: BLE001
            bad("audio_add", str(exc)[:160])
    else:
        skip("audio_add", "没有下载到的音频")

    try:
        r = api.ep_add_text(name, {"text": "自检文本", "start": 0.3, "end": 2.5,
                                   "size": 72, "color": "white", "y": 0.0})
        ok("text_add", json.dumps(r, ensure_ascii=False)[:80])
    except Exception as exc:  # noqa: BLE001
        bad("text_add", str(exc)[:160])

    try:
        names = [m.name for m in api.jyd().TransitionType]
        r = api.ep_add_transition(name, {"index": 0, "name": names[0], "duration": 0.5})
        ok("transition_add", "%s -> %s" % (names[0], json.dumps(r, ensure_ascii=False)[:60]))
    except Exception as exc:  # noqa: BLE001
        warn("transition_add", str(exc)[:160])

    try:
        r = api.ep_save(name, {})
        ok("draft_save", json.dumps(r, ensure_ascii=False)[:100])
    except Exception as exc:  # noqa: BLE001
        bad("draft_save", str(exc)[:160])
        return None

    # 校验生成的 JSON
    import glob
    hits = glob.glob(os.path.join(BASE, "output", "jy-drafts", name, "draft_content.json"))
    if not hits:
        bad("草稿文件", "没找到 draft_content.json")
        return None
    try:
        with open(hits[0], encoding="utf-8") as fh:
            content = json.load(fh)
        tracks = [t.get("type") for t in content.get("tracks", [])]
        mats = {k: len(v) for k, v in content.get("materials", {}).items() if v}
        ok("草稿 JSON", "version=%s duration=%s tracks=%s"
           % (content.get("version"), content.get("duration"), tracks))
        ok("素材表", str(mats))
    except Exception as exc:  # noqa: BLE001
        bad("草稿 JSON", str(exc)[:160])
    return name


def test_mcp_dispatch():
    section("7. MCP 分发层")
    try:
        import mcp_server
        names = [t["name"] for t in mcp_server.TOOLS]
        ok("tools 定义", "%d 个" % len(names))

        r = mcp_server.dispatch("catalog", {"kind": "transition"})
        ok("catalog", "transition %d 个" % r.get("count", 0))

        r = mcp_server.dispatch("music_search", {"keyword": "piano", "limit": 2})
        src = r.get("source", "?")
        if src == "native":
            ok("music_search", "source=native count=%s" % r.get("count"))
        else:
            warn("music_search", "source=%s native_error=%s" % (src, str(r.get("native_error"))[:80]))
    except Exception as exc:  # noqa: BLE001
        bad("MCP 分发", str(exc)[:200])


def test_deploy_script():
    section("8. 部署脚本")
    p = os.path.join(BASE, "env", "deploy.ps1")
    if os.path.exists(p):
        ok("deploy.ps1", "%d bytes" % os.path.getsize(p))
    else:
        bad("deploy.ps1", "不存在")

    draft_root = r"D:\notebook\software\JianyingPro Drafts"
    if os.path.isdir(draft_root):
        ok("草稿根目录", draft_root)
    else:
        warn("草稿根目录", "不存在 %s" % draft_root)


# --------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-download", action="store_true")
    args = ap.parse_args()

    print("JianYing-Automatic-editing 自检")
    print("base: %s" % BASE)

    test_deps()
    test_jianying()
    test_patch()
    item = test_search()
    audio = None if args.skip_download else test_download(item)
    test_draft(audio)
    test_mcp_dispatch()
    test_deploy_script()

    section("汇总")
    print("  PASS %d   FAIL %d   WARN %d   SKIP %d"
          % (len(PASS), len(FAIL), len(WARN), len(SKIP)))
    if FAIL:
        print("\n  失败项：")
        for n, d in FAIL:
            print("    - %-30s %s" % (n, d))
    if WARN:
        print("\n  警告项：")
        for n, d in WARN:
            print("    - %-30s %s" % (n, d))
    print()
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
