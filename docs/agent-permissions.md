# 智能体本地权限（三档）

输入框左侧的盾牌按钮切换三档权限，每轮随请求（`ChatRequest.permission`）发给智能体后端；服务端只信这个值，前端改文案不构成授权。

| 档位 | id | 写文件 / 移动 | 执行命令 | 生成图片 / 视频 | 可写范围 |
| --- | --- | --- | --- | --- | --- |
| 仅查看 | `readonly` | 否 | 否 | 否（工具不挂载） | — |
| 工作区权限 | `workspace` | 是 | 是 | 是 | 当前项目目录、智能体工作空间、白名单根 |
| 完全权限 | `full` | 是 | 是 | 是 | 本机任意路径（系统目录除外） |

## 落点

- 裁决内核：`agent_backend/app/permissions.py`
  - `MODES`：三档的写/命令/范围与提示文案
  - `allowed_roots()`：环境变量 `WMD_AGENT_WORKSPACE_ROOTS` > 当前项目目录（向控制器 `/api/projects` 取）> `data/workspace` > `agent_settings.json` 的 `workspace.roots`
  - `guard()` / `resolve_path()`：越界即拒；`full` 只放行全盘，Windows / Program Files / ProgramData\Microsoft 等系统目录始终受保护
  - `check_command()`：高危规则表 `DANGEROUS`，任何档位命中即阻断；工作区档还会校验命令里出现的绝对路径
  - `audit()`：每条命令写 `data/agent-commands.log`（含被阻断的）
- 工具：`agent_backend/app/fs_tools.py`
  - `read_permission` / `list_dir` / `read_file` / `write_file` / `make_dir` / `move_file` / `copy_file` / `delete_file` / `run_command`
  - 覆盖写和删除都会先 `park()` 一份到 `data/workspace/_trash/<日期>/`，可人工恢复
- 能力登记：`app/harness/registry.py`（`fs_write` / `shell` 两档 risk，超时按工具给）
- 提示词：`app/chat_policy.system_prompt(..., permission=...)`，明确"不要把活推回给用户去命令行做"
- 接口：`GET /agent/permissions`（档位说明 + 根目录 + 规则表）、`PUT /agent/permissions {roots}`（维护白名单）

## 硬阻断规则（任何档位）

`disk-format` / `disk-partition` / `boot-config` / `shadow-copy` / `power-off` / `registry-wipe` /
`wipe-root` / `drive-wipe` / `account-backdoor` / `encoded-payload` / `defender-off` / `acl-takeover`。

## 已知限制

- 默认渠道 `gpt-6-astra-wm`（本地 7012 网关，`openai-responses`）不透传 `tools`：探测结果为"不支持工具调用"，
  此时三档权限都不会真正触发文件操作，前端输入框会显示红色提示，改用 `deepseek-flash` 或 `gemini-3.8-flash`。
- 「完全权限」只挡系统目录；用户自选的工作目录（如 `D:\notebook\...`）按"完全权限"语义放行。
- 工作区档的命令只校验命令行里的绝对路径，`cd` 后相对路径仍以 `cwd` 为准（`cwd` 也被校验）。

## 验收

- `agent_backend/tests/test_permissions.py`：18 项（档位默认值、越界拒绝、系统目录保护、只读拒绝、移动/复制/建目录/读取、覆盖备份、删除入回收站、9 条高危命令 × 3 档、命令越界、命令执行与审计日志、权限自述）
- 实机（deepseek-flash）：仅查看移动→被拒；工作区项目内移动→成功；工作区项目外复制→被拦并提示切档；完全权限项目外复制→成功；完全权限 `shutdown` → 阻断；完全权限普通命令→退出码 0 并留审计日志
