# 06 API 契约（受影响接口）

- 文档状态：第一、二轮契约基线
- 版本：v1.1
- 更新时间：2026-11-05

通用约定：成功 `{ ok: true, data }`；失败 `{ ok: false, error }` + 4xx/5xx。认证失败 401 `{ auth: true }`。时间均为毫秒整数。

## 1. GET /api/state

- 调用者：登录用户（创作台首屏）。
- 权限：需要登录；只返回当前租户可见项目与数据。
- 变更（REQ-003）：`config.channels.*.apiKey`、`channels.*.apiKey` **不再返回**。

响应关键字段：

```json
{
  "ok": true,
  "data": {
    "config": { "channels": { "llm": [{ "id": "ch-1", "hasKey": true, "masked": "sk-a…9f2c" }] } },
    "channels": { "llm": [{ "id": "ch-1", "hasKey": true, "masked": "sk-a…9f2c" }] },
    "projectId": "proj-1",
    "jobs": [],
    "stats": { "total": 0, "queued": 0, "running": 0 }
  }
}
```

断言：响应文本中不得出现任一已配置 Key 的完整值。

## 2. GET /api/channels?kind=llm|image|video

- 权限：登录用户。
- 变更：去掉 `includeSecrets: true`，返回 `hasKey`、`masked`，不返回 `apiKey`。

## 3. PUT /api/config

- 权限：登录用户（当前无管理员限制；多租户隔离在 REQ-006 处理）。
- 请求可含 `llm`、`autodlKeys`、`concurrency`、`projectRoot` 等。
- 语义：字段中的 Key 为空字符串表示「保持原值」；`autodlKeys[].token` 为空同样保持原值。
- 响应：脱敏后的 `publicView()`。

## 3.1 租户语义（REQ-010）

- `GET /api/state`、`GET /api/channels`、`PUT /api/config` 都按当前登录用户的租户返回/保存。
- `PUT /api/config`：
  - 租户字段：`autodlKeys`、`llm`、`prompt`、`channels`（由渠道接口维护）。
  - 平台字段：`concurrency`、`projectRoot`、`saveFolder`、`assetFolder`、`voiceLibraryFolder`；非平台管理员提交时被忽略。
  - `ui` 自第二轮起是**每用户**设置：登录用户写 `user_prefs`，平台 `config.json.ui` 只作默认值；未登录本机仍写平台默认。
- 平台管理员不会自动看到其它租户的渠道；要管理某个租户，需以该租户用户身份登录。
- 响应结构与字段不变；`apiKey` 仍然只返回 `hasKey/masked`。

## 4. POST /api/channels

- 请求：`{ kind, type, name, baseUrl, apiKey, model, options }`。
- 语义：`apiKey` 为空且 `channelId` 存在时保持原 Key；`clearKey: true` 清空。
- 响应：脱敏后的渠道对象。

## 5. 执行端通道

| 方法 | 路径 | 认证 | 变更 |
| --- | --- | --- | --- |
| GET | `/api/executor/poll` | 通道令牌 | 命令增加 `expiresAt`；过期命令不再下发 |
| POST | `/api/executor/reply` | 通道令牌 | 迟到结果仍被忽略（不变） |
| POST | `/api/executor/blob` | 通道令牌 | 不变 |
| GET | `/api/executor/status` | 登录用户 | 不变 |

命令对象：

```json
{ "id": "uuid", "method": "POST", "path": "/api/tasks", "headers": {}, "bodyBase64": "", "serial": false, "expiresAt": 1762345678901 }
```

断言：超过 `expiresAt` 的命令不出现在任何一次 poll 响应中；管理器本地也拒绝执行过期命令。

## 6. 租户与用户删除

| 方法 | 路径 | 权限 | 变更 |
| --- | --- | --- | --- |
| DELETE | `/api/tenants/:id` | 平台管理员 | 租户下仍有项目时 400 |
| DELETE | `/api/users/:id` | 管理员/租户 owner | 用户名下仍有项目时 400 |

错误示例：

```json
{ "ok": false, "error": "租户下还有项目，先删除或转移项目" }
```

## 6.1 租户配额

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/tenants/:id/quota` | 本租户成员 / 平台管理员 | 返回 `{quota:{maxUsers,maxProjects,maxTasksPerDay}, usage:{users,projects,tasksToday}}` |
| PUT | `/api/tenants/:id/quota` | 平台管理员 | 字段为非负整数，0 = 不限；返回新配额与用量 |

超限时创建接口返回 429：

```json
{ "ok": false, "error": "租户配额已满：今日任务数已达上限 1" }
```

## 6.2 审计日志

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/audit?limit=100&offset=0&tenantId=` | 租户负责人/管理员；平台管理员可看全部 | 平台管理员不传 `tenantId` 时返回所有租户 |

记录动作：`auth.register`、`auth.login`、`auth.login.failed`、`auth.logout`、`user.create/update/delete`、`tenant.create/rename/delete`、`project.create/update/delete`、`config.update`、`channel.create/update/delete`、`event.delete`、`quota.update`。`detail` 只写用户名/名称/字段名，不写密码或密钥。

## 6.3 权限收紧（REQ-011）

- 渠道新增/编辑/删除/设为默认：租户 owner/admin 或平台管理员；成员返回 403。
- `PUT /api/config`：平台的端口/路径/并发仅平台管理员；渠道/Key/提示词仅租户 owner/admin；`ui` 成员可改。
- 设置页对成员隐藏渠道操作按钮，存储目录只读。

## 7. 健康与诊断

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 不泄露内部状态；维持 `{status:"ok"}` |
| — | `data/logs/process.log` | 进程退出/异常证据（非 HTTP） |

## 8. 第二轮新增/变更接口

### 8.1 每用户界面偏好

- `PUT /api/config` 的 `ui` 写当前用户 `user_prefs`；响应与 `GET /api/state` 返回合并后的 `ui`。
- 未登录（本机尚未注册）时仍写平台 `config.json`。

### 8.2 多执行端令牌

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/executor/pair` | 登录用户 | 追加一条令牌；`{name,replace}`；返回完整令牌仅此一次 |
| DELETE | `/api/executor/pair` | 登录用户 | `{id}` 或 `{token}`；只能撤销自己的 |
| POST | `/api/executor/active` | 租户 owner/admin | `{id}` 把该令牌设为 `manager-video` 任务通道 |
| GET | `/api/executor/status` | 登录用户 | 每条令牌 `id/tokenHint/name/online/lastSeen/...`，不返回完整令牌 |

### 8.3 邀请与密码重置

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/invites` | 租户 owner/admin | `{role,expiresInHours}`；返回 `{code,url,expiresAt}` |
| GET | `/api/invites/:code` | 公开 | 返回 `{tenantName,role,expiresAt}` |
| POST | `/api/auth/accept-invite` | 公开 | `{code,username,password}`；创建指定租户/角色并登录 |
| POST | `/api/users/:id/reset-token` | 租户 owner/admin | 返回 `{code,url,expiresAt}`；只能重置本租户成员 |
| GET | `/api/resets/:code` | 公开 | 返回 `{username,expiresAt}` |
| POST | `/api/auth/reset-password` | 公开 | `{code,password}`；旧会话失效 |
| POST | `/api/auth/change-password` | 登录用户 | `{oldPassword,newPassword}`；返回新会话 |

### 8.4 智能体内部项目接口

- `GET /api/internal/projects/:id`：仅本机 + `X-WMD-Internal`；返回 `{id,tenantId}`；不存在 404。
- `/agent/health` 公开；其它 `/agent/*` 由智能体按 `HARNESS_AUTH_MODE=controller` 校验。

### 8.5 配额与审计（第二轮扩展）

- 配额字段增加 `maxStorageBytes`、`maxConcurrentTasks`；用量增加 `runningTasks`、`storageBytes`、`storageFiles`、`storageTruncated`。
- `GET /api/audit` 增加 `integrity`（`{ok,checked,...}`）。
- `GET /api/audit/export?format=csv|json&tenantId=`：权限同 `/api/audit`；CSV 带 UTF-8 BOM；JSON 含 `integrity`。

## 9. 可复现 demo

```bash
# 1. 登录拿 cookie（首次注册见 /api/auth/register）
curl -s -c /tmp/wmd.cookie -H 'Content-Type: application/json' \
  -d '{"username":"qa","password":"qa-pass-123"}' \
  http://127.0.0.1:17821/api/auth/login

# 2. 状态接口不得包含完整 Key
curl -s -b /tmp/wmd.cookie http://127.0.0.1:17821/api/state | grep -c 'sk-'   # 期望 0（无完整 Key）

# 3. 渠道列表脱敏
curl -s -b /tmp/wmd.cookie 'http://127.0.0.1:17821/api/channels?kind=llm'

# 4. 删除仍有项目的租户（期望 400）
curl -s -b /tmp/wmd.cookie -X DELETE http://127.0.0.1:17821/api/tenants/tnt_default
```
