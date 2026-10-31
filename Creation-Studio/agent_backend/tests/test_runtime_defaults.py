from app.harness import runtime
from app.models.factory import with_retry

def test_harness_is_opt_in_per_project(monkeypatch):
    """Harness 引擎默认关闭，只有 allowlist 里点名的项目才走它（清理前默认值是别的产品项目名）。"""
    monkeypatch.delenv('HARNESS_RUNTIME_ENABLED', raising=False)
    monkeypatch.delenv('HARNESS_PROJECT_ALLOWLIST', raising=False)
    assert not runtime.enabled('proj-abc')
    monkeypatch.setenv('HARNESS_PROJECT_ALLOWLIST', 'proj-abc')
    assert runtime.enabled('proj-abc')
    assert not runtime.enabled('proj-other')
    monkeypatch.setenv('HARNESS_RUNTIME_ENABLED','false')
    assert not runtime.enabled('proj-abc')

def test_runtime_does_not_wrap_model_with_hidden_retries():
    model=object()
    token=runtime.current.set(object())
    try:assert with_retry(model) is model
    finally:runtime.current.reset(token)
