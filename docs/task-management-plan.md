# 任务管理（事件）改造实施计划

- 版本：v1（计划稿）
- 范围：CREATION-PIPELINE / Creation-Studio（创作管理端）
- 状态：待评审，未开始实施
- 原则：**只加聚合层，不重写执行器**；所有接口先冻结 v1，再分阶段落地

---

## 0. 术语

| 术语 | 含义 |
|---|---|
| 事件（Event） | 一次"创建任务"的动作产物：单条生成或批量，都算一个事件 |
| 条目（EventItem） | 事件里的单条执行单元，指向现有的 `job`（视频）或 `imageTask`（图像） |
| 探针（Probe） | 读取远端真实状态的只读动作，输出 `running/done/failed/unknown` + 证据 |
| 取消能力 | `none`（不可取消）/ `local`（只停本地等待）/ `remote`（通知平台停止） |
| 计费时点 | `on-submit`（提交即扣）/ `on-success`（成功才扣） |
| 六号接口 | 视频生成适配器契约，见第 9 节；本期只预留，不在创作管理端实现远端 |

---

## 1. 现状盘点（代码锚点）

| 能力 | 位置 | 备注 |
|---|---|---|
| 视频任务队列 | `src/jobs.js`（`pump()` L141、`addJobs`、`setHeld`、`reorder`、`slotStats`、`readLog`） | 已有 order / held / repeat / slot 并发 |
| 视频任务 API | `src/server.js` `/api/jobs*` | 列表、创建、取消、续跑、重试、暂停 |
| 批量解析 | `src/batch.js` `parseBatch` / `toJobInputs` | 只负责生成任务序列，生成后不保留事件 |
| 图像任务队列 | `src/image-tasks.js`（`enqueue`/`pause`/`resume`/`retry`） | 与视频队列独立 |
| 图像生成 | `src/imagegen.js`（`generate`/`saveImages`/`collectImages`） | 同步请求，fetch 只有超时 abort |
| 任务日志页 | `web/app.js` `renderLogs()` L5694，两个 tab | 视频生成日志 / 图像生成日志 |
| 任务页 | `web/app.js` `renderJobs()` L1998 | 运行态任务表 |
| 批量页 | `web/app.js` `renderBatch()` L5549 | 导入/解析/提交 |
| 顶栏 | `web/index.html` L25–35 | 9 个页签，窄屏被压缩（"项目"竖排） |
| 管理器任务 | `Video-Generation-Manager/src/tasks.js` | 队列 + `requestedAccountId` + 账号池 |
| 管理器取消 | `Video-Generation-Manager/src/automation.js` L220 | 仅 abort + 关页面，无远端探针 |
| 重启语义 | `src/jobs.js` L34 | running/queued 一律标 `failed` |

---

## 2. 目标与总体验收

### 2.1 目标

1. 顶栏合并入口：`批量任务` + `任务` → **任务管理**，窄屏不再挤压；
2. 引入 **Event** 聚合：创建 → 调度 → 监控 → 归因闭环；
3. 单条生成（创作台/图像台）自动生成单条目事件，可追溯；
4. 条目级日志完整保留，可从事件下钻；
5. 远端真值可探：重启不再"一刀切 failed"，改 `unknown + 可续跑`；
6. 取消语义按能力声明，UI 不撒谎。

### 2.2 总体验收（完成标准）

- [ ] 一次批量导入生成 1 个事件、N 个条目，进度/成功率实时正确；
- [ ] 事件可整组暂停/继续/取消，取消后不会误报"已停止平台生成"；
- [ ] 服务重启后，未完成事件标 `interrupted/unknown`，可续跑或放弃；
- [ ] 事件详情能下钻到现有单条日志，字段与现在一致；
- [ ] 批量 20 条跑完，报告含成功率、耗时、失败归因（渠道/账号/错误码）；
- [ ] 顶栏在 1280/1440/1920 宽度下不换行、不竖排。

### 2.3 非目标（本期不做）

- 不做依赖图 / DAG 编排；
- 不做 cron 定时（只留 `schedule.startAt` 字段，不实现 UI）；
- 不做多用户/权限；
- 不改管理器的账号池调度策略；
- 不实现六号接口的远端（只在创作管理端预留适配层）。

---

## 3. 架构与模块边界

```
web/app.js  ──►  任务管理页（事件列表 / 详情 / 创建）
                     │  fetch
                     ▼
src/server.js ──►  /api/events*  ──►  src/events.js（Event 聚合 + 调度）
                                          │  引用
                                          ├─► jobs.js（视频执行器，保持不变）
                                          └─► image-tasks.js（图像执行器，保持不变）
                                          │
                                          └─► src/probe.js（三层探针 + 能力矩阵）
                                                ├─ 本地队列状态
                                                ├─ 管理器 /api/tasks/{id}
                                                └─ 页面/网络证据（best-effort）
```

新增文件（计划）：

| 文件 | 职责 |
|---|---|
| `src/events.js` | Event 存储、状态机、调度、聚合统计 |
| `src/events-routes.js` | `/api/events*` 路由（或并入 server.js） |
| `src/probe.js` | 探针 + `capabilities` 能力矩阵 |
| `src/video-adapter.js` | 六号接口的本地适配层（本期用 managerVideo 实现） |
| `web/events.js` | 任务管理页渲染与交互（避免 app.js 继续膨胀） |
| `tests/events.test.js` | 事件状态机/调度/接口单测 |
| `tests/probe.test.js` | 能力矩阵与 unknown 收敛单测 |

---

## 4. 数据模型与状态机（冻结 v1）

### 4.1 Event

```json
{
  "schemaVersion": 1,
  "id": "evt_01J...",
  "title": "第 3 集 · 门口晨戏",
  "source": "batch | studio | image | api",
  "spec": {
    "channelId": "ch-xxx",
    "referenceAssets": ["asset-id-1", "asset-id-2"],
    "items": [
      {
        "key": "shot-1",
        "prompt": "六段式提示词…",
        "images": [{"path": "D:/…/13_门口.png", "role": "reference"}],
        "params": {"duration": 15, "aspectRatio": "16:9", "resolution": "720p"}
      }
    ]
  },
  "policy": {"concurrency": 1, "onItemFail": "continue", "retries": 0},
  "schedule": {"order": 0, "startAt": null},
  "status": "draft | queued | running | paused | partial | completed | failed | canceled | interrupted",
  "items": [
    {
      "id": "evt_01J..._001",
      "refType": "job | imageTask",
      "refId": "job-mv...",
      "status": "queued | running | success | failed | canceled | skipped | unknown",
      "attempts": 0,
      "error": null,
      "cancelMode": "none | local | remote",
      "billing": "on-submit | on-success"
    }
  ],
  "stats": {"total": 0, "queued": 0, "running": 0, "done": 0, "failed": 0, "skipped": 0, "etaSeconds": null, "cost": null},
  "createdAt": 0, "startedAt": null, "finishedAt": null
}
```

### 4.2 状态机

```
事件：draft ─► queued ─► running ─┬─► completed        （全部成功）
                                   ├─► partial          （继续跑完但有失败）
                                   ├─► failed           （onItemFail=stop 且首条失败）
                                   ├─► canceled         （整组取消）
                                   └─► interrupted      （服务重启，待续跑）
          running ⇄ paused
条目：queued ─► running ─┬─► success
                         ├─► failed
                         ├─► canceled（remote/local）
                         ├─► skipped（事件失败/取消后未派发）
                         └─► unknown（探针无法确认）
```

聚合规则：

- `stats.done = success + failed + skipped`；
- 首个条目进入 running → 事件 `running`、写 `startedAt`；
- `unknown` 不参与成功率分母，单独计数；
- 事件终态必须同时满足：所有条目终态 + 无 `running`。

### 4.3 能力矩阵（`GET /api/capabilities` 返回）

| provider/kind | cancel | probe | billing | 说明 |
|---|---|---|---|---|
| `local-queue`（未提交） | `remote` | `local` | `on-submit` 未发生 | 真取消 |
| `doubao-video`（管理器） | `remote` **待取证** | `manager` | `on-submit` | 页面停止控件确认后升级 |
| `gemini-video` | `local` | `page` | `on-submit` | 已提交不可撤回 |
| `openai-images` / `gemini-image` | `none` | `http` | `on-submit` | 取消=丢弃结果 |

> `doubao-video.cancel` 默认按 `local` 实现，取证通过后再改 `remote`（见 P3）。

### 4.4 存储

- 事件：`data/events.json`（≤200 条，滚动归档到 `data/events-archive/`）；
- 条目日志：继续用现有 `jobs.logs` / `generation_logs`，不复制；
- 迁移：首次启动把现有 `jobs.json` 按 `createdAt` 聚成"历史事件（只读）"，不改变执行语义。

---

## 5. 接口契约（冻结 v1）

### 5.1 一~五号接口（创作管理端内部 REST）

统一前缀 `/api`，JSON，鉴权沿用现有会话/token；写操作需 `Idempotency-Key`。

**1）创建事件**

```
POST /api/events
Idempotency-Key: <uuid>
{
  "title": "…",
  "source": "batch|studio|image|api",
  "spec": { "channelId": "…", "items": [ … ] },
  "policy": {"concurrency": 1, "onItemFail": "continue", "retries": 0},
  "schedule": {"order": 0, "startAt": null}
}
→ 201 Event
错误：400 INVALID_SPEC | 409 IDEMPOTENCY_CONFLICT | 422 CHANNEL_UNAVAILABLE
```

**2）事件列表 / 详情**

```
GET /api/events?status=&source=&limit=50&cursor=
→ 200 { "events": [Event], "stats": {…} }

GET /api/events/{id}
→ 200 Event（含 items 摘要）
```

**3）事件控制**

```
POST /api/events/{id}/pause
POST /api/events/{id}/resume
POST /api/events/{id}/cancel   { "mode": "auto|local" }
POST /api/events/{id}/retry-failed
→ 200 Event
错误：409 EVENT_STATE_INVALID
说明：cancel 只停止未派发条目；已提交条目按 capability 处理，响应里返回逐条结果：
{ "canceledItems": [{"id","refId","mode":"remote|local|none","note"}] }
```

**4）条目与日志下钻**

```
GET  /api/events/{id}/items?status=&cursor=
GET  /api/events/{id}/items/{itemId}/log     → 复用现有 jobs.readLog / generation_logs
POST /api/events/{id}/items/{itemId}/retry
POST /api/events/{id}/items/{itemId}/skip
```

**5）探针与能力**

```
GET  /api/capabilities
→ { "providers": [ {"id","kind","cancel","probe","billing"} ] }

POST /api/tasks/{id}/probe        （id 可为 job 或 imageTask）
→ { "refId","refType","remote":"running|done|failed|unknown","evidence":{"source","at","detail"},"confidence":0.0-1.0 }

POST /api/tasks/{id}/stop         （P3，需 capability=remote）
→ { "stopped": true, "mode": "remote", "confirmedAt": 0 }
错误：501 CAPABILITY_UNSUPPORTED
```

### 5.2 错误码表（冻结）

| code | HTTP | 含义 |
|---|---|---|
| `EVENT_NOT_FOUND` | 404 | 事件不存在 |
| `EVENT_STATE_INVALID` | 409 | 当前状态不允许该操作 |
| `INVALID_SPEC` | 400 | spec 结构/素材引用非法 |
| `IDEMPOTENCY_CONFLICT` | 409 | 同一 Key 不同载荷 |
| `CHANNEL_UNAVAILABLE` | 422 | 渠道/账号不可用 |
| `CAPABILITY_UNSUPPORTED` | 501 | 平台不支持该取消/探针 |
| `REMOTE_UNKNOWN` | 200 | 探针无法确认（业务态，不是错误） |

### 5.3 事件流（可选，P4）

```
GET /api/events/stream  (text/event-stream)
event: event-updated  data: {id,status,stats}
event: item-updated   data: {eventId,itemId,status}
```
未实现前，前端 3 秒轮询 `GET /api/events?status=running`，与现状一致。

---

## 6. 分阶段任务

### P0 · 入口合并与顶栏自适应（1–2 天）

**改动**

- `web/index.html`：删除 `批量任务`、`任务` 两个页签，新增 `任务管理`（`data-route="tasks"`）；Ctrl 快捷键重排为 1–8；
- `web/app.js`：`setRoute` 白名单加 `tasks`，`render()` 分派 `renderTasks()`；`renderTasks()` 内部先用现有 `renderJobs()` + `renderBatch()` 输出，保证功能不丢；
- `web/h3.css`：顶栏 `white-space:nowrap`、`flex:0 0 auto`、`min-width:0`；`@media (max-width:1440px)` 缩 gap/字号；`@media (max-width:1180px)` 隐藏品牌副标题、服务文字改图标；`项目` 按钮加 `flex-shrink:0`。

**验收**

- [ ] 1280/1440/1920 宽度下顶栏单行，无竖排；
- [ ] 任务管理页能看到原任务表与批量入口；
- [ ] 旧链接 `#jobs`、`#batch` 重定向到 `#tasks`（不 404）。

**回滚**：只改前端，保留旧路由常量，回滚即还原两个入口。

---

### P1 · 事件模型与创建/详情（3–4 天）

**改动**

- 新增 `src/events.js`：`create/list/get/updateStatus/aggregate`；`create` 内部调用 `jobs.addJobs` / `imageTasks.enqueue`，把返回 id 写进 `items[].refId`；
- 新增 `src/events-routes.js`：实现 5.1 的 1–4 号接口；
- `src/jobs.js`：`addJobs` 支持可选 `eventId`，状态变更时 `emitter.emit('job:update')`；
- `src/image-tasks.js`：`enqueue` 支持 `eventId`，`data.finish` 后触发事件聚合；
- `web/events.js` + `web/app.js`：事件列表（状态/进度/成功率）、详情抽屉、创建表单（单条 + JSON 批量，复用 `batch.parseBatch`）；
- 工作台生成：`renderStudio` / 图像台提交时创建一个单条目事件（`source: studio|image`）。

**验收**

- [ ] 批量 JSON 导入 → 1 事件 N 条目，`stats` 与实际一致；
- [ ] 条目失败不影响事件聚合正确性；
- [ ] 详情可下钻单条日志；
- [ ] 单条生成出现在事件列表（可过滤噪音）。

**回滚**：`H3_EVENTS=0` 时 `renderTasks` 退回旧视图，`/api/events` 返回 404。

---

### P2 · 调度与整组控制（3–5 天）

**改动**

- `src/events.js` 增加调度器：按 `order` 派发、`policy.concurrency` 限流、`onItemFail=stop` 时置 `skipped`；
- 整组 pause/resume/cancel：复用 `jobs.setHeld`、`jobs.cancel`、`imageTasks.pause/resume`；
- 取消能力：读 `probe.capabilities`，逐条返回 `mode`；UI 文案按 `remote/local/none` 显示；
- `web/events.js`：条目操作（重试/跳过/看日志）、失败策略展示。

**验收**

- [ ] 整组暂停后不再派发新条目；
- [ ] 取消后已提交条目不显示为"已停止平台生成"；
- [ ] `onItemFail=stop` 时剩余条目为 `skipped`，事件 `failed`；
- [ ] 重跑失败项生成新 requestId，不触发去重。

**回滚**：调度器开关 `H3_EVENT_SCHEDULER=0`，事件退化为"顺序执行 + 人工操作"。

---

### P3 · 探针与重启对账（3–5 天）

**改动**

- 新增 `src/probe.js`：`probeJob(job)` / `probeImageTask(t)` / `probeRemote(ref)`；
  - 管理器：`GET {manager}/api/tasks/{id}` → 映射 `queued/running/completed/failed`；
  - Gemini/页面：best-effort 读会话状态；
  - 输出 `unknown` + `evidence`；
- `src/jobs.js` L34：启动不再直接标 `failed`，改为 `probe` 后决定 `interrupted`（可续）或 `failed`（明确失败）；
- 管理器新增 `POST /api/tasks/{id}/stop`：先做真机取证，确认停止控件后实现点击 + 轮询确认；无控件则保持 501；
- 管理器 `GET /api/tasks/{id}` 增加 `remoteState` 字段（只读，供探针使用）；
- UI：`unknown` 状态与"继续查询/放弃"动作。

**验收**

- [ ] 重启后未完成条目 → `interrupted/unknown`，可整组续跑；
- [ ] 管理器侧 stop：取证通过后能确认平台状态变化；未通过时返回 501；
- [ ] 图像任务取消 → `canceled(local)`，成本照记，结果可选丢弃。

**回滚**：`H3_PROBE=0` 恢复旧语义（重启即 failed）。

---

### P4 · 监控分析（2–3 天）

**改动**

- `GET /api/events/{id}/report`：成功率、P50/P90 耗时、失败归因（provider/channel/账号/错误码）、配额消耗；
- 导出 JSON/CSV；事件列表加"近 7 天成功率"小图；
- 可选 SSE `/api/events/stream`。

**验收**

- [ ] 20 条批量跑完，报告字段完整且与日志一致；
- [ ] 失败归因能区分"平台失败 / 本地放弃 / 探针未知"。

---

## 7. 测试计划

| 层级 | 内容 |
|---|---|
| 单测 | 状态机迁移、聚合规则、幂等、能力矩阵、`unknown` 不污染成功率 |
| 接口 | `/api/events*` 全量 happy path + 409/422/501 |
| 浏览器 | 任务管理页：合并入口、窄屏顶栏、事件创建/详情/下钻（扩展 `tests/image-tasks-browser.js` 或新增 `tests/events-browser.js`） |
| 真机取证 | 豆包生成页停止控件（只读探测，不提交）；确认后写进能力矩阵 |
| 回归 | 现有 62 + 65 项测试保持全绿；`#jobs`/`#batch` 旧路由兼容 |

---

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 事件/日志膨胀 | `jobs.json` 全量进内存 | P1 事件单独文件；P4 条目日志拆 SQLite 或按事件分文件 |
| 重启语义变化 | 下游脚本误判 | 保留 `H3_PROBE=0` 开关；`interrupted/unknown` 不参与成功率 |
| 取消语义误导 | 用户以为停掉了 | 能力矩阵 + 逐条返回 `mode` + UI 文案 |
| 批次并发撞额度 | 大面积失败 | 事件并发默认 1；调度读账号池余量后再放行 |
| 顶栏改动破坏快捷键 | 用户习惯 | 快捷键按新顺序重排并在 tooltip 标注 |
| 双端接口漂移 | 六号接口对接失败 | 接口 v1 冻结 + 契约测试（见第 9 节） |

---

## 9. 六号接口：视频生成适配器（预留，创作管理端后续接入）

> 视频生成管理在创作管理端；本期只在创作管理端定义并落地 **适配层**，管理器侧接口保持现状，后续按此契约改造接入。

### 9.1 代码内接口（`src/video-adapter.js`）

```js
module.exports = {
  id: 'manager-doubao',
  capabilities: () => ({ cancel: 'local', probe: 'manager', billing: 'on-submit' }),
  create(input, ctx)  // {model,prompt,images[],duration,ratio,resolution,watermark,providerOptions}
                      // => {taskId, provider, status}
  poll(taskId, ctx)   // => {status:'queued|running|succeeded|failed', progress, message, videos:[{url,duration,size}], error}
  cancel(taskId, ctx) // => {canceled:boolean, mode:'remote|local|none', confirmedAt}
  probe(taskId, ctx)  // => {remote:'running|done|failed|unknown', evidence, confidence}
  classify(error, ctx)// => {code, retryable, scope:'account|channel|task'}
}
```

### 9.2 HTTP 契约（管理器侧未来实现，冻结 v1）

```
POST /v1/video/generations
Authorization: Bearer <token>
{ "model":"", "prompt":"", "images":[{"url":"","role":"reference|first_frame|last_frame"}],
  "duration":15, "aspectRatio":"16:9", "resolution":"720p", "watermark":false,
  "providerOptions":{}, "requestId":"<uuid>" }
→ 202 { "taskId":"", "status":"queued" }

GET /v1/video/generations/{taskId}
→ 200 { "taskId":"", "status":"queued|running|succeeded|failed|canceled",
        "progress":0-100, "message":"", "videos":[{"url":"","duration":15.05,"size":42368394}],
        "error":null, "remote":"running|done|failed|unknown" }

POST /v1/video/generations/{taskId}/cancel
→ 200 { "canceled":true, "mode":"remote|local|none", "confirmedAt":0 }
   501 { "error":{"code":"CAPABILITY_UNSUPPORTED"} }

GET /v1/capabilities
→ 200 { "providers":[{"id":"doubao","cancel":"remote|local|none","probe":"manager","billing":"on-submit"}] }
```

状态映射（必须一致）：

| 管理器 | 六号接口 |
|---|---|
| `queued` / `starting` | `queued` |
| `uploading` / `submitting` / `generating` / `downloading` | `running` |
| `completed` | `succeeded` |
| `failed` / `interrupted` | `failed` |
| `cancelled` | `canceled` |

### 9.3 接入前置条件（那边改造时要满足）

1. `GET /v1/video/generations/{id}` 返回真实 `remote`，不得用本地状态冒充；
2. `cancel` 必须返回 `mode`，`501` 表示平台不支持；
3. 参考图接受 URL；本地路径由管理端桥接转换（见 `docs` 中画布集成说明）；
4. `requestId` 幂等；
5. 接口带版本前缀，v1 字段只增不改。

---

## 10. 排期与里程碑

| 阶段 | 工期 | 依赖 | 交付物 |
|---|---|---|---|
| P0 入口合并 + 顶栏 | 1–2 天 | 无 | 可点的任务管理页 |
| P1 事件模型 | 3–4 天 | P0 | `/api/events*` + 详情/创建 |
| P2 调度与控制 | 3–5 天 | P1 | 整组操作 + 失败策略 |
| P3 探针与对账 | 3–5 天 | P1；管理器取证 | `unknown` + 可续跑 + stop |
| P4 监控分析 | 2–3 天 | P2、P3 | 报告与导出 |

建议里程碑：**M1 = P0+P1（第一周）**，跑一轮真实批量；**M2 = P2+P3（第二周）**；**M3 = P4**。

---

## 11. 待确认事项

1. "人物"页是否并入任务管理（若并入，作为事件筛选维度，而非独立 tab）；
2. 六号接口的最终归属与地址（本期只冻结契约，不接线）；
3. `doubao-video` 取消能力取证窗口（需要一条真实生成，只读探测控件）；
4. 事件归档策略：保留 200 条后归档，是否够用。
## 实施进度

| 阶段 | 状态 | 提交 |
|---|---|---|
| P0 入口合并 + 顶栏自适应 | 已完成 | `d4646ee` |
| P1 事件模型 + 创建/详情/下钻 | 已完成 | `b0587aa` |
| P2 调度 + 整组控制 | 已完成 | `dfa833d` |
| P3 探针 + 重启对账 + 能力矩阵 | 已完成（豆包 stop 待真机取证） | 见本提交 |
| P4 监控分析 | 未开始 | — |
