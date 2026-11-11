#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
调度器的可插拔后端。

契约：fn(payload: dict, ctx: dict) -> str   # 返回产物路径，抛异常表示失败

ctx 提供：
    project_root  项目根目录（相对路径基准）
    out_path      任务表里指定的输出路径（可能为空）
    log           打印进度的小函数
"""
import json
import os
import shutil
import subprocess
import sys

FFMPEG_DIR = r"D:\notebook\software\ffmpeg\bin"
JY_TOOL_PY = os.path.join("D:\\notebook\\AIGC\\CREATION-PIPELINE", ".venv-jianying", "Scripts", "python.exe")
JY_DRAFTC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "jianying-scheduler", "bin", "jy-draftc.exe")
JY_INSTALL_DIR = r"D:\notebook\software\JianyingPro\11.5.0.14471"
JY_DRAFT_ROOT = r"D:\notebook\software\JianyingPro Drafts"


def _env():
    env = os.environ.copy()
    if os.path.isdir(FFMPEG_DIR):
        env["PATH"] = FFMPEG_DIR + os.pathsep + env.get("PATH", "")
    env.setdefault("JY_INSTALL_DIR", JY_INSTALL_DIR)
    env.setdefault("JIANYING_DRAFT_ROOT", JY_DRAFT_ROOT)
    env.setdefault("JIANYING_INSTALL_ROOT", os.path.dirname(JY_INSTALL_DIR))
    env.setdefault("PYTHONIOENCODING", "utf-8")
    return env


def _run(cmd, cwd, ctx, timeout=1800):
    ctx["log"]("$ " + " ".join(cmd[:6]) + (" …" if len(cmd) > 6 else ""))
    proc = subprocess.run(cmd, cwd=cwd, env=_env(), capture_output=True,
                          text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-1200:]
        raise RuntimeError("退出码 %d\n%s" % (proc.returncode, tail))
    return proc.stdout or ""


# --------------------------------------------------------------------------- #
# 后端 1：ffmpeg —— 结构片，无 GUI，可并发
# --------------------------------------------------------------------------- #

def run_ffmpeg(payload, ctx):
    root = ctx["project_root"]
    edit_path = os.path.join(root, payload["edit"]) if "edit" in payload else None
    if edit_path is None:
        raise RuntimeError("ffmpeg 后端需要 payload.edit（剪辑单 JSON 路径）")

    with open(edit_path, encoding="utf-8-sig") as fh:
        edit = json.load(fh)

    out = ctx["out_path"] or edit.get("out")
    if not out:
        raise RuntimeError("没有输出路径：请给任务 --out 或在剪辑单里写 out")
    out = out if os.path.isabs(out) else os.path.join(root, out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    # 让 edit.py 用我们指定的输出，同时保持剪辑单原件不变
    edit["out"] = out
    tmp_edit = os.path.join(os.path.dirname(out), "_job_%s.json" % abs(hash(out)))
    with open(tmp_edit, "w", encoding="utf-8") as fh:
        json.dump(edit, fh, ensure_ascii=False, indent=2)

    runner = os.path.join(root, "tools", "ffmpeg-timeline", "edit.py")
    stdout = _run([sys.executable, runner, tmp_edit], root, ctx)
    if not os.path.exists(out):
        raise RuntimeError("ffmpeg 未产出文件: %s\n%s" % (out, stdout[-800:]))
    ctx["log"]("%.2f MB" % (os.path.getsize(out) / 1024 / 1024))
    return out


# --------------------------------------------------------------------------- #
# 后端 2：jianying-tool —— 驱动剪映导出对话框（真渲染，必须串行）
# --------------------------------------------------------------------------- #

def run_jianying_tool(payload, ctx):
    """payload: {draft_name, resolution, framerate, out_dir, title?}

    前置条件（缺一个就会明确报错，不会瞎点）：
      1. 剪映专业版已启动且停在目录页/编辑器
      2. 显示缩放 100%（截图模板采自 11.4.2 / 100%）
      3. 草稿里的 VIP 素材已联网缓存（否则渲染时"加载失败"）
    """
    if not os.path.exists(JY_TOOL_PY):
        raise RuntimeError("缺少 jianying-tool 环境: %s" % JY_TOOL_PY)
    root = ctx["project_root"]
    draft = payload["draft_name"]
    out_dir = payload.get("out_dir") or (ctx["out_path"] and os.path.dirname(os.path.abspath(ctx["out_path"])))
    if not out_dir:
        raise RuntimeError("payload.out_dir 或任务 --out 必须给一个")

    cmd = [JY_TOOL_PY, "-m", "jianying_tool.cli", "export",
           "--draft", draft,
           "--title", payload.get("title", draft),
           "--output-dir", out_dir,
           "--resolution", payload.get("resolution", "1080P"),
           "--framerate", str(payload.get("framerate", 30)),
           "--close"]
    _run(cmd, root, ctx, timeout=7200)

    produced = sorted(
        (os.path.join(out_dir, f) for f in os.listdir(out_dir) if f.lower().endswith((".mp4", ".mov"))),
        key=os.path.getmtime,
    )
    if not produced:
        raise RuntimeError("导出目录里没有视频产物: %s" % out_dir)
    ctx["log"]("产物: %s" % os.path.basename(produced[-1]))
    return produced[-1]


# --------------------------------------------------------------------------- #
# 后端 3：jy-draftc —— 直调 videoeditor.dll 无头导出（必须串行）
# --------------------------------------------------------------------------- #

def run_jy_draftc(payload, ctx):
    """payload: {draft_dir, size?, fps?, codec?}"""
    exe = payload.get("exe") or JY_DRAFTC
    if not os.path.exists(exe):
        raise RuntimeError(
            "缺少 jy-draftc: %s\n"
            "从 https://github.com/wanfke/jy-draftc/releases 下载与剪映 11.5.0.14471 匹配的包，"
            "解压到 tools/jianying-scheduler/bin/" % exe)
    root = ctx["project_root"]
    draft_dir = payload["draft_dir"]
    if not os.path.isabs(draft_dir):
        draft_dir = os.path.join(JY_DRAFT_ROOT, draft_dir)

    out = ctx["out_path"] or os.path.join(
        os.path.dirname(draft_dir), os.path.basename(draft_dir) + ".mp4")
    out = out if os.path.isabs(out) else os.path.join(root, out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    cmd = [exe, "-ex", draft_dir, "-o", out]
    if payload.get("size"):
        cmd += ["--size", payload["size"]]
    if payload.get("fps"):
        cmd += ["--fps", str(payload["fps"])]
    cmd += ["--jy-dir", JY_INSTALL_DIR, "-f"]
    _run(cmd, root, ctx, timeout=7200)

    if not os.path.exists(out):
        raise RuntimeError("jy-draftc 未产出文件: %s" % out)
    ctx["log"]("%.2f MB" % (os.path.getsize(out) / 1024 / 1024))
    return out


BACKENDS = {
    "ffmpeg": run_ffmpeg,
    "jianying-tool": run_jianying_tool,
    "jy-draftc": run_jy_draftc,
}
