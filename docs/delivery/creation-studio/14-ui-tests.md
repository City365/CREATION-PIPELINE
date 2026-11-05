# 14 页面真实操作测试

- 文档状态：本轮已执行（设置页密钥）
- 版本：v1.0
- RUN：RUN-001
- 环境：Windows 11 / Chrome（管理器自带 playwright-core）/ 1400×900 无头

## 1. 范围

本轮页面改动只有「设置 → 渠道」里的密钥展示与编辑保存。其余页面未改，不做无差别重测。

## 2. 用例

| 步骤 | 操作 | 预期 | 实际 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 注册账号，创建带 Key 的渠道 | 渠道创建成功 | PASS | `tests/channel-key-browser.js` |
| 2 | 打开设置面板 | 页面正常加载，不出现「无法连接」 | PASS | 同上 |
| 3 | 查看渠道行 | 只显示 `sk-b…cdef`，DOM 无完整 Key | PASS | 同上 |
| 4 | 点击「编辑」 | API Key 输入框为空，占位符提示「已配置：…」 | PASS | 同上 |
| 5 | 不填 Key 直接保存 | 保存成功；渠道仍显示已配置 | PASS | 同上 |
| 6 | 检查 `config.json` | 不含明文 Key；服务端 `hasKey` 仍为 true | PASS | 同上 |
| 7 | 页面错误 | 无 `pageerror` | PASS | 同上 |
| 8 | 普通租户成员打开设置 → 存储目录 | 项目目录/并发等平台字段只读，显示提示 | PASS | `tenant-storage-ui-browser.js` |
| 9 | 普通租户成员切到文本推理 | 仍能新增/编辑本租户渠道 | PASS | 同上 |
| 10 | 浏览器删除任务 → 回收站 → 恢复 | 回收站弹窗、恢复后任务回来、清单成片数正确 | PASS | `events-undo-browser.js` |
| 11 | 管理员打开设置 → 租户成员 | 显示配额用量，可保存用户上限 | PASS | `quota-audit-browser.js` |
| 12 | 管理员打开设置 → 审计日志 | 能看到注册/登录等记录 | PASS | 同上 |

## 3. 未执行

- 其他页面（图像/视频/素材/智能体）本轮无改动，未重跑浏览器用例；列为 NOT_RUN（不适用）。
- 真实视频生成页面：需要消耗账号额度，按用户要求不做测试性生成。

## 4. 复现

```bash
npm run test:channel-key-browser
npm run test:tenant-storage-browser
node tests/events-undo-browser.js
npm run test:quota-audit-browser
```

> 「最近生成」弹窗在第二轮补了浏览器用例，并修复了 `$('#modal-panel [data-history]').forEach` 的崩溃（改为 `$$`）。见下方第二轮。

## 5. 第二轮浏览器用例（2026-11-05）

| # | 页面/操作 | 断言 | 结果 | 脚本 |
| --- | --- | --- | --- | --- |
| 13 | 图像页 → 最近生成 | 弹窗标题、历史条目可见、无页面错误 | PASS | `tests/image-history-browser.js` |
| 14 | 两个账号分别登录 | A 的 `studio-mint` 持久化；B 不受影响 | PASS | `tests/user-prefs-browser.js` |
| 15 | 设置 → 执行端 | 生成两条令牌、列表两条、撤销一条 | PASS | `tests/executor-multi-token-browser.js` |
| 16 | 设置 → 租户成员 → 配额 | 管理员切换租户、保存对方配额、接口回读一致 | PASS | `tests/quota-cross-tenant-browser.js` |

复现：

```bash
npm run test:image-history-browser
npm run test:user-prefs-browser
npm run test:executor-multi-browser
npm run test:quota-cross-browser
```
