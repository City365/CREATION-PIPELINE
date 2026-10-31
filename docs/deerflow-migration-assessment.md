# 用 deer-flow 替换智能体后端 · 可行性评估

评估对象：`D:\notebook\AIGC\deer-flow-v0\deer-flow\backend`（harness 18,876 行 / gateway 4,613 行）
被替换对象：`Creation-Studio/agent_backend`（app 4,513 行，跑在 :17820）
前端约束：`Creation-Studio/web`（13,391 行 JS）通过 `/api/agent/*` 消费 30 个端点 + 11 种 SSE 事件

---

## 0. 结论

**"整包替换后端"不可行**——不是工作量问题，是**契约不同**：deer-flow 是「LangGraph 线程 + SDK 流」，我们是「项目会话 + 自定义 SSE + GenUI 渲染」，中间差着一整层翻译。

**"内核替换 + 契约保留"可行**（推荐）：把 `create_agent(...)` 那一层换成 deer-flow 的 agent 工厂（middleware / tools / prompt / checkpointer），`/agent/*` 契约、前端、执行回执、媒体链路全部不动。工作量 **≈5 人日**（含意外 6–8）。

**但更划算的是第三条路**：deer-flow 的价值 80% 集中在**中间件**，而我们已经是 `langchain.agents.create_agent` + `AgentMiddleware` 那一套 API——`SummarizationMiddleware`（langchain 自带）、`LoopDetectionMiddleware`、`DanglingToolCallMiddleware` 可以**直接挂到现有后端**，0.5–1 人日拿到上下文/循环/悬空修复，零架构风险。

> 顺带纠正一个前提：原项目本身**不完整**。RAG 指向别人内网（`172.20.11.192:6333`、`192.168.33.100:8106`、`localhost:9000`），工具依赖 Tavily/Jina/InfoQuest 三把外部 key，`data-inspector-agent` 是业务分析遗留（EDA），没有项目隔离、没有 GenUI、没有执行回执。**替换 ≠ 完善**，它是"另一套更厚的内核"，要选择性取用。

---

## 1. 同层对照

| 层 | 我们（4,513 行） | deer-flow（18,876 + 4,613 行） |
| --- | --- | --- |
| 运行形态 | 单进程 FastAPI :17820 | Gateway :8001 + LangGraph Server :2024（或嵌入式 `DeerFlowClient`） |
| Python | 3.11（借 ml-engineer venv） | **≥3.12**（`.python-version` 3.13，`langgraph.json` 3.12） |
| 对话协议 | `POST /agent/chat` → SSE `{type: delta/replace/start/done/process/artifact/media/error}` | LangGraph SDK `runs/stream` → `values / messages-tuple / end` |
| 会话 | `conversations` 表（project + session 双键） | LangGraph thread + checkpointer（`.deer-flow/threads/{id}`） |
| 上下文 | UTF-8 字节预算 + 静默截断（见上一份评审） | `SummarizationMiddleware`（trigger tokens=15564）+ memory + todo |
| 工具 | 手写 14 个（计划/工作区/创作）+ 昨日新增 9 个文件/命令 | 配置驱动：`ls/read_file/write_file/str_replace/bash` + `web_search/web_fetch/image_search` + `present_file/ask_clarification/delegate/retrieve` + 子代理 `task` + MCP + `tool_search` |
| 提示词 | 中文 + **GenUI 标签协议**（`<box>`、`DIL.useState`、`GenUI.issueNewTurn`） | 英文 491 行模板，**GenUI 零命中**（实测 grep） |
| 技能 | plugins 表 + `read_analysis_guidance` 注入 + 前端选择器 | 文件系统 `SKILL.md` + sandbox 挂载 `/mnt/skills` |
| 记忆 | 无 | `memory.json` + 30 s 去抖 + 事实注入（上限 100 条 / 2000 token） |
| 沙箱 | 无（直接跑本机） | LocalSandboxProvider（默认）或 Docker AIO |
| 多项目 | `X-Project-Id` 贯穿，目录 `…\<项目>-<id>\{assets,media,uploads,exports}` | **完全没有**，只有 thread 维度 |
| 鉴权 | 控制器会话 + 内部 token | 无（nginx/网关层自理） |
| 前端 | 原生 JS 13,391 行，自渲染 GenUI/回执/轨迹 | Next.js + `@langchain/langgraph-sdk` `useStream` |

---

## 2. 硬阻断项（不先解决，装完就是残的）

| # | 阻断项 | 现象 | 解决 | 工作量 |
| --- | --- | --- | --- | --- |
| 1 | **GenUI 协议不在 deer-flow 提示词里** | 回复不再有 `<box>/<row>/<button>`，前端组件渲染、`DIL.useState`、按钮交互、`issueNewTurn` 全部失效，创作台 UX 退回纯文本 | 保留我们的提示词段，拼在 deer-flow 模板后面（`apply_prompt_template()` 返回字符串，直接 `+ our_prompt`） | 0.5 h |
| 2 | **项目隔离缺失** | 会话不再按 `proj-…` 分，媒体/素材/导出目录对不上，52 个历史会话"看不见" | thread → project 映射；`thread_data.workspace_path` 指向项目目录（`Path\…\<项目>-<id>`） | 4–6 h |
| 3 | **媒体 URL 契约不同** | 生成的图/视频不再出现在对话里 | 保留我们自己的 creation 工具（它们发 `/api/file?path=`），不要换 deer-flow 的 artifacts 通道 | 2 h |
| 4 | **执行回执 / 轨迹 / 任务报告三个 tab** | 前端三个 tab 空白（`execution.steps/plan/tools/budget/usage`） | 回执是 `main.py` 里拼的，**与内核无关**，整段保留；只需把 deer-flow 的 tool_calls/tool 消息喂进同一个 receipt | 3–4 h |
| 5 | **断线续传 / 幂等 / 并发** | 刷新后"接着看生成"失效；重复提交可能跑两次 | `run_store`（lease + `client_request_id` 幂等 + `RUN_EVENTS` 序列）整段保留 | 0（保留即得） |
| 6 | **权限三档刚做** | 只读/工作区/完全失效或变成无差别 bash | `configurable.permission` → 工具组映射（readonly 不给 `file:write`/`bash`）+ bash 路径校验（deer-flow 已有 `validate_local_bash_command_paths`） | 4 h |
| 7 | **RAG 指向别人内网** | 启动/调用 `retrieve` 工具时超时或报错；装依赖要拉 llama-index + qdrant + milvus | `rag.enabled: false`，从 `BUILTIN_TOOLS` 摘掉 `retrieve_tool`，依赖可选装 | 1 h（+ 依赖瘦身） |
| 8 | **三把外部 key** | `web_search`/`web_fetch`/`image_search` 一调就 401 | 配 key，或从 `config.yaml tools` 删掉这三组 | 0.5 h |
| 9 | **模型体系不同** | 前端模型选择器（channel id）对不上 `config.yaml models`；工具能力探测丢了 | 适配层把 channel → deer-flow model 名映射；保留我们 `model-capabilities.json` 的探测 | 3 h |
| 10 | **技能语义不同** | 前端技能选择器（5 内置 + 自定义）失效，变成"全量 SKILL.md 挂载" | 保留 `read_analysis_guidance` 那套（我们自己的工具），deer-flow skills 仅作可选补充 | 2 h |
| 11 | **`/compact` 按钮** | 点了没反应 | 适配层返回"已启用自动摘要"，或接入 LangGraph state 更新 | 1 h |
| 12 | **Python 3.12+ 与打包** | 现有 3.11 venv 全废；`uv`/`langgraph` 得装 | 建 `agent_backend/.venv`（uv），5 处硬编码 PYTHON 一起改 | 2 h |
| 13 | **`data-inspector-agent` 遗留** | 多一个 EDA 专家代理 + `delegate_to_data_inspector` 工具，与创作无关 | 从 config 删掉，或留作日后数据代理 | 0.5 h |
| 14 | **中文表述** | deer-flow 全英文提示词/工具描述，产出风格漂 | 保留我们的中文身份段与创作规范段 | 含在 #1 |

---

## 3. 三条路线

| 路线 | 做法 | 工作量 | 拿到什么 | 丢掉什么 |
| --- | --- | --- | --- | --- |
| **A 整包替换** | 起 Gateway+LangGraph，前端改 `useStream` 语义 | **8–15 人日** + 高返工 | 全部 | 现有 30 个端点、GenUI、回执、轨迹、权限、项目隔离（都要重做） |
| **B 内核替换（推荐）** | 保留 `/agent/*` 与前端；把 agent 工厂/middleware/tools/prompt 换成 deer-flow | **≈5 人日**（6–8 含意外） | 摘要、记忆、todo、悬空修复、loop 检测、sandbox、artifacts、子代理、tool_search | 我们自己的 9 个文件工具（换 bash，权限粒度变粗，建议保留自有工具并存） |
| **C 只搬中间件** | 现有后端挂 3 个 `AgentMiddleware` | **0.5–1 人日** | 上下文摘要、loop 检测、悬空工具调用修复（=上一份评审 P1 的全部内容） | sandbox、artifacts、子代理、记忆、RAG |

**建议顺序：先 C（今天就做，把上下文评审的 P0/P1 一次解决），再决定要不要 B。**
C 之所以便宜：我们已经是 `langchain.agents.create_agent` + `AgentMiddleware`；deer-flow 的 `LoopDetectionMiddleware` / `DanglingToolCallMiddleware` 就是同 API 的子类，`SummarizationMiddleware` 是 langchain 自带。挂上去只需要在 `main.py:create_agent(...)` 的 `middleware=[...]` 里加三项。

---

## 4. 若走 B：改造清单（按文件）

| 模块 | 现状 | 改造 | 估计 |
| --- | --- | --- | --- |
| `app/main.py`（583 行） | `create_agent(model, tools, middleware=[ModelGateway,ToolGateway], system_prompt)` + 自研流翻译 | agent 构造换成 deer-flow 工厂（或 `DeerFlowClient` 内部 agent）；**流翻译、receipt、SSE、断线续传全部保留** | 改动 ~120 行 |
| `app/chat_policy.py` | 44 行中文提示词 + GenUI | 变成 `deerflow_prompt + 我们的 GenUI/创作段` 拼接 | +30 行 |
| `app/harness/*` | 自研 harness（context/budget/tool_gateway/recovery/run_store） | `context.py`/`budget.py` 可退役（由 SummarizationMiddleware + 租约保留）；`run_store`/`recovery` 留 | -300 / +50 行 |
| `app/create_tools.py` | 8 个创作工具（调控制器 17821） | **原样保留**，作为额外工具注入 deer-flow agent | 0 |
| `app/fs_tools.py` + `permissions.py` | 9 个文件/命令工具 + 三档 | 与 deer-flow 的 `ls/read_file/write_file/bash` 二选一或并存；推荐**保留我们的**（有 mv/cp/mkdir/delete + 三档） | +40 行注册 |
| `app/project_context.py` | 业务分析死代码 | **删**（上一份评审已列） | -134 |
| 新建 `app/deerflow_bridge.py` | — | thread↔session/project 映射、checkpointer(sqlite)、tool_groups 按 permission 选择、模型名映射 | +250 行 |
| `requirements.txt` | 11 项 | + langgraph、langchain-mcp-adapters(可选)；**不装** llama-index/qdrant/milvus/slack/telegram/lark | +3 |
| `scripts/launch.js`、`server.js`、`start-agent.cmd`、`start.sh` | 指向 ml-engineer venv | 指向 `agent_backend/.venv` | 5 行 |
| `config.yaml` / `extensions_config.json` | — | 新建精简版：只留 `ls/read_file/write_file/str_replace/bash` + 我们的工具；`rag.enabled=false`；删 data-inspector | 新文件 |

> 关键判断：**deer-flow 的 `DeerFlowClient.stream()` 用的是 `stream_mode="values"`，一次吐整条消息**，不是 token 流。要用它的内核还想保留打字机效果，就必须自己用 `astream(stream_mode=["messages","updates"])` 起 run，不能直接用 `client.stream()`。这一条是"看起来能用、接上去才发现"的典型坑。

---

## 5. "结束后部分功能不可用"验收清单

上线前逐条打勾（每条给判定方法）：

- [ ] 输入框发一句话，回复**逐字**出现（不是整段蹦出）→ 观察首字延迟 < 3 s
- [ ] GenUI 组件渲染：回复里出现 `<box>/<row>` 结构卡片，按钮可点
- [ ] 生成的图片/视频出现在对话里，点开能预览（`/api/file?path=`）
- [ ] 三个 tab 有数据：执行记录（工具调用列表）、任务报告（plan + 产物）、轨迹（分页）
- [ ] 刷新页面后"生成中"状态能接着看（`/runs/active` + `events?after=`）
- [ ] 中止生成（■ 停止）后回执状态 = cancelled，且下一轮上下文正常
- [ ] 权限三档：仅查看移动文件被拒 / 工作区项目内成功 / 完全权限项目外成功 / `shutdown` 全档阻断
- [ ] 模型切换生效（channel → deer-flow model 映射），工具能力探测仍准
- [ ] 技能选择器：选「剧本转分镜」后能读到对应指导
- [ ] 附件上传 + 预览（xlsx / md / 图片）
- [ ] `/compact` 不再报错（自动摘要或手动触发有响应）
- [ ] 会话列表按项目隔离，切项目看不到别项目会话
- [ ] 长会话（>20 万字符）不再 `ValueError`，摘要生效（拿会话 `38d8877f` 复现）
- [ ] 记忆：第二个会话能引用第一个会话里说过的事实（若启用）
- [ ] 并发：同会话重复提交被拒（409），跨项目并发不互相排队
- [ ] 启动：`stop-services → 起 launcher` 三条服务全绿，智能体不再依赖 ml-engineer venv
- [ ] 日志：新增 `data/deerflow-adapter.log`，工具调用/压缩/记忆事件可追

---

## 6. 分期计划

| 期 | 内容 | 工期 | 验收 |
| --- | --- | --- | --- |
| **P0** | 建独立 venv（uv, 3.12）+ 装 harness（不含 RAG 重依赖）+ 嵌入式 `DeerFlowClient` 跑通一句话 + 挂上我们的 creation 工具 | 0.5 d | `python -c` 里流式输出中文 + 调通 `list_creation_models` |
| **P1** | `deerflow_bridge.py`（thread/项目/checkpointer/模型映射）+ 替换 agent 工厂，保留 SSE 与 receipt | 1.5 d | 清单前 4 条通过 |
| **P2** | 契约对齐：models/health/skills/uploads/compact/runs 语义 | 1.5 d | 清单 5–12 条 |
| **P3** | 权限三档 + 工具取舍（bash 护栏 / 自有 fs 工具并存） | 1 d | 清单权限三条 |
| **P4** | 删 `project_context`、切 venv、清残留、回归（现 116 项 pytest + 控制器 254 项） | 0.5 d | 全绿 |

**回滚设计**：`WMD_AGENT_ENGINE=legacy|deerflow` 环境开关；两套引擎共用 `/agent/*` 契约与同一个前端，切开关即回退。**不迁移**现有 52 个会话与 1,087 条轨迹（旧库保留只读），新引擎从空库开始——这是刻意的，避免"迁移一半发现语义对不上"。

---

## 7. 需要你拍板的五件事

1. **要不要 sandbox**：`LocalSandboxProvider`（直接跑本机，改动小）还是 Docker AIO（隔离好，Windows 要多装 Docker + 每个会话一个容器）。
2. **文件工具取舍**：保留我们的 9 个（有 mv/cp/mkdir/delete + 三档权限）还是全面改用 `bash`（能力等价但权限粒度粗、护栏只能靠命令解析）。
3. **要不要 RAG / web 检索**：要就得配 Tavily/Jina key 和向量库；不要就从 config 摘掉，省掉一坨重依赖。
4. **要不要跨会话记忆**：deer-flow 的 `memory.json` 会记用户偏好/事实——对创作是加分（记住风格、常用目录），但也会把敏感信息留在本地文件里。
5. **项目隔离方式**：`thread.metadata.project_id` 映射（轻，推荐）还是每项目独立 workspace_path + 独立 checkpointer（重，隔离强）。

---

## 8. 一句话总结

- **能换，但不该"整包换"**：差的是契约不是代码；整包换等于把 30 个端点、GenUI、回执、权限、项目隔离全部重做（8–15 人日）。
- **性价比最高的是先搬中间件**（0.5–1 人日）：上下文摘要、循环检测、悬空工具调用修复——正是上一份评审里最痛的三件事，且我们现有架构原生兼容。
- **想要 sandbox/artifacts/子代理/记忆再上 B 路线**（≈5 人日），前提是先解决第 2 节的 14 个阻断项，否则就是"装完更完整，但用户能用的功能反而少了"。
