import copy
import pytest
import httpx
from fastapi import HTTPException
from pydantic import ValidationError
from app.project_context import ResourceSelection, resolve_context, context_summary, build_context_tools

@pytest.mark.parametrize('values', [{'dataset_id':'d'}, {'dataset_version_id':'v'}])
def test_version_pair(values):
    with pytest.raises(ValidationError): ResourceSelection(**values)

@pytest.mark.asyncio
async def test_no_context_no_network():
    assert await resolve_context('p', ResourceSelection()) is None

@pytest.mark.asyncio
async def test_scoped_frozen_context(monkeypatch):
    from app import project_context as module
    real = httpx.AsyncClient
    seen=[]
    def handle(request):
        seen.append(request)
        path=request.url.path
        if path.endswith('/datasets'): data={'datasets':[{'id':'d','name':'客户'}]}
        elif path.endswith('/schema'): data={'source':'data_schema','schema':{'file':{'path':'secret'},'validation':{'schema_confirmed':False},'columns':[{'name':'age','semantic_type':'numeric','sample_values':['private']} ]}}
        elif path.endswith('/versions/v'): data={'id':'v','dataset_id':'d','version_num':1,'n_rows':100,'n_cols':1}
        elif path.endswith('/packages/list'): data={'items':[{'id':'k','name':'策略'}]}
        else: data={'package':{'id':'k','version':'v1','status':'draft'},'items':[{'id':'r','conditions':[{'feature':'age','op':'<','value':18}],'action':'block','priority':1,'precision':0.99}]}
        return httpx.Response(200,json={'code':0,'data':data})
    monkeypatch.setattr(module.httpx,'AsyncClient',lambda **kw: real(**kw,transport=httpx.MockTransport(handle)))
    snapshot=await resolve_context('p',ResourceSelection(dataset_id='d',dataset_version_id='v',package_id='k'),'Bearer test')
    assert all(r.headers['X-Project-Id']=='p' and r.headers['Authorization']=='Bearer test' for r in seen)
    assert 'sample_values' not in snapshot['dataset']['schema']['columns'][0]
    assert 'file' not in snapshot['dataset']['schema']
    summary=context_summary(snapshot)
    assert summary['strategy']['rule_count']==1 and summary['warnings']
    sources={}; tools={t.name:t for t in build_context_tools(snapshot,sources)}
    result=tools['read_strategy_rules'].invoke({})
    assert result['items'][0]['conditions'][0]['value']==18
    assert result['source_id'] in sources
    assert not tools['read_dataset_schema'].invoke({'limit':51})['ok']
    with pytest.raises(HTTPException) as exc:
        await resolve_context('p',ResourceSelection(package_id='other'))
    assert exc.value.status_code==422
    with pytest.raises(HTTPException):
        await resolve_context('p',ResourceSelection(dataset_id='other',dataset_version_id='v'))
