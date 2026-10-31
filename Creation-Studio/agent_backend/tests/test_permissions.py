"""三档权限：路径守卫、命令硬阻断、文件工具的实际行为。"""
import json
import os
from pathlib import Path

import pytest

from app import permissions as perms
from app.fs_tools import build_local_tools


@pytest.fixture()
def roots(tmp_path, monkeypatch):
    """工作区档的两个根：一个"项目目录"，一个"工作空间"。"""
    project = tmp_path / 'project'
    workspace = tmp_path / 'workspace'
    project.mkdir()
    workspace.mkdir()
    monkeypatch.setenv('WMD_AGENT_WORKSPACE_ROOTS', os.pathsep.join([str(project), str(workspace)]))
    monkeypatch.setattr(perms, 'AGENT_WORKSPACE', workspace)
    monkeypatch.setattr(perms, 'TRASH_ROOT', workspace / '_trash')
    monkeypatch.setattr(perms, 'COMMAND_LOG', workspace / 'commands.log')
    return project, workspace


def tools_for(mode, project=None):
    built = build_local_tools(project='', session_id='t', mode=mode, roots=None)
    return {item.name: item for item in built}


def call(tools, name, **kwargs):
    return json.loads(tools[name].invoke(kwargs).content if hasattr(tools[name].invoke(kwargs), 'content') else '{}')


def invoke(tools, name, **kwargs):
    result = tools[name].invoke(kwargs)
    return result if isinstance(result, dict) else json.loads(getattr(result, 'content', '{}'))


def test_default_mode_and_labels():
    assert perms.normalize('') == 'workspace'
    assert perms.normalize('乱写') == 'workspace'
    assert perms.normalize('FULL') == 'full'
    assert [perms.describe(m)['label'] for m in perms.MODE_ORDER] == ['仅查看', '工作区权限', '完全权限']


def test_workspace_mode_blocks_outside_path(tmp_path, roots):
    tools = tools_for('workspace')
    outside = tmp_path / 'outside'
    outside.mkdir()
    result = invoke(tools, 'write_file', path=str(outside / 'a.txt'), content='x')
    assert result['ok'] is False
    assert '不在允许的工作目录内' in result['error']
    assert not (outside / 'a.txt').exists()


def test_full_mode_allows_outside_but_blocks_system_dir(tmp_path, roots, monkeypatch):
    monkeypatch.setenv('SystemRoot', str(tmp_path / 'Windows'))
    (tmp_path / 'Windows').mkdir()
    tools = tools_for('full')
    outside = tmp_path / 'outside'
    outside.mkdir()
    ok = invoke(tools, 'write_file', path=str(outside / 'a.txt'), content='hello')
    assert ok['ok'] is True, ok
    blocked = invoke(tools, 'write_file', path=str(tmp_path / 'Windows' / 'x.txt'), content='x')
    assert blocked['ok'] is False
    assert '系统目录受保护' in blocked['error']


def test_readonly_denies_writes(roots):
    tools = tools_for('readonly')
    assert invoke(tools, 'write_file', path='a.txt', content='x')['ok'] is False
    assert invoke(tools, 'make_dir', path='dir')['ok'] is False
    assert invoke(tools, 'move_file', src='a.txt', dst='b.txt')['ok'] is False
    assert invoke(tools, 'delete_file', path='a.txt')['ok'] is False
    assert invoke(tools, 'run_command', command='echo 1')['ok'] is False


def test_move_copy_mkdir_list_read(roots):
    project, _ = roots
    tools = tools_for('workspace')
    target = project / 'source.txt'
    target.write_text('第一行\n第二行\n', encoding='utf-8')

    read = invoke(tools, 'read_file', path=str(target))
    assert read['ok'] and '第一行' in read['content']

    made = invoke(tools, 'make_dir', path=str(project / '镜头' / '5'))
    assert made['ok'] and (project / '镜头' / '5').is_dir()

    moved = invoke(tools, 'move_file', src=str(target), dst=str(project / '镜头' / '5'))
    assert moved['ok'], moved
    assert (project / '镜头' / '5' / 'source.txt').exists()
    assert not target.exists()

    copied = invoke(tools, 'copy_file', src=str(project / '镜头' / '5' / 'source.txt'), dst=str(project / '复制.txt'))
    assert copied['ok'] and (project / '复制.txt').read_text(encoding='utf-8').startswith('第一行')

    listed = invoke(tools, 'list_dir', path=str(project / '镜头'))
    assert listed['ok'] and any(item['name'] == '5' for item in listed['items'])


def test_overwrite_creates_backup_and_delete_parks(roots):
    project, workspace = roots
    tools = tools_for('workspace')
    target = project / 'out.txt'
    target.write_text('旧内容', encoding='utf-8')
    written = invoke(tools, 'write_file', path=str(target), content='新内容')
    assert written['ok'] and written['backup']
    assert Path(written['backup']).read_text(encoding='utf-8') == '旧内容'

    deleted = invoke(tools, 'delete_file', path=str(target))
    assert deleted['ok'] and not target.exists()
    assert Path(deleted['backup']).exists()


@pytest.mark.parametrize('command', [
    'format D: /q',
    'diskpart',
    'shutdown /s /t 0',
    'reg delete HKLM\\Software\\Foo /f',
    'vssadmin delete shadows /all /quiet',
    'powershell -enc ZQBjAGgAbwA=',
    'net user hacker P@ss /add',
    'remove-item -recurse -force C:\\',
    'bcdedit /set testsigning on',
])
def test_dangerous_commands_blocked_in_every_mode(roots, command):
    for mode in perms.MODE_ORDER:
        tools = tools_for(mode)
        result = invoke(tools, 'run_command', command=command)
        assert result['ok'] is False, (mode, command, result)
        assert result.get('blocked') is True or '强制阻断' in result['error'] or '仅查看' in result['error']


def test_workspace_mode_blocks_absolute_path_in_command(roots, tmp_path):
    tools = tools_for('workspace')
    outside = tmp_path / 'elsewhere' / 'a.txt'
    result = invoke(tools, 'run_command', command='copy "' + str(outside) + '" .')
    assert result['ok'] is False
    assert '不在允许的工作目录内' in result['error']


def test_run_command_executes_and_logs(roots):
    project, workspace = roots
    tools = tools_for('full')
    result = invoke(tools, 'run_command', command='printf "hello-agent\\n"', cwd=str(project))
    assert result['ok'] is True, result
    assert 'hello-agent' in result['output']
    assert result['exit_code'] == 0
    log = workspace / 'commands.log'
    assert log.exists() and 'hello-agent' in log.read_text(encoding='utf-8')


def test_permission_tool_reports_roots(roots):
    tools = tools_for('workspace')
    info = invoke(tools, 'read_permission')
    assert info['ok'] and info['mode'] == 'workspace' and info['can_write'] is True
    assert info['roots']
    assert info['blocked_commands']
