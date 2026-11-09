"""技能统一来源：内置技能与项目自定义技能（plugins.kind == 'skill'）共用一份清单。

前端「右侧组件里的技能」和「插件管理」都读 /agent/skills，避免两边各维护一套。
"""
from app.chat_policy import skill_topics
from app.skill_library import LIMIT as SKILL_CONTENT_LIMIT

# 内置技能的 name 必须能在当前应用包的 skill_topics 里找到，决定后端注入哪份指导文档
BUILTIN_SKILLS = [
    {
        'id': 'novel',
        'name': '小说创作',
        'description': '从一句梗概到可改编的短篇小说 / 章节，带人物、钩子和下一节悬念。',
        'prompts': ['写一个 800 字的短篇开头：雨夜，外卖员在便利店门口捡到一部还在响的手机。', '给我 3 个「雪山寺庙门口重逢」的故事方向。'],
    },
    {
        'id': 'script',
        'name': '小说转剧本',
        'description': '小说 / 梗概改写成可拍的短剧剧本：分场、台词、场尾钩子。',
        'prompts': ['把下面这段小说改写成 3 场短剧剧本：', '把刚才的小说改成 60 秒竖屏短剧，保留结尾反转。'],
    },
    {
        'id': 'storyboard',
        'name': '剧本转分镜',
        'description': '剧本拆成可直接交给豆包 Seedance 2.0 的分镜：镜号、时长、景别、六段式提示词。',
        'prompts': ['把上面的剧本拆成 3 个 15 秒分镜。', '帮我把这场戏拆成分镜，标好 <Picture N> 和 <Subject N>。'],
    },
    {
        'id': 'prompt',
        'name': '分镜转提示词',
        'description': '分镜改写成视频创作台可直接粘贴的六段式提示词。',
        'prompts': ['把上面的分镜写成可直接出片的提示词。', '把这段描述改写成合规的六段式。'],
    },
    {
        'id': 'review',
        'name': '提示词审核',
        'description': '检查六段、引用、时长和人物一致性，给出可出片结论。',
        'prompts': ['审核这条提示词能不能出片：', '帮我检查分镜引用、时长和人物一致性。'],
    },
]

SKILL_CONTENT_LIMIT = 60000  # 超过这个长度，harness 会把技能标成 configured 而不可用


def builtin_skills():
    out = []
    for item in BUILTIN_SKILLS:
        out.append({
            **item,
            'source': 'builtin',
            'topic': skill_topics().get(item['name'], item['id']),
            'enabled': True,
            'runtime_status': 'available',
            'readonly': True,
        })
    return out


def custom_skills(project):
    from app.workspace import plugins
    from app.harness.registry import describe_plugin
    out = []
    for item in plugins(project, 'skill'):
        info = describe_plugin(item)
        out.append({
            'id': 'plugin:' + info['id'],
            'plugin_id': info['id'],
            'name': info.get('name') or '未命名技能',
            'description': info.get('description') or '自定义技能',
            'prompts': [],
            'source': 'custom',
            'enabled': bool(info.get('enabled', True)),
            'runtime_status': info.get('runtime_status', 'configured'),
            'version': info.get('version'),
            'readonly': False,
        })
    return out


def all_skills(project):
    return builtin_skills() + custom_skills(project)


def catalog(project):
    """给模型看的技能目录：只有名字与简介，正文一律按需用 read_analysis_guidance 读。

    目录只是索引：模型必须先读正文再动手，不允许凭简介臆测技能里的规则与步骤。
    这是「模型不知道有哪些技能」和「全量塞 prompt」之间的中间态。
    """
    out = []
    for item in all_skills(project):
        if item.get('enabled') is False:
            continue
        name = str(item.get('name') or '').strip()
        if not name:
            continue
        topic = item.get('topic') or ('skill:' + item['plugin_id'] if item.get('plugin_id') else '')
        if not topic:
            continue
        desc = ' '.join(str(item.get('description') or '').split())[:200]
        out.append({'name': name, 'description': desc, 'topic': topic,
                    'source': item.get('source') or 'builtin'})
    return out
