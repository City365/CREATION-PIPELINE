# 09 实施进度

- 文档状态：第一、二轮已完成（INC-001 观察中）
- 版本：v1.2
- 更新时间：2026-11-05
- 基线：BL-2026-11-05

## 1. 任务状态

| TASK | 关联 | 状态 | 实际改动 | 验证证据 |
| --- | --- | --- | --- | --- |
| TASK-001 进程稳定性 | REQ-001 | 已验证 | 新增 `src/process-log.js`、`src/process-guard.js`；`server.js` 启动时安装；退出/异常写 `data/logs/process.log` | `tests/process-guard.test.js` 2 项 PASS；RUN-001 |
| TASK-002 任务落库 | REQ-002 | 已验证 | `db.js` 新增 `jobs` 表；`jobs.js` 改为脏行 upsert；旧 `jobs.json` 导入并改名；`generation-store` 兼容 `.imported.json` | `tests/jobs-store.test.js` 4 项 PASS；`tests/job-output.test.js` PASS；本机 154 条任务迁移成功 |
| TASK-003 密钥脱敏 | REQ-003 | 已验证 | `config.publicChannel` 去 `apiKey`；`/api/state`、`/api/channels` 去 `includeSecrets`；设置页改用 `masked` | `tests/secret-exposure.test.js` PASS；`tests/channel-key-browser.js` PASS；本机 13 个密钥 0 泄露 |
| TASK-004 命令过期 | REQ-004 | 已验证 | 命令带 `expiresAt`；服务端超时摘除队列；管理器执行前校验 | `tests/executor-expiry.test.js` 2 项 PASS；管理器已重启 |
| TASK-005 删除完整性 | REQ-005 | 已验证 | `tenants.remove` 检查项目；`auth.removeUser` 检查项目 | `tests/tenant-delete-guard.test.js` 2 项 PASS |
| TASK-006 密钥入库 | REQ-006 | 已验证 | 新增 `src/vault.js`；`secrets` 表；`config.load/save` 改为「加密库 + 无密钥 config.json」，含明文迁移与备份 | `tests/secret-vault.test.js` 5 项 PASS；本机 10 条密钥迁移，配置文件 0 泄露 |
| TASK-007 租户配置隔离 | REQ-010 | 已验证 | 新增 `tenant-context`/`tenant-scope`/`tenant_configs`；`config` 按租户读写；任务/事件/图像后台按任务租户执行；部署参数仅管理员可改 | 24 个新增用例 + 177 回归 PASS；本机默认租户 8 个渠道迁移；双租户 API 隔离测试 PASS |
| TASK-008 图片历史/回收站 | REQ-007 | 已验证 | 新增 `image_history`/`event_trash`；旧 JSON 一次导入并改名；按租户隔离、独立限额 | 7 个新增用例 + 177 回归 + 回收站浏览器 PASS；本机 80 条历史 / 4 条回收站迁移 |
| TASK-009 调试产物清理 | REQ-009 | 已验证 | 新增 `scripts/clean-debug.js`、`scripts/clean-backups.js`；按白名单移入/删除 debug，清理过期备份，保留迁移快照与最新 `.db` | `tests/clean-debug.test.js`、`tests/clean-backups.test.js` PASS；本机 debug 约 104MB 已删，旧备份约 1.88GB 已删，`data/backups` 11MB，服务与数据正常 |
| TASK-010 配额与审计 | REQ-011 | 已验证 | 新增 `tenant_quotas`/`audit_log`；任务事件补 `tenant_id`；创建用户/项目/任务时校验；登录与变更留痕；设置页配额/审计 UI | 34 个新增用例 + 177 回归 + 4 浏览器 PASS；本机 198 条事件回填 |
| TASK-011 每用户界面偏好 | REQ-012 | 已验证 | 新增 `user_prefs`/`user-prefs.js`；`/api/state`、`/api/config` 合并用户偏好；登录用户保存 `ui` 不再改平台配置 | 4 个用例 + 浏览器 PASS；RUN-008 |
| TASK-012 多执行端令牌 | REQ-013 | 已验证 | `issue` 追加、`tokenId`/`revokeForUser`、`POST /api/executor/active`；设置页列出多令牌并可撤销/切换任务通道 | 1 个用例 + 浏览器 PASS；RUN-008 |
| TASK-013 邀请与密码重置 | REQ-014 | 已验证 | 新增 `access_codes`；邀请/重置/自助改密接口；登录页接受邀请与设置新密码；团队页生成链接 | 1 个用例 PASS；RUN-008 |
| TASK-014 跨租户配额管理 | REQ-015 | 已验证 | 团队页租户选择器；管理员切换并保存任意租户配额 | 浏览器 PASS；RUN-009 |
| TASK-015 智能体鉴权收紧 | REQ-016 | 已验证 | 新增内部项目接口；`identity.py` controller 模式改调该接口；启动脚本默认 controller；health 公开 | Node 1 个 + Python 4 个 PASS；RUN-008 |
| TASK-016 密钥轮换与目录加固 | REQ-017 | 已验证 | `vault.rotate/recover`；`scripts/rotate-secret.js`；`scripts/harden-data-dir.js`（默认 dry-run） | 6 个用例 PASS；RUN-008 |
| TASK-017 自动备份与保留 | REQ-018 | 已验证 | 新增 `src/backup.js`、`scripts/backup.js`；启动后 60 秒尝试、每 6 小时检查；每库保留 14 份/30 天 | 4 个用例 PASS；RUN-008 |
| TASK-018 配额增强 | REQ-019 | 已验证 | 新增存储/并发配额；`jobs.tenant_id` 回填；`pump` 兜底；设置页显示与保存 | 4 个用例 PASS；RUN-008/009 |
| TASK-019 审计导出与防篡改 | REQ-020 | 已验证 | `audit_log` 增加哈希链；`/api/audit` 返回完整性；CSV/JSON 导出；审计页导出与校验状态 | 1 个用例 PASS；RUN-008 |
| TASK-020 浏览器与离线回归 | REQ-021 | 已验证 | 4 个浏览器用例；`scripts/run-offline-tests.js` 与 `npm run test:offline`；修复「最近生成」弹窗 `$(...).forEach` 崩溃 | 离线全量 PASS；RUN-008/009 |
| TASK-021 文档与证据 | REQ-021 | 已验证 | 更新 02/03/04/09/11/16/18/19 与 RUN-008/009 | 文档审查 |

## 2. 计划外发现并修复

| 编号 | 问题 | 影响 | 处置 | 证据 |
| --- | --- | --- | --- | --- |
| BUG-001 | 新账号首屏带 `projectId=default`，被当成真实项目查询 → 404，页面显示「项目不存在 / 无法连接」 | 新租户/新账号无法进入创作台 | `scoped()` 把 `default`/`unassigned` 识别为未归档桶 | `tests/first-run-boot.test.js` PASS；`tests/channel-key-browser.js` 页面可加载 |
| BUG-002 | `/api/media` 只能按当前激活项目列，未登录/无激活项目时看不到指定项目媒体 | 无法按项目查看成片 | 支持显式 `projectId`（仍做租户校验） | `tests/workbench-e2e.test.js` PASS |
| BUG-003 | `workbench-e2e` 用合成项目 `p`，与项目归属校验冲突（既有未提交改动引入） | 回归失败 | 测试先创建真实项目并使用其 id | `tests/workbench-e2e.test.js` PASS |
| BUG-004 | `job-output` 直接读 `jobs.json`，迁移后文件已改名 | 回归失败 | 测试改为查 `jobs` 表 | `tests/job-output.test.js` PASS |

## 3. 测试统计

| 指标 | 数值 |
| --- | --- |
| 新增测试文件 | 17（process-guard、jobs-store、executor-expiry、secret-exposure、tenant-delete-guard、first-run-boot、secret-vault、tenant-config、tenant-config-api、tenant-job-context、tenant-image-context、image-history-store、event-trash-store、image-history-api、clean-debug、clean-backups、quota-audit-api） |
| 新增浏览器测试 | 4（channel-key-browser、tenant-storage-browser、events-undo-browser、quota-audit-browser） |
| 受影响回归文件 | 53（36 个既有 + 17 个新增） |
| 回归用例 | 211 个 Node 用例 + 4 个浏览器用例，PASS 215 / FAIL 0 |
| 必测用例 | 36 / 36 PASS |
| 全量 `npm test` | NOT_RUN（包含 AutoDL/Seedance/RunningHub 等会调用真实付费服务的 e2e，未获授权跑全量） |

> 并行执行时 `file-rel-api` 与 `tenant-isolation-api` 因固定端口互相踩踏出现 2 个失败；改用 `--test-concurrency=1` 串行后 177/177 通过。这是测试夹具问题，不是产品回归，已记录到 15。

## 4. 本机运行状态

- 创作台重启后 `/api/health` 正常；管理器 `/health` 正常。
- `data/jobs.imported.json` 已生成，`data/jobs.json` 不再存在；`jobs` 表 154 行，状态分布与旧文件一致（success 86 / failed 41 / canceled 27）。
- `/api/state`、`/api/channels` 对已配置密钥 0 泄露；渠道对象只含 `hasKey/keyCount/masked`。
- 密钥迁移：`data/secret.key` 已生成；`secrets` 表 10 行；`config.json` 明文 0 条；备份 `config.json.before-vault-*` 与 `config.json.bak-*` 均存在。
- 运行时解密正常：AutoDL 1 个、LLM 4 个、图像 2 个、视频 2 个渠道带 Key；执行端通道 20 秒内有心跳。
- 租户配置迁移：`tenant_configs` 1 行（`tnt_default`）；`config.json` 只剩部署参数；`secrets` 全部为 `scope='tenant', tenant_id='tnt_default'`（10 行），平台作用域 0 行。
- 图片历史/回收站迁移：`image_history` 80 行、`event_trash` 4 行（均为默认租户）；`image-history.json`、`events-trash.json` 已改名为 `*.imported.json`；两个接口返回条数一致。
- 调试产物：164 项/约 111MB 移入 `data/debug/` 后删除（释放约 104MB），根目录 203→39；`data/backups` 清理 3 项/约 1.88GB，保留 `migration/`（2 个快照）与最新 `.db`，目录降到 11MB。
- 配额/审计：`tenant_quotas`、`audit_log` 已建表；`task_events` 198 条全部回填 `tnt_default`；默认配额 0（不限）；服务/渠道/任务正常。
- `data/logs/process.log` 尚未产生（重启为外部强制终止，未走 JS 退出钩子）。
- 最终代码重启时间：2026-11-05 01:30:51；INC-001 观察窗口从此时开始（30 分钟）。

## 5. 偏差与阻塞

- INC-001 根因尚未确认：新增了退出/异常证据，但观察窗口内未复现原始 `code=1` 退出；继续观察。
- REQ-008 暂缓：用户 2026-11-05 明确继续 SQLite，等功能全部开发完成后再评估迁移；不再作为当前阻塞项。
- 未执行：真实付费视频/图像渠道生成（额度保护）；MySQL/PG 适配器（无实例）；真实邮件发送（邀请/重置用一次性链接，不接邮件服务）。
- 未提交：工作区改动尚未 git commit，交付前需要用户确认后提交。

## 6. 第二轮测试统计

| 指标 | 数值 |
| --- | --- |
| 新增 Node 测试文件 | 10（user-prefs、user-prefs-api、executor-multi-token、invite-reset、agent-internal-project、vault-rotate、harden-data-dir、backup-auto、quota-storage-concurrency、audit-chain-export） |
| 新增浏览器用例 | 4（image-history、user-prefs、executor-multi-token、quota-cross-tenant） |
| 新增 Node 用例 | 22 |
| Python 用例 | 5（agent governance，含 controller 项目校验与公开 health） |
| 离线全量回归 | `npm run test:offline`（排除 9 个付费 e2e，串行） | 543 tests / 543 pass / 0 fail |
| 浏览器结果 | 4 / 4 PASS |
| 已知问题修复 | 「最近生成」弹窗 `$().forEach` 崩溃；`poll wait=0` 被当成默认 25 秒；备份同名 `.db` 死循环 |
