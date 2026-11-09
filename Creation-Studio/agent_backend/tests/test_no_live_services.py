"""测试默认禁止真实网络请求。

这不是洁癖：`_wmd_channels()` 会去 127.0.0.1:17821 拉渠道，服务起没起决定
模型菜单是 2 条还是 6 条。同一份代码两种结果，等于假通过。

这里锁住这个机制本身，免得哪天有人把 conftest 里的 fixture 删掉或改名。

注意异常类型：`_http()` 内部有 `except Exception` 兜底，会把桩抛的
AssertionError 再包一层成 RuntimeError。所以断言看的是消息里的原因，
不是异常类——消息里带着桩原本的文本。
"""
import pytest


def test_creation_http_is_blocked_by_default():
    from app import create_tools
    with pytest.raises(RuntimeError, match='不允许真实网络请求'):
        create_tools._http('GET', '/api/state')


def test_blocked_call_names_the_target():
    from app import create_tools
    with pytest.raises(RuntimeError) as exc:
        create_tools._http('POST', '/api/images/generate')
    assert '/api/images/generate' in str(exc.value)
    assert '不允许真实网络请求' in str(exc.value)


def test_channel_discovery_is_stubbed():
    """渠道来源必须打桩，否则菜单条数取决于本机有没有跑控制器。

    注意只断言「线上渠道为空」：`model_options()` 还会读本机
    `agent_settings.json` 里配置的 provider，那属于配置依赖不是网络依赖，
    要隔离它的是 test_system_models 那种 tmp_path 用例。
    """
    from app.models import factory
    assert factory._wmd_channels() == []


def test_raw_urlopen_is_blocked_too():
    """桩打在 urllib 这一层：任何绕过 _http 的直连也会被拦住。"""
    import urllib.request
    with pytest.raises(AssertionError, match='不允许真实网络请求'):
        urllib.request.urlopen('http://127.0.0.1:17821/api/state')
