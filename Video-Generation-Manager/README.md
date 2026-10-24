# 豆包本地创作台（源码重建版）

这是从管理器 7.8.7 安装包提取证据后另写的本地任务服务。新服务、新界面、新插件均有可读源码，不依赖旧商业激活码。原管理器和原插件未修改。

## 启动

在 Git for Windows 的 Git Bash 中执行：

~~~bash
cd '/d/notebook/software/管理器7.8.7/rebuild'
./start.sh
~~~

需要已安装 Node.js 22+、Google Chrome，以及 FFprobe。本机已配置的 FFprobe 默认路径是 D:/notebook/software/ffmpeg/bin/ffprobe.exe。

启动后工作台地址：http://127.0.0.1:17778 。关闭管理器主窗口会同时停止后台服务、取消本地运行任务并关闭由它管理的账号浏览器；Cookie和登录配置保留。也可以使用“系统管理”页面的“退出整个应用”或终端 Ctrl+C。桌面快捷方式重复点击只唤起同一个主窗口。

顶部导航包含四个独立页面：任务管理（表格、筛选与任务明细）、账号管理（按平台 tab 分类、账号卡片、登录与配额）、API（连接凭据和调用示例）、系统管理（代理、下载位置、主题与动态效果）。

任务表格按「任务 / 平台 / 执行账号 / 生成参数 / 状态 / 创建时间 / 操作」分列，提示词只显示一行缩略（完整内容在任务明细里）。账号管理顶部按平台分 tab（全部 / 豆包 / Gemini / Dola），每个 tab 可以一键启用或停用该平台的全部账号，避免不同平台混在一起调度。

新建任务必须先选平台，再选该平台的执行账号。参数按平台变化：豆包支持 5–15 秒整数秒和多种画幅；Gemini 固定 10 秒、只有 16:9 与 9:16，并且隐藏模型和清晰度选项（提交时服务端也会再拦一次）。

在账号管理添加账号 → 打开登录窗口 → 登录 → 在任务管理新建任务 → 填写提示词和参数 → 提交。账号使用独立 Chrome 配置目录；窗口可关闭，登录状态保留。任务提交后不要手动操作该任务页面。

系统管理提供七套主题（薄荷花园、晴空来信、杏桃午后、极光夜航、樱雾、午夜极光、石墨暖光，后两套为深色）、三种组件风格（圆润、描边、紧凑）和三档动态强度（灵动、柔和、关闭），外观自动保存在当前浏览器。顶栏调色板按钮可快速切换主题。背景是随主题变色的极光氛围层：缓慢旋转的光幕 + 漂移的光斑 + 浮尘，指针移动时整层轻微视差；开启“减少动态效果”或选择“关闭”时动画停止但保留配色。HTTP/HTTPS 代理保存到 data/settings.json，对账号浏览器及视频下载生效，代理密码不会从设置查询接口回传。保存代理将关闭现有账号窗口，正在执行任务时不能修改。

API 页面提供服务地址、Bearer 密钥、任务提交/查询/下载示例。服务仍仅监听本机；本次界面更新没有新增对公网监听。

## 字字动画插件

插件源码在 plugin/video_plugin_doubao_local/ 。它是独立插件名，不覆盖 video_plugin_dola_doubao。

安装至字字动画的用户视频插件目录，或原有 plugins/video_plugins/ 下的新目录。刷新插件列表，选择“豆包本地创作台”。插件的 connection_file 参数填写管理器界面显示的连接文件绝对路径，默认是本项目 data/connection.json。该文件是本地服务连接凭据，不是商业授权码。

插件遵守宿主 generate(context) → list[str] 契约；参考图按槽位排序，首尾帧置前；结果保存至作品目录，按 0001_unique_name_round_position.mp4 命名，完整写入后才回传。

宿主公开插件接口没有运行中取消令牌。可在管理器取消，或在插件设置页点击取消；不能宣称宿主红 X 会自动中断正在运行的插件。取消不会撤回已经提交至豆包的生成。

## Gemini 视频

平台下拉里新增 Gemini，账号就是 Google 账号的独立浏览器资料目录。要求在账号窗口里登录 **Google AI Pro/Ultra** 会员；普通账号没有视频生成入口。

**必须走代理**：Gemini 对直连 IP 会做地区限制和风控。系统管理 → 代理设置里填 `http://127.0.0.1:7897`（本机 Clash 默认端口；换成你自己的 HTTP 代理地址），保存后重开账号窗口。代理同时作用于账号浏览器和视频下载。

任务流程（自动完成）：打开 `gemini.google.com/app` → 在输入框的「Upload & tools」里开启 **Create video**（首次会弹「Create videos With Gemini Omni」，自动点 Try it）→ 按需设画幅 → 填提示词发送 → 等这次会话出现新视频 → 点视频卡片的 **Download video** 下载，再用 ffprobe 校验时长和视频轨。

会员成片本身不带水印，所以 **Gemini 没有去水印流程**；Google 的 SynthID 隐形水印不在画面里，也无法也不应去除。管理器自己的配额计数对 Gemini 只是记账，真实额度以 Google 账号为准。

当前限制（会直接报错，不会静默忽略）：Gemini 视频固定 10 秒，画幅只支持 16:9 / 9:16，没有模型和清晰度选项（界面隐藏这些字段，服务端也校验）。参考图支持图片上传（走「Upload files」，逐个上传并确认出现附件缩略图后才提交）；多张参考图与首尾帧语义还没验证。任务明细里获取方式显示为「无水印 · Gemini 会员」。

实测：一条 10 秒 1280×720 24fps 成片，从提交到下载校验完成约 75 秒，抽帧无水印（evidence/gemini-test.md、gemini-test-sheet.jpg）。Google 对自动化更敏感，账号风险由使用者承担，只建议个人自用。

## 代码

- src/server.js：仅监听127.0.0.1的HTTP接口、管理界面、账号导入导出。
- src/browser-pool.js：真实Chrome独立持久会话、登录窗口、页面结构诊断。
- src/store.js：账号元数据与原子文件写入。
- src/tasks.js：队列、每账号互斥、取消、requestId去重、重启中断语义。
- src/automation.js：控件设置、逐图上传、消息归属、人工验证暂停、生成监测和下载。
- src/adapters/page-state.js：页面消息与媒体识别；拒绝把历史视频当成本次结果。
- src/adapters/doubao-official-resolver.js：从旧包恢复的官方原片模块，新增严格按选定消息ID解析的入口。
- src/download.js：流式下载、大小限制、MP4头与FFprobe视频轨道/时长校验。
- web/：新工作台。
- plugin/：字字动画薄插件。
- recovered/：旧包提取并格式化的45个文件，仅供参考；不作为完整原始源码。
- evidence/：REA分析记录、恢复文件摘要与测试证据。

## 数据与备份

新数据只写入 data/；旧管理器的AppData目录不被自动读取或覆盖。

accounts.json 是账号元数据；profiles/ 是 Chrome 登录配置；tasks.json 是任务日志；downloads/ 是默认成片目录（可在系统管理里改）；connection.json 是本地API凭据。备份时先正常退出新管理器，再复制完整 data/。导出的账号JSON包含Cookie，属于登录凭据，不要公开。

移除账号仅移除列表项目，Chrome配置文件保留，避免意外清除登录状态。旧管理器Cookie备份和Dola TXT支持导入；不同版本localStorage结构仍需真实备份核对。

## 下载文件在哪里

成片默认写进 data/downloads/，文件名是任务ID.mp4。任务管理页顶部有“视频下载目录”一条：显示当前完整路径，可复制路径、可「打开文件夹」、可打开「下载记录」、可跳转到设置；任务明细显示文件名、大小、时长、获取方式、下载时间与保存目录，并有「打开所在文件夹 / 系统播放器打开 / 下载视频」。已完成任务的行内「打开」调用系统默认播放器打开本地成片，不占用浏览器；明细里同样提供「系统播放器打开」。

下载位置可以在系统管理 → 下载位置里改：必须是绝对路径，留空回默认；目录不存在会自动创建，保存前会实际写一个探针文件验证可写。保存后立即生效，之后的新任务存到新目录，历史文件不会被搬动。改下载目录不会关闭账号浏览器，也不需要等任务结束。

系统管理页的本地工作空间也显示下载目录并可打开。下载目录里可能还有调试或失败任务留下的文件，系统不会自动删除；在「下载记录」里定位后手动清理即可。

相关接口：GET /api/settings 返回 downloadDirectory 与 downloadsPath；PUT /api/settings 传 {downloadDirectory} 修改；GET /api/downloads 列出下载目录（最多300个视频，按修改时间倒序，能对上任务的会带 taskId / watermarkMethod）；GET /api/downloads/file?name= 下载指定文件；GET /api/tasks/{id}/play 内联播放（支持 Range，供接口/内嵌场景使用）；POST /api/tasks/{id}/open 用系统默认播放器打开成片；GET /api/tasks/{id}/file 下载任务成片；POST /api/reveal 传 {taskId} 定位任务文件、传 {name} 定位文件、都不传则打开下载目录。只接受下载目录内的路径。

## 当前验收边界

本地测试使用真实Chrome与本地生成页面，验证任务链路与插件文件回传，不代表豆包或Dola实际视频生成已通过。真实平台验收进展记录在 evidence/platform-verification.json（存在时）。

Gemini 已完成真实账号实测：文字生成与带参考图生成各一条，均为 1280×720、10 秒、无水印，从提交到下载完成约 75 秒（evidence/gemini-test.md）。豆包链路未受影响，回归覆盖 fixture 端到端与全部单测。

Dola尚未完成实测。当前参考上传仅实现图片，插件遇到音频/视频参考会明确报错。模型、时长和画幅显式指定时必须有可验证控件，不能默默忽略或改用其他参数。网页更新后可在账号设置中调整选择器。

原“无限画布”、API模型渠道、所有旧版账号指纹/外部OAuth行为尚未移植。当前先重建用户指定的账号→浏览器→提示词/参考图→视频→下载→插件回传主链路。

无水印流程优先取官方明确标记的无水印原片；未实现图像修补式去水印。找不到本次消息对应的明确无水印地址时任务报错，不会用其他历史成片代替。

已并入 doubao-dola-watermark-helper v1.6.7 的 fallback_api 方法（channel=no、codec_type=8、logo_type=unwatermarked，并解码 qAAB 加密地址），MIT 授权见 licenses/。实测（evidence/live-no-watermark-probe.md）：真实会话取到 lr=unwatermarked 的 1280×720、24fps、15.05 秒成片，41MB，抽帧无水印；同一会话官方下载为 2.1MB HEVC 且带“豆包AI生成”。相对原扩展有两处改动：允许列表补上实测主机 snssdk.com；采集除 /im/chain/single 外也覆盖 /im/conversation/batch_get，否则重新打开既有会话取不到历史成片。手动实测脚本：node tests/live-no-watermark-probe.js [会话地址]，只读页面，不提交生成。

下载地址解析已接入任务主链路（src/automation.js 的 resolveGeneratedMedia）：豆包任务无论是否勾选无水印，都先走 fallback_api 取原片，未命中再试官方节点接口，最后才用页面视频（勾选无水印时页面视频必须由页面明确标记）；解出的地址仍会被带水印标记的检查拒绝，任务明细显示“获取方式 + 归属消息”，/api/tasks/{id}/diagnostics 也会带回 fallback 诊断。

## 测试

~~~bash
npm test
npm run test:browser
npm run test:ui
~~~

第三条使用临时数据在真实 Chrome 中检查四页导航、任务明细和筛选、账号配额、主题保存、代理保存以及手机宽度溢出，截图保存到 evidence/ui-*.png。

第二条会打开测试Chrome账号窗口，使用本地视频和Python测试插件，不向豆包提交生成。检查结果保存在 evidence/browser-smoke.json 和 dashboard.png。

可选环境变量：DBM_REBUILD_PORT、DBM_REBUILD_DATA_DIR、DBM_CHROME_PATH、DBM_FFPROBE。DBM_REBUILD_INSPECT=1仅用于开发验收，临时允许Chrome本地调试端口；正常start.sh不启用。

## 生成等待与确认

豆包先返回方案并要求确认时，管理器等待文本停止输出后，在原会话仅回复一次“确认，开始生成视频”。已发送确认的会话不会反复催促。

识别到生成或预计等待提示后，先等待约 5 分钟，再每 30 秒读取一次页面进度；不会通过重复提交提示词来查询。服务续查已提交任务时保留下一次检查时间。豆包账号窗口默认宽度约为可用屏幕的 70%、高度 90%，保持普通窗口。
