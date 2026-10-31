# 对话内容格式协议（正文 / 组件混排）

一条回复里只允许两种格式，靠**标签边界**区分，不允许第三种。

## 1. 正文 = Markdown

普通文字、标题、列表、表格、代码块、引用。正文里出现的 `<` `>` 一律当纯文字处理，
例如 `a < b`、"小于 5 秒"、路径 `<assets/a.png>` 都原样显示。

正文里可以出现的**非组件**标记（创作规范的一部分，不会被吞）：

| 标记 | 含义 |
| --- | --- |
| `<Picture N>` | 第 N 张参考图 |
| `<Subject N>` | 第 N 个主体 |
| `<Audio N>` | 第 N 段音频 |
| `<d>[Chinese] …</d>` | 台词 |
| `[Shot N]` | 第 N 个镜头 |

代码块（```）和行内代码（`` ` ``）里讨论的标签，也一律按文字处理，不当组件渲染。

## 2. 组件 = 白名单标签

标签名**大小写不敏感**（`<Card>` = `<card>`），下面这些是唯一允许的标签：

- 容器：`box` `card` `panel` `row` `col` `stack` `group` `grid` `grid-item`
- 内容：`text` `image` `asyncimage` `asyncimagegroup` `divider` `tag` `link`
- 表单：`button` `input` `textarea` `radio-group` `checkbox-group` `radio` `option`
- 别名：`Column`→col、`Section`/`Container`→box、`Caption`/`Label`→text、`GridItem`→grid-item、`Chip`/`Badge`→tag、`Hr`→divider、`Select`→radio-group
- 状态：`{@body const [x,setX] = DIL.useState("默认值")}`
- 动作：`GenUI.issueNewTurn("…")`、`GenUI.copy("…")`

常用属性：`text` 的 `weight`/`size`/`color`；`grid` 的 `columns`；`button` 的 `block`/`variant`；
`asyncimage` 的 `query`（英文画面描述）与 `aspectRatio`（`16:9` / `9:16` / `1:1` / `3:4` / `4:3`）。

### 混排规则

1. 正文与组件可以交替出现，顺序即渲染顺序。
2. 组件标签**不要写在句子中间**；单独成行或成块。
3. 标签必须闭合：成对写 `</text>`，或自闭合 `<AsyncImage … />`。
4. 只有叶子组件（`<text>`、`<AsyncImage/>`）时贴正文排，外面不再套卡片边框；
   出现 `box`/`grid` 等容器时才渲染成卡片。

## 3. 兜底：任何不认识的标签都不进正文

渲染器（`web/app.js` 的 `guLocateBlock` / `guScrubLeaks` / `guFixStrayTags`）按以下顺序处理：

| 情况 | 处理 |
| --- | --- |
| 白名单标签 | 渲染成组件 |
| 白名单标签但漏进 Markdown 段落 | 吞掉标签本身 |
| 白名单外、带属性或自闭合的组件式标签（`<VideoPlayer src=…/>`） | 整段吞掉 |
| 白名单外、无属性的正文标记（`<Picture 1>`、`<d>…</d>`） | 原样保留 |
| 引号没写完 / 流式中途的残缺标签 | 有 `query`/`prompt` 就重建成 `<AsyncImage …/>`；没有就丢掉整行 |
| 标签忘闭合 | 只吃掉该行，后面的正文继续按 Markdown 渲染 |
| 代码块 / 行内代码里的标签 | 原样当文字 |

结果：用户永远不会在对话里看到 `<AsyncImage query="…"/>` 这类协议源码。

## 4. 相关实现与测试

- 渲染：`Creation-Studio/web/app.js`（`GU_RENDER_TAGS`、`guLocateBlock`、`guSegments`、`guScrubLeaks`、`guFixStrayTags`、`guRenderBlock`）
- 样式：`Creation-Studio/web/styles.css`（`.gu-card` / `.gu-inline` / `.gu-ref-*`）
- 提示词约束：`Creation-Studio/agent_backend/app/chat_policy.py`（`system_prompt`）
- 测试：`Creation-Studio/tests/chat-genui.test.js`（格式协议 8 条）
