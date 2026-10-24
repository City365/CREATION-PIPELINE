"""Trust the business backend for identity and project authorization, never the project header alone."""
import contextvars,os
from urllib.parse import quote
import httpx
from fastapi import HTTPException
current=contextvars.ContextVar('agent_identity',default=None)
async def authorize(project,authorization=None):
    mode=os.getenv('HARNESS_AUTH_MODE','development')
    if mode=='development':return {'user_id':'development-local','security_mode':'development'}
    if mode!='business':raise HTTPException(503,'智能体鉴权模式配置无效')
    if not isinstance(authorization,str) or not authorization.startswith('Bearer '):raise HTTPException(401,'请先登录')
    try:
        async with httpx.AsyncClient(base_url=os.getenv('BUSINESS_API_URL','http://127.0.0.1:3014/api'),timeout=10,headers={'Authorization':authorization,'X-Project-Id':project}) as client:
            me=await client.get('/auth/me')
            if me.status_code in (401,403):raise HTTPException(me.status_code,'身份认证未通过')
            me.raise_for_status();payload=me.json()
            user=payload.get('data') if payload.get('code')==0 else None
            if not user or not user.get('id'):raise HTTPException(401,'身份认证未通过')
            if user['id']=='dev-admin':raise HTTPException(503,'业务后端处于免鉴权模式，不能作为生产身份认证')
            access=await client.get('/projects/'+quote(project,safe=''))
            if access.status_code in (401,403,404):raise HTTPException(access.status_code,'没有当前项目的访问权限')
            access.raise_for_status();data=access.json()
            if data.get('code')!=0 or not data.get('data'):raise HTTPException(403,'没有当前项目的访问权限')
            return {'user_id':str(user['id']),'security_mode':'business'}
    except HTTPException:raise
    except (httpx.HTTPError,ValueError):raise HTTPException(503,'身份校验服务暂不可用')
