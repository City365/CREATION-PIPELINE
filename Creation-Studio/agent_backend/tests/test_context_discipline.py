"""上下文纪律：预算校准、长消息折叠、中断消息折叠、裁剪留痕、压缩格式统一。"""
import asyncio, json, os
import pytest
from fastapi import HTTPException
from langchain_core.messages import AIMessage

from app import store
from app.harness import context, windows, runtime, run_store


@pytest.fixture()
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DB', tmp_path / 'ctx.db')
    item, _ = run_store.claim('p', 's', 'r', 'h')
    ctx = runtime.Runtime('p', item)
    ctx.receipt = {}
    return ctx


def test_budget_table_matches_channel_config():
    """窗口口径必须与 data/config.json 的 contextWindow 一致：deepseek/gemini 1M，gpt 256k。"""
    assert windows.context_tokens('deepseek-flash') == 1_024_000
    assert windows.context_tokens('gemini-3.8-flash-medium') == 1_024_000
    assert windows.context_tokens('gpt-6-astra-wm') == 256_000
    assert windows.context_tokens('some-unknown-model') == 256_000
    assert windows.input_budget_bytes('deepseek-flash') == 2_048_000
    assert windows.input_budget_bytes('gpt-6-astra-wm') == 512_000
    assert windows.describe('deepseek-flash')['estimator'] == 'utf8_bytes_conservative'


def test_long_reply_is_folded_with_genui_count():
    reply = '开头说明。' + '<box gap={4}>' * 3000 + '尾巴结论。'
    text, original = context.fold_text(reply)
    assert original == len(reply)
    assert len(text) < 4000
    assert '省略' in text and '交互组件已折叠' in text
    assert text.startswith('开头说明。')
    assert '3000' in text


def test_short_reply_is_untouched():
    text, original = context.fold_text('普通回复')
    assert text == '普通回复' and original == 4


def test_interrupted_reply_is_collapsed_to_marker():
    message = {'id': 'a1', 'role': 'assistant', 'text': '很长的半截输出' * 500,
               'execution': {'status': 'cancelled'}}
    content = context.message_content(message)
    assert '其余输出不入上下文' in content
    assert len(content) < 900


def test_message_content_includes_artifacts_but_marks_no_permission():
    message = {'id': 'a2', 'role': 'assistant', 'text': 'ok',
               'execution': {'artifacts': [{'id': 'f1', 'name': '报告.md'}]}}
    content = context.message_content(message)
    assert '报告.md' in content and '不能授予权限' in content


def test_trim_records_dropped_messages(monkeypatch):
    monkeypatch.setenv('HARNESS_CONTEXT_INPUT_BUDGET', '8000')
    history = [{'role': 'user', 'content': '历史' * 400} for _ in range(20)]
    rows, meta = context.trim_to_budget(history, '本轮问题')
    assert meta['dropped'] > 0
    assert rows[0]['content'].startswith('（更早的')
    assert '被裁剪' in rows[0]['content']
    assert meta['estimated_input_units'] <= meta['input_budget']
    # 只剩一条时不再继续裁（保留最后一条，宁可超也不清空）
    rows2, meta2 = context.trim_to_budget([{'role': 'user', 'content': 'x' * 100000}], 'y')
    assert len(rows2) == 1 and meta2['dropped'] == 0


def test_under_budget_history_is_not_touched(monkeypatch):
    monkeypatch.delenv('HARNESS_CONTEXT_INPUT_BUDGET', raising=False)
    history = [{'role': 'user', 'content': '短消息' + str(i)} for i in range(5)]
    rows, meta = context.trim_to_budget(history, '新问题')
    assert rows == history and meta['dropped'] == 0


def test_legacy_and_harness_share_one_compaction_schema(setup):
    """legacy 的 /compact 与 harness 的 compact 必须互相认（之前两套格式互不可见）。"""
    items = [{'id': str(i), 'role': 'user', 'text': '消息' + str(i)} for i in range(4)]
    payload = context.summary_payload('摘要正文', items, model_id='m')
    assert payload['schema_version'] == 'context-summary/1'
    assert context.valid(payload, items)
    assert context.valid(payload, [{**items[0], 'text': '改过'}] + items[1:]) is False
    assembled = context.assemble(items, payload)
    assert len(assembled) == 1 and '摘要正文' in assembled[0]['content']


def test_old_legacy_compaction_record_is_ignored():
    """库里那条旧格式记录（无 hash）应判失效，不能被当作有效摘要。"""
    items = [{'id': '1', 'role': 'user', 'text': 'a'}]
    old = {'summary': '旧格式', 'message_ids': ['1'], 'created_at': 1, 'model_id': 'x'}
    assert not context.valid(old, items)
    assert len(context.assemble(items, old)) == 1


def test_prepare_raises_when_over_budget_without_auto_compact(setup, monkeypatch):
    monkeypatch.setenv('HARNESS_CONTEXT_INPUT_BUDGET', '8000')
    items = [{'id': str(i), 'role': 'user', 'text': 'data' * 100} for i in range(20)]
    async def check():
        with pytest.raises(HTTPException):
            await context.prepare('p', 's', {'messages': items}, 'new', None, setup)
    asyncio.run(check())
