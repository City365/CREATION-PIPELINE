# 08 实施计划

- 文档状态：第一轮已执行；第二轮见 [19-round2-plan.md](19-round2-plan.md)
- 版本：v1.1
- 更新时间：2026-11-05
- 基线：BL-2026-11-05

任务状态：`待规划 → 就绪 → 进行中 → 待验证 → 已验证 → 已验收`

> 第二轮 TASK-011..021（每用户界面偏好、多执行端令牌、邀请/重置、跨租户配额、智能体鉴权、密钥轮换/ACL、自动备份、存储/并发配额、审计导出/哈希链、浏览器与离线回归）的任务卡、验收与证据见 [19-round2-plan.md](19-round2-plan.md)。

---

## TASK-001 进程稳定性与退出证据（REQ-001）

- 状态：就绪
- 前置：无
- 改动位置：`Creation-Studio/src/server.js`（进程级钩子）；新增 `Creation-Studio/src/process-log.js`
- 步骤：
  1. 新增 `process-log.js`：`logLine(kind, payload)` 追加到 `data/logs/process.log`，单文件超过 5 MB 轮转为 `.1`。
  2. `server.js` 启动时注册 `unhandledRejection`（记录后继续）、`uncaughtException`（记录 → `jobs.flushState()` → 退出 1）、`exit`（记录 pid/退出码/信号）。
  3. 保留现有 `SIGINT/SIGTERM` 行为。
- 验证：
  - 通过测试用子进程触发 `Promise.reject`，断言进程仍健康且 `process.log` 有记录。
  - 触发未捕获异常，断言退出码 1 且日志含堆栈。
  - 正常运行 10 分钟，退出记录可读。
- 回滚：移除钩子与文件即可；无数据影响。
- 完成定义：TC-001..003 PASS；日志路径写入 17-release。

---

## TASK-002 任务状态落库（REQ-002）

- 状态：就绪
- 前置：TASK-001（崩溃安全落盘）
- 改动位置：`src/db.js`（`jobs` 表）、`src/jobs.js`（load/save/flush、脏集合）、`src/generation-store.js`（兼容 `.imported.json`）
- 步骤：
  1. `db.js` SCHEMA 增加 `jobs` 表与索引。
  2. `jobs.js` 新增 `jobRepo`：`loadAll`、`upsert(job)`、`remove(id)`、`count()`。
  3. `loadState()`：先导入旧 `jobs.json`（备份 → 事务 → 校验 → 改名），再从表加载。
  4. `saveState()`：只 upsert `dirtyJobs`；`touch/log/setShotMeta/reorder/renameOutputs/adoptLegacy` 标脏。
  5. `remove()` 删除行；`flushState()` 立即 flush 并清空脏集合。
  6. `generation-store.importHistory()` 同时尝试 `jobs.imported.json`。
- 验证：
  - 迁移测试：临时目录放 `jobs.json`（3 条），启动后表行数 3、文件名变为 `jobs.imported.json`、列表一致。
  - 运行中任务触发 20 次 touch，落盘只影响该行（用 `updated_at` 与其它行比较）。
  - 重启后 `interrupted` 行为不变。
  - 删除任务后表行消失。
- 回滚：删除 `jobs` 表数据并把 `jobs.imported.json` 改回 `jobs.json`，回退代码。
- 完成定义：TC-004..007 PASS；`data/jobs.json` 不再增长（可留存的旧文件除外）。

---

## TASK-003 密钥响应脱敏（REQ-003）

- 状态：就绪
- 前置：无
- 改动位置：`src/config.js`、`src/server.js`、`web/app.js`
- 步骤：
  1. `config.publicChannel()` 去掉 `apiKey`，保留 `hasKey`/`masked`。
  2. `/api/state`、`/api/channels` 去掉 `includeSecrets: true`。
  3. 前端设置页：展示 `masked`；编辑草稿的 `apiKey` 初始为空，占位符显示 `masked`；保存空值保持原 Key。
- 验证：
  - TC-008：`/api/state`、`/api/channels`、`/api/config` 响应不含完整 Key。
  - TC-009：不改 Key 保存后，实际调用仍使用原 Key（通过 mock 渠道断言 Authorization）。
  - TC-010：`clearKey` 后 `hasKey=false`。
- 回滚：恢复 `includeSecrets`；不影响数据。
- 完成定义：TC-008..010 PASS；设置页可正常保存。

---

## TASK-004 执行端命令过期（REQ-004）

- 状态：就绪
- 前置：无
- 改动位置：`Creation-Studio/src/executor-channel.js`、`Video-Generation-Manager/src/outbound.js`
- 步骤：
  1. `request()` 给命令加 `expiresAt = now + timeoutMs`。
  2. `takeCommand()` 丢弃 `expiresAt <= now` 的命令。
  3. 超时回调按 id 从队列移除。
  4. 管理器 `execute()` 先检查 `expiresAt`，过期则不请求本地接口，直接回错误。
  5. 补一条协议说明注释。
- 验证：
  - TC-011：超时命令不再出现在后续 poll。
  - TC-012：管理器收到过期命令不调用本地接口。
- 回滚：移除 `expiresAt` 字段；旧管理器忽略未知字段，兼容。
- 完成定义：TC-011..012 PASS。

---

## TASK-005 删除完整性（REQ-005）

- 状态：就绪
- 前置：无
- 改动位置：`src/tenants.js`、`src/auth.js`
- 步骤：
  1. `tenants.remove()` 检查 `projects` 表。
  2. `auth.removeUser()` 检查 `projects.owner_user_id`。
  3. 错误信息给可操作建议。
- 验证：
  - TC-013：有项目的租户删除返回 400，数据不变。
  - TC-014：有项目的用户删除返回 400；无项目用户删除成功且会话清除。
- 回滚：移除检查；无数据变化。
- 完成定义：TC-013..014 PASS。

---

## TASK-006 密钥加密入库（REQ-006）

- 状态：已验证
- 前置：TASK-003（接口已脱敏）
- 改动位置：`src/vault.js`（新增）、`src/db.js`（`secrets` 表）、`src/config.js`（加载/保存/迁移）
- 步骤：
  1. `vault.js`：AES-256-GCM 加解密；主密钥来自 `WMD_SECRET_KEY` 或 `data/secret.key`（0600）。
  2. `db.js` 增加 `secrets(scope, tenant_id, name, value_enc, updated_at)`，预留租户级。
  3. `config.load()`：检测明文 → 备份 → 写入加密库 → 改写 `config.json` → 从库注入内存。
  4. `config.save()`：先写加密库，再写不含密钥的 `config.json`；删除渠道/Key 时清理密文。
  5. 解密失败直接报错，不把坏数据当成空值。
- 验证：
  - TC-016：明文迁移、文件/库无明文、备份存在。
  - TC-017：跨进程用同一主密钥解密。
  - TC-018：错误主密钥启动失败。
  - TC-019：保存更新、删除清理。
  - TC-020：密文篡改报错。
- 回滚：把 `config.json.bak-*` 改回 `config.json`，回退代码；`secrets` 表可保留。
- 完成定义：TC-016..020 PASS；本机 10 条密钥迁移成功；设置页/渠道调用不受影响。

> 租户级渠道隔离（同一租户各自配置）仍未做，作为 TASK-007 单独评估，不混在本次密钥迁移里。

---

## TASK-007 租户级配置隔离（REQ-010）

- 状态：已验证
- 前置：TASK-006
- 改动位置：`src/tenant-context.js`、`src/tenant-scope.js`（新增）、`src/config.js`、`src/server.js`、`src/jobs.js`、`src/events.js`、`src/image-tasks.js`、`web/app.js`
- 步骤：
  1. 新增 `tenant_configs` 表；`config.load/save` 按当前租户读/写，部署参数留在 `config.json`。
  2. 请求入口用独立的 `AsyncLocalStorage` 上下文，认证后 `enter(tenantId)`。
  3. 任务、事件、图像任务记录 `tenantId`；任务泵/事件调度/图像泵按任务租户执行。
  4. 非平台管理员的部署参数写入被忽略；设置页对普通成员只读。
  5. 默认租户继承旧全局配置，其它租户从空配置开始。
- 验证：TC-021..027；模块测试、API 测试、任务/图像后台上下文测试、浏览器只读测试。
- 回滚：停服 → 用 `wmd.before-tenant-*.sqlite` 与 `config.json.bak-*` 恢复 → 回退代码。
- 完成定义：24 个新增用例 + 177 个回归 PASS；本机默认租户 8 个渠道迁移成功。

---

## TASK-008 图片历史/回收站入库（REQ-007）

- 状态：已验证
- 前置：TASK-007（租户上下文）
- 改动位置：`src/image-history.js`（新增）、`src/db.js`、`src/image-tasks.js`、`src/generation-store.js`、`src/server.js`、`src/event-store.js`、`src/events.js`
- 步骤：
  1. `image_history` 表：按租户存最近 80 条，旧 JSON 首次读取时导入并改名。
  2. `event_trash` 表：按租户存最近 100 条，`event-store.open()` 时导入旧 JSON 并改名。
  3. `image-tasks`/`server` 改用 `image-history` 模块；`generation-store` 从表里导入历史。
  4. 回收站删除/恢复改走 `event-store`，租户隔离。
- 验证：TC-029..032；模块测试、HTTP 测试、回收站浏览器测试。
- 回滚：恢复迁移前数据库快照，把 `*.imported.json` 改回原名，回退代码。
- 完成定义：31 个新增用例 + 177 个回归 + 3 个浏览器用例 PASS；本机 80 条历史 / 4 条回收站迁移成功。

---

## TASK-009 调试产物清理（REQ-009）

- 状态：已验证
- 前置：无
- 改动位置：`scripts/clean-debug.js`（新增）、`package.json`、`tests/clean-debug.test.js`
- 步骤：
  1. 白名单分类：根目录截图、日志、`_*.js`/`tmp-dbg.js`、`p0-4`/`scene-*-evidence` 证据、旧 config 备份、迁移副本、调试目录。
  2. 默认 dry-run；`--apply` 移入 `data/debug/<分类>/` 并写 manifest，不删除。
  3. `wmd.before-*.sqlite` 移到 `data/backups/migration/`，保留回滚能力。
  4. 数据库、`*.imported.json`、业务目录、运行状态文件保持不动。
  5. 新增 `scripts/clean-backups.js`：删除超过 7 天的 `workspace-*`/`restore-*` 和旧 `.db`，保留 `migration/` 与最新 `.db`。
- 验证：TC-033/034；本机 164 项移动并删除（约 104MB）；旧备份删除 3 项/约 1.88GB，`data/backups` 降到 11MB；服务/任务/历史/回收站验证正常。
- 回滚：按 manifest 把 `debug/<分类>/` 下的文件移回原位。
- 完成定义：脚本测试 PASS；本机验证无数据丢失；遗留项记录在 02/18。

---

## TASK-010 配额与审计（REQ-011）

- 状态：已验证
- 前置：TASK-007（租户上下文）
- 改动位置：`src/quotas.js`、`src/audit.js`（新增）、`src/db.js`、`src/event-store.js`、`src/events.js`、`src/server.js`、`web/app.js`
- 步骤：
  1. `tenant_quotas` / `audit_log` 表；`task_events` 增加 `tenant_id` 并按项目回填。
  2. 配额校验：创建用户、项目、任务事件时检查；0 = 不限，超限 429。
  3. 审计写入：登录/注册/用户/租户/项目/配置/渠道/事件删除；只写安全摘要。
  4. `GET/PUT /api/tenants/:id/quota`、`GET /api/audit`；权限按租户/管理员收紧。
  5. 设置页「租户成员」显示配额并可保存；新增「审计日志」标签页；成员隐藏渠道操作。
- 验证：TC-035/036；配额/审计 API 测试、浏览器配额/审计测试、177 个回归。
- 回滚：恢复 `wmd-before-quota-*` / `events-before-quota-*` 快照并回退代码。
- 完成定义：34 个新增用例 + 177 回归 + 4 个浏览器用例 PASS；本机 198 条事件回填。

---

## 依赖与顺序

```
TASK-001 ──► TASK-002
TASK-003 ──► TASK-006
TASK-004（独立，跨项目协议）
TASK-005（独立）
TASK-007 租户级配置隔离（待规划）
```

## 本轮完成定义

- TASK-001..006 全部 `已验证`；
- 受影响测试与 96 个测试文件的回归结果留证；
- `09-progress.md`、`13-api-tests.md`、`14-ui-tests.md`、`16-acceptance.md` 更新为实际结果。
