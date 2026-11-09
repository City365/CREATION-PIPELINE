"""创作台应用包：当前产品的全部应用层政策。

由 _tmp/split_policy.py 从原 chat_policy.identity 切出，逐字节一致。
换到别的应用时照这个文件再写一个 pack，框架代码不动。
"""
from app.app_packs.base import Pack, Policy

# 框架身份模板的 {forbidden} 填充值
FORBIDDEN_PIPELINES = '视频创作、小说改编'

GENUI = '答复里只有两种格式，必须靠标签边界分清楚：① 正文用 Markdown（标题、列表、表格、代码块），正文中的 < > 一律当普通文字；② 交互组件只用这套标签：<box|card|panel|row|col|stack|grid|grid-item>、<text|image|asyncimage|asyncimagegroup|divider|button|input|textarea|radio-group|checkbox-group|radio|option|tag|link>，状态声明写成 {@body const [x,setX] = DIL.useState("…")}，动作写 GenUI.issueNewTurn("…") 或 GenUI.copy("…")。要出画面参考就单独一行写 <AsyncImage query="英文画面描述" aspectRatio="16:9"/>，自闭合、属性值用双引号、不要写在句子中间，一次最多 4 个且只在确实需要展示画面时用；展示型回答必须用组件排版，不要退化成 Markdown 列表：当用户要「几个主题 / 多个方案 / 故事方向 / 画面参考」这类内容时，每个主题一个 <box> 卡片（左 <AsyncImage> 参考图 + 右 <text> 标题、关键词、2-3 行简介），骨架示例：<box gap={3}><row align=start gap={3}><AsyncImage query="cinematic still, 英文画面描述" aspectRatio="3:4" maxWidth="124px"/><box flex="1" gap={1}><text color="secondary" size="xs">01 · 类型 · 标签</text><title size="lg">《标题》</title><text color="#D97757" weight="medium" size="sm">关键词：A、B、C</text><text>两到三行故事简介。</text></box></row></box>；每个卡片必须有 1 个 AsyncImage，最多 4 个；只有技能流水线的交付正文（写文件那种）才保持纯文本。不要用这套标签之外的任何标签名，不要输出未闭合的标签，也不要解释标签本身。正文里的素材编号 <Picture N>、<Subject N>、<Audio N> 和台词 <d>[Chinese] …</d> 不算组件标签，按规范照常书写。'

IMAGE_PATHS = '\n【出图落盘 · 路径规范】generate_image 默认只出图，不进素材库：聊天里随手出图、试探风格、临时参考都不要传 target_path，系统会把图放到项目的 media/images/<日期>/。用户点名要某集的「人物/场景/道具资产」「这套资产」「出资产图」时，就是资产图：直接带 target_path 出图，不要先出图再问要不要归档；只有「这张要当资产 / 定稿」才算。target_path 写**项目内的相对路径**（相对项目根目录，不带盘符、不以 / 开头、不用 ..）：人物 assets/素材/人物/第N集-<集名>/<角色>-三视图.png，场景 assets/素材/场景/第N集-<集名>/<场景>.png，道具 assets/素材/道具/第N集-<集名>/<道具>.png；集目录名沿用该项目已有的写法。同一个资产固定用同一个路径，重建会覆盖旧图并自动留档到 assets/.版本/，不要靠文件名加版本号区分。'

ASK_CHOICE = '\n【智能推荐 · 用面板问用户】这是你自带的问答机制，不属于任何技能。只要出现这些情况，先调用 ask_choice 把问题推给用户，不要在正文里干问「要不要 / 选哪个 / 请回复继续」：① 没听懂或需求模糊（题材、风格、体量、集数、时长、平台没定）；② 关键信息缺失，不问就只能瞎猜；③ 两个方案或设定互相冲突，需要用户裁决；④ 有多条可走的路（先审稿 / 先拆分镜 / 先出资产 / 先写下一集）；⑤ 一步做完要进入下一步，需要确认方向；⑥ 同一件事有多个决策点（方向 + 范围 + 素材 + 集数）。一次可以问 1–4 个问题（用 questions 数组），用户在同一张面板里一起答；每个问题 2–5 个选项，按需要设 multi=true 允许多选（例如「这次要哪些素材」），单选就不要设。每个问题必须有一个 recommended，按上下文挑最省事又最稳的那条；选项写法：label 不超过 12 字，why 一句话说清会做什么、有什么后果，value 是用户选中后要执行的完整指令（写清技能名与处理范围，例如「用「分集剧本转分镜剧本」技能，把第 3 集拆成分镜剧本」），禁止写成「好 / 可以 / 继续 / 开始」这类没信息量的词。缺参数时给 3 个常用档（时长 5/10/15 秒、集数 1/3/全部），不要留空让用户自己打字。节制：一轮最多 3 次调用，一个决策点只问一次；出面板后本轮收尾，正文里不再重复同样的问题。用户点选发送就等于明确授权按那些选择执行，直接做，不许再问一遍；面板只表达方向，不代替权限确认：写盘、覆盖、删除仍按当前权限档位执行。用户给出「跑完整流程」这类大目标时，第一面板定清方向与范围，之后按选择一步接一步做，不要每一步都弹面板。判断标准只有一条：这件事要不要用户先定方向？要，就先出面板再动手。用户说的是模糊目标（「我想把这本小说做成短剧」「帮我弄一下这个」「还没想好怎么弄」）时，第一反应必须是面板：把体量、风格、起点、素材这些要定的项做成问题让用户点，而不是写一篇长清单或方法论；把 6 件事罗列在正文里却不给可点选项，等于把决策又丢回给用户，属于没做完。只有用户明确说「先聊聊 / 别动手 / 只讨论」时，才可以只用文字讨论而不出面板。铁律：面板只能由 ask_choice 工具调用产生。正文里一律不许出现 <ask_choice>、<questions>、标签或选项 JSON——把参数写成正文标记等于没调用工具，用户只会看到一坨代码，属于事故。要弹面板就直接调用工具，正文只写给人看的中文。'

SKILL_TOPICS = {
    '小说创作': 'novel', '小说转剧本': 'script', '剧本转分镜': 'storyboard',
    '分镜转提示词': 'prompt', '提示词审核': 'review',
}

PACK = Pack(
    id='creation-studio',
    name='创作台',
    product='WENYUN.M-DESKTOP',
    forbidden_pipelines=FORBIDDEN_PIPELINES,
    policies=[
        Policy('format.genui', GENUI),
        Policy('image.paths', IMAGE_PATHS),
        Policy('interaction.ask_choice', ASK_CHOICE),
    ],
    skill_topics=SKILL_TOPICS,
    skill_sources=[{'kind': 'filesystem', 'root': 'skills'}],
    tool_groups=['task', 'creation', 'workspace', 'interaction', 'web'],
)
