"""智能推荐：ask_choice 的选项/问题收敛、多问题与多选、事件载荷与调用节制。"""
import json

from app.interaction_tools import (
    MAX_CALLS_PER_RUN, MAX_OPTIONS, MAX_QUESTIONS, build_interaction_tools, normalize_options, normalize_questions,
)


def _tools(events=None, receipt=None):
    events = events if events is not None else []
    return build_interaction_tools(events.append, receipt)


def _call(tools, **kwargs):
    return tools[0].invoke(kwargs)


def test_normalize_options_marks_exactly_one_recommended():
    options = normalize_options([
        {'label': '跑完整流程', 'why': '三阶段一次做完', 'value': '按顺序跑完整流程'},
        {'label': '只做分镜', 'why': '先看分镜效果', 'value': '只把第 1 集拆成分镜剧本', 'recommended': True},
        {'label': '先出提示词', 'why': '直接拿去出片', 'value': '只出第 1 集的视频提示词', 'recommended': True},
    ])
    assert len(options) == 3
    assert [o['label'] for o in options if o['recommended']] == ['只做分镜']
    assert options[0]['id'] == 'o1'


def test_normalize_options_accepts_plain_strings_with_hint():
    options = normalize_options(['跑完整流程｜三阶段一次做完', '只做分镜｜先看效果'])
    assert options[0]['label'] == '跑完整流程'
    assert options[0]['why'] == '三阶段一次做完'
    assert options[0]['recommended'] is True


def test_normalize_options_caps_length_and_count():
    long_label = '标' * 80
    options = normalize_options([{'label': long_label, 'value': 'v'}] + [{'label': 'x' + str(i), 'value': 'v'} for i in range(10)])
    assert len(options) == MAX_OPTIONS
    assert len(options[0]['label']) <= 18
    assert normalize_options([]) == []


def test_normalize_questions_accepts_multiple_questions_and_multi_select():
    questions = normalize_questions([
        {'question': '第 3 集接下来走哪条？', 'options': [
            {'label': '拆成分镜', 'value': '把第 3 集拆成分镜剧本', 'recommended': True},
            {'label': '先审剧本', 'value': '审校第 3 集剧本'},
        ]},
        {'question': '需要哪些素材？', 'multi': True, 'options': [
            {'label': '角色四视图', 'value': '生成角色四视图'},
            {'label': '场景参考图', 'value': '生成场景参考图'},
            {'label': '道具特写', 'value': '生成道具参考图'},
        ]},
    ])
    assert [q['id'] for q in questions] == ['q1', 'q2']
    assert questions[0]['multi'] is False
    assert questions[1]['multi'] is True
    assert [o['id'] for o in questions[1]['options']] == ['q2o1', 'q2o2', 'q2o3']
    assert questions[1]['recommended'] == '角色四视图'


def test_normalize_questions_keeps_single_question_form():
    questions = normalize_questions(None, question='这一集接下来走哪条？', options=[
        {'label': '拆成分镜', 'value': '拆成分镜剧本', 'recommended': True},
        {'label': '先审稿', 'value': '审校剧本'},
    ], multi=False)
    assert len(questions) == 1
    assert questions[0]['question'] == '这一集接下来走哪条？'
    assert questions[0]['allow_text'] is True


def test_normalize_questions_drops_invalid_and_caps_count():
    many = [{'question': '问题' + str(i), 'options': [{'label': 'a', 'value': 'a'}, {'label': 'b', 'value': 'b'}]} for i in range(9)]
    assert len(normalize_questions(many)) == MAX_QUESTIONS
    assert normalize_questions([{'question': '只有一个选项', 'options': [{'label': 'a', 'value': 'a'}]}]) == []
    assert normalize_questions([{'question': '', 'options': [{'label': 'a', 'value': 'a'}, {'label': 'b', 'value': 'b'}]}]) == []


def test_ask_choice_emits_multi_question_panel():
    events, receipt = [], {}
    tools = _tools(events, receipt)
    result = _call(tools, questions=[
        {'question': '第 3 集接下来走哪条？', 'options': [
            {'label': '拆成分镜剧本', 'why': '逐场拆成镜头表', 'value': '用「分集剧本转分镜剧本」技能处理第 3 集', 'recommended': True},
            {'label': '先审一遍剧本', 'why': '先挑逻辑问题', 'value': '审校第 3 集剧本'},
        ]},
        {'question': '需要哪些素材？', 'multi': True, 'options': [
            {'label': '角色四视图', 'why': '锁形象一致性', 'value': '生成角色四视图'},
            {'label': '场景参考图', 'why': '锁场景一致性', 'value': '生成场景参考图'},
        ]},
    ])
    assert result['ok'] is True
    assert result['questions'] == 2
    assert result['shown'] == 4
    assert '拆成分镜剧本' in result['recommended']
    event = events[0]
    assert event['type'] == 'choice'
    assert [q['question'] for q in event['questions']] == ['第 3 集接下来走哪条？', '需要哪些素材？']
    assert event['questions'][1]['multi'] is True
    assert 'options' not in event, '多问题时不再给扁平字段'
    assert receipt['choices'][0]['id'] == event['id']


def test_ask_choice_keeps_flat_fields_for_single_question():
    events = []
    tools = _tools(events)
    _call(tools, question='这一集接下来走哪条？', options=[
        {'label': 'a', 'value': 'a', 'recommended': True},
        {'label': 'b', 'value': 'b'},
    ])
    event = events[0]
    assert event['question'] == '这一集接下来走哪条？'
    assert event['options'][0]['id'] == 'q1o1'
    assert len(event['questions']) == 1


def test_ask_choice_rejects_empty_and_thin_payloads():
    events = []
    tools = _tools(events)
    assert _call(tools, question='', options=[])['ok'] is False
    bad = _call(tools, question='选一个？', options=[{'label': '只有一个', 'value': '只有一个'}])
    assert bad['ok'] is False
    assert events == []


def test_ask_choice_limits_calls_per_run():
    events = []
    tools = _tools(events)
    payload = dict(question='选一个？', options=[{'label': 'a', 'value': 'a'}, {'label': 'b', 'value': 'b'}])
    for _ in range(MAX_CALLS_PER_RUN):
        assert _call(tools, **payload)['ok'] is True
    blocked = _call(tools, **payload)
    assert blocked['ok'] is False
    assert len(events) == MAX_CALLS_PER_RUN


def test_ask_choice_auto_seconds_is_clamped():
    events = []
    tools = _tools(events)
    _call(tools, question='选一个？', options=[{'label': 'a', 'value': 'a'}, {'label': 'b', 'value': 'b'}], auto_seconds=999)
    assert events[0]['auto_seconds'] == 120


def test_ask_choice_publish_failure_does_not_break_tool():
    def boom(_event):
        raise RuntimeError('broken stream')
    tools = build_interaction_tools(boom, None)
    result = _call(tools, question='选一个？', options=[{'label': 'a', 'value': 'a'}, {'label': 'b', 'value': 'b'}])
    assert result['ok'] is True


def test_ask_choice_is_registered_for_the_gateway():
    """工具网关只放行注册过的能力，schema 也要能序列化，否则整个 run 会 503。"""
    from app.harness import registry
    from app.harness.tool_gateway import ALLOWED

    tool = build_interaction_tools(None, None)[0]
    assert tool.name == 'ask_choice'
    assert registry.CAPABILITIES['ask_choice'] == 'interaction'
    assert tool.name in ALLOWED
    assert registry.tool_timeout('ask_choice', {}, 120) == 20
    schema = tool.args_schema.model_json_schema()
    assert set(schema['properties']) == {'question', 'options', 'questions', 'multi', 'allow_text', 'auto_seconds'}


def test_ask_choice_result_serializes():
    events = []
    tools = _tools(events)
    result = _call(tools, questions=[{'question': '选？', 'options': [{'label': 'a', 'value': 'a'}, {'label': 'b', 'value': 'b'}]}])
    json.dumps(result, ensure_ascii=False)
    assert '推荐：' in result['note']


def test_main_wires_the_choice_tool_into_every_run():
    import inspect

    from app import main

    source = inspect.getsource(main)
    assert 'build_interaction_tools(publish_event, receipt)' in source
