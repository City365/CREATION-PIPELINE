import asyncio
from unittest.mock import patch
from app import web_tools as web

def run(coro): return asyncio.run(coro)

def test_search_normalizes_and_limits():
    with patch.object(web, 'config', return_value=web.DEFAULTS), patch.object(web, 'search_sync', return_value=[{'title':'标题','href':'https://example.com','body':'摘要'}]):
        result=run(web.search_web('test'))
    assert result['ok'] and result['results'][0]['url']=='https://example.com'

def test_failure_is_not_empty_results():
    with patch.object(web, 'config', return_value=web.DEFAULTS), patch.object(web, 'search_sync', side_effect=RuntimeError('secret')):
        result=run(web.search_web('test'))
    assert result['error']=='search_failed' and 'secret' not in str(result)

def test_disabled_and_invalid_input():
    with patch.object(web, 'config', return_value={**web.DEFAULTS,'enabled':False}):
        assert web.build_web_tools()==[]
        assert run(web.fetch_web('https://example.com'))['error']=='disabled'
    assert run(web.search_web(''))['error']=='invalid_query'

def test_local_and_credential_urls_blocked():
    for url in ['file:///etc/passwd','http://127.0.0.1','http://user:pass@example.com','http://example.com:8080']:
        assert run(web.fetch_web(url))['error']=='invalid_url'

def test_cancellation_propagates():
    async def cancelled(*args): raise asyncio.CancelledError()
    with patch.object(web,'public_url',cancelled):
        try: run(web.fetch_web('https://example.com'))
        except asyncio.CancelledError: pass
        else: raise AssertionError('cancel swallowed')

from unittest.mock import AsyncMock

def test_serper_primary_does_not_call_fallback():
    cfg={**web.DEFAULTS,'providers':['serper','tavily','ddgs'],'serper_api_key':'serper-test','tavily_api_keys':['tavily-test']}
    api=AsyncMock(return_value=[{'title':'official','url':'https://example.com','snippet':'body'}])
    with patch.object(web,'config',return_value=cfg), patch.object(web,'search_api',api):
        result=run(web.search_web('query'))
    assert result['provider']=='serper' and api.await_count==1

def test_tavily_rotates_quota_failure_and_redacts_keys():
    cfg={**web.DEFAULTS,'providers':['serper','tavily'],'serper_api_key':'secret-serper','tavily_api_keys':['secret-a','secret-b']}
    api=AsyncMock(side_effect=[web.SearchError('http_500'),web.SearchError('http_432',True),[{'title':'ok','url':'https://example.com','snippet':''}]])
    with patch.object(web,'config',return_value=cfg), patch.object(web,'search_api',api), patch.object(web,'_tavily_cursor',0), patch.object(web,'_key_cooldowns',{}):
        result=run(web.search_web('query'))
    assert result['provider']=='tavily' and result['key_slot']==2
    assert len(result['attempts'])==2 and 'secret-' not in str(result)

def test_all_api_failure_falls_back_to_ddgs():
    cfg={**web.DEFAULTS,'providers':['serper','tavily','ddgs'],'serper_api_key':'s','tavily_api_keys':['t']}
    with patch.object(web,'config',return_value=cfg), patch.object(web,'search_api',AsyncMock(side_effect=web.SearchError('http_500'))), patch.object(web,'search_sync',return_value=[{'href':'https://example.com'}]):
        result=run(web.search_web('query'))
    assert result['provider']=='ddgs' and len(result['attempts'])==2

def test_api_uses_fixed_endpoints_and_normalizes():
    class Client:
        def __init__(self,**kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self,*a): pass
        async def post(self,url,headers,json):
            assert url=='https://google.serper.dev/search'
            assert headers=={'X-API-KEY':'test-key'}
            assert json['q']=='query' and json['hl']=='zh-cn' and json['gl']=='us'
            return web.httpx.Response(200,json={'organic':[{'title':'A','link':'https://example.com','snippet':'B'}]})
    with patch.object(web.httpx,'AsyncClient',Client):
        rows=run(web.search_api('serper','query',5,web.DEFAULTS,'test-key'))
    assert rows[0]['url']=='https://example.com'
