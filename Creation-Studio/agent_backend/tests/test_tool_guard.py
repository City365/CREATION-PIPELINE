"""工具守卫：生成类去重、轮询类放过、写类防死循环、输出裁剪、读类不缓存。

循环判定口径：同一工具 + 完全相同的参数，连续 5 次才算循环；参数不同属于正常迭代。
"""
import asyncio
import json

from langchain_core.messages import ToolMessage

from app.tool_guard import ToolGuard


class Request:
    def __init__(self, name, args, call_id='c1'):
        self.tool_call = {'name': name, 'args': args, 'id': call_id}
        self.tool = None


def message(content, status='success'):
    return ToolMessage(content=content, tool_call_id='c1', name='t', status=status)


def run(guard, name, args, payload='{"ok": true}', calls=None):
    async def handler(_request):
        if calls is not None:
            calls.append(name)
        return message(payload)
    return asyncio.run(guard.awrap_tool_call(Request(name, args), handler))


def test_generation_calls_are_deduped():
    """同样的生成请求只执行一次，避免重复计费。"""
    guard = ToolGuard()
    calls = []
    run(guard, 'generate_image', {'prompt': '秋景', 'count': 1}, calls=calls)
    run(guard, 'generate_image', {'prompt': '秋景', 'count': 1}, calls=calls)
    assert calls == ['generate_image']
    assert guard.summary()['cache_hits'] == 1


def test_list_dir_is_never_cached():
    """文件系统随时会变：list_dir 每次都真执行（实机验收踩到的坑）。"""
    guard = ToolGuard()
    calls = []
    run(guard, 'list_dir', {'path': 'D:/tmp/x'}, calls=calls)
    run(guard, 'list_dir', {'path': 'D:/tmp/x'}, calls=calls)
    assert calls == ['list_dir', 'list_dir']
    assert guard.summary()['cache_hits'] == 0


def test_polling_tool_is_never_blocked():
    """查任务状态同参数重复多次都正常，不能被"重复调用"拦下。"""
    guard = ToolGuard(max_repeat=5)
    calls = []
    for _ in range(10):
        out = run(guard, 'check_video_job', {'job_id': 'j1'}, calls=calls)
        assert json.loads(out.content) == {'ok': True}
    assert len(calls) == 10
    assert guard.summary()['repeat_blocks'] == 0


def test_same_args_five_times_is_a_loop():
    """同一工具 + 同一参数连续 5 次才算循环（实机踩坑：3 次就拦会误杀脚本迭代）。"""
    guard = ToolGuard()
    calls = []
    outputs = []
    for _ in range(6):
        out = run(guard, 'move_file', {'src': 'a', 'dst': 'b'}, payload='{"ok": false}', calls=calls)
        outputs.append(json.loads(out.content))
    assert len(calls) == 4, '前 4 次照跑，第 5 次判为循环'
    assert guard.summary()['repeat_blocks'] >= 1
    assert any(item.get('ok') is False and '循环' in item.get('error', '') for item in outputs)


def test_same_tool_different_args_is_not_a_loop():
    """同名工具不同参数是正常迭代：写脚本 → 跑脚本 → 改脚本 → 再跑。"""
    guard = ToolGuard()
    calls = []
    for index in range(10):
        out = run(guard, 'run_command', {'command': 'python step' + str(index) + '.py'}, calls=calls)
        assert json.loads(out.content) == {'ok': True}
    assert len(calls) == 10
    assert guard.summary()['repeat_blocks'] == 0


def test_write_loop_does_not_block_later_tools():
    """写类被判循环后，后面的交付/读类工具不能被连坐（卡片消失的根因）。"""
    guard = ToolGuard()
    same = {'command': 'python make_batch.py'}
    for _ in range(5):
        run(guard, 'run_command', same, payload='{"ok": true}')
    assert guard.summary()['repeat_blocks'] == 1
    calls = []
    out = run(guard, 'create_workspace_artifact', {'name': '交付', 'format': 'txt', 'content': 'x'}, calls=calls)
    assert json.loads(out.content) == {'ok': True}, '交付工具不能被循环判定连坐'
    assert calls == ['create_workspace_artifact']
    out = run(guard, 'read_file', {'path': 'a.txt'}, calls=calls)
    assert json.loads(out.content) == {'ok': True}, '读类工具不受影响'


def test_read_tools_alternating_is_not_a_loop():
    """list_dir + read_file 交替多轮是正常探索，不能判成循环。"""
    guard = ToolGuard()
    for index in range(10):
        name = 'list_dir' if index % 2 == 0 else 'read_file'
        out = run(guard, name, {'i': index}, payload='{"ok": true}')
        assert json.loads(out.content) == {'ok': True}
    assert guard.summary()['repeat_blocks'] == 0


def test_generate_then_copy_alternating_is_not_a_loop():
    """出图 → 归档 → 再出图，各步参数都不同，不能判循环（资产图批量生成被误杀过）。"""
    guard = ToolGuard()
    calls = []
    for index in range(8):
        name = 'generate_image' if index % 2 == 0 else 'copy_file'
        args = {'prompt': '镜头' + str(index)} if name == 'generate_image' else {'src': 'a' + str(index), 'dst': 'b' + str(index)}
        out = run(guard, name, args, calls=calls)
        assert json.loads(out.content) == {'ok': True}, name + ' 第 ' + str(index) + ' 步被误拦'
    assert guard.summary()['repeat_blocks'] == 0


def test_failed_results_are_not_cached():
    guard = ToolGuard()
    calls = []
    run(guard, 'generate_image', {'prompt': 'x'}, payload='{"ok": false}', calls=calls)
    run(guard, 'generate_image', {'prompt': 'x'}, payload='{"ok": false}', calls=calls)
    assert calls == ['generate_image', 'generate_image']


def test_long_output_is_truncated():
    guard = ToolGuard(max_output=2000)
    out = run(guard, 'read_file', {'path': 'big.txt'}, payload='x' * 9000)
    payload = json.loads(out.content)
    assert payload['truncated'] is True
    assert len(payload['content']) == 2000
