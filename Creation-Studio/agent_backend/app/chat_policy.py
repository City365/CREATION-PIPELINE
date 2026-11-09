"""系统提示组装器（框架层）。

这里只放「顺序与条件分支」：身份 → 应用层政策 → 执行中追加 → 技能选择
→ 技能目录 → 恢复标记 → 本地权限。所有涉及具体领域的文案都在 app_packs/，
不在这个文件里出现「素材 / 分镜 / GenUI / 出图」这类词。

换应用：改 WMD_APP_PACK 指向另一个 pack，这个文件一行不动。
"""
import json

from app.app_packs import current as current_pack
from app.app_packs.framework import IDENTITY as FW_IDENTITY, SUPPLEMENT as FW_SUPPLEMENT


def skill_topics(pack=None):
    return (pack or current_pack()).skill_topics


def selected_topic(skill='', skill_id='', pack=None):
    if skill_id:
        return 'skill:' + skill_id
    return skill_topics(pack).get(skill, '')


def build(pack, topic='', skill='', project_hint='', resource_hint='',
          attachments=None, checkpoint=False, permission=None, skill_catalog=None):
    # ① 身份与行为基线：应用只提供产品名与它自己的领域词
    identity = (FW_IDENTITY
                .replace('{product}', str(pack.product or ''))
                .replace('{forbidden}', str(pack.forbidden_pipelines or '其他固定流程')))
    # ② 应用层政策段：整体关掉某段，对应能力就从提示里消失
    identity += ''.join(pack.policy_texts())
    # ③ 执行中追加：通用机制
    identity += FW_SUPPLEMENT

    # ④ 技能选择
    if topic:
        identity += '本轮用户明确选择的技能：' + skill + '。先通过 read_analysis_guidance 读取 topic=' + topic + ' 的指导，只按所选技能执行，不自动串入其他阶段。'
        identity += '为技能任务调用 create_task_plan 建立计划，逐步使用 record_step_result 记录实际产出与来源，完成后总结；不输出内部思维链。'
        identity += '交付文件按所选技能规定逐份生成，每次 create_workspace_artifact 只写一份文件，成功保存后再生成下一份；不要在回复里重复整份交付正文。技能允许短篇合并时可合并，但必须保留所有规定分节。进度摘要不能替代实际交付文件。'
        identity += project_hint
    else:
        identity += ('本轮未选择技能：默认不要套用任何创作指南，也不主动把闲聊拉进创作流程。'
                     '如果用户这一轮的需求明显就是下面目录里的某个技能（他点名了技能，或任务本身与该技能的简介对得上），'
                     '先调用 read_analysis_guidance 读取那份正文，读完再按它执行；只讨论、只出主意时不要读。')

    # ⑤ 技能目录：只是索引，正文一律按需读取
    if skill_catalog:
        rows = []
        for item in skill_catalog[:40]:
            name = str(item.get('name') or '').strip()
            if not name:
                continue
            desc = ' '.join(str(item.get('description') or '').split())[:200]
            topic_id = str(item.get('topic') or '').strip()
            rows.append('- ' + name + ('（topic: ' + topic_id + '）' if topic_id else '') + ('：' + desc if desc else ''))
        if rows:
            identity += ('\n【可用技能目录】本会话可用的技能只有这些（名字 + 简介）。'
                         '简介只是索引，不是执行依据：要按某个技能干活，必须先调用 read_analysis_guidance 读它的正文，'
                         '没读正文之前不要臆测它的规则、步骤和产出格式。读了哪个技能就在回复里说明按哪个技能做。\n'
                         + '\n'.join(rows))

    # ⑥ 恢复标记
    if checkpoint:
        identity += '本轮为用户明确恢复的任务，沿用已有计划，只继续未完成步骤；不得重建计划或重复已有交付。'

    # ⑦ 本地权限
    if permission:
        label = str(permission.get('label') or '工作区权限')
        mode = str(permission.get('mode') or 'workspace')
        roots = permission.get('roots') or []
        identity += ('\n【本地权限】当前档位：' + label + '。' + str(permission.get('hint') or '') + '')
        if mode == 'full':
            identity += '可以读写本机任意路径，但 Windows / Program Files / ProgramData\\Microsoft 等系统目录受保护。'
        else:
            identity += '允许操作的根目录：' + '、'.join(str(item) for item in roots[:8]) + '。'
        identity += ('高危命令（格式化、分区、关机、删系统目录、编码载荷、账户后门等）在所有档位都被系统强制阻断，'
                     '不要尝试用拼接、编码或换个写法绕过；被阻断时如实说明。')
        identity += ('用户让你移动、复制、改名、删除、按路径读写文件，或执行命令时，先调用 read_permission 确认档位与根目录，'
                     '再直接调用 list_dir/read_file/write_file/make_dir/move_file/copy_file/delete_file/run_command 真的执行并回报绝对路径。'
                     '不要把自己的活推回给用户去命令行里做；只有档位确实拒绝时才说明原因，并建议把输入框权限切到更高一档。'
                     '写文件或移动前如果目标已存在，工具会自动备份，照常执行并在回复里提到备份位置。')
        identity += ('\n【交付方式】要交给用户的文件，必须让它出现在对话里：内容由你直接编写的用 create_workspace_artifact；'
                     '由脚本、命令或分片拼装生成、内容不经过你工具参数的文件，落盘后用 publish_artifact 传磁盘绝对路径挂出来。'
                     '只写进磁盘、只在回复里说“已保存到某路径”不算交付，用户看不到文件卡片。')

    return identity + '\n' + resource_hint + '\n附件元数据（材料）：' + json.dumps(attachments or [], ensure_ascii=False)


def system_prompt(topic='', skill='', project_hint='', resource_hint='', attachments=None,
                  checkpoint=False, permission=None, skill_catalog=None, pack=None):
    """签名与原实现一致；pack 为空时取当前应用包（默认创作台）。"""
    return build(pack or current_pack(), topic=topic, skill=skill, project_hint=project_hint,
                 resource_hint=resource_hint, attachments=attachments, checkpoint=checkpoint,
                 permission=permission, skill_catalog=skill_catalog)
