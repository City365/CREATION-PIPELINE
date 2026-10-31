"""任务补充说明通道：直发不是新任务。

用户在任务执行中「直接发送」时，这句话不是另起一轮，而是**当前运行**的补充说明：
- 落到这条运行独占的有序队列里（先来先处理，不覆盖、不重复）；
- 只在模型调用边界（一次工具安全返回之后、下一次模型决策之前）取走并入上下文，
  绝不会取消任务、不会打断正在跑的工具；
- 取走即标记 applied，同一句只会被并入一次；
- 运行结束时仍未取走的，标记 undelivered 交回前端重新排队，不会静默丢失。
"""
from __future__ import annotations

import threading
import time
import uuid

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import SystemMessage

MAX_TEXT = 6000
MAX_PENDING = 50
ARCHIVE_SECONDS = 1800

BLOCK_HEAD = '【任务补充说明 · 用户在当前任务执行途中追加】'


def _now():
    return int(time.time() * 1000)


def _clock(value):
    try:
        return time.strftime('%H:%M:%S', time.localtime(int(value) / 1000))
    except Exception:
        return ''


class RunChannel:
    """一个运行独占的补充说明队列。"""

    def __init__(self, project, run_id, session_id=''):
        self.project = project
        self.run_id = run_id
        self.session_id = session_id
        self.closed = False
        self.created_at = _now()
        self.notify = None            # 收到补充说明时立刻通知（接当前运行的 SSE）
        self._lock = threading.Lock()
        self._items = []

    # ---- 写入 ----
    def push(self, text, source='ui'):
        body = str(text or '').strip()
        if not body:
            raise ValueError('empty_supplement')
        if len(body) > MAX_TEXT:
            body = body[:MAX_TEXT]
        with self._lock:
            if self.closed:
                raise RuntimeError('run_finished')
            waiting = [x for x in self._items if x['status'] == 'queued']
            if len(waiting) >= MAX_PENDING:
                raise RuntimeError('supplement_overflow')
            item = {'id': 'sp_' + uuid.uuid4().hex[:12], 'text': body, 'time': _now(),
                    'source': source, 'status': 'queued'}
            self._items.append(item)
            position = len(waiting) + 1
            public = {k: item[k] for k in ('id', 'text', 'time', 'status')}
        public['position'] = position
        public['run_id'] = self.run_id
        if self.notify:
            try:
                self.notify(public)
            except Exception:
                pass
        return public

    # ---- 读取（只在模型调用边界调用） ----
    def drain(self):
        """按接收顺序取走全部排队项，并标记 applied：同一条绝不会被并入两次。"""
        with self._lock:
            ready = [x for x in self._items if x['status'] == 'queued']
            stamp = _now()
            for item in ready:
                item['status'] = 'applied'
                item['applied_at'] = stamp
            return [{k: item[k] for k in ('id', 'text', 'time', 'status')} for item in ready]

    def pending(self):
        with self._lock:
            return [{k: item[k] for k in ('id', 'text', 'time', 'status')}
                    for item in self._items if item['status'] == 'queued']

    def snapshot(self):
        with self._lock:
            return {'run_id': self.run_id, 'session_id': self.session_id, 'closed': self.closed,
                    'created_at': self.created_at,
                    'items': [{k: item[k] for k in ('id', 'text', 'time', 'status')} for item in self._items]}

    # ---- 收尾 ----
    def close(self):
        """运行结束：返回还没被取走的补充说明，交给前端重新排队。"""
        with self._lock:
            self.closed = True
            left = [x for x in self._items if x['status'] == 'queued']
            for item in left:
                item['status'] = 'undelivered'
            return [{k: item[k] for k in ('id', 'text', 'time', 'status')} for item in left]


_CHANNELS = {}
_SESSIONS = {}
_LOCK = threading.Lock()


def _prune():
    now = _now()
    for key, channel in list(_CHANNELS.items()):
        if channel.closed and now - channel.created_at > ARCHIVE_SECONDS * 1000:
            _CHANNELS.pop(key, None)


def open_run(project, run_id, session_id=''):
    _prune()
    channel = RunChannel(project, run_id, session_id)
    with _LOCK:
        _CHANNELS[(project, run_id)] = channel
        if session_id:
            _SESSIONS[(project, session_id)] = run_id
    return channel


def channel(project, run_id):
    with _LOCK:
        return _CHANNELS.get((project, run_id))


def live_run(project, session_id):
    """这条会话当前正在跑的那次运行（没有就返回 None → 直发退回普通发送）。"""
    with _LOCK:
        run_id = _SESSIONS.get((project, session_id))
        channel_ = _CHANNELS.get((project, run_id)) if run_id else None
        if channel_ is not None and not channel_.closed:
            return channel_
        if run_id:
            _SESSIONS.pop((project, session_id), None)
        return None


def close_run(project, run_id):
    with _LOCK:
        channel_ = _CHANNELS.get((project, run_id))
        if channel_ is not None and channel_.session_id and _SESSIONS.get((project, channel_.session_id)) == run_id:
            _SESSIONS.pop((project, channel_.session_id), None)
    if channel_ is None:
        return []
    return channel_.close()


def reset():
    """测试用：清空全部运行通道。"""
    with _LOCK:
        _CHANNELS.clear()
        _SESSIONS.clear()


def render(items):
    """把已取走的补充说明渲染成一段可并进系统提示的文本（顺序固定、可重复渲染）。"""
    lines = [BLOCK_HEAD, '以下要求按接收顺序排列，后面的是最新的（有冲突时以后面为准）：']
    for index, item in enumerate(items, 1):
        lines.append('%d. （%s）%s' % (index, _clock(item.get('time')), str(item.get('text') or '').strip()))
    lines.append('处理方式：这是同一个任务的中途追加要求，不是新任务。保留已完成的步骤、中间结果与已生成的文件，'
                 '不要重跑已完成的部分，不要取消任务，也不要推翻已有计划重来；'
                 '按新要求调整剩余步骤后继续执行，并在最终回复里说明「已按补充说明调整了什么」。')
    return '\n'.join(lines)


class SupplementChannel(AgentMiddleware):
    """模型调用边界上的检查点。

    LangChain 的模型调用发生在每次工具返回之后，所以这里天然满足
    「等当前工具安全返回再处理补充说明」：工具执行途中不会被插入任何消息，
    也不会因为补充说明而中断正在进行的操作。
    """

    def __init__(self, channel, publish=None, receipt=None, record=None):
        self.channel = channel
        self.publish = publish
        self.receipt = receipt
        self.record = record
        self.applied = []

    async def awrap_model_call(self, request, handler):
        fresh = []
        for item in self.channel.drain():
            self.applied.append(item)
            fresh.append(item)
            if self.receipt is not None:
                self.receipt.setdefault('supplements', []).append(
                    {'id': item['id'], 'text': item['text'], 'time': item['time'], 'status': 'applied'})
            if self.record:
                try:
                    self.record(item)
                except Exception:
                    pass
        if fresh and self.publish:
            # 只对「这次新并入的」发一次通知，已并入的不会重复播报
            self.publish({'type': 'supplement', 'count': len(fresh), 'time': _now(),
                          'items': [{'id': x['id'], 'text': x['text'], 'time': x['time']} for x in fresh]})
        if self.applied:
            base = getattr(request.system_message, 'content', '') or ''
            base = str(base).split(BLOCK_HEAD)[0].strip()
            system = SystemMessage(content=(base + '\n\n' + render(self.applied)).strip())
            request = request.override(system_message=system)
        return await handler(request)
