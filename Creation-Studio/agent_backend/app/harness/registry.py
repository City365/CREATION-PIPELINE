"""Approved capabilities and immutable Skill instructions. CRUD is not execution authority."""
import hashlib,json
from .runtime import RunStopped
CAPABILITIES={name:('workspace_write' if name=='create_workspace_artifact' else 'read_or_plan') for name in ('create_task_plan','read_analysis_guidance','record_step_result','search_workspace_documents','read_workspace_document','create_workspace_artifact','read_dataset_schema','read_strategy_rules')}
CAPABILITIES.update({
    'list_creation_models': 'read_or_plan',
    'generate_image': 'media_write',
    'submit_video_job': 'media_write',
    'check_video_job': 'read_or_plan',
    'wait_video_job': 'read_or_plan',
    'probe_video': 'read_or_plan',
    'extract_frames': 'media_write',
    'describe_image': 'read_or_plan',
})

# Match the underlying HTTP operations, including video polling's caller budget.
TOOL_TIMEOUTS = {'generate_image': 310, 'submit_video_job': 70, 'probe_video': 70,
                 'extract_frames': 250, 'describe_image': 190}

def tool_timeout(name, args, default):
    if name == 'wait_video_job':
        return max(30, min(1800, int(args.get('timeout_seconds') or 600))) + 70
    return TOOL_TIMEOUTS.get(name, default)
def skill_version(item):
    return hashlib.sha256(json.dumps({'id':item['id'],'name':item['name'],'instructions':str(item.get('config',{}).get('instructions',''))},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def freeze(ctx):
    from app.workspace import plugins
    snapshots=[]
    for item in plugins(ctx.project,'skill'):
        text=str(item.get('config',{}).get('instructions',''))
        if item['enabled'] and text.strip():
            if len(text)>16000:continue
            snapshots.append({'id':item['id'],'name':item['name'],'version':skill_version(item),'instructions':text})
    previous=(getattr(ctx,'resume_checkpoint',None) or {}).get('skill_manifest',[])
    current={s['id']:s for s in snapshots}
    if previous and any(s['id'] not in current or current[s['id']]['version']!=s['version'] for s in previous):
        ctx.reason='skill_revoked';raise RunStopped(ctx.reason)
    ctx.skill_manifest=snapshots;ctx.active_skills=set((getattr(ctx,'resume_checkpoint',None) or {}).get('active_skills',[]))
    ctx.receipt['skill_manifest']=[{k:s[k] for k in ('id','name','version')} for s in snapshots]
    return snapshots

def verify(ctx,topic=None):
    from app.workspace import plugins
    if topic and topic.startswith('skill:'):
        selected=topic[6:]
        if selected not in {s['id'] for s in getattr(ctx,'skill_manifest',[])}:
            ctx.reason='skill_revoked';raise RunStopped(ctx.reason)
        ctx.active_skills.add(selected)
    if not getattr(ctx,'active_skills',set()):return
    current={s['id']:s for s in plugins(ctx.project,'skill')}
    for frozen in ctx.skill_manifest:
        if frozen['id'] in ctx.active_skills:
            item=current.get(frozen['id'])
            if not item or not item['enabled'] or skill_version(item)!=frozen['version']:
                ctx.reason='skill_revoked';raise RunStopped(ctx.reason)

def describe_plugin(item):
    result=dict(item)
    if item['kind']=='skill':
        text=str(item.get('config',{}).get('instructions',''))
        available=item.get('enabled') and bool(text.strip()) and len(text)<=16000
        result.update(runtime_status='available' if available else 'configured',version=skill_version(item),runtime_reason='以冻结版本读取指导内容，不授予工具权限' if available else '未启用或指导内容为空/过长')
    else:result.update(runtime_status='configured',runtime_reason='未注册经批准的执行适配器，配置不会作为代码或远程连接运行')
    return result
