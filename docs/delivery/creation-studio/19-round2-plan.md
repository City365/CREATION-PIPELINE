# 19 第二轮计划与验收方案（REQ-012..REQ-021）

- 文档状态：已完成
- 版本：v1.1
- 创建时间：2026-11-05
- 基线：第一轮 REQ-001..REQ-011 已完成（见 09/16）
- 范围：第一轮遗留的体验、安全运维、验证项；**不包含** MySQL/PG 迁移（用户决定暂缓）

## 1. 范围与非目标

### 1.1 本轮做

| 编号 | 需求 | 解决的问题 |
| --- | --- | --- |
| REQ-012 | 每用户界面偏好 | 主题/壁纸/字号/音量目前是平台共享，一个人改影响所有租户 |
| REQ-013 | 多执行端令牌 | 同一用户只能有一条管理器令牌，多台机器无法同时配对 |
| REQ-014 | 邀请与密码重置 | 目前只能管理员手填密码；忘记密码只能找管理员 |
| REQ-015 | 跨租户配额管理 | 平台管理员只能在设置页改自己所在租户的配额 |
| REQ-016 | 智能体鉴权收紧 | 智能体后端默认 `development` 直接放行；controller 模式只校验默认租户项目 |
| REQ-017 | 密钥轮换与目录加固 | 换 `secret.key` 需要重加密全部密钥；Windows 数据目录没有加固脚本 |
| REQ-018 | 自动备份与保留 | 只有手工脚本，没有定时快照和自动清理 |
| REQ-019 | 配额增强 | 只有用户/项目/每日任务；存储空间与并发任务没有计量 |
| REQ-020 | 审计导出与防篡改 | 审计只能看，不能导出；应用层可改且无完整性校验 |
| REQ-021 | 浏览器用例与离线全量回归 | 「最近生成」弹窗无浏览器用例；全量测试含付费 e2e 不能直接跑 |

### 1.2 本轮不做

- MySQL/PostgreSQL 迁移（REQ-008 暂缓）。
- 邮件发送、短信、第三方 SSO：邀请/重置以一次性链接/验证码交付，不接邮件服务。
- 对象存储、CDN、跨机任务调度。
- 对真实付费视频渠道做生成测试（额度保护）。
- 自动 git 提交：工作区改动由用户确认后再提交。

## 2. 任务总表

| TASK | REQ | 优先级 | 预计改动 | 风险 | 验收 |
| --- | --- | --- | --- | --- | --- |
| TASK-011 每用户界面偏好 | REQ-012 | P1 | `db.js`、`user-prefs.js`、`server.js`、`web/app.js` | 低 | UAT-016 |
| TASK-012 多执行端令牌 | REQ-013 | P1 | `executor-channel.js`、`server.js`、`web/app.js` | 低 | UAT-017 |
| TASK-013 邀请与密码重置 | REQ-014 | P1 | `db.js`、`auth.js`、`server.js`、`web/app.js` | 中 | UAT-018 |
| TASK-014 跨租户配额管理 | REQ-015 | P1 | `web/app.js`（接口已支持） | 低 | UAT-019 |
| TASK-015 智能体鉴权收紧 | REQ-016 | P0 | `server.js`、`identity.py`、`launch.js`、`main.py` | 中 | UAT-020 |
| TASK-016 密钥轮换与目录加固 | REQ-017 | P0 | `vault.js`、`scripts/rotate-secret.js`、`scripts/harden-data-dir.js` | 高 | UAT-021 |
| TASK-017 自动备份与保留 | REQ-018 | P1 | `backup.js`、`scripts/backup.js`、`server.js` | 低 | UAT-022 |
| TASK-018 配额增强 | REQ-019 | P1 | `db.js`、`quotas.js`、`jobs.js`、`events.js`、`server.js`、UI | 中 | UAT-023 |
| TASK-019 审计导出与防篡改 | REQ-020 | P1 | `db.js`、`audit.js`、`server.js`、UI | 中 | UAT-024 |
| TASK-020 浏览器用例与离线回归 | REQ-021 | P0 | `tests/*`、`package.json` | 低 | UAT-025 |
| TASK-021 文档与证据 | REQ-021 | P0 | `docs/delivery/**` | 低 | UAT-026 |

## 3. 逐项方案

### TASK-011 每用户界面偏好

**数据**

```sql
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**规则**

- `ui` 仍是平台默认值（`config.json`），用户偏好覆盖在默认值之上。
- 登录用户保存 `ui` 时写 `user_prefs`，不再写平台配置；未登录（本机尚未注册）仍写平台配置。
- 读取：`/api/state`、`/api/config` 返回 `{...平台 ui, ...用户 ui}`。
- 删除用户时清理 `user_prefs`。
- 不做迁移：已有 `config.json.ui` 继续作为默认值。

**API**

- `PUT /api/config`：`ui` 分流到 `userPrefs.save(currentUser.id, patch.ui)`；其它字段逻辑不变。
- 无新增读接口，复用 `/api/state`。

**验收**

- 用户 A 设 `theme=night`，用户 B 仍是默认；A 退出重登仍生效。
- `config.json` 不再因 A 改主题而变化。
- 未登录首次运行仍可保存主题。
- `tests/user-prefs.test.js` + `tests/user-prefs-api.test.js` 覆盖。

### TASK-012 多执行端令牌

**数据**

- 表结构不变；`executor_channels` 一个用户可以有多行。
- 新增 `tokenId(token) = sha256(token).slice(0,16)`，只用于界面标识，不替代令牌。

**行为**

- `issue` 改为追加，不再删除旧令牌；参数 `replace: true` 保留“换发”语义（可选）。
- `status` 返回每条令牌的 `id`、名称、在线状态、最后在线、配对时间；**不返回完整令牌**。
- 撤销：`DELETE /api/executor/pair` 接受 `{id}` 或 `{token}`；只能撤销自己的令牌。
- 新增 `POST /api/executor/pair` 的 `name` 用于区分机器。
- 管理器仍用完整令牌配对；界面只在生成时显示一次。

**验收**

- 同一用户连续生成两条令牌，两条都能 `poll`。
- 撤销其中一条，另一条仍可用；不能撤销别人的令牌。
- 设置页列出多条，带撤销按钮。
- `tests/executor-multi-token.test.js` 覆盖。

### TASK-013 邀请与密码重置

**数据**

```sql
CREATE TABLE IF NOT EXISTS access_codes (
  code_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,              -- invite | reset
  tenant_id TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  user_id TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_access_codes_expires ON access_codes(expires_at);
```

- 只存 `sha256(code)`；明文只在创建响应里出现一次。
- 邀请默认 72 小时；重置默认 30 分钟。
- 邀请与重置都单次使用；使用后写 `used_at`。
- 过期/已用/不存在统一返回 400，不泄露状态。

**API**

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/invites` | owner/admin | 生成邀请码，返回 `{code,url,expiresAt}` |
| GET | `/api/invites/:code` | 公开 | 返回 `{tenantName,role,expiresAt}`，用于注册页展示 |
| POST | `/api/auth/accept-invite` | 公开 | `{code,username,password}` 创建用户并登录 |
| POST | `/api/users/:id/reset-token` | owner/admin | 生成重置码，返回 `{code,url,expiresAt}` |
| POST | `/api/auth/reset-password` | 公开 | `{code,password}` 改密码并使旧会话失效 |
| POST | `/api/auth/change-password` | 登录 | `{oldPassword,newPassword}` 自助改密 |

**权限**

- 租户 owner/admin 只能邀请到本租户、只能重置本租户成员。
- 平台管理员可邀请到任意租户。
- 不能给平台管理员生成重置码（避免接管平台账号）。

**UI**

- 团队页：`邀请成员` 生成链接；成员行 `重置密码` 生成链接；链接只显示一次，可复制。
- 登录页：URL 带 `?invite=` 时显示“接受邀请”表单；带 `?reset=` 时显示“设置新密码”表单。
- 审计：`invite.create`、`invite.accept`、`user.reset.token`、`auth.password.reset`、`auth.password.change`；不记密码/验证码。

**验收**

- 邀请码创建后 72 小时内可用，过期/重复使用失败。
- 接受邀请创建的账号租户、角色正确，且受用户数配额限制。
- 重置码改密后旧会话立即失效，新密码可登录。
- `tests/invite-reset.test.js` 覆盖。

### TASK-014 跨租户配额管理

**现状**：`GET/PUT /api/tenants/:id/quota` 已支持平台管理员操作任意租户；缺的是界面。

**UI**

- 团队页配额块增加租户选择（仅平台管理员可见），默认当前租户。
- 选择租户后读取该租户配额与用量；保存写到所选租户。
- 同时展示新增的存储/并发配额（见 TASK-018）。

**验收**

- 管理员在 UI 切换租户，看到并修改另一租户配额；当前租户不变。
- 非管理员看不到租户选择，也不能写其它租户（403）。
- 浏览器用例 `quota-cross-tenant-browser.js` 覆盖。

### TASK-015 智能体鉴权收紧

**问题**

1. `launch.js`、`server.js controlService` 默认 `HARNESS_AUTH_MODE=development`。
2. `identity.py` 的 controller 模式调 `/api/projects`，内部调用没有租户上下文，只能看到默认租户项目。

**方案**

- 新增内部接口 `GET /api/internal/projects/:id`：只接受本机 + `X-WMD-Internal`，返回 `{id,tenantId}`；不存在 404。
- `identity.py` controller 模式改调该接口；项目存在即通过，不依赖租户上下文。
- 默认模式改为 `controller`；`development` 只能显式设置（本机开发用）。
- `launch.js` 与 `controlService` 默认传 `controller`。
- `/agent/health` 不再依赖项目鉴权（只返回模型/能力信息），避免启动健康检查被项目归属卡住；其它 `/agent/*` 仍鉴权。
- 启动器健康检查仍带项目头，但 controller 模式下若项目不存在会失败；因此 health 改为公开。

**验收**

- controller 模式下：不存在的项目 403；任意租户的真实项目 200。
- 直接访问 17820 且不带内部凭据时，业务接口 403/503，不能靠 `development` 绕过。
- 启动器默认以 controller 启动，`/agent/health` 正常。
- `tests/agent-internal-project.test.js` + `agent_backend/tests/test_identity.py` 覆盖。

### TASK-016 密钥轮换与数据目录加固

**轮换**

- `vault.rotate({ newKey })`：
  1. 读取全部 `secrets`，用当前主密钥解密、新密钥重加密；任一失败即中止，不写库。
  2. 写 `data/secret.key.next`，标记 `meta.vault_rotation='pending'`。
  3. 单事务更新全部密文。
  4. 旧 `secret.key` 备份为 `secret.key.bak-<时间戳>`，`next` 改名为 `secret.key`，清标记。
- `vault.recover()`：启动时若发现 pending，先用 `next` 试解密一条；成功则完成改名，失败则删除 `next` 保留原密钥。
- `scripts/rotate-secret.js`：默认只预览；`--apply` 执行；`--new-key` 可指定 64 位 hex/32 字节 base64；不指定则生成。
- 环境变量 `WMD_SECRET_KEY` 生效时，脚本提示需要同步更新环境变量；轮换仍写 `secret.key`，但下次启动会被环境变量覆盖，文档明确要求二选一。

**目录加固**

- `scripts/harden-data-dir.js`：默认打印 `icacls` 命令；`--apply` 执行。
- Windows：对 `data/` 关闭继承，授予当前用户、SYSTEM、Administrators 完全控制；对 `secret.key`、`internal-token.json`、`config.json` 单独授权。
- 非 Windows：打印说明，不做修改。

**验收**

- 轮换 10 条密钥后全部可解密；旧密钥备份存在；重启后仍可解密。
- 新密钥错误/密文损坏时轮换中止，原库不变。
- ACL 脚本 dry-run 不修改任何权限；`--apply` 只影响 `data/` 指定路径。
- `tests/vault-rotate.test.js`、`tests/harden-data-dir.test.js` 覆盖。

### TASK-017 自动备份与保留

**实现**

- `src/backup.js`：
  - `snapshot()`：对 `wmd.sqlite`、`task-events.sqlite`、`studio.db` 执行 `VACUUM INTO data/backups/auto/<时间>-<库名>.sqlite`。
  - `prune({keep=14, days=30})`：每个库保留最新 14 份，删除超过 30 天的自动备份；不碰 `data/backups/migration/` 与手工备份。
  - `maybeRun()`：`meta.backup.last_auto` 距今不足 24 小时则跳过。
  - `start()`：启动 60 秒后尝试一次，之后每 6 小时检查；定时器 `unref()`，不阻止退出。
  - 失败写 `process.log`，不影响业务。
- `scripts/backup.js`：`--list`、`--keep N`、`--days N`，默认执行一次快照+清理。
- `server.js` 启动时调用 `backup.start()`。

**验收**

- 三个库都能生成快照；`VACUUM INTO` 不锁死业务读取。
- 清理只删自动目录中超过保留策略的文件；迁移快照与最新库不动。
- 定时器不阻止进程退出；失败不会导致服务崩溃。
- `tests/backup-auto.test.js` 覆盖。

### TASK-018 配额增强

**数据**

```sql
ALTER TABLE tenant_quotas ADD COLUMN max_storage_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_quotas ADD COLUMN max_concurrent_tasks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ix_jobs_tenant_status ON jobs(tenant_id, status);
```

- 用 `PRAGMA table_info` 检查后再 `ALTER`，可重复执行。
- 老任务按 `data` 里的 `tenantId` 回填一次（标记 `jobs_tenant_backfill`）；缺失的落默认租户。

**规则**

- `maxStorageBytes`：0 不限；用量按租户项目目录 + 默认租户的 save/asset/upload 目录统计，60 秒缓存。
- 超过存储上限后，新建任务/事件返回 429；不删除已有文件。
- `maxConcurrentTasks`：0 不限；`jobs` 表 `status='running'` 计数；新建任务时 `running + 新增 > 上限` 返回 429。
- UI：配额块增加“存储上限（GB）”“并发任务上限”；显示当前用量。

**验收**

- 并发上限 1 时，第二个任务 429；完成第一个后可继续。
- 存储超限后新任务 429；清理文件后恢复。
- 用量按租户隔离；平台管理员可查看其它租户。
- `tests/quota-storage-concurrency.test.js` 覆盖。

### TASK-019 审计导出与防篡改

**数据**

```sql
ALTER TABLE audit_log ADD COLUMN prev_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_log ADD COLUMN hash TEXT NOT NULL DEFAULT '';
```

**规则**

- 每租户一条哈希链：`hash = sha256(prev_hash|id|tenant|user|action|target|detail|ip|created_at)`。
- 老记录 `hash` 为空；校验从第一条非空记录开始，把它当作锚点。
- 清理保留最近 5000 条会造成链首前移，校验仍以当前最早一条为锚点。
- 校验发现 `prev_hash` 不匹配或重算不一致即返回断裂位置。
- 导出 `GET /api/audit/export?format=csv|json&tenantId=`：权限同 `/api/audit`；CSV 带 UTF-8 BOM。
- `/api/audit` 响应增加 `integrity`。
- UI：审计页增加“导出 CSV/JSON”和完整性状态。

**验收**

- 导出条数与列表一致；CSV 可被 Excel 正确识别中文。
- 直接改库中一条 `detail` 后，`integrity.ok=false` 并指出记录。
- 普通成员不能导出；平台管理员可导出任意租户。
- `tests/audit-chain-export.test.js` 覆盖。

### TASK-020 浏览器用例与离线回归

- 新增 `tests/image-history-browser.js`：登录 → 打开图像页 → 菜单「最近生成…」→ 断言弹窗标题与条目。
- 新增 `tests/executor-multi-token-browser.js`：生成两条令牌、列表两条、撤销一条。
- 新增 `tests/user-prefs-browser.js`：两个浏览器上下文不同主题互不影响。
- `package.json` 增加 `test:offline`：跑除付费 e2e（autodl/seedance/optimize/image-e2e/image-tools/generic-video/tts/autodl-motion/runninghub）之外的全部 Node 用例，串行 `--test-concurrency=1`。
- 执行并记录 RUN-008。

### TASK-021 文档与证据

- 更新 02 需求、03 架构、04 数据、09 进度、11 决策、16 验收、18 交接。
- 新增 `evidence/RUN-008`（第二轮测试）与 `RUN-009`（浏览器/回归）。
- 记录未做项与遗留风险（INC-001、未提交文件、真实付费渠道未测）。

## 4. 验收标准

### 4.1 全局门槛

- 每个 UAT ≥ 90 分；全部 Must 通过。
- 新增 Node 用例与受影响回归全部 PASS；离线全量回归串行 PASS。
- 不新增明文密钥、不新增可编辑 JSON 业务状态。
- 数据库迁移可重复执行；失败不破坏原数据。
- 所有新增接口有权限校验，跨租户访问返回 404/403。

### 4.2 UAT 表

| UAT | 关联 | Must | 断言 |
| --- | --- | --- | --- |
| UAT-016 | REQ-012 | 是 | 双用户主题互不影响；重启保留；平台配置不变 |
| UAT-017 | REQ-013 | 是 | 多令牌并存；单条撤销；越权撤销失败；界面列出 |
| UAT-018 | REQ-014 | 是 | 邀请创建/接受/过期/重复；重置改密/旧会话失效；审计无敏感值 |
| UAT-019 | REQ-015 | 是 | 管理员跨租户改配额；非管理员 403 |
| UAT-020 | REQ-016 | 是 | controller 模式校验任意租户项目；直连无凭据被拒；health 可用 |
| UAT-021 | REQ-017 | 是 | 轮换后可解密；失败回滚；ACL 脚本 dry-run/apply |
| UAT-022 | REQ-018 | 是 | 三库快照；保留策略；定时器不阻塞退出 |
| UAT-023 | REQ-019 | 是 | 并发/存储 429；用量隔离；UI 显示 |
| UAT-024 | REQ-020 | 是 | 导出权限/内容；篡改可检出 |
| UAT-025 | REQ-021 | 是 | 浏览器用例 PASS；离线全量 PASS |
| UAT-026 | REQ-021 | 是 | 文档、证据、遗留项齐全 |

## 5. 执行顺序

1. TASK-011 每用户界面偏好
2. TASK-012 多执行端令牌
3. TASK-013 邀请与密码重置
4. TASK-014 跨租户配额管理
5. TASK-015 智能体鉴权收紧
6. TASK-016 密钥轮换与目录加固
7. TASK-017 自动备份与保留
8. TASK-018 配额增强
9. TASK-019 审计导出与防篡改
10. TASK-020 浏览器用例与离线回归
11. TASK-021 文档与证据

每项完成后：实现 → 单元/接口测试 → 受影响回归 → 记录证据 → 更新 09/16。

## 6. 状态跟踪

| TASK | 状态 | 证据 |
| --- | --- | --- |
| TASK-011 | 已完成 | `tests/user-prefs*.test.js`、`tests/user-prefs-browser.js`；RUN-008 |
| TASK-012 | 已完成 | `tests/executor-multi-token.test.js`、`tests/executor-multi-token-browser.js`；RUN-008 |
| TASK-013 | 已完成 | `tests/invite-reset.test.js`；RUN-008 |
| TASK-014 | 已完成 | `tests/quota-cross-tenant-browser.js`；RUN-009 |
| TASK-015 | 已完成 | `tests/agent-internal-project.test.js`、`agent_backend/tests/test_harness_governance.py`；RUN-008 |
| TASK-016 | 已完成 | `tests/vault-rotate.test.js`、`tests/harden-data-dir.test.js`；RUN-008 |
| TASK-017 | 已完成 | `tests/backup-auto.test.js`；RUN-008 |
| TASK-018 | 已完成 | `tests/quota-storage-concurrency.test.js`；RUN-008/009 |
| TASK-019 | 已完成 | `tests/audit-chain-export.test.js`；RUN-008 |
| TASK-020 | 已完成 | 4 个浏览器用例 + `npm run test:offline`；RUN-008/009 |
| TASK-021 | 已完成 | 02/03/04/09/11/16/18/19 更新 |
