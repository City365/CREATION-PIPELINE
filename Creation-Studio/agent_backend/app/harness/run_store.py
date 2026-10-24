"""Durable run ownership. SQLite transactions arbitrate across workers."""
import json, time, uuid
from contextlib import closing
from app import store

TERMINAL={'succeeded','partial','blocked','failed','cancelled','budget_exceeded','interrupted'}
class Conflict(Exception):
    def __init__(self, message, run_id=None):super().__init__(message);self.run_id=run_id

def now():return int(time.time()*1000)
def connect():
    db=store.connect()
    db.execute('CREATE TABLE IF NOT EXISTS harness_runs (project TEXT NOT NULL,id TEXT NOT NULL,session_id TEXT NOT NULL,request_id TEXT NOT NULL,input_hash TEXT NOT NULL,status TEXT NOT NULL,lease_until INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project,id),UNIQUE(project,session_id,request_id))')
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS ix_harness_active ON harness_runs(project,session_id) WHERE lease_until>0')
    db.execute('CREATE TABLE IF NOT EXISTS harness_events (project TEXT NOT NULL,run_id TEXT NOT NULL,seq INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project,run_id,seq))')
    db.commit()
    return db

def _expired(db):
    rows=db.execute('SELECT project,id,payload FROM harness_runs WHERE lease_until>0 AND lease_until<?',(now(),)).fetchall()
    for project,rid,raw in rows:
        payload=json.loads(raw);payload.update(status='interrupted',outcome='interrupted',reason_code='lease_expired',finished_at=now())
        if payload.get('execution'):payload['execution'].update(status='interrupted',outcome='interrupted',reason_code='lease_expired',finished_at=payload['finished_at'])
        db.execute('UPDATE harness_runs SET status=?,lease_until=0,payload=? WHERE project=? AND id=?',('interrupted',json.dumps(payload,ensure_ascii=False),project,rid))

def claim(project,sid,request_id,input_hash,seconds=180,principal=None):
    with closing(connect()) as db,db:
        db.execute('BEGIN IMMEDIATE');_expired(db)
        row=db.execute('SELECT input_hash,payload FROM harness_runs WHERE project=? AND session_id=? AND request_id=?',(project,sid,request_id)).fetchone()
        if row:
            payload=json.loads(row[1])
            if row[0]!=input_hash:raise Conflict('同一请求编号不能用于不同内容',payload['id'])
            return payload,False
        row=db.execute('SELECT id FROM harness_runs WHERE project=? AND session_id=? AND lease_until>0',(project,sid)).fetchone()
        if row:raise Conflict('当前会话正在执行任务',row[0])
        if db.execute('SELECT COUNT(*) FROM harness_runs WHERE lease_until>0').fetchone()[0]>=8:raise Conflict('智能体全局并发已达上限')
        if db.execute('SELECT COUNT(*) FROM harness_runs WHERE project=? AND lease_until>0',(project,)).fetchone()[0]>=4:raise Conflict('当前项目并发已达上限')
        user_id=(principal or {}).get('user_id')
        if user_id and user_id!='development-local' and db.execute("SELECT COUNT(*) FROM harness_runs WHERE lease_until>0 AND json_extract(payload,'$.user_id')=?",(user_id,)).fetchone()[0]>=2:raise Conflict('当前用户并发已达上限')
        rid=str(uuid.uuid4());ts=now()
        payload={'id':rid,'run_id':rid,'session_id':sid,'project_id':project,'client_request_id':request_id,'input_hash':input_hash,'user_id':user_id,'security_mode':(principal or {}).get('security_mode','development'),'engine_version':'harness/2.0','policy_version':'runtime/2','status':'accepted','phase':'accepted','revision':1,'started_at':ts,'cancel_requested_at':None}
        db.execute('INSERT INTO harness_runs VALUES (?,?,?,?,?,?,?,?)',(project,rid,sid,request_id,input_hash,'accepted',ts+int((seconds+30)*1000),json.dumps(payload,ensure_ascii=False)))
        return payload,True

def get(project,rid):
    with closing(connect()) as db,db:
        _expired(db)
        row=db.execute('SELECT payload FROM harness_runs WHERE project=? AND id=?',(project,rid)).fetchone()
        return json.loads(row[0]) if row else None

def busy(project,sid):
    with closing(connect()) as db,db:
        _expired(db)
        return bool(db.execute('SELECT 1 FROM harness_runs WHERE project=? AND session_id=? AND lease_until>0',(project,sid)).fetchone())

def update(project,rid,**changes):
    with closing(connect()) as db,db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT payload,status FROM harness_runs WHERE project=? AND id=?',(project,rid)).fetchone()
        if not row:return None
        item=json.loads(row[0])
        if row[1] in TERMINAL:return item
        item.update(changes);item['revision']+=1
        lease=0 if item['status'] in TERMINAL else db.execute('SELECT lease_until FROM harness_runs WHERE project=? AND id=?',(project,rid)).fetchone()[0]
        db.execute('UPDATE harness_runs SET payload=?,status=?,lease_until=? WHERE project=? AND id=?',(json.dumps(item,ensure_ascii=False),item['status'],lease,project,rid))
        return item

def cancel(project,rid):
    return update(project,rid,cancel_requested_at=now())

def append_event(project,rid,event):
    with closing(connect()) as db,db:
        db.execute('BEGIN IMMEDIATE')
        seq=db.execute('SELECT COALESCE(MAX(seq),0)+1 FROM harness_events WHERE project=? AND run_id=?',(project,rid)).fetchone()[0]
        result={**event,'run_id':rid,'sequence':seq,'event_id':rid+':'+str(seq),'schema_version':'run-event/1.0','timestamp':now()}
        db.execute('INSERT INTO harness_events VALUES (?,?,?,?)',(project,rid,seq,json.dumps(result,ensure_ascii=False)))
        return result

def events(project,rid,after=0,limit=100):
    with closing(connect()) as db:
        return [json.loads(r[0]) for r in db.execute('SELECT payload FROM harness_events WHERE project=? AND run_id=? AND seq>? ORDER BY seq LIMIT ?',(project,rid,after,limit))]

def find_request(project,sid,request_id):
    with closing(connect()) as db:
        row=db.execute('SELECT id FROM harness_runs WHERE project=? AND session_id=? AND request_id=?',(project,sid,request_id)).fetchone()
        return get(project,row[0]) if row else None


def sweep():
    with closing(connect()) as db,db:_expired(db)
