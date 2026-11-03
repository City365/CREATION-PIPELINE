import json
from types import SimpleNamespace as NS
import pytest
from langchain_core.messages import AIMessage,AIMessageChunk,HumanMessage,ToolMessage
from app.cycle_trace import CycleTrace,reasoning_text,safe
from app.models.observable_openai import ObservableChatOpenAI
from app import store

def test_reasoning_extraction_never_uses_answer_or_signature():
 assert reasoning_text(AIMessage(content='answer'))==''
 assert reasoning_text(AIMessage(content=[{'type':'thinking','thinking':'analysis','signature':'opaque'},{'type':'text','text':'answer'}]))=='analysis'
 assert reasoning_text(AIMessage(content='',additional_kwargs={'reasoning_content':'reason'}))=='reason'
 assert safe({'api_key':'secret','authorization':'Bearer secret'})=={'api_key':'[REDACTED]','authorization':'[REDACTED]'}

def test_compatible_adapter_keeps_stream_reasoning_and_replay():
 model=ObservableChatOpenAI(model='test',api_key='test')
 chunk=model._convert_chunk_to_generation_chunk({'choices':[{'delta':{'role':'assistant','reasoning_content':'reason'},'index':0}]},AIMessageChunk,None)
 assert reasoning_text(chunk.message)=='reason'
 msg=AIMessage(content='',additional_kwargs={'reasoning_content':'reason'},tool_calls=[{'id':'t1','name':'read','args':{}}])
 assert model._get_request_payload([HumanMessage(content='hello'),msg])['messages'][1]['reasoning_content']=='reason'

@pytest.mark.asyncio
async def test_two_cycles_snapshot_tool_result_and_reasoning_before_next_call():
 trace=CycleTrace();records=[];live=[]
 trace.record=lambda role,content,**extra:records.append(dict(role=role,content=content,**extra))
 trace.publish=live.append
 async def handler(request):
  trace.chunk(AIMessageChunk(content='',additional_kwargs={'reasoning_content':'inspect inputs'}))
  return NS(result=[AIMessage(content='read file')])
 await trace.awrap_model_call(NS(messages=[HumanMessage(content='question')],system_message=NS(content='system')),handler)
 await trace.awrap_model_call(NS(messages=[ToolMessage(content='file data',tool_call_id='t1')],system_message=None),handler)
 assert [x['kind'] for x in records]==['model_input','reasoning','model_end']*2
 assert records[0]['model_call_id']!=records[3]['model_call_id']
 assert json.loads(records[3]['content'])['messages'][0]['tool_call_id']=='t1'
 assert live[0]['item']['content']=='inspect inputs'

@pytest.mark.asyncio
async def test_partial_reasoning_survives_failure():
 trace=CycleTrace();records=[]
 trace.record=lambda role,content,**extra:records.append(dict(content=content,**extra))
 async def handler(request):
  trace.chunk(AIMessageChunk(content='',additional_kwargs={'reasoning_content':'partial'}))
  raise TimeoutError()
 with pytest.raises(TimeoutError):await trace.awrap_model_call(NS(messages=[],system_message=None),handler)
 assert any(x['kind']=='reasoning' and x['content']=='partial' for x in records)
 assert any(x['kind']=='model_failed' for x in records)

def test_run_query_does_not_drop_old_events(tmp_path,monkeypatch):
 monkeypatch.setattr(store,'DB',tmp_path/'trace.sqlite')
 for run in ('old','new'):
  for i in range(230):store.append_trajectory('p','s',run,i,{'id':run+str(i)})
 page=store.run_trajectory('p','s','old',0,100)
 assert page['total']==230 and page['items'][0]['id']=='old0' and page['next_offset']==100
 assert store.run_trajectory('p','s','old',200,100)['next_offset'] is None
 assert store.run_trajectory('other','s','old')['items']==[]

@pytest.mark.asyncio
async def test_real_langchain_graph_two_model_cycles():
 from langchain.agents import create_agent
 from langchain_core.language_models.chat_models import BaseChatModel
 from langchain_core.outputs import ChatResult,ChatGeneration
 from langchain_core.tools import tool
 class Model(BaseChatModel):
  @property
  def _llm_type(self):return 'cycle-test'
  def bind_tools(self,tools,**kwargs):return self
  def _generate(self,messages,stop=None,run_manager=None,**kwargs):
   if any(isinstance(m,ToolMessage) for m in messages):
    message=AIMessage(content='done',additional_kwargs={'reasoning_content':'checked result'})
   else:message=AIMessage(content='read file',additional_kwargs={'reasoning_content':'need file'},tool_calls=[{'id':'tool-1','name':'read_sample','args':{}}])
   return ChatResult(generations=[ChatGeneration(message=message)])
 @tool
 def read_sample()->str:
  """Read a sample file."""
  return 'file result'
 trace=CycleTrace();records=[]
 trace.record=lambda role,content,**extra:records.append(dict(role=role,content=content,**extra))
 graph=create_agent(model=Model(),tools=[read_sample],middleware=[trace],system_prompt='test system')
 async for mode,payload in graph.astream({'messages':[HumanMessage(content='read then answer')]},stream_mode=['messages','updates']):
  if mode=='messages':trace.chunk(payload[0])
 inputs=[x for x in records if x['kind']=='model_input']
 assert len(inputs)==2
 assert 'file result' in inputs[1]['content']
 assert 'read_sample' in inputs[0]['content']
 assert len([x for x in records if x['kind']=='reasoning'])==2
