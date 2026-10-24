"""Agent 设置存储 — JSON 持久化(data/agent_settings.json)。

当前管理: 模型连接配置(active provider + 各 provider 的 model/base_url/api_key/max_tokens/temperature)。
技能管理不走这里(直接读写 skills/ 目录下的 SKILL.md 文件)。
"""
import json
import os
from pathlib import Path

_DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "agent_settings.json"
SETTINGS_PATH = Path(os.getenv("AGENT_SETTINGS_PATH", str(_DEFAULT_PATH)))

def studio_models():
    """Read the same persisted channels as the desktop, on every request."""
    root = Path(os.getenv('H3_DATA_DIR') or Path(__file__).resolve().parents[3] / 'data')
    file = root / 'config.json'
    if not file.exists():
        return None
    try:
        config = json.loads(file.read_text(encoding='utf-8'))
    except (OSError, ValueError) as err:
        raise ValueError('系统模型配置无法读取，请检查 data/config.json') from err
    if 'channels' not in config:
        return None
    providers = {}
    active = ''
    for channel in (config.get('channels') or {}).get('llm', []):
        if channel.get('enabled') is False or not all(channel.get(key) for key in ('id', 'model', 'baseUrl', 'apiKey')):
            continue
        name = 'studio-' + channel['id']
        protocol = {'openai-responses': 'responses', 'gemini': 'gemini', 'anthropic': 'anthropic'}.get(channel.get('type'), 'chat')
        providers[name] = {
            'model': channel['model'], 'base_url': channel['baseUrl'], 'api_key': channel['apiKey'],
            'protocol': protocol, 'max_tokens': channel.get('maxTokens') or 8000,
            'label': channel.get('name') or channel['model'], 'context_tokens': channel.get('contextWindow') or 0,
            'system_channel': True,
        }
        if channel.get('active') and not active:
            active = name
    return {'active': active or next(iter(providers), ''), 'providers': providers}

# 默认值: 与 app/models/factory.py 的 CONFIGURED_MODELS 对齐
DEFAULT_SETTINGS: dict = {
    "model": {
        "active": "deepseek",
        "providers": {
            "deepseek": {
                "model": "deepseek-v4-pro",
                "base_url": "https://api.deepseek.com",
                "api_key": "",
                "max_tokens": 4096,
                "temperature": 0.7,
            },
            "minimax": {
                "model": "MiniMax-M2.7",
                "base_url": "",
                "api_key": "",
                "max_tokens": 4096,
                "temperature": 0.7,
            },
        },
    }
}


def _deep_merge(base: dict, override: dict) -> dict:
    """递归合并, override 优先。"""
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_settings() -> dict:
    """加载设置(与默认值合并, 缺字段自动补)。"""
    data: dict = {}
    try:
        if SETTINGS_PATH.exists():
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    result = _deep_merge(DEFAULT_SETTINGS, data)
    system = studio_models()
    if system is not None:
        result['model'] = system
    return result


def save_settings(settings: dict) -> dict:
    """保存设置(合并后落盘), 返回合并结果。"""
    merged = _deep_merge(load_settings(), settings)
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    return merged


def get_active_model_name() -> str:
    return (load_settings().get("model") or {}).get("active") or ""


def get_provider_config(name: str) -> dict:
    """返回某 provider 的有效配置(默认值 + 设置覆盖)。"""
    from app.models.factory import CONFIGURED_MODELS  # 延迟 import 防循环

    base = dict(CONFIGURED_MODELS.get(name, {}))
    base.pop("use", None)
    settings = (load_settings().get("model") or {}).get("providers") or {}
    cfg = settings.get(name) or {}
    merged = dict(base)
    for k in ("model", "base_url", "api_key", "max_tokens", "temperature", "protocol", "label", "context_tokens", "system_channel"):
        if cfg.get(k) is not None:
            merged[k] = cfg[k]
    return merged


def mask_api_key(key: str) -> str:
    """脱敏: 只保留后 4 位, 其余打码。"""
    if not key:
        return ""
    if len(key) <= 8:
        return "****" + key[-4:]
    return key[:4] + "****" + key[-4:]
