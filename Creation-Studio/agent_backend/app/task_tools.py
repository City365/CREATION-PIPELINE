"""Safe task orchestration tools. No business database, shell or deployment access."""
import threading
from copy import deepcopy
from langchain_core.tools import tool
from app.execution import tick
from app.creation_guidance import GUIDANCE, TOPICS

def build_task_tools(receipt, question, publish, available_sources, project=None, session_id=None, skill_snapshot=None, allowed_topics=None):
    lock=threading.RLock()
    available_sources['user_input']={'id':'user_input','title':'本轮用户指令','kind':'user_input','content':question}
    @tool
    def create_task_plan(goal: str, steps: list[dict[str,str]]) -> dict:
        """制定本轮任务计划。steps 为 1 到 5 项，每项包含 id、title、purpose。首次必须先制定计划；简单问题只需一步。"""
        with lock:
            if receipt.get('plan'):return {'ok':False,'error':'计划已存在，请执行已有步骤'}
            if not 1<=len(steps)<=5:return {'ok':False,'error':'需要 1 到 5 个步骤'}
            ids=[s.get('id','') for s in steps]
            if not all(ids) or any(len(i)>80 for i in ids) or len(set(ids))!=len(ids):return {'ok':False,'error':'步骤 id 不能为空且必须唯一'}
            if any(not s.get('title') or not s.get('purpose') for s in steps):return {'ok':False,'error':'每步需要 title 和 purpose'}
            receipt['plan']={'goal':goal[:500],'steps':[{'id':s['id'][:80],'title':s['title'][:150],'purpose':s['purpose'][:600],'status':'pending','output':'','evidence':[]} for s in steps]}
            publish({'type':'process','plan':deepcopy(receipt['plan'])})
            return {'ok':True,'plan':receipt['plan']}
    guidance_desc = '读取创作指导说明。可用 topic：%s。返回文档内容及可引用的 source_id。' % (
        '、'.join(sorted({str(t) for t in (allowed_topics or ()) if t})) or '（本会话没有可用技能）')
    @tool(description=guidance_desc)
    def read_analysis_guidance(topic: str) -> dict:
        """读取创作指导说明，返回文档内容及可引用的 source_id。"""
        if allowed_topics is not None and topic not in allowed_topics:
            return {'ok': False, 'error': '用户未选择该技能，不能读取其执行指导'}
        doc=GUIDANCE.get(topic)
        if project and topic.startswith('skill:'):
            from app.workspace import plugins
            if skill_snapshot is not None:
                plugin=next((p for p in skill_snapshot if 'skill:'+p['id']==topic),None)
                if plugin:doc={'title':plugin['name'],'content':plugin['instructions']}
            else:
                plugin=next((p for p in plugins(project,'skill') if p['enabled'] and 'skill:'+p['id']==topic),None)
                if plugin:doc={'title':plugin['name'],'content':str(plugin['config'].get('instructions',''))}
        if not doc:return {'ok':False,'error':'未知主题，可选 '+ '、'.join(TOPICS)}
        source={'id':'guidance:'+topic,'kind':'guidance',**doc}
        with lock:available_sources[source['id']]=source
        return {'ok':True,'source_id':source['id'],'title':source['title'],'content':source['content']}
    @tool
    def record_step_result(step_id: str, output: str, source_ids: list[str], status: str='completed') -> dict:
        """记录计划步骤的实际产出与来源。output 是面向用户的结论或待核验事项，不是内部思维链。source_ids 只能引用 user_input、已经读取的指导文档或工作空间工具返回的 source_id。无业务工具，不得声称已计算业务数据。status 可为 completed 或 blocked。"""
        with lock:
            step=next((s for s in receipt.get('plan',{}).get('steps',[]) if s['id']==step_id),None)
            if not step:return {'ok':False,'error':'步骤不在计划中，请先制定有效计划'}
            if step['status']=='completed':return {'ok':False,'error':'该步骤已完成，请继续下一步或总结'}
            if not output.strip() or len(output)>6000:return {'ok':False,'error':'需要非空产出，最多 6000 字'}
            if not source_ids or any(i not in available_sources for i in source_ids):return {'ok':False,'error':'只能引用本轮确实存在的来源，必须包含至少一项'}
            if status not in ('completed','blocked'):return {'ok':False,'error':'状态应为 completed 或 blocked'}
            step.update(status=status,output=output,evidence=[available_sources[i].copy() for i in dict.fromkeys(source_ids)],evidence_type='assistant_analysis',finished_at=tick())
            publish({'type':'process','plan':receipt['plan']})
            return {'ok':True,'step_id':step_id,'status':status,'output':output,'source_ids':source_ids,'remaining':[s['id'] for s in receipt['plan']['steps'] if s['status']=='pending'],'note':'这是模型基于引用材料的分析产出，不是业务数据计算结果'}
    @tool
    def search_workspace_documents(query: str) -> dict:
        """检索当前对话附件和项目知识库的全文索引。返回 file_id、来源编号和匹配片段；图片未识别时只包含文件名，不能推断图中内容。"""
        from app.workspace import search_documents
        results=search_documents(project,session_id,query)
        with lock:
            for row in results:available_sources[row['source_id']]={'id':row['source_id'],'kind':'workspace','title':row['name'],'content':row['snippet'],'file_id':row['file_id']}
        return {'ok':True,'results':results,'note':'这是文档检索片段；需要更多上下文时使用 read_workspace_document'}
    @tool
    def read_workspace_document(file_id: str, start: int=0, limit: int=6000) -> dict:
        """根据文件 ID 读取当前对话附件或项目知识库文档，可按字符偏移分页。返回可引用来源编号、原文件摘要和确切文本。不得传入磁盘路径。"""
        from app.workspace import read_document
        from fastapi import HTTPException
        try:result=read_document(project,session_id,file_id,start,limit)
        except HTTPException:return {'ok':False,'error':'文件不存在或不属于当前对话与项目知识库'}
        if result.get('ok'):
            with lock:available_sources[result['source_id']]={'id':result['source_id'],'kind':'workspace','title':result['name'],'content':result['content'],'file_id':file_id,'digest':result['digest']}
        return result
    @tool
    def create_workspace_artifact(name: str, format: str, content: str) -> dict:
        """生成可预览的交付文件，保存到当前对话工作空间，前端自动显示文件卡片。format 支持 txt、md、html、csv、json、xlsx；xlsx 的 content 必须为 JSON 字符串 {"sheets":[{"name":"Sheet1","rows":[["列名"],["值"]]}]}，json 的 content 必须是合法 JSON 文本。HTML 预览不执行脚本。文件不能冒充已验证的业务报告。"""
        from app.workspace import create_artifact
        from fastapi import HTTPException
        with lock:
            if len(receipt.get('artifacts',[]))>=6:return {'ok':False,'error':'每轮最多生成 6 个文件'}
            try:artifact=create_artifact(project,session_id,name,format,content)
            except (ValueError,HTTPException) as exc:return {'ok':False,'error':str(exc) if isinstance(exc,ValueError) else str(exc.detail)}
            receipt.setdefault('artifacts',[]).append(artifact)
            source_id='artifact:'+artifact['id']
            available_sources[source_id]={'id':source_id,'kind':'artifact','title':artifact['name'],'content':'已生成并保存交付文件；模型编写内容，不代表业务数据验证。','file_id':artifact['id'],'digest':artifact['digest']}
            publish({'type':'artifact','file':artifact})
            return {'ok':True,'artifact':artifact,'source_id':source_id,'note':'文件已保存，前端自动显示可点击预览卡片，不需要输出下载链接或重复全部正文。'}
    result=[create_task_plan,read_analysis_guidance,record_step_result]
    return result+[search_workspace_documents,read_workspace_document,create_workspace_artifact] if project else result
