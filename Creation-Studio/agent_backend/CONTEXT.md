# 项目资源上下文 · agent-context/1.0

当前范围：所选数据版本的 Schema、所选策略包的规则元数据；不读取客户行、不执行策略、不计算指标。

- 前端每轮传 context.dataset_id / dataset_version_id / package_id；无选择保持原对话。
- 后端通过 BUSINESS_API_URL（默认 http://127.0.0.1:3014/api）读取资源，转发用户 Authorization 并校验项目、版本归属。
- 每轮冻结允许公开给模型的元数据，保存 snapshot_hash 与 resource_snapshot；历史消息展示当时依据。文件路径、样本值、历史 precision 等不纳入上下文。
- 摘要先注入，完整字段和规则通过 read_dataset_schema/read_strategy_rules 分页读取，只能访问本轮选择。工具返回 source_id，可记录在步骤证据中。
- Schema 未确认、规则字段缺失会明确提示。字段存在性检查不等于类型兼容或业务效果验证。
- 当前选择在页面生命周期内有效，刷新需重新选择；历史回复的来源仍保留。

## 验收

2026-10-21：智能体测试 24 项通过；真实 deepseek 对话实际调用两个读取工具，4 次工具调用完成单步任务，正确返回 customer_id / age_group、credit_score < 580，指出 Schema 未确认与绑定数据不一致。前端回复可见版本依据。

## 回退

前端关联与后端上下文分别提交；使用 git revert 按提交逆序回退。SQLite 执行记录的新增 JSON 字段兼容旧记录，无需修改业务数据库。
