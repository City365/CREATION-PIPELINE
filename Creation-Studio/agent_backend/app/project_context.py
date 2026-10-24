"""Resolve selected resources through business APIs; expose only frozen metadata."""
import hashlib
import json
import os
from collections import Counter
from urllib.parse import quote
import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

class ResourceSelection(BaseModel):
    dataset_id: str | None = Field(default=None, max_length=100)
    dataset_version_id: str | None = Field(default=None, max_length=100)
    package_id: str | None = Field(default=None, max_length=100)

    @model_validator(mode='after')
    def paired_version(self):
        if bool(self.dataset_id) != bool(self.dataset_version_id):
            raise ValueError('数据集与版本必须同时选择')
        return self

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def clean_schema(raw):
    # No file paths, sample values, arbitrary lineage payloads or customer rows.
    fields = ('name', 'description', 'dtype', 'semantic_type', 'role', 'unit', 'nullable')
    return {**{k: raw.get(k) for k in ('schema_version', 'primary_key', 'target', 'time_column', 'validation')},
            'columns': [{k: c[k] for k in fields if k in c} for c in raw.get('columns', []) if isinstance(c, dict)]}

async def resolve_context(project, selection, authorization=None):
    if not selection or not any(selection.model_dump().values()):
        return None
    headers = {'X-Project-Id': project}
    if authorization:
        headers['Authorization'] = authorization
    async with httpx.AsyncClient(base_url=os.getenv('BUSINESS_API_URL', 'http://127.0.0.1:3014/api'), headers=headers, timeout=30) as client:
        async def get(path):
            try:
                response = await client.get(path)
                if response.status_code in (401, 403):
                    raise HTTPException(response.status_code, '无权读取所选项目资源')
                response.raise_for_status()
                body = response.json()
                if body.get('code') != 0:
                    raise HTTPException(422, '所选资源不存在或不可读取')
                return body['data']
            except (httpx.HTTPError, ValueError):
                raise HTTPException(503, '项目资源服务暂不可用，请稍后重试')
        root = '/projects/' + quote(project, safe='') + '/datasets'
        snapshot = {'schema_version': 'agent-context/1.0', 'project_id': project, 'selection': selection.model_dump(), 'warnings': []}
        if selection.dataset_id:
            catalog = await get(root)
            dataset = next((d for d in catalog['datasets'] if d['id'] == selection.dataset_id), None)
            if not dataset:
                raise HTTPException(422, '数据集不属于当前项目')
            path = root + '/' + quote(selection.dataset_id, safe='') + '/versions/' + quote(selection.dataset_version_id, safe='')
            version = await get(path)
            # Version detail may be wrapped; validate ownership explicitly.
            version = version.get('version', version)
            if version.get('is_deleted') or version.get('dataset_id') != selection.dataset_id or version.get('id') != selection.dataset_version_id:
                raise HTTPException(422, '数据版本与所选数据集不匹配')
            schema = await get(path + '/schema')
            snapshot['dataset'] = {'id': dataset['id'], 'name': dataset['name'], 'version_id': version['id'], 'version_num': version.get('version_num'), 'n_rows': version.get('n_rows'), 'n_cols': version.get('n_cols'), 'schema_source': schema['source'], 'schema': clean_schema(schema['schema'])}
            if not (schema['schema'].get('validation') or {}).get('schema_confirmed'):
                snapshot['warnings'].append('Schema 尚未人工确认；字段类型和业务口径需要核验。')
        if selection.package_id:
            catalog = await get('/strategy/packages/list?project_id=' + quote(project, safe=''))
            package = next((p for p in catalog['items'] if p['id'] == selection.package_id), None)
            if not package:
                raise HTTPException(422, '策略包不属于当前项目')
            detail = await get('/strategy/packages/' + quote(selection.package_id, safe='') + '/rules')
            if (detail.get('package') or {}).get('id') != package['id']:
                raise HTTPException(422, '策略包不可读取')
            fields = ('id', 'name', 'conditions', 'action', 'priority', 'sort_order', 'status', 'dataset_id', 'dataset_version_id')
            snapshot['strategy'] = {'id': package['id'], 'name': package['name'], 'version': detail['package'].get('version'), 'status': detail['package'].get('status'), 'rules': [{k: r[k] for k in fields if k in r} for r in detail['items']]}
        if 'dataset' in snapshot and 'strategy' in snapshot:
            def features(node):
                if isinstance(node, dict):
                    names = {node['feature']} if isinstance(node.get('feature'), str) else set()
                    for value in node.values(): names.update(features(value))
                    return names
                if isinstance(node, list):
                    return set().union(*(features(value) for value in node)) if node else set()
                return set()
            required = features([r['conditions'] for r in snapshot['strategy']['rules'] if 'conditions' in r])
            available = {c['name'] for c in snapshot['dataset']['schema']['columns'] if 'name' in c}
            snapshot['compatibility'] = {'check': 'field_presence_only', 'missing_fields': sorted(required - available), 'required_fields': sorted(required), 'note': '仅检查字段存在性；未验证类型、条件语义或策略效果。'}
            if required - available: snapshot['warnings'].append('所选数据缺少规则字段：' + ', '.join(sorted(required - available)))
        snapshot['snapshot_hash'] = digest(snapshot)
        return snapshot

def context_summary(snapshot):
    if not snapshot:
        return None
    summary = {k: snapshot[k] for k in ('schema_version', 'project_id', 'selection', 'snapshot_hash', 'warnings')}
    if 'compatibility' in snapshot: summary['compatibility'] = snapshot['compatibility']
    if 'dataset' in snapshot:
        d = snapshot['dataset']; schema = d['schema']
        summary['dataset'] = {k: v for k, v in d.items() if k != 'schema'}
        summary['dataset'].update({k: schema.get(k) for k in ('primary_key', 'target', 'time_column')})
        summary['dataset']['fields'] = [{k: c[k] for k in ('name', 'semantic_type', 'role') if k in c} for c in schema['columns'][:80]]
        summary['dataset']['fields_truncated'] = len(schema['columns']) > 80
    if 'strategy' in snapshot:
        p = snapshot['strategy']
        summary['strategy'] = {k: v for k, v in p.items() if k != 'rules'}
        summary['strategy'].update(rule_count=len(p['rules']), actions=dict(Counter(r.get('action') for r in p['rules'])))
    return summary

def build_context_tools(snapshot, sources):
    if not snapshot:
        return []
    from langchain_core.tools import tool
    def page(kind, rows, offset, limit, metadata):
        if offset < 0 or not 1 <= limit <= 50:
            return {'ok': False, 'error': 'offset>=0，limit 为 1 到 50'}
        selected = rows[offset:offset + limit]
        sid = 'context:' + snapshot['snapshot_hash'] + ':' + kind + ':' + str(offset) + ':' + str(limit)
        result = {'metadata': metadata, 'items': selected, 'total': len(rows), 'next_offset': offset + len(selected) if offset + len(selected) < len(rows) else None}
        sources[sid] = {'id': sid, 'kind': 'project_context', 'title': kind + ' · ' + metadata['name'], 'content': json.dumps(result, ensure_ascii=False)}
        return {'ok': True, 'source_id': sid, 'snapshot_hash': snapshot['snapshot_hash'], **result}
    @tool
    def read_dataset_schema(offset: int = 0, limit: int = 30) -> dict:
        """分页读取本轮选定数据版本的冻结 Schema。仅元数据，无客户明细；返回可引用来源和 next_offset。"""
        d = snapshot.get('dataset')
        if not d: return {'ok': False, 'error': '本轮未选择数据'}
        return page('schema', d['schema']['columns'], offset, limit, {**{k:v for k,v in d.items() if k != 'schema'}, **{k:v for k,v in d['schema'].items() if k != 'columns'}})
    @tool
    def read_strategy_rules(offset: int = 0, limit: int = 20) -> dict:
        """分页读取本轮选定策略包的冻结规则条件、动作、优先级和绑定。不是执行结果，不能据此判断实际策略效果。"""
        p = snapshot.get('strategy')
        if not p: return {'ok': False, 'error': '本轮未选择策略'}
        return page('rules', p['rules'], offset, limit, {k:v for k,v in p.items() if k != 'rules'})
    return ([read_dataset_schema] if 'dataset' in snapshot else []) + ([read_strategy_rules] if 'strategy' in snapshot else [])
