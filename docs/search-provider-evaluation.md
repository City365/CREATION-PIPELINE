# Tavily / DDGS 同题检索评估

日期：2026-11-02。本机网络和代理条件；6组中英文相同关键词；每次最多5条；Tavily basic；DDGS默认auto；每批2组并发。只评估返回URL、标题、摘要，未逐页核实正文。不是长期可用率或全网准确率基准。

|关键词|Tavily|DDGS（复测）|人工检查|
|---|---|---|---|
|Python asyncio TaskGroup documentation|1.16秒，成功|3.84秒，成功|两者首条Python官方文档|
|Python official website|1.10秒，成功|15.36秒，DDGSException|Tavily官网第3，3条公司信息无关|
|RunningHub API nodeInfoList 官方文档|1.10秒，成功|9.86秒，DDGSException|Tavily首条官方示例；混入同名跑步公司|
|Tavily search API include_domains documentation|2.30秒，成功|15.72秒，DDGSException|Tavily首条官方最佳实践；混入公司信息|
|deer-flow GitHub 联网搜索 配置|1.45秒，成功|8.23秒，DDGSException|Tavily首条官方仓库issue，非配置正文|
|FFmpeg 视频裁剪 官方文档|2.44秒，成功|11.34秒，DDGSException|Tavily官方文档第3/4，混入财经新闻|

复测Tavily 6/6成功，平均1.59秒；DDGS 1/6成功，另5次明确DDGSException。初轮DDGS存在输出解析失败，不能据此归因为网络超时；已统一UTF-8并完整复测。单独额外复核Python官网时DDGS成功约7.24秒，前5条均python.org；初轮FFmpeg成功约3.94秒且官网排第一。说明DDGS质量有优势样本，但本次稳定性波动大；无法仅凭异常类别确定是限流、网络还是搜索引擎后端问题。Tavily重复请求可能受服务端缓存影响，时间仅作本机观测。

结论：建议Tavily主搜索，DDGS备用，Jina继续读正文。优先官方域名并校验相关性，不能直接采信第一条。未修改智能体的当前搜索渠道，仍为DDGS。本次评估未保存密钥。
