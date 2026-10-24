from app.models import factory
from app.configs import settings
import pytest

@pytest.fixture(autouse=True)
def legacy_config_only(monkeypatch):
 monkeypatch.setattr(settings, 'studio_models', lambda: None)

def test_anthropic_protocol_uses_anthropic_adapter(monkeypatch):
 from app.models import patched_anthropic
 captured={}
 monkeypatch.setattr(factory,'get_active_model_name',lambda:'deepseek')
 monkeypatch.setattr(factory,'get_provider_config',lambda name:{'protocol':'anthropic','model':'deepseek-v4-pro','base_url':'https://api.deepseek.com/anthropic','api_key':'test-key','max_tokens':100})
 def build(**kwargs):captured.update(kwargs);return 'anthropic-model'
 monkeypatch.setattr(patched_anthropic,'PatchedChatAnthropic',build)
 assert factory.create_chat_model()=='anthropic-model'
 assert captured['base_url'].endswith('/anthropic')
 assert 'protocol' not in captured

def test_provider_config_preserves_protocol(monkeypatch):
 monkeypatch.setattr(settings,'load_settings',lambda:{'model':{'providers':{'deepseek':{'protocol':'anthropic'}}}})
 assert settings.get_provider_config('deepseek')['protocol']=='anthropic'


def test_request_selection_and_effort_mapping(monkeypatch):
 from app.models import patched_anthropic
 cfg={'protocol':'anthropic','model':'deepseek-v4-pro','base_url':'https://api.deepseek.com/anthropic','api_key':'test-key'}
 monkeypatch.setattr(factory,'load_settings',lambda:{'model':{'providers':{'deepseek':cfg}}})
 monkeypatch.setattr(factory,'get_active_model_name',lambda:'deepseek')
 monkeypatch.setattr(factory,'get_provider_config',lambda name:cfg)
 captured={}
 monkeypatch.setattr(patched_anthropic,'PatchedChatAnthropic',lambda **kw:captured.update(kw))
 choices=factory.model_options()
 assert len(choices['models'])==2 and 'api_key' not in str(choices)
 factory.create_chat_model('deepseek:deepseek-flash','max')
 assert captured['model']=='deepseek-flash'
 assert captured['thinking']=={'type':'adaptive'}
 assert captured['model_kwargs']['output_config']['effort']=='max'
 factory.create_chat_model('deepseek:deepseek-v4-pro','none')
 assert captured['thinking']=={'type':'disabled'}
 import pytest
 with pytest.raises(ValueError):factory.resolve_model('unknown:unconfigured','low')


def test_signature_only_thinking_block_is_valid_on_replay():
 from app.models.patched_anthropic import PatchedChatAnthropic
 from langchain_core.messages import AIMessage,HumanMessage
 model=PatchedChatAnthropic(model='deepseek-flash',api_key='test-key')
 payload=model._get_request_payload([HumanMessage(content='hello'),AIMessage(content=[{'type':'thinking','signature':'test-signature'},{'type':'text','text':'hello'}])])
 assert payload['messages'][1]['content'][0]=={'type':'thinking','signature':'test-signature','thinking':''}
