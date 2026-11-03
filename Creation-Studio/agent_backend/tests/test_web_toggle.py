import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessageChunk
from app import main,store

@pytest.mark.parametrize('enabled',[False,True])
def test_request_web_toggle_controls_bound_tools(tmp_path,monkeypatch,enabled):
    monkeypatch.setattr(store,'DB',tmp_path/'chat.db')
    captured={}
    class Graph:
        async def astream(self,*args,**kwargs):
            yield 'messages',(AIMessageChunk(content='收到'),{})
    def create(**kwargs):
        captured.update(kwargs)
        return Graph()
    monkeypatch.setattr(main,'create_agent',create)
    monkeypatch.setattr(main,'create_chat_model',lambda:object())
    main.locks.clear()
    client=TestClient(main.app)
    headers={'X-Project-Id':'web-toggle'}
    client.put('/agent/sessions/test',headers=headers,json={'id':'test','title':'test','updated':1,'messages':[]})
    body={'session_id':'test','text':'你好'}
    if enabled: body['web_search']=True
    response=client.post('/agent/chat',headers=headers,json=body)
    assert response.status_code==200
    names={t.name for t in captured['tools']}
    assert ('web_search' in names)==enabled
    assert ('web_fetch' in names)==enabled
    if not enabled: assert '联网检索关闭' in captured['system_prompt']
