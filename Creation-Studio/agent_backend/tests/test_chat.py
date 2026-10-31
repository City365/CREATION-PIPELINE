import json
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from app import main, store
@pytest.fixture
def client(tmp_path,monkeypatch):
 monkeypatch.setattr(store,'DB',tmp_path/'chat.db')
 main.locks.clear()
 main.LIVE_RUNS.clear()
 main.RUN_EVENTS.clear()
 main.RUN_ENDED.clear()
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
def test_recursion_limit_covers_batch_image_runs(client,monkeypatch):
 # 批量出图一轮要跑十几轮工具，36 步会在「图都出完了只差收尾」时撞线
 create(client)
 seen=[]
 class Graph:
  async def astream(self,payload,**kwargs):
   seen.append(kwargs.get('config') or {})
   raise type('GraphRecursionError',(Exception,),{})('Recursion limit reached')
   yield
 monkeypatch.setattr(main,'create_chat_model',lambda: object())
 monkeypatch.setattr(main,'create_agent',lambda **kwargs:Graph())
 assert main.RECURSION_LIMIT>=80
 r=client.post('/agent/chat',headers=headers(),json={'session_id':'c1','text':'继续出图'})
 assert seen and seen[0]['recursion_limit']>=80
 assert '步数达到上限' in r.text
 assert '请检查渠道' not in r.text
 assert '说“继续”' in r.text
 saved=client.get('/agent/sessions',headers=headers()).json()[0]['messages']
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

def test_client_disconnect_keeps_run_alive(client,monkeypatch):
 import asyncio
 create(client)
 class Graph:
  async def astream(self,*args,**kwargs):
   yield SimpleNamespace(content='部分回复'),{}
   await asyncio.Event().wait()
 monkeypatch.setattr(main,'create_chat_model',lambda: object())
 monkeypatch.setattr(main,'create_agent',lambda **kwargs:Graph())
 async def scenario():
  response=await main.chat(main.ChatRequest(session_id='c1',text='hi'),project='p1')
  iterator=response.body_iterator
  while True:
   data=await anext(iterator)
   if '"type": "delta"' in data:break
  await iterator.aclose()                     # 模拟前端刷新/关页：连接断开
  state=main.LIVE_RUNS.get(('p1','c1'))
  assert state and not state['finished'], '断开连接后任务应继续在后台跑'
  run_id=state['run_id']
  buffered=client.get('/agent/runs/'+run_id+'/events',headers=headers()).json()
  assert any(item['type']=='delta' for item in buffered['items'])
  assert client.get('/agent/sessions/c1/run',headers=headers()).json()['active'] is True
  state['task'].cancel()                      # 收尾，避免测试挂住
  try:await state['task']
  except asyncio.CancelledError:pass
 asyncio.run(scenario())
 saved=store.get_session('p1','c1')['messages'][-1]
 assert saved['role']=='assistant'
 assert saved['execution']['status']=='cancelled'
 assert '部分回复' in saved['text']
 assert not main.locks
 assert client.get('/agent/sessions/c1/run',headers=headers()).json()['active'] is False

def test_active_runs_lists_background_task(client,monkeypatch):
 import asyncio
 create(client)
 class Graph:
  async def astream(self,*args,**kwargs):
   await asyncio.Event().wait()
   yield
 monkeypatch.setattr(main,'create_chat_model',lambda: object())
 monkeypatch.setattr(main,'create_agent',lambda **kwargs:Graph())
 async def scenario():
  response=await main.chat(main.ChatRequest(session_id='c1',text='hi'),project='p1')
  iterator=response.body_iterator
  await anext(iterator)
  await iterator.aclose()
  items=client.get('/agent/runs/active',headers=headers()).json()['items']
  assert len(items)==1 and items[0]['session_id']=='c1'
  assert client.get('/agent/runs/active',headers=headers('p2')).json()['items']==[]
  state=main.LIVE_RUNS[('p1','c1')]
  state['task'].cancel()
  try:await state['task']
  except asyncio.CancelledError:pass
 asyncio.run(scenario())
 assert client.get('/agent/runs/active',headers=headers()).json()['items']==[]

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
