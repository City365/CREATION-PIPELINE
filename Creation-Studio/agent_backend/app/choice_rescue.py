"""把模型「写成正文」的选择题救回成真正的面板。

背景：ask_choice 是工具，正常调用会走工具通道推一个 choice 事件。但小模型偶尔会把工具调用
写成正文标记（`<ask_choice><questions>[…]</questions></ask_choice>`），用户就看到一坨原始 JSON。
这里做两件事：把这段标记从正文里剥掉，并按同样的结构补发一次 choice 事件。
"""
from __future__ import annotations

import json
import re
import time
import uuid

from app.interaction_tools import normalize_questions

WRAPPED = re.compile(r'<ask_choice\b[^>]*>(.*?)</ask_choice\s*>', re.S | re.I)
UNCLOSED = re.compile(r'<ask_choice\b[^>]*>.*$', re.S | re.I)
QUESTIONS_BLOCK = re.compile(r'<questions>(.*?)</questions>', re.S | re.I)
TAG_NOISE = re.compile(r'</?ask_choice\b[^>]*>|</?questions>|</?question>|</?options>|</?[｜|]DSML[｜|][^>]*>', re.I)


def _load(text):
    """尽量把模型写的 JSON 读出来；读不出就返回 None。"""
    blob = str(text or '').strip()
    if not blob:
        return None
    candidates = [blob]
    fenced = re.search(r'```(?:json)?\s*(.+?)```', blob, re.S)
    if fenced:
        candidates.insert(0, fenced.group(1).strip())
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except Exception:
            pass
        fixed = re.sub(r',\s*([}\]])', r'\1', candidate)
        if fixed != candidate:
            try:
                return json.loads(fixed)
            except Exception:
                pass
    return None


def _first_json(blob):
    """从夹杂说明文字的片段里找出第一个能解析的 JSON 数组或对象。"""
    text = str(blob or '')
    parsed = _load(text)
    if parsed is not None: return parsed
    text = re.sub(r',\s*([}\]])', r'\1', text)
    decoder = json.JSONDecoder()
    for match in re.finditer(r'[\[{]', text):
        try:
            parsed, _ = decoder.raw_decode(text[match.start():])
            if isinstance(parsed, (list, dict)): return parsed
        except ValueError:
            pass
    for start, end in (('[', ']'), ('{', '}')):
        first, last = text.find(start), text.rfind(end)
        if first >= 0 and last > first:
            parsed = _load(text[first:last + 1])
            if parsed is not None: return parsed
    return None


def _as_questions(payload):
    if isinstance(payload, dict):
        if isinstance(payload.get('questions'), list):
            return payload['questions']
        if payload.get('question') or payload.get('options'):
            return [payload]
        return None
    return payload if isinstance(payload, list) else None


def extract(text):
    """返回 (清理后的正文, questions 原始结构 或 None)。"""
    body = str(text or '')
    if not body:
        return body, None
    raw_questions = None
    inner = None
    stripped = False
    wrapped = WRAPPED.search(body)
    if wrapped:
        inner = wrapped.group(1)
        body = WRAPPED.sub('', body)
        stripped = True
    elif re.search(r'<ask_choice\b[^>]*>', body, re.I):
        position = re.search(r'<ask_choice\b[^>]*>', body, re.I).start()
        inner = body[position:]
        body = UNCLOSED.sub('', body)
        stripped = True
    if inner is not None:
        block = QUESTIONS_BLOCK.search(inner)
        raw_questions = _as_questions(_load(block.group(1)) if block else None)
        if raw_questions is None:
            raw_questions = _as_questions(_first_json(inner))
    if raw_questions is None:
        block = QUESTIONS_BLOCK.search(body)
        if block:
            raw_questions = _as_questions(_load(block.group(1)) or _first_json(block.group(1)))
            body = QUESTIONS_BLOCK.sub('', body)
            stripped = True
    if raw_questions is None and not stripped:
        return str(text or ''), None
    body = TAG_NOISE.sub('', body)
    body = re.sub(r'\n{3,}', '\n\n', body).strip()
    return body, raw_questions


def build_event(raw_questions, allow_text=True):
    questions = normalize_questions(raw_questions)
    if not questions:
        return None
    event = {
        'type': 'choice',
        'id': 'ch_' + uuid.uuid4().hex[:12],
        'questions': questions,
        'allow_text': bool(allow_text),
        'auto_seconds': 0,
        'time': int(time.time() * 1000),
        'rescued': True,
    }
    if len(questions) == 1:
        event['question'] = questions[0]['question']
        event['options'] = questions[0]['options']
        event['multi'] = questions[0]['multi']
    return event


def rescue(text, already_asked=False):
    """主入口：返回 (正文, choice 事件或 None)。

    already_asked=True 表示本轮工具已经弹过面板，这时只剥标记、不再重复补发。
    """
    body, raw_questions = extract(text)
    if raw_questions is None:
        return body, None
    if already_asked:
        return body, None
    event = build_event(raw_questions)
    if event is None:
        return body, None
    return body, event


def public_text(text):
    """Suppress serialized tool syntax while streaming, retaining raw text for rescue."""
    body, _ = extract(text)
    body = re.sub(r'<[｜|]DSML[｜|][\s\S]*$', '', body)
    body = re.sub(r'<(?:ask_choice|questions)\b[\s\S]*$', '', body, flags=re.I)
    return body
