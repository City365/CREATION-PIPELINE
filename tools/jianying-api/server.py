#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剪映控制 API（本地 HTTP 服务，供你的系统调用）

后端：pyJianYingDraft（写剪映草稿） + 本机 videoeditor.dll（草稿加解密）
不依赖剪映窗口、不需要 GUI 自动化、不走云端。

启动：
    .\\.venv-jianying\\Scripts\\python.exe tools\\jianying-api\\server.py --port 17830

端点（POST，JSON body）：
    GET  /health                      健康检查 + 能力清单
    POST /drafts                      创建草稿 {name,width,height,fps}
    POST /drafts/<n>/video            加视频片段 {path,in,duration,speed,transition,transition_duration,track}
    POST /drafts/<n>/image            加图片片段 {path,start,duration,track,animation}
    POST /drafts/<n>/audio            加音频/BGM 片段 {path,in,duration,start,volume,fade_in,fade_out,track}
    POST /drafts/<n>/text             加文本/字幕 {text,start,end,size,color,x,y,track,font,animation}
    POST /drafts/<n>/effect           加画面特效 {name,start,duration,params,track}
    POST /drafts/<n>/filter           加滤镜 {name,intensity,track}
    POST /drafts/<n>/animation        加片段动画 {target:"video|text",index,role,name,duration}
    POST /drafts/<n>/transition       给片段加转场 {track,index,name,duration}
    POST /drafts/<n>/keyframe         加关键帧 {target,index,property,time,value}
    POST /drafts/<n>/volume-keyframe  音频音量关键帧（BGM 自动让路）{start,end,from_volume,to_volume}
    GET  /drafts/<n>                  查询当前会话结构
    POST /drafts/<n>/save             保存到磁盘 {out_dir?}
    POST /drafts/<n>/deploy           部署到剪映草稿目录并注册索引
    POST /export                      导出 {draft,out,resolution,framerate}（部署草稿 + 可选 jy-draftc 渲染）
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
STAGE_DIR = os.path.join(PROJECT_ROOT, "output", "jy-drafts")
JY_DRAFT_ROOT = r"D:\notebook\software\JianyingPro Drafts"
JY_INDEX = os.path.join(os.environ.get("LOCALAPPDATA", ""), "JianyingPro", "User Data",
                        "Projects", "com.lveditor.draft", "root_meta_info.json")

SESSIONS = {}
LOCK = threading.Lock()


# --------------------------------------------------------------------------- #
# 后端封装
# --------------------------------------------------------------------------- #

def jyd():
    import pyJianYingDraft as draft
    return draft


def build_session(name, width, height, fps):
    draft = jyd()
    os.makedirs(STAGE_DIR, exist_ok=True)
    folder = draft.DraftFolder(STAGE_DIR)
    path = os.path.join(STAGE_DIR, name)
    if os.path.isdir(path):
        shutil.rmtree(path)
    script = folder.create_draft(name, width, height, fps=fps)
    session = {
        "name": name,
        "script": script,
        "width": width,
        "height": height,
        "fps": fps,
        "tracks": {},          # track_name -> TrackRef
        "video_count": 0,
        "text_count": 0,
        "audio_count": 0,
        "cursor": 0.0,         # 视频轨游标（秒）
        "log": [],
    }
    SESSIONS[name] = session
    return session


def get_session(name):
    session = SESSIONS.get(name)
    if not session:
        raise ApiError(404, "草稿不存在: %s（先 POST /drafts）" % name)
    return session


def ensure_track(session, kind, track_name):
    """按需建轨。kind: video/audio/text/effect/filter"""
    draft = jyd()
    key = track_name
    if key in session["tracks"]:
        return key
    tmap = {"video": draft.TrackType.video, "audio": draft.TrackType.audio,
            "text": draft.TrackType.text, "effect": draft.TrackType.effect,
            "filter": draft.TrackType.filter}
    spec = draft.TrackSpec(tmap[kind], track_name)
    ref = session["script"].append_track(spec)
    session["tracks"][key] = ref
    return key


def tr(start_s, dur_s):
    draft = jyd()
    return draft.Timerange(int(round(float(start_s) * draft.SEC)),
                           int(round(float(dur_s) * draft.SEC)))


class ApiError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


# --------------------------------------------------------------------------- #
# 内置曲库（从本机草稿里挖出来的「曲名 ↔ music_id ↔ 本地缓存文件」）
# --------------------------------------------------------------------------- #

MUSIC_INDEX = os.path.join(PROJECT_ROOT, "output", "jy-library", "music_index.json")
_MUSIC_CACHE = {"mtime": 0, "data": None}


def music_index():
    if not os.path.exists(MUSIC_INDEX):
        return {"items": [], "by_name": {}, "count": 0}
    mtime = os.path.getmtime(MUSIC_INDEX)
    if _MUSIC_CACHE["data"] is None or _MUSIC_CACHE["mtime"] != mtime:
        with open(MUSIC_INDEX, encoding="utf-8") as fh:
            _MUSIC_CACHE["data"] = json.load(fh)
        _MUSIC_CACHE["mtime"] = mtime
    return _MUSIC_CACHE["data"]


def ep_music_search(body):
    """按关键词搜本机已缓存的剪映内置曲库/音效库。"""
    kw = (body.get("keyword") or body.get("q") or "").strip()
    kind = body.get("type")  # music | sound
    idx = music_index()
    hits = []
    for it in idx.get("items") or []:
        if kind and it.get("type") != kind:
            continue
        if kw and kw.lower() not in (it.get("name") or "").lower() and kw not in (it.get("music_id") or ""):
            continue
        hits.append({
            "name": it.get("name"),
            "music_id": it.get("music_id"),
            "type": it.get("type"),
            "duration": it.get("duration"),
            "path": it.get("path"),
        })
    return {"ok": True, "keyword": kw, "count": len(hits),
            "index_built_at": idx.get("build_at"), "total_in_index": idx.get("count"),
            "items": hits[: int(body.get("limit", 50))]}


def resolve_music(body):
    """把 music_id / name 解析成本地缓存文件路径。"""
    idx = music_index()
    items = idx.get("items") or []
    if not items:
        raise ApiError(404, "曲库索引为空，先跑 tools/jianying-api/build_music_index.py")
    mid = str(body.get("music_id") or "")
    name = (body.get("music") or body.get("name") or "").strip()
    if mid:
        for it in items:
            if str(it.get("music_id") or "") == mid:
                return it
    if name:
        for it in items:
            if it.get("name") == name:
                return it
        for it in items:
            if name in (it.get("name") or ""):
                return it
    raise ApiError(404, "曲库里没有「%s」；用 music_search 查，或先在本机剪映里用过这首歌一次" % (name or mid))


MUSIC_DOWNLOAD_DIR = os.path.join(PROJECT_ROOT, "output", "jy-library", "downloads")
MUSIC_CACHE_DIR = os.path.join(os.environ.get("LOCALAPPDATA", ""), "JianyingPro",
                               "User Data", "Cache", "music")


def ep_music_native(body):
    """原生联网搜剪映曲库/音效库（lyra-cli 走剪映素材平台，和在剪映里搜同一份数据）。"""
    kw = (body.get("keyword") or body.get("q") or "").strip()
    if not kw:
        raise ApiError(400, "keyword 不能为空")
    kind = body.get("type") or "music"
    try:
        limit = int(body.get("limit") or 20)
    except (TypeError, ValueError):
        limit = 20
    import lyra
    try:
        res = lyra.search(kind, kw, limit=limit)
    except lyra.LyraError as exc:
        raise ApiError(502, "原生搜索失败: %s" % exc)
    items = lyra.simplify(res.get("items"))
    return {"ok": True, "source": "native", "keyword": kw, "type": kind,
            "count": len(items), "items": items}


def ep_music_download(body):
    """按 resource_id 把曲库条目下成 m4a，返回落地路径。"""
    rid = str(body.get("resource_id") or "").strip()
    if not rid:
        raise ApiError(400, "resource_id 不能为空")
    kind = body.get("type") or "music"
    out_dir = body.get("dir") or MUSIC_DOWNLOAD_DIR
    import lyra
    try:
        res = lyra.download(kind, rid, out_dir)
    except lyra.LyraError as exc:
        raise ApiError(502, "下载失败: %s" % exc)
    path = res.get("path")
    if not path or not os.path.exists(path):
        raise ApiError(502, "下载没有落地: %s" % json.dumps(res, ensure_ascii=False)[:300])
    return {"ok": True, "resource_id": rid, "type": kind, "path": path,
            "bytes": os.path.getsize(path),
            "title": body.get("title") or os.path.splitext(os.path.basename(path))[0]}


def ep_music_status(body):
    """曲库能力速览：本地索引多少条、原生通道能不能用、缓存目录在哪。"""
    idx = music_index()
    out = {
        "ok": True,
        "index": {"count": idx.get("count") or 0, "build_at": idx.get("build_at"),
                  "file": MUSIC_INDEX, "cache": MUSIC_CACHE_DIR},
        "downloads": MUSIC_DOWNLOAD_DIR,
        "native": {"ok": False, "install": None, "patched": None, "error": None},
    }
    try:
        import lyra
        install = lyra.find_install()
        out["native"] = {"ok": True, "install": install,
                         "patched": lyra.ensure_patched(install), "error": None}
    except Exception as exc:  # noqa: BLE001
        out["native"]["error"] = str(exc)
    return out


# --------------------------------------------------------------------------- #
# 端点实现
# --------------------------------------------------------------------------- #

def ep_health(body):
    draft = jyd()
    return {
        "ok": True,
        "service": "jianying-control-api",
        "pyjianyingdraft": getattr(draft, "__version__", "installed"),
        "stage_dir": STAGE_DIR,
        "draft_root": JY_DRAFT_ROOT,
        "sessions": list(SESSIONS),
        "capabilities": {
            "draft": ["create", "query", "save", "deploy"],
            "video": ["clip", "trim(in/duration)", "speed", "transition", "animation", "keyframe"],
            "image": True,
            "audio": ["clip", "volume", "fade_in/out", "start", "volume_keyframe"],
            "text": ["content", "size", "color", "position", "font", "animation"],
            "effect": ["video_scene_effect", "filter"],
            "export": ["deploy_to_jianying", "ffmpeg_render", "jy_draftc(optional)"],
            "music": ["search(local cache index)", "native_search(online)",
                      "download(resource_id -> m4a)", "status"],
        },
    }


def ep_create_draft(body):
    name = body.get("name") or ("draft_%d" % int(time.time()))
    with LOCK:
        session = build_session(name, int(body.get("width", 1080)),
                                int(body.get("height", 1920)), int(body.get("fps", 30)))
    return {"ok": True, "draft": name, "width": session["width"],
            "height": session["height"], "fps": session["fps"]}


def ep_add_video(name, body):
    draft = jyd()
    session = get_session(name)
    path = body.get("path")
    if not path or not os.path.exists(path):
        raise ApiError(400, "素材不存在: %s" % path)
    dur = float(body.get("duration") or 3.0)
    src_in = float(body.get("in", 0))
    speed = float(body.get("speed", 1.0))
    track = ensure_track(session, "video", body.get("track") or "video")
    start = body.get("start")
    cursor = float(start) if start is not None else session["cursor"]

    seg = draft.VideoSegment(path, tr(cursor, dur),
                             source_timerange=tr(src_in, dur * speed), speed=speed)
    if body.get("volume") is not None:
        seg.volume = float(body["volume"])
    if body.get("transition"):
        tname = body["transition"]
        ttype = getattr(draft.TransitionType, tname, None)
        if ttype is None and hasattr(draft.TransitionType, "from_name"):
            try:
                ttype = draft.TransitionType.from_name(tname)
            except Exception:
                ttype = None
        if ttype is None:
            raise ApiError(400, "未知转场: %s" % tname)
        seg.add_transition(ttype, duration=body.get("transition_duration", "0.5s"))
    session["script"].add_segment(seg, track)
    session["video_count"] += 1
    session["cursor"] = cursor + dur
    session["log"].append("video %.2f-%.2fs %s" % (cursor, cursor + dur, os.path.basename(path)))
    return {"ok": True, "index": session["video_count"] - 1, "start": cursor,
            "duration": dur, "cursor": session["cursor"]}


def ep_add_image(name, body):
    draft = jyd()
    session = get_session(name)
    path = body.get("path")
    if not path or not os.path.exists(path):
        raise ApiError(400, "素材不存在: %s" % path)
    dur = float(body.get("duration") or 3.0)
    start = float(body.get("start") or session["cursor"])
    track = ensure_track(session, "video", body.get("track") or "video")
    seg = draft.VideoSegment(path, tr(start, dur))
    if body.get("animation"):
        anim = getattr(draft.IntroType, body["animation"], None)
        if anim is not None:
            seg.add_animation(anim)
    session["script"].add_segment(seg, track)
    session["video_count"] += 1
    session["cursor"] = max(session["cursor"], start + dur)
    session["log"].append("image %.2f-%.2fs %s" % (start, start + dur, os.path.basename(path)))
    return {"ok": True, "index": session["video_count"] - 1, "start": start, "duration": dur}


def ep_add_audio(name, body):
    draft = jyd()
    session = get_session(name)
    path = body.get("path")
    if not path:
        # 没给路径但给了 music_id / name → 从内置曲库解析成本地缓存文件
        item = resolve_music(body)
        path = item["path"]
        body = dict(body)
        body.setdefault("volume", 0.45)
    if not path or not os.path.exists(path):
        raise ApiError(400, "音频不存在: %s" % path)
    start = float(body.get("start", 0))
    dur = body.get("duration")
    if dur is None:
        dur = session["cursor"] - start if session["cursor"] > start else 5.0
    dur = float(dur)
    src_in = float(body.get("in", 0))
    track = ensure_track(session, "audio", body.get("track") or "audio")
    seg = draft.AudioSegment(path, tr(start, dur), source_timerange=tr(src_in, dur),
                             volume=float(body.get("volume", 1.0)))
    if body.get("fade_in") or body.get("fade_out"):
        seg.add_fade(str(body.get("fade_in", 0)) + "s" if isinstance(body.get("fade_in"), (int, float)) else body.get("fade_in", "0s"),
                     str(body.get("fade_out", 0)) + "s" if isinstance(body.get("fade_out"), (int, float)) else body.get("fade_out", "0s"))
    session["script"].add_segment(seg, track)
    session["audio_count"] += 1
    session["log"].append("audio %.2f-%.2fs %s vol=%.2f" % (start, start + dur, os.path.basename(path), float(body.get("volume", 1.0))))
    return {"ok": True, "index": session["audio_count"] - 1, "start": start, "duration": dur}


def ep_add_text(name, body):
    draft = jyd()
    session = get_session(name)
    text = body.get("text")
    if not text:
        raise ApiError(400, "text 不能为空")
    start = float(body.get("start", 0))
    end = float(body.get("end", session["cursor"] or start + 3))
    size = float(body.get("size", 8.0))
    color = body.get("color") or [1.0, 1.0, 1.0]
    track_name = body.get("track") or "text"
    track = ensure_track(session, "text", track_name)
    style = draft.TextStyle(size=size, color=tuple(color), align=int(body.get("align", 1)))
    seg = draft.TextSegment(text, tr(start, max(end - start, 0.1)), style=style,
                            clip_settings=draft.ClipSettings(
                                transform_y=float(body.get("y", -0.75)),
                                transform_x=float(body.get("x", 0.0))))
    if body.get("font"):
        f = getattr(draft.FontType, body["font"], None)
        if f is not None:
            seg.font = f
    if body.get("animation"):
        a = getattr(draft.TextIntro, body["animation"], None)
        if a is not None:
            seg.add_animation(a)
    session["script"].add_segment(seg, track)
    session["text_count"] += 1
    session["log"].append("text %.2f-%.2fs %s" % (start, end, text[:16]))
    return {"ok": True, "index": session["text_count"] - 1, "start": start, "end": end}


def ep_add_effect(name, body):
    draft = jyd()
    session = get_session(name)
    ename = body.get("name")
    if not ename:
        raise ApiError(400, "name 不能为空（画面特效名，如 全息扫描）")
    et = getattr(draft.VideoSceneEffectType, ename, None)
    if et is None and hasattr(draft.VideoSceneEffectType, "from_name"):
        try:
            et = draft.VideoSceneEffectType.from_name(ename)
        except Exception:
            et = None
    if et is None:
        raise ApiError(400, "未知特效: %s" % ename)
    start = float(body.get("start", 0))
    dur = float(body.get("duration", session["cursor"] or 3))
    track = ensure_track(session, "effect", body.get("track") or "effect")
    session["script"].add_effect(et, tr(start, dur), track_name=track,
                                 params=body.get("params") or [])
    session["log"].append("effect %s %.2f-%.2fs" % (ename, start, start + dur))
    return {"ok": True, "effect": ename, "start": start, "duration": dur}


def ep_add_filter(name, body):
    draft = jyd()
    session = get_session(name)
    fname = body.get("name")
    if not fname:
        raise ApiError(400, "name 不能为空（滤镜名，如 哈苏蓝）")
    ft = getattr(draft.FilterType, fname, None)
    if ft is None and hasattr(draft.FilterType, "from_name"):
        try:
            ft = draft.FilterType.from_name(fname)
        except Exception:
            ft = None
    if ft is None:
        raise ApiError(400, "未知滤镜: %s" % fname)
    start = float(body.get("start", 0))
    dur = float(body.get("duration", session["cursor"] or 3))
    track = ensure_track(session, "filter", body.get("track") or "filter")
    session["script"].add_filter(ft, tr(start, dur), track_name=track,
                                 intensity=float(body.get("intensity", 70)))
    session["log"].append("filter %s %.2f-%.2fs" % (fname, start, start + dur))
    return {"ok": True, "filter": fname, "intensity": body.get("intensity", 70)}


def ep_add_transition(name, body):
    draft = jyd()
    session = get_session(name)
    tname = body.get("name")
    ttype = getattr(draft.TransitionType, tname, None)
    if ttype is None:
        raise ApiError(400, "未知转场: %s" % tname)
    idx = int(body.get("index", 0))
    seg = _pick_segment(session, body.get("target") or "video", idx)
    seg.add_transition(ttype, duration=body.get("duration", "0.5s"))
    session["log"].append("transition %s on video[%d]" % (tname, idx))
    return {"ok": True, "transition": tname, "index": idx}


def ep_add_animation(name, body):
    draft = jyd()
    session = get_session(name)
    target = body.get("target") or "video"
    idx = int(body.get("index", 0))
    role = body.get("role") or "intro"
    aname = body.get("name")
    seg = _pick_segment(session, target, idx)
    if target == "text":
        enum = {"intro": draft.TextIntro, "outro": draft.TextOutro, "loop": draft.TextLoopAnim}[role]
    else:
        enum = {"intro": draft.IntroType, "outro": draft.OutroType, "combo": draft.GroupAnimationType}[role]
    at = getattr(enum, aname, None)
    if at is None and hasattr(enum, "from_name"):
        try:
            at = enum.from_name(aname)
        except Exception:
            at = None
    if at is None:
        raise ApiError(400, "未知动画: %s" % aname)
    kwargs = {}
    if body.get("duration"):
        kwargs["duration"] = body["duration"]
    seg.add_animation(at, **kwargs) if kwargs else seg.add_animation(at)
    session["log"].append("animation %s %s[%d]" % (aname, target, idx))
    return {"ok": True, "animation": aname}


def ep_add_keyframe(name, body):
    draft = jyd()
    session = get_session(name)
    target = body.get("target") or "video"
    idx = int(body.get("index", 0))
    seg = _pick_segment(session, target, idx)
    prop = body.get("property")
    t = body.get("time", 0)
    v = float(body.get("value", 1.0))
    if target == "audio":
        seg.add_keyframe(t, v)
    else:
        kp = getattr(draft.KeyframeProperty, prop or "alpha", None)
        if kp is None:
            raise ApiError(400, "未知属性: %s" % prop)
        seg.add_keyframe(kp, t, v)
    session["log"].append("keyframe %s[%d].%s@%s=%s" % (target, idx, prop, t, v))
    return {"ok": True}


def ep_volume_keyframe(name, body):
    """BGM 自动让路：在 [start,end] 内把音量从 from 降到 to（人声段）。"""
    draft = jyd()
    session = get_session(name)
    idx = int(body.get("index", 0))
    seg = _pick_segment(session, "audio", idx)
    start = float(body.get("start", 0))
    end = float(body.get("end", start + 1))
    v_from = float(body.get("from_volume", 0.45))
    v_to = float(body.get("to_volume", 0.12))
    # add_keyframe 的 time_offset 必须是 int 微秒或 "1.5s" 字符串，传 Timerange 会污染序列化
    seg.add_keyframe(int(round(start * 1e6)), v_from)
    seg.add_keyframe(int(round(end * 1e6)), v_to)
    session["log"].append("ducking audio[%d] %.2f→%.2f @%.2f-%.2fs" % (idx, v_from, v_to, start, end))
    return {"ok": True, "ducking": {"start": start, "end": end, "from": v_from, "to": v_to}}


def _pick_segment(session, target, idx):
    script = session["script"]
    if target == "audio":
        ttype = jyd().TrackType.audio
    elif target == "text":
        ttype = jyd().TrackType.text
    else:
        ttype = jyd().TrackType.video
    segs = []
    for _tname, trk in script.tracks.items():
        if trk.track_type == ttype:
            segs.extend(trk.segments)
    if not segs:
        raise ApiError(400, "该类型没有片段: %s" % target)
    if idx < 0 or idx >= len(segs):
        raise ApiError(400, "下标越界: %s[%d] 共 %d 段" % (target, idx, len(segs)))
    return segs[idx]


def ep_get_draft(name):
    session = get_session(name)
    script = session["script"]
    tracks = []
    for tname, trk in script.tracks.items():
        tracks.append({
            "type": str(trk.track_type).split(".")[-1],
            "name": tname,
            "segments": len(trk.segments),
        })
    return {
        "ok": True, "draft": name, "width": session["width"], "height": session["height"],
        "fps": session["fps"], "duration": script.duration / 1e6,
        "counts": {"video": session["video_count"], "text": session["text_count"],
                   "audio": session["audio_count"]},
        "tracks": tracks, "log": session["log"][-50:],
    }


def ep_save(name, body):
    session = get_session(name)
    session["script"].save()
    path = os.path.join(STAGE_DIR, name, "draft_content.json")
    size = os.path.getsize(path) if os.path.exists(path) else 0
    return {"ok": True, "draft_dir": os.path.join(STAGE_DIR, name), "bytes": size}


def ep_deploy(name, body):
    """复制到剪映草稿目录并注册索引（PowerShell 执行，绕开 Python 对该目录的写限制）。"""
    session = get_session(name)
    session["script"].save()
    src = os.path.join(STAGE_DIR, name)
    ps = r"""
$ErrorActionPreference='Stop'
$name='__NAME__'; $src='__SRC__'; $root='__ROOT__'
$dst = Join-Path $root $name
if(Test-Path $dst){ Remove-Item $dst -Recurse -Force }
Copy-Item $src $dst -Recurse -Force
if(-not (Test-Path (Join-Path $dst 'draft_virtual_store.json'))){ '{"draft_materials":[],"draft_virtual_store":[]}' | Set-Content (Join-Path $dst 'draft_virtual_store.json') -Encoding UTF8 }
$c = Get-Content (Join-Path $dst 'draft_content.json') -Raw | ConvertFrom-Json
"[General]`ndraft_create_time=$([int]($c.create_time/1e6))`ndraft_last_edit_time=$([int]($c.update_time/1e6))`nreal_edit_seconds=0`nreal_edit_keys=0`n" | Set-Content (Join-Path $dst 'draft_settings') -Encoding UTF8
$idx='__IDX__'
$data = Get-Content $idx -Raw | ConvertFrom-Json
$tpl = $data.all_draft_store | Where-Object { $_.draft_name -ne $name } | Select-Object -First 1
$item = $tpl.PSObject.Copy()
$item.draft_name=$name; $item.draft_id=$c.id; $item.draft_fold_path=$dst; $item.draft_root_path=$root
$item.tm_duration=$c.duration; $item.draft_cover=''; $item.draft_new_version='75.0.0'
$data.all_draft_store = @($item) + @($data.all_draft_store | Where-Object { $_.draft_name -ne $name })
$data | ConvertTo-Json -Depth 12 -Compress | Set-Content $idx -Encoding UTF8
Write-Output ("deployed:" + $dst)
""".replace("__NAME__", name).replace("__SRC__", src).replace("__ROOT__", JY_DRAFT_ROOT).replace("__IDX__", JY_INDEX)
    proc = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                          capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
    if proc.returncode != 0:
        raise ApiError(500, "部署失败: %s" % (proc.stderr or proc.stdout)[-600:])
    return {"ok": True, "deployed": os.path.join(JY_DRAFT_ROOT, name),
            "hint": "打开剪映，草稿列表第一条即可看到"}


def ep_export(body):
    """导出：部署草稿；若提供 jy-draftc 则无头渲染，否则返回需人工点导出。"""
    name = body.get("draft")
    if not name:
        raise ApiError(400, "draft 必填")
    out = body.get("out") or os.path.join(PROJECT_ROOT, "output", "exports", name + ".mp4")
    dep = ep_deploy(name, {})
    exe = os.path.join(HERE, "..", "jianying-scheduler", "bin", "jy-draftc.exe")
    if os.path.exists(exe):
        cmd = [exe, "-ex", dep["deployed"], "-o", out, "--jy-dir",
               r"D:\notebook\software\JianyingPro\11.5.0.14471", "-f"]
        if body.get("size"):
            cmd += ["--size", body["size"]]
        if body.get("framerate"):
            cmd += ["--fps", str(body["framerate"])]
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=7200)
        if proc.returncode != 0:
            raise ApiError(500, "jy-draftc 渲染失败(%d): %s" % (proc.returncode, (proc.stderr or proc.stdout)[-600:]))
        return {"ok": True, "mode": "headless", "output": out,
                "bytes": os.path.getsize(out) if os.path.exists(out) else 0}
    return {"ok": True, "mode": "deployed_only", "deployed": dep["deployed"],
            "message": "草稿已进剪映列表，请在剪映里点导出（或放 jy-draftc.exe 到 tools/jianying-scheduler/bin 后自动无头渲染）"}


ROUTES = {
    ("GET", "/health"): lambda b: ep_health(b),
    ("POST", "/drafts"): ep_create_draft,
    ("POST", "/export"): ep_export,
    ("POST", "/music/search"): ep_music_search,
    ("GET", "/music/search"): ep_music_search,
    ("GET", "/music"): ep_music_search,
    ("GET", "/music/status"): ep_music_status,
    ("GET", "/music/native-search"): ep_music_native,
    ("POST", "/music/native-search"): ep_music_native,
    ("GET", "/music/download"): ep_music_download,
    ("POST", "/music/download"): ep_music_download,
}


# --------------------------------------------------------------------------- #
# HTTP 层
# --------------------------------------------------------------------------- #

class Handler(BaseHTTPRequestHandler):
    server_version = "JianyingAPI/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self, method):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
            if not isinstance(body, dict):
                body = {}
            from urllib.parse import parse_qs, unquote
            raw_target = self.path
            if "?" in raw_target:
                # GET 用查询串，POST 用 body；body 里已有的键优先
                for key, values in parse_qs(raw_target.split("?", 1)[1]).items():
                    body.setdefault(key, values[0] if len(values) == 1 else values)
            path = unquote(raw_target.split("?")[0]).rstrip("/") or "/"

            if (method, path) in ROUTES:
                return self._send(200, ROUTES[(method, path)](body))

            parts = [p for p in path.split("/") if p]
            if method == "GET" and len(parts) == 2 and parts[0] == "drafts":
                return self._send(200, ep_get_draft(parts[1]))

            if method == "POST" and len(parts) == 3 and parts[0] == "drafts":
                name, action = parts[1], parts[2]
                table = {
                    "video": ep_add_video, "image": ep_add_image, "audio": ep_add_audio,
                    "text": ep_add_text, "effect": ep_add_effect, "filter": ep_add_filter,
                    "transition": ep_add_transition, "animation": ep_add_animation,
                    "keyframe": ep_add_keyframe, "volume-keyframe": ep_volume_keyframe,
                    "save": ep_save, "deploy": ep_deploy,
                }
                fn = table.get(action)
                if fn:
                    return self._send(200, fn(name, body))

            self._send(404, {"ok": False, "error": "未知端点: %s %s" % (method, path)})
        except ApiError as exc:
            self._send(exc.code, {"ok": False, "error": exc.message})
        except Exception:  # noqa: BLE001
            self._send(500, {"ok": False, "error": traceback.format_exc()[-1500:]})

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=17830)
    args = ap.parse_args()
    os.makedirs(STAGE_DIR, exist_ok=True)
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print("剪映控制 API 已启动: http://%s:%d" % (args.host, args.port))
    print("阶段目录: %s" % STAGE_DIR)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n停止")


if __name__ == "__main__":
    main()
