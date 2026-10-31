# 视频渠道插件迁移验收

迁移位置：Creation-Studio/plugins/video。包括 AutoDL 官方H3、管理器（豆包/Gemini）、通用视频接口、RunningHub H3（国内站 + 国际站）四个插件包。

核心通过 src/video-plugins.js 扫描包、注册设置类型、派生模型与资源槽、分发执行/测试/取消/继续。旧 src/manager-video.js 与 src/generic-video.js 保留兼容导出；providers.js 的 AutoDL 方法兼容导出到插件协议实现；旧 src/workflows.json 已移入 autodl-h3/workflows.json。

任务、生成快照和输出 params.json 保存 pluginId/pluginVersion；现有渠道配置、默认渠道、凭据和历史 ID 无须搬动。插件升级后旧任务要求匹配版本，不会静默切换实现。

验收：299 项 Node 回归通过。包括现有 AutoDL 提交/轮询/下载、动作迁移字段、管理器生成与账号选择、队列顺序和既有功能。新增文件插件测试仅注入 manifest+index，自动注册渠道类型与模型，走正式本地 API 创建任务、下载输出并记录版本；异常包和版本缺失测试通过。未提交真实付费生成。

完整接口和首版边界见 plugins/video/README.md。插件变更需要重启服务。回滚备份位于 output/video-plugin-migration-backup-1793429386040，保留现有数据配置，恢复源代码并重启即可。

正式服务验收：17821 已重载，健康检查 200；/api/video-plugins 返回三个插件、零加载错误。原两个渠道 ID 保留；AutoDL 显示五个工作流，管理器显示豆包/Gemini 两个模型。
