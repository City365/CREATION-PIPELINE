#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
剪映剪辑 MCP Server（stdio）

把「剪映草稿 = 工程文件」这套能力暴露成 MCP 工具，任何支持 MCP 的 agent
（Codex / Claude Code / Claude Desktop / Cursor / 自己的宿主）都能直接调用。

零依赖：只用标准库实现 MCP 的 initialize / tools/list / tools/call。
后端复用 server.py 里的实现（同一个内存会话，所以可以先建草稿、再逐条加片段）。

启动（通常由 MCP 客户端拉起，不需要手跑）：
    .\\.venv-jianying\\Scripts\\python.exe tools\\jianying-api\\mcp_server.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import server as api  # noqa: E402  复用 HTTP 版的后端实现

SERVER_INFO = {"name": "jianying-edit", "version": "1.0.0"}
PROTOCOL = "2025-06-18"


# --------------------------------------------------------------------------- #
# 工具定义
# --------------------------------------------------------------------------- #

def _p(desc, **kw):
    d = {"description": desc}
    d.update(kw)
    return d


TOOLS = [
    {
        "name": "catalog",
        "description": "查询可用的枚举名字（转场/特效/滤镜/动画/字体）。写其他工具前先用它确认合法名字。",
        "inputSchema": {
            "type": "object",
            "properties": {"kind": {"type": "string",
                                    "enum": ["transition", "effect", "filter", "animation", "font"],
                                    "description": "要查询的类别"}},
            "required": ["kind"],
        },
    },
    {
        "name": "music_search",
        "description": "搜索剪映曲库（原生联网搜索，和剪映 App 里搜出来的完全一样）。返回 resource_id / 标题 / 作者 / 时长 / 试听地址 / 是否付费。拿到结果用 music_download 下成文件，或把 resource_id 传给 audio_add。没配好原生通道时自动回退查本地缓存索引。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "keyword": _p("搜索意图，可以是一句话，如 温暖治愈的钢琴 / 悬疑紧张 / Ditto", type="string"),
                "type": _p("music 或 sound（不填默认 music）", type="string", enum=["music", "sound"]),
                "limit": _p("最多返回条数，默认 10", type="integer"),
            },
            "required": ["keyword"],
        },
    },
    {
        "name": "music_download",
        "description": "把 music_search / material_search 返回的 resource_id 下载成本地音频文件（m4a）。返回绝对路径，可直接传给 audio_add 当 BGM。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "resource_id": _p("material search 返回的 resource_id", type="string"),
                "type": _p("资源类型，默认 music", type="string"),
                "dir": _p("保存目录，默认 output/jy-library/downloads", type="string"),
            },
            "required": ["resource_id"],
        },
    },
    {
        "name": "material_search",
        "description": "搜剪映素材平台全类型资源：template/music/sticker/effect/filter/transition/text_template/sound/font/flower/subtitle_template/photo/video/anim_text/anim_sticker/mix_mode/style/tone/voice_change 等 34 种。返回 resource_id + 元数据。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "type": _p("素材类型键", type="string"),
                "prompt": _p("搜索意图，用素材本身的词：物体 / 情绪 / 场景 / 风格 / 乐器 / 节奏", type="string"),
                "limit": _p("最多返回条数，默认 10", type="integer"),
                "filter_commercial": _p("只返回可商用素材", type="boolean"),
            },
            "required": ["type", "prompt"],
        },
    },
    {
        "name": "material_download",
        "description": "下载任意类型的素材包/文件到本地（贴纸、特效、转场、字体、模板等）。返回本地路径。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "type": _p("素材类型键", type="string"),
                "resource_id": _p("资源 ID", type="string"),
                "dir": _p("保存目录，默认 output/jy-library/downloads", type="string"),
            },
            "required": ["type", "resource_id"],
        },
    },
    {
        "name": "music_refresh",
        "description": "重建本机曲库索引：扫描全部剪映草稿，把里面用到的内置音乐/音效（曲名 + music_id + 本地缓存路径）收进索引。在剪映里搜过并用过一次某首歌之后调用它，之后 music_search 就能搜到。",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "draft_create",
        "description": "新建剪映草稿。之后所有添加操作都作用在这个 draft 上。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": _p("草稿名（同时是后续调用的 draft 参数）", type="string"),
                "width": _p("画布宽，默认 1080", type="integer"),
                "height": _p("画布高，默认 1920", type="integer"),
                "fps": _p("帧率，默认 30", type="integer"),
            },
            "required": ["name"],
        },
    },
    {
        "name": "video_add",
        "description": "导入视频片段并按顺序拼接。start 不传时自动接在上一段后面。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "draft": _p("草稿名", type="string"),
                "path": _p("本地视频绝对路径", type="string"),
                "in": _p("素材入点（秒），默认 0", type="number"),
                "duration": _p("在时间线上占用的时长（秒），默认 3", type="number"),
                "speed": _p("播放倍速，默认 1.0", type="number"),
                "start": _p("时间线起点（秒），不传则自动顺延", type="number"),
                "volume": _p("片段音量 0~1", type="number"),
                "transition": _p("该片段的转场名（用 catalog 查），如 叠化", type="string"),
                "transition_duration": _p("转场时长，如 0.5s", type="string"),
                "track": _p("轨道名，默认 video", type="string"),
            },
            "required": ["draft", "path"],
        },
    },
    {
        "name": "image_add",
        "description": "导入静态图片作为画面片段（可加入场动画）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "draft": _p("草稿名", type="string"),
                "path": _p("图片路径", type="string"),
                "start": _p("时间线起点（秒）", type="number"),
                "duration": _p("时长（秒），默认 3", type="number"),
                "track": _p("轨道名", type="string"),
                "animation": _p("入场动画名（用 catalog 查）", type="string"),
            },
            "required": ["draft", "path"],
        },
    },
    {
        "name": "audio_add",
        "description": "添加音频/BGM 片段，支持音量、淡入淡出、入点。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "draft": _p("草稿名", type="string"),
                "path": _p("音频文件路径", type="string"),
                "start": _p("时间线起点（秒），默认 0", type="number"),
                "in": _p("素材入点（秒），默认 0", type="number"),
                "duration": _p("时长（秒），不传则铺到视频轨末尾", type="number"),
                "volume": _p("音量 0~1，默认 1", type="number"),
                "fade_in": _p("淡入秒数", type="number"),
                "fade_out": _p("淡出秒数", type="number"),
                "track": _p("轨道名，默认 audio", type="string"),
            },
            "required": ["draft", "path"],
        },
    },
    {
        "name": "text_add",
        "description": "添加文本/字幕。不同 track 可叠加（如字幕轨 + 水印轨），同轨不能时间重叠。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "draft": _p("草稿名", type="string"),
                "text": _p("文字内容", type="string"),
                "start": _p("出现时间（秒）", type="number"),
                "end": _p("消失时间（秒）", type="number"),
                "size": _p("字号（相对值，常见 3~12）", type="number"),
                "color": _p("[r,g,b] 0~1，如 [1,1,1]", type="array", items={"type": "number"}),
                "x": _p("水平位置 -1~1", type="number"),
                "y": _p("垂直位置 -1~1，负数靠下", type="number"),
                "track": _p("轨道名，默认 text", type="string"),
                "font": _p("字体名（用 catalog font 查）", type="string"),
                "animation": _p("入场动画名", type="string"),
            },
            "required": ["draft", "text"],
        },
    },
    {
        "name": "effect_add",
        "description": "添加画面特效（独立特效轨）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "draft": _p("草稿名", type="string"),
                "name": _p("特效名（用 catalog effect 查），如 全息扫描", type="string"),
                "start": _p("开始时间（秒）", type="number"),
                "duration": _p("持续（秒）", type="number"),
                "params": _p("参数数组，顺序见特效定义，如 [null,null,60]", type="array"),
                "track": _p("轨道名，默认 effect", type="string"),
            },
            "required": ["draft", "name"],
        },
    },
    {
        "name": "filter_add",
        "description": "添加滤镜（独立滤镜轨），强度 0~100。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "draft": _p("草稿名", type="string"),
                "name": _p("滤镜名（用 catalog filter 查），如 哈苏蓝", type="string"),
                "start": _p("开始时间（秒）", type="number"),
                "duration": _p("持续（秒）", type="number"),
                "intensity": _p("强度 0~100，默认 70", type="number"),
                "track": _p("轨道名，默认 filter", type="string"),
            },
            "required": ["draft", "name"],
        },
    },
    {
        "name": "transition_add",
        "description": "给已存在的视频片段（按索引）加转场。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "draft": _p("草稿名", type="string"),
                "index": _p("视频片段下标，从 0 开始", type="integer"),
                "name": _p("转场名", type="string"),
                "duration": _p("时长，如 0.4s", type="string"),
            },
            "required": ["draft", "index", "name"],
        },
    },
    {
        "name": "animation_add",
        "description": "给片段加动画（视频入场/出场/组合，文本入场/出场/循环）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "draft": _p("草稿名", type="string"),
                "target": _p("video 或 text", type="string", enum=["video", "text"]),
                "index": _p("片段下标", type="integer"),
                "role": _p("intro / outro / combo / loop", type="string"),
                "name": _p("动画名（用 catalog animation 查）", type="string"),
                "duration": _p("时长，如 1s", type="string"),
            },
            "required": ["draft", "target", "index", "name"],
        },
    },
    {
        "name": "keyframe_add",
        "description": "给片段加关键帧（alpha/位置/缩放/旋转/音量等），做淡入淡出、推镜等。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "draft": _p("草稿名", type="string"),
                "target": _p("video / text / audio", type="string"),
                "index": _p("片段下标", type="integer"),
                "property": _p("属性名，如 alpha / uniform_scale / position_x / volume", type="string"),
                "time": _p("相对片段起点的秒数", type="number"),
                "value": _p("数值", type="number"),
            },
            "required": ["draft", "target", "index", "property", "time", "value"],
        },
    },
    {
        "name": "audio_duck",
        "description": "BGM 自动让路：在指定区间把音乐音量从 from 压到 to（人声段落用）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "draft": _p("草稿名", type="string"),
                "index": _p("音频片段下标，默认 0", type="integer"),
                "start": _p("区间开始（秒）", type="number"),
                "end": _p("区间结束（秒）", type="number"),
                "from_volume": _p("正常音量", type="number"),
                "to_volume": _p("压低后的音量", type="number"),
            },
            "required": ["draft", "start", "end"],
        },
    },
    {
        "name": "draft_inspect",
        "description": "查询当前草稿的轨道、片段数、时长和操作日志。",
        "inputSchema": {
            "type": "object",
            "properties": {"draft": _p("草稿名", type="string")},
            "required": ["draft"],
        },
    },
    {
        "name": "draft_save",
        "description": "把草稿写入磁盘（暂存目录）。",
        "inputSchema": {
            "type": "object",
            "properties": {"draft": _p("草稿名", type="string")},
            "required": ["draft"],
        },
    },
    {
        "name": "draft_deploy",
        "description": "把草稿部署到剪映草稿目录并注册到列表，剪映打开即可看到并导出。",
        "inputSchema": {
            "type": "object",
            "properties": {"draft": _p("草稿名", type="string")},
            "required": ["draft"],
        },
    },
    {
        "name": "export",
        "description": "导出成片：部署草稿；若配置了 jy-draftc 则无头渲染 mp4，否则返回需在剪映里点导出的提示。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "draft": _p("草稿名", type="string"),
                "out": _p("输出 mp4 路径", type="string"),
                "size": _p("分辨率，如 1080x1920", type="string"),
                "framerate": _p("帧率", type="integer"),
            },
            "required": ["draft"],
        },
    },
]


# --------------------------------------------------------------------------- #
# 工具分发
# --------------------------------------------------------------------------- #

def _catalog(kind):
    draft = api.jyd()
    if kind == "transition":
        names = [m.name for m in draft.TransitionType]
    elif kind == "effect":
        names = [m.name for m in draft.VideoSceneEffectType]
    elif kind == "filter":
        names = [m.name for m in draft.FilterType]
    elif kind == "animation":
        names = sorted({m.name for m in list(draft.IntroType) + list(draft.OutroType)
                        + list(draft.GroupAnimationType) + list(draft.TextIntro)
                        + list(draft.TextOutro) + list(draft.TextLoopAnim)})
    elif kind == "font":
        names = [m.name for m in draft.FontType]
    else:
        raise api.ApiError(400, "未知类别: %s" % kind)
    return {"ok": True, "kind": kind, "count": len(names), "names": names}


def _refresh_music():
    """重建曲库索引（调用 build_music_index.main）。"""
    import importlib
    import io
    import contextlib
    mod = importlib.import_module("build_music_index")
    buf = io.StringIO()
    old_argv = sys.argv
    sys.argv = ["build_music_index.py"]
    try:
        with contextlib.redirect_stdout(buf):
            mod.main()
    finally:
        sys.argv = old_argv
    idx = api.music_index()
    return {"ok": True, "count": idx.get("count"), "built_at": idx.get("build_at"),
            "log": buf.getvalue()[-800:]}


_DOWNLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "output", "jy-library", "downloads")


def _native_search(prompt, asset_type="music", limit=10, **extra):
    """走 lyra-cli 原生搜索；不可用时回退本地缓存索引。"""
    import lyra
    try:
        res = lyra.search(asset_type, prompt or "", int(limit or 10), **extra)
        items = lyra.simplify(res.get("items"))
        return {"ok": True, "source": "native", "type": asset_type,
                "keyword": prompt, "count": len(items), "items": items}
    except Exception as exc:  # noqa: BLE001
        fallback = api.ep_music_search({"keyword": prompt, "type": asset_type,
                                        "limit": int(limit or 50)})
        fallback["source"] = "cache"
        fallback["native_error"] = str(exc)[:400]
        if not fallback.get("count"):
            fallback["hint"] = ("原生搜索不可用，本地缓存也没命中。"
                                "检查剪映安装目录是否存在，或用 material_search 换关键词。")
        return fallback


def _native_download(asset_type, resource_id, target_dir=None):
    import lyra
    directory = target_dir or _DOWNLOAD_DIR
    res = lyra.download(asset_type, str(resource_id), directory)
    res["ok"] = True
    return res


def dispatch(name, args):
    if name == "catalog":
        return _catalog(args.get("kind"))
    if name == "music_search":
        return _native_search(args.get("keyword"), args.get("type") or "music",
                              args.get("limit") or 10)
    if name == "music_download":
        return _native_download("music", args["resource_id"], args.get("dir"))
    if name == "material_search":
        return _native_search(args["prompt"], args["type"], args.get("limit") or 10,
                              filter_commercial=args.get("filter_commercial"))
    if name == "material_download":
        return _native_download(args["type"], args["resource_id"], args.get("dir"))
    if name == "music_refresh":
        return _refresh_music()
    if name == "draft_create":
        return api.ep_create_draft(args)
    if name == "draft_inspect":
        return api.ep_get_draft(args["draft"])
    if name == "draft_save":
        return api.ep_save(args["draft"], args)
    if name == "draft_deploy":
        return api.ep_deploy(args["draft"], args)
    if name == "export":
        return api.ep_export(args)

    draft_name = args.pop("draft")
    table = {
        "video_add": api.ep_add_video,
        "image_add": api.ep_add_image,
        "audio_add": api.ep_add_audio,
        "text_add": api.ep_add_text,
        "effect_add": api.ep_add_effect,
        "filter_add": api.ep_add_filter,
        "transition_add": api.ep_add_transition,
        "animation_add": api.ep_add_animation,
        "keyframe_add": api.ep_add_keyframe,
        "audio_duck": api.ep_volume_keyframe,
    }
    fn = table.get(name)
    if not fn:
        raise api.ApiError(400, "未知工具: %s" % name)
    return fn(draft_name, args)


# --------------------------------------------------------------------------- #
# MCP 协议（stdio，换行分隔 JSON-RPC）
# --------------------------------------------------------------------------- #

def respond(msg_id, result):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": msg_id, "result": result},
                                ensure_ascii=False) + "\n")
    sys.stdout.flush()


def respond_error(msg_id, code, message):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": msg_id,
                                 "error": {"code": code, "message": message}},
                                ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle(req):
    method = req.get("method")
    msg_id = req.get("id")

    if method == "initialize":
        return respond(msg_id, {
            "protocolVersion": req.get("params", {}).get("protocolVersion") or PROTOCOL,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": (
                "剪映剪辑控制。典型流程：先 catalog 查合法枚举名 → draft_create 建草稿 → "
                "video_add 逐段拼素材（自动接续时间线）→ transition_add/effect_add/filter_add "
                "加转场特效滤镜 → text_add 加字幕或水印（不同 track 可叠加）→ audio_add 加 BGM "
                "→ audio_duck 让人声段音乐压低 → draft_inspect 核对 → draft_deploy 部署 / export 导出。"
            ),
        })

    if method == "notifications/initialized" or method == "initialized":
        return None
    if method == "ping":
        return respond(msg_id, {})
    if method == "tools/list":
        return respond(msg_id, {"tools": TOOLS})
    if method == "tools/call":
        params = req.get("params") or {}
        tool = params.get("name")
        args = params.get("arguments") or {}
        try:
            result = dispatch(tool, dict(args))
            text = json.dumps(result, ensure_ascii=False)
            return respond(msg_id, {"content": [{"type": "text", "text": text}],
                                    "isError": not result.get("ok", True)})
        except api.ApiError as exc:
            return respond(msg_id, {"content": [{"type": "text", "text": exc.message}],
                                    "isError": True})
        except Exception as exc:  # noqa: BLE001
            import traceback
            return respond(msg_id, {"content": [{"type": "text",
                                                 "text": "%s: %s" % (type(exc).__name__, exc),
                                                 "_trace": traceback.format_exc()[-800:]}],
                                    "isError": True})

    return respond_error(msg_id, -32601, "Method not found: %s" % method)


def main():
    sys.stderr.write("[jianying-mcp] ready (stdlib stdio)\n")
    sys.stderr.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            handle(req)
        except Exception as exc:  # noqa: BLE001
            respond_error(req.get("id"), -32603, "%s: %s" % (type(exc).__name__, exc))


if __name__ == "__main__":
    main()
