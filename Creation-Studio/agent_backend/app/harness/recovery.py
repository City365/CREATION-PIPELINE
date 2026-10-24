"""Public task checkpoints only. Resume never replays an uncertain workspace write."""
import json, os
from contextlib import closing
from fastapi import HTTPException
from . import run_store

def connect():
    db=run_store.connect()
    db.execute('CREATE TABLE IF NOT EXISTS harness_checkpoints (project TEXT NOT NULL,run_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project,run_id))')
    db.execute('CREATE TABLE IF NOT EXISTS harness_tool_calls (project TEXT NOT NULL,run_id TEXT NOT NULL,call_key TEXT NOT NULL,name TEXT NOT NULL,is_write INTEGER NOT NULL,status TEXT NOT NULL,PRIMARY KEY(project,run_id,call_key))')
    db.commit();return db

def tool_state(ctx,key,name,write,status):
    with closing(connect()) as db,db:db.execute('INSERT INTO harness_tool_calls VALUES (?,?,?,?,?,?) ON CONFLICT(project,run_id,call_key) DO UPDATE SET status=excluded.status',(ctx.project,ctx.run_id,key,name,int(write),status))
def uncertain(project,rid):
    with closing(connect()) as db:
        return [{'call_key':r[0],'name':r[1],'status':r[2]} for r in db.execute("SELECT call_key,name,status FROM harness_tool_calls WHERE project=? AND run_id=? AND is_write=1 AND status!='succeeded'",(project,rid))]
def save(ctx):
    receipt=ctx.receipt or {}
    payload={'schema_version':'task-checkpoint/1','created_at':run_store.now(),'plan':receipt.get('plan'),'artifacts':receipt.get('artifacts',[]),'sources':getattr(ctx,'sources',{}),'resource_hash':(receipt.get('resource_snapshot') or {}).get('snapshot_hash'),'skill_manifest':getattr(ctx,'skill_manifest',[]),'active_skills':sorted(getattr(ctx,'active_skills',set()))}
    raw=json.dumps(payload,ensure_ascii=False)
    if len(raw.encode())>256000:return # No truncated checkpoint is considered resumable.
    receipt['checkpoint_available']=bool(payload['plan'])
    with closing(connect()) as db,db:db.execute('INSERT INTO harness_checkpoints VALUES (?,?,?) ON CONFLICT(project,run_id) DO UPDATE SET payload=excluded.payload',(ctx.project,ctx.run_id,raw))
def get(project,rid):
    with closing(connect()) as db:
        row=db.execute('SELECT payload FROM harness_checkpoints WHERE project=? AND run_id=?',(project,rid)).fetchone()
        return json.loads(row[0]) if row else None

def load(project,rid):
    if os.getenv('HARNESS_RESUME_ENABLED','').lower() not in ('1','true'):raise HTTPException(409,'检查点恢复尚未启用')
    parent=run_store.get(project,rid)
    if not parent:raise HTTPException(404,'原运行不存在')
    if parent['status'] not in {'cancelled','interrupted','budget_exceeded','failed','partial'}:raise HTTPException(409,'仅中断或未完成任务可恢复')
    if uncertain(project,rid):raise HTTPException(409,'存在结果未知或失败的写入，需先核对工作空间；禁止自动重放')
    checkpoint=get(project,rid)
    if not checkpoint or not checkpoint.get('plan'):raise HTTPException(409,'没有可恢复的工具边界检查点，请重新发起任务')
    from app.workspace import file_record,file_path
    import hashlib
    for item in checkpoint.get('artifacts',[]):
        try:
            actual=file_record(project,item['id'],parent['session_id'])
            assert hashlib.sha256(file_path(actual).read_bytes()).hexdigest()==item['digest']
        except Exception:raise HTTPException(409,'检查点交付文件缺失或已改变，请重新配置任务')
    return parent,checkpoint
