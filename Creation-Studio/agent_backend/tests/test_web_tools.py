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
