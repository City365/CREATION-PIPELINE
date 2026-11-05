# 03 架构与运行时链路

- 文档状态：完成
- 版本：v1.0
- 更新时间：2026-11-05 01:16（UTC-06:00）
- 基线：BL-2026-11-05

## 1. 系统边界

```
浏览器（创作台 UI）
   │ HTTP / SSE
   ▼
Creation-Studio（Node 25，17821）──HTTP──► agent_backend（FastAPI，17820）
   │  │
   │  └──长轮询/回传──► Video-Generation-Manager（每用户本机，17778）
   │                         └── CDP ──► 豆包桌面客户端
   ▼
data/（SQLite 文件 + 媒体文件）
```

- 创作台是唯一的多租户服务端；管理器是每用户安装的独立应用，**不进入租户体系**。
- 管理器通过外联通道主动连创作台，因此共享部署不需要访问用户内网。
- 智能体只做创作辅助，不持有租户身份；创作台在代理时注入并校验 `X-Project-Id`。

## 2. 模块职责

| 模块 | 职责 | 数据 |
| --- | --- | --- |
| `server.js` | 121 个路由、认证、租户上下文、静态资源、代理 | 汇总各模块 |
| `auth.js` / `tenants.js` / `projects.js` | 身份、租户、项目 | `wmd.sqlite` |
| `events.js` + `event-store.js` | 任务事件、调度、回收站 | `task-events.sqlite`、`events-trash.json` |
| `jobs.js` | 视频任务队列与执行状态 | **`jobs.json`（本轮改为 `wmd.sqlite › jobs`）** |
| `workbench-store.js` | 分镜、生成记录、媒体定位 | `studio.db` |
| `image-tasks.js` | 图像任务队列 | `studio.db` |
| `library.js` / `file-aliases.js` / `media-episodes.js` | 素材、别名、分集 | 文件系统 + `wmd.sqlite` |
| `executor-channel.js` | 外联通道令牌、命令队列、长轮询 | `wmd.sqlite › executor_channels` + 内存队列 |
| `config.js` | 部署参数、渠道与密钥 | `config.json`（本轮只做响应脱敏） |
| `user-prefs.js` | 每用户界面偏好（主题/壁纸/字号/音量） | `wmd.sqlite › user_prefs` |
| `access-codes.js` | 一次性邀请码/密码重置码（只存哈希） | `wmd.sqlite › access_codes` |
| `backup.js` | 三库自动快照与保留策略 | `data/backups/auto/` |
| `vault.js` | AES-256-GCM 密钥库与主密钥轮换 | `wmd.sqlite › secrets` + `data/secret.key` |

## 3. 当前与目标数据访问

**当前**：各模块直接持有 `DatabaseSync`，在调用点拼 SQL；同步、方言耦合。

**目标（分阶段）**：

```
业务模块（async）
   │  query/one/run/tx（Promise）
   ▼
数据访问端口 src/store/index.js
   ├── sqlite 适配器（node:sqlite，Promise 包装）   ← 现在
   ├── mysql 适配器（mysql2/promise）                ← 有实例后
   └── pg 适配器（pg）                               ← 有实例后
   │
   └── 迁移文件按方言与版本执行
```

> 当前决定（2026-11-05）：继续使用 SQLite；远程 MySQL/PG 迁移暂缓，等功能全部开发完成后再按 04 §5 评估。

迁移硬约束（来自 SRC-001/002）：

1. 远程驱动只有异步 API，**数据访问必须异步化**；同步调用点是迁移的主要成本。
2. SQL 只使用三引擎共同子集：`TEXT/INTEGER`、`?` 占位符（适配器转换 `$n`）、显式 `ORDER BY`、`LIMIT ? OFFSET ?`。
3. `INSERT OR REPLACE`、`INSERT OR IGNORE`、`ON CONFLICT`、`json_extract`、`rowid`、`PRAGMA`、`VACUUM INTO` 只允许出现在适配器内部。
4. 时间统一存毫秒整数；布尔存 `INTEGER 0/1`；JSON 存 `TEXT`。
5. 事务边界由 `tx(fn)` 提供；MySQL/PG 使用连接级事务。

本轮不实施该端口，只交付设计、调用点清单与方言清单（见 [04-data-storage.md](04-data-storage.md) §5）。

## 3.1 租户配置隔离（本轮新增）

```
HTTP 请求
  └─ route() → tenantContext.run('', handle)
       └─ 认证 → tenantContext.enter(tenantId)
            └─ 业务代码 config.load() / channels.*
                 └─ 按 tenantId 返回该租户配置

后台任务（jobs / events / image-tasks / startup probe）
  └─ tenantContext.run(job.tenantId || project.tenantId, ...)
       └─ 同上
```

- 配置分两层：`config.json` 只放部署参数；`wmd.sqlite › tenant_configs` 按租户放渠道/AutoDL 元数据/提示词；`secrets` 按 `(tenant, tenant_id)` 加密放密钥。
- `config.load()` 按 `AsyncLocalStorage` 中的当前租户取配置；没有上下文（启动、脚本）落到默认租户。
- 任务、事件、图像任务在创建时记录 `tenantId`，后台执行优先用它，旧数据回落到项目归属。
- 请求入口用 `tenantContext.run('', ...)` 给每个请求独立上下文，避免 keep-alive 连接串租户。

## 3.2 每用户界面偏好（第二轮新增）

- `config.json › ui` 仍是平台默认值；登录用户保存 `ui` 时写 `wmd.sqlite › user_prefs`，读取时覆盖默认值。
- `/api/state`、`/api/config` 返回合并后的 `ui`；未登录（本机尚未注册）仍写平台默认值。
- 删除用户时一并清理偏好；不做迁移，已有 `config.json.ui` 继续作为默认值。

## 3.3 智能体鉴权（第二轮收紧）

- `launch.js`、`controlService`、`start-agent.cmd`、`agent_backend/start.sh` 默认 `HARNESS_AUTH_MODE=controller`。
- `identity.py` 调 `GET /api/internal/projects/:id`（仅本机 + `X-WMD-Internal`），返回 `{id,tenantId}`；不按当前租户过滤，租户隔离由创作台代理层完成。
- `/agent/health` 不依赖项目鉴权，只返回模型/能力信息；其它 `/agent/*` 仍鉴权。
- 本机开发可显式设 `HARNESS_AUTH_MODE=development`，测试夹具默认 development。

## 3.4 备份、配额与审计（第二轮新增）

- 备份：`backup.js` 每 24 小时对 `wmd.sqlite`、`task-events.sqlite`、`studio.db` 做 `VACUUM INTO`，每库保留最新 14 份、删除超过 30 天的自动快照；定时器 `unref()`。
- 配额：`tenant_quotas` 增加 `max_storage_bytes`、`max_concurrent_tasks`；`jobs` 增加 `tenant_id` 并回填；存储按租户目录求和（60 秒缓存），并发按 `jobs.status='running'` 计数；`jobs.pump` 兜底。
- 审计：`audit_log` 增加 `prev_hash`/`hash`，每租户一条哈希链；`/api/audit` 返回 `integrity`，`/api/audit/export` 导出 CSV/JSON；清理保留最近 5000 条，链校验以当前最早一条为锚点。

## 4. 运行时链路（合并 07）

### 4.1 视频任务

1. 页面提交 → `/api/jobs` → `jobs.addJobs()` 创建内存任务并写工作台 run。
2. `pump()` 按顺序找空闲槽位 → 插件适配器执行（管理器/AutoDL/RunningHub）。
3. 适配器通过 `touch()`/`log()` 更新进度；本轮改为「标脏 + 200 ms 批量 upsert 单行」。
4. 完成/失败 → `flushState()` 同步工作台终态并落盘。
5. 重启：`loadState()` 把 `running` 与「已提交远端但未回」的 `queued` 标记为 `interrupted`，等待对账。

### 4.2 外联通道

1. 管理器 `GET /api/executor/poll?token=&wait=25` 长轮询。
2. 创作台把命令压入该令牌队列，唤醒轮询；命令带 `id` 与 `expiresAt`。
3. 管理器执行本地 `/api/*`，小结果内联、大结果 POST `/api/executor/blob`。
4. 创作台 `settle()` 按 `id` 唤醒等待者；超时命令从队列移除，迟到结果丢弃。

### 4.3 异常与恢复

| 场景 | 行为 |
| --- | --- |
| 未处理 Promise 拒绝 | 写 `process.log`，继续运行 |
| 未捕获异常 | 写 `process.log`，落盘任务，退出 1，启动器重启 |
| 数据库忙 | SQLite `busy_timeout`，失败返回明确错误 |
| 执行端超时 | 命令移除，调用方收到失败；迟到结果忽略 |
| 进程重启 | 运行中任务标 `interrupted`，不自动重发 |

## 5. 架构决策

- DEC-001：现在**不换库**，先修本地正确性；理由见 11。
- DEC-002：数据访问端口与异步化作为独立阶段，避免在稳定性修复中同时引入大范围并发改造。
- DEC-003：任务状态按行入库，保留内存工作集，避免把热路径整体改成异步。
- DEC-004：密钥先做「不出现在响应」，再做「加密入库 + 租户隔离」。
