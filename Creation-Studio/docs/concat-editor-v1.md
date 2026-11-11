# 剪辑台 V1（前后端分离）

**一句话**：剪辑台页面是 Concat 原生服务的客户端。方法名、参数、错误码全是引擎的；
我们的 Node 只做三件事 —— 起进程、搬字节、收事件。加一条新命令不用改后端。

## 拓扑

```
浏览器（壳里的一个路由 #concat）
      │  POST /api/concat/rpc      {calls:[{method, params, lane}]}
      │  GET  /api/concat/frame    ?path=&t=&w=&h=     （PNG 直出）
      ▼
Creation-Studio  Node ── 纯传输（src/concat-rpc-routes.js）
      │  起进程、读横幅、管两路连接（src/concat-engine.js）
      ▼
concat-cli serve  127.0.0.1:<随机端口>   ← 不开窗、不链接 Slint
      │  换行 JSON-RPC；每条连接先 auth
      ▼
Concat 引擎：工程 / 时间线 / 编辑 / 预览帧 / 导出 / 撤销栈
```

智能体同时要改同一个工程时，用 `CONCAT_API_ADDRESS` + `CONCAT_API_TOKEN` 指向同一个
server，人和智能体就在同一份工程、同一条撤销栈上。

## 八个接口

| 接口 | 作用 |
|---|---|
| `GET /api/concat/engine` | 引擎状态：在不在、pid、apiVersion、addr、root、重启次数 |
| `POST /api/concat/engine/start` · `/stop` | 起 / 停（页面第一次调用 rpc 时也会自动起） |
| `POST /api/concat/rpc` | `{calls:[{id?, method, params, lane?}], drain?}` → `{replies, events, engine}`；`lane:"frame"` 走预览通道 |
| `GET /api/concat/frame` | 一帧 PNG，`<img>` 直接用（`nearest=1` / `proxy=1` 直通引擎那两档，见下） |
| `GET /api/concat/assets/thumb` · `/wave` · `/media` | 缩略图 / 波形峰值 / 音视频原文件（Range，见下） |
| `GET /api/concat/assets/doc` | 读一份**文本**给页面：只认 `.srt / .vtt / .txt`，≤4 MB，去 BOM（字幕导入用） |
| `POST /api/concat/pick` | 弹本机文件选择框，回 `{files:[绝对路径]}`；可带 `{single, exts, title}` 收窄 |
| `GET /api/concat/health` | 环境自检：引擎在不在、引擎的 `titles/` 能不能写（不能写时预览里没有文字/图形） |
| `GET/POST /api/music/*` | 剪映曲库的门（转发 + 试听直出），数据源是**独立的**「剪映控制 API」服务 |

只认回环（403 之外一律拒），因为这条口能改盘上的工程、能跑导出。

## 曲库（搜音乐）从哪来

引擎的 `catalogue.list` 里那 25 条 `audio` 是**音频处理包**（Bass / Cathedral / Noise Reduction…），
不是曲子；原生窗口的 `concat_host::sounds` 又没有 API 方法。所以曲库走我们自己那个服务：

```
浏览器  ── GET  /api/music/native?q=治愈&type=music&limit=24
        │  GET  /api/music/search?limit=100        （本机已缓存的曲库）
        │  POST /api/music/download {resource_id,title,type}
        │  GET  /api/music/audio?path=…            （试听：本地缓存文件，Range 直出）
        │  GET  /api/music/preview?url=…           （试听：在线曲目，同源转发 CDN，Range 也转）
        ▼
Creation-Studio  Node ── 纯转发（src/music-routes.js），顺手拉起下家
        ▼
剪映控制 API  127.0.0.1:17830（tools/jianying-api/server.py）
        ├─ /music/search          本机曲库索引（output/jy-library/music_index.json）
        ├─ /music/native-search   lyra-cli 走剪映素材平台，和剪映里搜出来的一样
        ├─ /music/download        按 resource_id 下成 m4a，返回落地绝对路径
        └─ /music/status          索引条数 + 原生通道能不能用
```

**试听必须走同源**：`preview_url` 是带签名的剪映 CDN 地址，从别的站点直接塞给 `<audio>`
会被防盗链挡掉（页面上表现为 `试听失败`）。所以页面只认 `/api/music/*`，由 Node 带上
`Referer` 转发，白名单只放剪映自家域名（`WMD_JY_PREVIEW_HOSTS`，默认
`vlabvod.com / faceu.com / byteimg.com / ulikecam.com / snssdk.com / pstatp.com …`），
且只转 https。

两条路各有各的用处：

| 源 | 数据 | 落地 | 用时 |
|---|---|---|---|
| **本机已缓存** | 在剪映里搜过并用过的歌/音效（曲名 ↔ music_id ↔ 本地 mp3） | 已有本地文件，`media.import` 直接用 | 秒回 |
| **联网曲库** | 整个剪映素材平台，返回 `resource_id / 标题 / 作者 / 时长 / 付费 / 试听地址` | 先 `/music/download` 下 m4a，再 `media.import` | 搜 1–3 s，下一首 2–8 s |

页面上：音频页签 → 「剪映曲库」→ 芯片切 `音乐 / 音效 / 本机已缓存` → 输入关键词回车 → 行尾
`▶` 试听、`＋` 下载并放进时间线（`media.import` → 找到新条目 → `addClip` 到音频轨）。
曲库状态在组件挂载时就探一次（`/api/music/status`），失败自动重试两次，仍失败就在面板上
留一行红字 + 「重试」按钮 —— 不会再出现“本机已缓存 0、什么也不说”的状态。
配好 `WMD_JY_API`（默认 `http://127.0.0.1:17830`）、`WMD_JY_PYTHON`、
`WMD_JY_MUSIC_ROOTS`（试听允许的目录，默认剪映 Cache 与 `output/jy-library`）即可换源。

剪映 API 没起时这层会自己拉起来（`outputs/jianying-api.log` 有输出），起不来就把原因原样返回页面。

## 版式照哪几个文件

页面结构对着 Slint 前端逐块抄：

| 原生 | 网页 |
|---|---|
| `ui/title-bar.slint` | 顶栏：File/Edit/View、工程名 + saved、Export、窗口按钮 |
| `ui/app.slint` + `ui/dock.slint` | 三栏 + 时间线，面板之间 8px 的“沟”，圆角 12px |
| `ui/start.slint` 的媒体页签 | 左侧页签条（见下面的「左侧面板」）|
| `ui/media-pane.slint` | 左侧筛选树（All media / Video / Audio / Images + Generated）+ 素材卡 |
| `ui/preview-pane.slint` | Preview 头（尺寸 · 帧率）+ 监视器 + 传输条（时间码、播放键、速度、质量）|
| `ui/clip-inspector.slint` | 右侧 DETAILS（CLIP / TRANSFORM / AUDIO & TIME；未选中时是 PROJECT / TIMELINE / CONTENTS）|
| `ui/lanes.slint` | 时间线：页签、工具栏、标尺、轨道头、片段、播放头、电平表 |
| `ui/theme/dark.slint` | 全部颜色（见 `web/concat-editor.css` 顶部那组 CSS 变量）|

### 左侧面板：十个页签 + 二级竖菜单 + 内容区

页签按剪映那一排排（「数字人」「智能包装」这两栏我们不做，跳过了）：

```
素材 音频 文本 贴纸 特效 转场 字幕 滤镜 调节 模板        »
```

十个都压到两个字，「`»`」把面板从 336 撑到 424。每个页签都是**左边一条二级竖菜单 + 右边内容区**，
内容区顶栏统一是「检索 / 布局（网格↔列表）/ 排序（默认·名称↑↓·分类）」，和剪映一条工具栏对得上。

| 页签 | 二级菜单 | 内容区 | 点一下 |
|---|---|---|---|
| 素材 | 导入⌄ / 全部素材 / 视频 / 音频 / 图片 / 语音 / 已处理 | 素材卡（缩略图、波形、时长） | 双击入轨 |
| 音频 | 工程音频 / 剪映曲库 | 工程音频卡；曲库是搜 + 试听 + ＋（芯片：音乐/音效/本机/收藏/最近） | ＋ 放进时间线 |
| 文本 | 文字片段 | 时间线上的文字片段卡 | 选中并跳过去 |
| 贴纸 | 基础图形 | 8 个图形格子（方块/圆/三角/星/心/箭头/多边形/直线） | `addShapeClip` 真落一条 3 秒片段 |
| 特效 | 全部 + 9 个分类架（Light/Cutout/Distort/Color/Film/Stylize/Blur/Retro/Basic） | 24 个包 | `updateClip` → `videoEffects` 真挂上 |
| 转场 | 全部 + 8 个分类架 | 22 个包 | `updateClip` → `transitionIn` 落在切入处 |
| 字幕 | 文字片段 / 自动字幕 | 同文本 + 导入 SRT/VTT + 按标点拆行 | `batch` 一批 `addTextClip` |
| 滤镜 | 全部 + 12 个分类架 | 57 个包 | `updateClip` → `videoEffects` 真挂上 |
| 调节 | 调节面板 | `concat.adjust` 的**全部 20 个参数**：13 根滑杆 + 3 个色轮 + 4 条曲线 | 拖完松手写一次 `updateClip` |
| 模板 | 模板 | 本机 `template.list` | 有占位就逐槽选文件 → `template.instantiate` |

页签、二级菜单、卡片都是同一份数据驱动的：`TABS` / `subRows` / `panelSource → panelItems`，
检索和排序作用在 `panelItems` 上，布局是 `.ce-cards` 的 `grid` / `list` 两个类。

### 贴纸/文字进不进帧（一条要更正的结论）

早先这里写过「`preview.frame` 不合成 shape 片段，加一条星形前后同刻帧 sha1 一致」。**那是误判**：
引擎的 `Titles::clips` 会把文字和形状都画成帧大小的透明 PNG（写在自己配置目录的 `titles/` 下），
再当普通图片片段合进去。我当时那台测试进程跑在受限身份里，`%LOCALAPPDATA%\app.concat.editor\titles`
写不进去，`painted()` 返回错误、片段被 `continue` 跳过，而引擎只 `log::warn` —— 于是「什么都没出现」。

复现清楚的做法（可写 `LOCALAPPDATA` 的进程）：

```
frame@1.2 before : c7fc9abbd8029015
addShapeClip（星形，red，#ff0000，width .4）
frame@1.2 after  : 60e0580e40dab362   ← 变了；titles/ 下当场多出 3 个 png+sidecar
```

所以现在页面上：贴纸、文字、图形**都进帧**；`/api/concat/health` 会在 `titles/` 写不进去时直接在
状态栏说出来（「引擎写不了文字/图形缓存 …：预览里会看不到文字和贴纸」），不再让人当成 bug 找。

配色直接取 `dark.slint` 的令牌：`panel #212123`、`page #151517`、`well #19191b`、
`lane #1a1a1c`、`lane-alt #1e1e20`、`ruler #171719`，强调色 lime `#cbf53f`（播放头同色），
素材色 video `#3373d1` / audio `#34c46f` / image `#9f63d6` / text `#cf5a99`，
每种素材再配一个更深的 `*-well` 作片段底色。

轨道按原生顺序自下而上排：视频在最下，音频、文字依次往上。

### 三栏的宽度和它们的坑

| 块 | 宽度 | 为什么 |
|---|---|---|
| 左素材栏 | 336px（≤1360 时 306，≤1180 时 272），点 » 变 424 | 原来 272 装不下五个页签，第五个「转场」被 `overflow:hidden` 直接裁掉 |
| 中监视器 | 剩下的全部，`min-width:360px` | 剪映里播放器就是最宽的一栏，别反过来压 |
| 右详情栏 | 300px（≤1360 时 272，≤1180 时 244） | 数值右对齐，长路径省略号截断 |

页签条 `.ce-tabstrip` 照剪映那条做：**一行等宽小格子**，图标在上（15px）、文字在下（10px），
页签封顶 64px 高 46px，`flex:1 1 0` 平分、`max-width:64px` 封顶；容器 `overflow-x:auto`
（不是 hidden），将来页签更多是横向滚，不是被切一半。`文字与字幕` 收成`文本`。

选中态和网页标签页不一样：**不做贴底鼓包**，只让图标换成强调色 lime `#cbf53f`、
文字转亮、配一层 `#ffffff12` 的浅底——剪映就是靠图标颜色告诉你现在在哪一栏。

最右那个 `»`（`.ce-tab-more`）把素材面板从 336 撑到 424，素材卡多排一列；再点变 `«` 收回。
它就一个 `leftWide` 布尔 + `.ce-pane-left.is-wide` 的宽度，没有别的机关。

实测（1600×1000）：折叠态 `pane=336 strip=336 scrollW=336`，五个页签各 58×46，
`»` 22px 顶在最右；展开态 `pane=424`，页签各 64（封顶生效）。选中项的图标实测算出来是
`rgb(203,245,63)`，未选中的是 `rgb(161,161,166)`。

监视器里那张图是引擎给的**画布尺寸预览帧**（`640×360` 就是 `640×360` 像素），
原先写 `max-width/max-height:100%`，`max-*` 只缩不放，所以帧永远只有 640 宽，
在一个 900 多像素宽的栏里飘着——这才是「中间太空、比例不对」的真因。
现在 `.ce-stage img` 是 `width/height:100% + object-fit:contain`，按画布比例撑满监视器，
两侧只留窄窄的黑边，和剪映播放器一个观感。

还有一个只有开壁纸时才出现的坑：整站有

```css
html[data-wallpaper="true"] :is(input, select, textarea, …) { background-color: … !important }
```

这条 `!important` 会把剪辑台里的输入框、下拉、搜索框刷成白板（浅色主题的值）。
`concat-editor.css` 顶部用 `.ce-shell` 提一级优先级扳回来，否则「搜素材」和「1× / 半清」
两个下拉在深色剪辑台里是两块白块。

## 引擎怎么起

```
concat-cli.exe serve --json 127.0.0.1:0 --token <32hex> --root <可写目录>
```

这一轮引擎源码动了一处：`preview.frame` 收 `nearest` / `proxy` 两个开关（`concat-api` 的
`message.rs` + `lib.rs`，把 `FrameSpec` 里本来就有、却一直被写死成 `false` 的两个字段接上）。
**但本机没能重编出新的 `concat-cli.exe`** —— 重编这套 workspace 缺三样东西：

1. `FFMPEG_DIR`（指向 `outputs/concat-validation/deps/ffmpeg/ffmpeg-n8.1.3-…`），
   否则 `ffmpeg-sys-the-third` 会去找 `pkg-config`（本机没装）；
2. `LIBCLANG_PATH`（`ffmpeg-sys` 的 bindgen 要 `libclang.dll`，全盘没找到）；
3. 编译 `ring` 的 C 部分时报 `cl error D8050（未能将命令行放入调试记录中）`，
   要加 `--config 'profile.dev.package.ring.debug=0'` 才过。

所以现在的 exe 还是旧的（`2026-11-10 12:21`），`nearest` / `proxy` 会被它当未知字段忽略
（实测：带着这两个参数请假面，照样 200 回一帧）。页面也还没切过去用 —— 等哪天在装好
libclang 的机器上 `cargo build -p concat-cli` 出新的 exe，`/api/concat/frame` 那条直通就生效。

- `:0` 让系统挑端口，真实端口从启动横幅读回（`Concat API 0.2: JSON-RPC on 127.0.0.1:50084`）。
- 令牌自己生成、自己用；页面拿不到，也不需要 —— 中继替它 auth。
- `--root` 是引擎**只允许写**的范围（新建工程、保存、导出、帧文件）；读不受限。
- 二进制默认 `<repo>/Concat/src/target/debug/concat-cli.exe`，可用 `WMD_CONCAT_CLI` 改；
  FFmpeg 目录用 `WMD_FFMPEG_BIN`。

## 页面调的原生方法与命令

| 交互 | 引擎调用 |
|---|---|
| 打开工程 | `project.open` → `project.document` + `project.get` |
| 拖动片段 | `edit.apply {op:"moveClips", moves:[{clipId,start,trackId}]}` |
| 拖两端裁剪 | `edit.apply {op:"trimClip", clipId, edge, delta, ripple}` |
| 切开（S） | `edit.apply {op:"splitClips", clipIds, time}` |
| 删除（Del） | `edit.apply {op:"removeClips", clipIds, ripple}` |
| 检查器改属性 | `updateClip` / `setClipTransform` / `setClipSpeed` |
| 轨道显隐、静音 | `setTrackFlag {trackId, flag:"visible"\|"muted", value}` |
| 撤销 / 重做 / 保存 | `edit.undo` / `edit.redo` / `project.save` |
| 监视器画面 | `preview.frame`（无 `output` 时回内联 base64 PNG） |
| 导入素材 | `POST /api/concat/pick` 拿路径 → 逐个 `media.import {path, file}` |
| 导出 | `export.run {path, output, crf}` → 轮询 `export.status {job}`，`export.cancel {job}` 取消 |
| 新建工程 | `project.create {location: engine.root, name}` → `project.list` 认出目录 → `project.open` |
| 新建时间线 / 轨道 | `edit.apply {op:"addTimeline"}` / `{op:"addTrack"}` |
| 切时间线 | `edit.apply {op:"selectTimeline", timelineId}` |
| 写入文字（文本/字幕） | `edit.apply {op:"addTextClip", above, start, duration, style:{content}}` |
| 改文字 | `updateClip {patch:{text:{…原样式, content:"新词"}}}`（引擎整份替换样式，所以要带上原样式的其余字段） |
| 转场 | `updateClip {patch:{transitionIn:{id, duration}}}`（写在**后一条**片段的切入处） |
| 挂特效 / 滤镜 / 调节 | `updateClip {patch:{videoEffects:[…]}}`（整链替换；参数是 `params` 里的键值，包 `enabled`） |
| 调节：色轮 / 曲线 | 同一个 `params` 里的**点号键**：色轮 `lift.x / lift.y / lift.m`，曲线 `luma.0.x … luma.7.y` |
| 画面链参数 | `updateClip` 写 `videoEffects[i].params`；可动参数（manifest 的 `animate`）另有 `keys` |
| 片段关键帧 | `edit.apply {op:"setClipKey", clipId, property, at, value}` / `clearClipKey` / `clearClipKeys`（`at` 是片内 0..1） |
| 效果参数关键帧 | `edit.apply {op:"setEffectKey", clipId, entry, key, at, value}` / `clearEffectKey` |
| 遮罩 | `updateClip {patch:{mask:{shape,x,y,width,height,rotation,roundness,feather,invert}}}`，`mask:null` 去掉 |
| 贴纸 / 基础图形 | `addShapeClip {above, start, duration, name, style}` |
| 存为模板 | `template.save {path, name}` → `template.list` |
| 按模板建工程 | `template.instantiate {template, location: engine.root, name, fills:[{mediaId, file}]}` |
| 字幕批量落字 | `edit.apply {op:"batch", commands:[addTextClip…]}`（一条命令一个撤销步） |

色轮和曲线为什么是点号键而不是数组：引擎 `AppliedFilter.params` 是 `BTreeMap<String, f64>`，
compound 旋钮（`ParamType::Wheel` / `Curve`）就靠带前缀的浮点键值传进 shader——
`manifest.rs` 里写死了 `x / y / m` 与 `<n>.x / <n>.y`（曲线最多 8 点，`MAX_CURVE_POINTS`）。
页面照这套键名读写，所以曲线「点一下加点、拖点改、双击去掉、↺ 复位成直线」存的都是这几个键。

## 时间线的声音，以及那个「播放头不动」的坑

引擎只给 `preview.frame`（一帧 PNG），不给预览用的混音流。所以播放声音由页面自己拼：

- 每个有声音的片段一条 `<audio>`，`src=/api/concat/assets/media?path=<原文件>`（Range 直出）；
- 播放循环每帧把每条对到 `sourceStart + (播放头 − 片段入点)`，偏差超过 0.25 s 才重新对齐；
- 所有元素接到一条 `AnalyserNode` 上，电平表的高度就是它的 RMS（-60 dB 映射到 0…100 %）。
- 播放头本身还是 PNG 逐帧（`preview.frame`），音频和画面同源同时间轴。引擎这一帧是**合成过**的：
  画面、文字、贴纸/形状都在里面（见上面那条更正），所以「看得见字、看不见图形」不是引擎的缺口。

坑：早期的播放循环写成 `next = 播放头 + dt; 播放头 = floor(next, 帧)`。播放头自己已经是取整过的，
再用它当累加基准，24 fps 下 `dt≈16.7 ms` 永远小于一帧 `41.7 ms`，`floor` 每次都落回同一帧 ——
**播放头原地不动**。现在另存一个不取整的游标 `playCursor`，播放头只是它的取整显示；`seek` 时把游标一起搬。
实测：点播放 2.4 s 后 `00:00:02.21`，电平表 32 %。

Range 实测（`quiet-piano.wav` 3.4 MB / `real-cafe.mp4`）：

```
Range: bytes=0-2047   → 206  audio/wav   Content-Range: bytes 0-2047/1411244
无 Range               → 200  audio/wav   Accept-Ranges: bytes
Range: bytes=100-999  → 206  video/mp4   Content-Range: bytes 100-999/914616
path=…nope.txt        → 400  不是音视频文件：nope.txt
```

## 缩略图与波形从哪来

引擎的 21 个方法里没有它们 —— 原生窗口是在自己进程里现算的。浏览器要显示素材卡和
波形，只能让服务端算一次并缓存：

- `GET /api/concat/assets/thumb?path=&t=&w=` → JPEG（FFmpeg `-ss … -frames:v 1`，磁盘缓存）
- `GET /api/concat/assets/wave?path=&b=` → `{peaks:[0..1…]}`（FFmpeg 出 4 kHz 单声道 s16le，算包络）

实测：缩略图首次 213 ms、命中缓存 9 ms；8 秒音频算 400 个峰值 96 ms。
波形在页面里画成 `viewBox="0 0 1000 100"` 的路径，所以缩放时间线不用重算。

## 为什么放置数学在前端
实测：引擎对**同一轨道上移到与别人重叠的位置**是静默 no-op —— 不报错、不改变、`canUndo` 不变。
换轨时才会被推到目标轨的空位。所以吸附、避让、落位、拖边夹紧必须由
`web/concat/placing.js` 先算好，再把一条引擎听得懂的命令发过去。

这个文件是纯函数（无 DOM、无网络），单测在 `tests/concat-v1.test.js`。

## 键位

| 键 | 动作 |
|---|---|
| 拖片段 / 拖两端 | 移动 / 裁剪（吸附到相邻片段、播放头、0；按住 Alt 关吸附） |
| 空格 | 连播：画面逐帧取 `preview.frame`，声音由 `<audio>` 同步（不是合成播放，见上） |
| ← / → | 逐帧 |
| Home / End | 跳到开头 / 结尾 |
| S | 在播放头处切开（没选中就切播放头下面的片段） |
| Delete / Backspace | 删除选中 |
| Ctrl+Z / Ctrl+Y | 撤销 / 重做 |
| Ctrl+S | 保存 |
| Ctrl+滚轮 | 以时间线中点缩放 |
| / | 光标跳到当前页签的检索框 |

## 实测数字（本机，debug 构建）

| 调用 | 延迟 |
|---|---|
| auth | 6–16 ms |
| `project.open` | 280–345 ms |
| `project.document` | 1.2 ms（5.8 KB JSON） |
| `edit.apply` / `undo` / `redo` | 各约 1 ms |
| `preview.frame` 320×180 | 82–90 ms |
| `preview.frame` 640×360 | 300–318 ms |
| `preview.frame` 960×540 | 665–760 ms |
| 冷启第一帧 | 2.8–3.4 s（GPU/合成器初始化） |
| 导出 10 s 片子 480p | 8.4 s（1.19× 实时） |

这一轮补完缺口的实测（真浏览器 + 真引擎，10 s / 6 片段 / 640×360 工程）：

| 动作 | 结果 |
|---|---|
| 文本页签打字回车 | 片段 6 → 7，`c6` 文字片段落在播放头，状态栏 `已放入文字片段（00:00:00.12，3 秒）` |
| 改文字 | 片段名跟着第一行变，字体/字号/颜色都留着（`Hanken Grotesk 0.09 #ffffff`） |
| 转场 | 卡片出现「已用」角标，`transitionIn = {id:"concat.blur-dissolve", duration:1}`，详情栏出现「转场」分组 |
| 挂滤镜 → 摘滤镜 | 画面链出现 `Adjust` → 点 ✕ 后消失，状态栏 `已移除「Adjust」` |
| 存为模板 | `template.list` 从 0 变 1，卡片出现「缺口探针模板 640×360」，页签计数 `模板 1` |
| 导出 | 进度 26 % 渲染画面 → 84 % 混音 → `导出完成：…\导出-20261111-140111.mp4（640×360）`，文件 1.3 MB |
| 取消导出 | 进度条上的「取消」→ `已取消导出`，按钮回到「导出」 |
| 播放 | 播放头 `00:00:02.21 / 00:00:10.00`，`<audio>` 在放（currentTime 0.48 → 0.56 → 0.66），电平表 25–32 % |
| 新建轨道 / 时间线 | 轨道头 4 → 5；时间线页签 2 → 3 并可点回，切回后片段 6 条完好 |

导出、模板这两条要引擎能写自己的位置：导出写工程目录（在引擎 `--root` 之下），
模板写 `%APPDATA%\app.concat.editor\templates\`。后者被拒时页面照实显示引擎原话：

```
存不了：could not create …\app.concat.editor\templates\缺口探针模板\assets: 拒绝访问。 (os error 5)
（引擎要能写自己的配置目录 templates/）
```

所以拖动跟手用 360 宽、松手补一张清楚的 —— 这就是「低清跟手 + 全清落定」。

## 还没做（下一步，按优先级）

1. **合成播放的最后一档**：现在仍是「PNG 帧 + 独立音轨同步」——帧是引擎合成的（文字/贴纸都在），
   但音画是两条独立时间轴对出来的，快进快退时有几十毫秒的相位差。真要连播成片，得用
   `export.run` 出一段低清 mp4 给 `<video>` 播，缺口是「编辑后何时重编」。
   引擎侧已经开了口子：`preview.frame` 现在收 `nearest` / `proxy`（草稿拖播放头用 `nearest=1`，
   跟手用 `proxy=1` 读代理档），页面还没切过去。
2. **自动字幕（转写）**：引擎有 `concat-speech`（whisper）但本机没下模型（`models/` 只有 manifest），
   API 也没有转写方法。所以现在能进的是 **SRT/VTT 导入** 和 **按标点拆行**，不是语音识别。
3. **抠像的画笔**：抠像面板已经能用（模式 / 主体 / 羽化，走 `setClipCutout`），但「自定义」模式真正的
   价值在于在监视器上补笔画（`addCutoutStroke`）——那需要在画面上画，还没做；不画笔画时
   「自定义」和「自动」是一回事，面板里就这么写着。
4. **防抖 / 人声分离**：`setClipStabilize` 与 `setClipVoice` 引擎都有命令，页面还没有面板。
5. **曲库三期**：分类（12 个题材词）已经能用，还差试听波形与「推荐流」（`lyra recommend`）。
6. **导入对话框**：`POST /api/concat/pick` 弹的是 Windows 原生框，无头/远程桌面里跑不了（会超时）。
   批量导入已经改成一次请求 8 条（`callMany`），但仍是引擎串行处理。
7. **模板包的资产打包**：`template.save` 要把媒体复制进 bundle，配置目录不可写时会失败（页面照抄引擎原话）。

## 自检

`web/integrations/concat-v1.html`（免登录）可以直接挂起剪辑台：

```
/integrations/concat-v1.html?project=<工程目录>&select=c2&t=1.5
/integrations/concat-v1.html?project=<工程目录>&check=drag      # 派发真实指针事件拖一段
/integrations/concat-v1.html?project=<工程目录>&check=split
/integrations/concat-v1.html?project=<工程目录>&check=undo
/integrations/concat-v1.html?project=<工程目录>&check=music      # 曲库搜「治愈」→ 下载 → 放进时间线
/integrations/concat-v1.html?project=<工程目录>&check=musicview  # 只切到曲库并搜一次（截图用）
```

`check` 的结果写在页面顶部那行 note 里，配合 `chrome --headless --dump-dom` 就能断言。

版式有三条会真的咬人的断言，落在 `tests/concat-v1.test.js` 的「版式自检」里：
页签条必须是 `overflow-x:auto` 且页签平分（不许再出现固定 `min-width:56px` 把第五个挤出去）、
监视器必须是 `object-fit:contain` + `width/height:100%`（不许用 `max-*`，`max-*` 不会放大）、
壁纸那条 `!important` 必须被 `.ce-shell` 覆盖掉。

这一轮补的缺口每条都有断言（同一文件末尾「缺口修复」那几组）：导入走 `POST /api/concat/pick`
而不是 `<input type=file>`、导出三方法齐全且输出落在工程目录、打字走 `addTextClip` 且改字带上原样式、
转场写 `transitionIn`、模板能存且 `slots` 按数组算、`playCursor` 不许退回「取整后累加」、
电平表高度由数据给、新建工程/全屏/预览质量/`/` 聚焦都真接上。合计 **59** 条
（54 条页面/服务端断言 + 5 条真引擎链路）。

二期这一批（检查器 / 模板填槽 / 字幕 / 框选 / 曲库 / 自检）同样每条有断言，实测都在真浏览器里跑过：

| 动作 | 断言到的事实 |
|---|---|
| 色轮拖拽（真 pointer 事件） | `concat.adjust.params` 里出现 `lift.x: .664 / lift.y: -.747`，松手才写一次 |
| 曲线点空处 | 3 个点写成 `luma.0.x … luma.2.x`，页面画成带拐点的平滑曲线，↺ 复位成直线 |
| 调色板规模 | `sliders 13 / wheels 3 / curves 4`（引擎目录的 20 个参数一个不落） |
| 片段关键字帧 | `keys: [{property:"scale", at:.39, value:1}]`，◆ 变实心，状态栏 `已给「缩放」打点（36% / 值 1）` |
| 效果参数关键帧 | `videoEffects[i].keys = {lift:[{at:0, value:0}]}`（`setEffectKey`，`animate` 才给 ◆） |
| 遮罩 | 星形 + `feather .3 / rotation 15 / width .78` 写进 `mask`，预览里就是一顆羽化星形里套着画面 |
| SRT 导入 | 3 条 cue → 片段 6→9；多行、`00:00:02,400` 逗号毫秒都认，一条 `batch` 一个撤销步 |
| 按标点拆行 | 30 字 → 5 条，从播放头 8.00 s 排到 15.10 s |
| 框选 | 空白处拖一个框 → `selection 5`，状态栏 `框选 5 段` |
| 曲库收藏 / 最近 | `musicFav 1 / musicRecent 1`，`localStorage` 的 `wmd.concat.music.fav / .recent` 各 1 条 |
| 批量导入 | 一次请求 8 条 `media.import`，`{done:1, failed:0}`（同文件已在素材箱 → 引擎不重复加） |
| 模板填槽 | `setMediaPlaceholder` → `template.save` 出 `slots:[{mediaId:"m1", kind:"video", seconds:9.5}]` → 逐槽填文件后 `template.instantiate` 建出工程并打开：`outputs\填槽探针 副本`，14 条片段 |
| 环境自检 | 引擎没起时 `warnings:["引擎没起来…"]`；起来后 `warnings: []` |
| 抠像 | 详情栏选「主体 = 人」+ 羽化 0.02 → 文档里 `cutout: {mode:"auto", subject:"person", feather:0.02}`；「去掉抠像」→ `null`（走 `setClipCutout`，不是 updateClip 的补丁） |
| 曲库分类 | 音乐 12 个题材词 / 音效 10 个，点「治愈」→ `musicQuery="治愈"` → 联网命中 **24 条**（分类复用 `searchMusic` 那条路） |
| `nearest=1` 直通 | `/api/concat/frame?...&nearest=1` → 200、407 KB PNG（旧 exe 忽略这个开关，不会报错） |

要肉眼量就看 runtime 里量出来的数字（1512×950 / 1706×1018 / 1240×820 / 1120×800 各量一遍）：
`stripW == scrollWidth` 就说明没有页签被裁；`img` 的宽高比恒等于 `640:360` 就说明没被拉变形。
