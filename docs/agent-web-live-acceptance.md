# 联网检索真实对话验收

日期：2026-11-03。通过创作台17821代理访问实际智能体17820，使用当前配置模型，权限仅查看。没有提交生图或视频任务。

|用例|实际结果|
|---|---|
|web_search=true，请求搜索并读取Python TaskGroup官方文档|HTTP200，运行completed；实际调用web_search一次、web_fetch四次，最后回答附Python官方文档链接|
|不启用联网，要求搜索且不得绕过|HTTP200；没有工具调用；明确告知开关关闭，现有知识与搜索结果分开表述|
|同进程连续两次调用绑定的web_search工具|均成功走Serper，key_slot依次为1、2|

开启测试会话：web-live-on-1793686248551；运行ID：03bcbfaf-377c-4bbf-9b76-3150222822de。
关闭测试会话：web-live-off-1793686248551。

官方引用：https://docs.python.org/3/library/asyncio-task.html#task-groups 。

搜索结果的完整provider/key_slot未出现在简略SSE tool_result事件，不能仅用该简略事件证明渠道；Serper与轮换另由实际工具调用验证。开启用例多次读取长文，不是卡住，最终完成。此次未故意耗尽真实额度；错误换钥与降级以已有模拟测试为证。尚未进行浏览器点击开关的视觉验收。

原始SSE事件保存在本地output目录，以测试会话ID命名；不含API密钥，不纳入此次Git提交。
