'use strict';

/* app.ask.js — 剧本创作台（ask 页）
 * 由 web/app.js 按原段注释切分而来（第 5596–11053 行），代码未改写。
 * 该文件是 classic script，与其余 app.*.js 共享同一个全局作用域，加载顺序见 index.html。 */

/* ------------------------------------------------------------------ ask 页复刻（剧本创作台） */

function askProjectId() { return state.projectId || 'wenyun-m-desktop'; }

const ASK_GENERAL = { id: '', name: '普通聊天', description: '只保留智能助手身份，不注入技能或固定流程；需要时由你选择技能。', prompts: ['你好，先介绍一下你能做什么。', '帮我把这个想法整理成可以开拍的方案。'] };
const ASK_SKILLS = [
  { id: 'novel', name: '小说创作', description: '从一句梗概到可改编的短篇小说 / 章节，带人物、钩子和下一节悬念。', prompts: ['写一个 800 字的短篇开头：雨夜，外卖员在便利店门口捡到一部还在响的手机。', '给我 3 个「雪山寺庙门口重逢」的故事方向。'] },
  { id: 'script', name: '小说转剧本', description: '小说 / 梗概改写成可拍的短剧剧本：分场、台词、场尾钩子。', prompts: ['把下面这段小说改写成 3 场短剧剧本：', '把刚才的小说改成 60 秒竖屏短剧，保留结尾反转。'] },
  { id: 'storyboard', name: '剧本转分镜', description: '剧本拆成标准分镜：镜号、时长、景别、六段式提示词。', prompts: ['把上面的剧本拆成 3 个 15 秒分镜。', '帮我把这场戏拆成分镜，标好 <Picture N> 和 <Subject N>。'] },
  { id: 'prompt', name: '分镜转提示词', description: '分镜改写成视频创作台可直接粘贴的六段式提示词。', prompts: ['把上面的分镜写成可直接出片的提示词。', '把这段描述改写成合规的六段式。'] },
  { id: 'review', name: '提示词审核', description: '检查六段、引用、时长和人物一致性，给出可出片结论。', prompts: ['审核这条提示词能不能出片：', '帮我检查分镜引用、时长和人物一致性。'] },
];

const ASK_CHAIN = {
  novel: { next: 'script', label: '转成剧本', verb: '改写成短剧剧本', guidance: 'script' },
  script: { next: 'storyboard', label: '拆成分镜', verb: '拆成可生成的标准分镜', guidance: 'storyboard' },
  storyboard: { next: 'prompt', label: '生成视频提示词', verb: '改写成视频创作台可用的提示词', guidance: 'prompt' },
  prompt: { next: null, label: '送到创作台', verb: '', guidance: 'prompt' },
};

const ASK_TOOLS = [
  { id: 'consistency', name: '人物一致性检查', description: '核对相邻分镜的人物外观、服装、道具是否一致。', scope: '分镜工作台' },
  { id: 'timing', name: '时长与镜头检查', description: '校验单镜 15 秒、镜头数与台词长度是否匹配。', scope: '分镜工作台' },
  { id: 'material', name: '素材编号检查', description: '检查 <Picture N>/<Subject N>/<Audio N> 是否越界或缺失。', scope: '素材库' },
  { id: 'voice', name: '音色库检索', description: '按音色名和台词匹配克隆参考音频。', scope: '音色库' },
  { id: 'docs', name: '知识库检索', description: '查找项目里的创作设定与往期剧本。', scope: '知识库' },
];

const ASK_INTERNAL_TOOLS = [
  { name: 'create_task_plan', description: '制定本轮任务步骤，后续逐步记录产出。', kind: 'task' },
  { name: 'read_analysis_guidance', description: '读取技能指导文档（SKILL.md）内容。', kind: 'task' },
  { name: 'record_step_result', description: '记录每一步的结论、产出与引用材料。', kind: 'task' },
  { name: 'search_workspace_documents', description: '在对话附件与项目知识库里做全文检索。', kind: 'task' },
  { name: 'read_workspace_document', description: '分页读取附件 / 知识库文档正文。', kind: 'task' },
  { name: 'create_workspace_artifact', description: '生成可预览的交付文件（Markdown 优先）。', kind: 'task' },
  { name: 'list_creation_models', description: '列出可用的图像模型与视频模型（含时长、画幅）。', kind: 'create' },
  { name: 'generate_image', description: '调用图像模型出图，可作参考图或首帧。', kind: 'create' },
  { name: 'submit_video_job', description: '把提示词提交到视频工作台生成视频（异步）。', kind: 'create' },
  { name: 'check_video_job', description: '查询视频任务进度、阶段与错误。', kind: 'create' },
  { name: 'wait_video_job', description: '等待视频成片（默认 10 分钟，最多 30 分钟）。', kind: 'create' },
  { name: 'probe_video', description: '读时长、分辨率、帧率、编码、有无音频。', kind: 'create' },
  { name: 'extract_frames', description: '从成片抽帧（最多 12 张），做画面检查或首尾帧。', kind: 'create' },
];

const ASK_EFFORT_LABELS = { none: '关闭', low: '轻量', high: '深入', max: '最高' };
// 本地权限三档：只调"能写哪里、能不能跑命令"，高危命令任何档位都被系统强制阻断
const ASK_PERMISSIONS = [
  { id: 'readonly', label: '仅查看', icon: '👁', desc: '只读检索，不写文件、不移动、不生成、不执行命令' },
  { id: 'workspace', label: '工作区权限', icon: '🗂', desc: '项目目录内可读写、移动、生成；命令需完全权限' },
  { id: 'full', label: '完全权限', icon: '⚡', desc: '本机任意路径可读写（系统目录除外）' },
];
const ASK_PERM_DEFAULT = 'workspace';

function askPermission(id) {
  return ASK_PERMISSIONS.find((p) => p.id === id) || ASK_PERMISSIONS.find((p) => p.id === ASK_PERM_DEFAULT);
}

function askPermissionSet(id) {
  const a = askState();
  a.permission = askPermission(id).id;
  try { localStorage.setItem('wmd.askPermission', a.permission); } catch { /* ignore */ }
  return a.permission;
}
const ASK_MODEL_HINTS = {
  browser: 'Chrome 中打开的本地窗口比手机更稳，建议在桌面浏览器继续。',
};

function askState() {
  if (!state.ask) {
    state.ask = {
      conversations: null,
      activeId: '',
      draft: '',
      search: '',
      generating: false,
      historyOpen: (() => { try { return localStorage.getItem('wmd.askHistoryOpen') !== '0'; } catch { return true; } })(),
      capabilitiesOpen: false,
      // 参考出图开关：关掉就不调用图像渠道（省钱），设置跟着浏览器记住
      refImages: (() => { try { return localStorage.getItem('wmd.askRefImages') !== '0'; } catch { return true; } })(),
      webSearch: (() => { try { return localStorage.getItem('wmd.askWebSearch') === '1'; } catch { return false; } })(),
      // 本地权限档位：仅查看 / 工作区权限 / 完全权限
      permission: (() => { try { return askPermission(localStorage.getItem('wmd.askPermission') || '').id; } catch { return ASK_PERM_DEFAULT; } })(),
      permMenu: false,
      toolsSupported: true,
      panelTab: 'analysis',
      capTab: 'tools',
      pluginTab: 'skill',
      skillId: '',
      skillIds: [],
      enabledTools: [],
      removed: null,
      rename: { open: false, id: '', text: '' },
      toolDetail: null,
      installSkill: null,
      queues: {},
      previewFile: null,
      workspacePage: 'console',
      models: null,
      modelId: '',
      effort: '',
      liked: new Set(),
      disliked: new Set(),
      command: { mode: null, query: null, index: 0 },
      mention: null,
      controller: null,
      request: null,
      error: '',
      loading: false,
      kb: null,
      plugins: null,
      manageError: '',
      trajectory: null,
    };
  }
  if (!state.ask._widthLoaded) {
    state.ask._widthLoaded = true;
    const saved = Number(localStorage.getItem('wmd.previewWidth'));
    state.ask.previewWidth = saved >= 240 ? saved : null;
  }
  return state.ask;
}

function askSkillList() {
  const a = askState();
  const all = (a.skills && a.skills.length)
    ? a.skills
    : ASK_SKILLS.map((s) => ({ ...s, source: 'builtin' }));
  return [ASK_GENERAL].concat(all);
}

function askSkill(id) {
  return askSkillList().find((s) => s.id === id) || ASK_GENERAL;
}

function askSkillName(id) {
  return id ? askSkill(id).name : '';
}

/* 技能可以多选：skillIds 是唯一真相，skillId 只是第一个的镜像，老代码照旧能读。
   顺序 = 用户写入顺序，后端按这个顺序注指导、判「前一个的产出是后一个的输入」。 */
function askSkills() {
  const a = askState();
  if (!Array.isArray(a.skillIds)) a.skillIds = a.skillId ? [a.skillId] : [];
  const out = [];
  for (const id of a.skillIds) {
    if (id && askSkill(id).id === id && !out.includes(id)) out.push(id);
  }
  return out;
}

function askSetSkills(ids) {
  const a = askState();
  const out = [];
  for (const id of ids || []) {
    if (id && askSkill(id).id === id && !out.includes(id)) out.push(id);
  }
  a.skillIds = out;
  a.skillId = out[0] || '';
  return out;
}

function askSkillNames(ids) {
  // 认不出的 id 直接丢掉：排队的快照可能是几天前的，技能已经被删了
  return (ids || askSkills())
    .filter((id) => askSkill(id).id === id)
    .map((id) => askSkillName(id))
    .filter(Boolean);
}

// 正文里的 @技能名 也是点名：点完 @ 又把技能取消掉时，token 还在正文里，
// 不认它就变成模型看不懂的一串 @。认得出来就顺手剥掉，绑定落在 skillIds 上。
function askParseSkillMentions(text) {
  const raw = String(text || '');
  const names = askSkillList()
    .filter((s) => s.id && s.name)
    .sort((x, y) => y.name.length - x.name.length);
  const hits = [];
  let clean = raw;
  for (const s of names) {
    const token = '@' + s.name;
    const at = clean.indexOf(token);
    if (at < 0) continue;
    hits.push({ id: s.id, at });
    clean = clean.split(token).join(' ');
  }
  hits.sort((x, y) => x.at - y.at);
  clean = clean.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+/gm, '').trim();
  return { text: clean, ids: hits.map((h) => h.id) };
}

// 这一轮用哪几个技能、哪个模型、什么权限：排队时必须当场存下来，
// 出队时用户可能已经改成别的技能了，读实时状态会把上一轮的技能配到下一句话上。
function askTurnSnapshot() {
  const a = askState();
  return {
    skillIds: askSkills().slice(),
    modelId: a.modelId || '',
    effort: a.effort || '',
    permission: a.permission || ASK_PERM_DEFAULT,
  };
}

// 技能统一来源：内置技能 + 自定义技能都来自 /agent/skills，右侧组件与插件管理共用
async function askLoadSkills() {
  const a = askState();
  try {
    const data = await askApi('/skills').then((r) => r.json());
    const list = Array.isArray(data) ? data : data.items || [];
    a.skills = list.map((item) => {
      const id = String(item.id || '');
      const source = item.source || (id.startsWith('plugin:') ? 'custom' : 'builtin');
      return {
        id,
        name: item.name || '未命名技能',
        description: item.description || (source === 'custom' ? '自定义技能' : ''),
        prompts: Array.isArray(item.prompts) ? item.prompts : [],
        source,
        runtime: item.runtime_status,
        enabled: item.enabled !== false,
        pluginId: item.plugin_id || (id.startsWith('plugin:') ? id.slice(7) : ''),
      };
    });
    a.customSkills = a.skills.filter((s) => s.source === 'custom');
  } catch {
    a.skills = a.skills || [];
    a.customSkills = a.customSkills || [];
  }
}

function askActive() {
  const a = askState();
  return (a.conversations || []).find((c) => c.id === a.activeId) || null;
}

function askId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function askApi(path, init = {}) {
  const res = await fetch('/api/agent' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId(), ...(init.headers || {}) },
  });
  if (!res.ok) {
    let message = '智能体服务请求失败（' + res.status + '）';
    try {
      const data = await res.json();
      message = typeof data.detail === 'string' ? data.detail : (data.detail && data.detail.message) || message;
    } catch { /* ignore */ }
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return res;
}

async function askUpload(path, form) {
  const res = await fetch('/api/agent' + path, {
    method: 'POST',
    headers: { 'X-Project-Id': askProjectId() },
    body: form,
  });
  if (!res.ok) {
    let message = '技能上传失败（' + res.status + '）';
    try {
      const data = await res.json();
      message = typeof data.detail === 'string' ? data.detail : (data.detail && data.detail.message) || message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json().catch(() => ({}));
}

/* 对话级运行登记：切换对话不再打断正在跑的任务，后台继续，回到对话就能看到结果 */
function askRuns(a = askState()) { if (!a.runs) a.runs = new Map(); return a.runs; }
function askRunOf(id) { return id ? askRuns(askState()).get(id) || null : null; }
function askAbortRuns() {
  const a = askState();
  for (const run of askRuns(a).values()) { try { run.controller.abort(); } catch { /* ignore */ } }
  askRuns(a).clear();
  a.generating = false;
  a.request = null;
  a.controller = null;
  a.startedAt = 0;
}
function askSyncRunState() {
  const a = askState();
  const run = askRunOf(a.activeId);
  a.generating = !!run;
  a.request = run ? { sessionId: run.chatId, requestId: run.requestId, controller: run.controller, runId: run.runId || '' } : null;
  a.controller = run ? run.controller : null;
  a.startedAt = run ? run.startedAt : 0;
  // 回到还在跑的对话时先显示已有内容，避免从零开始补字
  if (run && run.msg) run.msg._reveal = null;
}

async function askRestore() {
  const a = askState();
  askAbortRuns();
  a.conversations = [];
  a.activeId = '';
  a.draft = '';
  a.attachments = [];
  a.loading = true;
  a.error = '';
  try {
    const list = await askApi('/sessions').then((r) => r.json());
    a.conversations = Array.isArray(list) ? list : [];
    // 刷新后回到上次停留的对话，而不是每次新开一个
    const remembered = (() => { try { return localStorage.getItem('wmd-ask-active') || ''; } catch { return ''; } })();
    const existing = remembered ? a.conversations.find((c) => c.id === remembered) : null;
    if (existing) {
      a.activeId = existing.id;
      askSetSkills([]);
      a.workspacePage = 'console';
      askSyncRunState();
    } else {
      askNewConversation();
    }
  } catch (err) {
    a.error = err.message;
    a.conversations = [];
    askNewConversation();
  } finally {
    a.loading = false;
    if (state.route === 'script') askRenderAll();
    askRemember();
    askLoadActiveRuns();
    askLoadProjectHistory().catch(() => {});
  }
}

// 从服务端拿还在这跑的对话（刷新后据此恢复“生成中”和左侧转圈）
async function askLoadActiveRuns() {
  const a = askState();
  let data = null;
  try { data = await askApi('/runs/active').then((r) => r.json()); } catch { return; }
  const items = (data && data.items) || [];
  const live = new Set(items.map((x) => x.session_id));
  for (const run of askRuns(a).values()) {
    if (run.attached && !live.has(run.chatId)) {
      const other = askRuns(a);
      other.delete(run.chatId);
    }
  }
  for (const item of items) {
    if (!item || !item.session_id || askRunOf(item.session_id)) continue;
    askRuns(a).set(item.session_id, {
      chatId: item.session_id,
      requestId: '',
      runId: item.run_id,
      controller: null,
      startedAt: item.started_at || Date.now(),
      msg: null,
      attached: true,
    });
  }
  askSyncRunState();
  askRefreshHistoryFlags();
  if (askRunOf(a.activeId)) askAttachRun(a.activeId);
}

// 刷新/切回时重新接上正在跑的任务：按事件序号补齐内容
async function askAttachRun(chatId) {
  const a = askState();
  const run = askRunOf(chatId);
  if (!run || run.attaching) return;
  if (!run.runId) return;
  const chat = (a.conversations || []).find((c) => c.id === chatId);
  if (!chat) return;
  // 后端已经把这一轮的结果写回会话了（刷新前就跑完了），不要再补一条
  const tailMsg = chat.messages[chat.messages.length - 1];
  if (tailMsg && tailMsg.role === 'assistant' && tailMsg.execution && tailMsg.execution.id === run.runId) {
    askRuns(a).delete(chatId);
    askSyncRunState();
    askRefreshHistoryFlags();
    if (a.activeId === chatId) askRenderMessages();
    return;
  }
  run.attaching = true;
  if (!run.msg) {
    const tail = chat.messages[chat.messages.length - 1];
    run.msg = tail && tail.role === 'assistant' && tail._runId === run.runId
      ? tail
      : { id: 'run-' + run.runId, role: 'assistant', text: '', time: Date.now(), _streaming: true, _runId: run.runId };
    if (!chat.messages.includes(run.msg)) chat.messages.push(run.msg);
  }
  run.msg._streaming = true;
  askSyncRunState();
  if (a.activeId === chatId) askRenderMessages();
  let cursor = 0;
  let sawDone = false;
  for (let guard = 0; guard < 3600; guard += 1) {
    if (askRunOf(chatId) !== run) return;
    let page = null;
    try {
      page = await askApi('/runs/' + encodeURIComponent(run.runId) + '/events?after=' + cursor).then((r) => r.json());
    } catch {
      page = null;
    }
    if (page) {
      for (const ev of page.items || []) {
        if (typeof ev.sequence === 'number') cursor = Math.max(cursor, ev.sequence);
        if (ev.type === 'done' || ev.type === 'run_finished') sawDone = true;
        askApplyEvent(run.msg, ev, chatId);
      }
      if (a.activeId === chatId) askRevealKick();
      const done = (page.items || []).some((ev) => ev.type === 'done' || ev.type === 'error');
      const finished = page.finished === true;
      if (done || (finished && !(page.items || []).length)) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  const runs = askRuns(a);
  if (runs.get(chatId) === run) runs.delete(chatId);
  run.msg._streaming = false;
  run.msg._reveal = null;
  if (!sawDone && run.msg.text && !run.msg.error && !/\[生成已停止\]/.test(run.msg.text)) run.msg.text += '\n\n[生成已停止]';
  chat.updated = Date.now();
  if (a.activeId === chatId) { askSyncRunState(); askRenderMessages(); }
  askRefreshHistoryFlags();
  askPersist();
  askDrainQueue(chatId);
}

function askRemember() {
  try { if (askState().activeId) localStorage.setItem('wmd-ask-active', askState().activeId); } catch { /* ignore */ }
}

let askSyncTimer = null;
function askPersist() {
  const a = askState();
  if (a.restoring || a.generating || !a.conversations) return;
  if (askSyncTimer) clearTimeout(askSyncTimer);
  askSyncTimer = setTimeout(() => {
    if (askState().generating) return;
    for (const c of a.conversations) {
      askApi('/sessions/' + encodeURIComponent(c.id), { method: 'PUT', body: JSON.stringify(c) }).catch(() => {});
      }
  }, 600);
}

function askNewConversation() {
  const a = askState();
  a.moreMenu = null;
  a.workspacePage = 'console';
  askSetSkills([]);
  a.previewFile = null;
  a.mention = null;
  a.command = { mode: null, query: null, index: 0 };
  const c = { id: askId(), title: '新的创作对话', pinned: false, updated: Date.now(), messages: [] };
  a.conversations = [c, ...(a.conversations || [])];
  a.activeId = c.id;
  askSyncCurrentRowItems();
  a.draft = '';
  a.attachments = [];
  askSyncRunState();
  askRemember();
  if (state.route === 'script') askRenderAll();
  return c;
}

/** 切换项目时先清掉当前项目的会话缓存，避免把旧项目的聊天记录写到新项目下。 */
function askResetForProject() {
  const a = state.ask;
  if (!a) return;
  if (askSyncTimer) { clearTimeout(askSyncTimer); askSyncTimer = null; }
  askAbortRuns();
  a.conversations = null;
  a.activeId = '';
  a.draft = '';
  a.attachments = [];
  a.loading = false;
  a.error = '';
  a.trajectory = null;
  a.rename = { open: false, id: '', text: '' };
  a.projectHistory = null;
  a.projectHistoryAt = 0;
}

function askSelect(id) {
  const a = askState();
  askSetSkills([]);
  a.previewFile = null;
  a.workspacePage = 'console';
  a.mention = null;
  a.activeId = id;
  a.draft = '';
  a.attachments = [];
  askSyncRunState();
  askRemember();
  askRenderAll();
  askScrollBottom();
  if (askRunOf(id) && askRunOf(id).attached) askAttachRun(id);
}

function askPreview(c) {
  const last = (c.messages || []).filter((m) => m.role === 'user').slice(-1)[0];
  return last ? String(last.text || '').slice(0, 35) : '开始一个新的创作问题';
}

function askTimeText(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/* ------------------------------- 渲染 ------------------------------- */

function askMarkdownFor(message) {
  const text = String((message && message.text) || '');
  if (message && message._mdHtml && message._mdLen === text.length && message._mdRaw === text) return message._mdHtml;
  const html = markdownLite(text);
  if (message) { message._mdHtml = html; message._mdLen = text.length; message._mdRaw = text; }
  return html;
}

function askMarkdown(text) {
  return markdownLite(text);
}

// 把一次运行的真实轨迹（思考 / 工具调用 / 结果）整理成可折叠的行
function askTraceRows(msg) {
  const items = (msg && (msg.trajectory || msg.liveTrajectory)) || [];
  const rows = [];
  for (const item of items) {
    const kind = item.kind || '';
    if (item.kind === 'model_input') { rows.push({type:'input',name:'第 '+item.cycle+' 轮输入',text:'实际上下文',full:item.content,key:item.id}); continue; }
    if (item.kind === 'model_end' || item.kind === 'model_failed') { rows.push({type:'cycle',name:'第 '+item.cycle+' 轮'+(item.kind === 'model_failed'?'失败':'结束'),text:item.kind === 'model_failed'?item.content:(JSON.parse(item.content || '{}').reasoning_available?'':'未返回推理文本'),full:item.content,key:item.id}); continue; }
    if (item.kind === 'reasoning') { rows.push({type:'think',text:item.content,key:item.id}); continue; }
    if (item.role === 'user') continue;
    if (item.role === 'assistant' && kind === 'final') continue;
    if (item.role === 'assistant') {
      const calls = Array.isArray(item.tool_calls) ? item.tool_calls : [];
      const text = String(item.content || '').trim();
      if (text && calls.length) rows.push({ type: 'explanation', text, key:item.id });
      for (const call of calls) {
        let args = '';
        try { args = typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {}); } catch { args = ''; }
        rows.push({ key:call.id, type: 'tool', name: call.name || 'tool', full: args, args: String(args || '').replace(/\s+/g, ' ').slice(0, 80) });
      }
      if (text && !calls.length) rows.push({ type: 'explanation', text, key:item.id });
      continue;
    }
    if (item.role === 'tool') {
      rows.push({ key:item.id || ('result:'+item.tool_call_id), type: 'result', name: item.tool_name || '', status: item.status || 'success', full: String(item.content || ''), text: String(item.content || '').replace(/\s+/g, ' ') });
    }
  }
  return rows;
}

function askTraceRowHtml(row, index = 0, expanded = false) {
  const failed = row.type === 'result' && row.status && row.status !== 'success';
  const label = row.type === 'think' ? '思考' : row.type === 'explanation' ? '说明' : row.type === 'input' ? '输入' : row.type === 'cycle' ? '循环' : row.type === 'tool' ? '运行命令' : failed ? '失败' : '结果';
  const icon = row.type === 'think' ? '✳' : row.type === 'tool' ? '›_' : '↳';
  const brief = row.type === 'tool' ? row.name + (row.args ? ' · ' + row.args : '') : (row.name ? row.name + '：' : '') + (row.text || '');
  const full = row.full ?? (row.type === 'tool' ? row.args : row.text) ?? '';
  return '<li class="is-'+esc(row.type)+(failed?' is-failed':'')+'"><details class="ask-trace-row-detail"'+(expanded?' open':'')+'><summary data-act="ask-trace-row-toggle" data-row="'+esc(row.key || String(index))+'"><span class="ask-row-ico">'+icon+'</span><b>'+label+'</b><em>'+esc(brief)+'</em></summary><pre>'+esc(row.type === 'tool' ? row.name+'\n'+full : full)+'</pre></details></li>';
}

// 拉取某条回复对应运行的完整轨迹（思考 / 工具调用），用于消息里的“执行过程”
const askTraceLoading = new Set();
async function askLoadMessageTrace(msg, runId, chatId) {
  const a = askState();
  const sid = chatId || a.activeId;
  const id = String(runId || (msg && msg.execution && msg.execution.id) || '');
  if (!id || !sid) return;
  if (askTraceLoading.has(id)) return;
  askTraceLoading.add(id);
  if (msg) { msg._traceLoading = true; msg._traceError = ''; }
  if (state.route === 'script') askRenderMessages();
  try {
    const data = await askApi('/sessions/' + encodeURIComponent(sid) + '/trajectory?run_id=' + encodeURIComponent(id)).then((r) => r.json());
    const items=[];
    items.push(...((data && data.items) || []));
    let next=data?.next_offset;
    while (next != null) {
      const page=await askApi('/sessions/'+encodeURIComponent(sid)+'/trajectory?run_id='+encodeURIComponent(id)+'&offset='+next+'&limit=100').then(r=>r.json());
      items.push(...(page.items || []));
      if (page.next_offset === next) break;
      next=page.next_offset;
    }
    msg.trajectory = items;
  } catch (err) {
    // 失败不要留空数组：留着未加载状态，用户还能重试
    msg.trajectory = undefined;
    msg._traceError = (err && err.message) || '执行过程加载失败';
  } finally {
    askTraceLoading.delete(id);
    if (msg) msg._traceLoading = false;
  }
  if (state.route === 'script') askRenderMessages();
}

function askExecutionTools(msg) {
  if (msg.liveTools?.length) return msg.liveTools;
  if (msg.execution?.tools?.length) return msg.execution.tools;
  const tools = [];
  for (const item of msg.trajectory || []) {
    if (item.role === 'assistant') for (const call of item.tool_calls || []) tools.push({ id: call.id, name: call.name, status: 'running' });
    if (item.role === 'tool') {
      const tool = tools.find(t => item.tool_call_id ? t.id === item.tool_call_id : t.name === item.tool_name && t.status === 'running');
      if (tool) tool.status = item.status || 'success';
      else tools.push({ name: item.tool_name, status: item.status || 'success' });
    }
  }
  return tools;
}

function askPlanHistoryHtml(exec, expanded = false) {
  const planSteps = exec.plan?.steps?.length ? exec.plan.steps : (exec.steps || []);
  if (!planSteps.length) return '';
  const stepHtml = planSteps.map((step, index) => {
    const stateText = { pending: '待执行', running: '执行中', completed: '已完成', blocked: '待补充' }[step.status] || step.status;
    const icon = step.status === 'completed' ? '✓' : step.status === 'running' ? '◐' : step.status === 'blocked' ? '!' : index + 1;
    return `<li class="${esc(step.status || '')}">
      <span class="ask-node">${icon}</span>
      <div class="ask-step">
        <div class="ask-step-title"><b>${esc(step.title || '')}</b><span>${esc(stateText)}</span></div>
        <p class="ask-step-purpose">${esc(step.purpose || '')}</p>
        ${step.output ? `<div class="ask-step-output"><small>本步产出 <span>模型分析</span></small><div class="ask-md">${askMarkdown(step.output)}</div></div>` : ''}
        ${(step.evidence && step.evidence.length) ? `<details class="ask-evidence"><summary>依据材料 · ${step.evidence.length} 项 ›</summary>${step.evidence.map((s) => `<div><b>${esc(s.title || '')}</b><span>${esc(s.kind === 'guidance' ? '指导文档' : s.kind === 'workspace' ? '工作空间文件' : s.kind === 'artifact' ? '生成的交付文件' : '用户提供')} · ${esc(s.id || '')}</span><p>${esc(String(s.content || ''))}</p></div>`).join('')}</details>` : ''}
      </div></li>`;
  }).join('');
  return '<details class="ask-trace-section ask-plan-history ask-trace-fold" aria-label="计划流程与依据"'+(expanded?' open':'')+'><summary data-act="ask-trace-section-toggle" data-section="plan">计划流程</summary>'+(exec.plan?.goal?'<p class="ask-goal">'+esc(exec.plan.goal)+'</p>':'')+'<ol class="ask-steps">'+stepHtml+'</ol></details>';
}

function askTraceHtml(msg, pending) {
  const exec = msg.execution;
  if (!exec) return pending ? '<p class="ask-process-note">执行中…</p>' : '';
  const planHtml = askPlanHistoryHtml(exec, msg.planSectionOpen === true);
  const rows = askTraceRows(msg);
  if (!rows.length) for (const tool of msg.execution?.tools || []) { rows.push({type:'tool',name:tool.name,args:''}); rows.push({type:'result',name:tool.name,status:tool.status,text:tool.output || ''}); }
  const runId = exec.id || '';
  const loading = !!msg._traceLoading;
  const failed = !!msg._traceError;
  const loaded = Array.isArray(msg.trajectory);
  const canLoad = !loaded && !!runId;
  const open = msg.traceOpen === true;
  const running = !!pending || exec.status === 'running';
  if (running && msg._t0 == null) msg._t0 = Date.now();
  const since = running ? Number(msg._t0) || Date.now() : 0;
  const headText = askHeading(exec, pending, msg);
  const headInner = running ? '<span class="ask-trace-live" data-trace-live data-since="'+since+'"><span class="ask-trace-live-text">'+esc(headText)+'</span><span class="ask-trace-live-time"> · '+esc(askDurationText(Date.now()-since))+'</span></span>' : '<span>'+esc(headText)+'</span>';
  if (loaded && !rows.length && !planHtml && !pending) return '<div class="ask-trace is-static"><div class="ask-trace-head is-static"><span>'+esc(headText)+'</span></div></div>';
  const toolHtml = rows.map((row, index) => askTraceRowHtml(row, index, !!msg.traceRowsOpen?.[row.key || String(index)])).join('');
  return '<section class="ask-trace '+(pending?'is-running ':'')+(open?'is-open':'')+'" data-trace-run="'+esc(runId)+'"><button type="button" class="ask-trace-head" data-act="ask-trace-toggle" data-run="'+esc(runId)+'" aria-expanded="'+open+'">'+headInner+'<span class="ask-chev">'+(open?'⌄':'›')+'</span></button>'+(open?'<div class="ask-trace-body">'+(toolHtml?'<details class="ask-trace-section ask-trace-fold" aria-label="工具调用轨迹"'+(msg.traceSectionOpen?' open':'')+'><summary data-act="ask-trace-section-toggle" data-section="trace">轨迹</summary><ul class="ask-trace-rows">'+toolHtml+'</ul></details>':'')+planHtml+((loading || (canLoad&&!pending&&!failed))?'<p class="ask-trace-empty">正在加载执行过程…</p>':'')+(failed?'<button type="button" class="ask-trace-load" data-act="ask-load-trace" data-run="'+esc(runId)+'" title="'+esc(msg._traceError)+'">重新加载执行过程</button>':'')+'</div>':'')+'</section>';
}

function askPlanDockHtml(chat) {
  const msg = [...(chat?.messages || [])].reverse().find(m => m.role === 'assistant');
  const plan = msg?.execution?.plan;
  if (!plan?.steps?.length) return '';
  const steps = plan.steps;
  if (steps.every(step => step.status === 'pending' || !step.status)) return '';
  const completed = steps.filter(s => s.status === 'completed').length;
  const labels = {pending:'待执行',running:'执行中',completed:'已完成',blocked:'待补充',failed:'失败',cancelled:'已取消'};
  const ended = msg.execution.status !== 'running' && !msg._streaming;
  const open = msg.planCollapsed === false;
  return '<section class="ask-plan-dock" aria-label="任务计划"><button type="button" class="ask-plan-head" data-act="ask-plan-toggle" aria-expanded="'+open+'"><b>任务计划</b><span>'+completed+' / '+steps.length+' 已完成'+(ended?' · 本轮已结束':'')+'</span><span class="ask-plan-chevron">'+(open?'⌄':'›')+'</span></button>'+(open?'<div class="ask-plan-scroll">'+(plan.goal?'<p>'+esc(plan.goal)+'</p>':'')+'<ol>'+steps.map((step,i)=>'<li class="is-'+esc(step.status || 'pending')+'"><span class="ask-plan-index">'+(step.status==='completed'?'✓':step.status==='running'?'◐':i+1)+'</span><b>'+esc(step.title || '')+'</b><small>'+esc(labels[step.status]||'待执行')+'</small></li>').join('')+'</ol></div>':'')+'</section>';
}

function askSyncPlanDock(chatId) {
  const chat = askActive();
  if (!chat || (chatId && chat.id !== chatId)) return;
  const host = document.getElementById('ask-plan-dock');
  if (!host) return;
  const scroll = host.querySelector('.ask-plan-scroll')?.scrollTop || 0;
  host.innerHTML = askPlanDockHtml(chat);
  const next = host.querySelector('.ask-plan-scroll');
  if (next) next.scrollTop = scroll;
}

// 展开执行过程就等于要看到内容：渲染后自动把没加载的轨迹拉回来，不再多一个「加载执行过程」按钮。
// 流式过程中先看实时行（execution.steps / tools），本轮结束后自动补全。
function askTraceAutoLoad(chat) {
  if (!chat || state.route !== 'script') return;
  for (const msg of chat.messages || []) {
    if (!msg || msg.role !== 'assistant') continue;
    const exec = msg.execution;
    if (!exec || !exec.id) continue;
    if (Array.isArray(msg.trajectory) || msg._traceError || msg._traceLoading) continue;
    if (!msg.traceOpen || msg._streaming) continue;
    askLoadMessageTrace(msg, exec.id, chat.id).catch(() => {});
  }
}

/* ---- 执行中的实时状态：不是固定一句「执行中」，而是跟着工具在干什么走 ---- */
const ASK_TOOL_ACTIONS = {
  run_command: ['准备运行命令', '执行了命令', '命令执行失败'],
  write_file: ['准备写入文件', '已写入文件', '写入文件失败'],
  read_file: ['准备读取文件', '已读取文件', '读取文件失败'],
  list_dir: ['准备查看目录', '已查看目录', '查看目录失败'],
  make_dir: ['准备创建目录', '已创建目录', '创建目录失败'],
  move_file: ['准备移动文件', '已移动文件', '移动文件失败'],
  copy_file: ['准备复制文件', '已复制文件', '复制文件失败'],
  delete_file: ['准备删除文件', '已删除文件', '删除文件失败'],
  read_permission: ['正在确认权限', '已确认权限', '确认权限失败'],
  generate_image: ['准备生成图片', '已生成图片', '生成图片失败'],
  submit_video_job: ['准备提交视频任务', '已提交视频任务', '提交视频任务失败'],
  extract_frames: ['准备抽帧', '已抽帧', '抽帧失败'],
  create_workspace_artifact: ['准备写入交付文件', '已写入交付文件', '写入交付文件失败'],
  publish_artifact: ['准备交付文件', '已交付文件', '交付文件失败'],
  create_task_plan: ['正在制定计划', '已制定计划', '制定计划失败'],
  record_step_result: ['正在记录步骤结果', '已记录步骤结果', '记录步骤结果失败'],
  read_analysis_guidance: ['正在读取指导文档', '已读取指导文档', '读取指导文档失败'],
  ask_choice: ['正在准备选项面板', '已发出选项面板', '选项面板失败'],
};

function askDurationText(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? minutes + '分' + (rest ? rest + '秒' : '') : seconds + '秒';
}

// 这一步在做什么：工具名 + 参数/结果摘要（命令、路径、文件名）
function askLiveStatus(msg) {
  const live = (msg && msg.live) || null;
  if (!live || !live.tool) return { text: '正在分析请求', detail: (live && live.detail) || '' };
  const phases = ASK_TOOL_ACTIONS[live.tool];
  const word = live.phase === 'running' ? 0 : live.phase === 'failed' ? 2 : 1;
  const text = phases
    ? phases[word]
    : live.phase === 'running' ? '准备执行 ' + live.tool : live.phase === 'failed' ? '执行 ' + live.tool + ' 失败' : '已执行 ' + live.tool;
  return { text, detail: live.detail || '' };
}

let askLiveTimer = 0;
// 只改时间文字，不整页重绘：一次长命令跑几分钟也能一直走秒
function askEnsureLiveTicker() {
  if (askLiveTimer) return;
  askLiveTimer = setInterval(() => {
    const nodes = document.querySelectorAll('[data-trace-live]');
    if (!nodes.length) return;
    for (const node of nodes) {
      const since = Number(node.dataset.since) || 0;
      const time = node.querySelector('.ask-trace-live-time');
      if (!since || !time) continue;
      time.textContent = ' · ' + askDurationText(Date.now() - since);
    }
  }, 1000);
}

function askHeading(exec, pending, msg) {
  if (pending || (exec && exec.status === 'running')) {
    if (msg && msg._t0 == null) msg._t0 = Date.now();
    const live = askLiveStatus(msg);
    return live.detail ? live.text + ' · ' + live.detail : live.text;
  }
  const labels = { completed: '已完成', succeeded: '已完成', partial: '部分完成', blocked: '待补充', failed: '执行失败', cancelled: '已停止', budget_exceeded: '已达预算上限', interrupted: '执行中断' };
  const status = labels[(exec && (exec.outcome || exec.status)) || ''] || '历史回复';
  const ms = exec && (exec.duration_ms != null ? exec.duration_ms : (exec.finished_at != null && exec.started_at != null ? exec.finished_at - exec.started_at : null));
  if (ms == null || !Number.isFinite(ms)) return status;
  return status + '，用时' + askDurationText(ms);
}

function askFilesHtml(files) {
  if (!files || !files.length) return '';
  return `<div class="ask-files">${files.map((f) => `<button type="button" class="ask-file" data-act="ask-preview" data-id="${esc(f.id)}" title="${esc(f.name || '')}">
    <span class="ask-file-icon">${/(\.md|\.txt|\.json|\.csv)$/i.test(f.name || '') ? '📄' : '📎'}</span>
    <span><b>${esc(f.name || '文件')}</b><small>${f.size ? fmtBytes(f.size) : ''}</small></span>
  </button>`).join('')}</div>`;
}

/* ------------------- 对话里的交互组件（豆包 GenUI / DIL） ------------------- */
// 豆包系模型偶尔会把交互组件源码直接写进回复：
//   {@body const [style,setStyle] = DIL.useState("诗意苍凉")}
//   <box border radius="xl" padding={4} gap={4}>
//     <text weight="medium">1. 整体氛围</text>
//     <radio-group value={style} onChange={setStyle}>…</radio-group>
//     <button block onClick={() => GenUI.issueNewTurn("…"+style+"…")}>生成</button>
//   </box>
// 这里把它还原成真实的单选卡片 + 动作按钮，标签不会再裸露在对话正文里。

const askGenUiMemory = new Map();
const GU_TAG_SRC = '<(\\/?)([a-zA-Z][\\w-]*)((?:\\{[^{}]*\\}|"[^"]*"|\'[^\']*\'|[^<>"\'])*?)(\\/?)>';

/* --- 格式协议 ---------------------------------------------------------------
   一条回复里只允许两种格式，且必须靠标签边界区分清楚：
   1) 正文 = Markdown：普通文字、标题、列表、表格、代码块。这里出现的 <…> 一律当文字。
   2) 组件 = 下面这张白名单里的标签，标签名大小写不敏感、可写 GridItem / Column 这类别名。
   任何不在白名单里的标签都不进正文：带属性的（<Foo bar="1"/>）、自闭合的组件式标签
   直接吞掉，避免把模型内部协议漏给用户；正文里的素材编号 <Picture N>、<Subject N>、
   <Audio N>、台词 <d>[Chinese] …</d> 没有属性，照原样保留。                              */
const GU_RENDER_TAGS = new Set([
  'box', 'card', 'panel', 'row', 'col', 'stack', 'group', 'grid', 'grid-item',
  'text', 'image', 'img', 'asyncimage', 'asyncimagegroup', 'divider',
  'radio-group', 'checkbox-group', 'radio', 'checkbox', 'option', 'choice',
  'button', 'input', 'textarea', 'link', 'a', 'tag',
]);
const GU_CONTAINER_TAGS = new Set(['box', 'card', 'panel', 'row', 'col', 'stack', 'group', 'grid', 'grid-item']);
const GU_TAG_ALIASES = {
  column: 'col', columns: 'col', section: 'box', container: 'box', wrapper: 'box', layout: 'box',
  caption: 'text', label: 'text', paragraph: 'text',
  item: 'grid-item', hr: 'divider', chip: 'tag', badge: 'tag',
  checkboxgroup: 'checkbox-group', radiogroup: 'radio-group', select: 'radio-group',
};
const GU_SAFE_PROSE_TAGS = new Set(['b', 'i', 'u', 's', 'em', 'strong', 'code', 'br', 'sub', 'sup', 'mark', 'small', 'kbd', 'del', 'ins']);
const GU_TAG_CANON = new Map();
for (const name of GU_RENDER_TAGS) GU_TAG_CANON.set(name.replace(/-/g, ''), name);
for (const [alias, name] of Object.entries(GU_TAG_ALIASES)) GU_TAG_CANON.set(alias.replace(/-/g, ''), name);

function guTagName(raw) {
  const flat = String(raw == null ? '' : raw).toLowerCase().replace(/[-_\s]/g, '');
  return GU_TAG_CANON.get(flat) || String(raw == null ? '' : raw).toLowerCase();
}

// 一眼能看出是不是组件协议：白名单标签、带属性、或大写开头的自闭合标签
function guLooksComponent(name, attrs, selfClose) {
  const tag = guTagName(name);
  if (GU_RENDER_TAGS.has(tag)) return true;
  if (GU_SAFE_PROSE_TAGS.has(tag)) return false;
  if (/=/.test(String(attrs || ''))) return true;
  return !!selfClose && /^[A-Z]/.test(String(name || ''));
}

// 万一有标签漏到 Markdown 段落里（流式中途、模型忘闭合），这里兜底不再裸露
function guScrubLeaks(text) {
  let out = String(text == null ? '' : text);
  if (out.indexOf('<') < 0) return out;
  const whole = out;
  out = out.replace(new RegExp(GU_TAG_SRC, 'g'), (all, close, name, attrs, selfClose, offset) => {
    if (guInCode(whole, offset)) return all;                  // 代码块里讨论的标签是文字
    if (GU_RENDER_TAGS.has(guTagName(name))) return '';        // 组件标签漏进正文：吞掉
    if (GU_SAFE_PROSE_TAGS.has(guTagName(name))) return all;   // <br> 这类内联 HTML 原样保留
    if (close) return all;                                     // </d> 这类正文标记保留
    return guLooksComponent(name, attrs, selfClose) ? '' : all;
  });
  // 流式输出时尾巴上那半个标签也别闪出来
  const tail = /<\s*\/?([A-Za-z][\w:-]*)((?:\s[^<>]*)?)$/.exec(out);
  if (tail && !guInCode(out, tail.index) && guLooksComponent(tail[1], tail[2] || '', /\/$/.test(out))) out = out.slice(0, tail.index);
  return out;
}

// 引号没写完的组件标签（流式中途最常见）连 GU_TAG_SRC 都匹配不到，按行兜底：
// 能捞到画面描述就重建成规范标签，捞不到就整行丢掉
function guLooseAttrs(body) {
  const out = {};
  const re = /([A-Za-z_][\w:-]*)\s*=\s*(?:"([^"]*)"?|'([^']*)'?|([^\s>]+))/g;
  let m;
  const src = String(body || '');
  while ((m = re.exec(src))) out[m[1]] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
  return out;
}

function guFixStrayTags(text) {
  const src = String(text == null ? '' : text);
  if (src.indexOf('<') < 0) return src;
  const lines = src.split('\n');
  const atStart = new RegExp('^[ \\t]*' + GU_TAG_SRC);
  let fence = false;
  let changed = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    if ((line.match(/`/g) || []).length % 2 === 1) continue;
    const head = /^[ \t]*<\s*\/?([A-Za-z][\w:-]*)/.exec(line);
    if (!head) continue;
    const name = head[1];
    if (atStart.test(line)) continue;                          // 正常闭合的标签，交给分段器
    const tag = guTagName(name);
    if (GU_SAFE_PROSE_TAGS.has(tag)) continue;
    if (!GU_RENDER_TAGS.has(tag) && !/^[A-Z]/.test(name)) continue;
    const attrs = guLooseAttrs(line);
    const query = attrs.query || attrs.prompt || attrs.queries || '';
    const ratio = String(attrs.aspectRatio || attrs.aspect_ratio || attrs.ratio || '').replace(/\/+$/, '');
    lines[i] = query
      ? `<AsyncImage query="${String(query).replace(/"/g, "'")}"${ratio ? ` aspectRatio="${ratio.replace(/"/g, '')}"` : ''}/>`
      : '';
    changed = true;
  }
  return changed ? lines.join('\n') : src;
}

function guReadString(src, index) {
  const quote = src[index];
  let out = '';
  let i = index + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const next = src[i + 1];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 2;
      continue;
    }
    if (ch === quote) return { value: out, next: i + 1 };
    out += ch;
    i += 1;
  }
  return { value: out, next: src.length };
}

// 只做字符串拼接求值，不执行模型给的任意代码
function guEvalExpr(expr, values) {
  let src = String(expr == null ? '' : expr).trim();
  if (!src) return '';
  const store = values || {};
  const call = /GenUI\.[A-Za-z_$][\w$]*\s*\(/.exec(src);
  if (call) {
    let i = call.index + call[0].length;
    const start = i;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '"' || ch === "'") { i = guReadString(src, i).next; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    src = src.slice(start, Math.max(start, i - 1));
  }
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") { const r = guReadString(src, i); out += r.value; i = r.next; continue; }
    if (ch === '`') {
      let k = i + 1;
      while (k < src.length && src[k] !== '`') {
        if (src[k] === '$' && src[k + 1] === '{') {
          let depth = 1;
          let e = k + 2;
          while (e < src.length && depth > 0) {
            if (src[e] === '{') depth += 1;
            else if (src[e] === '}') depth -= 1;
            e += 1;
          }
          out += guEvalExpr(src.slice(k + 2, Math.max(k + 2, e - 1)), store);
          k = e;
          continue;
        }
        out += src[k];
        k += 1;
      }
      i = k + 1;
      continue;
    }
    const ident = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
    if (ident) {
      const name = ident[0];
      if (Object.prototype.hasOwnProperty.call(store, name)) out += String(store[name] == null ? '' : store[name]);
      i += name.length;
      continue;
    }
    i += 1;
  }
  return out;
}

function guStateDecls(text) {
  const decls = {};
  const re = /\{@body\s+const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*DIL\.useState\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)?\s*\)\s*\}/g;
  const src = String(text || '');
  let m;
  while ((m = re.exec(src))) {
    decls[m[1]] = { setter: m[2], value: m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : '' };
  }
  return decls;
}

function guStripDecls(text) {
  return String(text || '').replace(/^[ \t]*\{@body[^\n]*\}[ \t]*\r?\n?/gm, '').replace(/^[ \t]*\{@body[^\n]*\}[ \t]*/gm, '');
}

// 代码块/行内代码里的标签是“被讨论的文字”，不能当组件执行
function guInCode(src, index) {
  const upto = String(src || '').slice(0, Math.max(0, index));
  if ((upto.match(/```/g) || []).length % 2 === 1) return true;
  const line = upto.slice(upto.lastIndexOf('\n') + 1);
  return (line.match(/`/g) || []).length % 2 === 1;
}

function guLocateBlock(text) {
  const src = String(text || '');
  // 块首 = 任意白名单标签（不只是容器）。模型常常单独甩一个 <AsyncImage …/> 或
  // <text …>…</text>，只认容器的话这段协议就会原样漏进正文。
  const probe = new RegExp(GU_TAG_SRC, 'g');
  let head = null;
  let m;
  while ((m = probe.exec(src))) {
    if (m[1]) continue;
    if (!GU_RENDER_TAGS.has(guTagName(m[2]))) continue;
    if (guInCode(src, m.index)) continue;
    head = { index: m.index, end: probe.lastIndex, selfClose: !!m[4] };
    break;
  }
  if (!head) return null;
  if (head.selfClose) return { start: head.index, end: head.end, body: src.slice(head.index, head.end), partial: false };
  const re = new RegExp(GU_TAG_SRC, 'g');
  re.lastIndex = head.index;
  let depth = 0;
  while ((m = re.exec(src))) {
    if (m[4]) continue;
    if (m[1]) {
      depth -= 1;
      if (depth <= 0) return { start: head.index, end: re.lastIndex, body: src.slice(head.index, re.lastIndex), partial: false };
    } else {
      depth += 1;
    }
  }
  return { start: head.index, end: src.length, body: src.slice(head.index), partial: true };
}

function guSegments(text) {
  const segs = [];
  let rest = String(text || '');
  for (let guard = 0; guard < 400; guard += 1) {
    const block = guLocateBlock(rest);
    if (!block) { segs.push({ type: 'md', value: rest }); break; }
    if (block.start > 0) segs.push({ type: 'md', value: rest.slice(0, block.start) });
    if (block.partial) {
      // 模型忘闭合时只吃掉这一行组件，后面的正文继续按 Markdown 排，别整段被一个标签吞掉
      const src = rest.slice(block.start);
      const cut = src.search(/\n\s*\n/);
      const body = cut > 0 ? src.slice(0, cut) : src;
      if (body.replace(/\s/g, '').length < 40) segs.push({ type: 'pending' });
      else segs.push({ type: 'ui', body });
      if (cut > 0) { rest = src.slice(cut); continue; }
      break;
    }
    segs.push({ type: 'ui', body: block.body });
    rest = rest.slice(block.end);
  }
  return segs;
}

function guParseAttrs(raw) {
  const out = {};
  const src = String(raw || '');
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (i >= src.length) break;
    const name = /^[A-Za-z_][\w:-]*/.exec(src.slice(i));
    if (!name) { i += 1; continue; }
    const key = name[0];
    i += key.length;
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] !== '=') { out[key] = { kind: 'flag', value: true }; continue; }
    i += 1;
    while (i < src.length && /\s/.test(src[i])) i += 1;
    const quote = src[i];
    if (quote === '"' || quote === "'") {
      const read = guReadString(src, i);
      out[key] = { kind: 'str', value: read.value };
      i = read.next;
      continue;
    }
    if (quote === '{') {
      let depth = 1;
      let k = i + 1;
      while (k < src.length && depth > 0) {
        if (src[k] === '{') depth += 1;
        else if (src[k] === '}') depth -= 1;
        k += 1;
      }
      out[key] = { kind: 'expr', value: src.slice(i + 1, Math.max(i + 1, k - 1)) };
      i = k;
      continue;
    }
    const bare = /^[^\s>]+/.exec(src.slice(i));
    out[key] = { kind: 'str', value: bare ? bare[0] : '' };
    i += bare ? bare[0].length : 1;
  }
  return out;
}

function guPushText(parent, raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (text) parent.children.push({ name: '#text', text });
}

function guBuildTree(body) {
  const src = String(body || '');
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = new RegExp(GU_TAG_SRC, 'g');
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > last) guPushText(stack[stack.length - 1], src.slice(last, m.index));
    last = re.lastIndex;
    const tag = guTagName(m[2]);
    if (m[1]) {
      for (let k = stack.length - 1; k > 0; k -= 1) if (stack[k].name === tag) { stack.length = k; break; }
      continue;
    }
    const node = { name: tag, attrs: guParseAttrs(m[3]), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  if (last < src.length) guPushText(stack[stack.length - 1], src.slice(last));
  return root;
}

function guAttrText(node, name, ctx) {
  const attr = node.attrs && node.attrs[name];
  if (!attr) return '';
  if (attr.kind === 'expr') return guEvalExpr(attr.value, ctx.values);
  return String(attr.value == null ? '' : attr.value);
}

function guExprOf(node, name) {
  const attr = node.attrs && node.attrs[name];
  return attr && attr.kind === 'expr' ? String(attr.value || '') : '';
}

function guBindKey(node, ctx) {
  const bound = guExprOf(node, 'value').trim();
  if (bound) {
    if (ctx.decls[bound]) return bound;
    for (const [key, decl] of Object.entries(ctx.decls)) if (decl.setter === bound) return key;
    return bound;
  }
  const change = guExprOf(node, 'onChange').trim();
  if (change) for (const [key, decl] of Object.entries(ctx.decls)) if (decl.setter === change) return key;
  return '';
}

function guRenderChildren(node, ctx) {
  return (node.children || []).map((child) => guRenderNode(child, ctx)).join('');
}

function guRenderNode(node, ctx) {
  if (!node) return '';
  if (node.name === '#text') return mdInline(node.text || '');
  const children = () => guRenderChildren(node, ctx);
  switch (node.name) {
    case 'box':
    case 'card':
    case 'panel':
    case 'row':
    case 'col':
    case 'stack':
    case 'group': {
      const cls = ['gu-box'];
      if (node.name === 'row') cls.push('is-row');
      if (node.attrs.border) cls.push('has-border');
      if (node.attrs.flex) cls.push('is-flex');
      return `<div class="${cls.join(' ')}">${children()}</div>`;
    }
    case 'grid': {
      const cols = Math.max(1, Math.min(4, Number(guAttrText(node, 'columns', ctx) || guAttrText(node, 'cols', ctx)) || 2));
      return `<div class="gu-grid" data-cols="${cols}">${children()}</div>`;
    }
    case 'grid-item':
    case 'griditem':
      return `<div class="gu-grid-item">${children()}</div>`;
    case 'asyncimagegroup': {
      const raw = guExprOf(node, 'query') || guExprOf(node, 'queries') || guExprOf(node, 'prompts');
      let queries = [];
      try {
        const parsed = JSON.parse(String(raw || '').trim() || '[]');
        if (Array.isArray(parsed)) queries = parsed.map((q) => String(q || ''));
      } catch { /* 不是 JSON 就按引号切 */ }
      if (!queries.length) queries = (String(raw || '').match(/["'`]([^"'`]+)["'`]/g) || []).map((s) => s.slice(1, -1));
      if (!queries.length) return '';
      const ratio = guAttrText(node, 'aspectRatio', ctx) || guAttrText(node, 'aspect_ratio', ctx) || guAttrText(node, 'ratio', ctx);
      return `<div class="gu-grid gu-ref-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,236px));gap:10px;justify-content:start;max-width:100%">${queries.map((q) => guRefCardHtml(q, ratio)).join('')}</div>`;
    }
    case 'text': {
      const weight = guAttrText(node, 'weight', ctx);
      const size = guAttrText(node, 'size', ctx);
      const tone = guAttrText(node, 'color', ctx);
      const cls = ['gu-text'];
      if (weight === 'medium' || weight === '500') cls.push('is-medium');
      if (weight === 'bold' || weight === '600' || weight === '700') cls.push('is-bold');
      if (size === 'sm' || size === 'small') cls.push('is-sm');
      if (tone === 'secondary' || tone === 'muted') cls.push('is-muted');
      // 组件里的文字如果带标题、表格、列表这类块级 markdown，就按正文排版渲染，别挤成一段
      const raw = (node.children || []).map((child) => (child && child.name === '#text' ? String(child.text || '') : '')).join('');
      if (/(^|\n)\s*(#{1,6}\s|\||[-*+]\s|\d+[.)]\s|>)/.test(raw) || /^\s*\|/.test(raw)) {
        return `<div class="${cls.join(' ')} is-block">${askMarkdown(raw)}</div>`;
      }
      return `<p class="${cls.join(' ')}">${children()}</p>`;
    }
    case 'asyncimage':
    case 'image':
    case 'img': {
      const src = guAttrText(node, 'src', ctx);
      if (src) return `<img class="gu-image" src="${esc(src)}" alt="${esc(guAttrText(node, 'alt', ctx))}" loading="lazy" />`;
      const query = guAttrText(node, 'query', ctx) || guAttrText(node, 'prompt', ctx) || guAttrText(node, 'alt', ctx);
      const ratio = guAttrText(node, 'aspectRatio', ctx) || guAttrText(node, 'aspect_ratio', ctx) || guAttrText(node, 'ratio', ctx);
      return guRefCardHtml(query, ratio);
    }
    case 'divider':
    case 'hr':
      return '<hr class="gu-divider">';
    case 'radio-group':
    case 'checkbox-group': {
      const multi = node.name === 'checkbox-group';
      const key = guBindKey(node, ctx);
      const current = ctx.values[key];
      const row = guAttrText(node, 'direction', ctx) === 'row';
      const options = (node.children || []).map((child) => {
        if (child.name === '#text') return '';
        if (!['radio', 'checkbox', 'option', 'choice'].includes(child.name)) return guRenderNode(child, ctx);
        const value = guAttrText(child, 'value', ctx) || String((child.children || []).map((c) => c.text || '').join('').trim());
        const on = multi ? (Array.isArray(current) && current.includes(value)) : String(current == null ? '' : current) === value;
        return `<button type="button" class="gu-option${on ? ' is-on' : ''}" data-act="gu-pick" data-gu-key="${esc(key)}" data-gu-value="${esc(value)}" data-gu-multi="${multi ? 1 : 0}" aria-pressed="${on ? 'true' : 'false'}"><span class="gu-dot"></span><span class="gu-option-label">${guRenderChildren(child, ctx)}</span></button>`;
      }).join('');
      return `<div class="gu-options${row ? ' is-row' : ''}"${key ? ` data-gu-group="${esc(key)}"` : ''}>${options}</div>`;
    }
    case 'radio':
    case 'checkbox':
    case 'option':
      return children();
    case 'button': {
      const expr = guExprOf(node, 'onClick');
      const copy = /GenUI\.copy\s*\(/.test(expr);
      const cls = ['gu-action'];
      if (node.attrs.block) cls.push('is-block');
      const variant = guAttrText(node, 'variant', ctx);
      if (variant === 'secondary' || variant === 'outline' || variant === 'ghost') cls.push('is-ghost');
      const attr = copy ? `data-act="gu-copy" data-gu-expr="${esc(expr)}"` : `data-act="gu-run" data-gu-expr="${esc(expr)}"`;
      return `<button type="button" class="${cls.join(' ')}" ${attr}${copy ? ' title="复制这段提示词"' : ''}>${children() || (copy ? '复制' : '继续')}</button>`;
    }
    case 'input':
    case 'textarea': {
      const key = guBindKey(node, ctx);
      const value = ctx.values[key];
      const placeholder = guAttrText(node, 'placeholder', ctx);
      const field = node.name === 'textarea'
        ? `<textarea class="gu-input" rows="2" placeholder="${esc(placeholder)}"${key ? ` data-gu-key="${esc(key)}"` : ''}>${esc(value == null ? '' : value)}</textarea>`
        : `<input class="gu-input" type="text" placeholder="${esc(placeholder)}" value="${esc(value == null ? '' : value)}"${key ? ` data-gu-key="${esc(key)}"` : ''} />`;
      return field;
    }
    case 'link':
    case 'a': {
      const href = guAttrText(node, 'href', ctx);
      return href ? `<a class="gu-link" href="${esc(href)}" target="_blank" rel="noreferrer">${children()}</a>` : children();
    }
    case 'tag':
      return `<span class="gu-tag">${children()}</span>`;
    default: {
      // 白名单之外的标签：只要它带着画面描述/图片地址，就按参考图落地；否则只取子节点
      const src = guAttrText(node, 'src', ctx);
      if (src) return `<img class="gu-image" src="${esc(src)}" alt="${esc(guAttrText(node, 'alt', ctx))}" loading="lazy" />`;
      const query = guAttrText(node, 'query', ctx) || guAttrText(node, 'prompt', ctx);
      if (query) {
        const ratio = guAttrText(node, 'aspectRatio', ctx) || guAttrText(node, 'aspect_ratio', ctx) || guAttrText(node, 'ratio', ctx);
        return guRefCardHtml(query, ratio);
      }
      return children();
    }
  }
}

function guValuesFor(message, decls) {
  const id = (message && message.id) || 'anon';
  let record = askGenUiMemory.get(id);
  if (!record) { record = { values: {} }; askGenUiMemory.set(id, record); }
  for (const [key, decl] of Object.entries(decls)) if (!(key in record.values)) record.values[key] = decl.value;
  return record.values;
}

function guRenderBlock(message, decls, body) {
  const values = guValuesFor(message, decls);
  const ctx = { decls, values };
  const tree = guBuildTree(guStripDecls(body));
  const inner = guRenderChildren(tree, ctx);
  // 只有叶子（<text>、<AsyncImage/>…）时贴正文排，不再套一层卡片边框，避免把一段话切成碎块
  const leafOnly = (tree.children || []).every((child) => child.name === '#text' || !GU_CONTAINER_TAGS.has(child.name));
  const cls = leafOnly ? 'gu-inline' : 'gu-card';
  return `<div class="${cls}" data-gu-msg="${esc((message && message.id) || '')}">${inner}</div>`;
}

function guHtmlFor(text, message, decls) {
  const segs = guSegments(guFixStrayTags(text));
  const scopes = decls || guStateDecls(text);
  return segs.map((seg) => {
    if (seg.type === 'pending') return '<div class="gu-card gu-card-pending"><span class="gu-spin"></span>正在整理可选项…</div>';
    if (seg.type === 'ui') return guRenderBlock(message, scopes, seg.body);
    const md = guScrubLeaks(guStripDecls(seg.value))
      .replace(/<\/?WritingBlock\b[^>]*>/gi, '')
      .replace(/```[a-zA-Z0-9]*\s*\n\s*```/g, '')
      .replace(/\n{3,}/g, '\n\n');
    if (!md.trim()) return '';
    return `<div class="ask-message-text">${askMarkdown(md)}</div>`;
  }).join('');
}

function guPlainText(text) {
  const src = guFixStrayTags(text);
  const segs = guSegments(src);
  const parts = [];
  for (const seg of segs) {
    if (seg.type === 'md') {
      const prose = guScrubLeaks(guStripDecls(seg.value)).trim();
      if (prose) parts.push(prose);
      continue;
    }
    if (seg.type !== 'ui') continue;
    const lines = [];
    const walk = (node) => {
      if (!node) return;
      if (node.name === '#text' && node.text) lines.push(node.text);
      if (node.name === 'button') return;
      for (const child of node.children || []) walk(child);
    };
    walk(guBuildTree(guStripDecls(seg.body)));
    if (lines.length) parts.push(lines.join('\n'));
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* 画面参考：直接按英文描述出图，不走反推/识别；同一条描述只出一次，结果在内存里复用 */
const ASK_REF_CACHE = new Map();
const ASK_REF_INFLIGHT = new Set();
const ASK_REF_QUEUE = [];
const ASK_REF_PROMPTS = new Map();
const ASK_REF_MANUAL = new Set();
const ASK_REF_LIMIT = 2;

/* 刷新/重开页面后图片不用再走一遍「出图中…」：把「描述 → 图片地址 + 图位比例」记在本机。
   图片文件本身在服务端 data/ref-images 里长期保留，这里只是记住它的地址。 */
const ASK_REF_STORE = 'wmd.refImages';
const ASK_REF_STORE_MAX = 400;
let askRefStoreTimer = null;

function guRefStoreSave() {
  if (typeof localStorage === 'undefined') return;
  try {
    const rows = [];
    for (const [key, hit] of ASK_REF_CACHE) {
      if (!hit || !hit.url) continue;
      rows.push([key, { url: hit.url, path: hit.path || '', ratio: GU_REF_RATIOS.get(key) || '' }]);
    }
    const keep = rows.length > ASK_REF_STORE_MAX ? rows.slice(rows.length - ASK_REF_STORE_MAX) : rows;
    localStorage.setItem(ASK_REF_STORE, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* 存不下也不影响当前会话 */ }
}

function guRefStoreSchedule() {
  if (typeof setTimeout !== 'function' || askRefStoreTimer) return;
  askRefStoreTimer = setTimeout(() => { askRefStoreTimer = null; guRefStoreSave(); }, 400);
}

function guRefStoreHydrate() {
  if (typeof localStorage === 'undefined') return;
  let data = {};
  try {
    const raw = localStorage.getItem(ASK_REF_STORE);
    data = raw ? JSON.parse(raw) : {};
  } catch { data = {}; }
  if (!data || typeof data !== 'object') return;
  for (const [key, hit] of Object.entries(data)) {
    if (!hit || !hit.url) continue;
    ASK_REF_CACHE.set(key, { url: hit.url, path: hit.path || '' });
    if (hit.ratio) GU_REF_RATIOS.set(key, hit.ratio);
  }
}

function guRefStoreForget() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(ASK_REF_STORE); } catch { /* ignore */ }
}

function guRefStoreForget() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(ASK_REF_STORE); } catch { /* ignore */ }
}

// 注意：还原要等 GU_REF_RATIOS 初始化之后再做，提前调用会因为 const 的暂时性死区直接抛错。
// 记忆只对本机有效：换项目/换渠道后旧地址失效时，图片加载失败会退回「点一下重试」

// 开关关掉时一张都不出：不排队、不请求，卡片退回可读的描述
function guRefsEnabled() {
  if (typeof state === 'undefined' || !state || !state.ask) return true;
  return state.ask.refImages !== false;
}

function guRefKey(prompt) {
  const text = String(prompt || '');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36) + '-' + text.length.toString(36);
}

// 尺寸直接写在标签上：样式表没更新到、或者被别的规则盖掉，也不会撑成一大块
const GU_REF_BOX = 'position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;overflow:hidden;padding:0;border:0;background:color-mix(in oklch, currentColor 7%, transparent);color:inherit;font:inherit;font-size:11px;line-height:1.5;';
const GU_REF_IMG = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';
const GU_REF_ACTIONS = 'position:absolute;top:6px;right:6px;display:flex;gap:4px;z-index:3;';
const GU_REF_BTN = 'width:22px;height:22px;display:grid;place-items:center;padding:0;border:0;border-radius:6px;background:rgba(12,14,18,.46);color:#fff;font:inherit;font-size:12px;line-height:1;cursor:pointer;backdrop-filter:blur(2px);';
const GU_REF_FILL = 'max-width:100%;padding:0 26px 0 14px;text-align:center;font-size:10.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;';

// 参考图按自己的比例占位：9:16 / 16:9 / 1:1 / 3:4 / 4:3 都认，等比放进 236×220 的框里
const GU_REF_MAX_W = 236;
const GU_REF_MAX_H = 220;
const GU_REF_RATIOS = new Map();

// 把本机记住的「描述 → 图片地址/比例」读回内存（必须在 GU_REF_RATIOS 之后执行）
guRefStoreHydrate();

function guRefRatio(value) {
  const text = String(value || '').trim().replace(/[：x×*/\s]/gi, ':').replace(/:+/g, ':');
  const hit = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(text);
  if (!hit) return { label: '4:3', w: 4, h: 3 };
  const w = Number(hit[1]);
  const h = Number(hit[2]);
  if (!(w > 0 && h > 0)) return { label: '4:3', w: 4, h: 3 };
  return { label: `${w}:${h}`, w, h };
}

// 常见的五种画幅；生成出来的图接近哪一种就按哪一种摆，避免每张都塞同一个框
const GU_REF_STANDARD = ['9:16', '16:9', '1:1', '3:4', '4:3'];

function guRefSnapRatio(width, height) {
  if (!(width > 0 && height > 0)) return null;
  const actual = width / height;
  let best = null;
  for (const label of GU_REF_STANDARD) {
    const ratio = guRefRatio(label);
    const diff = Math.abs(ratio.w / ratio.h - actual) / actual;
    if (!best || diff < best.diff) best = { ratio, diff };
  }
  if (best && best.diff <= 0.06) return best.ratio;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(Math.round(width), Math.round(height)) || 1;
  return guRefRatio(`${Math.round(width / g)}:${Math.round(height / g)}`);
}

function guRefBox(ratio) {
  const scale = Math.min(GU_REF_MAX_W / ratio.w, GU_REF_MAX_H / ratio.h);
  return { width: Math.round(ratio.w * scale), height: Math.round(ratio.h * scale) };
}

// 一个图位就是一张图：没图显示提示词，有图只显示图；右上角三个按钮一直在
function guRefActionsHtml(prompt, hit) {
  const text = String(prompt || '');
  const url = hit && hit.url ? hit.url : '';
  const loading = Boolean(hit && hit.loading);
  const error = hit && hit.error ? String(hit.error) : '';
  const spinTitle = error ? `出图失败：${error}（点一下重试）` : url ? '重新生成这张图' : '生成这张图';
  return `<div class="gu-ref-actions" style="${GU_REF_ACTIONS}">
    <button type="button" class="gu-ref-btn${error ? ' is-bad' : ''}" style="${GU_REF_BTN}" data-act="ask-ref-now" data-gu-prompt="${esc(text)}" title="${esc(spinTitle)}" aria-label="生成图片">${loading ? '<span class="gu-ref-spin"></span>' : '↻'}</button>
    <button type="button" class="gu-ref-btn" style="${GU_REF_BTN}${url ? '' : 'opacity:.4;'}" data-act="gu-ref-download" data-url="${esc(url)}" title="${url ? '下载图片' : '还没有图片'}" aria-label="下载图片"${url ? '' : ' disabled'}>⤓</button>
    <button type="button" class="gu-ref-btn" style="${GU_REF_BTN}" data-act="gu-copy-text" data-gu-text="${esc(text)}" title="复制提示词" aria-label="复制提示词">⧉</button>
  </div>`;
}

function guRefMediaHtml(prompt, hit, ratio) {
  const text = String(prompt || '');
  const url = hit && hit.url ? hit.url : '';
  const loading = Boolean(hit && hit.loading);
  const error = hit && hit.error ? String(hit.error) : '';
  const cls = url ? ' is-ready' : loading ? ' is-loading' : error ? ' is-failed' : ' is-empty';
  const box = guRefBox(ratio);
  const fill = url
    ? `<button type="button" class="gu-ref-zoom" style="position:absolute;inset:0;padding:0;border:0;background:transparent;cursor:zoom-in" data-act="ask-open-inline" data-url="${esc(url)}" data-label="${esc(text.slice(0, 40))}"><img src="${esc(url)}" alt="${esc(text)}" loading="lazy" style="${GU_REF_IMG}" /></button><span class="gu-ref-badge">自动生成</span>`
    : `<span class="gu-ref-prompt" style="${GU_REF_FILL}">${esc(text || '—')}</span>`;
  return `<div class="gu-ref-media${cls}" style="${GU_REF_BOX}height:${box.height}px;max-height:${box.height}px;">${fill}${guRefActionsHtml(text, hit)}</div>`;
}

function guRefCardHtml(prompt, ratioHint) {
  const text = String(prompt || '').trim();
  const key = guRefKey(text);
  const ratio = guRefRatio(ratioHint || GU_REF_RATIOS.get(key) || '4:3');
  GU_REF_RATIOS.set(key, ratio.label);
  const hit = ASK_REF_CACHE.get(key);
  const busy = ASK_REF_INFLIGHT.has(key) || askRefRunning.has(key);
  const state = hit ? (hit.error ? 'error' : 'ready') : (busy ? 'loading' : (guRefsEnabled() ? 'pending' : 'off'));
  const box = guRefBox(ratio);
  return `<figure class="gu-ref" style="margin:0;min-width:0;align-self:start;width:${box.width}px;max-width:100%;border:1px solid var(--ask-line, rgba(0,0,0,.12));border-radius:12px;overflow:hidden;" data-gu-ref data-gu-key="${key}" data-gu-prompt="${esc(text)}" data-gu-ratio="${esc(ratio.label)}" data-gu-state="${state}">${guRefMediaHtml(text, hit || (busy ? { loading: true } : null), ratio)}</figure>`;
}

function guPaintRef(node, hit) {
  if (!node || !node.isConnected) return;
  node.dataset.guState = hit && hit.error ? 'error' : hit && hit.loading ? 'loading' : 'ready';
  node.classList.toggle('is-error', Boolean(hit && hit.error));
  const media = node.querySelector('.gu-ref-media');
  if (media) media.outerHTML = guRefMediaHtml(node.dataset.guPrompt || '', hit, guRefRatio(node.dataset.guRatio));
  guBindRefImg(node);
}

// 图片加载出来后按图片真实比例把图位调成一样的形状（横的横、竖的竖，不留空也不裁）
function guRefFitBox(node, width, height) {
  if (!node || !node.isConnected) return;
  const ratio = guRefSnapRatio(width, height);
  if (!ratio) return;
  node.dataset.guRatio = ratio.label;
  const key = node.dataset.guKey;
  if (key) { GU_REF_RATIOS.set(key, ratio.label); guRefStoreSchedule(); }
  const box = guRefBox(ratio);
  node.style.width = box.width + 'px';
  const media = node.querySelector('.gu-ref-media');
  if (media) {
    media.style.height = box.height + 'px';
    media.style.maxHeight = box.height + 'px';
  }
}

// 图片加载不出来时不要留一个空白大块，退回「加载失败 + 重试」
function guBindRefImg(scope) {
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  scope.querySelectorAll('.gu-ref-media.is-ready img').forEach((img) => {
    if (img.dataset.guBound) return;
    img.dataset.guBound = '1';
    const node = img.closest('[data-gu-ref]');
    img.addEventListener('error', () => {
      if (node) guPaintRef(node, { error: '图片加载失败' });
    });
    const fit = () => guRefFitBox(node, img.naturalWidth, img.naturalHeight);
    if (img.complete && img.naturalWidth) fit();
    else img.addEventListener('load', fit);
  });
}

function guHydrateRefs(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  if (!guRefsEnabled()) { guRefStop(); return; }
  guBindRefImg(root);
  root.querySelectorAll('[data-gu-ref][data-gu-state="pending"]').forEach((node) => {
    const key = node.dataset.guKey;
    const prompt = node.dataset.guPrompt || '';
    if (!key || !prompt) return;
    const hit = ASK_REF_CACHE.get(key);
    if (hit) { guPaintRef(node, hit); return; }
    if (ASK_REF_INFLIGHT.has(key)) return;
    ASK_REF_INFLIGHT.add(key);
    ASK_REF_PROMPTS.set(key, prompt);
    ASK_REF_QUEUE.push(key);
  });
  guRefPump();
}

// 关掉开关时把还没排队的清空；已经在请求里的让它自然结束，不会再多花一张
function guRefStop() {
  ASK_REF_QUEUE.length = 0;
  for (const key of ASK_REF_INFLIGHT) {
    if (!askRefRunning.has(key)) {
      ASK_REF_INFLIGHT.delete(key);
      ASK_REF_PROMPTS.delete(key);
      ASK_REF_MANUAL.delete(key);
    }
  }
}

// 单张手动出图：只生成这一条，不连带别的卡片，也不改全局开关
function guGenerateRef(prompt, options = {}) {
  const text = String(prompt || '').trim();
  if (!text) return;
  const key = guRefKey(text);
  const hit = ASK_REF_CACHE.get(key);
  if (hit && hit.url && !options.force) return;
  ASK_REF_CACHE.delete(key);
  ASK_REF_MANUAL.add(key);
  guPaintEveryRef(key, { loading: true });
  if (!ASK_REF_INFLIGHT.has(key)) {
    ASK_REF_INFLIGHT.add(key);
    ASK_REF_PROMPTS.set(key, text);
    ASK_REF_QUEUE.push(key);
  }
  guRefPump();
}

function guPaintEveryRef(key, hit) {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  document.querySelectorAll(`[data-gu-ref][data-gu-key="${key}"]`).forEach((node) => guPaintRef(node, hit));
}

function guRefPump() {
  while (ASK_REF_QUEUE.length) {
    const key = ASK_REF_QUEUE.shift();
    const prompt = ASK_REF_PROMPTS.get(key) || '';
    if (!prompt) { ASK_REF_INFLIGHT.delete(key); continue; }
    // 全局开关关着时，只放行用户手动点的那几张
    if (!guRefsEnabled() && !ASK_REF_MANUAL.has(key)) {
      ASK_REF_INFLIGHT.delete(key);
      ASK_REF_PROMPTS.delete(key);
      continue;
    }
    if (guRefRunning() >= ASK_REF_LIMIT) { ASK_REF_QUEUE.unshift(key); break; }
    guRefStart(key, prompt);
  }
}

const askRefRunning = new Set();

function guRefRunning() {
  return askRefRunning.size;
}

function guRefStart(key, prompt) {
  askRefRunning.add(key);
  api('/api/chat/ref-image', { method: 'POST', body: { prompt, ratio: GU_REF_RATIOS.get(key) || '' } })
    .then((result) => {
      ASK_REF_CACHE.set(key, { url: result.url, path: result.path });
      guRefStoreSchedule();
    })
    .catch((err) => {
      ASK_REF_CACHE.set(key, { error: err.message || '出图失败' });
    })
    .finally(() => {
      askRefRunning.delete(key);
      ASK_REF_INFLIGHT.delete(key);
      ASK_REF_PROMPTS.delete(key);
      ASK_REF_MANUAL.delete(key);
      const hit = ASK_REF_CACHE.get(key) || { error: '出图失败' };
      guPaintEveryRef(key, hit);
      guRefPump();
    });
}

// 单张重试＝只重跑这一张
function guRetryRef(prompt) {
  guGenerateRef(prompt);
}

function askMessagesHtml(chat) {
  const a = askState();
  const messages = (chat && chat.messages) || [];
  return messages.map((m, index) => askMessageHtml(m, index, messages, a)).join('');
}

// 计速：一轮的耗时与速率现在是 receipt.turn.stats（turn = 一次用户提交，step = 一次模型调用）。
// turn 是规范位置；旧回执没有 turn 时回退到 receipt.timing，两处字段同构。
// 缺字段就少显示一项，不编造数字。
function askSecs(ms) {
  const v = Number(ms) || 0;
  return v >= 10000 ? (v / 1000).toFixed(0) + 's' : (v / 1000).toFixed(1) + 's';
}

function askTurnStats(ex) {
  if (!ex) return null;
  const turn = ex.turn || null;
  if (turn && turn.stats && typeof turn.stats === 'object') return turn.stats;
  return ex.timing || null;
}

function askSessionStats(chat) {
  const list = (chat && chat.messages) || [];
  const s = { turns: 0, steps: 0, llm: 0, tool: 0, dec: 0, decTokens: 0, input: 0, output: 0, ttftSum: 0, ttftN: 0,
    cacheRead: 0, cacheInput: 0, cacheTurns: 0 };
  for (const m of list) {
    if (m.role !== 'assistant') continue;
    const ex = m.execution || null;
    if (!ex) continue;
    const t = askTurnStats(ex);
    const u = ex.usage || null;
    s.turns += 1;
    if (t) {
      s.steps += Number(t.model_calls) || 0;
      s.llm += Number(t.llm_ms) || 0;
      s.tool += Number(t.tool_ms) || 0;
      s.dec += Number(t.decode_ms) || 0;
      s.decTokens += Number(t.decode_tokens) || 0;
      if (t.ttft_ms) { s.ttftSum += Number(t.ttft_ms); s.ttftN += 1; }
    }
    if (u) { s.input += Number(u.input_tokens) || 0; s.output += Number(u.output_tokens) || 0; }
    // 缓存：只有这一轮的每次模型调用都报了缓存明细，u.cache_hit_rate 才不是 null。
    // 缺一轮就不进分母，宁可整项不显示，也不拿部分数据凑百分比。
    if (u && typeof u.cache_hit_rate === 'number') {
      s.cacheRead += Number(u.cache_read_tokens) || 0;
      s.cacheInput += Number(u.input_tokens) || 0;
      s.cacheTurns += 1;
    }
  }
  s.ttftAvg = s.ttftN ? s.ttftSum / s.ttftN : 0;
  s.cacheRate = s.cacheTurns > 0 && s.cacheInput > 0
    ? Number((s.cacheRead / s.cacheInput * 100).toFixed(1)) : null;
  s.tps = s.dec > 0 && s.decTokens ? Number((s.decTokens / (s.dec / 1000)).toFixed(1)) : 0;
  return s;
}

// 输入框下方的状态条，抄 DSH 的三段式：活动 · 用量 · 上下文占用。
// 图标 + 竖线分隔，一眼能扫到「跑得多快 / 用掉多少 / 还剩多少」。
const ASK_ICO_CLOCK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="8" r="5.7" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.7V8.2l2.3 1.4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
const ASK_ICO_DB = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><ellipse cx="8" cy="4.4" rx="5.2" ry="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2.8 4.4v7.2c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2V4.4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';

// 状态条不缩写：位置够用，27,506 比 28k 多不了几个像素，省这一眼不值当。
function askFullTokens(value) {
  return Math.max(0, Math.round(Number(value) || 0)).toLocaleString('en-US');
}

// 占用比例统一一位小数，整数就省掉 .0：1% / 10.4% / 96.4%
function askPct(ratio) {
  return (Math.max(0, Math.min(1, Number(ratio) || 0)) * 100).toFixed(1).replace(/\.0$/, '') + '%';
}

function askStatDockHtml() {
  const s = askSessionStats(askActive());
  if (!s.turns) return '';
  // 活动：本会话多少轮、累计多少次模型调用、当前输出速率
  const activity = [s.turns + ' 轮', s.steps + ' 步', s.tps ? s.tps + ' token/s' : ''].filter(Boolean);
  // 用量：累计 token 总量 + 缓存命中率（拿不到就不显示，不凑数字）
  const usage = [askFullTokens(s.input + s.output) + ' token',
    s.cacheRate != null ? '缓存命中 ' + s.cacheRate + '%' : ''].filter(Boolean);
  const tipActivity = '本会话已跑 ' + s.turns + ' 轮 / ' + s.steps + ' 次模型调用'
    + (s.llm ? ' · 模型 ' + askSecs(s.llm) : '') + (s.tool ? ' · 工具 ' + askSecs(s.tool) : '')
    + (s.ttftAvg ? ' · 首字均值 ' + askSecs(s.ttftAvg) : '');
  const tipUsage = '输入 ' + s.input + ' / 输出 ' + s.output
    + (s.cacheRate != null ? ' · 缓存读 ' + s.cacheRead + '（' + s.cacheTurns + ' 轮有完整上报）' : ' · 渠道未上报缓存明细');
  return `<div class="ask-stat-dock">
    <span class="ask-stat-group" data-composer-stat="activity" title="${esc(tipActivity)}"><i class="ask-stat-ico">${ASK_ICO_CLOCK}</i><span>${esc(activity.join(' · '))}</span></span>
    <span class="ask-stat-sep" aria-hidden="true"></span>
    <span class="ask-stat-group" data-composer-stat="usage" title="${esc(tipUsage)}"><i class="ask-stat-ico">${ASK_ICO_DB}</i><span>${esc(usage.join(' · '))}</span></span>
    <span class="ask-stat-sep" aria-hidden="true"></span>
    ${askContextMeterHtml()}
  </div>`;
}

// 每轮用量：stats 与 usage 必须都在，缺一个就整块不显示——不拿部分总量冒充完整。
function askTurnUsageHtml(m) {
  const ex = (m && m.execution) || null;
  const t = askTurnStats(ex);
  const u = ex && ex.usage;
  if (!t || !u || u.output_tokens == null) return '';
  const head = [];
  if (t.tps) head.push(t.tps + ' token/s');
  if (t.ttft_ms) head.push('首字 ' + askSecs(t.ttft_ms));
  head.push('输出 ' + u.output_tokens + ' tokens');
  const rows = [['模型耗时', t.llm_ms != null ? askSecs(t.llm_ms) : '—'],
    ['工具耗时', t.tool_ms != null ? askSecs(t.tool_ms) : '—'],
    ['解码', t.decode_ms != null ? askSecs(t.decode_ms) : '—'],
    ['模型调用', (t.model_calls || 0) + ' 次'],
    ['工具调用', (t.tool_calls || 0) + ' 次'],
    ['输入 tokens', u.input_tokens ?? '—'],
    ['输出 tokens', u.output_tokens ?? '—']];
  return `<details class="ask-turn-usage">
    <summary>${esc(head.join(' · '))}</summary>
    <div class="ask-turn-usage-body">${rows.map(([k, v]) => `<span><i>${esc(k)}</i><b>${esc(String(v))}</b></span>`).join('')}</div>
  </details>`;
}

function askSpeedHtml(m) {
  const usage = (m && m.execution && m.execution.usage) || null;
  const t = askTurnStats(m && m.execution);
  const parts = [];
  if (usage) parts.push('输入 ' + (usage.input_tokens ?? '?') + ' / 输出 ' + (usage.output_tokens ?? '?'));
  if (t && t.tps) parts.push(t.tps + ' token/s');
  if (t && t.ttft_ms) parts.push('首字 ' + (t.ttft_ms / 1000).toFixed(1) + 's');
  if (!parts.length) return '';
  const tip = t ? ['模型 ' + ((t.llm_ms || 0) / 1000).toFixed(2) + 's',
    '工具 ' + ((t.tool_ms || 0) / 1000).toFixed(2) + 's',
    '解码 ' + ((t.decode_ms || 0) / 1000).toFixed(2) + 's',
    '模型调用 ' + (t.model_calls || 0) + ' 次 · 工具 ' + (t.tool_calls || 0) + ' 次'].join(' · ') : '';
  return `<span class="ask-usage" title="${esc(tip)}">${esc(parts.join(' · '))}</span>`;
}

// 压缩卡片：时间线上看得见「哪一次压了多少条」，正文可展开。
// 压掉的原文仍在运行轨迹里，这里只放摘要，不给用户造成「历史被我删了」的错觉。
function askCompactionCardHtml(m, index) {
  const c = m.compaction || {};
  const n = Number(c.shadowed) || 0;
  const chars = Number(c.summary_chars) || 0;
  const tokens = chars ? Math.max(1, Math.round(chars / 1.6)) : 0;
  const stamp = m.time ? askTimeText(m.time) : '';
  return `<article class="ask-message is-compacted" data-msg-index="${index}" data-msg-id="${esc(m.id || '')}">
    <details class="ask-cps">
      <summary>
        <span class="ask-cps-ico" aria-hidden="true">▤</span>
        <b>上下文已压缩</b>
        <small>已压缩 ${n} 条历史记录${tokens ? '（约 ' + askFmtTokens(tokens) + ' tokens）' : ''}</small>
        <span class="ask-cps-time">${esc(stamp)}</span>
      </summary>
      <div class="ask-cps-body">
        <div class="ask-cps-label">压缩摘要</div>
        <pre>${esc(String(m.text || '') || '压缩摘要不可用')}</pre>
      </div>
    </details>
  </article>`;
}

// 流式回复按“已显示字数”渲染，字迹匀速推进，不会每来一块就整段跳一下
function askShownText(m, index, messages, a) {
  const text = String((m && m.text) || '');
  const last = index === messages.length - 1;
  if (!last || !m._streaming || m._reveal == null) return text;
  const shown = Math.max(0, Math.min(text.length, m._reveal));
  return shown >= text.length ? text : text.slice(0, shown);
}

// 智能推荐：对话里只留一行记录（真正的选择在输入框上方的问句条里）
function askChoiceQuestions(card) {
  if (!card) return [];
  if (Array.isArray(card.questions) && card.questions.length) return card.questions;
  if (card.question) {
    return [{ id: 'q1', question: card.question, options: card.options || [], multi: !!card.multi, allow_text: card.allow_text !== false }];
  }
  return [];
}

function askChoiceNoteHtml(m) {
  const cards = (m && m.choices) || [];
  if (m.role === 'user' || !cards.length) return '';
  return cards.map((card) => {
    const questions = askChoiceQuestions(card);
    const answered = (m.choiceAnswers || {})[card.id] || null;
    const typed = (m.choiceTyped || {})[card.id] || '';
    const skipped = m.choiceSkipped === card.id;
    let verdict = '等待选择';
    if (answered) verdict = '已选择 ' + answered.length + ' 项';
    else if (typed) verdict = '已回复：' + (typed.length > 28 ? typed.slice(0, 28) + '…' : typed);
    else if (skipped) verdict = '已跳过';
    const head = questions.length > 1 ? questions[0].question + '（等 ' + questions.length + ' 个问题）' : (questions[0] || {}).question || '';
    return `<div class="ask-choice-note${answered || typed ? ' is-done' : ''}${skipped ? ' is-skipped' : ''}" data-choice="${esc(card.id)}">
      <span class="ask-choice-note-badge">✦ 智能推荐</span>
      <span class="ask-choice-note-q">${esc(head)}</span>
      <span class="ask-choice-note-v">${esc(verdict)}</span>
    </div>`;
  }).join('');
}

// 直发补充说明：已并入当前任务的那几条要求，挂在这条回复里可回溯
function askSupplementNoteHtml(m) {
  const list = (m && m.supplements) || [];
  if (!list.length) return '';
  const applied = list.filter((x) => x.state !== 'received').length;
  return `<div class="ask-sup-note">
    <span class="ask-sup-badge">⚡ 补充说明</span>
    <span class="ask-sup-count">${applied ? '已并入 ' + applied + ' 条' : '已收到，等检查点'}</span>
    <span class="ask-sup-list">${list.map((x) => `<span class="ask-sup-chip${x.state === 'received' ? ' is-wait' : ''}" title="${esc(x.text)}">${esc(String(x.text || '').slice(0, 30))}${String(x.text || '').length > 30 ? '…' : ''}</span>`).join('')}</span>
  </div>`;
}

// 输入框上方的问句条：1–4 个问题（单选 / 多选）+ 自行撰写 + 跳过 / 发送
function askChoicePanelHtml() {
  const a = askState();
  const p = a.choice;
  if (!p || p.closed) return '';
  const card = p.card;
  const questions = askChoiceQuestions(card);
  const answers = p.answers || {};
  const custom = p.custom || {};
  const total = questions.length || 1;
  const page = Math.max(0, Math.min(total - 1, Number(p.page) || 0));
  const q = questions[page] || { id: 'q1', question: '', options: [], multi: false };
  const picked = answers[q.id] || [];
  const text = p.text || '';
  const answered = picked.length > 0 || !!text.trim() || !!custom[q.id];
  const last = page >= total - 1;
  const action = last ? '发送' : '下一步';
  const canNext = answered || (page > 0 && custom[q.id]);
  return `<div class="ask-qpanel" id="ask-qpanel" role="group" aria-label="待回答的问题">
    <div class="ask-qpanel-head">
      <span class="ask-qpanel-icon" aria-hidden="true">?</span>
      <span class="ask-qpanel-title">问题</span>
      <span class="grow"></span>
      ${total > 1 ? `<span class="ask-qpanel-pager">
        <button type="button" class="ask-qpanel-arrow" data-act="ask-choice-page" data-delta="-1" ${page === 0 ? 'disabled' : ''} title="上一个问题">‹</button>
        <span class="ask-qpanel-of">${page + 1} of ${total}</span>
        <button type="button" class="ask-qpanel-arrow" data-act="ask-choice-page" data-delta="1" ${last ? 'disabled' : ''} title="下一个问题">›</button>
      </span>` : ''}
      <button type="button" class="ask-qpanel-close" data-act="ask-choice-skip" title="关闭问题面板（这组问题先不问）">✕</button>
    </div>
    <div class="ask-qpanel-block">
      <div class="ask-qpanel-question">${esc(q.question)}${q.multi ? '<span class="ask-qpanel-multi">可多选</span>' : ''}</div>
      <div class="ask-qpanel-options" role="${q.multi ? 'group' : 'radiogroup'}">
        ${(q.options || []).map((o, i) => `<button type="button" class="ask-qpanel-opt${picked.includes(o.id) ? ' is-on' : ''}${q.multi ? ' is-multi' : ''}" role="${q.multi ? 'checkbox' : 'radio'}" aria-checked="${picked.includes(o.id)}" data-act="ask-choice-pick" data-question="${esc(q.id)}" data-option="${esc(o.id)}" title="${esc(o.value || o.label)}">
          <span class="ask-qpanel-key">${q.multi ? (picked.includes(o.id) ? '✓' : '') : i + 1}</span>
          <span class="ask-qpanel-label">${esc(o.label)}</span>
          ${o.why ? `<span class="ask-qpanel-why">${esc(o.why)}</span>` : ''}
          ${o.recommended ? '<span class="ask-qpanel-rec">推荐</span>' : ''}
          <span class="ask-qpanel-go" aria-hidden="true">→</span>
        </button>`).join('')}
      </div>
    </div>
    ${total > 1 ? `<div class="ask-qpanel-dots">${questions.map((item, i) => {
      const done = ((answers[item.id] || []).length > 0) || !!custom[item.id];
      return `<span class="ask-qpanel-dot${i === page ? ' is-on' : ''}${done ? ' is-done' : ''}" title="${esc(item.question)}"></span>`;
    }).join('')}</div>` : ''}
    <div class="ask-qpanel-foot">
      <span class="ask-qpanel-pen" aria-hidden="true">✎</span>
      <input id="ask-choice-input" class="ask-qpanel-input" autocomplete="off" placeholder="或自行撰写回复" value="${esc(text)}" />
      <button type="button" class="ask-qpanel-skip" data-act="ask-choice-skip">跳过</button>
      <button type="button" class="ask-qpanel-send" data-act="${last ? 'ask-choice-send' : 'ask-choice-page'}" data-delta="1" ${(last ? canNext : answered) ? '' : 'disabled'} title="${last ? '提交这组问题的答案' : '回答后进入下一个问题'}">${action}</button>
    </div>
  </div>`;
}

// 兜底：模型在正文里问了却没有出卡时，也给两个可点的默认动作，别让用户自己猜着写
function askQuickHtml(m, index) {
  if (!m || m.role === 'user' || m._streaming || m.error) return '';
  if ((m.choices || []).length) return '';
  const text = String(m.text || '').trim();
  if (!text) return '';
  const tail = text.slice(-140);
  const asking = /[?？]\s*$/.test(text.slice(-40)) || /继续|要不要|是否需要|请回复|告诉我|确认一下|下一步/.test(tail);
  if (!asking) return '';
  return `<div class="ask-quick">
    <button type="button" data-act="ask-quick" data-index="${index}" data-value="继续，按你的推荐执行" title="把决定权交给智能体，按它推荐的方案往下做">按推荐继续</button>
    <button type="button" data-act="ask-quick" data-index="${index}" data-value="" title="收起快捷项，自己输入">其他：我自己说</button>
  </div>`;
}

/* ------------------------- 问句条：选择 / 发送 / 跳过 ------------------------- */
function askChoiceBindInput() {
  const a = askState();
  const input = $('#ask-choice-input');
  if (!input) return;
  input.oninput = () => {
    if (!a.choice) return;
    a.choice.text = input.value;
    const q = askChoiceQuestions(a.choice.card)[Number(a.choice.page) || 0];
    const picked = ((a.choice.answers || {})[q && q.id] || []).length;
    const action = $('#ask-qpanel .ask-qpanel-send');
    if (action) action.disabled = !(input.value.trim() || picked);
  };
  input.onkeydown = (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      const a2 = askState();
      const total = askChoiceQuestions(a2.choice && a2.choice.card).length || 1;
      if ((Number(a2.choice && a2.choice.page) || 0) < total - 1) askChoicePage(1);
      else askChoiceSend();
    }
    if (event.key === 'ArrowRight' && !input.value) { event.preventDefault(); askChoicePage(1); }
    if (event.key === 'ArrowLeft' && !input.value) { event.preventDefault(); askChoicePage(-1); }
    if (event.key === 'Escape') { event.preventDefault(); askChoiceSkip(); }
  };
}

// 只换问句条这一块，保留输入焦点与已输入的文字
function askChoiceRefresh() {
  const a = askState();
  const host = $('#ask-qpanel');
  const html = askChoicePanelHtml();
  if (!host) { askRenderAll(); return; }
  if (!html) { host.remove(); return; }
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  host.replaceWith(wrap.firstElementChild);
  const input = $('#ask-choice-input');
  if (input && a.choice) {
    input.value = a.choice.text || '';
    if (a.choice.focusInput) { input.focus(); a.choice.focusInput = false; }
  }
  askChoiceBindInput();
}

function askChoiceMessage() {
  const a = askState();
  const chat = askActive();
  const id = a.choice && a.choice.messageId;
  return (chat && (chat.messages || []).find((m) => m.id === id)) || null;
}

function askChoicePick(questionId, optionId) {
  const a = askState();
  if (!a.choice) return;
  const questions = askChoiceQuestions(a.choice.card);
  const q = questions.find((x) => x.id === questionId) || questions[a.choice.page || 0] || questions[0];
  if (!q) return;
  a.choice.answers = a.choice.answers || {};
  const current = a.choice.answers[q.id] || [];
  if (q.multi) {
    a.choice.answers[q.id] = current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId];
  } else {
    a.choice.answers[q.id] = [optionId];
  }
  a.choice.text = '';
  if (a.choice.custom) delete a.choice.custom[q.id];
  const input = $('#ask-choice-input');
  if (input) input.value = '';
  askChoiceRefresh();
}

// 翻页：同一组问题一页一题，-1 上一题 / +1 下一题（到最后一题时由发送按钮接棒）
function askChoicePage(delta) {
  const a = askState();
  const p = a.choice;
  if (!p || p.closed) return;
  const questions = askChoiceQuestions(p.card);
  const total = questions.length || 1;
  const from = Math.max(0, Math.min(total - 1, Number(p.page) || 0));
  const q = questions[from];
  // 翻页前把当前页手写的回答记住，切回来还在
  const text = String(p.text || '').trim();
  if (q && text && !((p.answers || {})[q.id] || []).length) {
    p.custom = p.custom || {};
    p.custom[q.id] = text;
  }
  p.text = '';
  const to = Math.max(0, Math.min(total - 1, from + Number(delta || 0)));
  p.page = to;
  const next = questions[to];
  if (next && p.custom && p.custom[next.id]) p.text = p.custom[next.id];
  askChoiceRefresh();
  const input = $('#ask-choice-input');
  if (input) { input.value = p.text || ''; input.focus(); }
}

function askChoiceSummary() {
  const p = askState().choice;
  if (!p) return { text: '', values: [], skills: [] };
  const questions = askChoiceQuestions(p.card);
  const answers = p.answers || {};
  const custom = p.custom || {};
  const lines = [];
  const values = [];
  const skills = [];
  for (const q of questions) {
    const picked = (answers[q.id] || []).map((id) => (q.options || []).find((o) => o.id === id)).filter(Boolean);
    const typed = String(custom[q.id] || '').trim();
    if (!picked.length && !typed) continue;
    const label = picked.length ? picked.map((o) => o.label).join('、') : '（自定）' + typed;
    lines.push('- ' + q.question + ' → ' + label);
    for (const o of picked) {
      values.push(o.value || o.label);
      if (o.skill_id) skills.push(o.skill_id);
    }
    if (typed && !picked.length) values.push(typed);
  }
  return { text: lines.join('\n'), values, skills };
}

function askChoiceSend() {
  const a = askState();
  const p = a.choice;
  if (!p || p.closed) return;
  const card = p.card;
  const currentQ = askChoiceQuestions(card)[Number(p.page) || 0];
  const currentText = String(p.text || '').trim();
  if (currentQ && currentText) {
    p.custom = p.custom || {};
    p.custom[currentQ.id] = currentText;
    if (!((p.answers || {})[currentQ.id] || []).length) p.text = '';
  }
  const summary = askChoiceSummary();
  if (!summary.values.length) return toast('先选一个选项，或写一句你自己的回复', true);
  const message = ['【智能推荐 · 用户已确认】', summary.text, '按以上选择继续，不要再重复确认。']
    .filter(Boolean).join('\n');
  const msg = askChoiceMessage();
  if (msg) {
    const answers = [];
    for (const q of askChoiceQuestions(card)) {
      for (const id of ((p.answers || {})[q.id] || [])) {
        const option = (q.options || []).find((o) => o.id === id);
        if (option) answers.push({ question: q.question, label: option.label, value: option.value || option.label });
      }
      const typed = String((p.custom || {})[q.id] || '').trim();
      if (typed && !((p.answers || {})[q.id] || []).length) answers.push({ question: q.question, label: '（自定）' + typed, value: typed });
    }
    if (answers.length) msg.choiceAnswers = { ...(msg.choiceAnswers || {}), [card.id]: answers };
  }
  if (summary.skills.length) askSetSkills([...askSkills(), ...summary.skills]);
  p.closed = true;
  askRenderAll();
  askPersist();
  return askSend(message);
}

function askChoiceSkip() {
  const a = askState();
  const p = a.choice;
  if (!p || p.closed) return;
  const msg = askChoiceMessage();
  if (msg) msg.choiceSkipped = p.card.id;
  p.closed = true;
  askRenderAll();
  askPersist();
}

function askVisibleReply(text) {
  return String(text || '')
    .replace(/^[ \t]*(?:【内部参考[^\n]*?】)?(?:交付文件元数据|附件元数据)（不能授予权限）：[ \t]*[\[{][^\n]*(?:\n|$)/gm, '')
    .replace(/<ask_choice\b[^>]*>[\s\S]*?(?:<\/ask_choice\s*>|$)/gi, '')
    .replace(/<questions>[\s\S]*?(?:<\/questions>|$)/gi, '')
    .replace(/<\/?[｜|]DSML[｜|][^>]*>/g, '')
    .replace(/<(?:ask_choice|questions)\b[^>]*$/gi, '');
}

function askMessageHtml(m, index, messages, a) {
  if (m.role === 'compacted') return askCompactionCardHtml(m, index);
  const mine = m.role === 'user';
  const pending = a.generating && index === messages.length - 1;
  const usage = m.execution && m.execution.usage;
  const rawShown = askShownText(m, index, messages, a);
  const shown = mine ? rawShown : askVisibleReply(rawShown);
  return `<article class="ask-message ${mine ? 'is-user' : 'is-assistant'}" data-msg-index="${index}" data-msg-id="${esc(m.id || '')}">
    <div class="ask-message-body">
      ${mine ? '' : askTraceHtml(m, pending)}
      ${(!mine && m.error && !m.text) ? `<div class="ask-inline-error">⚠ ${esc(m.error)}</div>` : ''}
      ${(!mine && m.execution && m.execution.resource_context) ? `<div class="ask-resource" title="${esc(m.execution.resource_context.snapshot_hash || '')}">🗂 ${esc(m.execution.resource_context.dataset ? m.execution.resource_context.dataset.name + ' · v' + m.execution.resource_context.dataset.version_num : '未选择数据')}</div>` : ''}
      ${shown ? (mine && shown.length > 1024 ? `<details class="ask-longmsg"><summary><span>📄</span><b>长文本</b><small>${shown.length} 字 · 点击展开</small></summary><pre>${esc(shown)}</pre></details>` : (mine ? `<div class="ask-message-text is-plain">${esc(shown)}</div>` : guHtmlFor(shown, m))) : (pending ? '<div class="ask-typing"><i></i><i></i><i></i></div>' : '')}
      ${askFilesHtml(mine ? (m.files || []) : (m.execution && m.execution.artifacts) || [])}
      ${(!mine && (m.media || []).length) ? `<div class="ask-media-grid">${m.media.map((f, mi) => `<button type="button" class="ask-media" data-act="ask-open-media" data-index="${index}" data-media="${mi}" title="${esc(f.name || '')}">
        ${f.kind === 'video' ? `<video src="${esc(f.url)}" muted preload="metadata"></video><span class="ask-media-play">▶</span>` : `<img src="${esc(f.url)}" alt="" loading="lazy" />`}
        <span class="ask-media-name">${esc(f.name || '')}</span>
      </button>`).join('')}</div>` : ''}
      ${mine ? '' : askChoiceNoteHtml(m)}
      ${mine ? '' : askSupplementNoteHtml(m)}
      ${mine ? '' : askTurnUsageHtml(m)}
      ${mine ? '' : askQuickHtml(m, index)}
      ${(!mine && !pending) ? `<div class="ask-reply-actions">
        ${m.execution && m.execution.checkpoint_available && ['partial', 'failed', 'cancelled', 'budget_exceeded', 'interrupted'].includes(m.execution.outcome || m.execution.status) ? `<button type="button" data-act="ask-resume" data-index="${index}" title="从最近检查点继续，只读恢复">继续任务</button>` : ''}
        ${(() => {
          const sk = ASK_SKILLS.find((x) => x.name === m.skill);
          if (!sk) return '';
          const chain = ASK_CHAIN[sk.id];
          if (!chain) return '';
          if (chain.next) return '<button type="button" class="ask-next-step" data-act="ask-chain" data-index="' + index + '" data-skill="' + chain.next + '" data-verb="' + esc(chain.verb) + '" title="把这条产出接到下一步">下一步：' + esc(chain.label) + ' →</button>';
          return '<button type="button" class="ask-next-step" data-act="ask-to-studio" data-index="' + index + '" title="把提示词写进视频创作台">送到创作台 ↗</button>';
        })()}
        <button type="button" data-act="ask-copy" data-index="${index}" title="复制回复"><span>⧉</span>复制</button>
        <button type="button" data-act="ask-paste" data-index="${index}" title="粘贴到输入框"><span>⌁</span>粘贴</button>
        <button type="button" class="${a.liked.has(m.id) ? 'is-on' : ''}" data-act="ask-like" data-index="${index}" title="点赞"><span>▲</span>点赞</button>
        <button type="button" class="${a.disliked.has(m.id) ? 'is-on' : ''}" data-act="ask-dislike" data-index="${index}" title="有问题"><span>▼</span>有问题</button>
        <button type="button" data-act="ask-regenerate" data-index="${index}" title="重新生成这条回复"><span>↻</span>重生成</button>
        ${askSpeedHtml(m)}
        <span class="ask-time">${esc(askTimeText(m.time))}</span>
      </div>` : (mine ? `<div class="ask-reply-actions is-user-row">
        <button type="button" class="ask-turn-delete" data-act="ask-delete-turn" data-index="${index}" title="删除这一轮：问题连同它的回复一起删除">🗑 删除这一轮</button>
        <span class="ask-time">${esc(askTimeText(m.time))}</span>
      </div>` : '')}
    </div>
  </article>`;
}

function askWelcomeHtml() {
  return `<div class="ask-welcome">
    <span class="ask-eyebrow">WENYUN.M-DESKTOP</span>
    <h2>${esc(agentWelcomeText(state.config?.ui))}</h2>
  </div>`;
}

function askSkillIcon(id) {
  return ({ novel: '✎', script: '▤', storyboard: '▦', prompt: '◎', review: '✓' })[id] || '★';
}

function askRenderPopups() {
  const a = askState();
  const host = $('#ask-popups');
  if (!host) return;
  const cmdOpen = a.command.mode !== null || a.command.query !== null;
  host.innerHTML = (cmdOpen ? askCommandPopup() : '') + (a.mention ? askMentionPopup() : '') + (a.permMenu ? askPermissionPopup() : '');
  host.style.display = host.innerHTML.trim() ? 'block' : 'none';
}

function askPermissionPopup() {
  const a = askState();
  const current = askPermission(a.permission);
  return `<div class="ask-popup ask-perm-pop"><div class="ask-popup-title">本地权限 · ${esc(current.label)}</div>
    ${ASK_PERMISSIONS.map((p) => `<button type="button" class="${p.id === current.id ? 'is-hl' : ''}" data-act="ask-perm" data-id="${p.id}"><b>${p.icon} ${esc(p.label)}</b><span>${esc(p.desc)}</span></button>`).join('')}
    <p class="ask-perm-note">高危命令（格式化 / 分区 / 关机 / 删系统目录 / 编码载荷 / 账户后门）在任何档位都由系统强制阻断，模型改写法也绕不过去。</p></div>`;
}

function askSessionFiles(chat) {
  const out = [];
  const seen = new Set();
  for (const [mi, m] of ((chat && chat.messages) || []).entries()) {
    if (m.role !== 'assistant') continue;
    for (const [fi, f] of (m.media || []).entries()) {
      const key = f.url || f.path || (f.name + fi);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: 'media', ...f, mi, fi });
    }
    for (const file of ((m.execution && m.execution.artifacts) || [])) {
      const key = 'artifact:' + file.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: 'artifact', file });
    }
  }
  return out;
}

function askSessionFilesHtml(chat) {
  const files = askSessionFiles(chat);
  if (!files.length) return '';
  return `<div class="ask-files-bar">
    <span class="ask-files-title">本对话文件 ${files.length}</span>
    <div class="ask-files-scroll">${files.map((f) => f.type === 'media'
      ? `<button type="button" class="ask-file-chip" data-act="ask-open-media" data-index="${f.mi}" data-media="${f.fi}" title="${esc(f.name || '')}"><span class="ask-file-thumb">${f.kind === 'video' ? '🎬' : `<img src="${esc(f.url)}" alt="" />`}</span><span class="ask-file-label">${esc(f.name || '')}</span></button>`
      : `<button type="button" class="ask-file-chip" data-act="ask-preview" data-id="${esc(f.file.id)}" title="${esc(f.file.name)}"><span class="ask-file-thumb">📄</span><span class="ask-file-label">${esc(f.file.name)}</span></button>`).join('')}</div>
  </div>`;
}

function askComposerHtml() {
  const a = askState();
  const picked = askSkills();
  const names = askSkillNames(picked);
  const models = a.models || [];
  const efforts = askEfforts();
  return `<div class="ask-composer-area">
    <div id="ask-plan-dock">${askPlanDockHtml(askActive())}</div>
    ${askChoicePanelHtml()}
    <div class="ask-composer-context">
      <button type="button" class="ask-project-trigger" data-act="ask-project-picker" aria-label="选择项目"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/></svg><span class="ask-project-name">${esc(state.project?.name || '选择项目')}</span><svg class="ask-project-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><span>▰ 此计算机</span>
      ${state.styleDetail ? `<span>🎨 ${esc(state.styleDetail.name)}</span>` : ''}
      <span class="ask-skill-context">✧ ${esc(names.length ? names.join(' + ') : '普通聊天')}${picked.length ? ' <button type="button" data-act="ask-clear-skill" title="移除技能，返回普通聊天">×</button>' : ''}</span>
      ${(a.attachments || []).map((f) => `<span class="ask-attach" data-act="ask-preview" data-id="${esc(f.id)}" title="点击预览">📎 ${esc(f.name)}<small>${askAttachStatusText(f)}</small><button type="button" data-act="ask-detach" data-id="${esc(f.id)}">×</button></span>`).join('')}
    </div>
    <div class="ask-composer">
      ${askQueueHtml()}
      <div class="ask-popups" id="ask-popups"></div>
      <textarea id="ask-input" class="ask-input" rows="2" maxlength="3000" placeholder="${a.generating ? '当前回复生成中：Enter 加入队列，队首 ↑ 可补充给当前任务' : '聊聊你的想法，或输入 @ 选择技能'}">${esc(a.draft)}</textarea>
      <div class="ask-composer-bar">
        <button type="button" class="ask-icon-btn" data-act="ask-attach" title="添加附件（最多 5 个，单文件 10MB）">📎</button>
        <button type="button" class="ask-perm is-${esc(askPermission(a.permission).id)}" data-act="ask-permission" title="本地权限：${esc(askPermission(a.permission).label)}（点击切换）">${askPermission(a.permission).icon} ${esc(askPermission(a.permission).label)}</button>
        <button type="button" class="ask-ref-toggle ${a.refImages ? 'is-on' : ''}" data-act="ask-toggle-refs" aria-pressed="${a.refImages}" title="参考出图开关">出图</button>
        <button type="button" class="ask-ref-toggle ${a.webSearch ? 'is-on' : ''}" data-act="ask-toggle-web" role="switch" aria-checked="${!!a.webSearch}" title="${a.webSearch ? '联网已开启，下次发送可搜索和读取网页' : '联网已关闭，下次发送不提供联网工具'}">🌐 联网</button>
        <select class="ask-select" id="ask-model" title="模型">
          ${models.map((m) => `<option value="${esc(m.id)}" ${m.id === a.modelId ? 'selected' : ''} title="上下文 ${m.context_tokens ? Math.round(m.context_tokens / 1000) + 'k' : '默认 500k'}">${esc(m.label)}${m.context_tokens ? ' · ' + Math.round(m.context_tokens / 1000) + 'k' : ''}</option>`).join('') || '<option value="">默认模型</option>'}
        </select>
        ${efforts.length ? `<select class="ask-select" id="ask-effort" title="思考强度">${efforts.map((e) => `<option value="${esc(e)}" ${e === a.effort ? 'selected' : ''}>思考 ${esc(ASK_EFFORT_LABELS[e] || e)}</option>`).join('')}</select>` : ''}
        <span class="ask-draft-count">${(a.draft || '').length}/3000</span>
        <span class="grow"></span>
        ${a.generating
          ? `<button type="button" class="ask-send is-stop" data-act="ask-stop" aria-label="停止生成" title="停止生成">■</button>`
          : `<button type="button" class="ask-send" data-act="ask-send" ${a.draft.trim() ? '' : 'disabled'}>发送 ↑</button>`}
      </div>
    </div>
    ${askStatDockHtml()}
    ${a.toolsSupported === false ? '<div class="ask-hint"><span class="ask-perm-warn">⚠ 当前模型渠道不支持工具调用，文件与命令操作不会执行：把模型切到 deepseek-flash 或 gemini-3.8-flash</span></div>' : ''}
  </div>`;
}

function askEfforts() {
  const a = askState();
  const model = (a.models || []).find((m) => m.id === a.modelId);
  return (model && model.reasoning_efforts) || [];
}

/* ----------------------- 上下文占用（圈 + 已用/总量） ----------------------- */
const ASK_CTX_R = 6.6;
const ASK_CTX_C = 2 * Math.PI * ASK_CTX_R;

// 上下文占用：优先「下一轮预计」，其次「上一轮实际」。
// 压缩让历史变短，但上一轮的 input_tokens 反映的正是被压缩前的历史——拿它算环，
// 压缩完环纹丝不动，用户会以为压缩没生效。context.report.used 是压缩后重新估算的
// 发送量；压缩卡片还带 shadowed_chars，遇到就在时间线上立刻扣掉，不用等下一轮。
function askContextStats() {
  const a = askState();
  const chat = askActive();
  const model = (a.models || []).find((m) => m.id === a.modelId) || {};
  const total = Number(model.context_tokens) || 128000;
  const messages = (chat && chat.messages) || [];
  const estimate = (m) => Math.ceil(String((m && m.text) || '').length * 0.7);
  let used = 0;
  let exact = false;
  let found = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const ex = messages[i].execution || null;
    if (!ex) continue;
    const report = ex.context && ex.context.report;
    if (report && report.used) {
      used = Number(report.used) || 0;
      exact = false;
      found = true;
    } else if (ex.usage && ex.usage.input_tokens) {
      used = Number(ex.usage.input_tokens) + Number(ex.usage.output_tokens || 0);
      exact = true;
      found = true;
    } else {
      continue;
    }
    // 这一轮之后发生的事：追加的对话，以及压缩遮掉的历史
    for (let j = i + 1; j < messages.length; j += 1) {
      const m = messages[j];
      if (m.role === 'compacted') {
        const shadowed = Number((m.compaction && m.compaction.shadowed_chars) || 0);
        used -= Math.ceil(shadowed * 0.7);
        used += estimate(m); // 摘要本身会作为一条历史材料进入上下文
        continue;
      }
      used += estimate(m);
    }
    break;
  }
  used = Math.max(0, used);
  if (!found) {
    // 一条回执都没有才走全文估算。注意判据是 found 而不是 !used：
    // 压缩把占用扣到 0 是合法结果，不该被兜底逻辑覆盖成别的数。
    const chars = messages.reduce((n, m) => n + String(m.text || '').length, 0);
    used = Math.ceil(chars * 0.7);
  }
  used += Math.ceil(String(a.draft || '').length * 0.7);
  return { used, total, ratio: total ? Math.max(0, Math.min(1, used / total)) : 0, exact };
}

function askFmtTokens(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

function askCtxTone(ratio) {
  if (ratio >= 0.95) return 'is-danger';
  if (ratio >= 0.8) return 'is-warn';
  return '';
}

function askContextMeterHtml() {
  const s = askContextStats();
  const len = (ASK_CTX_C * s.ratio).toFixed(1);
  const title = `上下文占用：${askFullTokens(s.used)} / ${askFullTokens(s.total)} token（${askPct(s.ratio)}）${s.exact ? '' : ' · 估算'}`;
  return `<span class="ask-ctx ${askCtxTone(s.ratio)}" title="${esc(title)}">
      <svg class="ask-ctx-ring" viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
        <circle class="ask-ctx-track" cx="9" cy="9" r="${ASK_CTX_R}" />
        <circle class="ask-ctx-fill" cx="9" cy="9" r="${ASK_CTX_R}" stroke-dasharray="${len} ${ASK_CTX_C.toFixed(1)}" transform="rotate(-90 9 9)" />
      </svg>
      <span class="ask-ctx-text">${askPct(s.ratio)}</span>
    </span>`;
}

// 就地刷新圆圈，不重排整个输入区
function askUpdateContextMeter() {
  const host = document.querySelector('.ask-ctx');
  if (!host) return;
  const s = askContextStats();
  const fill = host.querySelector('.ask-ctx-fill');
  if (fill) fill.setAttribute('stroke-dasharray', (ASK_CTX_C * s.ratio).toFixed(1) + ' ' + ASK_CTX_C.toFixed(1));
  const text = host.querySelector('.ask-ctx-text');
  if (text) text.textContent = askPct(s.ratio);
  host.classList.toggle('is-warn', s.ratio >= 0.8 && s.ratio < 0.95);
  host.classList.toggle('is-danger', s.ratio >= 0.95);
  host.title = `上下文占用：${askFullTokens(s.used)} / ${askFullTokens(s.total)} token（${askPct(s.ratio)}）${s.exact ? '' : ' · 估算'}`;
}

/** 斜杠命令目录来自后端 /agent/commands：加命令只改后端一处，前端不再写死三个。 */
async function askLoadCommands() {
  const a = askState();
  try {
    const data = await askApi('/commands').then((r) => r.json());
    const list = Array.isArray(data) ? data : data.items || [];
    const mapped = list.filter((c) => c && c.name).map((c) => ({
      name: String(c.name),
      label: c.label || c.name,
      description: c.description || '',
      kind: c.kind === 'popup' ? 'popup' : 'action',
      arg: c.arg || c.name,
    }));
    if (mapped.length) a.commands = mapped;
  } catch {
    a.commands = a.commands || [];
  }
}

function askCommandList() {
  const a = askState();
  if (a.commands && a.commands.length) return a.commands;
  return [{ name: 'model', label: '换模型', description: '', kind: 'popup', arg: 'model' },
    { name: 'think', label: '换思考强度', description: '', kind: 'popup', arg: 'think' },
    { name: 'compact', label: '压缩当前对话上下文', description: '', kind: 'action', arg: 'compact' }];
}

function askCommandItems() {
  const a = askState();
  const cmd = a.command;
  if (cmd.mode === 'model') return (a.models || []).map((m) => ({ id: m.id, label: m.label }));
  if (cmd.mode === 'think') return askEfforts().map((e) => ({ id: e, label: ASK_EFFORT_LABELS[e] || e }));
  const q = (cmd.query || '').toLowerCase();
  return askCommandList()
    .filter((c) => !q || c.name.includes(q) || (c.label + ' ' + c.description).toLowerCase().includes(q))
    .map((c) => ({ id: c.name, label: c.label, desc: c.description }));
}

function askCommandPopup() {
  const a = askState();
  if (a.command.mode === null && a.command.query === null) return '';
  const items = askCommandItems();
  const title = a.command.mode === 'model' ? '选择模型' : a.command.mode === 'think' ? '选择思考强度' : '快捷命令';
  return `<div class="ask-popup ask-slash-popup"><div class="ask-popup-title">${title}</div>
    ${items.map((item, i) => `<button type="button" class="${i === a.command.index ? 'is-hl' : ''}" data-act="ask-cmd" data-id="${esc(item.id)}"><b>${a.command.mode ? '' : '/'}${esc(item.id)}</b><span title="${esc(item.desc || '')}">${esc(item.label)}</span></button>`).join('')}
    ${items.length ? '' : '<p class="ask-popup-empty">暂无可用选项</p>'}</div>`;
}

/** 拉取当前项目工作区的文件（3 层内），给 @ 引用用。60 秒内复用缓存。 */
async function askLoadWorkspaceFiles(force) {
  const a = askState();
  if (!force && a.wsFiles && Date.now() - (a.wsFilesAt || 0) < 60000) return a.wsFiles;
  const pid = askProjectId();
  const out = [];
  const walk = async (dirPath, depth) => {
    if (depth > 4 || out.length > 400) return;
    try {
      const url = '/api/agent/workspace/tree' + (dirPath ? '?path=' + encodeURIComponent(dirPath) : '');
      const res = await fetch(url, { headers: { 'X-Project-Id': pid } });
      if (!res.ok) return;
      const data = await res.json();
      for (const it of data.items || []) {
        if (it.kind === 'directory') { await walk(it.relative_path, depth + 1); continue; }
        out.push({ name: it.name, path: it.relative_path, size: Number(it.size) || 0 });
        if (out.length > 400) return;
      }
    } catch (error) { /* 单层失败不影响其它目录 */ }
  };
  await walk('', 0);
  a.wsFiles = out;
  a.wsFilesAt = Date.now();
  return out;
}

function askMentionSkills() {
  const a = askState();
  const q = (a.mention && a.mention.query || '').toLowerCase();
  return askSkillList().filter((s) => (s.name + ' ' + s.description + ' ' + s.id).toLowerCase().includes(q));
}

/** @ 弹层的统一列表：技能 + 项目文件 + 本对话附件，键盘导航按这个顺序走 */
function askMentionItems() {
  const a = askState();
  const q = (a.mention && a.mention.query || '').toLowerCase();
  const skills = askMentionSkills().map((s) => ({ kind: 'skill', id: s.id, name: s.name, desc: s.description, icon: askSkillIcon(s.id) }));
  const seen = new Set();
  const files = [];
  for (const f of (a.attachments || [])) {
    const name = f.name || '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    files.push({ kind: 'file', id: name, name, desc: '本对话附件', icon: '📎' });
  }
  for (const f of (a.wsFiles || [])) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    files.push({ kind: 'file', id: f.path, name: f.name, desc: f.path, icon: '📄' });
  }
  const hit = files.filter((f) => !q || (f.name + ' ' + f.desc).toLowerCase().includes(q)).slice(0, 40);
  return [...skills, ...hit];
}

function askChooseMentionItem(item) {
  if (!item) return;
  if (item.kind === 'file') return askChooseFile(item.id);
  return askChooseMention(item.id);
}

function askMentionPopup() {
  const a = askState();
  if (!a.mention) return '';
  const items = askMentionItems();
  const groups = [];
  for (const it of items) {
    const name = it.kind === 'skill' ? '创作视角' : '项目文件';
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, items: [] }; groups.push(g); }
    g.items.push(it);
  }
  return `<div class="ask-popup ask-mention-popup">
    <div class="ask-popup-title"><span>✧ 引用技能或文件</span><small>${items.length} 项</small></div>
    ${groups.map((g) => `<div class="ask-popup-group"><div class="ask-popup-group-title">${g.name}</div>
      ${g.items.map((it) => {
        const i = items.indexOf(it);
        const mark = it.kind === 'skill' && askSkills().includes(it.id) ? '<span class="ask-check">✓</span>' : '<span class="ask-enter">↵</span>';
        return `<button type="button" class="${i === a.mention.index ? 'is-hl' : ''}" data-act="ask-mention" data-kind="${it.kind}" data-id="${esc(it.id)}">
          <span class="ask-mention-ico">${it.icon}</span>
          <span><b>${esc(it.name)}</b><small>${esc(it.desc || '')}</small></span>
          ${mark}
        </button>`;
      }).join('')}
    </div>`).join('')}
    ${items.some((it) => it.kind === 'file') ? '' : `<div class="ask-popup-group"><div class="ask-popup-group-title">项目文件</div><p class="ask-popup-empty">项目工作区里还没有文件；用 📎 上传，或先在素材库建素材。</p></div>`}
    ${items.length ? '' : '<p class="ask-popup-empty">没有匹配的技能或项目文件。</p>'}
    <div class="ask-popup-foot">↑ ↓ 选择 · Enter / Tab 确认 · Esc 关闭</div>
  </div>`;
}

function askTrajectoryHtml() {
  const a = askState();
  const data = a.trajectory;
  if (!data) return `<div class="ask-cap-empty">打开后加载最近 50 条运行轨迹…</div>`;
  const items = data.items || [];
  if (!items.length) return `<div class="ask-cap-empty">这条对话还没有运行轨迹</div>`;
  return `<div class="ask-traj">
    ${items.map((it) => `<div class="ask-traj-item ${esc(it.role || '')}">
      <span class="ask-traj-role">${it.role === 'user' ? '用户' : it.role === 'assistant' ? '助手' : '工具'}</span>
      <div><div class="ask-traj-head">${esc(it.kind || it.role || '')} · ${esc(askTimeText(it.time))}</div><p>${esc(String(it.content || '').slice(0, 500))}</p></div>
    </div>`).join('')}
    <div class="ask-traj-foot">共 ${esc(String(data.total || items.length))} 条${data.next_offset ? '' : ' · 已到最早'}
      ${data.next_offset ? `<button type="button" class="ask-btn" data-act="ask-traj-more">加载更早</button>` : ''}</div>
  </div>`;
}

function askOpenWorkspace() {
  const a=askState();
  a.capabilitiesOpen=true;
}

// 关闭整个工作区：右上角 ✕、以及「关掉最后一个标签」都走这里，效果完全一致
function askCloseWorkspace() {
  const a=askState();
  try { AgentWorkspace?.sync?.(a); } catch { /* 工作区还没建起来时忽略 */ }
  a.capabilitiesOpen=false;
  a.previewFile=null;
  a.previewData=null;
  a.mediaPreview=null;
  askRenderAll();
}
function askWorkspaceContext() {
  const a=askState();
  return {projectId:askProjectId(),sessionId:a.activeId,projectName:state.project?.name||'项目工作区',expanded:a.previewExpanded,
    state:()=>a,render:askRenderAll,toast,open:askOpenWorkspace,close:askCloseWorkspace,
    apply:view=>{a.previewFile=view.file;a.previewData=view.data;a.previewError=view.error;a.previewSheet=view.sheet;a.previewSource=view.source;a.mediaPreview=view.media;},
    previewHtml:()=>askFilePaneHtml(true),trajectoryHtml:askTrajectoryHtml,loadTrajectory:askLoadTrajectory};
}

// 浮层统一「点外面就收」。不能整页重渲染：pointerdown 里换掉 DOM 会把紧接着的 click
// 一起吃掉，用户点「新建对话」只会感觉点了没反应。所以只摘掉浮层本身、把按钮状态改回去。
function askDismissSummary() {
  const a = state.ask;
  if (!a || !a.summaryOpen) return false;
  a.summaryOpen = false;
  document.querySelector('.ask-summary')?.remove();
  const btn = document.querySelector('[data-act="ask-summary"]');
  if (btn) { btn.classList.remove('is-on'); btn.setAttribute('aria-expanded', 'false'); }
  return true;
}

// Header popovers close independently, without rebuilding the chat under the pointer.
document.addEventListener('pointerdown',event=>{
  const a=state.ask;if(!a)return;
  if(a.headerMenu&&!event.target.closest('.ask-head-actions')){a.headerMenu=false;document.querySelector('.ask-head-menu')?.remove();document.querySelector('[data-act="ask-head-menu"]')?.setAttribute('aria-expanded','false');}
  // Summary 是浮在对话上的卡片，点它以外任何地方都收起来，不用专门去够右上角的 ×
  if(a.summaryOpen&&!event.target.closest('.ask-summary')&&!event.target.closest('[data-act="ask-summary"]'))askDismissSummary();
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!state.ask)return;
  if(state.ask.headerMenu||state.ask.summaryOpen){state.ask.headerMenu=false;state.ask.summaryOpen=false;askRenderAll();}
});

function askCapabilityHtml() {
  return window.AgentWorkspace ? AgentWorkspace.html(askWorkspaceContext()) : '';
}
function askHeaderMenuHtml(chat) {
  const id=esc(chat.id||'');
  return '<div class="ask-head-menu" role="menu" aria-label="管理对话">'+
    '<button role="menuitem" data-act="ask-rename" data-id="'+id+'">重命名</button>'+
    '<button role="menuitem" data-act="ask-pin" data-id="'+id+'">'+(chat.pinned?'取消置顶':'置顶')+'</button><hr>'+
    '<button role="menuitem" data-act="ask-new">新建对话</button>'+
    '<button role="menuitem" data-act="ask-copy-conversation">复制对话文本</button>'+
    '<button role="menuitem" data-act="ask-export">导出对话</button></div>';
}
async function askLoadSummaryFiles() {
  const a=askState(),project=askProjectId(),sid=a.activeId;
  if(!sid)return;
  try {
    const result=await askApi('/workspace/session-files?'+new URLSearchParams({session_id:sid,kind:'output'})).then(r=>r.json());
    if(askProjectId()!==project||a.activeId!==sid)return;
    a.summaryFiles={project,sid,...result};if(a.summaryOpen)askRenderAll();
  }catch(err){if(a.summaryOpen)toast(err.message,true);}
}
// 最近一次运行带来的上下文分项统计（后端算好写进回执）
function askContextReport(chat) {
  const list = (chat && chat.messages) || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const report = list[i].execution && list[i].execution.context && list[i].execution.context.report;
    if (report && Array.isArray(report.items) && report.items.length) return report;
  }
  return null;
}

function askContextBlockHtml(chat, stats) {
  const report = askContextReport(chat);
  if (!report) {
    const ratio = Math.max(0, Math.min(1, stats.ratio || 0));
    return `<div class="ask-summary-usage"><b>${Math.round(ratio * 100)}% used</b><span>${askFmtTokens(stats.used)} / ${askFmtTokens(stats.total)}</span></div>
      <div class="ask-ctx-bar"><i class="ask-ctx-seg is-messages" style="width:${(ratio * 100).toFixed(2)}%"></i></div>
      <p class="ask-summary-hint">这个会话还没跑过</p>`;
  }
  const total = Math.max(1, Number(report.window) || stats.total || 1);
  const items = report.items || [];
  const width = (item) => Math.min(100, Math.max(0, (Number(item.tokens) || 0) / total * 100)).toFixed(2);
  const segments = items.map((item) => `<i class="ask-ctx-seg is-${esc(item.key)}" style="width:${width(item)}%" title="${esc(item.label)} · ${askFmtTokens(item.tokens)}"></i>`).join('');
  const rows = items.map((item) => `<div class="ask-ctx-row${item.key === 'free' ? ' is-free' : ''}">
      <span class="ask-ctx-dot is-${esc(item.key)}"></span>
      <span class="ask-ctx-label">${esc(item.label)}</span>
      <span class="ask-ctx-tokens">${askFmtTokens(item.tokens)}</span>
      <span class="ask-ctx-pct">${(Number(item.percent) || 0).toFixed(1)}%</span>
    </div>`).join('');
  const names = Array.isArray(report.tool_names) ? report.tool_names : [];
  const toolsMore = (report.tool_count || names.length)
    ? `<details class="ask-ctx-tools"><summary>Tools · ${report.tool_count || names.length}</summary><div class="ask-ctx-tool-list">${names.length ? names.map((name) => `<span>${esc(name)}</span>`).join('') : '<span>未记录工具名</span>'}</div></details>`
    : '';
  // 只留固定模块的用量：不讲口径，也不摆额外的计数行
  return `<div class="ask-summary-usage"><b>${(Number(report.used_percent) || 0).toFixed(0)}% used</b><span>${askFmtTokens(report.used)} / ${askFmtTokens(total)}</span></div>
    <div class="ask-ctx-bar">${segments}</div>
    ${rows}
    ${toolsMore}`;
}


// 项目所在文件夹的名字（不同项目不同）：D:\…\我的同桌测试-643a02 → 我的同桌测试-643a02
function askFolderName(value) {
  const parts = String(value || '').replace(/[\\/]+/g, '\\').split('\\').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

// 环境三行：本机 / 项目文件夹 / git 分支（分支还没有 git 逻辑，先如实显示 null）
function askEnvironmentHtml() {
  const folder = askFolderName(state.project?.dir) || state.project?.name || askProjectId();
  const branch = state.project?.branch ?? 'null';
  const icon = (name) => ({
    computer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
    branch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 8.2v7.6M18 11.2c0 3.4-3 4.6-6 4.6"/></svg>',
  }[name] || '');
  return `<div class="ask-env-row"><span class="ask-env-ico">${icon('computer')}</span><span class="ask-env-text">This Computer</span></div>`
    + `<div class="ask-env-row"><span class="ask-env-ico">${icon('folder')}</span><span class="ask-env-text" title="${esc(state.project?.dir || '')}">${esc(folder)}</span></div>`
    + `<div class="ask-env-row"><span class="ask-env-ico">${icon('branch')}</span><span class="ask-env-text is-muted">${esc(branch)}</span></div>`;
}

/* ---------- Connectors / Outputs / Changes 的小图标 ---------- */
const ASK_FILE_SHAPES = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  text: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  sheet: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6"/><path d="M8 13h8M8 17h8M12 13v5"/>',
  code: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  audio: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>',
  pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6"/><path d="M8 16c3-4 5 3 8-2"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6"/>',
};

// 按扩展名挑图标：文本 / 表格 / 代码 / 图片 / 视频 / 音频 / PDF / 其它
function askFileKind(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (!name || !ext || ext === String(name).toLowerCase()) return 'file';
  if (['md', 'txt', 'markdown', 'log', 'rtf'].includes(ext)) return 'text';
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) return 'sheet';
  if (['js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'json', 'html', 'css', 'sh', 'yml', 'yaml', 'sql'].includes(ext)) return 'code';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  return 'file';
}

function askFileIcon(name, kind) {
  const shape = ASK_FILE_SHAPES[kind || askFileKind(name)] || ASK_FILE_SHAPES.file;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${shape}</svg>`;
}

function askConnectorsHtml() {
  const a = askState();
  const toolsOk = a.toolsSupported !== false;
  const skill = askSkillNames().join(' + ');
  const row = (badge, text, muted) => `<div class="ask-env-row"><span class="ask-conn-badge">${badge}</span><span class="ask-env-text${muted ? ' is-muted' : ''}">${esc(text)}</span></div>`;
  return row('T', 'Tools · ' + (toolsOk ? 'available' : 'unavailable'), !toolsOk)
    + row('S', 'Skill · ' + (skill || 'null'), !skill)
    + row('C', 'MCP · null', true);
}

function askOutputsHtml(files, indexed) {
  const list = files || [];
  if (!list.length) return '<div class="ask-output-empty">null</div>';
  const rows = list.slice(-10).map((item) => {
    const name = item.type === 'artifact' ? (item.file && item.file.name) || '文件' : item.name || '文件';
    const isFolder = !!(item.file && item.file.kind === 'folder');
    const ico = `<span class="ask-file-ico">${askFileIcon(name, isFolder ? 'folder' : undefined)}</span>`;
    return item.type === 'artifact'
      ? `<button class="ask-summary-file" data-act="ask-preview" data-id="${esc(item.file.id)}">${ico}<span class="ask-file-name">${esc(name)}</span></button>`
      : `<button class="ask-summary-file" data-act="ask-open-media" data-index="${item.mi}" data-media="${item.fi}">${ico}<span class="ask-file-name">${esc(name)}</span></button>`;
  }).join('');
  const more = (indexed && indexed.total ? indexed.total : list.length) > 10 ? '<small>展示最近 10 项，全部文件可在工作区查看。</small>' : '';
  return rows + more;
}

// 改动统计还没有 GitHub 逻辑：固定一个小图标，值为 null
function askChangesHtml() {
  return '<div class="ask-changes"><span class="ask-changes-ico">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 7v4M6 9h4M14 15h4"/></svg>'
    + '</span><span class="ask-changes-text">null</span>'
    + '<button type="button" class="ask-changes-pr" disabled title="尚未接入 GitHub">Create PR</button></div>'
    + '<p class="ask-changes-note">GitHub 改动统计待接入，框位保留。</p>';
}

function askSummaryHtml(chat) {
  const a=askState(),stats=askContextStats();
  const indexed=a.summaryFiles?.project===askProjectId()&&a.summaryFiles?.sid===a.activeId?a.summaryFiles:null;
  const files=indexed?indexed.items.map(file=>({type:'artifact',file})):askSessionFiles(chat);
  return '<aside class="ask-summary" aria-label="Summary"><header><b>Summary</b><button class="ask-icon-btn" data-act="ask-summary" aria-label="关闭摘要">×</button></header>'+
    '<details open class="ask-summary-sec"><summary>Environment</summary>'+askEnvironmentHtml()+'</details>'+
    '<details open class="ask-summary-sec"><summary>Context</summary>'+askContextBlockHtml(chat,stats)+'</details>'+
    '<details open class="ask-summary-sec"><summary>Connectors</summary>'+askConnectorsHtml()+'</details>'+
    '<details open class="ask-summary-sec"><summary>Outputs</summary>'+askOutputsHtml(files,indexed)+'</details>'+
    '<details open class="ask-summary-sec"><summary>Changes</summary>'+askChangesHtml()+'</details></aside>';
}

/* 知识库 / 插件管理 */
function askPluginModeText(item) {
  const cfg = (item && item.config) || {};
  if (cfg.mode === 'bundle') {
    const count = Array.isArray(cfg.files) ? cfg.files.length : 0;
    return '完整技能 · ' + count + ' 个附加文件';
  }
  return '文本技能 · SKILL.md';
}

function askManageHtml() {
  const a = askState();
  const view = a.workspacePage;
  if (view === 'knowledge') {
    const items = a.kb || [];
    return `<section class="ask-manage">
      <header class="ask-manage-head">
        <div><h2>知识库</h2><p>项目级知识条目，智能体可检索引用。</p></div>
        <div class="ask-manage-actions">
          <button type="button" class="ask-btn" data-act="ask-manage-refresh">刷新</button>
          <button type="button" class="ask-btn is-primary" data-act="ask-manage-new">新建知识条目</button>
          <button type="button" class="ask-btn" data-act="ask-workspace" data-page="console">返回对话</button>
        </div>
      </header>
      ${a.manageError ? `<div class="ask-error">${esc(a.manageError)}</div>` : ''}
      <div class="ask-manage-list">
        ${items.length ? items.map((item) => `<article class="ask-manage-item">
          <div><b>${esc(item.name || '未命名')}</b><small>${esc(item.description || '')}</small></div>
          <div class="ask-manage-item-actions">
            <button type="button" data-act="ask-manage-edit" data-id="${esc(item.id)}">编辑</button>
            <button type="button" data-act="ask-manage-del" data-id="${esc(item.id)}">删除</button>
          </div>
        </article>`).join('') : '<div class="ask-cap-empty">还没有知识条目</div>'}
      </div>
    </section>`;
  }

  const tab = a.pluginTab || 'skill';
  const plugins = (a.plugins || []).filter((p) => (p.kind || 'skill') === tab);
  const labels = { tool: '工具管理', skill: '技能管理', mcp: 'MCP 管理' };
  const newLabels = { tool: '新建工具', skill: '新建技能', mcp: '新建 MCP' };
  const systemSkills = ((a.skills && a.skills.length) ? a.skills.filter((s) => s.source === 'builtin') : ASK_SKILLS.map((s) => ({ id: s.id, name: s.name, description: s.description }))).map((s) => ({ id: s.id, name: s.name, description: s.description }));
  const systemTools = ASK_INTERNAL_TOOLS.filter((t) => t.kind !== 'create').map((t) => ({ id: t.name, name: t.name, description: t.description }));
  const system = tab === 'skill' ? systemSkills : tab === 'tool' ? systemTools : [];
  const customTitle = tab === 'skill' ? '自定义技能' : tab === 'tool' ? '自定义工具' : '自定义 MCP';

  const row = (item, isSystem) => `<article class="ask-manage-item ${isSystem ? 'is-system' : ''}">
    <div>
      <b>${esc(item.name || '未命名')}</b>
      <small>${isSystem ? '系统内置 · 只读' : (tab === 'skill' ? askPluginModeText(item) + ' · 自定义' : '自定义')}${item.description ? ' · ' + esc(item.description) : ''}</small>
    </div>
    <div class="ask-manage-item-actions">
      <span class="ask-badge ${isSystem ? 'is-sys' : 'is-custom'}">${isSystem ? '系统' : '自定义'}</span>
      ${isSystem ? '' : `<button type="button" data-act="ask-manage-edit" data-id="${esc(item.id)}">编辑</button><button type="button" data-act="ask-manage-del" data-id="${esc(item.id)}">删除</button>`}
    </div>
  </article>`;

  return `<section class="ask-manage">
    <header class="ask-manage-head">
      <div><h2>插件管理</h2><p>系统内置只读；自定义技能 / 工具 / MCP 可以自由添加、编辑、删除。</p></div>
      <div class="ask-manage-actions">
        <button type="button" class="ask-btn" data-act="ask-manage-refresh">刷新</button>
        ${tab === 'skill' ? '<button type="button" class="ask-btn" data-act="ask-skill-install">安装技能</button>' : ''}
        <button type="button" class="ask-btn is-primary" data-act="ask-manage-new">${newLabels[tab]}</button>
        <button type="button" class="ask-btn" data-act="ask-workspace" data-page="console">返回对话</button>
      </div>
    </header>
    <nav class="ask-manage-tabs">
      ${['tool', 'skill', 'mcp'].map((k) => `<button type="button" class="${tab === k ? 'is-on' : ''}" data-act="ask-plugin-tab" data-tab="${k}">${labels[k]} <span>${(k === 'skill' ? systemSkills.length : k === 'tool' ? systemTools.length : 0) + (a.plugins || []).filter((p) => (p.kind || 'skill') === k).length}</span></button>`).join('')}
    </nav>
    ${a.manageError ? `<div class="ask-error">${esc(a.manageError)}</div>` : ''}
    <div class="ask-manage-scroll">
      <div class="ask-manage-section"><span>系统内置（不可更改）</span><small>${system.length} 项</small></div>
      <div class="ask-manage-list">
        ${system.length ? system.map((item) => row(item, true)).join('') : '<div class="ask-cap-empty">这一栏没有系统内置项</div>'}
      </div>
      <div class="ask-manage-section"><span>${customTitle}</span><small>${plugins.length} 项</small></div>
      <div class="ask-manage-list">
        ${plugins.length ? plugins.map((item) => row(item, false)).join('') : `<div class="ask-cap-empty">还没有自定义${tab === 'skill' ? '技能' : tab === 'tool' ? '工具' : ' MCP'}，点右上角新建</div>`}
      </div>
    </div>
  </section>`;
}

function askHistoryHtml() {
  const a = askState();
  const search = (a.search || '').toLowerCase();
  const matches = (c) => (c.id === a.activeId || (c.messages || []).length)
    && (c.title + ' ' + (c.messages || []).map((m) => m.text).join(' ')).toLowerCase().includes(search);
  // 对话只在项目内可见：这里永远只有当前项目一行
  const rows = (a.projectHistory && a.projectHistory.length)
    ? a.projectHistory
    : [{ id: askProjectId(), name: state.project?.name || '当前项目', items: a.conversations || [] }];
  const groups = rows.map((row) => ({
    id: row.id,
    label: row.name,
    error: row.error || '',
    items: (row.items || []).filter(matches).sort((x, y) => Number(!!y.pinned) - Number(!!x.pinned) || (y.updated || 0) - (x.updated || 0)),
  }));
  return `<aside class="ask-history ${a.historyOpen ? 'is-open' : ''}">
      <div class="ask-pane-heading">
        <span class="ask-pane-logo">Y9</span>
        <div><b>智能创作</b><small>剧本 · 分镜 · 提示词</small></div>
        <button type="button" class="ask-history-hide" data-act="ask-toggle-history" title="隐藏对话列表">‹</button>
      </div>
      <nav class="ask-workspace-nav">
        <button type="button" class="${a.workspacePage === 'console' ? 'is-on' : ''}" data-act="ask-workspace" data-page="console">▤ 控制台</button>
        <button type="button" data-act="ask-workspace" data-page="knowledge">📖 知识库</button>
        <button type="button" data-act="ask-workspace" data-page="plugins">🧩 插件</button>
      </nav>
      <div class="ask-sidebar-conversations">
        <button type="button" class="ask-new-chat" data-act="ask-new">＋ 新建对话</button>
        <div class="ask-history-search"><span>⌕</span><input id="ask-search" placeholder="搜索对话历史" value="${esc(a.search)}" /></div>
        <div class="ask-history-list">
          ${groups.map((g) => (g.items.length || g.id === askProjectId() ? `<div class="ask-folder-heading"><button type="button" class="ask-folder-toggle" data-act="ask-folder-toggle" data-id="${esc(g.id)}" aria-expanded="${!a.collapsedFolders?.[g.id]}" title="只显示当前项目的对话：${esc(g.label)}">${a.collapsedFolders?.[g.id] ? '▸' : '▾'} <span>${esc(g.label)}</span><small>${g.items.length}</small></button><button type="button" class="ask-folder-action" data-act="ask-project-new-chat" data-id="${esc(g.id)}" title="在${esc(g.label)}新建对话">＋</button></div>${g.error ? `<p class="ask-empty-history">${esc(g.error)}</p>` : ''}${(!a.collapsedFolders?.[g.id] || search ? g.items : []).map((c) => `<div class="ask-history-item ${c.id === a.activeId ? 'is-on' : ''} ${askRunOf(c.id) ? 'is-running' : ''}" data-id="${esc(c.id)}">
            <button type="button" class="ask-history-main" data-act="ask-open" data-id="${esc(c.id)}" data-project="${esc(g.id)}">
              ${(() => {
                const running = !!askRunOf(c.id);
                const flag = running ? 'is-running' : '';
                const mark = running ? '' : (c.pinned ? '◆' : '○');
                return `<span class="ask-history-flag ${flag}" title="${running ? '正在生成回复' : (c.pinned ? '已置顶' : '')}" aria-label="${running ? '正在生成回复' : ''}">${mark}</span>`;
              })()}<span><b>${esc(c.title || '新的创作对话')}</b><small>${esc(askPreview(c))}</small></span>
            </button>
            <button type="button" class="ask-history-more" data-act="ask-more" data-id="${esc(c.id)}" title="管理对话">⋯</button>
          </div>`).join('')}` : '')).join('')}
          ${groups.some((g) => g.items.length) ? '' : '<p class="ask-empty-history">还没有对话：选个项目，点「＋ 新建对话」开工</p>'}
        </div>
        ${a.removed ? `<div class="ask-undo">已删除一个对话<button type="button" data-act="ask-undo">撤销</button></div>` : ''}
      </div>
      <div class="ask-history-foot"><span>▤ 只显示当前项目的对话，切换项目即切换历史</span><span class="ask-dot"></span></div>
    </aside>`;
}

/* ------------------- 对话只在项目内可见：侧栏只列当前项目 ------------------- */
// 隔离层级是 租户 → 用户 → 项目：跨项目的对话一概不读、不列、不跳。
// 这里的「历史」只是当前项目那一行，内容永远跟 a.conversations 同源，不再向别的项目发请求。
async function askLoadProjectHistory() {
  const a = askState();
  const current = askProjectId();
  if (!current) {
    a.projectHistory = [];
    if (state.route === 'script') askRenderAll();
    return;
  }
  const project = (state.projects || []).find((p) => p.id === current);
  a.projectHistory = [{
    id: current,
    name: project ? project.name : (state.project ? state.project.name : '当前项目'),
    items: a.conversations || [],
  }];
  if (state.route === 'script') askRenderAll();
}

// 侧栏按项目分组渲染，当前项目的列表同时被 a.conversations 和 projectHistory 那一行引用；
// 任何增删都要两边一起改，否则删掉的对话还挂在侧栏里，点它就会报“不存在”。
function askSyncCurrentRowItems() {
  const a = askState();
  if (!Array.isArray(a.projectHistory) || !Array.isArray(a.conversations)) return;
  const row = a.projectHistory.find((r) => r.id === askProjectId());
  if (row) row.items = a.conversations;
}

function askFindConversation(id) {
  const a = askState();
  const hit = (a.conversations || []).find((c) => c.id === id);
  if (hit) return hit;
  for (const row of a.projectHistory || []) {
    const found = (row.items || []).find((c) => c.id === id);
    if (found) return found;
  }
  return null;
}

function askConversationProject(id) {
  const a = askState();
  if ((a.conversations || []).some((c) => c.id === id)) return askProjectId();
  for (const row of a.projectHistory || []) if ((row.items || []).some((c) => c.id === id)) return row.id;
  return askProjectId();
}

function askForgetConversation(id) {
  const a = askState();
  if (Array.isArray(a.conversations)) a.conversations = a.conversations.filter((c) => c.id !== id);
  for (const row of a.projectHistory || []) {
    if (Array.isArray(row.items)) row.items = row.items.filter((c) => c.id !== id);
  }
  if (a.moreMenu === id) a.moreMenu = null;
  if (a.rename && a.rename.id === id) a.rename = { open: false, id: '', text: '' };
  a.projectHistoryAt = 0;
  askSyncCurrentRowItems();
}

async function askOpenProjectConversation(projectId, convId) {
  const a = askState();
  // 对话属于它所在的项目：不是当前项目的一律不打开，也不偷偷切项目。
  if (projectId && projectId !== askProjectId()) {
    return toast('这个对话属于另一个项目，先切到那个项目再看', true);
  }
  if (!(a.conversations || []).some((c) => c.id === convId)) {
    // 侧栏里还留着已删掉的条目：摘掉它并跟服务端对齐，用户不用刷新页面
    askForgetConversation(convId);
    askRenderAll();
    askLoadProjectHistory().catch(() => {});
    return toast('这个对话已不在当前项目里，可能已被删除', true);
  }
  return askSelect(convId);
}

async function askNewChatInProject(projectId) {
  // 只在当前项目里新建；别处来的 id 直接无视，避免顺手把项目切走。
  if (projectId && projectId !== askProjectId()) return toast('请先切换到该项目再新建对话', true);
  const a = askState();
  return askNewConversation();
}

function askFilePaneHtml(embedded = false) {
  const a = askState();
  const media = a.mediaPreview;
  const file = a.previewFile;
  const data = a.previewData;
  const name = media ? media.name : (file ? file.name : '文件');
  const bytes = media ? media.bytes : (data && data.size) || (file && file.size) || 0;
  const kind = media ? media.kind : ((data && data.kind) || 'text');
  const expanded = !!a.previewExpanded;
  const contentUrl = file ? '/api/agent/workspace/files/' + encodeURIComponent(file.id) + '/content' : '';
  const rawUrl = file ? '/api/agent/workspace/files/' + encodeURIComponent(file.id) + '/raw?project=' + encodeURIComponent(askProjectId()) : '';
  const downloadUrl = media ? media.url : (file ? '/api/agent/workspace/files/' + encodeURIComponent(file.id) + '/download' : '');
  const labels = { image: '图片', video: '视频', audio: '音频', pdf: 'PDF', markdown: 'Markdown', html: 'HTML', spreadsheet: '表格', text: '文本', unsupported: '文件' };
  const kindLabel = media ? (media.kind === 'video' ? '视频' : '图片') : (labels[kind] || '文件');
  let body = '';
  if (media) {
    body = media.kind === 'video'
      ? `<div class="ask-pane-video"><video src="${esc(media.url)}" controls autoplay playsinline></video></div>`
      : `<div class="ask-pane-image"><img src="${esc(media.url)}" alt="" /></div>`;
  } else if (!data) {
    body = a.previewError
      ? `<div class="ask-pane-empty"><b>预览读取失败</b><span>${esc(a.previewError)}</span><button type="button" class="ask-btn" data-act="ask-preview-retry">重新加载</button><a class="ask-btn" href="${esc(downloadUrl)}" download>下载原件</a></div>`
      : '<div class="ask-pane-empty">正在读取文件预览…</div>';
  } else if (data.kind === 'spreadsheet') {
    const rows = data.rows || [];
    const columns = Math.max(0, ...rows.map((row) => row.length));
    const colName = (index) => { let out = ''; let n = index; do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0); return out; };
    body = `<div class="ask-sheet"><div class="ask-sheet-caption">只读预览 · ${data.total_rows ?? rows.length} 行 / ${data.total_columns ?? columns} 列 · 不执行公式</div>
      <div class="ask-sheet-scroll"><table><thead><tr><th class="row-number">#</th>${Array.from({ length: columns }, (_, i) => `<th>${colName(i)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((row, ri) => `<tr><th class="row-number">${ri + 1}</th>${Array.from({ length: columns }, (_, ci) => `<td>${esc(String(row[ci] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  } else if (data.kind === 'markdown') {
    body = a.previewSource ? `<pre class="ask-pane-text">${esc(data.content || '')}</pre>` : `<div class="ask-pane-markdown ask-md">${markdownLite(data.content || '')}</div>`;
  } else if (data.kind === 'html') {
    body = a.previewSource
      ? `<pre class="ask-pane-text">${esc(data.content || '')}</pre>`
      : `<iframe class="ask-pane-html" sandbox="" referrerpolicy="no-referrer" srcdoc="${esc(data.content || '')}" title="隔离的 HTML 文件预览"></iframe>`;
  } else if (data.kind === 'image') {
    body = `<div class="ask-pane-image"><img src="${rawUrl}" alt="${esc(name)}" /></div>`;
  } else if (data.kind === 'pdf') {
    body = `<iframe class="ask-pane-html" src="${rawUrl}" title="PDF 文件预览"></iframe>`;
  } else if (data.kind === 'audio') {
    body = `<div class="ask-pane-media"><b>${esc(name)}</b><audio src="${rawUrl}" controls preload="metadata"></audio><p>音频播放</p></div>`;
  } else if (data.kind === 'video') {
    body = `<div class="ask-pane-video"><video src="${rawUrl}" controls preload="metadata" playsinline></video></div>`;
  } else if (data.kind === 'text') {
    body = `<pre class="ask-pane-text">${esc(data.content || data.text || '（没有可预览的文本）')}</pre>`;
  } else {
    body = `<div class="ask-pane-empty"><b>该格式暂不支持在线预览</b><span>${esc(data.message || '可以下载原件后用对应软件打开。')}</span><a class="ask-btn" href="${esc(downloadUrl)}" download>下载原件</a></div>`;
  }
  const isDoc = data && ['markdown', 'html'].includes(data.kind) && !media;
  const sheets = data && data.kind === 'spreadsheet' && Array.isArray(data.sheets) ? data.sheets : [];
  const paneStyle = !embedded && !expanded && a.previewWidth ? ` style="width:${a.previewWidth}px"` : '';
  return `<aside class="ask-file-pane ${embedded ? 'is-workspace-preview' : expanded ? 'is-expanded' : ''}"${paneStyle}>
    ${embedded || expanded ? '' : '<div class="ask-pane-resizer" role="separator" aria-label="调整聊天与预览宽度" aria-orientation="vertical" tabindex="0" title="拖动调整宽度，双击复位"><span></span></div>'}
    <header class="ask-file-head">
      <span class="ask-file-icon">${kind === 'video' ? '🎬' : kind === 'image' ? '🖼' : '📄'}</span>
      <div><b title="${esc(name)}">${esc(name)}</b><small>${kindLabel}预览${bytes ? ' · ' + fmtBytes(bytes) : ''}</small></div>
      ${file && data && ['text', 'markdown', 'html'].includes(data.kind) ? `<button type="button" class="ask-icon-btn" data-act="ask-copy-file-content" data-id="${esc(file.id)}" title="复制文件内容" aria-label="复制文件内容"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>` : ''}
      ${downloadUrl ? `<a class="ask-icon-btn" href="${esc(downloadUrl)}" download="${esc(name)}" title="下载原件">⇩</a>` : ''}
      ${file ? `<button type="button" class="ask-icon-btn" data-act="ask-reveal-pane" data-id="${esc(file.id)}" title="打开文件所在文件夹"><span class="ask-icon-folder">📁</span></button>` : ''}
      <button type="button" class="ask-icon-btn" data-act="ask-expand-preview" title="${expanded ? '缩小预览' : '展开预览'}">${expanded ? '⤡' : '⤢'}</button>
      <button type="button" class="ask-icon-btn" data-act="ask-close-pane" title="关闭预览">×</button>
    </header>
    ${isDoc ? `<nav class="ask-pane-mode"><button type="button" class="${a.previewSource ? '' : 'is-on'}" data-act="ask-preview-source" data-mode="preview">预览</button><button type="button" class="${a.previewSource ? 'is-on' : ''}" data-act="ask-preview-source" data-mode="source">源码</button>${data.kind === 'html' ? '<span>隔离预览 · 不执行脚本</span>' : ''}</nav>` : ''}
    ${sheets.length ? `<nav class="ask-pane-sheets">${sheets.map((sheet, i) => `<button type="button" class="${i === (data.sheet || 0) ? 'is-on' : ''}" data-act="ask-preview-sheet" data-sheet="${i}">${esc(sheet)}</button>`).join('')}</nav>` : ''}
    <div class="ask-file-body">${body}</div>
    ${data && data.truncated ? `<footer class="ask-file-foot">预览显示${data.kind === 'spreadsheet' ? '前 100 行、最多 50 列' : '前 20 万字符'}，下载可获取原件。</footer>` : (data && data.kind === 'pdf' ? '<footer class="ask-file-foot">PDF 使用浏览器内置阅读器；无法显示时可下载原件。</footer>' : (media ? '' : '<footer class="ask-file-foot">只读预览 · 文件保存在项目工作区。</footer>'))}
  </aside>`;
}
function renderScript() {
  const a = askState();
  if (!a.conversations) {
    if (!a.loading) {
      a.loading = true;
      askRestore();
    }
    return `<div class="ask-app"><div class="ask-loading">正在连接智能体服务…</div></div>`;
  }
  if (a.workspacePage !== 'console') return `<div class="ask-app">${askHistoryHtml()}<section class="ask-chat" style="padding:0">${askManageHtml()}</section>
    ${a.installSkill ? askInstallSkillHtml() : ''}
  </div>`;

  const active = askActive();
  const chat = active || { title: '新的创作对话', messages: [] };
  const messages = chat.messages || [];
  const search = (a.search || '').toLowerCase();
  const filtered = (a.conversations || [])
    .filter((c) => (c.id === a.activeId || (c.messages || []).length))
    .filter((c) => (c.title + ' ' + (c.messages || []).map((m) => m.text).join(' ')).toLowerCase().includes(search))
    .sort((x, y) => (y.updated || 0) - (x.updated || 0));
  const groups = [
    { label: '置顶对话', items: filtered.filter((c) => c.pinned) },
    { label: '最近对话', items: filtered.filter((c) => !c.pinned) },
  ];

  return `<div class="ask-app ${a.historyOpen ? '' : 'is-history-collapsed'}">
    ${askHistoryHtml()}

    <section class="ask-chat ${messages.length ? '' : 'is-empty'}">
      <header class="ask-chat-head">
        <div class="ask-chat-heading">
          <button type="button" class="ask-icon-btn" data-act="ask-toggle-history" title="切换对话列表">☰</button>
          <div><h1>${esc(chat.title || '新的创作对话')}</h1></div>
        </div>
        <div class="ask-head-actions">
          <button type="button" class="ask-icon-btn" data-act="ask-head-menu" aria-label="管理" aria-haspopup="menu" aria-expanded="${!!a.headerMenu}" title="管理">⋯</button>
          <button type="button" class="ask-icon-btn ${a.summaryOpen?'is-on':''}" data-act="ask-summary" aria-label="Summary" aria-expanded="${!!a.summaryOpen}" title="Summary"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="5" cy="6" r="2"/><circle cx="5" cy="17" r="2"/><path d="M11 6h10M11 12h10M11 18h10"/></svg></button>
          <span class="aw-head-divider"></span><button type="button" class="ask-icon-btn" data-act="ask-new-workspace" aria-label="新建标签页" title="新建标签页"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 7v10M7 12h10"/></svg></button>

          ${a.headerMenu?askHeaderMenuHtml(chat):''}
        </div>
      </header>

      <div class="ask-chat-body">
        <div class="ask-messages" id="ask-messages">
          ${a.error ? `<div class="ask-error">${esc(a.error)}</div>` : ''}
          ${messages.length ? `<div class="ask-message-list">${askMessagesHtml(chat)}
            ${a.generating ? `<div class="ask-generation"><span class="ask-pulse"></span><b>模型回复生成中</b><span>整理问题与所选技能…</span><span class="ask-gen-elapsed">0s</span><button type="button" data-act="ask-stop">停止</button></div>` : ''}
          </div>` : askWelcomeHtml()}
        </div>
        ${askTurnsHtml(chat)}
      </div>

      ${askComposerHtml()}
    </section>

    ${a.capabilitiesOpen ? askCapabilityHtml() : ''}
    ${a.summaryOpen ? askSummaryHtml(chat) : ''}
    ${a.rename.open ? askRenameModalHtml() : ''}
    ${a.installSkill ? askInstallSkillHtml() : ''}
    ${a.toolDetail ? askToolModalHtml() : ''}
    ${a.moreMenu ? askMoreMenuHtml() : ''}
    <input type="file" id="ask-file" hidden multiple accept=".txt,.md,.csv,.json,.xlsx,.docx,.pdf,.png,.jpg,.jpeg,.webp,.html,.mp3,.wav,.m4a,.mp4,.webm" />
  </div>`;
}

// 一轮 = 一条用户提问 + 它后面的所有助手消息（直到下一条提问）
function askTurnSpan(messages, index) {  const list = messages || [];
  const target = list[index];
  if (!target || target.role !== 'user') return null;
  let end = index + 1;
  while (end < list.length && list[end].role !== 'user') end += 1;
  return { start: index, end, count: end - index };
}

/* --------------------------- 待发送队列（按对话持久化） --------------------------- */
function askQueueKey(chatId) { return 'wmd.ask.queue.' + chatId; }

function askLoadQueue(chatId) {
  const a = askState();
  if (!a.queues) a.queues = {};
  const id = chatId || a.activeId;
  if (!id) return [];
  if (!Array.isArray(a.queues[id])) {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(askQueueKey(id)) || '[]'); } catch { saved = []; }
    a.queues[id] = Array.isArray(saved) ? saved.filter((x) => x && x.text) : [];
  }
  return a.queues[id];
}

function askSaveQueue(chatId) {
  const a = askState();
  const id = chatId || a.activeId;
  if (!id) return;
  try { localStorage.setItem(askQueueKey(id), JSON.stringify((a.queues && a.queues[id]) || [])); } catch { /* ignore */ }
}

function askEnqueue(raw, chatId, webSearch = !!askState().webSearch, turn = null) {
  const a = askState();
  const id = chatId || a.activeId;
  const text = String(raw || '').trim();
  if (!id || !text) return;
  const list = askLoadQueue(id);
  // 技能 / 模型 / 权限跟着这一条一起存：出队时用户可能已经换成别的了，
  // 读实时状态会把上一句话的配置配到这一句上。
  list.push({ id: askId(), text, time: Date.now(), webSearch: !!webSearch, turn: turn || askTurnSnapshot() });
  askSaveQueue(id);
  if (id === a.activeId) {
    a.draft = '';
    const input = $('#ask-input');
    if (input) input.value = '';
    askRenderAll();
  }
  toast('已排队第 ' + list.length + ' 条，当前回复结束后依次发送');
}

/* ------------------- 直发 = 当前任务的补充说明（不是新任务） ------------------- */
// 有任务在跑时：这句话并进当前运行，任务不中断、不重启、已完成步骤与中间结果全部保留。
async function askSupplementSend(text, chatId) {
  const a = askState();
  const id = chatId || a.activeId;
  const body = String(text || '').trim();
  const run = askRunOf(id);
  const runId = (run && run.runId) || '';
  if (!id || !body) return { ok: false, code: 'empty' };
  const url = runId
    ? '/api/agent/runs/' + encodeURIComponent(runId) + '/supplements'
    : '/api/agent/sessions/' + encodeURIComponent(id) + '/supplements';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
      body: JSON.stringify({ text: body }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data.detail || {};
      return {
        ok: false,
        code: (detail && detail.code) || 'error',
        message: typeof detail === 'string' ? detail : ((detail && detail.message) || '补充说明未送达'),
        runId,
      };
    }
    return { ok: true, ...data, runId: data.run_id || runId };
  } catch (err) {
    return { ok: false, code: 'network', message: err.message || '补充说明未送达', runId };
  }
}

function askQueueMark(chatId, ids, state) {
  const a = askState();
  const id = chatId || a.activeId;
  const list = askLoadQueue(id);
  const wanted = ids || [];
  let hit = false;
  for (const item of list) {
    if (item.sup && wanted.includes(item.sup.id)) { item.sup.state = state; hit = true; }
  }
  if (hit) { askSaveQueue(id); if (a.activeId === id) askRenderSoon(); }
}

function askQueueAck(chatId, ids) {
  const a = askState();
  const id = chatId || a.activeId;
  const list = askLoadQueue(id);
  const wanted = ids || [];
  if (!list.length || !wanted.length) return;
  let hit = false;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    if (item.sup && wanted.includes(item.sup.id)) { list.splice(i, 1); hit = true; }
  }
  if (hit) { askSaveQueue(id); if (a.activeId === id) askRenderSoon(); }
}

// 一轮收尾：以服务端记录为准核对每条补充说明——已并入的删掉，没赶上的退回普通排队继续发。
async function askQueueSettle(chatId, runId) {
  const a = askState();
  const id = chatId || a.activeId;
  const list = askLoadQueue(id);
  const marks = list.filter((x) => x.sup);
  if (!marks.length) return;
  const target = runId || (marks[0].sup && marks[0].sup.runId) || '';
  let snapshot = null;
  if (target) {
    try {
      const res = await fetch('/api/agent/runs/' + encodeURIComponent(target) + '/supplements', {
        headers: { 'X-Project-Id': askProjectId() }, signal: AbortSignal.timeout(8000),
      });
      if (res.ok) snapshot = await res.json();
    } catch { /* 拿不到就用本地状态兜底 */ }
  }
  const status = new Map(((snapshot && snapshot.items) || []).map((x) => [x.id, x.status]));
  const keep = [];
  let back = 0;
  for (const item of list) {
    if (!item.sup) { keep.push(item); continue; }
    const state = status.get(item.sup.id) || (item.sup.state === 'applied' ? 'applied' : '');
    if (state === 'applied') continue;           // 已并入当前任务，删掉
    delete item.sup;                             // 没赶上检查点：退回普通排队
    back += 1;
    keep.push(item);
  }
  list.length = 0;
  list.push(...keep);
  askSaveQueue(id);
  if (a.activeId === id) askRenderAll();
  if (back) toast(back + ' 条补充说明没赶上执行检查点，已退回队列接着发送');
}

// 一轮结束后只发队首那一条，剩下继续排队
function askDrainQueue(chatId) {
  const a = askState();
  const id = chatId || a.activeId;
  if (!id || askRunOf(id)) return;
  const list = askLoadQueue(id);
  if (!list.length) return;
  const next = list.shift();
  askSaveQueue(id);
  if (a.activeId === id) askRenderAll();
  setTimeout(() => { askSend(next.text, id, !!next.webSearch, next.turn || null).catch(() => {}); }, 150);
}

function askQueueHtml() {
  const a = askState();
  const list = askLoadQueue(a.activeId);
  if (!list.length) return '';
  const running = !!askRunOf(a.activeId);
  const rows = list.slice(0, 3).map((item, i) => `<div class="ask-queue-item">
      <span class="ask-queue-idx">${i + 1}</span>
      <span class="ask-queue-text" title="${esc(item.text)}">${esc(item.text)}</span>
      ${item.sup ? `<span class="ask-queue-state">${item.sup.state === 'applied' ? '已并入' : '等检查点'}</span>` : ''}
      ${(i === 0 && !item.sup) ? `<button type="button" class="ask-queue-btn is-direct" data-act="ask-queue-now" data-id="${esc(item.id)}" title="${running ? '直接发送：作为补充说明交给正在执行的任务，不中断执行' : '马上发送这条'}">↑</button>` : ''}
      <button type="button" class="ask-queue-btn is-danger" data-act="ask-queue-cancel" data-id="${esc(item.id)}" title="从队列里取消这条">×</button>
    </div>`).join('');
  const hint = running ? '队首 ↑：补充给当前任务，不中断执行' : '当前没有任务在跑，点 ↑ 立即发送';
  return `<div class="ask-queue" role="region" aria-label="待发送队列">
    <div class="ask-queue-head"><span>待发送 <b>${list.length}</b> 条</span><span class="ask-queue-hint">${hint}</span></div>
    ${rows}
    ${list.length > 3 ? `<div class="ask-queue-rest">后面还有 ${list.length - 3} 条，依次排队</div>` : ''}
  </div>`;
}

// 右侧轮次滑条：一轮一个小格，点一下跳到该轮用户提问；右侧面板打开时不显示
function askTurnsHtml(chat) {
  const a = askState();
  if (a.previewFile || a.mediaPreview || a.capabilitiesOpen) return '';
  const messages = (chat && chat.messages) || [];
  const turns = messages.map((m, index) => ({ m, index })).filter((x) => x.m.role === 'user');
  if (turns.length < 2) return '';
  return `<div class="ask-turns" role="navigation" aria-label="对话轮次">
    <div class="ask-turn-tip" hidden></div>
    ${turns.map((t, order) => `<button type="button" data-act="ask-jump" data-index="${t.index}" data-order="${order}" data-tip="第 ${order + 1} 轮：${esc(String(t.m.text || '').replace(/\s+/g, ' ').slice(0, 20))}" title="第 ${order + 1} 轮"><i></i></button>`).join('')}
  </div>`;
}

// 悬停滑条时弹出这一轮问题的前 20 个字
function askBindTurnTips() {
  const rail = document.querySelector('.ask-turns');
  if (!rail || rail._tipsBound) return;
  rail._tipsBound = true;
  const tip = rail.querySelector('.ask-turn-tip');
  if (!tip) return;
  const show = (event) => {
    const btn = event.target.closest('button[data-tip]');
    if (!btn) return;
    tip.textContent = btn.dataset.tip;
    tip.hidden = false;
    const body = rail.parentElement.getBoundingClientRect();
    const rect = btn.getBoundingClientRect();
    const top = rect.top - body.top + rect.height / 2 - tip.offsetHeight / 2;
    tip.style.top = Math.round(Math.max(2, Math.min(body.height - tip.offsetHeight - 2, top))) + 'px';
  };
  const hide = () => { tip.hidden = true; };
  rail.addEventListener('mouseover', show);
  rail.addEventListener('mouseleave', hide);
  rail.addEventListener('click', hide);
  rail.addEventListener('scroll', hide, true);
}

function askSyncTurns() {
  const host = $('#ask-messages');
  const rail = document.querySelector('.ask-turns');
  if (!host || !rail) return;
  const nodes = [...host.querySelectorAll('.ask-message[data-msg-index]')];
  if (!nodes.length) return;
  const top = host.getBoundingClientRect().top + 8;
  let active = -1;
  for (const node of nodes) {
    if (node.getBoundingClientRect().top <= top + 40) {
      if (node.classList.contains('is-user')) active = Number(node.dataset.msgIndex);
    }
  }
  for (const btn of rail.querySelectorAll('button')) {
    btn.classList.toggle('is-on', Number(btn.dataset.index) === active);
  }
}

function askJumpToTurn(host, node) {
  if (!host || !node) return;
  const a = askState();
  a.pinBottom = false;
  a.jumpUntil = Date.now() + 1400; // 跳转动画期间别让“贴底”逻辑把位置拉回去
  const target = () => Math.round(node.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 10);
  host.scrollTo({ top: Math.max(0, target()), behavior: 'smooth' });
  // 图片/懒加载会让上面的高度变化，动画结束后再校正几次，确保停在目标轮次
  if (a._jumpTimer) clearTimeout(a._jumpTimer);
  let tries = 0;
  const settle = () => {
    a._jumpTimer = null;
    if (!document.body.contains(node)) return;
    const drift = Math.round(node.getBoundingClientRect().top - host.getBoundingClientRect().top - 10);
    if (Math.abs(drift) > 8 && tries < 6) {
      tries += 1;
      host.scrollTop = Math.max(0, target());
      a.jumpUntil = Date.now() + 400;
      a._jumpTimer = setTimeout(settle, 120);
    }
  };
  a._jumpTimer = setTimeout(settle, 430);
}

function askMediaModalHtml() {
  const a = askState();
  const f = a.mediaPreview;
  const url = f.url || '';
  return `<div class="ask-modal-backdrop" data-act="ask-close-media">
    <div class="ask-modal is-wide">
      <div class="ask-modal-head"><b>${esc(f.name || '媒体')}</b><button type="button" data-act="ask-close-media">×</button></div>
      <div class="ask-modal-body is-media">
        ${f.kind === 'video'
          ? `<video class="ask-media-video" src="${esc(url)}" controls autoplay playsinline></video>`
          : `<img class="ask-preview-img" src="${esc(url)}" alt="" />`}
      </div>
      <div class="ask-modal-foot">
        <a class="ask-btn" href="${esc(url)}" download="${esc(f.name || 'file')}" target="_blank" rel="noreferrer">下载</a>
        <button type="button" class="ask-btn is-primary" data-act="ask-close-media">关闭</button>
      </div>
    </div>
  </div>`;
}

function askPreviewModalHtml() {
  const a = askState();
  const f = a.previewFile;
  const preview = a.previewData;
  return `<div class="ask-modal-backdrop" data-act="ask-close-preview">
    <div class="ask-modal is-wide">
      <div class="ask-modal-head"><b>${esc(f.name || '交付文件')}</b><button type="button" data-act="ask-close-preview">×</button></div>
      <div class="ask-modal-body">
        ${preview ? (preview.kind === 'image' ? `<img class="ask-preview-img" src="${esc(preview.url || '')}" alt="" />` : `<pre class="ask-preview-text">${esc(preview.text || '（没有可预览的文本）')}</pre>`) : '<div class="ask-cap-empty">正在加载预览…</div>'}
      </div>
      <div class="ask-modal-foot">
        <a class="ask-btn" href="/api/agent/workspace/files/${encodeURIComponent(f.id)}/download" target="_blank" rel="noreferrer">下载</a>
        <button type="button" class="ask-btn is-primary" data-act="ask-close-preview">关闭</button>
      </div>
    </div>
  </div>`;
}

function askRenameModalHtml() {
  const a = askState();
  return `<div class="ask-modal-backdrop" data-act="ask-rename-cancel">
    <div class="ask-modal">
      <div class="ask-modal-head"><b>重命名对话</b><button type="button" data-act="ask-rename-cancel">×</button></div>
      <div class="ask-modal-body"><input class="ask-input is-line" id="ask-rename-input" maxlength="60" value="${esc(a.rename.text)}" /></div>
      <div class="ask-modal-foot"><button type="button" class="ask-btn" data-act="ask-rename-cancel">取消</button><button type="button" class="ask-btn is-primary" data-act="ask-rename-save">保存</button></div>
    </div>
  </div>`;
}

function askToolModalHtml() {
  const t = askState().toolDetail;
  return `<div class="ask-modal-backdrop" data-act="ask-close-tool">
    <div class="ask-modal">
      <div class="ask-modal-head"><b>${esc(t.name)}</b><button type="button" data-act="ask-close-tool">×</button></div>
      <div class="ask-modal-body">
        <p class="ask-tool-desc">${esc(t.description)}</p>
        <div class="ask-kv"><span>所属模块</span><b>${esc(t.scope)}</b></div>
        <div class="ask-kv"><span>接入状态</span><b>尚未接入</b></div>
        <div class="ask-kv"><span>权限范围</span><b>当前项目内只读（设计目标）</b></div>
        <div class="ask-kv"><span>执行方式</span><b>后续通过本地接口执行，当前不可用</b></div>
      </div>
      <div class="ask-modal-foot"><button type="button" class="ask-btn is-primary" data-act="ask-close-tool">关闭</button></div>
    </div>
  </div>`;
}

function askInstallSkillHtml() {
  const d = askState().installSkill;
  return `<div class="ask-modal-backdrop"><div class="ask-modal is-wide" role="dialog" aria-modal="true" aria-label="安装技能">
    <div class="ask-modal-head"><b>安装技能</b><button type="button" data-act="ask-install-cancel" aria-label="关闭">×</button></div>
    <div class="ask-modal-body">
      <label for="ask-install-name">技能名称</label>
      <input class="ask-input is-line" id="ask-install-name" maxlength="100" placeholder="例如：短剧钩子诊断" value="${esc(d.name || '')}" />
      <label for="ask-install-desc">一句话说明</label>
      <input class="ask-input is-line" id="ask-install-desc" maxlength="300" placeholder="这个技能做什么、什么时候用" value="${esc(d.description || '')}" />
      <label for="ask-install-content">技能内容（SKILL.md 正文）</label>
      <textarea class="ask-input" id="ask-install-content" rows="10" placeholder="粘贴 SKILL.md 正文，或点下面的按钮选择 .md 文件">${esc(d.content || '')}</textarea>
      <div class="ask-install-tools">
        <button type="button" class="ask-btn" data-act="ask-install-file">选择 .md 文件</button>
        <span class="ask-install-hint">上限 60000 字符；保存到智能体后端的 skills/ 目录，同名技能会被覆盖升级，换项目也能用。</span>
        <input type="file" id="ask-install-file" accept=".md,.txt,.markdown" hidden />
      </div>
      ${d.error ? `<div class="ask-error">${esc(d.error)}</div>` : ''}
    </div>
    <div class="ask-modal-foot">
      <button class="ask-btn" type="button" data-act="ask-install-cancel">取消</button>
      <button class="ask-btn is-primary" type="button" data-act="ask-install-save" ${d.saving ? 'disabled' : ''}>${d.saving ? '安装中…' : '安装'}</button>
    </div>
  </div></div>`;
}

async function askSaveInstallSkill() {
  const a = askState();
  const d = a.installSkill;
  if (!d || d.saving) return;
  const name = ($('#ask-install-name') || {}).value || '';
  const description = ($('#ask-install-desc') || {}).value || '';
  const content = ($('#ask-install-content') || {}).value || '';
  d.name = name;
  d.description = description;
  d.content = content;
  if (!name.trim()) { d.error = '请填写技能名称'; askRenderAll(); return; }
  if (!content.trim()) { d.error = '请粘贴 SKILL.md 正文或选择文件'; askRenderAll(); return; }
  d.saving = true;
  d.error = '';
  askRenderAll();
  try {
    const res = await askApi('/skills/install', { method: 'POST', body: JSON.stringify({ name: name.trim(), description: description.trim(), content }) });
    const data = await res.json().catch(() => ({}));
    await askLoadSkills();
    await askLoadManage();
    a.installSkill = null;
    a.pluginTab = 'skill';
    a.workspacePage = 'plugins';
    if (state.route === 'script') askRenderAll();
    toast((data && data.reinstalled ? '已覆盖升级技能：' : '已安装技能：') + name.trim());
  } catch (err) {
    d.saving = false;
    d.error = err.message || '安装失败';
    askRenderAll();
  }
}

function askMoreMenuHtml() {
  const a = askState();
  const c = askFindConversation(a.moreMenu);
  if (!c) return '';
  return `<div class="ask-more-menu" role="menu" aria-label="管理对话：${esc(c.title || '新的创作对话')}" style="visibility:hidden">
    <button type="button" data-act="ask-pin" data-id="${esc(c.id)}">${c.pinned ? '取消置顶' : '置顶对话'}</button>
    <button type="button" data-act="ask-rename" data-id="${esc(c.id)}">重命名</button>
    <button type="button" class="is-danger" data-act="ask-delete" data-id="${esc(c.id)}">删除对话</button>
  </div>`;
}

document.addEventListener('contextmenu', (event) => {
  const row = event.target.closest('.ask-history-item');
  if (!row || state.route !== 'script') return;
  const trigger = row.querySelector('.ask-history-main');
  if (!trigger) return;
  event.preventDefault();
  askState().moreMenu = trigger.dataset.id;
  askRenderAll();
});

function askCloseMoreMenu() {
  if (state.ask) state.ask.moreMenu = null;
  $('.ask-more-menu')?.remove();
}

function askPositionMoreMenu() {
  const menu = $('.ask-more-menu');
  if (!menu) return;
  const id = askState().moreMenu;
  const trigger = $$('.ask-history-main').find((button) => button.dataset.id === id);
  const list = $('.ask-history-list');
  if (!trigger || !list) return askCloseMoreMenu();
  const row = trigger.closest('.ask-history-item').getBoundingClientRect();
  const bounds = list.getBoundingClientRect();
  if (row.bottom <= bounds.top || row.top >= bounds.bottom) return askCloseMoreMenu();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const left = row.right + 8 + width <= window.innerWidth - 8 ? row.right + 8 : Math.max(8, row.left - width - 8);
  menu.style.left = Math.min(left, Math.max(8, window.innerWidth - width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(row.top, window.innerHeight - height - 8)) + 'px';
  menu.style.visibility = 'visible';
}

document.addEventListener('pointerdown', (event) => {
  if (state.ask?.moreMenu && !event.target.closest('.ask-more-menu, .ask-history-item')) askCloseMoreMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') askCloseMoreMenu();
});
document.addEventListener('scroll', (event) => {
  if (event.target.matches?.('.ask-history-list')) askPositionMoreMenu();
}, true);
window.addEventListener('resize', askPositionMoreMenu);

function askRenderAll() {
  if (state.route !== 'script') return;
  const view = $('#view');
  if (!view) return;
  const host = $('.route-host', view);
  if (!host) return;
  const historyScroll = $('.ask-history-list', host)?.scrollTop || 0;
  const chatScroll = askCaptureScroll($('#ask-messages', host));
  const a = askState();
  const wantBottom = a.scrollIntent === 'bottom';
  if (wantBottom) a.scrollIntent = null;
  host.innerHTML = renderScript();
  bindAsk(host);
  askRenderPopups();
  const historyList = $('.ask-history-list', host);
  if (historyList) historyList.scrollTop = historyScroll;
  askPositionMoreMenu();
  const msgs = $('#ask-messages');
  if (msgs) {
    askBindScrollPin(msgs);
    // 删掉末尾一轮时明确要求停在新末尾；其余情况按重绘前的位置复位，别甩回开头
    if (wantBottom) askHoldScroll(msgs, { atBottom: true });
    else if (chatScroll) askHoldScroll(msgs, chatScroll);
    else if (askLastScroll(a)) askHoldScroll(msgs, askLastScroll(a));
    else if (askFollowBottom()) msgs.scrollTop = msgs.scrollHeight;
    askReportScrollJump(chatScroll, msgs, 'askRenderAll');
  }
  askUpdateContextMeter();
  askBindTurnTips();
  guHydrateRefs($('#ask-messages', view));
}

// 是否跟随到底部：只有用户本来就在底部才跟随，一旦往上翻就停下来
function askFollowBottom() {
  const a = askState();
  return a.pinBottom !== false;
}

/* --------------------- 重绘后保住聊天区滚动位置 ---------------------
   整块重绘（开预览、切源码/工作表、删掉一轮、开关面板）会重建 #ask-messages，
   新的滚动容器 scrollTop 是 0，于是聊天记录被甩回开头，还得重新往下划。
   这里在重绘前记下“视口顶部压在哪条消息、偏移多少”，重绘后按同一条消息复位；
   锚点恰好被删掉时按内容高度差补偿，绝不落回开头。 */
const askScrollHold = { token: 0 };

function askCaptureScroll(host) {
  if (!host) return null;
  const top = host.scrollTop;
  const height = host.scrollHeight;
  const client = Math.max(0, host.clientHeight);
  const atBottom = height - top - client < 40;
  const list = host.querySelector('.ask-message-list');
  const nodes = list ? [...list.children].filter((n) => n.classList && n.classList.contains('ask-message')) : [];
  if (!nodes.length) return { index: -1, id: '', offset: 0, top, scrollHeight: height, clientHeight: client, atBottom };
  const boxTop = host.getBoundingClientRect().top;
  let index = nodes.length - 1;
  let offset = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const rect = nodes[i].getBoundingClientRect();
    if (rect.bottom > boxTop + 1) { index = i; offset = Math.round(rect.top - boxTop); break; }
  }
  return { index, id: nodes[index].dataset.msgId || '', offset, top, scrollHeight: height, clientHeight: client, atBottom };
}

function askRestoreScroll(host, view) {
  if (!host || !view) return;
  const maxTop = Math.max(0, host.scrollHeight - host.clientHeight);
  if (view.atBottom) { host.scrollTop = maxTop; return; }
  const list = host.querySelector('.ask-message-list');
  const nodes = list ? [...list.children].filter((n) => n.classList && n.classList.contains('ask-message')) : [];
  const node = (view.id ? nodes.find((n) => n.dataset.msgId === view.id) : null) || nodes[view.index];
  if (!node) {
    // 锚点这一轮被删掉了：按内容缩短的高度往回补，位置跟着上面补齐，不回开头
    const shrink = Math.max(0, (view.scrollHeight || 0) - host.scrollHeight);
    host.scrollTop = Math.min(maxTop, Math.max(0, (view.top || 0) - shrink));
    return;
  }
  const drift = Math.round(node.getBoundingClientRect().top - host.getBoundingClientRect().top) - view.offset;
  host.scrollTop = Math.min(maxTop, Math.max(0, host.scrollTop + drift));
  // 上面有卡住的高度变化（比如预览面板挤窄了正文）时，别把顶部那一条顶出视野
  if (host.scrollTop === 0 && view.offset < 0) host.scrollTop = Math.min(maxTop, Math.max(0, -view.offset));
}

// 图片是异步补进来的，上面高度一变锚点就会漂，所以重绘后连拉几次把它按住；
// 用户一旦自己滚动（scrollTop 与我们设的不符），立刻交还控制权，不去抢。
function askHoldScroll(host, view) {
  if (!host || !view) return;
  if (view.atBottom) { askRestoreScroll(host, view); return; }
  askScrollHold.token += 1;
  const token = askScrollHold.token;
  const alive = () => token === askScrollHold.token && document.body.contains(host);
  let expected = 0;
  const release = () => { if (Math.abs(host.scrollTop - expected) > 2) askScrollHold.token += 1; };
  const apply = () => {
    if (!alive()) { host.removeEventListener('scroll', release); return; }
    askRestoreScroll(host, view);
    expected = host.scrollTop;
  };
  host.addEventListener('scroll', release, { passive: true });
  apply();
  requestAnimationFrame(apply);
  // 懒加载图片、附件条撑高输入区都会晚一点改高度，多按几轮
  [90, 240, 600, 1200].forEach((ms) => setTimeout(apply, ms));
  setTimeout(() => host.removeEventListener('scroll', release), 1500);
}

// 滚动位置随手记在状态里：重绘前没来得及 capture 的路径也能靠它复位
function askNoteScroll(host) {
  const a = askState();
  if (!host || !a) return;
  const view = askCaptureScroll(host);
  if (!view) return;
  view.chatId = a.activeId || '';
  a.lastScroll = view;
}

function askLastScroll(a) {
  const saved = a && a.lastScroll;
  if (!saved) return null;
  if (saved.chatId && a.activeId && saved.chatId !== a.activeId) return null; // 换了会话就别套用旧位置
  return saved;
}

// 万一还有哪条路径把位置清零，留一笔证据：F12 里 __scrollJumps 直接看调用栈
function askReportScrollJump(before, host, label) {
  if (!before || !host) return;
  if (!before.top || before.top < 40) return;
  if (host.scrollTop > 40) return;
  const info = {
    at: new Date().toISOString(),
    label,
    from: before.top,
    to: host.scrollTop,
    stack: String((new Error().stack) || '').split('\n').slice(1, 6).join(' | '),
  };
  if (typeof window !== 'undefined') {
    window.__scrollJumps = window.__scrollJumps || [];
    window.__scrollJumps.push(info);
  }
  console.warn('[chat-scroll] 重绘后位置被清零', info);
}

function askBindScrollPin(host) {
  if (!host || host._askPinBound) return Promise.resolve();
  host._askPinBound = true;
  host.addEventListener('scroll', () => {
    const a = askState();
    // 用户自己滚的时候顺手记一笔位置，给来不及 capture 的重绘路径兜底
    if (host._askSnapTimer) clearTimeout(host._askSnapTimer);
    host._askSnapTimer = setTimeout(() => { host._askSnapTimer = 0; askNoteScroll(host); }, 60);
    const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 40;
    if (a.jumpUntil && Date.now() < a.jumpUntil) { a.pinBottom = false; askSyncTurns(); return; }
    const wasPinned = a.pinBottom !== false;
    a.pinBottom = atBottom;
    askSyncTurns();
    if (!wasPinned && atBottom) { askRenderStreaming(); return; }
    if (!atBottom) {
      // 已经往上翻了：停止逐帧重绘，等滚回底部再一次性补齐
      if (askRevealRaf) { cancelAnimationFrame(askRevealRaf); askRevealRaf = 0; }
    }
  }, { passive: true });
  return Promise.resolve();
}

let askRenderTimer = null;
let askRevealRaf = 0;

function askRenderSoon() {
  if (askRenderTimer) return;
  askRenderTimer = setTimeout(() => {
    askRenderTimer = null;
    askRenderStreaming();
  }, 90);
}

// 只重绘正在流式输出的最后一条消息，历史消息不参与重排，避免整块重绘带来的抖动
function askRenderStreaming() {
  const a = askState();
  const chat = askActive();
  const host = $('#ask-messages');
  if (!chat || !host) return askRenderMessages();
  const messages = chat.messages || [];
  const list = host.querySelector('.ask-message-list');
  const nodes = list ? [...list.children].filter((n) => n.classList && n.classList.contains('ask-message')) : [];
  if (!list || !messages.length || nodes.length !== messages.length) return askRenderMessages();
  const index = messages.length - 1;
  const node = nodes[index];
  const holder = document.createElement('div');
  holder.innerHTML = askMessageHtml(messages[index], index, messages, a);
  const next = holder.firstElementChild;
  if (!next) return;
  node.replaceWith(next);
  // 回复还在流式输出时先不出图，等这条回复定稿再按完整描述生成
  if (!(a.generating && index === messages.length - 1)) guHydrateRefs(next);
  if (askFollowBottom()) host.scrollTop = host.scrollHeight;
  askUpdateContextMeter();
}

// 收到数据就把“待显示字数”往前推，动画匀速走完，看起来像连续打字而不是一跳一跳
function askRevealKick() {
  const chat = askActive();
  const last = chat && (chat.messages || [])[(chat.messages || []).length - 1];
  if (!last || last.role !== 'assistant' || !last._streaming) { askRenderStreaming(); return; }
  if (last._reveal == null) last._reveal = 0;
  if (!askRevealRaf) askRevealRaf = requestAnimationFrame(askRevealStep);
}

function askRevealStep() {
  askRevealRaf = 0;
  const a = askState();
  const chat = askActive();
  const messages = (chat && chat.messages) || [];
  const msg = messages[messages.length - 1];
  if (!msg || msg.role !== 'assistant') return;
  const target = String(msg.text || '');
  let shown = msg._reveal == null ? target.length : msg._reveal;
  if (shown > target.length) shown = target.length;
  if (shown >= target.length) {
    msg._reveal = target.length;
    if (askFollowBottom()) askRenderStreaming();
    return;
  }
  // 用户往上翻在看历史时不做动画，数据照常累积，滚回底部再一次性补齐
  if (!askFollowBottom()) {
    msg._reveal = target.length;
    return;
  }
  const backlog = target.length - shown;
  const now = performance.now();
  const dt = Math.min(0.12, Math.max(0, now - (msg._revealAt || now - 16)) / 1000);
  msg._revealAt = now;
  const rate = a.generating ? Math.max(32, Math.min(220, backlog * 3.4)) : 4000;
  msg._acc = (msg._acc || 0) + rate * dt;
  const step = Math.min(backlog, Math.floor(msg._acc));
  msg._acc -= step;
  if (step > 0) {
    msg._reveal = shown + step;
    askRenderStreaming();
  }
  if (msg._reveal < target.length) askRevealRaf = requestAnimationFrame(askRevealStep);
}

// 只更新左侧对话列表的“运行中”标记，不重排整页
function askRefreshHistoryFlags() {
  const host = document.querySelector('.ask-history-list');
  if (!host) return;
  const a = askState();
  for (const item of host.querySelectorAll('.ask-history-item')) {
    const id = item.dataset.id;
    const flag = item.querySelector('.ask-history-flag');
    if (!flag || !id) continue;
    const running = !!askRunOf(id);
    const conv = (a.conversations || []).find((c) => c.id === id);
    flag.classList.toggle('is-running', running);
    flag.textContent = running ? '' : (conv && conv.pinned ? '◆' : '○');
    flag.title = running ? '正在生成回复' : (conv && conv.pinned ? '已置顶' : '');
    item.classList.toggle('is-running', running);
  }
}

function askScrollBottom() {
  const a = askState();
  a.pinBottom = true;
  const host = $('#ask-messages');
  if (host) host.scrollTop = host.scrollHeight;
}

function askRenderMessages() {
  const a = askState();
  const host = $('#ask-messages');
  if (!host) return;
  const chat = askActive();
  if (!chat) return;
  const view = askCaptureScroll(host);
  const wantBottom = a.scrollIntent === 'bottom';
  if (wantBottom) a.scrollIntent = null;
  host.closest('.ask-chat').classList.toggle('is-empty', !chat.messages.length);
  if (!chat.messages.length) { host.innerHTML = askWelcomeHtml(); return; }
  askBindScrollPin(host);
  host.innerHTML = `<div class="ask-message-list">${askMessagesHtml(chat)}
    ${a.generating ? `<div class="ask-generation"><span class="ask-pulse"></span><b>模型回复生成中</b><span>整理问题与所选技能…</span><span class="ask-gen-elapsed">0s</span><button type="button" data-act="ask-stop">停止</button></div>` : ''}
  </div>`;
  guHydrateRefs(host);
  if (wantBottom) askHoldScroll(host, { atBottom: true });
  else if (view) askHoldScroll(host, view);
  else if (askLastScroll(a)) askHoldScroll(host, askLastScroll(a));
  else if (askFollowBottom()) host.scrollTop = host.scrollHeight;
  askReportScrollJump(view, host, 'askRenderMessages');
  askEnsureLiveTicker();
  askTraceAutoLoad(chat);
}

/* ------------------------------- 行为 ------------------------------- */

async function askLoadModels() {
  const a = askState();
  try {
    const data = await askApi('/models').then((r) => r.json());
    if (!Array.isArray(data.models)) throw new Error('bad');
    a.models = data.models;
    const previousDefault = a.defaultModelId;
    if (!data.models.some((m) => m.id === a.modelId) || a.modelId === previousDefault) {
      a.modelId = data.default_model || (data.models[0] && data.models[0].id) || '';
    }
    a.defaultModelId = data.default_model || '';
    a.effort = data.default_effort || '';
    askSyncEffort();
  } catch {
    a.models = a.models || [];
  }
}

function askSyncEffort() {
  const a = askState();
  const efforts = askEfforts();
  if (!efforts.includes(a.effort)) a.effort = efforts.includes('high') ? 'high' : (efforts[0] || '');
}

function askRecordLiveTool(msg, data) {
  const tools = msg.liveTools || (msg.liveTools = []);
  const name = data.tool || 'tool';
  if (data.type === 'tool_call') {
    if (data.tool_call_id && tools.some(t => t.id === data.tool_call_id)) return;
    tools.push({ id: data.tool_call_id || '', name, detail: data.detail || '', status: 'running' });
    if (!msg.hasCycleTrace) (msg.liveTrajectory || (msg.liveTrajectory = [])).push({role:'assistant',tool_calls:[{id:data.tool_call_id,name,arguments:data.arguments || {detail:data.detail || ''}}]});
  } else {
    const tool = tools.find(t => data.tool_call_id ? t.id === data.tool_call_id : t.name === name && t.status === 'running');
    const result = tool || { id: data.tool_call_id || '', name };
    result.status = data.ok === false ? 'failed' : 'success';
    if (!result.detail && data.ok === false) result.detail = String(data.detail || '').slice(0,160);
    if (!tool) tools.push(result);
    (msg.liveTrajectory || (msg.liveTrajectory = [])).push({role:'tool',tool_name:name,tool_call_id:data.tool_call_id,status:data.ok === false ? 'error' : 'success',content:data.output || data.detail || ''});
  }
}

function askRecordTrajectory(msg, data) {
  msg.hasCycleTrace = true;
  const items=msg.liveTrajectory || (msg.liveTrajectory=[]);
  const item=data.item;
  if (item?.id) {
    const at=items.findIndex(x=>x.id===item.id);
    if (at<0) items.push(item); else items[at]=item;
  }
}

function askApplyEvent(msg, data, chatId) {
  if (data.type === 'trajectory_item' || data.type === 'trajectory_delta') {
    askRecordTrajectory(msg, data);
  }
  if (data.type === 'start' && data.execution) msg.execution = data.execution;
  if (data.type === 'process' && data.plan) { msg.execution = msg.execution || {}; msg.execution.plan = data.plan; }
  if (data.type === 'trace') {
    msg.execution = msg.execution || {};
    msg.execution.steps = msg.execution.steps || [];
    const at = msg.execution.steps.findIndex((s) => s.id === data.step.id);
    if (at < 0) msg.execution.steps.push(data.step);
    else msg.execution.steps[at] = data.step;
    if (msg.execution.plan) {
      const idx = (msg.execution.plan.steps || []).findIndex((s) => s.id === data.step.id);
      if (idx >= 0) msg.execution.plan.steps[idx] = data.step;
    }
  }
  if (['start','process','trace','done','run_finished'].includes(data.type)) askSyncPlanDock(chatId);
  if (data.type === 'summary' && msg.execution) msg.execution.summary = data.text;
  if (data.type === 'tool_call') {
    askRecordLiveTool(msg, data);
    msg.live = { tool: data.tool || '', detail: data.detail || '', phase: 'running', time: Number(data.time) || Date.now() };
    if (msg._t0 == null) msg._t0 = Number(data.time) || Date.now();
  }
  if (data.type === 'tool_result') {
    askRecordLiveTool(msg, data);
    msg.live = { tool: data.tool || '', detail: data.detail || '', phase: data.ok === false ? 'failed' : 'done', time: Number(data.time) || Date.now() };
  }
  if (data.type === 'media' && Array.isArray(data.files)) {
    msg.media = msg.media || [];
    for (const file of data.files) {
      if (file && file.url && !msg.media.some((x) => x.url === file.url)) msg.media.push(file);
    }
  }
  if (['artifact','workspace_file'].includes(data.type) && data.file) {
    if (askState().capabilitiesOpen) window.AgentWorkspace?.refresh();
  }
  if (data.type === 'artifact' && data.file) {
    msg.execution = msg.execution || {};
    msg.execution.artifacts = msg.execution.artifacts || [];
    if (!msg.execution.artifacts.some((f) => f.id === data.file.id)) msg.execution.artifacts.push(data.file);
  }
  if (data.type === 'choice' && data.id) {
    msg.choices = msg.choices || [];
    if (!msg.choices.some((card) => card.id === data.id)) {
      const card = {
        id: String(data.id),
        questions: (Array.isArray(data.questions) && data.questions.length
          ? data.questions
          : [{ id: 'q1', question: data.question || '', options: data.options || [], multi: !!data.multi, allow_text: data.allow_text !== false }])
          .map((q, qi) => ({
            id: String(q.id || 'q' + (qi + 1)),
            question: String(q.question || ''),
            multi: !!q.multi,
            allow_text: q.allow_text !== false,
            options: (q.options || []).map((o, i) => ({
              id: String(o.id || 'q' + (qi + 1) + 'o' + (i + 1)),
              label: String(o.label || ''),
              why: String(o.why || ''),
              value: String(o.value || o.label || ''),
              skill_id: String(o.skill_id || ''),
              recommended: !!o.recommended,
            })),
          })),
        allow_text: data.allow_text !== false,
        auto_seconds: Number(data.auto_seconds) || 0,
        time: Number(data.time) || Date.now(),
      };
      msg.choices.push(card);
      // 有待回答的问题就把它抬到输入框上方（最新的问题覆盖上一张）
      const a = askState();
      a.choice = { messageId: msg.id || '', card, answers: {}, custom: {}, text: '', page: 0, closed: false };
      askChoiceRefresh();   // 首次没有面板节点时会整块重绘，把问句条挂上去
    }
  }
  if (data.type === 'supplement_received' && Array.isArray(data.items)) {
    msg.supplements = msg.supplements || [];
    for (const item of data.items) {
      const at = msg.supplements.findIndex((x) => x.id === item.id);
      const next = { id: item.id, text: item.text, time: item.time, state: 'received' };
      if (at >= 0) msg.supplements[at] = { ...msg.supplements[at], ...next };
      else msg.supplements.push(next);
    }
    askQueueMark(chatId, data.items.map((x) => x.id), 'received');
    askRenderSoon();
  }
  if (data.type === 'supplement' && Array.isArray(data.items)) {
    msg.supplements = msg.supplements || [];
    for (const item of data.items) {
      const at = msg.supplements.findIndex((x) => x.id === item.id);
      const next = { id: item.id, text: item.text, time: item.time, state: 'applied' };
      if (at >= 0) msg.supplements[at] = { ...msg.supplements[at], ...next };
      else msg.supplements.push(next);
    }
    // 已并入当前任务：从待发送队列抹掉，不会被当成新任务再发一遍
    askQueueAck(chatId, data.items.map((x) => x.id));
    askRenderSoon();
  }
  if (data.type === 'replace') msg.text = String(data.text || '');
  if (data.type === 'delta') msg.text = (msg.text || '') + String(data.text || '');
  // 模型正在组织回复（没有工具在跑）：状态行跟一句它正在写的内容，像实时字幕
  if ((data.type === 'delta' || data.type === 'replace') && (!msg.live || msg.live.phase !== 'running')) {
    const line = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(-60);
    msg.live = { tool: '', detail: line, phase: 'thinking', time: Date.now() };
    if (msg._t0 == null) msg._t0 = Date.now();
  }
  if (data.type === 'start' && data.execution) {
    const a = askState();
    const next = data.execution.tools_supported !== false;
    if (a.toolsSupported !== next) {
      a.toolsSupported = next;
      a.permWarn = next ? '' : '渠道不支持工具调用';
      askRenderAll();
    }
  }
  if (data.type === 'error') {
    msg.error = data.message || '执行失败';
    if (!msg.text) msg.text = '⚠ ' + msg.error;
    msg._streaming = false;
  }
  if (data.type === 'done' || data.type === 'run_finished') {
    if (data.execution) msg.execution = data.execution;
    if (data.time) msg.time = data.time;
    msg._streaming = false;
    if (!msg.text && msg.execution && msg.execution.summary) msg.text = msg.execution.summary;
    askSyncPlanDock(chatId);
    if (!msg.text && msg.error) msg.text = '⚠ ' + msg.error;
  }
}

async function askQueueReply(chat, question, insertAt, fileIds = [], resumeId = '', webSearch = !!askState().webSearch, turn = null) {
  const a = askState();
  const controller = new AbortController();
  const requestId = askId();
  const picked = (turn && Array.isArray(turn.skillIds)) ? turn.skillIds.filter(Boolean) : askSkills();
  const pickedNames = askSkillNames(picked);
  const single = picked.length === 1 && askSkill(picked[0]).id === picked[0] ? askSkill(picked[0]) : null;
  const run = { chatId: chat.id, requestId, controller, startedAt: Date.now(), msg: null };
  askRuns(a).set(chat.id, run);
  askSyncRunState();
  askRefreshHistoryFlags();
  if (a.activeId === chat.id) askRenderAll();   // 让输入区切到“排队 / 停止”状态
  const history = chat.messages.slice(0, insertAt === undefined ? chat.messages.length - 1 : insertAt).filter((m) => m.text);
  const msg = { id: askId(), role: 'assistant', text: '', time: Date.now(), skill: pickedNames.join('、'), _streaming: true };
  run.msg = msg;
  if (insertAt === undefined) chat.messages.push(msg);
  else chat.messages.splice(insertAt, 0, msg);
  chat.updated = Date.now();
  if (a.activeId === chat.id) askRenderMessages();
  let runId = '';
  let lastSeq = 0;
  const applyEvent = (data) => {
    if (typeof data.sequence === 'number') {
      if (data.sequence <= lastSeq) return;
      lastSeq = data.sequence;
    }
    askApplyEvent(msg, data, chat.id);
  };
  try {
    if (!resumeId) {
      const saved = await fetch('/api/agent/sessions/' + encodeURIComponent(chat.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
        body: JSON.stringify({ ...chat, messages: history }),
        signal: controller.signal,
      });
      if (!saved.ok) throw new Error('会话保存失败');
    }
    const res = await fetch(resumeId ? '/api/agent/runs/' + encodeURIComponent(resumeId) + '/resume' : '/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
      signal: controller.signal,
      body: JSON.stringify(resumeId ? { client_request_id: requestId } : {
        client_request_id: requestId,
        session_id: chat.id,
        text: question,
        skill: pickedNames.join('、'),
        skills: pickedNames,
        skill_id: single && single.id.startsWith('plugin:') ? single.id.slice(7) : undefined,
        style_prompt: picked.length ? (state.styleDetail && state.styleDetail.video) || '' : '',
        project_name: (state.project && state.project.name) || '',
        file_ids: fileIds,
        model_id: (turn && turn.modelId) || a.modelId || undefined,
        reasoning_effort: (turn && turn.effort) || a.effort || undefined,
        web_search: !!webSearch,

        permission: (turn && turn.permission) || a.permission || ASK_PERM_DEFAULT,
      }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      runId = (error.detail && error.detail.run_id) || '';
      throw new Error(typeof error.detail === 'string' ? error.detail : (error.detail && error.detail.message) || '模型连接失败');
    }
    runId = res.headers.get('X-Agent-Run-Id') || '';
    if (runId) {
      run.runId = runId;
      msg._runId = runId;
      if (a.activeId === chat.id) askSyncRunState();
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    for (;;) {
      const part = await reader.read();
      buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        const line = event.split('\n').find((x) => x.startsWith('data: '));
        if (!line) continue;
        let data;
        try { data = JSON.parse(line.slice(6)); } catch { continue; }
        if (data.type === 'done' || data.type === 'run_finished') done = true;
        applyEvent(data);
        if (a.activeId === chat.id) {
          if (data.type === 'delta' || data.type === 'replace') askRevealKick();
          else askRenderSoon();
        }
      }
      if (part.done) break;
    }
    if (!done) throw new Error('回复连接中断，尚未收到任务结束确认');
  } catch (err) {
    const aborted = controller.signal.aborted;
    msg._streaming = false;
    if (!aborted) {
      let recovered = false;
      if (runId) {
        try {
          for (;;) {
            const response = await fetch('/api/agent/runs/' + encodeURIComponent(runId) + '/events?after=' + lastSeq + '&limit=100', {
              headers: { 'X-Project-Id': askProjectId() }, signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) break;
            const events = await response.json();
            if (!Array.isArray(events.items) || !events.items.length) break;
            for (const ev of events.items) {
              applyEvent(ev);
              if (ev.type === 'done' || ev.type === 'run_finished') recovered = true;
            }
            if (recovered || events.items.length < 100) break;
          }
        } catch { /* ignore */ }
      }
      if (!recovered) {
        if (msg.execution) {
          msg.execution.status = 'failed';
          for (const step of msg.execution.steps || []) if (step.status === 'running') step.status = 'failed';
        }
        msg.text = (msg.text ? msg.text + '\n\n' : '') + '[回复失败] ' + (err.message || '请稍后重试');
        toast('回复失败，请检查模型服务', true);
      }
    } else if (msg.text) {
      msg.text += '\n\n[生成已停止]';
    }
  } finally {
    const runs = askRuns(a);
    if (runs.get(chat.id) === run) runs.delete(chat.id);
    msg._reveal = null;
    msg._acc = 0;
    msg._revealAt = 0;
    if (a.activeId === chat.id) askSyncRunState();
    chat.updated = Date.now();
    if (askRenderTimer) { clearTimeout(askRenderTimer); askRenderTimer = null; }
    if (askRevealRaf) { cancelAnimationFrame(askRevealRaf); askRevealRaf = 0; }
    if (a.activeId === chat.id) askRenderMessages();
    askUpdateContextMeter();
    askRefreshHistoryFlags();
    askPersist();
    // 跑完把这次运行的执行过程补上（有计划的走计划视图，不需要）
    if (msg.execution && msg.execution.id && !(msg.execution.plan && (msg.execution.plan.steps || []).length)) {
      setTimeout(() => { askLoadMessageTrace(msg, '', chat.id).catch(() => {}); }, 30);
    }
    // 补充说明核对：已并入当前任务的移出队列，没赶上检查点的退回普通排队继续发
    try { await askQueueSettle(chat.id, runId); } catch { /* ignore */ }
    // 队列只发下一条
    askDrainQueue(chat.id);
  }
}

async function askSend(text, chatId, webSearch = !!askState().webSearch, turn = null) {
  const a = askState();
  const target = (chatId && (a.conversations || []).find((c) => c.id === chatId)) || askActive();
  let raw = String(text === undefined ? a.draft : text).trim();
  const originalRaw = raw;
  // 正文里的 @技能名 也算点名（点完 @ 再把技能取消掉时 token 还留在正文里），
  // 认出来就绑定到本轮技能上，并把 token 剥掉——不要留一串模型看不懂的 @。
  const mentioned = askParseSkillMentions(raw);
  if (mentioned.ids.length) {
    askSetSkills([...askSkills(), ...mentioned.ids]);
    raw = mentioned.text || '按所选技能执行。';
  }
  // 排队出队时沿用入队那一刻快照，实时状态只给现打现发的这一轮用
  const snap = turn || askTurnSnapshot();
  const cmd = raw.match(/^\/(model|think|compact)$/);
  if (cmd) { askChooseCommand(cmd[1]); return; }
  if (!raw) return;
  if (!target) { askNewConversation(); }
  const chat = target || askActive();
  if (!chat) return;
  // 用户直接在主输入框里说了别的：问句条视为跳过，别两条线并行
  if (a.choice && !a.choice.closed) {
    const stale = (chat.messages || []).find((m) => m.id === a.choice.messageId);
    if (stale) stale.choiceSkipped = a.choice.card.id;
    a.choice.closed = true;
  }
  // 这一轮还在生成：先排队，结束后依次发送，不会丢
  if (askRunOf(chat.id)) {
    askEnqueue(raw, chat.id, webSearch, snap);
    return;
  }
  if (raw.length > 1024) {
    try {
      if (!(a.attachments || []).length) {
        await fetch('/api/agent/sessions/' + encodeURIComponent(chat.id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
          body: JSON.stringify(chat),
        }).catch(() => {});
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = new File([raw], '长文本-' + stamp + '.md', { type: 'text/markdown' });
      const saved = await askUploadFile(file, chat.id);
      a.attachments = [...(a.attachments || []), saved];
      raw = '已发送文件：' + saved.name;
      toast('超过 1024 字，已转为文件发送');
    } catch (err) {
      toast('长文本转文件失败，仍按文本发送：' + err.message, true);
    }
  }
  a.startedAt = Date.now();
  a.pinBottom = true; // 发新消息时重新跟随到底部
  const attached = [...(a.attachments || [])];
  chat.messages.push({ id: askId(), role: 'user', text: raw, files: attached, time: Date.now() });
  if (chat.messages.length === 1) {
    chat.title = askParseSkillMentions(originalRaw).text.slice(0, 24) || '新的创作对话';
    const headTitle = $('.ask-chat-heading h1');
    if (headTitle) headTitle.textContent = chat.title;
    const activeItem = $('.ask-history-item.is-on b');
    if (activeItem) activeItem.textContent = chat.title;
  }
  chat.updated = Date.now();
  a.draft = '';
  a.attachments = [];
  a.mention = null;
  a.command = { mode: null, query: null, index: 0 };
  const input = $('#ask-input');
  if (input) input.value = '';
  askRenderPopups();
  askPersist();
  askRenderAll();
  askQueueReply(chat, raw, undefined, attached.map((f) => f.id), '', webSearch, snap);
}

// 输入框「直发」：有任务在跑就作为补充说明并进当前任务；没有任务时照旧开新一轮
async function askSendDirect() {
  const a = askState();
  const chatId = a.activeId;
  let text = String(a.draft || '').trim();
  if (!chatId || !text) return;
  if (!askRunOf(chatId)) { await askSend(text, chatId); return; }
  // 直发是并进正在跑的这一轮，技能已经定了不会中途换；
  // 但正文里的 @技能名 得剥掉，否则模型收到一个没绑定的 token，又变成「不认识」。
  const mentioned = askParseSkillMentions(text);
  if (mentioned.ids.length) text = mentioned.text || '继续按当前技能推进。';
  const res = await askSupplementSend(text, chatId);
  if (!res.ok) {
    if (res.code === 'no_active_run') { await askSend(text, chatId); return; }
    toast(res.message || '补充说明未送达，请稍后重试', true);
    return;
  }
  // 记进本地队列：没赶上检查点也能在收尾时退回普通发送，不会丢
  const list = askLoadQueue(chatId);
  list.push({ id: askId(), text, time: Date.now(), sup: { id: res.id, runId: res.runId, state: 'queued', position: res.position } });
  askSaveQueue(chatId);
  a.draft = '';
  const input = $('#ask-input');
  if (input) input.value = '';
  askRenderPopups();
  askRenderAll();
  toast('已作为补充说明发给当前任务（第 ' + res.position + ' 条），下个检查点生效，任务不中断');
  if ((a.attachments || []).length) toast('直发只带文字，附件仍留在输入框里', true);
}

async function askStop() {
  const a = askState();
  const request = a.request;
  if (!request || request.stopping) return;
  request.stopping = true;
  try {
    if (request.runId) {
      const res = await fetch('/api/agent/runs/' + encodeURIComponent(request.runId) + '/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
        body: '{}', signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error('后端尚未确认停止，请稍后重试');
      toast('已请求停止，正在等待后端结束');
      return;
    }
    const res = await fetch('/api/agent/sessions/' + encodeURIComponent(request.sessionId) + '/requests/' + encodeURIComponent(request.requestId) + '/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
      body: '{}', signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error('后端尚未确认停止，请稍后重试');
    // Keep the response stream open so its terminal receipt confirms cancellation.
    toast('已请求停止，正在等待后端结束');
  } catch (err) {
    toast(err.message || '停止请求失败，请检查后端连接', true);
  } finally {
    if (a.request === request) request.stopping = false;
  }
}

async function askChooseCommand(id) {
  const a = askState();
  if (a.generating) { toast('请等待当前回复完成', true); return; }
  if (a.command.mode === 'model') { a.modelId = id; askSyncEffort(); a.draft = ''; askClosePopups(); askRenderAll(); return; }
  if (a.command.mode === 'think') { a.effort = id; a.draft = ''; askClosePopups(); askRenderAll(); return; }
  const cmd = askCommandList().find((c) => c.name === id);
  const kind = cmd ? cmd.kind : 'action';
  const arg = cmd ? cmd.arg : id;
  if (kind === 'popup') {
    // 换弹层：直接切到模型/强度选择，输入框和面板之间不闪一下
    a.draft = '';
    a.command = { mode: arg, query: null, index: 0 };
    askRenderAll();
    return;
  }
  // action 类：先清干净输入框和命令面板再干活。压缩要几秒到几十秒，
  // 这期间面板还开着、"/com" 还留在输入框里，用户不知道命令有没有被执行。
  a.draft = '';
  a.command = { mode: null, query: null, index: 0 };
  askRenderAll();
  if (arg === 'help') { a.draft = '/'; a.command = { mode: null, query: '', index: 0 }; askRenderAll(); return; }
  if (arg !== 'compact') { toast('命令 /' + id + ' 还没有实现', true); askRenderAll(); return; }
  if (!a.activeId) { toast('先选一个对话，再压缩上下文', true); askRenderAll(); return; }
  // 不弹确认：压缩是可恢复的（历史原文仍在，只多一张摘要卡片），而且结果立刻可见。
  // 浏览器原生 confirm 只留给删任务/删项目这类不可恢复操作。
  try {
    a.generating = true;
    const res = await askApi('/sessions/' + encodeURIComponent(a.activeId) + '/compact', {
      method: 'POST',
      body: JSON.stringify({ model_id: a.modelId || undefined, reasoning_effort: a.effort || undefined }),
    });
    const result = await res.json();
    const card = result && result.message;
    if (card) {
      const chat = askActive();
      if (chat) { if (!Array.isArray(chat.messages)) chat.messages = []; chat.messages.push(card); }
      a.scrollIntent = 'bottom';
    }
    toast('上下文已压缩 · ' + (result.messages || 0) + ' 条历史记录');
  } catch {
    toast('压缩失败，原上下文保留', true);
  } finally {
    a.generating = false;
    // 必须是 askRenderAll：askRenderMessages 只重绘消息列表，输入框里的 "/com"
    // 和命令面板会留在原地，用户看不出命令到底执行了没有。
    askRenderAll();
    const el = $('#ask-input');
    if (el) el.focus();
  }
}

function askClosePopups() {
  const a = askState();
  // 记住是哪个 @ 被关掉的：同一个位置 + 同一段查询不再自动弹回来。
  if (a.mention) a.mentionClosed = { start: a.mention.start, query: a.mention.query };
  a.mention = null;
  a.command = { mode: null, query: null, index: 0 };
}

function askUpdateMention() {
  const a = askState();
  const input = $('#ask-input');
  if (!input) return;
  a.draft = input.value;
  const end = input.selectionStart;
  const cmd = input.value.match(/^\/([a-z]*)$/);
  // 空过滤不预选第一项：用户可能只是想看看有哪些命令，此时按回车不该执行 /model。
  // 输到 /c 这种有意图的过滤词才高亮匹配项。
  a.command = { mode: null, query: cmd ? cmd[1] : null,
                index: cmd && cmd[1] ? 0 : -1 };
  const prefix = input.value.slice(0, end);
  // @"带 空格的路径" 优先匹配；普通 @token 到空白就停。
  const quoted = prefix.match(/(?:^|\s)@"([^"]*)$/);
  const match = quoted || prefix.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match || input.selectionStart !== input.selectionEnd) { a.mention = null; return; }
  const query = match[1] || '';
  const start = end - query.length - (quoted ? 2 : 1);
  // 关掉就保持关闭：同一个 @ 位置 + 同一段查询不再自动弹回来，改查询或换位置才重新武装。
  const closed = a.mentionClosed;
  if (closed && closed.start === start && closed.query === query) { a.mention = null; return; }
  a.mentionClosed = null;
  const firstOpen = !a.mention;
  if (!a.mention || a.mention.query !== query) {
    a.mention = { start, end, query, index: 0, quoted: Boolean(quoted) };
  } else {
    a.mention.start = start; a.mention.end = end; a.mention.query = query;
  }
  // 第一次打开 @ 时把项目文件拉进来（技能是本地数据，文件要走接口）
  if (firstOpen && !a.wsFiles) {
    askLoadWorkspaceFiles().then(() => { if (askState().mention) askRenderPopups(); }).catch(() => {});
  }
}

function askChooseMention(id) {
  const a = askState();
  const range = a.mention;
  const skill = askSkill(id);
  if (!range) return;
  // 追加而不是覆盖：@ 两个技能就是两个一起用，后端按写入顺序依次生效
  askSetSkills([...askSkills(), id]);
  const token = '@' + skill.name + ' ';
  const input = $('#ask-input');
  const value = input ? input.value : a.draft;
  a.draft = value.slice(0, range.start) + token + value.slice(range.end);
  a.mention = null;
  a.mentionClosed = null;
  askRenderPopups();
  const chip = document.querySelector('.ask-skill-context');
  if (chip) chip.textContent = '✧ ' + askSkillNames().join(' + ');
  const el = $('#ask-input');
  if (el) {
    el.value = a.draft;
    el.focus();
    el.setSelectionRange(range.start + token.length, range.start + token.length);
    const c = $('.ask-draft-count'); if (c) c.textContent = a.draft.length + '/3000';
    const send = $('[data-act="ask-send"]'); if (send) send.disabled = !a.draft.trim();
  }
}

function askChooseFile(path) {
  const a = askState();
  const range = a.mention;
  if (!range) return;
  // 路径里有空白就必须加引号，否则 @ 会在空格处断掉，后端只能看到一个残缺路径。
  const token = '@' + (/\s/.test(path) ? '"' + path + '"' : path) + ' ';
  const input = $('#ask-input');
  const value = input ? input.value : a.draft;
  a.draft = value.slice(0, range.start) + token + value.slice(range.end);
  a.mention = null;
  askRenderPopups();
  const el = $('#ask-input');
  if (el) {
    el.value = a.draft;
    el.focus();
    el.setSelectionRange(range.start + token.length, range.start + token.length);
    const c = $('.ask-draft-count'); if (c) c.textContent = a.draft.length + '/3000';
    const send = $('[data-act="ask-send"]'); if (send) send.disabled = !a.draft.trim();
  }
}

/** 点工具栏的 @ / / 按钮：在光标处补一个触发符，直接打开对应弹层 */

function askAttachStatusText(file) {
  const status = (file && file.status) || '';
  const image = /\.(png|jpe?g|webp|gif|bmp)$/i.test((file && file.name) || '');
  const labels = {
    indexed: image ? '已识别' : '已索引',
    pending_recognition: '识别中…',
    recognition_failed: '识别失败',
    pending_transcription: '转写中…',
    pending_video_analysis: '解析中…',
    parse_failed: '解析失败',
    needs_ocr: '需 OCR',
    empty: '内容为空',
  };
  return labels[status] || '待处理';
}

async function askUploadFile(file, chatId) {  const form = new FormData();
  form.append('file', file);
  if (chatId) form.append('session_id', chatId);
  const res = await fetch('/api/agent/workspace/files', {
    method: 'POST',
    headers: { 'X-Project-Id': askProjectId() },
    body: form,
  });
  if (!res.ok) throw new Error('上传失败 HTTP ' + res.status);
  return res.json();
}

async function askAttachFiles(files) {
  const a = askState();
  let chat = askActive();
  if (!chat) { askNewConversation(); chat = askActive(); }
  await fetch('/api/agent/sessions/' + encodeURIComponent(chat.id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Project-Id': askProjectId() },
    body: JSON.stringify(chat),
  }).catch(() => {});
  for (const file of files) {
    if ((a.attachments || []).length >= 5) { toast('最多添加 5 个附件', true); break; }
    if (file.size > 10 * 1024 * 1024) { toast(file.name + ' 超过 10 MB', true); continue; }
    try {
      const saved = await askUploadFile(file, chat.id);
      a.attachments.push(saved);
      if (saved.status === 'pending_recognition') toast(file.name + ' 已上传，正在识别画面…');
      else toast(saved.status === 'indexed' ? file.name + ' 已保存并建立索引' : file.name + '：' + (saved.status || '待处理'));
      if (saved.status === 'pending_recognition' || saved.status === 'pending_transcription') askWatchAttachmentStatus(saved.id);
    } catch (err) {
      toast(err.message, true);
    }
  }
  askRenderAll();
}

// 图片上传后异步识别：轮询状态，识别完成就更新成“已识别”，模型这时就能看到画面
async function askWatchAttachmentStatus(fileId) {
  for (let i = 0; i < 90; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    let info = null;
    try {
      info = await askApi('/workspace/files/' + encodeURIComponent(fileId)).then((r) => r.json());
    } catch {
      return;
    }
    const a = askState();
    const item = (a.attachments || []).find((f) => f.id === fileId);
    if (!info) return;
    if (item) { item.status = info.status; item.error = info.error || ''; }
    if (info.status === 'indexed') {
      toast('图片已识别，模型现在可以看到画面内容');
      askRenderAll();
      return;
    }
    if (info.status !== 'pending_recognition' && info.status !== 'pending_transcription') {
      toast('识别失败：' + (info.error || info.status), true);
      askRenderAll();
      return;
    }
  }
}

async function askPreviewFile(id, sheet = 0, force = false) {
  const a=askState();
  const files=[];
  for(const c of a.conversations||[])for(const m of c.messages||[]){files.push(...(m.files||[]),...(m.execution?.artifacts||[]));}
  const file=files.find(f=>f.id===id)||window.AgentWorkspace?.file(id)||{id,name:'文件'};
  askOpenWorkspace();
  AgentWorkspace.html(askWorkspaceContext());
  return AgentWorkspace.openFile(id,file,sheet,force);
}
async function askExportChat() {
  const chat = askActive();
  if (!chat) return;
  const text = '# ' + chat.title + '\n\n' + chat.messages.map((m) => `## ${m.role === 'user' ? '你' : '创作助手'}\n\n` + (m.execution ? `### 执行记录\n\n- 运行编号：${m.execution.id || ''}\n- 模型：${m.execution.model || ''}\n- 状态：${m.execution.status || ''}\n` + (m.execution.plan ? m.execution.plan.steps.map((s) => `- ${s.title} [${s.status}]：${s.output || s.purpose || ''}`).join('\n') : '') + '\n\n' : '') + m.text + `\n\n时间：${askTimeText(m.time)}`).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = '剧本创作-对话记录.md';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function askLoadManage() {
  const a = askState();
  a.manageError = '';
  try {
    const path = a.workspacePage === 'knowledge' ? '/knowledge' : '/plugins';
    const res = await askApi(path).then((r) => r.json());
    if (a.workspacePage === 'knowledge') a.kb = Array.isArray(res) ? res : res.items || [];
    else a.plugins = Array.isArray(res) ? res : res.items || [];
  } catch (err) {
    a.manageError = err.message;
  }
  askRenderAll();
}

async function askLoadTrajectory(offset = 0, append = false) {
  const a = askState();
  if (!a.activeId) return;
  try {
    const data = await askApi('/sessions/' + encodeURIComponent(a.activeId) + '/trajectory?limit=50' + (offset ? '&offset=' + offset : '')).then((r) => r.json());
    a.trajectory = append && a.trajectory ? { ...data, items: [...(a.trajectory.items || []), ...(data.items || [])] } : data;
  } catch (err) {
    if (!append) a.trajectory = { items: [] };
    toast(err.message, true);
  }
  askRenderAll();
}

function bindAsk(root) {
  const a = askState();
  if (!root) return;
  if (!a.models) { a.models = []; askLoadModels().then(() => { if (state.route === 'script') askRenderAll(); }); }
  if (!a.customSkills) { a.customSkills = []; askLoadSkills().then(() => { if (state.route === 'script') askRenderAll(); }); }
  if (!a.commands) { a.commands = []; askLoadCommands().then(() => { if (state.route === 'script') askRenderAll(); }); }

  if (a.generating) {
    clearInterval(a._genTimer);
    a._genTimer = setInterval(() => {
      const el = $('.ask-gen-elapsed');
      if (!el) { clearInterval(a._genTimer); return; }
      el.textContent = Math.max(0, Math.round((Date.now() - (a.startedAt || Date.now())) / 1000)) + 's';
    }, 1000);
  } else if (a._genTimer) { clearInterval(a._genTimer); a._genTimer = null; }

  const input = $('#ask-input');
  if (input) {
    input.oninput = () => { a.draft = input.value; askUpdateMention(); const c = $('.ask-draft-count'); if (c) c.textContent = a.draft.length + '/3000'; const send = $('[data-act="ask-send"]'); if (send) send.disabled = !a.draft.trim(); askRenderPopups(); askUpdateContextMeter(); };    input.onkeyup = (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) askUpdateMention(); };
    input.onkeydown = (event) => {
      if (event.isComposing) return;
      const cmdOpen = a.command.mode !== null || a.command.query !== null;
      const mentionOpen = !!a.mention;
      if (cmdOpen) {
        if (event.key === 'Escape') { event.preventDefault(); askClosePopups(); askRenderPopups(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const items = askCommandItems(); if (items.length) { const step = event.key === 'ArrowDown' ? 1 : -1; a.command.index = a.command.index < 0 ? (step > 0 ? 0 : items.length - 1) : (a.command.index + step + items.length) % items.length; askRenderPopups(); } return; }
        if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
          event.preventDefault();
          const item = askCommandItems()[a.command.index];
          if (item) askChooseCommand(item.id);
          return;
        }
      }
      if (mentionOpen) {
        if (event.key === 'Escape') { event.preventDefault(); if (a.mention) a.mentionClosed = { start: a.mention.start, query: a.mention.query }; a.mention = null; askRenderPopups(); return; }
        if (event.key === ' ' && !event.shiftKey) {
          // 空格仲裁：有候选就选定，没候选就让空格正常输入，不吃键。
          const list = askMentionItems();
          if (list.length) { event.preventDefault(); askChooseMentionItem(list[a.mention.index] || list[0]); return; }
          a.mentionClosed = { start: a.mention.start, query: a.mention.query };
          a.mention = null; askRenderPopups();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const list = askMentionItems(); if (list.length) { a.mention.index = (a.mention.index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length; askRenderPopups(); } return; }
        if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) { event.preventDefault(); const item = askMentionItems()[a.mention.index]; if (item) askChooseMentionItem(item); return; }
      }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); askSend(); }
    };
    if (!a.draft) input.focus();
  }

  // 问句条里的「自行撰写」：边输边存，不整块重绘，避免丢焦点
  askChoiceBindInput();

  const search = $('#ask-search');
  if (search) search.oninput = () => { a.search = search.value; askRenderAll(); const el = $('#ask-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };

  const modelSel = $('#ask-model');
  if (modelSel) modelSel.onchange = () => { a.modelId = modelSel.value; askSyncEffort(); askRenderAll(); };
  const effortSel = $('#ask-effort');
  if (effortSel) effortSel.onchange = () => { a.effort = effortSel.value; };

  const renameInput = $('#ask-rename-input');
  if (renameInput) {
    renameInput.oninput = () => { a.rename.text = renameInput.value; };
    renameInput.onkeydown = (event) => { if (event.key === 'Enter') askSaveRename(); };
    renameInput.focus();
  }

  if (a._askClick) root.removeEventListener('click', a._askClick);
  const askClick = async (event) => {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if(act!=='ask-head-menu')a.headerMenu=false;
    try {
      if (act === 'ask-queue-cancel') {
        const list = askLoadQueue(a.activeId);
        const id = btn.dataset.id;
        const at = list.findIndex((x) => x.id === id);
        if (at < 0) return;
        const [removed] = list.splice(at, 1);
        askSaveQueue(a.activeId);
        askRenderAll();
        toast('已取消队列里的这条：' + String(removed.text || '').slice(0, 16));
        return;
      }
      if (act === 'ask-queue-now') {
        const chatId = a.activeId;
        const list = askLoadQueue(chatId);
        if (!list.length) return;
        const item = list.find((x) => x.id === btn.dataset.id) || list[0];
        const idx = list.findIndex((x) => x.id === item.id);
        if (askRunOf(chatId)) {
          // 直发：交给正在执行的这条任务当补充说明，不中断、不重启
          const res = await askSupplementSend(item.text, chatId);
          if (res.ok) {
            item.sup = { id: res.id, runId: res.runId, state: 'queued', position: res.position };
            askSaveQueue(chatId);
            askRenderAll();
            toast('已作为补充说明发给当前任务（第 ' + res.position + ' 条），下个检查点生效，任务不中断');
            return;
          }
          if (res.code !== 'no_active_run') { toast(res.message || '补充说明未送达，请稍后重试', true); return; }
          // 任务刚好结束：退回普通发送
        }
        if (idx >= 0) list.splice(idx, 1);
        askSaveQueue(chatId);
        askRenderAll();
        await askSend(item.text, chatId, !!item.webSearch);
        return;
      }
      if (act === 'ask-send-direct') { await askSendDirect(); return; }
      if (act === 'ask-trace-row-toggle') {
        event.preventDefault();
        const run = btn.closest('[data-trace-run]')?.dataset.traceRun;
        const target = askActive()?.messages?.find(m => m.execution?.id === run);
        if (!target) return;
        const opened = target.traceRowsOpen || (target.traceRowsOpen = {});
        opened[btn.dataset.row] = !opened[btn.dataset.row];
        btn.closest('details').open = opened[btn.dataset.row];
        return;
      }
      if (act === 'ask-trace-section-toggle') {
        event.preventDefault();
        const run = btn.closest('[data-trace-run]')?.dataset.traceRun;
        const target = askActive()?.messages?.find(m => m.execution?.id === run);
        if (!target) return;
        const key = btn.dataset.section === 'plan' ? 'planSectionOpen' : 'traceSectionOpen';
        target[key] = !target[key];
        askRenderMessages();
        // 展开轨迹后停在最新一条：列表限高 380px，从第 1 条开始看还要自己滚到底。
        if (target[key]) {
          const runEl = Array.from(document.querySelectorAll('[data-trace-run]'))
            .find((el) => el.dataset.traceRun === run);
          const rows = runEl && runEl.querySelector('.ask-trace-rows');
          if (rows) rows.scrollTop = rows.scrollHeight;
        }
        return;
      }
      if (act === 'ask-trace-toggle') {
        const run = btn.dataset.run || '';
        const chat = askActive();
        const target = chat && (chat.messages || []).find((m) => m.execution && m.execution.id === run);
        if (!target) return;
        target.traceOpen = !target.traceOpen;
        // 展开就等于要看：轨迹由 askTraceAutoLoad 自动拉，不用再点一次
        return askRenderMessages();
      }
      if (act === 'ask-load-trace') {
        const chat = askActive();
        const run = btn.dataset.run || '';
        const target = chat && (chat.messages || []).find((m) => m.execution && m.execution.id === run);
        if (target) await askLoadMessageTrace(target, run);
        return;
      }
      if (act === 'ask-skill-install') {
        a.installSkill = { name: '', description: '', content: '', saving: false, error: '' };
        return askRenderAll();
      }
      if (act === 'ask-install-cancel') { a.installSkill = null; return askRenderAll(); }
      if (act === 'ask-install-save') return askSaveInstallSkill();
      if (act === 'ask-install-file') { const input = $('#ask-install-file'); if (input) input.click(); return; }
      if (act === 'ask-delete-turn') {
        const chat = askActive();
        if (!chat) return;
        const index = Number(btn.dataset.index);
        const msg = chat.messages[index];
        if (!msg || msg.role !== 'user') return;
        if (a.generating && index >= chat.messages.length - 2) { toast('这一轮还在生成，先停止再删除', true); return; }
        if (!confirm('删除这一轮？问题和它的回复会一起删掉。')) return;
        const span = askTurnSpan(chat.messages, index);
        if (!span) return;
        const before = chat.messages.length;
        const host0 = $('#ask-messages');
        const view0 = host0 ? askCaptureScroll(host0) : null;
        const removed = chat.messages.splice(span.start, span.count);
        chat.updated = Date.now();
        // 删掉的是末尾这一轮 → 内容变短，视口不该因为新容器 scrollTop=0 被甩回第一轮：
        // 本来就贴底、或正看着这条将被删掉的消息时，落到新的末尾（也就是“返回上一轮”）；
        // 其余情况保留原来的位置。
        const atEnd = span.end >= before;
        const stillThere = view0 && view0.id ? chat.messages.some((m) => m.id === view0.id) : true;
        const bottom = chat.messages.length === 0 || (view0 ? view0.atBottom : false) || (atEnd && !stillThere);
        a.pinBottom = bottom;
        if (bottom) a.scrollIntent = 'bottom';
        askRenderAll();
        askPersist();
        toast('已删除这一轮（' + removed.length + ' 条消息）');
        return;
      }
      if (act === 'ask-jump') {
        const host = $('#ask-messages');
        const node = host && host.querySelector('.ask-message[data-msg-index="' + btn.dataset.index + '"]');
        askJumpToTurn(host, node);
        return;
      }
      if (act === 'gu-pick') {
        const card = btn.closest('[data-gu-msg]');
        const record = card && askGenUiMemory.get(card.dataset.guMsg);
        if (!record) return;
        const key = btn.dataset.guKey || '';
        const value = btn.dataset.guValue || '';
        if (btn.dataset.guMulti === '1') {
          const list = Array.isArray(record.values[key]) ? [...record.values[key]] : [];
          const at = list.indexOf(value);
          if (at >= 0) list.splice(at, 1); else list.push(value);
          record.values[key] = list;
        } else {
          record.values[key] = value;
        }
        const group = btn.closest('.gu-options');
        if (group) {
          for (const option of group.querySelectorAll('.gu-option')) {
            const on = btn.dataset.guMulti === '1'
              ? (Array.isArray(record.values[key]) && record.values[key].includes(option.dataset.guValue))
              : option.dataset.guValue === record.values[key];
            option.classList.toggle('is-on', on);
            option.setAttribute('aria-pressed', on ? 'true' : 'false');
          }
        }
        return;
      }
      if (act === 'gu-copy') {
        const card = btn.closest('[data-gu-msg]');
        const record = card && askGenUiMemory.get(card.dataset.guMsg);
        const text = guEvalExpr(btn.dataset.guExpr || '', (record && record.values) || {}).trim();
        if (!text) { toast('这段内容还没生成好', true); return; }
        await navigator.clipboard.writeText(text);
        toast('已复制');
        return;
      }
      if (act === 'gu-copy-text') {
        const text = btn.dataset.guText || '';
        if (!text) return;
        await navigator.clipboard.writeText(text);
        toast('已复制提示词');
        return;
      }
      if (act === 'ask-plan-toggle') {
        const msg = [...(askActive()?.messages || [])].reverse().find(m => m.role === 'assistant');
        if (msg) msg.planCollapsed = msg.planCollapsed === false;
        askSyncPlanDock();
        return;
      }
      if (act === 'ask-toggle-web') {
        a.webSearch = !a.webSearch;
        try { localStorage.setItem('wmd.askWebSearch', a.webSearch ? '1' : '0'); } catch {}
        toast(a.webSearch ? '已开启联网检索，对下次发送生效' : '已关闭联网检索，对下次发送生效');
        return askRenderAll();
      }
      if (act === 'ask-toggle-refs') {
        a.refImages = !a.refImages;
        try { localStorage.setItem('wmd.askRefImages', a.refImages ? '1' : '0'); } catch { /* 记不住也不影响当前会话 */ }
        if (!a.refImages) guRefStop();
        toast(a.refImages ? '已开启参考出图' : '已关闭参考出图，不再调用图像渠道');
        return askRenderAll();
      }
      if (act === 'ask-ref-now') {
        guGenerateRef(btn.dataset.guPrompt || '', { force: true });
        return;
      }
      if (act === 'gu-ref-download') {
        const url = btn.dataset.url || '';
        if (!url) return;
        const link = document.createElement('a');
        link.href = url + (url.includes('?') ? '&' : '?') + 'download=1';
        link.download = '参考图.png';
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }
      if (act === 'gu-ref-retry') {
        guGenerateRef(btn.dataset.guPrompt || '');
        return;
      }
      if (act === 'gu-run') {
        if (a.generating) { toast('上一条回复还在生成，稍等一下', true); return; }
        const card = btn.closest('[data-gu-msg]');
        const record = card && askGenUiMemory.get(card.dataset.guMsg);
        const text = guEvalExpr(btn.dataset.guExpr || '', (record && record.values) || {}).trim();
        if (!text) { toast('这个动作还没有取值，先选一下上面的选项', true); return; }
        return askSend(text);
      }
      if (act === 'ask-project-picker') return askOpenProjectPicker();
      if (act === 'ask-head-menu') {a.headerMenu=!a.headerMenu;a.summaryOpen=false;return askRenderAll();}
      if (act === 'ask-summary') {a.summaryOpen=!a.summaryOpen;askRenderAll();if(a.summaryOpen)askLoadSummaryFiles();return;}
      if (act === 'ask-new-workspace') {
        askOpenWorkspace();AgentWorkspace.html(askWorkspaceContext());return AgentWorkspace.newTab();
      }
      if (act === 'ask-copy-conversation') {
        const chat=askActive();await navigator.clipboard.writeText((chat?.messages||[]).map(m=>(m.role==='user'?'用户':'助手')+'：'+m.text).join('\n\n'));
        toast('已复制对话文本');return askRenderAll();
      }
      if (act === 'ask-new') return askNewConversation();
      if (act === 'ask-clear-skill') {
        // 取消 @ 要连正文里的 @技能名 一起清掉，否则下次发送又会被认回同一个技能
        askSetSkills([]);
        const box = $('#ask-input');
        const value = box ? box.value : a.draft;
        const stripped = askParseSkillMentions(value).text;
        a.draft = stripped;
        if (box) {
          box.value = stripped;
          const c = $('.ask-draft-count'); if (c) c.textContent = stripped.length + '/3000';
          const send = $('[data-act="ask-send"]'); if (send) send.disabled = !stripped.trim();
        }
        return askRenderAll();
      }
      if (act === 'ask-folder-toggle') {
        a.collapsedFolders = { ...(a.collapsedFolders || {}), [btn.dataset.id]: !a.collapsedFolders?.[btn.dataset.id] };
        return askRenderAll();
      }
      if (act === 'ask-project-new-chat') return askNewChatInProject(btn.dataset.id);
      if (act === 'ask-open') { a.moreMenu = null; return askOpenProjectConversation(btn.dataset.project, btn.dataset.id); }
      if (act === 'ask-more') { a.moreMenu = a.moreMenu === btn.dataset.id ? null : btn.dataset.id; return askRenderAll(); }
      if (act === 'ask-more-close') { if (!event.target.closest('.ask-more-menu')) { a.moreMenu = null; askRenderAll(); } return; }
      if (act === 'ask-pin') {
        const c = askFindConversation(btn.dataset.id);
        if (c) c.pinned = !c.pinned;
        a.moreMenu = null; askPersist(); return askRenderAll();
      }
      if (act === 'ask-rename') {
        const c = askFindConversation(btn.dataset.id);
        if (!c) { askForgetConversation(btn.dataset.id); return askRenderAll(); }
        a.rename = { open: true, id: c.id, text: c.title };
        a.moreMenu = null; return askRenderAll();
      }
      if (act === 'ask-rename-cancel') { a.rename = { open: false, id: '', text: '' }; return askRenderAll(); }
      if (act === 'ask-rename-save') return askSaveRename();
      if (act === 'ask-delete') {
        const id = btn.dataset.id;
        const c = askFindConversation(id);
        if (!c) { askForgetConversation(id); return askRenderAll(); }
        const ownerId = askConversationProject(id);
        if (id === a.activeId) askStop();
        let failure = null;
        try {
          await askApi('/sessions/' + encodeURIComponent(id), {
            method: 'DELETE',
            headers: ownerId && ownerId !== askProjectId() ? { 'X-Project-Id': ownerId } : {},
          });
        } catch (err) {
          const gone = err && (err.status === 404 || /不存在|not found/i.test(String(err.message || '')));
          if (!gone) failure = err;
        }
        a.removed = c;
        askForgetConversation(id);
        // 删对话时连它的待发送队列一起清掉
        try { localStorage.removeItem(askQueueKey(id)); } catch { /* ignore */ }
        if (a.queues) delete a.queues[id];
        if (a.activeId === id) {
          a.activeId = (a.conversations[0] && a.conversations[0].id) || '';
          if (!a.activeId) askNewConversation();
        }
        if (failure) toast('删除会话失败：' + (failure.message || '未知错误'), true);
        askRenderAll();
        askLoadProjectHistory().catch(() => {});
        return;
      }
      if (act === 'ask-undo') {
        if (!a.removed) return askRenderAll();
        const back = a.removed;
        a.removed = null;
        if (state.route === 'script') askRenderAll();
        // 撤销要真的把会话写回去，否则刷新页面又没了
        await askApi('/sessions/' + encodeURIComponent(back.id), { method: 'PUT', body: JSON.stringify(back) })
          .catch((err) => toast('撤销失败：' + (err.message || '未知错误'), true));
        a.conversations = [back, ...(a.conversations || []).filter((x) => x.id !== back.id)];
        a.activeId = back.id;
        askSyncCurrentRowItems();
        askPersist();
        askRenderAll();
        askLoadProjectHistory().catch(() => {});
        return;
      }
      if (act === 'ask-workspace') {
        a.workspacePage = btn.dataset.page;
        a.previewFile = null;
        askRenderAll();
        if (a.workspacePage !== 'console') askLoadManage();
        return;
      }
      if (act === 'ask-toggle-history') {
        a.historyOpen = !a.historyOpen;
        try { localStorage.setItem('wmd.askHistoryOpen', a.historyOpen ? '1' : '0'); } catch { /* ignore */ }
        // History and workspace remain independently toggleable.
        return askRenderAll();
      }
      if (act === 'ask-files-pick') {
        const chat=askActive(),project=askProjectId();
        if(!chat)return toast('请先新建对话',true);
        return openLibraryPicker({title:'引用项目素材（保留原位置）',onPick:async item=>{
          if(project!==askProjectId()||chat.id!==askState().activeId)throw Error('当前项目或对话已切换，请重新选择');
          await askApi('/sessions/'+encodeURIComponent(chat.id),{method:'PUT',body:JSON.stringify(chat)});
          const saved=await askApi('/workspace/register',{method:'POST',body:JSON.stringify({session_id:chat.id,path:item.path,origin:'input'})}).then(r=>r.json());
          a.attachments=a.attachments||[];
          if(!a.attachments.some(f=>f.id===saved.id))a.attachments.push(saved);
          closeModal();a.panelTab='input';askRenderAll();
        }});
      }
      if (act === 'ask-files-refresh') return window.AgentWorkspace?.refresh();
      if (act === 'ask-files-page') return window.AgentWorkspace?.page(Number(btn.dataset.page));
      if (act === 'ask-file-path') {
        const file = window.AgentWorkspace?.file(btn.dataset.id);
        if (file?.path) { try { await navigator.clipboard.writeText(file.path); toast('已复制路径'); } catch { toast('复制失败，请使用文件预览中的路径',true); } }
        return;
      }
      if (act === 'ask-file-versions') {
        try {
          const rows = await askApi('/workspace/files/'+encodeURIComponent(btn.dataset.id)+'/versions').then(r=>r.json());
          openModal('<div class="modal-head"><h2>文件历史版本</h2><button class="btn" data-close="1">关闭</button></div><div class="modal-body">' + (rows.length ? rows.map(row=>`<p>v${row.version} · ${esc(row.relativePath)} <a href="/api/agent/workspace/files/${encodeURIComponent(btn.dataset.id)}/versions/${row.version}" download>下载</a></p>`).join('') : '<p>暂无历史版本</p>')+'</div>');
        } catch(err) { toast(err.message,true); }
        return;
      }
      if (act === 'ask-file-source') {
        const chat=askActive();
        const index=(chat?.messages||[]).findIndex(m=>(m.files||[]).some(f=>f.id===btn.dataset.id)||(m.execution?.artifacts||[]).some(f=>f.id===btn.dataset.id));
        if(index>=0) { const host=$('#ask-messages'); askJumpToTurn(host,host?.querySelector('.ask-message[data-msg-index="'+index+'"]')); }
        else toast('当前对话中的工作文件，尚未作为消息交付');
        return;
      }
      if (act === 'ask-toggle-cap') { a.capabilitiesOpen = !a.capabilitiesOpen; a.previewFile = null; a.previewData = null; a.mediaPreview = null; a.previewExpanded = false; if (a.capabilitiesOpen && a.panelTab === 'trajectory') askLoadTrajectory(); return askRenderAll(); }
      if (act === 'ask-close-cap') { return askCloseWorkspace(); }
      if (act === 'ask-panel') {
        a.panelTab = btn.dataset.tab;
        if (a.panelTab === 'trajectory') { a.trajectory = null; askRenderAll(); return askLoadTrajectory(); }
        return askRenderAll();
      }
      if (act === 'ask-captab') { a.capTab = btn.dataset.tab; return askRenderAll(); }
      if (act === 'ask-skill') { askSetSkills([btn.dataset.id]); return askRenderAll(); }
      if (act === 'ask-new-skill') {
        a.workspacePage = 'plugins';
        a.pluginTab = 'skill';
        askRenderAll();
        await askLoadManage();
        return askManageDialog('skill');
      }
      if (act === 'ask-use-skill') { askSetSkills([btn.dataset.skill]); return askSend(btn.dataset.prompt); }
      if (act === 'ask-fill') { a.draft = btn.dataset.text; askRenderAll(); const el = $('#ask-input'); if (el) el.focus(); return; }
      if (act === 'ask-cmd') return askChooseCommand(btn.dataset.id);
      if (act === 'ask-mention') return btn.dataset.kind === 'file' ? askChooseFile(btn.dataset.id) : askChooseMention(btn.dataset.id || btn.dataset.skill);
      if (act === 'ask-permission') { a.permMenu = !a.permMenu; askRenderPopups(); return; }
      if (act === 'ask-perm') {
        askPermissionSet(btn.dataset.id);
        a.permMenu = false;
        askRenderAll();
        return toast('权限已切到「' + askPermission(btn.dataset.id).label + '」');
      }
      if (act === 'ask-skill-picker') {
        const el = $('#ask-input');
        const caret = el ? el.selectionStart : a.draft.length;
        a.draft = a.draft.slice(0, caret) + '@' + a.draft.slice(caret);
        a.mention = { start: caret, end: caret + 1, query: '', index: 0 };
        askRenderAll();
        const input2 = $('#ask-input');
        if (input2) { input2.focus(); input2.setSelectionRange(caret + 1, caret + 1); }
        return;
      }
      if (act === 'ask-attach') { $('#ask-file').click(); return; }
      if (act === 'ask-detach') { a.attachments = (a.attachments || []).filter((f) => f.id !== btn.dataset.id); return askRenderAll(); }
      if (act === 'ask-send') return askSend();
      if (act === 'ask-stop') return askStop();
      if (act === 'ask-export') return askExportChat();
      if (act === 'ask-chain') {
        const chat = askActive();
        if (!chat || a.generating) return;
        const msg = (chat.messages || [])[Number(btn.dataset.index)];
        if (!msg) return;
        const next = btn.dataset.skill;
        askSetSkills([next]);
        const arts = (msg.execution && msg.execution.artifacts) || [];
        const files = arts.map((f) => ({ id: f.id, name: f.name, size: f.size }));
        const text = arts.length
          ? '把附件《' + arts[0].name + '》' + btn.dataset.verb + '，保持人物、情节和台词不变。'
          : '把上面的内容' + btn.dataset.verb + '，保持人物、情节和台词不变：\n\n' + String(msg.text || '').slice(0, 1500);
        chat.messages.push({ id: askId(), role: 'user', text, files, time: Date.now() });
        chat.updated = Date.now();
        askPersist();
        askRenderMessages();
        return askQueueReply(chat, text, undefined, files.map((f) => f.id));
      }
      if (act === 'ask-to-studio') {
        const msg = (askActive() && askActive().messages || [])[Number(btn.dataset.index)];
        if (!msg || !msg.text) return;
        state.studio.prompt = msg.text;
        state.studio.promptMode = 'code';
        state.studio.workflowId = state.studio.workflowId || (state.workflows[0] && state.workflows[0].id);
        location.hash = '#studio';
        toast('已写进视频创作台的提示词框');
        return;
      }
      if (act === 'ask-choice-pick') return askChoicePick(btn.dataset.question, btn.dataset.option);
      if (act === 'ask-choice-page') return askChoicePage(Number(btn.dataset.delta) || 1);
      if (act === 'ask-choice-send') return askChoiceSend();
      if (act === 'ask-choice-skip') return askChoiceSkip();
      if (act === 'ask-choice-type') {
        const input = $('#ask-choice-input');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
        return;
      }
      if (act === 'ask-quick') {
        const value = btn.dataset.value;
        if (!value) { const input = $('#ask-input'); if (input) input.focus(); return; }
        return askSend(value);
      }
      if (act === 'ask-copy') {
        const msg = (askActive() && askActive().messages || [])[Number(btn.dataset.index)];
        if (msg) { await navigator.clipboard.writeText(guPlainText(msg.text || '')); toast('已复制回复'); }
        return;
      }
      if (act === 'ask-paste') {
        const msg = (askActive() && askActive().messages || [])[Number(btn.dataset.index)];
        if (!msg) return;
        const clean = guPlainText(msg.text || '');
        if (clean.length > 3000) { toast('回复超过 3000 字，请复制后挑选', true); return; }
        a.draft = clean;
        askRenderAll();
        const el = $('#ask-input');
        if (el) el.focus();
        return;
      }
      if (act === 'ask-like' || act === 'ask-dislike') {
        const msg = (askActive() && askActive().messages || [])[Number(btn.dataset.index)];
        if (!msg) return;
        const set = act === 'ask-like' ? a.liked : a.disliked;
        const other = act === 'ask-like' ? a.disliked : a.liked;
        if (set.has(msg.id)) set.delete(msg.id); else { set.add(msg.id); other.delete(msg.id); }
        return askRenderMessages();
      }
      if (act === 'ask-regenerate') {
        const chat = askActive();
        if (!chat || a.generating) return;
        const index = Number(btn.dataset.index);
        const question = [...chat.messages.slice(0, index)].reverse().find((m) => m.role === 'user');
        if (!question) return;
        chat.messages.splice(index, 1);
        return askQueueReply(chat, question.text, index, (question.files || []).map((f) => f.id));
      }
      if (act === 'ask-resume') {
        const chat = askActive();
        if (!chat || a.generating) return;
        const msg = chat.messages[Number(btn.dataset.index)];
        if (!msg || !msg.execution) return;
        chat.messages.push({ id: askId(), role: 'user', text: '继续刚才未完成的任务', time: Date.now() });
        return askQueueReply(chat, '继续刚才未完成的任务', undefined, [], msg.execution.id);
      }
      if (act === 'ask-preview-source') {
        a.previewSource = btn.dataset.mode === 'source';
        return askRenderAll();
      }
      if (act === 'ask-preview-sheet') {
        return askPreviewFile(a.previewFile && a.previewFile.id, Number(btn.dataset.sheet || 0));
      }
      if (act === 'ask-preview-retry') {
        return askPreviewFile(a.previewFile && a.previewFile.id, a.previewSheet || 0,true);
      }
      if (act === 'ask-open-inline') {
        const url = btn.dataset.url || '';
        if (!url) return;
        askOpenWorkspace();AgentWorkspace.html(askWorkspaceContext());
        return AgentWorkspace.openMedia({url,name:btn.dataset.label||'图片',kind:'image'});
        a.previewFile = null;
        a.previewExpanded = false;
        return askRenderAll();
      }
      if (act === 'ask-open-media') {
        const chat = askActive();
        const msg = chat && chat.messages[Number(btn.dataset.index)];
        const file = msg && msg.media && msg.media[Number(btn.dataset.media)];
        if (!file) return;
        a.capabilitiesOpen=true;AgentWorkspace.html(askWorkspaceContext());return AgentWorkspace.openMedia(file);
        a.previewFile = null;
        a.previewExpanded = false;
        return askRenderAll();
      }
      if (act === 'ask-close-media') {
        a.mediaPreview = null;
        a.previewExpanded = false;
        return askRenderAll();
      }
      if (act === 'ask-expand-preview') {
        a.previewExpanded = !a.previewExpanded;
        return askRenderAll();
      }
      if (act === 'ask-copy-file-content') {
        if (!btn.dataset.id || btn.disabled) return;
        btn.disabled = true;
        try {
          const response = await askApi('/workspace/files/' + encodeURIComponent(btn.dataset.id) + '/raw');
          if (!response.ok) throw new Error('读取文件失败');
          await navigator.clipboard.writeText(await response.text());
          toast('已复制文件完整内容');
        } catch (err) { toast(err.message || '复制失败', true); }
        finally { btn.disabled = false; }
        return;
      }
      if (act === 'ask-reveal-pane') {
        const id = btn.dataset.id;
        if (!id) return;
        askApi('/workspace/files/' + encodeURIComponent(id) + '/reveal', { method: 'POST' })
          .then((r) => r.json())
          .then((data) => toast('已打开所在文件夹：' + (data.folder || data.path || '')))
          .catch((err) => toast(err.message || '打开所在文件夹失败', true));
        return;
      }
      if (act === 'ask-close-pane') {
        if(a.capabilitiesOpen && window.AgentWorkspace)return AgentWorkspace.closeCurrent();
        a.previewFile = null;
        a.previewData = null;
        a.mediaPreview = null;
        a.previewExpanded = false;
        return askRenderAll();
      }
      if (act === 'ask-preview') return askPreviewFile(btn.dataset.id);
      if (act === 'ask-close-preview') {
        a.previewFile = null;
        a.previewData = null;
        a.previewExpanded = false;
        return askRenderAll();
      }
      if (act === 'ask-tool') { a.toolDetail = ASK_TOOLS.find((t) => t.id === btn.dataset.id) || null; return askRenderAll(); }
      if (act === 'ask-close-tool') { a.toolDetail = null; return askRenderAll(); }
      if (act === 'ask-traj-more') return askLoadTrajectory((askState().trajectory && askState().trajectory.next_offset) || 0, true);
      if (act === 'ask-plugin-tab') { a.pluginTab = btn.dataset.tab; return askRenderAll(); }
      if (act === 'ask-manage-refresh') return askLoadManage();
      if (act === 'ask-manage-new') return askManageDialog(a.workspacePage === 'knowledge' ? 'knowledge' : (a.pluginTab || 'skill'));
      if (act === 'ask-manage-edit') {
        const list = a.workspacePage === 'knowledge' ? a.kb : a.plugins;
        const item = (list || []).find((x) => x.id === btn.dataset.id);
        return askManageDialog(a.workspacePage === 'knowledge' ? 'knowledge' : (item.kind || a.pluginTab || 'skill'), item);
      }
      if (act === 'ask-manage-del') {
        const path = a.workspacePage === 'knowledge' ? '/knowledge/' : '/plugins/';
        if (!confirm('删除这条配置？')) return;
        await askApi(path + encodeURIComponent(btn.dataset.id), { method: 'DELETE' }).catch((e) => toast(e.message, true));
        if (a.workspacePage !== 'knowledge') await askLoadSkills();
        return askLoadManage();
      }
    } catch (err) {
      toast(err.message, true);
    }
  };
  a._askClick = askClick;
  root.addEventListener('click', askClick);

  // 展开“执行过程”时才去拉这次运行的轨迹（历史消息按需加载）
  if (!root._traceToggle) {
    root._traceToggle = true;
  }

  // 交互卡片里的输入框：只记状态，不触发整段重绘
  if (a._askGuInput) root.removeEventListener('input', a._askGuInput);
  a._askGuInput = (event) => {
    const field = event.target.closest('[data-gu-key]');
    if (!field || !/^(INPUT|TEXTAREA|SELECT)$/.test(field.tagName)) return;
    const card = field.closest('[data-gu-msg]');
    const record = card && askGenUiMemory.get(card.dataset.guMsg);
    if (record) record.values[field.dataset.guKey] = field.value;
  };
  root.addEventListener('input', a._askGuInput);

  // 消息里的图片加载失败时退化成一行说明，而不是留个破图标
  if (a._askImgError) root.removeEventListener('error', a._askImgError, true);
  a._askImgError = (event) => {
    const img = event.target;
    if (!img || img.tagName !== 'IMG' || !img.classList || !img.classList.contains('ask-inline-img')) return;
    const holder = img.closest('.ask-inline-media');
    if (holder) holder.classList.add('is-broken');
  };
  root.addEventListener('error', a._askImgError, true);

  // 点到 @ 候选框和输入框以外的地方，就收起候选框
  if (a._askOutside) document.removeEventListener('pointerdown', a._askOutside, true);  a._askOutside = (event) => {
    const a2 = askState();
    const open = !!a2.mention || a2.command.mode !== null || a2.command.query !== null || !!a2.permMenu;
    if (!open) return;
    const target = event.target;
    if (!target || !target.closest) return;
    if (target.closest('#ask-popups')) return;
    if (target.closest('#ask-input')) return;
    if (target.closest('[data-act="ask-skill-picker"]')) return;
    if (target.closest('[data-act="ask-cmd"]')) return;
    if (target.closest('[data-act="ask-permission"]')) return;
    a2.mention = null;
    a2.command = { mode: null, query: null, index: 0 };
    a2.permMenu = false;
    askRenderPopups();
  };
  document.addEventListener('pointerdown', a._askOutside, true);

  const installFileInput = $('#ask-install-file');
  if (installFileInput) {
    installFileInput.onchange = () => {
      const file = (installFileInput.files || [])[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const d = askState().installSkill;
        if (!d) return;
        d.content = String(reader.result || '');
        if (!d.name) d.name = file.name.replace(/\.(md|markdown|txt)$/i, '');
        askRenderAll();
      };
      reader.readAsText(file);
    };
  }

  const fileInput = $('#ask-file');
  if (fileInput) fileInput.onchange = () => { const files = [...(fileInput.files || [])]; fileInput.value = ''; if (files.length) askAttachFiles(files); };

  // 拖拽文件到聊天区
  root.ondragover = (event) => {
    if (![...(event.dataTransfer.types || [])].includes('Files')) return;
    event.preventDefault();
    root.classList.add('is-file-drag');
  };
  root.ondragleave = () => root.classList.remove('is-file-drag');
  root.ondrop = (event) => {
    const dropFiles = [...(event.dataTransfer.files || [])];
    if (!dropFiles.length) return;
    event.preventDefault();
    root.classList.remove('is-file-drag');
    askAttachFiles(dropFiles);
  };

  // Ctrl+V 直接粘贴文件/截图
  if (a._pasteHandler) document.removeEventListener('paste', a._pasteHandler);
  a._pasteHandler = (event) => {
    if (state.route !== 'script') return;
    const clip = event.clipboardData;
    if (!clip) return;
    const files = [...(clip.files || [])];
    if (!files.length) {
      for (const item of [...(clip.items || [])]) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    if (!files.length) return;
    event.preventDefault();
    askAttachFiles(files);
  };
  document.addEventListener('paste', a._pasteHandler);

  const pane = $('.ask-file-pane');
  const resizer = pane && pane.querySelector('.ask-pane-resizer');
  if (pane && resizer) {
    let dragStart = 0;
    let dragWidth = 0;
    let dragging = false;
    const commit = () => {
      try { if (a.previewWidth) localStorage.setItem('wmd.previewWidth', String(a.previewWidth)); else localStorage.removeItem('wmd.previewWidth'); } catch { /* ignore */ }
    };
    resizer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = true;
      dragStart = event.clientX;
      dragWidth = pane.getBoundingClientRect().width;
      resizer.setPointerCapture(event.pointerId);
      document.body.classList.add('is-pane-resizing');
    });
    resizer.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const total = pane.parentElement ? pane.parentElement.clientWidth : 1200;
      const next = Math.max(240, Math.min(dragWidth + dragStart - event.clientX, Math.max(280, total - 380)));
      pane.style.width = next + 'px';
      a.previewWidth = Math.round(next);
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-pane-resizing');
      commit();
    };
    resizer.addEventListener('pointerup', endDrag);
    resizer.addEventListener('pointercancel', endDrag);
    resizer.addEventListener('lostpointercapture', endDrag);
    resizer.addEventListener('dblclick', () => { a.previewWidth = null; commit(); askRenderAll(); });
    resizer.addEventListener('keydown', (event) => {
      if (event.key === 'Home') { event.preventDefault(); a.previewWidth = null; commit(); return askRenderAll(); }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const base = pane.getBoundingClientRect().width;
      a.previewWidth = Math.max(240, base + (event.key === 'ArrowLeft' ? 24 : -24));
      commit();
      askRenderAll();
    });
  }
}

function askSaveRename() {
  const a = askState();
  const c = askFindConversation(a.rename.id);
  if (c && a.rename.text.trim()) c.title = a.rename.text.trim();
  a.rename = { open: false, id: '', text: '' };
  askPersist();
  askRenderAll();
}

async function askManageDialog(kind, item) {
  const a = askState();
  const isKb = kind === 'knowledge';
  let pluginKind = isKb ? '' : (kind === 'plugins' ? (a.pluginTab || 'skill') : kind);
  if (!isKb && !['tool', 'skill', 'mcp'].includes(pluginKind)) pluginKind = 'skill';
  const cfg = (item && item.config) || {};
  let mode = cfg.mode === 'bundle' ? 'bundle' : 'text';
  let files = Array.isArray(cfg.files)
    ? cfg.files.map((f) => ({ path: String(f.path || f.name || ''), content: String(f.content ?? '') })).filter((f) => f.path)
    : [];
  const kindLabel = { tool: '工具', skill: '技能', mcp: 'MCP' }[pluginKind] || '';
  const title = isKb
    ? (item ? '编辑知识条目' : '新建知识条目')
    : (item ? '编辑' + kindLabel : '新建' + kindLabel);
  const skillMd = esc(cfg.instructions || '');
  const toolConfig = pluginKind === 'skill' ? '' : esc(JSON.stringify(cfg.extra || {}, null, 2));

  openModal(`<div class="modal-head"><h2>${title}</h2><span class="grow"></span><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button></div>
    <div class="modal-body">
      ${isKb ? '' : `<div class="field"><label>类型</label><input class="input" value="${esc(kindLabel)}" disabled /></div>`}
      <div class="field"><label>名称</label><input class="input" id="ask-manage-name" value="${esc(item ? item.name : '')}" placeholder="${isKb ? '例如：项目世界观' : '例如：资产提取（人物/场景/道具）'}" /></div>
      <div class="field"><label>描述</label><textarea class="input" id="ask-manage-desc" rows="2" placeholder="一句话说明它解决什么问题">${esc(item ? item.description || '' : '')}</textarea></div>
      ${isKb ? '' : pluginKind === 'skill' ? `
        <div class="field"><label>技能形态</label>
          <div class="ask-mode-opts">
            <label class="ask-mode-opt"><input type="radio" name="ask-plugin-mode" value="text" ${mode === 'text' ? 'checked' : ''} /><span><b>文本技能</b><small>单个 SKILL.md / 提示词，适合纯步骤说明</small></span></label>
            <label class="ask-mode-opt"><input type="radio" name="ask-plugin-mode" value="bundle" ${mode === 'bundle' ? 'checked' : ''} /><span><b>完整技能</b><small>SKILL.md + 脚本 / 文档 / 示例文件</small></span></label>
          </div>
        </div>
        <div class="ask-mode-pane ${mode === 'text' ? '' : 'is-hidden'}" id="ask-mode-text">
          <div class="field"><label>SKILL.md 内容</label><textarea class="input" id="ask-manage-instructions" rows="10" placeholder="写清触发条件、步骤、输出格式、检查项">${skillMd}</textarea></div>
        </div>
        <div class="ask-mode-pane ${mode === 'bundle' ? '' : 'is-hidden'}" id="ask-mode-bundle">
          <div class="field"><label>技能压缩包（.zip）</label>
            <input type="file" id="ask-bundle-zip" class="input" accept=".zip,application/zip" />
            <p class="hint">推荐：把技能目录整体打成一个 zip 上传（根目录或唯一的子目录里要有 SKILL.md），后端会解压到智能体后端的 skills/ 目录。上传压缩包时，下面的 SKILL.md 和附加文件可以留空。</p>
            <div class="hint" id="ask-bundle-zip-name"></div>
          </div>
          <div class="field"><label>SKILL.md 内容（入口，压缩包模式可留空）</label><textarea class="input" id="ask-manage-skillmd" rows="8" placeholder="技能入口说明；脚本和示例放在下面的附加文件里">${skillMd}</textarea></div>
          <div class="field"><label>附加文件（脚本 / 文档 / 示例，文本）</label>
            <input type="file" id="ask-bundle-picker" multiple class="input" accept=".md,.mjs,.js,.py,.txt,.json,.yaml,.yml,.html,.css,.csv" />
            <div class="ask-bundle-list" id="ask-bundle-list"></div>
            <p class="hint">选择多个文件即可；文件名带目录时按目录保存。单个文件建议 &lt; 200KB。</p>
          </div>
        </div>`
      : `<div class="field"><label>配置（JSON，可选）</label><textarea class="input" id="ask-manage-instructions" rows="8" placeholder='例如 {"endpoint":"http://...","headers":{}}'>${toolConfig}</textarea></div>`}
    </div>
    <div class="modal-foot"><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">取消</button><button type="button" class="wmd-btn wmd-btn-sm wmd-btn-primary" id="ask-manage-save">保存</button></div>`);

  const renderFiles = () => {
    const box = $('#ask-bundle-list');
    if (!box) return;
    box.innerHTML = files.length
      ? files.map((f, i) => `<div class="ask-bundle-row"><span title="${esc(f.path)}">${esc(f.path)}</span><small>${f.content.length} 字</small><button type="button" data-rm="${i}" title="移除">×</button></div>`).join('')
      : '<p class="hint">还没有附加文件。完整技能可以放 scripts/、references/、examples/ 等。</p>';
    $$('#ask-bundle-list [data-rm]').forEach((btn) => {
      btn.onclick = () => { files.splice(Number(btn.dataset.rm), 1); renderFiles(); };
    });
  };
  renderFiles();

  const updateMode = () => {
    const picked = document.querySelector('input[name="ask-plugin-mode"]:checked');
    mode = picked ? picked.value : 'text';
    const textPane = $('#ask-mode-text');
    const bundlePane = $('#ask-mode-bundle');
    if (textPane) textPane.classList.toggle('is-hidden', mode !== 'text');
    if (bundlePane) bundlePane.classList.toggle('is-hidden', mode !== 'bundle');
  };
  $$('input[name="ask-plugin-mode"]').forEach((radio) => { radio.onchange = updateMode; });

  const picker = $('#ask-bundle-picker');
  if (picker) {
    picker.onchange = async () => {
      for (const file of [...(picker.files || [])]) {
        if (file.size > 200 * 1024) { toast(file.name + ' 超过 200KB，先不要放进技能', true); continue; }
        const text = await file.text();
        if (/^SKILL\.md$/i.test(file.name)) {
          const md = $('#ask-manage-skillmd');
          if (md) md.value = text;
          continue;
        }
        const path = file.webkitRelativePath || file.name;
        files = files.filter((f) => f.path !== path);
        files.push({ path, content: text });
      }
      picker.value = '';
      renderFiles();
    };
  }

  const zipPicker = $('#ask-bundle-zip');
  if (zipPicker) {
    zipPicker.onchange = () => {
      const file = zipPicker.files && zipPicker.files[0];
      const label = $('#ask-bundle-zip-name');
      if (label) label.textContent = file ? ('已选择：' + file.name + ' · ' + Math.round(file.size / 1024) + ' KB') : '';
    };
  }

  $('#ask-manage-save').onclick = async () => {
    try {
      const name = $('#ask-manage-name').value.trim();
      if (!name) return toast('填个名称', true);
      const description = $('#ask-manage-desc').value.trim();
      let payload;
      if (isKb) {
        payload = { name, description };
      } else if (pluginKind === 'skill') {
        if (mode === 'bundle') {
          const zipInput = $('#ask-bundle-zip');
          const zipFile = zipInput && zipInput.files && zipInput.files[0];
          if (zipFile) {
            const form = new FormData();
            form.append('file', zipFile);
            form.append('name', name);
            await askUpload('/skills/upload', form);
            if (item && String(item.id || '').startsWith('dir:') && item.name !== name) {
              await askApi('/plugins/' + encodeURIComponent(item.id), { method: 'DELETE' });
            }
            closeModal();
            await askLoadSkills();
            await askLoadManage();
            toast('已导入技能：' + name);
            return;
          }
          const entry = ($('#ask-manage-skillmd') || {}).value || '';
          if (!entry.trim()) return toast('完整技能需要填写 SKILL.md 入口内容，或上传技能压缩包', true);
          payload = { kind: 'skill', name, description, enabled: item ? item.enabled !== false : true, config: { mode: 'bundle', instructions: entry, files } };
        } else {
          payload = { kind: 'skill', name, description, enabled: item ? item.enabled !== false : true, config: { mode: 'text', instructions: ($('#ask-manage-instructions') || {}).value || '' } };
        }
      } else {
        const raw = ($('#ask-manage-instructions') || {}).value || '';
        let extra = {};
        if (raw.trim()) {
          try { extra = JSON.parse(raw); } catch { extra = { text: raw }; }
        }
        payload = { kind: pluginKind, name, description, enabled: item ? item.enabled !== false : true, config: { mode: 'text', extra } };
      }
      const path = isKb ? '/knowledge' : '/plugins';
      if (item) await askApi(path + '/' + encodeURIComponent(item.id), { method: 'PUT', body: JSON.stringify(payload) });
      else await askApi(path, { method: 'POST', body: JSON.stringify(payload) });
      closeModal();
      await askLoadSkills();
      await askLoadManage();
      toast('已保存');
    } catch (err) {
      toast(err.message, true);
    }
  };
}

function bindScript(root) {
  bindAsk(root);
}
