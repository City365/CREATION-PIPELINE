"""Model adapters migrated from smart_analysis; credentials are local-only."""
import os
import json
import time
import urllib.request
from langchain_openai import ChatOpenAI
from app.configs.settings import get_active_model_name, get_provider_config, load_settings
CONFIGURED_MODELS = {"deepseek": {}, "minimax": {}, "openai": {}}
H3_BASE = os.environ.get('H3_BASE_URL', 'http://127.0.0.1:17821').rstrip('/')
_H3_CACHE = {'at': 0, 'items': []}

def _h3_channels():
    """从 H3 读取已启用的语言模型渠道，作为可选模型（带 20 秒缓存）。"""
    now = time.time()
    if _H3_CACHE['items'] and now - _H3_CACHE['at'] < 20:
        return _H3_CACHE['items']
    items = []
    try:
        req = urllib.request.Request(H3_BASE + '/api/state', headers={'X-H3-Internal': '1'})
        with urllib.request.urlopen(req, timeout=3) as res:
            data = json.loads(res.read().decode('utf-8'))
        for ch in ((data.get('data') or {}).get('channels') or {}).get('llm', []):
            if ch.get('enabled') is False or not ch.get('apiKey') or not ch.get('model') or not ch.get('baseUrl'):
                continue
            proto = {'openai-responses': 'responses', 'openai-chat': 'chat', 'anthropic': 'anthropic'}.get(ch.get('type'), 'chat')
            items.append({
                'id': 'channel:' + ch['id'] + ':' + ch['model'],
                'provider': 'channel:' + ch['id'],
                'channel_id': ch['id'],
                'model': ch['model'],
                'label': (ch.get('name') or ch['id']) + ' · ' + ch['model'],
                'base_url': ch['baseUrl'],
                'api_key': ch['apiKey'],
                'max_tokens': ch.get('maxTokens') or 24000,
                'temperature': 0.7,
                'protocol': proto,
                'context_tokens': ch.get('contextWindow') or 0,
            })
    except Exception:
        items = []
    _H3_CACHE['items'] = items
    _H3_CACHE['at'] = now
    return items

def model_options():
    choices=[]
    providers=(load_settings().get('model') or {}).get('providers',{})
    for name in providers:
        cfg=get_provider_config(name)
        if not (cfg.get('api_key') or os.getenv(name.upper()+'_API_KEY')) or not cfg.get('model'):continue
        models=[cfg['model']]
        deepseek='api.deepseek.com' in str(cfg.get('base_url','')) and cfg['model'] in ('deepseek-v4-pro','deepseek-flash')
        if deepseek and not cfg.get('system_channel'):models=['deepseek-v4-pro','deepseek-flash']
        for model in models:
            choices.append({'id':name+':'+model,'provider':name,'model':model,'label':(cfg['label']+' · '+model) if cfg.get('label') else model,'context_tokens':cfg.get('context_tokens') or 0,'reasoning_efforts':['none','low','high','max'] if deepseek else []})
    seen = {(c.get('base_url'), c.get('model')) for c in []}
    for item in _h3_channels():
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
        hit = next((x for x in _h3_channels() if x['id'] == selection), None)
        if not hit:
            raise ValueError('所选渠道模型未启用或不可用')
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
    kwargs.update(api_key=key, timeout=45, max_retries=0 if ctx else 1)
    if cfg.get('protocol') == 'responses':
        kwargs['use_responses_api'] = True
        kwargs['output_version'] = 'responses/v1'
    if cfg.get('protocol') == 'gemini':
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=cfg['model'], google_api_key=key, base_url=cfg['base_url'], max_output_tokens=kwargs.get('max_tokens'), timeout=90, max_retries=0 if ctx else 1)
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
