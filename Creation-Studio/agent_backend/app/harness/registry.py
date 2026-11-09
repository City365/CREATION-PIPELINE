"""Approved capabilities and immutable Skill instructions. CRUD is not execution authority."""
import hashlib,json
from .runtime import RunStopped
from app.skill_library import LIMIT as SKILL_LIMIT
CAPABILITIES={name:('workspace_write' if name=='create_workspace_artifact' else 'read_or_plan') for name in ('create_task_plan','read_analysis_guidance','record_step_result','search_workspace_documents','read_workspace_document','create_workspace_artifact')}
CAPABILITIES.update({'web_search': 'read_or_plan', 'web_fetch': 'read_or_plan'})
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

# 本地文件与命令类能力：只读档只能读，写档和命令档由 permissions.py 按用户选择的档位二次裁决。
CAPABILITIES.update({
    'read_permission': 'read_or_plan',
    'list_dir': 'read_or_plan',
    'read_file': 'read_or_plan',
    'write_file': 'fs_write',
    'make_dir': 'fs_write',
    'move_file': 'fs_write',
    'copy_file': 'fs_write',
    'delete_file': 'fs_write',
    'run_command': 'shell',
    # 把磁盘上已有的文件登记为交付文件（脚本产物的出卡片通道）
    'publish_artifact': 'workspace_write',
    # 智能推荐：向用户出决策选择卡，只读不写盘
    'ask_choice': 'interaction',
    # 落盘回读：读 spill 目录里被裁剪的工具输出，只读
    'read_tool_output': 'read_or_plan',
    # 子智能体：子 run 的工具集继承父 run 已经过权限裁剪的这一份，
    # 所以它自己不需要额外授权，只按只读/规划等级计。
    'spawn_subagent': 'read_or_plan',
    'run_parallel_subagents': 'read_or_plan',
    # 跨轮目标：只写自己的 goal 记录，不碰工作区文件
    'set_goal': 'read_or_plan',
    'add_goal_progress': 'read_or_plan',
    'complete_goal': 'read_or_plan',
})

# 外部 MCP 工具的名字在运行时才知道（mcp__<server>__<tool>），不可能预先列清单。
# 按前缀放行，权限等级 external：既不当只读，也不给本地写盘授权，
# 实际能做什么由那个 MCP 服务器自己负责。加一个新 server 不用改这张表。
CAPABILITY_PREFIXES = {'mcp__': 'external'}


def is_capable(name):
    return name in CAPABILITIES or any(str(name).startswith(prefix) for prefix in CAPABILITY_PREFIXES)


def risk_of(name):
    if name in CAPABILITIES:
        return CAPABILITIES[name]
    for prefix, risk in CAPABILITY_PREFIXES.items():
        if str(name).startswith(prefix):
            return risk
    raise KeyError(name)

# Match the underlying HTTP operations, including video polling's caller budget.
TOOL_TIMEOUTS = {'web_search': 40, 'web_fetch': 40, 'generate_image': 310, 'submit_video_job': 70, 'probe_video': 70,
                 'extract_frames': 250, 'describe_image': 190,
                 'read_permission': 20, 'list_dir': 60, 'read_file': 60, 'write_file': 120,
                 'make_dir': 30, 'move_file': 300, 'copy_file': 300, 'delete_file': 120,
                 'publish_artifact': 120, 'ask_choice': 20, 'read_tool_output': 20, 'spawn_subagent': 620, 'run_parallel_subagents': 620, 'set_goal': 20, 'add_goal_progress': 20, 'complete_goal': 20}

def tool_timeout(name, args, default):
    if name == 'wait_video_job':
        return max(30, min(1800, int(args.get('timeout_seconds') or 600))) + 70
    if name == 'run_command':
        return max(5, min(600, int(args.get('timeout_seconds') or 60))) + 30
    return TOOL_TIMEOUTS.get(name, default)
def skill_version(item):
    return hashlib.sha256(json.dumps({'id':item['id'],'name':item['name'],'instructions':str(item.get('config',{}).get('instructions',''))},sort_keys=True,ensure_ascii=False).encode()).hexdigest()
def freeze(ctx):
    from app.workspace import plugins
    snapshots=[]
    for item in plugins(ctx.project,'skill'):
        text=str(item.get('config',{}).get('instructions',''))
        if item['enabled'] and text.strip():
            if len(text)>SKILL_LIMIT:continue
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
        available=item.get('enabled') and bool(text.strip()) and len(text)<=SKILL_LIMIT
        result.update(runtime_status='available' if available else 'configured',version=skill_version(item),runtime_reason='以冻结版本读取指导内容，不授予工具权限' if available else '未启用或指导内容为空/过长')
    else:result.update(runtime_status='configured',runtime_reason='未注册经批准的执行适配器，配置不会作为代码或远程连接运行')
    return result
