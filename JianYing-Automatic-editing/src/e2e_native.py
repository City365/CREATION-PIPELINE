"""End-to-end: native search -> download -> draft with BGM -> deploy."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lyra
import server as api

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.abspath(os.path.join(HERE, "..", "output", "jy-library", "downloads"))

print("== 1. 原生搜索 ==")
res = lyra.search("music", "温柔 治愈 钢琴", limit=5)
items = lyra.simplify(res.get("items"))
for i, it in enumerate(items, 1):
    print("  %d. %s | %s | %ss | %s" % (i, it["title"], it["author"],
                                        it["duration"], it["paid_mode"]))

free = [x for x in items if x["paid_mode"] == "free"] or items
pick = free[0]
print("\n选: %s (%s)" % (pick["title"], pick["resource_id"]))

print("\n== 2. 下载 ==")
dl = lyra.download("music", pick["resource_id"], OUT_DIR)
path = dl["path"]
print("  %s  (%d bytes)" % (path, os.path.getsize(path)))

print("\n== 3. 建草稿 ==")
d = api.ep_create_draft({"name": "原生搜索-BGM测试", "width": 1080, "height": 1920, "fps": 30})
print("  draft=%s  %dx%d" % (d["draft"], d["width"], d["height"]))
name = d["draft"]

print("\n== 4. 加素材 ==")
clips = [os.path.join(REPO, "Creation-Studio/web/skins/real-cafe.mp4"),
         os.path.join(REPO, "Creation-Studio/web/skins/real-reading.mp4")]
for c in clips:
    r = api.ep_add_video(name, {"path": c, "duration": 3})
    print("  video_add -> %s" % json.dumps(r, ensure_ascii=False)[:120])

r = api.ep_add_audio(name, {"path": path, "volume": 0.6,
                      "fade_in": 1.2, "fade_out": 1.5})
print("  audio_add -> %s" % json.dumps(r, ensure_ascii=False)[:160])

r = api.ep_add_text(name, {"text": "原生搜索 BGM", "start": 0.4,
                     "end": 3.0, "size": 80, "color": "white",
                     "y": 0.0})
print("  text_add  -> %s" % json.dumps(r, ensure_ascii=False)[:120])

print("\n== 5. 部署 ==")
r = api.ep_deploy(name, {})
print("  %s" % json.dumps(r, ensure_ascii=False)[:300])
