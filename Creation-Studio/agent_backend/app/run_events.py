"""运行事件流：receipt 是投影结果，事件才是真相。

现状问题：`receipt` 是一个单一 JSON，26 个字段由 stream() 里散落的赋值一点点
填起来。每加一个能力就要动 receipt 的 schema、前端解析和测试三处，这也是
这套系统难以往外扩的根本原因。

这里的做法不是重写，而是**先让写入变成事件**：

    receipt = trace({...})          # 普通 dict 的代理
    receipt['status'] = 'running'   # 自动生成一条 op=set 事件
    project(events_of(receipt))     # 从事件重放出等价结构

`verify(receipt)` 比对「重放结果」与「当前内存里的 receipt」。两者相等，
说明事件流已经足够表达这个 run 的全部状态，下一步才能把 receipt 从
「唯一真相」降级成「读数的缓存」。

开关：WMD_TRACE_RECEIPT=0 关掉（默认开），关掉时 trace() 原样返回普通 dict。
"""
import copy
import os
import time

ENABLE_ENV = 'WMD_TRACE_RECEIPT'


def enabled():
    raw = os.getenv(ENABLE_ENV)
    if raw is None or not str(raw).strip():
        return True
    return str(raw).strip().lower() not in ('0', 'false', 'off', 'no')


def _now():
    return int(time.time() * 1000)


def plain(value):
    """脱掉代理外壳，只留纯 dict / list / 标量，事件里不存外部引用。"""
    if isinstance(value, TracedDict):
        return {k: plain(v) for k, v in dict.items(value)}
    if isinstance(value, TracedList):
        return [plain(v) for v in list.__iter__(value)]
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [plain(v) for v in value]
    return value


class _Log:
    """一次 run 的事件缓冲。不落库，落库是 P0-B 第二阶段的事。"""

    def __init__(self):
        self.items = []
        self.seq = 0
        self.dropped = 0
        self.limit = 20000

    def add(self, op, path, value=None):
        if len(self.items) >= self.limit:
            self.dropped += 1
            return
        self.seq += 1
        event = {'seq': self.seq, 'at': _now(), 'op': op, 'path': list(path)}
        if op != 'del':
            event['value'] = plain(value)
        self.items.append(event)


def _wrap(value, log, path):
    if isinstance(value, TracedDict) or isinstance(value, TracedList):
        return value
    if isinstance(value, dict):
        return TracedDict(value, log, path)
    if isinstance(value, list):
        return TracedList(value, log, path)
    return value


class TracedDict(dict):
    """dict 的写操作代理：每次 set / del 落一条事件。

    emit_init 只在根节点（trace()）为 True：初始值本身要落成事件，
    否则重放出来的是空结构。嵌套容器由携带它的那条 set/append 事件
    带上完整初值，所以内部构造不再重复记录。
    """

    def __init__(self, initial=None, log=None, path=None, emit_init=False):
        super().__init__()
        object.__setattr__(self, '_log', log if log is not None else _Log())
        object.__setattr__(self, '_path', list(path or []))
        for key, value in dict(initial or {}).items():
            wrapped = _wrap(value, self._events, self._path + [key])
            dict.__setitem__(self, key, wrapped)
            if emit_init:
                self._events.add('set', self._path + [key], wrapped)

    # 内部字段不出现在键空间里，json.dumps / deepcopy 都看不见
    @property
    def _events(self):
        return object.__getattribute__(self, '_log')

    def __setitem__(self, key, value):
        wrapped = _wrap(value, self._events, self._path + [key])
        dict.__setitem__(self, key, wrapped)
        self._events.add('set', self._path + [key], wrapped)

    def __delitem__(self, key):
        dict.__delitem__(self, key)
        self._events.add('del', self._path + [key])

    def update(self, other=(), **kw):
        for k, v in dict(other, **kw).items():
            self[k] = v

    def setdefault(self, key, default=None):
        if key not in self:
            self[key] = default
        return dict.__getitem__(self, key)

    def __getitem__(self, key):
        # 取到嵌套容器时顺手包成代理，深层改动才抓得住
        value = dict.__getitem__(self, key)
        if isinstance(value, (dict, list)) and not isinstance(value, (TracedDict, TracedList)):
            value = _wrap(value, self._events, self._path + [key])
            dict.__setitem__(self, key, value)
        return value

    def get(self, key, default=None):
        try:
            return self[key]
        except KeyError:
            return default

    def __deepcopy__(self, memo):
        return plain(self)

    @staticmethod
    def _skip(name):
        return name.startswith('_')

    def __reduce__(self):
        return (dict, (plain(self),))


class TracedList(list):
    """list 的写操作代理：append / set / del 落事件。

    构造时不记事件：初始项由携带这个列表的父级 set/append 事件一并带上。
    """

    def __init__(self, initial=None, log=None, path=None):
        super().__init__()
        object.__setattr__(self, '_log', log if log is not None else _Log())
        object.__setattr__(self, '_path', list(path or []))
        for item in (initial or []):
            list.append(self, _wrap(item, self._events, self._path + [len(self)]))

    @property
    def _events(self):
        return object.__getattribute__(self, '_log')

    def append(self, value):
        index = len(self)
        wrapped = _wrap(value, self._events, self._path + [index])
        list.append(self, wrapped)
        self._events.add('append', self._path, wrapped)

    def extend(self, values):
        for item in values:
            self.append(item)

    def insert(self, index, value):
        self.append(value)

    def __setitem__(self, index, value):
        wrapped = _wrap(value, self._events, self._path + [index])
        list.__setitem__(self, index, wrapped)
        self._events.add('set', self._path + [index], wrapped)

    def __delitem__(self, index):
        list.__delitem__(self, index)
        self._events.add('del', self._path + [index])

    def __getitem__(self, index):
        value = list.__getitem__(self, index)
        if isinstance(value, (dict, list)) and not isinstance(value, (TracedDict, TracedList)):
            if isinstance(index, slice):
                return value
            value = _wrap(value, self._events, self._path + [index])
            list.__setitem__(self, index, value)
        return value

    def __iter__(self):
        for i in range(len(self)):
            yield self[i]

    def __deepcopy__(self, memo):
        return plain(self)

    def __reduce__(self):
        return (list, (plain(self),))


def trace(initial=None):
    """把一次 run 的 receipt 变成可记录事件的结构。"""
    if not enabled():
        return dict(initial or {})
    return TracedDict(initial or {}, emit_init=True)


def events_of(receipt):
    log = getattr(receipt, '_log', None)
    if log is None:
        return []
    return list(log.items)


def stats_of(receipt):
    log = getattr(receipt, '_log', None)
    if log is None:
        return {'events': 0, 'dropped': 0, 'tracked': False}
    return {'events': len(log.items), 'dropped': log.dropped, 'tracked': True}


# ---------------------------------------------------------------- 重放

def _child(next_key):
    return [] if isinstance(next_key, int) else {}


def _descend(cur, key, next_key):
    if isinstance(key, int):
        while len(cur) <= key:
            cur.append(None)
        if cur[key] is None or not isinstance(cur[key], (dict, list)):
            cur[key] = _child(next_key)
        return cur[key]
    if key not in cur or not isinstance(cur[key], (dict, list)):
        cur[key] = _child(next_key)
    return cur[key]


def _set_path(root, path, value):
    cur = root
    for i, key in enumerate(path[:-1]):
        cur = _descend(cur, key, path[i + 1])
    last = path[-1]
    if isinstance(last, int):
        while len(cur) <= last:
            cur.append(None)
        cur[last] = value
        return
    cur[last] = value


def _get_path(root, path):
    cur = root
    for key in path:
        if isinstance(key, int):
            if not isinstance(cur, list) or key >= len(cur):
                return None
            cur = cur[key]
        else:
            if not isinstance(cur, dict) or key not in cur:
                return None
            cur = cur[key]
    return cur


def _del_path(root, path):
    parent = _get_path(root, path[:-1]) if len(path) > 1 else root
    last = path[-1]
    if isinstance(parent, list) and isinstance(last, int) and last < len(parent):
        del parent[last]
    elif isinstance(parent, dict) and last in parent:
        del parent[last]


def project(events):
    """把事件序列重放成一个普通 dict。"""
    root = {}
    for event in events:
        path = event.get('path') or []
        if not path:
            continue
        op = event.get('op')
        if op == 'set':
            _set_path(root, path, copy.deepcopy(event.get('value')))
        elif op == 'append':
            container = _get_path(root, path)
            if not isinstance(container, list):
                container = []
                _set_path(root, path, container)
            container.append(copy.deepcopy(event.get('value')))
        elif op == 'del':
            _del_path(root, path)
    return root


def verify(receipt):
    """比对重放结果与当前 receipt。只用于验收与诊断，不参与业务逻辑。"""
    events = events_of(receipt)
    if not events:
        return {'ok': True, 'events': 0, 'tracked': False, 'diff': []}
    replayed = project(events)
    actual = plain(receipt)
    diff = []
    for key in sorted(set(replayed) | set(actual)):
        a = replayed.get(key, '<missing>')
        b = actual.get(key, '<missing>')
        if a != b:
            diff.append({'key': key, 'replayed': _short(a), 'actual': _short(b)})
    dropped = stats_of(receipt).get('dropped', 0)
    return {'ok': not diff and not dropped, 'events': len(events), 'tracked': True,
            'diff': diff[:8], 'dropped': dropped, 'truncated': bool(dropped)}


def _short(value):
    text = repr(value)
    return text if len(text) <= 200 else text[:200] + '…'
