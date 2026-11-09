"""子智能体：把一个独立子任务拆成自己的 run。

之前只有一条线：一次用户提交 = 一个 run = 一个 agent，多件事只能排队做。
DSH 的 `dsh-subagent` 让子任务成为独立 run，父 run 只留引用。

这里落地的形态：
- 子 run 有自己的 run_id、自己的 receipt、自己的事件流（同一张 run_events 表）
- 父 run 只在自己的事件流里追加一条 `subagents[]` 记录（run_id + label + 结果摘要）
- 子 agent 的工具集继承父 run，但**去掉 spawn_subagent 本身**，只允许一层嵌套

父 run 不因为子 run 变大而变大：子 run 的 26 个字段、几百条事件全在自己的
run_id 下，需要细节就查 `/agent/executions/{sub_run_id}`。
"""
import asyncio
import json
import time
import uuid

from langchain_core.tools import tool

from app import store

MAX_DEPTH = 1
PARALLEL_LIMIT = 6
DEFAULT_TIMEOUT = 600
SUMMARY_CHARS = 4000


def open_run(project, parent_run_id, task, label='', model='', depth=0):
    """开一个子 run 并落一条初始回执。"""
    run_id = str(uuid.uuid4())
    receipt = {
        'schema_version': 'agent-run/2.0',
        'id': run_id,
        'parent_run_id': parent_run_id,
        'kind': 'subagent',
        'session_id': '',
        'label': label or task[:40],
        'task': task,
        'model': model,
        'depth': depth,
        'status': 'running',
        'started_at': int(time.time() * 1000),
        'evidence_scope': '父 run 继承的工具集与权限档位',
        'steps': [],
        'tools': [],
        'subagents': [],
        'summary': '',
    }
    store.save_run(project, receipt)
    return run_id, receipt


def finish_run(project, receipt, *, status, text, usage=None, error='', artifacts=None):
    receipt['status'] = status
    receipt['finished_at'] = int(time.time() * 1000)
    receipt['duration_ms'] = receipt['finished_at'] - receipt['started_at']
    receipt['summary'] = str(text or '')[:SUMMARY_CHARS]
    if usage:
        receipt['usage'] = {k: usage[k] for k in ('input_tokens', 'output_tokens', 'total_tokens') if k in usage}
    if error:
        receipt['error'] = error
    if artifacts:
        receipt['artifacts'] = artifacts
    store.save_run(project, receipt)
    return receipt


def _text_of(result):
    """把内层 agent 的最终消息压成文本。"""
    messages = []
    if isinstance(result, dict):
        messages = result.get('messages') or []
    elif hasattr(result, 'messages'):
        messages = result.messages or []
    for message in reversed(list(messages)):
        if getattr(message, 'type', '') != 'ai':
            continue
        content = getattr(message, 'content', '')
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [part.get('text', '') for part in content if isinstance(part, dict) and part.get('type') == 'text']
            if parts:
                return ''.join(parts)
    return ''


def _usage_of(result):
    messages = []
    if isinstance(result, dict):
        messages = result.get('messages') or []
    elif hasattr(result, 'messages'):
        messages = result.messages or []
    total = {'input_tokens': 0, 'output_tokens': 0, 'total_tokens': 0}
    found = False
    for message in messages:
        usage = getattr(message, 'usage_metadata', None) or {}
        if not usage:
            continue
        found = True
        for key in total:
            total[key] += int(usage.get(key) or 0)
    return total if found else None


async def execute(*, project, parent_run_id, task, model, tools, system_prompt,
                  label='', depth=0, timeout=DEFAULT_TIMEOUT, create_agent=None):
    """跑一个子 run。返回给父 agent 看的结果，附 run_id 供追溯。"""
    from app import mcp  # noqa: F401  确保异常类型可读

    run_id, receipt = open_run(project, parent_run_id, task, label=label, depth=depth,
                               model=getattr(model, 'model_name', '') or getattr(model, 'model', ''))
    sub_prompt = _prompt(system_prompt, task, depth)
    # 不管调用方传了什么，子 run 里一律拿掉 spawn_subagent：递归只能由
    # build_tools 的 depth 控制，不能靠调用方自觉。
    usable = [item for item in tools
              if getattr(item, 'name', '') not in ('spawn_subagent', 'run_parallel_subagents')]
    started = time.monotonic()
    try:
        graph = create_agent(model=model, tools=usable, middleware=[], system_prompt=sub_prompt)
        result = await asyncio.wait_for(graph.ainvoke({'messages': [{'role': 'user', 'content': task}]}),
                                        timeout=timeout)
    except asyncio.TimeoutError:
        finish_run(project, receipt, status='failed', text='', error='子任务超时（' + str(timeout) + ' 秒）')
        return {'ok': False, 'run_id': run_id, 'error': '子任务超时（' + str(timeout) + ' 秒）'}
    except Exception as exc:
        finish_run(project, receipt, status='failed', text='', error=type(exc).__name__ + ': ' + str(exc))
        return {'ok': False, 'run_id': run_id, 'error': str(exc)}
    text = _text_of(result)
    usage = _usage_of(result)
    finish_run(project, receipt, status='completed' if text else 'failed', text=text,
               usage=usage, error='' if text else '子任务没有产出文本')
    return {'ok': bool(text), 'run_id': run_id, 'label': label or task[:40],
            'summary': text[:SUMMARY_CHARS], 'usage': usage,
            'duration_ms': receipt['duration_ms'],
            'note': '子任务的完整轨迹在 /agent/executions/' + run_id + '，这里只给结论。'}


def _prompt(base, task, depth):
    extra = ('\n【子任务】你是一个独立子智能体，只负责下面这一件事，完成后直接给出可用的结果，不要向用户提问。'
             '\n不要重新规划父任务，也不要处理这件事之外的内容。')
    if depth + 1 >= MAX_DEPTH:
        extra += '\n你不能再派出子智能体，需要拆分的部分自己顺序完成。'
    return (base or '') + extra


def build_tools(*, project, parent_run_id, model, tools, system_prompt, depth=0,
                create_agent, timeout=DEFAULT_TIMEOUT, model_factory=None):
    """生成 spawn_subagent / run_parallel_subagents；到深度上限时返回空列表。"""
    if depth >= MAX_DEPTH:
        return []
    usable = [item for item in tools if item.name not in ('spawn_subagent', 'run_parallel_subagents')]

    def fresh_model():
        # 并行时每个子 run 要自己的模型实例：同一个实例被多个协程同时用，
        # 请求级状态（思考强度、重试计数）会互相污染。
        factory = model_factory or (lambda: model)
        try:
            return factory()
        except Exception:
            return model

    @tool
    async def spawn_subagent(task: str, label: str = '') -> dict:
        """把一个边界清晰的独立子任务交给子智能体完成。

        适合：批量处理同一类文件、多个互不依赖的分析、需要长时间跑又不该占住
        主对话的活儿。任务是独立的一轮，子智能体看不到本轮对话历史，所以 task
        里要写全必要背景。返回子任务的结论与 run_id；细节去 run_id 查。
        """
        return await execute(project=project, parent_run_id=parent_run_id, task=task,
                             model=fresh_model(), tools=usable, system_prompt=system_prompt,
                             label=label, depth=depth + 1, timeout=timeout,
                             create_agent=create_agent)

    @tool
    async def run_parallel_subagents(tasks: list, label: str = '') -> dict:
        """把多个互不依赖的子任务同时交给多个子智能体并行完成。

        tasks 是字符串数组，每项是一条完整、自包含的任务说明（子智能体看不到
        本轮对话）。一次最多 6 个。返回每一项的结论与 run_id；某一项失败不影
        响其它项，各自的状态都在结果里。
        """
        items = [str(item).strip() for item in (tasks or []) if str(item).strip()]
        if not items:
            return {'ok': False, 'error': 'tasks 不能为空'}
        if len(items) > PARALLEL_LIMIT:
            items = items[:PARALLEL_LIMIT]
        runs = await asyncio.gather(*[
            execute(project=project, parent_run_id=parent_run_id, task=task,
                    model=fresh_model(), tools=usable, system_prompt=system_prompt,
                    label=(label + ' ' + str(index + 1)).strip(), depth=depth + 1,
                    timeout=timeout, create_agent=create_agent)
            for index, task in enumerate(items)
        ], return_exceptions=True)
        results = []
        for task, outcome in zip(items, runs):
            if isinstance(outcome, BaseException):
                results.append({'ok': False, 'task': task, 'error': type(outcome).__name__ + ': ' + str(outcome)})
            else:
                results.append({'ok': outcome.get('ok', False), 'task': task,
                                'run_id': outcome.get('run_id'), 'summary': outcome.get('summary'),
                                'error': outcome.get('error', ''), 'duration_ms': outcome.get('duration_ms')})
        return {'ok': any(item['ok'] for item in results), 'count': len(results),
                'succeeded': sum(1 for item in results if item['ok']),
                'items': results,
                'note': '每个子任务的完整轨迹在 /agent/executions/<run_id>，这里只给结论。'}

    return [spawn_subagent, run_parallel_subagents]
