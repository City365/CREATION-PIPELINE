"""应用包注册表：换应用只换这里的 id，框架代码不动。

环境变量 WMD_APP_PACK 指定当前应用包；留空或未设置时用 creation-studio
（保持现有产品行为不变），这就是整套分层的回滚开关。
"""
import os

from app.app_packs.base import Pack, Policy  # noqa: F401  （供 pack 模块 import）
from app.app_packs.creation_studio import PACK as CREATION_STUDIO
from app.app_packs.generic import PACK as GENERIC

PACKS = {p.id: p for p in (CREATION_STUDIO, GENERIC)}
DEFAULT_ID = 'creation-studio'
ENV = 'WMD_APP_PACK'


def names():
    return sorted(PACKS)


def load(pack_id=None):
    raw = pack_id if pack_id is not None else os.getenv(ENV)
    pid = str(raw or '').strip() or DEFAULT_ID
    pack = PACKS.get(pid)
    if pack is None:
        raise KeyError('unknown app pack: ' + pid + '；available: ' + ', '.join(names()))
    return pack


def current():
    return load()
