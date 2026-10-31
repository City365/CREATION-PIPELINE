# 视频渠道插件（接口 v1）

视频渠道统一放在本目录，每个插件一个子目录。应用启动时扫描 manifest.json，重启创作台服务后生效。无需修改 src/channels.js、src/workflows.js 或任务执行分支。

## 已迁移

- autodl-h3：AutoDL 官方H3，五个公开工作流，保留两个旧工作流 ID 的历史解析。
- browser-manager：豆包 / Gemini 浏览器管理器，包括账号槽位、提交、轮询、取消、继续原任务与结果取回。
- generic-video：OpenAI 视频兼容与通用任务接口。

现有渠道 type、渠道 ID、API Key、默认设置、任务 ID 不变。凭据仍在应用配置中，插件包不保存用户密钥。

## 包结构

manifest.json 定义 id、name、version（三段式）、apiVersion（当前为 1）、entry、provider、channelTypes（沿用设置表单 fields 契约）。index.js 导出适配器。插件协议实现和模型配置放在自己的目录中。

## 适配器接口

- workflows(channel)：返回标准工作流数组，包含唯一 id、channelId、channelType、label、images/audios/videos、时长选项、尺寸类型和枚举等；系统附加 pluginId/pluginVersion。
- slots(channel, config)：返回调度资源槽，包含 key、id（渠道 ID）、provider、name，可选 platform。
- execute(ctx)：执行一次任务，通过 ctx.touch/log 报告进度，通过 ctx.checkCanceled 检查停止，通过 ctx.saveOutputs/writeJobMeta 使用系统保存能力；完成后由核心更新终态。失败抛 Error。
- test(channel)：返回 {ok,message}，说明实际验证范围；不默认触发付费生成。
- cancel(channel, remoteId)：可选，远程取消；不支持时仅停止本地执行。
- resumeJob(job, ctx)：可选，继续查询原任务，避免盲目重复生成。
- resolve(id, channels)、legacy()：可选，旧工作流 ID 兼容入口。

插件内部可实现 submit/poll 等协议方法，由 execute 组合调用；首版迁移保留现有渠道的轮询和恢复语义。

ctx 提供 job、workflow、signal（含 canceled）、slot、timeoutMs、sleep、touch、log、checkCanceled、dataUrl、jobDir、saveOutputs、writeJobMeta、outputName 及已有配置和存储服务。可参考本目录三个已迁移插件及 tests/video-plugins.test.js 的独立示例。

## 生命周期与范围

插件在服务启动时加载，未做热更新。任务保存插件标识和版本；重启后版本不匹配会明确阻止执行，需恢复相同版本后继续。运行中的进程保持已加载实现。manifest 无效、重复标识、入口越界、接口版本不支持的包会跳过并通过 GET /api/video-plugins 返回诊断。

首版是受信任的本地 Node.js 代码插件，拥有应用进程权限，尚无代码沙箱、在线商店、ZIP 安装或多版本并存。将已审阅的插件目录放入这里即可；安装或更新后重启服务，再在设置中创建渠道、填写凭据。
