from app.harness import runtime
from app.models.factory import with_retry

def test_studio_runtime_enabled_by_default(monkeypatch):
    monkeypatch.delenv('HARNESS_RUNTIME_ENABLED', raising=False)
    monkeypatch.delenv('HARNESS_PROJECT_ALLOWLIST', raising=False)
    assert runtime.enabled('h3-studio')
    assert not runtime.enabled('other-project')
    monkeypatch.setenv('HARNESS_RUNTIME_ENABLED','false')
    assert not runtime.enabled('h3-studio')

def test_runtime_does_not_wrap_model_with_hidden_retries():
    model=object()
    token=runtime.current.set(object())
    try:assert with_retry(model) is model
    finally:runtime.current.reset(token)
