"""工具调用策略：一份语义，两个引擎共用。

legacy 走 `ToolGuard`，harness 走 `ToolGateway`。两边各写一套的后果不是风格问题，
是行为不一致：
- 该复用的生成请求被重复计费；
- 更糟的是 `run_command` 被当成可缓存——改完脚本重跑同一条命令，第二次直接
  返回上一次的输出，根本没执行。模型会拿着旧结果当新结果用。

所以分类只在这里定义一次。四类：

| 类别 | 判定 | 行为 |
|---|---|---|
| poll | 轮询现状（查任务状态） | 同参数重复是正常的，不拦不缓存 |
| cacheable | 昂贵且有副作用（出图 / 提交视频 / 抽帧 / 看图） | 同参数成功结果复用，防重复计费 |
| write | 会改磁盘或跑命令 | 每次都真执行，只防「同参数连续 N 次」的死循环 |
| read | 观察类（列目录 / 读文件 / 检索） | 每次都真执行，来回翻文件属于正常探索 |

`run_command` 属于 write 而不是 cacheable：脚本迭代就是「写脚本 → 跑 → 改 → 再跑」，
同一条命令必须真的再跑一次。
"""
import hashlib
import json

POLL = {'check_video_job', 'wait_video_job'}
# 只有「同参数重跑结果一样」的才进这里。边界很清楚：
#   - 生成类：重复调用会重复计费，必须复用
#   - 交付类（写文件 / 登记文件）：同参数同内容，幂等，复用省事
# 不在这里的 write 类一律每次真执行：delete_file / move_file / copy_file 同参数
# 第二次本来该失败，复用旧「成功」是把失败瞒报成成功；run_command 则是脚本迭代
# 必须真的跑（写脚本 → 跑 → 改 → 再跑）。
CACHEABLE = {'generate_image', 'submit_video_job', 'extract_frames', 'describe_image',
             'create_workspace_artifact', 'publish_artifact'}

LOOP_LIMIT = 5     # 同工具 + 同参数连续多少次算循环
KEEP_HISTORY = 3   # 保留最近多少倍 LOOP_LIMIT 的调用记录

WRITE_RISKS = ('workspace_write', 'media_write', 'fs_write', 'shell')


def kind(name, risk=''):
    if name in POLL:
        return 'poll'
    if name in CACHEABLE:
        return 'cacheable'
    if risk in WRITE_RISKS:
        return 'write'
    return 'read'


def is_cacheable(name):
    return name in CACHEABLE


def fingerprint(name, args):
    raw = json.dumps([name, args], ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def is_loop(history, name, key, limit=LOOP_LIMIT):
    """同工具 + 完全相同的参数连续 limit 次才算循环。

    名字相同但参数不同是正常迭代，不算。
    """
    if len(history) < limit:
        return False
    tail = history[-limit:]
    return all(item == (name, key) for item in tail)


def loop_reason(name, limit=LOOP_LIMIT):
    return ('同一工具「' + name + '」用完全相同的参数连续调用了 ' + str(limit)
            + ' 次，已判定为循环并停止执行；请换一种做法，或直接用现有结果回答。')
