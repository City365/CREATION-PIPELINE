'use strict';
/**
 * v2 工具层：把官方客户端界面变成一组「说得清、点得到」的语义操作。
 *
 * 这些函数不负责“该做什么”的判断——那是 agent.js 的事。这里只保证：
 * 左侧菜单、底部菜单、输入框、消息、账号，都能被稳定地读出来和点下去。
 * 选择器集中在 SELECTORS，客户端改版时只改这一处。
 */
const fs = require('node:fs');
const path = require('node:path');

const SELECTORS = {
  sidebarItem: '[class*="sidebar_nav_item"]',
  editable: '[contenteditable="true"], textarea',
  assistant: '[data-testid="receive_message"]',
  user: '[data-testid="send_message"]',
  messageText: '[data-testid="message_text_content"]',
  messageAny: '[data-testid="receive_message"], [data-testid="send_message"]',
  videoBlock: '[class*="block-video"], video',
  menuItem: '[role="menuitem"], [class*="menu"] div, [class*="popover"] div',
};

/** 注入到页面里的公共小工具，避免每个 evaluate 里重复写。 */
const PAGE_HELPERS = `
  const norm = (v) => String(v == null ? '' : v).replace(/\\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const boxOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const pointOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + Math.min(r.width / 2, 40), y: r.y + r.height / 2 }; };
  const smallestWithText = (text, scopeSel) => {
    const scope = scopeSel ? [...document.querySelectorAll(scopeSel)] : [document.body];
    const want = norm(text);
    const hits = [];
    for (const root of scope) {
      for (const el of root.querySelectorAll('div,button,span,a,li,p')) {
        if (!visible(el)) continue;
        if (norm(el.innerText || el.textContent) !== want) continue;
        hits.push(el);
      }
    }
    hits.sort((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height) - (b.getBoundingClientRect().width * b.getBoundingClientRect().height));
    return hits[0] || null;
  };
`;

async function pageOf(ctx) {
  const page = ctx && ctx.page ? ctx.page : null;
  if (!page) throw new Error('客户端没有连接');
  return page;
}

async function evaluate(page, fn, arg) {
  return page.evaluate(fn, arg);
}

/* ---------------------------------- 观察 ---------------------------------- */

/** 左侧菜单：文字 + 位置，供 agent 判断。 */
async function sidebar(page) {
  return evaluate(page, (sel) => {
    /* eslint-disable no-undef */
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const rows = [];
    for (const el of document.querySelectorAll(sel.sidebarItem)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80) continue;
      const raw = norm(el.innerText);
      // 快捷键提示的类名里也带 sidebar_nav_item，单独过滤掉
      if (!raw || /^Ctrl\b/i.test(raw)) continue;
      const text = raw.replace(/\s*Ctrl\s*(Shift\s*)?[+＋]?\s*[A-Za-z]\s*$/i, '').trim();
      if (!text || rows.some((row) => row.text === text)) continue;
      rows.push({ text, title: raw, box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
    }
    return rows;
    /* eslint-enable no-undef */
  }, SELECTORS);
}

/** 底部：工具条按钮（视频生成等）+ 左下角账号入口。 */
async function bottom(page) {
  return evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const h = innerHeight;
    const toolbar = [];
    for (const el of document.querySelectorAll('div,button,span')) {
      if (!visible(el) || el.children.length > 2) continue;
      const r = el.getBoundingClientRect();
      if (r.y < h - 130) continue;
      if (r.x < 300 && r.y > h - 90) continue;
      const text = norm(el.innerText || el.textContent);
      if (!text || text.length > 12) continue;
      toolbar.push({ text, box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
    }
    const seen = new Set();
    const buttons = toolbar.filter((row) => {
      if (row.box.x < 300) return false;
      if (seen.has(row.text)) return false;
      seen.add(row.text);
      return true;
    });
    // 左下角账号入口：认头像而不是认「用户」前缀——客户端里账号可以改昵称（大豆包、小豆包），
    // 按名字前缀匹配会认不出来，切到这些账号后左下角就变成 null。
    // 头像带 user-avatar 的地址是账号头像独有的；侧栏会话行也会露出视口底部，所以限定在视口里。
    const candidates = [...document.querySelectorAll('button,div')].filter((el) => {
      if (!visible(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.x > 330 || r.top < h - 150 || r.bottom > h + 2) return false;
      if (r.width < 100 || r.width > 340 || r.height < 24 || r.height > 80) return false;
      if (!el.querySelector('img[src*="user-avatar"]')) return false;
      return !el.closest('[data-radix-popper-content-wrapper], [role="menu"]');
    });
    const areaOf = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    const accountEl = candidates.find((el) => el.tagName === 'BUTTON')
      || candidates.sort((a, b) => areaOf(a) - areaOf(b))[0]
      || null;
    const account = accountEl ? { text: norm(accountEl.innerText).split('\n')[0], box: (() => { const r = accountEl.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() } : null;
    const gear = [...document.querySelectorAll('[aria-label*="设置"], [title*="设置"]')].filter(visible)
      .map((el) => { const r = el.getBoundingClientRect(); return { text: norm(el.getAttribute('aria-label') || el.getAttribute('title')), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; });
    return { buttons, account, gear };
  });
}

/** 输入框状态：是否可见、当前模式（普通对话 / 视频生成）、占位提示。 */
async function composer(page) {
  return evaluate(page, (sel) => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const editable = [...document.querySelectorAll(sel.editable)].filter(visible).pop() || null;
    const placeholder = editable ? norm(editable.getAttribute('data-placeholder') || editable.getAttribute('placeholder') || (editable.querySelector('[data-placeholder]') || {}).getAttribute?.('data-placeholder') || '') : '';
    const chips = [...document.querySelectorAll('div,button,span')]
      .filter((el) => visible(el) && el.children.length <= 2)
      .filter((el) => { const r = el.getBoundingClientRect(); return r.y > innerHeight - 160 && r.x > 300; })
      .map((el) => norm(el.innerText || el.textContent))
      .filter((text) => text && text.length <= 20);
    return {
      visible: Boolean(editable),
      placeholder,
      html: editable ? editable.innerHTML.slice(0, 200) : '',
      chips: [...new Set(chips)],
    };
  }, SELECTORS);
}

/** 消息列表：角色、文字、媒体地址、是否还在生成。 */
async function messages(page, { limit = 30 } = {}) {
  return evaluate(page, ({ sel, limit }) => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const nodes = [...document.querySelectorAll(sel.messageAny)];
    const rows = nodes.slice(-limit).map((node, index) => {
      const isAssistant = node.matches(sel.assistant) || node.getAttribute('data-role') === 'assistant';
      const texts = [...node.querySelectorAll(sel.messageText)].map((el) => norm(el.innerText)).filter(Boolean);
      const text = texts.join('\n') || norm(node.innerText);
      const media = [...node.querySelectorAll('video, img')].slice(0, 6).map((el) => ({
        tag: el.tagName.toLowerCase(),
        src: (el.currentSrc || el.src || '').slice(0, 400),
        poster: (el.getAttribute('poster') || '').slice(0, 400),
      })).filter((row) => row.src && !row.src.startsWith('data:'));
      return {
        index: index,
        role: isAssistant ? 'assistant' : 'user',
        text: text.slice(0, 4000),
        media,
      };
    });
    const streaming = Boolean(document.querySelector('[data-testid*="stop"], [aria-label*="停止"]'));
    return { total: nodes.length, rows, streaming };
  }, { sel: SELECTORS, limit });
}

/* ---------------------------------- 操作 ---------------------------------- */

async function clickText(page, text, { scopeSel = '', exact = false } = {}) {
  const point = await evaluate(page, ({ text, scopeSel, exact, sel }) => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const want = norm(text);
    const roots = scopeSel ? [...document.querySelectorAll(scopeSel)] : [document.body];
    const hits = [];
    for (const root of roots) {
      for (const el of root.querySelectorAll('div,button,span,a,li,p')) {
        if (!visible(el)) continue;
        const value = norm(el.innerText || el.textContent);
        const ok = exact ? value === want : value.includes(want);
        if (!ok) continue;
        if (el.children.length > 3) continue;
        const r = el.getBoundingClientRect();
        hits.push({ el, area: r.width * r.height, r });
      }
    }
    hits.sort((a, b) => a.area - b.area);
    const hit = hits[0];
    if (!hit) return null;
    return { x: hit.r.x + Math.min(hit.r.width / 2, 60), y: hit.r.y + hit.r.height / 2 };
    // eslint-disable-next-line no-unreachable
    void sel;
  }, { text, scopeSel, exact, sel: SELECTORS });
  if (!point) throw new Error('界面上找不到「' + text + '」');
  await page.mouse.click(point.x, point.y);
  return point;
}

async function newChat(page) {
  // 客户端「新对话」的快捷键是 Ctrl+Shift+K：比点左侧菜单可靠，
  // 菜单里可能正好有一个标题叫「新对话」的历史会话，按文字点会点进那个旧会话。
  const snapshot = () => page.evaluate(() => ({
    visible: Boolean(document.querySelector('[data-testid="chat_input_input"] [contenteditable="true"]')),
    messages: document.querySelectorAll('[data-message-id]').length,
  })).catch(() => ({ visible: false, messages: -1 }));
  await page.keyboard.press('Control+Shift+K').catch(() => {});
  await page.waitForTimeout(1200);
  let state = await snapshot();
  if (state.visible && state.messages === 0) return composer(page);
  // 快捷键没生效时，退回到「新建对话」按钮，再退回到菜单文字（精确匹配）。
  for (const selector of ['[data-testid="create_conversation_button"]', '[data-testid="create_conversation"]']) {
    const button = page.locator(selector).first();
    if (!(await button.count().catch(() => 0))) continue;
    await button.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1200);
    state = await snapshot();
    if (state.visible && state.messages === 0) return composer(page);
  }
  await clickText(page, '新对话', { scopeSel: SELECTORS.sidebarItem, exact: true });
  await page.waitForTimeout(1200);
  const final = await composer(page);
  if (!final.visible) throw new Error('新建对话失败：输入框没有出现');
  return final;
}

async function ensureTextMode(page) {
  // 视频生成模式会在输入框上挂一个「视频生成 ×」的标记，回到普通对话要点掉它
  const state = await composer(page);
  const inVideo = state.chips.some((text) => text.includes('视频生成') && text.includes('×'));
  if (!inVideo) return state;
  const point = await evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const hits = [...document.querySelectorAll('div,button,span')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.y > innerHeight - 160 && /视频生成/.test(norm(el.innerText));
    });
    const el = hits.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width - 6, y: r.y + r.height / 2 };
  });
  if (point) {
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(600);
  }
  return composer(page);
}

async function typeAndSend(page, text) {
  const editable = page.locator(SELECTORS.editable).last();
  await editable.waitFor({ state: 'visible', timeout: 20000 });
  // 输入框上方常驻提示条/浮层会挡住坐标点击，这里直接聚焦编辑器再输入，
  // 焦点拿不到时才退回强制点击。
  const focused = await editable.evaluate((el) => {
    el.focus();
    return document.activeElement === el;
  }).catch(() => false);
  if (!focused) {
    await editable.click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(120);
  await page.keyboard.insertText(String(text));
  await page.waitForTimeout(300);
  const typed = await editable.evaluate((el) => String(el.innerText || el.textContent || '').trim().length).catch(() => 0);
  if (typed < 2) throw new Error('提示词没有输入到输入框（可能被页面浮层挡住）');
  const before = await evaluate(page, (sel) => document.querySelectorAll(sel.messageAny).length, SELECTORS);
  await page.keyboard.press('Enter');
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const now = await evaluate(page, (sel) => document.querySelectorAll(sel.messageAny).length, SELECTORS);
    if (now > before) return { sent: true, total: now };
    await page.waitForTimeout(300);
  }
  throw new Error('消息没有发出去（回车后消息数没有变化）');
}

/** 等这一次对话出现新的助手回复，且内容稳定下来。 */
async function waitReply(page, { timeoutMs = 180000, sinceTotal = 0, settleMs = 2500 } = {}) {
  const started = Date.now();
  let lastText = '';
  let stableSince = 0;
  while (Date.now() - started < timeoutMs) {
    const state = await messages(page, { limit: 8 });
    const last = [...state.rows].reverse().find((row) => row.role === 'assistant');
    const fresh = state.total > sinceTotal && last;
    if (fresh) {
      const text = last.text + '|' + last.media.map((m) => m.src).join(',');
      if (text !== lastText) {
        lastText = text;
        stableSince = Date.now();
      } else if (!state.streaming && Date.now() - stableSince >= settleMs) {
        return { reply: last, total: state.total };
      }
    }
    await page.waitForTimeout(700);
  }
  throw new Error('等待回复超时');
}

/* ---------------------------------- 账号 ---------------------------------- */

/** 挡住菜单/输入框的模态弹窗（例如切号后弹的「手机控制电脑」引导）。 */
async function visibleDialogs(page) {
  return evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
      .filter(visible)
      .filter((el) => norm(el.innerText).length > 0)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { text: norm(el.innerText).slice(0, 60), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
      });
  }).catch(() => []);
}

/**
 * 关掉挡路的模态弹窗。切账号后客户端偶尔会弹「手机控制电脑」这类引导，
 * 它盖在左上角菜单上，鼠标事件全被吃掉——子菜单悬停不展开、点「更多账号」也点不动。
 * 先按 Esc，不行再点弹窗自己的关闭按钮，最后点遮罩。
 */
async function dismissDialogs(page, { max = 3 } = {}) {
  let dismissed = 0;
  for (let round = 0; round < max; round++) {
    const dialogs = await visibleDialogs(page);
    if (!dialogs.length) return dismissed;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(450);
    if (!(await visibleDialogs(page)).length) { dismissed++; continue; }
    const clicked = await evaluate(page, () => {
      const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const dialog = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
        .filter(visible).filter((el) => norm(el.innerText).length > 0).pop();
      if (!dialog) return null;
      const r = dialog.getBoundingClientRect();
      const buttons = [...dialog.querySelectorAll('button, [role="button"], [aria-label]')].filter(visible);
      const labelled = buttons.find((el) => /关闭|close/i.test(el.getAttribute('aria-label') || el.getAttribute('title') || ''));
      // 没有明确标注时，取弹窗右上角那个小按钮（引导弹窗的 × 都是这个位置）。
      const corner = buttons
        .filter((el) => { const b = el.getBoundingClientRect(); return b.width <= 48 && b.height <= 48 && b.right > r.x + r.width * 0.55 && b.top < r.y + r.height * 0.3; })
        .sort((a, b) => { const ar = a.getBoundingClientRect(); const br = b.getBoundingClientRect(); return (br.right + br.bottom) - (ar.right + ar.bottom); })[0];
      const target = labelled || corner;
      if (target) {
        const b = target.getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), mode: 'button' };
      }
      // 连关闭按钮都找不到就点遮罩（弹窗外面一点）。
      const x = Math.max(6, Math.round(r.x) - 30);
      const y = Math.max(6, Math.round(r.y) - 30);
      if (x >= r.x || y >= r.y) return null;
      return { x, y, mode: 'backdrop' };
    }).catch(() => null);
    if (!clicked) return dismissed;
    await page.mouse.click(clicked.x, clicked.y).catch(() => {});
    await page.waitForTimeout(450);
    if (!(await visibleDialogs(page)).length) dismissed++;
  }
  return dismissed;
}

/** 账号菜单是开关式的：已经打开时再点会关掉，所以先判断状态。 */
async function menuOpen(page) {
  return evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('div,span,button')].some((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && norm(el.innerText) === '退出登录';
    });
  });
}

async function closeMenu(page) {
  if (!(await menuOpen(page))) return false;
  const point = await evaluate(page, () => ({ x: Math.round(innerWidth * 0.72), y: Math.round(innerHeight * 0.2) }));
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(400);
  if (await menuOpen(page)) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  return !(await menuOpen(page));
}

async function openAccountMenu(page) {
  const current = async () => {
    const info = await bottom(page).catch(() => ({ account: null }));
    return (info.account && info.account.text) || '';
  };
  if (await menuOpen(page)) return current();
  await dismissDialogs(page, { max: 1 }).catch(() => {});
  // 客户端账号菜单的快捷键是 Ctrl+Shift+（逗号）：比点左下角账号入口稳，
  // 也避免点击被浮层挡住后要等默认超时。
  await page.keyboard.press('Control+Shift+Comma').catch(() => {});
  await page.waitForTimeout(700);
  if (await menuOpen(page)) return current();
  const info = await bottom(page);
  if (!info.account) {
    const size = await page.evaluate(() => ({ w: innerWidth, h: innerHeight })).catch(() => null);
    if (size && (!size.w || !size.h)) throw new Error('豆包客户端窗口被最小化了，页面读不到内容；请把客户端窗口恢复后重试');
    throw new Error('左下角找不到账号入口');
  }
  await page.mouse.click(info.account.box.x + 40, info.account.box.y + info.account.box.h / 2);
  const started = Date.now();
  while (Date.now() - started < 6000) {
    if (await menuOpen(page)) break;
    await page.waitForTimeout(250);
  }
  return info.account.text;
}

/** 账号菜单是左下角弹出的一层浮层：先找到「退出登录」所在的最小容器，再读里面的行。 */
async function menuItems(page) {
  return evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    // 菜单浮层里既有当前账号也有「退出登录」：取包含两者、且高度像浮层的最小容器，
    // 不能再往里缩，否则会缩到「退出登录」那一行本身，读不到其它项。
    const anchors = [...document.querySelectorAll('div,ul,[role="menu"]')]
      .filter((el) => {
        if (!visible(el)) return false;
        const r = el.getBoundingClientRect();
        if (r.height < 150 || r.width < 150) return false;
        return norm(el.innerText).includes('退出登录');
      });
    const popover = anchors.sort((a, b) => area(a) - area(b))[0];
    if (!popover) return [];
    const rows = [];
    for (const el of popover.querySelectorAll('div,button,li,[role="menuitem"],span')) {
      if (!visible(el) || el.children.length > 3) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 90 || r.height < 18 || r.height > 60) continue;
      const text = norm(el.innerText || el.textContent);
      if (!text || text.length > 30) continue;
      if (rows.some((row) => row.text === text && Math.abs(row.box.y - r.y) < 6)) continue;
      rows.push({ text, box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
    }
    return rows;
  });
}

const ACCOUNT_ACTION_TEXTS = new Set(['设置', '外观设置', '收藏夹', '豆包官网', '检查更新', '帮助与反馈', '免费使用豆包', '豆包订阅', '添加账号', '退出登录', '升级', '切换账号']);

/**
 * 菜单里的账号行。客户端只把前两个账号放在主菜单，其余收在「更多账号」子菜单里，
 * 两层用的是同一个 data-testid，所以统一按 testid 收，不再靠文字猜。
 */
async function accountRows(page) {
  return evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    return [...document.querySelectorAll('[data-testid="avatar_menu_account_row"]')]
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const first = el.querySelector('span');
        const text = norm(el.innerText);
        return {
          text,
          name: norm(first ? first.innerText : text).split(/\s+/)[0] || text,
          box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          sub: r.x > 230,
        };
      })
      .filter((row, index, list) => row.name && list.findIndex((other) => other.name === row.name) === index);
  }).catch(() => []);
}

/** 「更多账号」这个子菜单触发器（没有这个入口时返回 null）。 */
async function moreAccountsTrigger(page) {
  return evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const el = [...document.querySelectorAll('[data-slot="dropdown-menu-sub-trigger"], [role="menuitem"]')]
      .filter(visible)
      .find((node) => norm(node.innerText).includes('更多账号'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      expanded: el.getAttribute('aria-expanded') === 'true',
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  }).catch(() => null);
}

/** 展开「更多账号」子菜单；已经展开就直接返回。子菜单是悬停展开的，点一下反而会关掉。 */
async function openMoreAccounts(page) {
  const trigger = await moreAccountsTrigger(page);
  if (!trigger) return false;
  if (trigger.expanded) return true;
  const before = (await accountRows(page)).length;
  const point = { x: trigger.box.x + Math.min(80, Math.round(trigger.box.w / 2)), y: trigger.box.y + Math.round(trigger.box.h / 2) };
  await page.mouse.move(point.x, point.y, { steps: 6 });
  const started = Date.now();
  while (Date.now() - started < 2500) {
    await page.waitForTimeout(250);
    const now = await moreAccountsTrigger(page);
    if (now && now.expanded) return true;
    if ((await accountRows(page)).length > before) return true;
  }
  // 悬停没展开（比如鼠标本来就停在触发器上）才退回到点击。
  await page.mouse.click(point.x, point.y);
  const clickedAt = Date.now();
  while (Date.now() - clickedAt < 2500) {
    await page.waitForTimeout(250);
    const now = await moreAccountsTrigger(page);
    if (now && now.expanded) return true;
    if ((await accountRows(page)).length > before) return true;
  }
  return false;
}

/**
 * 开菜单并把「更多账号」展开。切号后客户端会重建页面、顺手弹一个引导弹窗，
 * 它盖住菜单，悬停展开子菜单就会失败——这种情况关掉菜单、清掉弹窗再来一次。
 */
async function openMenuWithMore(page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await openAccountMenu(page);
    if (!(await moreAccountsTrigger(page))) return { opened: true, more: false };
    const before = (await accountRows(page)).length;
    const more = await openMoreAccounts(page);
    const rows = await accountRows(page);
    if (more || rows.length > before) return { opened: true, more: true };
    if (attempt === 0) {
      await closeMenu(page);
      await dismissDialogs(page, { max: 2 }).catch(() => {});
      await page.waitForTimeout(600);
    }
  }
  return { opened: true, more: false };
}

/** 在已打开的菜单里按名字找账号行（主菜单优先，其次子菜单）。 */
async function findAccountRow(page, name) {
  const rows = await accountRows(page);
  const hit = (list) => list.find((row) => row.text.includes(name)) || null;
  return hit(rows) || hit(rows.filter((row) => row.sub)) || null;
}

async function listAccounts(page) {
  const current = await openAccountMenu(page);
  const { more } = await openMenuWithMore(page);
  let rows = await accountRows(page);
  const items = await menuItems(page);
  await closeMenu(page);
  if (!rows.length) {
    // 老客户端没有这个 testid：退回按文字挑。
    rows = items
      .filter((row) => /^(用户|账号|手机号|\d{6,})/.test(row.text) || (!ACCOUNT_ACTION_TEXTS.has(row.text) && /^\S+\s*(体验套餐|个人版|会员)?$/.test(row.text) && row.box.x < 340))
      .filter((row) => !ACCOUNT_ACTION_TEXTS.has(row.text))
      .map((row) => ({ text: row.text, name: row.text.split('\n')[0].replace(/\s+/g, ' ').trim(), box: row.box, sub: row.box.x > 230 }));
  }
  const accounts = rows
    .map((row) => ({ name: row.name, text: row.text, box: row.box, sub: row.sub }))
    .filter((row, index, list) => row.name && list.findIndex((other) => other.name === row.name) === index);
  return { current, accounts, items: items.map((row) => row.text), more };
}

/**
 * 切换账号。切号会让客户端重建渲染页面（旧 page 句柄直接失效），
 * 所以调用方可以传 reconnect() 拿到新页面；否则这里只等旧页面恢复。
 */
async function switchAccount(page, name, { reconnect = null } = {}) {
  await openAccountMenu(page);
  let target = await findAccountRow(page, name);
  if (!target) {
    await openMenuWithMore(page);
    target = await findAccountRow(page, name);
  }
  if (!target) {
    await closeMenu(page);
    throw new Error('账号菜单里没有「' + name + '」（含「更多账号」子菜单）');
  }
  const point = { x: target.box.x + Math.min(60, Math.round(target.box.w / 2)), y: target.box.y + Math.round(target.box.h / 2) };
  // 子菜单条目只认“从触发器移进内容区”的悬停：直接一步跳过去再点。
  await page.mouse.move(point.x, point.y, { steps: 2 }).catch(() => {});
  await page.waitForTimeout(200);
  await page.mouse.click(point.x, point.y).catch(() => {});
  // 点完之后客户端会重建页面：旧句柄随时可能失效，所以每一轮都先试读，
  // 读不到就重连，直到左下角真的变成目标账号。
  let current = page;
  let blind = 0;
  const started = Date.now();
  while (Date.now() - started < 60000) {
    try {
      if (typeof current.isClosed === 'function' && current.isClosed()) throw new Error('page closed');
      const info = await bottom(current);
      if (info.account && info.account.text.includes(name)) {
        await current.waitForTimeout(500).catch(() => {});
        return { account: info.account.text, switched: true, page: current };
      }
      if (!info.account) {
        // 窗口被最小化时整页几何都是 0，左下角读不到东西——这不代表没切成功，
        // 先把窗口提到前台再接着等，别当成失败。
        blind++;
        if (blind % 3 === 1) await current.bringToFront().catch(() => {});
      } else {
        blind = 0;
      }
    } catch {
      if (typeof reconnect === 'function') {
        try {
          const next = await reconnect(current);
          if (next) current = next;
        } catch { /* 下一轮继续重连 */ }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  await current.bringToFront().catch(() => {});
  throw new Error('切换到「' + name + '」后，左下角没有变成该账号'
    + (blind > 0 ? '（窗口像是被最小化/隐藏了，读不到页面内容）' : ''));
}

/* ---------------------------------- 其它 ---------------------------------- */

async function screenshot(page, { directory, label = 'shot' } = {}) {
  const dir = directory || path.join(process.cwd(), 'data', 'v2', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${label}-${Date.now()}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function open(page) {
  return evaluate(page, () => ({ url: location.href, title: document.title }));
}


/* ------------------------------- 视频生成模式 ------------------------------- */

/** 等输入框（以及视频模式下的参数芯片）就绪。 */
async function waitComposer(page, { video = false, timeoutMs = 20000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await composer(page);
    if (state.visible && (!video || state.chips.some((text) => text.includes('模型')))) return state;
    await page.waitForTimeout(350);
  }
  throw new Error(video ? '视频生成模式没有就绪' : '输入框没有出现');
}

/** 底部工具条：切到视频生成（没有就点一下）。 */
async function enterVideoMode(page) {
  const before = await composer(page);
  if (before.chips.some((text) => text.includes('模型'))) return before;
  await clickText(page, '视频生成');
  return waitComposer(page, { video: true });
}

/** 打开时长/比例弹层，返回可点的选项。 */
async function openVideoOptions(page) {
  const point = await evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const hits = [...document.querySelectorAll('button,div,span')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      if (r.y < innerHeight - 200 || r.x < 300) return false;
      const text = norm(el.innerText);
      return /^(自动|时长)/.test(text) || /^\d+s$/.test(text) || text.includes('·');
    });
    const el = hits.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!point) throw new Error('找不到视频参数入口');
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(900);
  return evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const rows = [];
    for (const el of document.querySelectorAll('div,button,span,li')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.width < 40 || r.height > 60) continue;
      if (el.children.length > 3) continue;
      const text = norm(el.innerText);
      if (!text || text.length > 24) continue;
      rows.push({ text, box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
    }
    const seen = new Set();
    return rows.filter((row) => {
      const key = row.text + '@' + row.box.y;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

/** 在已经打开的弹层里，按文字点中一个选项。 */
async function pickInPanel(page, text) {
  const point = await evaluate(page, (want) => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const hits = [...document.querySelectorAll('div,button,span,li')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.width < 24) return false;
      if (el.children.length > 3) return false;
      const text = norm(el.innerText).replace(/\s+/g, '');
      const target = want.replace(/\s+/g, '');
      // 面板里一项可能被包在「4s 15s」这种容器里，取真正以目标结尾的最小元素
      return text === target || (text.length <= target.length + 4 && text.endsWith(target));
    });
    const el = hits.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, text);
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(500);
  return true;
}

/** 设置比例和时长；面板是同一个浮层，设置完点空白处关掉。 */
async function setVideoOptions(page, { ratio = '', seconds = 0 } = {}) {
  const applied = {};
  if (ratio || seconds) {
    await openVideoOptions(page);
    if (ratio) {
      const map = { '16:9': '16:9', '9:16': '9:16', '1:1': '1:1', '4:3': '4:3', '3:4': '3:4' };
      const label = map[ratio] || '';
      if (label && await pickInPanel(page, label)) applied.ratio = label;
    }
    if (seconds) {
      if (await setDuration(page, seconds)) applied.seconds = Math.round(seconds);
    }
    await closeMenu(page);
    // 以输入框上的实际标记为准，滑杆/选项没生效时不要假装成功
    const state = await composer(page);
    const chip = (state.chips || []).find((text) => text.includes('·')) || '';
    if (ratio && chip.includes(ratio)) applied.ratio = ratio;
    if (seconds && chip.includes(`${Math.round(seconds)}s`)) applied.seconds = Math.round(seconds);
    return { applied, composer: state, chip };
  }
  return { applied, composer: await composer(page) };
}

/** 选模型（模型芯片是另一个弹层）。 */
async function setModel(page, name) {
  if (!name) return false;
  const point = await evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const hits = [...document.querySelectorAll('button,div')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      if (r.y < innerHeight - 200 || r.x < 300) return false;
      return norm(el.innerText).startsWith('模型');
    });
    const el = hits.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(900);
  const ok = await pickInPanel(page, name);
  await closeMenu(page);
  return ok;
}

/**
 * 取最近一条助手消息里的成片地址。
 * 客户端里的成片卡片默认只渲染封面图，要点一下卡片才会挂出 <video>；
 * 点开之后读到的是 CDN 的 https 直链，可以直接带着 Cookie 下载。
 */
async function latestVideo(page) {
  const state = await messages(page, { limit: 12 });
  for (const row of [...state.rows].reverse()) {
    if (row.role !== 'assistant') continue;
    const video = (row.media || []).find((item) => item.tag === 'video' && /^https:/.test(item.src || ''));
    if (video) return { url: video.src, text: row.text, total: state.total };
  }
  // 还没有可播的 video：点开最后一张成片卡片
  const point = await evaluate(page, () => {
    const cards = [...document.querySelectorAll('[class*="block-video"]')];
    const el = cards[cards.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!point) return null;
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(2600);
  const sources = await evaluate(page, () => [...document.querySelectorAll('video')]
    .map((video) => video.currentSrc || video.src || '')
    .filter((src) => /^https:/.test(src)));
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  if (!sources.length) return null;
  const latest = await messages(page, { limit: 12 });
  const lastAssistant = [...latest.rows].reverse().find((row) => row.role === 'assistant');
  return { url: sources[sources.length - 1], text: lastAssistant ? lastAssistant.text : '', total: latest.total };
}


/* ------------------------------- 最近会话 ------------------------------- */

/** 左侧「最近」里的会话：标题 + 位置。 */
async function recentChats(page) {
  return evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const rows = [];
    for (const el of document.querySelectorAll('div,li,a,button')) {
      if (!visible(el) || el.children.length > 3) continue;
      const r = el.getBoundingClientRect();
      if (r.x > 300 || r.width < 120 || r.height < 24 || r.height > 52) continue;
      const text = norm(el.innerText);
      if (!text || text.length > 40) continue;
      // 导航项和日期分组不是会话
      if (/^(豆包|项目|创建新项目|最近)$/.test(text)) continue;
      if (/^(新工作任务|新对话|定时任务|插件|云盘|手机遥控电脑|API 服务|更多)/.test(text)) continue;
      if (/^(今天|昨天|前天|更早)\s*\d*/.test(text) && text.length <= 12) continue;
      if (/Ctrl/i.test(text)) continue;
      if (rows.some((row) => row.text === text)) continue;
      rows.push({ text, box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
    }
    rows.sort((a, b) => a.box.y - b.box.y);
    return rows;
  });
}

/** 点开「最近」里标题匹配的会话。 */
async function openRecent(page, title) {
  const items = await recentChats(page);
  const want = String(title || '').trim();
  const hit = items.find((row) => row.text === want) || items.find((row) => row.text.includes(want));
  if (!hit) throw new Error('左侧最近列表里找不到会话「' + want + '」');
  await page.mouse.click(hit.box.x + 30, hit.box.y + hit.box.h / 2);
  await page.waitForTimeout(2200);
  return hit.text;
}

/** 当前会话在客户端里的 id（页面地址末尾那一段）。 */
function conversationId(page) {
  const match = /\/chat\/([^/?#]+)/.exec(String(page.url() || ''));
  return match ? match[1] : '';
}

/**
 * 按会话定位并打开会话。
 *
 * 标题会被平台改写、提交瞬间地址还是 local_ 临时 id，所以这里不做「挨个试点」：
 * id 精确匹配的链接只点一次，否则按标题点一次，点完都要核对地址。找不到就返回
 * false，由调用方继续用当前页面（当前页往往本来就是目标会话）。
 */
async function openConversation(page, { id = '', title = '' } = {}) {
  const tryOpen = async () => {
    if (id && conversationId(page) === id) return true;
    if (id && !/^local_/.test(id)) {
      const link = page.locator('a[href$="/chat/' + id + '"]').first();
      if (await link.count().catch(() => 0)) {
        await link.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1800);
        if (conversationId(page) === id) return true;
      }
    }
    const want = String(title || '').trim();
    if (want) {
      const items = await recentChats(page).catch(() => []);
      const hit = items.find((row) => row.text === want) || items.find((row) => row.text.includes(want));
      if (hit) {
        await page.mouse.click(hit.box.x + 30, hit.box.y + hit.box.h / 2).catch(() => {});
        await page.waitForTimeout(1800);
        const now = conversationId(page);
        if (!id || !now || now === id) return true;
      }
    }
    return false;
  };
  if (await tryOpen()) return true;
  // 推广弹窗的全屏遮罩会把点击全吃掉：清掉之后再试一次，还是没有才算找不到。
  if (!(await dismissDialogs(page, { max: 1 }).catch(() => 0))) return false;
  return tryOpen();
}

/** 当前页面里有没有这条消息（用消息 id 判断是不是目标会话）。 */
async function hasMessage(page, id) {
  if (!id) return false;
  return page.evaluate((messageId) => Boolean(document.querySelector('[data-message-id="' + messageId + '"]')), id).catch(() => false);
}

/** 长消息会被折叠，读文本前先把「展开全部」都点开。 */
async function expandMessages(page) {
  return page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('div,span,button')) {
      const text = String(el.innerText || '').replace(/\s+/g, '');
      if (text !== '展开全部' || el.children.length > 2) continue;
      (el.closest('button,[role="button"]') || el).click();
      n += 1;
    }
    return n;
  }).catch(() => 0);
}

/**
 * 在会话里找回「这次提交的那条消息」：按提示词开头几十个字做包含匹配。
 * 续查任务时页面是历史渲染，消息文本可能被折叠或改写，所以按开头片段认人。
 */
async function findUserMessage(page, prompt) {
  const head = String(prompt || '').replace(/\s+/g, '').slice(0, 30);
  if (!head) return null;
  return page.evaluate((sample) => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, '').trim();
    let best = null;
    for (const el of document.querySelectorAll('[data-testid="send_message"]')) {
      const text = norm(el.innerText).replace(/展开全部|收起/g, '');
      if (!text.includes(sample)) continue;
      const idNode = el.querySelector('[data-message-id]');
      const full = String(el.innerText || '').replace(/\s*展开全部\s*/g, '').replace(/\s*收起\s*$/g, '').replace(/\s+/g, ' ').trim();
      const candidate = { text: full, id: idNode ? idNode.getAttribute('data-message-id') : '' };
      if (!best || full.length > best.text.length) best = candidate;
    }
    return best;
  }, head).catch(() => null);
}

/** 某条消息完整渲染出来的文字（去掉「展开全部」这类按钮文字）。 */
async function messageText(page, id) {
  if (!id) return '';
  return page.evaluate((messageId) => {
    const node = document.querySelector('[data-message-id="' + messageId + '"]');
    if (!node) return '';
    const holder = node.closest('[data-testid="send_message"]') || node.parentElement || node;
    return String(holder.innerText || '')
      .replace(/\s*展开全部\s*/g, '')
      .replace(/\s*收起\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }, id).catch(() => '');
}


/** 会话里最后一个带视频的消息 id（DOM 顺序即时间顺序）。 */
async function lastVideoMessageId(page) {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-message-id]')].filter((el) => {
      const holder = el.closest('[data-testid="receive_message"]') || el;
      return Boolean(holder.querySelector('[class*="block-video"], video'));
    });
    const last = nodes[nodes.length - 1];
    return last ? last.getAttribute('data-message-id') : '';
  }).catch(() => '');
}

/** 当前对话的标题（顶部栏），去掉「AI 生成可能有误」这类提示后缀。 */
async function conversationTitle(page) {
  return evaluate(page, () => {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const el = document.querySelector('[class*="title"], [data-testid*="title"]');
    let text = norm(el ? el.innerText : document.title);
    text = text.split('AI 生成可能有误')[0].trim();
    return text.replace(/\s*-\s*豆包\s*$/, '').trim();
  });
}


/** 时长是自定义滑杆（aria-valuemin/max 是档位，标签是秒数），用键盘设档并回读。 */
async function setDuration(page, seconds) {
  const want = Math.round(Number(seconds) || 0);
  if (!want) return false;
  const info = await evaluate(page, () => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    const slider = [...document.querySelectorAll('[role="slider"]')].filter(visible)[0];
    if (!slider) return null;
    const labels = [...document.querySelectorAll('div,span')]
      .filter((el) => visible(el) && /^\d+s$/.test(norm(el.innerText)))
      .map((el) => Number(norm(el.innerText).replace('s', '')))
      .filter((value) => value > 0);
    slider.focus();
    return {
      min: Number(slider.getAttribute('aria-valuemin') ?? 0),
      max: Number(slider.getAttribute('aria-valuemax') ?? 0),
      now: Number(slider.getAttribute('aria-valuenow') ?? 0),
      labels: [...new Set(labels)].sort((a, b) => a - b),
    };
  });
  if (!info) return false;
  const base = info.labels.length ? info.labels[0] : 4;
  const index = Math.min(info.max, Math.max(info.min, want - base));
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('role') === 'slider');
  if (!focused) return false;
  await page.keyboard.press('Home');
  for (let i = 0; i < index; i += 1) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  const now = await page.evaluate(() => {
    const slider = document.querySelector('[role="slider"]');
    return slider ? Number(slider.getAttribute('aria-valuenow')) : NaN;
  });
  return now === index;
}

/**
 * 清空输入区里残留的参考图。客户端只有一个窗口，上一条任务失败留下的附件
 * 会跟着进入下一次提交，所以提交前必须清掉。
 * 附件卡上的删除按钮是悬停才出现的浮层，真实点击会落到外层，用 JS 直接点。
 */
async function clearAttachments(page) {
  for (let i = 0; i < 30; i += 1) {
    const count = await page.locator('[data-testid="attachment-image-card"]').count().catch(() => 0);
    if (!count) return 0;
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="attachment-delete-btn"]');
      if (btn) btn.click();
    }).catch(() => {});
    await page.waitForTimeout(400);
  }
  return page.locator('[data-testid="attachment-image-card"]').count().catch(() => -1);
}

module.exports = {
  SELECTORS,
  pageOf,
  sidebar,
  bottom,
  composer,
  messages,
  newChat,
  ensureTextMode,
  clearAttachments,
  waitComposer,
  enterVideoMode,
  openVideoOptions,
  pickInPanel,
  setVideoOptions,
  setDuration,
  setModel,
  latestVideo,
  recentChats,
  openRecent,
  conversationId,
  openConversation,
  hasMessage,
  expandMessages,
  messageText,
  lastVideoMessageId,
  findUserMessage,
  conversationTitle,
  typeAndSend,
  waitReply,
  clickText,
  openAccountMenu,
  menuOpen,
  closeMenu,
  menuItems,
  visibleDialogs,
  dismissDialogs,
  accountRows,
  moreAccountsTrigger,
  openMoreAccounts,
  openMenuWithMore,
  listAccounts,
  switchAccount,
  screenshot,
  open,
};
