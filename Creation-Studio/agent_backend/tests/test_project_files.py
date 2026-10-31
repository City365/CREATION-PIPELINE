import hashlib,json,sqlite3
from pathlib import Path
import pytest
from fastapi import HTTPException
from app import store,workspace,project_files,workspace_migrate
from test_chat import client,headers,create

@pytest.fixture
def local(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DB',tmp_path/'chat.db')
    return tmp_path

def session(project='p1',sid='s1'):
    store.save(project,{'id':sid,'title':'资产提取','messages':[],'updated':1})

def test_upload_is_project_owned_deduplicated_and_isolated(local):
    session()
    first=workspace.save_upload('p1','剧本.md',b'# story','s1')
    path=workspace.file_path(workspace.file_record('p1',first['id']))
    assert project_files.project_root('p1') in path.parents
    assert '智能体工作区' in str(path) and '输入' in str(path)
    assert workspace.save_upload('p1','剧本.md',b'# story','s1')['id']==first['id']
    assert workspace.file_path(workspace.file_record('p1',first['id']))==path
    with pytest.raises(HTTPException):workspace.file_record('p2',first['id'])
    assert not (workspace.ROOT/first['id']).exists()

def test_output_and_input_pagination_and_portable_index(local):
    session()
    workspace.save_upload('p1','输入.txt',b'input','s1')
    for i in range(12):workspace.create_artifact('p1','s1',str(i),'md','# '+str(i))
    page=project_files.page('p1','s1')
    assert page['total']==12 and len(page['items'])==10
    assert len(project_files.page('p1','s1',page=2)['items'])==2
    assert project_files.page('p1','s1','input')['total']==1
    root=project_files.project_root('p1')
    with sqlite3.connect(root/project_files.AGENT_FOLDER/'.索引/workspace.sqlite') as db:
        paths=[r[0] for r in db.execute('SELECT relative_path FROM files')]
    assert len(paths)==13 and all(not Path(p).is_absolute() for p in paths)
    assert (project_files.session_dir('p1','s1')/'文件清单.json').exists()

def test_shared_asset_no_copy_and_session_exports(local):
    session();session(sid='s2')
    root=project_files.project_root('p1');asset=root/'assets'/'素材'/'人物.png';asset.parent.mkdir(parents=True);asset.write_bytes(b'image')
    # No OCR calls during this registration test.
    old=workspace.recognize_image_async;workspace.recognize_image_async=lambda *a:None
    try:
        a=project_files.register_existing('p1','s1',asset)
        b=project_files.register_existing('p1','s2',asset)
    finally:workspace.recognize_image_async=old
    assert a['id']==b['id']
    assert workspace.file_record('p1',a['id'],'s2')['id']==a['id']
    assert project_files.page('p1','s2')['total']==1
    assert workspace.file_path(workspace.file_record('p1',a['id']))==asset
    assert (project_files.session_dir('p1','s1')/'会话记录.md').exists()

def test_project_move_uses_relative_paths_and_missing_root_fails(local,monkeypatch):
    session()
    item=workspace.create_artifact('p1','s1','报告','md','result')
    oldroot=project_files.project_root('p1');newroot=oldroot.with_name('relocated');oldroot.rename(newroot)
    monkeypatch.setattr(project_files,'project_root',lambda p:newroot)
    assert workspace.file_path(workspace.file_record('p1',item['id'])).read_text()=='result'
    def fail(p):raise HTTPException(409,'项目目录不可用')
    monkeypatch.setattr(project_files,'project_root',fail)
    with pytest.raises(HTTPException):workspace.create_artifact('p1','s1','不得回退','md','x')

def test_symlink_escape_denied(local):
    root=project_files.project_root('p1')
    with pytest.raises(HTTPException):project_files.inside(root,root/'..'/'outside.md')

def test_recover_script_output_does_not_scan_other_conversations(local):
    session();session(sid='s2')
    target=project_files.session_dir('p1','s1')/'脚本'/'result.py';target.parent.mkdir();target.write_text('print(1)')
    other=project_files.session_dir('p1','s2')/'not-yours.md';other.write_text('private')
    result=project_files.scan_session('p1','s1')
    assert len(result['files'])==1 and not result['errors']
    assert project_files.page('p1','s2')['total']==0

def test_legacy_migration_verified_rerunnable_and_rollback(local,monkeypatch):
    session()
    legacy=local/'legacy';monkeypatch.setattr(workspace,'ROOT',legacy)
    fid='file_legacy';folder=legacy/fid;folder.mkdir(parents=True);source=folder/'原文.md';source.write_bytes(b'original')
    with workspace.db_open() as db:
        db.execute('INSERT INTO workspace_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(fid,'p1','s1',None,'原文.md','.md',8,hashlib.sha256(b'original').hexdigest(),'indexed','original','',1,None))
    report=workspace_migrate.inventory('p1');report['journal']=str(local/'migration.json')
    assert len(report['files'])==1
    workspace_migrate.apply(report)
    path=workspace.file_path(workspace.file_record('p1',fid))
    assert path!=source and path.read_bytes()==source.read_bytes()
    assert source.exists()
    workspace_migrate.apply(report)
    assert workspace.file_path(workspace.file_record('p1',fid))==path
    workspace_migrate.rollback(report)
    assert workspace.file_path(workspace.file_record('p1',fid))==source
    assert path.exists()

def test_paged_api_and_version_ownership(client):
    create(client)
    artifact=workspace.create_artifact('p1','c1','报告','md','one')
    target=workspace.file_path(workspace.file_record('p1',artifact['id']))
    project_files.before_write('p1',target);target.write_text('two')
    project_files.register_existing('p1','c1',target)
    response=client.get('/agent/workspace/session-files?session_id=c1',headers=headers())
    assert response.status_code==200 and response.json()['items'][0]['version']==2
    path='/agent/workspace/files/'+artifact['id']+'/versions/1'
    assert client.get(path,headers=headers()).content==b'one'
    assert client.get(path,headers=headers('p2')).status_code==404
    assert client.get('/agent/workspace/session-files?session_id=c1',headers=headers('p2')).status_code==404


def test_same_asset_has_input_role_only_in_referencing_session(local):
    session();session(sid='s2')
    item=workspace.create_artifact('p1','s1','来源','md','hello')
    target=workspace.file_path(workspace.file_record('p1',item['id']))
    project_files.register_existing('p1','s2',target,origin='input')
    assert project_files.page('p1','s2','input')['total']==1
    assert project_files.page('p1','s2','output')['total']==0
    assert project_files.page('p1','s1','output')['total']==1
