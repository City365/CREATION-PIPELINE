import pytest
from fastapi import HTTPException
from app import store, main

@pytest.mark.asyncio
async def test_compact_preserves_history_and_failure(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB',tmp_path/'chat.db')
    conversation={'id':'s','title':'test','updated':1,'messages':[{'id':'u','role':'user','text':'只读查询'}]}
    store.save('p',conversation)
    class Model:
        async def ainvoke(self,messages):
            assert '只读查询' in messages[-1]['content']
            return type('Message',(),{'content':'用户要求只读查询。'})()
    monkeypatch.setattr(main,'create_chat_model',lambda *args:Model())
    result=await main.compact_session('s',main.CompactRequest(),project='p')
    assert result['messages']==1
    assert store.get_session('p','s')==conversation
    before=store.get_compaction('p','s')
    with pytest.raises(HTTPException) as exc:
        await main.compact_session('s',main.CompactRequest(),project='other')
    assert exc.value.status_code==404
    conversation['messages'].append({'id':'u2','role':'user','text':'新消息'})
    store.save('p',conversation)
    class Broken:
        async def ainvoke(self,messages):raise RuntimeError('upstream')
    monkeypatch.setattr(main,'create_chat_model',lambda *args:Broken())
    with pytest.raises(HTTPException):await main.compact_session('s',main.CompactRequest(),project='p')
    assert store.get_compaction('p','s')==before
    assert ('p','s') not in main.locks
