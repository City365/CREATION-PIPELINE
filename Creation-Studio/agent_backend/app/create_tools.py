"""创作工具：直接调用本机创作台的图像生成、视频生成、读视频信息与抽帧。

这些工具让智能体真的能"做片"：出参考图、提交视频任务、等成片、抽帧检查。
创作台服务地址默认 http://127.0.0.1:17821，可用 WMD_BASE_URL 覆盖。
"""
import json
import os
import time
import urllib.error
from urllib.parse import quote
import urllib.request
from pathlib import Path

from langchain_core.tools import tool

WMD_BASE = os.environ.get('WMD_BASE_URL', 'http://127.0.0.1:17821').rstrip('/')


def _http(method, path, body=None, timeout=60):
    token = os.environ.get('WMD_INTERNAL_TOKEN', '')
    if not token:
        data_dir = Path(os.environ.get('WMD_DATA_DIR') or Path(__file__).resolve().parents[2] / 'data')
        try:
            token = json.loads((data_dir / 'internal-token.json').read_text(encoding='utf-8'))['token']
        except (OSError, ValueError, KeyError):
            raise RuntimeError('内部服务凭据不可用，请先启动创作台服务，或检查 WMD_DATA_DIR')
    data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    req = urllib.request.Request(
        WMD_BASE + path,
        data=data,
        method=method,
        headers={'Content-Type': 'application/json', 'X-WMD-Internal': token},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            payload = json.loads(res.read().decode('utf-8'))
    except urllib.error.HTTPError as err:
        detail = err.read().decode('utf-8', 'replace')[:500]
        try:
            detail = json.loads(detail).get('error') or detail
        except Exception:
            pass
        raise RuntimeError('创作台接口 ' + path + ' 失败：' + str(detail))
    except Exception as err:
        raise RuntimeError('连不上创作台服务（' + WMD_BASE + '）：' + str(err))
    if not payload.get('ok'):
        raise RuntimeError(payload.get('error') or '创作台接口返回失败')
    return payload.get('data')


def _video_state():
    return _http('GET', '/api/state')


def build_creation_tools(publish=None, project=None, session_id=None):
    """构建一组绑定到当前创作台服务的创作工具。publish 用来把媒体文件推到对话里。"""

    def emit_media(files):
        if publish and files:
            try:
                publish({'type': 'media', 'files': files})
            except Exception:
                pass

    def media_item(item, kind='image'):
        path = str(item.get('path') or '')
        url = str(item.get('url') or '')
        rel = str(item.get('rel') or '')
        if rel and project:
            # 项目相对路径地址：换过项目根目录也还能打开
            url = '/api/file?rel=' + quote(rel) + '&projectId=' + quote(str(project))
        elif not url and path:
            url = '/api/file?path=' + quote(path)
        registration = {}
        if project and session_id and path and Path(path).is_file():
            try:
                from app.project_files import register_existing
                registered = register_existing(project,session_id,path,origin='generated')
                registration = {'file_id':registered['id']}
            except Exception as exc:
                registration = {'registration_error':str(exc)}
        return {
            **registration,
            'name': str(item.get('name') or os.path.basename(path)),
            'path': path,
            'rel': rel,
            'url': url,
            'kind': kind,
            'bytes': int(item.get('bytes') or 0),
        }

    @tool
    def list_creation_models() -> dict:
        """列出当前可用的视频模型（工作流）和图像渠道。生成视频前先调用，拿 workflow_id；图像渠道用来判断能不能出参考图。"""
        try:
            state = _video_state()
            videos = []
            for wf in state.get('workflows', []):
                videos.append({
                    'workflow_id': wf.get('id'),
                    'label': wf.get('display') or wf.get('label'),
                    'provider': wf.get('provider'),
                    'duration_default': wf.get('durationDefault'),
                    'ratios': wf.get('ratios') or [],
                    'images': wf.get('images'),
                })
            images = [
                {'channel_id': c.get('id'), 'name': c.get('name'), 'model': c.get('model'), 'type': c.get('type')}
                for c in (state.get('channels') or {}).get('image', [])
                if c.get('enabled', True)
            ]
            return {
                'ok': True,
                'video_models': videos,
                'image_channels': images,
                'default_video': state.get('defaultWorkflowId'),
                'note': '官网 API 与管理器渠道都会列出；选 workflow_id 后直接提交视频任务。',
            }
        except Exception as err:
            return {'ok': False, 'error': str(err)}

    @tool
    def generate_image(prompt: str, count: int = 1, size: str = '', refs: list[str] = [], target_path: str = '') -> dict:
        """调用本机图像生成模型出图（会真实计费）。prompt 必填；count 1-4；size 可留空；refs 是可选的本地参考图绝对路径。返回图片路径，可用于后续视频的首帧。

        target_path：只有在「这张图要当项目资产」时才填，写**项目内的相对路径**（相对项目根目录，不带盘符、不以 / 开头、不用 ..），
        例如 assets/素材/人物/第1集-错过，也是彼此成全/林清栀-三视图.png。填了就固定存到这个位置，同名文件覆盖、旧图自动留档到 assets/.版本/。
        聊天里随手生成的图不要填，系统会放到项目的 media/images/<日期>/。
        """
        try:
            body = {
                'prompt': prompt,
                'count': max(1, min(4, int(count or 1))),
                'size': size or '',
                'refs': [{'path': p, 'name': os.path.basename(p)} for p in (refs or [])],
            }
            if project:
                body['projectId'] = project
            target = str(target_path or '').strip()
            if target:
                body['targetPath'] = target
            data = _http('POST', '/api/images/generate', body, timeout=300)
            imgs = [{'path': i.get('path'), 'rel': i.get('rel') or '', 'name': i.get('name'), 'url': i.get('url')} for i in data.get('items', [])]
            emit_media([media_item(i, 'image') for i in data.get('items', [])])
            return {'ok': True, 'id': data.get('id'), 'images': imgs}
        except Exception as err:
            return {'ok': False, 'error': str(err)}

    @tool
    def submit_video_job(prompt: str, workflow_id: str = '', duration: int = 10, aspect_ratio: str = '16:9', image_paths: list[str] = []) -> dict:
        """把生成好的提示词提交到视频工作台（异步任务）。workflow_id 来自 list_creation_models，留空用默认模型；image_paths 是本地参考图路径。返回 job_id，之后用 wait_video_job 等成片。"""
        try:
            state = _video_state()
            wf_id = workflow_id or state.get('defaultWorkflowId')
            if not wf_id:
                return {'ok': False, 'error': '没有可用的视频模型'}
            images = [{'path': p, 'name': os.path.basename(p)} for p in (image_paths or [])]
            data = _http('POST', '/api/jobs', {
                'workflowId': wf_id,
                'prompt': prompt,
                'duration': max(1, min(15, int(duration or 10))),
                'aspectRatio': aspect_ratio or '16:9',
                'count': 1,
                'images': images,
            }, timeout=60)
            job_id = data['jobs'][0]['id']
            return {'ok': True, 'job_id': job_id, 'workflow_id': wf_id,
                    'note': '视频生成一般需要几分钟；用 wait_video_job 等结果，别重复提交。'}
        except Exception as err:
            return {'ok': False, 'error': str(err)}

    @tool
    def check_video_job(job_id: str) -> dict:
        """查询视频任务状态（queued / running / success / failed），返回进度、阶段、错误和成片路径。"""
        try:
            data = _http('GET', '/api/jobs')
            job = next((j for j in data.get('jobs', []) if j.get('id') == job_id), None)
            if not job:
                return {'ok': False, 'error': '任务不存在'}
            return {'ok': True, 'job_id': job_id, 'status': job.get('status'), 'stage': job.get('stage'),
                    'progress': job.get('progress'), 'error': job.get('error'),
                    'outputs': [{'path': o.get('path'), 'name': o.get('name')} for o in job.get('outputs', [])]}
        except Exception as err:
            return {'ok': False, 'error': str(err)}

    @tool
    def wait_video_job(job_id: str, timeout_seconds: int = 600) -> dict:
        """阻塞等待视频任务完成（默认 600 秒，最多 1800），返回最终状态、成片路径和大小。等待期间不要重复提交任务。"""
        deadline = time.time() + max(30, min(1800, int(timeout_seconds or 600)))
        last = None
        while time.time() < deadline:
            last = check_video_job.invoke({'job_id': job_id})
            if last.get('status') in ('success', 'failed', 'canceled'):
                if last.get('status') == 'success':
                    emit_media([media_item({'name': o.get('name'), 'path': o.get('path')}, 'video') for o in last.get('outputs', []) if o.get('path')])
                return last
            time.sleep(5)
        return {'ok': False, 'error': '等待超时，任务可能还在生成', 'last': last}

    @tool
    def probe_video(path: str) -> dict:
        """读取视频信息：时长、分辨率、帧率、编码、是否有音频。用于出片后自检。"""
        try:
            return {'ok': True, **_http('POST', '/api/tools/probe', {'path': path}, timeout=60)}
        except Exception as err:
            return {'ok': False, 'error': str(err)}

    @tool
    def extract_frames(path: str, count: int = 6) -> dict:
        """从视频里抽帧（默认 6 张，最多 12），返回每张图的路径和时间点，用来检查画面、找首尾帧或做参考图。"""
        try:
            data = _http('POST', '/api/tools/frames', {'path': path, 'count': max(1, min(12, int(count or 6)))}, timeout=240)
            emit_media([media_item({'name': f.get('name'), 'path': f.get('path'), 'url': f.get('url')}, 'image') for f in data.get('frames', [])])
            return {'ok': True, **data}
        except Exception as err:
            return {'ok': False, 'error': str(err)}

    @tool
    def describe_image(file_id: str = '', path: str = '') -> dict:
        """查看图片内容。用户发来图片/参考图时先调用它：传附件 file_id，或本地图片绝对路径 path。

        返回画面描述（人物、场景、光线、风格、文字），之后可据此写提示词或判断一致性。
        """
        try:
            target = str(path or '')
            if not target and file_id:
                from app.workspace import file_record, file_path
                record = file_record(project, file_id, session_id)
                target = str(file_path(record))
            if not target:
                return {'ok': False, 'error': '需要 file_id 或 path'}
            data = _http('POST', '/api/images/describe', {'path': target}, timeout=180)
            return {'ok': True, 'path': target, 'description': data.get('text', '')}
        except Exception as err:
            return {'ok': False, 'error': str(err)}

    return [list_creation_models, generate_image, submit_video_job, check_video_job, wait_video_job, probe_video, extract_frames, describe_image]
