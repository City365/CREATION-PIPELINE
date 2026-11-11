# JianYing-Automatic-editing

程序化控制剪映（CapCut 专业版）做视频剪辑的完整工具包。

Agent 通过 **MCP** 调用，全流程覆盖：搜素材 → 下素材 → 建草稿 → 拼片段 → 加转场/特效/文本/音频/关键帧 → 部署到剪映 → 导出。

---

## 能做什么

| 能力 | 通道 | 状态 |
|---|---|---|
| 搜索剪映曲库（原生联网，跟 App 内搜索一致） | `lyra-cli` | ✅ |
| 搜索 34 类素材（模板/贴纸/特效/滤镜/转场/字体/花字…） | `lyra-cli` | ✅ |
| 下载素材到本地（免费 + VIP 曲目） | `lyra-cli` | ✅ |
| 建草稿、导入片段、拼接、裁切、变速 | `pyJianYingDraft` | ✅ |
| 转场、特效、滤镜、动画、关键帧 | `pyJianYingDraft` | ✅ |
| 文本、字幕、字体、文字动画 | `pyJianYingDraft` | ✅ |
| 音频/BGM、音量、淡入淡出、人声闪避 | `pyJianYingDraft` | ✅ |
| 部署到剪映草稿列表 | PowerShell 复制 + 注册 | ✅ |
| 无头导出成片 | `jy-draftc`（可选） | ⚪ 需额外放置 |
| 语音识别 / 自动字幕 | `lyra-cli media asr` | 🔍 已定位，未接 MCP |

---

## 目录结构

```text
JianYing-Automatic-editing/
├── README.md                  ← 你在这里
├── docs/
│   ├── 00-攻坚全记录.md        ★ 从零到打通的完整纪实（先看这个）
│   ├── 01-快速开始.md          30 秒跑通第一个剪辑
│   ├── 02-MCP使用手册.md       21 个工具逐个说明 + 客户端配置
│   ├── 03-原生素材通道.md      lyra-cli 授权绕过 + 全部命令
│   ├── 04-实现流程.md          两条技术路线的取舍与设计
│   ├── 05-问题排查日志.md      17 个坑的成因、定位过程、解法
│   ├── 06-环境配置.md          依赖、路径、版本
│   ├── 07-维护指南.md          剪映升级后怎么修
│   └── 08-综合技术档案.md      长文总档：草稿格式、DLL 逆向、全部试错
├── src/
│   ├── mcp_server.py          MCP 服务入口（stdio JSON-RPC，21 工具）
│   ├── server.py              底层实现 + HTTP REST（14 端点）
│   ├── lyra.py                原生素材通道（自动定位 + 自动 patch）
│   ├── jydll.py               草稿加解密
│   ├── build_music_index.py   本地曲库索引（离线兜底）
│   ├── jyedit.py              spec.json → 草稿
│   └── e2e_native.py          端到端演示脚本
├── re/                        二进制逆向工具（可复用）
│   ├── find_lea.py            RIP-relative 引用查找
│   ├── disasm_range.py        PE 按 RVA 反汇编
│   ├── strs.py / dump_range.py
│   ├── pe_exports.py / vtable_dump.py
│   └── engine_api.py          PE 导出表解析
├── env/
│   ├── requirements.txt
│   ├── setup.ps1              一键环境自检 / 安装
│   ├── deploy.ps1             草稿部署（原生 PowerShell，绕开权限限制）
│   └── mcp-config.json        MCP 客户端配置样例
├── output/                    运行时产物（下载素材、草稿、补丁副本）
└── logs/                      运行日志
```

---

## 30 秒上手

### 1. 环境自检

```powershell
powershell -ExecutionPolicy Bypass -File env\setup.ps1
```

全部 `[OK]` 就能用。缺依赖加 `-Install`。

### 2. 直接命令行跑一次搜索

```powershell
cd src
..\..\.venv-jianying\Scripts\python.exe lyra.py search music "温暖 钢琴 治愈" 5
```

### 3. 接进 MCP 客户端

把 `env\mcp-config.json` 的内容合并进客户端配置：

- Claude Desktop → `%APPDATA%\Claude\claude_desktop_config.json`
- Cursor → `%USERPROFILE%\.cursor\mcp.json`
- 其它客户端见 `docs\02-MCP使用手册.md`

### 4. 让 agent 干活

```text
music_search   keyword="温板治愈的钢琴"  limit=5
music_download resource_id="<从上面拿>"
draft_create   name="治愈短片"  width=1080  height=1920
video_add      draft="治愈短片"  path="D:\素材\a.mp4"  duration=3
audio_add      draft="治愈短片"  path="<下载的 m4a>"  volume=0.6  fade_in=1.2
text_add       draft="治愈短片"  text="她等了 99 天"  start=0.4  end=3.0
draft_deploy   draft="治愈短片"
```

> `draft_deploy` 在 Python 子进程里可能因权限失败（见 `docs/05-问题排查日志.md` P12）。
> 失败时用原生 PowerShell 补救：
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File env\deploy.ps1 -Name "治愈短片"
> ```

---

## 关键事实

| 项 | 值 |
|---|---|
| 剪映版本 | 11.5.0.14471（控制目标） |
| 剪映安装目录 | `D:\notebook\software\JianyingPro\11.5.0.14471` |
| 草稿根目录 | `D:\notebook\software\JianyingPro Drafts` |
| 草稿索引 | `%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\root_meta_info.json` |
| Python | 3.12.11（`.venv-jianying`，项目根目录下） |
| pyJianYingDraft | 0.3.0 |
| capstone | 5.0.9 |
| ffmpeg | 6.1.1（`D:\notebook\software\ffmpeg\bin`，可选） |
| MCP 工具数 | 21 |

**剪映草稿是明文 JSON**（`draft_content.json`），不是二进制。这是整条路线成立的根本原因。

---

## 核心原理（一句话版）

1. **写草稿**：`pyJianYingDraft` 直接构造 `draft_content.json`，剪映打开即认。不点界面、不需要剪映运行。
2. **搜素材**：`lyra-cli.exe` 是剪映自带的官方 CLI，但它有一个「必须是剪映拉起的进程」校验（`-100015`）。把校验分支的 `jne` 改成 `jmp`（1 个字节）就通了 —— **这是整件事最关键的一刀**。
3. **部署**：草稿目录 + 索引文件都是普通文件，`Copy-Item` 就完成。

---

## 文档导航

| 你想知道 | 看 |
|---|---|
| **整个事情是怎么做成的** | **`docs/00-攻坚全记录.md`** |
| 怎么第一次跑通 | `docs/01-快速开始.md` |
| 21 个工具怎么用 | `docs/02-MCP使用手册.md` |
| 搜/下素材怎么写 | `docs/03-原生素材通道.md` |
| 为什么这么设计 | `docs/04-实现流程.md` |
| 某个错怎么解 | `docs/05-问题排查日志.md` |
| 换机器怎么装 | `docs/06-环境配置.md` |
| 剪映升级了怎么办 | `docs/07-维护指南.md` |
| 全部技术细节 | `docs/08-综合技术档案.md` |

---

## 迁移说明

本目录是 `tools/jianying-api/` 的独立维护版本。

代码里的项目根路径已从 `__file__/../..` 改为 `__file__/..`，因此可以整体搬走、独立运行。

原 `tools/jianying-api/` 仍然保留可用（供 `tools/ffmpeg-timeline/`、`tools/jianying-scheduler/` 联动），两者互不影响。
