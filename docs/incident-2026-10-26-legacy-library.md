# 事故记录：旧素材/成片目录被测试迁移误删（2026-10-26）

## 结论

在做「项目工作区」改造时，自动迁移逻辑把旧版 ZEALMAN 安装目录下的 `素材库`、`媒体库` 内容迁入了一个测试用临时项目目录，测试结束时临时目录被删除。

- 时间：2026-10-26 11:12–11:15（本机）
- 影响目录：
  - `D:\notebook\software\ZEALMAN-H3桌面版10-23-1000-WIN\素材库`（示例1/2/3 的图片与音频，约 36 个文件）
  - `D:\notebook\software\ZEALMAN-H3桌面版10-23-1000-WIN\媒体库`（历史成片，至少 6 个视频）
- 未受影响：
  - `Creation-Studio/data/assets`（6 个素材文件：蓝衣舞姬、少女、武僧、樱花草地、雪山古寺、配音1.mp3）
  - `Creation-Studio/data/uploads`（15 个上传文件）
  - 任务/事件/项目/账号等数据库与 JSON 数据
  - 风格库 `data/styles`

## 原因

1. 首次启动时 `config.importLegacy()` 会把旧 ZEALMAN 的 `assetFolder/saveFolder` 写进配置；本机 `data/config.json` 因此指向了旧安装目录。
2. 新加的自动迁移在「创建项目」时执行，迁移源直接用了 `config.assetFolder/saveFolder`，没有限制在应用自己的 `data/` 目录。
3. 隔离测试的临时数据目录没有隔离 `APPDATA`，于是也读到了旧配置，把旧目录当成迁移源；迁移完成后测试清理把临时目录整个删除。

## 已尝试的恢复

- AutoDL 结果接口按 `remotePromptId` 重查：旧任务返回签名 URL 已 404；本应用的任务返回「工作流不可用」。
- 回收站、卷影副本：均不可用（无记录/无权限）。
- 全盘按旧文件名（snowtp.png、ai008.png、fs.png 等）搜索：进行中，暂无结果。

## 已加的防护

- **取消自动迁移**：启动和创建项目时不再搬迁任何文件，改为设置里的显式按钮。
- 迁移只处理 `config.DATA` 下的 `assets/uploads/media`，不会跟随 `importLegacy` 带进来的外部目录。
- 迁移前先复制备份到 `data/backups/workspace-<时间>/`，结果写 `workspace-migration.json`。
- 隔离测试补上 `APPDATA` 临时目录，避免读到真实旧配置。
