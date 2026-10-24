'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { readJSON, saveJSON } = require('./store');
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
class TaskQueue extends EventEmitter {
  constructor({ directory, store, execute, concurrency = 3 }) {
    super(); this.store = store; this.execute = execute; this.concurrency = concurrency;
    this.file = path.join(directory, 'tasks.json'); this.tasks = readJSON(this.file, []);
    this.busy = new Set(); this.running = new Map(); this.stopping = false;
    for (const t of this.tasks) if (!TERMINAL.has(t.status)) {
      t.status = 'interrupted'; t.message = '服务重启，未自动重新提交，避免重复生成'; t.updatedAt = new Date().toISOString();
    }
    this.persist();
  }
  persist() { saveJSON(this.file, this.tasks); this.emit('change'); }
  list() { return this.tasks.map(t => this.public(t)); }
  public(t) { return structuredClone(t); }
  get(id) { const t = this.tasks.find(t => t.id === id); if (!t) throw new Error('任务不存在'); return t; }
  submit(input = {}) {
    if (this.stopping) throw new Error('服务正在退出');
    const requestId = String(input.requestId || crypto.randomUUID()).slice(0, 160);
    const duplicate = this.tasks.find(t => t.requestId === requestId); if (duplicate) return this.public(duplicate);
    const prompt = String(input.prompt || '').trim(); if (!prompt || prompt.length > 50000) throw new Error('提示词为空或超过50000字');
    const platform = input.platform || 'doubao'; if (!['doubao','dola','gemini','fixture'].includes(platform)) throw new Error('平台不支持');
    const accountId = input.accountId ? String(input.accountId) : '';
    if (accountId && this.store.get(accountId)?.platform !== platform) throw new Error('账号不存在或平台不匹配');
    const references = input.references || [];
    if (!Array.isArray(references) || references.length > 9) throw new Error('参考图最多9张');
    const paths = references.map(p => {
      if (typeof p !== 'string' || !path.isAbsolute(p) || !/\.(png|jpe?g|webp|gif|bmp)$/i.test(p) || !fs.statSync(p).isFile()) throw new Error('参考图路径或格式无效');
      return path.resolve(p);
    });
    const duration = input.duration == null || input.duration === '' ? null : Number(input.duration);
    if (duration !== null && (!Number.isInteger(duration) || duration < 5 || duration > 15)) throw new Error('视频时长仅支持 5–15 秒的整数秒');
    const resolution=String(input.resolution||'');if(resolution&&!['480p','720p','1080p','2160p'].includes(resolution))throw new Error('分辨率参数不支持');
    if(platform==='gemini'){
      if(duration!==null)throw new Error('Gemini 视频没有时长选项，请把时长留空使用网页设置');
      if(resolution)throw new Error('Gemini 视频没有清晰度选项，请把分辨率留空');
      if(String(input.model||''))throw new Error('Gemini 视频暂不支持指定模型，请把模型留空');
      if(input.ratio&&!['16:9','9:16'].includes(String(input.ratio)))throw new Error('Gemini 只支持 16:9 或 9:16 画幅');
    }
    const now = new Date().toISOString();
    const t = { id: crypto.randomUUID(), requestId, prompt, platform, accountId, requestedAccountId:accountId, references: paths,
      model: String(input.model || '').slice(0, 80), duration, resolution, ratio: String(input.ratio || '').slice(0, 20),
      removeWatermark: input.removeWatermark !== false, timeoutSeconds: Math.max(60,Math.min(14400,Number(input.timeoutSeconds)||3600)),
      status: 'queued', message: '等待可用账号', progress: 0, createdAt: now, updatedAt: now, result: null, error: '' };
    this.tasks.push(t); this.persist(); this.kick(); return this.public(t);
  }
  update(t, patch) {
    if (TERMINAL.has(t.status)) return;
    Object.assign(t, patch, { updatedAt: new Date().toISOString() }); this.persist();
  }
  kick() { if (!this.stopping) setImmediate(() => this.drain()); }
  drain() {
    if (this.stopping) return;
    for (const t of this.tasks) {
      if (this.running.size >= this.concurrency) break;
      if (t.status !== 'queued') continue;
      const a = this.store.list().find(a => a.enabled && a.platform === t.platform && (!(t.requestedAccountId??t.accountId) || a.id === (t.requestedAccountId??t.accountId))
        && this.store.canUse(a) && !this.busy.has(a.id) && (!a.cooldownUntil || a.cooldownUntil <= Date.now()));
      if (!a){if(t.message!=='等待可用账号：今日配额、冷却或占用限制')this.update(t,{message:'等待可用账号：今日配额、冷却或占用限制'});continue;}
      this.busy.add(a.id); const controller = new AbortController(); this.running.set(t.id, controller);
      this.update(t, { status: 'starting', accountId: a.id, message: '打开独立账号会话' });
      Promise.resolve().then(() => this.execute(t, a, controller.signal, patch => this.update(t, patch))).then(result => {
        if (controller.signal.aborted) return;
        if (!result || !path.isAbsolute(result.path) || !fs.existsSync(result.path)) throw new Error('任务没有返回真实本地文件');
        this.update(t, { status: 'completed', message: '已下载并校验', progress: 100, result });
      }).catch(error => {
        if(error.code==='ACCOUNT_QUOTA_EXHAUSTED' && !t.requestedAccountId && !controller.signal.aborted){
          this.update(t,{status:'queued',accountId:'',message:'账号额度不足，等待其他可用账号',quotaCharged:false});return;
        }
        if (!controller.signal.aborted) this.update(t, { status: 'failed', error: String(error.message || error), message: String(error.message || error) });
      }).finally(() => { this.busy.delete(a.id); this.running.delete(t.id); this.kick(); });
    }
  }
  resume(id) {
    const t=this.get(id);
    if(!['failed','interrupted','cancelled'].includes(t.status) || !t.conversationURL)throw new Error('任务没有可续查的已提交会话');
    Object.assign(t,{status:'queued',resume:true,error:'',message:'继续查询已提交会话，不重新发送提示词',updatedAt:new Date().toISOString()});
    this.persist();this.kick();return this.public(t);
  }
  cancel(id) {
    const t = this.get(id); if (TERMINAL.has(t.status)) return this.public(t);
    this.running.get(id)?.abort(new Error('任务已取消'));
    this.update(t, { status: 'cancelled', message: '已停止本地操作；已提交的平台生成无法撤回', progress: 0 });
    this.kick(); return this.public(t);
  }
  async shutdown() {
    this.stopping = true;
    for (const t of this.tasks) if (!TERMINAL.has(t.status)) this.cancel(t.id);
    const deadline = Date.now() + 10000;
    while (this.running.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  }
}
module.exports = { TaskQueue, TERMINAL };
