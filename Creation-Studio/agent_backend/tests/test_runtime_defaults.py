"""引擎选择：harness 是默认引擎，legacy 是应急回退。

历史教训：这里原本是「只有 allowlist 里点名的项目才走 harness」，而 allowlist
默认空、启动脚本也从不设——更强的实现一次都没被执行过。根子不是配置忘了写，
而是 allowlist 这个机制本身不适合产品级：项目 id 是用户新建项目时才生成的，
不可能预先列进启动脚本。
"""
from app.harness import runtime
from app.models.factory import with_retry


def _env(monkeypatch):
    for name in ('HARNESS_RUNTIME_ENABLED', 'HARNESS_PROJECT_ALLOWLIST', 'HARNESS_PROJECT_DENYLIST'):
        monkeypatch.delenv(name, raising=False)


def test_harness_is_the_default_engine(monkeypatch):
    """不设任何环境变量时，任意项目都走 harness。"""
    _env(monkeypatch)
    for project in ('proj-abc', 'proj-x9', '任何新项目'):
        assert runtime.enabled(project) is True


def test_allowlist_still_narrows_when_explicitly_set(monkeypatch):
    """显式列了 allowlist 就只走列表，保留旧行为。"""
    _env(monkeypatch)
    monkeypatch.setenv('HARNESS_PROJECT_ALLOWLIST', 'proj-abc')
    assert runtime.enabled('proj-abc') is True
    assert runtime.enabled('proj-other') is False


def test_denylist_excludes_individual_projects(monkeypatch):
    """默认全开时，用 denylist 点名排除。"""
    _env(monkeypatch)
    monkeypatch.setenv('HARNESS_PROJECT_DENYLIST', 'proj-bad, proj-worse')
    assert runtime.enabled('proj-ok') is True
    assert runtime.enabled('proj-bad') is False
    assert runtime.enabled('proj-worse') is False


def test_global_switch_turns_harness_off(monkeypatch):
    """应急开关：一条环境变量整体退回 legacy，denylist 不参与。"""
    _env(monkeypatch)
    monkeypatch.setenv('HARNESS_RUNTIME_ENABLED', 'false')
    assert runtime.enabled('proj-abc') is False
    monkeypatch.setenv('HARNESS_RUNTIME_ENABLED', '0')
    assert runtime.enabled('proj-abc') is False


def test_disable_beats_allowlist(monkeypatch):
    _env(monkeypatch)
    monkeypatch.setenv('HARNESS_PROJECT_ALLOWLIST', 'proj-abc')
    monkeypatch.setenv('HARNESS_RUNTIME_ENABLED', 'false')
    assert runtime.enabled('proj-abc') is False


def test_runtime_does_not_wrap_model_with_hidden_retries():
    model = object()
    token = runtime.current.set(object())
    try:
        assert with_retry(model) is model
    finally:
        runtime.current.reset(token)
