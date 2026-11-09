"""跨轮目标：一条会话里持续存在的「正在做的事」。

现状只有 `checkpoint`——那是**一轮内**的任务计划，run 结束就停在回执里。
用户说「把这本小说做成短剧」这种要跨十几轮的目标，没有地方承载：
下一轮模型只看得到历史消息，不知道自己在为哪个目标服务。

goal 就是补这一层：
- 会话级，一session 最多一个 active
- 每轮把「目标 + 已推进到哪」注入系统提示
- 模型用 set_goal / add_goal_progress / complete_goal 三个工具维护
- 回执里带 `goal`，前端可显示

刻意不复用 plan：plan 是「这一轮怎么走」，goal 是「这些轮为了什么」。
"""
import time
import uuid

from langchain_core.tools import tool

ACTIVE = 'active'
DONE = 'done'
ABANDONED = 'abandoned'

MAX_NOTES = 40
NOTE_CHARS = 500


def _now():
    return int(time.time() * 1000)


def _table(db):
    db.execute('CREATE TABLE IF NOT EXISTS goals (project TEXT NOT NULL, session_id TEXT NOT NULL, '
               'payload TEXT NOT NULL, PRIMARY KEY(project,session_id))')


def _load(project, session_id):
    import json
    from app import store
    with store.connect() as db:
        _table(db)
        row = db.execute('SELECT payload FROM goals WHERE project=? AND session_id=?',
                         (project, session_id)).fetchone()
    return json.loads(row[0]) if row else None


def _save(project, session_id, payload):
    import json
    from app import store
    with store.connect() as db:
        _table(db)
        db.execute('INSERT INTO goals VALUES (?,?,?) ON CONFLICT(project,session_id) DO UPDATE '
                   'SET payload=excluded.payload',
                   (project, session_id, json.dumps(payload, ensure_ascii=False)))


def active(project, session_id):
    """取当前 active 目标；已结束的目标不算，避免过期目标继续注入提示。"""
    goal = _load(project, session_id)
    if not goal or goal.get('status') != ACTIVE:
        return None
    return goal


def current(project, session_id):
    """不管状态，取最后一条记录（前端展示用）。"""
    return _load(project, session_id)


def open_goal(project, session_id, objective, steps=None):
    objective = ' '.join(str(objective or '').split())
    if not objective:
        raise ValueError('目标不能为空')
    previous = _load(project, session_id) or {}
    now = _now()
    goal = {
        'id': previous.get('id') if previous.get('status') == ACTIVE else str(uuid.uuid4()),
        'objective': objective[:800],
        'status': ACTIVE,
        'created_at': previous.get('created_at') if previous.get('status') == ACTIVE else now,
        'updated_at': now,
        'turns': int(previous.get('turns') or 0) if previous.get('status') == ACTIVE else 0,
        'steps': list(steps or [])[:20],
        'notes': list(previous.get('notes') or []) if previous.get('status') == ACTIVE else [],
        'replaced': previous.get('objective') if previous.get('status') == ACTIVE and
                    previous.get('objective') != objective[:800] else None,
    }
    _save(project, session_id, goal)
    return goal


def progress(project, session_id, note):
    goal = active(project, session_id)
    if not goal:
        return None
    text = ' '.join(str(note or '').split())[:NOTE_CHARS]
    if not text:
        return goal
    goal['notes'] = (list(goal.get('notes') or []) + [{'at': _now(), 'text': text}])[-MAX_NOTES:]
    goal['updated_at'] = _now()
    _save(project, session_id, goal)
    return goal


def close(project, session_id, reason='', status=DONE):
    goal = active(project, session_id)
    if not goal:
        return None
    goal['status'] = status if status in (DONE, ABANDONED) else DONE
    goal['closed_at'] = _now()
    goal['updated_at'] = goal['closed_at']
    goal['close_reason'] = ' '.join(str(reason or '').split())[:NOTE_CHARS]
    _save(project, session_id, goal)
    return goal


def bump_turn(project, session_id):
    """每轮开始记一次，用来判断「这个目标拖了多少轮」。"""
    goal = active(project, session_id)
    if not goal:
        return None
    goal['turns'] = int(goal.get('turns') or 0) + 1
    goal['updated_at'] = _now()
    _save(project, session_id, goal)
    return goal


def prompt_block(goal):
    """注入系统提示的那一段。没有目标时返回空串。"""
    if not goal:
        return ''
    lines = ['\n【跨轮目标】用户在这条会话里有一个持续目标，你的每一轮答复都在为它服务：'
             + goal['objective'],
             '已经推进 ' + str(goal.get('turns') or 0) + ' 轮。',
             '这是跨轮目标，不是本轮任务：不要从头重讲方案，也不要重复已经做完的事；'
             '先看历史里做到哪一步，接着往下做。用户明确要求换方向时才用 set_goal 改目标。']
    steps = goal.get('steps') or []
    if steps:
        lines.append('已登记的阶段：' + '；'.join(
            str(step.get('title') or step) + '（' + str(step.get('status') or 'pending') + '）'
            for step in steps[:12]))
    notes = goal.get('notes') or []
    if notes:
        lines.append('最近进展：' + '；'.join(item.get('text', '') for item in notes[-5:]))
    lines.append('这一步是做完了就调用 add_goal_progress 记一条；整个目标确认完成才调用 complete_goal。')
    return '\n'.join(lines)


def build_goal_tools(project, session_id):
    @tool
    def set_goal(objective: str) -> dict:
        """给这条会话设定（或更换）跨轮目标。

        只在用户表达了「要持续做完一件事」时调用，例如「把这本小说做成短剧」。
        一次闲聊、一个孤立的小任务不需要目标。目标会一直注入到之后的每一轮，
        直到 complete_goal 关掉它。
        """
        try:
            goal = open_goal(project, session_id, objective)
        except ValueError as exc:
            return {'ok': False, 'error': str(exc)}
        return {'ok': True, 'goal': goal, 'note': '目标已登记，之后每轮都会带上它。'}

    @tool
    def add_goal_progress(note: str) -> dict:
        """记一条目标进展：刚做完什么、产出了什么文件、下一步准备做什么。

        做完一步就记，不要攒到最后；下一轮靠这些记录知道自己推进到哪。
        """
        goal = progress(project, session_id, note)
        if not goal:
            return {'ok': False, 'error': '当前会话没有进行中的目标，先用 set_goal 建立。'}
        return {'ok': True, 'goal': goal}

    @tool
    def complete_goal(reason: str = '') -> dict:
        """目标全部达成时调用，之后不再注入提示。

        只是这一阶段做完、还要继续时不要调这个，用 add_goal_progress。
        """
        goal = close(project, session_id, reason)
        if not goal:
            return {'ok': False, 'error': '当前会话没有进行中的目标。'}
        return {'ok': True, 'goal': goal}

    return [set_goal, add_goal_progress, complete_goal]
