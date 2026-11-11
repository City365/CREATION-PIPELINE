#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剪映程序化剪辑器：剪辑单(JSON) → 剪映草稿(可直接打开成片)

"控制剪映剪辑"的正确解法不是去点它的时间线（QML 画布没有可定位控件，拖拽只能靠坐标），
而是按专业 NLE 的通行做法（Premiere 的 FCPXML / DaVinci 的 OTIO / Final Cut 的 XML）——
**程序产出工程文件，剪映只负责预览和渲染**。程序写完草稿，等于剪辑已经完成。

支持的操作（对应剪辑单字段）：
    clips[]      导入素材 + 排序 + 入点裁切 + 变速 + 转场
    texts[]      文字/字幕轨（位置、字号、颜色、描边）
    audio        音频轨（音量、淡入淡出）
    canvas       画布尺寸/帧率

用法：
    python tools/jianying-api/jyedit.py spec.json
    python tools/jianying-api/jyedit.py spec.json --root "D:\\notebook\\software\\JianyingPro Drafts"
    python tools/jianying-api/jyedit.py spec.json --dry-run
"""
import argparse
import json
import os
import sys

DEFAULT_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "output", "jy-drafts")


def load_spec(path):
    with open(path, encoding="utf-8-sig") as fh:
        return json.load(fh)


def build(spec, root, dry_run=False):
    import pyJianYingDraft as draft
    from pyJianYingDraft import (
        SEC,
        ClipSettings,
        TextStyle,
        Timerange,
        TrackSpec,
        TrackType,
        AudioSegment,
        TextSegment,
        VideoSegment,
    )

    def tr(start_s, dur_s):
        """秒 → 微秒 Timerange（兼容 pyJianYingDraft 0.3.0，无 trange_seconds）。"""
        return Timerange(int(round(float(start_s) * SEC)), int(round(float(dur_s) * SEC)))

    name = spec.get("name") or "程序化剪辑"
    width = int(spec.get("width", 1080))
    height = int(spec.get("height", 1920))
    fps = int(spec.get("fps", 30))
    clips = spec.get("clips") or []
    if not clips:
        raise SystemExit("clips 为空")

    if dry_run:
        total = sum(float(c["duration"]) for c in clips)
        print("[dry-run] %s %dx%d@%d  片段=%d  总时长=%.2fs  轨道: video/audio/text"
              % (name, width, height, fps, len(clips), total))
        for i, c in enumerate(clips):
            print("  [%d] %s  in=%.2fs dur=%.2fs speed=%s transition=%s"
                  % (i, os.path.basename(c["path"]), float(c.get("in", 0)),
                     float(c["duration"]), c.get("speed", 1.0), c.get("transition", "-")))
        return None

    folder = draft.DraftFolder(root)
    script = folder.create_draft(name, width, height, fps=fps)

    # 轨道顺序：视频在最底，文字在最上；有音频就再加一条
    specs = [TrackSpec(TrackType.video, "video")]
    if spec.get("audio"):
        specs.append(TrackSpec(TrackType.audio, "audio"))
    texts = spec.get("texts") or []
    # 文字按 track 字段分组（同轨不能重叠；水印/字幕应各占一轨）
    text_tracks = []
    for t in texts:
        tn = t.get("track") or "text"
        if tn not in text_tracks:
            text_tracks.append(tn)
    for tn in text_tracks:
        specs.append(TrackSpec(TrackType.text, tn))
    script.append_tracks(specs)

    # ---- 视频轨：排序 + 入点裁切 + 变速 + 转场 ----
    cursor = 0.0
    for clip in clips:
        dur = float(clip["duration"])
        src_in = float(clip.get("in", 0))
        speed = float(clip.get("speed", 1.0))
        seg = VideoSegment(
            clip["path"],
            tr(cursor, dur),
            source_timerange=tr(src_in, dur * speed),
            speed=speed,
        )
        if clip.get("transition"):
            from pyJianYingDraft import TransitionType
            tname = clip["transition"]
            ttype = getattr(TransitionType, tname, None)
            if ttype is None:
                ttype = TransitionType.from_name(tname) if hasattr(TransitionType, "from_name") else None
            if ttype is not None:
                seg.add_transition(ttype, duration=clip.get("transition_duration", "0.5s"))
        script.add_segment(seg, "video")
        cursor += dur

    # ---- 音频轨 ----
    audio = spec.get("audio")
    if audio:
        a = AudioSegment(audio["path"], tr(0, cursor),
                         volume=float(audio.get("volume", 1.0)))
        fin, fout = audio.get("fade_in"), audio.get("fade_out")
        if fin or fout:
            a.add_fade(fin or 0, fout or 0)
        script.add_segment(a, "audio")

    # ---- 文字轨 ----
    for text in texts:
        start = float(text.get("start", 0))
        end = float(text.get("end", cursor))
        color = text.get("color") or [1.0, 1.0, 1.0]
        style = TextStyle(
            size=float(text.get("size", 8.0)),
            color=tuple(color),
            align=int(text.get("align", 1)),
        )
        seg = TextSegment(
            text["text"],
            tr(start, max(end - start, 0.1)),
            style=style,
            clip_settings=ClipSettings(transform_y=float(text.get("y", -0.75))),
        )
        script.add_segment(seg, text.get("track") or "text")

    script.save()
    draft_dir = os.path.join(root, name)
    return {
        "draft_dir": draft_dir,
        "content": os.path.join(draft_dir, "draft_content.json"),
        "duration": cursor,
        "clips": len(clips),
        "texts": len(spec.get("texts") or []),
        "audio": bool(audio),
    }


def main():
    ap = argparse.ArgumentParser(description="剪映程序化剪辑器")
    ap.add_argument("spec")
    ap.add_argument("--root", default=DEFAULT_ROOT)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    spec = load_spec(args.spec)
    info = build(spec, args.root, dry_run=args.dry_run)
    if info is None:
        return 0

    print("草稿已生成:", info["draft_dir"])
    print("  draft_content.json: %d 字节" % os.path.getsize(info["content"]))
    print("  片段 %d / 文字 %d / 音频 %s / 总时长 %.2fs"
          % (info["clips"], info["texts"], "有" if info["audio"] else "无", info["duration"]))

    # 结构自检：轨道、素材、时间范围是否自洽
    with open(info["content"], encoding="utf-8") as fh:
        doc = json.load(fh)
    tracks = doc.get("tracks") or []
    mats = doc.get("materials") or {}
    print("  自检: version=%s tracks=%d (%s) videos=%d audios=%d texts=%d duration=%.2fs" % (
        doc.get("version"), len(tracks),
        ",".join(t.get("type", "?") for t in tracks),
        len(mats.get("videos") or []), len(mats.get("audios") or []), len(mats.get("texts") or []),
        (doc.get("duration") or 0) / 1e6,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
