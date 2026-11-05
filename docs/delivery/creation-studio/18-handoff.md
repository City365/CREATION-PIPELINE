# 18 交接

- 文档状态：可续作（第二轮已完成）
- 版本：v1.1
- 更新时间：2026-11-05
- 基线：BL-2026-11-05（分支 `v20261025` / `ed8553f` + 第一、二轮未提交改动）

## 1. 当前锚点

目标：Creation-Studio 本地基线规范化 + 多租户体验/安全运维补全。

- 第一轮：TASK-001..010（稳定性、任务落库、密钥脱敏/入库、执行端幂等、删除完整性、租户配置隔离、图片历史/回收站、清理、配额/审计）。
- 第二轮：TASK-011..021（每用户界面偏好、多执行端令牌、邀请/重置、跨租户配额、智能体鉴权、密钥轮换/ACL、自动备份、存储/并发配额、审计导出/哈希链、浏览器与离线回归）。
- **未做**：MySQL/PG 迁移（用户明确暂缓）；真实付费渠道生成测试；邮件发送；外部不可篡改审计存储。

## 2. 已确认事实

- 数据访问仍是 `node:sqlite` 同步 API；远程 MySQL/PG 迁移暂缓，等功能全部开发完成后再按 04 §5 评估。
- **用户决定（2026-11-05）**：先不迁移，继续使用 SQLite；当前不为迁移做异步化改造。
- 数据库：`wmd.sqlite`（账号/租户/项目/任务/配置/密钥/配额/审计/偏好/一次性码）、`task-events.sqlite`、`studio.db`。
- `jobs.json` → `wmd.sqlite › jobs`；`image-history.json` → `image_history`；`events-trash.json` → `event_trash`；旧文件均改名 `*.imported.json`。
- 渠道 Key、AutoDL Token、执行端令牌 AES-256-GCM 加密存 `secrets`；主密钥在 `data/secret.key` 或 `WMD_SECRET_KEY`；`config.json` 只剩部署参数。
- 租户配置存 `tenant_configs`；部署参数平台共享；HTTP 请求和后台任务都进租户上下文。
- 每用户界面偏好存 `user_prefs`；`config.json.ui` 只作默认值。
- 一次性邀请/重置码存 `access_codes`，只存 sha256；邀请默认 72 小时、重置 30 分钟。
- 配额：用户/项目/每日任务/存储/并发；0=不限；存储按租户目录求和（60 秒缓存），并发按运行中任务计数。
- 审计：`audit_log` 每租户哈希链；`/api/audit` 返回 `integrity`；`/api/audit/export` 可导出 CSV/JSON。
- 自动备份：`data/backups/auto/`，每库保留最新 14 份、删除超过 30 天；启动 60 秒后尝试、每 6 小时检查。
- 智能体默认 `HARNESS_AUTH_MODE=controller`；`/api/internal/projects/:id` 校验任意租户项目；`/agent/health` 公开。
- 执行端支持同一用户多条令牌；设置页可列出、撤销、切换视频任务通道。
- 「最近生成」弹窗的 `$().forEach` 崩溃已修复（浏览器用例覆盖）。

## 3. 运行入口

```bash
cd Creation-Studio
node scripts/launch.js
```

- 创作台：http://127.0.0.1:17821
- 智能体：http://127.0.0.1:17820
- 管理器：http://127.0.0.1:17778

## 4. 数据状态（本机）

- `jobs` 表 154 行（第一轮迁移）；`secrets` 10 行；`tenant_configs` 1 行；`image_history` 80 行；`event_trash` 4 行。
- 第二轮建表：`user_prefs`、`access_codes`；`tenant_quotas` 增加存储/并发列；`jobs` 增加 `tenant_id`；`audit_log` 增加 `prev_hash`/`hash`。
- 迁移前快照：`data/backups/migration/`；`data/debug/` 已按用户确认删除；`data/backups` 11MB。
- 测试数据都在系统临时目录；本机库未写入测试用户/项目。

## 5. 验证状态

- 第一轮 RUN-001..007：受影响 53 文件 / 211 Node + 4 浏览器 PASS。
- 第二轮 RUN-008/009：10 个新 Node 文件（22 用例）+ 4 个浏览器用例 PASS；`npm run test:offline` 离线全量 543 用例串行 PASS（排除 9 个付费 e2e）。
- Python：`agent_backend` governance 4 用例 PASS（含 controller 项目校验）。
- INC-001：`data/logs/process.log` 无新记录时视为未复现；复现先看 `uncaughtException` / `exit`。
- 未执行：真实付费视频/图像生成；MySQL/PG；邮件发送；完整 `npm test`（含付费 e2e）。

## 6. 下一项明确动作

1. **提交工作区**：第一、二轮改动尚未 git commit，交付/回滚前必须先提交或打标签。
2. 若马上多人使用：把邀请/重置链接的转发流程定下来（当前不接邮件），并确认租户 owner/admin 名单。
3. 共享部署前：用 `WMD_SECRET_KEY` 注入主密钥、运行 `node scripts/harden-data-dir.js --apply`、确认智能体端口只监听 127.0.0.1。
4. 运维：定期检查 `data/backups/auto/` 与 `data/logs/process.log`；需要时执行 `npm run clean:backups`。
5. 后期：MySQL/PG 迁移按 04 §5 单独立项；审计如需真正防篡改，接外部 WORM/签名服务。

## 7. 禁止重复的无效路径

- 不要直接把 `DATABASE_URL` 换成 MySQL/PG：同步调用点会全部失效。
- 不要复制运行中的 SQLite 主文件当备份（WAL 不一致）；用 `VACUUM INTO`（`scripts/backup.js`）。
- 不要在未备份的情况下删除 `jobs.imported.json` 或 `wmd.sqlite`。
- 不要在 `WMD_SECRET_KEY` 生效时用 `scripts/rotate-secret.js` 做文件轮换；改环境变量并重启。
- 不要把 `/agent/health` 当成业务鉴权：它只返回模型/能力信息；业务接口仍走 controller 校验。
- 不要让普通成员改渠道/配额；接口已按 owner/admin 限制。
