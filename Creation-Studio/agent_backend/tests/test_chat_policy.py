import json
from langchain_core.messages import AIMessageChunk
from app.chat_policy import selected_topic, system_prompt
from app.harness.completion import validate
from app.task_tools import build_task_tools
from app import main, store
from fastapi.testclient import TestClient


def test_no_skill_has_no_workflow_and_completes_without_plan():
    assert selected_topic() == ''
    prompt = system_prompt()
    assert '每轮先调用' not in prompt
    assert '唯一目标' not in prompt
    assert 'topic=script' not in prompt
    assert validate({'plan_required': False}, '你好，有什么想聊的？')['outcome'] == 'succeeded'
    assert validate({'plan_required': False}, '')['outcome'] == 'failed'


def test_only_explicitly_selected_guidance_can_be_read():
    tools = build_task_tools({}, 'hi', lambda event: None, {}, allowed_topics={'script'})
    read = next(tool for tool in tools if tool.name == 'read_analysis_guidance')
    assert read.invoke({'topic': 'script'})['ok']
    assert not read.invoke({'topic': 'storyboard'})['ok']
    assert selected_topic('小说转剧本') == 'script'
    assert selected_topic('', 'custom-id') == 'skill:custom-id'
    assert 'topic=script' in system_prompt('script', '小说转剧本')


def test_greeting_stream_uses_general_identity_and_excludes_workflow_tools(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'chat.db')
    captured = {}
    class Graph:
        async def astream(self, *args, **kwargs):
            yield 'messages', (AIMessageChunk(content='你好！'), {})
    def create(**kwargs):
        captured.update(kwargs)
        return Graph()
    monkeypatch.setattr(main, 'create_agent', create)
    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    main.locks.clear()
    client = TestClient(main.app)
    headers = {'X-Project-Id': 'chat-policy'}
    client.put('/agent/sessions/test', headers=headers, json={'id': 'test', 'title': 'test', 'updated': 1, 'messages': []})
    response = client.post('/agent/chat', headers=headers, json={'session_id': 'test', 'text': '你好'})
    assert response.status_code == 200
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    assert any(event['type'] == 'delta' and event['text'] == '你好！' for event in events)
    assert events[-1]['type'] == 'done'
    receipt = events[-1]['execution']
    assert receipt['skill'] == '' and receipt['plan_required'] is False and receipt['plan'] is None
    names = {tool.name for tool in captured['tools']}
    assert not names.intersection({'create_task_plan', 'read_analysis_guidance', 'record_step_result'})
    assert 'topic=script' not in captured['system_prompt']
