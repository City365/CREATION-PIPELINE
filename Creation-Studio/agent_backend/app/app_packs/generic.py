"""通用助手应用包：证明框架层不绑定创作台。

这个包不声明任何政策段——没有 GenUI 组件规范、没有出图落盘路径、
没有 ask_choice 面板规则、没有 skill_topics。同一个后端切到它，
就是一个普通的问答 / 文件 / 检索助手。

切换方式：
    set WMD_APP_PACK=generic
    （不设或设成 creation-studio 就是原来的创作台，行为不变）
"""
from app.app_packs.base import Pack

PACK = Pack(
    id='generic',
    name='通用助手',
    product='WENYUN.M-DESKTOP',
    forbidden_pipelines='固定工作流',
    policies=[],
    skill_topics={},
    skill_sources=[],
    tool_groups=['workspace', 'web'],
)
