# 01 调研：现状、证据与缺口

- 文档状态：完成
- 版本：v1.0
- 更新时间：2026-11-05 01:16（UTC-06:00）
- 基线：BL-2026-11-05（分支 `v20261025` / `ed8553f`）

## 1. 项目入口

| 项目 | 内容 |
| --- | --- |
| 源码 | `Creation-Studio/`（创作台，Node 25.9.0，CommonJS，无框架 HTTP 服务） |
| 管理器 | `Video-Generation-Manager/`（每用户安装，独立进程，端口 17778） |
| 智能体 | `Creation-Studio/agent_backend/`（FastAPI，端口 17820） |
| 启动 | `node scripts/launch.js`（守护管理器 + 智能体 + 创作台） |
| 数据目录 | `Creation-Studio/data/`（`WMD_DATA_DIR` 可覆盖） |
| 测试 | `node --test tests/*.test.js`，当前 96 个测试文件 |

## 2. 已核实事实（本地运行与代码）

### 2.1 数据分布

| 存储 | 内容 | 现状 |
| --- | --- | --- |
| `data/wmd.sqlite` | 租户/用户/会话/项目、执行端令牌、素材分类、文件别名、剧集 | 已入库 |
| `data/task-events.sqlite` | 任务事件、执行尝试 | 已入库（独立 SQLite 文件） |
| `data/studio.db` | 工作台分镜、生成记录、图像任务、创作台状态 | 已入库（独立 SQLite 文件） |
| `data/config.json` | 端口/路径/并发、渠道、AutoDL Key、LLM Key | **明文密钥，全局一份** |
| `data/jobs.json` | 任务队列与执行状态 | **1.7 MB，每 120 ms 全量重写** |
| `data/image-history.json` | 最近 80 条图像生成记录 | 文件 |
| `data/events-trash.json` | 回收站事件（最多 100 条） | 文件 |
| `data/*.imported.json` | 已迁移的旧 JSON | 仅存档，不再读取 |

### 2.2 代码规模

- `src/server.js` 2,446 行，约 121 个 API 路由分支。
- `.prepare(` 调用 147 处、`.exec(` 76 处，分布在 6 个模块：`db.js`、`auth.js`、`tenants.js`、`projects.js`、`event-store.js`、`workbench-store.js`、`studio-store.js`、`executor-channel.js`、`file-aliases.js`、`media-episodes.js`、`image-tasks.js`。
- 全部使用 `node:sqlite` 的 `DatabaseSync`，**同步 API**。

### 2.3 运行证据

`scripts/launch.js` 日志显示创作台进程多次以 `code=1 signal=null` 退出且 **stderr 为空**：

```
00:47:28 desktop 退出（code=1 signal=null）
00:49:12 desktop 退出（code=1 signal=null）
00:49:50 desktop 退出（code=1 signal=null）
00:52:51 desktop 退出（code=1 signal=null）
01:01:50 desktop 退出（code=1 signal=null）
01:03:06 desktop 退出（code=1 signal=null）
01:10:55 desktop 退出（code=1 signal=null）
```

同一秒内管理器记录 `[remote] fetch failed`，说明管理器是**先看到创作台断开**再报错，因果方向为创作台先退出。当前无 `uncaughtException` / `unhandledRejection` / `exit` 日志，无法判断是未处理异常、静默 `process.exit` 还是外部终止。→ INC-001。

同时 `data/jobs.json` 达到 1,763,996 字节，`jobs.js` 的 `saveState()` 在每次 `touch()` 后 120 ms 全量 `writeFileSync`，任务运行期间持续阻塞事件循环。

### 2.4 安全证据

`GET /api/state` 对任意登录用户返回：

- `config.publicView()` 中每个渠道的完整 `apiKey`；
- `channels.list(..., { includeSecrets: true })` 的完整密钥；
- `config.publicView().channels` 同样包含完整 `apiKey`。

`GET /api/channels` 同样使用 `includeSecrets: true`。在多租户部署下，任一租户成员都能读取平台全部模型的密钥。→ REQ-003。

### 2.5 执行端通道证据

`executor-channel.request()` 超时后只删除 `waiters` 条目，**命令仍留在 `queues[token]`**；下一次轮询会把这条已超时的命令再次下发。管理器端也没有过期判断。→ REQ-004。

### 2.6 数据完整性证据

- `tenants.remove()` 只检查是否还有用户，不检查项目；无用户的租户删除后项目成为孤儿。
- `auth.removeUser()` 删除用户与会话，但保留 `owner_user_id` 指向该用户的项目。
- `db.js` 的 schema 没有外键约束（注释里写了关系，DDL 未声明）。

## 3. 外部技术事实与适用条件

| SRC | 待解决问题 | 事实 | 适用条件 | 对本项目的影响 |
| --- | --- | --- | --- | --- |
| SRC-001 | Node 内置 SQLite 的 API 形态 | `node:sqlite` 的 `DatabaseSync` 是同步接口 | Node ≥ 22.5（本项目 25.9.0） | 现有 147 处调用均为同步；远端 DB 驱动不提供同步接口 |
| SRC-002 | MySQL/PG 驱动的 API 形态 | `mysql2/promise`、`pg` 的查询均返回 Promise | 远程数据库 | 切库必然要求数据访问异步化，不能只换连接串 |
| SRC-003 | SQLite 并发模型 | WAL 下仍只有一个写入者；`PRAGMA`、`json_extract`、`rowid`、`INSERT OR REPLACE` 为 SQLite 专有 | 当前单机单进程 | 这些写法不能直接搬到 MySQL/PG |
| SRC-004 | 备份方式 | 运行中的 SQLite 不能靠复制主文件做一致备份，需 Backup API 或 `VACUUM INTO` | 本地库 | 现有 `workbench-store` 的 `VACUUM INTO` 符合要求；`wmd.sqlite` 尚未提供备份入口 |

> 以上为公开文档中的稳定事实；本轮未引入新的第三方依赖，也未改变数据库引擎。

## 4. 缺口表

| 编号 | 现状 | 目标 | 影响 | 证据 |
| --- | --- | --- | --- | --- |
| GAP-01 | 进程静默退出，无崩溃日志 | 任何退出都有 `data/logs/process.log` 记录 | 无法定位、反复重启中断任务 | 2.3 |
| GAP-02 | `jobs.json` 全量重写 | 按行写 SQLite，只写变更行 | 事件循环阻塞、崩溃丢状态 | 2.3 |
| GAP-03 | 状态接口返回完整 Key | 只返回 `hasKey`/`masked` | 跨租户密钥泄露 | 2.4 |
| GAP-04 | 超时命令残留队列 | 过期命令丢弃并通知管理器 | 延迟重复执行 | 2.5 |
| GAP-05 | 删除租户/用户留孤儿 | 删除前校验或级联处理 | 数据归属错乱 | 2.6 |
| GAP-06 | 数据访问同步且方言耦合 | 统一的异步端口 + 方言适配 | 无法迁移 MySQL/PG | 2.2 / SRC-002 |
| GAP-07 | `config.json` 明文密钥 | 密钥加密入库、按租户隔离 | 文件泄露即密钥泄露 | 2.1 |
| GAP-08 | 图片历史/回收站仍在文件 | 入库 | 可被改写、并发覆盖 | 2.1 |
