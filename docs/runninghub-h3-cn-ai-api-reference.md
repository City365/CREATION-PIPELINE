# RunningHub H3 国内／国际 API 调用记录

核对日期：2026-10-31。范围：用户截图中的国内 6 项、国际 4 项。通过公开应用详情接口逐项核实，浏览器核对两站 API 示例；仅查询账号状态，未上传素材、未提交生成任务。密钥不在本文件或 JSON 附件中。

## 站点与鉴权

| 站点 | API 基地址 | 页面地址特点 |
|---|---|---|
| 国内 | `https://www.runninghub.cn` | `/call-api/api-detail/{id}?apiType=4` |
| 国际 | `https://www.runninghub.ai` | 页面可能有 `/zh-CN/`，API 路径不带它 |

两站分别配置密钥。本次国际账号状态返回 HTTP 200、code=0；这不证明特定应用可生成、余额充足或模型输出正确。国内密钥此前已通过相同账号查询；未拿国内密钥去国际站试探。

## 应用清单

| 站点 | 截图标注 | 实际页面名称 | 应用 ID |
|---|---|---|
| 国内 | 1080P 二采12+4 | [H3｜1080p 多参・二采12+4 HyperVAE](https://www.runninghub.cn/call-api/api-detail/2107825677151068161?apiType=4) | `2107825677151068161` |
| 国内 | 1024P | [H3｜1080P 多参·INT8解码（原1024P）](https://www.runninghub.cn/call-api/api-detail/2108112692224544769?apiType=4) | `2108112692224544769` |
| 国内 | 720P | [H3｜720p 多参·双采加强（10+4）](https://www.runninghub.cn/call-api/api-detail/2107126425336766466?apiType=4) | `2107126425336766466` |
| 国内 | 736P | [H3｜736P-无损融合单采](https://www.runninghub.cn/call-api/api-detail/2109183461906014210?apiType=4) | `2109183461906014210` |
| 国内 | 736P 48G提升画质 | [H3｜736p 多参·双阶段通用(48G限制)](https://www.runninghub.cn/call-api/api-detail/2107451561470418946?apiType=4) | `2107451561470418946` |
| 国内 | 736P武戏 | [H3 ／ 官流736P（武戏/特效）](https://www.runninghub.cn/call-api/api-detail/2112164973278482434?apiType=4) | `2112164973278482434` |
| 国际 | 国际1080P | [H3｜1080p 多参・二采12+4 HyperVAE](https://www.runninghub.ai/zh-CN/call-api/api-detail/2108408815590051841?apiType=4) | `2108408815590051841` |
| 国际 | 国际720P | [H3｜720p 多参·双采加强（10+4）](https://www.runninghub.ai/zh-CN/call-api/api-detail/2108408924982960129?apiType=4) | `2108408924982960129` |
| 国际 | 国际736P提升画质 | [H3｜736p 多参·（提高画质）_24G防爆版](https://www.runninghub.ai/zh-CN/call-api/api-detail/2113984372448813058?apiType=4) | `2113984372448813058` |
| 国际 | 国际736P武戏 | [H3 _ 官流736P（武戏_特效）](https://www.runninghub.ai/zh-CN/call-api/api-detail/2112481800195305473?apiType=4) | `2112481800195305473` |

注意：截图“1024P”当前官方名称已经变为“1080P 多参·INT8解码（原1024P）”。截图国内720P链接的 `apiType=4/2` 是异常后缀，本次用应用 ID 及 `apiType=4` 核对，详情查询成功。国际1080P完整ID为 `2108408815590051841`。

## 连接协议

| 环节 | 方法与路径 | 关键输入 |
|---|---|---|
| 读取应用字段 | `POST /api/webapp/detail` | `{"webappId":"应用ID"}`；本次十项均可不带密钥读取 |
| 测试账号 | `POST /uc/openapi/accountStatus` | `{"apikey":"密钥"}` |
| 上传文件 | `POST /openapi/v2/media/upload/binary` | multipart 的 `file` 字段 |
| 提交应用 | `POST /openapi/v2/run/ai-app/{应用ID}` | `nodeInfoList`、`instanceType` 等 |
| 查询结果 | `POST /openapi/v2/query` | `{"taskId":"任务ID"}` |

账号、上传、提交、查询使用 `Authorization: Bearer <API_KEY>`；JSON 请求使用 Content-Type application/json，上传使用 multipart。上传响应可含 `data.download_url` 和 `data.fileName`，调用时按对应接口的接受格式传递，不传本机路径。

提交参数 nodeInfoList 是节点三元组列表：nodeId、fieldName、fieldValue。提示词、时长、比例、参考图分别映射到下面各应用的公开输入。instanceType 的 default/plus/ultra 对应页面说明的 24G/48G/84G；应用标题中的48G限制需另行核实，不应沿用默认实例。可选 usePersonalQueue、webhookUrl；retainSeconds 为10～180秒且有额外计费，本次未启用。

## 节点映射

下表图片顺序严格记录 `inputNodes` 中公开展示的顺序；这不是已生成验证的 Picture 语义顺序。不能排序节点ID或跨站复用。

| 站点 / 截图标注 | 提示词 | 时长 | 比例 | 图片节点公开顺序（字段均为 image） |
|---|---|---|---|---|
| cn / 1080P 二采12+4 | `263.text` | `259.value` | `252.aspect_ratio` | `51` → `333` → `335` → `350` → `337` → `339` → `341` → `348` → `349` |
| cn / 1024P | `176.prompt` | `151.value` | `177.aspect_ratio` | `150` → `152` → `155` → `156` → `178` → `179` → `180` → `181` → `182` |
| cn / 720P | `848.prompt` | `259.value` | `252.aspect_ratio` | `854` → `856` → `857` → `858` → `859` → `860` → `861` → `862` → `863` |
| cn / 736P | `248.text` | `227.value` | `228.aspect_ratio` | `199` → `188` → `189` → `190` → `191` → `192` → `243` → `244` → `245` |
| cn / 736P 48G提升画质 | `28.prompt` | `27.value` | `29.aspect_ratio` | `66` → `58` → `65` → `59` → `60` → `61` → `62` → `63` → `64` |
| cn / 736P武戏 | `197.text` | `132.value` | `115.aspect_ratio` | `186` → `187` → `188` → `189` → `190` → `191` → `192` → `193` → `194` |
| ai / 国际1080P | `263.text` | `259.value` | `252.aspect_ratio` | `333` → `335` → `350` → `337` → `339` → `51` → `341` → `348` → `349` |
| ai / 国际720P | `848.prompt` | `259.value` | `252.aspect_ratio` | `854` → `856` → `857` → `858` → `859` → `860` → `861` → `862` → `863` |
| ai / 国际736P提升画质 | `28.prompt` | `27.value` | `29.aspect_ratio` | `66` → `65` → `58` → `59` → `60` → `61` → `62` → `63` → `64` |
| ai / 国际736P武戏 | `197.text` | `132.value` | `115.aspect_ratio` | `186` → `187` → `188` → `189` → `190` → `191` → `192` → `193` → `194` |

十项当前公开输入均为9个图片字段、1个提示词、1个时长、1个画幅字段，未公开音频或视频上传字段。页面描述提及多模态能力不等于当前应用API开放对应输入。

时长字段当前值均为15；部分类型是FLOAT，部分是INT。原始通用节点范围不能作为产品支持时长承诺，业务最小/最大时长仍待页面规则或小样生成验证。不得把“默认15”理解为“所有1～15秒都验证通过”。

画幅公开选项为1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9，并带英文完整标签；发送时使用JSON附件中各应用的完整枚举文本。国内原1024P应用当前值为9:16，其余采集项为16:9；底层COMBO默认值可能不同，应明确提交用户选择。

## 结果、待验证项与适配建议

- 提交返回 taskId；查询状态包括QUEUED、RUNNING、SUCCESS、FAILED，结果位于results，保留url、nodeId、outputType。输出及上传链接按页面说明通常仅保留约24小时，应尽快下载落盘。
- 国内、国际同名1080p的图片公开顺序不同；国内48G提升画质和国际24G防爆版的第2/3个图片节点顺序也不同。
- 页面在未登录时显示的cURL可能省略nodeInfoList；不能据此让平台使用示例提示词或示例图片。应从公开inputNodes构造用户自己的请求。
- 两站协议相近，应用ID与映射分别保存；国际插件应独立配置基地址与密钥，继续使用现有JavaScript插件接口，不依赖Python。
- 尚未验证：Picture语义顺序、必填/可选图片细则、真实业务时长上限、最终成片输出节点、实际分辨率、费用和生成可用性。finalOutputNode保持null，不能推测。
- 本次仅形成待适配资料，未替换当前RunningHub插件中的7个旧国内应用，也未添加国际生成渠道。

机器可读附件：[runninghub-h3-cn-ai-api-reference.json](./runninghub-h3-cn-ai-api-reference.json)。该文件不含密钥、作者账号信息、页面示例长提示词或示例图片文件名。
