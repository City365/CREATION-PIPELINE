# 02 需求与追踪矩阵

- 文档状态：基线已确认，按轮次实施
- 版本：v1.0
- 更新时间：2026-11-05 01:16（UTC-06:00）
- 基线：BL-2026-11-05

## 1. 需求条目

### REQ-001 进程稳定性（Must）

- 来源：INC-001、用户「本地都没弄好」。
- 业务结果：创作台进程异常时，必须留下可定位的证据；未处理 Promise 不得让进程静默退出。
- 验收条件：
  - Given 进程收到未处理的 Promise 拒绝，When 发生，Then 写入 `data/logs/process.log` 且进程继续服务，`/api/health` 仍为 200。
  - Given 进程收到未捕获异常，When 发生，Then 写入 `process.log`（含堆栈）后退出，启动器可重启。
  - Given 进程正常/异常退出，Then `process.log` 记录 pid、退出码、信号、时间。
  - Given 任一测试运行，Then 不出现无日志的 `code=1`。

### REQ-002 任务状态持久化（Must）

- 来源：`docs/storage-review.md` 第六节第 2 项；GAP-02。
- 业务结果：任务状态按行写入 `data/wmd.sqlite`，重启后可恢复；不再全量重写 `jobs.json`。
- 验收条件：
  - Given 已有 `jobs.json`，When 首次启动新版本，Then 任务导入 `jobs` 表，原文件改名 `jobs.imported.json`，列表数量一致。
  - Given 任务运行中每秒多次 `touch`，Then 单次落盘只写变更行，不再出现 1.7 MB 全量写。
  - Given 服务重启，Then 运行中任务标记为「已中断（待对账）」，与旧行为一致。
  - Given 删除任务，Then `jobs` 表对应行删除；列表不再出现。

### REQ-003 密钥保护（Must）

- 来源：GAP-03。
- 业务结果：`/api/state`、`/api/config`、`/api/channels` 的响应只包含 `hasKey` 与 `masked`，不包含完整 Key。
- 验收条件：
  - Given 已配置任一渠道 Key，When 任意登录用户请求上述接口，Then 响应体中不出现该 Key 的完整值。
  - Given 用户在设置页不修改 Key 直接保存，Then 原 Key 保持不变。
  - Given 用户显式清空 Key（`clearKey=true`），Then Key 被清空。

### REQ-004 执行端幂等（Must）

- 来源：GAP-04。
- 业务结果：已超时的命令不得在之后被下发或执行。
- 验收条件：
  - Given 一条命令超过 `timeoutMs` 未回结果，Then 它从队列移除，后续轮询不再返回它。
  - Given 管理器收到 `expiresAt` 已过的命令，Then 不执行本地请求，直接回一条过期错误。
  - Given 迟到的结果，Then 被忽略且不改变任何业务状态。

### REQ-005 删除完整性（Must）

- 来源：GAP-05。
- 业务结果：删除租户/用户时不允许产生孤儿数据。
- 验收条件：
  - Given 租户下仍有项目，When 删除租户，Then 返回 400 并说明原因，数据不变。
  - Given 用户仍拥有项目，When 删除用户，Then 返回 400 并说明原因，用户与会话不变。
  - Given 用户没有项目，When 删除用户，Then 用户与会话删除成功。

### REQ-006 配置密钥入库（Must，本轮已完成）

- 来源：`config.json` 明文密钥；GAP-07。
- 业务结果：渠道 Key、AutoDL Key、LLM Key、执行端令牌加密存 SQLite；`config.json` 只保留部署参数与 id/名称。
- 验收条件：
  - Given 旧配置含明文密钥，When 首次启动新版本，Then 密钥写入 `secrets` 表，`config.json` 改写为无密钥版本并留备份。
  - Given 读取 `config.json`、`wmd.sqlite`、`wmd.sqlite-wal`，Then 找不到任何明文密钥。
  - Given 另一个进程使用同一 `data/secret.key`，Then 能解密并使用密钥。
  - Given 主密钥缺失或不匹配，Then 启动直接失败并给出明确错误，不静默清空密钥。
  - Given 删除渠道/Key，Then 对应密文从 `secrets` 表删除。
- 结果：PASS（TC-016..020 / RUN-002）。租户级配置隔离仍未做，见 DEC-003。

### REQ-007 图片历史/回收站入库（Should，本轮已完成）

- 来源：GAP-08。
- 业务结果：`image-history.json` 与 `events-trash.json` 迁入 SQLite，按租户隔离，各租户独立保留上限。
- 验收条件：
  - Given 旧 `image-history.json`，When 首次读取历史，Then 导入默认租户（80 条），原文件改名 `*.imported.json`。
  - Given 两个租户各生成图片，Then 历史互不可见；一个租户超过 80 条不影响另一个。
  - Given 旧 `events-trash.json`，When 服务启动，Then 导入默认租户（4 条），原文件改名。
  - Given 两个租户删除任务，Then 回收站互不可见；每租户独立保留 100 条。
  - Given 回收站恢复，Then 任务重新出现在列表，回收站移除。
- 结果：PASS（TC-029..032 / RUN-004）。

### REQ-011 租户配额与审计（Must，本轮已完成）

- 来源：多租户评审「用量与审计」；平台运营需要限制资源并追溯操作。
- 配额：每租户 `maxUsers`、`maxProjects`、`maxTasksPerDay`；0 表示不限制。创建用户/项目/任务事件时校验，超限返回 429 和明确原因。
- 审计：登录成功/失败、注册、用户/租户/项目/配置/渠道变更、事件删除；只记安全摘要，不记密码、密钥或正文；按租户隔离，平台管理员可看全部。
- 验收条件：
  - Given 租户配额为 2 个用户，When 创建第 3 个，Then 429，租户成员数不变。
  - Given 项目/每日任务配额已满，When 再创建，Then 429。
  - Given 成员角色，When 改配额或看审计，Then 403；改渠道/租户配置也被拒绝。
  - Given 登录成功/失败与各类变更，Then 审计有对应动作；密码和密钥不出现在日志里。
  - Given 两个租户，Then 各自只看到本租户审计；平台管理员能看到全部。
- 结果：PASS（TC-035/036 / RUN-007）。

### REQ-008 数据库可迁移（Must，跨阶段；2026-11-05 用户决定暂缓）

- 数据访问统一走可切换端口；SQL 只用三种引擎都支持的子集或由方言适配器翻译；提供 MySQL/PG 迁移与回滚方案。
- 验收（本轮只到设计）：
  - 输出调用点清单、方言差异清单、异步化改造顺序。
  - 提供 SQLite 端口的契约测试，MySQL/PG 适配器在具备实例后跑同一套测试。
- 暂缓（用户决定）：2026-11-05 用户明确「先不要迁移，就使用 SQLite，后期功能全部开发完成后再对接改造，不着急」。本项不是阻塞，继续保留 04 §5 的盘点、方言差异与异步化顺序，后期再实施。

### REQ-009 调试产物清理（Should，本轮已完成）

- `data/` 根目录的截图、日志、临时脚本、证据 JSON、旧 config 备份、迁移副本、调试目录统一移入 `data/debug/`，不删除。
- 验收条件：
  - Given 根目录存在调试产物，When 运行 `node scripts/clean-debug.js --apply`，Then 按白名单移入 `data/debug/<分类>/` 并写 manifest。
  - Given 数据库、迁移存档（`*.imported.json`）、业务目录、运行状态文件，Then 留在原位。
  - Given 迁移快照 `wmd.before-*.sqlite`，Then 移到 `data/backups/migration/`，不混入 debug。
- 结果：PASS（TC-033/034 / RUN-005/006）。本机先移动 164 项/约 111MB 到 `data/debug` 并删除；再清理 `data/backups` 旧备份 3 项/约 1.88GB（2 个 10 月 26 日工作区备份 + 1 个 10 月 29 日恢复备份），保留今天的 2 个迁移快照和最新数据库备份。`data/backups` 从约 1.8GB 降到 11MB；服务与数据验证正常。
- 遗留：无（`data/backups/migration/` 与最新 `.db` 备份保留）。

### REQ-010 租户级配置隔离（Must，本轮已完成）

- 来源：多租户要求「租户 → 用户 → 项目三层，数据不能串」；GAP-06。
- 业务结果：渠道、AutoDL Key、LLM 渠道、提示词按租户独立；部署参数（端口、路径、并发、注册开关）平台共享。
- 验收条件：
  - Given 租户 A 建了渠道与 Key，When 租户 B 请求渠道列表/状态/按 id 生成，Then 看不到也用不了。
  - Given 管理员在自己的租户，Then 只能看到自己租户的渠道，不自动拥有其它租户的配置。
  - Given 租户 A 修改提示词或渠道，Then 租户 B 的配置不变。
  - Given 非平台管理员提交部署参数，Then 参数不生效。
  - Given 任务/图像任务在后台执行，Then 使用创建时所属租户的渠道，即使泵在没有请求上下文的定时器里运行。
  - Given 旧版本全局配置，When 首次启动，Then 迁移到默认租户，其它租户从空配置开始。
- 结果：PASS（TC-021..027 / RUN-003）。

### REQ-012 每用户界面偏好（Should，第二轮已完成）

- 来源：多租户评审「`ui` 仍平台共享」。
- 业务结果：主题、壁纸、字号、音量按用户保存，平台 `config.json.ui` 只作默认值。
- 验收条件：
  - Given 用户 A 改主题，When 用户 B 登录，Then B 仍看到默认主题。
  - Given A 退出重登或服务重启，Then A 的偏好仍在。
  - Given A 改主题，Then `config.json` 的默认值不变。
  - Given 尚未注册账号的本机，Then 界面设置仍可保存为平台默认值。
- 结果：PASS（TC-037..039 / RUN-008）。

### REQ-013 多执行端令牌（Must，第二轮已完成）

- 来源：多租户评审「执行端只能一对一，多台机器需要多条令牌」。
- 业务结果：同一用户可同时配对多台管理器，逐条撤销；不再“生成一条顶掉旧的”。
- 验收条件：
  - Given 同一用户连续生成两条令牌，Then 两条都能长轮询。
  - Given 撤销其中一条，Then 另一条仍可用；状态接口不返回完整令牌。
  - Given 用户 B，When 撤销用户 A 的令牌，Then 404。
  - Given 设置页执行端，Then 列出多条令牌、在线状态与撤销按钮。
- 结果：PASS（TC-040..042 / RUN-008）。

### REQ-014 邀请与密码重置（Must，第二轮已完成）

- 来源：多租户评审「邀请待补、忘记密码只能管理员重置」。
- 业务结果：管理员生成一次性邀请/重置链接；接受邀请创建指定租户/角色的账号；重置密码使旧会话失效。
- 验收条件：
  - Given 邀请码，When 在有效期内接受，Then 账号落在指定租户与角色，受用户数配额限制。
  - Given 邀请码过期或已使用，Then 400。
  - Given 重置码，When 设置新密码，Then 旧会话立即失效，新密码可登录。
  - Given 成员角色，Then 不能生成邀请/重置码。
  - Given 审计，Then 有 `invite.create`/`invite.accept`/`user.reset.token`/`auth.password.reset`，不含密码或验证码。
- 结果：PASS（TC-043..045 / RUN-008）。

### REQ-015 跨租户配额管理（Must，第二轮已完成）

- 来源：设置页只能改当前租户。
- 业务结果：平台管理员在设置页切换租户并查看/修改其配额；其它角色只能看本租户。
- 验收条件：
  - Given 管理员选择租户 B，Then 看到 B 的用量并可保存 B 的配额，当前租户不变。
  - Given 租户 owner，Then 看不到租户选择，也不能写其它租户（403）。
- 结果：PASS（TC-046 / RUN-009）。

### REQ-016 智能体鉴权收紧（Must，第二轮已完成）

- 来源：安全评审 `HARNESS_AUTH_MODE=development` 默认放行；controller 模式只校验默认租户项目。
- 业务结果：智能体默认向创作台复核项目归属；内部接口能校验任意租户项目；健康检查不被项目归属卡住。
- 验收条件：
  - Given controller 模式与不存在的项目，Then 业务接口 403。
  - Given 任意租户的真实项目，Then 内部项目接口 200 并返回 `tenantId`。
  - Given 没有内部凭据的普通请求，Then 401/403。
  - Given 启动器，Then 默认以 controller 启动，`/agent/health` 正常。
- 结果：PASS（TC-047..049 / RUN-008）。

### REQ-017 密钥轮换与目录加固（Must，第二轮已完成）

- 来源：多租户/安全评审「换 `secret.key` 需要重加密」「Windows 数据目录没有加固」。
- 业务结果：提供在线可回滚的主密钥轮换；提供 Windows ACL 加固脚本（默认 dry-run）。
- 验收条件：
  - Given 多条密钥，When 轮换，Then 全部可用新密钥解密，旧密钥备份保留。
  - Given 任一密文损坏，Then 轮换中止，原库与原密钥不变。
  - Given 事务提交后进程中断，Then 下次启动 `recover()` 收尾。
  - Given `WMD_SECRET_KEY` 生效，Then 文件轮换被拒绝并提示改用环境变量。
  - Given ACL 脚本默认运行，Then 只打印命令，不改权限；`--apply` 才执行。
- 结果：PASS（TC-050..053 / RUN-008）。

### REQ-018 自动备份与保留（Should，第二轮已完成）

- 来源：安全/运维评审「只有手工备份脚本」。
- 业务结果：每天自动对三个 SQLite 库做 `VACUUM INTO` 快照，按保留策略清理，不影响业务。
- 验收条件：
  - Given 三个库，Then 生成三份可打开的快照。
  - Given 自动备份目录，Then 每库保留最新 14 份、删除超过 30 天；不碰 `migration/` 与手工备份。
  - Given 距上次自动备份不足 24 小时，Then 跳过；`force` 可强制执行。
  - Given 定时器，Then `unref()`，不阻止进程退出；失败不影响服务。
- 结果：PASS（TC-054..056 / RUN-008）。

### REQ-019 配额增强（Should，第二轮已完成）

- 来源：配额评审「只有用户/项目/每日任务」。
- 业务结果：新增存储空间与并发任务配额；0 表示不限。
- 验收条件：
  - Given 并发上限 1 且已有运行任务，Then 新任务 429；任务完成后恢复。
  - Given 存储超限，Then 新任务/事件/图像任务 429；清理文件后恢复。
  - Given 两个租户，Then 用量互不影响；管理员可查看任意租户。
  - Given UI，Then 显示存储与并发用量，并可保存。
- 结果：PASS（TC-057..059 / RUN-008/009）。

### REQ-020 审计导出与防篡改（Should，第二轮已完成）

- 来源：审计评审「只能看、不能导出、应用层可改」。
- 业务结果：审计记录带按租户哈希链；支持 CSV/JSON 导出；篡改可检出。
- 验收条件：
  - Given 正常记录，Then `/api/audit` 的 `integrity.ok=true`。
  - Given 直接改库中一条记录，Then `integrity.ok=false` 并指出断裂记录。
  - Given 导出，Then CSV 带 UTF-8 BOM、JSON 含完整性结果；成员 403。
  - Given 平台管理员，Then 可导出任意租户。
- 结果：PASS（TC-060..062 / RUN-008）。

### REQ-021 浏览器用例与离线全量回归（Must，第二轮已完成）

- 来源：第一轮「全量 npm test 含付费 e2e」「最近生成无浏览器用例」。
- 业务结果：新增「最近生成」、多令牌、用户偏好、跨租户配额浏览器用例；提供排除付费 e2e 的离线全量回归命令。
- 验收条件：
  - Given `npm run test:offline`，Then 除付费 e2e 外的全部 Node 用例串行通过。
  - Given 四个新浏览器用例，Then 全部 PASS。
  - Given 「最近生成」，Then 能打开弹窗并显示历史条目。
- 结果：PASS（RUN-008/009）。

## 2. 需求追踪矩阵

| REQ | Must | DATA | PAGE | API | FLOW | TASK | TC | RUN/EV | UAT | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-001 | 是 | — | — | /api/health | 进程启动/退出 | TASK-001 | TC-001..003 | RUN-001 | UAT-001 | 已验证 |
| REQ-002 | 是 | `jobs` 表 | 任务列表/详情 | /api/jobs* | 任务生命周期 | TASK-002 | TC-004..007 | RUN-001 | UAT-002 | 已验证 |
| REQ-003 | 是 | `channels`/config | 设置-渠道 | /api/state /api/config /api/channels | 渠道编辑 | TASK-003 | TC-008..010 | RUN-001 | UAT-003 | 已验证 |
| REQ-004 | 是 | — | — | /api/executor/* | 外联下发/回传 | TASK-004 | TC-011..012 | RUN-001 | UAT-004 | 已验证 |
| REQ-005 | 是 | tenants/users/projects | 团队/租户 | /api/tenants /api/users | 删除 | TASK-005 | TC-013..014 | RUN-001 | UAT-005 | 已验证 |
| REQ-006 | 是 | `secrets` 表 | 设置 | /api/config /api/channels | 配置保存 | TASK-006 | TC-016..020 | RUN-002 | UAT-009 | 已验证 |
| REQ-007 | 否 | `image_history`/`event_trash` | 最近生成/回收站 | /api/images/history /api/events/trash | 历史读取、删除恢复 | TASK-008 | TC-029..032 | RUN-004 | UAT-011 | 已验证 |
| REQ-008 | 是 | 全部 | — | 全部 | 数据访问 | — | — | — | — | 暂缓（用户决定，功能完成后再迁移） |
| REQ-009 | 否 | `data/debug/`、`data/backups/` | — | — | 清理脚本 | TASK-009 | TC-033..034 | RUN-005/006 | UAT-012/013 | 已验证 |
| REQ-010 | 是 | `tenant_configs`/`secrets` | 设置/存储目录 | /api/config /api/channels /api/state | 渠道与任务执行 | TASK-007 | TC-021..028 | RUN-003 | UAT-010 | 已验证 |
| REQ-011 | 是 | `tenant_quotas`/`audit_log` | 租户成员/审计 | /api/tenants/:id/quota /api/audit | 创建与审计 | TASK-010 | TC-035..036 | RUN-007 | UAT-014/015 | 已验证 |
| REQ-012 | 否 | `user_prefs` | 外观 | /api/state /api/config | 界面设置 | TASK-011 | TC-037..039 | RUN-008 | UAT-016 | 已验证 |
| REQ-013 | 是 | `executor_channels` | 执行端 | /api/executor/* | 多机配对 | TASK-012 | TC-040..042 | RUN-008 | UAT-017 | 已验证 |
| REQ-014 | 是 | `access_codes` | 租户成员/登录 | /api/invites /api/users/:id/reset-token /api/auth/* | 邀请/重置 | TASK-013 | TC-043..045 | RUN-008 | UAT-018 | 已验证 |
| REQ-015 | 是 | `tenant_quotas` | 租户成员 | /api/tenants/:id/quota | 配额管理 | TASK-014 | TC-046 | RUN-009 | UAT-019 | 已验证 |
| REQ-016 | 是 | — | — | /api/internal/projects/:id /agent/* | 智能体鉴权 | TASK-015 | TC-047..049 | RUN-008 | UAT-020 | 已验证 |
| REQ-017 | 是 | `secrets` | — | — | 密钥轮换/ACL | TASK-016 | TC-050..053 | RUN-008 | UAT-021 | 已验证 |
| REQ-018 | 否 | backup 目录 | — | — | 自动备份 | TASK-017 | TC-054..056 | RUN-008 | UAT-022 | 已验证 |
| REQ-019 | 否 | `tenant_quotas`/`jobs.tenant_id` | 租户成员 | /api/tenants/:id/quota | 配额校验 | TASK-018 | TC-057..059 | RUN-008/009 | UAT-023 | 已验证 |
| REQ-020 | 否 | `audit_log` | 审计 | /api/audit /api/audit/export | 审计校验/导出 | TASK-019 | TC-060..062 | RUN-008 | UAT-024 | 已验证 |
| REQ-021 | 是 | — | 最近生成/执行端/外观/租户成员 | — | 回归 | TASK-020 | TC-063 | RUN-008/009 | UAT-025/026 | 已验证 |

## 3. 非功能目标（本轮可验证部分）

| 目标 | 口径 | 测量方法 |
| --- | --- | --- |
| 落盘不阻塞 | 单次任务状态更新落盘 < 20 ms（1 万任务以内） | 在 `flushDirty` 前后打点，记录 p95 |
| 崩溃可定位 | 每次非 0 退出都有 `process.log` 记录 | 人为制造未处理拒绝/异常 |
| 不泄露密钥 | 响应体中完整 Key 出现次数 = 0 | 真实 HTTP 请求 + 字符串断言 |
| 回归 | 受影响测试全部 PASS | `node --test` 指定文件 |
