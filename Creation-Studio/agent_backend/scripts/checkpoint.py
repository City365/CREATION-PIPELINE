"""Offline rollback checkpoint. Stop agent writes before running; never backs up credentials."""
import hashlib, json, shutil, sqlite3
from contextlib import closing
from pathlib import Path
from datetime import datetime
ROOT=Path(__file__).resolve().parents[2]
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def checkpoint():
    target=ROOT/'.git'/'agent-checkpoints'/datetime.now().strftime('%Y%m%d-%H%M%S')
    target.mkdir(parents=True,exist_ok=False)
    source=ROOT/'agent_backend'/'data'
    dbpath=source/'conversations.db'
    if dbpath.exists():
        with closing(sqlite3.connect(dbpath)) as db, closing(sqlite3.connect(target/'conversations.db')) as copy:db.backup(copy)
        with closing(sqlite3.connect(target/'conversations.db')) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    workspace=source/'workspace'
    if workspace.exists():shutil.copytree(workspace,target/'workspace')
    files={str(p.relative_to(target)):digest(p) for p in target.rglob('*') if p.is_file()}
    # Restore into a separate directory, never over the running data directory.
    with __import__('tempfile').TemporaryDirectory() as temp:
        restored=Path(temp)/'restored';shutil.copytree(target,restored)
        assert all(digest(restored/name)==value for name,value in files.items())
        if (restored/'conversations.db').exists():
            with closing(sqlite3.connect(restored/'conversations.db')) as db:assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    (target/'manifest.json').write_text(json.dumps({'files':files,'restore_verified':True},indent=2),encoding='utf-8')
    print(json.dumps({'path':str(target),'files':len(files),'restore_verified':True}))
if __name__=='__main__':checkpoint()
