"""分镜提示词转批量任务格式（skill 6）的素材库定位与匹配。

素材库位置由系统给（WMD_ASSETS_DIR / WMD_PROJECT_DIR），不再问用户；
素材按集放在子目录里，脚本必须递归找图。
"""
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "skills" / "6-分镜提示词转批量任务格式" / "scripts" / "build_tasks.py"


def load_module():
    spec = importlib.util.spec_from_file_location("build_tasks_skill", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def mod():
    return load_module()


def make_project(tmp_path):
    root = tmp_path / "我的同桌测试-643a02"
    for kind, ep, names in [
        ("人物", "第3集-被讨厌的勇气", ["温语-三视图.png", "程景深-三视图.png"]),
        ("场景", "第3集-被讨厌的勇气", ["大学露天咖啡吧.png"]),
        ("人物", "我的同桌", ["林辰_封面同款蓝白校服_四视图_v1.png"]),
        ("场景", "我的同桌", ["14_林辰家客厅_2026版_四视图.png"]),
    ]:
        folder = root / "assets" / "素材" / kind / ep
        folder.mkdir(parents=True, exist_ok=True)
        for name in names:
            (folder / name).write_bytes(b"png")
    (root / "assets" / "素材" / ".版本").mkdir(parents=True, exist_ok=True)
    (root / "assets" / "素材" / ".版本" / "旧图.png").write_bytes(b"png")
    return root


def test_list_images_is_recursive_and_skips_history(mod, tmp_path):
    root = make_project(tmp_path)
    files = mod.list_images(root / "assets" / "素材" / "人物")
    names = sorted(p.name for p in files)
    assert names == sorted(["温语-三视图.png", "程景深-三视图.png", "林辰_封面同款蓝白校服_四视图_v1.png"])
    assert all(".版本" not in p.as_posix() for p in files), "留档目录不算素材"


def test_find_assets_dir_prefers_env(mod, tmp_path, monkeypatch):
    root = make_project(tmp_path)
    monkeypatch.delenv("WMD_ASSETS_DIR", raising=False)
    monkeypatch.setenv("WMD_PROJECT_DIR", str(root))
    found, source = mod.find_assets_dir("")
    assert found == root / "assets" / "素材"
    assert "WMD_PROJECT_DIR" in source or "项目" in source

    monkeypatch.setenv("WMD_ASSETS_DIR", str(root / "assets" / "素材"))
    found, source = mod.find_assets_dir("")
    assert found == root / "assets" / "素材"
    assert source == "WMD_ASSETS_DIR"


def test_find_assets_dir_explicit_wins(mod, tmp_path, monkeypatch):
    root = make_project(tmp_path)
    monkeypatch.setenv("WMD_ASSETS_DIR", str(root / "assets" / "素材"))
    custom = tmp_path / "别处素材"
    custom.mkdir()
    found, source = mod.find_assets_dir(str(custom))
    assert found == custom
    assert "参数" in source


def test_in_episode_filters_by_subfolder(mod, tmp_path):
    root = make_project(tmp_path)
    base = root / "assets" / "素材" / "人物"
    files = mod.list_images(base)
    picked = [p for p in files if mod.in_episode(p, base, "第3集")]
    assert sorted(p.name for p in picked) == ["温语-三视图.png", "程景深-三视图.png"]
    assert len([p for p in files if mod.in_episode(p, base, "")]) == len(files)


def test_main_writes_task_files_from_project_assets(mod, tmp_path, monkeypatch):
    root = make_project(tmp_path)
    monkeypatch.setenv("WMD_PROJECT_DIR", str(root))
    monkeypatch.delenv("WMD_ASSETS_DIR", raising=False)
    text = tmp_path / "第3集分镜.txt"
    text.write_text(
        "*::~OUTPUT_START::~*\n"
        "场景：大学露天咖啡吧｜外｜日\n"
        "角色：温语、程景深\n"
        "时长：15秒\n"
        "SHOT 1: Medium close-up，温语看着手机。\n"
        "*::~RECORD::~*\n",
        encoding="utf-8",
    )
    out = tmp_path / "output"
    code = mod.main(["--input", str(text), "--out", str(out), "--episode", "第3集"])
    assert code == 0
    payload = json.loads((out / "第3集分镜.json").read_text(encoding="utf-8"))
    images = payload["items"][0]["images"]
    names = [Path(item["path"]).name for item in images]
    assert names == ["温语-三视图.png", "程景深-三视图.png", "大学露天咖啡吧.png"], names
    assert all("第3集-被讨厌的勇气" in item["path"] for item in images)
    assert payload["items"][0]["duration"] == 15
    assert payload["items"][0]["ratio"] == "16:9"


def test_main_fails_clearly_when_no_assets(mod, tmp_path, monkeypatch):
    monkeypatch.delenv("WMD_ASSETS_DIR", raising=False)
    monkeypatch.delenv("WMD_PROJECT_DIR", raising=False)
    monkeypatch.chdir(tmp_path)
    text = tmp_path / "a.txt"
    text.write_text("场景：x\n角色：y\n时长：10秒\n", encoding="utf-8")
    code = mod.main(["--input", str(text), "--out", str(tmp_path / "o")])
    assert code == 2
