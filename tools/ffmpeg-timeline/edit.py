#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剪辑单 → 成片：用 FFmpeg filter_complex 把一份 JSON 时间线渲染成 mp4。

这是"代码即时间线"路线的最小可用引擎：
智能体只产出 edit.json（结构化剪辑意图），本脚本负责翻译成 FFmpeg 滤镜图并执行。
不依赖剪映 / CapCut、不读写草稿文件、不需要 GUI，可批量、可 CI、可重跑。

用法：
    python tools/ffmpeg-timeline/edit.py tools/ffmpeg-timeline/sample.json
    python tools/ffmpeg-timeline/edit.py edit.json --dry-run      # 只打印滤镜图

edit.json 字段：
    width/height/fps          画布与帧率
    clips[]                   画面序列：{path, in?, duration, speed?}
    transition                相邻片段转场：{type: fade|wipeleft|slideleft…, duration}
    texts[]                   文字条：{text, start, end, size?, color?, y?, outline?}
    audio                     可选 BGM：{path, volume?, fade_in?, fade_out?}
    out                       输出路径
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

FONT_CANDIDATES = [
    r"C:/Windows/Fonts/msyh.ttc",
    r"C:/Windows/Fonts/msyhbd.ttc",
    r"C:/Windows/Fonts/simhei.ttf",
]


def find_font():
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    raise SystemExit("找不到中文字体，请在 FONT_CANDIDATES 里补一个字体路径")


def ffmpeg_bin():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    raise SystemExit("PATH 里没有 ffmpeg")


def fwd(path):
    """FFmpeg 滤镜里统一用正斜杠，并转义 Windows 盘符冒号。"""
    p = os.path.abspath(path).replace("\\", "/")
    if len(p) > 1 and p[1] == ":":
        p = p[0] + r"\:" + p[2:]
    return p


def build_graph(edit, tmpdir):
    width = int(edit.get("width", 1920))
    height = int(edit.get("height", 1080))
    fps = int(edit.get("fps", 30))
    clips = edit["clips"]
    if not clips:
        raise SystemExit("clips 为空")

    # 字体与文字文件都放进临时目录，用相对文件名引用：
    # Windows 盘符里的冒号在 filtergraph 里会被当成 key:value 分隔符，绕开它最省事。
    local_font = "font" + os.path.splitext(find_font())[1]
    shutil.copyfile(find_font(), os.path.join(tmpdir, local_font))
    font = local_font

    fit = edit.get("fit", "pad")  # pad=留黑边; cover=裁切填满（竖屏短视频常用）
    lines = []
    total = 0.0

    # 1) 每段画面归一化到同一画布：裁切→补齐/填满→调色→统一帧率与像素格式
    for i, clip in enumerate(clips):
        start = float(clip.get("in", 0))
        dur = float(clip["duration"])
        speed = float(clip.get("speed", 1.0))
        chain = [
            "trim=start=%.6f:duration=%.6f" % (start, dur * speed),
            "setpts=(PTS-STARTPTS)/%.6f" % speed,
        ]
        if fit == "cover":
            chain += [
                "scale=%d:%d:force_original_aspect_ratio=increase" % (width, height),
                "crop=%d:%d" % (width, height),
            ]
        else:
            chain += [
                "scale=%d:%d:force_original_aspect_ratio=decrease" % (width, height),
                "pad=%d:%d:(ow-iw)/2:(oh-ih)/2" % (width, height),
            ]
        grade = clip.get("grade")
        if grade:
            chain.append(
                "eq=contrast=%.3f:saturation=%.3f:gamma=%.3f:brightness=%.3f"
                % (
                    float(grade.get("contrast", 1.0)),
                    float(grade.get("saturation", 1.0)),
                    float(grade.get("gamma", 1.0)),
                    float(grade.get("brightness", 0.0)),
                )
            )
            if grade.get("warmth"):
                w = float(grade["warmth"])
                chain.append(
                    "colorbalance=rs=%.3f:bs=%.3f:rm=%.3f:bm=%.3f"
                    % (w, -w, w * 0.8, -w * 0.8)
                )
            if grade.get("sharpen"):
                amount = float(grade["sharpen"])
                chain.append("unsharp=5:5:%.2f:5:5:0.0" % amount)
        chain += ["setsar=1", "fps=%d" % fps, "format=yuv420p"]
        lines.append("[%d:v]%s[v%d]" % (i, ",".join(chain), i))
        total += dur

    # 2) 转场：xfade 需要按累计时间给 offset
    transition = edit.get("transition") or {}
    fade = float(transition.get("duration", 0))
    kind = transition.get("type", "fade")
    cur = "v0"
    if len(clips) > 1 and fade > 0:
        offset = float(clips[0]["duration"]) - fade
        for i in range(1, len(clips)):
            out = "x%d" % i
            lines.append(
                "[%s][v%d]xfade=transition=%s:duration=%.3f:offset=%.3f[%s]"
                % (cur, i, kind, fade, max(offset, 0.0), out)
            )
            cur = out
            offset += float(clips[i]["duration"]) - fade
        total -= fade * (len(clips) - 1)
    elif len(clips) > 1:
        labels = "".join("[v%d]" % i for i in range(len(clips)))
        lines.append("%sconcat=n=%d:v=1:a=0[c]" % (labels, len(clips)))
        cur = "c"

    # 3) 文字条：用 textfile 避免中文与冒号的转义问题；anim 给出场动效
    for i, text in enumerate(edit.get("texts", [])):
        tf = os.path.join(tmpdir, "text_%d.txt" % i)
        with open(tf, "w", encoding="utf-8") as fh:
            fh.write(str(text["text"]))
        start = float(text.get("start", 0))
        end = float(text.get("end", total))
        size = int(text.get("size", 48))
        color = text.get("color", "white")
        y = text.get("y", "h*0.78")
        outline = int(text.get("outline", 2))
        anim = text.get("anim", "")
        out = "t%d" % i

        extra = ""
        if anim in ("fade", "fade-up"):
            fade = float(text.get("fade", 0.35))
            extra += ":alpha='if(lt(t,%.3f),max(0,(t-%.3f)/%.3f),1)'" % (
                start + fade, start, fade)
            if anim == "fade-up":
                y = "%s-26*(1-min(max((t-%.3f)/%.3f,0),1))" % (y, start, fade)
        elif anim == "zoom":
            # 前 0.4s 从 0.86 倍放大到 1 倍，靠 fontsize 分段近似
            extra += ":alpha='if(lt(t,%.3f),max(0,(t-%.3f)/0.25),1)'" % (start + 0.25, start)

        lines.append(
            "[%s]drawtext=fontfile=%s:textfile=%s:fontcolor=%s:fontsize=%d:"
            "x=(w-text_w)/2:y='%s':borderw=%d:bordercolor=black@0.55"
            "%s:enable='between(t,%.3f,%.3f)'[%s]"
            % (cur, font, os.path.basename(tf), color, size, y, outline,
               extra, start, end, out)
        )
        cur = out

    lines.append("[%s]format=yuv420p[vout]" % cur)

    # 4) 音轨：BGM 可选；片段自带音轨时按需混音（这里保持简单：只支持独立 BGM）
    audio = edit.get("audio")
    filt = ";".join(lines)
    if audio:
        vol = float(audio.get("volume", 0.6))
        fin = float(audio.get("fade_in", 0))
        fout = float(audio.get("fade_out", 0))
        chain = ["volume=%.3f" % vol]
        if fin > 0:
            chain.append("afade=t=in:st=0:d=%.2f" % fin)
        if fout > 0:
            chain.append("afade=t=out:st=%.2f:d=%.2f" % (max(total - fout, 0), fout))
        chain.append("atrim=0:%.3f" % total)
        filt += ";[%d:a]%s[aout]" % (len(clips), ",".join(chain))
    return filt, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("edit", help="edit.json 路径")
    ap.add_argument("--dry-run", action="store_true", help="只打印滤镜图，不渲染")
    ap.add_argument("--crf", default="20")
    args = ap.parse_args()

    with open(args.edit, encoding="utf-8") as fh:
        edit = json.load(fh)

    out = edit.get("out") or "output/ffmpeg-timeline/out.mp4"
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    tmpdir = tempfile.mkdtemp(prefix="fftimeline-")

    try:
        filt, total = build_graph(edit, tmpdir)
        script = os.path.join(tmpdir, "filter.txt")
        with open(script, "w", encoding="utf-8") as fh:
            fh.write(filt)

        if args.dry_run:
            print(filt)
            print("\n# 预计时长 %.3fs" % total)
            return 0

        cmd = [ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "warning"]
        for clip in edit["clips"]:
            cmd += ["-i", os.path.abspath(clip["path"])]
        if edit.get("audio"):
            cmd += ["-i", os.path.abspath(edit["audio"]["path"])]
        cmd += ["-filter_complex_script", os.path.basename(script), "-map", "[vout]"]
        if edit.get("audio"):
            cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
        else:
            cmd += ["-an"]
        cmd += [
            "-c:v", "libx264", "-crf", args.crf, "-preset", "medium",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", os.path.abspath(out),
        ]
        print(" ".join('"%s"' % c if " " in c else c for c in cmd))
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", cwd=tmpdir)
        if proc.returncode != 0:
            sys.stderr.write(proc.stderr or "")
            raise SystemExit("ffmpeg 失败，退出码 %d" % proc.returncode)
        if proc.stderr and proc.stderr.strip():
            sys.stderr.write(proc.stderr[-2000:])
        size = os.path.getsize(out) / 1024 / 1024
        print("done: %s  (%.1fs, %.2f MB)" % (out, total, size))
        return 0
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
