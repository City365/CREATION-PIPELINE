import pytest

from app import skill_library


@pytest.fixture(autouse=True)
def local_auth_mode(monkeypatch):
    """测试默认用 development；需要 controller 的用例自己覆盖。"""
    monkeypatch.setenv('HARNESS_AUTH_MODE', 'development')


@pytest.fixture(autouse=True)
def isolated_skill_library(tmp_path, monkeypatch):
    """每个用例使用空的技能目录，避免仓库里的真实技能影响断言。"""
    monkeypatch.setattr(skill_library, 'ROOT', tmp_path / 'skills-library')
    skill_library._CACHE.clear()

@pytest.fixture(autouse=True)
def isolated_project_files(tmp_path,monkeypatch):
    from app import project_files
    def resolve(project):
        from fastapi import HTTPException
        if not project:raise HTTPException(422,'请先选择项目')
        point=tmp_path/'projects'/project
        point.mkdir(parents=True,exist_ok=True)
        return point
    monkeypatch.setattr(project_files,'project_root',resolve)


@pytest.fixture(autouse=True)
def no_live_services(monkeypatch):
    """测试默认不许连本机服务。

    不这么做的话，断言结果会取决于「你本机跑没跑控制器」：`_wmd_channels()`
    去 17821 拉渠道，服务起没起决定模型菜单是 2 条还是 6 条——同一份代码
    两种结果，假通过比没有测试更危险。

    桩打在 `urllib.request.urlopen` 这一层而不是 `_http`：需要验证请求细节的
    用例（比如内部凭据有没有带出去）自己在函数里 patch urlopen 就会覆盖这里。
    """
    import urllib.request
    from app.models import factory

    def boom(url, *args, **kwargs):
        target = getattr(url, 'full_url', url)
        raise AssertionError('测试不允许真实网络请求：' + str(target)
                             + '（要用就在用例里 monkeypatch urllib.request.urlopen）')

    monkeypatch.setattr(urllib.request, 'urlopen', boom)
    monkeypatch.setattr(factory, '_wmd_channels', lambda: [])

