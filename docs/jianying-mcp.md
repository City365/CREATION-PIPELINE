# 剪映剪辑 MCP：给 Agent 用的接口

一个本地 stdio MCP Server，把「剪映工程文件 + 素材平台」变成 21 个可调用工具。Agent 不需要点界面；工程编辑完全离线，素材搜索/下载走剪映原生通道。

```
Agent  ──MCP──▶  mcp_server.py  ──pyJianYingDraft──▶  剪映草稿  ──▶  剪映打开 / 导出
```

- 服务端：`tools/jianying-api/mcp_server.py`（零依赖，标准库实现 MCP，stdin/stdout）
- HTTP 版（同一套后端）：`tools/jianying-api/server.py`，端口 17830
- 草稿暂存：`output/jy-drafts/<草稿名>/`
- 部署目标：`D:\notebook\software\JianyingPro Drafts`

---

## 1. 安装

```powershell
cd D:\notebook\AIGC\CREATION-PIPELINE
uv venv --python 3.12 .venv-jianying
uv pip install --python .venv-jianying\Scripts\python.exe pyJianYingDraft
```

自检：

```powershell
.\.venv-jianying\Scripts\python.exe tools\jianying-api\mcp_server.py
# 不报错即可（它等 stdin 输入，Ctrl+C 退出）
```

---

## 2. 客户端配置

所有客户端用的都是同一段：**可执行文件 + 脚本路径**。

```json
{
  "mcpServers": {
    "jianying": {
      "command": "D:\\notebook\\AIGC\\CREATION-PIPELINE\\.venv-jianying\\Scripts\\python.exe",
      "args": ["D:\\notebook\\AIGC\\CREATION-PIPELINE\\tools\\jianying-api\\mcp_server.py"],
      "cwd": "D:\\notebook\\AIGC\\CREATION-PIPELINE"
    }
  }
}
```

- **Claude Code**：`claude mcp add jianying -- <上面的 command> <上面的 args>`
- **Claude Desktop**：写进 `claude_desktop_config.json` 的 `mcpServers`
- **Codex**：写进 `~/.codex/config.toml`
  ```toml
  [mcp_servers.jianying]
  command = 'D:\notebook\AIGC\CREATION-PIPELINE\.venv-jianying\Scripts\python.exe'
  args = ['D:\notebook\AIGC\CREATION-PIPELINE\tools\jianying-api\mcp_server.py']
  cwd = 'D:\notebook\AIGC\CREATION-PIPELINE'
  ```
- **Cursor / 其他 MCP 宿主**：同上 JSON。

> `cwd` 必须给，草稿路径是相对项目根解析的。

---

## 3. 工具清单（21 个）

### 3.1 素材 / 曲库（联网原生搜索）

| 工具 | 作用 | 必填参数 |
|---|---|---|
| `music_search` | 搜剪映曲库（原生联网，跟 App 里搜的一致） | `keyword` |
| `music_download` | 把 `resource_id` 下成本地 m4a，直接喂 `audio_add` | `resource_id` |
| `material_search` | 搜全类型素材（34 种：模板/贴纸/特效/滤镜/转场/字体/花字/模板包/文本动画…） | `type`,`prompt` |
| `material_download` | 下载任意类型的素材文件/包 | `type`,`resource_id` |
| `music_refresh` | 重建本地缓存曲库索引（离线兜底用） | — |

`music_search` 返回：`resource_id`、`title`、`author`、`duration`、`paid_mode`、`is_commerce`、`preview_url`、`cover`。
原生通道不可用时自动回退本地缓存索引（`source: "cache"`）。

### 3.2 工程编辑

| 工具 | 作用 | 必填参数 |
|---|---|---|
| `catalog` | 查合法枚举名（转场 453 个 / 特效 / 滤镜 / 动画 / 字体） | `kind` |
| `draft_create` | 新建草稿 | `name` |
| `video_add` | 导入视频并拼接（可裁切/变速/转场/音量） | `draft`,`path` |
| `image_add` | 导入图片片段（可加入场动画） | `draft`,`path` |
| `audio_add` | 音频/BGM（音量、淡入淡出、入点、起点） | `draft`,`path` |
| `text_add` | 文本/字幕/水印（颜色、位置、字号、字体、动画） | `draft`,`text` |
| `effect_add` | 画面特效（独立特效轨） | `draft`,`name` |
| `filter_add` | 滤镜（独立滤镜轨，强度 0~100） | `draft`,`name` |
| `transition_add` | 给已有片段按索引加转场 | `draft`,`index`,`name` |
| `animation_add` | 片段动画（视频出入场/组合，文本出入场/循环） | `draft`,`target`,`index`,`name` |
| `keyframe_add` | 关键帧（alpha / 位置 / 缩放 / 音量…） | `draft`,`target`,`index`,`property`,`time`,`value` |
| `audio_duck` | BGM 自动让路（人声段压低音乐） | `draft`,`start`,`end` |
| `draft_inspect` | 查结构：轨道、片段数、时长、操作日志 | `draft` |
| `draft_save` | 写入磁盘暂存目录 | `draft` |
| `draft_deploy` | 部署到剪映草稿目录并注册列表 | `draft` |
| `export` | 导出成片（部署 + 可选无头渲染） | `draft` |

---

## 4. 标准工作流

Agent 应该按这个顺序串：

```
① catalog(kind)                     ← 先确认名字合法，别猜
② draft_create(name,w,h,fps)
③ video_add × N                     ← 不传 start 时自动接续上一段
④ transition_add / effect_add / filter_add
⑤ text_add × N                      ← 字幕轨和水印轨分开（不同 track）
⑥ audio_add(BGM) + audio_duck       ← 人声段压低 BGM
⑦ draft_inspect                     ← 核对轨道和时长
⑧ draft_deploy → export
```

### 示例调用序列

```jsonc
// 1. 建 1080x1920 竖屏草稿
{"name":"draft_create","arguments":{"name":"ep01","width":1080,"height":1920,"fps":30}}

// 2. 三段画面，前两段带叠化
{"name":"video_add","arguments":{"draft":"ep01","path":"D:/media/shot01.mp4","in":0.5,"duration":3.0,"transition":"叠化","transition_duration":"0.4s"}}
{"name":"video_add","arguments":{"draft":"ep01","path":"D:/media/shot02.mp4","duration":2.5,"speed":1.2,"transition":"叠化"}}
{"name":"video_add","arguments":{"draft":"ep01","path":"D:/media/shot03.mp4","duration":4.0}}

// 3. 字幕（字幕轨）+ 水印（独立轨，可重叠）
{"name":"text_add","arguments":{"draft":"ep01","text":"她等了 99 天","start":0.5,"end":3.5,"size":10,"color":[1,1,1],"y":0.15}}
{"name":"text_add","arguments":{"draft":"ep01","text":"CREATION-PIPELINE","start":0,"end":10,"size":3.5,"track":"watermark","y":-0.92}}

// 4. BGM + 人声段让路
{"name":"audio_add","arguments":{"draft":"ep01","path":"D:/media/bgm.mp3","start":0,"duration":10,"volume":0.5,"fade_in":1.0,"fade_out":1.5}}
{"name":"audio_duck","arguments":{"draft":"ep01","index":0,"start":0.5,"end":3.5,"from_volume":0.5,"to_volume":0.12}}

// 5. 特效 / 滤镜（跨整条）
{"name":"effect_add","arguments":{"draft":"ep01","name":"全息扫描","start":0,"duration":10,"params":[null,null,60]}}
{"name":"filter_add","arguments":{"draft":"ep01","name":"哈苏蓝","start":0,"duration":10,"intensity":70}}

// 6. 部署 + 导出
{"name":"draft_deploy","arguments":{"draft":"ep01"}}
{"name":"export","arguments":{"draft":"ep01","out":"D:/renders/ep01.mp4","size":"1080x1920","framerate":30}}
```

---

## 5. 参数约定

| 概念 | 规则 |
|---|---|
| 时间 | 一律**秒**（浮点）。内部自动转微秒 |
| `duration` | 在时间线上占用多久；`in` 是素材第几秒开始取 |
| `speed` | 变速倍数。`duration × speed` 决定实际消耗的素材长度 |
| `start` | 时间线起点。`video_add` 不传时自动接续上一段的末尾 |
| `text.color` | `[r,g,b]`，取值 0~1，如 `[1,0.82,0.4]` |
| `text.size` | 相对字号，常见 `3~12`（`10` 大约是 1080p 上的大标题） |
| `text.x / y` | `-1~1`，`y` 负数靠下 |
| `track` | 轨道名。**同轨片段不能时间重叠**；字幕和水印用不同 `track` |
| 特效 `params` | 数组，顺序与特效定义一致；不确定就传 `[null,null,60]` 这类部分值 |
| 枚举名 | 全部中文，先 `catalog` 查 |

---

## 6. 能力边界

**能做到**

- 导入视频/图片/音频、顺序拼接、入点裁切、变速、音量
- 转场（453 种）、画面特效、滤镜、动画、关键帧
- 文本/字幕/水印多轨叠加、颜色字号位置、字体
- BGM + 淡入淡出 + 人声段自动压低（ducking）
- 画布尺寸/帧率
- 部署到剪映列表（打开即可继续手改、导出）

**做不到**

- 剪映内置曲库/贴纸/花字按 `resource_id` 直接调用：需要账号联网下载，本地无缓存会“加载失败”。替代：用本地文件，或在剪映里手工用一次让资源落缓存。
- 无头渲 mp4：需要 `tools/jianying-scheduler/bin/jy-draftc.exe`；没有时 `export` 只做部署，需在剪映里点一次导出。
- 智能功能（自动字幕识别、智能抠像、图文成片）：这些是剪映内部 AI，没有对外的程序入口。

---

## 7. 排查

| 现象 | 原因 / 处理 |
|---|---|
| `工具没出现` | 客户端没读到 config；检查 `command` 是否是绝对路径、`cwd` 是否给了 |
| `draft 不存在: xxx` | 先调 `draft_create`；服务重启会清空内存会话 |
| `未知转场/特效/滤镜: xxx` | 调 `catalog` 拿准确名字 |
| `SegmentOverlap` | 同一条 text/audio 轨上两段重叠，换 `track` 或错开时间 |
| `素材不存在` | `path` 用绝对路径，且文件真的在那 |
| `draft_deploy` 报 Access denied | 当前进程无权写剪映草稿目录；换有权限的会话执行，或手工把 `output/jy-drafts/<名>` 拷过去 |
| 草稿里素材“加载失败” | 素材被移动/删除，或引用的是剪映云资源而本地无缓存 |

---

## 8. 和 HTTP 版的关系

同一套后端，两种入口：

| | MCP（`mcp_server.py`） | HTTP（`server.py`） |
|---|---|---|
| 给谁用 | Agent / MCP 客户端 | 自己的后端服务、CI、脚本 |
| 传输 | stdio | `POST http://127.0.0.1:17830/...` |
| 工具/端点 | 21 个工具 | 14 个 REST 端点 |
| 会话 | 进程内存共享 | 服务进程内存共享 |

两者不要同时跑（会话不共享）。选一个。
