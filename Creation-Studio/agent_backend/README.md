# 智能体后端（Creation-Studio Agent）

FastAPI + LangChain `create_agent` 的智能体服务，端口 **17820**，供创作台 `/api/agent/*` 代理访问。
从业务分析项目迁入时做过一次精简：数据集/策略包、业务鉴权等外部依赖已全部移除（见 `docs/agent-backend-review.md`）。

## 运行

```bash
# 推荐：给本服务建独立环境（不再共用别的项目的 venv）
cd agent_backend && uv venv .venv && uv pip install --python .venv/Scripts/python.exe -r requirements.txt
bash start.sh            # 或 Windows 上 Creation-Studio\start-agent.cmd
```

启动脚本与 `scripts/launch.js`、`src/server.js` 都按「本目录 `.venv` → `WMD_PYTHON` → 历史共用环境」的顺序找解释器，
所以没有独立 venv 时仍能跑，但更推荐补上。本地模型配置在 `data/agent_settings.json`（不入 Git），密钥也可用环境变量传入。

## 接口

`GET /agent/health`、`GET /agent/models`、`GET/PUT/DELETE /agent/sessions[/{id}]`、`POST /agent/chat`（SSE）、
`GET /agent/executions/{run_id}`、`GET /agent/sessions/{id}/trajectory`、`POST /agent/sessions/{id}/compact`、
`GET /agent/runs/active`、`GET /agent/runs/{id}`、`GET /agent/runs/{id}/events`、`POST /agent/runs/{id}/cancel|resume`、
`GET /agent/permissions`、`PUT /agent/permissions`、`/agent/workspace/*`、`/agent/knowledge`、`/agent/plugins`、`/agent/skills`。

会话按 `X-Project-Id` 隔离；本机开发服务，不对外暴露。SSE 事件：`start / summary / delta / replace / process / media / artifact / error / done`。
执行回执单独写 `conversations.db` 的 `executions` 表（运行编号、模型、耗时、用量、计划、工具调用、上下文预算）。

## 能力

| 类别 | 工具 |
| --- | --- |
| 计划 | `create_task_plan` / `read_analysis_guidance` / `record_step_result`（仅选中技能时挂载） |
| 工作空间 | `search_workspace_documents` / `read_workspace_document` / `create_workspace_artifact` |
| 创作 | `list_creation_models` / `generate_image` / `submit_video_job` / `check_video_job` / `wait_video_job` / `probe_video` / `extract_frames` / `describe_image` |
| 本地文件与命令 | `read_permission` / `list_dir` / `read_file` / `write_file` / `make_dir` / `move_file` / `copy_file` / `delete_file` / `run_command` |

本地文件与命令受输入框的三档权限（仅查看 / 工作区权限 / 完全权限）约束，高危命令在任何档位都被强制阻断，详见 `docs/agent-permissions.md`。

## 上下文纪律

- 预算表按渠道真实窗口：**deepseek / gemini 1024k（1M）、gpt-* 256k、其它未知模型 256k**，与 `data/config.json` 的 `contextWindow` 保持一致；`HARNESS_CONTEXT_INPUT_BUDGET` 可覆盖（字节）。
- 单条过长的历史正文进上下文前折叠（默认 20000 字符），GenUI 组件块只留计数；中断/失败的回复只留摘要行。
- 非 harness 路径（产品默认）超预算时「折叠 → 从最旧裁剪 → 插入裁剪提示」，不再静默 `pop`。
- 压缩摘要只有一种 schema（`context-summary/1`，带 `message_hashes`），harness 与 legacy 互相认；历史被编辑后摘要自动失效。
- `ToolGuard` 中间件：同一工具同一参数最多 3 次、成功结果缓存复用、输出超 24000 字符裁剪、A→B→A→B 循环检测。

## 工作空间与技能

原件保存在 `data/workspace/{file_id}/`，元数据、分块与全文索引写 `conversations.db`。
TXT/MD/CSV/JSON/XLSX/DOCX/PDF 支持文本解析；图片与扫描 PDF 标为待识别，不推测内容。
单文件 10MB、文本上限 200 万字符、工作簿单表 2 万行、PDF 200 页；超限原件仍保存并提示拆分。
技能来源是内置 5 个 + 自定义（`plugin:…`）；自定义 Tool / MCP 目前只保存配置，不执行任意代码或远程连接。

## 鉴权

`HARNESS_AUTH_MODE`：`controller`（默认，向控制器 `/api/internal/projects/{id}` 复核项目归属，内部 token 走 `data/internal-token.json`）或 `development`（直接放行，仅本机开发/测试）。
