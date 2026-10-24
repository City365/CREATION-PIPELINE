"""创作链路指导文档（小说 → 剧本 → 分镜 → 提示词 → 视频）。

默认内容内置在 DEFAULT_GUIDANCE，运行时可用
`agent_backend/data/guidance.json` 覆盖任意条目（键为 scope / novel /
script / storyboard / prompt / review），这样后续补提示词不用改代码。

文件格式：
{
  "scope": {"title": "…", "content": "…"},
  "novel": {"title": "…", "content": "…"}
}
只覆盖出现的键；缺省键继续使用内置内容。
"""
import json
from pathlib import Path

GUIDANCE_PATH = Path(__file__).resolve().parents[1] / 'data' / 'guidance.json'

DEFAULT_GUIDANCE = {
    'scope': {
        'title': '创作链路与能力边界',
        'content': (
            '这条链路是：小说创作 → 小说转剧本 → 剧本转分镜 → 分镜转视频提示词 → 提示词生成视频。'
            '当前助手负责前四步的文字工作：写小说、改剧本、拆分镜、写视频提示词、做一致性审核；'
            '第五步由视频创作台调用 H3 / 豆包 / Gemini 完成，助手不生成图像或视频。'
            '不能把模型写出的画面当成已生成或已验证的成片；缺参考图、缺音频、缺时长信息时要直接说明。'
            '<Picture N>/<Subject N>/<Audio N> 只能引用用户真实提供的素材编号，缺素材就标注“未提供/待补”，'
            '绝不编造编号。区分“模型建议”和“已核验事实”，不虚构检索、渲染或命令执行。'
        ),
    },
    'novel': {
        'title': '小说创作指引',
        'content': (
            '目标：先写出能被改编的故事，而不是堆设定。'
            '先定三件事：题材与受众、篇幅（短篇/连载章节）、主角最想要什么、最大的阻力是什么。'
            '结构按“钩子—升级—反转—收束”推进，每一节留一个继续读下去的理由；'
            '场景写五感与可拍动作，少写抽象心理；对白承担人物关系和信息释放。'
            '输出：标题 + 一句话 logline + 人物小传（3 行内）+ 分节正文 + 下一节钩子。'
            '用户给一句话或梗概时，先给 2–3 个故事方向，再按选定方向写；不要一次写完整本。'
        ),
    },
    'script': {
        'title': '小说转剧本指引',
        'content': (
            '把小说改成能拍的短剧剧本，先做改编取舍，再写正文。'
            '取舍：删心理描写与旁白，合并功能重复的角色，把关键信息改成动作或对白；保留主线冲突和人物关系。'
            '结构按场拆：场号、地点、时间（日/夜/内/外）、人物、动作、台词、场尾钩子；每场控制在可拍的 15–60 秒。'
            '台词口语化、短句为主，一场只推进一个冲突；动作写成可执行的表演与镜头提示。'
            '输出：标题 + logline + 人物小传 + 分场剧本 + 下一场钩子。'
            '保留原著气质，但不逐句照搬；用户要求集数或总时长时按集拆分。'
        ),
    },
    'storyboard': {
        'title': '剧本转分镜指引',
        'content': (
            '把剧本拆成可生成的分镜，每个分镜最多 9 张参考图、3 段参考音频、最长 15 秒；超过就拆镜。'
            '先给分镜表（镜号 / 时长 / 景别 / 画面内容 / 台词），再给逐镜六段式：'
            '①主体定义（人物外观、场景、关键道具，写清谁是谁）②摘要（一句话讲这一镜发生什么）'
            '③保留分析（从剧本里保留的叙事信息与情绪）④详细描述（[Shot N] 逐镜，含景别、机位、动作、光线；'
            '台词写 <d>[Chinese] …</d>）⑤环境音（风、脚步、环境底噪等）⑥非剧情配乐（情绪与配器）。'
            '素材引用只用真实编号：<Picture N> 对应第 N 张参考图，<Subject N> 对应第 N 个主体，'
            '<Audio N> 对应第 N 段音频；用户没给素材时统一写“素材未提供、编号待补”，不要占位编号。'
            '保持相邻分镜的人物外观、服装、光线和轴线连续。'
        ),
    },
    'prompt': {
        'title': '分镜转视频提示词指引',
        'content': (
            '把分镜改写成视频创作台能直接用的提示词：六段结构（主体定义/摘要/保留分析/详细描述/环境音/非剧情配乐）+ '
            '[Shot N] 镜头 + <d>[Chinese] 台词</d> + 素材引用。'
            '把抽象形容换成可拍的具体动作、景别、光线和声音；一个分镜一个提示词，时长写清楚（≤15 秒）。'
            '输出：可直接粘贴的提示词代码块（每条一个分镜），后面附“素材需求”和“仍需确认”的两行说明。'
            '不改变用户原有故事与人物关系；不确定的地方标注待确认，不编造镜头编号或素材编号。'
        ),
    },
    'review': {
        'title': '分镜 / 提示词审核指引',
        'content': (
            '按清单逐项检查并给出结论：'
            '①六段是否齐全，缺哪段；②时长是否 ≤15 秒，镜头数是否与时长匹配；'
            '③引用是否越界：<Picture N>/<Subject N>/<Audio N> 是否都有真实素材，数量是否超 9 图 3 音频；'
            '④台词格式是否为 <d>[Chinese] …</d>，镜头是否用 [Shot N]；'
            '⑤同一主体在不同分镜的描述是否一致（外观、服装、道具）；⑥平台风险：真实人名、品牌、敏感场景。'
            '输出：可出片 / 需修改（按严重程度排序的问题清单）/ 建议改法。不要替用户编造素材编号。'
        ),
    },
}


def load_guidance():
    docs = {key: dict(value) for key, value in DEFAULT_GUIDANCE.items()}
    try:
        if GUIDANCE_PATH.exists():
            data = json.loads(GUIDANCE_PATH.read_text('utf-8'))
            if isinstance(data, dict):
                for key, value in data.items():
                    if str(key).startswith('_'):
                        continue
                    if isinstance(value, dict) and value.get('title') and value.get('content'):
                        docs[str(key)] = {'title': str(value['title']), 'content': str(value['content'])}
    except Exception:
        # 配置写坏时退回内置文档，不影响服务启动。
        pass
    return docs


GUIDANCE = load_guidance()
TOPICS = tuple(GUIDANCE)
