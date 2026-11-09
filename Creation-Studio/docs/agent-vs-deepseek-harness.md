# 智能体对比清单：创作台 vs DeepSeek Harness

对照对象：本机 `DeepSeek Harness` 桌面版（Electron + cordis 插件化 monorepo，约 240 个 `@deepseek-ai/dsh-*` 包，已解包到 `Creation-Studio/_tmp/dsh-src/`，每个包自带中文设计文档 `README.zh.md`）。
对照范围：`@` / `/` 交互 · 计速 · 上下文压缩 · 技能，外加轮次语义与运行态展示。

---

## 0. 先看清我们自己的架构事实

这一节必须先摆出来，否则后面所有对比都会跑偏。

**我们有两套引擎，产品实际跑的是弱的那套。**

| | legacy（实际在跑） | harness（有设计没启用） |
|---|---|---|
| 启用条件 | 默认 | `harness/runtime.py:12-21` 要求项目 id 在 `HARNESS_PROJECT_ALLOWLIST` |
| 当前状态 | **`start-agent.cmd` 里没有这个变量 → 走 legacy** | 代码齐全，未生效 |
| 入口 | `main.py:272-278` | `main.py` 同分支的 else |
| 上下文 | `assemble()` + `trim_to_budget()` | `harness/context.py` 带自动压缩 |
| token 累计 | `receipt['usage']`，**只保留最后一次，不累加** | `BudgetLedger.publish()` **累加** + `budget` 明细 |
| 每模型调用计时 | 无 | `model_started` / `model_finished{duration_ms,usage}` 事件 |

**SSE 信封**：所有帧只有 `data: {json}`，**没有 `event:` 行**，事件名在 `json.type` 里（`main.py:374,569`）。前端消费在 `web/app.js:9031-9159` 的 `askApplyEvent()`。全清单共 24 种（见 §10）。

含义很直接：我们在 harness 里已经写好的那些「累加用量 / 每调用计时 / 自动压缩 / 技能冻结」，产品里**一条都没跑**。所以「操作和展示呆瓜」的一半原因不是前端不会画，是数据源没接上。

---

## 1. `@` 提及

### 我们怎么做

| 环节 | 实现 | 位置 |
|---|---|---|
| 触发判定 | `/(?:^|\s)@([^\s@]*)$/`，要求光标无选区 | `app.js:9470-9472` |
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

| 项 | 我们 | DSH |
|---|---|---|
| source | 1 个（三类混排） | 文件 / 目录 / 会话 / 技能四个独立 source |
| 语法 | 无引号规则，空格即断 | `@path`、`@"path"`、`@"dir/` 开放式 |
| 目录 | 递归后丢弃层级 | drill + 面包屑 |
| 原子性 | 纯文本，`file_ids` 不写 | 原子行内 chip + 稳定剪贴板形式 |
| 空格/回车 | 无仲裁 | `matchSpace`/`matchEnter` 仲裁 |
| 重开抑制 | 无 | 有 |
| 内容 | 选中即引用 | 只给路径，内容靠工具读 |

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

| 项 | 我们 | DSH |
|---|---|---|
| token 总量 | 有（legacy 不累加） | 有（累加 + 缓存分桶） |
| TTFT | **采了没展示** | `ttftMs`/`ttftSteps`，展示在 dock |
| 总耗时 | 有，只进「用时」文案 | 有，但**故意不显示在完成页脚** |
| LLM / 工具分解 | 无 | `llmMs` / `toolMs` |
| 输出速率 | 无 | `decodeTokens/decodeMs` |
| 缓存命中 | 无 | `cacheRead` / `cacheWrite` + 命中率 |
| 不完整时 | 拿到什么显示什么 | 整块隐藏 |

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

| 项 | 我们 | DSH |
|---|---|---|
| 摘要 | 有（≤1500 字自由中文，hash 校验） | 有（**8 段固定 schema**，空段 `(none)`，已有摘要要合并） |
| 覆盖校验 | 有（`message_hashes`） | 有（surface 位置锚点 + 影子价） |
| **收缩校验** | 无 | **摘要 token 必须小于被遮蔽量，否则抛错** |
| 阈值 | `estimate > 预算×0.7` + 消息 >6 条（仅 harness） | `floor(min(W×0.8, W−O−65536))` **绝对值**比较 |
| 保留尾部 | 无——`trim_to_budget` 从最旧 pop | `floor((W−O)×0.16)` 从尾逐节点累加 |
| 边界安全 | 无 | **系统提示词永不遮蔽** + 回退到 tool 配对平衡点 |
| 溢出兜底 | `>0.9` 直接 422 | 收到 `CONTEXT_WINDOW_EXCEEDED` 后 `retain=0` 强制压缩并重试 1 次 |
| 事务 | 无，直接写库 | `start`（即加锁）→ `summary` → 替换 → `end`，恰好闭合一次 |
| 自动触发 | **只有 harness，产品未启用** | 三级：软阈值 / 硬溢出 / 模型切换前 |
| 手动 | `/compact` + `confirm` | `/compact`（无参数，busy 拒绝） |
| **通知前端** | **无** | **有（日志事件 + 投影）** |
| **UI 呈现** | 只有一个 toast | 压缩卡片（`已压缩 N 条历史（约 M tokens）`）+ `ContextMeter` 环 + Trajectory `Between turns` |
| 占用口径 | `input+output` 累加 + 后续按字数估 | `used = projectedTokens ?? pressureTokens`（**压缩一落地就变小**） |
| 图片 / 工具结果 / 大输出 | 无独立策略 | 三条独立策略（prune 8192/4096/1024、spill 首尾各半） |

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

| 项 | 我们 | DSH |
|---|---|---|
| 数量 | 单选 1 个 | 多选叠加 |
| 目录可见性 | 系统提示只写选中的那一个；自定义技能名不进工具描述 | 持久目录列出全部（名 + 截断描述，默认 500 字符） |
| 加载 | `read_analysis_guidance(topic)` 按需取正文（**已具备**） | `skill` 工具按需取正文 |
| 正文体积 | `compose()` 全量拼接 references，60k 硬上限 + 截断 | 正文无上限（明确列为已知限制），资源只给指引 |
| 目录更新 | 每轮重拼 | 追加式替换 + digest 差分 + 空目录作废 |
| 调用策略 | 启用 / 停用 | `modelInvocable` × `userInvocable` 四组合 |
| 用户路径 | 只能在 `@` 里挑 | `/name` 直接键入，注入到步骤最后 |
| 可见性 | 只有工具行「正在读取指导文档」 | `Instructions` 卡片 + 可展开正文 + 右侧栏看 SKILL.md |

---

## 6. 轮次语义与运行态展示

### 我们

`max_rounds` 输入框（默认 120，10–400）→ `ChatRequest.max_rounds` → `graph.astream(..., config={'recursion_limit': ...})`。这是 **LangGraph 图递归步数**，不是「对话轮次」，但界面写着「轮次」。

运行中气泡只有固定文案 + `0s` 秒表 + 停止按钮（`app.js:8232`），没有「第几步 / 第几次模型调用 / 现在跑哪个工具」。轨迹里有「第 N 轮输入」「第 N 轮结束」和工具行，但**要先展开轨迹**才看得到。

### DSH

- **`turn`（轮）**= 用户一次提交；**`step`（步）**= 一次模型调用 + 一次工具批次。`step/end` 在 `finally` 里恰好追加一条，完成 / 失败 / 取消 / max-tokens 的步都落地。
- 已知限制里**明确写着「没有内置轮次预算」**——失控轮次要从 `agent/turn-stopping` 扩展点执行取消。DSH 不把 recursion limit 摆到用户面前。
- 运行态：`running` 分组标题、思考预览、工具与命令行、当前重试行、底部运行状态用共享 `TextShimmer`（每行文字共用一道从左到右的高光）；完成时**一次性收起**整轮工作行，且「读者跟随底部时，收起前第一个可见行保持屏幕位置」。
- 间距定死：流程行 4px、展开组标题与内容 8px、Assistant 回复与相邻过程行 12px、完成／耗时控件与输入 16px。
- 进行中的记录**只画开始标记**，不虚构耗时。

### 差距

我们的「轮次」是引擎参数，DSH 的 turn/step 是领域模型；我们的运行态是一个秒表，DSH 把每条过程行做成可追踪、可收起、带 shimmer 的结构。

轨迹我们**有底子**：`trajectory_events` 表（`store.py:43-77`）+ 分页接口 `GET /agent/sessions/{sid}/trajectory?offset&limit&run_id`（`main.py:640-648`）+ SSE 的 `trajectory_item` / `trajectory_delta` + 前端 `ask-traj`（`app.js:7692-7702`，最近 50 条，role / kind / 时间 / 内容前 500 字）。缺的是：时间概览、TTFT 与解码时间条、可展开调用检查器、虚拟化。

---

## 7. DSH 有、我们没有 —— 按落地价值排序

| 优先级 | 能力 | DSH 包 | 我们的缺口 |
|---|---|---|---|
| **P0** | 让压缩变成可见事件 | `dsh-compaction*` / `dsh-command-compact` | 压缩静默，只有一个 toast |
| **P0** | 技能持久目录（清单型，非单选） | `dsh-skill` / `dsh-tool-skill` | 系统提示只写选中那一个，自定义技能名模型看不见 |
| **P0** | `sessionStats` 投影（turns/steps/llmMs/toolMs/ttftMs/decodeMs/decodeTokens） | `dsh-session-stats` | 有 `first_token_ms`/`duration_ms`/`usage`，无分解无速率 |
| **P0** | 命令注册表 + 会话级目录 | `dsh-commands` / `dsh-client-ui-commands` | `/` 正则里三个写死命令 |
| **P1** | composer dock 统计控件（activity / usage） | `dsh-client-ui-chat` | 一个环形占用 |
| **P1** | 输入触发 source 注册 + drill + 空格/回车仲裁 | `dsh-client-ui-input-trigger` | 单 source，无仲裁，无重开抑制 |
| **P1** | 原子引用 + `@"..."` 语法 | `dsh-client-ui-reference` / `dsh-file-reference` | 纯文本回写，带空格路径选不到 |
| **P1** | 每轮 token 用量页脚（不完整则整块隐藏） | `dsh-client-ui-chat` | 无 |
| **P1** | 启用 harness 路径 | — | 设计好了没开开关 |
| **P2** | Trajectory 时间概览（TTFT vs 解码条） | `dsh-client-ui-trajectory` | 有简化轨迹列表，无时间轴 / 无检查器 |
| **P2** | 图片 offload / 工具结果裁剪 / 输出落盘 | `dsh-compaction-*` / `dsh-spill-policy` | 无 |
| **P2** | 会话日志事件流 + 投影回放 | `dsh-session*` | 消息数组 + SQLite 摘要表 |
| **P2** | 排队 / steer / 回执发件机器 | `dsh-client-ui-conversation` | 单条在途 |
| **P2** | 技能 `Instructions` 卡片 | `dsh-client-ui-skill` | 只有工具行文案 |
| **P2** | turn/step 领域模型 | `dsh-agent-loop` | 用 LangGraph 递归步数顶替 |
| **P3** | 子代理 / workflow / goal / plan / schedule | `dsh-subagent` / `dsh-workflow` / `dsh-goal` / `dsh-plan-mode` | 无 |
| **P3** | 插件市场 / MCP / ACP | `dsh-plugin-market` / `dsh-mcp-client` / `dsh-acp` | 无 |

## 8. 我们有、DSH 没有

| 能力 | 说明 |
|---|---|
| 创作任务域 | 图像 / 视频任务、素材库、分镜、剪辑；DSH 是通用 agent |
| 单输入框多参数 | 模型 + 思考强度 + 轮次 + 运行权限挤在 composer 一行 |
| `contextReport` 6 分项 | Messages / System tools / Skills / System prompt / Autocompact buffer / Free space；DSH 的 `contextBreakdown` 只有 3 项 |
| 预算硬闸 | `budget.py` 的 `output_tokens_exceeded` / `tool_calls` 上限 + 422 不静默截断 |
| 压缩覆盖 hash 校验 | `message_hashes` 逐条比对；DSH 用位置锚点 |
| 技能正文 `compose()` 拼接 | 自动带上 `references/` 与根目录文本；DSH 只给资源指引不列举 |

---

## 9. 落地顺序

1. **先把 harness 打开，或者把 harness 里那几项搬进 legacy**。现在等于拿着两套代码跑弱的一套：`usage` 不累加、没有每调用计时、没有自动压缩、技能冻结不生效。这是所有后续工作的前提。
2. **让压缩可见**（半天量级，收益最大）：
   - 后端压缩成功后 append 一条 SSE：`{type:'compacted', compaction:{id, shadowed, shadowed_chars, summary_chars, kept, model, at, summary}}`，`shadowed` 用 `len(summary['message_ids'])`。
   - 前端在消息流里插一张可展开卡片，标题「上下文已压缩」，副标题「已压缩 N 条历史记录（约 M tokens）」，展开显示摘要正文；样式照 DSH 的 `CompactionItem`（图标 + 折叠箭头 + sticky 头栏）。
   - `ask-ctx` 环的 `used` 改成**优先用「下一轮预计」而不是「上一轮实际」**——DSH 用 `projectedTokens ?? pressureTokens`，这样压缩一落地环就变小。
   - 压缩完同时刷新 `receipt.context`，让 Summary 面板的 6 分项条同步。
3. **把 `/` 从正则改成注册表**：前端一个 `commands` 数组 + 一个 `GET /agent/commands` 目录接口，顺手把「加命令要改两处」消掉。
4. **上 sessionStats**：后端补 `llmMs` / `toolMs` / `decodeMs` / `decodeTokens`（harness 的 `model_finished.duration_ms` 已经给了单次模型时间），前端加 composer dock 两个控件。TTFT 和速率自然就有了。
5. **技能改成持久目录**：把「选中的那一个」换成「持久目录消息 + 工具按名加载」，同时把自定义技能的 description 带进目录。我们已经有 `read_analysis_guidance(topic)` 这个按需加载通道，缺的只是**目录**——把系统提示里那一行换成 `name + description` 列表即可，`allowed_topics` 相应放宽到目录全集。
6. **压缩算法对齐**（可选的第二轮）：阈值换成绝对值 `floor(min(W×0.8, W−O−65536))`、保留尾部 `floor((W−O)×0.16)`、加「系统提示词不遮蔽」和「摘要必须小于被遮蔽量」两条硬校验。`Message_hashes` 的覆盖校验我们已经有了，比 DSH 的位置锚点更严格，保留。
7. **`@` 加引号语法和 drill**：先解决「带空格路径选不到」这个硬 bug，再考虑下钻。

> DSH 的结论均来自 `_tmp/dsh-src/<包名>/README.zh.md`（各包自带中文设计文档）。我们的行号对应本次提交时的 `web/app.js`、`agent_backend/app/*.py`、`src/server.js`。

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

## 11. 本轮已落地（2026-11-09）

8 条「值得学」全部实现并逐条实测。

| # | 能力 | 改了哪里 | 实测 |
|---|---|---|---|
| 1 | 压缩可见 | `main.py` `compaction_card()` / `_compacted_response()`；`app.js` `askCompactionCardHtml()`；`agent-workspace.css` `.ask-cps` | 压缩后会话 42 条（41 + 1 卡片），`shadowed=41`、摘要 2072 字；模型可见仍 41 条（`messages()` 只收 user/assistant） |
| 2 | 技能持久目录 | `skills.py` `catalog()`；`chat_policy.py` 目录段；`main.py` `allowed_topics` 放宽；`task_tools.py` 动态 docstring | 目录 18 条（5 内置 + 13 自定义）；`read_analysis_guidance('skill:dir:抽帧检查')` 返回 `ok=True`，正文 532 字 |
| 3 | 计速 | `cycle_trace.py` `awrap_tool_call` + `llm_ms/tool_ms`；`main.py` `receipt['timing']`；`app.js` `askSpeedHtml()` | `{"llm_ms":3094,"tool_ms":0,"model_calls":1,"ttft_ms":2939,"decode_ms":828,"decode_tokens":79,"tps":95.4}` |
| 4 | 命令注册表 | `main.py` `COMMANDS` + `GET /agent/commands`；`app.js` `askLoadCommands()` / `askCommandList()` | `/` 弹层 4 条：`/model /think /compact /help` |
| 5 | `@` 语法 | `app.js` `askUpdateMention()` 引号分支 + `mentionClosed`；`askChooseFile()` 自动加引号；keydown 空格仲裁 | `@"3d` → `quoted:true`；选中带空格路径写出 `@"assets/a b.png" `；关闭后同位置不重开、改查询重新武装；空格选中 `@普通聊天 ` |
| 6 | composer dock | `app.js` `askSessionStats()` / `askStatDockHtml()`；CSS `.ask-stat-dock` | `轮次 2 · 步骤 1 · 95.4 tok/s · 模型 3.1s · 首字 2.9s` / `输入 16k · 输出 359 · 合计 16k` |
| 7 | 每轮页脚 | `app.js` `askTurnUsageHtml()`；CSS `.ask-turn-usage` | `95.4 tok/s · 首字 2.9s · 输出 79 tokens`，展开 7 项分解；无 timing 的旧轮整块不显示 |
| 8 | 压缩硬校验 | `context.py` `compaction_range()` + 收缩校验；`main.py` 同步 | 末尾未答完的一条不被压缩；摘要不比原文短（>4000 字节才校验）则 422；二次压缩 422「没有需要压缩的新消息」 |

### 顺带修掉的一个真 bug

原来的 `summary_payload(summary, items)` 把**全部** `items` 标成已覆盖，但摘要只基于 `fresh`。如果压缩时末尾那条被剔除（或未来任何范围收窄），那条消息会被标成「已覆盖」然后悄悄消失——下一轮模型再也看不到它。

改成 `summary_payload(summary, covered_items)`，`covered_items = items[:covered + len(fresh)]`，只标记真正进了摘要的部分。

### 测试

- `agent_backend`：234 passed / 4 failed。4 个失败里 1 个按新行为更新了断言（`test_chat_policy`），3 个（`test_models` / `test_system_models` ×2）是渠道环境隔离问题，与本次改动无关（`model_options()` 读到了真实 `agent_settings.json` 的 5 个渠道）。
- 前端 `node --test`：108 passed。

---

## 12. 分层改造：框架层只出契约，应用层出配置（P0-A 已落地）

### 12.1 之前错在哪

先说清楚判断错在哪：原来把「创作台不需要这些」当成不学 harness 的理由——这是**用应用层的短期需求去否决框架层的契约**。harness 的意义是反的：框架层只提供通用契约，应用层（创作台、管理器、任何新应用）用 skill + 配置去实现，换应用只换配置和技能。

而且实测出来的耦合度比预想的更深：

| 指标 | 改前 |
|---|---|
| `chat_policy.system_prompt()` 单串长度 | **3405 字**，一个 f-string 拼到底 |
| 其中应用层领域词 | GenUI 2 · AsyncImage 4 · target_path 3 · ask_choice 3 · 小说 4 · 分镜 5 · 剧本 5 · 素材 9 · 短剧 1 · 资产 7 = **43 处** |
| 代码里的「应用」概念 | `preset` / `profile` / `application` / `app_id` / `domain` 全 **0** 命中 |
| 加第 27 个能力要改几处 | receipt 字段 + 前端解析 + 测试，三处起步 |

结论：框架层和应用层糊在同一个字符串里，所以「换应用」等于改代码，「加能力」等于改 schema。

### 12.2 契约

```
框架层（不随应用变）              应用层（换应用只换这层）
─────────────────────────────   ─────────────────────────────
session / run / turn / step        product        产品名
event / projection                 forbidden_pipelines  不该被当流水线的领域词
tool / skill / command registry    policies[]     可整体开关的政策段
模型路由 · 预算 · 权限 · 沙箱        skill_topics   技能名 → 指导正文 topic
执行中追加 · 恢复标记 · 附件元数据    skill_sources  技能从哪加载
```

`Pack` 只是个 dataclass（`agent_backend/app/app_packs/base.py`），框架代码只认这七个字段，不认识任何领域词。

### 12.3 落地物

| 文件 | 作用 |
|---|---|
| `app/app_packs/base.py` | `Pack` / `Policy` 契约 + `envelope()` 诊断视图 |
| `app/app_packs/framework.py` | 框架层文案：身份基线（`{product}` / `{forbidden}` 两个占位符）+ 执行中追加 |
| `app/app_packs/creation_studio.py` | 创作台包：3 段政策原文（GenUI 1081 字 / 出图路径 423 字 / ask_choice 1075 字）+ skill_topics |
| `app/app_packs/generic.py` | 通用助手包：0 段政策、0 个技能 topic |
| `app/app_packs/__init__.py` | 注册表 + `WMD_APP_PACK` 选择器 |
| `app/chat_policy.py` | 从 126 行降到只做**顺序与条件分支**，领域词 43 → 0 |
| `GET /agent/app-pack` | 当前包 id / 政策段字数 / 可用包 / 提示词总字数 / 切换说明 |

创作台的 3 段政策**不是手抄的**：由 `_tmp/split_policy.py` 从原 `identity` 串按段首标记切出来再用 `repr()` 落盘，脚本自带 `assert rebuilt == identity`，切分有损就中止。

### 12.4 实测

```
包 id             名称       提示词字数  政策段  残留领域词
creation-studio   创作台          3401      3   GenUI、AsyncImage、target_path、ask_choice、素材、
                                                分镜、剧本、小说、出图、集数、三视图、短剧
generic           通用助手         818      0   （无）
```

- 换应用：`WMD_APP_PACK=generic` → 同一个后端的提示词从 3401 字降到 818 字，剩的 818 字全是框架层（身份基线 + 执行中追加 + 技能分支 + 附件元数据），一处领域词都不带。
- 关能力：把 `image.paths` 的 `enabled` 置 false → 提示词 3401 → 2978 字，差 **423 字**，正好等于该政策原文长度，其余一字不动。
- 环境变量留空 / 未设置 → `creation-studio`，产品行为不变。

### 12.5 验收口径

**逐字节相同**，不是「跑起来看着对」。`_tmp/verify_prompt.py` 从 `git show 07b3758:.../chat_policy.py` 取出拆层前的实现，与拆层后并排跑五种参数组合：

```
OK   bare                    3401 chars
OK   topic                   3557 chars
OK   catalog+attachment      3982 chars
OK   checkpoint+full-perm    4672 chars
OK   workspace-perm          3925 chars
result: PASS
```

组合覆盖：空参数、选技能、技能目录 + 附件、恢复标记 + 完全访问权限、工作区权限（多根目录）。目录用例里还塞了空 description、无 topic、无名条目、超 200 字简介四种边界。

### 12.6 回滚

`agent_backend/app/app_packs/` 是纯新增目录，`chat_policy.system_prompt()` 签名一字未改（末尾多一个可选 `pack=None`）。要退回旧行为直接把 `WMD_APP_PACK` 设成 `creation-studio` 或留空；要退回旧代码就 checkout 上一个提交。

### 12.7 新增测试

`tests/test_app_packs.py`（8 条）把分层的硬约束钉住：

- `framework.py` 与 `chat_policy.py` 里不允许出现 `GenUI / AsyncImage / target_path / ask_choice / 出图 / 分镜 / 集数 / 剧本 / 小说`（这两个文件是框架层，出现就是分层失败）
- 创作台包必须含全部领域词，通用包必须一个都不含
- 关掉一段政策，提示词缩减量精确等于该段字数，且 `full.replace(text, '') == cut`
- 未知包名抛 `KeyError`，空值回落到 `creation-studio`
- `build(pack)` 是纯函数：环境变量在调用之间变化不影响结果

顺带修掉两条**本来就坏**的测试（不是这次改坏的）：

- `test_skills.py` 引用被搬走的 `skills.SKILL_TOPICS`，改为 `skills.skill_topics()`。
- `test_models.py::test_request_selection_and_effort_mapping` 依赖真实运行中的创作台服务（`_wmd_channels()` 打 HTTP 到 17821），服务没起就假失败；同时它还在用一个「provider 会凭空多列 deepseek-flash」的旧契约。改成打桩渠道 + 用配置里的真实模型名。

### 12.8 后续阶段

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0-B** | 事件流收口：receipt 的 26 个平铺字段全部改成从事件 fold 出来，receipt 退化成投影结果 | 同一轮 run，fold 出的 receipt 与现在逐字段相等 |
| **P0-C** | turn / step 命名：`cycle_trace.cycle` 正名为 step，一次用户提交正名为 turn | 前端统计条显示不变，数据来源换名 |
| **P1-A** | MCP client：`mcp_servers` 进 `Pack`，工具动态注册 | 接一个本地 MCP server，工具结果落进事件流 |
| **P1-B** | 输出 spill：大工具输出落盘 + 回读 | >100KB 输出不再被截断丢弃 |
| **P1-C** | subagent：子 run 作为独立事件子流 | 一个 3 集任务拆成 3 个子 run 并行 |
| **P2** | workflow / goal / plugin market | 等 P0/P1 长稳 |

为什么 P0-A 先做、P0-B 后做：P0-A 不碰运行时（纯提示词装配），能用「逐字节相同」验收；P0-B 要动 receipt 和前端，风险高一档，而且它需要应用包先声明「这个应用关心哪些投影字段」——那个声明现在才刚有地方放。

