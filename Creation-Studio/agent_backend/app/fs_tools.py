"""文件与命令工具：受三档权限约束的本地操作能力。

这些工具让智能体真的能「把文件移动到指定目录」「按指定路径读写」「跑一条命令」，
而权限档位（仅查看 / 工作区权限 / 完全权限）由 permissions.py 统一裁决：
- 仅查看：只能读，写和命令一律拒绝；
- 工作区权限：写和命令限制在允许的根目录内；
- 完全权限：放开全盘（系统目录除外），高危命令仍然强制阻断。
"""
import json, os, shutil, subprocess, threading, time
from pathlib import Path

from langchain_core.tools import tool
from fastapi import HTTPException

from app import permissions as perms, project_files

MAX_TEXT_CHARS = 300000
MAX_READ_BYTES = 2000000
MAX_LIST_ENTRIES = 200
MAX_OUTPUT = 30000

# 发布交付文件时串行登记，避免同一轮并发调用把 6 个上限判穿
_PUBLISH_LOCK = threading.Lock()


def _fail(message, **extra):
    return {'ok': False, 'error': message, **extra}


def _denied_write(mode):
    return _fail('当前是「' + perms.MODES[mode]['label'] + '」模式，不能写文件或移动文件；'
                 '需要这类操作请让用户在输入框把权限切到「工作区权限」或「完全权限」')


def _denied_delete(mode):
    if mode == 'readonly':
        return _fail('当前是「仅查看」模式，不能删除文件；删除需要「工作区权限」或「完全权限」')
    return None


def _looks_binary(data):
    if b'\0' in data[:4096]:
        return True
    try:
        data[:4096].decode('utf-8')
        return False
    except UnicodeDecodeError:
        return True


def _decode(data):
    for encoding in ('utf-8-sig', 'gb18030'):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode('utf-8', 'replace')


def _entry(path):
    try:
        stat = path.stat()
        return {'name': path.name, 'type': 'dir' if path.is_dir() else 'file',
                'size': stat.st_size, 'modified': int(stat.st_mtime * 1000)}
    except OSError:
        return {'name': path.name, 'type': 'unknown', 'size': 0, 'modified': 0}


def build_local_tools(project=None, session_id=None, mode=None, roots=None, publish=None, receipt=None):
    """按当前权限档位构建本地文件 / 命令工具。

    传入 publish / receipt 时额外提供 publish_artifact：把磁盘上已有的文件挂到对话里出卡片。
    脚本或命令生成的产物不经过模型参数，只能靠它登记成交付文件。
    """
    key = perms.normalize(mode)
    allowed = perms.allowed_roots(project, roots)
    base = allowed[0] if allowed else Path.cwd()
    frozen_root = project_files.project_root(project) if project else None
    if project:
        base = project_files.session_dir(project, session_id, frozen_root)
        # Project scope must not include the shared legacy backend directory.
        allowed = [frozen_root] + [p for p in allowed if p != perms.AGENT_WORKSPACE.resolve()]


    def resolve(value):
        return perms.resolve_path(value, allowed, key, base=base)

    @tool
    def read_permission() -> dict:
        """读取当前权限档位和可用的工作目录。做任何文件或命令操作前先调用它，确认能写到哪些目录、能不能执行命令。"""
        return {'ok': True, 'mode': key, 'label': perms.MODES[key]['label'],
                'can_write': perms.MODES[key]['write'], 'can_run': perms.MODES[key]['run'] and key != 'workspace',
                'hint': perms.MODES[key]['hint'],
                'roots': [str(item) for item in allowed],
                'project': project or '',
                'blocked_commands': perms.dangerous_summary(),
                'note': '高危命令（格式化、分区、关机、删系统目录、编码载荷等）在所有档位都被系统强制阻断，'
                        '不要尝试改写命令绕过。'}

    @tool
    def list_dir(path: str = '', depth: int = 1) -> dict:
        """列出目录内容（名称、类型、大小、修改时间）。path 可留空表示当前项目目录；depth 1-2。"""
        try:
            target = resolve(path or str(base))
        except PermissionError as exc:
            return _fail(str(exc))
        if not target.is_dir():
            return _fail('不是目录：' + str(target))
        limit = 1 if int(depth or 1) <= 1 else 2
        items, truncated = [], False
        stack = [(target, 0)]
        while stack:
            current, level = stack.pop(0)
            try:
                children = sorted(current.iterdir(), key=lambda item: (item.is_file(), item.name.lower()))
            except OSError as exc:
                items.append({'name': current.name, 'type': 'error', 'size': 0, 'modified': 0, 'error': str(exc)})
                continue
            for child in children:
                if child.name.startswith('.'):
                    continue
                if len(items) >= MAX_LIST_ENTRIES:
                    truncated = True
                    break
                entry = _entry(child)
                entry['path'] = str(child)
                if level + 1 < limit and child.is_dir():
                    entry['child_count'] = len(list(child.iterdir())) if child.is_dir() else 0
                    stack.append((child, level + 1))
                items.append(entry)
            if truncated:
                break
        return {'ok': True, 'path': str(target), 'count': len(items), 'items': items,
                'truncated': truncated or len(items) >= MAX_LIST_ENTRIES}

    @tool
    def read_file(path: str, start: int = 0, limit: int = 6000) -> dict:
        """按绝对路径读取文本文件（文本、代码、json、csv、md 等），可分页。二进制文件只返回元数据。"""
        try:
            target = resolve(path)
        except PermissionError as exc:
            return _fail(str(exc))
        if not target.exists():
            return _fail('文件不存在：' + str(target))
        if target.is_dir():
            return _fail('这是目录，请用 list_dir：' + str(target))
        size = target.stat().st_size
        try:
            with target.open('rb') as handle:
                data = handle.read(min(size, MAX_READ_BYTES))
        except OSError as exc:
            return _fail('读取失败：' + str(exc))
        if _looks_binary(data):
            return {'ok': False, 'path': str(target), 'name': target.name, 'bytes': size,
                    'error': '这是二进制文件，不能按文本读；图片用 describe_image，视频用 probe_video / extract_frames'}
        text = _decode(data)
        offset = max(0, int(start or 0))
        size_limit = max(200, min(12000, int(limit or 6000)))
        chunk = text[offset:offset + size_limit]
        return {'ok': True, 'path': str(target), 'name': target.name, 'bytes': size,
                'characters': len(text), 'content': chunk, 'start': offset,
                'next_start': offset + len(chunk) if offset + len(chunk) < len(text) else None,
                'truncated': size > MAX_READ_BYTES}

    @tool
    def write_file(path: str, content: str, mode: str = 'overwrite') -> dict:
        """把文本写入指定路径（自动创建父目录）。mode 为 overwrite 覆盖或 append 追加；覆盖前旧文件会自动备份。"""
        if not perms.MODES[key]['write']:
            return _denied_write(key)
        try:
            output_path=path
            if project and Path(path).name==path:
                output_path=str(Path('脚本' if Path(path).suffix.lower() in project_files.SCRIPT_SUFFIXES else '文档')/path)
            target = resolve(output_path)
        except PermissionError as exc:
            return _fail(str(exc))
        body = str(content or '')
        if not body:
            return _fail('内容为空，没有写入')
        if len(body) > MAX_TEXT_CHARS:
            return _fail('内容太长（上限 30 万字符），请拆分后分批写')
        if target.exists() and target.is_dir():
            return _fail('目标是目录，请给出文件名：' + str(target))
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            backup = ''
            if project and (target==frozen_root or frozen_root in target.parents):backup=project_files.before_write(project,target) or ''
            if target.exists() and not backup:backup = perms.park(target, root=(frozen_root/project_files.AGENT_FOLDER/'.回收站') if project else None)
            with target.open('a' if str(mode).lower() == 'append' else 'w', encoding='utf-8', newline='') as handle:
                handle.write(body)
        except OSError as exc:
            return _fail('写入失败：' + str(exc))
        result = {'ok': True, **perms.public(target), 'bytes': target.stat().st_size,
                  'appended': str(mode).lower() == 'append', 'backup': backup}
        if project and session_id and target.suffix.lower() in (__import__('app.workspace',fromlist=['EXTENSIONS']).EXTENSIONS):
            try:
                item = project_files.register_existing(project,session_id,target,origin='work')
                result['file_id'] = item['id']
                if publish:publish({'type':'workspace_file','file':{k:v for k,v in item.items() if k!='text'}})
            except Exception as exc:
                result['registration_error'] = str(exc)
        return result

    @tool
    def make_dir(path: str) -> dict:
        """创建目录（含父级目录）。已存在时直接返回成功。"""
        if not perms.MODES[key]['write']:
            return _denied_write(key)
        try:
            target = resolve(path)
        except PermissionError as exc:
            return _fail(str(exc))
        try:
            existed = target.is_dir()
            target.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            return _fail('创建目录失败：' + str(exc))
        return {'ok': True, **perms.public(target), 'existed': existed}

    @tool
    def move_file(src: str, dst: str) -> dict:
        """把文件或目录移动到目标位置。dst 是已存在的目录时移入该目录并保留原名；同名文件会先备份再覆盖。"""
        if not perms.MODES[key]['write']:
            return _denied_write(key)
        try:
            source = resolve(src)
            target = resolve(dst)
        except PermissionError as exc:
            return _fail(str(exc))
        if not source.exists():
            return _fail('源路径不存在：' + str(source))
        if target.is_dir():
            target = target / source.name
        if str(source) == str(target):
            return _fail('源和目标是同一个位置')
        try:
            if project:project_files.move_records(project,source,target)
            target.parent.mkdir(parents=True, exist_ok=True)
            backup = perms.park(target,root=(frozen_root/project_files.AGENT_FOLDER/'.回收站') if project else None) if target.exists() else ''
            shutil.move(str(source), str(target))
            if project:project_files.move_records(project,source,target,apply=True)
        except (OSError,HTTPException) as exc:
            return _fail('移动失败：' + str(exc))
        return {'ok': True, 'from': str(source), **perms.public(target), 'backup': backup}

    @tool
    def copy_file(src: str, dst: str) -> dict:
        """复制文件或目录到目标位置，保留原名。dst 是已存在的目录时复制进去；同名文件先备份再覆盖。"""
        if not perms.MODES[key]['write']:
            return _denied_write(key)
        try:
            source = resolve(src)
            target = resolve(dst)
        except PermissionError as exc:
            return _fail(str(exc))
        if not source.exists():
            return _fail('源路径不存在：' + str(source))
        if target.is_dir():
            target = target / source.name
        if str(source) == str(target):
            return _fail('源和目标是同一个位置')
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            backup = perms.park(target,root=(frozen_root/project_files.AGENT_FOLDER/'.回收站') if project else None) if target.is_file() else ''
            if source.is_dir():
                shutil.copytree(str(source), str(target), dirs_exist_ok=True)
            else:
                shutil.copy2(str(source), str(target))
        except OSError as exc:
            return _fail('复制失败：' + str(exc))
        return {'ok': True, 'from': str(source), **perms.public(target),
                'bytes': target.stat().st_size if target.is_file() else 0, 'backup': backup}

    @tool
    def delete_file(path: str) -> dict:
        """删除文件或空目录。删除前自动备份到工作空间的 _trash 目录，可人工恢复。"""
        denied = _denied_delete(key)
        if denied:
            return denied
        try:
            target = resolve(path)
        except PermissionError as exc:
            return _fail(str(exc))
        if not target.exists():
            return _fail('路径不存在：' + str(target))
        try:
            if target.is_dir():
                if any(target.iterdir()):
                    return _fail('目录不为空，先清理里面的文件再删：' + str(target))
                target.rmdir()
                return {'ok': True, 'path': str(target), 'kind': 'dir', 'backup': ''}
            backup = perms.park(target,root=(frozen_root/project_files.AGENT_FOLDER/'.回收站') if project else None)
            target.unlink()
        except OSError as exc:
            return _fail('删除失败：' + str(exc))
        return {'ok': True, 'path': str(target), 'kind': 'file', 'backup': backup,
                'note': '文件已删除，副本在 ' + (backup or '（备份失败，无法恢复）')}

    @tool
    def run_command(command: str, cwd: str = '', timeout_seconds: int = 60) -> dict:
        """在 Git Bash 里执行一条命令，返回退出码和输出（超时自动结束整个进程树）。

        高危命令（格式化、分区、关机、删系统目录、编码载荷等）会被系统强制阻断；
        工作区权限下 cwd 和命令里的绝对路径都必须落在允许目录内。
        """
        try:
            text = perms.check_command(command, allowed, key, cwd)
        except PermissionError as exc:
            perms.audit({'tool': 'run_command', 'command': str(command or '')[:400], 'cwd': str(cwd or ''),
                         'mode': key, 'exit_code': None, 'blocked': True, 'reason': str(exc)})
            return _fail(str(exc), blocked=True)
        if key == 'workspace':
            return _fail('工作区权限只开放受路径校验的文件工具；执行任意脚本需明确切换完全权限', blocked=True)
        workdir = str(base)
        if cwd:
            try:
                workdir = str(resolve(cwd))
            except PermissionError as exc:
                return _fail(str(exc))
        if not Path(workdir).is_dir():
            return _fail('工作目录不存在：' + workdir)
        timeout = max(5, min(600, int(timeout_seconds or 60)))
        env = {k: v for k, v in os.environ.items() if not k.upper().startswith(('WMD_', 'AGENT_'))}
        # 把当前项目位置显式传给脚本：技能脚本据此找 assets/素材，不用再问用户路径。
        try:
            project_dir = str(perms.project_dir(project) or '') if project else ''
        except Exception:
            project_dir = ''
        if project_dir:
            env['WMD_PROJECT_DIR'] = project_dir
            env['WMD_ASSETS_DIR'] = str(Path(project_dir) / 'assets' / '素材')
        bash = os.getenv('WMD_GIT_BASH') or r'D:\notebook\software\git\Git\bin\bash.exe'
        if not Path(bash).is_file():return _fail('Git Bash 不可用：' + bash)
        argv = [bash, '--noprofile', '--norc', '-c', text]
        started = time.time()
        proc = subprocess.Popen(argv, cwd=workdir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                env=env, text=True, encoding='utf-8', errors='replace')
        timed_out = False
        try:
            output, _ = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)], capture_output=True, timeout=30)
            except Exception:
                pass
            try:
                output, _ = proc.communicate(timeout=15)
            except Exception:
                output = ''
        duration = int((time.time() - started) * 1000)
        text_out = str(output or '')
        clipped = len(text_out) > MAX_OUTPUT
        payload = {'ok': (not timed_out) and proc.returncode == 0, 'command': text, 'cwd': workdir,
                   'exit_code': proc.returncode, 'duration_ms': duration, 'timed_out': timed_out,
                   'output': text_out[:MAX_OUTPUT], 'truncated': clipped}
        if timed_out:
            payload['error'] = '命令超过 ' + str(timeout) + ' 秒，已结束进程树'
        perms.audit({'tool': 'run_command', 'session': session_id or '', 'mode': key, 'command': text[:400],
                     'cwd': workdir, 'exit_code': proc.returncode, 'duration_ms': duration,
                     'timed_out': timed_out, 'blocked': False})
        return payload

    tools = [read_permission, list_dir, read_file, write_file, make_dir, move_file, copy_file, delete_file, run_command]

    if publish is not None and receipt is not None:
        @tool
        def publish_artifact(path: str, name: str = '', format: str = '') -> dict:
            """把已经用脚本或命令写好、已经落在磁盘上的文件挂到当前对话里，前端会显示可预览可下载的文件卡片。
            path 用绝对路径；name 省略时用文件名；format 省略时按后缀判断，支持 txt、md、html、csv、json、xlsx。
            只登记项目内原文件，不复制或重建内容。只要是本轮要交付给用户的文件，都要调用它。"""
            from fastapi import HTTPException
            if not perms.MODES[key]['write']:
                return _denied_write(key)
            try:
                target = resolve(path)
            except PermissionError as exc:
                return _fail(str(exc))
            if not target.is_file():
                return _fail('文件不存在：' + str(target))
            suffix = (format or target.suffix or '').lower().strip('.')
            from app.workspace import EXTENSIONS
            if '.' + suffix not in EXTENSIONS:
                return _fail('只支持发布文档、脚本、图片、音频和视频；当前后缀为「' + suffix + '」')
            label = (name or target.name)[:120]
            with _PUBLISH_LOCK:
                if len(receipt.get('artifacts', [])) >= 6:
                    return _fail('每轮最多发布 6 个文件')
                try:
                    artifact = project_files.register_existing(project,session_id,target,name=label,suffix='.'+suffix)
                    artifact.pop('text',None)
                except (ValueError, HTTPException) as exc:
                    return _fail(str(exc) if isinstance(exc,ValueError) else str(exc.detail))
                artifacts = receipt.setdefault('artifacts', [])
                if not any(a['id']==artifact['id'] for a in artifacts):artifacts.append(artifact)
                publish({'type':'artifact','file':artifact})
            return {'ok': True, 'artifact': artifact, 'source_path': str(target),
                    'note': '文件已挂到当前对话，前端会自动显示可点击的预览卡片，不需要输出下载链接或重复正文'}
        tools.append(publish_artifact)

    note = ('\n【权限】当前档位：' + perms.MODES[key]['label'] + '。' + perms.MODES[key]['hint']
            + ('可用根目录：' + '、'.join(str(item) for item in allowed[:6]) if key != 'full' else '可写本机任意路径（系统目录除外）')
            + '。高危命令在任何档位都被强制阻断。')
    for item in tools:
        item.description = (item.description or '') + note
    return tools
