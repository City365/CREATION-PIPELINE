# -*- coding: utf-8 -*-
"""字字动画 → 本地豆包任务服务。没有商业激活码或旧管理器哈希绑定。"""
import hashlib
import json
import os
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

_DEFAULTS = {
    "connection_file": "D:/notebook/software/管理器7.8.7/rebuild/data/connection.json",
    "platform": "doubao", "account_id": "", "model": "", "duration": "",
    "ratio": "", "remove_watermark": True, "timeout": 3600, "poll_interval": 2,
}
_params = {}
_running = {}
_lock = threading.Lock()
try:
    from plugin_utils import load_plugin_config
except ImportError:
    def load_plugin_config(_):
        return {}


def get_info():
    return {"name": "豆包本地创作台", "version": "0.1.0", "images_per_batch": 1,
            "description": "独立Chrome账号会话，视频生成、原片下载和本地回传"}


def get_params():
    result = dict(_DEFAULTS)
    result.update(_params)
    result.update(load_plugin_config(__file__) or {})
    return result


def load_params(params):
    _params.update(params or {})
    return True


def _connection(params):
    file = Path(str(params.get("connection_file") or _DEFAULTS["connection_file"]))
    if not file.is_file():
        raise RuntimeError("找不到本地服务连接文件，请先启动管理器并核对connection_file路径")
    data = json.loads(file.read_text(encoding="utf-8"))
    url = str(data.get("baseURL") or "").rstrip("/")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username or parsed.path:
        raise RuntimeError("只允许连接127.0.0.1本地管理器")
    token = str(data.get("apiToken") or "")
    if not token:
        raise RuntimeError("连接文件缺少本地API凭据")
    return url, token


def _request(connection, route, method="GET", data=None):
    base, token = connection
    payload = None if data is None else json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(base + route, data=payload, method=method,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            message = json.loads(exc.read().decode("utf-8")).get("error")
        except Exception:
            message = "HTTP %s" % exc.code
        raise RuntimeError(message) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("本地管理器未启动或无法连接") from exc


def _references(context):
    result = []
    seen = set()

    def add(value):
        if isinstance(value, str) and value.strip():
            p = os.path.abspath(value)
            if p not in seen:
                if not os.path.isfile(p):
                    raise RuntimeError("参考图不存在：" + p)
                seen.add(p)
                result.append(p)
        elif isinstance(value, dict):
            for key in ("path", "file_path", "image_path", "local_path"):
                if value.get(key):
                    add(value[key])
                    return
            for item in value.values():
                add(item)
        elif isinstance(value, (list, tuple)):
            for item in value:
                add(item)

    add(context.get("first_frame_path"))
    add(context.get("end_frame_path"))
    refs = context.get("reference_images") or {}
    if isinstance(refs, dict):
        def order(key):
            return (0, int(key)) if str(key).isdigit() else (1, str(key))
        for key in sorted(refs, key=order):
            add(refs[key])
    else:
        add(refs)
    return result


def _safe(value):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', str(value)).rstrip('. ')[:100]
    if not value or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', value, re.I):
        raise RuntimeError("分镜标识无法用作文件名")
    return value


def _progress(context, text, percent=None):
    callback = context.get("progress_callback")
    if callable(callback):
        callback(text, percent)


def _check_stop(event):
    if event.is_set():
        raise RuntimeError("本地任务已取消")


def generate(context):
    params = get_params()
    params.update(context.get("plugin_params") or {})
    connection = None
    submitted = []
    stop = threading.Event()
    invocation = uuid.uuid4().hex
    try:
        connection = _connection(params)
        prompt = str(context.get("prompt") or "").strip()
        if not prompt:
            raise RuntimeError("提示词为空")
        if context.get("reference_audios") or context.get("reference_videos"):
            raise RuntimeError("当前重建版尚未实现音频/视频参考上传，不能静默忽略这些素材")
        root = Path(context.get("project_path") or context.get("output_dir") or "")
        if not str(root) or str(root) == '.':
            raise RuntimeError("宿主未提供作品输出目录")
        root = root.resolve()
        root.mkdir(parents=True, exist_ok=True)
        positions = context.get("output_position") or [0]
        if not isinstance(positions, list):
            positions = [positions]
        references = _references(context)
        unique = _safe(context.get("unique_name") or invocation)
        viewer = int(context.get("viewer_index") or 0)
        generation_round = int(context.get("generation_round") or 0)
        timeout = max(60, min(14400, int(params.get("timeout") or 3600)))
        with _lock:
            _running[invocation] = {"stop": stop, "task_ids": submitted, "connection": connection}
        output = []
        for position in positions:
            _check_stop(stop)
            payload = {
                "requestId": invocation + ":" + str(position), "prompt": prompt,
                "platform": params.get("platform") or "doubao", "accountId": params.get("account_id") or "",
                "references": references, "model": params.get("model") or "", "duration": params.get("duration") or None,
                "ratio": params.get("ratio") or "", "removeWatermark": params.get("remove_watermark") is not False,
                "timeoutSeconds": timeout,
            }
            # Transport retry reuses requestId; service must not submit another platform generation.
            try:
                task = _request(connection, "/api/tasks", "POST", payload)
            except RuntimeError:
                _check_stop(stop)
                task = _request(connection, "/api/tasks", "POST", payload)
            task_id = task["id"]
            with _lock:
                submitted.append(task_id)
            deadline = time.monotonic() + timeout
            while True:
                _check_stop(stop)
                if time.monotonic() >= deadline:
                    raise RuntimeError("插件等待超时，已请求取消本地任务")
                task = _request(connection, "/api/tasks/" + task_id)
                _progress(context, task.get("message") or task["status"], task.get("progress"))
                if task["status"] == "completed":
                    break
                if task["status"] in ("failed", "cancelled", "interrupted"):
                    raise RuntimeError(task.get("error") or task.get("message") or "生成失败")
                stop.wait(max(0.2, float(params.get("poll_interval") or 2)))
            _check_stop(stop)
            destination = root / ("%04d_%s_%d_%s.mp4" % (viewer, unique, generation_round, _safe(position)))
            temporary = destination.with_name(destination.name + "." + invocation + ".part")
            req = urllib.request.Request(connection[0] + "/api/tasks/" + task_id + "/file",
                headers={"Authorization": "Bearer " + connection[1]})
            try:
                digest = hashlib.sha256()
                size = 0
                with urllib.request.urlopen(req, timeout=300) as response, temporary.open("xb") as target:
                    while True:
                        _check_stop(stop)
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        target.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
                    target.flush()
                    os.fsync(target.fileno())
                _check_stop(stop)
                if size != task["result"]["size"]:
                    raise RuntimeError("视频回传大小不匹配")
                with temporary.open("rb") as source:
                    if b"ftyp" not in source.read(64):
                        raise RuntimeError("视频回传不是MP4")
                os.replace(temporary, destination)
                output.append(str(destination))
            finally:
                temporary.unlink(missing_ok=True)
        _progress(context, "已完成", 100)
        return output
    except Exception as exc:
        if connection:
            for task_id in submitted:
                try:
                    _request(connection, "/api/tasks/" + task_id + "/cancel", "POST", {})
                except Exception:
                    pass
        raise RuntimeError("PLUGIN_ERROR:::" + str(exc)) from exc
    finally:
        with _lock:
            _running.pop(invocation, None)


def handle_action(action, data=None):
    data = data or {}
    try:
        if action in ("get_task_logs", "get_api_state", "test_connection"):
            state = _request(_connection(get_params()), "/api/state")
            return {"ok": True, "accounts": state["accounts"], "tasks": state["tasks"],
                    "message": "已连接本地管理器"}
        if action in ("cancel_task", "force_end_task", "cancel_all"):
            target = str(data.get("task_id") or data.get("taskId") or "")
            with _lock:
                runs = list(_running.values())
            cancelled = []
            for run in runs:
                if action != "cancel_all" and target and target not in run["task_ids"]:
                    continue
                run["stop"].set()
                for task_id in list(run["task_ids"]):
                    _request(run["connection"], "/api/tasks/" + task_id + "/cancel", "POST", {})
                    cancelled.append(task_id)
            if target and target not in cancelled:
                _request(_connection(get_params()), "/api/tasks/" + target + "/cancel", "POST", {})
            return {"ok": True, "message": "已请求取消本地任务"}
        return {"ok": False, "error": "未知动作：" + str(action)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
