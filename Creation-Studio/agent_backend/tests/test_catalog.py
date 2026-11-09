"""能力目录：一眼看清框架层给什么、应用层加什么、外部接什么。"""
import pytest


HEADERS = {'X-Project-Id': 'catalog'}


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main, store
    monkeypatch.setattr(store, 'DB', tmp_path / 'catalog.db')
    main.locks.clear()
    return TestClient(main.app)


def test_catalog_lists_every_layer(client):
    data = client.get('/agent/catalog', headers=HEADERS).json()
    assert data['app_pack']['id'] == 'creation-studio'
    assert data['app_pack']['prompt_chars'] > 0
    assert data['layers']['application']['policies'] == [
        'format.genui', 'image.paths', 'interaction.ask_choice']
    assert '跨轮目标' in data['layers']['framework']
    assert 'MCP 客户端' in data['layers']['framework']
    assert data['layers']['external'] == []


def test_catalog_covers_the_capabilities_added_in_this_round(client):
    tools = set(client.get('/agent/catalog', headers=HEADERS).json()['tools'])
    for name in ('read_tool_output', 'spawn_subagent', 'run_parallel_subagents',
                 'set_goal', 'add_goal_progress', 'complete_goal', 'mcp__*'):
        assert name in tools, name


def test_catalog_follows_the_active_app_pack(client, monkeypatch):
    from app import app_packs
    monkeypatch.setenv(app_packs.ENV, 'generic')
    data = client.get('/agent/catalog', headers=HEADERS).json()
    assert data['app_pack']['id'] == 'generic'
    assert data['layers']['application']['policies'] == []
    # 换应用只换应用层：框架能力一个都不少
    assert '子智能体' in data['layers']['framework']
    assert 'set_goal' in data['tools']


def test_catalog_reports_switch_notes_for_each_layer(client):
    notes = client.get('/agent/catalog', headers=HEADERS).json()['switch_notes']
    assert set(notes) == {'application', 'skill', 'tool', 'framework'}
    assert 'WMD_APP_PACK' in notes['application']
    assert 'mcp_servers' in notes['tool']


def test_switching_off_a_policy_shrinks_the_reported_prompt(client):
    from app import app_packs
    before = client.get('/agent/catalog', headers=HEADERS).json()['app_pack']
    pack = app_packs.load('creation-studio')
    image = pack.policy('image.paths')
    image.enabled = False
    try:
        after = client.get('/agent/catalog', headers=HEADERS).json()['app_pack']
    finally:
        image.enabled = True
    assert before['prompt_chars'] - after['prompt_chars'] == len(image.text)
    assert [p['id'] for p in after['policies']] == ['format.genui', 'image.paths', 'interaction.ask_choice']
