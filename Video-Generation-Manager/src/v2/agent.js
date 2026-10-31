'use strict';
/**
 * v2 智能体：在「官方客户端」上按目标自己决定下一步点哪里。
 *
 * 设计取舍：
 * - 工具（drive.js）只负责“看得懂、点得到”，不含任何流程判断；
 * - 智能体拿到目标 + 当前界面快照，自己决定调用哪个工具；
 * - 没有配置模型时不假装智能：退回 playbook（同一套工具的顺序编排），
 *   行为仍然可用、可测试，但不会“猜”。
 */
const drive = require('./drive');

/* --------------------------------- 工具表 --------------------------------- */

function toolList(page) {
  return {
    'menu.sidebar': {
      spec: { description: '读取左侧菜单项（新对话、更多等）', args: {} },
      run: () => drive.sidebar(page),
    },
    'menu.bottom': {
      spec: { description: '读取底部工具条按钮和左下角账号入口', args: {} },
      run: () => drive.bottom(page),
    },
    'chat.new': {
      spec: { description: '新建一个对话', args: {} },
      run: () => drive.newChat(page),
    },
    'chat.send': {
      spec: { description: '在当前对话的输入框里发送一条消息', args: { text: '要发送的文字' } },
      run: ({ text }) => drive.typeAndSend(page, text),
    },
    'chat.read': {
      spec: { description: '读取最近的消息（角色、文字、媒体地址）', args: { limit: '条数，默认 10' } },
      run: ({ limit }) => drive.messages(page, { limit: Number(limit) || 10 }),
    },
    'chat.wait': {
      spec: { description: '等待助手给出新的、已经稳定的回复', args: { timeoutMs: '超时毫秒，默认 180000' } },
      run: ({ timeoutMs }) => drive.waitReply(page, { timeoutMs: Number(timeoutMs) || 180000 }),
    },
    'video.enter': {
      spec: { description: '把输入框切到视频生成模式', args: {} },
      run: () => drive.enterVideoMode(page),
    },
    'video.options': {
      spec: { description: '设置视频比例和时长', args: { ratio: '16:9|9:16|1:1|4:3|3:4', seconds: '5-15 的秒数' } },
      run: ({ ratio, seconds }) => drive.setVideoOptions(page, { ratio, seconds: Number(seconds) || 0 }),
    },
    'video.latest': {
      spec: { description: '读取最近一条成片的地址', args: {} },
      run: () => drive.latestVideo(page),
    },
    'account.list': {
      spec: { description: '列出客户端里已登录的账号', args: {} },
      run: () => drive.listAccounts(page),
    },
    'account.switch': {
      spec: { description: '切换到一个已登录的账号', args: { name: '账号显示名' } },
      run: ({ name }) => drive.switchAccount(page, name),
    },
    'ui.click': {
      spec: { description: '按界面文字点击一个元素（找不到就别硬点）', args: { text: '要点击的文字' } },
      run: ({ text }) => drive.clickText(page, text),
    },
    'ui.screenshot': {
      spec: { description: '截一张当前界面，返回文件路径', args: {} },
      run: () => drive.screenshot(page, { directory: require('node:path').join(process.cwd(), 'data', 'v2', 'shots') }),
    },
  };
}

/** 给模型看的工具清单：只描述“能做什么”，不写选择顺序。 */
function toolCatalog(tools) {
  return Object.entries(tools).map(([name, item]) => ({
    name,
    description: item.spec.description,
    args: item.spec.args || {},
  }));
}

/* --------------------------------- 观察 --------------------------------- */

async function observe(page) {
  const [sidebar, bottom, composer, messages] = await Promise.all([
    drive.sidebar(page).catch(() => []),
    drive.bottom(page).catch(() => ({ buttons: [], account: null })),
    drive.composer(page).catch(() => ({ visible: false, chips: [] })),
    drive.messages(page, { limit: 6 }).catch(() => ({ rows: [], total: 0, streaming: false })),
  ]);
  return {
    sidebar: sidebar.map((row) => row.text),
    bottom: {
      buttons: (bottom.buttons || []).map((row) => row.text),
      account: bottom.account ? bottom.account.text : '',
    },
    composer,
    recent: (messages.rows || []).map((row) => ({
      role: row.role,
      text: String(row.text || '').slice(0, 300),
      media: (row.media || []).length,
    })),
    streaming: messages.streaming,
  };
}

/* --------------------------------- 模型 --------------------------------- */

function endpoint(baseUrl, protocol = 'openai') {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (protocol === 'anthropic') return /\/v1\/messages$/i.test(base) ? base : base + '/v1/messages';
  if (/\/chat\/completions$/i.test(base)) return base;
  let pathname = '';
  try { pathname = new URL(base).pathname; } catch { return base + '/v1/chat/completions'; }
  if (!pathname || pathname === '/') return base + '/v1/chat/completions';
  return base + '/chat/completions';
}

async function askModel(cfg, { system, user, timeoutMs = 30000 }) {
  const url = endpoint(cfg.baseUrl, cfg.protocol);
  if (!url || !cfg.model) throw new Error('没有配置可用的模型');
  const key = String(cfg.apiKey || '').trim();
  const headers = { 'Content-Type': 'application/json' };
  let body;
  if (cfg.protocol === 'anthropic') {
    if (key) headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: cfg.model, max_tokens: 1200, temperature: 0, system, messages: [{ role: 'user', content: user }] };
  } else {
    if (key) headers.Authorization = 'Bearer ' + key;
    body = {
      model: cfg.model,
      temperature: 0,
      max_tokens: 1200,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
    };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5000, Number(timeoutMs) || 30000));
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error('模型返回 HTTP ' + res.status + '：' + text.slice(0, 200));
    const data = JSON.parse(text);
    if (cfg.protocol === 'anthropic') return String((data.content || []).map((part) => part.text || '').join(''));
    return String(((data.choices || [])[0] || {}).message?.content || '');
  } finally {
    clearTimeout(timer);
  }
}

function parseDecision(text) {
  const raw = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(raw.slice(start, end + 1));
    if (data.done) return { done: true, result: data.result || {} , why: String(data.why || '') };
    if (data.tool) return { tool: String(data.tool), args: data.args || {}, why: String(data.why || '') };
    return null;
  } catch {
    return null;
  }
}

/* --------------------------------- 智能体 -------------------------------- */

const SYSTEM = [
  '你在操作 Windows 上的「豆包」官方客户端（不是网页版），目标是用最少、最自然的操作完成任务。',
  '你只能通过工具操作界面；不要凭空描述界面，也不要一次调用多个工具。',
  '每一步只输出一个 JSON 对象，不要 Markdown、不要解释：',
  '{"tool":"工具名","args":{...},"why":"一句话原因"}',
  '任务完成时输出：{"done":true,"result":{...},"why":"一句话原因"}',
  '原则：',
  '- 先看再点：不确定界面状态时先用只读工具（menu.sidebar / menu.bottom / chat.read）观察。',
  '- 平台如果反问“是否确认生成”，用 chat.send 回复一句自然的中文确认，再继续等待。',
  '- 看起来卡住时换一种观察方式（截图/读消息），不要重复同一个失败的点击。',
  '- 已经拿到成片地址就可以结束，不要多余操作。',
].join('\n');

function createAgent({ settings, getDispatcher, log = () => {} } = {}) {
  async function modelConfig() {
    const cfg = settings && settings.value ? settings.value.interpreter : null;
    if (!cfg || !cfg.enabled || !cfg.baseUrl || !cfg.model) return null;
    return cfg;
  }

  /** 有模型就让它决策，没有就返回 null，由调用方走 playbook。 */
  async function decide({ page, goal, history, step }) {
    const cfg = await modelConfig();
    if (!cfg) return null;
    const tools = toolList(page);
    const snapshot = await observe(page);
    const user = [
      '目标：' + JSON.stringify(goal),
      '可用工具：' + JSON.stringify(toolCatalog(tools)),
      '当前界面：' + JSON.stringify(snapshot),
      '已经做过的步骤：' + JSON.stringify(history.slice(-8)),
      '第 ' + (step + 1) + ' 步。',
    ].join('\n\n');
    const text = await askModel(cfg, { system: SYSTEM, user, timeoutMs: cfg.timeoutMs || 30000 });
    const decision = parseDecision(text);
    if (!decision) throw new Error('模型没有给出可执行的 JSON 决策');
    return decision;
  }

  async function run({ page, goal, maxSteps = 12 }) {
    const tools = toolList(page);
    const history = [];
    for (let step = 0; step < maxSteps; step += 1) {
      let decision = null;
      try {
        decision = await decide({ page, goal, history, step });
      } catch (error) {
        log('模型决策失败，改用固定流程：' + error.message);
      }
      if (!decision) return { mode: 'playbook', ...(await playbook(page, goal, { log })) };
      if (decision.done) return { mode: 'agent', result: decision.result, history };
      const tool = tools[decision.tool];
      if (!tool) {
        history.push({ step, tool: decision.tool, error: '没有这个工具' });
        continue;
      }
      try {
        const result = await tool.run(decision.args || {});
        history.push({ step, tool: decision.tool, args: decision.args || {}, why: decision.why, ok: true, result: summarise(result) });
        log(`第 ${step + 1} 步：${decision.tool} → ${decision.why || ''}`);
      } catch (error) {
        history.push({ step, tool: decision.tool, args: decision.args || {}, ok: false, error: error.message });
        log(`第 ${step + 1} 步失败：${decision.tool} ${error.message}`);
      }
    }
    throw new Error('智能体在 ' + maxSteps + ' 步内没有完成任务');
  }

  return { run, observe, tools: (page) => toolList(page) };
}

function summarise(value) {
  if (!value) return null;
  if (Array.isArray(value)) return { count: value.length };
  if (typeof value === 'object') {
    const out = {};
    for (const key of ['sent', 'total', 'visible', 'url', 'role', 'text', 'account', 'switched', 'mode']) {
      if (value[key] !== undefined) out[key] = value[key];
    }
    return Object.keys(out).length ? out : { ok: true };
  }
  return value;
}

/* -------------------------------- 固定流程 ------------------------------- */

/**
 * 没有模型时的保底流程：账号 → 新对话 → 视频模式 → 参数 → 发送 → 等回复 → 取地址。
 * 只处理“正常路径”，遇到平台反问确认时也会回一句确认。
 */
async function playbook(page, goal, { log = () => {} } = {}) {
  const steps = [];
  if (goal.account) {
    const accounts = await drive.listAccounts(page);
    const current = accounts.current || '';
    if (!current.includes(goal.account)) {
      await drive.switchAccount(page, goal.account);
      steps.push('switch-account');
    }
  }
  await drive.newChat(page);
  steps.push('new-chat');
  if (goal.kind === 'video-task') {
    await drive.enterVideoMode(page);
    steps.push('video-mode');
    if (goal.ratio || goal.seconds) {
      const applied = await drive.setVideoOptions(page, { ratio: goal.ratio, seconds: goal.seconds });
      steps.push('options:' + JSON.stringify(applied.applied));
    }
    if (goal.model) {
      const ok = await drive.setModel(page, goal.model);
      steps.push('model:' + (ok ? goal.model : 'skip'));
    }
  }
  const before = await drive.messages(page, { limit: 1 });
  await drive.typeAndSend(page, goal.prompt);
  steps.push('send');
  const deadline = Date.now() + (goal.timeoutMs || 180000);
  let replied = null;
  while (Date.now() < deadline) {
    const state = await drive.messages(page, { limit: 6 });
    const last = [...state.rows].reverse().find((row) => row.role === 'assistant');
    if (last && (state.total > before.total || last.text)) {
      replied = last;
      if (!state.streaming) {
        // 平台可能在反问确认，回一句确认再等
        if (/确认|是否|开始生成/.test(last.text) && !/生成好了/.test(last.text)) {
          await drive.typeAndSend(page, '确认，请开始生成视频');
          steps.push('confirm');
          await page.waitForTimeout(1500);
          continue;
        }
        const video = await drive.latestVideo(page);
        if (video) return { steps, video, reply: last };
      }
    }
    await page.waitForTimeout(1500);
  }
  const video = await drive.latestVideo(page);
  if (video) return { steps, video, reply: replied };
  throw new Error('等待成片超时');
}


/* ---------------------------- 等待阶段的回复判定 --------------------------- */

const REPLY_SYSTEM = [
  '你在操作官方豆包客户端的一个视频生成任务，负责判断平台的回复并决定下一步。',
  '输入：原始提示词、已经发送过的消息、平台最后一条回复。',
  '只输出一个 JSON 对象，不要 Markdown、不要解释：',
  '{"action":"confirm|wait|fail","reply":"需要发送时的一句自然中文","reason":"不超过40字"}',
  '规则：',
  '- 平台在问参数确认、让你确认后再生成 → action=confirm；reply 用口语确认，必须提到“生成视频”，30 字以内，不要链接、@、表情或引号。',
  '- 平台说正在生成、让稍等、已经生成好了 → action=wait。',
  '- 平台明确说违规、无法生成、让你换方式 → action=fail。',
  '- 拿不准就 wait，不要反复催促；同一句话不要连续回两次确认。',
].join('\n');

function parseJsonLoose(text) {
  const raw = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

function parseReplyDecision(text) {
  const data = parseJsonLoose(text);
  if (!data || !data.action) return null;
  const action = ['confirm', 'wait', 'fail'].includes(String(data.action)) ? String(data.action) : 'wait';
  let reply = String(data.reply || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (action === 'confirm' && !/生成/.test(reply)) reply = '确认，开始生成视频';
  return { action, reply, reason: String(data.reason || '').slice(0, 80) };
}

/** 有模型就让模型判断，没配置就返回 null（调用方用规则兜底）。 */
function createReplyDecider({ settings } = {}) {
  return async function decide({ task, lastReply, sent = [] }) {
    const cfg = settings && settings.value ? settings.value.interpreter : null;
    if (!cfg || !cfg.enabled || !cfg.baseUrl || !cfg.model) return null;
    const user = JSON.stringify({
      prompt: String((task && task.prompt) || '').slice(0, 1500),
      sent: (sent || []).slice(-6),
      last_reply: String(lastReply || '').slice(0, 1200),
    });
    const text = await askModel(cfg, { system: REPLY_SYSTEM, user, timeoutMs: cfg.timeoutMs || 30000 });
    return parseReplyDecision(text);
  };
}

module.exports = { createAgent, createReplyDecider, parseReplyDecision,  playbook, observe, toolList, endpoint, parseDecision, SYSTEM };
