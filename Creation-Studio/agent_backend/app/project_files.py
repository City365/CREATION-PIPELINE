"""Project-owned physical files. Global DB only resolves stable legacy file IDs.

All paths in the portable project index are relative to a controller-validated root.
No fallback write into the application's private workspace is permitted.
"""
from contextlib import closing
import contextvars
import hashlib
import json
import os
import re
import shutil
import sqlite3
import threading
import uuid
from pathlib import Path
from fastapi import HTTPException
from app import store

LOCK = threading.RLock()
BOUND_ROOTS = contextvars.ContextVar('project_file_roots',default={})
AGENT_FOLDER = '智能体工作区'
SCRIPT_SUFFIXES = {'.py', '.js', '.cjs', '.mjs', '.ts', '.sh', '.css', '.sql', '.yaml', '.yml'}


def project_root(project):
    bound = BOUND_ROOTS.get().get(project)
    if bound is not None:
        if not bound.is_dir():raise HTTPException(409,'本次运行绑定的项目目录不可用')
        return bound
    from app.create_tools import _http
    if not project:
        raise HTTPException(422, '请先选择项目，再创建工作区文件')
    try:
        projects = _http('GET', '/api/projects', timeout=10)
        if isinstance(projects, dict):
            projects = projects.get('items', [])
        item = next((p for p in projects if p.get('id') == project), None)
        raw = (item or {}).get('dir')
        if not raw:
            raise ValueError('项目未注册工作目录')
        root = Path(raw).resolve(strict=True)
        if not root.is_dir():
            raise ValueError('项目目录不存在')
        return root
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(409, '项目工作目录不可用，请检查项目位置；未回退到后端目录') from exc


def inside(root, path):
    root, path = Path(root).resolve(), Path(path).resolve()
    if path != root and root not in path.parents:
        raise HTTPException(403, '文件不在当前项目工作区内')
    return path


def slug(value):
    text = re.sub(r'[\\/*?:"<>|\r\n\t]', '_', str(value or '')).strip(' .')[:60]
    if not text or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', text, re.I):
        text = '文件'
    return text


def connect():
    db = store.connect()
    db.execute('CREATE TABLE IF NOT EXISTS workspace_locations (file_id TEXT PRIMARY KEY, project TEXT NOT NULL, relative_path TEXT NOT NULL, origin TEXT NOT NULL, category TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, UNIQUE(project,relative_path))')
    db.execute('CREATE TABLE IF NOT EXISTS workspace_links (project TEXT NOT NULL, session_id TEXT NOT NULL, file_id TEXT NOT NULL, PRIMARY KEY(project,session_id,file_id))')
    if 'role' not in {r[1] for r in db.execute('PRAGMA table_info(workspace_links)')}:
        db.execute('ALTER TABLE workspace_links ADD COLUMN role TEXT')
    db.execute('CREATE TABLE IF NOT EXISTS workspace_versions (file_id TEXT NOT NULL, version INTEGER NOT NULL, relative_path TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(file_id,version))')
    return db


def location(file_id):
    with closing(connect()) as db, db:
        row = db.execute('SELECT project,relative_path,origin,category,version FROM workspace_locations WHERE file_id=?', (file_id,)).fetchone()
    return dict(zip(('project','relative_path','origin','category','version'),row)) if row else None


def resolve(item):
    loc = location(item['id'])
    if not loc:
        return None
    if loc['project'] != item['project']:
        raise HTTPException(403, '文件不属于当前项目')
    root = project_root(item['project'])
    return inside(root, root / loc['relative_path'])


def session_dir(project, session_id, root=None):
    root = Path(root) if root is not None else project_root(project)
    # Stable ID, not mutable title; renaming a conversation does not rename its files.
    sid = slug(session_id or '项目资料')
    folder = inside(root, root / AGENT_FOLDER / ('对话' if session_id else '项目资料') / sid)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def destination(project, session_id, name, suffix, origin, collection_id=None):
    root = project_root(project)
    folder = session_dir(project, session_id, root)
    category = '输入' if origin == 'input' else '脚本' if suffix in SCRIPT_SUFFIXES else '文档'
    if collection_id:
        folder = inside(root, root / AGENT_FOLDER / '知识库' / slug(collection_id))
    folder = inside(root, folder / category)
    folder.mkdir(parents=True, exist_ok=True)
    target = inside(root, folder / slug(name))
    if target.exists():
        target = inside(root, folder / (target.stem[:45] + '-' + uuid.uuid4().hex[:8] + suffix))
    return root, target, category


def enrich(item):
    loc = location(item['id'])
    return {**item, **(loc or {}), 'storage': 'project' if loc else 'legacy'}


def mirror(project, root=None):
    """Portable relative-path manifest; primary content never lives in this index."""
    root = root or project_root(project)
    folder = inside(root, root / AGENT_FOLDER / '.索引')
    folder.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        files = db.execute('SELECT l.file_id,l.relative_path,l.origin,l.category,l.version,f.name,f.digest FROM workspace_locations l JOIN workspace_files f ON f.id=l.file_id WHERE l.project=?', (project,)).fetchall()
        links = db.execute('SELECT session_id,file_id,role FROM workspace_links WHERE project=?', (project,)).fetchall()
        versions = db.execute('SELECT v.file_id,v.version,v.relative_path,v.digest FROM workspace_versions v JOIN workspace_locations l ON l.file_id=v.file_id WHERE l.project=?', (project,)).fetchall()
    with closing(sqlite3.connect(folder / 'workspace.sqlite', timeout=10)) as db, db:
        db.execute('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT)')
        db.execute("INSERT OR REPLACE INTO meta VALUES('schema_version','1')")
        db.execute('CREATE TABLE IF NOT EXISTS files(file_id TEXT PRIMARY KEY,relative_path TEXT,origin TEXT,category TEXT,version INTEGER,name TEXT,digest TEXT)')
        db.execute('CREATE TABLE IF NOT EXISTS links(session_id TEXT,file_id TEXT,role TEXT,PRIMARY KEY(session_id,file_id))')
        if 'role' not in {r[1] for r in db.execute('PRAGMA table_info(links)')}:db.execute('ALTER TABLE links ADD COLUMN role TEXT')
        db.execute('CREATE TABLE IF NOT EXISTS versions(file_id TEXT,version INTEGER,relative_path TEXT,digest TEXT,PRIMARY KEY(file_id,version))')
        for table in ('files','links','versions'):
            db.execute('DELETE FROM ' + table)
        db.executemany('INSERT INTO files VALUES(?,?,?,?,?,?,?)', files)
        db.executemany('INSERT INTO links VALUES(?,?,?)', links)
        db.executemany('INSERT INTO versions VALUES(?,?,?,?)', versions)
    for sid in {row[0] for row in links if row[0]}:
        folder = session_dir(project, sid, root)
        ids = {fid for s,fid,role in links if s == sid}
        payload = {'schema_version':1,'projectId':project,'sessionId':sid,'files':[dict(zip(('fileId','relativePath','origin','category','version','name','digest'),row)) for row in files if row[0] in ids]}
        atomic(folder / '文件清单.json', json.dumps(payload, ensure_ascii=False, indent=2).encode())


def atomic(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_bytes(data)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def attach(file_id, project, session_id, path, origin, category, root=None):
    root = root or project_root(project)
    relative = inside(root, path).relative_to(root).as_posix()
    with connect() as db:
        db.execute("INSERT INTO workspace_locations(file_id,project,relative_path,origin,category) VALUES(?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET relative_path=excluded.relative_path,origin=CASE WHEN excluded.origin='input' THEN workspace_locations.origin ELSE excluded.origin END,category=excluded.category", (file_id,project,relative,origin,category))
        if session_id:
            db.execute('INSERT INTO workspace_links(project,session_id,file_id,role) VALUES(?,?,?,?) ON CONFLICT(project,session_id,file_id) DO UPDATE SET role=excluded.role',(project,session_id,file_id,origin))
    mirror(project, root)


def shared(project, session_id, file_id):
    with connect() as db:
        return bool(db.execute('SELECT 1 FROM workspace_links WHERE project=? AND session_id=? AND file_id=?',(project,session_id,file_id)).fetchone())


def register_existing(project, session_id, path, name='', suffix='', origin='generated'):
    from app import workspace
    root = project_root(project)
    target = inside(root, path)
    if not target.is_file():
        raise HTTPException(404, '文件不存在，不能登记为交付文件')
    suffix = suffix or target.suffix.lower()
    if suffix not in workspace.EXTENSIONS:
        raise HTTPException(400, '不支持登记该文件类型')
    if session_id and not store.get_session(project, session_id):
        raise HTTPException(404, '所属对话不存在')
    size = target.stat().st_size
    if not size or size > 256*1024*1024:
        raise HTTPException(400, '登记文件不能为空且不能超过 256 MB')
    data = target.read_bytes()
    if suffix == '.json':
        try: json.loads(data.decode('utf-8-sig'))
        except (ValueError, UnicodeError) as exc: raise HTTPException(400, '文件不是合法 JSON') from exc
    if suffix in {'.txt','.md','.csv','.json'} | SCRIPT_SUFFIXES and not data.strip():
        raise HTTPException(400,'文件是空的，没有可发布内容')
    digest = hashlib.sha256(data).hexdigest()
    relative = target.relative_to(root).as_posix()
    with LOCK:
        with connect() as db:
            row = db.execute('SELECT file_id FROM workspace_locations WHERE project=? AND relative_path=?',(project,relative)).fetchone()
        if row:
            item = workspace.file_record(project,row[0])
            if origin=='work' and item.get('origin')=='generated':origin='generated'
            if item.get('digest')==digest and shared(project,session_id,item['id']) and item.get('origin')==origin:
                return {**item,'path':str(target)}
            workspace.reindex(item, data)
            attach(item['id'],project,session_id,target,origin,'脚本' if suffix in SCRIPT_SUFFIXES else '文件',root)
        else:
            item = workspace.save_upload(project,name or target.name,data,session_id=session_id,source=str(target),existing_path=target,origin=origin)
        return {**workspace.file_record(project,item['id']), 'origin':origin, 'path':str(target), 'digest':digest}


def before_write(project, path):
    root = project_root(project)
    target = inside(root, path)
    if not target.exists(): return
    relative = target.relative_to(root).as_posix()
    with connect() as db:
        row = db.execute('SELECT file_id,version FROM workspace_locations WHERE project=? AND relative_path=?',(project,relative)).fetchone()
    if not row: return
    file_id, version = row
    archive = inside(root,root / AGENT_FOLDER / '版本' / file_id / (str(version) + '-' + target.name))
    archive.parent.mkdir(parents=True, exist_ok=True)
    # Never overwrite a retained historical version.
    if not archive.exists(): shutil.copy2(target,archive)
    with connect() as db:
        db.execute('INSERT OR IGNORE INTO workspace_versions VALUES(?,?,?,?)',(file_id,version,archive.relative_to(root).as_posix(),hashlib.sha256(archive.read_bytes()).hexdigest()))
        db.execute('UPDATE workspace_locations SET version=version+1 WHERE file_id=?',(file_id,))
    return str(archive)


def export_session(project, conversation):
    root = project_root(project)
    folder = session_dir(project,conversation['id'],root)
    # Only visible conversation data; never dump configuration or private tool headers.
    messages = [{'id':m.get('id'),'role':m.get('role'),'text':m.get('text',''),'time':m.get('time'),'files':m.get('files',[]),'artifacts':(m.get('execution') or {}).get('artifacts',[])} for m in conversation.get('messages',[])]
    payload = {'schema_version':1,'projectId':project,'id':conversation['id'],'title':conversation.get('title',''),'messages':messages}
    atomic(folder/'会话记录.json',json.dumps(payload,ensure_ascii=False,indent=2).encode())
    text = '# ' + str(conversation.get('title') or '对话') + '\n\n' + '\n\n'.join('## '+('用户' if m['role']=='user' else '助手')+'\n\n'+str(m['text']) for m in messages)
    atomic(folder/'会话记录.md',text.encode())


def _page(project, session_id, kind='output', page=1):
    from app import workspace
    with workspace.db_open() as db:
        connect().close()
        condition = 'f.project=? AND (f.session_id=? OR EXISTS(SELECT 1 FROM workspace_links l WHERE l.project=f.project AND l.session_id=? AND l.file_id=f.id))'
        args = [project,session_id,session_id]
        role="COALESCE((SELECT l.role FROM workspace_links l WHERE l.project=f.project AND l.session_id=? AND l.file_id=f.id),p.origin,'input')"
        args.append(session_id)
        if kind == 'input':condition += ' AND '+role+"='input'"
        else:condition += ' AND ('+role+"!='input' OR p.file_id IS NULL AND f.source IS NOT NULL)"
        query = ' FROM workspace_files f LEFT JOIN workspace_locations p ON p.file_id=f.id WHERE '+condition
        total = db.execute('SELECT COUNT(*)'+query,args).fetchone()[0]
        page = max(1,min(int(page),max(1,(total+9)//10)))
        ids = db.execute('SELECT f.id'+query+' ORDER BY f.created DESC,f.id LIMIT 10 OFFSET ?',args+[(page-1)*10]).fetchall()
    items = []
    for fid, in ids:
        item = workspace.file_record(project,fid)
        item.pop('text',None)
        try:
            path = workspace.file_path(item)
            item.update(path=str(path),missing=not path.is_file())
        except HTTPException:
            item.update(missing=True,path='')
        items.append(item)
    return {'items':items,'total':total,'page':page,'pageSize':10}


def scan_session(project,session_id):
    """Recover outputs written by scripts in this session only; bounded work, no whole-project crawl."""
    from app import workspace
    folder=session_dir(project,session_id)
    recovered=[];errors=[]
    for index,path in enumerate(folder.rglob('*')):
        if index>=500:break
        if not path.is_file() or path.name in {'会话记录.md','会话记录.json','文件清单.json'} or path.suffix.lower() not in workspace.EXTENSIONS:continue
        if any(part.startswith('.') or part in {'输入','临时','版本'} for part in path.relative_to(folder).parts):continue
        try:
            item=register_existing(project,session_id,path,origin='work')
            recovered.append(item['id'])
        except Exception as exc:errors.append({'name':path.name,'error':str(exc)})
    return {'files':recovered,'errors':errors}


def page(project,session_id,kind='output',page=1):
    root=project_root(project)
    token=BOUND_ROOTS.set({**BOUND_ROOTS.get(),project:root})
    try:return _page(project,session_id,kind,page)
    finally:BOUND_ROOTS.reset(token)
