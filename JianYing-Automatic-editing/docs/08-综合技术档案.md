# 让智能体控制剪映剪辑：路线调研与本机落地方案

> 调研日期：2026-11-09 ｜ 本机实测：剪映专业版 11.5.0.14471（`D:\notebook\software\JianyingPro\11.5.0.14471\JianyingPro.exe`）

## 0. 结论先行

智能体"控制剪映"没有官方 API。所有可行做法都归结为两条控制面：

| 控制面 | 做法 | 能力上限 | 稳定性 |
| --- | --- | --- | --- |
| **草稿文件面**（离线） | 直接读写 `draft_content.json` 等草稿文件 | 时间线、素材、字幕、特效、转场、关键帧全都能写 | 高（结构版本变了要跟） |
| **UI 面**（在线） | 鼠标键盘 + 截图/控件识别的 RPA | 剪映界面里有的都能点，含导出、会员素材、字幕识别 | 低（改版即失效） |

推荐组合：**草稿文件面做全部剪辑编排，UI 面只负责最后一件事——点「导出」。**

具体选型（按本机 11.5 现状排序）：

| 方案 | 形态 | 能读加密草稿 | 能自动导出 | 适合 |
| --- | --- | --- | --- | --- |
| **jianying-tool**（推荐） | Python CLI + **MCP 服务（71 个工具）** | ✅ 调 `videoeditor.dll` | ✅ 桌面自动化 | 直接给智能体当工具箱，11.x 已验证 |
| **jy-draftc** | C++ CLI | ✅ 加解密 + 升降级 | ✅ **无头导出**（不起 UI） | 批量渲染、解密真实草稿做模板 |
| **pyJianYingDraft** | Python 库 | 🟡 需自带 `fallback_loader` | ❌ 仅剪映 6 及以下 | 从零生成草稿，代码最顺手 |
| **jianying-ai-mcp** | MCP + Skill | ✅ 依赖 jy-draftc | ❌ | 参考草稿复用/批量换料 |
| **剪映小助手 capcut-mate** | Docker + HTTP API | — | 由下游消费者导出 | 服务化、多机调用 |
| 纯 UI 自动化 | uiautomation / pywinauto / 截图匹配 | — | ✅ | 兜底 |
| **CapCut（国际版）生态** | CLI / HTTP / MCP 包装，只产草稿 | ❌ 无解密器 | ❌ 手动 | 不推荐，见 §9 |

---

## 1. 剪映的"可编程接口"到底是什么

剪映专业版没有对外 API，但它的工程文件是完全可读写的本地文件。一个草稿目录大致长这样：

```
<草稿根>/<草稿名>/
├── draft_content.json        ← 时间线本体（轨道 / 片段 / 素材 / 特效）
├── draft_meta_info.json      ← 草稿卡片元信息（名称、路径、时长、封面）
├── draft_virtual_store.json  ← 素材池虚拟映射
├── draft_settings            ← ini，创建/编辑时间
├── draft_cover.jpg           ← 列表缩略图
└── media/…                   ← 素材副本（可选）
```

外层还有一个索引：`%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\root_meta_info.json`，里面 `all_draft_store[]` 是草稿列表。

`draft_content.json` 的核心结构（简化）：

```jsonc
{
  "version": 360000,                 // 草稿结构版本
  "canvas_config": { "width": 1920, "height": 1080, "ratio": "16:9" },
  "duration": 54669000,              // 微秒
  "materials": { "videos": [], "audios": [], "texts": [], "transitions": [], … },
  "tracks": [                        // 轨道数组，顺序 = 层级（后添加的在上层）
    { "type": "video", "segments": [ { "material_id": "…", "target_timerange": {…}, "source_timerange": {…} } ] }
  ]
}
```

要点：
- **时间单位是微秒**（1s = 1 000 000）。
- 片段（segment）用 `material_id` 指向 `materials` 里的素材；`target_timerange` 是它在时间线上的位置，`source_timerange` 是截取素材的哪一段。
- 轨道顺序决定叠放层级，字幕/贴纸/特效是不同类型的轨道。

### 关键变化：11.x 的草稿被加密了

本机实测（`D:\notebook\software\JianyingPro Drafts`，36 个草稿）：

```
10月10日               → hFHc6dlGEHDT…     ← 加密
你死后的99天           → bfICZ8c3ig34…     ← 加密
我的同桌测试-第2集     → {"canvas_con…     ← 明文（本项目 jianying.js 生成）
```

规律：**剪映 11.5 自己保存的草稿全部不是明文 JSON**；本项目用 `version: 360000` 明文生成的草稿仍是明文，剪映也能打开（保存后变加密）。

因此：
- 只想"生成新草稿"→ 明文骨架仍然有效（`Creation-Studio/src/jianying.js` 走的就是这条路）。
- 想"读/改用户真实草稿、拿它当模板"→ **必须解密**，要么调 `videoeditor.dll`（jy-draftc / jianying-tool），要么退回用 `version: 360000` 明文自建。

---

## 1.5 本机实测结果（2026-11-09）

环境：`uv` + CPython 3.12.11，隔离 venv `.venv-jianying`，`jianying-tool 0.5.0`（附带 `pyjianyingdraft 0.3.0`、`uiautomation 2.0.29`、`pymediainfo`）。

```powershell
uv venv --python 3.12 .venv-jianying
uv pip install --python .venv-jianying\Scripts\python.exe jianying-tool
```

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| 版本探测 | `probe --json` | ✅ 但**必须**显式 `JY_INSTALL_DIR=D:\notebook\software\JianyingPro\11.5.0.14471`；不设时它挑到了安装根下旧的 `8.9.0.13361`（按目录名取"最新"会取错） |
| 读加密草稿 | `inspect "...\你死后的99天"` | ✅ `format: jianying-native`、`codec_used: true`、`readable: true`，解出 6 条轨道（video / text / audio）、素材名与时间范围完整 |
| 写新草稿 | `create --name agent-test --video real-cafe.mp4` | ✅ 生成 `draft_content.json`(3.9 KB, 明文) + `draft_meta_info.json` + `media/` 素材副本 |
| 复制加密草稿 | `bundle <加密草稿> <目标>` | ❌ `JSONDecodeError` —— bundle 会对加密的 `draft_content.json` 直接 `json.loads`。要用模板请走 `inspect`/原生编解码或先解密 |

结论：**11.5 上"读真实草稿 + 写新草稿"都能跑通**，主链路成立；加密草稿做模板请绕开 `bundle`。

---

## 2. 路线 A：从零生成草稿（pyJianYingDraft）

最轻的一条。纯 Python，不碰剪映进程，只产出草稿目录。

```bash
pip install pyJianYingDraft   # 需要 Python ≥3.8；本机默认 3.8.6 可用
```

```python
import pyJianYingDraft as draft
from pyJianYingDraft import (
    TrackSpec, TrackType, VideoSegment, AudioSegment,
    trange_seconds, ClipSettings, TextStyle,
)

folder = draft.DraftFolder(r"D:\notebook\software\JianyingPro Drafts")

# 1) 新建 1080x1920 竖屏草稿
script = folder.create_draft("agent_ep01", 1080, 1920)

# 2) 建轨（顺序 = 层级）
script.append_tracks([
    TrackSpec(TrackType.video, "主视频"),
    TrackSpec(TrackType.audio, "人声"),
    TrackSpec(TrackType.text,  "字幕"),
])

# 3) 主视频：按镜头顺序首尾相接
cursor = 0.0
for shot in ["shot01.mp4", "shot02.mp4", "shot03.mp4"]:
    seg = VideoSegment(f"D:/media/{shot}", trange_seconds(cursor, duration=4.0))
    script.add_segment(seg, "主视频")
    cursor += 4.0

# 4) 背景音乐 + 淡入淡出
bgm = AudioSegment("D:/media/bgm.mp3", trange_seconds(0, duration=cursor))
bgm.add_fade("1s", "2s")
script.add_segment(bgm, "人声")

# 5) 字幕（也可以直接导入 srt）
script.import_srt("D:/media/ep01.srt", track_name="字幕",
                  text_style=TextStyle(size=8.0, color=(1, 1, 1)),
                  clip_settings=ClipSettings(transform_y=-0.8))

script.save()
```

能力边界（官方功能清单）：
- 支持：视频/图片/音频片段与变速截取、关键帧、蒙版、色度抠图、混合模式、背景填充、贴纸、文本与样式/动画/气泡花字、`.srt` 字幕、片段特效/滤镜/转场、独立特效与滤镜轨道、模板模式（替换素材/文本、导入轨道）。
- 不支持：曲线变速；自动导出仅剪映 **6 及以下**（7+ 控件被隐藏）；新版加密草稿做模板需 `DraftFolder(..., fallback_loader=…)` 接外部读取器。

> 本机剪映 11.5 高于该库验证基线（10.8），生成后应先开一个小样抽查：文本、转场、字体是否正常，再上批量。

---

## 3. 路线 B：原生编解码读写（能治加密草稿 + 能无头导出）

剪映自己带了一个渲染引擎：`videoeditor.dll`（内含 `EncryptUtils`、`Draft` 解析、`Lyra` 服务、`ExportService`）。两个开源项目直接调它：

### B1. jy-draftc（C++ CLI，MIT）

```powershell
# 解出明文，看真实草稿结构（也可当模板来源）
.\jy-draftc.exe -dc "D:\notebook\software\JianyingPro Drafts\你死后的99天" -o D:\plain

# 明文改完再加密回去
.\jy-draftc.exe -ec "D:\plain\你死后的99天-plain"

# 无头导出：不起剪映 UI，直接渲染 mp4
.\jy-draftc.exe -ex "D:\plain\你死后的99天-plain" -o D:\out\ep.mp4 --size 1080x1920 --fps 30

# 批量并行（auto 按 CPU/内存自调）
.\jy-draftc.exe -ex "D:\notebook\software\JianyingPro Drafts" -o D:\out -j auto
```

- 版本强绑定：需选与剪映版本匹配的 release。本项目 11.5.0.14471 对应 `11.5.0.14471-26101113`（草稿结构 33.0.0–187.0.0）。
- 配置 `.env`：`JY_INSTALL_DIR=D:\notebook\software\JianyingPro\11.5.0.14471`（该目录下必须有 `videoeditor.dll`）。
- 退出码可用于流水线判断（0 成功 / 2 导出失败 / 8 DLL 版本不符 / 10 解析被拒 / 11 加解密回环失败 / 12 校验失败）。

### B2. jianying-tool（Python + MCP，Apache-2.0）

同一套原生编解码思路的完整工程化版本，**基准就是剪映 11.4.2**，与本机 11.5 最接近：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install "jianying-tool[tts,asr]"

# 自检：确认找到本机安装与草稿根
.\.venv\Scripts\python.exe -m jianying_tool.cli probe --json
```

它把 71 个操作做成 CLI + MCP 工具，粒度非常适合智能体：

```text
create / project-settings / subtitle / text-style / append-text
replace-video / replace-image / replace-audio / append-video / append-image
split-segment / duplicate-segment / move-segment / edit-segment / freeze-frame
add-track / move-track / rename-track / shift-track / track-mute
transition / filter / video-effect / track-effect / animation / mask / chroma / background
keyframe / transform / crop / adjust / mix-mode / separator-audio / voiceover / transcribe
export（驱动剪映导出对话框）
doctor / drafts --check / inspect / media-resources
```

典型一键成片：

```powershell
jianying create --name ep01 --video "D:\media\shot01.mp4"
jianying project-settings --draft ep01 --width 1080 --height 1920 --ratio 9:16 --fps 30
jianying subtitle --draft ep01 --srt "D:\media\ep01.srt"
jianying append-audio --draft ep01 --audio "D:\media\bgm.mp3" --volume 0.35 --fade-in 1 --fade-out 2
jianying transition --draft ep01 --track main_video --segment 0 --name 叠化 --duration 0.5
jianying export --draft ep01 --title ep01 --output-dir "D:\renders" --resolution 1080P --framerate 30 --close
```

重要事实（决定了它为什么能跑在本机）：
- 剪映 11.x 是 Qt/QML，**不暴露任何 UIA 控件**（`QT_ACCESSIBILITY=1`、屏幕阅读器标志都试过，8 层深度内 0 个 UIA 子控件）。所以 UI 自动化只能靠**截图模板匹配 + 合成输入**。
- 它的导出就是这套：`PrintWindow` 截图、模板匹配找控件、每设一项参数都**读回核对**，并通过 `导出-<草稿名>` 标题校验"当前打开的是哪个草稿"。模板采自 11.4.2 / 100% 缩放，换机器或改版会**明确报错而不是瞎点**。
- MCP 客户端配置：

```json
{
  "mcpServers": {
    "jianying": {
      "command": "D:\\notebook\\AIGC\\CREATION-PIPELINE\\.venv\\Scripts\\python.exe",
      "args": ["-m", "jianying_tool.mcp_server"],
      "cwd": "D:\\notebook\\AIGC\\CREATION-PIPELINE"
    }
  }
}
```

---

## 4. 路线 C：把剪映包成 MCP，交给智能体

**智能体本身不会点鼠标。** 它需要的是"能被调用的函数"。所以正确架构是三层：

```
用户自然语言
   ↓
LLM（创作智能体：规划剪辑意图，产出结构化剪辑单 EDL/JSON）
   ↓  工具调用
剪辑执行层（jianying-tool CLI / MCP / pyJianYingDraft 封装）
   ↓  写文件
剪映草稿（draft_content.json）  →  剪映 UI 打开确认  →  导出 mp4
```

给 LLM 的工具不必是 71 个。**收窄到 8~12 个**，语义边界清晰，成功率最高：

```python
TOOLS = [
  {"name": "jy_probe",         "desc": "探测剪映版本/草稿根，返回能力清单"},
  {"name": "jy_create_draft",  "desc": "新建草稿，参数 name/width/height/fps"},
  {"name": "jy_add_clips",     "desc": "按顺序追加视频/图片片段，参数 track, items[{path,start,duration}]"},
  {"name": "jy_add_audio",     "desc": "加音频，参数 path/volume/fade_in/fade_out/start"},
  {"name": "jy_add_subtitle",  "desc": "从 srt 或文本+时间轴加字幕，参数 srt|segments, style"},
  {"name": "jy_add_text",      "desc": "加标题文字，参数 text/start/duration/style/animation"},
  {"name": "jy_add_effect",    "desc": "加转场/滤镜/特效，参数 target, name, params"},
  {"name": "jy_keyframe",      "desc": "加关键帧，参数 track/segment/property/time/value"},
  {"name": "jy_inspect_draft", "desc": "只读检查草稿：轨道、片段、素材是否缺失"},
  {"name": "jy_export",        "desc": "导出 mp4，参数 draft/resolution/framerate/out_dir"},
]
```

LLM 侧只需产出这样一份"剪辑单"，执行层逐条翻译成工具调用：

```json
{
  "draft": "ep01",
  "canvas": { "width": 1080, "height": 1920, "fps": 30 },
  "tracks": [
    { "type": "video", "name": "main", "clips": [
      { "path": "D:/media/shot01.mp4", "start": 0.0, "duration": 4.0 },
      { "path": "D:/media/shot02.mp4", "start": 4.0, "duration": 3.2 }
    ]},
    { "type": "audio", "name": "bgm", "clips": [
      { "path": "D:/media/bgm.mp3", "start": 0.0, "duration": 7.2, "volume": 0.35, "fade_in": 1.0 }
    ]},
    { "type": "text", "name": "sub", "source": "D:/media/ep01.srt" }
  ],
  "transitions": [ { "track": "main", "segment": 0, "name": "叠化", "duration": 0.5 } ],
  "export": { "resolution": "1080P", "framerate": 30, "out_dir": "D:/renders/ep01" }
}
```

> MCP 参考实现：[jianying-ai-mcp](https://github.com/Xanthus-Sanslab/jianying-ai-mcp) 就是这套形态——`analyze_video_source`（抽帧+字幕，让模型真的"看"素材）→ `build_draft` / `build_from_reference` / `batch_from_template`（确定性生成）→ 默认 `dry_run=true`，先在暂存区生成并校验，再发布到剪映目录，不覆盖同名草稿。

---

## 5. 路线 D：UI 自动化兜底

适用场景：剪映界面里才有的东西（自动字幕识别、会员音乐库、模板套用、导出）。

| 工具 | 适用 | 说明 |
| --- | --- | --- |
| `uiautomation` | 剪映 5.x/6.x | 老版本有可见控件，`JianyingController` 就是这么导出的 |
| 截图模板匹配 + `pydirectinput`/`SendInput` | 剪映 7+ / 11.x | 11.x 无 UIA，只能这条路；模板随版本维护 |
| `pywinauto` | 一般 Windows 应用 | 对 Qt/QML 同样难，聊胜于无 |

11.x 上的最低可行实现要点：
1. 用 `PrintWindow` 截图（`ImageGrab` 会被遮挡干扰），不要用 `BitBlt` 直接读被遮挡窗口。
2. 模板匹配打分不过阈值就**报错退出**，宁可失败不要乱点。
3. 每次点击前用"窗口标题 + 可见窗口集合 + 锚点图像"三重确认页面状态（主窗口标题恒为"剪映专业版"，不携带页面信息；导出对话框标题是 `导出-<草稿名>`，这是唯一能确认"开的是哪个草稿"的地方）。
4. 运行期不要抢焦点：建议夜间批处理，或配虚拟桌面。

---

## 6. 路线 E：服务化（多机/多任务）

[剪映小助手 capcut-mate](https://developer.aliyun.com/article/1731723) 是 Docker 化的 HTTP 服务，把草稿操作做成 REST：

```
POST /openapi/capcut-mate/v1/create_draft   {width, height}   → draft_url
POST /openapi/capcut-mate/v1/save_draft     {draft_url}
GET  /openapi/capcut-mate/v1/get_draft?draft_id=...
```

适合"一个剪辑服务、多个智能体客户端"。代价是多一层部署与草稿同步；单机自用没必要。

---

## 7. 接入本项目（CREATION-PIPELINE）的改造点

现状：`Creation-Studio/src/jianying.js` 已能生成 `version: 360000` 明文草稿（仅视频轨道顺序拼接 + 注册 `root_meta_info.json`），并做"剪映未运行"检查与索引备份。这套骨架是对的，缺三块：

| 缺口 | 补法 | 落点 |
| --- | --- | --- |
| 只有视频轨 | 扩 `buildDraft`：audio / text / sticker / effect 轨 + transitions 素材 | `Creation-Studio/src/jianying.js` |
| 不能读真实草稿 | 需要模板时调 `jy-draftc -dc` 解出明文，或直接用 jianying-tool 读 | 新增 `src/jianying-native.js`（调外部 exe） |
| 不能自动导出 | `jy-draftc -ex`（无头）优先；UI 自动化作为备选 | 新增导出任务类型，回传 `output/` |

推荐的落地顺序（每步都可独立验证）：

1. **打通读**：装 `jianying-tool`，`probe` + `drafts --check` 跑通，确认能读到 11.5 的加密草稿。
2. **打通写**：用它 `create` + `append-video` + `subtitle` 造一个小样，剪映打开抽查视觉正确。
3. **打通导出**：`export --resolution 1080P --close` 出一条 mp4，确认落在 `D:\renders`。
4. **接智能体**：把上面 10 个工具注册进 `agent_backend`（FastAPI + LangChain 那侧），提示词里约束"只输出剪辑单 JSON + 工具调用"。
5. **接流水线**：Creation-Studio 里"分镜/媒体库 → 生成草稿 → 导出"变成三段可重试的任务，失败按退出码分类重试。

---

## 8. 坑与边界

- **版本漂移**是最大风险。草稿结构版本、加密方式、UI 布局都随版本变；固定剪映版本（`winget download --id ByteDance.JianyingPro --exact --version 11.5.0.14471`）比追新更省事。
- **剪映运行时不要写草稿**：退出时剪映会用内存里的列表覆盖 `root_meta_info.json`（本项目已做拦截）。
- **索引与目录会不一致**：`dangling` / `duplicate_name` / `missing_content` / `unregistered`。同名草稿残留会导致剪映报"草稿内容已损坏"。
- **写前备份**：`draft_content.json` 改写前留副本（jianying-tool 会备份到 `.jianying-tool-backups`）。
- **VIP / 在线素材**：贴纸、气泡、花字、滤镜、特效都是 `resource_id` 引用，第一次打开需联网下载，未缓存会显示"加载失败"；字体同理，可能需要二次打开草稿。
- **导出**：自动导出会置顶窗口并操作光标，不适宜白天有人用机器时跑；VIP 未开通时可能陷入重试，必须设超时。
- **不要提交/分发剪映二进制**：调 `videoeditor.dll` 的方案都只在本地调用本机安装的运行时，不自带任何剪映文件。

## 9. CapCut（国际版）：官方 Codex MCP 实测与定位

用户口中的 "capcat" 即 **CapCut**（剪映国际版）。结论：**CapCut 确实有官方 MCP（2026-10 起），但它锁定 Codex 桌面端 + 云草稿，接不进本地流水线；驱动本机剪映仍走 jianying-tool / jy-draftc。** 本机未安装 CapCut 桌面版（`%LOCALAPPDATA%\CapCut`、`Program Files`、`D:\notebook\software`、winget 均无），以下为端点实测 + 官方 runbook。

### 9.1 它是什么：官方托管 MCP

2026-10-27 CapCut World LA 发布（newsroom 原话："bringing CapCut to ChatGPT plugins … in the coming months"，同时宣布"a more agentic experience coming soon to CapCut"）。落地形态是一个 **Codex 插件**（`CapCut@CapCut`，v0.2.7），底层是标准远程 MCP。

端点实测（2026-11-09，本机）：

```powershell
# initialize —— 无需授权，返回 200 + Mcp-Session-Id + instructions
POST https://www.capcut.com/api/external_mcp
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}

# tools/list —— 返回 36 个工具
# 任何 tools/call —— 未授权一律 HTTP 401
```

36 个工具的骨架是**云草稿 `stdraft`**，不是本地 `draft_content.json`：

| 分组 | 工具 | 作用 |
| --- | --- | --- |
| 会话/云草稿 | `start_stdraft_session`、`get_stdraft_snapshot`、`push_stdraft_snapshot`、`check_stdraft_state` | 新建会话绑定一个云草稿；取/推**整份快照**（不收 patch）；`package_id` 做乐观锁，`stale=true` 说明云端已变 |
| AI 粗剪 | `capcut_ailab_start_edit`、`capcut_ailab_poll_edit_progress`、`capcut_ailab_submit_plan_response`、`editing_plan` | 从视频/图片出 AI 粗剪，剪辑计划以卡片形式等用户确认 |
| 字幕 | `auto_caption_submit`、`auto_caption_query` | 语音识别 → 字幕文件/自动加字幕 |
| 模板 | `capcut_template_search`、`capcut_template_search_poll_v2`、`templates_preview_v2` | 文本/图片/视频 → 模板与剪辑灵感检索 |
| 素材库 | `search_capcut_material` | 音乐、音效、视频特效、字体、文字效果、转场、滤镜 |
| 生成 | `capcut_image_generate`、`capcut_video_generate`、`*_poll`、`*_cancel`、`capcut_estimate_generation_credits`、`billing_confirmation` | 图/视频生成，走 credits 计费，生成前要确认 |
| 素材上传 | `capcut_asset_upload_credential`、`capcut_batch_media_url` | 拿到上传凭证后跑"随包本地 uploader"，再取回 URL 与元数据 |
| 界面卡片 | `capcut_*_card_*`、`templates_preview`、`video_preview`、`generation_result` | 给 Codex UI 渲染参数卡/计费卡/结果卡，非 Codex 客户端里没有意义 |

**36 个工具里没有 export / 渲染**：`video_preview` 只返回"editing destination"，成片仍在 CapCut 应用内导出。这一点与开源生态一致。

### 9.2 怎么装（官方 runbook 的关键步骤）

官方页 `capcut.com/tools/capcut-x-codex` 给的是一段**提示词**：把它粘进 Codex 桌面任务，任务会去读 `…/capcut_codex_plugin/SKILL.md` 并照做。runbook 的核心链路：

```text
下载 plugins_v27.zip（HTTPS，失败重试 2 次）
  → Expand-Archive / ditto 解到唯一临时目录
  → 找 .agents/plugins/marketplace.json，定位 marketplace root
  → 拷到 <codex-data>/plugin-marketplaces 的 sibling staging 目录
  → codex plugin marketplace add <codex-data>/plugin-marketplaces/CapCut
  → codex plugin add CapCut@CapCut        （校验版本 == 0.2.7）
  → codex mcp get capcut_creation         （transport 必须 == https://www.capcut.com/api/external_mcp）
  → node …/mcp-auth/scripts/capcut-login.mjs --codex-cli <codex-cli>
        ↑ 起 codex app-server，请求 mcpServer/oauth/login（PKCE），
          把 authorization_url 丢给 Codex 内置浏览器，凭据留在那里
  → 等到 event=completed success=true，再做"首次使用"
```

细节值得抄：安装/授权/首次使用**分三段报告**；旧安装先备份再替换、失败按状态机回滚；权限不足时只对该条命令申请一次提权；工具列表过期要 fork 任务而不是重装。

### 9.3 四条限制（决定它进不了本流水线）

1. **事实上锁定 Codex 桌面端。** 我探测 `/.well-known/oauth-protected-resource`、`/.well-known/oauth-authorization-server`、`/.well-known/openid-configuration`，分别 502/502/502，`/api/external_mcp/.well-known/…` 404 —— 没有公开的 OAuth discovery，client 是 Codex 侧注册的（runbook 里 `invalid_request` / `unknown client` 分支即为此）。自建 MCP 客户端只能 initialize，调不了工具。
2. **区域账号必须匹配。** runbook 原文：US 出口 IP 要 US 注册的 CapCut 账号，非 US 出口 IP 要非 US 账号，否则授权页直接报错。
3. **云草稿，不是本地文件。** 素材要先上传换 URL，项目存 CapCut 云，`stdraft` 快照整份推回。本机 `D:\notebook\software\JianyingPro Drafts` 那套中文草稿、剪映素材库、模板 ID 全部不通。
4. **生成要花钱，导出还要人工。** 图/视频生成走 credits（有 `billing_confirmation`、`capcut_estimate_generation_credits`），且没有 export 工具。

### 9.4 值得抄的三点

1. **快照 + 乐观锁。** `get_stdraft_snapshot` / `push_stdraft_snapshot` + `package_id` + `check_stdraft_state`，把"读-改-写"的并发问题做成显式契约。我们的 `jianying.js` 现在是"剪映运行中就报错"的硬拦，可以升级成同样的版本号校验。
2. **安装/授权/首次使用三段式状态机。** 这份 runbook 是目前见过写得最细的 agent 执行契约：备份-替换-回滚、权限分级、错误分支、fork 交接。
3. **能力按"卡片"暴露。** 参数卡、计费卡、结果卡都是工具，把"需要人确认的决策点"变成可渲染对象，而不是让模型自己猜。自建 agent 里可以用"确认消息 + 继续/取消"模拟。

### 9.5 其余开源生态（无官方支持时的那一套）

### 9.6 开源生态现状

| 项目 | 形态 | 产出 | 备注 |
| --- | --- | --- | --- |
| [VectCutAPI](https://github.com/sun-guannan/VectCutAPI)（原 CapCutAPI） | Python HTTP :9001 + MCP | `dfd_` 前缀草稿文件夹 | Apache-2.0，~2.3k star；云渲染部分未开源 |
| [capcut-mate](https://github.com/Hommy-master/capcut-mate) | FastAPI 服务 | 剪映草稿 | ~1.8k star，Coze / n8n 可接 |
| [capcut-cli](https://github.com/renezander030/capcut-cli) | Node CLI | 原地改 `draft_content.json`，含 Whisper 字幕 | ~480 star，声明与字节无关 |
| [pyCapCut](https://github.com/GuanYixuan/pyCapCut) | Python 库（与 pyJianYingDraft 同源） | 草稿 | **明确不支持自动导出**，模板只吃明文 |
| [cli-anything-capcut](https://github.com/juliang8507/cli-anything-capcut) | Python CLI + Claude Code skill | session → 草稿 | 50+ 命令、全 `--json`，`render-headless` 走 ffmpeg |
| 各类 MCP 包装 | MCP server | 草稿 | 如 `Atx-Guy/capcut-mcp-server`（TS，11 工具） |

### 9.7 开源路线的四条硬伤

1. **导出必须人工。** 开源生态全部停在"草稿"：pyCapCut README 直说"生成后请在 CapCut 中打开草稿，并通过应用手动导出"。cli-anything-capcut 的 `render`（驱壳导出）只认窗口名 `剪映专业版`，CapCut 国际版窗口叫 `CapCut`，匹配必然失败（上游 issue #17，CapCut 9.4.0 复现），只剩 `render-headless`——那是 ffmpeg 合成，**没有 CapCut 的特效/花字/贴纸渲染能力**。剪映这边有 jy-draftc 无头导出、jianying-tool 截图模板导出，都是真渲染。
2. **加密更无解。** 社区实测：剪映 6.0+ 的 `draft_content.json` 是 AES 加密的；**CapCut 同样加密，但没有 jy-draftc 这种对应解密器**。于是"读真实草稿当模板"在 CapCut 上断掉，pyCapCut 明确"模板必须是明文，加密或其他不可读格式暂不支持"。
3. **版本更挑模板。** CapCut 8.4 / 8.7(Win) / 9.3 会拒绝由旧模板生成的草稿，报 `This draft comes from an unconventional path and cannot be used.` 剪映这边用 `version: 360000` 明文骨架至今仍被 11.5 接受（本机 4 个草稿即为证）。
4. **上游状态坏。** pyCapCut 的 PyPI 0.0.3 缺 `TextSegment(shadow=...)`，内置文字样式会直接报错；`setup.py` 读一个没提交的 `pypi_readme.md`，导致 `pip install git+https://...` 抛 `FileNotFoundError`——必须克隆 + 切 commit + 补文件。这种依赖不适合进流水线。

### 9.8 CLI 优先与事件溯源（与 CapCut 无关的两个好设计）

这两点与 CapCut 无关，是它生态里做得好的工程习惯：

1. **CLI 优先于 MCP。** [cli-anything-capcut](https://github.com/juliang8507/cli-anything-capcut) 的理由很实在：MCP 的工具 schema 会永久占用上下文，CLI 只在需要时调用、输出是纯文本。所以它所有命令都带 `--json`，并有 `agent status` 专门返回**"下一步该做什么"**而不是"发生了什么"。我们的工具层应照此设计：一个 `jy agent status` 返回校验结果 + 缺口 + 建议动作。
2. **事件溯源 session。** 它把每次编辑记成 op 序列（`session.json`），可 `import-recipe` / `export-recipe` / `compact` / `find-replace-media`，失败 op 自动隔离后重放。比"直接写草稿 JSON"更容易重试与批量换料。

### 9.9 真要出海用 CapCut 的话

- **优先官方 Codex MCP**：装 `CapCut@CapCut` 插件，让 Codex 直接操作云草稿、自动字幕、模板与素材库。前提是账号区域与出口 IP 匹配，且接受项目在 CapCut 云、导出在应用内。
- 开源兜底：`cli-anything-capcut`（补丁版 pyCapCut）+ `render-headless`，接受"没有剪映级特效"这个前提。
- 需要真实 CapCut 渲染又不用 Codex：只能 `save` 出草稿 → 人工在 CapCut 里点导出，或用 AutoHotkey/图像匹配自己写驱壳（注意用户协议 §6）。
- 最省事的路仍是：素材与文案走本流水线生成，成片用剪映出；CapCut 只作为人工二次剪辑的交付格式。

---

## 10. "开源版剪映"这条路：不存在，但有更好的替代

### 10.1 先纠正前提

**剪映本身不开源**，CapCut 也不开源。市面上被称为"开源版剪映"的是另外一类东西：

| 项目 | 许可 | 现状（2026-11） | 对 agent 友好度 |
| --- | --- | --- | --- |
| [OpenCut](https://github.com/Theorvane/OpenCut) | MIT | **正在从零重写**（Rust core）。路线图明确写着 Editor API、插件架构、**MCP server**、**headless 批渲染**、编辑器内脚本页；classic 版仍在 opencut.app 上跑 | 现在：弱；重写完成后：可能最强 |
| [pireel](https://github.com/pireel/pireel) | AGPL-3.0（编辑器）/ Apache-2.0（连接器） | 编辑器可本地 `pnpm dev` 跑，导出本地；**Agent 连接器官方支持 Codex / Claude Code**，MCP 端点是托管的 `https://pireel.com/api/studio/mcp` | 中高：MCP 真能用，但核心服务在 pireel.com |
| Kdenlive / Shotcut / OpenShot / Olive | GPL | 成熟 NLE，工程文件可脚本化（MLT XML） | 低：无 MCP，无 headless 语义 |

pireel 的 agent 安装方式，和 CapCut 官方那套同构但更开放：

```bash
# Codex
codex plugin marketplace add https://github.com/pireel/pireel-agent
codex plugin add pireel@pireel-marketplace

# Claude Code
claude plugin marketplace add pireel/pireel-agent
claude plugin install pireel@pireel-marketplace

# 只要工具、不要工作流
claude mcp add --transport http pireel https://pireel.com/api/studio/mcp
```

### 10.2 但对本流水线，正确答案是"不要编辑器"

你的片源本来就是程序生成的（分镜图/视频 + TTS + 字幕），要的是**批量、可重跑、可 diff 的合成**，不是"人工剪辑手感"。这类需求最适合**代码即时间线**：

- 无草稿加密、无版本绑定、无账号与区域限制
- 一条命令出片，可进 CI，失败可重试，改一个字段就重渲
- 智能体只需要产出结构化剪辑单，不需要理解任何 GUI

**本机已实测**（见 `tools/ffmpeg-timeline/`）：

```powershell
python tools/ffmpeg-timeline/edit.py tools/ffmpeg-timeline/sample.json
# → output/ffmpeg-timeline/demo.mp4  9.0s / 1.86 MB
```

剪辑单（edit.json）就是智能体的输出契约：

```json
{
  "width": 1280, "height": 720, "fps": 30,
  "clips": [
    { "path": "Creation-Studio/web/skins/real-cafe.mp4", "in": 0.5, "duration": 5 },
    { "path": "Creation-Studio/web/skins/real-reading.mp4", "in": 1.0, "duration": 5 }
  ],
  "transition": { "type": "fade", "duration": 1 },
  "texts": [
    { "text": "开源剪辑 · 代码即时间线", "start": 0.6, "end": 4.6, "size": 58, "color": "white" }
  ],
  "out": "output/ffmpeg-timeline/demo.mp4"
}
```

引擎做的事：每段 `trim/setpts/scale/pad/fps/format` 归一化到同一画布 → `xfade` 链式转场（按累计时长算 offset）→ `drawtext` 烧中文字幕（`textfile` 规避转义，字体拷到临时目录规避 Windows 盘符冒号）→ BGM 可选 `afade + atrim`。9 秒成片，中文描边正常，转场正常。

### 10.3 三条路怎么选

| 需求 | 选 |
| --- | --- |
| 批量出片、无人值守、要进流水线 | **FFmpeg + 剪辑单 JSON**（已可用）；要复杂动效再上 [Remotion](https://www.remotion.dev/)（React 写视频，支持导出 OpenTimelineIO 交给 NLE 精修） |
| 人工精修、要花字/模板/贴纸生态 | **剪映 11.5 + jianying-tool**（已打通，见 §3） |
| 想用开源 GUI 又希望 agent 能驱动 | **pireel**（MCP 现成），或等 **OpenCut** 重写完成 |
| 出海、接受云草稿 | CapCut 官方 Codex MCP（见 §9） |

结论：开源 GUI 剪辑器解决的是"给人用"，代码即时间线解决的才是"给 agent 用"。你这条流水线属于后者。

---

## 11. 没有剪映素材生态，怎么做出好看的片子

这是整条路线上最实的顾虑：剪映真正的护城河不是编辑器，是**几十万套模板、花字、贴纸、转场、曲库**。离开它，观感会不会崩？

### 11.1 把"好看"拆开，逐项对照

| 剪映生态 | 本质是什么 | 开源/免费侧怎么拿 | 可程序化 |
| --- | --- | --- | --- |
| 转场（叠化/推拉/故障/闪白…） | 两段间的像素合成 shader | **FFmpeg `xfade` 内置 40+ 种**（fade/wipe*/slide*/circle*/dissolve/pixelize/radial/smooth*…）；[gl-transitions](https://gl-transitions.com/) 300+ 可自接 | ✅ 完全 |
| 滤镜（清透/复古/胶片/黑白） | LUT + 强度参数 | 免费 LUT 包（`.cube`）→ `lut3d=`；或 `eq` + `curves` + `colorbalance` 组合自调 | ✅ 完全 |
| 花字 / 文字动效 | 预渲染字形 + 逐字动画 | 字体 + `drawtext` 表达式动画；或 ASS `\t`/`\k`；或 Remotion 做真动画 | ✅ 大部分 |
| 贴纸 / 情绪符号 | PNG/GIF 素材 | AI 生图（本项目已有透明背景生图能力）+ 免费贴纸站 | ✅ 大部分 |
| 音乐 / 音效 | 版权曲库 | Pixabay Music、Uppbeat、Free Music Archive、Freesound；或 AI 音乐（Suno/Udio/Stable Audio） | ✅ 靠外部源 |
| 模板 | **审美封装** + 素材引用 | **配方（recipe）**：一套版式写成 JSON / Remotion 组件，参数化复用 | ✅ 关键在这 |
| 自动字幕 | ASR + 样式模板 | faster-whisper（`jianying-tool transcribe` 自带）+ ASS 样式 | ✅ |
| 智能抠像 / 补帧 / 降噪 | 模型 | RVM / BiRefNet / MatAnyone；RIFE；Demucs / DeepFilterNet | ✅ 需 GPU |

结论：**技术能力几乎都有开源对应物，缺的是"审美预置"——几万套模板把"什么好看"提前替你决定好了。**

### 11.2 解法：从"挑模板"改成"建设计系统"

剪映让你每次开一个新片子都得再挑一遍模板；配方让你把审美沉淀下来：

```jsonc
// recipes/短剧竖屏.json —— 一次设计，无限复用
{
  "canvas": { "width": 1080, "height": 1920, "fps": 30, "fit": "cover" },
  "look":  { "contrast": 1.1, "saturation": 1.14, "warmth": 0.045, "sharpen": 0.55 },
  "title": { "font": "msyhbd", "size": 92, "outline": 4, "anim": "fade-up", "y": "h*0.34" },
  "subtitle": { "size": 54, "outline": 3, "y": "h*0.80" },
  "transition": { "type": "smoothleft", "duration": 0.5 },
  "audio": { "volume": 0.55, "fade_in": 1.2, "fade_out": 1.8 }
}
```

同一份配方套不同素材，出来的片子风格一致——这比每次挑模板更可控，也才撑得起批量。

### 11.3 本机实证

`tools/ffmpeg-timeline/edit.py` 现在支持 `fit`（cover/pad）、`grade`（对比/饱和/伽马/暖调/锐化）、`texts[].anim`（fade / fade-up / zoom）：

```powershell
python tools/ffmpeg-timeline/edit.py tools/ffmpeg-timeline/sample2.json
# → output/ffmpeg-timeline/styled.mp4   8.0s / 3.05 MB
#   1080x1920 竖屏 · cover 裁切 · 暖调 · 描边字幕 fade-up · smoothleft 转场 · BGM 淡入淡出
```

![竖屏调色 + 大字幕](output/ffmpeg-timeline/styled-a.png)
![转场后 · 黄色强调字幕](output/ffmpeg-timeline/styled-b.png)

全程一个 JSON、一条命令、无 GUI、无账号。缺的只是"爆款花字"这种纯审美资产——那部分该交给人工，见下。

### 11.4 最优解是分工，不是二选一

```
① 程序化出结构片（80% 的工时）
   画面顺序 / 时长 / 变速 / 画幅 / 字幕 / 转场 / BGM / 基础调色 / 音量包络
   → 无人值守，可批量，改一个字段就重渲

② 人工精修（20% 的审美决策）
   花字、贴纸、卡点特效、热门模板同款
   → 把剪映当"精修台"，只处理程序化做不好的部分

③ 沉淀
   每次精修的选择记回配方参数（字号/位置/颜色/转场类型），下次自动套用
```

必须回剪映的三种情况：要平台热门模板同款（跟风流量）、要剪映独有 AI 能力（智能抠像/扩图/声音成曲）、要用 VIP 曲库。

---

## 12. 剪映 11.5 自带的"控制器"：实测 agent-cli / lyra-cli / videoeditor.dll

上一节讲的是外部工具。这一节是更重要的发现：**剪映自己就把控制器装进了安装目录**，只是每一层都带闸门。本机实测（`D:\notebook\software\JianyingPro\11.5.0.14471`）。

### 12.1 目录里有什么

| 组件 | 体积 | 作用 |
| --- | --- | --- |
| `jianying-agent-cli.exe` | 0.1 MB | **官方草稿补丁协议**：`draft <fetch-feishu-doc\|query-content\|plan-patch\|validate-patch\|apply-patch> --input <json>` |
| `lyra-cli.exe` + `lyra_cli_client.dll` | 11.6 + 8.5 MB | **引擎 CLI**：`draft edit / extract`；blueprint XML 命令列表 → apply pipeline |
| `videoeditor.dll` | 67.7 MB | 渲染/草稿引擎本体，**未加壳**，含 `lyra/generated/draft/*.cpp` 等完整符号族 |
| `VESafeGuard.dll` / `gp.dll` / `gpHackerProc.dll` / `VEFileVerify.exe` + `.dat` / `preSign.dat` | — | 防护层：文件校验、反注入、签名 |
| `agent_runtime_addon.node` / `videoeditor_addon.node` / `bun.exe` | — | Node/Bun 侧 agent 运行时 |
| Qt 6.2.2（Qt6Core/Qml/Quick/QuickControls2…） | — | QML 架构，可注入但受上面防护 |

`draft_patch` 协议（从 exe 字符串还原）：

```jsonc
{
  "draft_patch": {
    "baseRevision": 0,              // 非负整数，乐观锁
    "targetProjectId": "…",         // 必须与 --project-id 一致
    "runId": "…",                   // 必须与 JY_AGENT_RUN_ID 一致
    "lyraDraftRef": "…",            // 或 env JY_AGENT_LYRA_DRAFT_REF
    "operations": [ { "op": "set_timeline_property", "enabled": true, … } ],
    "lyraCommands": [ { "subcommand": "edit|extract", "args": ["…"] } ]  // flag 白名单校验
  }
}
```

### 12.2 三道闸门（实测输出）

```powershell
# 1) validate-patch：能跑，但 input 必须是合法 artifact
> jianying-agent-cli draft validate-patch --input dp.json
{"code":"INVALID_ARGUMENT","message":"input is not a draft_patch artifact", …}

# 2) plan-patch：需要 runtime token
> jianying-agent-cli draft plan-patch --input dp.json
{"code":"PERMISSION_DENIED","message":"JIANYING_AGENT_RUNTIME_TOKEN is required", …}

# 3) apply-patch：需要 project-id，且还要 JY_AGENT_ALLOW_APPLY_PATCH + PC 确认 + lyra-cli
> jianying-agent-cli draft apply-patch --input dp.json
{"code":"INVALID_ARGUMENT","message":"--project-id is required", …}

# 4) lyra-cli 直接调用：宿主校验
> lyra-cli.exe --help
{"err_category":"runtime","err_code":-100015,
 "err_msg":"unauthorized host process","recovery":"upgrade_or_switch_path", …}
```

结论：**这套通道是给剪映内置 AI 助手用的"人在环"链路**，不是开放 API。但它同时暴露了两个可用的东西：

- `lyra-cli` 支持凭据注入：`LYRA_CLI_ACCESS_TOKEN` / `LYRA_CLI_AUTH_TOKEN` / `LYRA_CLI_REFRESH_TOKEN` / `LYRA_CLI_AUTH_COOKIE` / `LYRA_CLI_ACCOUNT_ID` / `LYRA_CLI_INJECT_CREDENTIAL_JSON(_FILE)` / `LYRA_CLI_BLUEPRINT_COMMAND_XML_DIFF`
- `videoeditor.dll` 未加壳、符号完整 —— 可以像 jy-draftc 那样 `GetProcAddress` 直接调

### 12.3 自己写控制器的四条路，按代价排

| 级别 | 做法 | 代价 | 可行性 |
| --- | --- | --- | --- |
| **L0** | 用官方 `draft_patch` 协议产出补丁，交给剪映侧 apply | 低 | 🟡 需 runtime token，仅适合配合内置助手 |
| **L1** | **直接驱动 `videoeditor.dll`**：`GetProcAddress` 拿 `Server::instance/startup/openSession`、`ProjectService::draftInit/draftTransaction`、`restore_draft`、`ExportService`，自起 Lyra 会话 → 提交时间线 → 无头导出 | 中 | ✅ **已验证**：jy-draftc 就是这条路；本机 jianying-tool 读你的加密草稿返回 `codec_used: true` |
| **L2** | Qt 层注入：拿到 `QQuickWindow` → 遍历 QML 对象树 → `QMetaObject::invokeMethod` 操作控件（比截图像素匹配稳） | 高 | 🟡 Qt 6.2.2 具备条件，但要过 `VESafeGuard` / `gp` 反注入 |
| **L3** | 改安装包：patch 会员校验、去水印、解锁时长 | 很高 | 🔴 `VEFileVerify` + 每周 `DiffUpgrade`，补丁失效即打不开 |

写控制器的正解是 **L1**：不碰安装包、不改官方二进制，只作为宿主进程加载官方 DLL，用它的公开导出做"会话-时间线-导出"。jy-draftc 的 README 把用到的入口全列出来了，MIT 许可，可直接当参考实现。

### 12.4 为什么"破解版"解决不了真问题

用户真正的痛点是**没有素材生态**，而破解解决的是**"用 VIP 素材不付钱"**——两件事不相关：

1. **素材在服务端**：音乐、花字、贴纸、特效都要账号授权后按需下载到本地缓存。破解改的是本地行为（去水印、跳会员弹窗、解锁时长），**拿不到云曲库的授权**。
2. **对抗成本高**：`VEFileVerify.dat` + `preSign.dat` + `JianyingPro-DiffUpgrade.exe` + 周更节奏，补丁失效一次剪映就打不开，流水线直接停。
3. **对批量出片收益低**：你的瓶颈是"编排自动化"，不是"水印"。

### 12.5 建议顺序

1. **现在就能用**：`jy-draftc` 当渲染后端（无头导出）+ `tools/ffmpeg-timeline/` 做主结构片（§11）。
2. **要完整控制器**：写一个 host（C++/Rust/Python ctypes 均可）加载 `videoeditor.dll`，复刻 session → draftInit → restoreDraft → ExportService 四步；jy-draftc 源码是现成地图。
3. **不要动安装包**：L3 的收益远小于它带来的不稳定。

---

## 13. 本地还是云端：把四层分清楚

结论：**剪映的控制链 100% 本地。云端只出现在两处：CapCut（国际版）的官方 MCP，以及 VIP 素材的首次下载。**

### 13.1 逐层归属

| 层 | 跑在哪 | 需要联网吗 |
| --- | --- | --- |
| 剪映 GUI `JianyingPro.exe` | 本机进程 | 素材/账号/云同步时才需要 |
| `videoeditor.dll` 渲染引擎 | **本机进程内** | 素材已缓存时不需要 |
| `lyra-cli` / Lyra 会话 | **本机** | 不需要 |
| `jianying-agent-cli draft validate/apply-patch` | **本机进程** | `plan-patch` 要 `JIANYING_AGENT_RUNTIME_TOKEN`（云侧颁发） |
| `jy-draftc` | **本机** | 不需要 |
| `jianying-tool export` | **本机**（截自己屏幕上的窗口） | 不需要 |
| 本项目的调度器 | **本机**（SQLite + subprocess） | 不需要 |
| **CapCut 官方 MCP** `www.capcut.com/api/external_mcp` | **云端服务器** | 全程需要 |

关键区别：**CapCut 的官方 MCP 是云的；剪映自带的控制器是本地进程。**

### 13.2 为什么 `jianying-agent-cli` 会要 token

它的服务对象是剪映内置 AI 助手：云端对话规划 → 下发 `draft_patch` → PC 端确认执行。所以那条通道天然带云端耦合（`JIANYING_AGENT_RUNTIME_TOKEN`、`JY_AGENT_RUN_ID`）。它不适合第三方做纯本地编排。

### 13.3 纯本地、零云端的路线 = L1

`videoeditor.dll` 直调：不读 token、不连账号、不发网络请求。本机实测证据：`jianying-tool` 读加密草稿返回 `format: jianying-native`、`codec_used: true` —— 全程没有任何网络调用，是本进程加载 DLL 现场解出来的。

### 13.4 本机实测：本地任务队列

`tools/jianying-scheduler/`（SQLite 队列 + 可插拔后端）：

```powershell
$ python tools/jianying-scheduler/scheduler.py submit --kind ffmpeg \
    --payload tools/jianying-scheduler/_p1.json --out output/queue/ep01.mp4
25e0d7b5175e
$ python tools/jianying-scheduler/scheduler.py run
[2026-11-09 03:31:40] 25e0d7b5175e ffmpeg (attempt 1/3)
    ✔ done in 1.6s → …\output/queue/ep01.mp4
[2026-11-09 03:31:42] 3cd172311e8c ffmpeg (attempt 1/3)
    ✔ done in 4.9s → …\output/queue/ep01-vertical.mp4
本次完成 2 个，失败 0 个
```

状态表 `jobs.db`（16 KB，`queued → running → done`，带 attempts/max_attempts/error/output 字段），产物 `ep01.mp4` 1.86 MB、`ep01-vertical.mp4` 3.05 MB。全程本地进程，没有一次网络出口。

三个后端：

| 后端 | 渲染方式 | 并发 | 前置条件 |
| --- | --- | --- | --- |
| `ffmpeg` | 本地转码 | 可并发 | 无（已跑通） |
| `jianying-tool` | 驱动剪映导出对话框 | **必须 1** | 剪映在跑、缩放 100%、模板版本匹配 |
| `jy-draftc` | 直调 `videoeditor.dll` 无头导出 | **必须 1** | 放对版本的 exe 到 `tools/jianying-scheduler/bin/` |

### 13.5 唯一的云依赖

1. **VIP 素材/花字/贴纸/特效首次使用要联网缓存**到本地（之后离线可用）。所以调度器应在正式渲染前跑一次"预热"：打开草稿让剪映把资源拉齐，否则渲染时会出现"xx 加载失败"。
2. 账号登录态（cookie）用于素材授权。
3. 云同步/云备份可以关掉，不影响本地渲染。

除此之外，控制、编排、渲染、导出全部在本机完成。**这和你手点剪映没有区别——区别只是谁在点。**

---

## 14. 参考

- CapCut 官方 Codex MCP 端点 — `https://www.capcut.com/api/external_mcp`（36 工具，需 OAuth）
- CapCut × Codex 官方页 — https://www.capcut.com/zh-tw/tools/capcut-x-codex
- 官方安装 runbook — https://sf16-sg.tiktokcdn.com/obj/eden-sg/962370eh7nupenuhbo/capcut_codex_plugin/SKILL.md
- CapCut World LA 发布稿 — https://www.capcut.com/newsroom/capcut-world-la
- pyJianYingDraft — https://github.com/GuanYixuan/pyJianYingDraft ｜ https://pypi.org/project/pyjianyingdraft/
- jianying-tool（CLI + MCP，11.x 基线）— https://pypi.org/project/jianying-tool/
- jy-draftc（草稿加解密 / 升降级 / 无头导出）— https://github.com/wanfke/jy-draftc
- jianying-ai-mcp（MCP + Skill）— https://github.com/Xanthus-Sanslab/jianying-ai-mcp
- 剪映小助手 capcut-mate（HTTP API）— https://developer.aliyun.com/article/1731723
- VectCutAPI — https://github.com/sun-guannan/VectCutAPI
- OpenCut（开源 CapCut 替代，重写中）— https://github.com/Theorvane/OpenCut
- pireel（开源编辑器 + agent MCP）— https://github.com/pireel/pireel ｜ https://github.com/pireel/pireel-agent
- Remotion（React 写视频，可导出 OTIO）— https://www.remotion.dev/
- gl-transitions（300+ 转场 shader）— https://gl-transitions.com/
- 免费音源 — https://pixabay.com/music/ ｜ https://uppbeat.io/ ｜ https://freesound.org/
- 本机实现 — `tools/ffmpeg-timeline/edit.py`、`sample.json`、`sample2.json`（竖屏调色版）
- 剪映自带（本机 11.5.0.14471 实测）— `jianying-agent-cli.exe`、`lyra-cli.exe`、`videoeditor.dll`、`VESafeGuard.dll`
