# 计划二：媒体库内视频剪辑

调研日期：2026-10-24。当前交付为 GitHub 调研与实施设计，未安装候选剪辑器、未改动媒体库业务代码、未执行导出性能测试。

## 1. 目标与入口

媒体库保留点击弹窗预览；在卡片/预览弹窗新增“剪辑”，支持多选素材“新建剪辑工程”。在工作台内打开完整剪辑工作区，不启动本地外部播放器。生成的视频、图片、配音、背景音乐可以直接进入时间线。

核心任务是将数个生成片段整理成完整剧情：裁掉首尾、分割拼接、增减音轨、加入文字/字幕和图片，最后导出可播放文件。编辑是非破坏性的，原始素材保留。

## 2. GitHub 调研结论

| 项目 | 已核实内容 | 推荐借鉴/使用 | 限制与依据 |
|---|---|---|---|
| [OpenCut](https://github.com/OpenCut-app/OpenCut) | 主仓库说明正在重写，规划 Rust 核心与编辑器 API | 跟踪架构方向，不把路线图当已可用能力 | [当前 README](https://github.com/OpenCut-app/OpenCut#readme) |
| [OpenCut Classic](https://github.com/OpenCut-app/opencut-classic) | 经典版 README 明确 archived/no longer maintained；Next.js/React，含 Rust/WASM 部分 | 时间线/编辑状态设计参考；不整站搬入现有 Node/原生 JS 页面 | [README](https://github.com/OpenCut-app/opencut-classic/blob/main/README.md)、[依赖](https://github.com/OpenCut-app/opencut-classic/blob/main/apps/web/package.json)、[MIT](https://github.com/OpenCut-app/opencut-classic/blob/main/LICENSE) |
| [LosslessCut](https://github.com/mifi/lossless-cut) | FFmpeg 驱动的无损裁切、分段和同编码拼接 | 借鉴入出点、片段导出和关键帧限制的处理思路；不是嵌入式多轨组件 | [README](https://github.com/mifi/lossless-cut/blob/master/README.md)、[GPL 许可证文本](https://github.com/mifi/lossless-cut/blob/master/LICENSE) |
| [Shotcut](https://github.com/mltframework/shotcut) | Qt 桌面剪辑器，仓库标明 GPLv3 | 参考成熟剪辑交互，不直接嵌入网页 | 独立桌面技术栈；按实际 GPL 条件审查代码复用 |
| [React Timeline Editor](https://github.com/xzdarcy/react-timeline-editor) | React 时间轴组件，基于行与起止时间 action 数据 | 首个时间线 UI 验证候选；仅是组件，不提供完整视频解码、混音和成片导出 | [MIT](https://github.com/xzdarcy/react-timeline-editor/blob/master/LICENSE) |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) | 浏览器侧视频/音频读写转换工具 | 后续评估精确取帧、解码和浏览器导出；首期非必要依赖 | [MPL-2.0](https://github.com/Vanilagy/mediabunny/blob/main/LICENSE)，需要逐依赖复核 |
| [OpenVideo / react-video-editor](https://github.com/openvideodev/react-video-editor) | README 描述 WebCodecs/PixiJS、多轨及浏览器导出；涉及云素材/转写配置 | UI 和预览设计参考；暂不复制作为默认底座 | [自定义许可证](https://github.com/openvideodev/react-video-editor/blob/main/LICENSE)设免费资格及衍生产品限制，不能当 MIT；搜索摘要中的旧 Remotion 描述也不能当当前架构 |

补充：[Remotion](https://www.remotion.dev/docs/license)可作为程序化视频方案的进一步候选，但不能默认视作无条件 MIT；首期无需为基础剪辑引入它。[clawnify/OpenCut](https://github.com/clawnify/OpenCut)是同名的另一项目，README 说明部署依赖其托管渲染服务，本次不作为本地剪辑首选。不要混淆这两个 OpenCut。

以上是官方页面、许可证与部分配置/源码的桌面调研。没有以星数替代验证。GitHub API 本轮返回 403，因此未核实完整提交活跃度和最新 release；实施前固定具体提交、建立依赖与许可证清单。

## 3. 推荐技术路线

推荐：媒体库入口 + 独立时间线模块 + 本项目剪辑文档 + 浏览器预览 + 本机 FFmpeg 导出。业务数据和导出能力不绑定某个完整开源剪辑器。

时间线先用 MIT React Timeline Editor 做小型验证。如果满足多轨拖动、缩放、吸附、入出点交互与大列表性能，封装成单独构建的组件挂载到当前页面；只在剪辑模块引入 React，不迁移整个工作台。如验证不通过，沿用同一文档契约实现原生时间线，避免同时维护两套数据。

先将所有编辑能力限定到预览和导出均已实现的操作，不能出现预览可拖文字但导出没有文字等两套语义。复杂效果可先生成短段预渲染，不能以浏览器看起来正确替代最终成片验收。

## 4. 本项目当前基础

实际读取：Creation-Studio/src/server.js、web/app.js 和 package.json。已有媒体列表、视频弹窗、/api/tools/probe 与 /api/tools/frames，可复用素材寻址、视频信息和抽帧的思路；现有抽帧接口一次只生成少量帧，时间线需要另建缩略图/波形缓存。

本机真实执行 ffmpeg -version：D:/notebook/software/ffmpeg/bin/ffmpeg.exe，6.1.1 essentials；配置含 libx264、libass 等，且包含 --enable-gpl 和 --enable-version3。此事实仅说明程序存在及构建配置，不证明导出速度或具体滤镜组合可用。打包分发时不能把这份二进制标为“纯 LGPL”。[FFmpeg 官方许可证说明](https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md)

不直接沿用当前 runCommand 的短任务模式处理长时间导出；需要可取消、可观察、可恢复状态的后台导出任务。

## 5. 第一版功能

- 素材：视频、图片、音频、透明 PNG；媒体库多选加入，保留原始文件引用。
- 时间线：多轨、播放头、时间尺、缩放、吸附、拖动排序；分割、首尾裁切、复制、删除、删除并闭合空隙；原声与视频可关联移动。
- 画面：16:9/9:16/1:1 项目比例、适应/填充、基础位移缩放旋转、图片叠加、文字层。
- 声音：静音、音量、独立配音/音乐轨、淡入淡出，静音视频与无音轨素材正常处理。
- 字幕：手动文本字幕、导入/导出 SRT；自动转写放后续，并明确所需模型与渠道。
- 工程：命名、自动保存、刷新恢复、撤销重做、素材丢失提示和重定位。
- 输出：导出任务进度、取消、失败原因、重试、成片回到媒体库。

不把高级关键帧、复杂转场、调色曲线、自动卡点列为首批已支持；可在第二阶段逐项补齐并做预览/导出一致性验证。

## 6. 页面布局

顶部：工程名、保存状态、撤销重做、项目比例、导出。
左侧：当前项目素材、媒体库引用、文字/字幕。
中间：预览画面和播放控制，可逐帧查看与设置入出点。
右侧：当前片段的时间、画面、声音、文字属性。
底部：视频/叠加/文字/音频轨道，缩略图、音频波形、吸附线和播放头。

普通媒体点击继续弹窗；进入剪辑才打开较大的工作区，避免把完整编辑器塞进小预览框。

## 7. 数据与时间规则

EditProject：schemaVersion、projectId、id、revision、name、画布宽高、背景、fps 有理数、audioSampleRate、assets、tracks、clips、titles、captions、exportSettings。

Clip：稳定 ID、assetId、trackId、时间线 start、素材入出点、speed、transform、opacity、volume、linkedGroupId。所有时间运算使用明确时间基准与有理数/整数 tick，避免依赖反复累加的浮点秒；界面显示秒/帧。源文件 VFR 和项目 CFR 的映射需明确，速度不为 1 时正确换算源区间与时间线长度。

素材记录源时长、音视频流、旋转元数据、帧率/时间基、分辨率和 fingerprint。浏览器 blob URL 仅作临时展示，不能写入工程充当持久化地址。JSON 工程保存动作和版本；导出绑定工程 revision，编辑后旧导出不会冒充最新版本。

轨道顺序、空隙、重叠、静音、变换、文字样式等由统一规范定义。UI 动作提交命令再进入文档，方便撤销和未来 AI 编辑；不让渲染器私自修改工程。

## 8. 预览、代理与导出

预览统一主时钟；视频根据入出点调度，音频用可控音频时钟同步；拖动播放头和逐帧取样不能只改 DOM 时间文本。首期先限定可支持的同时活动视频层数并显示性能提示，实际限制由验证决定。

为浏览器不能流畅解码的素材生成可播放代理；预览使用代理，导出从原始文件读取。缩略图、波形、代理以源指纹和参数缓存，避免每次打开重复解码。源修改或丢失时缓存失效，导出前再次检查。

后台生成受控 FFmpeg 参数/滤镜图，实现 trim/atrim、时间戳归零、scale/pad/crop、叠加、concat、音量/混音和字幕烧录。字幕转为可控 ASS/文本资源；中文字体需要固定可用字体和测试。构造参数数组，不拼接 shell 命令；中文/空格文件名、滤镜转义单独测试。

导出任务包括 queued/running/cancelRequested/cancelled/succeeded/failed；读取 -progress pipe:1，不将进度条到 100% 当作成功。成功要求退出码为零、ffprobe 验证输出流/尺寸/时长，且可解码播放。临时文件完成后原子发布，取消仅终止该任务进程和清理该任务临时输出，原素材始终保留。

“快速裁切”和“精确剪辑”分开：流复制只在编码、时间戳和关键帧等条件允许时启用；任意帧裁切、文字、混音和转场通常需要重新编码。不能保证任何素材都能任意帧无损裁切。

## 9. 任务持久化与模块划分

建议独立 modules：edit-store（工程/版本）、timeline-model（命令/时间语义）、media-analysis（探测/代理/波形）、preview（浏览器调度）、ffmpeg-render（导出编译）、edit-jobs（状态/进度/取消）。server.js 只连接路由，app.js 只保留入口。

建议 API 契约：工程列表/读取/保存、媒体分析和代理状态、导出创建/查询/取消，沿用项目认证与权限。修改工程使用 revision 防止旧页面覆盖新版本；服务重启后运行中导出标记中断，不显示一直运行，也不在无提示下重复导出。

AI 自动粗剪放在基础剪辑可用之后：AI 提出可审阅的文档 patch（片段排序、裁切、字幕），校验源时长/引用/版本后应用，允许一步撤销。模型不生成可执行脚本或自由 FFmpeg 命令。

## 10. 分阶段交付与验收

阶段 0：技术验证。用两个 15 秒视频、一张 PNG、一段配音验证时间线交互、代理预览、裁切拼接、字幕与本机 FFmpeg 导出；确认中文字体、音画同步和许可证依赖。无需先搭完整 SaaS 或云账号系统。

阶段 1：媒体库入口、工程保存恢复、基础时间线、入出点/分割/排序、一个画面主轨与配音/音乐轨、基础成片导出。目标是能完成实际短剧情拼接。

阶段 2：扩展叠加轨、文字/字幕、画面变换、淡入淡出、波形/代理、导出取消及局部失败恢复；与计划一的图像编辑输出衔接。

阶段 3：转场、关键帧、自动转写和 AI 粗剪。每项独立检查预览/成片一致性，不以界面按钮存在作为验收。

验收样本：15秒片段拼接、不同分辨率/帧率/采样率、无音轨素材、VFR、中文路径和字幕、透明叠图、竖屏输出、长素材代理、多次撤销重开、导出时继续编辑、取消导出和重启恢复。核对实际入出帧、拼接处黑帧/音频爆点、音画同步、总时长与文字位置。说明结果误差与支持范围。

## 11. 与计划一的先后关系

两个计划可独立建设，不必等场景推理全部完成才开始剪辑。先约定共享 AssetRef 和任务状态，再各做一个最小验证；图像导出的透明 PNG/场景图、视频生成结果和配音可直接复用。图层文档、场景文档、剪辑文档各自版本化，不共用可变状态。

优先级建议：先做剪辑的“生成片段拼接成片”链路和图像编辑的“图层保存恢复”链路；场景建模推进结构化数据和可视化，后续再叠加 AI。最终是否引入候选库，以阶段 0 的真实验证为准。
