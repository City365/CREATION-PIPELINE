# 17 发布、备份与恢复

- 文档状态：本轮适用
- 版本：v1.0
- 更新时间：2026-11-05 01:45（UTC-06:00）

## 1. 启动

```bash
cd Creation-Studio
node scripts/launch.js          # 管理器 + 智能体 + 创作台
node scripts/launch.js --app    # 同时打开应用窗口
```

健康检查：

```bash
curl http://127.0.0.1:17821/api/health
curl http://127.0.0.1:17820/agent/health
curl http://127.0.0.1:17778/health
```

## 2. 数据位置

| 文件 | 内容 |
| --- | --- |
| `data/wmd.sqlite` | 租户、用户、会话、项目、执行端令牌、素材分类、别名、剧集、任务、租户配置、加密密钥、图像历史、**配额**、**审计日志** |
| `data/task-events.sqlite` | 任务事件与执行尝试、**回收站** |
| `data/task-events.sqlite` | 任务事件与执行尝试 |
| `data/studio.db` | 工作台、生成记录、图像任务、创作台状态 |
| `data/config.json` | 部署参数与渠道配置（**不含密钥**） |
| `data/secret.key` | 主密钥（32 字节 base64，0600）；**必须与数据库一起备份** |
| `data/logs/process.log` | 进程退出与异常证据 |
| `data/jobs.imported.json` | 旧任务存档（迁移后不再读取） |

## 3. 迁移顺序（首次启动新版本）

1. 自动备份：`jobs.json` 复制为 `jobs.json.bak-<时间戳>`。
2. `wmd.sqlite` 建 `jobs` 表（`CREATE TABLE IF NOT EXISTS`）。
3. 单事务导入 `jobs.json`，逐条校验存在。
4. 成功后把 `jobs.json` 改名为 `jobs.imported.json`。
5. 失败：回滚事务，保留 `jobs.json`，写 `process.log`，服务用库里已有任务继续启动。

## 4. 备份

运行中的 SQLite 不要直接复制主文件（WAL）。使用 `VACUUM INTO` 生成一致快照：

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/wmd.sqlite');db.exec(\"VACUUM INTO 'data/backup-wmd-'+Date.now()+'.sqlite'\");db.close()"
```

同样方式备份 `data/task-events.sqlite`、`data/studio.db`。

**密钥库额外要求**：

- 必须同时备份 `data/secret.key`（或记录 `WMD_SECRET_KEY`）。只备份数据库，恢复后所有渠道密钥都无法解密。
- 主密钥不要和数据库放在同一台远程主机上；生产环境优先用 `WMD_SECRET_KEY` 由部署平台注入。
- 更换主密钥需要重新加密所有密文（当前未提供自动轮换，需单独实现）。

## 5. 恢复

1. 停服务（关闭启动器）。
2. 把快照复制回 `data/wmd.sqlite`（同时删除旧的 `-wal`/`-shm`）。
3. 启动服务，核对：
   - `/api/health` 200；
   - `SELECT COUNT(*) FROM tenants/users/projects/jobs/tenant_configs/secrets/image_history/tenant_quotas/audit_log` 与备份前一致；
   - 任务列表数量、最近任务内容抽查；
   - 渠道配置可读（`/api/state` 返回 `hasKey:true`）；
   - 若密钥读不出来，检查 `secret.key` / `WMD_SECRET_KEY` 是否与备份时一致（不匹配会直接启动失败）。
4. 恢复演练先在隔离目录进行，不直接覆盖生产数据。

## 6. 回退到旧版本（仅本次迁移相关）

1. 停服务。
2. 删除 `jobs` 表数据（或整库换回备份）。
3. 把 `jobs.imported.json` 改回 `jobs.json`。
4. 回退代码。
5. 启动并核对任务列表。

### 6.2 图片历史/回收站迁移回退

- 迁移前快照：`data/wmd.before-history-*.sqlite`；两个旧文件的副本：`image-history.json.before-import-*`、`events-trash.json.before-import-*`。
- 回退：停服 → 恢复数据库快照 → 把 `*.imported.json` 改回原名 → 回退代码 → 启动核对条数。
- 迁移后新产生的历史和回收站记录只在新库；回退前先导出 `image_history` / `event_trash`。

### 6.1 租户配置迁移回退

- 迁移前快照：`data/wmd.before-tenant-*.sqlite`；配置备份：`data/config.json.bak-*` 与 `data/config.json.before-tenant-*`。
- 回退：停服 → 用快照覆盖 `wmd.sqlite`（删除 `-wal/-shm`）→ 恢复 `config.json` → 回退代码 → 启动核对渠道与任务。
- 迁移后新建租户的配置只在新库；回退会丢失，先导出 `tenant_configs`。

> 迁移后新产生的任务只在新库中；回退会丢失这些任务。回退前先导出 `SELECT data FROM jobs`。

## 8. 调试产物清理

```bash
node scripts/clean-debug.js            # 预览
node scripts/clean-debug.js --apply    # 移入 data/debug/<分类>/，写 manifest
```

- 只移动根目录截图、日志、临时脚本、证据 JSON、旧 config 备份、迁移副本、调试目录；数据库、`*.imported.json`、业务目录、`workspace-migration.json` 等不动。
- 数据库迁移快照移到 `data/backups/migration/`，保留回滚能力。
- 回滚：按 `data/debug/cleanup-manifest-*.json` 把文件移回原位。
- `data/debug/` 已删除（含旧 config 备份）；`data/backups/` 旧备份已按 8.1 清理。

## 8.1 旧备份清理

```bash
node scripts/clean-backups.js                 # 预览
node scripts/clean-backups.js --apply         # 删除超过 7 天的 workspace/restore 和旧 .db
node scripts/clean-backups.js --apply --days 30
```

- 永远保留 `data/backups/migration/`（数据库迁移快照）和最新的 `.db` 备份。
- 本机已删除 3 项/约 1.88GB，`data/backups` 从约 1.8GB 降到 11MB；清单在 `data/backups/cleanup-manifest-*.json`，副本在 RUN-006 证据目录。

## 9. 观察项

| 指标 | 位置 | 阈值/动作 |
| --- | --- | --- |
| 进程退出 | `data/logs/process.log` | 出现 `uncaughtException`/`exit code=1` 立即查堆栈；`unhandledRejection` 连续出现需定位来源 |
| 任务落库失败 | `process.log` 的 `jobs-flush-failed` | 检查磁盘空间、库锁；脏行会在下次变更时重试 |
| 任务列表 | `/api/jobs`、`data/jobs.imported.json` 存档 | 数量异常时核对 `jobs` 表 |
| 磁盘 | `data/` 与项目根目录 | 低于 10% 时清理 `_trash`、旧日志、`.bak` |
| 执行端在线 | `/api/executor/status`（登录后） | 离线超过 45 秒检查管理器外联配置 |
| 配额超限 | 创建接口 429 | 到「租户成员 → 配额」调整上限；0 = 不限 |
| 审计写入失败 | `process.log` 的 `audit-failed` | 检查数据库锁/磁盘；审计失败不会阻断业务 |

## 10. 第二轮运维动作

### 10.1 自动备份

- 服务启动 60 秒后尝试一次，之后每 6 小时检查；距上次成功不足 24 小时则跳过。
- 目录 `data/backups/auto/`；每库保留最新 14 份、删除超过 30 天；不碰 `migration/` 与手工备份。
- 手工触发：

```bash
node scripts/backup.js
node scripts/backup.js --list
node scripts/backup.js --keep 7 --days 14
```

- 回滚：停服 → 用 `VACUUM INTO` 快照替换对应库（删除 `-wal/-shm`）→ 启动核对。

### 10.2 主密钥轮换

```bash
node scripts/rotate-secret.js                          # 预览
node scripts/rotate-secret.js --apply                  # 生成新密钥并重加密
node scripts/rotate-secret.js --apply --new-key <64hex>
```

- 轮换会先写 `data/secret.key.next`，事务更新 `secrets`，成功后备份旧 key 并改名；启动时 `recover()` 收尾。
- `WMD_SECRET_KEY` 生效时脚本拒绝文件轮换；请更新环境变量并重启。
- 回滚：停服 → 把 `secret.key.bak-*` 改回 `secret.key` → 用轮换前的数据库快照恢复。

### 10.3 Windows 数据目录加固

```bash
node scripts/harden-data-dir.js                 # 只打印 icacls 命令
node scripts/harden-data-dir.js --apply         # 执行
node scripts/harden-data-dir.js --apply --recursive
```

- 关闭继承，授予运行账号、SYSTEM、Administrators 完全控制；`secret.key`/`internal-token.json`/`config.json` 单独授权。
- 非 Windows 平台只提示 `chmod 700`。

### 10.4 邀请/重置与智能体鉴权

- 邀请链接默认 72 小时、重置链接 30 分钟；只在创建时显示一次，不接邮件。
- 智能体默认 `HARNESS_AUTH_MODE=controller`；共享部署确认 17820 只监听 `127.0.0.1`，并保证控制器在线。
- 本机开发如确需绕过，显式设 `HARNESS_AUTH_MODE=development`，不要用于共享部署。
