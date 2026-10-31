"""标准技能目录：agent_backend/skills/<技能名>/SKILL.md

目录是自建技能的源文件，也是后端发现技能的入口：
- 每次读取技能时扫描目录，把每个含 SKILL.md 的文件夹合成一条 kind=skill 插件；
- 技能全局可用（换项目不会丢），ID 为 dir:<文件夹名>；
- 文本技能 / 完整技能压缩包 / 插件管理的增删改都直接落到这个目录。
"""
import hashlib
import io
import json
import os
import re
import shutil
import time
import uuid
import zipfile
from pathlib import Path

ROOT = Path(os.getenv('AGENT_SKILLS_DIR') or (Path(__file__).resolve().parents[1] / 'skills'))
LIMIT = 60000
TEXT_SUFFIXES = {'.md', '.txt', '.json', '.yaml', '.yml', '.csv'}
BUNDLE_SUFFIXES = TEXT_SUFFIXES | {'.py', '.js', '.mjs', '.html', '.css'}
SKIP_DIRS = {'scripts', 'examples', '__MACOSX'}
MAX_FILE_CHARS = 200000
MAX_ZIP_BYTES = 20 * 1024 * 1024
MAX_UNZIP_BYTES = 50 * 1024 * 1024
MAX_ZIP_FILES = 500

ADAPTER = '\n'.join([
    '【本机适配】',
    '你运行在 WENYUN.M-DESKTOP 创作台的对话里：没有项目文件夹、没有 Python / 外部命令权限，不能读取用户磁盘上的任何路径。',
    '- 输入文件由用户作为附件上传；先用 read_workspace_document 分页读完，再开始处理。',
    '- 需要产出文件时使用 create_workspace_artifact（txt/md/html/csv/json/xlsx），每次只生成一份，成功后再生成下一份，回复里不要重复整份正文。',
    '- SKILL.md 里提到的脚本 / 命令在本机不可用；按文字规则自己完成，不要声称运行了脚本。',
    '- 内容必须来自本轮材料；不确定时明确说明，不要编造。',
])

_CACHE = {}


def now_ms():
    return int(time.time() * 1000)


def safe_name(name):
    value = str(name or '').strip()
    value = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', '_', value).strip(' .')
    if not value or value in {'.', '..'}:
        raise ValueError('技能名称无效')
    return value[:80]


def safe_rel(rel):
    raw = str(rel or '').replace('\\', '/').strip()
    if not raw or re.match(r'^[A-Za-z]:', raw):
        return None
    parts = []
    for part in raw.split('/'):
        if part in ('', '.'):
            continue
        if part == '..' or part == '__MACOSX' or part == '.DS_Store':
            return None
        parts.append(part)
    if not parts or len('/'.join(parts)) > 200:
        return None
    return '/'.join(parts)


def split_front(text):
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n?(.*)$', text, re.S)
    if not match:
        return {}, text
    meta = {}
    for line in match.group(1).splitlines():
        if ':' not in line:
            continue
        key, value = line.split(':', 1)
        meta[key.strip().lower()] = value.strip().strip('"\'')
    return meta, match.group(2)


def read_text(path):
    return path.read_text(encoding='utf-8-sig', errors='replace').replace('\r\n', '\n')


def skill_folders():
    if not ROOT.is_dir():
        return []
    return [folder for folder in sorted(ROOT.iterdir(), key=lambda item: item.name)
            if folder.is_dir() and not folder.name.startswith('.') and (folder / 'SKILL.md').is_file()]


def _source_files(folder):
    """参与合成正文的文件：references/ 与根目录的文本文件（跳过 scripts/ examples/）。"""
    found = []
    for path in folder.rglob('*'):
        if not path.is_file():
            continue
        rel = path.relative_to(folder)
        if rel.as_posix() == 'SKILL.md' or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if rel.parts and rel.parts[0] in SKIP_DIRS:
            continue
        found.append((rel.as_posix(), path))
    return sorted(found, key=lambda item: item[0])


def _bundle_files(folder):
    files = []
    for path in folder.rglob('*'):
        if not path.is_file():
            continue
        rel = path.relative_to(folder)
        if rel.as_posix() == 'SKILL.md' or path.suffix.lower() not in BUNDLE_SUFFIXES:
            continue
        try:
            content = read_text(path)
        except OSError:
            continue
        if len(content) > MAX_FILE_CHARS:
            continue
        files.append({'path': rel.as_posix(), 'content': content})
    return sorted(files, key=lambda item: item['path'])


def compose(folder):
    skill_md = folder / 'SKILL.md'
    if not skill_md.is_file():
        return None
    meta, body = split_front(read_text(skill_md))
    already_adapted = body.lstrip().startswith('【本机适配】')
    parts = ([body.strip()] if already_adapted else [ADAPTER, '', '---', '', body.strip()])
    used = sum(len(part) for part in parts)
    omitted = []

    def add(title, text):
        nonlocal used
        block = '\n\n---\n\n## ' + title + '\n\n' + text.strip()
        if used + len(block) > LIMIT - 240:
            omitted.append(title)
            return
        parts.append(block)
        used += len(block)

    for rel, path in _source_files(folder):
        add(rel, read_text(path))
    if omitted:
        parts.append('\n\n---\n\n## 未加载的附件\n\n' + '、'.join(omitted) + '（超过技能正文上限，需要时请用户单独提供）')
    text = '\n'.join(parts).strip()
    if len(text) > LIMIT:
        text = text[:LIMIT - 40] + '\n\n…（内容超过上限，已截断）'
    description = str(meta.get('description') or '').strip()
    if not description:
        first = next((line.strip(' #') for line in body.splitlines() if line.strip()), '')
        description = first[:200] or ('来自后端 skills 目录：' + folder.name)
    return {'name': folder.name, 'description': description[:1000], 'instructions': text,
            'hash': hashlib.sha256((folder.name + '\n' + text).encode('utf-8')).hexdigest()}


def _signature(folder):
    stamps = []
    for path in folder.rglob('*'):
        if path.is_file():
            try:
                stat = path.stat()
            except OSError:
                continue
            stamps.append((path.relative_to(folder).as_posix(), stat.st_mtime_ns, stat.st_size))
    return tuple(sorted(stamps))


def spec_for(folder):
    key = str(folder)
    signature = _signature(folder)
    cached = _CACHE.get(key)
    if cached and cached[0] == signature:
        return cached[1]
    spec = compose(folder)
    if spec is not None:
        _CACHE[key] = (signature, spec)
    return spec


def item_for(folder):
    spec = spec_for(folder)
    if not spec:
        return None
    text = spec['instructions']
    files = _bundle_files(folder)
    return {
        'id': 'dir:' + folder.name,
        'kind': 'skill',
        'name': folder.name,
        'description': spec['description'],
        'enabled': not (folder / '.disabled').exists(),
        'config': {
            'mode': 'bundle' if files else 'text',
            'instructions': text,
            'files': files,
            'folder': folder.name,
            'source': 'folder',
        },
        'created': int(folder.stat().st_ctime * 1000),
        'updated': now_ms(),
        'runtime_status': 'available' if text.strip() and len(text) <= LIMIT else 'configured',
    }


def scan():
    items = []
    for folder in skill_folders():
        item = item_for(folder)
        if item:
            items.append(item)
    return items


def item_by_name(name):
    try:
        folder = ROOT / safe_name(name)
    except ValueError:
        return None
    return item_for(folder) if (folder / 'SKILL.md').is_file() else None


def write_skill(name, description='', instructions='', files=None, overwrite=True, enabled=True):
    folder = ROOT / safe_name(name)
    if folder.exists() and not overwrite:
        raise FileExistsError('技能已存在：' + folder.name)
    body = str(instructions or '').strip()
    if not body:
        raise ValueError('技能内容不能为空（粘贴 SKILL.md 正文）')
    folder.mkdir(parents=True, exist_ok=True)
    head = '---\nname: ' + folder.name + '\n'
    if description:
        head += 'description: ' + ' '.join(str(description).split()) + '\n'
    head += '---\n\n'
    (folder / 'SKILL.md').write_text(head + body + '\n', encoding='utf-8')
    marker = folder / '.disabled'
    if enabled is False:
        marker.write_text('disabled\n', encoding='utf-8')
    else:
        marker.unlink(missing_ok=True)
    if files is not None:
        _replace_files(folder, files)
    _CACHE.pop(str(folder), None)
    return item_for(folder)


def _replace_files(folder, files):
    keep = {'SKILL.md', '.disabled'}
    for item in files or []:
        rel = safe_rel(item.get('path') or item.get('name') or '')
        if not rel or rel == 'SKILL.md':
            continue
        content = str(item.get('content') or '')
        if len(content) > MAX_FILE_CHARS:
            raise ValueError('单个附加文件超过 200KB：' + rel)
        target = folder / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')
        keep.add(rel)
    for path in folder.rglob('*'):
        if not path.is_file():
            continue
        rel = path.relative_to(folder).as_posix()
        if rel not in keep:
            path.unlink(missing_ok=True)
    for path in sorted(folder.rglob('*'), key=lambda item: len(item.parts), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()


def update_skill(current_name, name, description='', instructions='', files=None, enabled=True):
    old = safe_name(current_name)
    new = safe_name(name or current_name)
    folder = ROOT / old
    if not (folder / 'SKILL.md').is_file():
        raise FileNotFoundError('技能不存在：' + old)
    if new != old:
        target = ROOT / new
        if target.exists():
            raise FileExistsError('技能已存在：' + new)
        folder.rename(target)
        folder = target
        _CACHE.pop(str(ROOT / old), None)
    return write_skill(folder.name, description, instructions, files, overwrite=True, enabled=enabled)


def delete_skill(name):
    folder = ROOT / safe_name(name)
    if not folder.is_dir() or folder.parent != ROOT:
        raise FileNotFoundError('技能不存在：' + str(name))
    shutil.rmtree(folder)
    _CACHE.pop(str(folder), None)
    return True


def save_zip(name, data, overwrite=True):
    if not data:
        raise ValueError('压缩包是空的')
    if len(data) > MAX_ZIP_BYTES:
        raise ValueError('压缩包超过 20MB')
    temp = ROOT / ('.tmp-' + uuid.uuid4().hex)
    temp.mkdir(parents=True, exist_ok=True)
    try:
        total = 0
        count = 0
        try:
            archive = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile:
            raise ValueError('不是有效的 zip 压缩包')
        with archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                rel = safe_rel(info.filename)
                if not rel:
                    continue
                count += 1
                total += info.file_size
                if count > MAX_ZIP_FILES:
                    raise ValueError('压缩包文件数超过 %d' % MAX_ZIP_FILES)
                if total > MAX_UNZIP_BYTES:
                    raise ValueError('解压后超过 50MB')
                target = temp / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as source, open(target, 'wb') as output:
                    shutil.copyfileobj(source, output)
        root = temp
        if not (root / 'SKILL.md').is_file():
            with_md = [folder for folder in temp.iterdir() if folder.is_dir() and (folder / 'SKILL.md').is_file()]
            if len(with_md) != 1:
                raise ValueError('压缩包里找不到 SKILL.md（放在根目录或唯一的子目录里）')
            root = with_md[0]
        meta, _ = split_front(read_text(root / 'SKILL.md'))
        final_name = safe_name(name or meta.get('name') or root.name or '未命名技能')
        destination = ROOT / final_name
        if destination.exists() and not overwrite:
            raise FileExistsError('技能已存在：' + final_name)
        if destination.exists():
            shutil.rmtree(destination)
        shutil.move(str(root), str(destination))
        _CACHE.pop(str(destination), None)
        return item_for(destination)
    finally:
        shutil.rmtree(temp, ignore_errors=True)


def migrate_item(item):
    """把数据库里的一条 skill 插件写成目录技能（供迁移脚本使用）。"""
    config = item.get('config') or {}
    files = config.get('files') if isinstance(config.get('files'), list) else None
    name = safe_name(item.get('name') or '未命名技能')
    if (ROOT / name / 'SKILL.md').is_file():
        return 'exists'
    write_skill(name, item.get('description') or '', str(config.get('instructions') or ''), files)
    return 'created'
