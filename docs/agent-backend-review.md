# 智能体后端评审报告

范围：`Creation-Studio/agent_backend`（:17820）全部代码与数据，以及它与控制器、`ml-engineer`、`deer-flow` 的关系。
基准：`D:\notebook\AIGC\deer-flow-v0\deer-flow\backend`（完整版）与 `new-flow`（简版）。
结论先行：**代码量少是因为砍掉了业务分析那一整套，但砍得不干净**；上下文处理不是"简略"，是**只剩截断**——已有的摘要能力被项目 allowlist 关在门外。

---

## 一、不属于这个项目的文件 / 代码

### A. 跨项目运行时依赖（最严重，随时会炸）

| 位置 | 内容 | 风险 |
| --- | --- | --- |
| `Creation-Studio/scripts/launch.js:29` | `PYTHON = D:/notebook/AIGC/ml-engineer/backend/.venv/Scripts/python.exe` | 智能体跑在**另一个项目**的虚拟环境里 |
| `Creation-Studio/src/server.js:566` | 同上（服务自启路径） | 同上 |
| `Creation-Studio/tests/review-regressions.test.js:132` | 同上 | 测试也依赖那个 venv |
| `Creation-Studio/start-agent.cmd:4` | `AGENT_PYTHON=…ml-engineer\backend\.venv\Scripts\python.exe` | 同上 |
| `agent_backend/start.sh:5` | 同上（Git Bash） | 同上 |
| `agent_backend/README.md:35` | "共用 ml-engineer 的 Python venv" | 文档把临时方案写成了设计 |

`ml-engineer` 一旦删目录、升 Python、重装依赖，智能体直接起不来；而 `agent_backend/requirements.txt` 明明列了 11 项依赖，却没有自己的环境。

### B. 从 ml-engineer 搬来的业务分析代码（死代码，但仍在执行链上）

| 文件 | 行数 | 内容 | 现状 |
| --- | --- | --- | --- |
| `app/project_context.py` | 134 | `ResourceSelection(dataset_id/dataset_version_id/package_id)`、`resolve_context`、`read_dataset_schema`、`read_strategy_rules`、`BUSINESS_API_URL=http://127.0.0.1:3014/api`、"客户行/策略包/credit_score"语义 | `main.py:135` 每轮仍调 `resolve_context`（前端从不传 `context`，永远返回 None，白等一个 await）；两个工具在 harness 权限表里注册、在 `main.py:221` 挂载 |
| `app/harness/identity.py` | 26 | `HARNESS_AUTH_MODE=business` 时调 `/auth/me`、`/projects/{id}` | 默认 `development`（`launch.js:119`），不联网；但代码与业务后端强绑定 |
| `app/harness/runtime.py:13` | — | `HARNESS_PROJECT_ALLOWLIST` 默认 `wenyun-m-desktop` | **本产品项目 id 是 `proj-…`，所以 harness 永远关闭**（实测 `"harness_runtime": false`），连带 `context.prepare/compact`、预算账本、检查点全部不生效 |
| `app/main.py:24` | — | `FastAPI(title='ML Engineer Agent')` | 服务名还是原项目 |
| `app/main.py` receipt | — | `business_tools`、`business_tool_count`、`evidence_scope`（"不含业务指标计算"） | 每次运行回执都带业务分析口径 |
| `agent_backend/CONTEXT.md` | 18 | 整篇 `agent-context/1.0` 数据集/策略包说明 | 与本产品无关 |
| `tests/test_project_context.py` | — | 数据集/策略包工具测试 | 同上 |

`task_tools.py:1` 的注释 "No business database, shell or deployment access" 也是当年的边界声明——上一轮加文件/命令工具时，正是它把能力锁死的根源。

### C. 占位项目名贯穿三处

| 位置 | 值 |
| --- | --- |
| `src/server.js:47` | `AGENT_PROJECT = 'wenyun-m-desktop'`（前端没带 `X-Project-Id` 时的兜底） |
| `scripts/launch.js:57` | 健康检查固定用 `wenyun-m-desktop` |
| `agent_backend/import_skills.js:11` | `PROJECT = 'wenyun-m-desktop'`，且技能源目录硬编码 `C:/Users/Mr.luo/Desktop/相关提示词/A9版本全流程/skills` |
| `app/harness/runtime.py:13` | allowlist 默认值 |

结果是：真实 UI 请求（带 `proj-…`）走 legacy 引擎；只有**兜底请求**才会命中 harness。实测 `conversations.db` 52 个会话全在 `proj-b1a9643a02` 下，所以 harness 从未跑过。

### D. 数据与脚本残留

| 文件 | 说明 | 建议 |
| --- | --- | --- |
| `data/_probe_files.py`、`data/_probe_projects.py` | 一次性排查脚本，硬编码 `data/conversations.db` | 删 |
| `data/工作空间读取验收.txt` | 验收用测试文件 | 删 |
| `data/agent-run.err`（0.4 KB） | 旧 stderr，内容是 17820 端口冲突日志 | 删 |
| `data/workspace/*`（55 目录 / 44 文件 / 13.1 MB） | 用户真实附件，`_trash`/`_backup` 也在里面 | 留，但需要清理策略 |
| `app/__pycache__` 里 `cpython-38`（10 个）+ `cpython-312`（2 个） | 另外两个解释器留下的，当前跑 3.11 | 删 |
| `.pytest_cache/` | 无意义产物 | 删 + 加 `.gitignore` |
| `data/conversations.db` 内 `project='codex-chat-policy-check'` 的执行记录 ×1 | 外部项目名 | 删 |
| 同库 `compactions` 表 1 条 `mp-test-*` | 旧格式（无 `message_hashes`/`schema_version`），`valid()` 判失效 | 删（见第二节 ⑤） |
| `Creation-Studio/evidence/reverse-engineering.md:344/726/742` | 历史记录里引用 ml-engineer 前端组件 | 留（历史证据），但不要再当设计依据 |

### E. 处置优先级

1. **A 类必须做**：给 `agent_backend` 建自己的 venv（`uv venv .venv` + `uv pip install -r requirements.txt`），5 处硬编码改成 `agent_backend/.venv/Scripts/python.exe`，保留 `WMD_PYTHON`/`AGENT_PYTHON` 覆盖。
2. **B 类先删调用再加能力**：`main.py` 去掉 `resolve_context`，删 `project_context.py` + 两个工具 + 对应测试 + `CONTEXT.md`，receipt 去掉 `business_*` / `evidence_scope`。
3. **C 类统一成真实项目**：兜底项目名改成 `proj-…` 或空；allowlist 决定用不用 harness（见第二节 P1）。
4. **D 类清理**：一条命令，不影响功能。

---

## 二、上下文处理评审

### 2.1 现状：三层，只有第一层在跑

| 层 | 实现 | 是否生效 |
| --- | --- | --- |
| 存储 | `app/store.py`，整个会话一段 JSON 存 `conversations` 表 | ✅ |
| 组装 | `main.py` legacy 分支 → `harness_context.trim()`：按 UTF-8 字节预算**从头 pop 掉最旧消息** | ✅（唯一的保护） |
| 压缩 | `harness_context.compact()`（hash 校验 + 分批 + schema 版本）与 `_compact_session()`（legacy 版）两套 | ⚠️ 只有用户手动 `/compact`，且走的是 legacy 那套 |
| 自动压缩 | `HARNESS_AUTO_COMPACT_ENABLED`（默认关）+ harness 路径 | ❌ 项目不在 allowlist，永不执行 |
| 预算表 | `app/harness/windows.py` 硬编码 + `BYTES_PER_TOKEN=2` | ✅ 但数字不对 |

真正的"上下文管理"就一句话：**超预算就把最旧的消息扔掉，不告诉任何人。**

### 2.2 实测问题（真实会话数据）

**① 预算表与实际窗口差 8 倍**
`windows.py`：`gpt-5→20k`、`gemini/deepseek→1024k`、其余默认 **500k**。当前在用的三个模型 `gpt-6-astra-wm`、`deepseek-flash`、`gemini-3.8-flash-medium` 里，前两个都匹配不到真实窗口（`gpt-6-astra-wm` 落默认 500k；`deepseek` 被写成 1024k，实际 128k）。

**② 会话 `38d8877f` 已经撑爆了，而且没人管**
真实数据：

| 指标 | 数值 |
| --- | --- |
| 消息数 / 文本量 | 28 条 / 364,614 字符 |
| `trim()` 算出的历史体积 | 741,782 字节 |
| deepseek-flash 触发线（0.9） | 1,843,200 字节 |
| 折算 token（÷1.6） | ≈ **227,883** |
| DeepSeek 真实窗口 | **128,000** |

→ 历史是窗口的 1.8 倍，**但 `trim` 一次都没触发**（741 KB < 1.84 MB），直接把 22.8 万 token 塞给 12.8 万窗口。该会话第 25、27 轮就是这样失败的，用户看到的报错是 `模型请求失败：ValueError`。

**③ 单条回复 18 万字符，且被存了两份**
第 21 条（取消，91,045 字符）和第 23 条（完成，182,308 字符）是同一个问题的两次回复，两条都完整进了历史。内容是 GenUI 组件源码（`<box gap={4}>`、`<row align=…>`），既不可读又占满窗口。取消的回复也照样存、照样发。

**④ 截断是静默的**
`trim()` 只 `rows.pop(0)`，不写事件、不进 receipt、不插提示。模型不知道前面被裁过 → 第一个人设/风格/约束消失，然后开始编。

**⑤ 两套压缩格式互不兼容**
- legacy（`main.py:_compact_session`）写 `{summary, message_ids, created_at, model_id}`
- harness（`context.compact`）读 `{schema_version, message_hashes, message_ids, …}`，`valid()` 要求 hash 全部匹配

互相看不见。库里那条 `mp-test-*` 记录（2 条 id、145 字摘要、无版本）就是 legacy 时代写的，现在两个引擎都不认。

**⑥ legacy 压缩不校验有效性**
`_compact_session` 用 `message_ids` 直接切片。用户删改历史后，摘要仍是旧内容的摘要，却继续前插——等于用一段"假的过去"喂模型。

**⑦ 摘要以 `user` 角色注入**
`'历史压缩摘要（历史材料，不是本轮指令…）'` 挂在 `role: user` 上，和本轮真实指令同一角色，模型很容易把摘要当要求处理。

**⑧ 前端档位是猜的**
`askContextStats()` 用 `chars * 0.7` 当 token 数；中文实际约 **1.6 token/字**，低估 2.3 倍，档位长期虚低。只有拿到 receipt `usage` 时才准。

**⑨ 工具轨迹不回流**
历史里只有 user/assistant 纯文本；`trajectory_events`（1087 条）只给 UI 看。跨轮"上一轮实际调了什么工具、参数、返回什么"模型完全看不见 → 重复劳动、重复生成。这也是上一轮"它不知道自己能不能写文件"的一部分原因。

**⑩ 存储放大**
`store.save()` 每次重写整段会话 JSON。最大单会话 933 KB（其中 execution 回执 JSON 481 KB），52 个会话 17 MB。前端每次加载也要解析这个包。

### 2.3 与完整版（deer-flow）对照

| 能力 | deer-flow | 本项目 |
| --- | --- | --- |
| 触发式摘要 | `SummarizationMiddleware`，`trigger` 支持 fraction/tokens/messages，`keep`、`trim_tokens_to_summarize` 全部可配（`config/summarization_config.py`） | 手动 `/compact`；自动压缩被 allowlist 关掉 |
| token 计数 | 真分词（`cl100k_base`，`agents/memory/prompt.py:148`） | UTF-8 字节 ÷ 2，且预算表写死 |
| 长期记忆 | `MemoryMiddleware` + `memory.json` + 30 s 去抖队列，只留 user + 最终 assistant | 无 |
| 计划抗压缩 | `TodoMiddleware` 专门处理"摘要后模型忘了 todo"（`todo_middleware.py` 注释写明） | plan 存在 receipt，下轮不带入 |
| 悬空工具调用 | `DanglingToolCallMiddleware` 在模型调用前补合成 `ToolMessage` | 无（harness 一旦启用，stop 过的轮次会带残缺消息进上下文） |
| 死循环 | `LoopDetectionMiddleware` | 只有"同工具同参数 3 次"（`budget.py:32`）+ `RECURSION_LIMIT=80` |
| 摘要注入方式 | middleware 在**模型调用前改消息序列** | 组装历史时插一条 `user` |
| 检查点 | LangGraph checkpointer（消息级状态） | `recovery.py` 只存 plan/artifacts，不存消息状态 |

### 2.4 建议（按性价比排序）

**P0 · 止血（半天，只改 `windows.py` + `harness/context.py` + `main.py`）**

1. **预算表按真实窗口重写**：未知模型给 **128k 保守值**（默认 500k 是定时炸弹）；`deepseek` 改 128k；`BYTES_PER_TOKEN` 取 3（中文保守）。
2. **裁剪必须留痕**：`trim()` 返回 `{history, dropped}`，`receipt['context_trimmed']={dropped, bytes}` 推给前端，并在历史首条插 `system`："更早的 N 条历史已裁剪"。
3. **单条消息上限**：assistant 回复 > 20,000 字符时，进历史前折叠成「前 2,000 字符 + （其余 N 字符已省略，原文见运行轨迹）」；GenUI 标签整块替换成 `[已输出组件 ×k]`。这一项能直接把 `38d8877f` 从 22.8 万 token 压到 3 万以内。
4. **取消/失败回复不进历史正文**：只留一行 `[本轮已取消]`，别整段回放。
5. **错误说人话**：`empty response` / 400 超窗统一翻成"本轮上下文超过模型窗口，请 `/compact` 或新建会话"，而不是 `模型请求失败：ValueError`。

**P1 · 把已有能力接上（1–2 天）**

6. **二选一**：①把 `HARNESS_PROJECT_ALLOWLIST` 改成真实项目 id（会带来 lease/并发上限/预算账本等新行为，需要回归）；②把 `compact()` 的 hash 校验 + schema 版本搬进 legacy，统一成一种压缩格式（推荐先做这个，风险小）。
7. **自动压缩**：`HARNESS_AUTO_COMPACT_ENABLED=1`，触发线 0.6、`keep` 最近 6 条改成可配（现在 `items[:-6]` 写死）。
8. **用量校准**：receipt 已经记 `usage.input_tokens`，用"上次 usage / 上次字符数"滑动平均写回 `data/model-capabilities.json`，替掉拍脑袋的 `BYTES_PER_TOKEN`。
9. **前端档位用真数**：优先用 receipt `usage`，没有就用 1.6 token/字；或直接读服务端 `context_manifest.estimated_input_units`。

**P2 · 对齐完整版（后续）**

10. **工具轨迹回流**：把上一轮 `tool_calls` + 结果前 300 字符作为结构化消息带进历史（langchain 支持 dict 形式的工具消息）。
11. **跨会话记忆**：一个 `memory.json` 存事实/偏好/常用路径，照搬 deer-flow 的 `_filter_messages_for_memory`（只留 user + 最终 assistant，剔除上传文件块）。
12. **plan 每轮注入 system**，不进历史，这样摘要后也不丢。
13. **悬空工具调用补丁 + 输出级 loop 检测**（同工具同参数 3 次已有，补"连续两次相同输出"）。

### 2.5 验收方式

- pytest：新增 `tests/test_context_budget.py`（预算表映射、折叠阈值、裁剪留痕、legacy 压缩格式兼容、旧格式摘要失效）
- 实机：拿 `38d8877f` 复现——折叠后 `context_manifest.estimated_input_units` 应从 741 KB 降到 < 200 KB，且第 25 轮不再报 `empty response`
- 回归：`agent_backend` 全量 pytest（当前 116 passed）+ 控制器 `npm test`（254）

---

## 附：一句话总结

- **不属于这个项目的东西**：一个 venv（ml-engineer）、一整套业务分析上下文（dataset/strategy/BUSINESS_API）、一个占位项目名（`wenyun-m-desktop`）、若干排查脚本与旧缓存。
- **上下文处理**：不是"简略"，是**只有截断**；而且负责截断的预算是照着 10 倍窗口写的，所以连截断都没触发。摘要、记忆、计划保持、悬空补丁这些完整版都有的东西，要么被 allowlist 关在门外，要么根本没搬。

---

## 修复记录（2026-10-30 落地）

### 上下文纪律

| 项 | 改动 | 位置 |
| --- | --- | --- |
| 预算表 | 按渠道口径校准：**deepseek / gemini 1024k（1M）、gpt-* 256k、未知模型 256k**，与 `data/config.json` 的 `contextWindow` 一致（`HARNESS_CONTEXT_INPUT_BUDGET` 可覆盖） | `harness/windows.py` |
| 长消息折叠 | 单条 >20000 字符折叠成 头 2000 + 尾 800 + 说明，GenUI 组件块只留计数（`WMD_HISTORY_FOLD_*` 可调） | `harness/context.py:fold_text` |
| 中断回复 | `cancelled/failed/interrupted/blocked/partial` 的回复只留前 500 字符 + 明确标记 | `harness/context.py:message_content` |
| 裁剪留痕 | `trim_to_budget()` 返回 `dropped`，并在历史首条插入「更早的 N 条已裁剪」；不再静默 `pop` | `harness/context.py` |
| 压缩格式统一 | legacy 与 harness 共用 `context-summary/1`（带 `message_hashes`）；历史被编辑后摘要自动失效 | `harness/context.py:summary_payload` |
| 错误可读 | `empty response` / 400 超窗翻成「上下文超过模型窗口，请 /compact 或新建会话」，并带预算数字 | `main.py` 异常分支 |
| 回执 | 每轮写 `receipt.context`（context_tokens / input_budget_bytes / estimated_input_units / dropped） | `main.py` |

### 工具守卫（替代搬 deer-flow 中间件）

`app/tool_guard.py`：同一工具同一参数最多 3 次（失败结果不缓存）、成功结果缓存复用、输出 >24000 字符裁剪、A→B→A→B 循环检测；legacy 路径默认挂载，回执写 `receipt.tool_guard`。
**没有引入 `SummarizationMiddleware`**：本项目没有 LangGraph checkpointer，历史每轮从库里重建，middleware 级摘要无法持久化，会退化成每轮重新压缩——真正的摘要由 `harness/context.py:compact` 承担。
**不需要 `DanglingToolCallMiddleware`**：历史是纯文本重建的，残缺 `tool_call` 不会跨轮进入上下文。

### 清理

- 删除 `app/project_context.py`（134 行业务分析上下文）、`tests/test_project_context.py`、`CONTEXT.md`，`main.py` 去掉 `resolve_context` 调用与 `read_dataset_schema`/`read_strategy_rules` 能力登记。
- `identity.py` 重写：去掉 `BUSINESS_API_URL`，`HARNESS_AUTH_MODE=controller` 时向控制器 `/api/projects` 复核项目。
- `HARNESS_PROJECT_ALLOWLIST` 默认改为空（harness 显式开关），不再借用别的产品项目名。
- 解释器：`launch.js` / `server.js` / `start-agent.cmd` / `start.sh` 改为「本目录 `.venv` → `WMD_PYTHON` → 历史共用环境」；不再硬绑 ml-engineer。
- 占位项目名 `wenyun-m-desktop` → `wmd-local`（`server.js` 兜底、launch 健康检查、`import_skills.js`）；`import_skills.js` 不再默认指向某人桌面目录。
- FastAPI 标题 `ML Engineer Agent` → `Creation-Studio Agent`；回执 `business_tool_count` → `workspace_tool_count`，`evidence_scope` 改成本产品口径。
- 删除 `data/_probe_files.py`、`data/_probe_projects.py`、`data/工作空间读取验收.txt`、`data/agent-run.err`、`__pycache__`（cpython-38/312 残留）、`.pytest_cache`；库里 1 条 `codex-chat-policy-check` 执行记录与 1 条旧格式压缩记录（备份在 `data/backups/`）。

### 实测

- 真实长会话 `38d8877f`（28 条 / 364,614 字符）：历史 741,782 字节 → **70,156 字节**（≈35k token，预算 27.4%），不需要裁剪。
- 造一份 12 条 / 264,480 字符的长历史（含一条 cancelled）：折叠后 **44,324 字节（-94.4%）**，第二轮正常完成并正确复述前 6 轮意图。
- 工具调用轮：`list_creation_models` 成功，`receipt.tool_guard = {repeat_blocks:0, cache_hits:0}`，`receipt.context.context_tokens = 128000`。
- 测试：智能体 **127 passed**（新增 `test_context_discipline.py` 12 项、`test_tool_guard.py` 5 项）；控制器 **254 passed**。

### 仍未做（按需再上）

1. 跨会话记忆（deer-flow `memory.json` 那套）；
2. plan 每轮注入 system（现在存在 receipt，摘要后可能丢）；
3. 工具轨迹回流（`trajectory_events` 目前只给 UI）；
4. 独立 venv（现在只是"优先使用"，实际仍跑在历史共用环境）；
5. 默认渠道 `gpt-6-astra-wm` 的网关不透传 `tools`（nexora 侧问题，需换渠道或改网关）。
