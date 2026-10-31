"""权限三档：仅查看 / 工作区权限 / 完全权限。

设计原则：
1. 三档只调"能写哪里、能不能跑命令"，不调"能不能读"（读由工具白名单控制）。
2. 高危命令在所有档位（含完全权限）都由系统强制阻断，模型无法通过措辞绕过。
3. 任何写操作都要经过路径守卫，完全权限只放开"全盘"，不放开系统目录。
"""
import json, os, re, time
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parents[1]
AGENT_WORKSPACE = AGENT_ROOT / 'data' / 'workspace'
TRASH_ROOT = AGENT_WORKSPACE / '_trash'
BACKUP_ROOT = AGENT_WORKSPACE / '_backup'
COMMAND_LOG = AGENT_ROOT / 'data' / 'agent-commands.log'

MODES = {
    'readonly': {'label': '仅查看', 'write': False, 'run': False, 'scope': 'roots',
                 'hint': '只能读取和检索；不能写文件、移动文件、生成图片或视频、执行命令。'},
    'workspace': {'label': '工作区权限', 'write': True, 'run': True, 'scope': 'roots',
                  'hint': '可以使用文件工具读写、移动、生成项目文件；任意命令需选择完全权限。'},
    'full': {'label': '完全权限', 'write': True, 'run': True, 'scope': 'any',
             'hint': '可以读写本机任意路径（系统目录除外）；命令仍然受高危规则强制阻断。'},
}
DEFAULT_MODE = 'workspace'
MODE_ORDER = ('readonly', 'workspace', 'full')

# 与具体业务无关的硬阻断：磁盘、引导、卷影、账户、电源、注册表、编码载荷。
DANGEROUS = [
    ('disk-format', r'\bformat\s+[a-z]:(?![\w])'),
    ('disk-partition', r'\bdiskpart\b|\bmkfs(\.|\b)|\bclean\s+all\b'),
    ('boot-config', r'\bbcdedit\b|\bbootrec\b|\bdiskpart\s+clean\b'),
    ('shadow-copy', r'vssadmin\s+delete|wbadmin\s+delete|sc\s+delete\s+\S*shadowcopy'),
    ('power-off', r'\bshutdown\b|\brestart-computer\b|\bstop-computer\b|\blogoff\b'),
    ('registry-wipe', r'\breg\s+delete\b.*(hklm|hkcu|hkey_)'),
    ('wipe-root', r'(rm\s+-rf?\s+/(\s|$)|\bdel\s+/[fsq]+\b[^\n]*\s[a-z]:\\?\s*$|\brd\s+/s\s+/q\s+[a-z]:\\?\s*$|remove-item\b[^\n]*-recurse[^\n]*[a-z]:\\?\s*$)'),
    ('drive-wipe', r'\bcipher\s+/w\b|\bsdelete\b'),
    ('account-backdoor', r'net\s+user\s+\S+\s+.*/add\b|net\s+localgroup\s+administrators\b'),
    ('encoded-payload', r'-e(nc|ncodedcommand)\b|\binvoke-expression\b|\biex\b|frombase64string'),
    ('defender-off', r'set-mppreference[^\n]*disable|add-mppreference[^\n]*-exclusion'),
    ('acl-takeover', r'takeown\s+/f\s+[a-z]:\\?\s*$|icacls\s+[a-z]:\\?\s+/grant'),
]

_PROJECT_DIR_CACHE = {}


def normalize(mode):
    value = str(mode or '').strip().lower()
    return value if value in MODES else DEFAULT_MODE


def describe(mode):
    key = normalize(mode)
    return {'mode': key, **MODES[key], 'default': key == DEFAULT_MODE, 'order': list(MODE_ORDER)}


def settings_roots():
    path = Path(os.getenv('AGENT_SETTINGS_PATH') or (AGENT_ROOT / 'data' / 'agent_settings.json'))
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []
    roots = (data.get('workspace') or {}).get('roots')
    if not isinstance(roots, list):
        return []
    return [str(item).strip() for item in roots if str(item).strip()]


def save_settings_roots(roots):
    path = Path(os.getenv('AGENT_SETTINGS_PATH') or (AGENT_ROOT / 'data' / 'agent_settings.json'))
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        data = {}
    workspace = data.get('workspace') if isinstance(data.get('workspace'), dict) else {}
    workspace['roots'] = [str(item).strip() for item in (roots or []) if str(item).strip()]
    data['workspace'] = workspace
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return workspace['roots']


def project_dir(project, ttl=300):
    """当前项目目录：向控制器要 /api/projects，失败就退回缓存，不阻塞工具调用。"""
    if not project:
        return ''
    hit = _PROJECT_DIR_CACHE.get(project)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    path = hit[1] if hit else ''
    try:
        from app.create_tools import _http
        data = _http('GET', '/api/projects', timeout=10)
        items = data if isinstance(data, list) else ((data or {}).get('items') or [])
        found = next((item for item in items if item.get('id') == project), None)
        path = str((found or {}).get('dir') or '') or path
    except Exception:
        pass
    _PROJECT_DIR_CACHE[project] = (time.time(), path)
    return path


def allowed_roots(project='', extra=None):
    """允许的根：环境变量 > 当前项目目录 > 智能体工作空间 > 设置里的白名单。

    系统临时目录不算工作区：写盘只认项目目录和显式白名单，避免"看似受控其实全盘可写"。
    """
    raw = []
    for chunk in str(os.getenv('WMD_AGENT_WORKSPACE_ROOTS') or '').split(os.pathsep):
        if chunk.strip():
            raw.append(Path(chunk.strip()))
    if project:
        found = project_dir(project)
        if found:
            raw.append(Path(found))
    raw.append(AGENT_WORKSPACE)
    raw += [Path(item) for item in settings_roots()]
    raw += [Path(item) for item in (extra or [])]
    roots, seen = [], set()
    for item in raw:
        try:
            resolved = item.expanduser().resolve()
        except OSError:
            continue
        key = str(resolved).lower()
        if key in seen or not resolved.is_dir():
            continue
        seen.add(key)
        roots.append(resolved)
    return roots


def protected_path(path):
    text = str(path).lower()
    windows = str(os.getenv('SystemRoot') or r'C:\Windows').lower().rstrip('\\')
    program = str(os.getenv('ProgramFiles') or r'C:\Program Files').lower()
    data = str(os.getenv('ProgramData') or r'C:\ProgramData').lower()
    if text == windows or text.startswith(windows + os.sep):
        return 'Windows 系统目录'
    if text == program or text.startswith(program + os.sep) or text.startswith(program + ' (x86)' + os.sep):
        return 'Program Files 安装目录'
    if text.startswith(data + os.sep + 'microsoft'):
        return 'ProgramData\\Microsoft'
    return ''


def guard(path, roots, mode):
    """路径守卫：工作区档必须落在允许根内；完全权限只挡住系统目录。"""
    if normalize(mode) == 'full':
        reason = protected_path(path)
        if reason:
            raise PermissionError('系统目录受保护（任何档位都不允许写）：' + reason)
        return path
    for root in roots:
        if path == root or root in path.parents:
            return path
    raise PermissionError('路径不在允许的工作目录内：' + str(path) + '；可用根：' + '、'.join(str(item) for item in roots[:6])
                          + '（需要写别处请把权限切到「完全权限」）')


def resolve_path(value, roots, mode, base=None):
    raw = str(value or '').strip().strip('"').strip("'")
    if not raw:
        raise PermissionError('缺少路径')
    point = Path(os.path.expandvars(raw)).expanduser()
    if not point.is_absolute():
        point = Path(base or (roots[0] if roots else Path.cwd())) / point
    try:
        point = point.resolve()
    except OSError as exc:
        raise PermissionError('路径无效：' + str(exc))
    return guard(point, roots, mode)


def check_command(command, roots, mode, cwd=''):
    text = ' '.join(str(command or '').split())
    if not text:
        raise PermissionError('缺少命令')
    low = text.lower()
    for rule, pattern in DANGEROUS:
        if re.search(pattern, low):
            raise PermissionError('高危命令被系统强制阻断（规则 ' + rule + '）：任何权限档位都不执行这类操作')
    if not MODES[normalize(mode)]['run']:
        raise PermissionError('当前是「仅查看」模式，不执行命令；需要执行请切到「工作区权限」或「完全权限」')
    if normalize(mode) == 'workspace':
        # 命令里出现的绝对路径也必须落在允许根内，挡住“绕开工具直接搬文件”。
        for token in re.findall(r'[a-z]:[\\/][^\s"\'|<>;,)]*', text, re.I):
            guard(Path(token).resolve(), roots, 'workspace')
        if cwd:
            guard(Path(cwd).resolve(), roots, 'workspace')
    return text


def dangerous_summary():
    return [{'rule': rule, 'blocked_in': 'all'} for rule, _ in DANGEROUS]


def audit(entry):
    try:
        COMMAND_LOG.parent.mkdir(parents=True, exist_ok=True)
        with COMMAND_LOG.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps({'at': int(time.time() * 1000), **entry}, ensure_ascii=False) + '\n')
    except OSError:
        pass


def park(path, root=None):
    """删除/覆盖前先复制一份到引用目录，避免用户数据不可恢复。"""
    source = Path(path)
    if not source.is_file():
        return ''
    day = time.strftime('%Y-%m-%d')
    stamp = time.strftime('%H%M%S')
    target_dir = (Path(root) if root else TRASH_ROOT) / day
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / (stamp + '-' + source.name)
    index = 1
    while target.exists():
        target = target_dir / (stamp + '-' + str(index) + '-' + source.name)
        index += 1
    try:
        import shutil
        shutil.copy2(source, target)
        return str(target)
    except OSError:
        return ''


def public(path):
    """对外显示前把允许根之后的相对位置也带上，方便模型和用户核对。"""
    text = str(path)
    return {'path': text, 'name': Path(text).name}
