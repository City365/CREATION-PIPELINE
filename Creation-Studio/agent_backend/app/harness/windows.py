"""每个模型的上下文窗口（token）与输入预算（保守字节估算）。

用户约定：
- 默认 500k
- GPT-5: 20k
- Gemini / DeepSeek: 1024k

注意：这里的数字是"上下文 token 预算"，不是模型厂商实际支持的上限；
如果实际 API 的窗口更小（例如 DeepSeek 常见 128k），历史超过后仍会被上游拒绝，
到时把对应数字调小即可。
"""
import os

DEFAULT_CONTEXT_TOKENS = 500_000

MODEL_CONTEXT_TOKENS = {
    'gpt-5': 20_000,
    'gemini': 1_024_000,
    'deepseek': 1_024_000,
}

# 输入预算用 UTF-8 字节做保守估算：中文约 3 字节/字，1 token ≈ 1.5 字 ≈ 4.5 字节；
# 取 2 字节/token 是偏保守的下限，宁早压缩也不把上游撑爆。
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
    for key, value in MODEL_CONTEXT_TOKENS.items():
        if key in name:
            return value
    return DEFAULT_CONTEXT_TOKENS


def input_budget_bytes(model=None) -> int:
    override = os.getenv('HARNESS_CONTEXT_INPUT_BUDGET')
    if override:
        return max(8000, int(override))
    return max(8000, int(context_tokens(model) * BYTES_PER_TOKEN))
