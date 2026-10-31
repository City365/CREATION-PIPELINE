"""上下文分项统计：摘要面板里「各固定环节各占多少」的数据来源。

面板要像 Codex 那样按固定环节拆开（Messages / Tools / Skills / System prompt /
Reserved buffer / Free space），而不是只给一个「参考占用」。这些分项只有后端知道
（工具 schema、系统提示词、技能包都在后端拼装），所以在这里一次算好写进运行回执。

口径：保守字符估算，不是厂商 tokenizer。
- ASCII：4 字符 ≈ 1 token
- 中文 / 全角：1.5 字符 ≈ 1 token
"""
import json

SCHEMA_VERSION = 'context-report/1'
ESTIMATOR = 'chars ascii/4 + cjk/1.5'
ASCII_PER_TOKEN = 4.0
CJK_PER_TOKEN = 1.5
RESERVE_RATIO = 0.15
FREE_KEY = 'free'

LABELS = [
    ('messages', 'Messages'),
    ('tools', 'System tools'),
    ('skills', 'Skills'),
    ('system', 'System prompt'),
    ('buffer', 'Autocompact buffer'),
    (FREE_KEY, 'Free space'),
]


def tokens_of(value):
    """把一段文本或一个可序列化结构换算成估算 token 数。"""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    if not text:
        return 0
    ascii_chars = sum(1 for ch in text if ch < '\x80')
    wide = len(text) - ascii_chars
    return int(round(ascii_chars / ASCII_PER_TOKEN + wide / CJK_PER_TOKEN))


def tool_manifest(tools):
    """工具定义的体积（名字 + 参数 schema + 说明），用于 Tools 分项。"""
    rows = []
    for tool in tools or []:
        try:
            schema = tool.args_schema.model_json_schema()
        except Exception:
            schema = {}
        rows.append({'name': getattr(tool, 'name', ''), 'schema': schema,
                     'description': getattr(tool, 'description', '') or ''})
    return rows


def build(history, tools, system_prompt, skills=None, window=128000, tool_count=None, skill_count=None,
          tool_names=None):
    window = max(1, int(window or 0) or 128000)
    messages_tokens = tokens_of(history)
    tools_tokens = tokens_of(tool_manifest(tools))
    skills_tokens = tokens_of(skills) if skills else 0
    system_tokens = tokens_of(system_prompt)
    reserved = int(round(window * RESERVE_RATIO))
    used = messages_tokens + tools_tokens + skills_tokens + system_tokens
    free = max(0, window - used - reserved)

    values = {'messages': messages_tokens, 'tools': tools_tokens, 'skills': skills_tokens,
              'system': system_tokens, 'buffer': reserved, FREE_KEY: free}
    items = [{'key': key, 'label': label, 'tokens': values[key],
              'percent': round(values[key] / window * 100, 2)} for key, label in LABELS]
    names = [str(name) for name in (tool_names or [getattr(tool, 'name', '') for tool in tools or []]) if name]
    return {
        'schema_version': SCHEMA_VERSION,
        'estimator': ESTIMATOR,
        'window': window,
        'used': used,
        'used_percent': round(used / window * 100, 2),
        'reserved': reserved,
        'free': free,
        'messages': len(history or []),
        'tool_count': len(tools or []) if tool_count is None else tool_count,
        'skill_count': (len(skills) if isinstance(skills, (list, dict)) else 0) if skill_count is None else skill_count,
        'tool_names': names,
        'items': items,
    }
