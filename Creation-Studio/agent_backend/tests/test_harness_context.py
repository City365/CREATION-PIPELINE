import asyncio
import pytest
from fastapi import HTTPException
from langchain_core.messages import AIMessage
from app import store
from app.harness import context, runtime, run_store

@pytest.fixture
def setup(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB',tmp_path/'context.db')
    item,_=run_store.claim('p','s','r','h');ctx=runtime.Runtime('p',item);ctx.receipt={}
    return ctx

def rows(n=50):return [{'id':str(i),'role':'user','text':'消息'+str(i)} for i in range(n)]

def test_history_is_not_silently_truncated(setup):
    async def check():
        history=await context.prepare('p','s',{'messages':rows()},'new',None,setup)
        assert len(history)==51 and '消息0' in history[0]['content']
    asyncio.run(check())

def test_hashes_invalidate_edited_deleted_or_reordered_history(setup):
    items=rows(4)
    saved={'message_ids':['0','1'],'message_hashes':{m['id']:context.digest(m) for m in items[:2]},'summary':'旧摘要'}
    assert context.valid(saved,items)
    changed=[{**items[0],'text':'新内容'},*items[1:]]
    assert not context.valid(saved,changed)
    assert not context.valid(saved,items[1:])
    assert not context.valid(saved,[items[1],items[0],*items[2:]])
    assert len(context.assemble(changed,saved))==4

def test_compact_atomic_failure_and_metadata(setup):
    async def check():
        class Good:
            async def ainvoke(self,request):return AIMessage(content='保留目标和约束',usage_metadata={'input_tokens':20,'output_tokens':6,'total_tokens':26})
        items=rows(3)
        saved=await context.compact('p','s',items,Good(),setup,'model','none')
        assert context.valid(saved,items) and saved['prompt_version']=='context-summary/1'
        assert setup.budget.publish()['model_calls']==1
        class Broken:
            async def ainvoke(self,request):raise RuntimeError('failed')
        with pytest.raises(HTTPException):await context.compact('p','s',rows(4),Broken(),setup)
        assert store.get_compaction('p','s')==saved
    asyncio.run(check())

def test_auto_compact_is_explicit_and_preserves_recent_messages(setup,monkeypatch):
    monkeypatch.setenv('HARNESS_CONTEXT_INPUT_BUDGET','8000')
    items=[{'id':str(i),'role':'user','text':'data'*100} for i in range(20)]
    async def check():
        class Model:
            async def ainvoke(self,request):return AIMessage(content='用户历史目标和约束摘要')
        with pytest.raises(HTTPException):await context.prepare('p','s',{'messages':items},'new',Model(),setup)
        monkeypatch.setenv('HARNESS_AUTO_COMPACT_ENABLED','true')
        history=await context.prepare('p','s',{'messages':items},'new',Model(),setup)
        assert len(history)==8
        saved=store.get_compaction('p','s')
        assert len(saved['message_ids'])==14
        assert setup.context_manifest['estimator']=='utf8_bytes_conservative'
    asyncio.run(check())
