# 存储规范化审阅：哪些数据必须入库

状态：评审 + 第一、二批改造已执行并验证（2026-11-05）。结论先说：**账号、会话、租户、项目已经全部落进 `data/wmd.sqlite`；剩下的文件型状态按敏感度和并发风险分批迁移，不再往 JSON 里加新数据。**

## 一、为什么要改

现在的问题不是「文件不好」，而是：

1. **可被随手改**：`data/users.json`、`projects.json`、`executor-channels.json` 用记事本就能改，改完还立即生效——权限、归属、令牌都靠文件内容说了算。
2. **并发不安全**：JSON 是全量读-改-写，两个请求同时写会互相覆盖；SQLite 有事务和行级写锁。
3. **没有约束**：外键、唯一索引、NOT NULL 都靠代码自觉；文件里一条手工塞进去的坏数据能一直存在。
4. **无法审计**：谁在什么时候改了什么，文件层面没有痕迹。

## 二、现状盘点

| 数据 | 现在存在哪 | 性质 | 结论 |
| --- | --- | --- | --- |
| 租户 / 用户 / 会话 / 项目 | `data/wmd.sqlite` | 身份与归属，最敏感 | ✅ 已入库（本轮完成） |
| 任务事件 | `data/events.db`（event-store） | 业务数据、并发写 | ✅ 已入库 |
| 工作台条目 / 生成记录 | `data/workbench.db` | 业务数据 | ✅ 已入库 |
| 视频创作台界面状态 | `data/studio.db` | 按项目的状态 | ✅ 已入库 |
| 执行端配对令牌 | `data/wmd.sqlite › executor_channels` | 凭据，能远程下发命令 | ✅ 本轮完成 |
| 素材分类与主体映射 | `data/wmd.sqlite › asset_meta` | 业务数据 | ✅ 本轮完成 |
| 文件别名（改名/移动追溯） | `data/wmd.sqlite › file_aliases` | 业务数据 | ✅ 本轮完成 |
| 剧集分组 | `data/wmd.sqlite › media_episodes` | 业务数据 | ✅ 本轮完成 |
| 图片生成历史 | `data/wmd.sqlite › image_history` | 业务数据 | ✅ 已入库（按租户 80 条，旧文件改名 `image-history.imported.json`） |
| 任务状态（队列/执行） | `data/wmd.sqlite › jobs` | 热路径，写频繁 | ✅ 已入库（按行 upsert，旧文件改名 `jobs.imported.json`） |
| 回收站事件 | `data/task-events.sqlite › event_trash` | 业务数据 | ✅ 已入库（按租户 100 条，旧文件改名 `events-trash.imported.json`） |
| 应用配置 / 渠道 / 模型 Key | `data/config.json` + `data/wmd.sqlite › secrets` | 部署参数 + **加密密钥** | ✅ 密钥已 AES-GCM 入库（`config.json` 只留 id/名称）；⏳ 渠道仍是全局一份，租户级隔离未做 |
| 内部服务令牌 | `data/internal-token.json` | 引导用共享密钥 | 保留（Py/Node 共用，权限 0600） |
| 服务 PID | `data/service-pids.json` | 运行时瞬时数据 | 保留 |
| 备份 / 证据 / 截图（`backups-config-*.json`、`p0-topbar.json` 等） | `data/*.json` | 调试产物 | 不迁移，另外清理 |

## 三、目标结构

一个库 `data/wmd.sqlite`（新数据）+ 三个历史库（`events.db` / `workbench.db` / `studio.db`）保留，逐步合并：

```
wmd.sqlite
├── tenants / users / sessions / projects        ✅ 已建
├── executor_channels(token, user_id, name, …)   ← 本轮
├── asset_tags(path, type, subject, tenant, …)   ← 本轮
├── file_aliases(from_path, to_path, …)          ← 本轮
├── media_episodes(id, project, title, …)        ← 本轮
├── image_history(...)                            ← 下轮
├── jobs(...)                                     ← 下轮
└── app_settings / tenant_settings / channels     ← 下轮（Key 加密存）
```

原则：

- **业务状态一律入库**；配置文件只留「部署参数」（端口、路径）——这些改了也就是启动参数，不影响权限。
- **一条数据只有一个家**：迁移时先读旧文件导入一次，然后把文件改名 `*.imported.json`，避免两份真相。
- **敏感字段**：模型 Key、配对令牌在库里单独一列并加密（AES-GCM，密钥来自 `data/secret.key`，文件权限 0600）。
- **版本化**：每个表带 `schema_version`，迁移脚本按版本推进，不再靠「试一下能不能读」。

## 四、本轮已做

1. 新增 `src/db.js`：统一的 SQLite 入口（WAL、外键、建表、一次性导入老 JSON 并改名）。
2. `auth.js` / `tenants.js` / `projects.js` 全部改为读写 SQLite，对外 API 不变，`server.js` 和测试无需改动。
3. 老数据自动迁移：`tenants/users/sessions/projects.json` → SQLite，导入成功后原文件改名 `*.imported.json`。
4. 执行端配对令牌、素材分类、文件别名、剧集分组迁移入库。
5. 本机实际数据已迁移完成：1 个租户、1 个用户、2 个项目、1 条配对令牌、2 行素材分类、82 条文件别名、1 组剧集；原 JSON 全部改名为 `*.imported.json`。
6. 迁移后回归：租户隔离、项目隔离、媒体库、任务生命周期、工作台等 13 项测试通过；外联通道用库里的令牌重新连上。

## 五、迁移与回滚

- 迁移发生在第一次打开库时，整体一个事务；失败回滚，旧文件保持原样。
- 回滚方案：删掉 `wmd.sqlite*`，把 `*.imported.json` 改回原名即可回到旧版本。
- 迁移完成后旧文件不再被读取，改它们没有任何效果——这正是要的效果。

## 六、后续（按优先级）

1. **配置与密钥**：渠道 Key、AutoDL Token、执行端令牌已加密入库（TASK-006）；下一步是把渠道拆成「平台级 / 租户级」，补上多租户配置隔离（目前仍是全局一份，这是已知的最大缺口）。
2. ~~**任务状态**：`jobs.json` 入库~~（已完成：按行写入 `wmd.sqlite › jobs`，旧文件改名存档）。
3. ~~**图片历史 / 回收站**~~（已完成：`image_history` / `event_trash`，按租户隔离，旧 JSON 改名存档）。
4. ~~**清理调试产物**~~（已完成：`scripts/clean-debug.js` + `scripts/clean-backups.js`；debug 与旧备份已删除，数据库迁移快照和最新 `.db` 保留）。
5. **远程数据库**：切换 MySQL/PG 前必须先完成异步数据访问改造；见 `docs/delivery/creation-studio/04-data-storage.md` §5。
