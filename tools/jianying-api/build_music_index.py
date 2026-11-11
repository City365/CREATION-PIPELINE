#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从本机剪映草稿里挖出「内置曲库/音效库」索引。

原理：剪映把用户用过的内置音乐/音效**已经下载到本地缓存**，草稿里记的是

    {"type":"music", "name":"宿命感进行曲", "music_id":"7593177804998936627",
     "path":"…\\User Data\\Cache\\music\\ccc5531c….mp3"}

所以不需要联网、不需要账号凭据：把全机草稿扫一遍，就能得到
「曲名 ↔ music_id ↔ 本地缓存文件」的映射。之后 agent 可以直接按曲名点歌。

用法：
    python tools/jianying-api/build_music_index.py
    python tools/jianying-api/build_music_index.py --root "D:\\notebook\\software\\JianyingPro Drafts"
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(PROJECT_ROOT, "output", "jy-library", "music_index.json")
DEFAULT_ROOT = r"D:\notebook\software\JianyingPro Drafts"
MUSIC_CACHE = os.path.join(os.environ.get("LOCALAPPDATA", ""), "JianyingPro", "User Data", "Cache", "music")

sys.path.insert(0, HERE)


def read_draft(path, engine):
    with open(path, "rb") as fh:
        raw = fh.read()
    head = raw[:1]
    if head in (b"{", b" "):
        try:
            return json.loads(raw.decode("utf-8-sig"))
        except Exception:  # noqa: BLE001
            pass
    if engine is None:
        return None
    try:
        text = engine.decrypt(raw)
        return json.loads(text)
    except Exception:  # noqa: BLE001
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=DEFAULT_ROOT)
    args = ap.parse_args()

    try:
        from jydll import JianyingEngine
        engine = JianyingEngine(verbose=False)
    except Exception as exc:  # noqa: BLE001
        print("引擎加载失败（只处理明文草稿）: %s" % exc)
        engine = None

    entries = {}
    scanned = ok = 0
    for name in sorted(os.listdir(args.root)):
        d = os.path.join(args.root, name)
        if not os.path.isdir(d):
            continue
        content = os.path.join(d, "draft_content.json")
        if not os.path.exists(content):
            continue
        scanned += 1
        doc = read_draft(content, engine)
        if not doc:
            continue
        ok += 1
        for aud in (doc.get("materials") or {}).get("audios") or []:
            typ = aud.get("type")
            if typ not in ("music", "sound"):
                continue
            path = (aud.get("path") or "").replace("/", "\\")
            title = aud.get("name") or ""
            mid = str(aud.get("music_id") or "")
            if not path or not os.path.exists(path):
                continue
            key = mid or path
            duration = aud.get("duration") or 0
            if key not in entries:
                entries[key] = {
                    "name": title,
                    "music_id": mid,
                    "type": typ,
                    "path": path,
                    "duration": round(duration / 1e6, 2) if duration else None,
                    "sources": [name],
                }
            else:
                if name not in entries[key]["sources"]:
                    entries[key]["sources"].append(name)
                if not entries[key]["name"] and title:
                    entries[key]["name"] = title

    items = sorted(entries.values(), key=lambda x: (x["type"], x["name"]))
    by_name = {it["name"]: it["music_id"] or it["path"] for it in items if it["name"]}
    by_id = {(it["music_id"] or it["path"]): it for it in items}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"build_at": __import__("time").strftime("%Y-%m-%d %H:%M:%S"),
                   "draft_root": args.root, "music_cache": MUSIC_CACHE,
                   "scanned": scanned, "parsed": ok,
                   "count": len(items), "items": items,
                   "by_name": by_name}, fh, ensure_ascii=False, indent=2)

    print("扫描草稿 %d，成功解析 %d" % (scanned, ok))
    print("曲库条目 %d（music=%d, sound=%d）" % (
        len(items),
        sum(1 for i in items if i["type"] == "music"),
        sum(1 for i in items if i["type"] == "sound")))
    print("索引: %s" % OUT)
    print("\n前 12 条:")
    for it in items[:12]:
        print("  [%s] %-22s id=%s  %s" % (
            it["type"], (it["name"] or "(无题)")[:22], it["music_id"] or "-",
            os.path.basename(it["path"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
