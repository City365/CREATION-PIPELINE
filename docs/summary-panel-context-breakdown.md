# 摘要面板（Summary）：上下文分项 + Changes 框位

> 面板原来只有「2% 参考占用 23k/1m」「消息 22 条」「工具/技能/系统提示词：暂无分项计量」，
> 看不出上下文被谁吃掉；标题还是中文。现在按 Codex 的信息密度重做：固定环节逐项统计、
> 彩色堆叠条、英文标题、工具清单可展开，并补一个 Changes 框（GitHub 改动统计待接入，框位先留着）。

## 面板结构

| 区块 | 内容 |
| --- | --- |
| `Environment` | Workspace（此计算机）/ Project / Path（项目目录，只显示尾两段）/ Model / Permission |
| `Context` | `N% used` + `已用 / 窗口`；彩色堆叠条；六个固定环节逐行 `tokens + %`；`› Tools · 26` 可展开看工具名（面板上不解释 token 怎么算的） |
| `Connectors` | 本地工具是否可用、当前技能 |
| `Outputs` | 最近 10 份交付文件 |
| `Changes` | `+0 −0` + 灰掉的 `Create PR`，下方一行说明「GitHub 改动统计待接入，框位保留」 |

分项固定为：`Messages` / `System tools` / `Skills` / `System prompt` / `Autocompact buffer` / `Free space`。

## 分项统计怎么来的

前端算不出工具 schema、系统提示词、技能包的大小，所以在后端一次算好写进运行回执：

`agent_backend/app/context_report.py`

```json
{
  "schema_version": "context-report/1",
  "estimator": "chars ascii/4 + cjk/1.5",
  "window": 1024000, "used": 6370, "used_percent": 0.62,
  "reserved": 153600, "free": 864030,
  "messages": 1, "tool_count": 20, "skill_count": 1,
  "tool_names": ["create_task_plan", "read_analysis_guidance", "..."],
  "items": [
    {"key": "messages", "label": "Messages",           "tokens": 25,     "percent": 0.0},
    {"key": "tools",    "label": "System tools",       "tokens": 4270,   "percent": 0.42},
    {"key": "skills",   "label": "Skills",             "tokens": 144,    "percent": 0.01},
    {"key": "system",   "label": "System prompt",      "tokens": 1931,   "percent": 0.19},
    {"key": "buffer",   "label": "Autocompact buffer", "tokens": 153600, "percent": 15},
    {"key": "free",     "label": "Free space",         "tokens": 864030, "percent": 84.38}
  ]
}
```

- 口径：ASCII 4 字符 ≈ 1 token，中文/全角 1.5 字符 ≈ 1 token（`chars ascii/4 + cjk/1.5`），
  与代码里其他地方一致的保守估算，不冒充厂商 tokenizer。
- `window` 取该模型的实际窗口（`harness.windows.context_tokens`）。
- `Autocompact buffer` 固定 15%（给输出和自动压缩预留，与 Codex 的同位）。
- `Free space = window − 已用 − 预留`，永不小于 0；分项合计恒等于 `window`（有单测）。
- `Messages` 用实际进上下文的 history（已折叠/裁剪后的版本）算，不是原始消息数。
- `tool_names` 给面板的 `› Tools · N` 展开用。

写入位置：`_chat` 在拼完 system prompt 后计算，存进 `receipt['context']['report']`，
因此 **`start` 事件里就有**——面板不用等这一轮跑完才显示，跑完后再按最终回执刷新。

## Skills 之前为什么是 0

旧实现只统计 `skill_snapshot`（harness 引擎下由 `registry.freeze(ctx)` 冻结的技能列表），
而产品实际跑的 legacy 引擎里 `ctx` 是 None → `skill_snapshot=None` → Skills 恒为 0，
哪怕这轮就是「@小说创作」跑的。

现在 `main.skill_material(project, topic, skill_name, snapshot)` 按真正进上下文的那份材料算：

1. `topic = skill:<id>`：取插件技能记录（`name / description / content / prompt / files`）；
2. 内置主题（`novel / script / storyboard / prompt / review`）：取 `creation_guidance.GUIDANCE[topic]`；
3. 没选技能 → 0，不硬凑。

单测覆盖：插件技能、内置指导、无技能三种情况，以及一次真实「@小说创作」运行里
`start` 事件中就带着 `Skills > 0`。

前端 `web/app.js`：

- `askContextReport(chat)`：从最后一条带 `execution.context.report` 的消息取报告（旧会话没有就退回原来的估算条）。
- `askContextBlockHtml(chat, stats)`：堆叠条 + 分项行 + meta + `› Tools · N` 展开；没有报告时明确写
  「这个会话还没跑过」，不拿 0 假装是统计值。
- `askShortPath(dir)`：Environment 里的路径只显示尾两段，完整路径放 `title`。
- `askSummaryHtml(chat)`：英文标题、Workspace/Path 行、Changes 框位。

样式在 `web/agent-workspace.css`（`.ask-ctx-*` / `.ask-changes*`），颜色对齐 Codex：
Messages 蓝、System tools 橙、Skills 绿、System prompt 黄、Autocompact buffer 灰、Free space 淡灰。

## 验证

- `agent_backend/tests/test_context_report.py` 6 条：口径换算、六项顺序与英文标签、
  合计守恒、超长历史不出现负数、回执与 `start` 事件都带报告、技能材料三条路径。
- `tests/chat-summary.test.js` 6 条：取最近一次报告、空状态文案、六行渲染与百分比宽度、
  中文标题不再出现、工具清单展开、路径截断。
- 全量：agent 后端 **203 passed**，控制器 **339 passed**。
- 真实运行（`proj-b1a9643a02`，`@小说创作`，只读）：

```
window= 1024000  used= 6370 (0.62%)  reserved= 153600  free= 864030
Messages 25 · System tools 4270 · Skills 144 · System prompt 1931
Autocompact buffer 153600 · Free space 864030
skill_count= 1   tool_count= 20
```

预览图（本地，`Creation-Studio/output/` 已被 git 忽略）：`output/context-summary-panel/preview.png`。

## 未做

- `Changes` 只留框：要接 GitHub（`gh` CLI 或 API token）才能给出真实 `+N −M`、分支和 PR 入口；
  现在按钮是禁用的，不会假装有数据。
- 没有 MCP：面板里的工具分项就叫 `System tools`（内置工具），不虚构 `MCP tools` 行；
  将来真接 MCP 时按组拆行即可。
- `Connectors` 只有本地能力说明。
