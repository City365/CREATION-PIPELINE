"""技能统一来源：内置技能与项目自定义技能（plugins.kind == 'skill'）共用一份清单。

前端「右侧组件里的技能」和「插件管理」都读 /agent/skills，避免两边各维护一套。
"""
import re

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


# --------------------------- 技能选择归一 ---------------------------
# @ 只是输入框里的快捷方式，绑定的落点统一在 request()：
# 用户点没点 @、@ 了几个、点完又取消、直接写技能名，最后都收敛成同一份 picks。


def _flat(text):
    """比对用的归一：去掉所有空白并转小写，「小说 创作」和「小说创作」算同一个。"""
    return ''.join(str(text or '').split()).lower()


def index(project):
    """名字 / 技能 id / 插件 id → 技能条目。"""
    table = {}
    for item in all_skills(project):
        if item.get('enabled') is False:
            continue
        name = str(item.get('name') or '').strip()
        if not name:
            continue
        topic = item.get('topic') or ('skill:' + item['plugin_id'] if item.get('plugin_id') else '')
        if not topic:
            continue
        entry = {'id': item.get('id') or '', 'plugin_id': item.get('plugin_id') or '',
                 'name': name, 'topic': topic, 'source': item.get('source') or 'builtin'}
        for key in (name, item.get('id') or '', item.get('plugin_id') or ''):
            flat = _flat(key)
            if flat:
                table.setdefault(flat, entry)
    return table


def look(project, key):
    """按名字或 id 取一条技能条目，取不到返回 None。"""
    return index(project).get(_flat(key))


def detect(project, text, table=None):
    """正文里点到技能名就认出来，长名优先：「小说转剧本」不会被「小说创作」抢走。

    返回按正文出现位置排列的条目。只有真的写了名字才算，别的话不猜。
    """
    table = table if table is not None else index(project)
    flat = _flat(text)
    if not flat:
        return []
    hits, seen = [], set()
    for entry in sorted(table.values(), key=lambda e: len(_flat(e['name'])), reverse=True):
        key = _flat(entry['name'])
        if len(key) < 2 or key not in flat or entry['topic'] in seen:
            continue
        if any(key in _flat(other['name']) for other in hits):
            continue  # 已经被更长的技能名覆盖
        seen.add(entry['topic'])
        hits.append(entry)
    return sorted(hits, key=lambda e: flat.find(_flat(e['name'])))


def strip_tokens(project, text, table=None):
    """把界面里的 @技能名 从正文剥掉：绑定已经落在 picks 上，不该再当字面量喂给模型。

    只剥目录里确实存在的技能名，用户写的 @某人 / @file 一律原样留着。
    """
    table = table if table is not None else index(project)
    raw = str(text or '')
    for entry in sorted(table.values(), key=lambda e: len(e['name']), reverse=True):
        name = str(entry['name']).strip()
        if name and ('@' + name) in raw:
            raw = raw.replace('@' + name, ' ')
    raw = re.sub(r'[ \t]{2,}', ' ', raw)
    raw = re.sub(r'(?m)^[ \t]+', '', raw)
    return raw.strip()


def request(project, names=(), skill_id='', text='', table=None):
    """一次请求的技能归一，返回 (picks, clean_text)。

    picks 顺序 = 显式选择（按传入顺序）→ 正文点名（按出现顺序），同名只留一次。
    clean_text 是剥掉 @token 之后的正文，其余一个字不改。
    """
    table = table if table is not None else index(project)
    picks = []

    def push(entry):
        if entry and not any(p['topic'] == entry['topic'] for p in picks):
            picks.append({'name': entry['name'], 'topic': entry['topic'], 'source': entry['source']})

    for name in list(names or []):
        push(table.get(_flat(name)))
    if skill_id:
        push(table.get(_flat(skill_id)))
    # 认名字要在剥 token 之前：@小说创作 本身就是一次点名，剥完就没了。
    for entry in detect(project, text, table):
        push(entry)
    clean = strip_tokens(project, text, table)
    if not picks and names:
        # 名字不在目录里但应用包认得（旧客户端传的 pack 内部名），退回老路径映射。
        fallback = skill_topics().get(str(names[0]), '')
        if fallback:
            picks.append({'name': str(names[0]), 'topic': fallback, 'source': 'builtin'})
    return picks, clean
