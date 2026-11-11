"""技能选择归一：@ 只是输入框的快捷方式。

点没点 @、@ 了几个、点完又把技能取消掉、干脆直接写技能名——最后都要收敛成同一份 picks，
否则模型看到的是一串自己看不懂的 @技能名，或者上一句话的技能的配置被配到这一句上。
"""
from types import SimpleNamespace

from app import skills
from app.chat_policy import system_prompt
from app.harness import policy


def table():
    """内置三条的目录表：名字与 id 都是键，跟 skills.index() 的形状一致。"""
    out = {}
    for key, name, topic in (('novel', '小说创作', 'novel'),
                             ('script', '小说转剧本', 'script'),
                             ('storyboard', '剧本转分镜', 'storyboard')):
        entry = {'id': key, 'plugin_id': '', 'name': name, 'topic': topic, 'source': 'builtin'}
        out[key] = entry
        out[name] = entry
    return out


def test_at_token_binds_and_is_stripped():
    picks, clean = skills.request('p', text='@小说创作 把这段写成短篇', table=table())
    assert [p['topic'] for p in picks] == ['novel']
    assert clean == '把这段写成短篇', '界面 token 不能当字面量喂给模型'


def test_two_at_tokens_both_kept_in_written_order():
    picks, clean = skills.request('p', text='@小说创作 @剧本转分镜 先写再拆', table=table())
    assert [p['topic'] for p in picks] == ['novel', 'storyboard']
    assert clean == '先写再拆'


def test_same_skill_twice_is_not_duplicated():
    picks, _ = skills.request('p', text='@小说创作 @小说创作 继续', table=table())
    assert [p['topic'] for p in picks] == ['novel']


def test_plain_name_works_without_at():
    """用户不 @、直接说技能名，也要按技能执行。"""
    picks, clean = skills.request('p', text='用剧本转分镜这个技能拆一下', table=table())
    assert [p['topic'] for p in picks] == ['storyboard']
    assert clean == '用剧本转分镜这个技能拆一下', '正文里的名字是正常指令，不该被剥'


def test_longest_name_wins():
    picks, _ = skills.request('p', text='小说转剧本', table=table())
    assert [p['topic'] for p in picks] == ['script']


def test_chip_and_text_merge_without_duplicates():
    picks, _ = skills.request('p', names=['小说创作'], text='@小说创作 再接着写', table=table())
    assert [p['topic'] for p in picks] == ['novel']


def test_chip_plus_text_gives_two_skills():
    picks, _ = skills.request('p', names=['小说创作'], text='@剧本转分镜 拆开', table=table())
    assert [p['topic'] for p in picks] == ['novel', 'storyboard']


def test_no_skill_is_still_no_skill():
    picks, clean = skills.request('p', text='你好，先介绍一下你能做什么', table=table())
    assert picks == []
    assert clean == '你好，先介绍一下你能做什么'


def test_unknown_at_token_left_alone():
    picks, clean = skills.request('p', text='帮我看看 @某个不存在的技能 的文档', table=table())
    assert picks == []
    assert '@某个不存在的技能' in clean, '不认识的名字原样留着，不能悄悄吃掉'


def test_whole_message_is_one_token():
    picks, clean = skills.request('p', text='@小说创作', table=table())
    assert [p['topic'] for p in picks] == ['novel']
    assert clean == ''


def test_works_against_the_real_catalog():
    """不传表：走真实目录（内置技能 + 项目自定义技能）。"""
    picks, clean = skills.request('skill-selection-project', text='@小说创作 写个开头')
    assert 'novel' in [p['topic'] for p in picks]
    assert clean == '写个开头'


def test_single_selection_matches_legacy_prompt_bytes():
    """单选必须与老行为逐字节相同，不能因为支持多选就把单选的提示词改掉。"""
    legacy = system_prompt('novel', '小说创作')
    picked = system_prompt('novel', '小说创作', selection=[{'name': '小说创作', 'topic': 'novel'}])
    assert legacy == picked


def test_multi_selection_prompt_names_every_topic():
    prompt = system_prompt('novel', '小说创作、剧本转分镜',
                           selection=[{'name': '小说创作', 'topic': 'novel'},
                                      {'name': '剧本转分镜', 'topic': 'storyboard'}])
    assert 'topic=novel' in prompt and 'topic=storyboard' in prompt
    assert '共 2 个' in prompt
    assert '按顺序' in prompt, '多选要讲清谁先谁后'


def test_multi_selection_is_a_skill_run():
    """多技能同样算技能任务：执行档位要按技能给，不能退化成闲聊的 180 秒。"""
    req = SimpleNamespace(skill='', skill_id='', skills=['小说创作', '剧本转分镜'])
    assert policy.profile(req)['name'] == 'skill-delivery'
    assert policy.profile(SimpleNamespace(skill='', skill_id='', skills=[]))['name'] == 'chat'
