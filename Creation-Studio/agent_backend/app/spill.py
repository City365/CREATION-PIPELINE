"""工具输出落盘：超长结果不再被截断丢弃。

原来 ToolGuard 直接把超过 24000 字符的输出切掉，后半截模型永远看不到——
一次 `read_file` 一个大文件、一次 `run_command` 刷屏日志，就永久丢信息，
模型只能重复调用同一个工具，把上下文和额度一起烧掉。

这里改成：
- 完整内容落盘到 data/spills/<project>/<run_id>/<spill_id>-<tool>.txt
- 回给模型的是「前 4000 字预览 + 落盘路径 + spill_id + next_start」
- 模型用 read_tool_output(spill_id, start, limit) 分段读完剩下的

为什么不复用 read_file：spill 目录在 agent_backend/data 下，通常不在用户的
权限根里，read_file 会按权限档位拒绝。专用回读工具只认 spill 目录，既不
放宽权限，也不会被路径穿越绕过。
"""
import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path

from langchain_core.tools import tool

ROOT = Path(os.getenv('WMD_SPILL_DIR') or Path(__file__).resolve().parents[1] / 'data' / 'spills')
PREVIEW_CHARS = 4000
DEFAULT_LIMIT = 6000
MAX_LIMIT = 40000
RETENTION_DAYS = 7

_SAFE = re.compile(r'[^A-Za-z0-9_.-]+')


def _run_dir(project, run_id):
    project_part = _SAFE.sub('_', str(project or 'shared'))[:60] or 'shared'
    run_part = _SAFE.sub('_', str(run_id or 'norun'))[:80] or 'norun'
    return ROOT / project_part / run_part


def write(text, *, project='', run_id='', tool='output', content_type='text'):
    """把完整输出落盘，返回给模型看的替代内容（预览 + 读法）。

    落盘失败时退回原来的截断行为，不让落盘问题打断工具调用。
    """
    text = str(text or '')
    spill_id = 's' + uuid.uuid4().hex[:10]
    name = _SAFE.sub('_', str(tool or 'output'))[:40] or 'output'
    payload = {
        'ok': True,
        'truncated': True,
        'spill_id': spill_id,
        'characters': len(text),
        'preview': text[:PREVIEW_CHARS],
        'next_start': PREVIEW_CHARS if len(text) > PREVIEW_CHARS else None,
        'note': ('完整输出共 ' + str(len(text)) + ' 字符，已落盘。用 '
                 'read_tool_output(spill_id="' + spill_id + '", start=next_start) 继续读，'
                 '不要为了看全内容重复调用原工具。'),
    }
    try:
        folder = _run_dir(project, run_id)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / (spill_id + '-' + name + '.txt')
        path.write_text(text, encoding='utf-8')
        payload['saved_to'] = str(path)
    except OSError as exc:
        payload['saved_to'] = None
        payload['error'] = '落盘失败，仅为预览：' + str(exc)
        payload['next_start'] = None
        payload['content'] = text[:PREVIEW_CHARS]
    return json.dumps(payload, ensure_ascii=False)


def _find(spill_id):
    """按 spill_id 在 spill 根下找文件，只允许根目录内的命中。"""
    raw = str(spill_id or '').strip()
    if not re.fullmatch(r's[0-9a-f]{6,32}', raw):
        return None
    root = ROOT.resolve()
    for path in root.glob('*/*/' + raw + '-*.txt'):
        try:
            path.resolve().relative_to(root)
        except ValueError:
            continue
        return path
    return None


def read(spill_id, start=0, limit=DEFAULT_LIMIT):
    path = _find(spill_id)
    if path is None:
        return {'ok': False, 'error': '找不到这条落盘输出：' + str(spill_id)
                + '。只有被裁剪过的工具结果才有 spill_id。'}
    try:
        text = path.read_text(encoding='utf-8', errors='replace')
    except OSError as exc:
        return {'ok': False, 'error': '读取失败：' + str(exc)}
    offset = max(0, int(start or 0))
    size = max(1, min(MAX_LIMIT, int(limit or DEFAULT_LIMIT)))
    chunk = text[offset:offset + size]
    return {'ok': True, 'spill_id': str(spill_id), 'characters': len(text),
            'content': chunk, 'start': offset,
            'next_start': offset + len(chunk) if offset + len(chunk) < len(text) else None,
            'done': offset + len(chunk) >= len(text)}


def build_spill_tools():
    @tool
    def read_tool_output(spill_id: str, start: int = 0, limit: int = DEFAULT_LIMIT) -> dict:
        """读取被裁剪的工具输出全文（按 spill_id 分段）。

        工具结果过长时会被落盘，返回值里的 spill_id 就是它的编号。
        用 next_start 作为下一次的 start 继续读，直到 done=true。
        """
        return read(spill_id, start, limit)

    return [read_tool_output]


def purge(days=RETENTION_DAYS, now=None):
    """清理过期落盘文件，返回删掉的文件数与释放的字节数。"""
    cutoff = (now or time.time()) - max(1, int(days)) * 86400
    removed = 0
    freed = 0
    if not ROOT.exists():
        return {'removed': 0, 'freed': 0}
    for project_dir in ROOT.iterdir():
        if not project_dir.is_dir():
            continue
        for run_dir in project_dir.iterdir():
            if not run_dir.is_dir():
                continue
            try:
                newest = max((p.stat().st_mtime for p in run_dir.iterdir()), default=0)
            except OSError:
                continue
            if newest >= cutoff:
                continue
            try:
                freed += sum(p.stat().st_size for p in run_dir.iterdir())
                shutil.rmtree(run_dir)
                removed += 1
            except OSError:
                continue
    return {'removed': removed, 'freed': freed}


def stats():
    if not ROOT.exists():
        return {'runs': 0, 'files': 0, 'bytes': 0}
    runs = files = total = 0
    for project_dir in ROOT.iterdir():
        if not project_dir.is_dir():
            continue
        for run_dir in project_dir.iterdir():
            if not run_dir.is_dir():
                continue
            runs += 1
            for path in run_dir.iterdir():
                files += 1
                try:
                    total += path.stat().st_size
                except OSError:
                    pass
    return {'runs': runs, 'files': files, 'bytes': total}
