import pytest

from app import skill_library


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
