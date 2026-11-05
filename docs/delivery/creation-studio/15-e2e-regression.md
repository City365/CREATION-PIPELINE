# 15 端到端与工程回归

- 文档状态：本轮已执行（受影响范围）
- 版本：v1.0
- RUN：RUN-001

## 1. 分层回归

| 层次 | 文件 | 结果 |
| --- | --- | --- |
| 任务生命周期 / 输出 | `task-lifecycle-api`、`job-output`、`manager-video`、`manager-failure-analysis` | PASS |
| 工作台 / 生成记录 | `workbench.test`、`workbench-e2e`、`workbench-item-isolation`、`history-projects` | PASS |
| 图像任务 | `image-tasks`、`image-save-project`、`image-target-path`、`generation-params` | PASS |
| 多租户 / 项目隔离 | `tenant-isolation-api`、`project-isolation-api`、`project-paths`、`project-source-folders` | PASS |
| 渠道 | `channels`、`channel-models` | PASS |
| 事件 / 调度 | `events`、`events-scheduler`、`task-import`、`task-overview`、`task-drawer`、`task-manifest` | PASS |
| 素材 / 媒体 / 别名 | `asset-layout`、`asset-storyboard`、`asset-tree`、`media-episodes`、`media-import`、`file-aliases`、`file-rel-api` | PASS |
| 创作台界面状态 | `studio-live-patch`、`studio-stage-job` | PASS |
| 代理 / 网络 | `agent-proxy`、`extract-proxy` | PASS |
| 新增 | `process-guard`、`jobs-store`、`executor-expiry`、`secret-exposure`、`tenant-delete-guard`、`first-run-boot` | PASS |

统计：42 个文件（36 个既有 + 6 个新增），189 个 Node 用例 + 1 个浏览器用例，PASS 190 / FAIL 0。

> 执行方式：`node --test --test-concurrency=1 ...`。并行模式（默认）下 `file-rel-api` 与 `tenant-isolation-api` 因固定端口争用出现 2 个失败；串行后全部通过。结论：这批测试必须串行跑，或后续改为动态端口。

## 2. 端到端链路

| 链路 | 操作 | 断言 | 结果 |
| --- | --- | --- | --- |
| 任务创建 → 执行 → 成片维护 | `workbench-e2e` + `job-output` | 任务落库、成片改名/替换/删除、重启后可读 | PASS |
| 旧数据迁移 | 临时 `jobs.json` + 本机 154 条 | 行数一致、原文件改名、重启恢复 | PASS |
| 密钥配置 → 页面展示 → 保存 | `channel-key-browser` | 页面只显示尾号、留空保存不清 Key | PASS |
| 外联命令超时 | `executor-expiry` | 超时命令不再下发、管理器拒绝执行 | PASS |

## 3. 未执行与理由

- 全量 96 个测试文件：其中 `autodl-e2e`、`seedance`、`image-e2e`、`tts`、`runninghub-h3` 等会访问真实付费服务或依赖外部账号，按用户「不要消耗视频额度」的要求未执行。标记 NOT_RUN。
- 真实豆包视频生成：未执行（额度保护）。
- 浏览器全页面回归：本轮只改了设置页密钥展示，其他页面 NOT_RUN（不适用）。

## 4. 第二轮回归（2026-11-05）

- 新增 10 个 Node 测试文件（22 用例）与 4 个浏览器用例，全部 PASS。
- `npm run test:offline`：`tests/*.test.js` 排除 9 个付费 e2e，`--test-concurrency=1` 串行执行；结果见 `evidence/RUN-008/offline-full.log`。
- 修复离线回归暴露的 3 个问题：
  1. `events-undo.test.js` 仍按 5 列写 `task_events` → 改为命名 6 列（含 `tenant_id`）。
  2. `scene-agent` / `scene-view-camera` 临时目录清理在 Windows 偶发 EPERM → 增加重试并忽略清理失败。
  3. 「最近生成」弹窗 `$().forEach` 崩溃 → 改为 `$$`，并新增浏览器用例。
- 未执行：付费 e2e、真实豆包视频生成、MySQL/PG 适配器（理由同上）。
