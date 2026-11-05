"""项目身份校验：只信本机控制器，不再依赖外部业务后端。

原来这里连 `BUSINESS_API_URL`（ml-engineer 的业务后端 :3014）做 `/auth/me` 与 `/projects/{id}`，
本产品没有那套服务，已改成向控制器复核项目是否真实存在（本机、内部 token 即可）。
模式由 HARNESS_AUTH_MODE 控制：
- controller（默认）：向控制器 `/api/internal/projects/{id}` 复核项目；不存在的项目直接拒绝；
- development：直接放行，只用于本机开发/测试，部署时必须显式设置。
"""
import contextvars, json, os
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import HTTPException

current = contextvars.ContextVar('agent_identity', default=None)


def _controller_base():
    return str(os.getenv('WMD_BASE_URL') or 'http://127.0.0.1:17821').rstrip('/')


def _internal_token():
    token = os.getenv('WMD_INTERNAL_TOKEN', '')
    if token:
        return token
    data_dir = Path(os.getenv('WMD_DATA_DIR') or Path(__file__).resolve().parents[3] / 'data')
    try:
        return json.loads((data_dir / 'internal-token.json').read_text(encoding='utf-8'))['token']
    except (OSError, ValueError, KeyError):
        return ''


async def authorize(project, authorization=None):
    mode = os.getenv('HARNESS_AUTH_MODE', 'controller').strip().lower()
    if mode in ('development', 'off', 'none'):
        return {'user_id': 'development-local', 'security_mode': 'development'}
    if mode != 'controller':
        raise HTTPException(503, '智能体鉴权模式配置无效（可选 development / controller）')
    token = _internal_token()
    if not token:
        raise HTTPException(503, '内部服务凭据不可用，请先启动控制器服务')
    try:
        async with httpx.AsyncClient(base_url=_controller_base(), timeout=10,
                                     headers={'X-WMD-Internal': token}) as client:
            response = await client.get('/api/internal/projects/' + quote(str(project), safe=''))
            if response.status_code in (401, 403):
                raise HTTPException(response.status_code, '控制器拒绝内部凭据')
            if response.status_code == 404:
                raise HTTPException(403, '没有当前项目的访问权限')
            response.raise_for_status()
            payload = response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, '控制器暂不可用，无法校验项目归属')
    item = payload.get('data') if isinstance(payload, dict) else None
    if not isinstance(item, dict) or item.get('id') != project:
        raise HTTPException(403, '没有当前项目的访问权限')
    return {
        'user_id': 'controller:' + str(project),
        'tenant_id': str(item.get('tenantId') or ''),
        'security_mode': 'controller',
    }
