"""每个模型的上下文窗口（token）与输入预算（保守字节估算）。

口径（2026-10-30 按本机渠道校准）：
- deepseek / gemini：1024k（= 1M，与本机渠道配置一致）
- gpt-*：256k
- 其它未知模型：256k 兜底

这里的数字必须与 `data/config.json` 里各渠道的 `contextWindow` 保持一致，否则前端进度条
和后端折叠/裁剪阈值会各说各话。
"""
import os

DEFAULT_CONTEXT_TOKENS = 256_000

# 按模型名做子串匹配，先命中先用；顺序有意义（gpt-5 必须放在 gpt 之前）。
CONTEXT_RULES = (
    ('gemini', 1_024_000),
    ('deepseek', 1_024_000),
    ('claude', 200_000),
    ('minimax', 192_000),
    ('qwen', 128_000),
    ('gpt-5', 20_000),
    ('gpt', 256_000),
    ('o1', 200_000),
    ('o3', 200_000),
    ('o4', 200_000),
)

# 输入预算用 UTF-8 字节做保守估算：中文约 3 字节/字、约 1.5 token/字，
# 折算约 2 字节/token；取 2 是偏保守的下限（英文/JSON 会被算得更宽，只会更早触发）。
BYTES_PER_TOKEN = 2


def model_name(model) -> str:
    if isinstance(model, str):
        return model
    for attr in ('model_name', 'model', 'model_id'):
        value = getattr(model, attr, None)
        if value:
            return str(value)
    return ''


def context_tokens(model=None) -> int:
    name = model_name(model).lower()
    for key, value in CONTEXT_RULES:
        if key in name:
            return value
    return DEFAULT_CONTEXT_TOKENS


def input_budget_bytes(model=None) -> int:
    override = os.getenv('HARNESS_CONTEXT_INPUT_BUDGET')
    if override:
        return max(8000, int(override))
    return max(8000, int(context_tokens(model) * BYTES_PER_TOKEN))


def describe(model=None) -> dict:
    """给回执和前端看的预算说明。"""
    return {'model': model_name(model), 'context_tokens': context_tokens(model),
            'input_budget_bytes': input_budget_bytes(model), 'bytes_per_token': BYTES_PER_TOKEN,
            'estimator': 'utf8_bytes_conservative'}
