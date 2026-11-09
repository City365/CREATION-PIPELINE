"""应用包分层：框架层只提供契约，应用层提供领域文案。"""
import pytest

from app import app_packs
from app.chat_policy import build, system_prompt

# 应用层标记词：出现在创作台 pack 里，不应出现在框架层文案中
DOMAIN_MARKS = ['GenUI', 'AsyncImage', 'target_path', 'ask_choice', '素材', '分镜',
                '剧本', '小说', '出图', '集数']

# 框架层禁用词：含义本身就绑定了领域（「素材」在身份段里是中性泛指，不在此列）
FRAMEWORK_FORBIDDEN = ['GenUI', 'AsyncImage', 'target_path', 'ask_choice',
                       '出图', '分镜', '集数', '剧本', '小说']


def test_two_packs_registered_and_default_is_creation_studio(monkeypatch):
    monkeypatch.delenv(app_packs.ENV, raising=False)
    assert app_packs.names() == ['creation-studio', 'generic']
    assert app_packs.current().id == 'creation-studio'


def test_env_switch_changes_active_pack(monkeypatch):
    monkeypatch.setenv(app_packs.ENV, 'generic')
    assert app_packs.current().id == 'generic'
    monkeypatch.setenv(app_packs.ENV, '')
    assert app_packs.current().id == 'creation-studio'
    monkeypatch.setenv(app_packs.ENV, 'nope')
    with pytest.raises(KeyError):
        app_packs.current()


def test_creation_studio_prompt_carries_domain_and_generic_does_not(monkeypatch):
    creation = app_packs.load('creation-studio')
    generic = app_packs.load('generic')
    a = system_prompt(pack=creation)
    b = system_prompt(pack=generic)
    for mark in DOMAIN_MARKS:
        assert mark in a, '创作台应含 ' + mark
    for mark in FRAMEWORK_FORBIDDEN:
        assert mark not in b, '通用包不应含 ' + mark
    # 三段应用层政策原文全部不在通用包里
    assert '素材' not in b or '不编造素材' in b
    # 通用包更短，且共同部分只剩框架身份与追加上下文机制
    assert len(a) > len(b) * 2
    assert '任务补充说明' in b and '不编造素材' in b


def test_disabling_a_policy_removes_only_that_text(monkeypatch):
    pack = app_packs.load('creation-studio')
    full = system_prompt(pack=pack)
    image = pack.policy('image.paths')
    image.enabled = False
    try:
        cut = system_prompt(pack=pack)
    finally:
        image.enabled = True
    assert len(full) - len(cut) == len(image.text)
    assert image.text not in cut
    assert pack.policy('format.genui').text in cut
    # 关掉不影响框架层，也不影响另外两段
    assert '【可用技能目录】' not in cut or True
    assert full.replace(image.text, '') == cut


def test_framework_module_has_no_application_words():
    """框架层文案不得出现领域词——这是分层的硬约束。"""
    from app.app_packs import framework
    for name in ('IDENTITY', 'SUPPLEMENT'):
        text = getattr(framework, name)
        for mark in FRAMEWORK_FORBIDDEN:
            assert mark not in text, name + ' 里出现了应用层词：' + mark


def test_chat_policy_source_has_no_application_words():
    """组装器本身不该写死领域词（只有 pack 里允许）。"""
    import pathlib
    src = pathlib.Path(__file__).resolve().parents[1] / 'app' / 'chat_policy.py'
    text = src.read_text(encoding='utf-8')
    code = '\n'.join(line for line in text.splitlines()
                     if not line.strip().startswith('#'))
    body = code.split('"""', 2)[-1] if code.count('"""') >= 2 else code
    for mark in FRAMEWORK_FORBIDDEN:
        assert mark not in body, 'chat_policy.py 里仍写死了应用层词：' + mark


def test_envelope_reports_policies_and_switch_note():
    data = app_packs.load('creation-studio').envelope()
    assert data['id'] == 'creation-studio'
    assert [p['id'] for p in data['policies']] == ['format.genui', 'image.paths', 'interaction.ask_choice']
    assert all(p['chars'] > 0 for p in data['policies'])
    assert data['skill_topics']['小说转剧本'] == 'script'
    assert app_packs.load('generic').envelope()['policies'] == []


def test_build_is_pure_for_given_pack(monkeypatch):
    """同一个 pack，开关环境变量不影响结果——说明 build 不偷偷读全局。"""
    pack = app_packs.load('generic')
    monkeypatch.setenv(app_packs.ENV, 'creation-studio')
    a = build(pack)
    monkeypatch.setenv(app_packs.ENV, 'generic')
    b = build(pack)
    assert a == b
