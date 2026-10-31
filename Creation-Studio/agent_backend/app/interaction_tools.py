"""智能推荐改造：把「要问用户的事」变成可点击的选择面板。

这是智能体自带的问答机制，不属于任何技能：遇到模型没理解、必须确认、方案冲突、
多条路径、多个决策、下一步走什么，就调用 ask_choice 把问题推给用户，用户点选即定方向。

一次可以问 1–4 个问题；每个问题 2–5 个选项，可单选也可多选；每个问题都可以留
「自行撰写」出口。选中项带 value（可执行的完整指令），点完就等于把方向说清楚了。

设计约束（与 chat_policy 的【智能推荐】段一致）：
- 一轮最多 3 次调用：只在真正的分叉点问，不拿选择题凑数；
- 每个问题必须有一个推荐项，推荐项按上下文选最省事又最稳的；
- 面板只表达方向，不代替权限确认；动磁盘仍按权限档位裁决。
"""
from __future__ import annotations

import time
import uuid

from langchain_core.tools import tool

MAX_OPTIONS = 5
MIN_OPTIONS = 2
MAX_QUESTIONS = 4
MAX_CALLS_PER_RUN = 3
QUESTION_LIMIT = 60
LABEL_LIMIT = 18
WHY_LIMIT = 40
VALUE_LIMIT = 400


def _clip(value, limit):
    text = ' '.join(str(value if value is not None else '').split())
    return text[:limit]


def _split_text_option(text):
    """允许模型把选项写成一段字符串：`标题｜作用说明`。"""
    parts = [p.strip() for p in str(text or '').replace('|', '｜').split('｜') if p.strip()]
    label = parts[0] if parts else ''
    why = parts[1] if len(parts) > 1 else ''
    return label, why


def normalize_options(raw, prefix=''):
    """把模型给的选项收敛成统一结构；非法项丢掉，最多 MAX_OPTIONS 个。"""
    items = raw if isinstance(raw, list) else []
    options = []
    for index, item in enumerate(items):
        if isinstance(item, dict):
            label = _clip(item.get('label') or item.get('title') or item.get('value'), LABEL_LIMIT)
            why = _clip(item.get('why') or item.get('hint') or item.get('desc'), WHY_LIMIT)
            value = _clip(item.get('value') or item.get('prompt') or label, VALUE_LIMIT)
            skill_id = _clip(item.get('skill_id') or item.get('skill'), 64)
            recommended = bool(item.get('recommended'))
        else:
            label, why = _split_text_option(item)
            label = _clip(label, LABEL_LIMIT)
            why = _clip(why, WHY_LIMIT)
            value = _clip(item, VALUE_LIMIT)
            skill_id = ''
            recommended = False
        if not label and not value:
            continue
        options.append({
            'id': prefix + 'o' + str(len(options) + 1),
            'label': label or value,
            'why': why,
            'value': value or label,
            'skill_id': skill_id,
            'recommended': recommended,
        })
        if len(options) >= MAX_OPTIONS:
            break
    if not options:
        return []
    # 每个问题必须且只能推荐一个：没人标就推第一个，标多了只留第一个。
    flagged = [o for o in options if o['recommended']]
    if not flagged:
        options[0]['recommended'] = True
    else:
        for option in flagged[1:]:
            option['recommended'] = False
    return options


def normalize_questions(raw, question='', options=None, multi=False, allow_text=True):
    """支持两种写法：questions[] 多问题面板，或单问题的 question + options。"""
    items = raw if isinstance(raw, list) else []
    if not items and (question or options):
        items = [{'question': question, 'options': options or [], 'multi': multi, 'allow_text': allow_text}]
    questions = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        text = _clip(item.get('question') or item.get('title') or item.get('ask'), QUESTION_LIMIT)
        opts = normalize_options(item.get('options') or item.get('choices'), prefix='q' + str(index + 1))
        if not text or len(opts) < MIN_OPTIONS:
            continue
        questions.append({
            'id': 'q' + str(len(questions) + 1),
            'question': text,
            'options': opts,
            'multi': bool(item.get('multi') or item.get('multi_select')),
            'allow_text': item.get('allow_text', allow_text) is not False,
            'recommended': next((o['label'] for o in opts if o['recommended']), opts[0]['label']),
        })
        if len(questions) >= MAX_QUESTIONS:
            break
    return questions


def build_interaction_tools(publish=None, receipt=None):
    """构建智能推荐工具。publish 用来把面板事件推给前端，receipt 记录本轮问过的内容。"""

    calls = {'count': 0}

    def emit(event):
        if callable(publish):
            try:
                publish(event)
            except Exception:
                pass
        if receipt is not None:
            receipt.setdefault('choices', []).append(event)

    @tool
    def ask_choice(question: str = '', options: list[dict] | None = None,
                   questions: list[dict] | None = None, multi: bool = False,
                   allow_text: bool = True, auto_seconds: int = 0) -> dict:
        """需要用户拍板时用它：把「要不要 / 走哪条 / 哪个方案 / 下一步」变成可点击的选项面板。

        什么时候用：模型没听懂、需求模糊、信息不足、两个方案冲突、有多条路线、有多个决策点、
        或者进入下一步之前需要用户确认方向。普通闲聊和已经明确的任务不要用。

        两种写法，任选其一：
        1) 一次问多个问题（推荐）：questions=[{"question": "…", "options": [{...}], "multi": false, "allow_text": true}, …]
           一次 1–4 个问题，用户在同一张面板里一起答。
        2) 只问一个问题：question="…", options=[{...}], multi=false。

        每个选项是对象：{"label": 按钮标题（≤12 字），
                       "why": 一句话说清这个选项会做什么、有什么后果（≤28 字），
                       "value": 选中后要执行的完整指令（写清技能名与处理范围；禁止「好/可以/继续」这类空话），
                       "recommended": 是否推荐（每个问题只能一个 true，按上下文挑最省事又最稳的），
                       "skill_id": 该选项要用的技能 id（可选）}
        multi=true 表示这个问题可以多选（用户能同时勾几个方向）；allow_text 决定是否给「自行撰写」出口；
        auto_seconds>0 时到点自动按推荐项执行（默认 0，等用户点）。

        调用后面板会出现在输入框上方，用户点选并发送即可；本轮到此收尾，不要在正文里把同样的问题再问一遍。
        """
        if calls['count'] >= MAX_CALLS_PER_RUN:
            return {'ok': False, 'error': '本轮已经问过 ' + str(MAX_CALLS_PER_RUN) + ' 次，直接按当前判断继续或收尾，不要再弹面板。'}
        normalized = normalize_questions(questions, question, options, multi, allow_text)
        if not normalized:
            return {'ok': False, 'error': '至少要有一个问题，且每个问题至少 2 个有效选项（label + value）。'}
        event = {
            'type': 'choice',
            'id': 'ch_' + uuid.uuid4().hex[:12],
            'questions': normalized,
            'allow_text': bool(allow_text),
            'auto_seconds': max(0, min(120, int(auto_seconds or 0))),
            'time': int(time.time() * 1000),
        }
        # 单问题时同步给出扁平字段，老前端也能读懂
        if len(normalized) == 1:
            event['question'] = normalized[0]['question']
            event['options'] = normalized[0]['options']
            event['multi'] = normalized[0]['multi']
        calls['count'] += 1
        emit(event)
        recommended = '；'.join(q['question'] + '→' + q['recommended'] for q in normalized)
        return {
            'ok': True,
            'choice_id': event['id'],
            'questions': len(normalized),
            'shown': sum(len(q['options']) for q in normalized),
            'recommended': recommended,
            'waiting_for_click': True,
            'note': ('已在输入框上方展示 ' + str(len(normalized)) + ' 个问题（推荐：' + recommended
                     + '）。用户点选并发送后会带着这些选择继续；本轮收尾，不要在正文里重复同样的问题。'),
        }

    return [ask_choice]
