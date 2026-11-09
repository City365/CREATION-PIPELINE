"""用量与缓存分桶：没有数据就不出百分比。

对齐 DSH `dsh-token-meter` 的口径——「只有每次参与的尝试都报告缓存值，
相应汇总才会出现」。拿部分数据算一个命中率出来，比不显示更糟。
"""
import pytest

from app.harness import run_store
from app.harness.budget import BudgetLedger
from app.harness import runtime


@pytest.fixture
def ledger(tmp_path, monkeypatch):
    from app import store
    monkeypatch.setattr(store, 'DB', tmp_path / 'meter.db')
    payload, _ = run_store.claim('p1', 's', 'meter', 'h')
    ctx = runtime.Runtime('p1', payload)
    ctx.receipt = {}
    return BudgetLedger(ctx)


def usage(**over):
    base = {'input_tokens': 1000, 'output_tokens': 50}
    base.update(over)
    return base


def test_cache_fields_accumulate_across_calls(ledger):
    a = ledger.begin_model()
    ledger.settle(a, usage(input_token_details={'cache_read': 800, 'cache_creation': 20}))
    b = ledger.begin_model()
    ledger.settle(b, usage(input_token_details={'cache_read': 700, 'cache_creation': 10}))
    snap = ledger.publish()
    assert snap['cache_read_tokens'] == 1500
    assert snap['cache_write_tokens'] == 30
    assert snap['cache_complete'] is True
    # 1500 / 2000 总提示词
    assert snap['cache_hit_rate'] == 75.0


def test_cached_tokens_are_part_of_input_not_extra(ledger):
    """input_tokens 在 Anthropic 口径里已含缓存读，命中率分母直接用它。"""
    a = ledger.begin_model()
    ledger.settle(a, usage(input_tokens=1000, input_token_details={'cache_read': 900, 'cache_creation': 0}))
    assert ledger.publish()['cache_hit_rate'] == 90.0


def test_partial_cache_reporting_yields_no_rate(ledger):
    a = ledger.begin_model()
    ledger.settle(a, usage(input_token_details={'cache_read': 500, 'cache_creation': 0}))
    b = ledger.begin_model()
    ledger.settle(b, usage())          # 这次没报缓存明细
    snap = ledger.publish()
    assert snap['cache_complete'] is False
    assert snap['cache_hit_rate'] is None, '缺一次就不能出百分比'
    assert snap['cache_read_tokens'] == 500


def test_no_usage_means_no_rate(ledger):
    a = ledger.begin_model()
    ledger.settle(a, None)
    snap = ledger.publish()
    assert snap['usage_complete'] is False
    assert snap['cache_hit_rate'] is None


def test_zero_input_does_not_divide_by_zero(ledger):
    a = ledger.begin_model()
    ledger.settle(a, {'input_tokens': 0, 'output_tokens': 0,
                      'input_token_details': {'cache_read': 0, 'cache_creation': 0}})
    assert ledger.publish()['cache_hit_rate'] is None


def test_receipt_usage_carries_the_cache_numbers(ledger):
    a = ledger.begin_model()
    ledger.settle(a, usage(input_token_details={'cache_read': 750, 'cache_creation': 5}))
    usage_receipt = ledger.ctx.receipt['usage']
    assert usage_receipt['cache_read_tokens'] == 750
    assert usage_receipt['cache_hit_rate'] == 75.0
    assert usage_receipt['input_tokens'] == 1000
    assert usage_receipt['total_tokens'] == 1050


def test_settle_is_idempotent_per_call(ledger):
    a = ledger.begin_model()
    ledger.settle(a, usage(input_token_details={'cache_read': 600, 'cache_creation': 0}))
    ledger.settle(a, usage(input_token_details={'cache_read': 600, 'cache_creation': 0}))
    snap = ledger.publish()
    assert snap['cache_read_tokens'] == 600
    assert snap['input_tokens'] == 1000
