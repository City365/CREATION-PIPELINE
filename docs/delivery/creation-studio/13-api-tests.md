# 13 API 测试记录

- 文档状态：本轮已执行
- 版本：v1.0
- RUN：RUN-001
- 时间：2026-11-05 01:20–01:45（UTC-06:00）
- 环境：Windows 11 / Node 25.9.0 / 每个用例独立临时 `WMD_DATA_DIR`

## 1. 用例与结果

| TC | 关联 | 操作 | 断言 | 实际结果 | 证据 |
| --- | --- | --- | --- | --- | --- |
| TC-001 | REQ-001 | 子进程触发未处理 Promise 拒绝 | 进程继续运行；`process.log` 有记录；退出码 0 | PASS | `tests/process-guard.test.js` |
| TC-002 | REQ-001 | 子进程触发未捕获异常 | 退出码 1；日志含堆栈与 `exit code=1` | PASS | 同上 |
| TC-003 | REQ-001 | 正常 `process.exit(0)` | 日志记录退出码 | PASS | 同上 |
| TC-004 | REQ-002 | 临时目录写入 2 条 `jobs.json` 后启动 | 列表 2 条；表 2 行；原文件改名 | PASS | `tests/jobs-store.test.js` |
| TC-005 | REQ-002 | 修改一条任务并 flush | 仅该行变化，另一行不变 | PASS | 同上 |
| TC-006 | REQ-002 | 插入 running 任务后重新加载 | 状态变 `interrupted`，原因写入 | PASS | 同上 |
| TC-007 | REQ-002 | 删除任务 | 表行删除、列表消失 | PASS | 同上 |
| TC-008 | REQ-003 | 配置 Key 后请求 `/api/state`、`/api/channels`、PUT `/api/config` | 响应不含完整 Key；含 `masked` | PASS | `tests/secret-exposure.test.js` |
| TC-009 | REQ-003 | PUT 渠道不传 Key | 配置文件仍保留原 Key | PASS | 同上 |
| TC-010 | REQ-003 | PUT 渠道 `clearKey=true` | 响应 `hasKey=false`，配置文件不再含 Key | PASS | 同上 |
| TC-011 | REQ-004 | 命令 1 秒超时后再轮询 | 不再返回该命令 | PASS | `tests/executor-expiry.test.js` |
| TC-012 | REQ-004 | 管理器执行 `expiresAt` 已过的命令 | 本地接口 0 次请求 | PASS | 同上 |
| TC-013 | REQ-005 | 有项目的租户删除 | 抛错「项目」，租户仍在 | PASS | `tests/tenant-delete-guard.test.js` |
| TC-014 | REQ-005 | 有项目的用户删除 / 无项目用户删除 | 前者 400，后者 200；会话与执行端令牌清除；删租户时配置/密钥一并清理 | PASS | 同上 |
| TC-015 | BUG-001 | 新账号请求 `projectId=default` 的工作台/创作台状态 | 200，空列表，不 404 | PASS | `tests/first-run-boot.test.js` |
| TC-016 | REQ-006 | 旧 `config.json` 含 4 类明文密钥后启动 | 内存配置有密钥；文件/库/WAL 无明文；备份存在 | PASS | `tests/secret-vault.test.js` |
| TC-017 | REQ-006 | 另一个进程用同一主密钥读取 | 解密结果等于原 Key | PASS | 同上 |
| TC-018 | REQ-006 | 换错 `WMD_SECRET_KEY` 启动 | 退出码非 0，错误含「无法解密」 | PASS | 同上 |
| TC-019 | REQ-006 | 保存新 Key / 删除 AutoDL Key / 删除渠道 | 密文更新；删除后对应行消失 | PASS | 同上 |
| TC-020 | REQ-006 | 篡改 `value_enc` 后读取 | 抛「无法解密」，不返回空值 | PASS | 同上 |
| TC-021 | REQ-010 | 模块级双租户配置 | 渠道/密钥/提示词互不可见；跨租户取不到 | PASS | `tests/tenant-config.test.js` |
| TC-022 | REQ-010 | 检查配置文件与加密库 | `config.json` 无租户字段；密钥按租户 | PASS | 同上 |
| TC-023 | REQ-010 | 租户 A 改并发 | 平台共享；B 渠道不变 | PASS | 同上 |
| TC-024 | REQ-010 | 定时器内读配置 | 继承租户 | PASS | 同上 |
| TC-025 | REQ-010 | 双租户 HTTP 隔离 | 列表为空/生成失败；管理员也只看自己租户 | PASS | `tests/tenant-config-api.test.js` |
| TC-026 | REQ-010 | 无上下文泵起 t1 任务 | 使用 t1 渠道 | PASS | `tests/tenant-job-context.test.js` |
| TC-027 | REQ-010 | 无上下文泵起 t1 图像任务 | 使用 t1 渠道 | PASS | `tests/tenant-image-context.test.js` |
| TC-029 | REQ-007 | 旧图片历史导入、双租户记忆 | 默认租户 2 条；t1/t2 各 1 条；80 条上限 | PASS | `tests/image-history-store.test.js` |
| TC-030 | REQ-007 | 旧回收站导入、双租户推入/取走 | 默认租户 1 条；t1/t2 隔离；100 条上限 | PASS | `tests/event-trash-store.test.js` |
| TC-031 | REQ-007 | 生成图片后读历史；B 租户读 | A 有记录；B 为空；A 不被清掉 | PASS | `tests/image-history-api.test.js` |
| TC-033 | REQ-009 | 清理脚本 dry-run/apply | 只移白名单；数据/存档/业务目录不动；manifest 生成 | PASS | `tests/clean-debug.test.js` |
| TC-034 | REQ-009 | 旧备份清理 | 只删过期 workspace/restore 和旧 .db；保留 migration/最新 .db | PASS | `tests/clean-backups.test.js` |
| TC-035 | REQ-011 | 配额限制用户/项目/任务 | 超限 429；用量正确 | PASS | `tests/quota-audit-api.test.js` |
| TC-036 | REQ-011 | 审计登录/变更/隔离/脱敏 | 动作齐全；租户隔离；无密码/密钥 | PASS | 同上 |

## 2. 真实服务验证（本机数据）

| 项 | 结果 |
| --- | --- |
| 旧任务迁移 | `jobs` 表 154 行；success 86 / failed 41 / canceled 27，与 `jobs.json` 一致 |
| 任务接口 | `GET /api/jobs` 返回 `ok:true`，154 条 |
| 密钥迁移 | `secrets` 表 10 行；`config.json` 明文 0 条；`data/secret.key` 已生成 |
| 租户配置迁移 | `tenant_configs` 1 行（`tnt_default`）；`secrets` 全部为 `tenant/tnt_default`，平台作用域 0 行 |
| 图片历史迁移 | `image_history` 80 行（默认租户）；`image-history.json` 已改名 `*.imported.json`；`/api/images/history` 返回 80 条 |
| 回收站迁移 | `event_trash` 4 行（默认租户）；`events-trash.json` 已改名；`/api/events/trash` 返回 4 条 |
| 调试产物清理 | 164 项/约 111MB 移入 `data/debug/` 后删除；根目录 203→39；数据库、存档、业务目录未动 |
| 旧备份清理 | 删除 3 项/约 1.88GB（2 个旧工作区 + 1 个恢复备份）；`data/backups` 11MB；保留 `migration/` 与最新 `.db` |
| 配额/审计迁移 | `tenant_quotas`/`audit_log` 建表；`task_events` 198 条回填 `tnt_default`；默认配额 0（不限）；服务正常 |
| 运行时解密 | AutoDL 1 个、LLM 4 个、图像 2 个、视频 2 个渠道带 Key |
| 密钥泄露扫描 | `/api/state` 与 `/api/channels` 响应中出现 0 次 |
| 渠道字段 | 仅 `hasKey/keyCount/masked` |
| 外联通道 | 管理器重启后 `last_seen` 20 秒内更新，通道在线 |

## 3. 复现命令

```bash
node --test tests/process-guard.test.js tests/jobs-store.test.js tests/executor-expiry.test.js tests/secret-exposure.test.js tests/tenant-delete-guard.test.js tests/first-run-boot.test.js tests/secret-vault.test.js
node tests/channel-key-browser.js
```

## 4. 未执行项

- 全量 `npm test`：包含会访问真实 AutoDL / Seedance / RunningHub 的 e2e，未获授权，标记 NOT_RUN。
- MySQL/PG 适配器契约测试：无实例，NOT_RUN。

## 5. 第二轮 API 测试（2026-11-05）

```bash
node --test --test-concurrency=1 \
  tests/user-prefs.test.js tests/user-prefs-api.test.js \
  tests/executor-multi-token.test.js tests/invite-reset.test.js \
  tests/agent-internal-project.test.js tests/vault-rotate.test.js \
  tests/harden-data-dir.test.js tests/backup-auto.test.js \
  tests/quota-storage-concurrency.test.js tests/audit-chain-export.test.js
```

| 用例 | 断言 | 结果 |
| --- | --- | --- |
| 用户偏好 | A/B 主题互不影响；`config.json` 不变；重启保留 | PASS |
| 多令牌 | 两条并存；撤销一条；越权 404；状态不含完整令牌 | PASS |
| 邀请/重置 | 接受邀请租户/角色正确；过期/重复 400；旧会话失效 | PASS |
| 内部项目 | 任意租户项目 200；未知 404；无内部凭据 401 | PASS |
| 密钥轮换 | 全量重加密；坏密文中止；启动收尾；env 拒绝 | PASS |
| 自动备份 | 三库快照；保留 14/30 天；24 小时节流 | PASS |
| 存储/并发配额 | 超限 429；用量隔离；缓存；负数拒绝 | PASS |
| 审计链/导出 | 篡改检出；CSV BOM；成员 403；JSON 含 integrity | PASS |
