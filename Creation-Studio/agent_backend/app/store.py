"""Project-scoped conversation storage; no historical source database is imported."""
import json, sqlite3, time, os
from pathlib import Path
DB = Path(os.getenv('WMD_AGENT_DB') or Path(__file__).resolve().parents[1] / 'data' / 'conversations.db')
def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=10)
    db.execute('CREATE TABLE IF NOT EXISTS conversations (project TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project,id))')
    return db
def list_sessions(project):
    with connect() as db:
        return sorted([json.loads(r[0]) for r in db.execute('SELECT payload FROM conversations WHERE project=?',(project,))],key=lambda c:c['updated'],reverse=True)
def get_session(project, sid):
    with connect() as db:
        r=db.execute('SELECT payload FROM conversations WHERE project=? AND id=?',(project,sid)).fetchone()
        return json.loads(r[0]) if r else None
def save(project, c):
    with connect() as db:
        db.execute('INSERT INTO conversations VALUES (?,?,?) ON CONFLICT(project,id) DO UPDATE SET payload=excluded.payload',(project,c['id'],json.dumps(c,ensure_ascii=False)))
    try:
        from app.project_files import export_session
        export_session(project,c)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning('项目会话导出待恢复：%s',exc)

def delete(project,sid):
    with connect() as db:
        db.execute('DELETE FROM conversations WHERE project=? AND id=?',(project,sid))

# Immutable per-request receipts are separate from editable conversation messages.
def save_run(project, payload):
    with connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS executions (project TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project,id))')
        db.execute('INSERT INTO executions VALUES (?,?,?)',(project,payload['id'],json.dumps(payload,ensure_ascii=False)))
def get_run(project, run_id):
    with connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS executions (project TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project,id))')
        row=db.execute('SELECT payload FROM executions WHERE project=? AND id=?',(project,run_id)).fetchone()
        return json.loads(row[0]) if row else None

# Role-level events are stored separately and fetched only by the trajectory endpoint.
def trajectory_table(db):
    db.execute('CREATE TABLE IF NOT EXISTS trajectory_events (project TEXT NOT NULL, session_id TEXT NOT NULL, run_id TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project,run_id,seq))')
    db.execute('CREATE INDEX IF NOT EXISTS ix_trajectory_session ON trajectory_events(project,session_id)')
def append_trajectory(project, sid, run_id, seq, payload):
    with connect() as db:
        trajectory_table(db)
        db.execute('INSERT INTO trajectory_events VALUES (?,?,?,?,?)',(project,sid,run_id,seq,json.dumps(payload,ensure_ascii=False)))
def session_trajectory(project, sid, offset=None, limit=50):
    with connect() as db:
        trajectory_table(db)
        total=db.execute('SELECT COUNT(*) FROM trajectory_events WHERE project=? AND session_id=?',(project,sid)).fetchone()[0]
        if offset is None:offset=max(total-limit,0)
        rows=db.execute('SELECT payload FROM trajectory_events WHERE project=? AND session_id=? ORDER BY rowid LIMIT ? OFFSET ?',(project,sid,limit,offset)).fetchall()
        items=[{**json.loads(row[0]),'position':offset+i} for i,row in enumerate(rows)]
        return {'items':items,'total':total,'offset':offset,'previous_offset':max(offset-limit,0) if offset else None,'next_offset':offset+len(items) if offset+len(items)<total else None}

# Separate from editable messages: UI saves cannot overwrite compacted context.
def get_compaction(project, sid):
    with connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS compactions (project TEXT NOT NULL, session_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project,session_id))')
        row=db.execute('SELECT payload FROM compactions WHERE project=? AND session_id=?',(project,sid)).fetchone()
        return json.loads(row[0]) if row else None

def save_compaction(project, sid, payload):
    with connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS compactions (project TEXT NOT NULL, session_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project,session_id))')
        db.execute('INSERT INTO compactions VALUES (?,?,?) ON CONFLICT(project,session_id) DO UPDATE SET payload=excluded.payload',(project,sid,json.dumps(payload,ensure_ascii=False)))
