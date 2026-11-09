import json
import pytest
from app.configs import settings
from app.models import factory


@pytest.fixture
def system_config(tmp_path, monkeypatch):
    monkeypatch.setenv('WMD_DATA_DIR', str(tmp_path))
    monkeypatch.setattr(settings, 'SETTINGS_PATH', tmp_path / 'agent.json')
    # 必须打桩：真实实现会向 127.0.0.1:17821 拉渠道，本机跑没跑控制器会让断言结果飘。
    monkeypatch.setattr(factory, '_wmd_channels', lambda: [])
    channels = [
        dict(id='gpt', name='GPT 渠道', model='gpt-test', type='openai-responses', active=True, enabled=True, baseUrl='http://127.0.0.1:12345/v1', apiKey='private-key', contextWindow=123456, maxTokens=1234),
        dict(id='gemini', name='Gemini 渠道', model='gemini-test', type='openai-chat', enabled=True, baseUrl='http://127.0.0.1:12346/v1', apiKey='gemini-key'),
        dict(id='disabled', model='disabled', enabled=False, baseUrl='x', apiKey='x'),
    ]
    file = tmp_path / 'config.json'
    file.write_text(json.dumps({'channels': {'llm': channels}}), encoding='utf-8')
    return file, channels


def test_catalog_uses_system_active_and_hides_secrets(system_config):
    data = factory.model_options()
    assert data['default_model'] == 'studio-gpt:gpt-test'
    assert len(data['models']) == 2
    assert data['models'][0]['context_tokens'] == 123456
    assert 'private-key' not in json.dumps(data)
    assert not any('deepseek' in option['id'] for option in data['models'])


def test_requests_use_selected_channel_protocol_and_credentials(system_config, monkeypatch):
    captured = {}
    monkeypatch.setattr(factory, 'ChatOpenAI', lambda **kw: captured.update(kw))
    factory.create_chat_model()
    assert captured['use_responses_api'] is True
    assert captured['model'] == 'gpt-test'
    assert captured['api_key'] == 'private-key'
    assert captured['max_tokens'] == 1234
    captured.clear()
    factory.create_chat_model('studio-gemini:gemini-test')
    assert captured['api_key'] == 'gemini-key'
    assert 'use_responses_api' not in captured


def test_changes_reload_without_restart_and_disabled_selection_is_rejected(system_config):
    file, channels = system_config
    channels[0]['enabled'] = False
    channels[1]['active'] = True
    file.write_text(json.dumps({'channels': {'llm': channels}}), encoding='utf-8')
    assert factory.model_options()['default_model'] == 'studio-gemini:gemini-test'
    with pytest.raises(ValueError):
        factory.resolve_model('studio-gpt:gpt-test')
    file.write_text(json.dumps({'channels': {'llm': []}}), encoding='utf-8')
    assert factory.model_options()['models'] == []
