# 智能推荐：正文里的假工具调用救援

## 现象

2026-10-31 03:5x，剧本创作台（骨灯项目）一轮回答的正文里出现了：

```
<ask_choice>
<questions>[{"question":"剧本三集齐了，下一步走哪条？","options":[{"label":"抛第1集分镜","why":"…","value":"…","recommended":true}, …]}]
</ask_choice>
```

用户看到的是原始标记和 JSON，而不是可点面板。

## 原因

`ask_choice` 是工具，面板只能由工具调用触发。那次模型（deepseek-v4.1-flash / deepseek-flash）虽然看到了工具 schema（正文里的 `label / why / value / recommended` 与工具定义完全一致），但没有走工具通道，而是把调用序列化成正文标记。属于模型侧的伪工具调用，不是前端渲染问题。

## 三层处理

1. **策略层**（`app/chat_policy.py`）：新增铁律——面板只能由 `ask_choice` 工具调用产生，正文禁止出现 `<ask_choice>`、`<questions>` 或选项 JSON；把参数写成正文标记等于没调用工具。
2. **流式层**（`app/main.py`）：一旦累积文本里出现未闭合的 `<ask_choice>`，暂停向用户推送增量文本，避免原始标记在屏幕上闪一下。
3. **收尾层**（`app/choice_rescue.py`）：解析正文里的伪调用（支持整块包裹、未闭合截断、仅 `<questions>`、代码围栏、尾逗号），归一化成标准 `questions` 结构，补发一次真正的 `choice` 事件并用 `replace` 清理正文；JSON 解析失败时至少把标记剥掉；本轮工具已经弹过面板时只剥标记、不重复弹。

## 验证

- `tests/test_choice_rescue.py`：8 项，覆盖整块包裹、裸 JSON、截断、仅标签、围栏 + 尾逗号、纯文本不动、已弹过只剥、垃圾负载只剥。
- `tests/test_chat.py`：新增 1 项端到端——假模型流式吐出伪调用，断言事件流出现 `choice`、`rescued=true`、最终留存文本无标记、receipt 记录 1 次面板。
- 后端全量：184 项通过。
- 真实模型复测（deepseek-flash，模糊需求「我想把这本小说做成短剧，你看着办」）：模型直接走了工具通道，`choice` 事件带 3 个问题，正文无任何标记。
