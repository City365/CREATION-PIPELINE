"""摘要面板的分项统计：口径、分项、总量守恒。"""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import context_report, main, store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'chat.db')
    main.locks.clear()
    main.LIVE_RUNS.clear()
    main.RUN_EVENTS.clear()
    main.RUN_ENDED.clear()
    return TestClient(main.app)


def test_tokens_follow_documented_estimator():
    assert context_report.tokens_of('') == 0
    assert context_report.tokens_of('abcd' * 10) == 10          # ASCII：4 字符 1 token
    assert context_report.tokens_of('中' * 15) == 10            # 中文：1.5 字符 1 token
    mixed = context_report.tokens_of('abcd中文')
    assert mixed == round(4 / 4 + 2 / 1.5)


def test_report_has_fixed_sections_in_order():
    history = [{'role': 'user', 'content': '把小说拆成分集'}]
    tools = [SimpleNamespace(name='list_dir', description='列目录', args_schema=SimpleNamespace(
        model_json_schema=lambda: {'type': 'object', 'properties': {'path': {'type': 'string'}}}))]
    report = context_report.build(history, tools, '系统提示词', [{'id': 'novel', 'name': '小说'}], window=100000)
    keys = [item['key'] for item in report['items']]
    assert keys == ['messages', 'tools', 'skills', 'system', 'buffer', 'free']
    assert [item['label'] for item in report['items']] == [
        'Messages', 'System tools', 'Skills', 'System prompt', 'Autocompact buffer', 'Free space']
    assert report['window'] == 100000
    assert report['tool_count'] == 1
    assert report['skill_count'] == 1
    assert report['tool_names'] == ['list_dir']
    assert report['messages'] == 1
    # 已用 = 四个固定环节之和；预留 = 15%；剩余补齐到窗口
    fixed = sum(item['tokens'] for item in report['items'] if item['key'] in ('messages', 'tools', 'skills', 'system'))
    assert report['used'] == fixed
    assert report['reserved'] == 15000
    assert fixed + report['reserved'] + report['free'] == 100000
    assert all(item['tokens'] >= 0 for item in report['items'])
    assert round(sum(item['percent'] for item in report['items']), 1) == 100.0


def test_oversized_history_never_goes_negative():
    history = [{'role': 'user', 'content': '字' * 400000}]
    report = context_report.build(history, [], '', None, window=1000)
    assert report['free'] == 0
    assert report['used'] > report['window']
    assert report['items'][-1]['percent'] == 0.0


def test_report_is_written_into_execution_receipt(client, monkeypatch):
    class Graph:
        async def astream(self, payload, **kwargs):
            yield SimpleNamespace(content='好的'), {}

    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    monkeypatch.setattr(main, 'create_agent', lambda **kwargs: Graph())
    headers = {'X-Project-Id': 'p1'}
    assert client.put('/agent/sessions/c1', headers=headers,
                      json={'id': 'c1', 'title': '测试', 'updated': 1, 'messages': []}).status_code == 200
    response = client.post('/agent/chat', headers=headers, json={'session_id': 'c1', 'text': '你好'})
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    done = [event for event in events if event['type'] == 'done'][-1]
    receipt = client.get('/agent/executions/' + done['execution']['id'], headers=headers).json()
    report = receipt['context']['report']
    assert report['schema_version'] == 'context-report/1'
    assert [item['label'] for item in report['items']][:2] == ['Messages', 'System tools']
    assert report['tool_count'] > 0
    assert report['used'] > 0
    assert report['window'] >= report['used']
    # start 事件里也带着，面板不用等跑完才显示
    start = [event for event in events if event['type'] == 'start'][0]
    assert start['execution']['context']['report']['items'][0]['key'] == 'messages'


# ---- 技能分项：选了技能就不能显示 0 ----

def test_skill_material_reads_plugin_record_or_builtin_guidance():
    record = {'id': 'novel-x', 'name': '小说创作', 'content': '技能正文：' * 200}
    text, count = main.skill_material('p1', 'skill:novel-x', '小说创作', plugins_fn=lambda project, kind: [record])
    assert count == 1 and '技能正文' in text
    # 内置主题（@小说创作 走的是内置指导文档）
    builtin, builtin_count = main.skill_material('p1', 'novel', '小说创作', plugins_fn=lambda project, kind: [])
    assert builtin_count == 1 and len(builtin) > 100
    # 没有技能就不该硬凑
    assert main.skill_material('p1', '', '小说创作', plugins_fn=lambda project, kind: []) == ('', 0)


def test_skill_run_reports_skills_in_context(client, monkeypatch):
    class Graph:
        async def astream(self, payload, **kwargs):
            yield SimpleNamespace(content='按技能处理中'), {}

    monkeypatch.setattr(main, 'create_chat_model', lambda: object())
    monkeypatch.setattr(main, 'create_agent', lambda **kwargs: Graph())
    headers = {'X-Project-Id': 'p1'}
    assert client.put('/agent/sessions/c1', headers=headers,
                      json={'id': 'c1', 'title': '测试', 'updated': 1, 'messages': []}).status_code == 200
    response = client.post('/agent/chat', headers=headers,
                           json={'session_id': 'c1', 'text': '按小说创作技能改这一篇', 'skill': '小说创作'})
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    start = [event for event in events if event['type'] == 'start'][0]
    report = start['execution']['context']['report']
    skills = next(item for item in report['items'] if item['key'] == 'skills')
    assert skills['tokens'] > 0, '选了技能，Skills 分项不能是 0'
    assert report['skill_count'] == 1
    assert skills['label'] == 'Skills'
