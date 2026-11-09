"""应用包结构：框架层与应用层的唯一契约。

框架代码只认 Pack 里这几个字段，不认识任何领域词。
换应用 = 换一个 pack 模块（或改配置指向另一个 id），框架代码不动。
"""
from dataclasses import dataclass, field


@dataclass
class Policy:
    """应用层政策段：一段可以整体开关的提示词正文。

    id 给配置 / 测试引用，text 是原样拼进系统提示的词。
    关掉一个政策，对应能力从提示里消失，但框架代码不需要改。
    """
    id: str
    text: str
    enabled: bool = True


@dataclass
class Pack:
    """一个应用的全部可变部分。"""
    id: str
    name: str
    # 产品名，填进框架身份模板的 {product}
    product: str
    # 不该被误当流水线的领域词，填进 {forbidden}
    forbidden_pipelines: str = '其他固定流程'
    # 应用层政策段，按列表顺序拼进系统提示
    policies: list = field(default_factory=list)
    # 技能名 → topic，决定 read_analysis_guidance 读哪份正文
    skill_topics: dict = field(default_factory=dict)
    # 技能来源声明：{'kind': 'filesystem', 'root': 'skills'} 等
    skill_sources: list = field(default_factory=list)
    # 该应用挂哪些工具组
    tool_groups: list = field(default_factory=list)
    # 外部工具服务器（MCP）：{'name','command','args','env','cwd','timeout'}。
    # 框架只认这个结构，不关心具体是哪个 server。
    mcp_servers: list = field(default_factory=list)

    def policy_texts(self):
        return [p.text for p in self.policies if p.enabled]

    def policy(self, pid):
        for p in self.policies:
            if p.id == pid:
                return p
        return None

    def envelope(self):
        """给前端 / 诊断接口看的最小描述。"""
        return {
            'id': self.id,
            'name': self.name,
            'product': self.product,
            'policies': [{'id': p.id, 'enabled': p.enabled, 'chars': len(p.text)}
                         for p in self.policies],
            'skill_topics': dict(self.skill_topics),
            'skill_sources': list(self.skill_sources),
            'tool_groups': list(self.tool_groups),
            'mcp_servers': [str(item.get('name') or '') for item in self.mcp_servers],
        }
