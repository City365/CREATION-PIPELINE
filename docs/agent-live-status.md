# 执行过程标题：实时状态 + 走秒

> 原来标题只有一个「执行中…」，跑 12 分钟也还是这两个字。现在它跟工具在干什么走，
> 后面挂一个自己在走的用时：「准备运行命令 · npm test · 12秒」「已写入文件 · 分集.md · 1分4秒」。

## 后端：把「正在做什么」推成事件

`agent_backend/app/main.py` 在原有的 `updates` 循环里补两种 SSE 事件（legacy 与 harness 共用这条流）：

| 事件 | 时机 | 字段 |
| --- | --- | --- |
| `tool_call` | 模型决定调用工具、工具还没开始跑 | `tool`、`detail`（命令/路径/文件名）、`time` |
| `tool_result` | 工具返回 | `tool`、`ok`、`detail`（失败给原因，成功给路径/输出首行）、`time` |

`detail` 由两个小函数挑出来：`tool_detail(args)` 优先取 `command / path / file_path / target / source / name / file / prompt / query / topic / pattern / step_id`，
`tool_result_detail(text)` 失败优先 `error / message / stderr`，成功取 `path / name / file / url / output / stdout / content / summary`，都截断到 60 字。

事件只进 `pending` 队列，随流推出，不进正文（有单测保证 `delta` 里没有脏东西）。

## 前端：文案映射 + 走秒

`web/app.js`

- `ASK_TOOL_ACTIONS`：每个工具三段文案（准备 / 完成 / 失败），例如
  `run_command → 准备运行命令 / 执行了命令 / 命令执行失败`、
  `write_file → 准备写入文件 / 已写入文件 / 写入文件失败`、
  `generate_image → 准备生成图片 / 已生成图片 / 生成图片失败`，
  18 个工具都覆盖，未知工具回退「准备执行 X」。
- `askApplyEvent`：`tool_call` / `tool_result` 写入 `msg.live`；
  `delta` / `replace` 在「没有工具在跑」时把正在生成的那句尾巴写进状态，形成
  「正在分析请求 · 我先看项目里有哪些文件」这种实时字幕。
- `askHeading(exec, pending, msg)`：运行中输出 `<状态> · <摘要>`；结束后仍是
  `已完成，用时12分4秒`（`askDurationText` 抽出复用）。
- 标题里的 `· 12秒` 由 `askEnsureLiveTicker()` 每秒只改这一小段文字，
  **不整页重绘**——一次长命令跑几分钟也不会卡住，也不会因为没事件而停表。
- 运行中标题前有一个 1.4s 呼吸的小圆点（`.ask-trace-live-text::before`）。

## 验证

- 后端 `tests/test_tool_events.py` 4 条：`tool_detail` / `tool_result_detail` 的取值与截断、
  流里出现 `tool_call` / `tool_result`（含失败 `ok:false` 与原因）、事件排在 `done` 之前、
  `delta` 文本里不含工具噪音。
- 前端 `tests/chat-trace-autoload.test.js` 追加 4 条：18 个工具的三段文案、无工具时
  「正在分析请求」+ 正在写的句子、运行中标题带 `data-since` 与秒数、结束后回到
  「已完成，用时…」。合计 10 条。
- 全量：agent 后端 **201 passed**，控制器 **337 passed**。
- 真实运行（只读，`proj-b1a9643a02`）标题会依次变成：

```
  3.5s  准备查看目录
  3.5s  已查看目录 · D:\…\智能体工作区\对话\live-status-044703
  4.5s  准备读取文件 · D:\…\会话记录.md
  4.5s  已读取文件 · D:\…\会话记录.md
  6.2s  done → 已完成，用时 4 秒
```

（第三个字段的路径是真实工作区路径；上面的输出里手工截断了中间一段。）
