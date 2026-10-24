import json
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage
from app import main, store
from app.task_tools import build_task_tools
from test_chat import client, headers, create

def test_plan_sources_require_real_reference():
 receipt={'plan':None};published=[];sources={}
 tools={t.name:t for t in build_task_tools(receipt,'检查分镜连贯性',published.append,sources)}
 plan=tools['create_task_plan'].invoke({'goal':'核对分镜','steps':[{'id':'s1','title':'核对场景','purpose':'识别首尾状态'}]})
 assert plan['ok']
 invalid=tools['record_step_result'].invoke({'step_id':'s1','output':'凭空结论','source_ids':['fake-report']})
 assert not invalid['ok']
 assert receipt['plan']['steps'][0]['status']=='pending'
 doc=tools['read_analysis_guidance'].invoke({'topic':'storyboard'})
 result=tools['record_step_result'].invoke({'step_id':'s1','output':'需要核对镜头首尾状态，尚无实际成片。','source_ids':['user_input',doc['source_id']]})
 assert result['ok']
 assert receipt['plan']['steps'][0]['evidence'][1]['kind']=='guidance'
 assert published[0]['plan']['steps'][0]['status']=='pending'

def test_role_trajectory_and_process_are_separate(client,monkeypatch):
 create(client)
 def build(**kwargs):
  tools={t.name:t for t in kwargs['tools']}
  class Graph:
   async def astream(self,payload,**stream_kwargs):
    calls=[('create_task_plan',{'goal':'回答分镜问题','steps':[{'id':'s1','title':'核对分镜','purpose':'明确镜头衔接条件'}]}),('read_analysis_guidance',{'topic':'storyboard'}),('record_step_result',{'step_id':'s1','output':'需要统一首尾状态；还缺实际成片。','source_ids':['user_input','guidance:storyboard']})]
    for i,(name,args) in enumerate(calls):
     cid='call-'+str(i)
     yield 'updates',{'model':{'messages':[AIMessage(content='采用已开放的工具继续任务。',tool_calls=[{'id':cid,'name':name,'args':args}])]}}
     output=tools[name].invoke(args)
     yield 'updates',{'tools':{'messages':[ToolMessage(content=json.dumps(output,ensure_ascii=False),tool_call_id=cid,name=name)]}}
    yield 'messages',(AIMessageChunk(content='最终建议：统一镜头首尾状态。'),{})
    yield 'updates',{'model':{'messages':[AIMessage(content='最终建议：统一镜头首尾状态。')]}}
  return Graph()
 monkeypatch.setattr(main,'create_chat_model',lambda:object())
 monkeypatch.setattr(main,'create_agent',build)
 response=client.post('/agent/chat',headers=headers(),json={'session_id':'c1','text':'检查分镜连贯性','skill':'剧本转分镜'})
 events=[json.loads(l[6:]) for l in response.text.splitlines() if l.startswith('data: ')]
 assert any(e['type']=='process' for e in events)
 receipt=events[-1]['execution']
 assert receipt['plan']['steps'][0]['output']=='需要统一首尾状态；还缺实际成片。'
 assert receipt['tool_count']==3 and receipt['business_tool_count']==0
 sessions=client.get('/agent/sessions',headers=headers()).json()
 assert 'trajectory' not in json.dumps(sessions)
 trajectory=client.get('/agent/sessions/c1/trajectory',headers=headers()).json()
 roles=[item['role'] for item in trajectory['items']]
 assert roles==['user','assistant','tool','assistant','tool','assistant','tool','assistant']
 assert trajectory['items'][2]['tool_call_id']==trajectory['items'][1]['tool_calls'][0]['id']
 assert client.get('/agent/sessions/c1/trajectory',headers=headers('p2')).status_code==404
 assert client.get('/agent/sessions/c1/trajectory?limit=101',headers=headers()).status_code==400

def test_trajectory_pagination_defaults_to_latest(client):
 create(client)
 for i in range(55):store.append_trajectory('p1','c1','r1',i,{'id':str(i),'run_id':'r1','seq':i,'role':'assistant','content':'公开消息'})
 page=client.get('/agent/sessions/c1/trajectory?limit=40',headers=headers()).json()
 assert page['total']==55 and page['offset']==15
 assert page['items'][0]['id']=='15' and page['items'][-1]['id']=='54'
 assert page['previous_offset']==0
 assert 'items' not in client.get('/agent/sessions',headers=headers()).json()[0]
