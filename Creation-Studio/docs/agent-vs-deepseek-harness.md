# 智能体对比清单：创作台 vs DeepSeek Harness

对照对象：本机 `DeepSeek Harness` 桌面版（Electron + cordis 插件化 monorepo，约 240 个 `@deepseek-ai/dsh-*` 包，已解包到 `Creation-Studio/_tmp/dsh-src/`，每个包自带中文设计文档 `README.zh.md`）。
对照范围：`@` / `/` 交互 · 计速 · 上下文压缩 · 技能，外加轮次语义与运行态展示。

**这是一张台账，不是工作汇报。** 用法：

| 章节 | 用途 |
|---|---|
| §0–§6 | 六个主题逐项对比，「差距」表带状态列（✅ 已消除 / ◐ 部分 / ❌ 仍缺）与「现在怎么做的」 |
| **§7** | **差距总台账**：已落地清单 / 仍缺按该不该做排序 / 判定不学并附理由。**要动手先看这里** |
| §8 | 反向：我们有、DSH 没有 |
| **§9** | 推进记录 + 下一轮该做什么 |
| §10 | 我们的 SSE 事件全清单（含 3 处死分支） |
| §11 | 实现档案：只记「为什么这么做」和「怎么验的」 |

维护规则：**每消除一条差距，回头改 §0–§6 的对应行和 §7.2，不要另起一章写「本轮已落地」**。上一版就是把台账写成了流水账——后面九章全在说「我做了什么」，而前面的差距表还停在改前一天，等于同一份文档同时撒两个谎。

---

## 0. 先看清我们自己的架构事实

这一节必须先摆出来，否则后面所有对比都会跑偏。

**两套引擎，共用同一个内核。**

`runtime.execute()` 不是另一套实现，而是把 `_chat()` 包了一层：run_store 记账、预算硬闸、租约与 deadline、事件持久化、恢复检查点、技能冻结、权限归属校验。所以 harness = legacy 内核 + 一层运行生命周期。

| | legacy | harness |
|---|---|---|
| 启用条件 | `HARNESS_RUNTIME_ENABLED=0` 时回退 | **默认**；`HARNESS_PROJECT_DENYLIST` 排除个别项目 |
| 入口 | `main.py` 的 `_chat()` | `main.py` → `runtime.execute(req, project, lambda: _chat(...))` |
| 上下文 | `assemble()` + `trim_to_budget()` | 同左，外加自动压缩 |
| token 累计 | `receipt['usage']` 只保留最后一次 | `BudgetLedger.publish()` **累加** + `budget` 明细 |
| 每模型调用计时 | 无 | `model_started` / `model_finished{duration_ms,usage}` |
| 事件持久化 | 内存缓冲 + 落 `run_events` | 同左，另落 `harness_events` 可重放 |
| 回执终止事件 | `done` | `run_finished` |

**2026-11-10 之前产品跑的是 legacy。** 原因不是配置忘写，而是 allowlist 这个机制本身不适合产品级：项目 id 是用户新建项目时才生成的，永远不可能预先列进启动脚本。改成默认全开之后，真模型跑一轮实测：

```
terminal=run_finished   events=142   engine=harness/2.0
outcome=succeeded       reason=validated_complete
turn.stats   3 次模型调用 · 2 次工具调用 · 587 tokens · 1013.8 tok/s
budget       usage_complete=true · input 26750 · output 587
event_stream ok=true / 108 事件      projection identical=true / 109 事件
```

legacy 报不出这里面任何一项用量数字，因为它从来不累加。

**SSE 信封**：所有帧只有 `data: {json}`，**没有 `event:` 行**，事件名在 `json.type` 里。前端消费在 `web/app.js` 的 `askApplyEvent()`。全清单见 §10。


## 1. `@` 提及

### 我们怎么做

| 环节 | 实现 | 位置 |
|---|---|---|
| 触发判定 | 要求「行首或空白紧跟 `@`」且光标无选区 | `app.js:9470-9472` |
| 状态 | `a.mention = {start, end, query, index}` | `app.js:9476` |
| 候选 | `askMentionItems()` = 技能 + 附件 + 工作区文件，拍平成一个数组 | `app.js:7635-7654` |
| 拉文件 | `askLoadWorkspaceFiles()` 递归 `/api/agent/workspace/tree?path=`，深度 ≤4、≤400 个、60s 缓存 | `app.js:7603-7626` |
| 分组 | 按 `kind` 造两组：「创作视角」/「项目文件」，标题显示项数 | `app.js:7662-7690` |
| 键盘 | ↑↓ 取模循环，Tab/Enter 确认，Esc 关闭 | `app.js:9710-9714` |
| 选中技能 | `a.skillId = id` + 把 range 换成 `@技能名 ` + 更新 chip | `app.js:9486-9508` |
| 选中文件 | **只写 `@path ` 纯文本，不产生附件、不写 `file_ids`** | `app.js:9510-9528` |

实打实的缺陷：

1. **带空格的路径根本选不到**。正则 `[^\s@]*` 到空格就断，`@"..."` 这种写法不存在，所以路径里有空格的素材永远进不了候选。
2. **选中即纯文本**。不是原子引用，改一个字就变成别的路径；后端也只是把它当提示词，不会附带内容。
3. **只有一个 source**。技能、附件、工作区文件挤在同一个扁平列表里，靠分组标题区分。
4. **没有下钻**。文件夹 `kind==='directory'` 在 `askLoadWorkspaceFiles` 里被递归展开然后丢弃，用户看不到层级。
5. **没有重开抑制**。只要 `a.mention` 为 null 且正则命中就重建，光标一动菜单又回来。
6. **没有空格/回车仲裁**。`/` 只有在「整个输入框恰好是 `/^[a-z]*$/`」时才有命令面（`app.js:9468`），一打空格就退出。

### DSH 怎么做

`dsh-client-ui-input-trigger` 是**注册制流水线**，`/` 和 `@` 共用一套内核：

- `src/core/` 纯函数内核（触发器检测、菜单归约、精确匹配），零 React / 零 DOM / 零 cordis；`src/client/service.ts` 才接到菜单快照存储与 pick 路径。
- source 带 `lexicon` 词表，词表变了实现 `subscribeLexicon`，控制器收到通知重拉。
- 候选拉取以 **generation 把关**、`AbortSignal` 取代后继请求；失败的 source **静默丢弃**，只留一条 console。
- 行结构：图标 + `label`（无则 `name`）+ 大小写别名 + 右对齐说明；**查询同时匹配 name 和 label**。

交互细节（「不呆瓜」的真正来源）：

| 机制 | 行为 |
|---|---|
| `drill: true` | Tab / 行尾 chevron 以 `action:'drill'` 下钻，**不选定**；回车或点行主体才是 `pick` |
| `header` 钩子 | 每次命中用实时查询重问，出**面包屑**；点面包屑 `action:'drill'` 回该层 |
| `matchSpace` / `matchEnter` | 按注册序轮询，第一个非 `undefined` 应答胜出；source 可拒绝它无法整体消费的提交 |
| `matchClaim` | 恢复持久化命令 chip，**只应答 claim**，绝不开弹窗 / 跑动作 / 执行命令 |
| 关闭即保持关闭 | 同一 token 同查询重新 track **不会重开**；换 token 或改查询才重新武装 |
| launcher | 从按钮打开时**先把键盘还给编辑器**再开菜单 |
| 焦点 | composer 保持焦点，`aria-activedescendant` 承载高亮 |
| 指针 | mousedown 即 pick；落在菜单与 composer 卡片之外关闭 |

`dsh-client-ui-reference` 挂两个 source：`@file` 与 `@session`（先文件后会话，一组挂了另一组照常）。文件行省略多余根目录；会话行仅在工作区不同时显示工作区。

`dsh-file-reference` 定语法：

- `@path` 只在**开头或空白之后**触发（邮箱里的 `@` 不触发）。
- `@"path with spaces"` 开引号式 mention；目录候选在尾斜杠后**保持引号打开**，可继续下钻。
- 格式化器拒绝含控制字符或内嵌引号的路径。
- **选中绝不读取或附带文件内容**——只是提示词文本，模型必须自己调 `read`。
- 浏览器不扫文件系统：候选取自宿主 `ctx.fileReferences.list(agent, query, signal)`，与模型能读的 `read` 工具同命名空间。

### 差距

状态：✅ 已消除 ｜ ◐ 部分 ｜ ❌ 仍缺（截至 2026-11-10）

| 项 | 我们原来 | DSH | 状态 | 现在 |
|---|---|---|---|---|
| source | 1 个（三类混排） | 文件 / 目录 / 会话 / 技能四个独立 source | ❌ | 仍是单 source，`askMention` 里三类混排 |
| 语法 `@"path"` | 无引号规则，空格即断 | `@path`、`@"path"`、`@"dir/` 开放式 | ✅ | 引号包路径，带空格的可选 |
| 目录 | 递归后丢弃层级 | drill + 面包屑 | ❌ | 仍拍平 |
| 原子性 | 纯文本，`file_ids` 不写 | 原子行内 chip + 稳定剪贴板形式 | ❌ | 仍纯文本回写 |
| 空格/回车 | 无仲裁 | `matchSpace`/`matchEnter` 仲裁 | ✅ | keydown 里加 `' '` 仲裁 |
| 重开抑制 | 无 | 有 | ✅ | `a.mentionClosed`，选中后不再弹出 |
| 内容 | 选中即引用 | 只给路径，内容靠工具读 | ◐ | 仍选中即引用，靠附件摘要兜 |

---

## 2. `/` 斜杠命令

### 我们怎么做

- 按钮 title 写死「快捷命令：/model /think /compact」（`app.js:7486`）。
- `askCommandItems()`（`app.js:7582`）：`mode==='model'` → 模型列表；`mode==='think'` → 强度列表；否则固定三项 `{model, think, compact}`（`app.js:7587`），过滤是 `c.id.includes(q)`（`app.js:7589`），**无分组**。
- 派发 `askChooseCommand()`（`app.js:9429-9453`）：`compact` 走 `confirm()` 再调 `POST /agent/sessions/{sid}/compact`。
- 输入框识别：`/^\/[a-z]*$/` 整框匹配（`app.js:9468`），别的一律当普通文本发出去。

问题：想加第 4 个命令要改**两处**（`askCommandItems` 的数组 + `askChooseCommand` 的分支），还得同步按钮 title。没有目录接口、没有 fuzzy 排序、没有说明文字、不区分「客户端动作」和「宿主执行」。

### DSH 怎么做

两层：一层管语义，一层管交互。

**`dsh-commands`（宿主注册表）**

```text
ctx.commands.register({
  name: 'plan',
  description: 'Enter plan mode',
  input: { hint: '<message>' },
  handler: ({ agent, rawInput }) => { ... return { kind:'success', text:'plan mode selected' } },
})
```

- handler **直接对 agent 生效，不产生模型消息**；返回 `success` / `error` + 适配器渲染的 UI 文本。
- 语法：第 0 字节必须是 `/`，随后小写名（字母数字 `_` `-`），再之后是输入末尾或空白；名称后**每个字节都是 `rawInput`**。
- **不符合语法或名字未知的行被拒绝，不会降级成提示词**。
- 生命周期：`command/run` → `command/done`，带 `commandId` 配对；`recordInput:false` 时命令自己拥有权威领域事件。
- 作用域：全局层 + agent 层；同层重名注册直接抛错；agent 层只遮蔽同名全局。
- 附件：声明 `input.attachments` 才收；图片 base64 进 wire，通用文件走凭证，**命令提交不会重读文件字节**。

**`dsh-client-ui-commands`（客户端）**

四类派发：`leadingInput`（带 `input` 的宿主描述符，开输入）/ `popupSelect`（`/model` `/permission`，开选择弹窗）/ `action`（回调）/ 其余 `execute`。

- 命令目录**按会话缓存**；拉取要等「首次历史打开成功」才发 RPC，未持有会话直接拒绝，**后台刷新不会重新打开已关闭的会话**。
- 查询：不区分大小写**有序子序列**匹配 name 与 label，前缀优先；`searchMode:'fuzzy-label'` 可选（`/model` 用），其他默认 `substring`。
- 选项可 `group:{name,label}`；同名归组、组序按首次出现、**查询隐藏较早行也保持组序**、空组隐藏。
- `searchLabels()` 定制占位 / 空目录 / 无匹配文案，**一个弹窗的文案不会沿用到下一个**。
- `+` 按钮和键入 `/` 打开**同一个菜单**：「添加」（文件、目标、计划、反馈）+「指令」（压缩、权限、模型、下载日志），**空查询按使用频次排序**。
- 带附件提交时只有声明 `input.attachments` 的命令继续，其余抛 `attachmentsUnsupported`（toast），**草稿与附件卡原位保留**。

### 差距

我们是「三个 if 分支 + 一个正则」，DSH 是「注册表 + 会话级目录缓存 + 四类派发 + 可装饰（给既有命令加弹窗但保留其参数声明）」。加命令的成本差一个量级。

**现状（✅ 已消除）**：`COMMANDS` 注册表 + `GET /agent/commands`，前端只读这份表，加命令改一处。四类派发（`popup` / `action`）已落地，别名与装饰器未做（我们的命令只有 4 条，暂时用不上）。

两处对齐 DSH 的细节（2026-11-10）：

- **`/compact` 不再弹浏览器原生 confirm**。压缩是可恢复的（历史原文仍在，只多一张摘要卡片），结果还立刻可见，用不着拿「确定/取消」再问一遍。原生 confirm 只留给删任务/删项目这类不可恢复操作。DSH 的 `/compact` 也没有确认，只有 busy 时拒绝。
- **命令面板不预选第一项**。只打一个 `/` 时四项全列但不高亮——用户可能只是想看看有哪些命令，此时按回车不该执行 `/model`。输入到 `/c` 这种有意图的过滤词才高亮匹配项。实测：`/` → 4 项 0 高亮；`/c` → 只剩 compact 并高亮；`/t` → think+compact 并高亮 think。

---

## 3. 计速（token / 速率 / 耗时）

### 我们怎么做

**采集了一大半，展示了一小部分。**

| 字段 | 生产方 | 口径 |
|---|---|---|
| `receipt.first_token_ms` | `main.py:429-430` | 首个有文本的 chunk 时 `tick() - started_at`，**从 run 开始算，含准备与工具时间** |
| `receipt.duration_ms` | `main.py:537-538` | `finally` 里 `finished_at - started_at` |
| `receipt.usage` | legacy `main.py:424-425`；harness `budget.py:36-39` | legacy **只留最后一次，不累加**；harness **累加** |
| `receipt.budget` | `budget.py:36-39` | `limits` + `model_calls`/`tool_calls`/`tool_failures`/`usage_complete`/`missing_usage_calls` |
| `model_finished{duration_ms,usage}` | `model_gateway.py:35`（仅 harness） | 每次模型调用一段 |
| `receipt.context.report` | `context_report.py` | 6 分项估算（见 §4） |

前端：

| 位置 | 显示 | 位置 |
|---|---|---|
| 回复底部 | 「输入 X / 输出 Y」 | `app.js:7395` |
| 输入框右侧 | 上下文环形占用（used/total + 百分比，≥80% 黄 ≥95% 红） | `app.js:7517-7579` |
| Summary → Context | 6 分项条 | `app.js:7772-7799` |
| 轨迹头 | 工具动作中文文案（`ASK_TOOL_ACTIONS` 17 条）+ `askDurationText()` 秒表 | `app.js:6128-6157`、`6170` |
| 轨迹行 | 「第 N 轮输入」「第 N 轮结束/失败」「思考」「工具名 + 参数前 80 字」「工具结果」 | `app.js:5962-5984` |
| 结束后 | 「已完成，用时 1 分 20 秒」 | `app.js:6190-6194` |
| 生成中气泡 | 固定文案 + `0s` 秒表（**不是模型时间**） | `app.js:8232`、`9685-9690` |

**缺的东西很清楚：**

- 没有 `llmMs` / `toolMs` 分解——`duration_ms` 是一个总包，看不出时间花在模型还是工具。
- 没有 `decodeMs` / `decodeTokens`——算不出输出速率。
- 没有缓存命中（`cacheRead` / `cacheWrite`）——全仓无 `tps` / `tok/s` 计算或展示。
- `first_token_ms`、`duration_ms` 只进 `receipt` 存库，**前端从不读它们**（只读 `duration_ms` 到「用时」文案）。
- `askExecutionTools()`（`app.js:6034`）**定义了但全文件无调用点**——「跑了几个工具」运行中不显示。

### DSH 怎么做

**输入框下方 composer dock**，两个标准控件（`data-composer-stat`）：

| 控件 | order | 内容 |
|---|---|---|
| `activity` | 0 | 轮次数、步骤数、**输出速度**、LLM 耗时、工具耗时、**TTFT** |
| `usage` | 1 | token 总量、**缓存命中** |

- 有对话框的控件 hover / 键盘聚焦才显示；对话框开着时不显示。无对话框的读数 hover / 点击 / 轻触就显示。
- 读数被省略号截断时 tooltip 给完整值。
- Escape 或点外面关闭；激活另一个控件是**切换**而不是叠加。
- 其他插件用同 id 同 order 注册即可**替换**某个控件，新 id 就是新增控件。

**两档显示**（设置 → 通用 → 性能与用量，`ui-chat.performanceUsage`）：`detailed`（默认，会话统计 + 每轮 token 用量）/ `compact`（**只在输入框下显示输出速度和缓存命中率**）。

**每轮页脚**：已完成轮次可展开 token 用量行。显示条件是硬的——「已加载窗口包含 `turn/start`，且**每次**已启动的模型尝试都报告安全、精确的用量」；记账不完整或互相矛盾时**整块详情都不显示**，不拿部分总量冒充完整。**两种模式的已完成页脚都不显示耗时。**

**`dsh-session-stats`**（全日志投影，分页与压缩都不改变它）：

| 字段 | 含义 |
|---|---|
| `turns` | 含至少一个已关闭步的轮次；被拒/空轮不计 |
| `steps` | 已关闭的步（完成、失败、取消、max-tokens 全算） |
| `llmMs` | 组装出消息的步的模型墙钟时间和 |
| `toolMs` | `tool/call` → `tool/result` 墙钟和（按 callId 配对，未解决的在 `turn/end` 丢弃） |
| `ttftMs` / `ttftSteps` | 首 token 延迟和 + 承载步数（首个非空 delta chunk，**步内 `llm/retry` 后保留**） |
| `decodeMs` / `decodeTokens` | 上报用量的步的解码时间与输出 token → **吞吐 = decodeTokens / decodeMs** |

规矩：解码与 token 只在**同时有 TTFT 和有效 usage** 的步上累加；被取消的步**计数但不计时**；畸形 usage 直接忽略。

**`dsh-token-meter`**：`measure(session)` 回放持久日志给出 `totalTokens` / `surfaceTokens` / `nodes[]`，`estimateMessage()` 单条计价。三个投影：`tokenUsage`（`uncachedInputTokens`/`outputTokens`/`cacheReadTokens`/`cacheWriteTokens`）、`contextPressure`（`pressureTokens`/`projectedTokens`/`contextWindow`）、`contextBreakdown`（`systemTokens`/`toolsTokens`/`messageTokens`）。估算器固定「ASCII 4 字符/token + CJK 1.5」，文档明写**是近似不是计费**，并提醒「CJK 与 JSON schema 在每 token 四字符下严重低估」。

**Trajectory 时间概览**：固定在记录表上方，按真实开始时间与耗时投影；助手时间条**区分 TTFT 与解码时间**；hover 500 ms 看精确时刻；拖选区间聚焦、滚轮缩放。**流式中只画开始标记，绝不虚构耗时。**

### 差距

状态：✅ 已消除 ｜ ◐ 部分 ｜ ❌ 仍缺（截至 2026-11-10）

| 项 | 我们原来 | DSH | 状态 | 现在 |
|---|---|---|---|---|
| token 总量 | 有（legacy 不累加） | 有（累加 + 缓存分桶） | ❌ | legacy 的 `usage` 仍是最后一次的，没累加 |
| TTFT | **采了没展示** | `ttftMs`/`ttftSteps`，展示在 dock | ✅ | `turn.stats.ttft_ms`，dock 与每轮页脚都显示 |
| 总耗时 | 有，只进「用时」文案 | 有，但**故意不显示在完成页脚** | — | 两边一致，都不显示 |
| LLM / 工具分解 | 无 | `llmMs` / `toolMs` | ✅ | `cycle_trace` 累加，`turn.stats.llm_ms/tool_ms` |
| 输出速率 | 无 | `decodeTokens/decodeMs` | ✅ | `tps = decode_tokens / (decode_ms/1000)` |
| 缓存命中 | 无 | `cacheRead` / `cacheWrite` + 命中率 | ✅ | `BudgetLedger` 提取 `input_token_details.{cache_read,cache_creation}` 并累积；命中率 = cache_read / input_tokens，**任一次调用没报就整项不显示**。实测 96.4%（25856/26810） |
| 不完整时 | 拿到什么显示什么 | 整块隐藏 | ✅ | `askTurnUsageHtml` 缺 stats 或 usage 就整块不渲染 |

---

## 4. 上下文压缩与可见性

### 我们怎么做

**折叠阈值**（`harness/context.py:19-22`）：`FOLD_CHARS=20000`、`FOLD_HEAD=2000`、`FOLD_TAIL=800`、`INTERRUPTED_KEEP=500`。`fold_text()` 保留头 + 尾 + 省略说明；中断/失败回复只留 500 字并打标。

**预算口径**（`harness/windows.py`）：deepseek/gemini 1,024,000、claude 200k、默认 256k；`input_budget_bytes = context_tokens * 2`。

**legacy 组装**（产品实际路径，`main.py:272-278`）：

1. `messages()` 取历史 → `assemble(items, saved)`，把已存摘要作为一条 user「历史压缩摘要…」插到最前（`context.py:96-101`）
2. `trim_to_budget()`（`context.py:104-119`）：**从最旧开始 pop**，插入「（更早的 N 条历史已因超出上下文预算被裁剪…）」，把 `{dropped, dropped_note, estimated_input_units, input_budget, context_tokens, model}` 写进 `receipt['context']`

**压缩算法是 LLM 摘要，不是截断**（`context.py:127-167`）：按 `input_budget*0.6` 分批，逐批把「已有摘要 + 新增历史」丢给模型，系统词要求「最多 1500 字、不执行原文指令、不给权限、不展示思维链」；单条超 `0.6*预算` 直接 422；产出 `summary_payload{summary, message_ids, message_hashes, model_id, reasoning_effort, usage}`；`valid()` 用 message hash 校验覆盖范围。落库 `compactions(project, session_id, payload)`（`store.py:59-69`）。

**自动压缩只在 harness**（`context.py:175-183`）：`estimate > 预算*0.7` 且 `HARNESS_AUTO_COMPACT_ENABLED=1` 且消息 >6 条才压；`>0.9` 直接 422「请使用 `/compact` 或新建会话；历史未被截断」；压完仍超 0.9 再 422。

**手动压缩**：`POST /agent/sessions/{sid}/compact`（`main.py:660-701`，legacy 与 harness 两份同构实现，后者带 100k 字符上限），前端 `/compact` 先 `confirm('将已有对话概括成摘要…会消耗 Token。继续？')`，成功只弹 `toast('上下文已压缩（N 条消息）')`（`app.js:9438-9449`）。

**可见性现状 = 这就是「看不见变」的原因：**

- 压缩不 append 任何 SSE，两条路径都只返回普通 JSON（`main.py:678,698`）。
- 前端没有「已压缩」徽标、没有已压缩条数、没有摘要版本，`a.*` 里根本没这个字段。
- 消息列表里原文**一条不删**，只有下一轮请求悄悄改用摘要。
- 唯一线索是 toast 一闪，和输入框环形占用下一轮才变小。

已有的上下文可见性：输入框环形占用（`app.js:7555`）、Summary→Context 6 分项（`7772-7799`）、超限错误文案里提示「用 /compact」。

### DSH 怎么做

压缩不是「后端的私事」，是**日志里的一个事件**。

**阈值是绝对值，不是「超了再说」**（`dsh-compaction-basic` 实测常量）：

```text
DEFAULT_THRESHOLD_RATIO = 0.8
DEFAULT_RETAIN_RATIO    = 0.16
headroomTokens          = 65536        (默认)
messageBudget  = W - O
pressureBudget = W - O - headroom
thresholdTokens = floor(min(W × 0.8, pressureBudget))
retainTokens    = floor(messageBudget × 0.16)
判据：totalTokens < thresholdTokens 就什么都不做
```

**三级触发**：

1. **软阈值**：`agent/pre-step` 压力检查——先 prune 再测，超阈值才摘要，保留尾部。
2. **硬溢出**：`agent/request-error` 收到 `CONTEXT_WINDOW_EXCEEDED` → 绕过阈值与保留（`retain=0`，最大化缩减），`maxOverflowRetries=1`，且**只有 surface generation 前进才授权重试**。
3. **模型切换前**：按目标模型容量测压，失败抛 `MODEL_SWITCH_COMPACTION_FAILED`。

**选范围 `selectCompactableRange`**（这是最值得抄的一段）：

- 节点 0 若是 `system/message`，`firstIdx = 1`——**系统提示词永不被遮蔽，它是锚点**；否则 `firstIdx = 0`。
- 从尾往前累加 `nodes[i].tokens`，直到 `>= retainTokens`，得到 `keepFromIdx`（**逐字保留的不可压缩尾部**）。
- 再**回退到 tool 配对平衡点**（`toolPairingBalancedBefore`）——绝不切开 tool-call / tool-result 对。
- 返回 `{start: nodes[firstIdx], end: nodes[keepFromIdx-1]}`；`keepFromIdx <= firstIdx` 时返回 null（不可分单元，零写入）。

**替换方式**：追加一条 `user/message`，带 `surfaceOp:{op:'replace', startSeq, endSeq}`、`sourceEventSeqs:[start, summary, ...shadowed]`、`source:{kind:'compact-checkpoint', compactionId}`；`deriveMessages()` 渲染成「user 消息 + 已保留节点」。正文 = `CHECKPOINT_PREAMBLE` + `<compacted-summary>` + 模型输出 + `</compacted-summary>`。

**摘要调用**：另一次 `ctx.llm.stream()`，回放「节点 0 系统提示词 + `header.tools` + 被遮蔽消息」，把压缩指令作为**最后一条 user 消息**追加，`purpose:'compaction'`。所以辅助调用**是会话真前缀**，只有指令与输出未命中缓存。指令硬编码 **8 段 Markdown schema**：

```text
Primary Request and Intent / Key Technical Concepts / Files and Code / Errors and Fixes
/ Pending Jobs / Current Work / Next Step / Critical Context
```

空段写 `(none)`；遇到已有 `<compacted-summary>` 要**合并而非照抄**；只保留 text block（图片输出抛 `UNSUPPORTED_CONTENT`）；`max-tokens` 直接判失败。

**收缩校验**：`estimateMessage(检查点) >= shadowedRouteTokenCount` 时抛 `summary is not smaller than the shadowed content`——**摘要没变小就不许替换**。

**三条并行策略**：

| 策略 | 触发 | 参数 / 效果 |
|---|---|---|
| 工具结果修剪 | 压缩条件满足后由 backend 调 `pruneSession()` | `thresholdChars=8192` / `headChars=4096` / `tailChars=1024`，中间插 `[... tool result middle pruned ...]`；替换前紧跟一条 `compaction/prune`（带 `shadowedTokenCount`）当影子价；**修剪后达标可跳过摘要** |
| 输出 spill | `tools/post-execute` | `maxInlineTokens` 省略即禁用；文字图片共享预算、首尾各半；尾部 `(Omitted N bytes. Full formatted result stored at: path…)` |
| 图片 offload | `image/offload:{targets}` 事件 | 按占位文本计价，本批不含独立包 |

**事件序（事务）**：

```text
compaction/start{compactionId, sourceCommandId?, turn}   ← 同步追加，追加即加锁
compaction/summary{compactionId, summary[], shadowedRange, shadowedSeqs[],
                   shadowedTokenCount, provider, model, usage?}
user/message                                            ← 唯一一次表层变更
compaction/end{...}                                     ← 恰好一次
```

未匹配的 `start` 是持久锁；早于最新 `session/end-seed` 算陈旧不阻塞，之后报 busy。自动路径用 `turn` 数字归属（整表稳定），手动 `compactNow()` 用 `turn:null`。

**可见性（这才是我们最该抄的）**：

- Chat 里有**压缩卡片** `CompactionItem`：上下文图标 + 折叠箭头（`data-compaction-disclosure`）+ 标题 + 文案；`node.summary === null` 时 disabled；展开是 MarkdownText，摘要头栏 sticky。文案：
  - `上下文已压缩`
  - `已压缩 {items} 条历史记录（约 {tokens} tokens）` —— `items = shadowedSeqs.length`，`tokens = shadowedTokenCount`
  - `正在压缩…` / `点击查看压缩摘要` / `压缩摘要不可用`
  - 手动卡标题 `compact`
- **`ContextMeter`** 在输入卡下方、会话统计右侧：14px viewBox / r=5.5 / 描边 2 / `strokeDasharray` 百分比。`used = projectedTokens ?? pressureTokens`（**优先用「下一个请求将花多少」，所以压缩一落地就变小**），`percent = min(100, round(used/window*100))`。点击开 `role="dialog"` 面板，宽 `min(264px, 100vw−24px)`，`~{used}/{window}` + 4px 三段条 + system/tools/messages 明细。
- Trajectory 里压缩是记录表的一种行类型；**独立手动压缩显示在 `Between turns` 区段**，带轮次编号的留在轮次内。
- **无 undo / uncompact**——替换持久；原文仍在日志里，能去 Trajectory 看。

**统计不受压缩影响**：`sessionStats` 是全会话 `step/end` 的 fold（日志口径），文档明写「计数是日志口径，不是 surface 口径——消息后来被压缩掉的步仍然计入」。

### 差距

状态：✅ 已消除 ｜ ◐ 部分 ｜ ❌ 仍缺（截至 2026-11-10）

| 项 | 我们原来 | DSH | 状态 | 现在 |
|---|---|---|---|---|
| 摘要 | 有（≤1500 字自由中文，hash 校验） | 有（**8 段固定 schema**，空段 `(none)`，已有摘要要合并） | ❌ | 仍是自由中文。结构化的好处是合并有锚点、不漂 |
| 覆盖校验 | 有（`message_hashes`） | 有（surface 位置锚点 + 影子价） | ✅ | 我们更严格，保留 |
| **收缩校验** | 无 | **摘要 token 必须小于被遮蔽量，否则抛错** | ✅ | `shadowed_units > 4000` 时 `<90%` 才放行 |
| 阈值 | `estimate > 预算×0.7` + 消息 >6 条 | `floor(min(W×0.8, W−O−65536))` **绝对值** | ✅ | harness 层已换绝对值 |
| 保留尾部 | 无——`trim_to_budget` 从最旧 pop | `floor((W−O)×0.16)` 从尾逐节点累加 | ✅ | `compaction_range()` 实现 |
| 边界安全 | 无 | **系统提示词永不遮蔽** + 回退到 tool 配对平衡点 | ✅ | 两处都有：`compact()` + `compaction_range()` |
| 溢出兜底 | `>0.9` 直接 422 | 收到 `CONTEXT_WINDOW_EXCEEDED` 后 `retain=0` 强制压缩并重试 1 次 | ◐ | 仍 422，没做强制压缩重试 |
| 事务 | 无，直接写库 | `start`（即加锁）→ `summary` → 替换 → `end`，恰好闭合一次 | ❌ | 仍直接写库 |
| 自动触发 | **只有 harness，产品未启用** | 三级：软阈值 / 硬溢出 / 模型切换前 | ◐ | harness 有软阈值；产品跑 legacy 没有自动压缩 |
| 手动 | `/compact` + `confirm` | `/compact`（无参数，busy 拒绝） | ✅ | 有 |
| **通知前端** | **无** | **有（日志事件 + 投影）** | ✅ | `role='compacted'` 消息 + `compaction` 字段 |
| **UI 呈现** | 只有一个 toast | 压缩卡片 + `ContextMeter` 环 + Trajectory `Between turns` | ✅ | 卡片做了；`ContextMeter` 等价物是 `ask-ctx` 环；轨迹里的「轮间压缩」未做 |
| 占用口径 | `input+output` 累加 + 后续按字数估 | `used = projectedTokens ?? pressureTokens`（**压缩一落地就变小**） | ✅ | 优先 `context.report.used`（压缩后重新估算），压缩卡片带 `shadowed_chars`，前端在时间线上当场扣掉 |
| 图片 / 工具结果 / 大输出 | 无独立策略 | 三条独立策略（prune 8192/4096/1024、spill 首尾各半） | ◐ | **大输出 spill 做了**（P1-B）；**图片不需要 prune**——核实过：`generate_image` 只回路径不回图，附件进提示词只带 `{id,name,status,suffix}` + 600 字文本摘要，上下文里从来没有内联图片块 |

---

## 5. 技能读取与使用

### 我们怎么做

- **目录**：`agent_backend/skills/<技能名>/SKILL.md`（`skill_library.py:19`），发现条件=目录含 `SKILL.md`，`.disabled` 文件即停用，跳过 `scripts/examples/__MACOSX`。
- **格式**：Markdown + 极简 YAML front matter（只做 `key: value` 逐行切分）；`description` 取 front matter，缺则取正文首行前 200 字。命名=文件夹名，id=`dir:<文件夹名>`。
- **正文合成** `compose()`（`skill_library.py:126-157`）：先插固定 `ADAPTER`（本机适配约束）→ 拼正文 → 把 `references/` 与根目录所有文本文件按 `## 相对路径` **全部追加**；总量超 `LIMIT=60000` 的附件列进「## 未加载的附件」，整体再超就**硬截断**。
- **内置 5 个**：`novel` / `script` / `storyboard` / `prompt` / `review`，每个 id 映射 `chat_policy.SKILL_TOPICS`。自定义技能来自 `workspace.plugins(project,'skill')`，`plugins()` 会把目录技能并入（同名目录技能覆盖数据库旧记录）。
- **单选**：`a.skillId` 一个字段，提交时 `skill`（名字）+ `skill_id`（`plugin:` 前缀去头）。
- **模型怎么知道有哪些技能**：系统提示里**不塞技能清单**，只写本届选中的那一个名字与 topic（`chat_policy.py:84`）；未选时明确「不要读取或套用任何创作指南」。
- **模型怎么拿正文**：调 `read_analysis_guidance(topic)`（`task_tools.py:24-40`），`allowed_topics` 只含选中 topic，越权直接拒；工具 docstring 只列内置 5 个 topic，**自定义技能名根本不出现在工具描述里**。
- **冻结**：`registry.freeze(ctx)` 生成 `receipt['skill_manifest']=[{id,name,version}]`，每次模型调用前 `verify()`，变更即 `RunStopped('skill_revoked')`。
- **可见性**：没有「技能被调用」的专门事件，只有通用 `tool_call` / `tool_result`（`tool:'read_analysis_guidance'`）和轨迹项。前端有对应中文文案「正在读取指导文档」。

所以：**我们其实已经是「按需加载」了**——只是目录信息残缺（只有选中的那一个、自定义技能不可见）、没有前置清单让模型自己判断该不该加载、也没有加载后的展示卡片。

### DSH 怎么做

三层分离：

| 包 | 职责 |
|---|---|
| `dsh-skill` | 注册表：合并任意来源、按名去重、跨层裁决（近层赢）、验证、**按需 `get()` 加载正文**、定义从不缓存、失效靠 provider `invalidate()`（**无 TTL**） |
| `dsh-skill-filesystem` | 从磁盘发现 `SKILL.md` |
| `dsh-tool-skill` | 面向模型：会话目录 + `skill` 加载工具 + `/name` 手势注入 |

**渐进式加载**三级：

1. 首次请求**之前**，模型收到一条**持久的 user 角色目录消息**：

```markdown
<system-reminder>
A skill is a reusable set of task-specific instructions. The following skills are available in this session:

<available_skills>
- `<name>`: <normalized-and-capped-description>
</available_skills>

If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.
</system-reminder>
```

2. 模型调 `skill` 工具 → 收到 `<skill_content>` + `<skill_resources>`（基础目录 / URL / 不透明指引）+ `<skill_instructions>` 正文。
3. **目录是投影，用 digest 差分**：条目/完整性变了就**追加一条替换目录**（删光技能时追加**空目录**明确作废旧名）；只追加不改写，KV cache 前缀不受影响。正文改了**不**改 digest，下一次工具调用读 provider 当前内容。

**调用策略是二值组合**：

| 策略 | 模型 | 用户 |
|---|---|---|
| `modelInvocable:true, userInvocable:true` | 包含 | 包含 |
| `modelInvocable:true, userInvocable:false` | 包含 | 排除 |
| `modelInvocable:false, userInvocable:true` | 排除 | 包含（`disable-model-invocation` 唯一入口） |
| `false/false` | 排除 | 排除 |

**用户显式 `/name`**：pre-step 监听器只扫已认领的用户消息，发现以空白为界的 `/name` 指向某个用户可调用技能，就把**同一份** `renderSkillContent` 作为 user 角色指令上下文**追加在该步骤所有注入的最后**（「背景在前，要处理的材料在最后」），并告诉模型别重复加载。未知/不可用的名字保持普通行文。

**UI**：`/` 菜单里是独立 source（`rankByName`：有序子序列匹配，前缀优先）；对话里是可展开的 **`Instructions` 卡片**——收起时 skill 图标 + `Skill` + 技能名，运行中一道高光从左到右扫过，失败时用错误首行替换名字；**卡片落定后内容冻结**（只从冻结的调用/结果切片派生，绝不读当前目录，回放稳定）；点 `/name` 在右侧栏打开 `SKILL.md`。

### 差距

状态：✅ 已消除 ｜ ◐ 部分 ｜ ❌ 仍缺（截至 2026-11-10）

| 项 | 我们原来 | DSH | 状态 | 现在 |
|---|---|---|---|---|
| 数量 | 单选 1 个 | 多选叠加 | ❌ | 仍单选。多选要先定「多个技能冲突谁优先」 |
| 目录可见性 | 系统提示只写选中的那一个；自定义技能名不进工具描述 | 持久目录列出全部（名 + 截断描述，默认 500 字符） | ✅ | `skills.catalog()` + 【可用技能目录】，实测 18 条 |
| 加载 | `read_analysis_guidance(topic)` 按需取正文 | `skill` 工具按需取正文 | ✅ | 两边同构，本来就有 |
| 正文体积 | `compose()` 全量拼接 references，60k 硬上限 | 正文无上限（列为已知限制），资源只给指引 | ◐ | 仍全量拼接 |
| 目录更新 | 每轮重拼 | 追加式替换 + digest 差分 + 空目录作废 | ❌ | 每轮重拼，18 条目录约 1.2k 字，暂时可接受 |
| 调用策略 | 启用 / 停用 | `modelInvocable` × `userInvocable` 四组合 | ❌ | 仍两态 |
| 用户路径 | 只能在 `@` 里挑 | `/name` 直接键入，注入到步骤最后 | ❌ | 仍走 `@` |
| 可见性 | 只有工具行「正在读取指导文档」 | `Instructions` 卡片 + 可展开正文 + 右侧栏看 SKILL.md | ❌ | 仍只有工具行 |

---

## 6. 轮次语义与运行态展示

### 我们

`max_rounds` 输入框（默认 120，10–400）→ `ChatRequest.max_rounds` → `graph.astream(..., config={'recursion_limit': ...})`。这是 **LangGraph 图递归步数**，不是「对话轮次」，但界面写着「轮次」。**2026-11-10 已从界面移除**，理由见下方现状。

运行中气泡只有固定文案 + `0s` 秒表 + 停止按钮（`app.js:8232`），没有「第几步 / 第几次模型调用 / 现在跑哪个工具」。轨迹里有「第 N 轮输入」「第 N 轮结束」和工具行，但**要先展开轨迹**才看得到。

### DSH

- **`turn`（轮）**= 用户一次提交；**`step`（步）**= 一次模型调用 + 一次工具批次。`step/end` 在 `finally` 里恰好追加一条，完成 / 失败 / 取消 / max-tokens 的步都落地。
- 已知限制里**明确写着「没有内置轮次预算」**——失控轮次要从 `agent/turn-stopping` 扩展点执行取消。DSH 不把 recursion limit 摆到用户面前。
- 换句话说 **`turn-stopping` 是一个给插件挂的扩展点，不是一个数字**。DSH 里根本没有「轮次上限」这个配置项，循环就是「调用模型 → 跑工具 → 重复」，直到模型不再要工具。
- DSH 真正的资源控制是另外三样，全是真实资源而不是步数：`agents[].maxTokens`（逐请求输出 token 上限）、`maxParallelToolCalls`（默认 10，1 表示串行）、适配器超时。
- 运行态：`running` 分组标题、思考预览、工具与命令行、当前重试行、底部运行状态用共享 `TextShimmer`（每行文字共用一道从左到右的高光）；完成时**一次性收起**整轮工作行，且「读者跟随底部时，收起前第一个可见行保持屏幕位置」。
- 间距定死：流程行 4px、展开组标题与内容 8px、Assistant 回复与相邻过程行 12px、完成／耗时控件与输入 16px。
- 进行中的记录**只画开始标记**，不虚构耗时。

### 差距

我们的「轮次」是引擎参数，DSH 的 turn/step 是领域模型；我们的运行态是一个秒表，DSH 把每条过程行做成可追踪、可收起、带 shimmer 的结构。

轨迹我们**有底子**：`trajectory_events` 表（`store.py:43-77`）+ 分页接口 `GET /agent/sessions/{sid}/trajectory?offset&limit&run_id`（`main.py:640-648`）+ SSE 的 `trajectory_item` / `trajectory_delta` + 前端 `ask-traj`（`app.js:7692-7702`，最近 50 条，role / kind / 时间 / 内容前 500 字）。缺的是：时间概览、TTFT 与解码时间条、可展开调用检查器、虚拟化。

**现状（2026-11-10）**：

- ✅ **turn/step 领域模型落了**，但只在数据层：`receipt.turn = {index, run_id, started_at, ended_at, step_count, steps, stats}`，`step` 对应原来含糊的 `cycle`。事件流按 turn 聚合，子 run 靠 `parent_run_id` 挂回 turn。
- ⚠️ **上一轮的判断需要修正**：我把「输入框里的轮次 120」和「dock 里的轮次统计」一起删了。前者该删（引擎参数），**后者不该删**——DSH 的状态条明明白白显示「374 轮 10137 步」，一个会话累计跑了多少轮多少步是有信息量的规模指标。现在已恢复为累计统计，只放在 dock 里。
- ✅ **两处「轮次」是两个不同的东西**：
  - **dock 里的「轮次 2 · 步骤 1」**：自我证明式数字——用户自己数得出发了几条消息，模型内部调了几次也不关他事。dock 只留速率、首字、模型/工具墙钟。
  - **输入框里的「轮次 120」**：那是 `recursion_limit`，LangGraph 的图递归步数上限。更糟的是**它从来没生效过**——真正的成本闸是 harness 的 `BudgetLedger`（chat 政策 `model_calls=8` / `tool_calls=16`），一次模型调用约 2–3 个图节点，预算闸在约 24 步就先炸。用户把 120 调到 400 只是假的掌控感。
  - `ask_rounds()` 现在不再采信请求里的 `max_rounds`，只用 `WMD_RECURSION_LIMIT`（默认 120）做异常兜底；`ChatRequest.max_rounds` 字段保留只为兼容旧客户端。
- ✅ **`@` 和 `/` 两个按钮也删了**。它们是键盘字符，用户打字就能触发；做成按钮等于用鼠标模拟打字，还挤占了权限/联网/模型这些真控件的横向空间。删后实测键盘输入 `@` 仍正常弹出「引用技能或文件 19 项」。
- ❌ **运行态展示没动**：仍是固定文案 + 秒表，没有「第几步 / 现在跑哪个工具」，shimmer、完成时收起、间距规范全未做。
- ◐ **Trajectory 时间概览、TTFT 与解码条、调用检查器、虚拟化**：仍未做；但**轨迹列表已限高**——`.ask-trace-fold[open] .ask-trace-rows` 锁在 380px 内滚，展开时自动滚到最新一条。DSH 的虚拟化是为了长会话性能，我们先把「不把页面撑长」补上。

---

## 7. 差距总台账（DSH 有、我们没有）

状态：✅ 已消除 ｜ ◐ 部分 ｜ ❌ 仍缺 ｜ ⏸ 判定不学（附理由）

### 7.0 先认一个错

这张表最初的版本把 **subagent / workflow / goal / plan-mode / MCP / plugin market / turn-step 模型** 整体打成 P3「不学」，理由是「创作台不吃这套」。

那个理由本身就是错的：**它是拿应用层的短期需求去否决框架层的契约**。harness 的意义恰好是反过来的——框架层只出通用契约，应用层（创作台、管理器、任何新应用）用 skill + 配置去实现，换应用只换配置和技能。当时判「不学」的七项里，五项已经落了，而且落的时候没有一项需要改应用层逻辑。

真正的判断标准只有一条：**这项能力是不是「换应用也不变」的框架能力**。是，就该在框架层；不是，才该留在应用层。用「当前产品用不上」去否决它，等于把框架层焊死在第一个应用上。

### 7.1 已落地

| 优先级 | 能力 | DSH 包 | 我们现在的做法 |
|---|---|---|---|
| P0 | 命令注册表 + 会话级目录 | `dsh-commands` | `COMMANDS` + `GET /agent/commands` |
| P0 | 技能持久目录（清单型，非单选） | `dsh-skill` / `dsh-tool-skill` | `skills.catalog()` + 【可用技能目录】 |
| P0 | sessionStats 投影 | `dsh-session-stats` | `receipt.turn.stats`：llm/tool/ttft/decode/tps |
| P0 | 压缩可见 | `dsh-compaction*` | `role='compacted'` 消息 + 压缩卡片 |
| P0 | 原子引用 + `@"..."` 语法 | `dsh-client-ui-reference` | 引号包路径 |
| P0 | 输入触发仲裁 + 重开抑制 | `dsh-client-ui-input-trigger` | keydown 空格仲裁 + `mentionClosed` |
| P1 | composer dock 统计 | `dsh-client-ui-chat` | `ask-stat-dock`（速率 / 首字 / 双墙钟） |
| P1 | 每轮 token 页脚（不完整则整块隐藏） | `dsh-client-ui-chat` | `ask-turn-usage` |
| **P0** | **启用 harness 路径** | — | 默认引擎；legacy 退成 `HARNESS_RUNTIME_ENABLED=0` 的应急回退 |
| P1 | **框架层/应用层分离** | （DSH 隐含在插件体系里） | `app_packs/` + `WMD_APP_PACK` |
| P1 | **事件流 + 投影回放** | `dsh-session*` | `run_events` 表 + `/events` + `/projection` |
| P1 | **turn/step 领域模型** | `dsh-agent-loop` | `receipt.turn`（数据层，界面不展示） |
| P1 | **输出落盘（spill）** | `dsh-spill-policy` | `spill.py` + `read_tool_output` |
| P1 | **MCP client** | `dsh-mcp-client` | `mcp.py` + `Pack.mcp_servers` |
| P1 | **子代理** | `dsh-subagent` | `spawn_subagent`，子 run 独立事件流 |
| P2 | **并行 fan-out（workflow 最小形态）** | `dsh-workflow` | `run_parallel_subagents`（≤6） |
| P2 | **跨轮目标** | `dsh-goal` | `goal.py` + 3 个工具 |
| P2 | **能力目录（plugin market 的实际形态）** | `dsh-plugin-market` | `GET /agent/catalog` 三层视图 |
| P1 | **工具调用语义单一来源** | （DSH 工具网关） | `tool_policy.py`：两引擎共用一套缓存/循环判定 |
| P1 | **测试不依赖本机服务** | — | `conftest` 在 urllib 层阻断真实网络；三端口全关时 329 passed |
| P1 | **缓存命中分桶** | `dsh-token-meter` | 活动/用量/上下文三段状态条，缓存命中率只在全量上报时出现 |
| P1 | **composer dock 三段式** | `dsh-client-ui-chat` | 图标 + 竖线分组 + 圆环并排，照 DSH 的结构 |
| P1 | **占用口径改 projectedTokens** | `dsh-context-meter` | 优先 `context.report.used` + 压缩卡片 `shadowed_chars` 当场扣减 |

### 7.2 仍缺 —— 按该不该做排序

| 优先级 | 能力 | DSH 包 | 缺口 | 为什么值得做 |
|---|---|---|---|---|
| **P1** | 运行态展示 | `dsh-client-ui-chat` | 仍是固定文案 + 秒表 | 「现在跑到第几步、卡在哪个工具」用户完全看不到 |
| **P1** | Trajectory 时间概览 + 调用检查器 | `dsh-client-ui-trajectory` | 只有简化列表 | 排查用，和 dock 的统计是两回事 |
| **P1** | 摘要 8 段 schema | `dsh-compaction-basic` | 自由中文，合并无锚点 | 多次压缩后摘要会漂，结构化才能合并 |
| **P2** | 压缩事务 | `dsh-compaction-basic` | 直接写库 | 压缩中途失败会留下半状态 |
| **P2** | 溢出兜底强制压缩重试 | `dsh-compaction*` | 仍 422 | 用户撞上就断线，DSH 会自己救一次 |
| **P2** | 技能多选叠加 | `dsh-skill` | 仍单选 | 要先定冲突优先序 |
| **P2** | `/name` 直接键入技能 | `dsh-client-ui-skill` | 仍走 `@` | 少一次挑选 |
| **P2** | `Instructions` 卡片 | `dsh-client-ui-skill` | 只有工具行 | 用户不知道技能正文长什么样 |
| **P3** | 完整 workflow 编排 | `dsh-workflow` | 只有并行 fan-out | 阶段性依赖 + 结果传递，等有真实多阶段需求 |
| **P3** | 多 source `@` 注册表 + drill | `dsh-client-ui-input-trigger` | 单 source、目录拍平 | 现有三类混排够用 |
| **P3** | 原子 chip 引用 | `dsh-client-ui-reference` | 纯文本回写 | 改输入框数据结构，收益中等 |
| **P3** | ACP | `dsh-acp` | 无 | 没有对端要接入 |

### 7.3 判定不学（附理由，随时可翻）

| 能力 | 理由 |
|---|---|
| `dsh-plan-mode`（只读探索、只出方案不动手） | 我们的权限档位里已有 `readonly`，只差一个「不许写盘但允许一轮多步」的组合。要等真有人用「先看看，别动」这个说法再补，现在补是猜需求 |
| `dsh-compaction-image`（图片 offload） | **核实后判定不适用**，不是不做。我们的上下文里没有内联图片块：`generate_image` 返回 `{path,rel,name,url}` 只给路径，附件进系统提示只带 `{id,name,status,suffix}` + 600 字文本摘要，图片内容靠 `describe_image` 翻成文字。没有图可 offload |
| 虚拟列表 + 长会话性能 | 单机会话量到不了那个量级，先有真实卡顿再优化 |

> 上一版把 plan-mode 和 image offload 都放在这里。image offload 后来被我改判成 P0——**这个改判是错的**：我照着 DSH 的清单往上加，没先核我们到底有没有这个问题。核实结果是根本没有（见上）。教训：差距要落在我们自己的代码上验证过才算差距，照抄对方的清单会凭空造出工作量。

## 8. 我们有、DSH 没有

| 能力 | 说明 |
|---|---|
| 创作任务域 | 图像 / 视频任务、素材库、分镜、剪辑；DSH 是通用 agent |
| 单输入框多参数 | 模型 + 思考强度 + 运行权限挤在 composer 一行（「轮次」已移除，见 §6） |
| `contextReport` 6 分项 | Messages / System tools / Skills / System prompt / Autocompact buffer / Free space；DSH 的 `contextBreakdown` 只有 3 项 |
| 预算硬闸 | `budget.py` 的 `output_tokens_exceeded` / `tool_calls` 上限 + 422 不静默截断 |
| 压缩覆盖 hash 校验 | `message_hashes` 逐条比对；DSH 用位置锚点 |
| 技能正文 `compose()` 拼接 | 自动带上 `references/` 与根目录文本；DSH 只给资源指引不列举 |
| **运行时换应用** | `WMD_APP_PACK` 一个环境变量切应用包，框架代码不动。DSH 换产品是重打包（插件组合在构建期定） |
| **投影自证接口** | `/agent/executions/{id}/projection` 用落库事件重放整份回执并逐字段比对，`identical` 直接给出「事件够不够当真相」。DSH 有 session 投影，但没有这个自证口 |
| **应用层文案可整体取回** | `/agent/app-pack/prompt` 按 `layer` 分段返回全文，关掉的政策原文照样在；DSH 的提示词靠代码拼接，没有分段台账 |

---

## 9. 推进记录

### 9.1 当初排的顺序，后来怎么走的

原计划的 7 步，实际执行时顺序被改过一次，原因写在下面——这次改动本身是个教训。

| 原计划 | 实际 | 为什么改 |
|---|---|---|
| ① 先打开 harness | **没做** | 打开它之前得先解决「两套代码行为不一致」，否则一开就是换引擎顺手换 bug |
| ② 让压缩可见 | ✅ 做了 | 按计划 |
| ③ `/` 改注册表 | ✅ 做了 | 按计划 |
| ④ 上 sessionStats | ✅ 做了 | 按计划 |
| ⑤ 技能改持久目录 | ✅ 做了 | 按计划 |
| ⑥ 压缩算法对齐 | ✅ 做了 | 按计划 |
| ⑦ `@` 加引号 | ✅ 做了（drill 没做） | 按计划 |

原计划里**没有**的一项成了第一件事：**框架层与应用层的分离**。原计划把 harness 那批能力当「加功能」来做，做到一半发现前提是错的——那些能力之所以装不进来，是因为框架层里焊着应用层的东西。所以先拆层，再装能力。

### 9.2 2026-11-09 / 11-10 两轮实际顺序

| 顺序 | 做了什么 | 为什么排在这个位置 | 提交 |
|---|---|---|---|
| 1 | 命令注册表 / 技能目录 / sessionStats / 压缩卡片 / `@` 引号 | 收益直接、风险低、不碰运行时 | `07b3758` |
| 2 | **应用包分层（P0-A）** | 后面每一项都卡在这：能力没地方声明 | `33eaa07` |
| 3 | **事件流收口（P0-B）** | 加能力不再改 receipt schema 的前提 | `44cff9c` |
| 4 | turn/step 命名（P0-C） | 和 B 同一次切，顺手 | `44cff9c` |
| 5 | **输出落盘（P1-B）** | 比 MCP 先做：MCP 工具的输出更要落盘 | `e70dc3e` |
| 6 | MCP 客户端（P1-A） | 落盘就位后才接外部工具 | `e70dc3e` |
| 7 | 子智能体（P1-C） | 要事件流 + 落盘都就位 | `72bb67e` |
| 8 | 跨轮目标 / 并行子任务 / 能力目录（P2） | 复用子智能体 | `dca0ed8` |
| 9 | 提示词分段留存 | 分层之后原文不能丢 | `421279f` |
| 10 | dock 撤掉「轮次/步骤」 | 内部模型不该漏到界面 | `d110262` |
| 11 | 文档改成台账 | 差距表停在改前一天，同一份文档自相矛盾 | `fb2cc88` |
| 12 | **harness 变默认引擎** | 结构性欠账里最大的一笔，且实测暴露两个被 legacy 藏住的真 bug | `5b94011` |
| 13 | 占用口径改 projectedTokens | 压缩后环不变小 = 用户认为压缩没生效 | `f0f61fa` |
| 14 | 核实图片 offload | 结论是**不适用**，从 P0 撤下 | `f0f61fa` |
| 15 | 测试不依赖本机服务 | 假通过；三端口全关跑 329 passed | `03c50ec` |
| 16 | 删掉输入框的「轮次」 | 那是 recursion_limit，且被预算闸抢先，用户调它没有效果 | 本轮 |
| 17 | 删掉 `@` `/` 入口按钮 | 键盘字符做成按钮 = 鼠标模拟打字，挤占真控件位置 | 本轮 |
| 18 | 状态条改三段式 + 缓存命中 | 照 DSH 的 activity/usage/context 结构；缓存是真实数据，实测 96.4% | `14cfd82` |

### 9.3 下一轮该做什么

§9.3 上一版排的四件事：第 1、3 已做，第 2 核实后不适用，第 4 做了一半。剩下的按 §7.2 顺序：

1. **运行态展示**（P1）——仍是固定文案 + 秒表，「现在跑到第几步、卡在哪个工具」看不到。这是 P1 里最影响体感的一条。
2. **Trajectory 时间概览 + 调用检查器**（P1）——排查用，和 dock 的统计是两回事。
3. **摘要 8 段 schema**（P1）——现在自由中文，多次压缩后摘要会漂，结构化才能合并。

再往后是 P2：压缩事务、溢出兜底强制压缩重试、技能多选叠加、`/name` 键入技能、`Instructions` 卡片、缓存命中分桶。

> DSH 的结论均来自 `_tmp/dsh-src/<包名>/README.zh.md`（各包自带中文设计文档）。我们的行号对应本次提交时的 `web/app.js`、`agent_backend/app/*.py`、`src/server.js`，已随提交推移，看代码时以符号名为准。

---

## 10. 附：我们的 SSE 事件全清单

信封 `data: {json}`，事件名在 `json.type`；legacy 补 `run_id` + `sequence`（`main.py:569`），harness 另补 `event_id` / `schema_version` / `timestamp`（`run_store.py:75`）。前端消费在 `askApplyEvent()`（`app.js:9031-9159`）。

| type | 产生位置 | 关键字段 |
|---|---|---|
| `start` | `main.py:388` | `session_id`, `execution`（完整回执副本） |
| `delta` | `main.py:416,438` | `text` |
| `replace` | `main.py:439,454,464,479` | `text` |
| `media` | `main.py:408`；`create_tools.py:61` | `files[]` |
| `tool_call` | `main.py:457` | `tool`, `tool_call_id`, `arguments`, `detail`, `time` |
| `tool_result` | `main.py:472` | `tool`, `tool_call_id`, `ok`, `detail`, `output`(≤1200), `time` |
| `process` | `main.py:461`；`task_tools.py:21,52`；`model_gateway.py:21` | `plan{goal,steps[]}` |
| `trajectory_item` | `main.py:380` | `item{id,role,content,time,cycle,model_call_id,kind,…}` |
| `trajectory_delta` | `cycle_trace.py:59` | `item{kind:'reasoning',content}`（节流 120ms） |
| `supplement_received` / `supplement` / `supplement_undelivered` | `main.py:387,580`；`supplements.py:207` | `items[{id,text,time}]` |
| `choice` | `interaction_tools.py:155-169`；`choice_rescue.py:117` | `questions[]`, `options[]`, `auto_seconds` |
| `artifact` / `workspace_file` | `task_tools.py:84`；`fs_tools.py:199,396` | `file` |
| `error` | `main.py:533,574`；`runtime.py:101,121` | `message`（harness 另带 `reason_code`） |
| `done` / `run_finished` | `main.py:552`；`runtime.py:64` | `execution`, `time` / `status`, `reason_code` |
| `model_started` | `model_gateway.py:24` | `model_call_id`, `timeout_seconds` |
| `model_finished` | `model_gateway.py:35` | `model_call_id`, `usage{input,output,total}`, `usage_available`, **`duration_ms`** |
| `model_failed` | `model_gateway.py:40` | `error_type`, `duration_ms`, `timeout_seconds` |
| `tool_started` / `tool_finished` / `tool_reused` | `tool_gateway.py:32-63` | `tool_call_id`, `tool_name`, `risk` / `ok` |

空档：`trace`（前端 `app.js:9037` 有分支，后端无 emit）、`summary`（前端 `app.js:9049` 有分支，后端已无 emit）、`askExecutionTools()` 无调用点。这三处是死分支。

---

## 11. 实现档案（2026-11-09 / 11-10）

两轮共 10 个提交。这里只记「为什么这么做」和「怎么验的」，过程略；差距的当下状态看 §7。

### 11.1 应用包分层（`33eaa07`）

**问题**：框架层里焊着应用层的 43 处领域词，代码里 `preset`/`profile`/`app_id` 零命中，换应用等于改代码。

**做法**：`Pack` 只认七个字段（product / forbidden_pipelines / policies / skill_topics / skill_sources / tool_groups / mcp_servers）。创作台那三段政策不是手抄的——脚本从原字符串按段首标记切出来再 `repr()` 落盘，自带 `assert rebuilt == identity`，切分有损就中止。

**验收**：**逐字节相同**，五种参数组合 5/5 PASS（空参数 / 选技能 / 技能目录+附件 / 恢复+完全权限 / 工作区权限多根目录）。换包实测 3401 → 818 字，**工具 22 个、技能 18 条一个不少**。

**回滚**：`WMD_APP_PACK=` 留空即回创作台。

### 11.2 事件流收口（`44cff9c`）

**问题**：receipt 26 个平铺字段，加一个能力要改 schema + 前端解析 + 测试三处。

**做法**：不重写，先让写入变成事件。`TracedDict`/`TracedList` 代理 dict/list 的写操作，`stream()` 里那 26 处赋值**一行都没改**。`project()` 重放，`verify()` 比对。

**实测**：一轮 39 事件，重放与内存值逐字段相等，存储 1.93×。落库后 `/projection` 的 `identical` 就是「事件够不够当真相」的答案。

**兜底**：缓冲上限 2 万条，超限时 `verify()` 自曝 `truncated=true` 且 `ok=false`——不拿半截事件流说相等。

**回滚**：`WMD_TRACE_RECEIPT=0`。

### 11.3 turn / step（`44cff9c` / `d110262`）

`receipt.turn = {index, run_id, started_at, ended_at, step_count, steps, stats}`，`step` 即原来含糊的 `cycle`；`receipt.timing` 保留同值快照。

**后来把界面上的「轮次/步骤」撤了**：用户自己数得出发了几条消息，模型内部调了几次不关他事。turn 留在数据层做聚合标识和 `parent_run_id` 的挂点，不上界面。

### 11.4 输出落盘（`e70dc3e`）

两处截断（`tool_guard` 24000 / `harness/tool_gateway` 30000 字符）直接丢内容。模型为了看后半截只能重复调同一个工具，把上下文和额度一起烧，还容易被判死循环。

`spill.py`：全文落 `data/spills/<project>/<run_id>/`，回模型 4000 字预览 + `spill_id` + `next_start`，`read_tool_output` 分页读完。

**为什么不用 `read_file`**：spill 目录在 `agent_backend/data` 下，通常不在用户权限根里，`read_file` 会按档位拒绝。专用读取只认 spill 根，`spill_id` 走 `^s[0-9a-f]{6,32}$` 白名单 + `relative_to(ROOT)` 校验，既不放宽权限也不留穿越缝。

### 11.5 MCP 客户端（`e70dc3e`）

stdio + 换行分隔 JSON-RPC 2.0（initialize / initialized / tools/list / tools/call）。工具变 `mcp__<server>__<tool>`，`args_schema` 由 `inputSchema` 现场生成 pydantic 模型，模型看到的是真实参数。

**stdout 必须独立线程 + queue**：`readline()` 阻塞，不这么做超时就是摆设（改前实测 32 秒，改后 1.5 秒）。

`harness/registry.py` 加 `CAPABILITY_PREFIXES = {'mcp__': 'external'}`，加一个 server 不用改能力表。

### 11.6 子智能体（`72bb67e`）

子 run 有自己的 run_id / receipt / 事件流，父 run 只留一条 `subagents[]` 追加事件。**父回执不随子任务变大**——这个形态只有在事件流收口之后才成立。

递归双保险：`MAX_DEPTH=1` 时 `build_tools` 返回空列表，`execute()` 再过滤一遍，不靠调用方自觉。

顺带修 `store.save_run` 的裸 `INSERT` → upsert：子 run 先落初始回执、跑完更新同一 id，会撞 `UNIQUE constraint failed`。

### 11.7 跨轮目标（`dca0ed8`）

会话级，一会话最多一个 active。每轮注入「目标 + 已推进几轮 + 已登记阶段 + 最近 5 条进展」。

**刻意不复用 plan**：plan 是「这一轮怎么走」，goal 是「这些轮为了什么」。

### 11.8 并行 fan-out（`dca0ed8`）

`run_parallel_subagents` ≤6 个，`gather(return_exceptions=True)`。**每项用自己的 model 实例**——同一个实例被多个协程同时用，请求级状态（思考强度、重试计数）会互相污染。

### 11.9 能力目录（`dca0ed8`）

`GET /agent/catalog` 分三层：框架 / 应用 / 外部。单机产品没有社区生态，「插件市场」的实际形态就是**一眼看清每个能力来自哪一层、怎么换**。

### 11.10 提示词留存（`421279f`）

分层后 2579 字应用层政策搬进了 `creation_studio.py`，没有任何入口能读回来；关掉一段政策还会把原文一起丢掉。

`chat_policy.segments()` 返回 `{id, layer, chars, enabled, text}`，`build()` 只是 join enabled 的那部分——**关掉只影响进不进提示，原文一直在**。`GET /agent/app-pack/prompt?compare=generic` 能取回切走的 2579 字全文（三段：GenUI 1081 / 出图路径 423 / 智能推荐 1075）。

### 11.11 这两轮踩到的坑

全是真问题，没有一条是环境问题。

| 坑 | 表现 | 修法 |
|---|---|---|
| 哑巴 503 | 工具初始化失败只回「智能体工具初始化失败」，异常被 `except Exception:` 吞掉 | 记 `logging.exception`，一眼看到 `Unregistered runtime capability` |
| 能力表要手工登记 | 新工具不在 `CAPABILITIES` 里就 503 | 补登记 + `mcp__` 前缀放行 |
| 测试连真服务 | `_wmd_channels()` 打 17821，服务起没起决定断言（2 vs 6 个模型） | 打桩。**假通过比没有测试更危险** |
| `readline()` 阻塞 | MCP 超时设 0.5 秒，实际跑了 32 秒 | 独立线程 + `queue.Queue` |
| 裸 `INSERT` | 子 run 撞 `UNIQUE constraint failed` | 改 `ON CONFLICT DO UPDATE` |
| 前端 2 条顽固失败 | `asset-folders` 仍在渲染、缺 `id="studio-generate-hint"` | **未修**，属之前没收尾的 UI 重构 |
| **改错了容器** | 给 `.ask-traj` 加限高，而它根本没有调用点；真正渲染的是 `askTraceHtml` 里的 `.ask-trace-rows` | 先确认「哪段 DOM 真的渲染出来」再改样式。`askTrajHtml` 是死代码，`grep` 调用点一次就能看出来 |
| 清理临时目录撞 EPERM | 三个测试 `kill` 后立刻 `rmSync`，进程未退文件仍被持有 | 等 `exit` 事件 + 重试，删不掉就放弃 |

### 11.12 测试盘子与真机验证

```
后端  321 passed   服务全开着跑出来的，不依赖外部状态
前端  551 passed / 2 failed   上面那两条
```

真模型跑两轮：一轮 113 个 SSE 事件，`turn.stats` 是真实数字（llm 4281ms / 首字 4044ms / 解码 844ms / 179 tokens / 212.1 tok/s），落库事件重放 `identical=True`、48 事件、`diff=[]`。
