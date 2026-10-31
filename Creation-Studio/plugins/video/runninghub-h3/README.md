# RunningHub H3（国内站 / 国际站）

原生 Node.js 视频渠道插件，不调用 Python，不加载原插件 HTML，也不读取原宿主账号状态。

节点映射的唯一来源是 `docs/runninghub-h3-cn-ai-api-reference.md` 与同名 JSON（核对日期 2026-10-31）。插件内 `workflows.json` 按站别登记 10 个 AI 应用：国内站 6 个、国际站 4 个；每个应用保存提示词节点、时长节点、比例节点与 9 个参考图节点的公开顺序。

## 渠道类型

| 类型 id | 站点 | 默认接口地址 | 应用数 |
| --- | --- | --- | --- |
| `runninghub-h3-cn` | 国内 | `https://www.runninghub.cn` | 6 |
| `runninghub-h3-ai` | 国际 | `https://www.runninghub.ai` | 4 |

两个站点独立配置密钥：`baseUrl` 只允许本渠道所属站点的域名（回环地址除外，便于本地联调），跨站地址会被拒绝。实例类型 `default/plus/ultra`，并发 `maxConcurrent` 默认 3、上限 16。

## 应用

国内站：1080P 二采12+4 HyperVAE、1080P 多参·INT8解码（原1024P）、720P 多参·双采加强（10+4）、736P 无损融合单采、736p 多参·双阶段通用（48G 限制）、官流 736P 武戏/特效。

国际站：1080P 二采12+4 HyperVAE、720P 多参·双采加强（10+4）、736p 多参·提高画质 24G 防爆版、官流 736P 武戏/特效。

同一 1080P 应用在两站的参考图节点顺序不同（国内 `51` 在首位，国际 `51` 在第 6 位），因此不允许跨站复用映射。

## 连接协议

`POST /uc/openapi/accountStatus`（只查账号）→ `POST /openapi/v2/media/upload/binary`（multipart 的 `file`）→ `POST /openapi/v2/run/ai-app/{applicationId}`（`nodeInfoList` + `instanceType`）→ `POST /openapi/v2/query`（`taskId`）→ 下载结果里的视频地址。全部使用 `Authorization: Bearer <API_KEY>`。

系统提供提示词、参考图、时长和画幅；插件把画幅短名（如 `4:3`）还原成应用要求的完整枚举（`4:3 (Standard)`），没有匹配项时落到应用默认值。多输出优先按 `finalOutputNode` 筛选，否则取最后一个视频作为成片。

## 多账号（密钥池）

- `API Key` 每行一个，支持多个账号（逗号/分号也认，重复自动去重）；`账号名` 可选，每行一个，顺序与密钥对应，填 `363 / 364 / 365 / 366` 这类编号。
- 每个账号派生一个调度槽（`每个账号并发` 默认 1，可调到 8），总并发 = 账号数 × 该值；队列里直接显示账号名。
- 任务与账号绑定：提交时记下账号序号，轮询、继续原任务、重试都用同一把 Key（`/openapi/v2/query` 只能查提交它的账号）。任务记录与 `params.json` 落 `accountIndex` 与账号名。
- 某把 Key 失效时，渠道测试会列出第几个账号失败且不回显密钥；用不到删掉那一行即可，其余账号继续工作。

## 能力与边界

- 支持 `execute`（提交并轮询）与 `resumeJob`（用已有 `remotePromptId` 继续查询，不重复上传和提交）。
- 平台未提供取消接口，插件不声明 `cancel`：本地停止只终止轮询，撤回平台生成请在平台侧操作。
- 一个渠道一个密钥；不含多 Key 池、动态导入应用、采样步数控制。
- 任务与 `params.json` 记录 `pluginId`、`pluginVersion`、`site`、`applicationId`，升级插件不会静默换实现。

## 验证

```bash
node --test tests/runninghub-h3.test.js          # 映射、站点校验、提交/轮询/继续、正式服务端到端
node scripts/verify-runninghub-apps.js           # 对照平台公开详情核对 10 个应用的节点，只读不提交
```

真实渠道只做账号状态查询与公开详情核对，未提交付费生成。
