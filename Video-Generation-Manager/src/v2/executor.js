'use strict';
/**
 * v2 执行器：把一条任务交给官方豆包客户端完成。
 *
 * 原则：提交、上传参考图、参数、确认、解析原片、下载——这些步骤全部直接调用
 * 网页版（v1）已经跑稳的实现（src/automation.js 与 src/adapters/*），
 * 这里只负责两件客户端独有的事：在客户端里切账号，以及「提交后放锁、轮询时
 * 再拿锁」的窗口轮转。客户端只有一个窗口，同一时刻只能看着一个账号，所以
 * 生成在平台侧并行，只有看结果的瞬间才占用窗口。
 *
 * v1 的文件一行都不改：需要的能力都通过它已导出的函数调用。
 */
const path = require('node:path');
const fs = require('node:fs');
const client = require('./client');
const drive = require('./drive');
const automation = require('../automation');
const { readPageState } = require('../adapters/page-state');
const { downloadVideo, validateMP4 } = require('../download');

const { selectorsFor, prepareInputs, submitText, resolveGeneratedMedia, settlePopups, warmUpConversation, firstVisible } = automation;

const POLL_MS = Number(process.env.WMD_V2_POLL_MS || 8000);

let chain = Promise.resolve();
/** 客户端窗口是独占资源：所有界面操作排队拿锁，避免两个任务抢同一个窗口。 */
function withClientLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

// 同一个客户端账号同时只跑一条任务：两个管理器账号如果指向同一个客户端账号，
// 后来的那条要等前一条结束，否则会把对方刚发的会话顶掉。
const accountChains = new Map();
function withAccountSlot(key, fn) {
  const previous = accountChains.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(() => {}, () => {});
  accountChains.set(key, tail);
  tail.then(() => { if (accountChains.get(key) === tail) accountChains.delete(key); });
  return run;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 管理器账号 → 客户端里已登录的账号显示名。 */
function clientAccountName(account) {
  if (!account) return '';
  const remark = String(account.remark || '').trim();
  if (remark && /^(用户|账号|手机号|\d{6,})/.test(remark)) return remark;
  const name = String(account.name || '').trim();
  if (name && /^(用户|账号|手机号|\d{6,})/.test(name)) return name;
  return '';
}

/**
 * 按客户端实际的账号列表做匹配：管理器账号叫「自己号-用户490936」，
 * 客户端显示名是「用户490936 体验套餐」，取客户端账号名的第一段做包含匹配。
 * 匹配不到就返回空，按“用客户端当前账号”处理。
 */
async function resolveClientAccount(page, account) {
  const direct = clientAccountName(account);
  const hay = [account && account.remark, account && account.name].filter(Boolean).join(' ');
  let accounts = [];
  try { accounts = (await drive.listAccounts(page)).accounts || []; } catch { accounts = []; }
  if (!accounts.length) return direct;
  const names = accounts.map((row) => row.name);
  if (direct) {
    const exact = names.find((name) => name.includes(direct));
    if (exact) return exact;
  }
  const hit = names.find((name) => hay.includes(name))
    || names.find((name) => hay.includes(String(name).split(/\s+/)[0]));
  return hit || '';
}

async function ensureOnAccount(page, name, update) {
  if (!name) return false;
  // 只看左下角账号名，不开菜单——轮询每几秒就要看一眼，开菜单太重。
  // 页面刚重建时底部栏可能还没渲染，读不到就当“不确定”，继续走切换流程。
  const info = await drive.bottom(page).catch(() => ({ account: null }));
  const current = String((info.account && info.account.text) || '');
  if (current.includes(name)) return false;
  update({ message: '切换到账号：' + name });
  const result = await drive.switchAccount(page, name, {
    reconnect: async () => { const ctx = await client.reconnect(); return ctx.page; },
  });
  return Boolean(result && result.page);
}

/** 会话可能很长，先把列表滚到顶部让锚点渲染，再滚到底看最新回复。 */
async function scrollMessages(page) {
  const scroller = page.locator('[data-testid="message-list"] .scroller');
  await scroller.evaluateAll((es) => es.forEach((e) => { e.scrollTop = 0; })).catch(() => {});
  await page.waitForTimeout(350);
  await scroller.evaluateAll((es) => es.forEach((e) => { e.scrollTop = e.scrollHeight; })).catch(() => {});
}

/**
 * 下载成片：先用 v1 的 downloadVideo（它会带上页面 Cookie）。
 * 客户端的页面地址是 chrome://，拿它当 Referer 会被 CDN 直接 403，
 * 所以这里显式给官方网页地址做 Referer；401/403 时再用页面请求上下文重试。
 */
const CLIENT_REFERER = 'https://www.doubao.com/';

async function downloadHeaders(page, url) {
  const headers = { Referer: CLIENT_REFERER };
  try { headers['User-Agent'] = await page.evaluate(() => navigator.userAgent); } catch { /* 没有 UA 也能下载 */ }
  try {
    const cookies = await page.context().cookies(url);
    if (cookies.length) headers.Cookie = cookies.map((c) => c.name + '=' + c.value).join('; ');
  } catch { /* 没有 Cookie 也能下载 */ }
  return headers;
}

async function downloadMedia({ url, page, destination, signal, ffprobe, getDispatcher }) {
  const headers = await downloadHeaders(page, url);
  try {
    return await downloadVideo({ url, page, destination, signal, ffprobe, getDispatcher, headers });
  } catch (error) {
    if (!page || page.isClosed() || !/HTTP (401|403)/.test(String(error && error.message))) throw error;
    const temp = destination + '.part';
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try {
      const res = await page.context().request.get(url, { timeout: 300000, headers });
      if (!res.ok()) throw error;
      const body = await res.body();
      if (!body || !body.length) throw new Error('视频下载失败：返回为空');
      fs.writeFileSync(temp, body);
      const checked = await validateMP4(temp, ffprobe);
      fs.renameSync(temp, destination);
      return { path: path.resolve(destination), size: body.length, duration: checked.duration };
    } finally {
      try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* 清理失败不阻塞 */ }
    }
  }
}

// 同一个客户端窗口同一时刻只「观察」一条任务：按提交先后排队。
// 两条任务各自轮询会让窗口在账号之间每几秒来回跳一次，看着就像乱点；
// 这里让最早提交的那条一直看着直到出片，再轮到下一条——平台侧仍然并行生成。
const inflight = new Map();
function markInflight(taskId) { inflight.set(taskId, Date.now()); }
function clearInflight(taskId) { inflight.delete(taskId); }
/** 当前该由哪条任务占用窗口；没有任务时返回空。 */
function focusTaskId() {
  let best = '';
  let earliest = Infinity;
  for (const [id, since] of inflight) if (since < earliest) { earliest = since; best = id; }
  return best;
}

function createClientExecutor({ store, settings, downloads, ffprobe, getDispatcher, interpreter = null, warmup = null, log = () => {} } = {}) {
  return async function execute(rawTask, rawAccount, signal, update = () => {}) {
    if (rawTask.platform !== 'doubao') throw new Error('v2 客户端调度目前只支持豆包');
    // 续查必须回到会话所在的原账号：队列可能因为额度/占用把任务改派给别的账号，
    // 但原会话只在提交它的那个账号里可见。
    if (rawTask.resume) {
      const original = store.get(rawTask.executedAccountId || rawTask.accountId);
      if (original) rawAccount = original;
    }
    // 先确定这条任务落在客户端哪个账号上，再按账号排队：
    // 两个账号才能真轮转，落到同一个账号就必须串行。
    let wanted = clientAccountName(rawAccount);
    if (!wanted) {
      try {
        wanted = await withClientLock(async () => {
          await client.ensureReady({ restart: false });
          const ctx = await client.connect();
          return await resolveClientAccount(ctx.page, rawAccount);
        });
      } catch { wanted = ''; }
    }
    return withAccountSlot(wanted || 'current', () => runTask(rawTask, rawAccount, wanted, signal, update));
  };

  async function runTask(task, account, wanted, signal, update) {
    signal.throwIfAborted();
    update({ status: 'starting', message: '连接官方客户端', progress: 2 });
    await client.ensureReady({ restart: false });

    const selectors = selectorsFor('doubao', account);
    const attachments = (task.references || []).length;
    let page = null;

    /**
     * 客户端会时不时弹推广弹窗（「手机控制电脑」「每日签到」…），它们带一层全屏遮罩，
     * 鼠标事件全被吃掉，点「新对话」、点发送、点确认都会静默失败。动手前先清一遍。
     */
    const clearOverlays = async (target, where = '') => {
      const dismissed = await drive.dismissDialogs(target, { max: 2 }).catch(() => 0);
      if (dismissed) log('关掉挡路的弹窗' + (where ? '（' + where + '）' : ''));
      return dismissed;
    };

    /** 拿到窗口并确保停在目标账号上（切账号会重建页面，所以重新连接）。 */
    const acquire = async () => {
      const ctx = await client.connect();
      let current = ctx.page;
      if (await ensureOnAccount(current, wanted, update)) {
        current = (await client.connect()).page;
        await clearOverlays(current, '切换账号后');
      }
      // 客户端里被浮层挡住/还没渲染好的点击，默认会重试 30 秒，看起来就像卡死；
      // 统一收紧到 6 秒，让每一步要么成功要么很快报错。
      try { current.setDefaultTimeout(6000); } catch { /* 页面刚重建时设置失败，下次再说 */ }
      return current;
    };

    let conversationTitle = String(task.conversationTitle || '');
    // 平台会改写标题，定位会话靠 id：新提交时从页面地址取，续查时从任务记录里取。
    let conversationId = String(task.conversationId || '');
    if (!conversationId) {
      const match = /\/chat\/([^/?#]+)/.exec(String(task.conversationURL || ''));
      if (match) conversationId = match[1];
    }
    // 锚点用「实际渲染出来的自己那条消息」匹配，参考图会被平台换成文件名，
    // 原提示词对不上；轮询时页面重开也能靠这段文字重新认出来。
    let anchorPrompt = String(task.submittedPrompt || task.prompt);
    // 本次提交那条消息的 id：判断「当前页面是不是目标会话」最可靠的依据。
    let submittedMessageId = String(task.submittedMessageId || '');
    // 提交阶段当场确认过的语句，轮询阶段要做同样的任务消息识别。
    const confirmedPhrases = [];

    /* ------------------------------ 提交阶段 ------------------------------ */
    if (!task.resume) {
      await withClientLock(async () => {
        page = await acquire();
        if (wanted) update({ message: '执行账号：' + wanted });
        update({ status: 'starting', message: '新建对话', progress: 4 });
        log('阶段：新建对话');
        await clearOverlays(page, '新建对话前');
        await drive.newChat(page);
        await firstVisible(page, selectors.editor, 30000);
        // 一条任务必须落在全新会话里：同一会话里出现两个视频时，取片很容易拿到旧的那个。
        // 新建后确认会话是空的，不空就再开一次，仍然不空就停下，宁可不提交。
        let blank = null;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          blank = await page.evaluate(readPageState, { selectors });
          if (!blank || !blank.messageCount) break;
          await page.waitForTimeout(500);
          if (attempt === 2) await drive.newChat(page);
        }
        if (blank && blank.messageCount) {
          throw new Error('新建会话失败：当前会话仍有 ' + blank.messageCount + ' 条历史消息；为避免同一会话出现两个视频，已停止提交');
        }
        log('阶段：已确认是全新会话');
        // 客户端只有一个窗口：上一条任务失败留下的参考图会跟着进来，先清掉。
        const leftover = await drive.clearAttachments(page);
        if (leftover) log('残留参考图没有清干净，仍有 ' + leftover + ' 张');

        // 提交前先像普通用户一样聊两轮创作话题（与网页版一致），失败不阻断任务。
        if (warmup) {
          try {
            const info = await warmUpConversation({ page, task, selectors, signal, update, warmup });
            if (info) update({ warmup: info });
          } catch (error) {
            if (/has been closed|Target page, context or browser has been closed/i.test(String(error && error.message))) throw error;
            signal.throwIfAborted();
            update({ warmup: { error: String(error && error.message), finishedAt: new Date().toISOString() } });
          }
        }

        // 视频模式 + 模型/时长/比例 + 参考图上传，全部用网页版已经验证过的实现。
        log('阶段：设置参数与上传参考图' + (attachments ? '（' + attachments + ' 张）' : ''));
        await prepareInputs(page, task, selectors, signal, 'doubao', update);
        log('阶段：参数与参考图完成');
        await clearOverlays(page, '提交前');
        await settlePopups(page, { signal, update, label: '提交前的页面弹窗' });
        const before = await page.evaluate(readPageState, { selectors });
        if (before.captcha) {
          update({ status: 'paused', message: '请在客户端完成人工验证' });
          throw new Error('提交前需要人工验证，请在客户端完成后重新提交');
        }

        update({ status: 'submitting', message: '提交提示词', progress: 10 });
        log('阶段：提交提示词');
        let charged = false;
        await submitText(page, task.prompt, selectors, signal, () => {
          if (charged) return;
          charged = true;
          const quota = store.consumeQuota(account.id);
          update({ quotaCharged: true, quotaDate: quota.date, executedAccountId: account.id });
        }, attachments ? task.references : null);

        // 等到自己那条消息出现，既确认发送成功，也拿到渲染后的文字做锚点。
        const end = Date.now() + 60000;
        let state = null;
        while (Date.now() < end) {
          signal.throwIfAborted();
          state = await page.evaluate(readPageState, { selectors, baseline: before.keys, prompt: task.prompt, attachments });
          if (state.captcha) update({ status: 'paused', message: '请在客户端完成人工验证' });
          if (state.failedSend) throw new Error('发送失败：客户端显示发送失败，请检查账号状态');
          if (state.userKey) break;
          await sleep(600);
        }
        if (!state || !state.userKey) throw new Error('发送未确认：没有找到本次新增的用户消息；为避免重复生成，未自动重发');
        // 锚点用页面上完整渲染出来的文字：messages[].text 只留 160 字，参考图绑定后正文也会被改写，
        // 所以按消息 id 取整条气泡的文本；轮询时页面重开也能靠这段文字重新认出来。
        const fullText = await drive.messageText(page, state.userId);
        anchorPrompt = fullText || task.prompt;
        submittedMessageId = String(state.userId || '');
        log('阶段：等待平台确认开始生成');
        // 提交完成不等于平台开始生成：先在这个会话里等到平台明确回复「正在生成」，
        // 需要确认时当场确认，确认到了再放锁进入轮询。
        update({ status: 'submitting', message: '等待平台确认开始生成', progress: 12 });
        const ackDeadline = Date.now() + 180000;
        let acked = false;
        let ackText = '';
        let ackStableSince = Date.now();
        let confirmationSent = false;
        while (Date.now() < ackDeadline) {
          signal.throwIfAborted();
          await page.waitForTimeout(2500);
          const ack = await page.evaluate(readPageState, { selectors, baseline: before.keys, prompt: task.prompt, attachments });
          if (ack.captcha) { update({ status: 'paused', message: '请在客户端完成人工验证' }); continue; }
          if (ack.quota) throw new Error('平台额度不足：' + String(ack.text).slice(-500));
          if (ack.refusal) throw new Error('平台拒绝：' + String(ack.text).slice(-800));
          if (ack.failure) throw new Error('平台生成失败：' + String(ack.text).slice(-800));
          if (ack.canceled) throw new Error('平台取消了这次生成：' + String(ack.text).slice(-500));
          if (ack.text !== ackText) { ackText = ack.text; ackStableSince = Date.now(); }
          if (ack.generating || ack.complete) { acked = true; break; }
          // 回复稳定 8 秒后还没进生成，且平台在问确认，就把确认发出去（判定规则和轮询阶段一致）。
          if (!confirmationSent && ack.confirmation && Date.now() - ackStableSince >= 8000) {
            let verdict = null;
            try {
              if (interpreter) {
                verdict = await interpreter.classify({
                  task: { prompt: anchorPrompt, model: task.model, duration: task.duration, ratio: task.ratio, resolution: task.resolution },
                  lastReply: ackText,
                  recentReplies: (ack.replies || []).slice(-10).map((reply) => reply.text),
                  sent: [anchorPrompt],
                  pushRounds: 0,
                });
              }
            } catch (error) { log('理解器判定失败，按规则兜底：' + error.message); }
            if (verdict && verdict.nextAction === 'fail' && verdict.confidence >= 0.6) {
              throw new Error('平台拒绝：' + (verdict.evidence || ackText.slice(-500)));
            }
            const phrase = (verdict && verdict.nextAction === 'confirm' && verdict.confidence >= 0.75 && verdict.suggestedReply)
              || '确认，开始生成视频';
            await clearOverlays(page, '发送确认前');
            await submitText(page, phrase, selectors, signal);
            confirmationSent = true;
            confirmedPhrases.push(phrase);
            update({
              status: 'submitting',
              confirmationSentAt: new Date().toISOString(),
              confirmationPhrase: phrase,
              confirmationSource: verdict && verdict.nextAction === 'confirm' ? 'ai' : 'rule',
              message: '已确认生成：' + phrase,
            });
            ackText = '';
            ackStableSince = Date.now();
            continue;
          }
        }
        if (!acked) log('没有读到明确的「正在生成」提示，交给轮询继续判断');

        // 平台开始生成后才会把 local_ 临时会话换成正式 id，等它换过来。
        for (let i = 0; i < 12 && !conversationId; i += 1) {
          const currentId = drive.conversationId(page);
          if (currentId && !/^local_/.test(currentId)) { conversationId = currentId; break; }
          await page.waitForTimeout(1250);
        }

        // 平台先显示「新对话」，几秒后才给正式标题。标题只用来在左侧列表里排序，
        // 真正定位会话用的是 id。
        for (let i = 0; i < 10; i += 1) {
          const title = await drive.conversationTitle(page).catch(() => '');
          if (title && !/^(新对话|豆包|新建对话|新建会话)$/.test(title)) { conversationTitle = title; break; }
          const chats = await drive.recentChats(page).catch(() => []);
          const first = chats[0];
          if (first && first.text) conversationTitle = first.text;
          if (conversationTitle) break;
          await page.waitForTimeout(1500);
        }
        update({
          status: 'generating',
          progress: 15,
          message: '已提交，等待平台生成',
          conversationURL: page.url(),
          conversationTitle,
          conversationId,
          submittedPrompt: anchorPrompt,
          submittedMessageId,
        });
      });
    } else if (!conversationId && !conversationTitle) {
      throw new Error('无法续跑：任务里没有保存会话标识，请在客户端里找到该会话后重新提交');
    } else {
      // 续查：不重新发送提示词，只在原会话里继续等成片。
      await withClientLock(async () => {
        page = await acquire();
        await drive.openConversation(page, { id: conversationId, title: conversationTitle });
        await drive.expandMessages(page);
        const found = await drive.findUserMessage(page, task.prompt);
        if (found && found.text) anchorPrompt = found.text;
        if (found && found.id) submittedMessageId = String(found.id);
        if (!conversationId) conversationId = drive.conversationId(page);
        // 旧记录里的标题可能还停在「新对话」，打开会话后刷新一次。
        const freshTitle = await drive.conversationTitle(page).catch(() => '');
        if (freshTitle && !/^(新对话|豆包|新建对话|新建会话)$/.test(freshTitle)) conversationTitle = freshTitle;
        update({
          status: 'generating',
          progress: 15,
          message: '继续查询已提交会话，不重新发送提示词',
          submittedPrompt: anchorPrompt,
          submittedMessageId,
          conversationId,
          conversationTitle,
        });
      });
    }

    /* ------------------------------ 轮转等待 ----------------------------- */
    // 从这一刻起本条任务在飞；谁最早提交谁先占用窗口观察。
    markInflight(task.id);
    try {
    const deadline = Date.now() + Math.max(60, Number(task.timeoutSeconds) || 3600) * 1000;
    const taskReplies = [String(anchorPrompt || '').slice(0, 400), ...confirmedPhrases];
    const confirmReplies = [...confirmedPhrases];
    let round = 0;
    let confirmations = 0;
    let pushRounds = 0;
    let lastConfirmation = '';
    let lastPushSource = '';
    let lastUnderstoodKey = '';
    let lastVerdict = null;
    let lastReply = '';
    let stableSince = Date.now();
    let completeSince = 0;

    const readState = async (extra = {}) => {
      page = await acquire();
      await clearOverlays(page, '轮询');
      // 当前页本来就是目标会话（能看见本次提交的那条消息）时，什么都不点。
      // 只有确认不在目标会话上，才做一次精确定位，避免在左侧列表里来回点。
      const onTarget = submittedMessageId
        ? await drive.hasMessage(page, submittedMessageId)
        : Boolean(await drive.findUserMessage(page, anchorPrompt));
      if (!onTarget && (conversationId || conversationTitle)) {
        await drive.openConversation(page, { id: conversationId, title: conversationTitle }).catch(() => false);
      }
      // 提交瞬间地址还是 local_ 临时 id；平台分配正式 id 后在这里补上，之后就用 id 定位。
      const current = drive.conversationId(page);
      if (current && !/^local_/.test(current) && current !== conversationId) {
        conversationId = current;
        update({ conversationId, conversationURL: page.url() });
      }
      // 长消息默认折叠，展开后再读，否则锚点文字和经验证的原提示词对不上。
      await drive.expandMessages(page);
      await scrollMessages(page);
      // 锚点直接用「这次提交那条消息在页面上的完整文本」，和 readPageState 比对的是同一份 DOM，
      // 不会再出现存储文本和渲染文本差一两个字符、锚点认不出来的情况。
      if (submittedMessageId) {
        const currentText = await drive.messageText(page, submittedMessageId);
        if (currentText) anchorPrompt = currentText;
      }
      return page.evaluate(readPageState, {
        selectors,
        baseline: [],
        prompt: anchorPrompt,
        anchorKey: '',
        attachments,
        taskReplies,
        confirmReplies,
        ...extra,
      });
    };

    let waitingForFocus = false;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      // 窗口一次只观察一条任务：不是最早的这条就先让位，平台仍在后台生成。
      const focus = focusTaskId();
      if (focus && focus !== task.id) {
        if (!waitingForFocus) {
          waitingForFocus = true;
          update({ message: '排队等待：先取回更早提交的任务' });
          log('让出窗口，等待更早提交的任务出片');
        }
        await sleep(4000);
        continue;
      }
      if (waitingForFocus) {
        waitingForFocus = false;
        update({ message: '轮到自己取片，切回该账号' });
      }
      await sleep(POLL_MS);
      signal.throwIfAborted();
      round += 1;

      const seen = await withClientLock(async () => {
        const state = await readState();
        // 有的成片消息不带「视频生成好了」这类文字，只挂一个视频卡片，所以单独看视频块。
        const videoMessageId = await drive.lastVideoMessageId(page).catch(() => '');
        return { ...state, videoMessageId };
      });
      update({
        progress: Math.min(80, 15 + round * 3),
        message: `轮询第 ${round} 次：${seen.complete || seen.videoMessageId ? '成片就绪' : seen.generating ? '生成中' : seen.responding ? '平台正在回复' : '等待成片'}`,
      });

      if (seen.captcha) {
        update({ status: 'paused', message: '客户端要求人工验证：请在客户端里完成验证，任务会自动继续' });
        continue;
      }
      if (seen.quota) {
        const current = store.get(account.id);
        store.update(account.id, { quotaUsed: current.quota.limit, cooldownUntil: 0 });
        const error = new Error('平台额度不足，已标记该账号今日额度用完；平台原文：' + String(seen.text).slice(-500));
        error.code = 'ACCOUNT_QUOTA_EXHAUSTED';
        throw error;
      }
      if (seen.canceled) {
        const canceled = new Error(task.stopRequestedAt ? '已通过管理器取消视频生成' : '平台已确认取消视频生成');
        canceled.code = 'CANCELED';
        throw canceled;
      }
      if (seen.refusal) throw new Error('平台拒绝：' + String(seen.text).slice(-1000));
      if (seen.failure) throw new Error('平台生成失败：' + String(seen.text).slice(-1000));

      if (seen.text !== lastReply) { lastReply = seen.text; stableSince = Date.now(); }

      // 新回复稳定后让理解器（智能体）判断一次，模型不可用时退回正则。
      if (interpreter && !seen.responding && !seen.generating && seen.replies.length) {
        const latest = seen.replies[seen.replies.length - 1];
        const replyKey = String(latest.id || latest.key || '') + ':' + String(latest.text || '').length;
        if (replyKey !== lastUnderstoodKey) {
          lastUnderstoodKey = replyKey;
          lastVerdict = null;
          try {
            const understood = await interpreter.classify({
              task: { prompt: anchorPrompt, model: task.model, duration: task.duration, ratio: task.ratio, resolution: task.resolution },
              lastReply: latest.text,
              recentReplies: seen.replies.slice(-10).map((reply) => reply.text),
              sent: taskReplies,
              pushRounds,
            });
            if (understood) {
              lastVerdict = understood;
              update({ replyUnderstanding: { intent: understood.intent, confidence: understood.confidence, nextAction: understood.nextAction, evidence: understood.evidence, suggestedReply: understood.suggestedReply, at: new Date().toISOString() } });
            }
          } catch (error) {
            log('理解器判定失败，按规则兜底：' + error.message);
          }
        }
      }

      // 平台已生成：解析原片地址（与网页版同一套：官方接口优先，其次页面地址）。
      const candidate = seen.media.find((item) => item.ready);
      if (seen.complete || candidate || seen.videoMessageId) {
        if (!completeSince) completeSince = Date.now();
        update({ status: 'downloading', message: '平台已生成，解析原片地址', progress: 85 });
        const plan = await withClientLock(async () => {
          const fresh = await readState();
          // 同一会话里可能已经有更早的一条视频：只保留最新那条消息去解析，
          // 否则官方接口会按消息顺序返回第一个，取回的是上一条任务的片子。
          const newest = seen.videoMessageId || await drive.lastVideoMessageId(page).catch(() => '');
          let state = fresh;
          if (newest) {
            const kept = fresh.replies.filter((reply) => reply.id === newest);
            state = { ...fresh, replies: kept.length ? kept : [{ id: newest, key: '', text: '' }] };
          }
          return resolveGeneratedMedia({ page, state, task, anchorKey: state.userKey || '', signal, getDispatcher });
        });
        if (plan && plan.media) {
          const directory = typeof downloads === 'function' ? downloads() : downloads;
          const destination = path.join(directory, task.id + '.mp4');
          update({ status: 'downloading', message: '下载并检查 MP4 完整性与时长', progress: 90 });
          const result = await downloadMedia({ url: plan.media.url, page, destination, signal, ffprobe, getDispatcher });
          return {
            ...result,
            file: path.basename(result.path),
            watermarkMethod: plan.media.method,
            ownership: plan.ownership,
            downloadedAt: new Date().toISOString(),
          };
        }
        if (Date.now() - completeSince > 45000) throw new Error('平台视频已生成，但没有解析到可确认归属的原片地址');
        continue;
      }

      // 确认 / 催促：判断规则与网页版一致，确认话术由理解器决定。
      const verdict = lastVerdict;
      const confident = Boolean(verdict && verdict.confidence >= 0.6);
      const suppressRegex = confident && ['wait', 'fail'].includes(verdict.nextAction);
      if (confident && verdict.nextAction === 'fail') throw new Error('平台拒绝：' + (verdict.evidence || String(seen.text).slice(-1000)));
      const confirmByLlm = confident && verdict.nextAction === 'confirm' && verdict.confidence >= 0.75;
      const confirmByRegex = !suppressRegex && seen.confirmation;
      const confirmStable = confirmByLlm ? Date.now() - stableSince >= 4000 : Date.now() - stableSince >= 15000;
      if (!seen.responding && !seen.generating && !seen.confirmationSent && confirmations === 0
        && (confirmByLlm || confirmByRegex) && confirmStable && seen.text !== lastConfirmation) {
        const phrase = (confirmByLlm && verdict.suggestedReply) || '确认，开始生成视频';
        await withClientLock(async () => {
          page = await acquire();
          try { await drive.openConversation(page, { id: conversationId, title: conversationTitle }); } catch { /* 已在当前会话 */ }
          await submitText(page, phrase, selectors, signal);
        });
        confirmations += 1;
        lastConfirmation = seen.text;
        taskReplies.push(phrase);
        confirmReplies.push(phrase);
        update({ confirmationSentAt: new Date().toISOString(), confirmationPhrase: phrase, confirmationSource: confirmByLlm ? 'ai' : 'rule', message: '已确认生成：' + phrase });
        continue;
      }

      // 平台先回「暂时不能生成」时继续请求，最多 3 轮（与网页版一致）。
      const pushByLlm = confident && verdict.nextAction === 'push';
      const pushByRegex = !suppressRegex && seen.videoUnavailable;
      const pushStable = pushByLlm ? Date.now() - stableSince >= 4000 : Date.now() - stableSince >= 8000;
      if (!seen.responding && !seen.generating && !seen.confirmationSent && (pushByLlm || pushByRegex) && pushRounds < 3 && pushStable && seen.text !== lastPushSource) {
        pushRounds += 1;
        lastPushSource = seen.text;
        const phrase = (pushByLlm && verdict.suggestedReply) || '请直接用视频生成功能帮我生成这条视频';
        await withClientLock(async () => {
          page = await acquire();
          try { await drive.openConversation(page, { id: conversationId, title: conversationTitle }); } catch { /* 已在当前会话 */ }
          await submitText(page, phrase, selectors, signal);
        });
        taskReplies.push(phrase);
        stableSince = Date.now();
        lastReply = '';
        update({ pushRounds, pushSource: pushByLlm ? 'ai' : 'rule', message: '平台暂未同意生成（第 ' + pushRounds + '/3 轮），正在再次请求', progress: 25 });
      }
    }
    throw new Error('客户端等待成片超时；未自动重复提交原始提示词');
    } finally {
      clearInflight(task.id);
    }
  }
}

module.exports = { createClientExecutor, withClientLock, clientAccountName, resolveClientAccount, downloadMedia, focusTaskId, inflightCount: () => inflight.size };
