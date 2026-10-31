'use strict';
const {httpJson,deepFindUrl}=require('../../../src/util');
const AUTODL_BASE = process.env.WMD_AUTODL_BASE || 'https://autodl.art';

function autodlHeaders(token) {
  return {
    Authorization: 'Bearer ' + String(token || '').replace(/^\s*Bearer\s+/i, '').trim(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function submitAutodl(token, workflowId, payload, base = AUTODL_BASE) {
  const res = await httpJson(`${base.replace(/\/+$/,'')}/api/v1/comfyui/comfyui_workflow/${encodeURIComponent(workflowId)}`, {
    method: 'POST',
    headers: autodlHeaders(token),
    body: JSON.stringify(payload),
    timeoutMs: 120000,
  });
  const data = res.data || {};
  if (String(data.code || '').toLowerCase() !== 'success' || !(data.data && data.data.task_id)) {
    const msg = (data.data && (data.data.message || data.data.msg)) || data.msg || data.message || String(res.text || '').slice(0, 200);
    if (res.status === 401) throw new Error('AutoDL 返回 401（密钥无效或未授权大模型接口），请到 https://autodl.art/large-model/tokens 检查令牌');
    throw new Error('任务提交失败：' + msg);
  }
  return String(data.data.task_id);
}

async function pollAutodl(token, taskId, base = AUTODL_BASE) {
  const res = await httpJson(`${base.replace(/\/+$/,'')}/api/v1/comfyui/comfyui_workflow/result/${encodeURIComponent(taskId)}`, {
    headers: autodlHeaders(token),
    timeoutMs: 30000,
  });
  const data = res.data || {};
  if (String(data.code || '').toLowerCase() !== 'success') {
    throw new Error('查询失败：' + ((data.data && (data.data.message || data.data.msg)) || data.msg || `HTTP ${res.status}`));
  }
  const body = data.data;
  if (!body || typeof body !== 'object') throw new Error('查询响应缺少 data');
  const raw = String(body.status || '').trim().toUpperCase();
  let status = 'unknown';
  if (['QUEUED', 'PENDING', 'WAITING'].includes(raw)) status = 'queued';
  else if (['RUNNING', 'PROCESSING'].includes(raw)) status = 'running';
  else if (['SUCCESS', 'COMPLETED', 'SUCCEEDED'].includes(raw)) status = 'success';
  else if (['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(raw)) status = 'failed';
  return { status, rawStatus: raw, url: status === 'success' ? deepFindUrl(body) : '', message: body.message || body.msg || '', raw: body };
}

async function verifyAutodlKey(token, base = AUTODL_BASE) {
  if (!String(token || '').trim()) return {ok:false,message:'请先填写 API Key'};
  try {
    const res=await httpJson(base.replace(/\/+$/,'')+'/api/v1/comfyui/comfyui_workflow/result/h3-key-check',{headers:autodlHeaders(token),timeoutMs:30000});
    if(res.status===401||res.status===403)return {ok:false,message:'密钥无效或未授权'};
    if(res.status>=500)return {ok:false,message:'官方接口暂不可用'};
    return {ok:true,message:'接口连接通过；未提交生成，实际生成权限与余额以任务响应为准'};
  } catch(err) {
    if(err.status===404)return {ok:true,message:'接口可连接（测试任务不存在）；未验证生成额度'};
    return {ok:false,message:err.status===401||err.status===403?'密钥无效或未授权':err.message};
  }
}


module.exports={AUTODL_BASE,submitAutodl,pollAutodl,verifyAutodlKey};
