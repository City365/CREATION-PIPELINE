# 12 测试计划

- 文档状态：已定义，待执行
- 版本：v1.0
- 更新时间：2026-11-05 01:16（UTC-06:00）

## 1. 范围与环境

- 环境：Windows 11、Node 25.9.0、独立 `WMD_DATA_DIR` 临时目录（每个测试用例独立，互不污染）。
- 分层：业务/模块 → API 集成 → 页面真实操作 → 端到端 → 工程回归。
- 数据：测试创建的用户名前缀 `qa-`、项目名 `qa-*`；结束后删除本批次数据。
- 不触碰：真实视频生成额度、`用户490936`、生产媒体目录。

## 2. 用例

| TC | REQ | 层次 | Must | 场景 | 断言 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | REQ-001 | 模块 | 是 | 未处理 Promise 拒绝 | 进程存活；`process.log` 有记录；`/api/health` 200 |
| TC-002 | REQ-001 | 模块 | 是 | 未捕获异常 | 退出码 1；日志含堆栈 |
| TC-003 | REQ-001 | 模块 | 是 | 正常退出 | `process.log` 记录 pid/退出码/信号 |
| TC-004 | REQ-002 | 集成 | 是 | 旧 `jobs.json` 导入 | 表行数=文件条数；文件改名；列表一致 |
| TC-005 | REQ-002 | 集成 | 是 | 运行中多次 touch | 只更新该行；无全量 JSON 写 |
| TC-006 | REQ-002 | 集成 | 是 | 重启恢复 | 运行中任务变 `interrupted` |
| TC-007 | REQ-002 | 集成 | 是 | 删除任务 | 表行删除；列表消失 |
| TC-008 | REQ-003 | API | 是 | 状态/配置/渠道响应 | 不含完整 Key |
| TC-009 | REQ-003 | API | 是 | 空 Key 保存 | 原 Key 保持不变 |
| TC-010 | REQ-003 | API | 是 | `clearKey` | Key 清空 |
| TC-011 | REQ-004 | 模块 | 是 | 命令超时 | 后续 poll 不再返回该命令 |
| TC-012 | REQ-004 | 模块 | 是 | 管理器收到过期命令 | 不调用本地接口 |
| TC-013 | REQ-005 | API | 是 | 删除有项目的租户 | 400；数据不变 |
| TC-014 | REQ-005 | API | 是 | 删除有/无项目的用户 | 有项目 400；无项目成功且会话清除 |
| TC-021 | REQ-010 | 模块 | 是 | 两个租户分别建渠道/Key/提示词 | 各自只看到自己的；跨租户按 id 取不到 |
| TC-022 | REQ-010 | 模块 | 是 | 检查 `config.json` 与 `secrets` | 配置文件无租户字段；密钥按租户加密 |
| TC-023 | REQ-010 | 模块 | 是 | 租户 A 改并发 | 平台共享生效；B 的渠道不受影响 |
| TC-024 | REQ-010 | 模块 | 是 | 异步回调/定时器读取配置 | 继承创建时的租户 |
| TC-025 | REQ-010 | API | 是 | 双租户通过 HTTP 互相访问渠道 | 列表为空、按 id 生成失败；管理员也只看自己租户 |
| TC-026 | REQ-010 | 模块 | 是 | 任务在 t1 创建、从无上下文泵起 | 使用 t1 渠道，不用默认/t2 |
| TC-027 | REQ-010 | 模块 | 是 | 图像任务在 t1 入队、从无上下文泵起 | 使用 t1 渠道 |
| TC-028 | REQ-010 | UI | 是 | 普通租户成员打开存储目录 | 平台字段只读并提示；本租户渠道仍可编辑 |
| TC-029 | REQ-007 | 模块 | 是 | 旧图片历史导入、双租户记忆 | 默认租户 2 条；t1/t2 各 1 条；各自 80 条上限 |
| TC-030 | REQ-007 | 模块 | 是 | 旧回收站导入、双租户推入/取走 | 默认租户 1 条；t1/t2 隔离；各 100 条上限 |
| TC-031 | REQ-007 | API | 是 | 生成图片后读历史；B 租户读 | A 有记录；B 为空；A 不被清掉 |
| TC-032 | REQ-007 | UI | 是 | 浏览器删除任务→回收站→恢复 | 回收站弹窗、恢复、任务清单成片数正确 |
| TC-033 | REQ-009 | 模块 | 是 | `clean-debug.js --apply` | 只移白名单；数据库/存档/业务目录/状态文件不动；manifest 生成 |
| TC-034 | REQ-009 | 模块 | 是 | `clean-backups.js --apply --days 7` | 只删过期 workspace/restore 和旧 .db；保留 migration 与最新 .db |
| TC-035 | REQ-011 | API | 是 | 配额 2 用户/1 项目/1 任务 | 第 3 用户、第 2 项目、第 2 任务均 429；用量正确 |
| TC-036 | REQ-011 | API | 是 | 登录成功/失败与各类变更 | 审计动作齐全；租户隔离；不含密码/密钥 |

## 3. 回归集

- 任务：`tests/task-lifecycle-api.test.js`、`tests/job-output.test.js`、`tests/manifest`、`tests/manager-video.test.js`
- 工作台：`tests/workbench.test.js`、`tests/workbench-e2e.test.js`
- 图像：`tests/image-tasks.test.js`、`tests/image-tasks-browser.js`（如环境可用）
- 租户/项目：`tests/tenant-isolation-api.test.js`、`tests/project-isolation-api.test.js`
- 渠道：`tests/channels.test.js`、`tests/channel-models.test.js`
- 外联：`tests/executor-channel`（若存在）/ `manager-failure-analysis`
- 全量：`npm test`（96 个文件，按时间预算分批）

## 4. 结果口径

- 结果仅用 `PASS/FAIL/BLOCKED/NOT_RUN/N/A`。
- 执行率 =（PASS+FAIL）/ 必测适用数；通过率 = PASS /（PASS+FAIL）。
- 失败保留首次输出，修复后重跑并记录两次 RUN。
- 证据目录：`evidence/RUN-001/` 起，含命令、退出码、关键输出、截图（UI）。

## 5. 退出条件

- 14 个必测用例全部 PASS；
- 受影响回归全部 PASS；
- 无 P0/P1 未关闭；
- 文档与实际一致，`16-acceptance.md` 有逐项分数。

## 6. 第二轮补充（REQ-012..021）

- 新增 Node 测试：`user-prefs`、`user-prefs-api`、`executor-multi-token`、`invite-reset`、`agent-internal-project`、`vault-rotate`、`harden-data-dir`、`backup-auto`、`quota-storage-concurrency`、`audit-chain-export`。
- 新增浏览器测试：`image-history-browser`、`user-prefs-browser`、`executor-multi-token-browser`、`quota-cross-tenant-browser`。
- 离线全量：`npm run test:offline`（`scripts/run-offline-tests.js`），排除 9 个付费 e2e，串行执行。
- 智能体：`agent_backend/tests/test_harness_governance.py`，测试夹具默认 development，controller 用例显式覆盖。
- 退出条件：新增 22 个 Node 用例 + 4 个浏览器 + 5 个 Python 用例全部 PASS；离线全量 PASS；无新增 P0/P1。
