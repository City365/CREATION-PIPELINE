# 豆包参考图上传假卡住修复

日期：2026-10-25。

## 复现证据

失败任务 cc6ecd41-166a-46c8-8fd7-22ff9b7b11e0 的第一张参考图已完成，第二张在管理器快照中显示 Uploading / 55%，120秒后失败。

只上传复现时，网络记录显示 prepare_upload、ApplyImageUpload、二进制上传、CommitImageUpload 均在约2秒内返回 HTTP 200，而管理器仍连续119秒读到 Uploading / 45%。因此旧诊断里的“上传进度”不能当作当前平台状态。

## 根因和修复

React 在同一DOM节点上保留当前与 alternate 两套 fiber 树。旧读取器只按附件数量匹配并取最后一份 attachmentStates；两份快照数量相同时，会读到未提交的旧 Uploading 状态。

新读取器同时检查两套 fiber，通过 stateNode.current 找到当前提交树，再遍历其 child/sibling 图定位真实 DOM 附件节点，并使用最近层的附件属性。只检查父指针还不够，因为复用节点的 return 链可能仍跨向旧分支。找不到可确认的当前快照时继续等待，不能因为旧快照曾经100%就提前发送。

同时补充逐张上传阶段、百分比、停滞标识、上传状态变化历史和网络错误记录。诊断剔除签名查询参数，不记录请求凭据。账号检查接口现在也返回当前附件状态。

## 验证

- 管理器完整测试53项通过。覆盖同数量旧 Uploading 快照、旧 Normal 快照不能覆盖当前 Uploading、逐张进度回调和诊断脱敏。
- 真实复测两张原图，约6.3秒完成；两张均为 Normal / 100%，取得有效文件标识与宽高，原生 @ 绑定2处成功。上传提交业务码0，各返回1份结果。
- 完整原任务复测：4张参考图全部 Normal / 100%，完整提示词的28处图片引用原生绑定成功，约15.4秒完成，无上传网络或业务错误。证据 data/upload-full-task-fixed-v2.json。
- 测试仅调用管理器 reference-draft 接口，sent=false；没有调用视频生成发送，也没有重试提交原视频任务。

原始诊断和修复后的草稿证据分别保存在管理器 data/upload-live-diagnostics.json、data/upload-live-fixed.json，不纳入Git。

## 第二次卡住：新编辑器里读错了快照（2026-10-25 04:00 之后）

现象和上一次不同：失败任务 8ebc…/f43f8a6e 的第2张图在管理器里一直停在 Uploading 0% / 89%，120秒后报“参考图未确认上传完成”；而网络记录显示 prepare_upload、ApplyImageUpload、TOS 上传、CommitImageUpload 全部 200、businessCode 0、resultCount 1，2秒内就传完了。截图里缩略图已经正常显示，页面还给出了“解释图片”快捷入口。

现场探针（真实账号页面，逐层打印 fiber props）确认了原因：

- 新编辑器每张卡片自己带 `status`、`progressPercent`、`ariaLabel`，上一两层是 `attachmentState`（含 fileName/fileKey/uploadPercent/imageWidth/imageHeight），这些才是页面真正渲染的数据。
- 与之等长的 `attachmentStates` 数组现在位于卡片上方第12层甚至更远；更近的地方还留着一份旧的 `attachmentStates` 包装快照，它不会跟着上传结束更新。
- 旧读取器只向上找8层的 `attachmentStates`，于是要么读不到（返回空），要么读到那份停在 89% 的旧包装快照。两种情况都会让“上传完成”永远不成立，只能等满120秒报错。

修复（src/adapters/attachment-state.js）：仍只认已提交的 fiber 树，但解析顺序改成以卡片自身的 props 为准，用 `attachmentState` 补文件标识和宽高，再用 DOM 顺序对位的 `attachmentStates` 兜底；近处旧快照不再能压过卡片自身的 Normal 状态。src/automation.js 的完成判定改用同一轮已读到的状态，避免同一循环里重复求值。

验证：

- 管理器完整测试55项通过，新增用例“新编辑器在包装数组停在89%时按卡片自身状态判定完成”。
- 真实账号草稿复测4张图：全部 Normal / 100%，带有效 fileKey 与宽高，约12.3秒完成（此前是120秒失败）；3处图片引用原生绑定成功。证据 data/verify-upload-after-fix.json、data/doubao-tag-draft.png。
- 只调用 reference-draft 草稿接口，sent=false，没有提交视频生成。

旧版的父链读取（沿 return 找8层 `attachmentStates`、用最后一份快照）已经删除。现在找不到已提交 fiber 树时直接返回空，让上传确认超时报错，不再把父链旧快照当成完成。删除后完整测试54项通过，真实草稿复测2张图约7.7秒完成、2处绑定成功（data/verify-upload-no-legacy.json）。
