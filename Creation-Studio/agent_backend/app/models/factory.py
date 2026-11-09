"""Model adapters migrated from smart_analysis; credentials are local-only."""
import os
import json
import pathlib
import time
import urllib.request
from app.models.observable_openai import ObservableChatOpenAI as ChatOpenAI
from app.configs.settings import get_active_model_name, get_provider_config, load_settings
CONFIGURED_MODELS = {"deepseek": {}, "minimax": {}, "openai": {}}
# 模型客户端超时：流式回答按“两次数据之间”的时间算，调大这里主要是给首字前的排队留余量。
# 原来 45 秒在高峰期等不到首个分片，会显示“模型响应超时”；默认 120 秒，可用 WMD_MODEL_TIMEOUT 覆盖。
MODEL_TIMEOUT = float(os.environ.get('WMD_MODEL_TIMEOUT', '120'))
WMD_BASE = os.environ.get('WMD_BASE_URL', 'http://127.0.0.1:17821').rstrip('/')
_WMD_CACHE = {'at': 0, 'items': []}

def _internal_token():
    """创作台的内部服务凭据：环境变量优先，其次读 data/internal-token.json。"""
    tok = os.environ.get('WMD_INTERNAL_TOKEN')
    if tok:
        return tok.strip()
    here = pathlib.Path(__file__).resolve()
    for base in (here.parents[3], here.parents[2], here.parents[2].parent):
        try:
            data = json.loads((base / 'data' / 'internal-token.json').read_text(encoding='utf-8'))
            token = str(data.get('token') or '').strip()
            if token:
                return token
        except Exception:
            continue
    return ''


def _wmd_channels():
    """从创作台读取已启用的语言模型渠道，作为可选模型（带 20 秒缓存）。"""
    now = time.time()
    if _WMD_CACHE['items'] and now - _WMD_CACHE['at'] < 20:
        return _WMD_CACHE['items']
    items = []
    headers = {'X-WMD-Internal': _internal_token() or '1'}
    try:
        req = urllib.request.Request(WMD_BASE + '/api/state', headers=headers)
        with urllib.request.urlopen(req, timeout=4) as res:
            data = json.loads(res.read().decode('utf-8'))
        for ch in ((data.get('data') or {}).get('channels') or {}).get('llm', []):
            if ch.get('enabled') is False or not ch.get('model') or not ch.get('baseUrl'):
                continue
            # Key 由创作台按内部凭据给出；没有 Key 也保留条目，调用时再报错，至少菜单里看得见。
            if not (ch.get('apiKey') or ch.get('hasKey')):
                continue
            proto = {'openai-responses': 'responses', 'openai-chat': 'chat', 'anthropic': 'anthropic'}.get(ch.get('type'), 'chat')
            ch_name = str(ch.get('name') or ch['id'])
            # 渠道名和模型名不一样时带上渠道名，避免下拉框里出现两个同名 deepseek-flash
            label = ch['model'] if (ch_name == ch['model'] or ch['model'] in ch_name) else (ch_name + ' · ' + ch['model'])
            items.append({
                'id': 'channel:' + ch['id'] + ':' + ch['model'],
                'provider': 'channel:' + ch['id'],
                'channel_id': ch['id'],
                'model': ch['model'],
                'label': label,
                'channel_name': ch_name,
                'base_url': ch['baseUrl'],
                'api_key': ch.get('apiKey') or '',
                'max_tokens': ch.get('maxTokens') or 24000,
                'temperature': 0.7,
                'protocol': proto,
                'context_tokens': ch.get('contextWindow') or 0,
            })
    except Exception:
        # 失败不缓存，下一个请求立刻重试（否则会空 20 秒）
        _WMD_CACHE['items'] = []
        _WMD_CACHE['at'] = 0
        return []
    _WMD_CACHE['items'] = items
    _WMD_CACHE['at'] = now
    return items

def model_options():
    choices=[]
    providers=(load_settings().get('model') or {}).get('providers',{})
    for name in providers:
        cfg=get_provider_config(name)
        if not (cfg.get('api_key') or os.getenv(name.upper()+'_API_KEY')) or not cfg.get('model'):continue
        # 只用系统配置里填的那个模型，不再自己凭空多列一个（配置是唯一事实来源）
        models=[cfg['model']]
        deepseek='api.deepseek.com' in str(cfg.get('base_url',''))
        for model in models:
            choices.append({'id':name+':'+model,'provider':name,'model':model,'label':model,
                            'channel_name': cfg.get('label') or name,'context_tokens':cfg.get('context_tokens') or 0,'reasoning_efforts':['none','low','high','max'] if deepseek else []})
    seen = {(c.get('base_url'), c.get('model')) for c in []}
    for item in _wmd_channels():
        if any(m['id'] == item['id'] for m in choices):
            continue
        choices.append({
            'id': item['id'], 'provider': item['provider'], 'model': item['model'],
            'label': item['label'], 'context_tokens': item.get('context_tokens') or 0,
            'reasoning_efforts': [],
        })
    active=get_active_model_name()
    return {'models':choices,'default_model':active+':'+str(get_provider_config(active).get('model','')),'default_effort':'high'}

def resolve_model(selection=None, effort=None):
    if selection and selection.startswith('channel:'):
        hit = next((x for x in _wmd_channels() if x['id'] == selection), None)
        if not hit:
            raise ValueError('所选模型未启用或不可用')
        cfg = {k: hit.get(k) for k in ('model', 'base_url', 'api_key', 'max_tokens', 'temperature', 'protocol', 'context_tokens')}
        return hit['provider'], cfg
    if selection:
        option=next((x for x in model_options()['models'] if x['id']==selection),None)
        if not option:raise ValueError('所选模型未配置或不可用')
        name=option['provider'];cfg={**get_provider_config(name),'model':option['model']}
        if effort is not None and effort not in option['reasoning_efforts']:raise ValueError('该模型不支持所选推理强度')
    else:
        name=get_active_model_name();cfg=get_provider_config(name)
        if effort is not None:
            option=next((x for x in model_options()['models'] if x['id']==name+':'+str(cfg.get('model'))),None)
            if not option or effort not in option['reasoning_efforts']:raise ValueError('该模型不支持所选推理强度')
    return name,cfg

def create_chat_model(selection=None, effort=None):
    name,cfg = resolve_model(selection,effort)
    key = cfg.get("api_key") or os.getenv(name.upper()+"_API_KEY", "")
    if not key:
        raise ValueError("当前没有可用模型，请在系统设置的语言模型渠道中配置并启用模型")
    kwargs = {k: v for k, v in cfg.items() if k in ("model", "base_url", "max_tokens", "temperature") and v is not None and v != ""}
    from app.harness.runtime import current
    ctx=current.get()
    request_timeout=getattr(ctx,'model_timeout',MODEL_TIMEOUT)
    kwargs.update(api_key=key, timeout=request_timeout, max_retries=0 if ctx else 1)
    if cfg.get('protocol') == 'responses':
        kwargs['use_responses_api'] = True
        kwargs['output_version'] = 'responses/v1'
    if cfg.get('protocol') == 'gemini':
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=cfg['model'], google_api_key=key, base_url=cfg['base_url'], max_output_tokens=kwargs.get('max_tokens'), timeout=request_timeout, max_retries=0 if ctx else 1)
    if ctx:kwargs['max_tokens']=min(kwargs.get('max_tokens') or 8000,ctx.budget.limits['output_tokens'])
    if cfg.get("protocol") == "anthropic" or "/anthropic" in str(cfg.get("base_url", "")):
        from app.models.patched_anthropic import PatchedChatAnthropic
        if effort is not None:
            kwargs['thinking']={'type':'disabled'} if effort=='none' else {'type':'adaptive'}
            if effort!='none':kwargs['model_kwargs']={'output_config':{'effort':effort}}
        return PatchedChatAnthropic(**kwargs)
    if effort is not None:
        kwargs['extra_body']={'thinking':{'type':'disabled' if effort=='none' else 'enabled'}}
        if effort!='none':kwargs['reasoning_effort']=effort
    if name == "deepseek":
        from app.models.patched_deepseek import PatchedChatDeepSeek
        return PatchedChatDeepSeek(**kwargs)
    if name == "minimax":
        from app.models.patched_minimax import PatchedChatMiniMax
        return PatchedChatMiniMax(**kwargs)
    return ChatOpenAI(**kwargs)


def with_retry(model, attempts=5):
    """同一模型最多请求 attempts 次，间隔 1–5 秒；不做任何模型切换。"""
    from app.harness.runtime import current
    if current.get() is not None:
        return model
    import asyncio
    import random

    def delay_for(attempt):
        return min(5.0, 1.0 * (2 ** attempt)) + random.uniform(0, 0.4)

    base = model.__class__

    class RetrySameModel(base):
        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            last = None
            for i in range(attempts):
                try:
                    return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)
                except Exception as exc:
                    last = exc
                    status = getattr(exc, 'status_code', None)
                    if status not in (408, 429, 500, 502, 503, 504, 529):
                        raise
                    if i >= attempts - 1:
                        break
                    time.sleep(delay_for(i))
            raise last

        async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
            last = None
            for i in range(attempts):
                try:
                    return await super()._agenerate(messages, stop=stop, run_manager=run_manager, **kwargs)
                except Exception as exc:
                    last = exc
                    status = getattr(exc, 'status_code', None)
                    if status not in (408, 429, 500, 502, 503, 504, 529):
                        raise
                    if i >= attempts - 1:
                        break
                    await asyncio.sleep(delay_for(i))
            raise last

    wrapped = model.model_copy()
    wrapped.__class__ = RetrySameModel
    return wrapped


# ---------------------------- 渠道工具能力探测 ----------------------------
# 有些渠道（例如把 ChatGPT 网页版包成 API 的代理）收得下 tools 参数，但根本不会返回
# tool_calls。这里真发一次最小工具请求来判断，结果缓存 7 天，避免每次都探测。
_CAP_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'data', 'model-capabilities.json',
)
_CAP_TTL = 7 * 24 * 3600
_PROBING = set()


def _capabilities():
    try:
        with open(_CAP_FILE, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_capabilities(data):
    try:
        os.makedirs(os.path.dirname(_CAP_FILE), exist_ok=True)
        with open(_CAP_FILE, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _probe_tools(cfg, timeout=6.0):
    protocol = cfg.get('protocol') or 'chat'
    if protocol not in ('chat', 'responses'):
        return True
    base = str(cfg.get('base_url') or '').rstrip('/')
    key = cfg.get('api_key') or ''
    model = cfg.get('model') or ''
    if not base or not key or not model:
        return True
    params = {'type': 'object', 'properties': {'x': {'type': 'string'}}, 'required': ['x']}
    if protocol == 'responses':
        url = base + '/responses'
        body = {
            'model': model,
            'input': [{'role': 'user', 'content': '调用 ping 工具，x 传 ok'}],
            'tools': [{'type': 'function', 'name': 'ping', 'description': '连通性测试工具', 'parameters': params}],
        }
    else:
        url = base + '/chat/completions'
        body = {
            'model': model,
            'messages': [{'role': 'user', 'content': '调用 ping 工具，x 传 ok'}],
            'tools': [{'type': 'function', 'function': {'name': 'ping', 'description': '连通性测试工具', 'parameters': params}}],
            'tool_choice': 'auto',
        }
    request = urllib.request.Request(
        url, data=json.dumps(body, ensure_ascii=False).encode('utf-8'), method='POST',
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as res:
            payload = json.loads(res.read().decode('utf-8'))
    except Exception:
        return None  # 探测失败/超时：不下结论
    if protocol == 'responses':
        return any(str(item.get('type')) == 'function_call' for item in (payload.get('output') or []))
    choice = (payload.get('choices') or [{}])[0] or {}
    return bool((choice.get('message') or {}).get('tool_calls'))


def supports_tools(provider, cfg, allow_probe=True, timeout=6.0):
    """该模型渠道是否能真正调用工具（function calling），带 7 天缓存。

    allow_probe=False 时只读缓存（缓存没有就按“支持”处理），用于不阻塞的列表接口。
    """
    key = str(provider) + ':' + str(cfg.get('model'))
    cache = _capabilities()
    item = cache.get(key) or {}
    if 'tools' in item and time.time() - float(item.get('at') or 0) < _CAP_TTL:
        return bool(item['tools'])
    if not allow_probe:
        return True
    if key in _PROBING:
        return True
    _PROBING.add(key)
    try:
        ok = _probe_tools(cfg, timeout=timeout)
        if ok is None:
            return True  # 探测失败/超时：先按支持处理，下次再测
        cache[key] = {'tools': bool(ok), 'at': time.time()}
        _save_capabilities(cache)
        return bool(ok)
    finally:
        _PROBING.discard(key)


def probe_tools_background(provider, cfg):
    """在后台预热能力缓存，避免用户第一次发消息时多等一次探测。"""
    key = str(provider) + ':' + str(cfg.get('model'))
    item = _capabilities().get(key) or {}
    if 'tools' in item and time.time() - float(item.get('at') or 0) < _CAP_TTL:
        return
    if key in _PROBING:
        return
    import threading

    def work():
        try:
            supports_tools(provider, cfg, allow_probe=True, timeout=30.0)
        except Exception:
            pass

    threading.Thread(target=work, daemon=True).start()


