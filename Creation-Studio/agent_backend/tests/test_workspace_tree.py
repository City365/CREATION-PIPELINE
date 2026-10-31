import pytest
from app import store,workspace,project_files
from test_chat import client,headers,create


def test_tree_lists_actual_project_directories_and_pages(client):
    create(client)
    root=project_files.project_root('p1')
    (root/'assets'/'素材').mkdir(parents=True)
    for i in range(55):(root/'assets'/'素材'/('角色'+str(i)+'.md')).write_text('hello')
    (root/'.索引').mkdir();(root/'.索引'/'private.txt').write_text('hidden')
    response=client.get('/agent/workspace/tree',headers=headers())
    assert response.status_code==200
    names=[n['name'] for n in response.json()['items']]
    assert 'assets' in names and '.索引' not in names
    response=client.get('/agent/workspace/tree?path=assets/素材',headers=headers()).json()
    assert len(response['items'])==50 and response['nextOffset']==50
    assert len(client.get('/agent/workspace/tree?path=assets/素材&offset=50',headers=headers()).json()['items'])==5


def test_tree_file_opens_without_copy_or_claiming_conversation(client):
    create(client)
    root=project_files.project_root('p1');target=root/'场景说明.md';target.write_text('# 场景',encoding='utf8')
    response=client.post('/agent/workspace/open',headers=headers(),json={'relative_path':'场景说明.md'})
    assert response.status_code==200,response.text
    item=response.json()
    assert item['session_id'] is None
    assert workspace.file_path(workspace.file_record('p1',item['id']))==target
    assert client.post('/agent/workspace/open',headers=headers(),json={'relative_path':'场景说明.md'}).json()['id']==item['id']
    assert client.get('/agent/workspace/files/'+item['id']+'/preview',headers=headers()).json()['content']=='# 场景'
    assert project_files.page('p1','c1')['total']==0
    assert client.get('/agent/workspace/files/'+item['id']+'/preview',headers=headers('p2')).status_code==404


@pytest.mark.parametrize('path',['../outside.txt','.索引/private.txt'])
def test_tree_and_open_reject_escape_and_internal_files(client,path):
    create(client)
    assert client.get('/agent/workspace/tree',headers=headers(),params={'path':path}).status_code in (403,404)
    assert client.post('/agent/workspace/open',headers=headers(),json={'relative_path':path}).status_code in (403,404)


def test_browsing_image_does_not_call_ai_recognition(client,monkeypatch):
    create(client)
    root=project_files.project_root('p1');(root/'image.png').write_bytes(b'image')
    def forbidden(*args):raise AssertionError('Preview must not call AI')
    monkeypatch.setattr(workspace,'recognize_image_async',forbidden)
    assert client.post('/agent/workspace/open',headers=headers(),json={'relative_path':'image.png'}).status_code==200
