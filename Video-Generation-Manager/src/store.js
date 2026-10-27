'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function saveJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function safeSegment(value) {
  const s = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100);
  if (!s || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(s)) throw new Error('无效文件名');
  return s;
}
const DEFAULT_QUOTA_TIMEZONE = 'Asia/Shanghai';
class Store {
  constructor(directory, options = {}) {
    this.now=options.now || (()=>new Date());
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true });
    this.file = path.join(this.directory, 'accounts.json');
    this.accounts = readJSON(this.file, []);
    if (!Array.isArray(this.accounts)) throw new Error('账号文件格式错误，请保留文件后检查');
    let migrated=false;
    for(const a of this.accounts){
      // 旧版本默认按蒂华纳时间重置；统一迁到北京时间，避免早上 8 点才刷新。
      if(a.quota?.timezone==='America/Tijuana'||!a.quota?.timezone){a.quota={...(a.quota||{}),timezone:DEFAULT_QUOTA_TIMEZONE};migrated=true;}
      if(this.ensureQuota(a))migrated=true;
    }
    if(migrated)this.persist();
  }
  quotaDate(timezone) {
    return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(this.now());
  }
  ensureQuota(account) {
    const q=account.quota ||= {limit:5,used:0,timezone:DEFAULT_QUOTA_TIMEZONE,date:''};
    q.limit=Number.isInteger(q.limit)&&q.limit>=0?q.limit:5;
    q.used=Number.isInteger(q.used)&&q.used>=0?q.used:0;
    q.timezone=q.timezone||DEFAULT_QUOTA_TIMEZONE;
    const today=this.quotaDate(q.timezone);
    if(q.date!==today){q.date=today;q.used=0;return true;}return false;
  }
  list() {
    let changed=false;for(const a of this.accounts)if(this.ensureQuota(a))changed=true;if(changed)this.persist();
    return structuredClone(this.accounts);
  }
  canUse(account) {this.ensureQuota(account);return account.quota.used<account.quota.limit;}
  consumeQuota(id) {
    const a=this.get(id);if(!a)throw new Error('账号不存在');this.ensureQuota(a);
    if(!this.canUse(a)){const error=new Error('账号今日视频配额已用完');error.code='ACCOUNT_QUOTA_EXHAUSTED';throw error;}
    a.quota.used++;this.persist();return structuredClone(a.quota);
  }
  /** 任务没有产出成片时退回预扣额度；已到平台上限的账号不要调用。 */
  refundQuota(id) {
    const a=this.get(id);if(!a)return null;this.ensureQuota(a);
    a.quota.used=Math.max(0,a.quota.used-1);this.persist();return structuredClone(a.quota);
  }
  get(id) { return this.accounts.find(a => a.id === id); }
  persist() { saveJSON(this.file, this.accounts); }
  add(input = {}) {
    const platform = input.platform || 'doubao';
    if (!['doubao', 'dola', 'gemini', 'fixture'].includes(platform)) throw new Error('平台不支持');
    const account = { id: crypto.randomUUID(), name: String(input.name || '新账号').slice(0, 60), platform,
      group: String(input.group || '').slice(0, 40), remark: String(input.remark || '').slice(0, 100),
      enabled: true, cooldownUntil: 0, createdAt: new Date().toISOString(), selectors: {}, quota:{limit:5,used:0,timezone:DEFAULT_QUOTA_TIMEZONE,date:this.quotaDate(DEFAULT_QUOTA_TIMEZONE)} };
    this.accounts.push(account); this.persist(); return structuredClone(account);
  }
  update(id, input = {}) {
    const a = this.get(id); if (!a) throw new Error('账号不存在');
    for (const k of ['name', 'group', 'remark']) if (input[k] !== undefined) a[k] = String(input[k]).slice(0, 100);
    if (input.enabled !== undefined) a.enabled = Boolean(input.enabled);
    if (input.cooldownUntil !== undefined) {
      const until = Number(input.cooldownUntil); if (!Number.isFinite(until) || until < 0) throw new Error('冷却时间无效');
      a.cooldownUntil = until;
    }
    if (input.selectors !== undefined) {
      if (!input.selectors || typeof input.selectors !== 'object' || Array.isArray(input.selectors)) throw new Error('选择器必须是对象');
      const allowed = ['editor','send','newChat','message','userMessage','assistantMessage','upload','uploadButton','uploadMenuItem','attachment','uploading','captcha','modeControl','modelControl','durationControl','ratioControl','resolutionControl','tools','videoTool','videoChip','aspect','download','videoMode'];
      const next = {};
      for (const k of allowed) if (input.selectors[k] !== undefined) next[k] = String(input.selectors[k]).slice(0, 1000);
      a.selectors = next;
    }
    this.ensureQuota(a);
    for(const [inputKey,key]of [['quotaLimit','limit'],['quotaUsed','used']])if(input[inputKey]!==undefined){
      const value=Number(input[inputKey]);if(!Number.isInteger(value)||value<0||value>100000)throw new Error('配额必须是0到100000之间的整数');a.quota[key]=value;
    }
    if(input.quotaTimezone!==undefined){const timezone=String(input.quotaTimezone||'').trim()||DEFAULT_QUOTA_TIMEZONE;this.quotaDate(timezone);a.quota.timezone=timezone;this.ensureQuota(a);}
    this.persist(); return structuredClone(a);
  }
  remove(id) {
    if (!this.get(id)) throw new Error('账号不存在');
    this.accounts = this.accounts.filter(a => a.id !== id); this.persist();
    // Chrome profiles remain on disk so removing a list entry never silently destroys login data.
    return { ok: true, profileRetained: true };
  }
  profile(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id) || !this.get(id)) throw new Error('账号不存在');
    return path.join(this.directory, 'profiles', id);
  }
}
module.exports = { Store, saveJSON, readJSON, safeSegment, DEFAULT_QUOTA_TIMEZONE };
