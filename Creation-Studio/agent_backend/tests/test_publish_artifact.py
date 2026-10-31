"""Publishing registers original project files; it must never rebuild their contents."""
import io
import pytest
from openpyxl import Workbook, load_workbook
from app import workspace,store,project_files
from app.fs_tools import build_local_tools

@pytest.fixture
def setup(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB',tmp_path/'chat.db')
    root=tmp_path/'project';root.mkdir()
    monkeypatch.setattr(project_files,'project_root',lambda project:root)
    store.save('p1',{'id':'s1','title':'测试','messages':[]})
    events=[];receipt={}
    tools={t.name:t for t in build_local_tools('p1','s1',publish=events.append,receipt=receipt)}
    return root,tools,events,receipt

def test_publish_original_and_repeat_is_idempotent(setup):
    root,tools,events,receipt=setup
    file=root/'原始.md';file.write_text('# 原始',encoding='utf8')
    original=file.read_bytes()
    result=tools['publish_artifact'].invoke({'path':str(file)})
    assert result['ok'],result
    item=result['artifact']
    assert workspace.file_path(workspace.file_record('p1',item['id']))==file
    assert file.read_bytes()==original
    assert tools['publish_artifact'].invoke({'path':str(file)})['artifact']['id']==item['id']
    assert len(receipt['artifacts'])==1
    assert events[0]['type']=='artifact'

def test_excel_bytes_and_formulas_preserved(setup):
    root,tools,events,receipt=setup
    file=root/'表.xlsx';book=Workbook();book.active['A1']='=1+1';book.active['A1'].number_format='0.00';book.save(file)
    original=file.read_bytes()
    result=tools['publish_artifact'].invoke({'path':str(file)})
    assert result['ok'],result
    assert file.read_bytes()==original
    saved=workspace.file_path(workspace.file_record('p1',result['artifact']['id']))
    assert load_workbook(saved).active['A1'].value=='=1+1'

@pytest.mark.parametrize('name,body,error',[('bad.exe',b'MZ','只支持'),('empty.txt',b'  ','空'),('bad.json',b'{bad','合法 JSON')])
def test_reject_bad_publish(setup,name,body,error):
    root,tools,_,receipt=setup
    file=root/name;file.write_bytes(body)
    result=tools['publish_artifact'].invoke({'path':str(file)})
    assert not result['ok'] and error in result['error'],result
    assert not receipt

def test_publish_outside_project_denied(setup,tmp_path):
    _,tools,_,_=setup
    file=tmp_path/'outside.md';file.write_text('outside')
    assert not tools['publish_artifact'].invoke({'path':str(file)})['ok']

def test_write_script_auto_registers_and_versions(setup):
    root,tools,events,_=setup
    result=tools['write_file'].invoke({'path':'脚本/demo.py','content':'print(1)'})
    assert result['ok'] and result['file_id'],result
    item=workspace.file_record('p1',result['file_id'])
    target=workspace.file_path(item)
    assert root in target.parents and '智能体工作区' in str(target)
    result2=tools['write_file'].invoke({'path':'脚本/demo.py','content':'print(2)'})
    assert result2['file_id']==result['file_id']
    assert workspace.file_record('p1',result['file_id'])['version']==2
    with project_files.connect() as db:
        row=db.execute('SELECT relative_path FROM workspace_versions WHERE file_id=?',(result['file_id'],)).fetchone()
    assert (root/row[0]).read_text()=='print(1)'
    assert events[-1]['type']=='workspace_file'

def test_workspace_blocks_generic_command(setup):
    _,tools,_,_=setup
    result=tools['run_command'].invoke({'command':'echo 1'})
    assert not result['ok'] and result['blocked']


def test_move_updates_stable_file_reference(setup):
    root,tools,_,_=setup
    item=tools['write_file'].invoke({'path':'原名.md','content':'keep'})
    record=workspace.file_record('p1',item['file_id'])
    old=workspace.file_path(record)
    result=tools['move_file'].invoke({'src':str(old),'dst':str(root/'assets'/'新名.md')})
    assert result['ok'],result
    new=workspace.file_path(workspace.file_record('p1',item['file_id']))
    assert new.name=='新名.md' and new.read_text()=='keep'
