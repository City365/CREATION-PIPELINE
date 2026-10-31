# 直发 = 当前任务的补充说明（不中断、不重启）

> 「直接发送」不再取消正在执行的任务。任务在跑时，直发的话进入**当前运行**的补充说明通道，
> 在下一次模型调用（= 上一次工具安全返回之后）并入上下文，按新要求调整剩余步骤继续执行。

## 1. 问题

消息队列里队首的 ↑ 按钮（`ask-queue-now`）原来的实现是：

```
confirm('…会中断它…') → askStop()（POST /runs/{id}/cancel）→ 等运行结束 → 作为新任务重新发送
```

后果跟截图里一致：取消请求发出后原任务被 `RunStopped` 打断，前端等不到 `done`，
于是显示「已停止／[回复失败] 回复连接中断，尚未收到任务结束确认」。用户真正想要的是
「补充一句要求」，不是「换一个问题重来」。

## 2. 现在的行为

| 场景 | 点「直发 / 直接发送」的结果 |
| --- | --- |
| 有任务在跑 | `POST /agent/sessions/{sid}/supplements`（或 `/agent/runs/{run_id}/supplements`）→ 200，返回 `run_id` + 序号；只并入当前运行 |
| 没有任务在跑 | 409 `no_active_run` → 前端按普通发送开新一轮（行为与原来一致） |
| 任务刚好在这一刻结束 | 同上，退回普通发送，不会丢也不会重复 |
| 补充说明没赶上检查点（例如最后一段回复已经在生成） | 运行结束前标记 `undelivered`，通过 SSE 事件交回前端，前端把它退回普通队列，作为**后续任务**接着发（需求 10） |

发送方式明确分成两种，互不替代：

- **排队（普通发送）**：进入待发送队列，当前回复结束后依次发送（原逻辑，未改动）。
- **直发（直接发送）**：任务在跑时作为补充说明并入当前任务；没任务时等同于普通发送。

## 3. 后端

新增 `agent_backend/app/supplements.py`：

- `RunChannel`：一次运行独占的有序队列，条目 `{id, text, time, status}`，
  `status ∈ queued → applied | undelivered`。
  - `push()` 只追加到队尾（FIFO，序号即接收顺序）。
  - `drain()` **原子地**取走全部 `queued` 并标记 `applied` —— 同一条不会被并入两次。
  - `close()` 把剩余 `queued` 标记 `undelivered` 并交回，供前端重新排队。
- 注册表：`open_run / live_run / channel / close_run`，按 `(project, run_id)` 与
  `(project, session_id)` 双索引，运行结束后保留 30 分钟归档供前端核对状态。
- `SupplementChannel(AgentMiddleware)`：挂在 LangChain 的 `awrap_model_call` 上，
  **只在模型调用边界**取队列：

```
工具正在执行 → 不改任何东西（等待安全返回）
工具返回 → 下一次模型调用 → drain() → 把【任务补充说明】追加进 system message → 模型按新要求继续
```

  已并入的条目会在后续每次模型调用继续带在 system message 里（不丢），但不会重复通知、不会重复投递；
  `request.messages`（计划 / 工具调用链）保持原样，因此已完成步骤、中间结果和交付文件都在。

`app/main.py` 接线：

- `_chat` 拿到 `run_id` 后 `open_run(...)`；中间件随 `create_agent(middleware=[...])` 注入，
  legacy 引擎与 harness 引擎都挂上。
- 事件：`supplement_received`（已收到，等检查点）、`supplement`（已并入，带条目）、
  `supplement_undelivered`（没赶上，交回前端）。运行回执里有 `supplements` 字段。
- 轨迹：每条补充说明写一条 `kind='supplement'` 的记录，出现在「执行过程」里。
- 接口：`POST /agent/runs/{run_id}/supplements`、`POST /agent/sessions/{sid}/supplements`、
  `GET /agent/runs/{run_id}/supplements`（状态快照）。
- 提示词：`chat_policy.py` 增加「任务补充说明 · 执行中直发」段落，明确这是同一任务的中途追加，
  保留已完成部分、不重跑、不推翻计划，收尾时说明调整了什么。

## 4. 前端 `web/app.js`

- 输入区生成中显示两个按钮：`排队 ↑`（原行为）与 `直发 ⚡`（补充给当前任务），两者语义分开。
- 队列面板：运行中时队首按钮文案为「直发」，提示「直发＝补充给当前任务，不中断执行」；
  已直发的条目显示「等检查点」，不再重复给直发按钮；面板最多展示 3 条。
- 直发发出后条目留在本地队列并标记 `sup`，靠事件把状态改成 `received / applied`，
  **applied 才从队列移除**；运行结束时 `askQueueSettle()` 用 `GET /runs/{id}/supplements` 兜底核对：
  已并入的删除，`undelivered` 的清掉标记退回普通排队（顺序不变）。
- 回复里显示「⚡ 补充说明 · 已并入 N 条」+ 每条摘要，可回溯这条回复吃过哪些中途要求。

## 5. 需求对照

| 需求 | 落地 |
| --- | --- |
| 1 保留原队列 | 队列存储 / `askDrainQueue` / localStorage 键全部未改，只改队首按钮的语义 |
| 2 直发与普通发送区分 | 两个按钮 + 两个接口（`supplements` vs `/agent/chat`） |
| 3 识别为补充说明 | 运行中用会话/运行 ID 查 live run，命中即入队，不新建运行 |
| 4 关联运行 ID + 独立通道 | 每个 `run_id` 一个 `RunChannel`，响应里带 `run_id` |
| 5 检查点读取并调整计划 | `awrap_model_call` 边界并入 system message，要求调整剩余步骤 |
| 6 保留状态/上下文/步骤/结果 | 不取消运行；`request.messages` 不改写 |
| 7 等工具安全返回 | 只在模型调用边界处理，工具执行期间零注入 |
| 8 顺序、不丢、不重 | FIFO 队列 + `drain()` 一次性原子取走 + `undelivered` 交回 |
| 9 没任务时照旧 | 409 `no_active_run` → 普通发送 |
| 10 任务已完成 → 后续任务 | 同上；没赶上检查点的条目退回队列作为下一轮 |

## 6. 验证

单测：`agent_backend/tests/test_supplements.py`（9 条，含中间件合并、消息序列不变、
路由绑定运行 ID、项目隔离、未赶上检查点交回）与 `tests/chat-supplement.test.js`（7 条，队列 UI / 状态核对）。
全量：agent 后端 `193 passed`，控制器 `node --test` 全绿。

真实运行（`deepseek-flash`，只读权限，脚本见 `_tmp_direct_send/`）：

1. 跑起来后连续两次直发 → 两次都是 200 且 `run_id` 相同，序号 1、2；
   事件 `start → supplement_received ×2 → supplement(2 条) → delta… → done`；
   回执 `status=completed`、`supplements` 两条 `applied`；会话仍只有 1 轮（没新任务）。
2. 工具执行途中（第 8 秒，7 次工具调用中）直发 → 下个模型边界并入，
   最终回复里出现补充要求的结论句，`tool_errors=None`、`tool_count=7`、只跑一轮。
3. 第 20 秒（最后一段回复已在生成）再直发 → 该条 `undelivered`，
   事件 `supplement_undelivered` 交回前端，前端退回队列作为后续任务。

## 7. 边界

- 补充说明只带文字（附件仍留在输入框），单条 ≤ 6000 字，一次运行最多排队 50 条。
- 「最后一段回复已经开始生成」这条时间窗内到达的要求无法改写已生成的文字，按需求 10 退回队列；
  这不是丢弃，前端会紧接着作为下一轮发送。
- 停止按钮仍是唯一的强制中断入口，直发不会触发它。
