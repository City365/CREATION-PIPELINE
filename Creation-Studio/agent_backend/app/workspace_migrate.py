"""Verified, resumable copy migration. Originals are never removed.

CLI: python -m app.workspace_migrate --project ID --report FILE [--apply]
Apply and rollback require the agent service to be stopped. Default is inventory only.
"""
import argparse
import hashlib
import json
import shutil
import socket
import sqlite3
import time
from pathlib import Path
from app import store,workspace,project_files


def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def inventory(project):
    root=project_files.project_root(project)
    with workspace.db_open() as db:
        rows=db.execute('SELECT id FROM workspace_files WHERE project=?',(project,)).fetchall()
    generated=set()
    for c in store.list_sessions(project):
        for m in c.get('messages',[]):
            generated.update(a.get('id') for a in (m.get('execution') or {}).get('artifacts',[]))
    files=[]
    for fid, in rows:
        item=workspace.file_record(project,fid)
        if project_files.location(fid):continue
        path=workspace.file_path(item)
        origin='generated' if fid in generated or item.get('source') else 'input'
        files.append({'id':fid,'sessionId':item['session_id'],'name':item['name'],'collectionId':item['collection_id'],'source':str(path),'originalSource':item.get('source'),'origin':origin,'exists':path.is_file(),'digest':sha(path) if path.is_file() else None,'size':path.stat().st_size if path.is_file() else 0,'recordedDigest':item['digest']})
    return {'schema_version':1,'projectId':project,'root':str(root),'createdAt':int(time.time()*1000),'files':files,'note':'原文件保留；缺失或内容不符时跳过'}


def require_offline(port=17820):
    with socket.socket() as s:
        if s.connect_ex(('127.0.0.1',port))==0:
            raise RuntimeError('迁移写入前请停止智能体服务，避免旧进程同时写入；未迁移文件')


def apply(report):
    project=report['projectId'];root=project_files.project_root(project)
    if str(root)!=report['root']:raise RuntimeError('项目根已变动，请重新盘点')
    journal=Path(report['journal'])
    journal.parent.mkdir(parents=True,exist_ok=True)
    # Online SQLite backup is consistent even when WAL exists; do not copy only .db.
    backup=journal.with_suffix('.db')
    if not backup.exists():
        with store.connect() as src,sqlite3.connect(backup) as dst:src.backup(dst)
    project_files.atomic(journal,json.dumps(report,ensure_ascii=False,indent=2).encode())
    for file in report['files']:
        if project_files.location(file['id']):
            if file.get('state')=='copied':continue
            file['state']='copied' if file.get('target') and project_files.resolve({'id':file['id'],'project':project})==Path(file['target']) else 'already_indexed'
            continue
        source=Path(file['source'])
        if not source.is_file():file['state']='missing';continue
        digest=sha(source)
        if digest!=file['digest'] or digest!=file['recordedDigest']:
            file['state']='changed';continue
        item=workspace.file_record(project,file['id'])
        original=Path(file.get('originalSource') or '')
        if original.is_file() and root in original.resolve().parents and sha(original)==digest:
            project_files.attach(item['id'],project,item['session_id'],original,file['origin'],'文件',root)
            file.update(state='copied',target=str(original))
            project_files.atomic(journal,json.dumps(report,ensure_ascii=False,indent=2).encode())
            continue
        if file.get('target') and file.get('state')=='copying':
            target=project_files.inside(root,Path(file['target']));category=target.parent.name
        else:
            _,target,category=project_files.destination(project,item['session_id'],item['name'],item['suffix'],file['origin'],item['collection_id'])
        # Intent precedes copying, so an interrupted copy has a recoverable target.
        file.update(target=str(target),state='copying')
        project_files.atomic(journal,json.dumps(report,ensure_ascii=False,indent=2).encode())
        shutil.copy2(source,target)
        if sha(target)!=digest:raise RuntimeError('复制校验失败：'+item['name'])
        project_files.attach(item['id'],project,item['session_id'],target,file['origin'],category,root)
        file['state']='copied'
        project_files.atomic(journal,json.dumps(report,ensure_ascii=False,indent=2).encode())
    for c in store.list_sessions(project):project_files.export_session(project,c)
    project_files.atomic(journal,json.dumps(report,ensure_ascii=False,indent=2).encode())
    return report


def rollback(report):
    project=report['projectId']
    for file in report['files']:
        if file.get('state')!='copied':continue
        loc=project_files.location(file['id'])
        target=Path(file.get('target',''))
        root=project_files.project_root(project)
        # Refuse rollback after a user edited, relocated or versioned the migrated entity.
        if not loc or project_files.inside(root,root/loc['relative_path'])!=target or not target.is_file() or sha(target)!=file['digest'] or loc['version']!=1:
            raise RuntimeError('文件已变化，不能覆盖回滚：'+file['name'])
    with project_files.connect() as db:
        for file in report['files']:
            if file.get('state')=='copied':
                db.execute('DELETE FROM workspace_links WHERE file_id=?',(file['id'],))
                db.execute('DELETE FROM workspace_locations WHERE file_id=?',(file['id'],))
    project_files.mirror(project)
    # Retain both source and verified target until explicit cleanup.
    return {'ok':True,'originals_preserved':True}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--project');parser.add_argument('--report',required=True)
    parser.add_argument('--apply',action='store_true');parser.add_argument('--rollback',action='store_true')
    args=parser.parse_args()
    path=Path(args.report)
    if args.apply or args.rollback:require_offline()
    if args.rollback:
        print(json.dumps(rollback(json.loads(path.read_text(encoding='utf8'))),ensure_ascii=False));return
    report=json.loads(path.read_text(encoding='utf8')) if args.apply and path.exists() else inventory(args.project)
    report['journal']=str(path)
    if args.apply:report=apply(report)
    else:project_files.atomic(path,json.dumps(report,ensure_ascii=False,indent=2).encode())
    print(json.dumps({'project':report['projectId'],'files':len(report['files']),'report':str(path)},ensure_ascii=False))

if __name__=='__main__':main()
