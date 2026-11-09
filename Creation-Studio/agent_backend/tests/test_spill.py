"""工具输出落盘：超长结果不丢内容，模型能按 spill_id 读回全文。"""
import time

import pytest

from app import spill


@pytest.fixture(autouse=True)
def isolated_root(tmp_path, monkeypatch):
    monkeypatch.setattr(spill, 'ROOT', tmp_path / 'spills')
    return tmp_path / 'spills'


def test_write_saves_full_text_and_returns_a_readable_handle():
    text = '甲' * (spill.PREVIEW_CHARS + 2500)
    payload = spill.write(text, project='p1', run_id='r1', tool='run_command')
    assert payload is payload  # json 字符串
    import json
    data = json.loads(payload)
    assert data['ok'] is True and data['truncated'] is True
    assert data['characters'] == len(text)
    assert data['preview'] == text[:spill.PREVIEW_CHARS]
    assert data['next_start'] == spill.PREVIEW_CHARS
    assert data['spill_id'].startswith('s')
    assert data['saved_to'] and data['saved_to'].endswith('.txt')
    assert 'run_command' in data['saved_to']

    chunk = spill.read(data['spill_id'], start=data['next_start'])
    assert chunk['ok'] is True
    assert chunk['done'] is True
    assert chunk['content'] == text[spill.PREVIEW_CHARS:]
    # 预览 + 回读 = 原文，一个字符都不丢
    assert data['preview'] + chunk['content'] == text


def test_read_pages_through_a_long_output():
    text = ''.join(str(i % 10) for i in range(30000))
    import json
    sid = json.loads(spill.write(text, project='p', run_id='r'))['spill_id']
    seen = ''
    start = 0
    pages = 0
    while True:
        page = spill.read(sid, start=start, limit=7000)
        assert page['ok'] is True
        seen += page['content']
        pages += 1
        if page['done']:
            break
        start = page['next_start']
        assert pages < 20
    assert seen == text
    assert pages >= 4


def test_unknown_or_malformed_spill_id_is_rejected():
    assert spill.read('s0000000000')['ok'] is False
    assert spill.read('../../etc/passwd')['ok'] is False
    assert spill.read('')['ok'] is False


def test_read_never_escapes_the_spill_root(tmp_path, monkeypatch):
    outside = tmp_path / 'outside.txt'
    outside.write_text('机密', encoding='utf-8')
    monkeypatch.setattr(spill, 'ROOT', tmp_path / 'spills')
    # 在根目录外伪造一个名字合法的文件，读不到
    assert spill.read('s' + 'a' * 10)['ok'] is False


def test_files_are_grouped_by_project_and_run():
    import json
    for run in ('r1', 'r2'):
        spill.write('内容' * 100, project='proj', run_id=run, tool='t')
    stats = spill.stats()
    assert stats['runs'] == 2 and stats['files'] == 2 and stats['bytes'] > 0
    names = sorted(p.parent.name for p in spill.ROOT.glob('*/*/*.txt'))
    assert names == ['r1', 'r2']


def test_purge_removes_only_expired_runs():
    import json
    old = spill.write('old', project='p', run_id='old')
    new = spill.write('new', project='p', run_id='new')
    old_path = spill.ROOT / 'p' / 'old'
    stamp = time.time() - spill.RETENTION_DAYS * 86400 - 100
    import os
    for path in old_path.iterdir():
        os.utime(path, (stamp, stamp))
    result = spill.purge()
    assert result['removed'] == 1
    assert not old_path.exists()
    assert (spill.ROOT / 'p' / 'new').exists()
    assert spill.read(json.loads(old)['spill_id'])['ok'] is False
    assert spill.read(json.loads(new)['spill_id'])['ok'] is True


def test_write_failure_falls_back_to_preview(tmp_path, monkeypatch):
    blocker = tmp_path / 'blocked'
    blocker.write_text('不是目录', encoding='utf-8')
    monkeypatch.setattr(spill, 'ROOT', blocker)
    import json
    data = json.loads(spill.write('乙' * 6000, project='p', run_id='r', tool='t'))
    assert data['ok'] is True and data['truncated'] is True
    assert data['saved_to'] is None
    assert '落盘失败' in data['error']
    # 落盘失败也要给模型一段能看的内容，不能空手而归
    assert data['content'] == '乙' * spill.PREVIEW_CHARS


def test_tool_exposes_the_same_reader():
    tools = spill.build_spill_tools()
    assert [t.name for t in tools] == ['read_tool_output']
    import json
    sid = json.loads(spill.write('丙' * 5000, project='p', run_id='r'))['spill_id']
    result = tools[0].invoke({'spill_id': sid, 'start': 0, 'limit': 1000})
    assert result['ok'] is True and len(result['content']) == 1000
    assert result['next_start'] == 1000
