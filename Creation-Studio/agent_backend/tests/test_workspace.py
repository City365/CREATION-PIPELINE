import io
from openpyxl import Workbook
from app import workspace, store
from app.task_tools import build_task_tools
from test_chat import client, headers, create
import pytest

@pytest.fixture(autouse=True)
def workspace_root(tmp_path,monkeypatch):monkeypatch.setattr(workspace,'ROOT',tmp_path/'files')

def upload(client,name='口径说明.txt',data='通过率分母：已完成审批申请。验收编号 VERIFY-742。'.encode(),**form):
 return client.post('/agent/workspace/files',headers=headers(),files={'file':(name,data)},data=form)

def test_upload_index_read_and_isolation(client):
 create(client)
 response=upload(client,session_id='c1');assert response.status_code==200
 file=response.json();assert file['status']=='indexed'
 assert workspace.file_path(workspace.file_record('p1',file['id'])).exists()
 result=workspace.search_documents('p1','c1','通过率')
 assert result and result[0]['file_id']==file['id']
 text=client.get('/agent/workspace/files/'+file['id']+'/content',headers=headers()).json()
 assert 'VERIFY-742' in text['content']
 assert client.get('/agent/workspace/files/'+file['id']+'/content',headers=headers('p2')).status_code==404
 with pytest.raises(Exception):workspace.read_document('p1','other-conversation',file['id'])
 receipt={};sources={}
 tools={t.name:t for t in build_task_tools(receipt,'读附件',lambda e:None,sources,project='p1',session_id='c1')}
 result=tools['read_workspace_document'].invoke({'file_id':file['id']})
 assert result['ok'] and 'VERIFY-742' in result['content']
 assert sources[result['source_id']]['digest']==file['digest']
 assert client.delete('/agent/workspace/files/'+file['id'],headers=headers()).status_code==200
 assert not workspace.search_documents('p1','c1','通过率')

def test_knowledge_crud_and_documents(client):
 kb=client.post('/agent/knowledge',headers=headers(),json={'name':'口径知识库','description':'测试'}).json()
 file=upload(client,collection_id=kb['id']).json()
 assert workspace.read_document('p1','any-session',file['id'])['ok']
 assert client.get('/agent/knowledge',headers=headers()).json()[0]['file_count']==1
 assert client.put('/agent/knowledge/'+kb['id'],headers=headers(),json={'name':'已更名','description':'新说明'}).status_code==200
 assert client.delete('/agent/knowledge/'+kb['id'],headers=headers()).status_code==409
 assert client.get('/agent/knowledge',headers=headers('p2')).json()==[]
 client.delete('/agent/workspace/files/'+file['id'],headers=headers())
 assert client.delete('/agent/knowledge/'+kb['id'],headers=headers()).status_code==200

def test_images_and_bad_formats_are_not_invented(client):
 file=upload(client,'sample.png',b'placeholder-image').json()
 assert file['status']=='pending_recognition'
 assert client.get('/agent/workspace/files/'+file['id']+'/content',headers=headers()).json()['ok'] is False
 assert upload(client,'sample.exe',b'bad').status_code==400
 assert upload(client,'empty.txt',b'').status_code==400
 assert upload(client,'bad.pdf',b'not-pdf').json()['status']=='parse_failed'
 assert upload(client,session_id='foreign').status_code==404

def test_xlsx_and_plugin_crud(client):
 workbook=Workbook();workbook.active.append(['编号','说明']);workbook.active.append(['X-19','精确读取']);stream=io.BytesIO();workbook.save(stream)
 file=upload(client,'说明.xlsx',stream.getvalue()).json();assert file['status']=='indexed'
 assert 'X-19' in workspace.read_document('p1',None,file['id'])['content']
 for kind in ['tool','skill','mcp']:
  config={'instructions':'遵循真实证据来源。'} if kind=='skill' else {'url':'https://example.test','api_key':'test-secret'}
  body={'kind':kind,'name':'test-'+kind,'description':'配置管理测试','enabled':True,'config':config}
  response=client.post('/agent/plugins',headers=headers(),json=body)
  assert response.status_code==200
  plugin=response.json();assert plugin['runtime_status']==('available' if kind=='skill' else 'configured')
  listed=client.get('/agent/plugins',headers=headers()).json()
  assert 'test-secret' not in str(listed)
  if kind=='skill':
   tools={t.name:t for t in build_task_tools({},'读技能',lambda e:None,{},project='p1',session_id='c1')}
   assert tools['read_analysis_guidance'].invoke({'topic':'skill:'+plugin['id']})['content']=='遵循真实证据来源。'
  plugin['enabled']=False
  assert client.put('/agent/plugins/'+plugin['id'],headers=headers(),json=plugin).status_code==200
  assert client.get('/agent/plugins',headers=headers('p2')).json()==[]
  assert client.delete('/agent/plugins/'+plugin['id'],headers=headers()).status_code==200


def test_generated_artifacts_preview_and_ownership(client):
 create(client)
 events=[];receipt={};sources={}
 tools={t.name:t for t in build_task_tools(receipt,'生成文档',events.append,sources,project='p1',session_id='c1')}
 result=tools['create_workspace_artifact'].invoke({'name':'报告.md','format':'md','content':'# 报告\n\n**结论**：需复核。'})
 assert result['ok']
 file=receipt['artifacts'][0]
 assert events[-1]['type']=='artifact'
 url='/agent/workspace/files/'+file['id']+'/preview'
 preview=client.get(url,headers=headers()).json()
 assert preview['kind']=='markdown' and '# 报告' in preview['content']
 assert client.get(url,headers=headers('p2')).status_code==404
 import json
 xlsx=workspace.create_artifact('p1','c1','明细','xlsx',json.dumps({'sheets':[{'name':'样本','rows':[['编号','值'],['A',42],['公式','=1+1']]},{'name':'备注','rows':[['完成']]}]}))
 data=workspace.preview_file('p1',xlsx['id'])
 assert data['sheets']==['样本','备注'] and data['rows'][1]==['A',42]
 assert data['rows'][2][1]=="'=1+1"
 assert workspace.preview_file('p1',xlsx['id'],1)['rows']==[['完成']]
 with pytest.raises(Exception):workspace.preview_file('p1',xlsx['id'],9)
 html=workspace.create_artifact('p1','c1','页面','html','<h1>报告</h1><script>bad()</script>')
 assert workspace.preview_file('p1',html['id'])['kind']=='html'
 assert 'bad()' not in workspace.read_document('p1','c1',html['id'])['content']
 csv=upload(client,'wide.csv',(','.join(['x']*60)).encode()).json()
 assert workspace.preview_file('p1',csv['id'])['truncated']
 for suffix,kind in [('png','image'),('pdf','pdf'),('mp3','audio'),('mp4','video')]:
  item=upload(client,'sample.'+suffix,b'preview-test').json()
  assert workspace.preview_file('p1',item['id'])['kind']==kind
