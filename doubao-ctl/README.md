# 豆包本地控制台（doubao-ctl）

直接控制本机安装的豆包客户端 `D:\notebook\software\Doubao\app\Doubao.exe`：
发消息、等回复（含流式中间态）、读会话、切会话、新建对话、中断生成。

## 原理

豆包桌面端是 Chromium/CEF 外壳，带 `--remote-debugging-port=9333` 启动后，
用 Chrome DevTools Protocol 连接到 `doubao://doubao-chat/chat` 页面：

| 操作 | 实现 |
| --- | --- |
| 输入 | 聚焦 `div.ProseMirror[contenteditable="true"]`，`Input.insertText` 写入 |
| 发送 | `Input.dispatchKeyEvent` 回车（等价手按回车） |
| 完成判定 | 最后一条 `receive_message` 的 `data-message-id` 变化 + 文本稳定 1.2s + 无 `message_loading` |
| 读消息 | `message-block-container` / `message_text_content` |
| 会话列表 | `conversation-list-v2-item` 的 `data-conversation-id` |
| 新建 / 切换 | 点击 `create_conversation_button` / 对应会话项（CDP 合成鼠标事件） |

客户端没开调试端口时，程序会把它关掉并带参数重新启动一次（会自动等待界面就绪）。

## 三种用法

### 1. 网页控制台（推荐）

```bat
start.cmd
```

浏览器打开 http://127.0.0.1:18080 ：左侧会话列表、中间对话（生成中会实时长出来）、
底部输入框（Ctrl+Enter 发送），右上角可中断生成，左下角可重新连接客户端。

### 2. 命令行

```bash
node cli.mjs status                 # 连接状态 / 当前会话
node cli.mjs ask "你好"             # 发一条，等完整回复后打印
node cli.mjs read 10                # 读最近 10 条
node cli.mjs ls                     # 会话列表
node cli.mjs open 2                 # 切到第 3 个会话（也支持标题片段或会话 ID）
node cli.mjs new                    # 新建对话
node cli.mjs stop                   # 中断当前生成
node cli.mjs                        # 进入交互式连续对话（/new /read /ls /stop /exit）
```

加 `--json` 输出结构化结果，`--timeout 300000` 改等待上限。

### 3. HTTP API（给别的程序调用）

服务端是 `server.mjs`（默认 18080，改 `DOUBAO_PANEL_PORT`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/status` | 连接状态、当前会话、是否生成中 |
| GET | `/api/state` | 消息列表 + `partial`（流式中间态）+ `busy` |
| GET | `/api/conversations` | 侧边栏会话 |
| POST | `/api/send` | `{"text":"..."}`，立即返回 202，结果看 `/api/state` |
| POST | `/api/new` | 新建对话 |
| POST | `/api/open` | `{"id":"3845..."}` 或 `{"title":"片段"}` |
| POST | `/api/stop` | 中断生成 |
| POST | `/api/reconnect` | 断开重连（客户端被关会自动重启） |

```bash
curl -X POST http://127.0.0.1:18080/api/send -H "content-type: application/json" -d "{\"text\":\"你好\"}"
curl http://127.0.0.1:18080/api/state
```

## 文件

- `src/cdp.mjs` CDP 客户端（WebSocket + Runtime.evaluate + Input 事件）
- `src/app.mjs` 启动/关闭/等待客户端、附加到聊天页
- `src/dom.mjs` 页面侧选择器与探测脚本
- `src/chat.mjs` `DoubaoController`：send / messages / conversations / newChat / open / stop
- `cli.mjs` 命令行；`server.mjs` 面板 + API；`web/` 页面

## 注意

- 只对本机 127.0.0.1 生效，端口 9333（CDP）/ 18080（面板），可用 `DOUBAO_CDP_PORT`、`DOUBAO_PANEL_PORT` 改。
- 调试端口是启动参数，客户端若被普通方式打开，程序会重启它一次；重启期间页面上正在进行的手动操作会丢。
- 同一条消息并发发送会返回“上一条还在生成中”，串行使用。
- 长回答默认等 180s；视频类回答可能更久，用 `--timeout` 或面板的“中断生成”控制。
- 文档类/视频类回答里除了文字还可能带卡片，`read` 只取文字块。
