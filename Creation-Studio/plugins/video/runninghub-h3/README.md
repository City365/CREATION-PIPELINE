# RunningHub H3 国内站

原生 Node.js 视频渠道插件，不调用 Python，不加载原插件 HTML，也不读取原宿主账号状态。

接口和节点映射参考用户提供的 RunningHub_H3 v3.9.3：国内站 7 个 AI 应用配置保存在 workflows.json，保留每个应用的参考图节点顺序。

配置：设置 → 视频生成 → 新增渠道 → RunningHub H3 国内站；填写国内站 API Key。接口地址默认为 https://www.runninghub.cn，实例类型默认为 default，可配置 plus/ultra；并发默认为 3，最大 16，实际额度由平台决定。

连接：POST /uc/openapi/accountStatus（仅查询账号）；POST /openapi/v2/media/upload/binary（multipart file）；POST /openapi/v2/run/ai-app/{id}（nodeInfoList）；POST /openapi/v2/query（taskId）；下载查询结果中的视频地址。所有请求通过 Bearer 密钥鉴权。

系统提供提示词、参考图、时长和常见画幅；插件映射至应用各自的节点。多输出优先按 final_output_node 筛选，否则取最后一个视频作为成片，与源插件默认策略相同。

当前不包含国际站、原插件多 Key 池、动态导入新应用、采样步数控制和 Python 自动节点识别。一个渠道配置一个 Key，可建立多个渠道；不会读取或迁移外部账号。远程取消能力尚未声明，本地停止不承诺撤回平台生成。

测试：tests/runninghub-h3.test.js 覆盖节点顺序、应用模型注册、账号查询、图片上传、节点提交、轮询、最终输出筛选、下载和密钥不进入任务记录。真实渠道只执行账号状态查询，未提交付费生成。
