"""工具守卫：死循环检测、重复调用去重、工具输出裁剪。

对应 deer-flow 的 LoopDetectionMiddleware + 工具结果裁剪；
本项目没有 LangGraph checkpointer，历史每轮从库里重建，所以「悬空工具调用」不会跨轮出现，
不需要 DanglingToolCallMiddleware（那一层由 `tool_gateway` 的 RunStopped 兜住同轮异常）。

按工具性质分三类，避免"防循环"误伤正常用法：
- POLL      轮询类：同参数重复是正常的（查任务状态），既不去重也不计重复；
- CACHEABLE 昂贵/有副作用的生成类：同参数成功结果缓存复用，防止重复计费或重复提交；
- 其它      读写观察类：每次都真执行（文件系统可能已变）。

循环判定只看「同一工具 + 完全相同的参数」连续出现 5 次：
- 名字相同但参数不同，是正常迭代（写脚本 → 跑脚本 → 改脚本 → 再跑），不算循环；
- 判定只作用于当前这次调用本身，不会因为 run_command 连跑几次就把后面的
  create_workspace_artifact / read_file 一起连坐拦掉；
- 读/观察类工具不参与判定，来回翻文件属于正常探索。
"""
import hashlib, json

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage

from app import spill

MAX_OUTPUT = 24000
# 同一工具 + 同一参数连续多少次算死循环
MAX_REPEAT = 5

POLL = {'check_video_job', 'wait_video_job'}
CACHEABLE = {'generate_image', 'submit_video_job', 'extract_frames', 'describe_image'}
WRITE_LIKE = CACHEABLE | {'write_file', 'make_dir', 'move_file', 'copy_file', 'delete_file', 'run_command'}


def _fingerprint(name, args):
    raw = json.dumps([name, args], ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _content_text(result):
    content = getattr(result, 'content', '')
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return ''.join(part.get('text', '') if isinstance(part, dict) else str(part) for part in content)
    return str(content)


class ToolGuard(AgentMiddleware):
    """legacy 引擎用：生成类去重、轮询类放过、写类防死循环、超长输出裁剪。"""

    def __init__(self, max_repeat=MAX_REPEAT, max_output=MAX_OUTPUT, project='', run_id=''):
        super().__init__()
        self.max_repeat = max(2, int(max_repeat))
        self.max_output = max(2000, int(max_output))
        self.project = project
        self.run_id = run_id
        self.recent = []          # 写/生成类的 (工具名, 参数指纹)
        self.cache = {}
        self.blocked = []
        self.cache_hits = 0
        self.spilled = []         # 超长输出：落盘而不是切掉

    def _loop_reason(self, name, key):
        """只有「这个工具用这套参数」连续重复到上限，才算循环。"""
        if len(self.recent) < self.max_repeat:
            return ''
        tail = self.recent[-self.max_repeat:]
        if all(item == (name, key) for item in tail):
            return ('同一工具「' + name + '」用完全相同的参数连续调用了 '
                    + str(self.max_repeat) + ' 次，已判定为循环并停止执行')
        return ''

    async def awrap_tool_call(self, request, handler):
        call = request.tool_call or {}
        name = call.get('name', '')
        args = call.get('args', {}) or {}
        call_id = call.get('id', '')
        key = _fingerprint(name, args)

        if name in CACHEABLE and key in self.cache:
            self.cache_hits += 1
            reused = self.cache[key]
            return ToolMessage(content=_content_text(reused), tool_call_id=call_id, name=name,
                               status=getattr(reused, 'status', 'success'))

        reason = ''
        if name not in POLL and name in WRITE_LIKE:
            self.recent.append((name, key))
            if len(self.recent) > self.max_repeat * 3:
                self.recent = self.recent[-self.max_repeat * 3:]
            reason = self._loop_reason(name, key)
        if reason:
            self.blocked.append({'tool': name, 'reason': reason})
            return ToolMessage(
                content=json.dumps({'ok': False, 'error': reason + '；请换一种做法，或直接用现有结果回答，不要重复提交。'},
                                   ensure_ascii=False),
                tool_call_id=call_id, name=name, status='error')

        result = await handler(request)
        text = _content_text(result)
        if len(text) > self.max_output:
            # 落盘而不是切掉：模型拿 spill_id 用 read_tool_output 读完全文，
            # 不必为了看后半截重复调用同一个工具。
            content = spill.write(text, project=self.project, run_id=self.run_id, tool=name)
            self.spilled.append({'tool': name, 'characters': len(text)})
            result = result.model_copy(update={'content': content})
            text = content
        failed = getattr(result, 'status', 'success') == 'error'
        if not failed:
            try:
                failed = json.loads(text).get('ok') is False
            except (ValueError, AttributeError):
                pass
        if not failed and name in CACHEABLE:
            self.cache[key] = result
        return result

    def summary(self):
        return {'repeat_blocks': len(self.blocked), 'cache_hits': self.cache_hits,
                'blocked': self.blocked[:5], 'max_repeat': self.max_repeat,
                'spilled': self.spilled[:5], 'spill_count': len(self.spilled)}
