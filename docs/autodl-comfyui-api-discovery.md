# AutoDL ComfyUI 工作流接口逆向：工作流与参数到底是哪来的

探测时间：2026-10-31
目标：`https://autodl.art`
令牌：本机 `video_plugin_西林漫剧\.token_state.json` 解出的 48 位令牌（`wb1:` + base64 混淆，见 `main.py:326-342`）
产物：`_tmp_xilin_diff/workflow_list.json`、`_tmp_xilin_diff/schemas/*.json`（25 份完整 schema）

## 结论先说

西林漫剧插件里那 12 个工作流和全部参数规则，**都是手工抄的常量**，插件从不查询后端。但后端**有现成的 schema 接口，而且完全公开、不需要令牌**：

| 用途 | 接口 | 鉴权 |
|---|---|---|
| **工作流列表** | `GET /api/v1/comfyui/comfyui_workflow/list` | 无 |
| **工作流详情 + 入参 schema** | `GET /api/v1/comfyui/workflows/{workflow_id}` | 无 |
| 提交任务 | `POST /api/v1/comfyui/comfyui_workflow/{workflow_id}` | Bearer |
| 查询任务 | `GET /api/v1/comfyui/comfyui_workflow/result/{task_id}` | Bearer |

前两个是插件完全没用过的接口。

## 一、工作流列表接口

```
GET https://autodl.art/api/v1/comfyui/comfyui_workflow/list
```

响应：
```json
{"code":"Success","data":[
  {"workflow_id":"minimax_h3_zm_u22","name":"H3多图多音频生视频(短剧带货版)","description":"..."},
  ...
]}
```

**实测返回 25 个工作流**。插件 `WORKFLOW_OPTIONS`（`main.py:50-79`）只有 12 个，且注释写着"2026-09-13 与后端逐条核对"——也就是说这套表从 9 月 13 日起就没再同步过。

## 二、工作流详情 / 入参 schema 接口

```
GET https://autodl.art/api/v1/comfyui/workflows/minimax_h3_lightx2v_v5
```

返回字段结构（节选）：

```json
{"code":"Success","data":{
  "uuid":"minimax_h3_lightx2v_v5",
  "name":"H3多图参考生视频",
  "description":"...",
  "input_rules":{
     "duration":  {"node_id":"132","field":"inputs.value","required":false,"type":"integer","default":5,"min":1,"max":10},
     "prompt":    {"node_id":"664","field":"inputs.prompt","required":true,"type":"prompt","min_length":1,"max_length":20000},
     "ref_image_0":{"node_id":"137","field":"inputs.image","required":true,"type":"image","accept_types":["image/jpeg","image/png","image/webp"],"default":"default_local_path:/blank.png;..."},
     "resolution":{"node_id":"665","required":false,"type":"enum","default":"768p竖",
                   "options":[{"label":"480p竖","values":{"inputs.自定义宽":480,"inputs.自定义高":864}}, ...]},
     "seed":      {"node_id":"142","type":"integer","required":false,"default":212238359716024,"min":1,"max":999999999999999}
  },
  "input_example":"{...}",
  "output_example":"{...}",
  "api_reference_url":"https://autodl.art/docs/comfyui_api/",
  "endpoint_info":{"endpoints":[
      {"name":"提交任务","url":"/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_v5"},
      {"name":"查询任务","url":"/api/v1/comfyui/comfyui_workflow/result/{task_id}"}]},
  "price_type":"minimax_h3",
  "billing_config":{"minimax_h3":[
      {"resolution":"480p","price":40,"off_peak_price":30},
      {"resolution":"768p","price":50,"off_peak_price":40},
      {"resolution":"1080p","price":100,"off_peak_price":60}]}
}}
```

`input_rules` 就是权威的入参契约：每个字段的 `type` / `required` / `default` / `min` / `max` / `options` / `accept_types` / `max_length`，一条不缺。插件里那 5 个手工元组（`WORKFLOWS_REQUIRE_IMAGE`、`WORKFLOWS_FIRST_LAST_FRAME`、`WORKFLOWS_AUDIO_DRIVEN`、`WORKFLOWS_TEXT_ONLY`、`WORKFLOWS_WITH_AUDIO`、`WORKFLOW_MAX_DURATION`、`WORKFLOWS_ONLY_736P`）**全都是从这个 JSON 里能推出来的**，而且推得比手工更准。

## 三、后端 25 个 vs 插件 12 个

| 状态 | workflow_id | 名称 | 图 | 音 | 时长 | prompt | 首尾帧 | 分辨率档 |
|---|---|---|---|---|---|---|---|---|
| ★新增 | `minimax_h3_zm_u22` | H3多图多音频(短剧带货版) | 9 | 3 | 1-15 | Y | - | 4 |
| ★新增 | `minimax_h3_zm_nono` | H3多图多音频(影视画质) | 9 | 3 | 1-15 | Y | - | 6 |
| ★新增 | `minimax_h3_zm_u30` | H3多图多音频(超清画质) | 9 | 3 | 1-15 | Y | - | 6 |
| ★新增 | `minimax_h3_801` | H3九图15s(无字幕版) | 9 | 0 | 1-15 | Y | - | 8 |
| ★新增 | `minimax_h3_802` | H3九图15s(画质增强版) | 9 | 0 | 1-15 | Y | - | 8 |
| ★新增 | `minimax_h3_803` | H3九图三音15s(画质增强版) | 9 | 3 | 1-15 | Y | - | 8 |
| ★新增 | `minimax_h3_804` | H3九图15s(多模式版) | 9 | 0 | 1-15 | Y | - | 8 |
| ★新增 | `minimax_h3_805` | H3九图三音15s(多模式版) | 9 | 3 | 1-15 | Y | - | 8 |
| ★新增 | `minimax_h3_z0901` | H3文生视频(高质量创意直出) | 0 | 0 | 1-15 | Y | - | 8 |
| ★新增 | `minimax_h3_z0902` | H3六图生视频(多图一致性创作) | 6 | 0 | 1-15 | Y | - | 8 |
| ★新增 | `minimax_h3_z0903` | H3六图三音频(高质量音画融合) | 6 | 3 | 1-15 | Y | - | 8 |
| ★新增 | `wan2.2animate-v4-motion_retargeting` | 动作迁移 | 0 | 0 | - | - | - | 2 |
| ★新增 | `indextts2-v1` | indextts2（TTS，非视频） | 0 | 0 | - | - | - | 0 |
| 已有 | `minimax_h3_lightx2v_v5` | H3多图参考生视频 | 9 | 0 | 1-10 | Y | - | 9 |
| 已有 | `minimax_h3_lightx2v_v5_15s` | H3多图生视频15秒 | 9 | 0 | 1-15 | Y | - | 6 |
| 已有 | `minimax_h3_b99_003_12s` | H3多图生视频12秒 | 9 | 0 | 1-15 | Y | - | 3 |
| 已有 | `minimax_h3_zm_u24` | H3多图多音频(升级画质) | 9 | 3 | 1-15 | Y | - | 6 |
| 已有 | `minimax_h3_zm_u08` | H3多图多音频(高速版) | 9 | 3 | 1-15 | Y | - | 6 |
| 已有 | `minimax_h3_image_audio_to_video_v2` | H3多图多音频生视频 | 9 | 3 | 1-10 | Y | - | 6 |
| 已有 | `minimax_h3_image_audio_to_video_v2_15s` | H3多图多音频15秒 | 9 | 3 | 1-15 | Y | - | 4 |
| 已有 | `minimax_h3_image_audio_to_video` | H3图生视频-音频同步(对口型) | 1 | 1 | 无 | - | - | 6 |
| 已有 | `minimax_h3_lightx2v` | H3首尾帧生成视频 | 0 | 0 | 1-15 | Y | Y | 6 |
| 已有 | `minimax_h3_b99_002` | H3首尾帧生成视频 | 0 | 0 | 1-15 | Y | Y | 3 |
| 已有 | `minimax_h3_lightx2v_no_pic` | H3文生视频 | 0 | 0 | 1-15 | Y | - | 6 |
| 已有 | `minimax_h3_b99_001` | H3文生视频 | 0 | 0 | 1-15 | Y | - | 3 |

**新增 11 个视频工作流**（动作迁移与 TTS 不算视频生成，插件 README 也明确排除）。

## 四、插件漏掉的新参数（硬编码表里完全没有）

### `seed`
全部 25 个工作流都接受，`integer`，范围 1~999999999999999。插件从来不发这个字段，意味着**同一提示词无法复现同一结果**。做分镜一致性的时候这是硬伤。

### `style_preset`（805 / 804 多模式版）
`enum`，默认 `武打模式-真人-武戏+真实质感`，6 个选项：
```
文戏模式-真人-文戏
文戏模式-真人-文戏+真实质感
武打模式-真人-武戏
武打模式-真人-武戏+真实质感
漫剧模式-漫剧-文戏
漫剧模式-漫剧-武戏
```
插件 UI 里根本没有这个下拉。**"漫剧模式-漫剧-文戏/武戏" 正好是西林漫剧这条线最该用的预设。**

### `mode`（801 / 802 / 803）
`enum`，默认 `高质模式`，2 个选项：`高速模式` / `高质模式`。同样没有暴露。

## 五、分辨率枚举对不上——硬编码会直接出错

老工作流的分辨率 label 不带尺寸：
```json
"options":[{"label":"768p竖","values":{"inputs.自定义宽":768,"inputs.自定义高":1344}}, ...]
```

新工作流带尺寸，而且是**新档位**：
```json
"options":[
  {"label":"480p竖(480*864)"},
  {"label":"480p横(864*480)"},
  {"label":"768p竖(768*1376)"},
  {"label":"768p横(1376*768)"},
  {"label":"1088p竖(1088*1920)"},
  {"label":"1088p横(1920*1088)"},
  {"label":"1440p竖(1440*2560)"},
  {"label":"1440p横(2560*1440)"}]
```

三处不兼容：

1. **数值不同**：老 768p 竖是 `768*1344`，新 768p 竖是 `768*1376`。同一个 label 概念，实际画幅不一样。
2. **新档位插件不认识**：`1088p` / `1440p` 插件 `RESOLUTION_OPTIONS`（`main.py:114-123`）里没有，只有 480/768/736/1080。
3. **字符串不匹配**：插件传给后端的是 `"768p横"`，新工作流的枚举值是 `"768p横(1376*768)"`。**照硬编码表给 805 送 `"768p横"`，后端大概率判非法枚举。**

而且 `minimax_h3_zm_u22` 只有 4 档（480p横/480p竖/768p横/768p竖），插件那套全局 8 档对它也不成立。

## 六、插件那套"契约常量"对应到 schema 的哪一项

| 插件常量 | 真实来源（`input_rules`） |
|---|---|
| `WORKFLOWS_REQUIRE_IMAGE` | `ref_image_0.required == true` |
| `WORKFLOWS_FIRST_LAST_FRAME` | 存在 `first_frame` / `last_frame` 键 |
| `WORKFLOWS_AUDIO_DRIVEN` | 只有 `ref_image_0` + `ref_audio_0` + `audio_duration`，无 `prompt` |
| `WORKFLOWS_TEXT_ONLY` | 无任何 `ref_image_*` |
| `WORKFLOWS_WITH_AUDIO` | 存在 `ref_audio_*` |
| `WORKFLOW_MAX_DURATION` | `duration.max` |
| `WORKFLOWS_ONLY_736P` | `resolution.options` 全为 `736p*` |
| 图片上限 9 张 | `ref_image_*` 键的数量 |
| 音频上限 3 条 | `ref_audio_*` 键的数量 |
| 计费 | `billing_config` |

**一条都不需要手写。** 启动时拉一次列表 + 每个详情，5 秒内全量同步。

## 七、接进 CREATION-PIPELINE 的建议

### 方案：schema 驱动 + 硬编码兜底

1. **启动/首次进入时** `GET /api/v1/comfyui/comfyui_workflow/list`，拿 25 个 `workflow_id`。
2. 并发 `GET /api/v1/comfyui/workflows/{id}`，缓存到本地 `data/autodl-schemas.json`（带 `updated_at`）。
3. 从 `input_rules` 自动推导：
   - 图片槽数量、音频槽数量 → 生成 UI 槽位
   - `required` → 必填校验
   - `duration.max` → 时长上限钳制（替代 `WORKFLOW_MAX_DURATION`）
   - `resolution.options[].label` → 该工作流专属的分辨率下拉（替代全局 8 档）
   - `seed` / `style_preset` / `mode` → 自动生成对应控件
4. 请求体按 `input_rules` 的键名直接组装，不再走"模板占位符 + 5 个元组分支"。
5. 缓存过期（比如 24 小时）或拉取失败 → 用上次缓存；首次拉取失败 → 用内置 12 个兜底。

好处：后端上架第 26 个工作流，你这边重启就自动出现在下拉框，`style_preset`、`mode` 这种新枚举也自动出现，不用改一行代码。

风险点：

- 列表/详情接口目前无鉴权，属公开端点，随时可能加 token 或改结构 → 必须有兜底快照。
- 每工作流的 `resolution.options[].label` 是自由字符串，不能跨工作流复用 → 多工作流批量任务必须逐工作流取枚举。
- `price_type` / `billing_config` 可以用来做成本预估，插件现在完全没用。

## 附件

- `workflow_list.json` — 25 个工作流列表原始响应
- `schemas/{workflow_id}.json` — 25 份完整 schema（含 input_rules / input_example / output_example / billing_config）
