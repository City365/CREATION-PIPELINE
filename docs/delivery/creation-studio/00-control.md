# 00 控制台：Creation-Studio 数据与稳定性规范化

- 文档状态：第一、二轮已完成（INC-001 观察中）
- 版本：v1.1
- 更新时间：2026-11-05
- 基线编号：BL-2026-11-05
- 适用范围：CREATION-PIPELINE / Creation-Studio 本地基线；Video-Generation-Manager 仅涉及外联协议兼容
- 源码版本：分支 `v20261025`，提交 `ed8553f`，工作区含未提交改动（以 `git status` 为准）
- 关联编号：REQ-001..021（REQ-008 暂缓）、TASK-001..021、DEC-001..010、INC-001、TC-001..063

## 1. 目标与范围

目标：把本地基线收敛到「可复现、可验证、崩溃有证据」的状态，并把后续切换远程 MySQL/PostgreSQL 的边界划清楚；**不在本轮直接换库**。

本次包含：

- 进程稳定性、任务落库、密钥脱敏/入库、执行端幂等、删除完整性。
- 租户配置隔离、图片历史/回收站入库、调试产物清理、配额与审计（第一轮）。
- 每用户界面偏好、多执行端令牌、邀请/密码重置、跨租户配额、智能体鉴权收紧、密钥轮换/ACL、自动备份、存储/并发配额、审计导出/哈希链、浏览器与离线回归（第二轮）。

本次不包含（理由见 [11-decisions-changes.md](11-decisions-changes.md)）：

- 真实接入 MySQL/PG（用户明确暂缓，功能全部开发完成后再评估）。
- 邮件/短信发送、第三方 SSO（邀请/重置用一次性链接）。
- 页面视觉改版、管理器自动化逻辑调整。
- 外部不可篡改审计存储（当前为应用层哈希链）。

## 2. 文档索引与职责映射

规范要求的 00–18 按「小范围任务可合并、但职责不丢失」原则合并如下：

| 规范文件 | 本项目文件 | 说明 |
| --- | --- | --- |
| 00 总控 | 本文件 | 范围、门禁、统计、阻塞 |
| 01 调研 | [01-context-research.md](01-context-research.md) | 现状、资料、证据、缺口 |
| 02 需求 | [02-requirements.md](02-requirements.md) | 需求、验收条件、追踪矩阵 |
| 03 架构 | [03-architecture.md](03-architecture.md) | 边界、模块、运行时链路（合并 07） |
| 04 数据存储 | [04-data-storage.md](04-data-storage.md) | 数据清单、目标表、迁移、备份 |
| 05 页面交互 | [06-api-contract.md](06-api-contract.md) §4 + [14-ui-tests.md](14-ui-tests.md) | 仅涉及受影响的设置/团队/执行端页面 |
| 06 API 契约 | [06-api-contract.md](06-api-contract.md) | 受影响接口逐个说明 |
| 07 联调调度 | [03-architecture.md](03-architecture.md) §4 | 任务、事件、外联通道的运行时 |
| 08 实施计划 | [08-implementation-plan.md](08-implementation-plan.md) | 任务卡、依赖、回滚 |
| 09 进度 | [09-progress.md](09-progress.md) | 实时状态与证据 |
| 10 风险事件 | [10-risks-incidents.md](10-risks-incidents.md) | INC-001 及风险清单 |
| 11 决策变更 | [11-decisions-changes.md](11-decisions-changes.md) | DEC-001..010、CR 记录 |
| 12 测试计划 | [12-test-plan.md](12-test-plan.md) | 分层、用例、退出条件 |
| 13 API 测试 | [13-api-tests.md](13-api-tests.md) | 请求 demo、断言、结果 |
| 14 UI 测试 | [14-ui-tests.md](14-ui-tests.md) | 真实浏览器逐页操作 |
| 15 E2E 回归 | [15-e2e-regression.md](15-e2e-regression.md) | 完整链路与旧功能回归 |
| 16 验收 | [16-acceptance.md](16-acceptance.md) | 评分细则、UAT、结论 |
| 17 发布恢复 | [17-release-recovery.md](17-release-recovery.md) | 启动、迁移、备份恢复 |
| 18 交接 | [18-handoff.md](18-handoff.md) | 续作入口 |

证据目录：`docs/delivery/creation-studio/evidence/<run-id>/`。

## 3. 阶段门禁

| 阶段 | 状态 | 依据 |
| --- | --- | --- |
| G0 调研完成 | 已满足 | 入口、数据清单、运行日志、崩溃时间线已核实 |
| G1 设计就绪 | 已满足 | 02/03/04/06/12/16 已写具体设计与可测预期 |
| G2 实施就绪 | 已满足 | 第一、二轮均在规范内实施 |
| G3 单元完成 | 已满足 | 见 09-progress 与 RUN-008 |
| G4 联调完成 | 已满足 | 见 13/14/15 与 RUN-008/009 |
| G5 工程验收 | 已满足（INC-001 观察中） | 见 16 |

## 4. 统计口径

| 指标 | 分母 | 当前 |
| --- | --- | --- |
| 需求 | 21（Must 14） | 设计完成 21；实现完成 20；验证完成 20；暂缓 1（REQ-008） |
| 实施任务 | 21 | 已验证 21 |
| 必测用例 | 63 | 执行 63；PASS 63（付费 e2e 除外） |
| 暂缓 | — | 1（REQ-008：用户决定继续 SQLite，功能完成后再评估迁移） |

## 5. 当前决定与下一步

- **REQ-008 暂缓**：用户 2026-11-05 明确「先不要迁移，就使用 SQLite，后期功能全部开发完成后再对接改造，不着急」。当前保持 `node:sqlite`，不做异步化改造；04 §5 的盘点与顺序保留为后期参考。
- 第一、二轮功能已实现并验证；下一步是**提交工作区**、真实环境验收与付费渠道抽样验证。
- INC-001 继续观察 `data/logs/process.log`；复现时按堆栈定位。
- 共享部署前：注入 `WMD_SECRET_KEY`、运行数据目录加固脚本、确认智能体端口只监听 127.0.0.1。
