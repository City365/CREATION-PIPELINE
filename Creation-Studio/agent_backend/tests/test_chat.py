import json
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app import main, store
@pytest.fixture
def client(tmp_path,monkeypatch):
 monkeypatch.setattr(store,'DB',tmp_path/'chat.db')
 main.locks.clear()
 return TestClient(main.app)
def headers(project='p1'):return {'X-Project-Id':project}
def create(client):
 return client.put('/agent/sessions/c1',headers=headers(),json={'id':'c1','title':'测试','updated':1,'messages':[]})
def test_project_isolation(client):
 assert create(client).status_code==200
 assert len(client.get('/agent/sessions',headers=headers()).json())==1
 assert client.get('/agent/sessions',headers=headers('p2')).json()==[]
 assert client.post('/agent/chat',headers=headers('p2'),json={'session_id':'c1','text':'hi'}).status_code==404
 assert client.get('/agent/sessions').status_code==422
def test_stream_and_history(client,monkeypatch):
 create(client)
 inputs=[]
 class Graph:
  async def astream(self,payload,**kwargs):
   inputs.append(payload)
   yield SimpleNamespace(content='你好'),{}
   yield SimpleNamespace(content='，已连接'),{}
 monkeypatch.setattr(main,'create_chat_model',lambda: object())
 monkeypatch.setattr(main,'create_agent',lambda **kwargs:Graph())
 for text in ['第一轮','第二轮']:
  r=client.post('/agent/chat',headers=headers(),json={'session_id':'c1','text':text})
  assert r.status_code==200
  events=[json.loads(line[6:]) for line in r.text.splitlines() if line.startswith('data: ')]
  assert [e['type'] for e in events if e['type']!='trace']==['start','delta','delta','done']
  assert events[-1]['execution']['status']=='completed'
  receipt=client.get('/agent/executions/'+events[-1]['execution']['id'],headers=headers()).json()
  assert receipt['tool_count']==0
  assert receipt['history_count']==len(inputs[-1]['messages'])-1
  assert client.get('/agent/executions/'+receipt['id'],headers=headers('p2')).status_code==404
 assert len(inputs[1]['messages'])==3
 saved=client.get('/agent/sessions',headers=headers()).json()[0]
 assert len(saved['messages'])==4
 assert saved['messages'][-1]['text']=='你好，已连接'
 assert not main.locks
def test_failed_reply_not_fabricated(client,monkeypatch):
 create(client)
 class Graph:
  async def astream(self,*args,**kwargs):
   raise RuntimeError('private upstream detail')
   yield
 monkeypatch.setattr(main,'create_chat_model',lambda: object())
 monkeypatch.setattr(main,'create_agent',lambda **kwargs:Graph())
 r=client.post('/agent/chat',headers=headers(),json={'session_id':'c1','text':'hi'})
 assert '"type": "error"' in r.text
 assert 'private upstream detail' not in r.text
 saved=client.get('/agent/sessions',headers=headers()).json()[0]['messages']
 assert len(saved)==2
 assert saved[-1]['execution']['status']=='failed'
 assert not main.locks
def test_session_management(client):
 create(client)
 r=client.get('/agent/sessions',headers=headers()).json()[0]
 r['title']='已重命名'
 assert client.put('/agent/sessions/c1',headers=headers(),json=r).status_code==200
 assert client.get('/agent/sessions',headers=headers()).json()[0]['title']=='已重命名'
 assert client.delete('/agent/sessions/c1',headers=headers()).status_code==200
 assert client.get('/agent/sessions',headers=headers()).json()==[]

def test_cancelled_stream_keeps_receipt_and_partial_answer(client,monkeypatch):
 import asyncio
 create(client)
 class Graph:
  async def astream(self,*args,**kwargs):
   yield SimpleNamespace(content='部分回复'),{}
   await asyncio.Event().wait()
 monkeypatch.setattr(main,'create_chat_model',lambda: object())
 monkeypatch.setattr(main,'create_agent',lambda **kwargs:Graph())
 async def consume():
  response=await main.chat(main.ChatRequest(session_id='c1',text='hi'),project='p1')
  iterator=response.body_iterator
  while True:
   data=await anext(iterator)
   if '"type": "delta"' in data:break
  await iterator.aclose()
 asyncio.run(consume())
 saved=store.get_session('p1','c1')['messages'][-1]
 assert saved['execution']['status']=='cancelled'
 assert '部分回复' in saved['text']
 assert store.get_run('p1',saved['execution']['id'])['status']=='cancelled'
 assert not main.locks

def test_bad_request_surfaces_upstream_reason(client,monkeypatch):
 create(client)
 class BadRequestError(Exception):
  status_code=400
 class Graph:
  async def astream(self,*args,**kwargs):
   raise BadRequestError("Error code: 400 - {'error': {'message': 'User location is not supported for the API use.', 'type': 'api_error'}}")
   yield
 monkeypatch.setattr(main,'create_chat_model',lambda: object())
 monkeypatch.setattr(main,'create_agent',lambda **kwargs:Graph())
 r=client.post('/agent/chat',headers=headers(),json={'session_id':'c1','text':'hi'})
 assert 'User location is not supported' in r.text
 assert '上游拒绝请求（400）' in r.text
