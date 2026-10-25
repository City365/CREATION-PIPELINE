# H3 Studio · 源码重建版

把打包的 **ZEALMAN-H3 桌面版**（Tauri + WebView2 + 混淆 JS）按源码方式重建：Node 本地服务 + 网页界面，没有 Electron/WebView2 壳，改一行样式就能看到，方便长期修改和优化。

核心流程与原版一致：

```
参考图 / 音频 + 六段式提示词
        │
        ├─ 官网 API（AutoDL）   POST /api/v1/comfyui/comfyui_workflow/{id} → 轮询 result → 下载
        └─ 自定义视频渠道       POST 你填的接口 → 轮询你填的字段 → 下载
        ↓
   媒体库/日期/job-xxx/01-video.mp4 + params.json + prompt.txt
```

## 快速开始

要求：Node.js ≥ 22（本机 25.9 已验证）。

```bat
start.cmd
```

或：

```bash
node src/server.js
```

然后打开 <http://127.0.0.1:17821>。端口可用环境变量 `H3_PORT` 改。

剧本创作台需要一个智能体后端（端口 17820），开两个窗口：

```bat
start-agent.cmd   :: 先起智能体后端 17820（共用 ml-engineer 的 Python venv）
start.cmd         :: 再起 Web 17821
```

`start-agent.cmd` 里可以改 `AGENT_PYTHON`（Python 解释器）和 `AGENT_PORT`；模型与 Key 在 `agent_backend/data/agent_settings.json`。

Git Bash 也可单独启动智能体：`bash agent_backend/start.sh`，默认端口 17820。脚本从 `agent_backend` 加载本项目的 `app.main`。

Node 与智能体之间使用自动生成的 `data/internal-token.json` 作为内部调用凭据，不再接受固定的 `X-H3-Internal: 1`。先启动 Node 后，智能体会自动读取同一文件；更换 Node 数据目录时，两端应使用相同的 `H3_DATA_DIR`。也可为两端设置相同的 `H3_INTERNAL_TOKEN`。凭据不会返回给网页，不应提交到仓库。

要用豆包 / Gemini 出视频，还要把管理器服务启起来（不弹它自己的窗口）：

```bat
cd /d D:\notebook\software\管理器7.8.7\rebuild
node src/server.js
```

H3 的「设置 → 视频生成」里已有渠道「本机管理器 · 豆包/Gemini」，默认连 `127.0.0.1:17778`，凭据取自该项目的 `data/connection.json`。

首次启动会自动从原版读取 `%APPDATA%\com.zealman.h3desktop\config.json`，导入已有的 **AutoDL Key**，并把原语言模型配置留成一条「停用」渠道：补上可用的地址/Key/模型后点「设为当前」即可。所有设置也可在界面右上角 ⚙ 里改。

## 已实现

- **视频创作台**：9 张参考图、3 段音频（**内置音色 / 本地音频**两个入口）、参考图命名主体、`<Picture N>` / `<Subject N>` / `<Audio N>` 标签插入、六段式骨架、示例、字数统计、实时校验提示。
  - 左上只选**渠道**（官网 API / 自定义渠道 / 外接管理器），底部参数条第一位选**视频模型**：官网 API 出 6 条 H3 工作流，管理器渠道出「豆包 / Gemini」，自定义渠道出它自己的模型；切模型会带出对应画幅与时长（Gemini 固定 10 秒）。
  - **外接管理器（豆包 / Gemini）**：调用 `管理器7.8.7/rebuild` 的本地服务（默认 `127.0.0.1:17778`，Bearer 用 `rebuild/data/connection.json` 的 apiToken），用真实 Chrome 账号跑豆包或 Gemini 网页生成；一个管理器渠道派生豆包 / Gemini 两个视频模型、按平台各占一个工位，成片下载后统一进媒体库。
- **内置音色**：音频槽点「内置音色」→ 两个页签：
  - **音色库**：直接接你盘里的 `800+音色` 目录（默认 `D:\notebook\AIGC\Comic-drama\资产文档\800+音色`，可在设置里改）。扫出 918 条克隆参考音色，按「音色名 / 分组 / 样本台词 / 时长」列出，可搜索（音色名、台词关键词）、按分组过滤、**逐条试听原声**；点「使用」把样本复制进 `data/uploads/voice/` 并放进音频槽，提示词里 `<Audio N>` 就能引用这个音色。
  - **系统音色**：用 Windows 自带 SAPI 语音包离线合成 WAV（填台词 → 选发音人/语速 → 生成），和音色库互不影响。
- **图像创作台**：三个页签——图像生成、图像编辑（参考图 + 指令）、图像反推（图 → 英文提示词）；支持多个图像渠道（OpenAI Images、Gemini 生图、Chat Completions 生图），结果落盘到 `媒体库/images/日期/`，可一键存进素材库或拿去当视频参考图。
- **图像画布工具**：`文件` 菜单（打开 / 粘贴剪贴板 / 存素材库 / 清空）、`撤销 / 重做`、`全选 / 取消选区 / 裁剪 / 尺寸`、`缩放 − % + / 适应 / 1:1`；在画布上拖拽框选，`裁剪` 会把选区切成新图（存进媒体库 images 目录）并进历史，`尺寸` 可改宽高，`Ctrl+Z / Ctrl+Y / Ctrl+A / Esc` 有快捷键。
- **对比页**：左右 A/B 各放一段成片或图片（`媒体库` 选 / `本地文件` 选），`对比模式 / 叠加对比`（叠加时带不透明度滑块）、`交换 A/B`、`清空`、`导出并排合成`（把当前两帧拼成一张 PNG 存进素材库）；播放、逐帧、进度条、循环、倍速同步，空格 / ← → 有快捷键。
- **创作台（智能体，ask 页复刻）**：不是"只写剧本"的工具，而是一条创作链路：**小说创作 → 小说转剧本 → 剧本转分镜 → 分镜转视频提示词 → 提示词生成视频**。前四步在这里对话完成，最后一步「送到创作台」把提示词写进视频创作台；每步产出都可以点「下一步：转成剧本 / 拆成分镜 / 生成视频提示词」接着往下走，附带上一步的交付文件。页面按 ml-engineer 的 `frontend/src/pages/strategy` 源码搬过来：
  - 左：品牌区 + 工作区切换（控制台 / 知识库 / 插件管理）+ 新建对话 + 搜索 + 置顶 / 最近分组 + 「⋯」置顶 / 重命名 / 删除 / 撤销；五个创作阶段：小说创作 / 小说转剧本 / 剧本转分镜 / 分镜转提示词 / 提示词审核；
  - 中：对话头部（导出 / 工具与技能开关）、欢迎页 4 张 H3 技能卡、执行轨迹（计划步骤、每步产出、依据材料、用时）、资源上下文、Markdown 正文、附件与交付文件卡片、回复操作（继续任务 / 复制 / 粘贴 / 点赞 / 有问题 / 重生成 / token 用量）、生成中条与停止；
  - 输入：项目 / 技能 / 附件 chips、`/` 命令（换模型、换思考强度、压缩上下文）、`@` 视角选择、模型与思考强度下拉、附件上传（10MB×5，索引状态）、字数、Enter 发送；
  - 右：分析工作区 / 运行轨迹两个 tab、本轮项目资源、工具与技能（内置工具 + 待接入工具详情）、技能试例；运行轨迹读 `/agent/sessions/{id}/trajectory`；
  - 知识库 / 插件管理：列表 + 新建 / 编辑 / 删除（`/agent/knowledge`、`/agent/plugins`）；
  - 文件预览：附件 / 交付文件卡片 → `/agent/workspace/files/{id}/preview`，图片直显、文本可滚动、可下载；
  - 会话：首条消息生成标题、localStorage 记住当前会话、防抖保存（生成中不写避免 409）、停止时 abort + cancel、断流后用 `/agent/runs/{id}/events` 恢复、导出对话为 Markdown。
  - 指导文档按阶段放在 `agent_backend/app/creation_guidance.py`，可用 `agent_backend/data/guidance.json` 覆盖（键：scope / novel / script / storyboard / prompt / review；示例见 `guidance.example.json`），后续补提示词不用改代码。
  - 走独立智能体后端（FastAPI + LangChain，端口 **17820**，源码在 `agent_backend/`），H3 服务用 `/api/agent/*` 透传（SSE 不缓冲）；模型配置在 `agent_backend/data/agent_settings.json`（默认 DeepSeek，protocol=`anthropic`）。
- **素材库**：文件夹（角色/场景/道具…）、搜索、命名主体、重命名、移动、上传；创作台直接取用。
- **媒体库**：按日期/job 扫描成片和图像生成结果，视频用**系统默认播放器**打开；支持 HTTP Range 播放。
- **任务日志**：每条任务写入 `data/logs/<job>.log`，界面可查看。
- **外观**：默认白昼动漫界面，提供「静态图片 / 动态壁纸 / 我的收藏」分类。内置晴空海岸、春日花房两张原创插画及花瓣、光尘场景动画；保留原版亮色和薄荷奶绿，已移除旧暗色皮肤。

## 界面（用原版设计系统，不是仿制）

- `web/h3.css` 是从**原版运行中的 WebView2 里直接取出的** `index-DTSkrVN7.css`（185 KB，原封不动），包含 `h3-*`（外壳 / 表单 / 按钮 / 槽位 / 提示词芯片）、`zs-*`（图像创作台参数面板）、`zd-*`（图像画布工具条）三套类名和全部 CSS 变量。
- `web/index.html`、`web/app.js` 的结构按原版真实 DOM 复刻：顶栏 `h3-topbar`（品牌块 + 页签 + 队列/设置/版本）、状态栏 `h3-statusbar`、左侧 `h3-panel`、分隔条 `h3-splitter`、右侧 `h3-stage`。
- `web/styles.css` 只做两件事：把本项目还在用的通用类（`.btn` / `.input` / `.card` / `table` …）映射到同一套 token；补原版没有的局部（舞台播放器、最近任务、图像查看器）。
- 想改配色只动 `:root` 里的 `--h3-*` 变量即可，不用碰结构。

### 两个创作台的布局

- **视频创作台**：`渠道下拉（官网 API / 自定义渠道，标默认）+ 模型下拉（H3 工作流）+ 渠道类型标签 + Key 状态` 一行（原来的「工作流」行已去掉）；`图像参考 4/9 · 音频参考 0/3` + 9 图槽 + 3 音频槽同一行（有图的槽自动加宽、`S1` 主体色标）；提示词区 `字数 / 标签·代码 / Skill 优化 / 插入骨架 / 示例 / 复制 / 清空`，标签视图把 `<Picture N>` `<Subject N>` `<Audio N>` `<d>` `[Shot N]` 渲染成带缩略图的芯片（点一下进编辑）；底部 `分辨率 · 时长 · 数量 · 种子 + 生成视频`；右侧「舞台」显示成片/进度 + 最近任务。
- **图像创作台**：`图像编辑 / 图像生成 / 图像反推` 页签；左侧 440px 参数面板（生图模型 + 渠道状态、提示词带字数与「优化提示词」、比例/分辨率、底部生成按钮）；右侧 `zd-*` 工具栏 + 结果标签页 + 棋盘格画布 + 状态栏；左右分隔条可拖动。
- **素材库 / 媒体库**：顶部搜索与操作，下面卡片网格；媒体库按视频/图像分页。
- **任务 / 批量 / 日志**：表格 + 状态筛选，保持紧凑。

## 渠道体系

「设置 → 渠道管理」里三类渠道各自独立：

| 类别 | 类型 | 用途 |
| --- | --- | --- |
| 语言 | OpenAI Chat / OpenAI Responses / Gemini generateContent | Skill 优化、提示词改写 |
| 图像 | OpenAI Images（含 `/images/edits` 参考图）/ Gemini 生图 / Chat Completions 生图 | 图像创作台 |
| 视频 | OpenAI 视频（Sora 兼容）/ 自定义任务式接口 | 视频创作台工作流列表 |

- **每个类别可以有多个渠道**，只有一个是「当前」；语言和图像功能默认用当前渠道。
- **视频创作台**右上角有「＋ 新增渠道」，图像创作台有「新增渠道 / 管理渠道」，语言渠道在「设置 → 渠道管理」。
- **OpenAI Images** 的渠道支持「附加参数（JSON）」，会原样合并进 `/images/generations` 请求体（参考图走 `/images/edits` 时作为普通表单字段），用于 `background`、`moderation` 等非通用字段。
- **自定义视频渠道**保存后会自动出现在创作台的工作流下拉里（显示为 `[自定义] 渠道名`），每个渠道一个工位，和 `[官网API]` 并行排队。
- **通用任务式接口**用字段路径适配异步 API：提交路径、请求体模板（`{prompt}` `{model}` `{duration}` `{size}` `{seed}` `{image0}` 占位）、任务 ID 字段、状态字段、结果 URL 字段，例如：
  - 提交：`POST /v1/tasks`，body `{"model":"{model}","prompt":"{prompt}","image":"{image0}"}`
  - 查询：`GET /v1/tasks/{id}`，状态 `data.status`（`SUCCEEDED` 等），结果 `data.result.video_url`
- **测试**按钮：语言渠道发一条短对话；图像渠道会真实生成一张小图（会计费）；视频渠道检查接口可达与鉴权。

## 目录

```
src/
  server.js       HTTP 服务、路由、静态资源、SSE
  config.js       设置读写、原版配置导入、渠道数据
  channels.js     语言/图像/视频渠道的增删改查与类型定义
  jobs.js         队列/工位/执行/下载/落盘（含自定义视频渠道）
  providers.js    AutoDL、LLM 适配器
  imagegen.js     OpenAI Images / Gemini / Chat 生图
  generic-video.js OpenAI 视频兼容 + 通用任务式轮询
  tts.js          内置音色（Windows System.Speech 离线合成 WAV）
  voices.js       音色库扫描/索引/试听/复制（800+ 克隆参考音色）
  workflows.js    工作流清单与参数校验（src/workflows.json + 合成渠道）
  batch.js        批量 JSON 解析与入队
  prompts.js      六段式解析/校验/优化消息组装
  library.js      素材库、媒体库、系统打开
web/              原生 HTML/CSS/JS，无构建步骤
prompts/          原版内置的系统提示词与附加规则（可改）
data/             config.json、jobs.json、uploads、media、assets、logs
tests/            node:test + 本地 mock 服务
```

## 协议（便于改适配器）

### 云机器（Zealman 面板）

已按需求移除：不保留 `cloudHosts`、云机器工作流和排队工位，工作流列表只剩 `[官网API]` 与 `[自定义]`。以后需要时再按原协议加回一个「云端渠道」类型即可（原端点：`/api/workflow/generate`、`/api/comfy/*`）。

### 官网 API（AutoDL）

- 提交：`POST https://autodl.art/api/v1/comfyui/comfyui_workflow/{workflow_id}`，`Authorization: Bearer <token>`，JSON：
  `{prompt, resolution, duration, seed, ref_image_0: "data:image/png;base64,…", ref_audio_0: "data:audio/mpeg;base64,…"}`
- 轮询：`GET .../result/{task_id}` → `data.status` 为 `QUEUED/RUNNING/SUCCESS/FAILED`，成功时从 `data` 里找 `video_url/result_url/…`
- 验 Key：`GET .../result/h3-key-check`（401/403 视为无效）

### 渠道与图像

- 渠道 CRUD：`GET /api/channels`、`POST /api/channels`、`PATCH/PUT /api/channels/{id}`、`DELETE /api/channels/{id}?kind=`
- 切换当前：`POST /api/channels/{id}/activate`，测试：`POST /api/channels/{id}/test`
- 图像生成：`POST /api/images/generate` `{channelId?, prompt, size, quality, count, refs:[{path}]}` → 返回落盘后的图片列表
- 图像落盘（裁剪/改尺寸/粘贴用）：`POST /api/images/save` `{data: dataURL}` → 存进 `媒体库/images/日期/` 并返回条目
- 图像反推：`POST /api/images/reverse` `{path}` → 用当前语言渠道（需支持图片输入）返回英文提示词
- 提示词优化：`POST /api/images/prompt` `{prompt}` → 返回扩写后的出图提示词
- 音色列表：`GET /api/voices` → 系统 SAPI 语音包；合成：`POST /api/tts` `{text, voice, rate}` → WAV 落盘条目（含秒数）
- 音色库：`GET /api/voice-library[?refresh=1]` → `{root,total,groups,items}`；试听 `GET /api/voice-library/audio?id=`；选中 `POST /api/voice-library/pick {id}` → 复制进 `uploads/voice/` 并返回音频槽条目
- 存进素材库：`POST /api/assets/from-file` `{path}`
- 类型定义（表单字段）由 `src/channels.js` 的 `TYPES` 提供，前端按字段声明渲染，新增厂商只需加一个类型 + 一个分支。

## 测试

```bash
npm test
```

23 条：六段解析/校验、批量 JSON、渠道 CRUD/脱敏/切换、官网 API 全流程（mock）、Skill 优化（mock 模型）、图像生成/参考图编辑（mock `/images/edits`）、图像反推与提示词优化（mock 视觉模型）、自定义视频两种模式（mock `/videos` 与 `/tasks`）、内置音色（真跑一次 System.Speech 合成 WAV）、音色库（临时目录造两条 WAV，验证扫描/分组/时长/试听/复制）、剧本创作台（mock 文本渠道：建会话 → 对话 → 自动标题 → 改名 → 清空 → 删除）、渠道模型列表与 token 限制、外接管理器（mock 管理器：豆包任务带参考图跑通、Gemini 不带时长/清晰度/模型）。

## 与原版的差异

- **对比页**：已补，A/B 双联 + 叠加 + 同步播放 + 导出并排合成（原版还有「帧标签」这种给关键帧打标的细活，没做）。
- **图像画布**：已补选区 / 裁剪 / 改尺寸 / 撤销重做 / 缩放 / 文件菜单；**蒙版绘制**（画笔/橡皮）还没做，`图像编辑` 走的是参考图重绘，不是局部回贴。
- **内置音色**：已补。两条路——**音色库**（你盘里 918 条克隆参考音色，选中即进音频槽当 `<Audio N>` 音色参考）和**系统音色**（Windows SAPI 离线合成，只有系统装的那几个发音人）。原版是通过远程工作流做「内置音色」合成，那台服务我们没有；如果你有可零样本克隆的 TTS（GPT-SoVITS / CosyVoice / MiniMax 声音克隆），我可以加一个 `tts` 渠道类型，把音色库的参考音频 + 样本台词直接喂过去合成。
- **版本自更新**：没做；`视频教学` 按钮打开的是可配置链接（默认 B 站搜索），`QQ群` 浮层用的是原版那 6 个群号，可复制。

另外：

- **云机器已移除**：按你的要求去掉了 `cloudHosts`、8 条云机器工作流、云机器排队工位和设置页签；以后要接云端，按「云端渠道」再加一个类型即可。
- 语言模型渠道需自己填 Base URL / Key / 模型；AutoDL 的 `chat/completions` 是否可用取决于令牌分组（实测本机令牌返回「模型不存在」）。本机若有 OpenAI 兼容代理（例如原版里配置的 `http://127.0.0.1:7012/v1`），在渠道管理里指向它即可。

## 数据与隐私

- 设置（含 Key/Token）保存在 `data/config.json`，**不要**把这个文件提交或分享。
- 参考图、音频、成片都在本机目录；默认 `data/media`、`data/assets`，可在设置里换成你自己的盘。
- 生成请求发往你填写的渠道 / autodl.art，不经第三方中转。

## 二次开发

- 换提示词规则：改 `prompts/h3-system.txt`、`prompts/h3-extra.txt`（界面里 Skill 优化立即生效）。
- 加工作流：在 `src/workflows.json` 追加一条，字段照现有条目写（provider、images、audios、durationKey、sizeMode…）。
- 换模型/加厂商：`src/providers.js` 的 `submitAutodl` / `chat`，或 `src/generic-video.js` 的两种视频模式、`src/imagegen.js` 的三种图像协议。
- 改界面：`web/` 下 `index.html`（外壳）、`app.js`（所有页面渲染）、`styles.css`（本项目自己的样式），刷新即生效；`h3.css` 是原版产物，只读不改。



## 创作链路与技能

创作台不是"只写剧本"的工具，而是一条链路：

```
小说创作 → 小说转剧本 → 剧本转分镜 → 分镜转视频提示词 → 提示词生成视频
```

前四步在「剧本创作台」里对话完成，每步产出都可以点「下一步」接着走（附带上一步的交付文件）；
最后一步「送到创作台」把提示词写进视频创作台，用 H3 官网 API 或管理器里的豆包 / Gemini 出片。

**后端是通用智能体，不需要为每个阶段写业务逻辑。** 扩展方式是「技能」：

1. 左侧「插件管理」→「新建插件」→ 类型选 `skill`，填名称、描述和 instructions（技能要求）；
2. 保存后立刻出现在对话输入框的 `@` 列表和右侧「技能」页，头像前带 ★；
3. 选中后发消息，前端会带 `skill_id`，后端提示模型先用 `read_analysis_guidance` 读取该技能，再按技能里的步骤/格式执行；
4. 技能内容随时改，下一轮生效；不用改代码、不用重启。

内置的五个阶段（小说 / 转剧本 / 分镜 / 提示词 / 审核）只是快捷起点，指导文档在
`agent_backend/app/creation_guidance.py`，可用 `agent_backend/data/guidance.json` 覆盖
（键：scope / novel / script / storyboard / prompt / review，示例见 `guidance.example.json`）。

## 启动与守护

```bat
start-all.cmd    :: 管理器 17778（可选）→ 智能体 17820 → H3 17821，带健康检查和自动重启
start-app.cmd    :: 同上，再用 Chrome 应用窗口打开
```

- 端口已被健康服务占用时直接复用；
- 子进程退出会自动重启（5 分钟内最多 5 次）；
- 底部状态栏两个圆点分别是智能体 / 管理器，悬停看模型和账号数；
- 单独启动：`start.cmd`（只起 H3）、`start-agent.cmd`（只起智能体）。

## AI 视频创作专家（智能体定位）

创作台的智能体身份是固定的：**AI 视频创作专家**。它不该变成通用聊天、写代码或数据分析助手；
遇到无关话题会一句话拉回"怎么把这件事做成视频"。

它具备真实的创作工具（不是演示）：

| 工具 | 说明 |
| --- | --- |
| `list_creation_models` | 列出可用视频模型 / 图像渠道（含时长、画幅） |
| `generate_image` | 调图像模型出图，可作参考图或视频首帧 |
| `submit_video_job` | 把提示词提交到视频工作台（可带参考图、指定模型/时长/画幅） |
| `check_video_job` | 查任务进度、阶段、错误、成片 |
| `wait_video_job` | 等待成片（默认 10 分钟，最多 30 分钟） |
| `probe_video` | 读时长、分辨率、帧率、编码、有无音频 |
| `extract_frames` | 从成片抽帧（最多 12 张），做画面检查或首尾帧 |

工具实现在 `agent_backend/app/create_tools.py`，通过本机 H3 接口执行；H3 地址默认
`http://127.0.0.1:17821`，可用 `H3_BASE_URL` 覆盖。出片会真实消耗视频额度，出图会真实计费。

规划执行仍由智能体的 `create_task_plan → record_step_result` 完成：例如"写一句提示词 → 提交视频 →
等成片 → 抽帧检查 → 交付"。更细的创作规则（剧本/分镜/提示词）建议做成技能，随时改、随时生效。

## A9 技能（已导入）

已把 A9 全流程里的三个固定技能导入智能体（插件管理里可见、`@` 可选）：

| 技能 | 内容 | 大小 |
| --- | --- | --- |
| 小说拆集 | `01_小说拆集`：SKILL.md + references/prompt.txt | 2.9k 字符 |
| 分集转剧本 | `02_分集转剧本`：SKILL.md + references/prompt.txt | 3.6k 字符 |
| 剧本转分镜 | `04_剧本转分镜`：SKILL.md + 补充导演提示词 + CINEMA-SHOT v18.4 15S 预设 | 18.8k 字符 |

- 导入脚本：`node agent_backend/import_skills.js [技能目录] [--dry]`，同名会原地更新，可重复跑；
- 适配：技能开头写明本机没有 `split.mjs` / `check.mjs`，校验清单当自检，不声称执行脚本；
- 04 内置 15S 预设全文，10S / 12S / 30S 与它结构相同、只改时长参数；用户指定其它时长时按同样结构替换；
- 若以后要加 03 资产提取 / 05 分镜转视频提示词，把目录放进同一个 skills 根目录再跑一次导入脚本即可（脚本只导 01/02/04，改 `DEFS` 增加一行）；
- 模型输出上限已调到 **24000**（`agent_backend/data/agent_settings.json`），单轮预算同步提到 24000 输出 / 200000 总量（`app/harness/budget.py`）；否则复杂技能会因推理吃满 4096/8192 而报「任务执行未完成」。

## 上下文窗口（按模型）

`agent_backend/app/harness/windows.py` 定义每个模型的上下文预算：

| 模型 | 上下文 |
| --- | --- |
| 默认 | 500k |
| gpt-5 | 20k |
| gemini | 1024k |
| deepseek | 1024k |

- 历史裁剪按这个预算做（UTF-8 字节 × 2 保守估算），不再固定只留 40 条；
- `/agent/models` 返回 `context_tokens`，前端模型下拉显示「· 1024k」；
- 这只是本地预算，不等于厂商 API 的真实上限。DeepSeek 常见窗口是 128k，若上游报超长，把 `windows.py` 里的数字调小（或设 `HARNESS_CONTEXT_INPUT_BUDGET` 覆盖字节预算）。

> 注：GPT-5 按 20k 写入；如果原意是 200k，把 `MODEL_CONTEXT_TOKENS['gpt-5']` 改成 200000 即可。

## 账号与项目

- **首次使用**打开页面是「创建账号」（用户名 + 密码），之后是登录页；本机单账号，密码 scrypt 加盐存在 `data/users.json`，会话 30 天（HttpOnly cookie）。忘记密码：停服务删掉 `data/users.json` 重新创建。
- **项目**：顶栏 📁 进入项目页；每个项目绑定一套风格，新建时从风格库里选（8 套，带预览图）。生成图片/视频时自动把风格前置拼到提示词，智能体也会收到「项目 + 风格前置」。
- 风格来自 `风格前置提示词.xlsx`，已导入 `data/styles.json`（角色 / 场景 / 道具 / 视频四段 + `data/styles/images/` 预览图）；改风格直接改 JSON 或重新导入。

## 图片保存

图像生成结果本来就会落到媒体库；现在额外提供显式保存：

- 工具栏「保存」/「全部保存」，文件菜单「保存图片… / 保存全部… / 下载到浏览器」；
- 弹窗里选目标：素材库、媒体库 `images/日期`、浏览器下载、自定义绝对目录；重名自动加序号；
- 接口 `POST /api/images/save-copy`（支持批量）。

### 风格预览图

风格选择里的图片是用图像模型生成的 16:9 概念图（`data/styles/images/preview-*.png`），不是 xlsx 里的排版截图。

重新生成：

```bat
set H3_BASE=http://127.0.0.1:17821
set H3_USER=你的用户名
set H3_PASS=你的密码
node scripts\gen-style-previews.cjs            :: 只补没生成的
node scripts\gen-style-previews.cjs --force    :: 全部重生成
```
### 探索模式

新建项目可以选择「🧭 探索模式」：不绑定风格、不注入任何前置提示词，完全按输入自由生成；项目卡和状态栏会显示探索模式。想换回固定风格，编辑项目重选即可。
### 白昼动漫壁纸库

设置 → 外观分为静态图片、动态壁纸和我的收藏。可多选导入 JPG、PNG、WebP、GIF、MP4、WebM；动态 WebP / APNG 自动识别。图片和 GIF 最大 10MB，视频最大 600MB。视频默认静音循环，可在声音设置中开启原声；背景音乐提供内置轻琴配乐，支持导入 60MB 以内的 MP3 / WAV / M4A / OGG / FLAC，独立音量和循环播放。GIF / 场景动画 / 视频都可暂停；可按静态、动态或全部自动轮换。收藏仅存本机，移出收藏不会删除本机原文件。白昼界面取消磨砂模糊，AI 回复保持无框。
### 生成记录留存

- 图像：每次生成/编辑都会记到 `data/image-history.json`（最多 80 批），刷新或切换页面后自动恢复最近一批；文件菜单「最近生成…」可以翻回之前批次。
- 视频：最近一次任务记在 localStorage，刷新后舞台继续显示；任务列表本身在 `data/jobs.json`，不会丢。

### 真人风格背景与独立区域背景

新增海边午后、晴日阅读两组 AI 生成人像照片，每组含静态图片和 6 秒、1280×720、24fps 的静音循环动态照片（轻微镜头移动）。导入图片、GIF 或视频时可填写新主题名称，保存到本机收藏。

外观设置的中间对话区柔和度、左侧记录栏柔和度、右侧文件预览背景透明度、右侧工作区背景透明度分别保存，互不联动。透明度只影响面板背景，不改变文字、图片或文档内容的不透明度。

## 新目录（CREATION-PIPELINE）

统一根目录：`D:\notebook\AIGC\CREATION-PIPELINE`

- `Creation-Studio`：H3 Studio 重建项目（原 `D:\notebook\software\H3-Studio`）
- `Video-Generation-Manager`：视频管理器（原 `D:\notebook\software\管理器7.8.7\rebuild`）

## 顶栏服务控制

顶栏「智能体」「管理器」现在是按钮：

- 灰色圆点 = 未启动，点一下启动对应服务；
- 绿色圆点 = 在线，点一下停止；
- 按钮右侧小字显示「启动 / 停止 / 启动中 / 停止中」；
- 启动由 `POST /api/services/control` 完成，PID 记录在 `data/service-pids.json`，停止用 `taskkill /T /F`。

启动顺序：先启动 Creation-Studio（`node src/server.js` 或 `start-all.cmd`），再点顶栏两个按钮即可，不用再单独开终端。


### 智能体执行控制

创作台项目 h3-studio 默认使用 harness/2.0，健康接口返回 harness_runtime 与 engine_version。其他项目须通过 HARNESS_PROJECT_ALLOWLIST 配置；临时回退可设置 HARNESS_RUNTIME_ENABLED=false，但旧路径不支持持久运行取消与事件恢复。

每轮执行有 180 秒总时限，模型和工具调用计入统一预算；harness 内不再叠加模型重试。停止按钮提交取消请求后等待后端终态回执，取消失败会显示提示。断流恢复按事件序号分页读取，每页最多 100 条，并去重；未取得结束回执时会明确显示中断。

启动器对自动补启和退出重启统一限流，五分钟内最多五次；达到上限后需检查日志并重新启动启动器。本启动器持有的进程连续三次健康检查失败后会停止并按限流规则恢复；外部进程不会被自动终止。

## 视频创作台数据持久化（SQLite）

- 服务端新增 `src/studio-store.js`：`data/studio.db` 的 `studio_state(project, data, updated)` 表，按项目存整份创作台状态（提示词、参考图/音频路径、画幅、时长、模型等）。
- API：`GET /api/studio/state?projectId=`、`POST /api/studio/state`（登录态内）。
- 前端：编辑时 300ms debounce 写服务端，同时写 `localStorage.h3.studio.<projectId>` 作为离线缓存；刷新前用 `sendBeacon` 兜底提交；加载时比较服务端与本地 `updated`，取较新的一份。
- 切项目会先 flush 当前项目，再读取目标项目状态；目标项目没有记录才清空。
