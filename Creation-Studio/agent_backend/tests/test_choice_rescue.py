import json

from app import choice_rescue

PAYLOAD = [
    {
        "question": "剧本三集齐了，下一步走哪条？",
        "options": [
            {"label": "抛第1集分镜", "why": "先把第1集拆成带镜号景别的分镜剧本", "value": "用「分集剧本转分镜剧本」技能拆第1集", "recommended": True},
            {"label": "三集全拆分镜", "why": "一次出完，量大耗时", "value": "用「分集剧本转分镜剧本」技能拆第1–3集"},
            {"label": "先出定妆图", "why": "先把人物定下来", "value": "用「角色四视图」技能出主要人物定妆图"},
        ],
    },
    {
        "question": "这批剧本的时长口径按哪种走？",
        "options": [
            {"label": "不设上限", "why": "按内容自然长度", "value": "剧本按内容自然长度处理，不设单集上限"},
            {"label": "压到 90 秒", "why": "强钩子快节奏", "value": "把三集剧本压到每集 90 秒以内"},
        ],
    },
]


def _wrapped(inner):
    return '先做完剧本。\n<ask_choice>\n' + inner + '\n</ask_choice>\n按上面点一下就行。'


def test_rescues_wrapped_questions_and_strips_markup():
    body, event = choice_rescue.rescue(_wrapped('<questions>' + json.dumps(PAYLOAD, ensure_ascii=False) + '</questions>'))
    assert '<ask_choice>' not in body and '<questions>' not in body
    assert '先做完剧本。' in body and '按上面点一下就行。' in body
    assert event and event['type'] == 'choice' and event['rescued'] is True
    assert len(event['questions']) == 2
    assert [q['question'] for q in event['questions']] == [p['question'] for p in PAYLOAD]
    assert event['questions'][0]['recommended'] == '抛第1集分镜'
    assert event['questions'][0]['options'][0]['value'].startswith('用「分集剧本转分镜剧本」')
    assert event['auto_seconds'] == 0


def test_rescues_bare_json_inside_wrapper_without_questions_tag():
    body, event = choice_rescue.rescue(_wrapped(json.dumps(PAYLOAD, ensure_ascii=False)))
    assert event is not None
    assert len(event['questions']) == 2
    assert '<ask_choice>' not in body


def test_rescues_truncated_block():
    text = '下一步？\n<ask_choice>\n<questions>' + json.dumps(PAYLOAD[1:], ensure_ascii=False) + '</questions>'
    body, event = choice_rescue.rescue(text)
    assert event is not None and len(event['questions']) == 1
    assert '<ask_choice>' not in body and '<questions>' not in body
    assert body.strip() == '下一步？'


def test_rescues_questions_tag_without_wrapper():
    body, event = choice_rescue.rescue('说明\n<questions>' + json.dumps(PAYLOAD, ensure_ascii=False) + '</questions>')
    assert event is not None and len(event['questions']) == 2
    assert '<questions>' not in body


def test_tolerates_trailing_comma_and_fence():
    blob = '```json\n' + json.dumps(PAYLOAD[:1], ensure_ascii=False).replace('}]', '},]') + '\n```'
    body, event = choice_rescue.rescue(_wrapped(blob))
    assert event is not None
    assert len(event['questions']) == 1


def test_plain_text_is_untouched():
    text = '分镜已经拆完了，等你确认下一步。'
    body, event = choice_rescue.rescue(text)
    assert body == text and event is None


def test_already_asked_only_strips():
    body, event = choice_rescue.rescue(_wrapped('<questions>' + json.dumps(PAYLOAD, ensure_ascii=False) + '</questions>'), already_asked=True)
    assert event is None
    assert '<ask_choice>' not in body and '"label"' not in body


def test_ignores_garbage_payload():
    body, event = choice_rescue.rescue('<ask_choice><questions>不是 JSON</questions></ask_choice>')
    assert event is None
    assert '<ask_choice>' not in body
