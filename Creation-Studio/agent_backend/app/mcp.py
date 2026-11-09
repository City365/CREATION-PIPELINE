"""MCP 客户端：把外部工具服务器接进同一套工具注册表。

DSH 的 `dsh-mcp-client` 让 harness 不只吃内置工具，还能接任何说 MCP 的服务。
我们之前是「工具全部写死在 build_*_tools 里」，加一个外部能力就要改后端代码。

这里实现最小但完整的 MCP 客户端：
- 传输：stdio（本地子进程），换行分隔的 JSON-RPC 2.0
- 握手：initialize → notifications/initialized → tools/list
- 调用：tools/call，结果压成文本
- 包装：每个 MCP 工具变成普通 LangChain 工具，名字 mcp__<server>__<tool>

进程生命周期：按 server 名复用常驻子进程，atexit 统一关。握手与 tools/list
结果缓存 5 分钟，避免每轮都重启子进程。任何一步失败都只是「这个 server 不可用」，
不影响 agent 启动。
"""
import atexit
import json
import os
import queue
import shutil
import subprocess
import threading
import time

CACHE_TTL = 300          # tools/list 缓存秒数
DEFAULT_TIMEOUT = 30
MAX_RESULT_CHARS = 60000

_SERVERS = {}            # name -> Server
_LOCK = threading.Lock()

# 上一次 build_mcp_tools 的失败清单，供 receipt / 诊断读
LAST_FAILURES = []


class McpError(RuntimeError):
    pass


class Server:
    """一个 stdio MCP 服务器进程。"""

    def __init__(self, config):
        self.name = str(config.get('name') or '').strip()
        self.command = str(config.get('command') or '').strip()
        self.args = [str(a) for a in (config.get('args') or [])]
        self.env = {**os.environ, **{str(k): str(v) for k, v in (config.get('env') or {}).items()}}
        self.cwd = config.get('cwd') or None
        self.timeout = float(config.get('timeout') or DEFAULT_TIMEOUT)
        self.proc = None
        self._id = 0
        self._lock = threading.Lock()
        self._lines = None
        self._pump = None
        self.tools = []
        self.discovered_at = 0.0

    # -- 进程 ---------------------------------------------------------
    def alive(self):
        return self.proc is not None and self.proc.poll() is None

    def start(self):
        if self.alive():
            return self
        if not self.name or not self.command:
            raise McpError('MCP 服务器缺少 name 或 command')
        resolved = shutil.which(self.command) or self.command
        with self._lock:
            try:
                self.proc = subprocess.Popen(
                    [resolved, *self.args], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, text=True, encoding='utf-8', cwd=self.cwd,
                    env=self.env, bufsize=1)
            except OSError as exc:
                raise McpError('MCP 服务器「' + self.name + '」启动失败：' + str(exc))
        # 读管道必须独立线程：readline() 会阻塞，超时就只能靠猜时间。
        self._lines = queue.Queue()
        self._pump = threading.Thread(target=self._pump_stdout, args=(self.proc,), daemon=True)
        self._pump.start()
        self._handshake()
        return self

    def _pump_stdout(self, proc):
        try:
            for line in proc.stdout:
                self._lines.put(line)
        except Exception:
            pass
        finally:
            self._lines.put(None)

    def close(self):
        with self._lock:
            proc, self.proc = self.proc, None
        if not proc:
            return
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    # -- JSON-RPC -----------------------------------------------------
    def _send(self, payload):
        proc = self.proc
        if not proc or proc.poll() is not None:
            raise McpError('MCP 服务器「' + self.name + '」已退出')
        try:
            proc.stdin.write(json.dumps(payload, ensure_ascii=False) + '\n')
            proc.stdin.flush()
        except (BrokenPipeError, ValueError) as exc:
            raise McpError('MCP 服务器「' + self.name + '」写入失败：' + str(exc))

    def _read_reply(self, want_id):
        """读到 id 匹配的那条响应为止；通知与无关消息直接跳过。"""
        deadline = time.monotonic() + self.timeout
        while True:
            remain = deadline - time.monotonic()
            if remain <= 0:
                raise McpError('MCP 服务器「' + self.name + '」响应超时')
            try:
                line = self._lines.get(timeout=remain)
            except queue.Empty:
                raise McpError('MCP 服务器「' + self.name + '」响应超时')
            if line is None:
                raise McpError('MCP 服务器「' + self.name + '」断开（退出码 '
                               + str(self.proc.poll() if self.proc else '?') + '）')
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if message.get('id') != want_id:
                continue
            if 'error' in message:
                error = message['error'] or {}
                raise McpError(str(error.get('message') or error))
            return message.get('result') or {}

    def request(self, method, params=None):
        with self._lock:
            self._id += 1
            want = self._id
            self._send({'jsonrpc': '2.0', 'id': want, 'method': method, 'params': params or {}})
            return self._read_reply(want)

    def notify(self, method, params=None):
        with self._lock:
            self._send({'jsonrpc': '2.0', 'method': method, 'params': params or {}})

    def _handshake(self):
        self.request('initialize', {
            'protocolVersion': '2024-11-05',
            'capabilities': {'tools': {}},
            'clientInfo': {'name': 'creation-studio-agent', 'version': '1.0'},
        })
        self.notify('notifications/initialized')

    # -- 能力 ---------------------------------------------------------
    def list_tools(self, force=False):
        if not force and self.tools and time.monotonic() - self.discovered_at < CACHE_TTL:
            return self.tools
        result = self.request('tools/list', {})
        self.tools = [item for item in (result.get('tools') or []) if item.get('name')]
        self.discovered_at = time.monotonic()
        return self.tools

    def call(self, tool, arguments):
        return self.request('tools/call', {'name': tool, 'arguments': arguments or {}})


def text_of(result):
    """把 MCP 的 content 数组压成文本；同时暴露非文本块的类型。"""
    parts = []
    kinds = []
    for block in (result.get('content') or []):
        if not isinstance(block, dict):
            parts.append(str(block))
            continue
        kind = block.get('type')
        kinds.append(kind)
        if kind == 'text':
            parts.append(block.get('text') or '')
        elif kind == 'image':
            parts.append('[图片 ' + str(block.get('mimeType') or '') + '，未内联]')
        elif kind == 'resource':
            resource = block.get('resource') or {}
            parts.append(str(resource.get('text') or resource.get('uri') or '[资源]'))
        else:
            parts.append(json.dumps(block, ensure_ascii=False))
    if parts:
        text = '\n'.join(parts)
    else:
        text = json.dumps(result, ensure_ascii=False) if result else ''
    return text, kinds


def get(name):
    with _LOCK:
        return _SERVERS.get(name)


def server_for(config):
    """取（或创建）一个 server 实例并确保已握手；失败抛 McpError。"""
    name = str(config.get('name') or '').strip()
    if not name:
        raise McpError('MCP 服务器缺少 name')
    with _LOCK:
        server = _SERVERS.get(name)
        if server is None:
            server = Server(config)
            _SERVERS[name] = server
    return server.start()


def probe(config):
    """探活：能握手就返回工具清单。给诊断接口用。"""
    try:
        server = server_for(config)
        tools = server.list_tools(force=True)
        return {'name': server.name, 'ok': True, 'tools': len(tools),
                'items': [t.get('name') for t in tools]}
    except Exception as exc:
        return {'name': str(config.get('name') or ''), 'ok': False, 'error': str(exc)}


def shutdown():
    with _LOCK:
        servers = list(_SERVERS.values())
        _SERVERS.clear()
    for server in servers:
        server.close()


atexit.register(shutdown)


def _args_model(props, required, name):
    """把 MCP 的 JSON Schema 收敛成 pydantic 模型，让模型看到真实参数。"""
    from pydantic import ConfigDict, create_model

    types = {'string': str, 'integer': int, 'number': float, 'boolean': bool,
             'array': list, 'object': dict}
    fields = {}
    for key, value in (props or {}).items():
        if not isinstance(key, str) or not key.isidentifier():
            continue
        spec = value if isinstance(value, dict) else {}
        annotation = types.get(str(spec.get('type') or ''), str)
        optional = str(spec.get('type') or '') in ('integer', 'number', 'boolean')
        if key in (required or []):
            fields[key] = (annotation, ...)
        elif 'default' in spec:
            fields[key] = (annotation, spec['default'])
        else:
            fields[key] = (annotation if optional else str, None)
    if not fields:
        # 不能返回 None：harness 的 ToolGateway 要读 t.args_schema.model_json_schema()，
        # 无参工具按 MCP 规范就是 properties 为空。给一个空模型，而不是留 None。
        return create_model(name + 'Args', __config__=ConfigDict(extra='allow'))
    return create_model(name + 'Args', __config__=ConfigDict(extra='allow'), **fields)


def _make_tool(server, config, item, project, run_id, publish):
    from langchain_core.tools import StructuredTool
    from app import spill

    mcp_name = item.get('name')
    full = 'mcp__' + server.name + '__' + mcp_name
    schema = item.get('inputSchema') or item.get('input_schema') or {}
    props = (schema.get('properties') or {}) if isinstance(schema, dict) else {}
    required = (schema.get('required') or []) if isinstance(schema, dict) else []
    description = str(item.get('description') or (server.name + ' 提供的 ' + mcp_name))

    def call(**kwargs):
        arguments = {k: v for k, v in kwargs.items() if v is not None}
        started = time.monotonic()
        try:
            result = server.call(mcp_name, arguments)
        except Exception as exc:
            if publish:
                publish({'type': 'tool', 'tool': full, 'status': 'error', 'error': str(exc),
                         'duration_ms': round((time.monotonic() - started) * 1000),
                         'source': 'mcp', 'server': server.name})
            return {'ok': False, 'error': str(exc), 'server': server.name, 'tool': mcp_name}
        text, kinds = text_of(result)
        duration = round((time.monotonic() - started) * 1000)
        ok = not result.get('isError', False)
        if publish:
            publish({'type': 'tool', 'tool': full, 'status': 'ok' if ok else 'error',
                     'duration_ms': duration, 'source': 'mcp', 'server': server.name,
                     'mcp_tool': mcp_name})
        if ok and len(text) > MAX_RESULT_CHARS:
            # 超长结果走落盘，和内置工具一致
            text = spill.write(text, project=project, run_id=run_id, tool=full)
        return {'ok': ok, 'server': server.name, 'tool': mcp_name, 'content': text,
                'kinds': kinds, 'duration_ms': duration}

    call.__name__ = full
    call.__doc__ = description
    tool = StructuredTool(
        name=full, description=description, func=call,
        args_schema=_args_model(props, required, full),
        metadata={'source': 'mcp', 'server': server.name, 'mcp_tool': mcp_name})
    return tool


def build_mcp_tools(configs, project='', run_id='', publish=None):
    """把配置里的 MCP 服务器工具包成 LangChain 工具。

    单个 server 起不来只丢它自己的工具，不抛异常——外部服务不该拖垮主流程。
    失败清单写进 LAST_FAILURES，供 receipt 与诊断读。
    """
    global LAST_FAILURES
    tools = []
    failures = []
    for config in (configs or []):
        if not isinstance(config, dict):
            continue
        name = str(config.get('name') or '').strip()
        if not name:
            continue
        try:
            server = server_for(config)
            available = server.list_tools()
        except Exception as exc:
            failures.append({'name': name, 'error': str(exc)})
            continue
        for item in available:
            try:
                tools.append(_make_tool(server, config, item, project, run_id, publish))
            except Exception as exc:
                failures.append({'name': name, 'tool': item.get('name'), 'error': str(exc)})
    LAST_FAILURES = failures
    return tools
