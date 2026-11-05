# 04 数据与存储设计

- 文档状态：用户决定暂缓迁移（2026-11-05）；当前继续 SQLite，本节保留为功能完成后的迁移参考
- 版本：v1.0
- 更新时间：2026-11-05 01:16（UTC-06:00）
- 基线：BL-2026-11-05

## 1. 存储分层

| 层 | 内容 | 位置 | 规则 |
| --- | --- | --- | --- |
| 部署参数 | 端口、路径、并发、是否开放注册 | `data/config.json` / 环境变量 | 可留在文件；改错最多导致启动参数变化，不涉及权限 |
| 身份与业务状态 | 租户、用户、会话、项目、任务、事件、素材元数据 | SQLite（本轮 4 个库文件） | 必须入库；不再新增 JSON 状态 |
| 密钥 | 渠道 Key、AutoDL Key、LLM Key、执行端令牌 | `wmd.sqlite › secrets`（AES-256-GCM，按租户） | 主密钥在 `data/secret.key` 或 `WMD_SECRET_KEY`；与数据库分开存放 |
| 租户配置 | 渠道、AutoDL 元数据、提示词 | `wmd.sqlite › tenant_configs` | 每个租户一行；部署参数仍在 `config.json` |
| 文件 | 成片、参考图、上传、日志、备份 | 项目目录 / `data/` | 数据库只存路径与元数据，不存二进制 |

## 2.0 本轮新增表：`tenant_configs`（租户配置）

```sql
CREATE TABLE IF NOT EXISTS tenant_configs (
  tenant_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

`data` 的 JSON：`{ channels: {llm:[],image:[],video:[]}, autodlKeys: [], llm: {}, prompt: {} }`，**不含密钥**。
密钥按 `secrets(scope='tenant', tenant_id=<租户>, name=…)` 存。

规则：

- 默认租户第一次读取时继承旧版全局配置；其它租户从空配置开始。
- `config.json` 只保留 `port/concurrency/projectRoot/saveFolder/assetFolder/uploadFolder/voiceLibraryFolder/jianyingDraftRoot/signup/ui`。
- 非平台管理员提交部署参数会被服务端忽略；租户 owner/admin 可改本租户渠道、Key、提示词。
- 平台管理员在自己的租户里也只看到自己的配置；要配置其它租户，需以该租户用户身份登录。

## 2.1 本轮新增表：`secrets`（密钥库）

```sql
CREATE TABLE IF NOT EXISTS secrets (
  scope TEXT NOT NULL DEFAULT 'platform',
  tenant_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, tenant_id, name)
);
```

| 字段 | 类型 | 含义 | 约束 | 映射 |
| --- | --- | --- | --- | --- |
| `scope` | TEXT | `platform`（当前唯一） / 预留 `tenant` | NOT NULL | vault 内部 |
| `tenant_id` | TEXT | 租户级密钥的租户 | 默认空串 | 预留 |
| `name` | TEXT | `autodl:<id>`、`channel:<kind>:<id>:apiKey`、`channel:<kind>:<id>:executorToken`、`llm:apiKey` | 主键 | 配置对象字段 |
| `value_enc` | TEXT | `v1:<iv b64>:<tag b64>:<cipher b64>` | NOT NULL | — |
| `updated_at` | INTEGER | 最近写入（毫秒） | NOT NULL | — |

加密规则：

- AES-256-GCM，每次加密随机 12 字节 IV；认证标签与密文一起存。
- 主密钥来源优先级：`WMD_SECRET_KEY`（64 位 hex / 32 字节 base64 / 任意口令经 SHA-256）→ `data/secret.key`（首次生成 32 字节，权限 0600）。
- 主密钥与数据库**分开**：以后数据库换远程 MySQL/PG，主密钥仍留在应用服务器或环境变量里；**备份数据库时必须同时备份主密钥**，否则密文不可恢复。
- Windows 上 `0600` 只是尽力设置，实际保护依赖数据目录 ACL；部署时应把 `data/` 限制给运行账号。
- 解密失败直接抛错并阻止启动；不会把「读不到」当成「已清空」再写回，避免误删密钥。

`config.json` 的最终形态：

```json
{
  "channels": { "llm": [{ "id": "ch-1", "name": "主渠道", "baseUrl": "…", "model": "…" }] },
  "autodlKeys": [{ "id": "key-1", "name": "主 Key", "enabled": true }],
  "llm": { "baseUrl": "…", "model": "…" }
}
```

## 2.2 本轮新增表：`jobs`

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  order_no    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jobs_project ON jobs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_jobs_status  ON jobs(status);
```

字段说明：

| 字段 | 类型 | 含义 | 约束 | 映射 |
| --- | --- | --- | --- | --- |
| `id` | TEXT | 任务 ID（`job-…`） | 主键 | `job.id` |
| `project_id` | TEXT | 所属项目；空串表示未归档 | NOT NULL | `job.projectId` |
| `status` | TEXT | `queued/running/success/failed/canceled/interrupted/paused` | NOT NULL | `job.status` |
| `order_no` | INTEGER | 排队顺序 | 默认 0 | `job.order` |
| `created_at` | INTEGER | 创建时间（毫秒） | NOT NULL | `job.createdAt` |
| `updated_at` | INTEGER | 最近落盘时间（毫秒） | NOT NULL | 内部字段 |
| `data` | TEXT | 任务完整 JSON（含提示词、参数、输出、日志） | NOT NULL | 序列化后的 `job` |

设计理由：

- 任务对象字段随渠道插件变化频繁，整行 JSON 比上百列更稳；查询只按 `project_id/status/created_at/order_no`，全部有索引。
- 一次 `touch` 只 upsert 一行，避免 1.7 MB 全量重写；`jobs.json` 的读-改-写并发覆盖问题同时消失。
- 迁移器一次性导入旧 `jobs.json`，成功后改名为 `jobs.imported.json`。

## 2.3 本轮新增表：`image_history` / `event_trash`

```sql
-- wmd.sqlite：每租户最近 80 条图像生成历史
CREATE TABLE IF NOT EXISTS image_history (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tnt_default',
  project_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);

-- task-events.sqlite：每租户最近 100 条回收站任务
CREATE TABLE IF NOT EXISTS event_trash (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'tnt_default',
  removed_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
```

- `image_history.payload` 保留原条目形状；`tenant_id` 用于过滤与独立限额，`project_id` 便于以后按项目筛。
- `event_trash.payload` 是 `{event, removedAt, items}`；恢复时原样写回事件库。
- 旧文件首次读取/启动时导入默认租户，随后改名为 `*.imported.json`；失败保留原文件。

## 2.4 配额与审计表

```sql
-- wmd.sqlite：0 = 不限制
CREATE TABLE IF NOT EXISTS tenant_quotas (
  tenant_id TEXT PRIMARY KEY,
  max_users INTEGER NOT NULL DEFAULT 0,
  max_projects INTEGER NOT NULL DEFAULT 0,
  max_tasks_per_day INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- wmd.sqlite：每租户保留最近 5000 条
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at DESC);
```

`task-events.sqlite › task_events` 增加 `tenant_id` 列与 `(tenant_id, created_at)` 索引；老库启动时 `ALTER TABLE` 并按项目归属回填一次（标记 `tenant-backfill`）。每日任务配额按该列统计本地自然日内的事件数。

## 2.5 第二轮新增表：`user_prefs` / `access_codes`

```sql
-- wmd.sqlite：每用户界面偏好；只存显式改过的键
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- wmd.sqlite：一次性邀请/重置码，只存 sha256(code)
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

- 邀请默认 72 小时、重置默认 30 分钟；单次使用；明文只在创建响应里出现一次。
- 偏好上限 32 KB，拒绝 `__proto__`/`constructor`/`prototype` 键；删除用户时清理。

## 2.6 第二轮列变更

```sql
-- 老库用 PRAGMA table_info 检查后再 ALTER，可重复执行
ALTER TABLE tenant_quotas ADD COLUMN max_storage_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_quotas ADD COLUMN max_concurrent_tasks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ix_jobs_tenant_status ON jobs(tenant_id, status);
ALTER TABLE audit_log ADD COLUMN prev_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_log ADD COLUMN hash TEXT NOT NULL DEFAULT '';
```

- `jobs.tenant_id` 首次迁移时按 `data` 里的 `tenantId` 回填一次（标记 `jobs_tenant_backfill`），缺失的落默认租户。
- `audit_log` 老记录 `hash` 为空；校验从第一条非空记录开始，把它当作锚点。
- 自动备份目录 `data/backups/auto/`，每库保留最新 14 份、删除超过 30 天；不碰 `migration/` 与手工备份。
- 存储配额在 `jobs.addJobs`、`events.createFromJobInputs`、`imageTasks.enqueue` 三处检查；并发配额在 `jobs.addJobs` 与 `jobs.pump` 检查（图像任务不占视频并发）。

## 3. 既有表（本轮不改结构）

`wmd.sqlite`：`tenants`、`users`、`sessions`、`projects`、`executor_channels`、`asset_meta`、`file_aliases`、`media_episodes`、`jobs`、`tenant_configs`、`secrets`、`image_history`、`tenant_quotas`、`audit_log`、`user_prefs`、`access_codes`、`meta`。

`task-events.sqlite`：`task_events`（含 `tenant_id`）、`task_attempts`、`task_meta`、`event_trash`。

`studio.db`：`workbench_items`、`workbench_selection`、`generation_runs`、`media_records`、`media_locations`、`image_tasks`、`generation_logs`、`studio_state`、`migration_log`。

## 4. 迁移与回滚（本轮）

### 4.3 租户配置迁移

| 项 | 做法 |
| --- | --- |
| 触发 | 默认租户第一次 `config.load()` 时 |
| 备份 | `config.json` 复制为 `config.json.bak-<时间戳>` |
| 执行 | 读取旧文件里的 `channels/autodlKeys/llm/prompt` → 写入 `tenant_configs(tnt_default)`；把 `scope='platform'` 的密钥搬到 `scope='tenant', tenant_id='tnt_default'` |
| 清理 | `config.json` 改写为只含部署参数 |
| 其它租户 | 不继承；第一次读取时生成空配置行 |
| 回滚 | 停服 → 用 `wmd.before-tenant-*.sqlite` 和 `config.json.bak-*` 恢复 → 回退代码 |

### 4.4 密钥迁移

| 项 | 做法 |
| --- | --- |
| 触发 | 每次 `config.load()` 时检测 `config.json` 是否仍有明文密钥 |
| 备份 | 改写前复制为 `config.json.bak-<时间戳>` |
| 执行 | 收集 `autodl:<id>`、`channel:<kind>:<id>:apiKey`、`channel:<kind>:<id>:executorToken`、`llm:apiKey`，AES-GCM 加密写入 `secrets` |
| 校验 | 写入后从库读回并注入内存配置；`config.json` 不再含任何密钥值 |
| 失败 | 主密钥错误/密文损坏时启动失败，日志给出「无法解密」；不会清空库里的密钥 |
| 回滚 | 停服 → 把 `config.json.bak-*` 改回 `config.json` → 回退代码；`secrets` 表可保留 |

### 4.6 图片历史/回收站迁移

| 项 | 做法 |
| --- | --- |
| 触发 | 图片历史：首次 `list/remember`；回收站：`event-store.open()` |
| 备份 | 迁移前人工快照 `wmd.before-history-*.sqlite`，并复制两个 JSON 为 `.before-import-*` |
| 执行 | 单事务导入默认租户，行数/内容按原样；成功后原文件改名 `*.imported.json` |
| 校验 | 本机 80 条历史、4 条回收站导入；`/api/images/history`、`/api/events/trash` 条数一致 |
| 回滚 | 停服 → 用快照恢复数据库 → 把 `*.imported.json` 改回原名 → 回退代码 |

### 4.7 租户配额/审计迁移

| 项 | 做法 |
| --- | --- |
| 触发 | 服务启动建表；`task_events` 首次打开时补列并回填 |
| 备份 | 迁移前 `VACUUM INTO` 快照 `wmd-before-quota-*.sqlite`、`events-before-quota-*.sqlite` |
| 执行 | 建 `tenant_quotas`/`audit_log`；`ALTER TABLE task_events ADD tenant_id`；按 `projects.tenant_id` 回填，未归属落默认租户 |
| 校验 | 本机 198 条事件全部回填为 `tnt_default`；配额/审计表为空即默认不限/无记录 |
| 回滚 | 恢复快照并回退代码；新表随快照一起回滚 |

### 4.8 任务迁移

| 项 | 做法 |
| --- | --- |
| 触发 | `jobs.loadState()` 首次运行时 |
| 前置检查 | `meta.jobs_import` 不存在；`jobs` 表为空/无冲突行 |
| 备份 | 导入前把 `jobs.json` 复制为 `jobs.json.bak-<时间戳>` |
| 执行 | 单事务批量 insert（`INSERT OR IGNORE` 在适配器内使用） |
| 校验 | 导入后 `SELECT COUNT(*)` 与 `jobs.json.jobs.length` 比较；不一致则回滚并保留原文件 |
| 失败 | 回滚事务，保留 `jobs.json`，记录 `process.log`，服务继续用空队列（不自动重试覆盖） |
| 回滚方案 | 停服 → 删除 `jobs` 表数据 → 把 `jobs.imported.json` 改回 `jobs.json` → 回退代码 |
| 不可逆点 | 导入成功后旧文件改名；回滚需要手工改名（文档已写） |

## 5. MySQL/PG 迁移盘点（REQ-008，暂缓，后期参考）

### 5.1 调用点清单

| 模块 | `.prepare` 数 | 同步依赖 | 迁移顺序 |
| --- | --- | --- | --- |
| `auth.js` | 23 | 路由内调用 | 1（与 `tenants/projects` 一起） |
| `tenants.js` | 13 | 路由内调用 | 1 |
| `projects.js` | 7 | 路由 + `jobs.jobProjectRoot` 等同步路径 | 1（先消除同步调用者） |
| `executor-channel.js` | 7 | 路由内调用 | 1 |
| `file-aliases.js` / `media-episodes.js` | 7 | 路由 + 文件解析 | 2 |
| `event-store.js` | 14 | `events.js` 同步 API | 3（需先改 `events.js` 为 async） |
| `workbench-store.js` | 28 | 任务执行路径同步调用 | 4（与 `jobs.js` 一起） |
| `image-tasks.js` | 24 | 任务泵同步调用 | 4 |
| `studio-store.js` | 2 | 路由内调用 | 1 |

### 5.2 方言差异清单

| 写法 | SQLite | MySQL | PostgreSQL | 处理 |
| --- | --- | --- | --- | --- |
| 占位符 | `?` | `?` | `$1` | 适配器转换 |
| upsert | `ON CONFLICT … DO UPDATE` | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT … DO UPDATE` | 适配器生成 |
| 忽略重复 | `INSERT OR IGNORE` | `INSERT IGNORE` | `ON CONFLICT DO NOTHING` | 适配器生成 |
| JSON 提取 | `json_extract(x,'$.k')` | `JSON_EXTRACT` | `x::jsonb->>'k'` | 目标表改为显式列，避免运行时 JSON 查询 |
| 行号排序 | `rowid` | 无 | 无 | 增加 `seq INTEGER` 自增列 |
| 模糊匹配大小写 | `COLLATE NOCASE` | 默认不区分 | `ILIKE` | 适配器提供 |
| 建表/迁移 | `PRAGMA` | `information_schema` | `information_schema` | 迁移器按方言执行 |
| 备份 | `VACUUM INTO` | `mysqldump` | `pg_dump` | 运维脚本 |

### 5.3 异步化改造顺序（需单独审批）

1. 建 `src/store` 端口与 SQLite 适配器，补契约测试（同一套测试可跑三方言）。
2. 改造 `auth/tenants/projects` 及所有调用点到 `async`；路由本来就是 async，成本集中在 `jobs.jobProjectRoot`、`file-aliases.searchRoots` 等同步工具函数。
3. 改造 `events/event-store`，调度器 `tick()` 改 async。
4. 改造 `workbench-store/image-tasks/jobs`，任务泵改 async。
5. 提供 MySQL/PG 迁移脚本、双写/停机迁移方案与回滚演练。
6. 只有在有实例、完成备份恢复演练后，才切换 `WMD_DB_DRIVER`。

> 结论：**现在不能直接换库**。同步 API 是硬阻塞，且 `events.js`/`jobs.js` 的运行时模型依赖同步读写；必须先完成端口与异步化，再谈连接远程数据库。

## 6. 备份与恢复

- `wmd.sqlite`、`task-events.sqlite`、`studio.db` 运行中不得直接复制主文件；使用 SQLite Backup API 或 `VACUUM INTO` 生成快照。
- 本轮新增 `jobs` 表随 `wmd.sqlite` 一起备份。
- 恢复演练在隔离目录进行，核对 `tenants/users/projects/jobs` 行数与抽样内容后才可替换。
