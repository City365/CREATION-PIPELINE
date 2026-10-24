# 智能体后端

从 smart_analysis 迁入模型工厂配置方式、DeepSeek/MiniMax 模型适配；沿用 LangChain create_agent 执行。首期只启用基础流式对话，业务工具、沙箱、自动操作尚未开放。

使用 Git Bash 执行 bash agent_backend/start.sh，共用 backend/.venv，端口 3017。依赖：uv pip install --python backend/.venv/Scripts/python.exe -r agent_backend/requirements.txt。

本地模型设置在 data/agent_settings.json（不入 Git），密钥也可通过 DEEPSEEK_API_KEY 等环境变量传入。原会话数据库、工作文件不迁入。

API 使用 X-Project-Id 隔离会话；当前为本机开发服务，不应直接暴露公网。正式多用户部署需接业务用户鉴权。

GET /agent/health；GET /agent/sessions；PUT/DELETE /agent/sessions/{id}；POST /agent/chat（SSE）。前端通过 /agent-api 代理。

共用环境也可在 backend 目录使用 uv sync --group agent 安装；后续同步环境需带 --group agent，避免移除智能体依赖。

模型配置支持 protocol: "anthropic"，例如 DeepSeek 的 https://api.deepseek.com/anthropic，使用 ChatAnthropic 适配；OpenAI 兼容地址继续使用原适配器。修改本地配置后下一次请求即可生效。

每次对话返回 start/trace/summary/delta/done（失败时 error）SSE 事件；分析说明是面向用户的方法概述，不读取或展示模型内部 thinking。执行回执单独写入 conversations.db 的 executions 表，可通过 GET /agent/executions/{run_id} 按项目读取；包括运行编号、输入指纹、模型、事件时间、耗时及用量。当前业务工具调用数固定为 0，与业务分析证据分开。

## 任务过程与运行轨迹
对话内 plan 包含任务目标、步骤、步骤产出与真实引用材料。create_task_plan / read_analysis_guidance / record_step_result 是可运行的内置工具；search_workspace_documents / read_workspace_document 可读取当前对话附件及项目知识库。模型分析产出不等于业务指标计算。每次实际用户、助手、工具消息独立写 trajectory_events，GET /agent/sessions/{id}/trajectory 按项目分页读取；前端仅打开运行轨迹标签才请求。

## 工作空间与管理
原件保存在 data/workspace/{file_id}/，元数据、文本分块和全文索引写 conversations.db。TXT/MD/CSV/JSON/XLSX/DOCX/PDF 支持文本解析；图片与扫描 PDF 标为待识别，不推测内容。单文件 10MB、最多 200 万文本字符，工作簿单工作表 2 万行，PDF 200 页；超限原件仍保存并明确提示拆分，不静默截断。
知识库、插件管理提供项目隔离的 CRUD。启用的 Skill instructions 可由指导读取工具读取；自定义 Tool 和 MCP 当前只保存配置，未接入任意代码或远程连接。内置系统工具由代码管理。
