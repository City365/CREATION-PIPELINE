# Concat 智能剪辑验证项目

立项日期：2026-11-09。状态：首轮基础技术验证通过。源码 CLI、GUI 均已构建，GUI 启动冒烟检查和源码版 MCP 小样闭环通过；人工精调与实时共同编辑尚未验证。

## 目标和范围

验证 Concat 能否作为 Creation Studio 智能剪辑底座，实现 AI 操作、人工作业和真实视频导出。先验证，再决定界面整合方式。现有业务页面和其他在途修改保持原样；本轮新增验证脚本、工程、样片和记录，并修正 Concat 的效果包目录名。

首期不重写网页时间线，不嵌入原生窗口，不以模拟界面或工具调用成功代替成片验收。后续源码运行检查发现上游效果包目录不一致，已作可追溯的目录名修正，详见下文；现有业务代码未修改。

## 版本基线

- 本地源码：0.2.10，Git 提交 `9fcd218ba75d0f4856cc2daf36eeae906a08818d`。
- 已安装应用：`D:/notebook/software/Concat/concat.exe`，实际 MCP 回报 0.2.8。
- 两条证据分开：以下成片来自已安装应用，不能证明本地 0.2.10 已构建成功。
- 后续另行构建并运行了源码 CLI 0.2.10，修正了 14 个效果包目录名；源码测试结果适用于此本地修正版，不等于原始提交开箱可用。

## 首轮已完成

1. 源码 `concat-project` 测试：206 passed，0 failed。仅证明工程模型测试通过。
2. 已安装应用以显式 headless MCP 模式运行，初始化并发现 42 个工具，写入范围限制在本次输出目录。
3. 导入项目已有 6 秒 1280×720/24fps 视频，添加两个连续片段，总长 12 秒。
4. 首片段尾部缩短 2 秒并波纹移动，第二片段从 6 秒移至 4 秒，总长变成 10 秒。
5. 撤销恢复 12 秒，重做恢复 10 秒，脚本断言通过。
6. 导入已有钢琴音轨，截取为 10 秒，设置线性增益 0.25；回读数据确认保存该值。
7. 添加两条中文字幕，生成预览 PNG；人工查看本轮预览和导出抽帧，中文可读且位置合理。
8. 导出 H.264/AAC MP4，640×360、24fps、10 秒，视频 240 帧，音频时长 10 秒；FFmpeg 全量解码未报错。
9. 保存、关闭并重开中文路径工程：仍为 10 秒，保留 2 视频片段、1 音频片段、2 字幕片段。
10. 已安装 0.2.8 执行官方 `--smoke` 返回 0，日志记录 `smoke: ok`；不是人工编辑验收。

以上由脚本发出确定参数调用，未使用大模型理解自然语言，也未进行人工时间线交互、听音或长视频性能验收。音乐存在、长度正确和解码通过，不等同于对白音画同步或听感通过。

## 源码构建问题

- Cargo 1.98.1 可用；找到 Visual Studio 18 目录中的 MSVC 14.44/14.50 和 CMake，修正“可能未安装”的初步判断：它们存在，但 CMake 不在当前 PATH。
- 首次 concat-cli 构建在 ring 的 C 编译处遇到 MSVC 14.50 D8050 错误。
- 改用 14.44 并关闭开发调试信息后，报缺少 stddef.h。
- 已定位 Windows SDK 10.0.26100.0 的 UCRT 头文件，显式提供 INCLUDE 后再次尝试。最终结果见 source-build-env.log 和本记录后续更新。
- 尚未验证 FFmpeg 开发头文件/导入库与 libclang 的完整可用性；本机已有 ffmpeg.exe 不等于具备开发依赖。

### 已解决与源码运行结果

- 下载上游 deps.lock 中的 FFmpeg 8.1 开发包并通过其锁定 SHA-256 校验，解压在验证目录。
- 从 PyPI 下载 libclang 18.1.1 Windows x64 wheel，校验其元数据 SHA-256；仅解压本地，不修改系统 Python。pip 方式因代理配置失败，改用 curl 下载。
- 提供 UCRT INCLUDE、MSVC 14.44、FFMPEG_DIR、LIBCLANG_PATH 和 CMake 路径后，concat-cli 0.2.10 构建成功。
- 源码 CLI 实际识别已有视频，并从 1280×720/24fps 素材渲染出 24 帧视频，产物 source-render.mp4；ffprobe 结果保存为 source-render-verification.json。
- 首次源码 API 创建工程发生 panic：效果包目录 concat.after-hours 的 manifest ID 是 concat.midnight，违反 compiled_in() 的目录与 ID 一致性断言。
- 检查全部效果包，共发现 14 处同类不一致。通过 normalize-effect-folders.cjs 将目录改为 manifest ID；保留所有文件内容和效果 ID，变更前后路径清单见 effect-folder-repair.json。未删除效果，未关闭断言。
- 修正后重新构建，源码 CLI 的 9 次真实 JSON-RPC 请求通过：版本、建工程、导入、添加片段、保存、关闭、重开、读取和关闭；断言回读有 1 份素材、1 个 6 秒视频片段。
- GUI 首次构建出现 link.exe 初始化失败（0xc0000142）等编译错误，改用 CARGO_BUILD_JOBS=2 后继续推进。随后 Whisper CMake/MSBuild 在默认临时目录写临时文件时报访问被拒绝；将 TEMP/TMP 指向验证目录后，Whisper 原生依赖编译通过。最终 GUI 结果以 source-gui-build-temp.log 为准。
- 音量检查：源音频为单声道 22050 Hz，导出为双声道 48000 Hz。采用相同声道/采样率转换并施加 0.25 增益的 FFmpeg 参考结果，mean_volume -39.7 dB，导出 -39.9 dB，峰值同为 -26.5 dB。该样本的音量输出与参考基本一致；这不替代听音或对白同步验收。

### 最终源码 GUI 与媒体结果

- 最后一次 GUI 构建成功，耗时 13 分 19 秒；主程序 Slint 生成代码约 81 MB，曾观察到 rustc 内存约 8 GB。本次为 dev 验证构建，不是发布包性能测试。
- 生成 `Concat/src/target/debug/concat.exe`。官方 `--smoke` 返回 0，日志 `smoke: ok`，实际识别 RTX 4060 Laptop GPU / DirectX 12；没有人工操作时间线。
- 默认 APPDATA/LOCALAPPDATA 目录存在写入拒绝：不只影响日志和效果卡片，标题缓存失败还使字幕在预览与导出中消失，而 export_wait 仍返回 done。已通过实际抽帧识别该问题。
- 验证脚本按进程设置 APPDATA/LOCALAPPDATA 到验证目录，无需更改系统 ACL 或用户现有应用配置。复测后日志/标题缓存写入正常，中文在源码版预览和导出抽帧中可见。仍有 mstmc.ttf 字体解析警告，本样片所用微软雅黑中文显示正常。
- 通过源码 GUI 可执行文件的 headless MCP 重跑完整双片段、波纹裁剪、撤销重做、音量、字幕、保存重开和导出流程，断言通过；证据独立存于 `outputs/concat-validation/source-mcp/`。
- 源码版样片是 640×360、24fps、10 秒 H.264/AAC；240 个视频帧，全量解码未报错。AAC 流报告 9.92 秒，比视频少 80 ms，尚未归因，不作为对白同步验收通过。
- 源码版导出抽帧已查看，中文字幕可读。本轮没有对自然语言智能体理解能力、长片性能或复杂特效做结论。

本轮决策：继续推进“原生编辑器 + 适配层”。先用生成工程验证人工接手，再开发当前 Session 的实时桥接；暂不重写网页编辑器。

## 后续里程碑与决策门槛

| 里程碑 | 当前状态 | 通过条件 |
| --- | --- | --- |
| V0：立项与基线 | 完成 | 固定源码/运行版本，保存记录和可复跑脚本 |
| V1：基础接口和成片 | 小样通过 | 当前样片闭环已通过；补充用户真实短剧素材、正常分辨率和听音验收 |
| V2：源码构建 | 本地修正版通过 | CLI、GUI 构建及 GUI 冒烟通过，源码 MCP 小样闭环通过；发布打包未验证 |
| V3：原生人工接手 | 未验证 | 打开生成工程、预览、调整字幕及音量、保存导出 |
| V4：实时共同编辑 | **本地二开版已通过（2026-11-10）** | API 经 UI 事件循环操作当前 Session，共享撤销，拒绝过期版本，人工后 AI 读取最新状态 |
| V5：接回业务页 | 未开始 | 选定项目、素材与片段准确传入，状态与取消反馈真实 |

若 V1 真实媒体稳定性或 V2 构建持续不达标，暂停扩大二开范围，保留现有执行路径。若 V4 未通过，只能交付批处理和阶段性交接，不能宣称实时协作。

## V4 实时共同编辑：实现与验收（2026-11-10）

本地二开版已实现，真窗口 + 真 socket + 真 Session 端到端通过。见 [证据](../../outputs/concat-validation/live-runtime/report.json) 与截图 `outputs/concat-validation/live-window.png`（预览区出现 API 加进去的 “Your text”，标题栏 “LiveProof saved”）。

改了什么：

- `concat-api/src/live.rs`（新增）：`LiveLink` / `LiveSessions` / `LiveJob`，跨线程请求与回包，超时 15 秒。
- `concat-api/src/lib.rs`：`project.open` / `project.get` / `project.document` / `project.save` / `project.setVideo` / `edit.apply` / `edit.undo` / `edit.redo` / `media.import` 在 live 会话上路由到窗口；`project.close`、`export`、`preview_frame`、`template.save` 明确拒绝对 live 会话执行并说明原因。
- `concat-host/src/session.rs`：`Session::revision` 与 `EditorView::revision`；apply/undo/redo 自增。
- `concat-api/src/message.rs`：`edit.apply` 新增可选 `expectedRevision`；新增 `ErrorCode::Conflict`；新增 `Event::ProjectEdited`（path / revision / commands / createdId）。
- `concat/src/host.rs`：`Shell::serve_live` 每帧排空队列，在事件循环里 apply 后一次 publish；`Host::attach_live` / `detach_live`，开工程挂上、关工程摘下。
- `concat/src/lib.rs`：启动参数里的工程**在自动化服务器启动前**先认领并挂线（`OpenProjects::claim` + `attach_live`），打开失败则归还。
- `concat/src/panes/settings.rs`：自动化服务器把 live 注册表交给 API。

复跑：`powershell -File tools/concat-dev/live-runtime-probe.ps1`（全程独立 HOME，不碰现有设置）。11 项断言：建工程、起窗口、自动化监听、auth、project.open 命中窗口会话、version 报 live、edit.apply 0→1、片段落地、project.edited 广播、过期 expectedRevision 被 conflict 拒绝、undo 生效。`concat-api` 单测 33 项通过（含假窗口真 Session 的端到端用例与“窗口先认领”的竞态用例）。

已知边界（本轮不覆盖）：live 会话不服务导出与预览帧；探针只验空工程加字幕，未验真实素材与听感；V3 的人工精修仍未做。

## 文件与复跑

- 验证脚本：`tools/concat-validation/mcp-probe.cjs`。
- 执行：在指定 Git Bash 中，项目根目录运行 `node tools/concat-validation/mcp-probe.cjs --e2e --render`。
- 每次新建带时间戳的工程，不覆盖原业务工程；样片与日志固定更新于 `outputs/concat-validation/`。
- 样片：`sample.mp4`；预览：`preview.png`；导出抽帧：`export-frame.png`。
- 工程定位：`last-project.txt`；接口调用记录：`e2e-transcript.json`；断言结果：`assertions.json`。
- 构建日志：`source-build.log`、`source-build-retry.log`、`source-build-env.log`。
- 媒体检查：`media-verification.json`、`decode-errors.log`。

脚本当前使用本机已安装应用路径，属于固定环境验证工具，不是生产适配层。

源码构建脚本：在 Git Bash 执行 `bash tools/concat-validation/build-cli.sh`；GUI 为 `CARGO_BUILD_JOBS=2 bash tools/concat-validation/build-cli.sh concat`。脚本使用本机固定工具链路径及已下载依赖，尚不是通用安装器。源码接口复跑：`node tools/concat-validation/source-api.cjs`。

源码 GUI 启动检查：`node tools/concat-validation/source-smoke.cjs`。

源码版 MCP 闭环（Git Bash）：

```bash
CONCAT_VALIDATION_BIN='D:/notebook/AIGC/CREATION-PIPELINE/Concat/src/target/debug/concat.exe' \
CONCAT_VALIDATION_OUTPUT='outputs/concat-validation/source-mcp' \
node tools/concat-validation/mcp-probe.cjs --e2e --render
```

源码样片：`outputs/concat-validation/source-mcp/sample.mp4`。对应工程路径：同目录 `last-project.txt`。已安装版早期样片保留在上一级目录，两者证据不混用。

---

## M1 窗口停靠（伪嵌入）：实现与验收（2026-11-10）

**目标**：把 Concat 原生编辑器当成页面主体，右侧只留一条智能体对话栏。
不做 iframe、不重写时间线；原生窗口精确落进网页预留区域，看起来就是页面的一块。

### 版面（用户定的方向，倒过来重做过一次）
- 左：`.sc-canvas` 整块 —— 原生 Concat 窗口停靠后正好盖满，页面看上去就是编辑器本身。
- 右：`.sc-rail` 窄栏（`clamp(340px, 26%, 460px)`）—— 智能体对话、发送、引擎切换。
- 第一版做成了「对话页右边挂一块剪辑台」，方向反了；按「原生剪辑页 + 右侧对话」重排。

### 组成
| 层 | 文件 | 职责 |
| --- | --- | --- |
| 代理 | `tools/concat-dev/dock-agent.ps1` | 常驻 PowerShell，stdin/stdout JSON 行协议；EnumWindows 挑主窗口（可见 + 面积最大）、改样式去标题栏、`SetWindowPos`（topmost）、报回真实矩形与 DPI |
| 后端 | `Creation-Studio/src/local-dock.js` | 守护代理（90s 空闲回收）、CSS px × dpr → 物理像素、`launch/status/dock/restore` |
| 路由 | `Creation-Studio/src/local-dock-routes.js` | `/api/local/dock[/dock|/restore|/launch]`，只认回环（403），参数不合法给人话 |
| 前端 | `Creation-Studio/web/dock-host.js` | `DockHost.attach({stage})`：`screenX/screenY + getBoundingClientRect` 算屏幕坐标，ResizeObserver + scroll + 800ms 兜底同步、坐标没变不发请求 |
| 版面 | `web/smartcut.js`、`web/smartcut.css` | 画布 + 右栏，顶条三个动作：打开剪辑台 / 还原成窗口 / 对话 |

### 验收
- `node --test tests/dock-host.test.js` → 11/11（含坐标换算、缩放只乘一次、回环限制、代理协议、还原）
- `node tools/concat-dev/dock-selftest.js` → 13/13（真进程真窗口：落位 ±6px、连续移动、dpr 换算、还原）
- `node tools/concat-dev/dock-http-probe.js` → 12/12（起真服务、走真 HTTP：GET/dock/restore、太小拒绝、复查一致、borderless）
- 真浏览器：`web/integrations/dock-preview.html`（走 `/integrations/` 静态路由，免登录）自检 11/11，
  画布 1049×756、对话栏 369，点「打开剪辑台」后状态变「已停靠 · 可直接操作」
- 截图：`outputs/concat-validation/dock-in-page.png`（页面与原生窗口两张真实抓图按物理坐标对齐合成）

### 已知问题
- Concat 在**长时间反复停靠**后偶发自己退出（两次观察到）。写改样式时顺手补的
  `ShowWindow(SW_RESTORE)` 已去掉（多余的尺寸重算），此后自测未再复现；还要再压一次长跑。
- Concat 的日志写在 APPDATA，本机那个目录写不进去，崩了没栈可看——真要定位得给它一个可写的 HOME。
- 右侧对话栏仍是旧版的「页面」样式（欢迎块偏大、tips 竖排占地方），窄栏版式还没重排。

---

## M3 剪辑台：一个窗口（2026-11-10）

**改了什么**：不再把原生窗口摆在网页上（那是两个窗口）。改成 Concat 以 **headless** 跑在后台，
浏览器就是唯一的窗口：左侧媒体 / 预览 / 时间线，右侧一条智能体对话，都是同一个页面的 DOM。

- 引擎会话：`Creation-Studio/src/concat-session.js` —— 常驻 `concat.exe --mcp`（stdio 换行 JSON-RPC），
  懒启动、空闲 15 分钟回收。工具：`project_open / timeline_read / project_get / edit_apply / edit_undo / edit_redo / project_save / preview_frame`
- 后端口：`Creation-Studio/src/concat-routes.js` —— `/api/concat/{status,projects,open,timeline,apply,undo,redo,save,frame}`；
  预览帧直接回 PNG，浏览器不碰引擎令牌。
- 页面：`web/concat-editor.js`（Vue 3，全局构建，无打包）+ `web/concat-editor.css`；
  挂在系统壳里当一级页（`#concat`，左侧「剪辑台」），配色走 `--wmd-*` token，和别的页同一套。
- 交互：拖动片段（换轨/换位）、拖两端裁剪、播放头切开（S）、删除（Del）、撤销/重做（Ctrl+Z/Y）、保存（Ctrl+S）、
  素材点一下加入时间线、播放头点击定位、缩放；全部落到 `edit.apply`，和智能体共用同一份撤销历史。

**验收**
- `node tools/concat-dev/engine-probe.js` → 5/5（version / open / timeline / get / 预览 PNG 403 KB）
- `node tools/concat-dev/editor-api-test.js` → 6/6（读时间线、移动、撤销、切开、撤销、预览帧），走的就是页面的 HTTP 路径
- 真浏览器：`web/integrations/concat-home.html` 自检 7/7（素材 2、轨 4、片段 5、预览帧 640×360、对话栏 369px、预览区 853×486）
- 截图：`outputs/concat-validation/concat-editor.png`

**还没做**
- 拖动/裁剪只用 API 验过，没人用手在页面上真拖过（需要一次人工点两下）。
- 播放是「按 1/30 秒推进 + 每 260ms 拉一帧」，不是实时预览流；要看真节奏得走帧流或分段缓存。
- 新建工程还在老的表单/接口里，剪辑台只负责剪（按你的意思，创建不该占这里）。
- 右侧对话是最小版（`/api/agent/chat` 的 SSE），会话列表、轨迹、附件都还没接。
